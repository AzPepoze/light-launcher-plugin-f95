import type { SyncStatus } from '@light-launcher/plugin-sdk/types';
import { titleFromSlug } from '@light-launcher/plugin-sdk/helpers';
import type { HostServices, SitemapRow } from '../host';

const BASE = 'https://f95zone.to';

let running = false;

/** The sync:index answer: the index itself stays in the data directory. */
export function indexStatus(services: HostServices, source = 'f95'): SyncStatus {
  return {
    count: services.sitemapCache.count(source),
    syncedAt: services.sitemapCache.syncedAt(source),
    running,
  };
}

/** The sitemap is behind the same Cloudflare check as the forum pages, so the cookie is sent too. */
async function sitemapHeaders(services: HostServices): Promise<Record<string, string>> {
  const cookie = await services.credential.get();
  return cookie ? { Cookie: cookie } : {};
}

function rowsFromMap(text: string): SitemapRow[] {
  const rows: SitemapRow[] = [];
  for (const match of text.matchAll(/<loc>(https:\/\/f95zone\.to\/threads\/[^<]+)<\/loc>/g)) {
    const url = match[1];
    const slug = decodeURIComponent(url.split('/threads/')[1] ?? '').replace(/\/$/, '');
    if (slug) rows.push({ url, slug, title: titleFromSlug(slug) });
  }
  return rows;
}

/**
 * Pulls the forum's public sitemap into the host's cache so "find a game by name"
 * works without the login-gated search page.
 */
export async function syncThreadIndex(
  services: HostServices,
  source = 'f95',
  onProgress: (message: string) => void = () => {},
): Promise<void> {
  if (running) return;
  running = true;
  onProgress('Indexing F95 threads…');
  try {
    const headers = await sitemapHeaders(services);
    const index = await services.http.request(`${BASE}/sitemap.xml`, { headers, timeoutMs: 30_000 });
    const maps = [...index.text.matchAll(/<loc>([^<]*sitemap-\d+\.xml)<\/loc>/g)].map((m) => m[1]);
    if (!maps.length) throw new Error('sitemap index had no child maps');

    const rows: SitemapRow[] = [];
    for (const map of maps) {
      const res = await services.http.request(map, { headers, timeoutMs: 120_000, maxBytes: 40 * 1024 * 1024 });
      rows.push(...rowsFromMap(res.text));
      onProgress(`Indexing F95 threads… ${rows.length.toLocaleString()} found`);
    }

    services.sitemapCache.replace(source, rows);
    services.log('info', `indexed ${rows.length} threads`);
  } finally {
    running = false;
  }
}
