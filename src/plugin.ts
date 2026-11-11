import fs from 'node:fs';
import path from 'node:path';
import {
  sourceHandlers,
  type PluginContext,
  type PluginHandlers,
  type PluginNotificationHandlers,
  type SourceProvider,
} from '@light-launcher/plugin-sdk/runtime';
import { HttpClient, hostTransport } from '@light-launcher/plugin-sdk/helpers';
import { ErrorCode, RpcFailure, type InitializeParams } from '@light-launcher/plugin-sdk/types';
import manifest from '../plugin.json';
import profileJson from '../profiles/f95zone.json';
import { BrowserEvents, createBrowserAssist, type BrowserAssist } from './browser-assist';
import { fileSitemapCache } from './cache';
import { secretCredentialStore } from './credential';
import type { HostServices, LogFn, LogLevel } from './host';
import { createLogger } from './log';
import { createF95Provider } from './providers/f95';
import { loadProfile } from './providers/xenforo';
import { settingsFrom, type PluginSettings } from './settings';
import { loggedTransport, spacedTransport } from './transport';

const API_VERSION = '1';
const SETTINGS_TIMEOUT_MS = 5_000;
/** Largest response the plugin accepts. The sitemap call raises its own limit. */
const MAX_BODY_BYTES = 12 * 1024 * 1024;
/** Selector fixes go here, in the plugin's data directory, so they need no rebuild. */
const PROFILE_OVERLAY_PATH = ['profiles', 'f95zone.local.json'] as const;

interface RunState {
  services: HostServices;
  provider: SourceProvider;
}

function logLevelFor(settings: PluginSettings): LogLevel {
  return settings.verboseLogging ? 'debug' : 'info';
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
    http: new HttpClient(spacedTransport(loggedTransport(hostTransport(ctx.host), log), settings.requestDelayMs), {
      defaultHeaders: { 'User-Agent': settings.userAgent },
      maxBodyBytes: MAX_BODY_BYTES,
    }),
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
  // settings are read first, so the logger that the rest of the run uses can honour them
  const settings = await readSettings(ctx, createLogger(manifest.id));
  const log = createLogger(manifest.id, { minLevel: logLevelFor(settings) });
  const services = buildServices({
    dataDir: params.dataDir,
    settings,
    log,
    ctx,
    events,
    hostGrantedBrowser: params.grantedPermissions.browser,
  });
  const profile = loadProfile(profileJson, path.join(params.dataDir, ...PROFILE_OVERLAY_PATH));
  const provider = createF95Provider(services, {
    profile,
    userAgent: settings.userAgent,
    filePreferences: settings.filePreferences,
    updateCheckIntervalMs: settings.updateCheckIntervalMs,
  });
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
    ...sourceHandlers(() => ready().provider, 'f95'),
  };

  const notifications: PluginNotificationHandlers = {
    'browser.waiting': (params) => events.waiting(params.token, params.message),
    'browser.progress': (params) => events.progress(params.token, params.percent, params.message),
  };

  return { handlers, notifications };
}
