import { describe, expect, test } from 'bun:test';
import type { HttpTransport } from '@light-launcher/plugin-sdk/helpers';
import { spacedTransport } from '../src/transport';

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

describe('spacedTransport', () => {
  test('returns the inner transport unchanged when the delay is 0', () => {
    const { transport } = recordingTransport();
    expect(spacedTransport(transport, 0)).toBe(transport);
  });

  test('starts calls made together one delay apart, in call order', async () => {
    const delay = 40;
    const { transport, starts } = recordingTransport();
    const spaced = spacedTransport(transport, delay);
    await Promise.all([spaced.request(params), spaced.request(params), spaced.request(params)]);

    expect(starts.length).toBe(3);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(delay - 5);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(delay - 5);
  });
});
