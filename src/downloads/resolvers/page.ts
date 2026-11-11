import { DEFAULT_USER_AGENT, load } from '@light-launcher/plugin-sdk/helpers';
import { hostOf } from '../hosts';
import type { ResolveContext } from './base';

export interface FetchedPage {
  html: string;
  /** final URL after redirects */
  url: string;
}

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
  return { 'User-Agent': DEFAULT_USER_AGENT, ...out };
}

const HUMAN_STEP = [
  /\b(?:g-recaptcha|h-captcha|hcaptcha|cf-turnstile|recaptcha)\b/i,
  /type\s*=\s*["']password["']/i,
  /\b(?:captcha|cloudflare|just a moment|checking your browser)\b/i,
  /\b(?:please wait|countdown|wait\s+\d+\s*(?:seconds?|s))\b/i,
  /\b(?:sign in|log in|login)\s+to\s+(?:continue|download)\b/i,
];

/** True when the page asks the visitor to do something a plain fetch cannot. */
export function needsHumanStep(html: string): boolean {
  return HUMAN_STEP.some((pattern) => pattern.test(html));
}

function isHtml(contentType: string | undefined): boolean {
  const type = (contentType ?? '').toLowerCase();
  return type.includes('text/html') || type.includes('application/xhtml');
}

/** Some hosts send HTML without a content type. */
function looksLikeHtml(text: string): boolean {
  return /^\s*</.test(text);
}

/**
 * Returns the page HTML, or an empty string when the URL is already a file.
 * A HEAD request checks the type first, so a large file is never downloaded into memory.
 */
export async function fetchPage(url: string, { headers, http }: ResolveContext): Promise<FetchedPage | null> {
  const requestHeaders = scopedHeaders(url, headers);
  const head = await http.request(url, { method: 'HEAD', headers: requestHeaders, allowStatus: [405] });
  if (head.status < 400 && head.headers['content-type'] && !isHtml(head.headers['content-type'])) {
    return { html: '', url: head.url };
  }

  const res = await http.request(url, { headers: requestHeaders });
  if (res.status < 200 || res.status >= 300) return null;
  if (!isHtml(res.headers['content-type']) && !looksLikeHtml(res.text)) return { html: '', url: res.url };
  return { html: res.text, url: res.url };
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
