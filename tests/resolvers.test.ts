import { describe, expect, test } from 'bun:test';
import { findResolver } from '../src/downloads/resolvers';
import { BuzzHeavierHost } from '../src/downloads/resolvers/buzzheavier';
import { DataNodesHost } from '../src/downloads/resolvers/datanodes';
import { MegaHost } from '../src/downloads/resolvers/mega';
import { MixDropHost } from '../src/downloads/resolvers/mixdrop';
import { PixelDrainHost } from '../src/downloads/resolvers/pixeldrain';

const MEGA_KEY = 'a'.repeat(43);

describe('file host resolvers', () => {
  test('each supported host maps to its own resolver', () => {
    expect(findResolver('https://pixeldrain.com/u/abc')).toBeInstanceOf(PixelDrainHost);
    expect(findResolver('https://buzzheavier.com/abc123')).toBeInstanceOf(BuzzHeavierHost);
    expect(findResolver('https://bzzhr.to/abc123')).toBeInstanceOf(BuzzHeavierHost);
    expect(findResolver('https://datanodes.to/abc123')).toBeInstanceOf(DataNodesHost);
    expect(findResolver('https://mixdrop.co/f/abc123')).toBeInstanceOf(MixDropHost);
    expect(findResolver(`https://mega.nz/file/abc#${MEGA_KEY}`)).toBeInstanceOf(MegaHost);
  });

  test('a look-alike domain gets no resolver', () => {
    expect(findResolver('https://evildatanodes.to/abc123')).toBeNull();
    expect(findResolver('https://mixdrop.co.evil.com/f/abc')).toBeNull();
  });

  test('only MEGA fails closed, so its errors reach the user', () => {
    expect(new MegaHost().failsOpen).toBe(false);
    expect(new BuzzHeavierHost().failsOpen).toBe(true);
    expect(new MixDropHost().failsOpen).toBe(true);
  });
});
