import type { HttpTransport } from '@light-launcher/plugin-sdk/helpers';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
