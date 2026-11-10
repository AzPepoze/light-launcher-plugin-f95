import fs from 'node:fs';
import { load, txt, type Doc, type El, type HostMap } from '@light-launcher/plugin-sdk/helpers';

/** Everything the generic XenForo engine needs to know about one forum. */
export interface XenForoProfile {
  id: string;
  label: string;
  baseUrl: string;
  engine: 'xenforo';
  profileVersion: number;
  auth: { checkPath: string; loginPath: string; userSelector: string | string[] };
  /** regex source; capture group 1 = thread id */
  threadUrl: string;
  selectors: {
    title: string | string[];
    titlePrefix: string | string[];
    firstPost: string | string[];
    postBody: string | string[];
    postAuthor: string | string[];
    postDate: string | string[];
    cover: string | string[];
    screenshots: string | string[];
    threadTags: string | string[];
  };
  /** label -> regex with a (?<value>...) group, run on first-post text */
  fields: Record<string, string>;
  /** ordered, each with (?<v>...) or (?<value>...) */
  versionPatterns: string[];
  statusPatterns: Array<{ status: string; pattern: string }>;
  hosts: HostMap;
  attachmentHosts: string[];
  listing: {
    path: string;
    item: string;
    title: string;
    link: string;
    cover: string;
    latest: string;
    pageParam: string;
  };
  rateLimitMs: number;
}

// ---------------------------------------------------------------------------
// selector/url helpers shared by the generic parser (profile-driven, no I/O)
// ---------------------------------------------------------------------------

export function selectorList(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

/** first selector in a profile list that matches anything */
export function selectFirst(doc: Doc, value: string | string[]): El {
  for (const selector of selectorList(value)) {
    const found = doc(selector).first();
    if (found.length) return found;
  }
  return doc('__xenforo_missing__');
}

export function profileBody(doc: Doc, profile: XenForoProfile): El {
  return selectFirst(doc, profile.selectors.postBody);
}

export function profileBodySelector(doc: Doc, profile: XenForoProfile): string | null {
  for (const selector of selectorList(profile.selectors.postBody)) {
    if (doc(selector).length) return selector;
  }
  return null;
}

/** block-aware text extraction; keeps one line per paragraph/li/br */
export function htmlToLines(html: string): string[] {
  const prepared = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr|ul|ol|blockquote)>/gi, '\n');
  const text = load(`<div id="__frag">${prepared}</div>`)('#__frag').first().text();
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function threadIdFromUrl(url: string, profile: XenForoProfile): string {
  let match: RegExpMatchArray | null = null;
  try {
    match = url.match(new RegExp(profile.threadUrl, 'i'));
  } catch {
    match = null;
  }
  if (!match) match = url.match(/\/threads\/(?:[^/]*?\.)?(\d+)(?:\/|$)/i);
  return match?.[1] ?? '';
}

export function canonicalThreadUrl(profile: XenForoProfile, id: string, fallback: string): string {
  if (!id) return fallback;
  return `${profile.baseUrl.replace(/\/+$/, '')}/threads/${id}/`;
}

export function hashId(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export function isoDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}


function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch (err) {
    throw new Error(`cannot read xenforo profile ${file}: ${(err as Error).message}`);
  }
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** objects merge recursively, arrays and scalars replace */
function deepMerge(base: unknown, overlay: unknown): unknown {
  if (overlay === undefined) return base;
  if (!isPlain(base) || !isPlain(overlay)) return overlay;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) out[key] = deepMerge(base[key], value);
  return out;
}

function requireString(obj: Record<string, unknown>, key: string, file: string): void {
  if (typeof obj[key] !== 'string' || !(obj[key] as string).trim()) {
    throw new Error(`invalid xenforo profile ${file}: missing "${key}"`);
  }
}

/** Checks a raw profile object and returns it typed. `file` names the source in error messages. */
export function parseProfile(raw: unknown, file: string): XenForoProfile {
  if (!isPlain(raw)) throw new Error(`invalid xenforo profile ${file}: not an object`);
  if (raw.engine !== 'xenforo') throw new Error(`invalid xenforo profile ${file}: engine must be "xenforo"`);
  for (const key of ['id', 'label', 'baseUrl', 'threadUrl']) requireString(raw, key, file);
  if (!Array.isArray(raw.versionPatterns) || raw.versionPatterns.length === 0) {
    throw new Error(`invalid xenforo profile ${file}: versionPatterns must be a non-empty array`);
  }
  if (!isPlain(raw.selectors)) throw new Error(`invalid xenforo profile ${file}: missing "selectors"`);
  if (!isPlain(raw.fields)) throw new Error(`invalid xenforo profile ${file}: missing "fields"`);
  if (!isPlain(raw.hosts)) throw new Error(`invalid xenforo profile ${file}: missing "hosts"`);
  if (!Array.isArray(raw.attachmentHosts)) {
    throw new Error(`invalid xenforo profile ${file}: attachmentHosts must be an array`);
  }
  if (!isPlain(raw.listing)) throw new Error(`invalid xenforo profile ${file}: missing "listing"`);
  for (const key of ['path', 'item', 'title', 'link', 'cover', 'latest', 'pageParam']) {
    requireString(raw.listing, key, `listing in ${file}`);
  }
  if (!isPlain(raw.auth)) throw new Error(`invalid xenforo profile ${file}: missing "auth"`);
  for (const key of ['checkPath', 'loginPath']) requireString(raw.auth, key, `auth in ${file}`);
  const userSelector = raw.auth.userSelector;
  const selectorOk = typeof userSelector === 'string'
    ? Boolean(userSelector.trim())
    : Array.isArray(userSelector) && userSelector.length > 0 && userSelector.every((s) => typeof s === 'string' && s.trim());
  if (!selectorOk) throw new Error(`invalid xenforo profile ${file}: missing "userSelector"`);
  return raw as unknown as XenForoProfile;
}

/**
 * The embedded profile, with the overlay file merged over it when the file exists.
 * Selector fixes go in the overlay, so they need no rebuild.
 */
export function loadProfile(embedded: unknown, overlayFile: string): XenForoProfile {
  if (!fs.existsSync(overlayFile)) return parseProfile(embedded, 'embedded profile');
  const merged = deepMerge(embedded, readJson(overlayFile));
  return parseProfile(merged, overlayFile);
}
