import { randomUUID } from 'node:crypto';
import type { HostClient } from '@light-launcher/plugin-sdk/runtime';

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
      const params = { url, timeoutMs: HOST_TIMEOUT_MS, token };
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

/** Reads the on/off setting on each capture, so a change applies without a restart. */
class SwitchBrowserAssist implements BrowserAssist {
  constructor(
    private readonly host: BrowserAssist,
    private readonly getEnabled: () => Promise<boolean>,
  ) {}

  async capture(url: string, options?: BrowserCaptureOptions): Promise<BrowserCapture> {
    if (!(await this.getEnabled())) throw new Error(DISABLED_MESSAGE);
    return this.host.capture(url, options);
  }

  close(): Promise<void> {
    return this.host.close();
  }
}

export interface BrowserAssistInput {
  /** grantedPermissions.browser from initialize */
  hostGranted: boolean;
  host: HostClient;
  events: BrowserEvents;
  /** when set, the on/off setting is read again for every capture */
  getEnabled?: () => Promise<boolean>;
}

/** The launcher's embedded browser is the only route; a missing permission refuses every capture. */
export function createBrowserAssist(input: BrowserAssistInput): BrowserAssist {
  if (!input.hostGranted) return new DisabledBrowserAssist(NO_PERMISSION_MESSAGE);
  const host = new HostBrowserAssist(input.host, input.events);
  if (input.getEnabled) return new SwitchBrowserAssist(host, input.getEnabled);
  return host;
}
