// vendored until the SDK is published; replace with @light-launcher/plugin-sdk
import * as cheerio from 'cheerio';

export type Doc = cheerio.CheerioAPI;
export type El = cheerio.Cheerio<any>;

const WS = /\s+/g;

export function load(html: string): Doc {
  return cheerio.load(html);
}

export function txt(el: El | null | undefined): string {
  if (!el || !el.length) return '';
  return el.text().replace(WS, ' ').trim();
}

export function attr(el: El | null | undefined, name: string): string | null {
  if (!el || !el.length) return null;
  const v = el.attr(name);
  return v == null || v === '' ? null : v;
}

export function absUrl(base: string, href?: string | null): string | null {
  if (!href) return null;
  const raw = href.trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('javascript:') || raw.startsWith('mailto:')) return null;
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

/** strip everything that can execute or track, then absolutize urls */
export function cleanHtml(doc: Doc, selector: string, baseUrl: string): { html: string; text: string } {
  const found = doc(selector).first();
  if (!found.length) return { html: '', text: '' };

  const clone = found.clone();
  clone.find('script,style,iframe,object,embed,form,button,input,textarea,select,noscript,svg,canvas,video,audio').remove();
  clone.find('*').each((_, el) => {
    const node = doc(el);
    const attribs = (el as any).attribs as Record<string, string> | undefined;
    if (attribs) {
      for (const name of Object.keys(attribs)) {
        if (/^on/i.test(name) || name === 'style' || name.startsWith('data-xf')) node.removeAttr(name);
      }
      // lazy images
      const lazy = attribs['data-src'] ?? attribs['data-url'];
      if ((el as any).tagName === 'img' && lazy && !attribs['src']) node.attr('src', absUrl(baseUrl, lazy) ?? lazy);
      for (const name of ['href', 'src']) {
        const v = node.attr(name);
        if (v) {
          const abs = absUrl(baseUrl, v);
          if (abs) node.attr(name, abs);
        }
      }
    }
  });

  const html = clone.html()?.trim() ?? '';
  const text = clone.text().replace(WS, ' ').trim();
  return { html, text };
}

export function firstText(doc: Doc, ...selectors: string[]): string {
  for (const sel of selectors) {
    const v = txt(doc(sel).first());
    if (v) return v;
  }
  return '';
}

export function firstAttr(doc: Doc, name: string, ...selectors: string[]): string | null {
  for (const sel of selectors) {
    const v = attr(doc(sel).first(), name);
    if (v) return v;
  }
  return null;
}

/** site chrome, favicons and avatars are never cover art */
const IMG_SKIP = /\/(?:styles|emoji|smilies|avatars|assets)\//i;
const IMG_EXT_SKIP = /\.(?:svg|ico)$/i;

export function usableImage(url: string | null | undefined): string | null {
  if (!url) return null;
  if (IMG_SKIP.test(url) || IMG_EXT_SKIP.test(url) || /favicon/i.test(url) || /^data:/i.test(url)) return null;
  return url;
}

/** "1.4 GB", "512MB", "1,234.5 MB" -> bytes */
export function parseSize(input?: string | null): number | null {
  if (!input) return null;
  const m = input.replace(/,/g, '').match(/([\d.]+)\s*(bytes?|b|kb|kib|mb|mib|gb|gib|tb|tib)/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2].toLowerCase();
  const mult: Record<string, number> = {
    b: 1,
    byte: 1,
    bytes: 1,
    kb: 1e3,
    kib: 1024,
    mb: 1e6,
    mib: 1024 ** 2,
    gb: 1e9,
    gib: 1024 ** 3,
    tb: 1e12,
    tib: 1024 ** 4,
  };
  return Math.round(n * (mult[unit] ?? 1));
}

export function absoluteImages(doc: Doc, selector: string, baseUrl: string): string[] {
  const out: string[] = [];
  doc(selector)
    .find('img')
    .each((_, el) => {
      const e = doc(el);
      const src = absUrl(baseUrl, e.attr('src') ?? e.attr('data-src'));
      if (src && !out.includes(src)) out.push(src);
    });
  return out;
}
