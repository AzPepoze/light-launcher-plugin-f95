import { randomUUID } from 'node:crypto';
import type { HostClient } from '@light-launcher/plugin-sdk/runtime';
import { ErrorCode, RpcFailure } from '@light-launcher/plugin-sdk/types';
import { browserAssistAvailable, captureF95Download, closeBrowserAssist } from './downloads/browser/assist';
import type { CaptureServices, LogFn } from './host';

export interface BrowserCapture {
  capturedUrl: string | null;
  filename?: string | null;
  size?: number | null;
  /** headers the download needs, such as Cookie */
  headers?: Record<string, string>;
}

export interface BrowserCaptureOptions {
  signal?: AbortSignal;
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
}

const HOST_TIMEOUT_MS = 600_000;

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

/** Uses the host's browser.assist. The host opens the browser and returns the link. */
class HostBrowserAssist implements BrowserAssist {
  constructor(
    private readonly host: HostClient,
    private readonly events: BrowserEvents,
  ) {}

  async capture(url: string, options: BrowserCaptureOptions = {}): Promise<BrowserCapture> {
    const token = randomUUID();
    const unsubscribe = this.events.subscribe(token, options);
    try {
      const result = await this.host.browser.assist(
        { url, timeoutMs: HOST_TIMEOUT_MS, token },
        { signal: options.signal },
      );
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

/** Drives Chrome, Edge or Chromium over CDP. Used when the host does not provide browser.assist. */
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

function isMethodNotFound(err: unknown): boolean {
  return err instanceof RpcFailure && err.code === ErrorCode.MethodNotFound;
}

/**
 * Prefers the host's browser.assist. If the host answers "method not found", the plugin
 * switches to the local browser for the rest of the run.
 */
class PreferredBrowserAssist implements BrowserAssist {
  private hostLacksAssist = false;

  constructor(
    private readonly host: BrowserAssist,
    private readonly local: BrowserAssist,
    private readonly log: LogFn,
  ) {}

  async capture(url: string, options?: BrowserCaptureOptions): Promise<BrowserCapture> {
    if (!this.hostLacksAssist) {
      try {
        return await this.host.capture(url, options);
      } catch (err) {
        if (!isMethodNotFound(err)) throw err;
        this.hostLacksAssist = true;
        this.log('warn', 'the host has no browser.assist, using the local browser');
      }
    }
    return this.local.capture(url, options);
  }

  close(): Promise<void> {
    return this.local.close();
  }
}

/** Refuses every capture. Used when the user turns browser assist off in the settings. */
class DisabledBrowserAssist implements BrowserAssist {
  capture(): Promise<BrowserCapture> {
    return Promise.reject(new Error('browser assist is turned off in the plugin settings'));
  }

  close(): Promise<void> {
    return Promise.resolve();
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
}

/** Host browser.assist when the host granted the browser permission, otherwise the local browser. */
export function createBrowserAssist(input: BrowserAssistInput): BrowserAssist {
  if (input.enabled === false) return new DisabledBrowserAssist();
  const local = new LocalBrowserAssist(input.services, input.settings);
  if (!input.hostGranted) return local;
  return new PreferredBrowserAssist(new HostBrowserAssist(input.host, input.events), local, input.services.log);
}
