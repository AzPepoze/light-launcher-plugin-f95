import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { DEFAULT_USER_AGENT, type HttpClient } from '@light-launcher/plugin-sdk/helpers';

const API_URL = 'https://g.api.mega.co.nz/cs';
const API_TIMEOUT_MS = 30_000;

export interface MegaLink {
  handle: string;
  /** 32-byte file key, base64url as written in the link */
  key: string;
}

/** What is needed to decrypt the content of a MEGA file. */
export interface MegaCipherKey {
  /** AES-128 key */
  aesKey: Buffer;
  /** 8-byte CTR nonce */
  nonce: Buffer;
}

export interface MegaFile extends MegaCipherKey {
  /** temporary download URL, valid for a few hours */
  url: string;
  filename: string;
  size: number;
}

/** Parses `mega.nz/file/<handle>#<key>` and the older `mega.nz/#!<handle>!<key>` form. */
export function parseMegaLink(url: string): MegaLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'mega.nz' && !parsed.hostname.endsWith('.mega.nz')) return null;

  const modern = /^\/file\/([\w-]+)$/.exec(parsed.pathname);
  if (modern?.[1] && parsed.hash.length > 1) {
    return { handle: modern[1], key: parsed.hash.slice(1) };
  }

  const legacy = /^#!([\w-]+)!([\w-]+)$/.exec(parsed.hash) ?? /^\/#!([\w-]+)!([\w-]+)$/.exec(parsed.pathname + parsed.hash);
  if (legacy?.[1] && legacy[2]) return { handle: legacy[1], key: legacy[2] };
  return null;
}

/** MEGA folds the 256-bit file key into a 128-bit AES key by XOR-ing both halves. */
export function deriveKeys(keyBase64: string): { aesKey: Buffer; nonce: Buffer } {
  const raw = Buffer.from(keyBase64, 'base64url');
  if (raw.length !== 32) throw new Error('MEGA file key must be 32 bytes');
  const aesKey = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) aesKey[i] = (raw[i] ?? 0) ^ (raw[i + 16] ?? 0);
  return { aesKey, nonce: raw.subarray(16, 24) };
}

/** The name is stored as `MEGA{"n":"<filename>"}`, AES-CBC with a zero IV and zero padding. */
export function decryptName(attributes: string, aesKey: Buffer): string {
  const cipher = Buffer.from(attributes, 'base64url');
  const decipher = crypto.createDecipheriv('aes-128-cbc', aesKey, Buffer.alloc(16));
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(cipher), decipher.final()]).toString('utf8');
  const json = /^MEGA(\{.*\})/s.exec(plain.replace(/\0+$/, ''))?.[1];
  if (!json) throw new Error('MEGA file name could not be read');
  const name = (JSON.parse(json) as { n?: unknown }).n;
  if (typeof name !== 'string' || !name) throw new Error('MEGA file name is missing');
  return name;
}

/** Asks the MEGA API for the temporary download URL, size and name of one file. */
export async function resolveMega(link: MegaLink, http: HttpClient): Promise<MegaFile> {
  const res = await http.request(`${API_URL}?id=${Math.floor(Math.random() * 1e9)}`, {
    method: 'POST',
    headers: { 'User-Agent': DEFAULT_USER_AGENT, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ a: 'g', g: 1, p: link.handle }]),
    timeoutMs: API_TIMEOUT_MS,
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`MEGA API returned ${res.status}`);
  const body = JSON.parse(res.text) as unknown;
  const first = Array.isArray(body) ? body[0] : body;
  if (typeof first === 'number') throw new Error(megaErrorMessage(first));
  const reply = first as { g?: unknown; s?: unknown; at?: unknown };
  if (typeof reply.g !== 'string' || typeof reply.s !== 'number' || typeof reply.at !== 'string') {
    throw new Error('MEGA API sent an unexpected reply');
  }

  const { aesKey, nonce } = deriveKeys(link.key);
  return {
    url: reply.g,
    filename: decryptName(reply.at, aesKey),
    size: reply.s,
    aesKey,
    nonce,
  };
}

function megaErrorMessage(code: number): string {
  if (code === -9) return 'MEGA says this file was removed or is not available';
  if (code === -3) return 'MEGA is busy, try again in a moment';
  return `MEGA API error ${code}`;
}

/** A CTR stream that starts at byte `offset`; the file is always decrypted from byte 0. */
function megaCipher(aesKey: Buffer, nonce: Buffer, offset: number): crypto.Cipheriv {
  const counter = Buffer.alloc(16);
  nonce.copy(counter, 0, 0, 8);
  counter.writeBigUInt64BE(BigInt(Math.floor(offset / 16)), 8);
  return crypto.createCipheriv('aes-128-ctr', aesKey, counter);
}

/** Text form stored with the download row, so a restart can still decrypt. */
export function encodeCipherKey(key: MegaCipherKey): string {
  return JSON.stringify({ aes: key.aesKey.toString('base64'), nonce: key.nonce.toString('base64') });
}

export function decodeCipherKey(text: string | null): MegaCipherKey | null {
  if (!text) return null;
  const parsed = JSON.parse(text) as { aes?: string; nonce?: string };
  if (!parsed.aes || !parsed.nonce) return null;
  return { aesKey: Buffer.from(parsed.aes, 'base64'), nonce: Buffer.from(parsed.nonce, 'base64') };
}

/** Decrypts a finished MEGA download in place, streaming so large files stay out of memory. */
export async function decryptMegaFile(file: string, key: MegaCipherKey): Promise<void> {
  const tmp = `${file}.dec`;
  await pipeline(
    fs.createReadStream(file),
    megaCipher(key.aesKey, key.nonce, 0),
    fs.createWriteStream(tmp),
  );
  await fsp.rename(tmp, file);
}
