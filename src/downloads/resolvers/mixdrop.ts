import { FileHostResolver, type ResolveContext, type ResolvedDownload } from './base';
import { fetchPage, needsHumanStep } from './page';

/** The page script sets `MDCore.wurl` to the file's delivery URL. */
const WURL = /MDCore\.wurl\s*=\s*["']([^"']+)["']/;

export class MixDropHost extends FileHostResolver {
  readonly domains = ['mixdrop.co'];

  async resolve(url: string, context: ResolveContext): Promise<ResolvedDownload | null> {
    const page = await fetchPage(url, context);
    if (page && needsHumanStep(page.html)) return { url, needsHuman: true };
    const raw = page ? WURL.exec(page.html)?.[1] : undefined;
    if (!raw) return null;
    return { url: new URL(raw, url).toString() };
  }
}
