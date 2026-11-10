import { PageFileHost } from './base';

export class MediaFireHost extends PageFileHost {
  readonly domains = ['mediafire.com'];
  protected readonly selector = '#downloadButton, a.input.popsok, a[href*="download"]';
}
