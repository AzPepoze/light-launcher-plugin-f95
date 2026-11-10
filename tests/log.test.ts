import { describe, expect, test } from 'bun:test';
import { categoryRgb, createLogger, fnv1a } from '../src/log';

describe('fnv1a', () => {
  test('matches the published FNV-1a 32-bit values', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
  });
});

describe('categoryRgb', () => {
  test('gives the same color for the same category every time', () => {
    expect(categoryRgb('f95')).toEqual(categoryRgb('f95'));
  });

  test('gives pastel colors: every channel is light', () => {
    for (const category of ['f95', 'browser', 'resolver']) {
      expect(categoryRgb(category).every((channel) => channel >= 150)).toBe(true);
    }
  });
});

describe('createLogger', () => {
  test('writes level, timestamp and category without color codes when color is off', () => {
    const lines: string[] = [];
    const log = createLogger('f95', {
      color: false,
      write: (line) => lines.push(line),
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    });
    log('warn', 'slow page', { ms: 900 });
    expect(lines).toEqual(['2026-01-02T03:04:05.000Z WARN  [f95] slow page {"ms":900}\n']);
  });

  test('adds color codes when color is on', () => {
    const lines: string[] = [];
    const log = createLogger('f95', { color: true, write: (line) => lines.push(line) });
    log('error', 'failed');
    expect(lines[0]).toContain('\x1b[');
  });
});
