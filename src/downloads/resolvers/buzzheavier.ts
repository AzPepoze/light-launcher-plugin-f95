import { DEFAULT_USER_AGENT } from '@light-launcher/plugin-sdk/helpers';
import { FileHostResolver, type ResolvedDownload } from './base';

const REQUEST_TIMEOUT_MS = 30_000;

/** BuzzHeavier answers `<file>/download` with the real link in an `hx-redirect` header. */
export class BuzzHeavierHost extends FileHostResolver {
  readonly domains = ['buzzheavier.com', 'bzzhr.to'];

  async resolve(url: string): Promise<ResolvedDownload | null> {
    const res = await fetch(`${url.replace(/\/+$/, '')}/download`, {
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const target = res.headers.get('hx-redirect');
    await res.body?.cancel().catch(() => {});
    if (!target) return null;
    return { url: new URL(target, url).toString() };
  }
}
