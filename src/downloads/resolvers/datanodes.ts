import { PageFileHost } from './base';

export class DataNodesHost extends PageFileHost {
  readonly domains = ['datanodes.to'];
  protected readonly selector = 'a[href*="/download/"], #download-button';
}
