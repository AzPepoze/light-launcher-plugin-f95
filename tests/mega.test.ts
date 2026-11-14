import { describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import {
  decryptName,
  deriveKeys,
  megaDecryptField,
  parseMegaLink,
} from '../src/downloads/mega';

const FILE_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i * 7 + 1));
const KEY_TEXT = FILE_KEY.toString('base64url');

describe('MEGA links', () => {
  test('a file link splits into handle and key', () => {
    expect(parseMegaLink(`https://mega.nz/file/xGEwBahC#${KEY_TEXT}`)).toEqual({
      handle: 'xGEwBahC',
      key: KEY_TEXT,
    });
  });

  test('the older #! link form is read too', () => {
    expect(parseMegaLink(`https://mega.nz/#!xGEwBahC!${KEY_TEXT}`)).toEqual({
      handle: 'xGEwBahC',
      key: KEY_TEXT,
    });
  });

  test('other hosts and folder links are not MEGA files', () => {
    expect(parseMegaLink(`https://mega.nz.evil.com/file/abc#${KEY_TEXT}`)).toBeNull();
    expect(parseMegaLink(`https://mega.nz/folder/abc#${KEY_TEXT}`)).toBeNull();
    expect(parseMegaLink('https://mega.nz/file/abc')).toBeNull();
  });
});

describe('MEGA keys', () => {
  test('the AES key is the XOR of both halves of the file key', () => {
    const { aesKey, nonce } = deriveKeys(KEY_TEXT);
    expect(aesKey.length).toBe(16);
    expect(aesKey[0]).toBe((FILE_KEY[0] ?? 0) ^ (FILE_KEY[16] ?? 0));
    expect(nonce.equals(FILE_KEY.subarray(16, 24))).toBe(true);
  });

  test('a key that is not 32 bytes is rejected', () => {
    expect(() => deriveKeys(Buffer.alloc(16).toString('base64url'))).toThrow('32 bytes');
  });

  test('the name is read from the MEGA attribute block', () => {
    const { aesKey } = deriveKeys(KEY_TEXT);
    const plain = Buffer.from('MEGA{"n":"Toybox 0.1.4.7z"}');
    const padded = Buffer.concat([plain, Buffer.alloc((16 - (plain.length % 16)) % 16)]);
    const cipher = crypto.createCipheriv('aes-128-cbc', aesKey, Buffer.alloc(16));
    cipher.setAutoPadding(false);
    const attributes = Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64url');
    expect(decryptName(attributes, aesKey)).toBe('Toybox 0.1.4.7z');
  });

  test('the download field is AES-128-CTR with base64 key and nonce', () => {
    const key = deriveKeys(KEY_TEXT);
    expect(megaDecryptField(key)).toEqual({
      algorithm: 'aes-128-ctr',
      key: key.aesKey.toString('base64'),
      nonce: key.nonce.toString('base64'),
    });
    expect(Buffer.from(megaDecryptField(key).key, 'base64').length).toBe(16);
    expect(Buffer.from(megaDecryptField(key).nonce, 'base64').length).toBe(8);
  });

  test('a key or nonce of the wrong size is refused instead of sent to the host', () => {
    const key = deriveKeys(KEY_TEXT);
    expect(() => megaDecryptField({ aesKey: Buffer.alloc(15), nonce: key.nonce })).toThrow('16 bytes');
    expect(() => megaDecryptField({ aesKey: key.aesKey, nonce: Buffer.alloc(7) })).toThrow('8 bytes');
  });
});
