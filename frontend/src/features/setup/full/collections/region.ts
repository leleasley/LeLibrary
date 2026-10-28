// Watch region from the setup language. Mirrors backend/src/catalog/region.ts
// (regionForLang) exactly: there is no separate region question, the region
// comes from "Display, search & notices" (meta.lang). English is stored as
// en-US but means the UK, so it maps to GB; every other language uses its own
// country (pt-BR -> BR, es-ES -> ES ...). Anything unusable falls back to GB.
// A test pins both sides to the same table for the seven setup languages.

export const DEFAULT_REGION = 'GB';

export function regionForLang(lang?: unknown): string {
  const value = typeof lang === 'string' ? lang.trim() : '';
  if (!value) return DEFAULT_REGION;
  const [language, country] = value.split(/[-_]/);
  if (String(language).toLowerCase() === 'en' && (!country || country.toUpperCase() === 'US')) return DEFAULT_REGION;
  if (country && /^[A-Za-z]{2}$/.test(country)) return country.toUpperCase();
  return DEFAULT_REGION;
}

// Country name in the interface language ("United Kingdom", "Reino Unido").
export function regionName(region: string, uiLang?: string): string {
  try {
    const names = new Intl.DisplayNames(uiLang ? [uiLang, 'en'] : ['en'], { type: 'region' });
    return names.of(region) ?? region;
  } catch {
    return region;
  }
}
