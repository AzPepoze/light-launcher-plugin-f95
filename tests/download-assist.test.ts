import { describe, expect, test } from 'bun:test';
import type { FileCandidate, GameRef } from '@light-launcher/plugin-sdk/types';
import { ErrorCode, RpcFailure } from '@light-launcher/plugin-sdk/types';
import { createF95Provider } from '../src/providers/f95';
import { parseProfile } from '../src/providers/xenforo';
import profileJson from '../profiles/f95zone.json';
import { settingsFrom } from '../src/settings';
import { fakeServices } from './fakes';

const profile = parseProfile(profileJson, 'profiles/f95zone.json');

const game: GameRef = {
  source: 'f95',
  sourceId: '12345',
  url: 'https://f95zone.to/threads/12345/',
  title: 'My Game',
};

function file(over: Partial<FileCandidate>): FileCandidate {
  return {
    id: 'file',
    label: 'PIXELDRAIN',
    url: 'https://pixeldrain.com/u/abc',
    host: 'pixeldrain.com',
    kind: 'mirror',
    ...over,
  };
}

describe('prepareDownload with file-host resolvers', () => {
  test('answers with the direct URL, headers, filename, size and hints', async () => {
    const fake = fakeServices();
    const provider = createF95Provider(fake.services, { profile });

    const prepared = await provider.prepareDownload(
      file({ filename: 'game.zip', size: 1234 }),
      game,
      {},
    );

    expect(prepared.url).toBe('https://pixeldrain.com/api/file/abc?download');
    expect(prepared.filename).toBe('game.zip');
    expect(prepared.size).toBe(1234);
    expect(prepared.root).toBe('downloads');
    expect(prepared.subfolder).toBe('My Game');
    expect(prepared.headers['User-Agent']).toBeTruthy();
    expect(fake.browserCalls).toEqual([]);
  });

  test('resolves a host page link even without a content type', async () => {
    const fake = fakeServices({
      respond: () => ({
        text: '<html><body><a id="downloadButton" href="https://cdn.mediafire.com/game.zip">Download</a></body></html>',
      }),
    });
    const provider = createF95Provider(fake.services, { profile });

    const prepared = await provider.prepareDownload(
      file({ url: 'https://www.mediafire.com/file/direct/game.zip/file', host: 'mediafire.com' }),
      game,
      {},
    );

    expect(prepared.url).toBe('https://cdn.mediafire.com/game.zip');
    expect(fake.browserCalls).toEqual([]);
  });

  test('a resolver that needs a person falls back to browser assist', async () => {
    const mediafire = 'https://www.mediafire.com/file/abc/game.zip/file';
    const fake = fakeServices({
      respond: () => ({
        text: '<html><body><div id="countdown">Please wait 15 seconds</div><a id="downloadButton" href="/download/abc">Download</a></body></html>',
        headers: { 'content-type': 'text/html' },
      }),
      capture: () => ({
        capturedUrl: 'https://cdn.mediafire.com/game.zip',
        filename: 'game.zip',
        size: 99,
        headers: { Cookie: 'download=1' },
      }),
    });
    const provider = createF95Provider(fake.services, { profile });

    const prepared = await provider.prepareDownload(
      file({ url: mediafire, host: 'mediafire.com' }),
      game,
      {},
    );

    expect(fake.browserCalls).toEqual([mediafire]);
    expect(prepared).toEqual({
      url: 'https://cdn.mediafire.com/game.zip',
      headers: { Cookie: 'download=1' },
      filename: 'game.zip',
      size: 99,
      root: 'downloads',
      subfolder: 'My Game',
    });
  });

  test('an unsupported mirror page also falls back to browser assist', async () => {
    const url = 'https://gofile.io/d/AbCdEf';
    const fake = fakeServices({
      capture: () => ({ capturedUrl: 'https://cdn.gofile.io/game.zip' }),
    });
    const provider = createF95Provider(fake.services, { profile });

    const prepared = await provider.prepareDownload(file({ url, host: 'gofile.io' }), game, {});
    expect(fake.browserCalls).toEqual([url]);
    expect(prepared.url).toBe('https://cdn.gofile.io/game.zip');
  });
});

describe('prepareDownload browser assist', () => {
  const redirect = file({
    url: 'https://f95zone.to/dl/1/',
    host: 'pixeldrain',
    kind: 'mirror',
    requiresAuth: true,
  });

  test('refuses to open a window when browser assist is off', async () => {
    const fake = fakeServices();
    const provider = createF95Provider(fake.services, {
      profile,
      getSettings: async () => settingsFrom({ browserAssistEnabled: false }),
    });

    await expect(provider.prepareDownload(redirect, game, {})).rejects.toThrow('turned off in the plugin settings');
    expect(fake.browserCalls).toEqual([]);
  });

  test('a closed window has a clear error', async () => {
    const fake = fakeServices({
      capture: () => {
        throw new RpcFailure(ErrorCode.Canceled, 'the browser window was closed');
      },
    });
    const provider = createF95Provider(fake.services, { profile });

    const failure = provider.prepareDownload(redirect, game, {});
    await expect(failure).rejects.toThrow('browser window was closed before a download link was captured');
    await expect(failure).rejects.toMatchObject({ code: ErrorCode.Canceled });
  });

  test('a timeout has a clear error', async () => {
    const fake = fakeServices({
      capture: () => {
        throw new RpcFailure(ErrorCode.Timeout, 'browser.assist timed out');
      },
    });
    const provider = createF95Provider(fake.services, { profile });

    const failure = provider.prepareDownload(redirect, game, {});
    await expect(failure).rejects.toThrow('browser assist timed out before a download link was captured');
    await expect(failure).rejects.toMatchObject({ code: ErrorCode.Timeout });
  });

  test('nothing captured has a clear error', async () => {
    const fake = fakeServices({ capture: () => ({ capturedUrl: null }) });
    const provider = createF95Provider(fake.services, { profile });

    const failure = provider.prepareDownload(redirect, game, {});
    await expect(failure).rejects.toThrow('no download link was captured');
    await expect(failure).rejects.toMatchObject({ code: ErrorCode.InternalError });
  });

  test('uses the download settings on the assist path too', async () => {
    const fake = fakeServices({ capture: () => ({ capturedUrl: 'https://cdn.example/game.zip' }) });
    const provider = createF95Provider(fake.services, {
      profile,
      getSettings: async () => settingsFrom({
        downloadRoot: 'games',
        installAfterDownload: true,
        deleteArchiveAfterInstall: true,
      }),
    });

    const prepared = await provider.prepareDownload(redirect, { ...game, title: 'a/b' }, {});
    expect(prepared).toMatchObject({
      root: 'games',
      subfolder: 'ab',
      install: true,
      installSubfolder: 'ab',
      deleteArchive: true,
    });
  });
});
