import type { FileCandidate, Platform } from '@light-launcher/plugin-sdk/types';

/** File hosts a user can rank. The names are the values of the preferredHosts setting. */
export const RANKED_HOSTS = [
  'pixeldrain',
  'mediafire',
  'workupload',
  'datanodes',
  'krakenfiles',
  'buzzheavier',
  'mixdrop',
  'mega',
] as const;

export type RankedHost = (typeof RANKED_HOSTS)[number];

export const PLATFORM_CHOICES = ['any', 'windows', 'linux', 'mac'] as const;
export type PlatformChoice = (typeof PLATFORM_CHOICES)[number];

export interface FilePreferences {
  /** listed hosts come first, in this order; an empty list keeps the thread's order */
  preferredHosts: readonly RankedHost[];
  preferredPlatform: PlatformChoice;
}

/** The behaviour before the settings existed. */
export const DEFAULT_FILE_PREFERENCES: FilePreferences = {
  preferredHosts: [],
  preferredPlatform: 'any',
};

const HOST_DOMAINS: Record<RankedHost, readonly string[]> = {
  pixeldrain: ['pixeldrain.com'],
  mediafire: ['mediafire.com'],
  workupload: ['workupload.com'],
  datanodes: ['datanodes.to'],
  krakenfiles: ['krakenfiles.com'],
  buzzheavier: ['buzzheavier.com', 'bzzhr.to'],
  mixdrop: ['mixdrop.co'],
  mega: ['mega.nz', 'mega.co.nz'],
};

function isMatchingDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** The ranked host a candidate's host belongs to. Forum mirror labels are plain names, such as "mega". */
export function rankedHostOf(host: string | null | undefined): RankedHost | null {
  if (!host) return null;
  const name = host.toLowerCase();
  return RANKED_HOSTS.find(
    (ranked) => name === ranked || HOST_DOMAINS[ranked].some((domain) => isMatchingDomain(name, domain)),
  ) ?? null;
}

function rankOf(file: FileCandidate, preferred: readonly RankedHost[]): number {
  const ranked = rankedHostOf(file.host);
  const index = ranked ? preferred.indexOf(ranked) : -1;
  return index === -1 ? preferred.length : index;
}

/** Keeps the thread's order inside each group. Unlisted hosts come last. */
export function orderByHosts(files: FileCandidate[], preferred: readonly RankedHost[]): FileCandidate[] {
  if (preferred.length === 0) return files;
  return [...files].sort((a, b) => rankOf(a, preferred) - rankOf(b, preferred));
}

/** Links with a platform that is not known are always kept, because they cannot be placed. */
export function keepPlatform(files: FileCandidate[], choice: PlatformChoice): FileCandidate[] {
  if (choice === 'any') return files;
  return files.filter((file) => isPlatformOrUnknown(file.platform, choice));
}

function isPlatformOrUnknown(platform: Platform | undefined, choice: PlatformChoice): boolean {
  return platform === undefined || platform === 'unknown' || platform === choice;
}

export function applyFilePreferences(files: FileCandidate[], preferences: FilePreferences): FileCandidate[] {
  return orderByHosts(keepPlatform(files, preferences.preferredPlatform), preferences.preferredHosts);
}
