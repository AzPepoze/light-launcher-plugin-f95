import type { HostServices } from '../../host';
import type { Provider } from '../../provider';
import { createXenForoProvider, type XenForoProfile } from '../xenforo';

export interface F95ProviderOptions {
  profile: XenForoProfile;
  userAgent?: string;
}

/**
 * F95 Zone is the generic XenForo engine plus profiles/f95zone.json.
 * A new forum only needs another JSON profile and a factory this small.
 */
export function createF95Provider(services: HostServices, options: F95ProviderOptions): Provider {
  return createXenForoProvider(options.profile, services, {
    id: 'f95',
    label: 'F95 Zone',
    userAgent: options.userAgent,
  });
}
