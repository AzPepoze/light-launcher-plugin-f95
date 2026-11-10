import { FileHostResolver, type ResolvedDownload } from './base';

export class PixelDrainHost extends FileHostResolver {
  readonly domains = ['pixeldrain.com'];

  async resolve(url: string): Promise<ResolvedDownload | null> {
    const match = new URL(url).pathname.match(/^\/u\/([^/]+)/i);
    if (!match) return null;
    return { url: `https://pixeldrain.com/api/file/${match[1]}?download` };
  }
}
