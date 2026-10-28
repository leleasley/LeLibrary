import { describe, expect, it } from 'vitest';
import { LANGS } from '@/features/setup/full/MetadataExtras';
import { regionForLang, regionName } from '@/features/setup/full/collections/region';

// The same table is pinned in backend/test/curated-packs-58.test.ts against
// backend/src/catalog/region.ts, so both sides agree on every setup language.
const TABLE: Record<string, string> = {
  'en-US': 'GB',
  'pt-BR': 'BR',
  'es-ES': 'ES',
  'fr-FR': 'FR',
  'de-DE': 'DE',
  'it-IT': 'IT',
  'ja-JP': 'JP',
};

describe('region from the setup language', () => {
  it('maps every setup language like the server (en-US means GB)', () => {
    expect(LANGS.map((lang) => lang.id).sort()).toEqual(Object.keys(TABLE).sort());
    for (const lang of LANGS) expect(regionForLang(lang.id)).toBe(TABLE[lang.id]);
  });
  it('falls back to GB', () => {
    expect(regionForLang(undefined)).toBe('GB');
    expect(regionForLang('')).toBe('GB');
    expect(regionForLang('en')).toBe('GB');
    expect(regionForLang('xx')).toBe('GB');
  });
  it('names the country in the interface language', () => {
    expect(regionName('GB', 'en')).toBe('United Kingdom');
    expect(regionName('GB', 'es')).toBe('Reino Unido');
  });
});
