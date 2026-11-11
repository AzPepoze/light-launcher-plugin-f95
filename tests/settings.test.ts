import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { DEFAULT_USER_AGENT } from '@light-launcher/plugin-sdk/helpers';
import manifest from '../plugin.json';
import settingsSchema from '../settings.schema.json';
import { settingsFrom } from '../src/settings';

/** The values a schema's defaults describe, the way the launcher stores them. */
function defaultsOf(schema: { properties: Record<string, { default?: unknown }> }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(schema.properties)) {
    if (property.default !== undefined) out[key] = property.default;
  }
  return out;
}

describe('settings.schema.json', () => {
  // x-ll-* keys are host UI hints: validators must ignore them, so strict mode is off
  const ajv = new Ajv2020({ allErrors: true, strict: false });

  test('is a valid JSON Schema', () => {
    expect(ajv.validateSchema(settingsSchema)).toBe(true);
  });

  test('is referenced by plugin.json and the file exists', () => {
    expect(manifest.contributes.settings).toEqual({ $ref: 'settings.schema.json' });
    expect(fs.existsSync(new URL('../settings.schema.json', import.meta.url))).toBe(true);
  });

  test('every setting has a title, a description, a default and a group', () => {
    for (const [key, property] of Object.entries(settingsSchema.properties)) {
      expect({ key, title: typeof property.title }).toEqual({ key, title: 'string' });
      expect({ key, description: typeof property.description }).toEqual({ key, description: 'string' });
      expect({ key, hasDefault: property.default !== undefined }).toEqual({ key, hasDefault: true });
      expect({ key, group: typeof property['x-ll-group'] }).toEqual({ key, group: 'string' });
    }
  });

  test('its defaults keep the behaviour the plugin had before settings existed', () => {
    expect(settingsFrom(defaultsOf(settingsSchema))).toEqual(settingsFrom({}));
    expect(settingsFrom({})).toEqual({
      userAgent: DEFAULT_USER_AGENT,
      browserPath: null,
      dumpDir: null,
      filePreferences: { preferredHosts: [], preferredPlatform: 'any' },
      updateCheckIntervalMs: 0,
      requestDelayMs: 0,
      verboseLogging: false,
      browserAssistEnabled: true,
      useExternalChrome: false,
      downloadRoot: 'downloads',
      gameSubfolder: true,
      installAfterDownload: false,
      deleteArchiveAfterInstall: false,
    });
  });

  test('accepts a complete set of values and rejects unknown keys', () => {
    const validate = ajv.compile(settingsSchema);
    expect(validate(defaultsOf(settingsSchema))).toBe(true);
    expect(validate({ notASetting: true })).toBe(false);
  });
});

describe('settingsFrom', () => {
  test('uses the built-in defaults when the host sends nothing', () => {
    expect(settingsFrom({})).toEqual({
      userAgent: DEFAULT_USER_AGENT,
      browserPath: null,
      dumpDir: null,
      filePreferences: { preferredHosts: [], preferredPlatform: 'any' },
      updateCheckIntervalMs: 0,
      requestDelayMs: 0,
      verboseLogging: false,
      browserAssistEnabled: true,
      useExternalChrome: false,
      downloadRoot: 'downloads',
      gameSubfolder: true,
      installAfterDownload: false,
      deleteArchiveAfterInstall: false,
    });
  });

  test('keeps text values the host sends', () => {
    expect(settingsFrom({ userAgent: 'custom/1.0', browserPath: '/opt/chrome', dumpDir: '/tmp/dump' })).toMatchObject({
      userAgent: 'custom/1.0',
      browserPath: '/opt/chrome',
      dumpDir: '/tmp/dump',
    });
  });

  test('treats blank and non-text values as not set', () => {
    expect(settingsFrom({ userAgent: '  ', browserPath: '', dumpDir: 42 })).toEqual({
      userAgent: DEFAULT_USER_AGENT,
      browserPath: null,
      dumpDir: null,
      filePreferences: { preferredHosts: [], preferredPlatform: 'any' },
      updateCheckIntervalMs: 0,
      requestDelayMs: 0,
      verboseLogging: false,
      browserAssistEnabled: true,
      useExternalChrome: false,
      downloadRoot: 'downloads',
      gameSubfolder: true,
      installAfterDownload: false,
      deleteArchiveAfterInstall: false,
    });
  });

  test('keeps the order of the preferred hosts and drops unknown and repeated names', () => {
    const { filePreferences } = settingsFrom({ preferredHosts: ['mega', 'nope', 'pixeldrain', 'mega', 7] });
    expect(filePreferences.preferredHosts).toEqual(['mega', 'pixeldrain']);
  });

  test('reads the update interval in hours as milliseconds and keeps it in range', () => {
    const hour = 60 * 60 * 1000;
    expect(settingsFrom({ updateCheckIntervalHours: 6 }).updateCheckIntervalMs).toBe(6 * hour);
    expect(settingsFrom({ updateCheckIntervalHours: -3 }).updateCheckIntervalMs).toBe(0);
    expect(settingsFrom({ updateCheckIntervalHours: 10_000 }).updateCheckIntervalMs).toBe(720 * hour);
    expect(settingsFrom({ updateCheckIntervalHours: 'soon' }).updateCheckIntervalMs).toBe(0);
  });

  test('reads the request delay as whole milliseconds within 0 to 10 seconds', () => {
    expect(settingsFrom({ requestDelayMs: 400 }).requestDelayMs).toBe(400);
    expect(settingsFrom({ requestDelayMs: -5 }).requestDelayMs).toBe(0);
    expect(settingsFrom({ requestDelayMs: 99_999 }).requestDelayMs).toBe(10_000);
    expect(settingsFrom({ requestDelayMs: 'fast' }).requestDelayMs).toBe(0);
  });

  test('turns verbose logging on only for a true value', () => {
    expect(settingsFrom({ verboseLogging: true }).verboseLogging).toBe(true);
    expect(settingsFrom({ verboseLogging: 'yes' }).verboseLogging).toBe(false);
  });

  test('browser assist is on unless the host sends false', () => {
    expect(settingsFrom({}).browserAssistEnabled).toBe(true);
    expect(settingsFrom({ browserAssistEnabled: false }).browserAssistEnabled).toBe(false);
    expect(settingsFrom({ browserAssistEnabled: 'no' }).browserAssistEnabled).toBe(true);
  });

  test('the external Chrome route is off unless the host sends true', () => {
    expect(settingsFrom({}).useExternalChrome).toBe(false);
    expect(settingsFrom({ useExternalChrome: true }).useExternalChrome).toBe(true);
    expect(settingsFrom({ useExternalChrome: 'yes' }).useExternalChrome).toBe(false);
  });

  test('reads the download folder choice and its switches', () => {
    const settings = settingsFrom({
      downloadRoot: 'games',
      gameSubfolder: false,
      installAfterDownload: true,
      deleteArchiveAfterInstall: true,
    });
    expect(settings).toMatchObject({
      downloadRoot: 'games',
      gameSubfolder: false,
      installAfterDownload: true,
      deleteArchiveAfterInstall: true,
    });
  });

  test('an unknown download root falls back to downloads', () => {
    expect(settingsFrom({ downloadRoot: 'elsewhere' }).downloadRoot).toBe('downloads');
  });

  test('reads the platform and falls back to any for an unknown value', () => {
    expect(settingsFrom({ preferredPlatform: 'linux' }).filePreferences.preferredPlatform).toBe('linux');
    expect(settingsFrom({ preferredPlatform: 'android' }).filePreferences.preferredPlatform).toBe('any');
  });
});
