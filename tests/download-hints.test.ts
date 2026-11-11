import { describe, expect, test } from 'bun:test';
import type { DownloadHintSettings } from '../src/downloads/hints';
import { downloadHints, FALLBACK_GAME_FOLDER, sanitizeGameFolder } from '../src/downloads/hints';

/** The host's folder-path pattern; a folder name must always pass it. */
const FOLDER_PATH = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)(?!.*\/$)[^\\:\u0000-\u001f]+$/;

const base: DownloadHintSettings = {
  downloadRoot: 'downloads',
  gameSubfolder: true,
  installAfterDownload: false,
  deleteArchiveAfterInstall: false,
};

const game = { title: 'My Game' };

describe('sanitizeGameFolder', () => {
  const cases: Array<[string, string]> = [
    ['My Game', 'My Game'],
    ['a/b\\c', 'abc'],
    ['a:b*c?d"e<f>g|h', 'abcdefgh'],
    ['  ...Name   With   Spaces  ', 'Name With Spaces'],
    ['..', FALLBACK_GAME_FOLDER],
    ['...', FALLBACK_GAME_FOLDER],
    ['', FALLBACK_GAME_FOLDER],
    ['   ', FALLBACK_GAME_FOLDER],
    ['\u0001\u0002name', 'name'],
    ['Name...', 'Name...'],
    ['Emoji 🎮 Game', 'Emoji 🎮 Game'],
  ];

  test.each(cases)('turns %j into %j', (title, expected) => {
    expect(sanitizeGameFolder(title)).toBe(expected);
  });

  test('keeps every result a safe single folder segment', () => {
    for (const title of ['..', 'a/b', 'a\\b', 'C:', '../up', 'x'.repeat(500), '🎮']) {
      const folder = sanitizeGameFolder(title);
      expect(folder).not.toContain('/');
      expect(FOLDER_PATH.test(folder)).toBe(true);
    }
  });

  test('caps a very long title without splitting a character', () => {
    const folder = sanitizeGameFolder('A'.repeat(500));
    expect(folder.length).toBe(80);
    expect(folder).toBe('A'.repeat(80));
    expect([...sanitizeGameFolder('🎮'.repeat(200))]).toHaveLength(80);
  });
});

describe('downloadHints', () => {
  const cases: Array<[string, DownloadHintSettings, Record<string, unknown>, { title: string }?]> = [
    ['defaults', base, { root: 'downloads', subfolder: 'My Game' }],
    ['games root', { ...base, downloadRoot: 'games' }, { root: 'games', subfolder: 'My Game' }],
    ['no game folder', { ...base, gameSubfolder: false }, { root: 'downloads' }],
    [
      'install',
      { ...base, installAfterDownload: true },
      { root: 'downloads', subfolder: 'My Game', install: true, installSubfolder: 'My Game', deleteArchive: false },
    ],
    [
      'install without a game folder',
      { ...base, gameSubfolder: false, installAfterDownload: true },
      { root: 'downloads', install: true, deleteArchive: false },
    ],
    [
      'delete after install',
      { ...base, installAfterDownload: true, deleteArchiveAfterInstall: true },
      {
        root: 'downloads',
        subfolder: 'My Game',
        install: true,
        installSubfolder: 'My Game',
        deleteArchive: true,
      },
    ],
    [
      'delete is ignored without install',
      { ...base, deleteArchiveAfterInstall: true },
      { root: 'downloads', subfolder: 'My Game' },
    ],
    ['hostile title', base, { root: 'downloads', subfolder: 'ab' }, { title: 'a/b' }],
  ];

  test.each(cases.map(([name, settings, expected, selectedGame]) => [name, settings, expected, selectedGame ?? game]))(
    '%s',
    (_name, settings, expected, selectedGame) => {
      expect(downloadHints(settings as DownloadHintSettings, selectedGame as { title: string })).toEqual(expected);
    },
  );
});
