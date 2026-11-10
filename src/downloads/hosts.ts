import path from 'node:path';
import { DEFAULT_UA } from '../vendor/http';

/** Per-host defaults the downloader should send before a provider's own headers. */
const REFERERS: Record<string, string> = {
  'f95zone.to': 'https://f95zone.to/',
  'itch.io': 'https://itch.io/',
  'itch.zone': 'https://itch.io/',
  'mediafire.com': 'https://www.mediafire.com/',
  'mega.nz': 'https://mega.nz/',
  'pixeldrain.com': 'https://pixeldrain.com/',
  'gofile.io': 'https://gofile.io/',
  'workupload.com': 'https://workupload.com/',
  'datanodes.to': 'https://datanodes.to/',
  'krakenfiles.com': 'https://krakenfiles.com/',
  'buzzheavier.com': 'https://buzzheavier.com/',
  'vikingfile.com': 'https://vikingfile.com/',
};

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Referer is mandatory on a few CDNs; sending the site root is always safe. */
export function defaultHeaders(url: string): Record<string, string> {
  const host = hostOf(url);
  const out: Record<string, string> = {};
  for (const [domain, referer] of Object.entries(REFERERS)) {
    if (host === domain || host.endsWith(`.${domain}`)) {
      out.Referer = referer;
      break;
    }
  }
  return out;
}

export function mergeHeaders(
  url: string,
  headers?: Record<string, string> | null,
): Record<string, string> {
  return {
    'User-Agent': DEFAULT_UA,
    'Accept-Encoding': 'identity',
    ...defaultHeaders(url),
    ...(headers ?? {}),
  };
}

/** Same registrable site: `a.example.com` and `example.com`, but not `evilexample.com`. */
export function sameSiteHost(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;
const MAX_FILENAME = 180;

/** Keep a single safe path component; never let a filename escape the downloads dir. */
export function sanitizeFilename(name: string): string {
  const base = path
    .basename(name.replace(/\\/g, '/'))
    .replace(ILLEGAL, '_')
    .replace(/^\.+/, '')
    .trim();
  const cleaned = base.replace(/[. ]+$/g, '');
  if (!cleaned) return 'download.bin';
  if (cleaned.length <= MAX_FILENAME) return cleaned;
  // keep the extension so archive detection and players still recognise the file
  const ext = path.extname(cleaned);
  if (ext && ext.length <= 10) {
    return `${cleaned.slice(0, MAX_FILENAME - ext.length)}${ext}`;
  }
  return cleaned.slice(0, MAX_FILENAME);
}

export function filenameFromUrl(url: string, fallback = 'download.bin'): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (!last) return fallback;
    const decoded = decodeURIComponent(last);
    return decoded ? sanitizeFilename(decoded) : fallback;
  } catch {
    return fallback;
  }
}

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/vnd.rar': '.rar',
  'application/x-rar-compressed': '.rar',
  'application/x-7z-compressed': '.7z',
  'application/x-tar': '.tar',
  'application/gzip': '.gz',
  'application/x-gzip': '.gz',
  'application/x-bzip2': '.bz2',
  'application/x-xz': '.xz',
  'application/zstd': '.zst',
  'application/x-iso9660-image': '.iso',
  'application/x-msdownload': '.exe',
  'application/vnd.microsoft.portable-executable': '.exe',
  'application/x-msi': '.msi',
  'application/vnd.android.package-archive': '.apk',
  'application/octet-stream': '',
};

const GENERIC_STEMS = new Set([
  'download', 'downloads', 'file', 'files', 'get', 'attachment', 'attachments',
  'index', 'api', 'data', 'blob', 'unknown', 'archive', 'setup', 'install',
  'installer', 'redirect', 'link', 'media', 'content', 'proxy', 'stream',
]);

const FILE_HOST_STEMS = new Set([
  'pixeldrain', 'mediafire', 'mega', 'mega.nz', 'gofile', 'datanodes',
  'krakenfiles', 'workupload', 'mixdrop', 'vikingfile', 'buzzheavier',
  'bzzhr', 'yourfilestore', 'dropmefiles', 'wdho', 'bunkr',
]);

export function extensionForContentType(value: string | null | undefined): string | null {
  if (!value) return null;
  const type = value.split(';')[0]?.trim().toLowerCase() ?? '';
  return CONTENT_TYPE_EXTENSIONS[type] ?? null;
}

/** Parses both `filename=` and the UTF-8 `filename*=` forms of Content-Disposition. */
export function filenameFromDisposition(value: string | null | undefined): string | null {
  if (!value) return null;
  const extended = /filename\*\s*=\s*(?:([\w-]+)'[^']*')?([^;]+)/i.exec(value);
  if (extended?.[2]) {
    const raw = extended[2].trim().replace(/^"|"$/g, '');
    try {
      return sanitizeFilename(decodeURIComponent(raw));
    } catch {
      return sanitizeFilename(raw);
    }
  }
  const quoted = /filename\s*=\s*"([^"]+)"/i.exec(value);
  if (quoted?.[1]) return sanitizeFilename(quoted[1]);
  const plain = /filename\s*=\s*([^;]+)/i.exec(value);
  return plain?.[1] ? sanitizeFilename(plain[1].trim()) : null;
}

export function isGenericFilename(name: string | null | undefined): boolean {
  if (!name) return true;
  const base = sanitizeFilename(name).toLowerCase();
  const stem = base.replace(/\.[a-z0-9]{1,8}$/i, '');
  if (!stem || stem === base && base === 'download.bin') return true;
  return GENERIC_STEMS.has(stem) || FILE_HOST_STEMS.has(stem);
}

/** A URL basename only counts when it looks like a real file, not an API token. */
function usefulUrlName(url: string | null | undefined): string | null {
  if (!url) return null;
  let raw: string;
  try {
    raw = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
  } catch {
    return null;
  }
  if (!raw || isGenericFilename(raw)) return null;
  const hasExtension = /\.[a-z0-9]{2,5}$/i.test(raw);
  const looksNamed = /[\s_-]/.test(raw) || raw.length > 24;
  return hasExtension || looksNamed ? sanitizeFilename(raw) : null;
}

function usefulName(value: string | null | undefined): string | null {
  if (!value) return null;
  const name = sanitizeFilename(value);
  return isGenericFilename(name) ? null : name;
}

export function ensureFilenameExtension(name: string, contentType?: string | null): string {
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  const ext = extensionForContentType(contentType);
  return ext ? `${name}${ext}` : `${name}.bin`;
}

export interface FilenameParts {
  /** `Content-Disposition` of the final response */
  disposition?: string | null;
  contentType?: string | null;
  /** final direct URL */
  url?: string | null;
  /** filename suggested by the browser's download event */
  captured?: string | null;
  /** filename returned by a host resolver */
  resolved?: string | null;
  /** filename the source page listed */
  file?: string | null;
  /** mirror label, e.g. PIXELDRAIN */
  label?: string | null;
}

/**
 * The name a download should be saved under. Server metadata wins over
 * inferred names, so a mirror label never becomes `Pixeldrain.zip`.
 */
export function finalFilename(parts: FilenameParts): string {
  const chosen =
    usefulName(filenameFromDisposition(parts.disposition)) ??
    usefulName(parts.captured) ??
    usefulName(parts.resolved) ??
    usefulUrlName(parts.url) ??
    usefulName(parts.file) ??
    usefulName(parts.label) ??
    'download';
  return ensureFilenameExtension(chosen, parts.contentType);
}

/** Headers safe to send to this URL: the forum session never leaves the forum. */
export function headersForHost(
  url: string,
  headers: Record<string, string>,
  forumHost = 'f95zone.to',
): Record<string, string> {
  const host = hostOf(url);
  const onForum = host === forumHost || host.endsWith(`.${forumHost}`);
  if (onForum) return mergeHeaders(url, headers);
  const out = { ...headers };
  delete out.Cookie;
  delete out.Referer;
  return mergeHeaders(url, out);
}

/** Like headersForHost, plus cookies the browser fetched for this exact URL (safe to send back to it). */
export function withBrowserHeaders(
  url: string,
  base: Record<string, string>,
  browserHeaders?: Record<string, string>,
): Record<string, string> {
  const scoped = headersForHost(url, base);
  return browserHeaders ? { ...scoped, ...browserHeaders } : scoped;
}
