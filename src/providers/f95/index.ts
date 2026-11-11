import type { CallHooks, SourceProvider } from '@light-launcher/plugin-sdk/runtime';
import type { SyncStatus } from '@light-launcher/plugin-sdk/types';
import type { PluginSettings, SettingsSource } from '../../settings';
import type { FilePreferences } from '../../downloads/preferences';
import type { HostServices } from '../../host';
import { indexStatus, syncThreadIndex } from '../../library/f95-index';
import { createXenForoProvider, type XenForoProfile } from '../xenforo';

export interface F95ProviderOptions {
  profile: XenForoProfile;
  userAgent?: string;
  filePreferences?: FilePreferences;
  updateCheckIntervalMs?: number;
  /** read on each call, so settings changes apply without a restart */
  getSettings?: () => Promise<PluginSettings>;
  /** another way to pass the same values, as an object or a reader */
  settings?: SettingsSource;
}

/**
 * F95 Zone is the generic XenForo engine plus profiles/f95zone.json.
 * A new forum only needs another JSON profile and a factory this small.
 */
export function createF95Provider(services: HostServices, options: F95ProviderOptions): SourceProvider {
  const xenforo = createXenForoProvider(options.profile, services, {
    id: 'f95',
    label: 'F95 Zone',
    userAgent: options.userAgent,
    filePreferences: options.filePreferences,
    updateCheckIntervalMs: options.updateCheckIntervalMs,
    getSettings: options.getSettings,
    settings: options.settings,
  });
  return { ...xenforo, sync: (hooks) => syncIndex(services, xenforo.id, hooks) };
}

/** Pulls the thread index into the host cache and reports its status. */
async function syncIndex(services: HostServices, source: string, hooks: CallHooks): Promise<SyncStatus> {
  await syncThreadIndex(services, source, (message) => hooks.progress?.({ message }));
  return indexStatus(services, source);
}

export { downloadHints, sanitizeGameFolder } from './downloads';
