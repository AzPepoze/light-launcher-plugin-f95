import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import profileJson from '../profiles/f95zone.json';
import { loadProfile } from '../src/providers/xenforo';

function overlayFile(content: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f95-profile-'));
  const file = path.join(dir, 'f95zone.local.json');
  fs.writeFileSync(file, JSON.stringify(content));
  return file;
}

describe('loadProfile', () => {
  test('uses the embedded profile when the overlay file is missing', () => {
    const missing = path.join(os.tmpdir(), 'no-such-dir', 'f95zone.local.json');
    expect(loadProfile(profileJson, missing).selectors).toEqual(profileJson.selectors);
  });

  test('merges the overlay over the embedded profile', () => {
    const file = overlayFile({ selectors: { title: '.fixed-title' }, listing: { path: '/sam/' } });
    const profile = loadProfile(profileJson, file);
    expect(profile.selectors.title).toBe('.fixed-title');
    expect(profile.selectors.postBody).toEqual(profileJson.selectors.postBody);
    expect(profile.listing.path).toBe('/sam/');
    expect(profile.listing.item).toBe(profileJson.listing.item);
  });

  test('replaces arrays instead of merging them', () => {
    const file = overlayFile({ versionPatterns: ['v(?<v>\\d+)'] });
    expect(loadProfile(profileJson, file).versionPatterns).toEqual(['v(?<v>\\d+)']);
  });

  test('does not change the embedded profile object', () => {
    const before = profileJson.selectors.title;
    loadProfile(profileJson, overlayFile({ selectors: { title: '.other' } }));
    expect(profileJson.selectors.title).toBe(before);
  });

  test('rejects an overlay that breaks the profile', () => {
    const file = overlayFile({ engine: 'not-xenforo' });
    expect(() => loadProfile(profileJson, file)).toThrow('engine must be "xenforo"');
  });
});
