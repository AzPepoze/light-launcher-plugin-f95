import { createHash } from 'node:crypto';
import type {
  BrowseOrder, BrowseParams, FilterOption, FilterValue, GameDTO,
} from '@light-launcher/plugin-sdk/types';
import { ErrorCode, RpcFailure } from '@light-launcher/plugin-sdk/types';
import type { SitemapRow } from '../../host';
import { engineFromText, parseVersion } from './parse';
import { threadIdFromUrl, type XenForoProfile } from './profile';

/** The XenForo listing order values behind the sidebar sort options. */
export const LISTING_SORTS: Record<string, string> = {
  latest: 'last_post_date',
  date: 'last_post_date',
  title: 'title',
  replies: 'reply_count',
  views: 'view_count',
  likes: 'first_post_likes',
};

export type BrowseMode = 'listing' | 'index';

export interface BrowsePlan {
  mode: BrowseMode;
  query: string;
  engines: string[];
  sort: string;
  order: BrowseOrder;
}

export interface BrowseCursor {
  page: number;
  offset: number;
}

function filterEngines(value: FilterValue | undefined): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.map((item) => item.trim()).filter(Boolean);
}

/**
 * A title search or engine filter reads the synced thread index. A plain listing
 * keeps the live forum page order, covers and dates.
 */
export function planBrowse(params: BrowseParams): BrowsePlan {
  const query = params.query?.trim() ?? '';
  const engines = filterEngines(params.filters?.engine);
  const sort = params.sort && LISTING_SORTS[params.sort] ? params.sort : 'latest';
  const order = params.order ?? (sort === 'title' ? 'asc' : 'desc');
  return {
    mode: query || engines.length ? 'index' : 'listing',
    query,
    engines,
    sort,
    order,
  };
}

function fingerprint(plan: BrowsePlan): string {
  return createHash('sha256')
    .update(JSON.stringify([plan.mode, plan.query, [...plan.engines].sort(), plan.sort, plan.order]))
    .digest('hex')
    .slice(0, 16);
}

export function encodeBrowseCursor(plan: BrowsePlan, page: number, offset: number): string {
  return Buffer.from(JSON.stringify({ v: 1, f: fingerprint(plan), p: page, o: offset })).toString('base64url');
}

export function decodeBrowseCursor(plan: BrowsePlan, cursor: string): BrowseCursor {
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      v?: unknown; f?: unknown; p?: unknown; o?: unknown;
    };
    if (
      raw.v !== 1 ||
      raw.f !== fingerprint(plan) ||
      !Number.isInteger(raw.p) ||
      !Number.isInteger(raw.o) ||
      (raw.p as number) < 1 ||
      (raw.o as number) < 0
    ) {
      throw new Error('invalid cursor');
    }
    return { page: raw.p as number, offset: raw.o as number };
  } catch {
    throw new RpcFailure(ErrorCode.InvalidCursor, 'invalid_cursor');
  }
}

/** Rows that match the title text and engine filters, in index order. */
export function filterIndexRows(rows: SitemapRow[], plan: BrowsePlan): SitemapRow[] {
  const needle = plan.query.toLowerCase();
  const engines = new Set(plan.engines.map((engine) => engine.toLowerCase()));
  const matched = rows.filter((row) => {
    if (needle && !row.title.toLowerCase().includes(needle)) return false;
    if (!engines.size) return true;
    const engine = engineFromText(row.title);
    return Boolean(engine && engines.has(engine.toLowerCase()));
  });
  if (plan.sort !== 'title') return matched;
  const sorted = [...matched].sort((left, right) => left.title.toLowerCase().localeCompare(right.title.toLowerCase()));
  return plan.order === 'desc' ? sorted.reverse() : sorted;
}

export function indexGames(rows: SitemapRow[], profile: XenForoProfile, source: string): GameDTO[] {
  return rows.map((row) => ({
    source,
    sourceId: threadIdFromUrl(row.url, profile) || row.url,
    url: row.url,
    title: row.title,
    version: parseVersion(row.title, '', profile),
    updatedAt: null,
    extra: { fromIndex: true },
  }));
}

/** Engine values and whole-index counts for the dynamic sidebar group. */
export function engineFilterOptions(rows: SitemapRow[], query: string, limit: number): FilterOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const engine = engineFromText(row.title);
    if (engine) counts.set(engine, (counts.get(engine) ?? 0) + 1);
  }
  const needle = query.trim().toLowerCase();
  return [...counts.entries()]
    .filter(([label]) => !needle || label.toLowerCase().includes(needle))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ value: label, label, count }));
}
