import fs from 'node:fs';
import path from 'node:path';
import type { SitemapCache, SitemapRow } from './host';
import type { CacheEntry, HttpCache } from './vendor/http';

const HTTP_CACHE_LIMIT = 500;

/** Keeps only validators (etag, last-modified) for conditional GET; the parsed page is kept by the provider. */
export function memoryHttpCache(limit = HTTP_CACHE_LIMIT): HttpCache {
  const entries = new Map<string, CacheEntry>();
  return {
    get: (url) => entries.get(url) ?? null,
    set(url, entry) {
      entries.delete(url);
      entries.set(url, entry);
      while (entries.size > limit) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
  };
}

interface SitemapEntry {
  syncedAt: string;
  rows: SitemapRow[];
}

type SitemapFile = Record<string, SitemapEntry>;

function readSitemapFile(file: string): SitemapFile {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as SitemapFile;
  } catch {
    return {};
  }
}

/** The thread index kept as `sitemap.json` in the plugin's data directory. */
export function fileSitemapCache(dataDir: string): SitemapCache {
  const file = path.join(dataDir, 'sitemap.json');
  let data = readSitemapFile(file);
  return {
    count: (source) => data[source]?.rows.length ?? 0,
    syncedAt: (source) => data[source]?.syncedAt ?? null,
    replace(source, rows) {
      data = { ...data, [source]: { syncedAt: new Date().toISOString(), rows } };
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data));
    },
  };
}
