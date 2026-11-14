import { describe, expect, test } from 'bun:test';
import type { HostClient } from '@light-launcher/plugin-sdk/runtime';
import { ErrorCode, RpcFailure, type BrowserAssistResult } from '@light-launcher/plugin-sdk/types';
import { BrowserEvents, createBrowserAssist } from '../src/browser-assist';

const PAGE = 'https://f95zone.to/dl/1/';

type HostAssist = (url: string, token: string) => Promise<BrowserAssistResult>;

/** A host client whose browser.assist calls `assist` and records the page URLs. */
function fakeHost(assist: HostAssist) {
  const calls: string[] = [];
  const params: Array<Record<string, unknown>> = [];
  const host = {
    browser: {
      assist: async (input: { url: string; token: string }) => {
        calls.push(input.url);
        params.push(input);
        return assist(input.url, input.token);
      },
    },
  } as unknown as HostClient;
  return { host, calls, params };
}

describe('createBrowserAssist', () => {
  test('uses the host browser.assist when the host granted the browser permission', async () => {
    const events = new BrowserEvents();
    const { host, calls, params } = fakeHost(async () => ({ capturedUrl: 'https://pixeldrain.com/u/abc', filename: 'game.zip', size: 10 }));
    const assist = createBrowserAssist({ hostGranted: true, host, events });

    const result = await assist.capture(PAGE);
    expect(result).toEqual({ capturedUrl: 'https://pixeldrain.com/u/abc', filename: 'game.zip', size: 10 });
    expect(calls).toEqual([PAGE]);
    expect(Object.keys(params[0] ?? {}).sort()).toEqual(['timeoutMs', 'token', 'url']);
  });

  test('passes host waiting and progress notifications to the caller', async () => {
    const events = new BrowserEvents();
    const { host } = fakeHost(async (_url, token) => {
      events.waiting(token, 'Press Download File');
      events.progress(token, 50, 'halfway');
      return { capturedUrl: 'https://pixeldrain.com/u/abc' };
    });
    const assist = createBrowserAssist({ hostGranted: true, host, events });

    const waiting: string[] = [];
    const progress: Array<[number, string | undefined]> = [];
    await assist.capture(PAGE, {
      onWaiting: (message) => waiting.push(message),
      onProgress: (percent, message) => progress.push([percent, message]),
    });
    expect(waiting).toEqual(['Press Download File']);
    expect(progress).toEqual([[50, 'halfway']]);
  });

  test('gives each capture its own token and routes events by it', async () => {
    const events = new BrowserEvents();
    const tokens: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { host } = fakeHost(async (url, token) => {
      tokens.push(token);
      await gate;
      events.waiting(token, `waiting for ${url}`);
      return { capturedUrl: 'https://pixeldrain.com/u/abc' };
    });
    const assist = createBrowserAssist({ hostGranted: true, host, events });

    const firstWaiting: string[] = [];
    const secondWaiting: string[] = [];
    const first = assist.capture(PAGE, { onWaiting: (message) => firstWaiting.push(message) });
    const second = assist.capture(`${PAGE}other/`, { onWaiting: (message) => secondWaiting.push(message) });
    release();
    await Promise.all([first, second]);

    expect(tokens[0]).not.toBe(tokens[1]);
    expect(firstWaiting).toEqual([`waiting for ${PAGE}`]);
    expect(secondWaiting).toEqual([`waiting for ${PAGE}other/`]);
  });

  test('keeps host errors instead of falling back', async () => {
    const events = new BrowserEvents();
    const { host } = fakeHost(async () => {
      throw new RpcFailure(ErrorCode.Timeout, 'browser.assist timed out');
    });
    const assist = createBrowserAssist({ hostGranted: true, host, events });

    await expect(assist.capture(PAGE)).rejects.toThrow('browser.assist timed out');
  });

  test('does not call the host when the browser permission was not granted', async () => {
    const events = new BrowserEvents();
    const { host, calls } = fakeHost(async () => ({ capturedUrl: 'https://example.com/x' }));
    const assist = createBrowserAssist({ hostGranted: false, host, events });

    await expect(assist.capture(PAGE)).rejects.toThrow('needs the browser permission');
    expect(calls).toEqual([]);
  });

  test('reads the on/off setting again for each capture', async () => {
    const events = new BrowserEvents();
    const { host, calls } = fakeHost(async () => ({ capturedUrl: 'https://example.com/x' }));
    let enabled = true;
    const assist = createBrowserAssist({
      hostGranted: true, host, events,
      getEnabled: async () => enabled,
    });

    await expect(assist.capture(PAGE)).resolves.toMatchObject({ capturedUrl: 'https://example.com/x' });
    enabled = false;
    await expect(assist.capture(PAGE)).rejects.toThrow('turned off in the plugin settings');
    expect(calls).toEqual([PAGE]);
  });
});
