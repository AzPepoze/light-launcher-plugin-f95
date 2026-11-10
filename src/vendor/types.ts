// vendored until the SDK is published; replace with @light-launcher/plugin-sdk

/**
 * Provider contract types copied from Interesting Launcher.
 * Only the shapes a source plugin produces or consumes are kept here.
 */

export type SourceId = string;
export type Platform = 'windows' | 'linux' | 'mac' | 'android' | 'unknown';
export type GameStatus = 'ongoing' | 'completed' | 'abandoned' | 'onhold' | 'unknown';
export type AuthKind = 'none' | 'cookie' | 'apikey';
export type AuthStatus = 'unconfigured' | 'ok' | 'expired' | 'invalid' | 'error';

export interface GameDTO {
  source: SourceId;
  sourceId: string;
  url: string;
  title: string;
  version?: string | null;
  developer?: string | null;
  engine?: string | null;
  tags?: string[];
  coverUrl?: string | null;
  screenshots?: string[];
  descriptionHtml?: string | null;
  changelog?: string | null;
  rating?: number | null;
  status?: GameStatus;
  updatedAt?: string | null;
  extra?: Record<string, unknown>;
}

export type FileKind = 'mirror' | 'attachment' | 'direct' | 'external';

export interface FileCandidate {
  /** stable within a game: host + path hash is fine */
  id: string;
  label: string;
  url: string;
  filename?: string | null;
  size?: number | null;
  host?: string | null;
  kind: FileKind;
  platform?: Platform;
  /** true when the URL is only reachable with the source session/key */
  requiresAuth?: boolean;
  /** known-good range support: true = yes, false = no, undefined = probe */
  rangeHint?: boolean | null;
  /** extra request headers the downloader must send (referer, cookies...) */
  headers?: Record<string, string>;
}

export interface UpdateInfo {
  version?: string | null;
  updatedAt?: string | null;
  changelog?: string | null;
}

export interface Ref {
  kind: 'game' | 'listing';
  id: string;
  url: string;
}

export interface ProviderCapabilities {
  /** can enumerate a listing / search page */
  browse: boolean;
  auth: AuthKind;
  /** can tell whether a newer release exists */
  updateCheck: boolean;
  /** can produce download candidates */
  resolveFiles: boolean;
  /** version strings are meaningful (not just file mtimes) */
  versioned: boolean;
}

export interface AuthState {
  status: AuthStatus;
  user?: string | null;
  message?: string | null;
  checkedAt?: string | null;
}

/** Minimal game shape a provider needs to re-fetch something. */
export interface GameRef {
  id: number;
  source: SourceId;
  sourceId: string;
  url: string;
  title: string;
  version: string | null;
  updatedAt: string | null;
  extra: Record<string, unknown> | null;
}

export interface Provider {
  readonly id: SourceId;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;

  /** URL -> ref, purely syntactic. null = this source doesn't own that URL. */
  parseRef(url: string): Ref | null;

  authStatus(): Promise<AuthState>;
  /** cookie header for f95, api key for itch. Returns the new state. */
  setCredential(value: string): Promise<AuthState>;
  clearCredential?(): Promise<void>;

  fetchGame(ref: Ref): Promise<GameDTO>;
  /** one page of a listing or search */
  fetchList(opts: { url?: string; query?: string; page?: number }): Promise<GameDTO[]>;

  resolveFiles(game: GameRef): Promise<FileCandidate[]>;
  /** final URL + headers for the downloader (may resolve redirects / attachments) */
  prepareDownload(file: FileCandidate, game: GameRef): Promise<{ url: string; headers: Record<string, string> }>;
  checkUpdate(game: GameRef): Promise<UpdateInfo | null>;
  /** optional: bulk-import the account's own library */
  sync?(): Promise<GameDTO[]>;
}
