import fs from 'node:fs';
import path from 'node:path';
import type { SitemapCache, SitemapRow } from './host';

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
    rows: (source) => data[source]?.rows ?? [],
    replace(source, rows) {
      data = { ...data, [source]: { syncedAt: new Date().toISOString(), rows } };
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data));
    },
  };
}
