import { DEFAULT_USER_AGENT } from '@light-launcher/plugin-sdk/helpers';
import {
  DEFAULT_FILE_PREFERENCES,
  PLATFORM_CHOICES,
  RANKED_HOSTS,
  type FilePreferences,
  type PlatformChoice,
  type RankedHost,
} from './downloads/preferences';

/** The values the plugin reads from the host. A missing or invalid value uses its default. */
export interface PluginSettings {
  userAgent: string;
  /** null uses the usual install locations */
  browserPath: string | null;
  /** null turns off dumps of pages that fail to parse */
  dumpDir: string | null;
  filePreferences: FilePreferences;
}

function textSetting(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function isRankedHost(value: unknown): value is RankedHost {
  return typeof value === 'string' && (RANKED_HOSTS as readonly string[]).includes(value);
}

/** Unknown and repeated names are dropped; the order the user chose is kept. */
function hostListSetting(raw: Record<string, unknown>, key: string): RankedHost[] {
  const value = raw[key];
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isRankedHost))];
}

function platformSetting(raw: Record<string, unknown>, key: string): PlatformChoice {
  const value = raw[key];
  const known = (PLATFORM_CHOICES as readonly unknown[]).includes(value);
  return known ? (value as PlatformChoice) : DEFAULT_FILE_PREFERENCES.preferredPlatform;
}

function filePreferencesFrom(raw: Record<string, unknown>): FilePreferences {
  return {
    preferredHosts: hostListSetting(raw, 'preferredHosts'),
    preferredPlatform: platformSetting(raw, 'preferredPlatform'),
  };
}

export function settingsFrom(raw: Record<string, unknown>): PluginSettings {
  return {
    userAgent: textSetting(raw, 'userAgent') ?? DEFAULT_USER_AGENT,
    browserPath: textSetting(raw, 'browserPath'),
    dumpDir: textSetting(raw, 'dumpDir'),
    filePreferences: filePreferencesFrom(raw),
  };
}
