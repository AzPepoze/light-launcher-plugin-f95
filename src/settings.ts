import { DEFAULT_USER_AGENT } from '@light-launcher/plugin-sdk/helpers';
import type { DownloadRoot } from '@light-launcher/plugin-sdk/types';
import { DOWNLOAD_SETTINGS_DEFAULTS, type DownloadSettings } from '@light-launcher/plugin-sdk';
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
  /** null uses the usual install locations */
  browserPath: string | null;
  /** null turns off dumps of pages that fail to parse */
  dumpDir: string | null;
  filePreferences: FilePreferences;
  /** 0 checks every time */
  updateCheckIntervalMs: number;
  /** extra wait between two requests, on top of the launcher's own spacing */
  requestDelayMs: number;
  verboseLogging: boolean;
  browserAssistEnabled: boolean;
  /** use the plugin's own Chrome/Edge over CDP instead of the launcher's embedded browser */
  useExternalChrome: boolean;
}

/** A settings object, or a reader called again for each download. */
export type SettingsSource = PluginSettings | (() => PluginSettings | Promise<PluginSettings>);

const HOUR_MS = 60 * 60 * 1000;
const MAX_UPDATE_INTERVAL_HOURS = 720;
const MAX_REQUEST_DELAY_MS = 10_000;

function textSetting(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function boolSetting(raw: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = raw[key];
  return typeof value === 'boolean' ? value : fallback;
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

function downloadRootSetting(raw: Record<string, unknown>): DownloadRoot {
  return raw.downloadRoot === 'games' ? 'games' : DOWNLOAD_SETTINGS_DEFAULTS.downloadRoot;
}

function filePreferencesFrom(raw: Record<string, unknown>): FilePreferences {
  return {
    preferredHosts: hostListSetting(raw, 'preferredHosts'),
    preferredPlatform: platformSetting(raw, 'preferredPlatform'),
  };
}

/** Hours in the setting, kept between 0 and the schema maximum, as milliseconds. */
function updateIntervalMsSetting(raw: Record<string, unknown>): number {
  const value = raw.updateCheckIntervalHours;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), MAX_UPDATE_INTERVAL_HOURS) * HOUR_MS;
}

function requestDelaySetting(raw: Record<string, unknown>): number {
  const value = raw.requestDelayMs;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), MAX_REQUEST_DELAY_MS);
}

export function settingsFrom(raw: Record<string, unknown>): PluginSettings {
  return {
    userAgent: textSetting(raw, 'userAgent') ?? DEFAULT_USER_AGENT,
    browserPath: textSetting(raw, 'browserPath'),
    dumpDir: textSetting(raw, 'dumpDir'),
    filePreferences: filePreferencesFrom(raw),
    updateCheckIntervalMs: updateIntervalMsSetting(raw),
    requestDelayMs: requestDelaySetting(raw),
    verboseLogging: boolSetting(raw, 'verboseLogging', false),
    browserAssistEnabled: boolSetting(raw, 'browserAssistEnabled', true),
    useExternalChrome: boolSetting(raw, 'useExternalChrome', false),
    downloadRoot: downloadRootSetting(raw),
    gameSubfolder: boolSetting(raw, 'gameSubfolder', DOWNLOAD_SETTINGS_DEFAULTS.gameSubfolder),
    installAfterDownload: boolSetting(raw, 'installAfterDownload', DOWNLOAD_SETTINGS_DEFAULTS.installAfterDownload),
    deleteArchiveAfterInstall: boolSetting(raw, 'deleteArchiveAfterInstall', DOWNLOAD_SETTINGS_DEFAULTS.deleteArchiveAfterInstall),
  };
}

/** The values the schema defaults describe. */
export const DEFAULT_SETTINGS: Readonly<PluginSettings> = settingsFrom({});
