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
  return hashShort([posterProvider, erdbToken, rpdbKey, fanartKey, omdbKey, customPosterTemplate, enhanceBackground ? 1 : 0, enhanceLogo ? 1 : 0, pictorium].join('|'));
}

function posterEnhance(config: Config = {}) {
  return {
    erdbToken: config.erdbToken,
    rpdbKey: config.rpdbKey,
    fanartKey: config.fanartKey,
    omdbKey: config.omdbKey,
    posterProvider: config.posterProvider,
    customPosterTemplate: config.customPosterTemplate,
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
