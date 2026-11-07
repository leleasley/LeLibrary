// Shared cache identity helpers (server only: node:crypto). Kept separate from
// route modules so background refresh can use them without a refresh/routes cycle.
const crypto = require('node:crypto');

type Config = Record<string, any>;

// Fingerprint length in hex chars (96 bits). These values separate users and
// settings inside shared caches (poster style, MDBList key, stream addons,
// stream format), so a collision would merge two users' entries. The old
// 32-bit string hash collided within tens of thousands of values; every cache
// key fingerprint goes through this one function instead of a local copy.
const FP_HEX_LENGTH = 24;

function hashShort(value: unknown): string {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, FP_HEX_LENGTH);
}

function posterFp(config: Config = {}): string {
  const {
    erdbToken = '', rpdbKey = '', fanartKey = '', omdbKey = '', posterProvider = '',
    customPosterTemplate = '', enhanceBackground = false, enhanceLogo = false,
  } = config;
  const postersPlus = posterProvider === 'postersplus' ? String(config.postersPlusUrl || '') : '';
  return hashShort([posterProvider, erdbToken, rpdbKey, fanartKey, omdbKey, customPosterTemplate, enhanceBackground ? 1 : 0, enhanceLogo ? 1 : 0, postersPlus].join('|'));
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
  };
}

module.exports = { FP_HEX_LENGTH, hashShort, posterFp, posterEnhance };
