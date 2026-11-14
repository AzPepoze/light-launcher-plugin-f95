import { createHash } from 'node:crypto';
import type {
  AuthState, BrowseParams, BrowseResult, FileCandidate, GameDTO, GameRef, ListFiltersParams,
  ListFiltersResult, ProviderCapabilities, Ref, UpdateInfo,
} from '@light-launcher/plugin-sdk/types';
import { isNewer } from '@light-launcher/plugin-sdk/helpers';
import type { CallHooks, SourceProvider } from '@light-launcher/plugin-sdk/runtime';
import { ErrorCode, RpcFailure, type PrepareDownloadResult } from '@light-launcher/plugin-sdk/types';
import { downloadHints } from '@light-launcher/plugin-sdk';
import { withBrowserHeaders } from '../../downloads/hosts';
import { megaDecryptField, type MegaDecryptField } from '../../downloads/mega';
import { applyFilePreferences, type FilePreferences } from '../../downloads/preferences';
import { findResolver, resolveDownload } from '../../downloads/resolve';
import type { HostServices } from '../../host';
import { settingsFrom, type PluginSettings } from '../../settings';
import type { XenForoProfile } from './profile';
import {
  extractFileCandidates, isDownloadRedirect, parseAccountName, parseListing, parseThread, parseThreadMeta,
} from './parse';
import {
  decodeBrowseCursor, encodeBrowseCursor, engineFilterOptions, filterIndexRows, indexGames,
  LISTING_SORTS, planBrowse, type BrowsePlan,
} from './browse';

export * from './profile';
export * from './parse';
export * from './browse';

/**
 * source.prepareDownload answer with the encrypted-download field.
 * It is declared here until the SDK's PrepareDownloadResult carries `decrypt` itself.
 */
export type PrepareDownloadWithDecrypt = PrepareDownloadResult & { decrypt?: MegaDecryptField };

export interface XenForoProviderOptions {
  /** defaults to the profile id */
  id?: string;
  /** defaults to the profile label */
  label?: string;
  userAgent?: string;
  /** host and platform choices applied to the links resolveFiles returns */
  filePreferences?: FilePreferences;
  /** minimum time between update checks of one game; 0 checks every time */
  updateCheckIntervalMs?: number;
  /** read on each call, so settings changes apply without a restart */
  getSettings?: () => Promise<PluginSettings>;
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
): SourceProvider {
  const sourceId = options.id ?? profile.id;
  const label = options.label ?? profile.label;
  const base = profile.baseUrl.replace(/\/+$/, '');
  const loginPath = profile.auth.loginPath.replace(/\/+$/, '') || '/login';

  const defaults = settingsFrom({});
  const startupSettings: PluginSettings = {
    ...defaults,
    userAgent: options.userAgent ?? defaults.userAgent,
    filePreferences: options.filePreferences ?? defaults.filePreferences,
    updateCheckIntervalMs: options.updateCheckIntervalMs ?? defaults.updateCheckIntervalMs,
  };

  /** Settings are read again for every call, so a change applies without a restart. */
  async function currentSettings(): Promise<PluginSettings> {
    const loaded = options.getSettings ? await options.getSettings() : null;
    return loaded ? { ...startupSettings, ...loaded } : startupSettings;
  }

  /** The saved cookie, normalized, or null when not signed in. */
  async function savedCookie(): Promise<string | null> {
    const stored = await services.credential.get();
    return stored?.trim() ? normalizeCookie(stored) : null;
  }

  async function cookieHeaders(): Promise<Record<string, string>> {
    const cookie = await savedCookie();
    return cookie ? { Cookie: cookie } : {};
  }

  // parsed results depend on the login: a guest parse must not answer for a logged-in user
  async function memoryId(id: string): Promise<string> {
    const cookie = await savedCookie();
    const login = cookie ? createHash('sha256').update(cookie).digest('hex').slice(0, 12) : 'guest';
    return `${id}@${login}`;
  }

  const urlFor = (pathOrUrl: string): string => new URL(pathOrUrl, `${base}/`).toString();

  function parseThreadPage(html: string, url: string, id: string): GameDTO {
    const dto = parseThread(html, profile, url);
    if (!dto.title || !dto.descriptionHtml) services.dump(`thread-${id}`, html);
    return dto;
  }

  function parseListingPage(html: string, url: string): GameDTO[] {
    const games = parseListing(html, profile, url);
    if (!games.length) services.dump('listing', html);
    return games;
  }

  async function inspectAccount(cookie: string): Promise<AuthState> {
    try {
      const checkUrl = urlFor(profile.auth.checkPath);
      const res = await services.http.request(checkUrl, {
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
    const cookie = await savedCookie();
    if (!cookie) return { status: 'unconfigured', checkedAt: now() };
    return inspectAccount(cookie);
  }

  /** Validates the cookie, then saves it through the host's secret store. */
  async function setCredential(value: string): Promise<AuthState> {
    const normalized = normalizeCookie(value);
    if (!normalized) return { status: 'unconfigured', checkedAt: now() };
    const state = await inspectAccount(normalized);
    if (state.status === 'ok') await services.credential.set(normalized);
    return state;
  }

  async function clearCredential(): Promise<AuthState> {
    await services.credential.set(null);
    return { status: 'unconfigured', checkedAt: now() };
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
    const key = await memoryId(ref.id);
    let res = await services.http.request(ref.url, { cacheKey: ref.url, headers: await cookieHeaders() });
    if (res.notModified) {
      const fresh = dtoCache.get(key);
      if (fresh && Date.now() - fresh.at < DTO_TTL_MS) return fresh.dto;
      // no parsed copy was retained, so ask for the body without validators
      res = await services.http.request(ref.url, { headers: await cookieHeaders() });
    }
    if (res.status >= 400) throw new Error(`${sourceId}: HTTP ${res.status} for ${ref.url}`);
    const dto = parseThreadPage(res.text, ref.url, ref.id);
    // reuse this parse for the following resolveFiles() call
    remember(await memoryId(dto.sourceId), dto.updatedAt ?? null, extractFileCandidates(res.text, profile, dto.url));
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
    const res = await services.http.request(target.toString(), { headers: await cookieHeaders() });
    if (res.notModified || res.status >= 400) return [];
    return parseListingPage(res.text, target.toString());
  }

  async function browseIndex(plan: BrowsePlan, page: number, offset: number, limit: number): Promise<BrowseResult> {
    const rows = services.sitemapCache.rows(sourceId);
    if (!rows.length) {
      services.log('warn', 'the F95 thread index is empty; run a sync to search titles');
    }
    const matched = filterIndexRows(rows, plan);
    const total = matched.length;
    const games = indexGames(matched.slice(offset, offset + limit), profile, sourceId);
    const next = offset + games.length < total
      ? encodeBrowseCursor(plan, page, offset + games.length)
      : undefined;
    return next ? { games, nextCursor: next, total } : { games, total };
  }

  async function browseListing(plan: BrowsePlan, page: number, offset: number, limit: number): Promise<BrowseResult> {
    const games: GameDTO[] = [];
    const seen = new Set<string>();
    let next: string | undefined;
    let currentPage = page;
    let currentOffset = offset;

    while (games.length < limit) {
      const target = new URL(`${base}${profile.listing.path}`, `${base}/`);
      target.searchParams.set('order', LISTING_SORTS[plan.sort]);
      target.searchParams.set('direction', plan.order);
      if (currentPage > 1) target.searchParams.set(profile.listing.pageParam, String(currentPage));
      const res = await services.http.request(target.toString(), { headers: await cookieHeaders() });
      if (res.notModified || res.status >= 400) break;
      const batch = parseListingPage(res.text, target.toString());
      if (!batch.length || currentOffset >= batch.length) break;

      const available = batch.slice(currentOffset);
      let consumed = 0;
      let added = 0;
      for (const game of available) {
        consumed++;
        if (seen.has(game.sourceId)) continue;
        seen.add(game.sourceId);
        games.push(game);
        added++;
        if (games.length === limit) break;
      }
      if (games.length === limit) {
        next = encodeBrowseCursor(plan, currentPage, currentOffset + consumed);
        break;
      }
      // a page with nothing new means the listing started repeating itself
      if (!added) break;
      currentPage++;
      currentOffset = 0;
    }
    return next ? { games, nextCursor: next } : { games };
  }

  async function browse(params: BrowseParams): Promise<BrowseResult> {
    const plan = planBrowse(params);
    const limit = Math.max(1, Math.min(params.limit, 100));
    const cursor = params.cursor ? decodeBrowseCursor(plan, params.cursor) : { page: 1, offset: 0 };
    if (plan.mode === 'index') return browseIndex(plan, cursor.page, cursor.offset, limit);
    return browseListing(plan, cursor.page, cursor.offset, limit);
  }

  async function listFilters(params: ListFiltersParams): Promise<ListFiltersResult> {
    if (params.group !== 'engine') return { options: [] };
    const limit = Math.max(1, Math.min(params.limit, 200));
    return { options: engineFilterOptions(services.sitemapCache.rows(sourceId), params.query ?? '', limit) };
  }

  async function threadHtml(game: GameRef): Promise<string> {
    let res = await services.http.request(game.url, { cacheKey: game.url, headers: await cookieHeaders() });
    if (res.notModified) {
      // the http cache only stores validators, so revalidate without a cache key
      res = await services.http.request(game.url, { headers: await cookieHeaders() });
    }
    if (res.status >= 400) throw new Error(`${sourceId}: ${refusedMessage(res.status, game.url)}`);
    return res.text;
  }

  async function resolveFiles(game: GameRef): Promise<FileCandidate[]> {
    const files = await listFiles(game);
    const settings = await currentSettings();
    return applyFilePreferences(files, settings.filePreferences);
  }

  /** The links the thread lists, parsed once and cached. The cache keeps the thread's order. */
  async function listFiles(game: GameRef): Promise<FileCandidate[]> {
    const id = await memoryId(game.sourceId);
    const cached = parsedCache.get(cacheKey(id, game.updatedAt ?? null)) ?? null;
    if (cached) return cached;
    const html = await threadHtml(game);
    const meta = parseThreadMeta(html, profile);
    const files = extractFileCandidates(html, profile, game.url);
    remember(id, meta.editedAt, files);
    if (meta.editedAt !== game.updatedAt) remember(id, game.updatedAt ?? null, files);
    return files;
  }

  /** A failed browser assist gets a code and a plain message the launcher can show. */
  function browserError(err: unknown): RpcFailure {
    const message = err instanceof Error ? err.message : String(err);
    if (/turn(?:ed)? off/i.test(message)) {
      return new RpcFailure(
        ErrorCode.PermissionDenied,
        `${label}: browser assist is turned off in the plugin settings.`,
      );
    }
    if ((err instanceof RpcFailure && err.code === ErrorCode.PermissionDenied) || /permission/i.test(message)) {
      return new RpcFailure(
        ErrorCode.PermissionDenied,
        `${label}: the launcher did not allow a browser window for this download.`,
      );
    }
    if (/clos/i.test(message)) {
      return new RpcFailure(
        ErrorCode.Canceled,
        `${label}: the browser window was closed before a download link was captured.`,
      );
    }
    if ((err instanceof RpcFailure && err.code === ErrorCode.Timeout) || /tim(?:e|ed)?\s*out/i.test(message)) {
      return new RpcFailure(
        ErrorCode.Timeout,
        `${label}: browser assist timed out before a download link was captured.`,
      );
    }
    if (err instanceof RpcFailure && err.code === ErrorCode.Canceled) {
      return new RpcFailure(ErrorCode.Canceled, `${label}: browser assist was closed or canceled before a download link was captured.`);
    }
    return new RpcFailure(ErrorCode.InternalError, `${label}: browser assist failed: ${message}`);
  }

  /** Opens the embedded browser and waits for the user to finish the page's download step. */
  async function captureRedirect(
    file: FileCandidate,
    game: GameRef,
    hooks: CallHooks,
    settings: PluginSettings,
  ): Promise<PrepareDownloadResult> {
    if (!settings.browserAssistEnabled) {
      throw new RpcFailure(
        ErrorCode.PermissionDenied,
        `${label}: browser assist is turned off in the plugin settings, so the download link cannot be captured.`,
      );
    }
    hooks.progress?.({ message: 'Use the browser window to finish the download; the launcher will catch the file.' });
    let captured;
    try {
      captured = await services.browser.capture(file.url, {
        signal: hooks.signal,
        onWaiting: (message) => hooks.progress?.({ message }),
        onProgress: (percent, message) => hooks.progress?.({ done: percent, total: 100, message }),
      });
    } catch (err) {
      throw browserError(err);
    }
    if (!captured.capturedUrl) {
      throw new RpcFailure(
        ErrorCode.InternalError,
        `${label}: no download link was captured. Use the browser window to finish the download and try again.`,
      );
    }
    return {
      url: captured.capturedUrl,
      headers: captured.headers ?? {},
      filename: captured.filename ?? undefined,
      size: captured.size ?? undefined,
      ...downloadHints(settings, game),
    };
  }

  async function prepareDownload(
    file: FileCandidate,
    game: GameRef,
    hooks: CallHooks = {},
  ): Promise<PrepareDownloadWithDecrypt> {
    const settings = await currentSettings();
    const hints = downloadHints(settings, game);
    if (isDownloadRedirect(file.url)) return captureRedirect(file, game, hooks, settings);

    if (findResolver(file.url)) {
      const credentials = withBrowserHeaders(file.url, file.headers ?? {});
      let resolved;
      try {
        resolved = await resolveDownload(file.url, { headers: credentials, http: services.http });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new RpcFailure(
          ErrorCode.RemoteError,
          `${label}: could not resolve the ${file.host ?? 'file host'} link: ${message}`,
        );
      }
      if (resolved.needsHuman) return captureRedirect(file, game, hooks, settings);
      const prepared = {
        url: resolved.url,
        headers: withBrowserHeaders(resolved.url, { ...file.headers, ...resolved.headers }),
        filename: resolved.filename ?? file.filename ?? undefined,
        size: resolved.size ?? file.size ?? undefined,
      };
      if (!resolved.decrypt) return { ...prepared, ...hints };
      // MEGA: the host decrypts the finished file with this key; the key is never logged.
      return { ...prepared, decrypt: megaDecryptField(resolved.decrypt), ...hints };
    }

    // an unsupported mirror page is as likely to need a person as a supported one
    if (file.kind === 'mirror') return captureRedirect(file, game, hooks, settings);

    if (file.requiresAuth) {
      const cookie = await savedCookie();
      if (!cookie) {
        throw new RpcFailure(ErrorCode.AuthRequired, `${label} needs a sign-in cookie for this download. Add it in the source settings.`);
      }
      return {
        url: file.url,
        headers: {
          Cookie: cookie,
          Referer: game.url,
          ...(options.userAgent ? { 'User-Agent': settings.userAgent } : {}),
        },
        ...hints,
      };
    }
    return { url: file.url, headers: { ...file.headers }, ...hints };
  }

  /** When each game was last checked, by source id. It is kept in memory, so a restart clears it. */
  const lastUpdateCheck = new Map<string, number>();

  function isInsideUpdateInterval(game: GameRef): boolean {
    const interval = options.updateCheckIntervalMs ?? 0;
    const last = lastUpdateCheck.get(game.sourceId);
    return interval > 0 && last !== undefined && Date.now() - last < interval;
  }

  /** Inside the interval the thread is not fetched and no update is reported. */
  async function checkUpdate(game: GameRef): Promise<UpdateInfo | null> {
    if (isInsideUpdateInterval(game)) return null;
    const update = await fetchUpdate(game);
    lastUpdateCheck.set(game.sourceId, Date.now());
    return update;
  }

  async function fetchUpdate(game: GameRef): Promise<UpdateInfo | null> {
    const res = await services.http.request(game.url, { cacheKey: game.url, headers: await cookieHeaders() });
    if (res.notModified) return null;
    if (res.status >= 400) throw new Error(`${sourceId}: ${refusedMessage(res.status, game.url)}`);
    const fresh = parseThreadPage(res.text, game.url, game.sourceId);
    const meta = parseThreadMeta(res.text, profile);
    const versionNewer = isNewer(fresh.version ?? null, game.version);
    const editedLater = dateAfter(meta.editedAt, game.updatedAt ?? null);
    // reuse this fetch for a following resolveFiles() call
    remember(await memoryId(game.sourceId), meta.editedAt, extractFileCandidates(res.text, profile, game.url));
    if (!versionNewer && !editedLater) return null;
    return { version: fresh.version ?? null, updatedAt: meta.editedAt, changelog: fresh.changelog ?? null };
  }

  const capabilities: ProviderCapabilities = {
    browse: true,
    auth: 'cookie',
    updateCheck: true,
    resolveFiles: true,
    versioned: true,
    'browse:filters': true,
  };

  return {
    id: sourceId,
    capabilities,
    parseRef,
    authStatus,
    setCredential,
    clearCredential,
    fetchGame,
    fetchList,
    browse,
    listFilters,
    resolveFiles,
    prepareDownload,
    checkUpdate,
  };
}
