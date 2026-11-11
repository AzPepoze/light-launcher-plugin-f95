import type { DownloadRoot, GameRef, PrepareDownloadResult } from '@light-launcher/plugin-sdk/types';

/** The settings that decide where a prepared download goes on the host. */
export interface DownloadHintSettings {
  downloadRoot: DownloadRoot;
  gameSubfolder: boolean;
  installAfterDownload: boolean;
  deleteArchiveAfterInstall: boolean;
}

export type DownloadHints = Pick<
  PrepareDownloadResult,
  'root' | 'subfolder' | 'install' | 'installSubfolder' | 'deleteArchive'
>;

/** Name used when nothing safe is left of the game title. */
export const FALLBACK_GAME_FOLDER = 'game';
const MAX_FOLDER_LENGTH = 80;
const UNSAFE_PATH_CHARS = /[/\\:*?"<>|\u0000-\u001f\u007f-\u009f]/g;

/** Makes a game title safe as one folder name under the download root. */
export function sanitizeGameFolder(title: string): string {
  const cleaned = title
    .replace(UNSAFE_PATH_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '');
  const capped = [...cleaned].slice(0, MAX_FOLDER_LENGTH).join('').trimEnd();
  return capped || FALLBACK_GAME_FOLDER;
}

export const safeFolderName = sanitizeGameFolder;
export const sanitizeFolderName = sanitizeGameFolder;

/** Only the hint fields the user's settings turn on. */
export function downloadHints(settings: DownloadHintSettings, game: Pick<GameRef, 'title'>): DownloadHints {
  const hints: DownloadHints = { root: settings.downloadRoot };
  if (settings.gameSubfolder) hints.subfolder = sanitizeGameFolder(game.title);
  if (settings.installAfterDownload) {
    hints.install = true;
    if (hints.subfolder) hints.installSubfolder = hints.subfolder;
    hints.deleteArchive = settings.deleteArchiveAfterInstall;
  }
  return hints;
}
