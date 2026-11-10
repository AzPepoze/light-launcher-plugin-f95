import { load } from '../../vendor/html';
import { DEFAULT_UA } from '../../vendor/http';
import { hostOf } from '../hosts';

export interface FetchedPage {
  html: string;
  /** final URL after redirects */
  url: string;
}

const PAGE_TIMEOUT_MS = 30_000;

function isForumHost(host: string): boolean {
  return host === 'f95zone.to' || host.endsWith('.f95zone.to');
}

/** The forum cookie and referer only ever go to the forum. */
function scopedHeaders(url: string, headers: Record<string, string>): Record<string, string> {
  const out = { ...headers };
  if (!isForumHost(hostOf(url))) {
    delete out.Cookie;
    delete out.Referer;
  }
  return { 'User-Agent': DEFAULT_UA, ...out };
}

/** Returns the page HTML, or an empty string when the URL is already a file. */
export async function fetchPage(url: string, headers: Record<string, string>): Promise<FetchedPage | null> {
  const res = await fetch(url, {
    headers: scopedHeaders(url, headers),
    redirect: 'follow',
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!type.includes('text/html') && !type.includes('application/xhtml')) {
    await res.body?.cancel().catch(() => {});
    return { html: '', url: res.url };
  }
  return { html: await res.text(), url: res.url };
}

function absolute(base: string, href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** The first link matching a host-specific selector. */
export function firstLink(html: string, base: string, selector: string): string | null {
  const $ = load(html);
  const node = $(selector).first();
  return absolute(base, node.attr('href') ?? node.attr('data-href'));
}

/** A generic "download" link, used when a host's own selector finds nothing. */
export function genericDownloadLink(html: string, base: string): string | null {
  const $ = load(html);
  let found: string | null = null;
  $('a[href]').each((_, element) => {
    if (found) return;
    const node = $(element);
    const href = node.attr('href') ?? '';
    const text = node.text().replace(/\s+/g, ' ').trim().toLowerCase();
    const looksUseful =
      /\/download(\/|$)/i.test(href) ||
      node.attr('id')?.toLowerCase().includes('download') ||
      /^(download|download now|click here to download)$/.test(text);
    if (looksUseful) found = absolute(base, href);
  });
  if (found) return found;
  const form = $('form[action]').first();
  const action = form.attr('action');
  if (action && /download/i.test(action)) return absolute(base, action);
  return null;
}
