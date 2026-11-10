// vendored until the SDK is published; replace with @light-launcher/plugin-sdk
/**
 * Fuzzy version handling. Sources are wildly inconsistent:
 *   v0.7 / 0.7a / 1.0.2-hotfix / Ch.5 / Ep.3 / Version: 0.12.4 / 2024-05-01
 */
export interface ParsedVersion {
  raw: string;
  kind: 'num' | 'v' | 'ch' | 'ep' | 'date';
  nums: number[];
  suffix: string;
}

const PREFIX = /^(?:ch(?:apter)?|ep(?:isode)?|v(?:er(?:sion)?)?|ver\.?|build|update|part)\s*[.:_-]?\s*/i;

export function parseVersion(input?: string | null): ParsedVersion | null {
  if (input == null) return null;
  const raw = String(input).trim().replace(/^[[(<{]+|[)\]>}]+$/g, '').trim();
  if (!raw) return null;

  const date = raw.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (date) {
    return { raw, kind: 'date', nums: [Number(date[1]), Number(date[2]), Number(date[3])], suffix: '' };
  }

  let kind: ParsedVersion['kind'] = 'num';
  let rest = raw;
  const pre = raw.match(PREFIX);
  if (pre) {
    const p = pre[0].toLowerCase();
    kind = p.startsWith('ch') ? 'ch' : p.startsWith('ep') ? 'ep' : 'v';
    rest = raw.slice(pre[0].length);
  }

  const nums = (rest.match(/\d+/g) ?? []).map(Number);
  if (!nums.length) return null;
  const suffix = (rest.match(/([a-z]+)\s*$/i)?.[1] ?? '').toLowerCase();
  return { raw, kind, nums, suffix };
}

/** negative = a older, 0 = equal, positive = a newer */
export function compareVersions(a?: string | null, b?: string | null): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;

  const n = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < n; i++) {
    const x = pa.nums[i] ?? 0;
    const y = pb.nums[i] ?? 0;
    if (x !== y) return x - y;
  }
  if (pa.suffix !== pb.suffix) return pa.suffix < pb.suffix ? -1 : 1;
  // chapters and episodes never compare meaningfully; fall back to text
  if (pa.kind !== pb.kind && pa.kind !== 'num' && pa.kind !== 'v' && pb.kind !== 'num' && pb.kind !== 'v') {
    return pa.raw.localeCompare(pb.raw, undefined, { numeric: true });
  }
  return 0;
}

export function isNewer(candidate?: string | null, current?: string | null): boolean {
  if (candidate == null || candidate === '') return false;
  if (current == null || current === '') return true;
  if (candidate.trim() === current.trim()) return false;
  return compareVersions(candidate, current) > 0;
}

/** stable key for equality checks (0.7 == v0.7 == 0.7.0) */
export function versionKey(input?: string | null): string | null {
  const p = parseVersion(input);
  if (!p) return null;
  const trimmed = p.nums.slice();
  while (trimmed.length > 1 && trimmed[trimmed.length - 1] === 0) trimmed.pop();
  return `${p.kind === 'ch' || p.kind === 'ep' ? p.kind : 'v'}${trimmed.join('.')}${p.suffix}`;
}

export function sameVersion(a?: string | null, b?: string | null): boolean {
  const ka = versionKey(a);
  const kb = versionKey(b);
  if (ka && kb) return ka === kb;
  return (a ?? '') === (b ?? '');
}
