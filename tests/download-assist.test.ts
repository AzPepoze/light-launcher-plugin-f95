import { describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import type { FileCandidate, GameRef } from '@light-launcher/plugin-sdk/types';
import { ErrorCode, RpcFailure } from '@light-launcher/plugin-sdk/types';
import { deriveKeys } from '../src/downloads/mega';
import { createF95Provider } from '../src/providers/f95';
import { parseProfile } from '../src/providers/xenforo';
import profileJson from '../profiles/f95zone.json';
import { settingsFrom } from '../src/settings';
import { fakeServices, type Responder } from './fakes';

const profile = parseProfile(profileJson, 'profiles/f95zone.json');
const threadHtml = await Bun.file(new URL('./fixtures/f95-thread.html', import.meta.url)).text();

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

describe('prepareDownload selects every supported file host resolver', () => {
  const page = (html: string) => (_url: string, params: { method?: string }) =>
    (params.method === 'HEAD'
      ? { headers: { 'content-type': 'text/html; charset=utf-8' } }
      : { headers: { 'content-type': 'text/html' }, text: html });

  const cases: Array<{ name: string; url: string; host: string; response: Responder; expected: string }> = [
    {
      name: 'MediaFire',
      url: 'https://www.mediafire.com/file/mf1/game.zip/file',
      host: 'mediafire.com',
      response: page('<a id="downloadButton" href="https://cdn.mediafire.com/game.zip">Download</a>'),
      expected: 'https://cdn.mediafire.com/game.zip',
    },
    {
      name: 'WorkUpload',
      url: 'https://workupload.com/file/wu1',
      host: 'workupload.com',
      response: page('<a id="download-button" href="/download/wu1/game.zip">Download</a>'),
      expected: 'https://workupload.com/download/wu1/game.zip',
    },
    {
      name: 'DataNodes',
      url: 'https://datanodes.to/dn1',
      host: 'datanodes.to',
      response: page('<a href="/download/dn1/game.zip">Download</a>'),
      expected: 'https://datanodes.to/download/dn1/game.zip',
    },
    {
      name: 'KrakenFiles',
      url: 'https://krakenfiles.com/view/kf1/file.html',
      host: 'krakenfiles.com',
      response: page('<a id="download" href="/download/kf1/game.zip">Download</a>'),
      expected: 'https://krakenfiles.com/download/kf1/game.zip',
    },
    {
      name: 'BuzzHeavier',
      url: 'https://buzzheavier.com/bz1',
      host: 'buzzheavier.com',
      response: () => ({ headers: { 'hx-redirect': '/dl/bz1/game.zip' } }),
      expected: 'https://buzzheavier.com/dl/bz1/game.zip',
    },
    {
      name: 'MixDrop',
      url: 'https://mixdrop.co/f/md1',
      host: 'mixdrop.co',
      response: () => ({
        headers: { 'content-type': 'text/html' },
        text: '<script>MDCore.wurl = "https://cdn.mixdrop.co/game.zip";</script>',
      }),
      expected: 'https://cdn.mixdrop.co/game.zip',
    },
  ];

  for (const item of cases) {
    test(`${item.name} page links become direct downloads`, async () => {
      const fake = fakeServices({ respond: item.response });
      const provider = createF95Provider(fake.services, { profile });

      const prepared = await provider.prepareDownload(
        file({ url: item.url, host: item.host }),
        game,
        {},
      );

      expect(prepared.url).toBe(item.expected);
      expect(fake.browserCalls).toEqual([]);
    });
  }

  test('resolveFiles keeps the host page link that prepareDownload then resolves', async () => {
    const fake = fakeServices({ respond: () => ({ text: threadHtml }) });
    const provider = createF95Provider(fake.services, { profile });

    const threadGame = { ...game, sourceId: 'resolve-files-integration' };
    const files = await provider.resolveFiles(threadGame);
    const pixeldrain = files.find((candidate) => candidate.host === 'pixeldrain.com');
    expect(pixeldrain?.url).toBe('https://pixeldrain.com/u/AbCd1234');

    const prepared = await provider.prepareDownload(pixeldrain!, threadGame, {});
    expect(prepared.url).toBe('https://pixeldrain.com/api/file/AbCd1234?download');
    expect(fake.browserCalls).toEqual([]);
  });

  test('MEGA is selected, but reports the missing key field instead of saving a corrupt file', async () => {
    const fileKey = Buffer.alloc(32, 7).toString('base64url');
    const { aesKey } = deriveKeys(fileKey);
    const plain = Buffer.from('MEGA{"n":"game.zip"}');
    const padded = Buffer.concat([plain, Buffer.alloc((16 - (plain.length % 16)) % 16)]);
    const cipher = crypto.createCipheriv('aes-128-cbc', aesKey, Buffer.alloc(16));
    cipher.setAutoPadding(false);
    const attributes = Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64url');
    const fake = fakeServices({
      respond: () => ({ text: JSON.stringify([{ g: 'https://gfs1.userstorage.mega.co.nz/dl', s: 3, at: attributes }]) }),
    });
    const provider = createF95Provider(fake.services, { profile });

    await expect(provider.prepareDownload(
      file({ url: `https://mega.nz/file/abc#${fileKey}`, host: 'mega.nz' }),
      game,
      {},
    )).rejects.toMatchObject({
      code: ErrorCode.InternalError,
      message: expect.stringContaining('no field for it'),
    });
  });

  test('a resolver failure names the host instead of leaking a bare parse error', async () => {
    const key = 'a'.repeat(43);
    const fake = fakeServices({ respond: () => ({ text: 'not json' }) });
    const provider = createF95Provider(fake.services, { profile });

    await expect(provider.prepareDownload(
      file({ url: `https://mega.nz/file/abc#${key}`, host: 'mega.nz' }),
      game,
      {},
    )).rejects.toMatchObject({
      code: ErrorCode.RemoteError,
      message: expect.stringContaining('could not resolve the mega.nz link'),
    });
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
