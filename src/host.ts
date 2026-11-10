import type { HttpClient } from './vendor/http';

/** One row of the forum's public thread sitemap. */
export interface SitemapRow {
  url: string;
  slug: string;
  title: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFn = (level: LogLevel, message: string, extra?: unknown) => void;

/** Per-source login cookie. The host owns the secret; the plugin only reads and replaces it. */
export interface CredentialStore {
  get(): Promise<string | null>;
  set(value: string | null): Promise<void>;
}

/** A directory the plugin may write to for its own data (browser profile, sitemap cache). */
export interface PluginStorage {
  dataDir: string;
}

/** Cached thread index used by "find a game by name". */
export interface SitemapCache {
  count(source: string): number;
  syncedAt(source: string): string | null;
  replace(source: string, rows: SitemapRow[]): void;
}

/** Everything a plugin receives from its host. The plugin never imports app modules. */
export interface HostServices {
  http: HttpClient;
  credential: CredentialStore;
  /** save a raw page when a parse fails; a no-op when dumps are off */
  dump: (name: string, body: string) => void;
  log: LogFn;
  storage: PluginStorage;
  sitemapCache: SitemapCache;
}
