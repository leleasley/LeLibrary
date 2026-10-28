// ── Watch region from the setup language ─────────────────────
// Operator decision (Docs/plans/5.8-collections.md): there is no separate
// region question. The region comes from the setup language
// ("Display, search & notices", config.lang). English is stored as `en-US`
// but is shown as plain English and means the UK, so it maps to GB. Every
// other language uses its own country (pt-BR -> BR, es-ES -> ES, ...).
// Anything unusable falls back to GB.
//
// Dependency-free and erasable-syntax-only so the browser can reuse it.

const DEFAULT_REGION = 'GB';

function regionForLang(lang?: unknown): string {
  const value = typeof lang === 'string' ? lang.trim() : '';
  if (!value) return DEFAULT_REGION;
  const [language, country] = value.split(/[-_]/);
  if (String(language).toLowerCase() === 'en' && (!country || country.toUpperCase() === 'US')) return DEFAULT_REGION;
  if (country && /^[A-Za-z]{2}$/.test(country)) return country.toUpperCase();
  return DEFAULT_REGION;
}

export interface RegionApi {
  regionForLang: (lang?: unknown) => string;
  DEFAULT_REGION: string;
}

module.exports = { regionForLang, DEFAULT_REGION } satisfies RegionApi;
