import type { FileHostResolver } from './base';
import { BuzzHeavierHost } from './buzzheavier';
import { DataNodesHost } from './datanodes';
import { KrakenFilesHost } from './krakenfiles';
import { MediaFireHost } from './mediafire';
import { MegaHost } from './mega';
import { MixDropHost } from './mixdrop';
import { PixelDrainHost } from './pixeldrain';
import { WorkUploadHost } from './workupload';

export type { FileHostResolver, ResolvedDownload } from './base';

const RESOLVERS: readonly FileHostResolver[] = [
  new PixelDrainHost(),
  new MediaFireHost(),
  new WorkUploadHost(),
  new DataNodesHost(),
  new KrakenFilesHost(),
  new BuzzHeavierHost(),
  new MixDropHost(),
  new MegaHost(),
];

export function findResolver(url: string): FileHostResolver | null {
  return RESOLVERS.find((resolver) => resolver.matches(url)) ?? null;
}
