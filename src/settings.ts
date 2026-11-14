import {
  DEFAULT_USER_AGENT,
  boolOr,
  intInRange,
  parseDownloadSettings,
  textOr,
} from '@light-launcher/plugin-sdk/helpers';
import { type DownloadSettings } from '@light-launcher/plugin-sdk/downloads';
import {
  DEFAULT_FILE_PREFERENCES,
  PLATFORM_CHOICES,
  RANKED_HOSTS,
  type FilePreferences,
  type PlatformChoice,
  type RankedHost,
} from './downloads/preferences';

/** The values the plugin reads from the host. A missing or invalid value uses its default. */
export interface PluginSettings extends DownloadSettings {
  userAgent: string;
  /** null turns off dumps of pages that fail to parse */
  dumpDir: string | null;
  filePreferences: FilePreferences;
  /** 0 checks every time */
  updateCheckIntervalMs: number;
  /** extra wait between two requests, on top of the launcher's own spacing */
  requestDelayMs: number;
  verboseLogging: boolean;
  browserAssistEnabled: boolean;
}

const HOUR_MS = 60 * 60 * 1000;
const MAX_UPDATE_INTERVAL_HOURS = 720;
const MAX_REQUEST_DELAY_MS = 10_000;

function textSetting(raw: Record<string, unknown>, key: string): string | null {
  return textOr(raw[key], '') || null;
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

/** Keeps a number between 0 and max; invalid values use 0. */
function clampedSetting(raw: Record<string, unknown>, key: string, max: number, round = false): number {
  const value = raw[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const bounded = Math.min(Math.max(round ? Math.round(value) : value, 0), max);
  // the SDK check rejects fractions, so a fractional value falls back to its clamped value
  return intInRange(0, max)(bounded, bounded);
}

function updateIntervalMsSetting(raw: Record<string, unknown>): number {
  return clampedSetting(raw, 'updateCheckIntervalHours', MAX_UPDATE_INTERVAL_HOURS) * HOUR_MS;
}

function requestDelaySetting(raw: Record<string, unknown>): number {
  return clampedSetting(raw, 'requestDelayMs', MAX_REQUEST_DELAY_MS, true);
}

export function settingsFrom(raw: Record<string, unknown>): PluginSettings {
  return {
    userAgent: textOr(raw.userAgent, DEFAULT_USER_AGENT) || DEFAULT_USER_AGENT,
    dumpDir: textSetting(raw, 'dumpDir'),
    filePreferences: filePreferencesFrom(raw),
    updateCheckIntervalMs: updateIntervalMsSetting(raw),
    requestDelayMs: requestDelaySetting(raw),
    verboseLogging: boolOr(raw.verboseLogging, false),
    browserAssistEnabled: boolOr(raw.browserAssistEnabled, true),
    ...parseDownloadSettings(raw),
  };
}
