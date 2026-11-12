import { describe, expect, test } from 'bun:test';
import manifest from '../plugin.json';
import pluginSchema from '@light-launcher/plugin-sdk/schema/plugin.schema.json';

/** ajv is the validator the SDK's `llp validate` uses. Returns null when it cannot be loaded. */
async function loadAjv(): Promise<typeof import('ajv/dist/2020').default | null> {
  try {
    return (await import('ajv/dist/2020')).default;
  } catch {
    return null;
  }
}

const Ajv2020 = await loadAjv();
if (!Ajv2020) console.warn('skipped plugin.json schema check: ajv is not installed');

describe('plugin.json', () => {
  test.skipIf(!Ajv2020)('matches the SDK plugin manifest schema', () => {
    const validate = new Ajv2020!({ allErrors: true }).compile(pluginSchema);
    const problems = validate(manifest) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || '(root)'}: ${e.message}`);
    expect(problems).toEqual([]);
  });

  test('declares the GitHub repository', () => {
    expect(manifest.repository).toBe('github:AzPepoze/light-launcher-plugin-f95');
  });

  test('asks for the games folder because download hints can install there', () => {
    expect(manifest.permissions.fs).toContain('$GAMES');
  });

  test('declares the sync:index capability for the thread index', () => {
    const [source] = manifest.contributes.sources;
    expect(source.capabilities).toContain('sync:index');
    expect(source.capabilities).not.toContain('sync:games');
  });

  test('declares browse filters and a matching sidebar', () => {
    const [source] = manifest.contributes.sources;
    expect(source.capabilities).toContain('browse:filters');
    expect(source.sidebar?.map((group) => group.id)).toEqual(['text', 'engine', 'sort']);
    expect(source.sidebar?.[1]).toMatchObject({ type: 'multi', dynamic: true });
  });
});
