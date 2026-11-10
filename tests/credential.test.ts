import { describe, expect, test } from 'bun:test';
import type { HostClient } from '@light-launcher/plugin-sdk/runtime';
import { COOKIE_SECRET_KEY, secretCredentialStore } from '../src/credential';

function fakeSecrets(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const reads: string[] = [];
  let failNextRead = false;
  const secrets: HostClient['secrets'] = {
    get: async (key) => {
      reads.push(key);
      if (failNextRead) {
        failNextRead = false;
        throw new Error('host unavailable');
      }
      return values.get(key) ?? null;
    },
    set: async (key, value) => {
      values.set(key, value);
    },
    delete: async (key) => {
      values.delete(key);
    },
  };
  return {
    values,
    reads,
    secrets,
    failNextRead: () => {
      failNextRead = true;
    },
  };
}

describe('secretCredentialStore', () => {
  test('reads the cookie from the host once, then from memory', async () => {
    const fake = fakeSecrets({ [COOKIE_SECRET_KEY]: 'a=b' });
    const store = secretCredentialStore(fake.secrets);
    expect(await store.get()).toBe('a=b');
    expect(await store.get()).toBe('a=b');
    expect(fake.reads).toEqual([COOKIE_SECRET_KEY]);
  });

  test('set saves through the host and updates memory without a read', async () => {
    const fake = fakeSecrets();
    const store = secretCredentialStore(fake.secrets);
    await store.set('c=d');
    expect(fake.values.get(COOKIE_SECRET_KEY)).toBe('c=d');
    expect(await store.get()).toBe('c=d');
    expect(fake.reads).toEqual([]);
  });

  test('set(null) deletes the cookie', async () => {
    const fake = fakeSecrets({ [COOKIE_SECRET_KEY]: 'a=b' });
    const store = secretCredentialStore(fake.secrets);
    await store.set(null);
    expect(fake.values.has(COOKIE_SECRET_KEY)).toBe(false);
    expect(await store.get()).toBeNull();
  });

  test('a failed read is not cached', async () => {
    const fake = fakeSecrets({ [COOKIE_SECRET_KEY]: 'a=b' });
    const store = secretCredentialStore(fake.secrets);
    fake.failNextRead();
    await expect(store.get()).rejects.toThrow('host unavailable');
    expect(await store.get()).toBe('a=b');
  });
});
