import path from 'node:path';
import {
  createLogger,
  sourceHandlers,
  type PluginContext,
  type PluginHandlers,
  type PluginNotificationHandlers,
  type SourceProvider,
} from '@light-launcher/plugin-sdk/runtime';
import {
  HttpClient,
  hostTransport,
  readSettings,
  spacedTransport,
  writeDump,
} from '@light-launcher/plugin-sdk/helpers';
import { ErrorCode, RpcFailure, type InitializeParams } from '@light-launcher/plugin-sdk/types';
import manifest from '../plugin.json';
import profileJson from '../profiles/f95zone.json';
import { BrowserEvents, createBrowserAssist, type BrowserAssist } from './browser-assist';
import { fileSitemapCache } from './cache';
import { secretCredentialStore } from './credential';
import type { HostServices, LogFn, LogLevel } from './host';
import { createF95Provider } from './providers/f95';
import { loadProfile } from './providers/xenforo';
import { settingsFrom, type PluginSettings } from './settings';
import { loggedTransport } from './transport';

const API_VERSION = '1';
/** Largest response the plugin accepts. The sitemap call raises its own limit. */
const MAX_BODY_BYTES = 12 * 1024 * 1024;
/** Selector fixes go here, in the plugin's data directory, so they need no rebuild. */
const PROFILE_OVERLAY_PATH = ['profiles', 'f95zone.local.json'] as const;
const SETTINGS_DEFAULTS = settingsFrom({});
const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

interface RunState {
  services: HostServices;
  provider: SourceProvider;
}

function logLevelFor(settings: PluginSettings): LogLevel {
  return settings.verboseLogging ? 'debug' : 'info';
}

function loadSettings(ctx: PluginContext): Promise<PluginSettings> {
  return readSettings(ctx.host, settingsFrom, SETTINGS_DEFAULTS);
}

function formatExtra(extra: unknown): string {
  if (extra === undefined) return '';
  if (extra instanceof Error) return ` ${extra.message}`;
  if (typeof extra === 'string') return ` ${extra}`;
  return ` ${JSON.stringify(extra)}`;
}

/** The SDK logger writes every level, so verbose logging decides whether debug lines pass. */
function createLog(settings: PluginSettings): LogFn {
  const logger = createLogger(manifest.id);
  const minRank = LEVEL_RANK[logLevelFor(settings)];
  return (level, message, extra) => {
    if (LEVEL_RANK[level] < minRank) return;
    logger[level](`${message}${formatExtra(extra)}`);
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
  const transport = spacedTransport(loggedTransport(hostTransport(ctx.host), log), {
    minDelayMs: settings.requestDelayMs,
  });
  const base: Omit<HostServices, 'browser'> = {
    http: new HttpClient(transport, {
      defaultHeaders: { 'User-Agent': settings.userAgent },
      maxBodyBytes: MAX_BODY_BYTES,
    }),
    secrets: ctx.host.secrets,
    storage: ctx.host.storage,
    settings: () => loadSettings(ctx),
    credential: secretCredentialStore(ctx.host.secrets),
    dump: (name, body) => writeDump(settings.dumpDir ?? '', name, body),
    log,
    sitemapCache: fileSitemapCache(dataDir),
  };
  const browser: BrowserAssist = createBrowserAssist({
    hostGranted: input.hostGrantedBrowser,
    host: ctx.host,
    events: input.events,
    getEnabled: async () => (await loadSettings(ctx)).browserAssistEnabled,
  });
  return { ...base, browser };
}

async function startPlugin(params: InitializeParams, ctx: PluginContext, events: BrowserEvents): Promise<RunState> {
  if (params.apiVersion !== API_VERSION) {
    throw new RpcFailure(ErrorCode.InvalidParams, `this plugin speaks apiVersion ${API_VERSION}`);
  }
  // settings are read first, so the logger that the rest of the run uses can honour them
  const settings = await loadSettings(ctx);
  const log = createLog(settings);
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
    getSettings: () => loadSettings(ctx),
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
