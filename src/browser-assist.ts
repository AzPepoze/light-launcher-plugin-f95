import { randomUUID } from 'node:crypto';
import type { HostClient } from '@light-launcher/plugin-sdk/runtime';
import { browserAssistAvailable, captureF95Download, closeBrowserAssist } from './downloads/browser/assist';
import type { CaptureServices } from './host';

export interface BrowserCapture {
  capturedUrl: string | null;
  filename?: string | null;
  size?: number | null;
  /** headers the download needs, such as Cookie */
  headers?: Record<string, string>;
}

export interface BrowserCaptureOptions {
  signal?: AbortSignal;
  /** short text shown above the embedded page, when the host supports it */
  message?: string;
  onWaiting?: (message: string) => void;
  onProgress?: (percent: number, message?: string) => void;
}

/** Opens a browser at a page and captures the download link it produces. */
export interface BrowserAssist {
  capture(url: string, options?: BrowserCaptureOptions): Promise<BrowserCapture>;
  close(): Promise<void>;
}

export interface LocalBrowserSettings {
  /** explicit browser executable; null uses the usual install locations */
  browserPath: string | null;
  userAgent: string;
  /** also accepted here, so a caller can pass the whole browser settings object */
  useExternalChrome?: boolean;
}

/** The settings that choose between the embedded host browser and the old local Chrome route. */
export interface BrowserRouteSettings {
  browserAssistEnabled: boolean;
  useExternalChrome: boolean;
}

const HOST_TIMEOUT_MS = 600_000;
const DISABLED_MESSAGE = 'browser assist is turned off in the plugin settings';
const NO_PERMISSION_MESSAGE = 'browser assist needs the browser permission from the launcher';

type BrowserListener = Pick<BrowserCaptureOptions, 'onWaiting' | 'onProgress'>;

/** Routes the host's browser.waiting and browser.progress to the capture that sent the token. */
export class BrowserEvents {
  private readonly listeners = new Map<string, BrowserListener>();

  subscribe(token: string, listener: BrowserListener): () => void {
    this.listeners.set(token, listener);
    return () => {
      this.listeners.delete(token);
    };
  }

  waiting(token: string, message: string): void {
    this.listeners.get(token)?.onWaiting?.(message);
  }

  progress(token: string, percent: number, message?: string): void {
    this.listeners.get(token)?.onProgress?.(percent, message);
  }
}

/** Uses the host's embedded browser through browser.assist. The user does the page step. */
class HostBrowserAssist implements BrowserAssist {
  constructor(
    private readonly host: HostClient,
    private readonly events: BrowserEvents,
  ) {}

  async capture(url: string, options: BrowserCaptureOptions = {}): Promise<BrowserCapture> {
    const token = randomUUID();
    const unsubscribe = this.events.subscribe(token, options);
    try {
      const params = { url, timeoutMs: HOST_TIMEOUT_MS, token, message: options.message };
      const result = await this.host.browser.assist(params, { signal: options.signal });
      return {
        capturedUrl: result.capturedUrl,
        filename: result.filename,
        size: result.size,
        headers: result.headers,
      };
    } finally {
      unsubscribe();
    }
  }

  async close(): Promise<void> {}
}

/** Drives Chrome, Edge or Chromium over CDP. Used by the old route. */
class LocalBrowserAssist implements BrowserAssist {
  constructor(
    private readonly services: CaptureServices,
    private readonly settings: LocalBrowserSettings,
  ) {}

  capture(url: string, options: BrowserCaptureOptions = {}): Promise<BrowserCapture> {
    if (!browserAssistAvailable(this.settings.browserPath)) {
      return Promise.reject(new Error('browser assist needs Google Chrome, Microsoft Edge or Chromium installed'));
    }
    return new Promise((resolve, reject) => {
      const stop = new AbortController();
      const cancel = () => stop.abort();
      options.signal?.addEventListener('abort', cancel, { once: true });
      captureF95Download(this.services, url, {
        browserPath: this.settings.browserPath,
        userAgent: this.settings.userAgent,
        signal: stop.signal,
        onWaiting: options.onWaiting,
        onCandidate: (candidate) => {
          resolve({ capturedUrl: candidate.url, filename: candidate.filename, headers: candidate.headers });
          stop.abort();
        },
      })
        .catch(reject)
        .finally(() => options.signal?.removeEventListener('abort', cancel));
    });
  }

  close(): Promise<void> {
    return closeBrowserAssist();
  }
}

/** Refuses every capture. Used when the user turns browser assist off in the settings. */
class DisabledBrowserAssist implements BrowserAssist {
  constructor(private readonly message = DISABLED_MESSAGE) {}

  capture(): Promise<BrowserCapture> {
    return Promise.reject(new Error(this.message));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** Reads the route settings on each capture, so a change applies without a restart. */
class SwitchBrowserAssist implements BrowserAssist {
  constructor(
    private readonly host: BrowserAssist | null,
    private readonly local: BrowserAssist,
    private readonly getRoute: () => Promise<BrowserRouteSettings>,
  ) {}

  async capture(url: string, options?: BrowserCaptureOptions): Promise<BrowserCapture> {
    const route = await this.getRoute();
    if (!route.browserAssistEnabled) throw new Error(DISABLED_MESSAGE);
    if (route.useExternalChrome) return this.local.capture(url, options);
    if (!this.host) throw new Error(NO_PERMISSION_MESSAGE);
    return this.host.capture(url, options);
  }

  close(): Promise<void> {
    return this.local.close();
  }
}

export interface BrowserAssistInput {
  /** grantedPermissions.browser from initialize */
  hostGranted: boolean;
  host: HostClient;
  events: BrowserEvents;
  services: CaptureServices;
  settings: LocalBrowserSettings;
  /** false refuses every capture; defaults to true */
  enabled?: boolean;
  /** true uses the plugin's own Chrome over CDP instead of the host's embedded browser */
  useExternalChrome?: boolean;
  /** when set, the route is read again for every capture */
  getRoute?: () => Promise<BrowserRouteSettings>;
}

/**
 * The embedded host browser is the default. The plugin's own Chrome route is used only
 * when useExternalChrome is on.
 */
export function createBrowserAssist(input: BrowserAssistInput): BrowserAssist {
  const local = new LocalBrowserAssist(input.services, input.settings);
  const host = input.hostGranted ? new HostBrowserAssist(input.host, input.events) : null;
  if (input.getRoute) {
    return new SwitchBrowserAssist(host, local, input.getRoute);
  }
  if (input.enabled === false) return new DisabledBrowserAssist();
  if (input.useExternalChrome ?? input.settings.useExternalChrome) return local;
  if (!host) return new DisabledBrowserAssist(NO_PERMISSION_MESSAGE);
  return host;
}
