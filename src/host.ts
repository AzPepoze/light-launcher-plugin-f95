import type { HttpClient } from '@light-launcher/plugin-sdk/helpers';
import type { BrowserAssist } from './browser-assist';

/** One row of the forum's public thread sitemap. */
export interface SitemapRow {
  url: string;
  slug: string;
  title: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFn = (level: LogLevel, message: string, extra?: unknown) => void;

/** Per-source login cookie. The host stores the secret; the plugin reads and replaces it. */
export interface CredentialStore {
  get(): Promise<string | null>;
  /** null removes the cookie */
  set(value: string | null): Promise<void>;
}

/** A directory the plugin may write to for its own data (sitemap cache, profile overlay). */
export interface PluginStorage {
  dataDir: string;
}

/** Cached thread index used by "find a game by name" and the browse filters. */
export interface SitemapCache {
  count(source: string): number;
  syncedAt(source: string): string | null;
  /** rows in index order; empty when the source was never synced */
  rows(source: string): SitemapRow[];
  replace(source: string, rows: SitemapRow[]): void;
}

/** Everything a plugin receives from its host. The plugin never imports app modules. */
export interface HostServices {
  http: HttpClient;
  credential: CredentialStore;
  browser: BrowserAssist;
  /** save a raw page when a parse fails; a no-op when dumps are off */
  dump: (name: string, body: string) => void;
  log: LogFn;
  storage: PluginStorage;
  sitemapCache: SitemapCache;
}
