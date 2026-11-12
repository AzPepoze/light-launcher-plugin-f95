import { describe, expect, test } from 'bun:test';
import { ErrorCode } from '@light-launcher/plugin-sdk/types';
import { createF95Provider } from '../src/providers/f95';
import { decodeBrowseCursor, encodeBrowseCursor, parseProfile, planBrowse } from '../src/providers/xenforo';
import profileJson from '../profiles/f95zone.json';
import { fakeServices } from './fakes';

const profile = parseProfile(profileJson, 'profiles/f95zone.json');
const listingHtml = await Bun.file(new URL('./fixtures/f95-listing.html', import.meta.url)).text();

const indexRows = [
  { url: 'https://f95zone.to/threads/quiet-meadow-v0-11-1.111/', slug: 'quiet-meadow-v0-11-1.111', title: "Quiet Meadow [v0.11.1] [Ren'Py]" },
  { url: 'https://f95zone.to/threads/pixel-town.222/', slug: 'pixel-town.222', title: 'Pixel Town [Unity]' },
  { url: 'https://f95zone.to/threads/my-game.12345/', slug: 'my-game.12345', title: 'My Game [v0.8.1]' },
];

function provider(options: { respond?: () => { text: string }; sitemap?: typeof indexRows } = {}) {
  const fake = fakeServices({
    respond: options.respond ?? (() => ({ text: listingHtml })),
    sitemap: options.sitemap,
  });
  return { fake, provider: createF95Provider(fake.services, { profile }) };
}

describe('source.browse', () => {
  test('maps the listing page, sort and order, with a page cursor', async () => {
    const { fake, provider: source } = provider();

    const page = await source.browse!({ source: 'f95', limit: 2 }, {});

    expect(page.games.map((game) => game.sourceId)).toEqual(['12345', '67890']);
    expect(page.games[0]).toMatchObject({
      source: 'f95',
      sourceId: '12345',
      url: 'https://f95zone.to/threads/12345/',
      title: 'My Game [v0.8.1]',
      version: '0.8.1',
      coverUrl: 'https://f95zone.to/data/attachments/0/thumb-12345.jpg',
      updatedAt: '2026-03-15T16:30:00.000Z',
    });
    expect(page.total).toBeUndefined();
    expect(page.nextCursor).toBeTruthy();
    expect(fake.calls[0]?.url).toBe(
      'https://f95zone.to/forums/adult-games.1/?order=last_post_date&direction=desc',
    );
  });

  test('sends the chosen sort and order to the listing', async () => {
    const { fake, provider: source } = provider();
    await source.browse!({ source: 'f95', sort: 'title', order: 'asc', limit: 5 }, {});
    expect(fake.calls[0]?.url).toBe(
      'https://f95zone.to/forums/adult-games.1/?order=title&direction=asc',
    );
  });

  test('searches titles in the thread index and reports the total', async () => {
    const { provider: source } = provider({ sitemap: indexRows });

    const page = await source.browse!({ source: 'f95', query: 'pixel', limit: 10 }, {});

    expect(page.total).toBe(1);
    expect(page.nextCursor).toBeUndefined();
    expect(page.games[0]).toMatchObject({
      source: 'f95',
      sourceId: '222',
      url: 'https://f95zone.to/threads/pixel-town.222/',
      title: 'Pixel Town [Unity]',
      version: null,
      updatedAt: null,
      extra: { fromIndex: true },
    });
  });

  test('filters the index by engine and ignores an unknown group', async () => {
    const { provider: source } = provider({ sitemap: indexRows });

    const page = await source.browse!({
      source: 'f95',
      filters: { engine: ['unity'], unknown: true },
      limit: 10,
    }, {});

    expect(page.total).toBe(1);
    expect(page.games.map((game) => game.title)).toEqual(['Pixel Town [Unity]']);
  });

  test('pages the index with a cursor and sorts by title', async () => {
    const { provider: source } = provider({ sitemap: indexRows });

    const first = await source.browse!({ source: 'f95', query: 'a', sort: 'title', order: 'asc', limit: 1 }, {});
    expect(first.games.map((game) => game.title)).toEqual(['My Game [v0.8.1]']);
    expect(first.total).toBe(2);

    const second = await source.browse!({
      source: 'f95',
      query: 'a',
      sort: 'title',
      order: 'asc',
      limit: 1,
      cursor: first.nextCursor,
    }, {});
    expect(second.games.map((game) => game.title)).toEqual(["Quiet Meadow [v0.11.1] [Ren'Py]"]);
    expect(second.nextCursor).toBeUndefined();
    expect(second.total).toBe(2);
  });

  test('rejects a cursor made for another query with invalid_cursor', async () => {
    const { provider: source } = provider({ sitemap: indexRows });
    const first = await source.browse!({ source: 'f95', query: 'a', limit: 1 }, {});

    await expect(source.browse!({
      source: 'f95',
      query: 'pixel',
      limit: 1,
      cursor: first.nextCursor,
    }, {})).rejects.toMatchObject({ code: ErrorCode.InvalidCursor, message: 'invalid_cursor' });
  });

  test('rejects a cursor that is not one of ours', async () => {
    const { provider: source } = provider({ sitemap: indexRows });
    await expect(source.browse!({ source: 'f95', query: 'a', limit: 1, cursor: 'nope' }, {}))
      .rejects.toMatchObject({ code: ErrorCode.InvalidCursor });
  });

  test('a plain browse cursor is tied to its sort and order', () => {
    const plan = planBrowse({ source: 'f95', sort: 'title', order: 'asc', limit: 5 });
    const cursor = decodeBrowseCursor(plan, encodeBrowseCursor(plan, 2, 0));
    expect(cursor).toEqual({ page: 2, offset: 0 });
    expect(() => decodeBrowseCursor(
      planBrowse({ source: 'f95', sort: 'latest', order: 'desc', limit: 5 }),
      encodeBrowseCursor(plan, 2, 0),
    )).toThrow('invalid_cursor');
  });
});

describe('source.listFilters', () => {
  test('lists engine options with whole-index counts', async () => {
    const { provider: source } = provider({ sitemap: indexRows });

    const result = await source.listFilters!({ source: 'f95', group: 'engine', limit: 10 }, {});

    expect(result.options).toEqual([
      { value: "Ren'Py", label: "Ren'Py", count: 1 },
      { value: 'Unity', label: 'Unity', count: 1 },
    ]);
  });

  test('filters the options by the box text and the limit', async () => {
    const { provider: source } = provider({ sitemap: indexRows });

    expect((await source.listFilters!({ source: 'f95', group: 'engine', query: 'uni', limit: 10 }, {})).options)
      .toEqual([{ value: 'Unity', label: 'Unity', count: 1 }]);
    expect((await source.listFilters!({ source: 'f95', group: 'engine', limit: 1 }, {})).options.length).toBe(1);
  });

  test('answers an unknown group with no options', async () => {
    const { provider: source } = provider({ sitemap: indexRows });
    expect(await source.listFilters!({ source: 'f95', group: 'tags', limit: 10 }, {})).toEqual({ options: [] });
  });
});
