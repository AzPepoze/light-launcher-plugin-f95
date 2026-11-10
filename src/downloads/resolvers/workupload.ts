import { PageFileHost } from './base';

export class WorkUploadHost extends PageFileHost {
  readonly domains = ['workupload.com'];
  protected readonly selector = '#download-button, a[href*="/download/"]';
}
