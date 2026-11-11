import { DEFAULT_USER_AGENT } from '@light-launcher/plugin-sdk/helpers';

/** The values the plugin reads from the host. A missing or invalid value uses its default. */
export interface PluginSettings {
  userAgent: string;
  /** null uses the usual install locations */
  browserPath: string | null;
  /** null turns off dumps of pages that fail to parse */
  dumpDir: string | null;
}

function textSetting(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function settingsFrom(raw: Record<string, unknown>): PluginSettings {
  return {
    userAgent: textSetting(raw, 'userAgent') ?? DEFAULT_USER_AGENT,
    browserPath: textSetting(raw, 'browserPath'),
    dumpDir: textSetting(raw, 'dumpDir'),
  };
}
