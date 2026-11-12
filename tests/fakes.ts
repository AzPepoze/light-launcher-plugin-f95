import os from 'node:os';
import path from 'node:path';
import { HttpClient, type HttpTransport } from '@light-launcher/plugin-sdk/helpers';
import type { HttpRequestParams, HttpRequestResult } from '@light-launcher/plugin-sdk/types';
import type { BrowserAssist, BrowserCapture } from '../src/browser-assist';
import type { HostServices, SitemapRow } from '../src/host';

export type Responder = (url: string, params: HttpRequestParams) => Partial<HttpRequestResult>;

export interface FakeHttpCall {
  url: string;
  options: HttpRequestParams;
}

export interface FakeServicesOptions {
  /** answers each GET; the default is an empty 200 response */
  respond?: Responder;
  credential?: string | null;
  /** answers each browser capture; the default captures nothing */
  capture?: (url: string) => BrowserCapture | Promise<BrowserCapture>;
  /** seeds the thread index used by browse and listFilters */
  sitemap?: SitemapRow[];
}

export interface FakeServices {
  services: HostServices;
  calls: FakeHttpCall[];
  logs: string[];
  /** the URLs sent to browser assist */
  browserCalls: string[];
  /** the credential the plugin last stored, or the initial one */
  credential: () => string | null;
}

/** In-memory HostServices: no network, no disk, no database. */
export function fakeServices(options: FakeServicesOptions = {}): FakeServices {
  const calls: FakeHttpCall[] = [];
  const logs: string[] = [];
  const sitemap = new Map<string, { syncedAt: string; rows: SitemapRow[] }>();
  if (options.sitemap) sitemap.set('f95', { syncedAt: new Date().toISOString(), rows: options.sitemap });
  let credential = options.credential ?? null;

  const transport: HttpTransport = {
    request: async (params) => {
      calls.push({ url: params.url, options: params });
      return {
        status: 200,
        url: params.url,
        text: '',
        headers: {},
        notModified: false,
        ...(options.respond?.(params.url, params) ?? {}),
      };
    },
  };

  const browserCalls: string[] = [];
  const browser: BrowserAssist = {
    capture: async (url) => {
      browserCalls.push(url);
      return options.capture?.(url) ?? { capturedUrl: null };
    },
    close: async () => {},
  };

  const services: HostServices = {
    browser,
    http: new HttpClient(transport),
    credential: {
      get: async () => credential,
      set: async (value) => {
        credential = value;
      },
    },
    dump: () => {},
    log: (level, message) => {
      logs.push(`${level} ${message}`);
    },
    storage: { dataDir: path.join(os.tmpdir(), 'f95-plugin-tests') },
    sitemapCache: {
      count: (source) => sitemap.get(source)?.rows.length ?? 0,
      syncedAt: (source) => sitemap.get(source)?.syncedAt ?? null,
      rows: (source) => sitemap.get(source)?.rows ?? [],
      replace: (source, rows) => {
        sitemap.set(source, { syncedAt: new Date().toISOString(), rows });
      },
    },
  };

  return { services, calls, logs, browserCalls, credential: () => credential };
}
