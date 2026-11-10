// vendored until the SDK is published; replace with @light-launcher/plugin-sdk
import type { FileKind, Platform } from './types';
import { absUrl, type Doc } from './html';

export interface HostRule {
  kind: FileKind;
  platform?: Platform;
}

export type HostMap = Record<string, FileKind | HostRule>;

export interface LinkInfo {
  url: string;
  host: string;
  label: string;
  kind: FileKind;
  platform: Platform;
  filename: string | null;
  requiresAuth: boolean;
}

// underscores, dots and dashes are separators in filenames ("Game_v1.2_Win.zip")
const EDGE = '(?:^|[^a-z0-9])';
const TAIL = '(?=[^a-z0-9]|$)';
const PLATFORM_PATTERNS: [RegExp, Platform][] = [
  [new RegExp(`${EDGE}(?:windows|win(?:32|64)?|x64|pc)${TAIL}`, 'i'), 'windows'],
  [new RegExp(`${EDGE}(?:linux(?:64)?|unix|appimage|x86_64)${TAIL}`, 'i'), 'linux'],
  [new RegExp(`${EDGE}(?:mac(?:os)?|osx|darwin|dmg)${TAIL}`, 'i'), 'mac'],
  [new RegExp(`${EDGE}(?:android|apk)${TAIL}`, 'i'), 'android'],
];

/** Forum posts are written by hand; these are the misspellings seen on real threads. */
const PLATFORM_TYPOS: Record<string, Platform> = {
  andorid: 'android',
  andriod: 'android',
  andoid: 'android',
  androd: 'android',
  windwos: 'windows',
  wndows: 'windows',
  winows: 'windows',
  linx: 'linux',
  lunix: 'linux',
  macso: 'mac',
};

const ARCHIVE_RE = /\.(zip|rar|7z|tar|gz|tgz|xz|bz2|zst|iso|jar|apk)$/i;
const BINARY_RE = /\.(exe|msi|appimage|dmg|sh|bat|cmd|x86_64|run)$/i;
const JUNK_RE = /\.(png|jpe?g|gif|webp|svg|ico|css|js|mp4|webm|mp3|ogg|wav|pdf|txt|md)$/i;

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function matchHost(host: string, map: HostMap): HostRule | null {
  let best: { key: string; rule: HostRule } | null = null;
  for (const [key, value] of Object.entries(map)) {
    const k = key.toLowerCase().replace(/^www\./, '');
    if (host === k || host.endsWith(`.${k}`)) {
      if (!best || k.length > best.key.length) {
        best = { key: k, rule: typeof value === 'string' ? { kind: value } : value };
      }
    }
  }
  return best?.rule ?? null;
}

/** every platform named in the text, in a stable order */
export function platformsIn(...texts: (string | null | undefined)[]): Platform[] {
  const haystack = texts.filter(Boolean).join(' ');
  const out: Platform[] = [];
  for (const [re, platform] of PLATFORM_PATTERNS) {
    if (re.test(haystack) && !out.includes(platform)) out.push(platform);
  }
  for (const word of haystack.toLowerCase().match(/[a-z]+/g) ?? []) {
    const platform = PLATFORM_TYPOS[word];
    if (platform && !out.includes(platform)) out.push(platform);
  }
  return out;
}

export function platformOf(...texts: (string | null | undefined)[]): Platform {
  return platformsIn(...texts)[0] ?? 'unknown';
}

export function fileNameFromUrl(url: string): string | null {
  try {
    const p = new URL(url).pathname;
    const last = decodeURIComponent(p.split('/').filter(Boolean).pop() ?? '');
    if (!last || last.length > 160) return null;
    return /\.[a-z0-9]{2,5}$/i.test(last) ? last : null;
  } catch {
    return null;
  }
}

export function classifyLink(input: {
  url: string;
  label?: string | null;
  hosts?: HostMap;
  baseUrl: string;
  knownAttachmentHosts?: string[];
}): LinkInfo | null {
  const url = absUrl(input.baseUrl, input.url);
  if (!url) return null;
  const host = hostOf(url);
  if (!host) return null;
  const label = (input.label ?? '').replace(/\s+/g, ' ').trim();
  const filename = fileNameFromUrl(url);

  if (JUNK_RE.test(url) && !ARCHIVE_RE.test(url)) return null;

  let rule = input.hosts ? matchHost(host, input.hosts) : null;
  if (!rule && input.knownAttachmentHosts?.some((h) => host === h || host.endsWith(`.${h}`))) {
    rule = { kind: 'attachment' };
  }

  const looksBinary = ARCHIVE_RE.test(url) || BINARY_RE.test(url) || ARCHIVE_RE.test(label) || BINARY_RE.test(label);
  if (!rule) {
    if (!looksBinary) return null;
    rule = { kind: 'external' };
  }
  if (rule.kind === 'external' && !looksBinary) return null;

  return {
    url,
    host,
    label: label || filename || host,
    kind: rule.kind,
    platform: platformOf(label, filename, url),
    filename,
    requiresAuth: rule.kind === 'attachment',
  };
}

/** every real download link inside a post body */
export function extractLinks(doc: Doc, selector: string, hosts: HostMap, baseUrl: string): LinkInfo[] {
  const out = new Map<string, LinkInfo>();
  doc(selector)
    .find('a[href]')
    .each((_, el) => {
      const a = doc(el);
      const href = a.attr('href');
      if (!href) return;
      const info = classifyLink({ url: href, label: a.text(), hosts, baseUrl });
      if (info && !out.has(info.url)) out.set(info.url, info);
    });
  return [...out.values()];
}

/** best-guess filename for a mirror whose url is opaque */
export function guessFilename(link: LinkInfo, fallback: string): string {
  const raw = link.filename ?? `${link.host}-${fallback}`;
  const cleaned = raw.replace(/[^\w.\-+() \[\]]+/g, '_').trim() || 'download.bin';
  return cleaned;
}
