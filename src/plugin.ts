import fs from 'node:fs';
import path from 'node:path';
import type {
  PluginContext,
  PluginHandlers,
  PluginNotificationHandlers,
} from '@light-launcher/plugin-sdk/runtime';
import { ErrorCode, RpcFailure, type InitializeParams } from '@light-launcher/plugin-sdk/types';
import manifest from '../plugin.json';
import profileJson from '../profiles/f95zone.json';
import { BrowserEvents, createBrowserAssist, type BrowserAssist } from './browser-assist';
import { fileSitemapCache, memoryHttpCache } from './cache';
import { secretCredentialStore } from './credential';
import type { HostServices, LogFn } from './host';
import { createLogger } from './log';
import type { Provider } from './provider';
import { indexStatus, syncThreadIndex } from './library/f95-index';
import { createF95Provider } from './providers/f95';
import { loadProfile } from './providers/xenforo';
import { DEFAULT_UA, HttpClient } from './vendor/http';

const API_VERSION = '1';
const DEFAULT_RATE_LIMIT_MS = 1200;
const SETTINGS_TIMEOUT_MS = 5_000;
/** Selector fixes go here, in the plugin's data directory, so they need no rebuild. */
const PROFILE_OVERLAY_PATH = ['profiles', 'f95zone.local.json'] as const;

interface PluginSettings {
  userAgent: string;
  rateLimitMs: number;
  browserPath: string | null;
  dumpDir: string | null;
}

interface RunState {
  services: HostServices;
  provider: Provider;
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new RpcFailure(ErrorCode.InvalidParams, `missing string param: ${name}`);
  }
  return value;
}

function textSetting(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberSetting(raw: Record<string, unknown>, key: string): number | null {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function settingsFrom(raw: Record<string, unknown>): PluginSettings {
  return {
    userAgent: textSetting(raw, 'userAgent') ?? DEFAULT_UA,
    rateLimitMs: numberSetting(raw, 'rateLimitMs') ?? DEFAULT_RATE_LIMIT_MS,
    browserPath: textSetting(raw, 'browserPath'),
    dumpDir: textSetting(raw, 'dumpDir'),
  };
}

/** Host settings are optional: when the host cannot answer, the defaults apply. */
async function readSettings(ctx: PluginContext, log: LogFn): Promise<PluginSettings> {
  try {
    const { settings } = await ctx.host.call('settings.get', {}, { timeoutMs: SETTINGS_TIMEOUT_MS });
    return settingsFrom(settings);
  } catch (err) {
    log('warn', 'settings.get failed, using defaults', err instanceof Error ? err.message : err);
    return settingsFrom({});
  }
}

function dumpInto(dir: string | null): HostServices['dump'] {
  return (name, body) => {
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name.replace(/[^\w.-]+/g, '_')}.html`), body);
  };
}

interface ServicesInput {
  dataDir: string;
  settings: PluginSettings;
  log: LogFn;
  ctx: PluginContext;
  events: BrowserEvents;
  hostGrantedBrowser: boolean;
}

function buildServices(input: ServicesInput): HostServices {
  const { dataDir, settings, log, ctx } = input;
  const base = {
    http: new HttpClient({ rateLimitMs: settings.rateLimitMs, userAgent: settings.userAgent, cache: memoryHttpCache() }),
    credential: secretCredentialStore(ctx.host.secrets),
    dump: dumpInto(settings.dumpDir),
    log,
    storage: { dataDir },
    sitemapCache: fileSitemapCache(dataDir),
  };
  const browser: BrowserAssist = createBrowserAssist({
    hostGranted: input.hostGrantedBrowser,
    host: ctx.host,
    events: input.events,
    services: base,
    settings: { browserPath: settings.browserPath, userAgent: settings.userAgent },
  });
  return { ...base, browser };
}

async function startPlugin(params: InitializeParams, ctx: PluginContext, events: BrowserEvents): Promise<RunState> {
  if (params.apiVersion !== API_VERSION) {
    throw new RpcFailure(ErrorCode.InvalidParams, `this plugin speaks apiVersion ${API_VERSION}`);
  }
  const log = createLogger(manifest.id);
  const settings = await readSettings(ctx, log);
  const services = buildServices({
    dataDir: params.dataDir,
    settings,
    log,
    ctx,
    events,
    hostGrantedBrowser: params.grantedPermissions.browser,
  });
  const profile = loadProfile(profileJson, path.join(params.dataDir, ...PROFILE_OVERLAY_PATH));
  const provider = createF95Provider(services, { profile, userAgent: settings.userAgent });
  log('info', `ready (${manifest.name} ${manifest.version})`);
  return { services, provider };
}

/** The handlers and notification listeners for servePlugin. State lives in this closure. */
export function createPlugin(): { handlers: PluginHandlers; notifications: PluginNotificationHandlers } {
  let state: RunState | null = null;
  const events = new BrowserEvents();

  function ready(): RunState {
    if (!state) throw new RpcFailure(ErrorCode.InvalidRequest, 'send initialize first');
    return state;
  }

  const handlers: PluginHandlers = {
    initialize: async (params, ctx) => {
      const started = await startPlugin(params, ctx, events);
      state = started;
      return {
        pluginVersion: manifest.version,
        capabilities: { [started.provider.id]: started.provider.capabilities },
      };
    },
    shutdown: async () => {
      await state?.services.browser.close();
      return null;
    },

    'source.authStatus': () => ready().provider.authStatus(),
    'source.setCredential': (params) => ready().provider.setCredential(requireText(params.value, 'value')),
    'source.clearCredential': () => ready().provider.clearCredential(),
    'source.parseRef': (params) => ready().provider.parseRef(requireText(params.url, 'url')),

    'source.search': async (params) => ({
      games: await ready().provider.fetchList({ url: params.url, query: params.query, page: params.page }),
    }),
    'source.fetchGame': async (params) => ({ game: await ready().provider.fetchGame(params.ref) }),
    'source.resolveFiles': async (params) => ({ files: await ready().provider.resolveFiles(params.game) }),
    'source.prepareDownload': (params, ctx) =>
      ready().provider.prepareDownload(params.file, params.game, { signal: ctx.signal, progress: ctx.progress }),
    'source.checkUpdate': async (params) => ({ update: await ready().provider.checkUpdate(params.game) }),

    'source.sync': async (_params, ctx) => {
      const { services } = ready();
      await syncThreadIndex(services, 'f95', (message) => ctx.progress({ message }));
      return indexStatus(services);
    },
  };

  const notifications: PluginNotificationHandlers = {
    'browser.waiting': (params) => events.waiting(params.message),
    'browser.progress': (params) => events.progress(params.percent, params.message),
  };

  return { handlers, notifications };
}
