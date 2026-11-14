import { describe, expect, test } from 'bun:test';
import { spacedTransport, type HttpTransport } from '@light-launcher/plugin-sdk/helpers';
import { loggedTransport } from '../src/transport';

/** Records the time each request reaches the inner transport. */
function recordingTransport(): { transport: HttpTransport; starts: number[] } {
  const starts: number[] = [];
  const transport: HttpTransport = {
    request: async (params) => {
      starts.push(Date.now());
      return { status: 200, url: params.url, text: '', headers: {}, notModified: false };
    },
  };
  return { transport, starts };
}

const params = { url: 'https://f95zone.to/threads/1/' };

describe('loggedTransport', () => {
  test('writes a debug line with the host name and status, without the path', async () => {
    const { transport } = recordingTransport();
    const logs: Array<{ level: string; message: string }> = [];
    const logged = loggedTransport(transport, (level, message) => logs.push({ level, message }));
    await logged.request({ url: 'https://pixeldrain.com/u/secret-token?x=1' });

    expect(logs.length).toBe(1);
    expect(logs[0]?.level).toBe('debug');
    expect(logs[0]?.message).toMatch(/^GET pixeldrain\.com 200 in \d+ ms$/);
  });

  test('logs failed requests and rethrows the error', async () => {
    const failing: HttpTransport = { request: async () => { throw new Error('offline'); } };
    const logs: string[] = [];
    const logged = loggedTransport(failing, (_level, message) => logs.push(message));
    await expect(logged.request(params)).rejects.toThrow('offline');
    expect(logs[0]).toMatch(/^GET f95zone\.to failed after \d+ ms$/);
  });
});

describe('spacedTransport', () => {
  test('returns the inner transport unchanged when the delay is 0', () => {
    const { transport } = recordingTransport();
    expect(spacedTransport(transport, { minDelayMs: 0 })).toBe(transport);
  });

  test('starts calls made together one delay apart, in call order', async () => {
    const delay = 40;
    const { transport, starts } = recordingTransport();
    const spaced = spacedTransport(transport, { minDelayMs: delay });
    await Promise.all([spaced.request(params), spaced.request(params), spaced.request(params)]);

    expect(starts.length).toBe(3);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(delay - 5);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(delay - 5);
  });
});
