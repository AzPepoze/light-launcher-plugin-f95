import { PageFileHost } from './base';

export class KrakenFilesHost extends PageFileHost {
  readonly domains = ['krakenfiles.com'];
  protected readonly selector = '#download, a[href*="/download/"]';
}
