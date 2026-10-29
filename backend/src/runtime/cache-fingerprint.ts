// Shared, dependency-free cache identity helpers. Kept separate from route
// modules so background refresh can use them without a refresh/routes cycle.
type Config = Record<string, any>;

function hashShort(value: unknown): string {
  const s = String(value);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function posterFp(config: Config = {}): string {
  const {
    erdbToken = '', rpdbKey = '', fanartKey = '', omdbKey = '', posterProvider = '',
    customPosterTemplate = '', enhanceBackground = false, enhanceLogo = false,
  } = config;
  const pictorium = posterProvider === 'pictorium'
    ? `${config.pictoriumUrl || ''}|${JSON.stringify(config.pictoriumOptions || {})}`
    : '';
  const postersPlus = posterProvider === 'postersplus' ? String(config.postersPlusUrl || '') : '';
  return hashShort([posterProvider, erdbToken, rpdbKey, fanartKey, omdbKey, customPosterTemplate, enhanceBackground ? 1 : 0, enhanceLogo ? 1 : 0, pictorium, postersPlus].join('|'));
}

// Posters+ is a poster service driven by one link (its configurator's "Copy
// config"), kept sealed with the keys. Every catalogue, search and meta path
// already resolves custom templates, so it is handed over as one; a link that
// cannot be read leaves TMDB posters in place.
function postersPlusAsCustom(config: Config): { posterProvider: string; customPosterTemplate: string } {
  const checked = require('../media/poster-template.ts').fromPostersPlus(config.postersPlusUrl);
  return checked.ok
    ? { posterProvider: 'custom', customPosterTemplate: checked.value }
    : { posterProvider: '', customPosterTemplate: '' };
}

function posterEnhance(config: Config = {}) {
  const poster = config.posterProvider === 'postersplus'
    ? postersPlusAsCustom(config)
    : { posterProvider: config.posterProvider, customPosterTemplate: config.customPosterTemplate };
  return {
    erdbToken: config.erdbToken,
    rpdbKey: config.rpdbKey,
    fanartKey: config.fanartKey,
    omdbKey: config.omdbKey,
    posterProvider: poster.posterProvider,
    customPosterTemplate: poster.customPosterTemplate,
    enhanceBackground: config.enhanceBackground,
    enhanceLogo: config.enhanceLogo,
    pictorium: {
      enabled: config.posterProvider === 'pictorium',
      token: config.__pictoriumToken || '',
      origin: String(process.env.BASE_URL || '').replace(/\/+$/, ''),
      options: config.pictoriumOptions || {},
    },
  };
}

module.exports = { hashShort, posterFp, posterEnhance };
