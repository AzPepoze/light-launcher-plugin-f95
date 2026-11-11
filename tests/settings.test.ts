import { describe, expect, test } from 'bun:test';
import { DEFAULT_USER_AGENT } from '@light-launcher/plugin-sdk/helpers';
import { settingsFrom } from '../src/settings';

describe('settingsFrom', () => {
  test('uses the built-in defaults when the host sends nothing', () => {
    expect(settingsFrom({})).toEqual({
      userAgent: DEFAULT_USER_AGENT,
      browserPath: null,
      dumpDir: null,
    });
  });

  test('keeps text values the host sends', () => {
    expect(settingsFrom({ userAgent: 'custom/1.0', browserPath: '/opt/chrome', dumpDir: '/tmp/dump' })).toEqual({
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
    });
  });
});
