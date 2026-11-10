import fs from 'node:fs';
import path from 'node:path';
import manifest from '../plugin.json';
import profileJson from '../profiles/f95zone.json';
import { fileSitemapCache, memoryHttpCache } from './cache';
import type { HostServices } from './host';
import { createLogger } from './log';
import { RPC_ERROR, RpcError, RpcServer, optionalNumber, optionalString, paramObject, requireObject, requireString, serveStdio } from './rpc';
import { captureF95Download, browserAssistAvailable, closeBrowserAssist } from './downloads/browser/assist';
import { createF95Provider } from './providers/f95';
import { parseProfile } from './providers/xenforo';
import { indexStatus, syncThreadIndex } from './library/f95-index';
import { HttpClient, DEFAULT_UA } from './vendor/http';
import type { GameRef, Provider, Ref } from './vendor/types';

const API_VERSION = '1';
const DEFAULT_RATE_LIMIT_MS = 1200;

interface Settings {
  dataDir: string;
  credential: string | null;
  userAgent: string;
  rateLimitMs: number;
  browserPath: string | null;
  dumpDir: string | null;
}

interface RunState {
  settings: Settings;
  services: HostServices;
  provider: Provider;
}

let state: RunState | null = null;

function readyState(): RunState {
  if (!state) throw new RpcError(RPC_ERROR.invalidRequest, 'send initialize first');
  return state;
}

function settingsFrom(params: Record<string, unknown>): Settings {
  const dataDir = requireString(params, 'dataDir');
  return {
    dataDir,
    credential: optionalString(params, 'credential') ?? null,
    userAgent: optionalString(params, 'userAgent') ?? DEFAULT_UA,
    rateLimitMs: optionalNumber(params, 'rateLimitMs') ?? DEFAULT_RATE_LIMIT_MS,
    browserPath: optionalString(params, 'browserPath') ?? null,
    dumpDir: optionalString(params, 'dumpDir') ?? null,
  };
}

function dumpInto(dir: string | null): HostServices['dump'] {
  return (name, body) => {
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name.replace(/[^\w.-]+/g, '_')}.html`), body);
  };
}

function buildServices(settings: Settings, log: HostServices['log'], credentialChanged: (value: string | null) => void): HostServices {
  let credential = settings.credential;
  return {
    http: new HttpClient({ rateLimitMs: settings.rateLimitMs, userAgent: settings.userAgent, cache: memoryHttpCache() }),
    credential: {
      get: async () => credential,
      set: async (value) => {
        credential = value;
        credentialChanged(value);
      },
    },
    dump: dumpInto(settings.dumpDir),
    log,
    storage: { dataDir: settings.dataDir },
    sitemapCache: fileSitemapCache(settings.dataDir),
  };
}

function registerMethods(server: RpcServer): void {
  server.handle('initialize', (raw) => {
    const params = paramObject(raw);
    if (requireString(params, 'apiVersion') !== API_VERSION) {
      throw new RpcError(RPC_ERROR.invalidParams, `this plugin speaks apiVersion ${API_VERSION}`);
    }
    const settings = settingsFrom(params);
    const log = createLogger(manifest.id);
    const services = buildServices(settings, log, (value) => server.notify('credential.changed', { source: 'f95', value }));
    const profile = parseProfile(profileJson, 'profiles/f95zone.json');
    const provider = createF95Provider(services, {
      profile,
      credential: settings.credential,
      userAgent: settings.userAgent,
    });
    state = { settings, services, provider };
    log('info', `ready (${manifest.name} ${manifest.version})`);
    return { pluginVersion: manifest.version, capabilities: provider.capabilities, source: { id: provider.id, label: provider.label } };
  });

  server.handle('source.authStatus', async () => readyState().provider.authStatus());
  server.handle('source.setCredential', async (raw) => {
    const { provider } = readyState();
    return provider.setCredential(requireString(paramObject(raw), 'value'));
  });
  server.handle('source.clearCredential', async () => {
    await readyState().provider.clearCredential?.();
    return null;
  });

  server.handle('source.parseRef', (raw) => readyState().provider.parseRef(requireString(paramObject(raw), 'url')));

  server.handle('source.search', async (raw) => {
    const params = paramObject(raw);
    return readyState().provider.fetchList({
      url: optionalString(params, 'url'),
      query: optionalString(params, 'query'),
      page: optionalNumber(params, 'page'),
    });
  });

  server.handle('source.fetchGame', async (raw) => {
    const ref = requireObject(paramObject(raw), 'ref') as unknown as Ref;
    return readyState().provider.fetchGame(ref);
  });

  server.handle('source.resolveFiles', async (raw) => {
    const game = requireObject(paramObject(raw), 'game') as unknown as GameRef;
    return readyState().provider.resolveFiles(game);
  });

  server.handle('source.prepareDownload', async (raw) => {
    const params = paramObject(raw);
    const file = requireObject(params, 'file') as unknown as Parameters<Provider['prepareDownload']>[0];
    const game = requireObject(params, 'game') as unknown as GameRef;
    return readyState().provider.prepareDownload(file, game);
  });

  server.handle('source.checkUpdate', async (raw) => {
    const game = requireObject(paramObject(raw), 'game') as unknown as GameRef;
    return readyState().provider.checkUpdate(game);
  });

  // The thread index is the forum's sitemap cache, not a list of owned games.
  server.handle('source.sync', async () => {
    const { services } = readyState();
    const result = await syncThreadIndex(services, 'f95', (message) => server.notify('progress', { message }));
    return { ...result, ...indexStatus(services) };
  });

  server.handle('browser.capture', (raw) => {
    const { services, settings } = readyState();
    const url = requireString(paramObject(raw), 'url');
    if (!browserAssistAvailable(settings.browserPath)) {
      throw new RpcError(RPC_ERROR.internal, 'browser assist needs Google Chrome, Microsoft Edge or Chromium installed');
    }
    return new Promise((resolve, reject) => {
      const stop = new AbortController();
      captureF95Download(services, url, {
        browserPath: settings.browserPath,
        userAgent: settings.userAgent,
        signal: stop.signal,
        onWaiting: (message) => server.notify('browser.waiting', { message }),
        onCandidate: (candidate) => {
          resolve(candidate);
          stop.abort();
        },
      }).catch(reject);
    });
  });

  server.handle('browser.close', async () => {
    await closeBrowserAssist();
    return null;
  });

  server.handle('shutdown', async () => {
    await closeBrowserAssist();
    return null;
  });
}

async function main(): Promise<void> {
  const server = new RpcServer((line) => process.stdout.write(line));
  registerMethods(server);
  await serveStdio(server);
}

if (import.meta.main) {
  await main();
}
