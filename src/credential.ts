import type { HostClient } from '@light-launcher/plugin-sdk/runtime';
import type { CredentialStore } from './host';

/** Key of the F95 cookie in the host's secret store. */
export const COOKIE_SECRET_KEY = 'cookie';

/**
 * Reads and saves the cookie through host secrets. The first read loads it; later
 * reads use memory, and set() replaces the memory copy.
 */
export function secretCredentialStore(secrets: HostClient['secrets']): CredentialStore {
  let cached: Promise<string | null> | null = null;

  function load(): Promise<string | null> {
    cached ??= secrets.get(COOKIE_SECRET_KEY).catch((err: unknown) => {
      cached = null;
      throw err;
    });
    return cached;
  }

  return {
    get: load,
    async set(value) {
      if (value === null) await secrets.delete(COOKIE_SECRET_KEY);
      else await secrets.set(COOKIE_SECRET_KEY, value);
      cached = Promise.resolve(value);
    },
  };
}
