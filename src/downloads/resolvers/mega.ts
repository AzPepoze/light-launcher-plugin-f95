import { FileHostResolver, type ResolvedDownload } from './base';
import { parseMegaLink, resolveMega } from '../mega';

/** MEGA file links are decrypted here; folder links are not supported. */
export class MegaHost extends FileHostResolver {
  readonly domains = ['mega.nz'];
  /** a MEGA error must reach the user; the page URL cannot be downloaded anyway */
  readonly failsOpen = false;

  matches(url: string): boolean {
    return parseMegaLink(url) !== null;
  }

  async resolve(url: string): Promise<ResolvedDownload | null> {
    const link = parseMegaLink(url);
    if (!link) return null;
    const file = await resolveMega(link);
    return {
      url: file.url,
      filename: file.filename,
      decrypt: { aesKey: file.aesKey, nonce: file.nonce },
    };
  }
}
