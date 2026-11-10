// vendored until the SDK is published; replace with @light-launcher/plugin-sdk
/** Shared title normalisation + scoring, used by the search index and the local matcher. */

const NOISE = new Set([
  'the', 'a', 'an', 'and', 'of', 'for', 'my', 'to', 'in', 'on', 'public', 'trial', 'demo',
  'win', 'windows', 'pc', 'ver', 'version', 'eng', 'english', 'final', 'build', 'update',
  'game', 'games', 'completed', 'abandoned', 'ongoing', 'renpy', 'unity', 'rpgm', 'html',
]);

export function normalizeTitle(input: string): string {
  return input
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/['’`]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\b(?:v|ver|version)\s*\d+(?:\s*\d+)*[a-z]?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function compactTitle(input: string): string {
  return normalizeTitle(input).replace(/[^a-z0-9]/g, '');
}

export function titleTokens(input: string): string[] {
  return [...new Set(normalizeTitle(input).split(' ').filter((t) => t.length > 1 && !NOISE.has(t)))];
}

/** Like titleTokens, but keeps one-character numeric tokens so "Game 2" never matches "Game 3". */
export function matchTokens(input: string): string[] {
  return [...new Set(normalizeTitle(input).split(' ').filter((t) => t && !NOISE.has(t)))];
}

/** 0..~2.3 — higher is better */
export function scoreMatch(query: string, candidate: string): number {
  const q = normalizeTitle(query);
  const c = normalizeTitle(candidate);
  if (!q || !c) return 0;

  const qTokens = titleTokens(query);
  const cTokens = new Set(titleTokens(candidate));
  let hits = 0;
  for (const token of qTokens) if (cTokens.has(token)) hits++;

  let score = qTokens.length ? hits / qTokens.length : 0;
  const qCompact = compactTitle(query);
  const cCompact = compactTitle(candidate);
  if (qCompact.length > 5 && cCompact.includes(qCompact)) score += 0.9;
  if (c.startsWith(q) && q.length > 4) score += 0.4;
  // A compact hit already proves the title is there, so don't penalise it for
  // having fewer separate token matches (Kel Pie Rays vs KelpieRays).
  if (hits < Math.min(2, qTokens.length) && score < 0.9) score *= 0.45;
  return Math.min(score, 2.5);
}

/** "sample-quest-v1-3-1-69-full-dlcs-remtairy.33777" -> a readable title */
export function titleFromSlug(slug: string): string {
  const body = decodeURIComponent(slug).replace(/\.\d+$/, '').replace(/\/$/, '');
  let text = body.replace(/-/g, ' ');
  text = text.replace(/\bv(\d+(?:\s\d+){1,4})\b/gi, (_m, nums: string) => `v${nums.trim().split(/\s+/).join('.')}`);
  text = text.replace(/\bch\s+(\d+)\b/gi, 'Ch.$1');
  text = text.replace(/\b(renpy|rpgm|html|unity|godot|unreal|flash|qsp)\b/gi, (m) => m.toUpperCase());
  return text
    .split(' ')
    .map((word) => (word.length > 2 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ')
    .trim();
}

export function versionFromText(input: string): string | null {
  const matches = [...input.matchAll(/(?<![0-9a-z])[vV]?(\d{1,3}(?:\.\d{1,4}){1,3}[a-z]?)(?![0-9a-z])/g)];
  if (!matches.length) return null;
  const candidate = matches[matches.length - 1][1];
  if (/^(?:19|20)\d{2}$/.test(candidate)) return null;
  return candidate;
}
