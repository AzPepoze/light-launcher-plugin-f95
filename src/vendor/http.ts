// Kept local: the SDK http helper goes through host http.request and has no rate limit, ETag cache or cookie header.

/** Validators kept for conditional GET requests. */
export interface CacheEntry {
  etag: string | null;
  lastModified: string | null;
  fetchedAt: string;
}

export interface HttpResult {
  status: number;
  url: string;
  text: string;
  headers: Headers;
  notModified: boolean;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  method?: string;
  body?: any; // RequestInit['body'] — the DOM lib is not loaded on the server
  /** enables conditional GET + a cache slot */
  cacheKey?: string;
  maxBytes?: number;
  allowStatus?: number[];
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface HttpCache {
  get(url: string): CacheEntry | null;
  set(url: string, entry: CacheEntry): void;
}

export interface HttpClientOptions {
  userAgent?: string;
  rateLimitMs?: number;
  cache?: HttpCache;
  /** called with a snippet when a body looks wrong (provider decides to dump) */
  onBody?: (url: string, body: string) => void;
  maxBytes?: number;
}

export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class HttpClient {
  private chain: Promise<void> = Promise.resolve();
  private nextFree = new Map<string, number>();
  private cookie: string | null = null;

  constructor(private readonly opts: HttpClientOptions = {}) {}

  setCookie(cookie: string | null) {
    this.cookie = cookie;
  }

  /** serialize requests, keeping at least rateLimitMs between hits on one host */
  private gate(host: string) {
    const run = async () => {
      const now = Date.now();
      const wait = (this.nextFree.get(host) ?? 0) - now;
      if (wait > 0) await sleep(wait);
      this.nextFree.set(host, Date.now() + (this.opts.rateLimitMs ?? 800));
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  async request(url: string, options: RequestOptions = {}): Promise<HttpResult> {
    const attempts = options.retries ?? 2;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= attempts; attempt++) {
      try {
        const host = new URL(url).host;
        await this.gate(host);
        const res = await this.once(url, options);
        if ((res.status === 429 || res.status >= 500) && !(options.allowStatus ?? []).includes(res.status)) {
          throw new HttpError(`HTTP ${res.status}`, res.status, url);
        }
        return res;
      } catch (err) {
        lastErr = err;
        if (attempt === attempts) break;
        const status = err instanceof HttpError ? err.status : 0;
        const base = status === 429 ? 1500 : 400;
        await sleep(base * 2 ** attempt + Math.floor(Math.random() * 300));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private async once(url: string, options: RequestOptions): Promise<HttpResult> {
    const headers = new Headers({
      'User-Agent': this.opts.userAgent ?? DEFAULT_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(options.headers ?? {}),
    });
    if (this.cookie && !headers.has('Cookie')) headers.set('Cookie', this.cookie);

    let cached: CacheEntry | null = null;
    if (options.cacheKey && this.opts.cache) {
      cached = this.opts.cache.get(options.cacheKey);
      if (cached?.etag) headers.set('If-None-Match', cached.etag);
      if (cached?.lastModified) headers.set('If-Modified-Since', cached.lastModified);
    }

    const res = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body,
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
    });

    if (res.status === 304) {
      if (options.cacheKey && cached && this.opts.cache) {
        this.opts.cache.set(options.cacheKey, { ...cached, fetchedAt: new Date().toISOString() });
      }
      return { status: 304, url: res.url || url, text: '', headers: res.headers, notModified: true };
    }

    const max = options.maxBytes ?? this.opts.maxBytes ?? 12 * 1024 * 1024;
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > max) throw new HttpError(`body too large (${declared} bytes)`, res.status, url);

    const text = res.status === 204 ? '' : await res.text();
    if (options.cacheKey && this.opts.cache) {
      this.opts.cache.set(options.cacheKey, {
        etag: res.headers.get('etag'),
        lastModified: res.headers.get('last-modified'),
        fetchedAt: new Date().toISOString(),
      });
    }
    if (text && /text\/html/i.test(res.headers.get('content-type') ?? '') && this.opts.onBody) {
      this.opts.onBody(res.url || url, text);
    }
    return { status: res.status, url: res.url || url, text, headers: res.headers, notModified: false };
  }

  async get(url: string, options: RequestOptions = {}): Promise<HttpResult> {
    return this.request(url, options);
  }

  async json<T>(url: string, options: RequestOptions = {}): Promise<T> {
    const res = await this.request(url, {
      ...options,
      headers: { Accept: 'application/json', ...(options.headers ?? {}) },
    });
    try {
      return JSON.parse(res.text) as T;
    } catch {
      throw new HttpError(`invalid JSON from ${url}`, res.status, url);
    }
  }

  /** probe a download URL: total size, range support, final URL */
  async probe(url: string, headers: Record<string, string> = {}) {
    let res: Response | null = null;
    try {
      res = await fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': this.opts.userAgent ?? DEFAULT_UA, ...headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      res = null;
    }
    // some hosts reject HEAD; fall back to a 1-byte ranged GET
    if (!res || res.status >= 400 || !res.headers.get('content-length')) {
      const fallback = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': this.opts.userAgent ?? DEFAULT_UA, Range: 'bytes=0-0', ...headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      });
      const range = fallback.headers.get('content-range');
      const total = range?.match(/\/(\d+)/)?.[1];
      return {
        url: fallback.url || url,
        status: fallback.status,
        size: total ? Number(total) : Number(fallback.headers.get('content-length') ?? 0) || 0,
        ranges: fallback.status === 206,
        headers: fallback.headers,
      };
    }
    return {
      url: res.url || url,
      status: res.status,
      size: Number(res.headers.get('content-length') ?? 0) || 0,
      ranges: (res.headers.get('accept-ranges') ?? '').toLowerCase().includes('bytes'),
      headers: res.headers,
    };
  }
}
