import type { HttpClient } from '@light-launcher/plugin-sdk/helpers';
import type { HostServices as SdkHostServices } from '@light-launcher/plugin-sdk/runtime';
import type { BrowserAssist } from './browser-assist';
import type { PluginSettings } from './settings';

/** One row of the forum's public thread sitemap. */
export interface SitemapRow {
  url: string;
  slug: string;
  title: string;
}

export type { LogLevel } from '@light-launcher/plugin-sdk/runtime';

/** Per-source login cookie. The host stores the secret; the plugin reads and replaces it. */
export interface CredentialStore {
  get(): Promise<string | null>;
  /** null removes the cookie */
  set(value: string | null): Promise<void>;
}

/** Cached thread index used by "find a game by name" and the browse filters. */
export interface SitemapCache {
  count(source: string): number;
  syncedAt(source: string): string | null;
  /** rows in index order; empty when the source was never synced */
  rows(source: string): SitemapRow[];
  replace(source: string, rows: SitemapRow[]): void;
}

/** Everything a plugin receives from its host, plus the services only this plugin uses. */
export interface HostServices extends Omit<SdkHostServices<PluginSettings>, 'http'> {
  http: HttpClient;
  credential: CredentialStore;
  browser: BrowserAssist;
  sitemapCache: SitemapCache;
}

export type LogFn = HostServices['log'];
