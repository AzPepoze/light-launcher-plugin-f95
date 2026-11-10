import fs from 'node:fs';
import path from 'node:path';
import type { CaptureServices } from '../../host';
import { DEFAULT_UA } from '../../vendor/http';
import { filenameFromDisposition } from '../hosts';
import { CdpClient } from './cdp';
import { watchTabs } from './tabs';
import { findBrowser } from './find';
import {
  FILE_HOSTS,
  hostMatches,
  hostOf,
  isInternalF95,
  isMegaFile,
  isResolverHost,
  isStorageHost,
  looksLikeFile,
  shouldWaitForHostPage,
} from './urls';

interface BrowserSession {
  proc: ReturnType<typeof Bun.spawn>;
  cdp: CdpClient;
  idle: ReturnType<typeof setTimeout> | null;
  services: CaptureServices;
}

let session: BrowserSession | null = null;
let queue: Promise<unknown> = Promise.resolve();
/** bumped by closeBrowserAssist so queued/in-flight launches can bail out */
let closeEpoch = 0;

const WAITING_MESSAGE = 'Press Download File in the browser window — the launcher will catch the link.';

const BINARY_TYPES = new Set([
  'application/octet-stream',
  'application/zip',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-7z-compressed',
]);

const DOWNLOAD_LINK_SCRIPT = String.raw`
(() => {
  if (window.__imDownloadLinkBound) return;
  window.__imDownloadLinkBound = true;
  document.addEventListener('click', (event) => {
    const target = event.target;
    const anchor = target && target.closest ? target.closest('a[href]') : null;
    if (!anchor) return;
    const href = anchor.href || '';
    if (!/^https?:/i.test(href)) return;
    const isFile = /\.(zip|rar|7z|tar|gz|tgz|xz|bz2|zst|iso|exe|msi|dmg|appimage|apk)(\?|#|$)/i.test(href);
    if (!isFile && !anchor.hasAttribute('download')) return;
    if (typeof window.imDownloadLink !== 'function') return;
    window.imDownloadLink(href);
    event.preventDefault();
  }, true);
})();
`;

export interface CapturedLink {
  url: string;
  filename?: string | null;
  /** browser cookies for this exact URL, sent as a Cookie header */
  headers?: Record<string, string>;
}

export interface CaptureOptions {
  /** explicit browser executable; null uses the usual install locations */
  browserPath?: string | null;
  userAgent?: string;
  signal?: AbortSignal;
  onWaiting?: (message: string) => void;
  /** called for every distinct download link the page produces */
  onCandidate?: (candidate: CapturedLink) => void;
}

/** CDP reports a frame's URL without its `#fragment`; MEGA keeps its file key there. */
interface FrameInfo {
  url: string;
  urlFragment?: string;
}

function withFragment(frame: FrameInfo): string {
  return `${frame.url}${frame.urlFragment ?? ''}`;
}

const WAIT_TIMEOUT_MS = 300_000;
const PICK_TIMEOUT_MS = 600_000;

function headerValue(headers: Record<string, unknown> | undefined, name: string): string {
  if (!headers) return '';
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue;
    return typeof value === 'string' ? value : String(value);
  }
  return '';
}

function cookieHeaderFrom(cookies: { name: string; value: string }[] | undefined): string {
  return (cookies ?? []).map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

function parseCookies(header: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const part of header.split(';')) {
    const item = part.trim();
    if (!item) continue;
    const index = item.indexOf('=');
    if (index <= 0) continue;
    out.push({ name: item.slice(0, index).trim(), value: item.slice(index + 1).trim() });
  }
  return out;
}

async function waitForPort(file: string, proc: ReturnType<typeof Bun.spawn>): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (proc.exitCode !== null) throw new Error('the browser exited before its debug port was ready');
    try {
      const raw = fs.readFileSync(file, 'utf8').split('\n')[0]?.trim();
      const port = Number(raw);
      if (Number.isFinite(port) && port > 0) return port;
    } catch {
      /* not written yet */
    }
    await Bun.sleep(100);
  }
  throw new Error('timed out waiting for the browser debug port');
}

/** Only kill a PID that still looks like our browser with this profile. */
function pidLooksLikeBrowser(pid: number, profile: string): boolean {
  try {
    if (process.platform === 'linux') {
      return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(`--user-data-dir=${profile}`);
    }
    if (process.platform === 'darwin') {
      const out = Bun.spawnSync(['ps', '-p', String(pid), '-o', 'command=']);
      return out.stdout.toString().includes(profile);
    }
    if (process.platform === 'win32') {
      const out = Bun.spawnSync(['tasklist', '/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
      return /chrome\.exe|msedge\.exe|chromium\.exe|brave\.exe/i.test(out.stdout.toString());
    }
  } catch {
    /* fall through */
  }
  return false;
}

function stopStaleBrowser(services: CaptureServices, dataDir: string, profile: string): void {
  const pidFile = path.join(dataDir, 'browser.pid');
  try {
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (Number.isFinite(pid) && pid > 0 && pid !== process.pid && pidLooksLikeBrowser(pid, profile)) {
      try {
        process.kill(pid, 0);
        process.kill(pid);
        services.log('info', 'closed a browser window left by a previous session');
      } catch {
        /* already gone */
      }
    }
    fs.rmSync(pidFile, { force: true });
  } catch {
    /* no pid file */
  }
}

async function launch(services: CaptureServices, browserPath: string | null | undefined): Promise<BrowserSession> {
  const executable = findBrowser(browserPath);
  if (!executable) {
    throw new Error('browser assist needs Google Chrome, Microsoft Edge or Chromium installed');
  }
  const dataDir = services.storage.dataDir;
  const profile = path.join(dataDir, 'browser-profile');
  fs.mkdirSync(profile, { recursive: true });
  stopStaleBrowser(services, dataDir, profile);
  const portFile = path.join(profile, 'DevToolsActivePort');
  try {
    fs.rmSync(portFile, { force: true });
  } catch {
    /* ignore */
  }

  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1100,800',
    'about:blank',
  ];
  if (process.platform === 'linux' && process.getuid?.() === 0) args.unshift('--no-sandbox');

  const proc = Bun.spawn([executable, ...args], { stdout: 'ignore', stderr: 'ignore' });
  try {
    fs.writeFileSync(path.join(dataDir, 'browser.pid'), String(proc.pid));
  } catch {
    /* best effort */
  }
  try {
    const port = await waitForPort(portFile, proc);
    // the browser-level socket sees every tab, including ones the site opens later
    const version = (await fetch(`http://127.0.0.1:${port}/json/version`).then((res) => res.json())) as {
      webSocketDebuggerUrl?: string;
    };
    if (!version.webSocketDebuggerUrl) throw new Error('the browser did not expose a debug socket');
    const cdp = await CdpClient.connect(version.webSocketDebuggerUrl);
    services.log('info', 'browser assist window ready');
    return { proc, cdp, idle: null, services };
  } catch (err) {
    try {
      proc.kill();
      fs.rmSync(path.join(dataDir, 'browser.pid'), { force: true });
    } catch {
      /* already gone */
    }
    throw err;
  }
}

function scheduleIdle(sessionToClose: BrowserSession) {
  if (sessionToClose.idle) clearTimeout(sessionToClose.idle);
  sessionToClose.idle = setTimeout(() => {
    if (session === sessionToClose) void closeBrowserAssist();
  }, 90_000);
  sessionToClose.idle.unref?.();
}

async function disposeSession(current: BrowserSession | null): Promise<void> {
  if (!current) return;
  if (current.idle) clearTimeout(current.idle);
  current.cdp.close();
  try {
    current.proc.kill();
  } catch {
    /* already gone */
  }
  await current.proc.exited.catch(() => -1);
  const dataDir = current.services.storage.dataDir;
  try {
    fs.rmSync(path.join(dataDir, 'browser.pid'), { force: true });
  } catch {
    /* ignore */
  }
  // the profile holds the injected forum session; never leave it on disk
  try {
    fs.rmSync(path.join(dataDir, 'browser-profile'), { recursive: true, force: true });
  } catch {
    /* Chrome may still hold a lock on a slow filesystem */
  }
  current.services.log('info', 'browser assist window closed');
}

async function getSession(services: CaptureServices, epoch: number, browserPath: string | null | undefined): Promise<BrowserSession> {
  if (session?.cdp.isOpen) {
    scheduleIdle(session);
    return session;
  }
  if (session) {
    const stale = session;
    session = null;
    await disposeSession(stale);
  }
  if (epoch !== closeEpoch) throw new Error('canceled');
  const launched = await launch(services, browserPath);
  if (epoch !== closeEpoch) {
    await disposeSession(launched);
    throw new Error('canceled');
  }
  session = launched;
  scheduleIdle(session);
  return session;
}

export async function closeBrowserAssist(): Promise<void> {
  closeEpoch++;
  const current = session;
  session = null;
  await disposeSession(current);
}

async function capture(
  services: CaptureServices,
  sourceUrl: string,
  epoch: number,
  options: CaptureOptions,
): Promise<void> {
  const { signal } = options;
  const cookie = await services.credential.get();
  if (!cookie) throw new Error('F95 is not connected — save the session cookie first');
  const userAgent = options.userAgent ?? DEFAULT_UA;
  const current = await getSession(services, epoch, options.browserPath);
  if (current.idle) {
    clearTimeout(current.idle);
    current.idle = null;
  }
  const { cdp } = current;
  /** injected-script id per attached tab, so cleanup can remove it */
  const tabs = new Map<string, string | undefined>();

  // every tab (including ones the site opens) gets the same listeners and script
  const preparePage = async (sessionId: string) => {
    const to = { sessionId };
    await cdp.send('Network.enable', {}, to);
    await cdp.send('Page.enable', {}, to);
    await cdp
      .send('Network.setUserAgentOverride', { userAgent, acceptLanguage: 'en-US,en;q=0.9' }, to)
      .catch(() => {});
    await cdp.send('Emulation.setUserAgentOverride', { userAgent, acceptLanguage: 'en-US,en;q=0.9' }, to).catch(() => {});
    await cdp.send('Page.setDownloadBehavior', { behavior: 'deny' }, to).catch(() => {});
    await cdp.send('Runtime.enable', {}, to).catch(() => {});
    await cdp.send('Runtime.addBinding', { name: 'imDownloadLink' }, to).catch(() => {});
    const injected = await cdp
      .send<{ identifier?: string }>('Page.addScriptToEvaluateOnNewDocument', { source: DOWNLOAD_LINK_SCRIPT }, to)
      .catch(() => null);
    tabs.set(sessionId, injected?.identifier);
  };

  // the stored secret may be a full "Cookie: a=b; c=d" header pasted from devtools
  const normalized = cookie
    .trim()
    .replace(/^cookie\s*:\s*/i, '')
    .replace(/[\r\n]+/g, '; ')
    .replace(/;\s*;/g, ';')
    .trim();
  let accepted = 0;
  for (const item of parseCookies(normalized)) {
    try {
      // cookies live in the browser profile, so one browser-level call covers every tab
      await cdp.send('Storage.setCookies', {
        cookies: [{ name: item.name, value: item.value, domain: '.f95zone.to', path: '/', secure: true, httpOnly: false }],
      });
      accepted++;
    } catch {
      /* a single malformed cookie should not stop the rest */
    }
  }
  if (!accepted) {
    throw new Error('could not apply the saved F95 cookie — save the full Cookie header again');
  }

  let settleReject: ((reason: Error) => void) | null = null;
  const result = new Promise<void>((_, reject) => {
    settleReject = reject;
  });
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cleanup = () => {};

  const stop = (reason: Error) => {
    if (stopped) return;
    stopped = true;
    cleanup();
    for (const sessionId of tabs.keys()) void cdp.send('Page.stopLoading', {}, { sessionId }).catch(() => {});
    settleReject?.(reason);
    settleReject = null;
  };

  const armTimer = (ms: number, message: string) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => stop(new Error(message)), ms);
    timer.unref?.();
  };

  const cookiesFor = async (url: string, sessionId?: string): Promise<Record<string, string> | undefined> => {
    const result = await cdp
      .send<{ cookies?: { name: string; value: string }[] }>('Network.getCookies', { urls: [url] }, { sessionId })
      .catch(() => null);
    const cookie = cookieHeaderFrom(result?.cookies);
    return cookie ? { Cookie: cookie } : undefined;
  };

  const deliver = async (url: string, filename: string | null | undefined, sessionId?: string) => {
    const headers = await cookiesFor(url, sessionId);
    if (stopped) return;
    try {
      options.onCandidate?.(headers ? { url, filename, headers } : { url, filename });
    } catch {
      /* the caller's candidate handler must not break capture */
    }
    // after the first link the user needs time to compare the caught files
    armTimer(PICK_TIMEOUT_MS, 'the caught link expired before a file was chosen');
  };

  const seen = new Set<string>();
  const emit = (url: string, filename: string | null | undefined, sessionId?: string) => {
    if (stopped || !/^https?:\/\//i.test(url) || isStorageHost(url)) return;
    const key = url.split('#')[0] ?? url;
    if (seen.has(key)) return;
    seen.add(key);
    void deliver(url, filename, sessionId);
  };

  const waitingHosts = new Set<string>();
  const offRequest = cdp.on('Network.requestWillBeSent', (params, sessionId) => {
    const request = params?.request;
    if (!request?.url || !looksLikeFile(request.url)) return;
    emit(request.url, undefined, sessionId);
  });
  /** A tab's main page moved to `url`: a file link is caught, a host page is waited for. */
  const handleMainFrame = (url: string, sessionId?: string) => {
    if (/f95zone\.to\/login(?:\/|\?|$)/i.test(url)) {
      stop(new Error('the F95 session expired — save a new cookie'));
      return;
    }
    if (isInternalF95(url)) return;
    if (looksLikeFile(url) || isResolverHost(url) || isMegaFile(url)) {
      emit(url, undefined, sessionId);
      return;
    }
    if (!shouldWaitForHostPage(url)) return;
    const host = hostOf(url);
    if (!host || waitingHosts.has(host)) return;
    waitingHosts.add(host);
    options.onWaiting?.(WAITING_MESSAGE);
  };
  const offFrame = cdp.on('Page.frameNavigated', (params, sessionId) => {
    const frame = params?.frame;
    if (!frame?.url || frame.parentId) return;
    handleMainFrame(withFragment(frame), sessionId);
  });
  const offDownload = cdp.on('Page.downloadWillBegin', (params, sessionId) => {
    if (!params?.url || params.url.startsWith('blob:')) return;
    emit(params.url, params.suggestedFilename ?? null, sessionId);
  });
  const offResponse = cdp.on('Network.responseReceived', (params, sessionId) => {
    const response = params?.response;
    if (!response?.url) return;
    const disposition = headerValue(response.headers, 'content-disposition');
    const filename = disposition ? filenameFromDisposition(disposition) : null;
    if (/attachment/i.test(disposition)) {
      emit(response.url, filename, sessionId);
      return;
    }
    const type = headerValue(response.headers, 'content-type').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!BINARY_TYPES.has(type)) return;
    const host = hostOf(response.url);
    if (looksLikeFile(response.url) || (host && hostMatches(host, FILE_HOSTS))) {
      emit(response.url, filename, sessionId);
    }
  });
  const offBinding = cdp.on('Runtime.bindingCalled', (params, sessionId) => {
    if (params?.name !== 'imDownloadLink' || typeof params.payload !== 'string') return;
    if (!/^https?:\/\//i.test(params.payload)) return;
    emit(params.payload, undefined, sessionId);
  });
  const offClosed = cdp.on('__closed', () => stop(new Error('the browser window was closed')));
  let stopTabs = () => {};

  cleanup = () => {
    offRequest();
    offFrame();
    offDownload();
    offResponse();
    offBinding();
    offClosed();
    stopTabs();
    for (const [sessionId, identifier] of tabs) {
      if (!identifier) continue;
      void cdp
        .send('Page.removeScriptToEvaluateOnNewDocument', { identifier }, { sessionId })
        .catch(() => {});
    }
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    scheduleIdle(current);
  };
  const onAbort = () => stop(new Error('canceled'));
  if (signal?.aborted) {
    cleanup();
    throw new Error('canceled');
  }
  signal?.addEventListener('abort', onAbort, { once: true });

  armTimer(WAIT_TIMEOUT_MS, 'the F95 check was not completed in time — press Download File in the browser window');
  // the first tab is the one the launcher opened: it goes to the F95 page; later tabs are watched only
  let navigated = false;
  stopTabs = await watchTabs(cdp, async (sessionId) => {
    await preparePage(sessionId);
    // a tab can finish loading before its listeners were attached, so read where it is now
    const tree = await cdp
      .send<{ frameTree: { frame: FrameInfo } }>('Page.getFrameTree', {}, { sessionId })
      .catch(() => null);
    if (tree?.frameTree.frame.url) handleMainFrame(withFragment(tree.frameTree.frame), sessionId);
    if (navigated) return;
    navigated = true;
    await cdp
      .send('Page.navigate', { url: sourceUrl }, { sessionId })
      .catch((err) => stop(err instanceof Error ? err : new Error(String(err))));
  });
  return result;
}

/**
 * Open (or reuse) a visible Chrome window, wait for F95's check to redirect, and
 * stream every distinct download link to `onCandidate` until the caller aborts.
 */
export function captureF95Download(
  services: CaptureServices,
  sourceUrl: string,
  options: CaptureOptions = {},
): Promise<void> {
  const epoch = closeEpoch;
  const job = queue.then(() => {
    if (epoch !== closeEpoch) throw new Error('canceled');
    return capture(services, sourceUrl, epoch, options);
  });
  queue = job.catch(() => {});
  return job;
}

export function browserAssistAvailable(browserPath?: string | null): boolean {
  return Boolean(findBrowser(browserPath));
}
