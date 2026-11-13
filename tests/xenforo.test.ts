import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { ErrorCode, type GameRef } from '@light-launcher/plugin-sdk/types';
import { isNewer, platformOf, platformsIn } from '@light-launcher/plugin-sdk/helpers';
import {
  extractFileCandidates, parseAccountName, parseListing,
  parseProfile, parseThread, parseThreadMeta, parseVersion,
} from '../src/providers/xenforo';
import { createF95Provider } from '../src/providers/f95';
import profileJson from '../profiles/f95zone.json';
import { fakeServices, type Responder } from './fakes';

const fixture = (name: string): string =>
  fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const threadHtml = fixture('f95-thread.html');
const listingHtml = fixture('f95-listing.html');
const accountHtml = fixture('f95-account.html');
const profile = parseProfile(profileJson, 'profiles/f95zone.json');
const threadUrl = 'https://f95zone.to/threads/my-game.12345/';

function makeProvider(respond: Responder, credential: string | null = null) {
  const fake = fakeServices({ respond, credential });
  const provider = createF95Provider(fake.services, { profile });
  return { calls: fake.calls, provider, fake };
}

function gameRef(over: Partial<GameRef> = {}): GameRef {
  return {
    source: 'f95',
    sourceId: '12345',
    url: 'https://f95zone.to/threads/12345/',
    title: 'My Game',
    version: '0.7.0',
    updatedAt: '2026-01-01T00:00:00.000Z',
    extra: null,
    ...over,
  };
}

describe('xenforo profile', () => {
  test('loads the F95 profile from profiles/', () => {
    expect(profile.id).toBe('f95');
    expect(profile.engine).toBe('xenforo');
    expect(profile.baseUrl).toBe('https://f95zone.to');
    expect(profile.listing.pageParam).toBe('page');
    expect(profile.rateLimitMs).toBe(1200);
  });
});

describe('parseThread', () => {
  const game = parseThread(threadHtml, profile, threadUrl);

  test('normalizes identity and title', () => {
    expect(game.source).toBe('f95');
    expect(game.sourceId).toBe('12345');
    expect(game.url).toBe('https://f95zone.to/threads/12345/');
    expect(game.title).toBe('My Game [v0.8.1]');
    expect(game.version).toBe('0.8.1');
  });

  test('reads fields and tags', () => {
    expect(game.developer).toBe('Someone');
    expect(game.engine).toBe("Ren'Py");
    expect(game.status).toBe('ongoing');
    expect(game.tags).toContain('Visual Novel');
    expect(game.tags).toContain('Romance');
    expect(game.tags).toContain('Male Protagonist');
    expect(game.extra?.language).toBe('English');
  });

  test('collects cover, screenshots and description', () => {
    expect(game.coverUrl).toBe('https://attachments.f95zone.to/2026/03/111111_screenshot1.jpg');
    expect(game.screenshots).toEqual([
      'https://attachments.f95zone.to/2026/03/111111_screenshot1.jpg',
      'https://attachments.f95zone.to/2026/03/222222_screenshot2.jpg',
      'https://attachments.f95zone.to/2026/03/333333_screenshot3.jpg',
    ]);
    expect(game.descriptionHtml).toContain('Developer: Someone');
    expect(game.descriptionHtml).toContain('https://pixeldrain.com/u/AbCd1234');
  });

  test('extracts changelog and edit time', () => {
    expect(game.changelog).toContain('Added the new beach scene.');
    expect(game.changelog).toContain('Fixed two dialogue typos.');
    expect(game.updatedAt).toBe('2026-03-15T16:30:00.000Z');
    expect(parseThreadMeta(threadHtml, profile)).toEqual({
      editedAt: '2026-03-15T16:30:00.000Z',
      title: 'My Game [v0.8.1]',
    });
  });

  test('falls back to the engine keyword in the title prefix', () => {
    const html = `<html><body>
      <h1 class="p-title-value">[Unity] Space Game</h1>
      <article class="message"><div class="message-body"><div class="bbWrapper">
        <p>Made with something.</p>
      </div></div></article>
    </body></html>`;
    const fallback = parseThread(html, profile, 'https://f95zone.to/threads/space.5/');
    expect(fallback.title).toBe('Space Game');
    expect(fallback.engine).toBe('Unity');
  });

  test('version parsing strips v and brackets', () => {
    expect(parseVersion('[v1.2.3]', '', profile)).toBe('1.2.3');
    expect(parseVersion('No marker', 'Version: 0.9', profile)).toBe('0.9');
    expect(parseVersion('nothing here', 'nothing', profile)).toBeNull();
  });
});

describe('extractFileCandidates', () => {
  const files = extractFileCandidates(threadHtml, profile, threadUrl);
  const byUrl = (url: string) => files.find((file) => file.url === url);

  test('finds spoiler links, dedupes and classifies hosts', () => {
    expect(files.length).toBe(5);
    const pixeldrain = byUrl('https://pixeldrain.com/u/AbCd1234');
    expect(pixeldrain?.kind).toBe('mirror');
    expect(pixeldrain?.requiresAuth).toBe(false);
    expect(byUrl('https://gofile.io/d/AbCdEf')?.kind).toBe('mirror');
    expect(byUrl('https://drive.google.com/drive/folders/1AbCdEfGhIj')?.kind).toBe('mirror');
    expect(byUrl('https://example.com/downloads/My_Game_v0.8.1_Win.zip')?.kind).toBe('external');
    expect(byUrl('https://example.com/about')).toBeUndefined();
  });

  test('flags attachments and reads sizes/platforms', () => {
    const attachment = byUrl('https://attachments.f95zone.to/attachments/777/My_Game_v0.8.1_Win.zip');
    expect(attachment?.kind).toBe('attachment');
    expect(attachment?.requiresAuth).toBe(true);
    expect(attachment?.size).toBe(2_400_000_000);
    expect(attachment?.platform).toBe('windows');
    expect(attachment?.filename).toBe('My_Game_v0.8.1_Win.zip');
    expect(byUrl('https://gofile.io/d/AbCdEf')?.size).toBe(1_200_000_000);
  });

  test('ids are stable and unique', () => {
    const again = extractFileCandidates(threadHtml, profile, threadUrl);
    expect(again.map((file) => file.id)).toEqual(files.map((file) => file.id));
    expect(new Set(files.map((file) => file.id)).size).toBe(files.length);
  });
});

describe('platform words', () => {
  test('finds every platform, common typos, and ignores unrelated words', () => {
    expect(platformsIn('OS: Windows, Linux, Mac, Android')).toEqual(['windows', 'linux', 'mac', 'android']);
    expect(platformOf('Andorid')).toBe('android');
    expect(platformOf('Game_v1.2_Win.zip')).toBe('windows');
    expect(platformOf('window size')).toBe('unknown');
  });
});

describe('platform sections', () => {
  const platformHtml = fixture('f95-thread-platforms.html');
  const platformUrl = 'https://f95zone.to/threads/quiet-meadow.100001/';
  const platformFiles = extractFileCandidates(platformHtml, profile, platformUrl);
  const count = (platform: string) => platformFiles.filter((file) => file.platform === platform).length;

  test('reads every platform group and skips hidden duplicate links', () => {
    expect(platformFiles.length).toBe(21);
    expect({
      windows: count('windows'),
      linux: count('linux'),
      mac: count('mac'),
      android: count('android'),
      unknown: count('unknown'),
    }).toEqual({ windows: 5, linux: 5, mac: 5, android: 5, unknown: 1 });
    expect(platformFiles.filter((file) => file.label === 'AKIRABOX' && file.platform === 'windows')).toHaveLength(1);
  });

  test('patches do not inherit the previous platform', () => {
    expect(platformFiles.find((file) => file.label === 'Brass Patch')?.platform).toBe('unknown');
  });

  test('understands headings, misspelled labels and combined labels', () => {
    const here = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
    const html = `<html><body><article class="message"><div class="message-body"><div class="bbWrapper">
      <p>OS: Windows, Linux, Mac, Android</p>
      <h3>Windows</h3>
      <p><a href="https://f95zone.to/dl/1/?k=w">Win mirror</a></p>
      <h3>Andorid</h3>
      <p><a href="https://f95zone.to/dl/1/?k=a">Android mirror</a></p>
      <p><b>Win/Linux</b>: <a href="https://f95zone.to/dl/1/?k=c">Combined mirror</a></p>
      <p><b>Patches</b>: <a href="https://f95zone.to/dl/1/?k=p">Patch mirror</a></p>
    </div></div></article></body></html>`;
    const files = extractFileCandidates(html, profile, platformUrl);
    expect(files.find((file) => file.label === 'Win mirror')?.platform).toBe('windows');
    expect(files.find((file) => file.label === 'Android mirror')?.platform).toBe('android');
    const combined = files.find((file) => file.label === 'Combined mirror')?.platform;
    expect(combined).toBe(['windows', 'linux'].includes(here) ? here : 'unknown');
    expect(files.find((file) => file.label === 'Patch mirror')?.platform).toBe('unknown');
  });

  test('falls back to a single OS value and reads table cells', () => {
    const html = `<html><body><article class="message"><div class="message-body"><div class="bbWrapper">
      <p>OS: Windows</p>
      <h3>DOWNLOAD</h3>
      <p><a href="https://f95zone.to/dl/1/?k=u">No label mirror</a></p>
      <table><tr><td>Linux</td><td><a href="https://f95zone.to/dl/1/?k=t">Table mirror</a></td></tr></table>
    </div></div></article></body></html>`;
    const files = extractFileCandidates(html, profile, platformUrl);
    expect(files.find((file) => file.label === 'No label mirror')?.platform).toBe('windows');
    expect(files.find((file) => file.label === 'Table mirror')?.platform).toBe('linux');
  });
});

describe('parseListing and account', () => {
  test('parses three thread rows', () => {
    const games = parseListing(listingHtml, profile, 'https://f95zone.to/forums/adult-games.1/');
    expect(games.length).toBe(3);
    expect(games[0]).toMatchObject({
      sourceId: '12345',
      title: 'My Game [v0.8.1]',
      version: '0.8.1',
      url: 'https://f95zone.to/threads/12345/',
      coverUrl: 'https://f95zone.to/data/attachments/0/thumb-12345.jpg',
      updatedAt: '2026-03-15T16:30:00.000Z',
    });
    expect(games[1].coverUrl).toBe('https://f95zone.to/data/attachments/0/thumb-67890.jpg');
    expect(games[2].sourceId).toBe('11111');
  });

  test('parses the logged-in username', () => {
    expect(parseAccountName(accountHtml, profile)).toBe('Someone');
    expect(parseAccountName('<html><body><div class="p-navgroup--member"></div></body></html>', profile)).toBeNull();
  });

  test('reads the username from the current account menu markup', () => {
    const live = `<html><body>
      <div class="p-navgroup p-account p-navgroup--member">
        <a href="/account/" class="p-navgroup-link p-navgroup-link--user" title="IHNEEY">
          <span class="avatar avatar--xxs"><span role="img" aria-label="IHNEEY">I</span></span>
          <span class="p-navgroup-linkText">IHNEEY</span>
        </a>
        <div class="menu"><div class="menu-row">Loading…</div></div>
      </div>
    </body></html>`;
    expect(parseAccountName(live, profile)).toBe('IHNEEY');
  });
});

describe('provider wiring', () => {
  test('parseRef understands threads, listings and foreign hosts', () => {
    const { provider } = makeProvider(() => ({}));
    expect(provider.id).toBe('f95');
    expect(provider.capabilities).toMatchObject({ browse: true, auth: 'cookie', updateCheck: true, resolveFiles: true });
    expect(provider.parseRef(threadUrl)).toEqual({
      kind: 'game', id: '12345', url: 'https://f95zone.to/threads/12345/',
    });
    expect(provider.parseRef('https://www.f95zone.to/threads/slug.999/')?.id).toBe('999');
    expect(provider.parseRef('https://f95zone.to/forums/adult-games.1/page-2')).toEqual({
      kind: 'listing', id: '/forums/adult-games.1/page-2', url: 'https://f95zone.to/forums/adult-games.1/page-2',
    });
    expect(provider.parseRef('https://itch.io/game/foo')).toBeNull();
  });

  test('auth states: unconfigured, ok, expired', async () => {
    const unconfigured = makeProvider(() => ({})).provider;
    expect((await unconfigured.authStatus()).status).toBe('unconfigured');

    const signedIn = makeProvider(() => ({ url: 'https://f95zone.to/account/', text: accountHtml }), 'a=b; c=d');
    const state = await signedIn.provider.authStatus();
    expect(state.status).toBe('ok');
    expect(state.user).toBe('Someone');

    const expired = makeProvider(() => ({ url: 'https://f95zone.to/login/', text: '<html></html>' }), 'stale=1');
    expect((await expired.provider.authStatus()).status).toBe('expired');
  });

  test('setCredential normalizes a Cookie header and validates it', async () => {
    const { calls, provider } = makeProvider(() => ({ url: 'https://f95zone.to/account/', text: accountHtml }));
    const state = await provider.setCredential('Cookie: a=b; c=d\n');
    expect(state).toMatchObject({ status: 'ok', user: 'Someone' });
    expect(calls[0].options.headers?.Cookie).toBe('a=b; c=d');
  });

  test('fetchGame reuses the parsed page when the server answers 304', async () => {
    let requests = 0;
    const { calls, provider } = makeProvider(() => {
      requests++;
      if (requests === 1) return { text: threadHtml };
      return { status: 304, notModified: true, text: '' };
    });
    const ref = { kind: 'game' as const, id: '12345', url: threadUrl };
    const first = await provider.fetchGame(ref);
    const second = await provider.fetchGame(ref);
    expect(second.title).toBe(first.title);
    expect(calls.length).toBe(2);
  });

  test('fetchGame asks for the body when a 304 has no parsed copy', async () => {
    let requests = 0;
    const { calls, provider } = makeProvider(() => {
      requests++;
      if (requests === 1) return { status: 304, notModified: true, text: '' };
      return { text: threadHtml };
    });
    const game = await provider.fetchGame({ kind: 'game', id: 'fresh', url: threadUrl });
    expect(game.title.length).toBeGreaterThan(0);
    expect(calls.length).toBe(2);
  });

  test('fetchList appends the profile page parameter', async () => {
    const { calls, provider } = makeProvider(() => ({ text: listingHtml }));
    const games = await provider.fetchList({ page: 3 });
    expect(games.length).toBe(3);
    expect(calls[0].url).toBe('https://f95zone.to/forums/adult-games.1/?page=3');
  });

  test('resolveFiles parses once and reuses the cache', async () => {
    const { calls, provider } = makeProvider(() => ({ text: threadHtml }));
    const game = gameRef({ sourceId: 'cache-test', updatedAt: '2026-03-15T16:30:00.000Z' });
    const first = await provider.resolveFiles(game);
    const second = await provider.resolveFiles(game);
    expect(first.length).toBe(5);
    expect(second).toEqual(first);
    expect(calls.length).toBe(1);
  });

  test('prepareDownload adds cookie and referer for attachments', async () => {
    const { provider } = makeProvider(() => ({}), 'session=abc');
    const attachment = extractFileCandidates(threadHtml, profile, threadUrl)
      .find((file) => file.requiresAuth)!;
    const prepared = await provider.prepareDownload(attachment, gameRef(), {});
    expect(prepared.headers).toEqual({ Cookie: 'session=abc', Referer: 'https://f95zone.to/threads/12345/' });

    const anonymous = makeProvider(() => ({})).provider;
    await expect(anonymous.prepareDownload(attachment, gameRef(), {})).rejects.toMatchObject({
      code: ErrorCode.AuthRequired,
      message: expect.stringContaining('needs a sign-in cookie'),
    });
  });

  test('prepareDownload returns the file name, size and headers the browser captured', async () => {
    const fake = fakeServices({
      capture: () => ({
        capturedUrl: 'https://pixeldrain.com/u/abc',
        filename: 'game.zip',
        size: 42,
        headers: { Cookie: 'session=abc' },
      }),
    });
    const provider = createF95Provider(fake.services, { profile });
    const redirect = { ...extractFileCandidates(threadHtml, profile, threadUrl)[0], url: 'https://f95zone.to/dl/1/' };

    const prepared = await provider.prepareDownload(redirect, gameRef(), {});
    expect(prepared).toEqual({
      url: 'https://pixeldrain.com/u/abc',
      headers: { Cookie: 'session=abc' },
      filename: 'game.zip',
      size: 42,
      root: 'downloads',
      subfolder: 'My Game',
    });
  });

  test('checkUpdate compares versions and edit times', async () => {
    expect(isNewer('0.8.1', '0.7.9')).toBe(true);
    const { provider } = makeProvider(() => ({ text: threadHtml }));
    const update = await provider.checkUpdate(gameRef());
    expect(update).toMatchObject({ version: '0.8.1', updatedAt: '2026-03-15T16:30:00.000Z' });
    expect(update?.changelog).toContain('Added the new beach scene.');

    const current = await provider.checkUpdate(
      gameRef({ version: '0.8.1', updatedAt: '2026-04-01T00:00:00.000Z' }),
    );
    expect(current).toBeNull();

    const cached = makeProvider(() => ({ status: 304, notModified: true })).provider;
    expect(await cached.checkUpdate(gameRef())).toBeNull();
  });
});
