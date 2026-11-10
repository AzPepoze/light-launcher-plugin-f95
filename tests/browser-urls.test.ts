import { describe, expect, test } from 'bun:test';
import {
  isInternalF95,
  isMegaFile,
  isResolverHost,
  isStorageHost,
  looksLikeFile,
  shouldWaitForHostPage,
} from '../src/downloads/browser/urls';

describe('browser download URLs', () => {
  test('a file-host landing page keeps the browser assist waiting', () => {
    expect(shouldWaitForHostPage('https://bzzhr.to/abc123')).toBe(true);
  });

  test('a direct file link does not wait', () => {
    expect(shouldWaitForHostPage('https://bzzhr.to/download/Game.zip')).toBe(false);
    expect(looksLikeFile('https://bzzhr.to/download/Game.zip')).toBe(true);
  });

  test('looksLikeFile matches archives before a query or fragment', () => {
    expect(looksLikeFile('https://example.com/Game.7z?token=1')).toBe(true);
    expect(looksLikeFile('https://example.com/Game.rar#download')).toBe(true);
    expect(looksLikeFile('https://example.com/threads/example.123/')).toBe(false);
  });

  test('resolver hosts are recognised and do not wait', () => {
    expect(isResolverHost('https://pixeldrain.com/u/abc123')).toBe(true);
    expect(isResolverHost('https://www.mediafire.com/file/abc')).toBe(true);
    expect(isResolverHost('https://evilpixeldrain.com/u/abc123')).toBe(false);
    expect(shouldWaitForHostPage('https://pixeldrain.com/u/abc123')).toBe(false);
  });

  test('F95 pages are internal and do not wait', () => {
    expect(isInternalF95('https://f95zone.to/threads/example.123/')).toBe(true);
    expect(isInternalF95('https://attachments.f95zone.to/file.png')).toBe(true);
    expect(isInternalF95('https://f95zone.to.evil.com/threads/example.123/')).toBe(false);
    expect(shouldWaitForHostPage('https://f95zone.to/threads/example.123/')).toBe(false);
  });

  test('MEGA storage chunks are ignored and MEGA file pages are captured', () => {
    expect(isStorageHost('https://gfs214n231.userstorage.mega.co.nz/abc')).toBe(true);
    expect(isStorageHost('https://userstorage.mega.co.nz.evil.com/abc')).toBe(false);
    expect(isMegaFile(`https://mega.nz/file/abc#${'a'.repeat(43)}`)).toBe(true);
    expect(shouldWaitForHostPage(`https://mega.nz/file/abc#${'a'.repeat(43)}`)).toBe(false);
  });

  test('random https pages wait for the host page', () => {
    expect(shouldWaitForHostPage('https://example.com/some/page')).toBe(true);
    expect(shouldWaitForHostPage('about:blank')).toBe(false);
  });
});
