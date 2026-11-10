import { describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  decodeCipherKey,
  decryptMegaFile,
  decryptName,
  deriveKeys,
  encodeCipherKey,
  parseMegaLink,
} from '../src/downloads/mega';

const FILE_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i * 7 + 1));
const KEY_TEXT = FILE_KEY.toString('base64url');

function counterFor(nonce: Buffer, block: number): Buffer {
  const counter = Buffer.alloc(16);
  nonce.copy(counter, 0, 0, 8);
  counter.writeBigUInt64BE(BigInt(block), 8);
  return counter;
}

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

  test('a stored key comes back unchanged', () => {
    const key = deriveKeys(KEY_TEXT);
    const restored = decodeCipherKey(encodeCipherKey(key));
    expect(restored?.aesKey.equals(key.aesKey)).toBe(true);
    expect(restored?.nonce.equals(key.nonce)).toBe(true);
    expect(decodeCipherKey(null)).toBeNull();
  });
});

describe('MEGA file decryption', () => {
  test('an encrypted download is restored to the original bytes', async () => {
    const { aesKey, nonce } = deriveKeys(KEY_TEXT);
    const original = crypto.randomBytes(100_003);
    const cipher = crypto.createCipheriv('aes-128-ctr', aesKey, counterFor(nonce, 0));
    const encrypted = Buffer.concat([cipher.update(original), cipher.final()]);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mega-test-'));
    const file = path.join(dir, 'game.part');
    fs.writeFileSync(file, encrypted);
    try {
      await decryptMegaFile(file, { aesKey, nonce });
      expect(fs.readFileSync(file).equals(original)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
