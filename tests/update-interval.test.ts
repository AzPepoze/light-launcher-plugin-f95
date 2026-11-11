import { describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import type { GameRef } from '@light-launcher/plugin-sdk/types';
import { createF95Provider } from '../src/providers/f95';
import { parseProfile } from '../src/providers/xenforo';
import profileJson from '../profiles/f95zone.json';
import { fakeServices } from './fakes';

const HOUR_MS = 60 * 60 * 1000;
const profile = parseProfile(profileJson, 'profiles/f95zone.json');
const threadHtml = fs.readFileSync(new URL('./fixtures/f95-thread.html', import.meta.url), 'utf8');

const game: GameRef = {
  source: 'f95',
  sourceId: '12345',
  url: 'https://f95zone.to/threads/12345/',
  title: 'My Game',
  version: '0.7.0',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function providerWithInterval(updateCheckIntervalMs?: number) {
  const fake = fakeServices({ respond: () => ({ text: threadHtml }) });
  const provider = createF95Provider(fake.services, { profile, updateCheckIntervalMs });
  return { provider, calls: fake.calls };
}

describe('update check interval', () => {
  test('checks the thread every time when the interval is 0', async () => {
    const { provider, calls } = providerWithInterval(0);
    await provider.checkUpdate(game);
    await provider.checkUpdate(game);
    expect(calls.length).toBe(2);
  });

  test('inside the interval it does not fetch the thread and reports no update', async () => {
    const { provider, calls } = providerWithInterval(HOUR_MS);
    await provider.checkUpdate(game);
    const second = await provider.checkUpdate(game);
    expect(calls.length).toBe(1);
    expect(second).toBeNull();
  });

  test('checks again once the interval has passed', async () => {
    const clock = spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      const { provider, calls } = providerWithInterval(HOUR_MS);
      await provider.checkUpdate(game);
      clock.mockReturnValue(1_000_000 + HOUR_MS);
      await provider.checkUpdate(game);
      expect(calls.length).toBe(2);
    } finally {
      clock.mockRestore();
    }
  });

  test('keeps the timer per game', async () => {
    const { provider, calls } = providerWithInterval(HOUR_MS);
    await provider.checkUpdate(game);
    await provider.checkUpdate({ ...game, sourceId: '999', url: 'https://f95zone.to/threads/999/' });
    expect(calls.length).toBe(2);
  });

  test('a failed check is not counted, so the next call tries again', async () => {
    let failing = true;
    const fake = fakeServices({
      respond: () => (failing ? { status: 404 } : { text: threadHtml }),
    });
    const provider = createF95Provider(fake.services, { profile, updateCheckIntervalMs: HOUR_MS });
    await expect(provider.checkUpdate(game)).rejects.toThrow();
    failing = false;
    const before = fake.calls.length;
    await provider.checkUpdate(game);
    expect(fake.calls.length).toBeGreaterThan(before);
  });
});
