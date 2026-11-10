import os from 'node:os';
import path from 'node:path';
import type { BrowserAssist, BrowserCapture } from '../src/browser-assist';
import type { HostServices, SitemapRow } from '../src/host';
import type { HttpResult, RequestOptions } from '../src/vendor/http';

export type Responder = (url: string, options: RequestOptions) => Partial<HttpResult>;

export interface FakeHttpCall {
  url: string;
  options: RequestOptions;
}

export interface FakeServicesOptions {
  /** answers each GET; the default is an empty 200 response */
  respond?: Responder;
  credential?: string | null;
  /** answers each browser capture; the default captures nothing */
  capture?: (url: string) => BrowserCapture;
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
  let credential = options.credential ?? null;

  const http = {
    get: async (url: string, requestOptions: RequestOptions = {}): Promise<HttpResult> => {
      calls.push({ url, options: requestOptions });
      return {
        status: 200,
        url,
        text: '',
        headers: new Headers(),
        notModified: false,
        ...(options.respond?.(url, requestOptions) ?? {}),
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
    http: http as unknown as HostServices['http'],
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
      replace: (source, rows) => {
        sitemap.set(source, { syncedAt: new Date().toISOString(), rows });
      },
    },
  };

  return { services, calls, logs, browserCalls, credential: () => credential };
}
