import { DEFAULT_USER_AGENT } from '@light-launcher/plugin-sdk/helpers';
import { FileHostResolver, type ResolveContext, type ResolvedDownload } from './base';

/** BuzzHeavier answers `<file>/download` with the real link in an `hx-redirect` header. */
export class BuzzHeavierHost extends FileHostResolver {
  readonly domains = ['buzzheavier.com', 'bzzhr.to'];

  async resolve(url: string, { http }: ResolveContext): Promise<ResolvedDownload | null> {
    const res = await http.request(`${url.replace(/\/+$/, '')}/download`, {
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
    });
    const target = res.headers['hx-redirect'];
    if (!target) return null;
    return { url: new URL(target, url).toString() };
  }
}
