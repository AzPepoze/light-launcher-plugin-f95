import { DEFAULT_USER_AGENT } from '@light-launcher/plugin-sdk/helpers';

/** Per-host defaults the downloader should send before a provider's own headers. */
const REFERERS: Record<string, string> = {
  'f95zone.to': 'https://f95zone.to/',
  'mediafire.com': 'https://www.mediafire.com/',
  'mega.nz': 'https://mega.nz/',
  'pixeldrain.com': 'https://pixeldrain.com/',
  'workupload.com': 'https://workupload.com/',
  'datanodes.to': 'https://datanodes.to/',
  'krakenfiles.com': 'https://krakenfiles.com/',
  'buzzheavier.com': 'https://buzzheavier.com/',
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
    'User-Agent': DEFAULT_USER_AGENT,
    'Accept-Encoding': 'identity',
    ...defaultHeaders(url),
    ...(headers ?? {}),
  };
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

/** Headers safe to send to a resolved download URL. */
export function withBrowserHeaders(
  url: string,
  base: Record<string, string>,
): Record<string, string> {
  return headersForHost(url, base);
}
