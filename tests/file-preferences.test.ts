import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import type { FileCandidate } from '@light-launcher/plugin-sdk/types';
import {
  DEFAULT_FILE_PREFERENCES, applyFilePreferences, keepPlatform, orderByHosts, rankedHostOf,
} from '../src/downloads/preferences';
import { createF95Provider } from '../src/providers/f95';
import { extractFileCandidates, parseProfile } from '../src/providers/xenforo';
import profileJson from '../profiles/f95zone.json';
import { fakeServices } from './fakes';

const profile = parseProfile(profileJson, 'profiles/f95zone.json');
const platformsHtml = fs.readFileSync(new URL('./fixtures/f95-thread-platforms.html', import.meta.url), 'utf8');
const threadUrl = 'https://f95zone.to/threads/12345/';

function candidate(host: string, platform: FileCandidate['platform'], id = `${host}-${platform}`): FileCandidate {
  return { id, label: id, url: `https://${host}/${id}`, host, kind: 'mirror', platform };
}

const files = [
  candidate('mediafire.com', 'windows'),
  candidate('mixdrop', 'linux'),
  candidate('pixeldrain.com', 'unknown'),
  candidate('mega.nz', 'mac'),
  candidate('buzzheavier', 'windows'),
];

describe('rankedHostOf', () => {
  test('maps a domain or its subdomain to the ranked name', () => {
    expect(rankedHostOf('www.mediafire.com')).toBe('mediafire');
    expect(rankedHostOf('bzzhr.to')).toBe('buzzheavier');
    expect(rankedHostOf('mega.co.nz')).toBe('mega');
  });

  test('maps a plain host label, such as a mirror name from the forum', () => {
    expect(rankedHostOf('mixdrop')).toBe('mixdrop');
  });

  test('ignores hosts that only look similar and unknown hosts', () => {
    expect(rankedHostOf('pixeldrain.com.example.test')).toBeNull();
    expect(rankedHostOf('evilmixdrop.co')).toBeNull();
    expect(rankedHostOf('gofile.io')).toBeNull();
    expect(rankedHostOf(null)).toBeNull();
  });
});

describe('orderByHosts', () => {
  test('returns the same list when no host is preferred', () => {
    expect(orderByHosts(files, [])).toBe(files);
  });

  test('lists preferred hosts first, in the order the user set', () => {
    const ordered = orderByHosts(files, ['buzzheavier', 'mixdrop']).map((file) => file.host);
    expect(ordered).toEqual(['buzzheavier', 'mixdrop', 'mediafire.com', 'pixeldrain.com', 'mega.nz']);
  });

  test('keeps the thread order inside the unlisted group', () => {
    const ordered = orderByHosts(files, ['mega']).map((file) => file.id);
    expect(ordered).toEqual(['mega.nz-mac', 'mediafire.com-windows', 'mixdrop-linux', 'pixeldrain.com-unknown', 'buzzheavier-windows']);
  });
});

describe('keepPlatform', () => {
  test('keeps every link for any', () => {
    expect(keepPlatform(files, 'any')).toBe(files);
  });

  test('keeps the chosen platform and links whose platform is unknown', () => {
    const kept = keepPlatform(files, 'windows').map((file) => file.id);
    expect(kept).toEqual(['mediafire.com-windows', 'pixeldrain.com-unknown', 'buzzheavier-windows']);
  });
});

describe('applyFilePreferences', () => {
  test('the default preferences leave the list unchanged', () => {
    expect(applyFilePreferences(files, DEFAULT_FILE_PREFERENCES)).toEqual(files);
  });

  test('applies the platform filter and then the host order', () => {
    const result = applyFilePreferences(files, { preferredHosts: ['buzzheavier'], preferredPlatform: 'windows' });
    expect(result.map((file) => file.id)).toEqual(['buzzheavier-windows', 'mediafire.com-windows', 'pixeldrain.com-unknown']);
  });
});

describe('provider file choices', () => {
  test('resolveFiles applies the preferences to the links of a real thread page', async () => {
    const fake = fakeServices({ respond: () => ({ text: platformsHtml }) });
    const provider = createF95Provider(fake.services, {
      profile,
      filePreferences: { preferredHosts: ['mixdrop'], preferredPlatform: 'linux' },
    });
    const game = { source: 'f95', sourceId: '12345', url: threadUrl, title: 'Game' };
    const links = await provider.resolveFiles(game);

    expect(links.every((file) => file.platform === 'linux' || file.platform === 'unknown')).toBe(true);
    expect(links[0]?.host).toBe('mixdrop');
  });

  test('without preferences resolveFiles returns the thread order', async () => {
    const all = extractFileCandidates(platformsHtml, profile, threadUrl);
    const fake = fakeServices({ respond: () => ({ text: platformsHtml }) });
    const provider = createF95Provider(fake.services, { profile });
    const game = { source: 'f95', sourceId: '12345', url: threadUrl, title: 'Game' };
    expect((await provider.resolveFiles(game)).map((file) => file.id)).toEqual(all.map((file) => file.id));
  });
});
