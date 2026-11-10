import fs from 'node:fs';
import path from 'node:path';

const LINUX = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'microsoft-edge',
  'microsoft-edge-stable',
  'brave-browser',
];

function windowsPaths(): string[] {
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(
    (value): value is string => Boolean(value),
  );
  const relatives = [
    ['Google', 'Chrome', 'Application', 'chrome.exe'],
    ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
    ['Chromium', 'Application', 'chrome.exe'],
  ];
  return roots.flatMap((root) => relatives.map((parts) => path.join(root, ...parts)));
}

function macPaths(): string[] {
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ];
}

/** An explicit browser path wins, then the usual Chrome/Edge/Chromium locations. */
export function findBrowser(browserPath?: string | null): string | null {
  const override = browserPath?.trim();
  if (override) return fs.existsSync(override) ? override : null;

  if (process.platform === 'win32') {
    for (const candidate of windowsPaths()) if (fs.existsSync(candidate)) return candidate;
  }
  if (process.platform === 'darwin') {
    for (const candidate of macPaths()) if (fs.existsSync(candidate)) return candidate;
  }

  for (const name of LINUX) {
    const found = Bun.which(name);
    if (found) return found;
  }
  for (const candidate of macPaths()) if (fs.existsSync(candidate)) return candidate;
  return null;
}
