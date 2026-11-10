import { parseMegaLink } from '../mega';

const FILE_EXTENSION =
  /\.(zip|rar|7z|tar|gz|tgz|xz|bz2|zst|iso|exe|msi|dmg|appimage|apk)(\?|#|$)/i;

export const FILE_HOSTS = [
  'pixeldrain.com', 'mega.nz', 'mediafire.com', 'workupload.com', 'datanodes.to',
  'gofile.io', 'krakenfiles.com', 'buzzheavier.com', 'bzzhr.to', 'vikingfile.com', 'mixdrop.co',
  'dropmefiles.com', 'yourfilestore.com', 'wdho.ru', 'bunkr.si', 'bunkr.ru', 'uploadhaven.com',
];

const RESOLVER_HOSTS = [
  'pixeldrain.com',
  'mediafire.com',
  'workupload.com',
  'datanodes.to',
  'krakenfiles.com',
];

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function hostMatches(host: string, list: readonly string[]): boolean {
  return list.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

export function looksLikeFile(url: string): boolean {
  return FILE_EXTENSION.test(url);
}

/** A MEGA file page; the launcher decrypts it natively, so the browser never downloads it. */
export function isMegaFile(url: string): boolean {
  return parseMegaLink(url) !== null;
}

export function isResolverHost(url: string): boolean {
  const host = hostOf(url);
  return Boolean(host) && hostMatches(host, RESOLVER_HOSTS);
}

/** MEGA's own storage shards: the browser fetches these chunks, which are encrypted and useless alone. */
const STORAGE_HOSTS = ['userstorage.mega.co.nz'];

export function isStorageHost(url: string): boolean {
  const host = hostOf(url);
  return Boolean(host) && hostMatches(host, STORAGE_HOSTS);
}

export function isInternalF95(url: string): boolean {
  const host = hostOf(url);
  return host === 'f95zone.to' || host.endsWith('.f95zone.to');
}

export function shouldWaitForHostPage(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (isInternalF95(url) || looksLikeFile(url) || isResolverHost(url) || isMegaFile(url)) return false;
  return true;
}
