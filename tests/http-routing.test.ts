import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import path from 'node:path';
import { deriveKeys, resolveMega, parseMegaLink } from '../src/downloads/mega';
import { BuzzHeavierHost } from '../src/downloads/resolvers/buzzheavier';
import { DataNodesHost } from '../src/downloads/resolvers/datanodes';
import { MegaHost } from '../src/downloads/resolvers/mega';
import { fakeServices, type Responder } from './fakes';

const SRC_DIR = path.resolve(import.meta.dir, '../src');
const realFetch = globalThis.fetch;

/** Any test that reaches global fetch fails here instead of touching the network. */
function blockGlobalFetch(): void {
  globalThis.fetch = Object.assign(
    async (): Promise<Response> => {
      throw new Error('global fetch is not allowed in the plugin; use the host http client');
    },
    { preconnect: realFetch.preconnect },
  );
}

beforeEach(blockGlobalFetch);
afterEach(() => {
  globalThis.fetch = realFetch;
});

function resolverContext(respond?: Responder) {
  const fake = fakeServices({ respond });
  return { fake, context: { headers: {}, http: fake.services.http } };
}

describe('file hosts send requests through the host', () => {
  test('BuzzHeavier reads the redirect header from the host reply', async () => {
    const { fake, context } = resolverContext(() => ({ headers: { 'hx-redirect': '/dl/game.zip' } }));

    const resolved = await new BuzzHeavierHost().resolve('https://buzzheavier.com/abc123', context);

    expect(resolved?.url).toBe('https://buzzheavier.com/dl/game.zip');
    expect(fake.calls[0]?.url).toBe('https://buzzheavier.com/abc123/download');
  });

  test('a page host reads the page HTML from the host reply', async () => {
    const { fake, context } = resolverContext((_url, params) =>
      params.method === 'HEAD'
        ? { headers: { 'content-type': 'text/html; charset=utf-8' } }
        : { headers: { 'content-type': 'text/html' }, text: '<a href="/download/game.zip">Download</a>' },
    );

    const resolved = await new DataNodesHost().resolve('https://datanodes.to/abc123', context);

    expect(resolved?.url).toBe('https://datanodes.to/download/game.zip');
    expect(fake.calls.map((call) => call.options.method ?? 'GET')).toEqual(['HEAD', 'GET']);
  });

  test('a link that is already a file is not downloaded by the plugin', async () => {
    const { fake, context } = resolverContext(() => ({ headers: { 'content-type': 'application/zip' } }));

    const resolved = await new DataNodesHost().resolve('https://datanodes.to/game.zip', context);

    expect(resolved?.url).toBe('https://datanodes.to/game.zip');
    expect(fake.calls.map((call) => call.options.method)).toEqual(['HEAD']);
  });

  test('MEGA asks the API through the host and decrypts the file name', async () => {
    const fileKey = Buffer.alloc(32, 7).toString('base64url');
    const { aesKey } = deriveKeys(fileKey);
    const plain = Buffer.from('MEGA{"n":"game.zip"}');
    const padded = Buffer.concat([plain, Buffer.alloc((16 - (plain.length % 16)) % 16)]);
    const cipher = crypto.createCipheriv('aes-128-cbc', aesKey, Buffer.alloc(16));
    cipher.setAutoPadding(false);
    const attributes = Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64url');
    const reply = [{ g: 'https://gfs1.userstorage.mega.co.nz/dl', s: 3, at: attributes }];
    const { fake, context } = resolverContext(() => ({ text: JSON.stringify(reply) }));

    const link = parseMegaLink(`https://mega.nz/file/abc#${fileKey}`);
    if (!link) throw new Error('test link did not parse');
    const file = await resolveMega(link, context.http);

    expect(file.filename).toBe('game.zip');
    expect(file.size).toBe(3);
    expect(fake.calls[0]?.url.startsWith('https://g.api.mega.co.nz/cs?id=')).toBe(true);
    expect(fake.calls[0]?.options.method).toBe('POST');
    expect(await new MegaHost().resolve(`https://mega.nz/file/abc#${fileKey}`, context)).not.toBeNull();
  });
});

describe('source files never use network APIs directly', () => {
  const sources = Array.from(new Bun.Glob('**/*.ts').scanSync({ cwd: SRC_DIR }));

  test('no source file calls global fetch', async () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const text = await Bun.file(path.join(SRC_DIR, file)).text();
      if (/(^|[^.\w])fetch\(/m.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test('no source file opens its own WebSocket', async () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const text = await Bun.file(path.join(SRC_DIR, file)).text();
      if (/new WebSocket\(/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
