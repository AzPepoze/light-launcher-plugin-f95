import type { HttpTransport } from '@light-launcher/plugin-sdk/helpers';
import type { LogFn } from './host';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

/**
 * Starts each request at least delayMs after the previous one. Requests keep their call order.
 * A delay of 0 returns the transport unchanged.
 */
export function spacedTransport(inner: HttpTransport, delayMs: number): HttpTransport {
  if (delayMs <= 0) return inner;
  let nextStart = 0;
  return {
    async request(params, options) {
      // the slot is reserved before waiting, so calls made together still queue in order
      const now = Date.now();
      const start = Math.max(now, nextStart);
      nextStart = start + delayMs;
      if (start > now) await sleep(start - now);
      return inner.request(params, options);
    },
  };
}
