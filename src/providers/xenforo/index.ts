import { createHash } from 'node:crypto';
import type {
  AuthState, FileCandidate, GameDTO, GameRef, Provider, ProviderCapabilities,
  Ref, UpdateInfo,
} from '../../vendor/types';
import { isNewer } from '../../vendor/version';
import type { HostServices } from '../../host';
import type { XenForoProfile } from './profile';
import {
  extractFileCandidates, parseAccountName, parseListing, parseThread, parseThreadMeta,
} from './parse';

export * from './profile';
export * from './parse';

export interface XenForoProviderOptions {
  /** defaults to the profile id */
  id?: string;
  /** defaults to the profile label */
  label?: string;
  /** cookie header saved for this source, or null when not signed in */
  credential?: string | null;
  userAgent?: string;
}

const MAX_CACHE = 50;
const parsedCache = new Map<string, FileCandidate[]>();
/** the HTTP cache only keeps validators; keep the last parsed page so a 304 does not need a second request */
const dtoCache = new Map<string, { dto: GameDTO; at: number }>();
const DTO_TTL_MS = 5 * 60 * 1000;

function cacheKey(id: string, editedAt: string | null): string {
  return `${id}:${editedAt ?? '0'}`;
}

function remember(id: string, editedAt: string | null, files: FileCandidate[]): void {
  const key = cacheKey(id, editedAt);
  parsedCache.delete(key);
  parsedCache.set(key, files);
  while (parsedCache.size > MAX_CACHE) {
    const oldest = parsedCache.keys().next().value;
    if (oldest === undefined) break;
    parsedCache.delete(oldest);
  }
}

function now(): string {
  return new Date().toISOString();
}

function dateAfter(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  const a = Date.parse(left);
  const b = Date.parse(right);
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
}

/** the site answers 403 both to blocked clients and to pages that need a login, so say both */
function refusedMessage(status: number, url: string): string {
  if (status === 403) {
    return 'F95 refused the request (HTTP 403). It may block automated requests, or the thread needs a login. Try again later.';
  }
  return `HTTP ${status} for ${url}`;
}

function normalizeCookie(input: string): string {
  return input
    .trim()
    .replace(/^cookie\s*:\s*/i, '')
    .replace(/[\r\n]+/g, '; ')
    .replace(/;\s*;/g, ';')
    .trim();
}

export function createXenForoProvider(
  profile: XenForoProfile,
  services: HostServices,
  options: XenForoProviderOptions = {},
): Provider {
  const sourceId = options.id ?? profile.id;
  const label = options.label ?? profile.label;
  const base = profile.baseUrl.replace(/\/+$/, '');
  const loginPath = profile.auth.loginPath.replace(/\/+$/, '') || '/login';
  let credential = options.credential?.trim() ? normalizeCookie(options.credential) : null;

  const cookies = (): Record<string, string> => (credential ? { Cookie: credential } : {});
  // parsed results depend on the login: a guest parse must not answer for a logged-in user
  const memoryId = (sourceId: string): string => {
    const login = credential ? createHash('sha256').update(credential).digest('hex').slice(0, 12) : 'guest';
    return `${sourceId}@${login}`;
  };
  const urlFor = (pathOrUrl: string): string => new URL(pathOrUrl, `${base}/`).toString();

  async function inspectAccount(cookie: string): Promise<AuthState> {
    try {
      const checkUrl = urlFor(profile.auth.checkPath);
      const res = await services.http.get(checkUrl, {
        headers: { Cookie: cookie },
        retries: 0,
        timeoutMs: 20_000,
      });
      let finalPath = '';
      try {
        finalPath = new URL(res.url).pathname.replace(/\/+$/, '');
      } catch {
        finalPath = '';
      }
      const redirected = finalPath === loginPath || finalPath.startsWith(`${loginPath}/`);
      if (res.status >= 400) {
        return { status: 'expired', checkedAt: now(), message: refusedMessage(res.status, res.url || checkUrl) };
      }
      const user = res.notModified ? null : parseAccountName(res.text, profile);
      if (redirected) return { status: 'expired', checkedAt: now(), message: 'redirected to login', user };
      if (!user) return { status: 'expired', checkedAt: now(), message: 'no account name in response', user: null };
      return { status: 'ok', user, checkedAt: now() };
    } catch (err) {
      return { status: 'error', checkedAt: now(), message: (err as Error).message };
    }
  }

  async function authStatus(): Promise<AuthState> {
    if (!credential) return { status: 'unconfigured', checkedAt: now() };
    return inspectAccount(credential);
  }

  function parseRef(url: string): Ref | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    const baseHost = new URL(base).hostname.replace(/^www\./i, '').toLowerCase();
    if (parsed.hostname.replace(/^www\./i, '').toLowerCase() !== baseHost) return null;

    const thread = parsed.href.match(new RegExp(profile.threadUrl, 'i'));
    if (thread?.[1]) {
      return { kind: 'game', id: thread[1], url: `${base}/threads/${thread[1]}/` };
    }
    const bare = parsed.pathname.match(/^\/threads\/(?:[^/]*?\.)?(\d+)(?:\/|$)/);
    if (bare?.[1]) return { kind: 'game', id: bare[1], url: `${base}/threads/${bare[1]}/` };
    if (/^\/(?:forums|sam)(?:\/|$)/i.test(parsed.pathname)) {
      return { kind: 'listing', id: parsed.pathname, url: `${base}${parsed.pathname}` };
    }
    return null;
  }

  async function fetchGame(ref: Ref): Promise<GameDTO> {
    const key = memoryId(ref.id);
    let res = await services.http.get(ref.url, { cacheKey: ref.url, headers: cookies() });
    if (res.notModified) {
      const fresh = dtoCache.get(key);
      if (fresh && Date.now() - fresh.at < DTO_TTL_MS) return fresh.dto;
      // no parsed copy was retained, so ask for the body without validators
      res = await services.http.get(ref.url, { headers: cookies() });
    }
    if (res.status >= 400) throw new Error(`${sourceId}: HTTP ${res.status} for ${ref.url}`);
    const dto = parseThread(res.text, profile, ref.url);
    // reuse this parse for the following resolveFiles() call
    remember(memoryId(dto.sourceId), dto.updatedAt ?? null, extractFileCandidates(res.text, profile, dto.url));
    dtoCache.set(key, { dto, at: Date.now() });
    while (dtoCache.size > MAX_CACHE) {
      const oldest = dtoCache.keys().next().value;
      if (oldest === undefined) break;
      dtoCache.delete(oldest);
    }
    return dto;
  }

  async function fetchList(opts: { url?: string; query?: string; page?: number }): Promise<GameDTO[]> {
    const target = new URL(opts.url ?? `${base}${profile.listing.path}`, `${base}/`);
    if (opts.page && opts.page > 1) target.searchParams.set(profile.listing.pageParam, String(opts.page));
    const res = await services.http.get(target.toString(), { headers: cookies() });
    if (res.notModified || res.status >= 400) return [];
    return parseListing(res.text, profile, target.toString());
  }

  async function threadHtml(game: GameRef): Promise<string> {
    let res = await services.http.get(game.url, { cacheKey: game.url, headers: cookies() });
    if (res.notModified) {
      // the http cache only stores validators, so revalidate without a cache key
      res = await services.http.get(game.url, { headers: cookies() });
    }
    if (res.status >= 400) throw new Error(`${sourceId}: ${refusedMessage(res.status, game.url)}`);
    return res.text;
  }

  async function resolveFiles(game: GameRef): Promise<FileCandidate[]> {
    const cached = parsedCache.get(cacheKey(memoryId(game.sourceId), game.updatedAt)) ?? null;
    if (cached) return cached;
    const html = await threadHtml(game);
    const meta = parseThreadMeta(html, profile);
    const files = extractFileCandidates(html, profile, game.url);
    remember(memoryId(game.sourceId), meta.editedAt, files);
    if (meta.editedAt !== game.updatedAt) remember(memoryId(game.sourceId), game.updatedAt, files);
    return files;
  }

  async function prepareDownload(file: FileCandidate, game: GameRef): Promise<{ url: string; headers: Record<string, string> }> {
    if (file.requiresAuth) {
      if (!credential) {
        throw new Error(`${label}: this download requires a stored session cookie (set the source cookie in settings)`);
      }
      return {
        url: file.url,
        headers: {
          Cookie: credential,
          Referer: game.url,
          ...(options.userAgent ? { 'User-Agent': options.userAgent } : {}),
        },
      };
    }
    return { url: file.url, headers: {} };
  }

  async function checkUpdate(game: GameRef): Promise<UpdateInfo | null> {
    const res = await services.http.get(game.url, { cacheKey: game.url, headers: cookies() });
    if (res.notModified) return null;
    if (res.status >= 400) throw new Error(`${sourceId}: ${refusedMessage(res.status, game.url)}`);
    const fresh = parseThread(res.text, profile, game.url);
    const meta = parseThreadMeta(res.text, profile);
    const versionNewer = isNewer(fresh.version ?? null, game.version);
    const editedLater = dateAfter(meta.editedAt, game.updatedAt);
    // reuse this fetch for a following resolveFiles() call
    remember(memoryId(game.sourceId), meta.editedAt, extractFileCandidates(res.text, profile, game.url));
    if (!versionNewer && !editedLater) return null;
    return { version: fresh.version ?? null, updatedAt: meta.editedAt, changelog: fresh.changelog ?? null };
  }

  const capabilities: ProviderCapabilities = {
    browse: true,
    auth: 'cookie',
    updateCheck: true,
    resolveFiles: true,
    versioned: true,
  };

  return {
    id: sourceId,
    label,
    capabilities,
    parseRef,
    authStatus,
    // Validates the cookie, then saves it through the host's credential store.
    async setCredential(value: string): Promise<AuthState> {
      const normalized = normalizeCookie(value);
      if (!normalized) return { status: 'unconfigured', checkedAt: now() };
      const state = await inspectAccount(normalized);
      if (state.status === 'ok') {
        credential = normalized;
        await services.credential.set(normalized);
      }
      return state;
    },
    async clearCredential(): Promise<void> {
      credential = null;
      await services.credential.set(null);
    },
    fetchGame,
    fetchList,
    resolveFiles,
    prepareDownload,
    checkUpdate,
  };
}
