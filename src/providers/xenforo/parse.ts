import type { FileCandidate, FileKind, GameDTO, GameStatus, Platform } from '@light-launcher/plugin-sdk/types';
import {
  absUrl, attr, classifyLink, cleanHtml, load, parseSize, platformOf, platformsIn, txt, usableImage,
  type Doc, type El,
} from '@light-launcher/plugin-sdk/helpers';
import {
  canonicalThreadUrl, hashId, htmlToLines, isoDateTime, profileBody, profileBodySelector,
  selectFirst, selectorList, threadIdFromUrl, type XenForoProfile,
} from './profile';

const WS = /\s+/g;

function cleanTitle(raw: string, siteLabel: string): string {
  let title = raw.replace(WS, ' ').trim();
  const suffix = new RegExp(`\\s*[|\\-–—]\\s*${siteLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  title = title.replace(suffix, '').trim();
  title = title.replace(/^\[[^\]]+\]\s*/, (m) => (engineKeyword(m) ? '' : m));
  return title.trim();
}

const ENGINE_PATTERNS: Array<[RegExp, string]> = [
  [/ren'?py/i, "Ren'Py"],
  [/\brpgm\b|\brpg\s*maker\b/i, 'RPG Maker'],
  [/\bunity\b/i, 'Unity'],
  [/\bunreal\b/i, 'Unreal Engine'],
  [/\bgodot\b/i, 'Godot'],
  [/\bflash\b/i, 'Flash'],
  [/\bqsp\b/i, 'QSP'],
  [/\bhtml\b/i, 'HTML'],
];

function engineKeyword(text: string): string | null {
  for (const [pattern, name] of ENGINE_PATTERNS) if (pattern.test(text)) return name;
  return null;
}

export function engineFromText(text: string): string | null {
  const bracket = text.match(/\[([^\]]+)\]/)?.[1] ?? '';
  return engineKeyword(bracket) ?? engineKeyword(text);
}

function extractTitle(doc: Doc, profile: XenForoProfile): { title: string; prefix: string; raw: string } {
  const titleEl = selectFirst(doc, profile.selectors.title);
  let prefix = '';
  let raw = '';
  if (titleEl.length) {
    const clone = titleEl.clone();
    for (const selector of selectorList(profile.selectors.titlePrefix)) {
      clone.find(selector).each((_, node) => {
        prefix += ` ${txt(doc(node))}`;
      });
      clone.find(selector).remove();
    }
    raw = txt(clone);
  }
  prefix = prefix.replace(WS, ' ').trim();
  if (!raw) raw = cleanTitle(txt(doc('title')), profile.label);
  return { title: cleanTitle(raw, profile.label), prefix, raw };
}

function fieldValues(lines: string[], profile: XenForoProfile): Record<string, string> {
  const text = lines.join('\n');
  const out: Record<string, string> = {};
  for (const [key, source] of Object.entries(profile.fields)) {
    try {
      const match = text.match(new RegExp(source, 'im'));
      const value = (match?.groups?.value ?? match?.groups?.v ?? match?.[1] ?? '').trim();
      if (value) out[key] = value.replace(/\s*\|\s*$/, '').trim();
    } catch {
      /* a broken custom regex must not break the whole parse */
    }
  }
  return out;
}

function statusOf(text: string, profile: XenForoProfile): GameStatus {
  const allowed: GameStatus[] = ['ongoing', 'completed', 'abandoned', 'onhold', 'unknown'];
  for (const rule of profile.statusPatterns) {
    try {
      if (new RegExp(rule.pattern, 'i').test(text)) {
        const value = rule.status.toLowerCase() as GameStatus;
        if (allowed.includes(value)) return value;
      }
    } catch {
      /* ignore invalid custom pattern */
    }
  }
  return 'unknown';
}

function normalizeVersion(value: string): string | null {
  const cleaned = value
    .replace(/^[\s[({<]+|[\s\]})>,.;]+$/g, '')
    .replace(/^v(?=\d)/i, '')
    .trim();
  return cleaned || null;
}

export function parseVersion(title: string, firstPostText: string, profile: XenForoProfile): string | null {
  for (const source of [title, firstPostText]) {
    if (!source) continue;
    for (const pattern of profile.versionPatterns) {
      try {
        const match = source.match(new RegExp(pattern, 'i'));
        const value = match?.groups?.v ?? match?.groups?.value;
        if (value) {
          const normalized = normalizeVersion(value);
          if (normalized) return normalized;
        }
      } catch {
        /* skip invalid pattern */
      }
    }
  }
  return null;
}

function postImages(doc: Doc, profile: XenForoProfile, baseUrl: string): string[] {
  const body = profileBody(doc, profile);
  const out: string[] = [];
  if (!body.length) return out;
  body.find('img').each((_, node) => {
    const img = doc(node);
    const src = absUrl(baseUrl, img.attr('data-src') ?? img.attr('data-url') ?? img.attr('src'));
    if (!src || out.includes(src)) return;
    if (/^data:/i.test(src) || !usableImage(src)) return;
    const width = Number(img.attr('width') ?? 0);
    const height = Number(img.attr('height') ?? 0);
    if ((width && width < 80) || (height && height < 80)) return;
    out.push(src);
  });
  return out.slice(0, 12);
}

function coverOf(doc: Doc, profile: XenForoProfile, baseUrl: string, shots: string[]): string | null {
  if (shots[0]) return shots[0];
  const og = usableImage(attr(doc('meta[property="og:image"]').first(), 'content'));
  if (og) return absUrl(baseUrl, og);
  const thumb = selectFirst(doc, '.js-threadThumbnail img, .threadThumbnail img, .structItem-cell--icon img');
  return usableImage(absUrl(baseUrl, thumb.attr('data-src') ?? thumb.attr('src')));
}

function tagList(doc: Doc, profile: XenForoProfile, genre?: string): string[] {
  const tags: string[] = [];
  const add = (value: string) => {
    const cleaned = value.replace(WS, ' ').replace(/^#/, '').trim();
    if (cleaned && !tags.some((t) => t.toLowerCase() === cleaned.toLowerCase())) tags.push(cleaned);
  };
  for (const selector of selectorList(profile.selectors.threadTags)) {
    doc(selector).each((_, node) => add(txt(doc(node))));
  }
  for (const value of (genre ?? '').split(/[,/|]/)) add(value);
  return tags.slice(0, 24);
}

const CHANGELOG_HEADING =
  /<h[1-6][^>]*>\s*(?:<[^>]+>\s*)*(?:change[\s-]?log|changes)\s*(?:<\/[^>]+>\s*)*<\/h[1-6]>|<(?:b|strong)[^>]*>\s*(?:change[\s-]?log|changes)\s*<\/(?:b|strong)>/i;

function changelogOf(doc: Doc, profile: XenForoProfile): string | null {
  const body = profileBody(doc, profile);
  if (!body.length) return null;
  const html = body.html() ?? '';
  const found = CHANGELOG_HEADING.exec(html);
  if (!found) return null;
  const rest = html.slice(found.index + found[0].length);
  const nextHeading = rest.search(/<h[1-6][^>]*>/i);
  const section = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
  const text = htmlToLines(section).join('\n').trim();
  return text ? text.slice(0, 4000) : null;
}

export function parseThreadMeta(html: string, profile: XenForoProfile): { editedAt: string | null; title: string } {
  const doc = load(html);
  const first = selectFirst(doc, profile.selectors.firstPost);
  const edited = attr(first.find('.message-lastEdit time[datetime]').first(), 'datetime');
  const posted = attr(first.find(selectorList(profile.selectors.postDate).join(',')).first(), 'datetime');
  const raw = edited ?? posted ?? null;
  return { editedAt: isoDateTime(raw), title: extractTitle(doc, profile).title };
}

export function parseThread(html: string, profile: XenForoProfile, url: string): GameDTO {
  const doc = load(html);
  const { title, prefix, raw } = extractTitle(doc, profile);
  const body = profileBody(doc, profile);
  const lines = htmlToLines(body.html() ?? '');
  const text = lines.join('\n');
  const fields = fieldValues(lines, profile);
  const id = threadIdFromUrl(url, profile);
  const shots = postImages(doc, profile, url);
  const descriptionSelector = profileBodySelector(doc, profile);
  const description = descriptionSelector ? cleanHtml(doc, descriptionSelector, url) : { html: '', text: '' };
  const meta = parseThreadMeta(html, profile);
  const version = parseVersion(title, text, profile);
  const engine = fields.engine ?? engineFromText(`${prefix} ${raw} ${title}`) ?? null;

  return {
    source: profile.id,
    sourceId: id || url,
    url: canonicalThreadUrl(profile, id, url),
    title,
    version,
    developer: fields.developer ?? null,
    engine,
    tags: tagList(doc, profile, fields.genre),
    coverUrl: coverOf(doc, profile, url, shots),
    screenshots: shots,
    descriptionHtml: description.html || null,
    changelog: changelogOf(doc, profile),
    status: statusOf(fields.status ?? text, profile),
    updatedAt: meta.editedAt,
    extra: {
      threadId: id || null,
      prefix: prefix || null,
      language: fields.language ?? null,
      genre: fields.genre ?? null,
      installation: fields.installation ?? null,
      releaseDate: fields.releaseDate ?? null,
    },
  };
}

export function parseListing(html: string, profile: XenForoProfile, url: string): GameDTO[] {
  const doc = load(html);
  const out: GameDTO[] = [];
  doc(profile.listing.item).each((_, node) => {
    const item = doc(node);
    const linkEl = item.find(profile.listing.link).first();
    const href = absUrl(url, attr(linkEl, 'href'));
    if (!href) return;
    const id = threadIdFromUrl(href, profile);
    if (!id || out.some((game) => game.sourceId === id)) return;
    const title = cleanTitle(txt(linkEl), profile.label);
    const coverEl = item.find(profile.listing.cover).first();
    const cover = absUrl(url, coverEl.attr('data-src') ?? coverEl.attr('src'));
    const latest = attr(item.find(profile.listing.latest).first(), 'datetime');
    out.push({
      source: profile.id,
      sourceId: id,
      url: canonicalThreadUrl(profile, id, href),
      title,
      version: parseVersion(title, '', profile),
      coverUrl: cover,
      updatedAt: isoDateTime(latest),
      extra: { fromListing: true },
    });
  });
  return out;
}

export function parseAccountName(html: string, profile: XenForoProfile): string | null {
  const doc = load(html);
  const element = selectFirst(doc, profile.auth.userSelector);
  const name = (txt(element) || attr(element, 'title') || attr(element, 'aria-label') || '')
    .replace(/^(?:signed in as|account)\s*:?\s*/i, '')
    .trim();
  return name || null;
}

/** inline screenshots and thumbnails are not downloads */
const IMAGE_LINK = /\/thumb\/|\.(gif|png|jpe?g|webp|bmp)(\?|#|$)/i;

/** F95's own redirect to a file host; the link text names the host */
const DOWNLOAD_REDIRECT = /\/dl\/\d+\//;
const SIZE_TEXT = /size\s*:\s*([\d.,]+\s*[kmgt]?i?b)/i;
const OS_LINE = /^\s*OS\s*:\s*/i;

/** headings that start a fresh download block instead of continuing the previous one */
const BLOCK_RESET = /^(?:downloads?|download links?|mirrors?|links?)\s*:?\s*$/i;
/** patches, cheats and guides are not builds; do not let them inherit the last platform */
const EXTRAS_SECTION = /\b(?:patch(?:es)?|mods?|cheat(?:s| table)?|walkthrough|guides?|updates?|dlc|bonus|extras?|soundtrack|tools?)\b/i;

const TOKEN_MARK = /__il_dl_\d+__/g;
const TOKEN_MATCH = /__il_dl_(\d+)__/g;

function plainText(line: string): string {
  return line.replace(TOKEN_MARK, ' ').replace(/\s+/g, ' ').trim();
}

function stripHidden(doc: Doc, root: El): void {
  root
    .find('script,style,noscript,iframe,object,embed,form,button,input,textarea,select,svg,canvas,video,audio')
    .remove();
  root.find('[hidden], [aria-hidden="true"], .u-hidden, .is-hidden').remove();
  root.find('[style]').each((_, node) => {
    const element = doc(node);
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(element.attr('style') ?? '')) element.remove();
  });
}

/** the launcher is local, so a combined "Win/Linux" section can be filed under this machine's platform */
function localPlatform(): Platform {
  return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
}

function combinedPlatform(platforms: Platform[]): Platform | null {
  const here = localPlatform();
  return platforms.includes(here) ? here : null;
}

/** A forum /dl/ link: the browser must follow it, because it leads to a file host. */
export function isDownloadRedirect(url: string): boolean {
  return DOWNLOAD_REDIRECT.test(url);
}

interface CandidateInfo {
  label: string;
  url: string;
  filename: string | null;
  host: string;
  kind: FileKind;
  requiresAuth: boolean;
  explicitPlatform: Platform;
  token: string;
  platform: Platform;
  size: number | null;
}

function candidateInfo(
  anchor: El,
  href: string,
  profile: XenForoProfile,
  baseUrl: string,
): CandidateInfo | null {
  const label = txt(anchor);
  const context = txt(anchor.closest('p, li, div.bbCodeBlock-content, div'));
  if (DOWNLOAD_REDIRECT.test(href)) {
    const link = absUrl(baseUrl, href);
    if (!link || !label) return null;
    return {
      label,
      url: link,
      filename: null,
      host: label.toLowerCase(),
      kind: 'mirror',
      requiresAuth: true,
      // the label is the host name here, not the build platform; the section heading decides
      explicitPlatform: 'unknown',
      token: '',
      platform: 'unknown',
      size: parseSize(context.match(SIZE_TEXT)?.[1] ?? null),
    };
  }
  const info = classifyLink({
    url: href,
    label,
    hosts: profile.hosts,
    baseUrl,
    knownAttachmentHosts: profile.attachmentHosts,
  });
  if (!info) return null;
  const attachment = info.requiresAuth
    || profile.attachmentHosts.some((host) => info.host === host || info.host.endsWith(`.${host}`));
  return {
    label: info.label || info.filename || info.host,
    url: info.url,
    filename: info.filename,
    host: info.host,
    kind: attachment ? 'attachment' : info.kind,
    requiresAuth: attachment,
    // do not trust the hostname here (androidfilehost is a host, not a platform)
    explicitPlatform: platformOf(info.label, info.filename),
    token: '',
    platform: 'unknown',
    size: parseSize(context.match(SIZE_TEXT)?.[1] ?? null),
  };
}

export function extractFileCandidates(html: string, profile: XenForoProfile, url: string): FileCandidate[] {
  const doc = load(html);
  const body = profileBody(doc, profile);
  if (!body.length) return [];

  const clone = body.clone();
  stripHidden(doc, clone);

  // Keep a marker where each download link was so the rendered line still tells us which
  // platform heading it belongs to after inline markup and block boundaries are flattened.
  const candidates: CandidateInfo[] = [];
  for (const node of clone.find('a[href]').toArray()) {
    const anchor = doc(node);
    const href = anchor.attr('href');
    if (!href || IMAGE_LINK.test(href)) continue;
    const info = candidateInfo(anchor, href, profile, url);
    if (!info) continue;
    info.token = `__il_dl_${candidates.length}__`;
    candidates.push(info);
    anchor.replaceWith(info.token);
  }

  const lines = htmlToLines(clone.html() ?? '');
  const osLine = lines.find((line) => OS_LINE.test(plainText(line)));
  const osPlatforms = platformsIn(osLine ?? '');
  const osFallback = osPlatforms.length === 1 ? osPlatforms[0] : null;

  let current: Platform | null = null;
  for (const line of lines) {
    const found = [...line.matchAll(TOKEN_MATCH)];
    const text = plainText(line);
    const whole = platformsIn(text);

    if (!found.length) {
      if (whole.length === 1) current = whole[0];
      else if (whole.length > 1) current = null;
      else if (BLOCK_RESET.test(text) || EXTRAS_SECTION.test(text)) current = null;
      continue;
    }

    const firstPrefix = plainText(line.slice(0, found[0].index ?? 0));
    const prefixPlatforms = platformsIn(firstPrefix);
    const extras = EXTRAS_SECTION.test(firstPrefix);
    let section: Platform | null = null;
    if (prefixPlatforms.length === 1) section = prefixPlatforms[0];
    else if (prefixPlatforms.length > 1) section = combinedPlatform(prefixPlatforms);
    else if (extras) section = null;
    else section = current;

    if (prefixPlatforms.length === 1) current = section;
    else if (prefixPlatforms.length > 1) current = section;
    else if (extras) current = null;

    for (const match of found) {
      const index = Number(match[1]);
      const candidate = candidates[index];
      if (!candidate) continue;
      const before = plainText(line.slice(0, match.index ?? 0));
      const anchorPlatforms = platformsIn(before);
      let anchorPlatform: Platform | null = null;
      if (anchorPlatforms.length === 1) anchorPlatform = anchorPlatforms[0];
      else if (anchorPlatforms.length > 1) anchorPlatform = combinedPlatform(anchorPlatforms);

      const explicit = candidate.explicitPlatform !== 'unknown' ? candidate.explicitPlatform : null;
      const fallback = extras ? null : osFallback;
      candidate.platform = explicit ?? anchorPlatform ?? section ?? fallback ?? 'unknown';
      if (candidate.size == null) candidate.size = parseSize(text.match(SIZE_TEXT)?.[1] ?? null);
    }
  }

  const out: FileCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    out.push({
      id: hashId(candidate.url),
      label: candidate.label,
      url: candidate.url,
      filename: candidate.filename,
      size: candidate.size,
      host: candidate.host,
      kind: candidate.kind,
      platform: candidate.platform,
      requiresAuth: candidate.requiresAuth,
    });
  }
  return out;
}
