import { cachedSecret, type HostClient } from '@light-launcher/plugin-sdk/runtime';
import type { CredentialStore } from './host';

/** Key of the F95 cookie in the host's secret store. */
export const COOKIE_SECRET_KEY = 'cookie';

/**
 * Reads and saves the cookie through host secrets. The first read is cached; set() also
 * keeps the new value here, so the next get() sees it without another host read.
 */
export function secretCredentialStore(secrets: HostClient['secrets']): CredentialStore {
  const host = { secrets };
  let saved: string | null | undefined;

  return {
    get: () => (saved === undefined ? cachedSecret(host, COOKIE_SECRET_KEY) : Promise.resolve(saved)),
    async set(value) {
      if (value === null) await secrets.delete(COOKIE_SECRET_KEY);
      else await secrets.set(COOKIE_SECRET_KEY, value);
      saved = value;
    },
  };
}
