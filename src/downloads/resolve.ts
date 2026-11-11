import { findResolver, type ResolveContext, type ResolvedDownload } from './resolvers';

export type { ResolvedDownload } from './resolvers';

const cache = new Map<string, { value: ResolvedDownload; at: number }>();
const TTL_MS = 10 * 60 * 1000;
const CACHE_LIMIT = 100;

function remember(url: string, value: ResolvedDownload) {
  cache.set(url, { value, at: Date.now() });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Turn a file-host page into a direct download URL.
 * F95's /dl/ links are handled by browser assist, not here.
 */
export async function resolveDownload(url: string, context: ResolveContext): Promise<ResolvedDownload> {
  const resolver = findResolver(url);
  if (!resolver) return { url };

  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  let value: ResolvedDownload;
  try {
    value = (await resolver.resolve(url, context)) ?? { url };
  } catch (err) {
    if (!resolver.failsOpen) throw err;
    // a resolver failure is not fatal: the normal probe can still try the original URL
    value = { url };
  }
  remember(url, value);
  return value;
}
