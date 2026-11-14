import type { HttpTransport } from '@light-launcher/plugin-sdk/helpers';
import type { LogFn } from './host';

/** Only the host name is logged: paths and query strings can hold tokens. */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid-url';
  }
}

/** Writes one debug line per request: method, host name, status and time. */
export function loggedTransport(inner: HttpTransport, log: LogFn): HttpTransport {
  return {
    async request(params, options) {
      const started = Date.now();
      const label = `${params.method ?? 'GET'} ${hostnameOf(params.url)}`;
      try {
        const res = await inner.request(params, options);
        log('debug', `${label} ${res.status} in ${Date.now() - started} ms`);
        return res;
      } catch (err) {
        log('debug', `${label} failed after ${Date.now() - started} ms`, err instanceof Error ? err.message : err);
        throw err;
      }
    },
  };
}
