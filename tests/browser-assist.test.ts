import { describe, expect, test } from 'bun:test';
import type { HostClient } from '@light-launcher/plugin-sdk/runtime';
import { ErrorCode, RpcFailure, type BrowserAssistResult } from '@light-launcher/plugin-sdk/types';
import { BrowserEvents, createBrowserAssist } from '../src/browser-assist';
import type { CaptureServices } from '../src/host';

const PAGE = 'https://f95zone.to/dl/1/';

/** No browser is installed at this path, so the local browser always refuses. */
const NO_BROWSER = { browserPath: '/no/such/browser', userAgent: 'test' };

type HostAssist = (url: string, token: string) => Promise<BrowserAssistResult>;

/** A host client whose browser.assist calls `assist` and records the page URLs. */
function fakeHost(assist: HostAssist) {
  const calls: string[] = [];
  const host = {
    browser: {
      assist: async ({ url, token }: { url: string; token: string }) => {
        calls.push(url);
        return assist(url, token);
      },
    },
  } as unknown as HostClient;
  return { host, calls };
}

function fakeServices(): { services: CaptureServices; logs: string[] } {
  const logs: string[] = [];
  const services: CaptureServices = {
    credential: { get: async () => null, set: async () => {} },
    log: (level, message) => {
      logs.push(`${level} ${message}`);
    },
    storage: { dataDir: '/unused' },
  };
  return { services, logs };
}

describe('createBrowserAssist', () => {
  test('uses the host browser.assist when the host granted the browser permission', async () => {
    const events = new BrowserEvents();
    const { host, calls } = fakeHost(async () => ({ capturedUrl: 'https://pixeldrain.com/u/abc', filename: 'game.zip', size: 10 }));
    const { services } = fakeServices();
    const assist = createBrowserAssist({ hostGranted: true, host, events, services, settings: NO_BROWSER });

    const result = await assist.capture(PAGE);
    expect(result).toEqual({ capturedUrl: 'https://pixeldrain.com/u/abc', filename: 'game.zip', size: 10 });
    expect(calls).toEqual([PAGE]);
  });

  test('passes host waiting and progress notifications to the caller', async () => {
    const events = new BrowserEvents();
    const { host } = fakeHost(async (_url, token) => {
      events.waiting(token, 'Press Download File');
      events.progress(token, 50, 'halfway');
      return { capturedUrl: 'https://pixeldrain.com/u/abc' };
    });
    const { services } = fakeServices();
    const assist = createBrowserAssist({ hostGranted: true, host, events, services, settings: NO_BROWSER });

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
    const { services } = fakeServices();
    const assist = createBrowserAssist({ hostGranted: true, host, events, services, settings: NO_BROWSER });

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

  test('falls back to the local browser once when the host has no browser.assist', async () => {
    const events = new BrowserEvents();
    const { host, calls } = fakeHost(async () => {
      throw new RpcFailure(ErrorCode.MethodNotFound, 'method not found: browser.assist');
    });
    const { services, logs } = fakeServices();
    const assist = createBrowserAssist({ hostGranted: true, host, events, services, settings: NO_BROWSER });

    await expect(assist.capture(PAGE)).rejects.toThrow('browser assist needs Google Chrome');
    await expect(assist.capture(PAGE)).rejects.toThrow('browser assist needs Google Chrome');
    expect(calls).toEqual([PAGE]);
    expect(logs.filter((line) => line.includes('no browser.assist'))).toHaveLength(1);
  });

  test('refuses every capture without starting a browser when turned off', async () => {
    const { host, calls } = fakeHost(async () => ({ capturedUrl: 'https://pixeldrain.com/u/abc' }));
    const { services } = fakeServices();
    const assist = createBrowserAssist({
      hostGranted: true, host, events: new BrowserEvents(), services, settings: NO_BROWSER, enabled: false,
    });

    await expect(assist.capture(PAGE)).rejects.toThrow('turned off in the plugin settings');
    expect(calls).toEqual([]);
  });

  test('does not call the host when the browser permission was not granted', async () => {
    const events = new BrowserEvents();
    const { host, calls } = fakeHost(async () => ({ capturedUrl: 'https://example.com/x' }));
    const { services } = fakeServices();
    const assist = createBrowserAssist({ hostGranted: false, host, events, services, settings: NO_BROWSER });

    await expect(assist.capture(PAGE)).rejects.toThrow('browser assist needs Google Chrome');
    expect(calls).toEqual([]);
  });

  test('keeps other host errors instead of falling back', async () => {
    const events = new BrowserEvents();
    const { host } = fakeHost(async () => {
      throw new RpcFailure(ErrorCode.Timeout, 'browser.assist timed out');
    });
    const { services } = fakeServices();
    const assist = createBrowserAssist({ hostGranted: true, host, events, services, settings: NO_BROWSER });

    await expect(assist.capture(PAGE)).rejects.toThrow('browser.assist timed out');
  });
});
