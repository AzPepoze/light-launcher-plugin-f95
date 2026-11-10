import type { LogFn, LogLevel } from './host';

/**
 * Logs go to stderr. Stdout carries the JSON-RPC stream, so it must stay clean.
 * Colors are used only on a TTY and when NO_COLOR is not set.
 */

const RESET = '\x1b[0m';
const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const LEVEL_TAGS: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

export interface LoggerOptions {
  color?: boolean;
  write?: (line: string) => void;
  now?: () => Date;
}

/** FNV-1a: the same input always gives the same number, in every run. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function sectorRgb(hue: number, chroma: number, x: number): [number, number, number] {
  if (hue < 60) return [chroma, x, 0];
  if (hue < 120) return [x, chroma, 0];
  if (hue < 180) return [0, chroma, x];
  if (hue < 240) return [0, x, chroma];
  if (hue < 300) return [x, 0, chroma];
  return [chroma, 0, x];
}

/** HSL to RGB with 0-1 saturation and lightness; hue in degrees. */
export function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;
  return sectorRgb(hue, chroma, x).map((value) => Math.round((value + offset) * 255)) as [number, number, number];
}

/** A stable pastel color per category: hue from the hash, high lightness, moderate saturation. */
export function categoryRgb(category: string): [number, number, number] {
  return hslToRgb(fnv1a(category) % 360, 0.55, 0.8);
}

function colorize(text: string, sgr: string, enabled: boolean): string {
  return enabled ? `${sgr}${text}${RESET}` : text;
}

function categorySgr(category: string): string {
  const [r, g, b] = categoryRgb(category);
  return `\x1b[38;2;${r};${g};${b}m`;
}

function formatExtra(extra: unknown): string {
  if (extra === undefined) return '';
  if (extra instanceof Error) return ` ${extra.message}`;
  if (typeof extra === 'string') return ` ${extra}`;
  return ` ${JSON.stringify(extra)}`;
}

export function defaultColorEnabled(): boolean {
  return Boolean(process.stderr.isTTY) && !process.env.NO_COLOR;
}

export function createLogger(category: string, options: LoggerOptions = {}): LogFn {
  const color = options.color ?? defaultColorEnabled();
  const write = options.write ?? ((line: string) => process.stderr.write(line));
  const now = options.now ?? (() => new Date());
  const categoryText = colorize(`[${category}]`, categorySgr(category), color);

  return (level, message, extra) => {
    const time = colorize(now().toISOString(), '\x1b[90m', color);
    const levelText = colorize(LEVEL_TAGS[level], LEVEL_COLORS[level], color);
    // one write per line keeps lines whole when several sources log at once
    write(`${time} ${levelText} ${categoryText} ${message}${formatExtra(extra)}\n`);
  };
}
