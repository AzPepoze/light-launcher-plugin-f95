import type { HttpClient } from '@light-launcher/plugin-sdk/helpers';
import type { MegaCipherKey } from '../mega';
import { hostOf } from '../hosts';
import { fetchPage, firstLink, genericDownloadLink } from './page';

/** Everything a resolver needs to reach the network through the host. */
export interface ResolveContext {
  headers: Record<string, string>;
  http: HttpClient;
}

export interface ResolvedDownload {
  url: string;
  headers?: Record<string, string>;
  filename?: string | null;
  /** MEGA content is encrypted; the download is decrypted when it finishes */
  decrypt?: MegaCipherKey | null;
}

/** One file host. Each supported host has its own subclass. */
export abstract class FileHostResolver {
  /** Domains this host serves from, e.g. `mediafire.com`. */
  abstract readonly domains: readonly string[];

  /** When false, a resolve error is shown to the user instead of falling back to the original URL. */
  readonly failsOpen: boolean = true;

  matches(url: string): boolean {
    const host = hostOf(url);
    return this.domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  }

  /** Returns the direct download, or null to keep the original URL. */
  abstract resolve(url: string, context: ResolveContext): Promise<ResolvedDownload | null>;
}

/** A host whose page links to the real file through a selector. */
export abstract class PageFileHost extends FileHostResolver {
  protected abstract readonly selector: string;

  async resolve(url: string, context: ResolveContext): Promise<ResolvedDownload | null> {
    const page = await fetchPage(url, context);
    if (!page) return null;
    // the URL already points at the file
    if (!page.html) return { url: page.url };
    const next = firstLink(page.html, page.url, this.selector) ?? genericDownloadLink(page.html, page.url);
    return next ? { url: next } : null;
  }
}
