// Custom poster URL templates.
//
// Server core (catalog builders validate and resolve these per row). The
// frozen legacy /configure page loads a type-stripped build of this module
// at /poster-template.js; that shim dies with the /configure cutover. The
// React setup pages load the same build for their live preview, so keep this
// file dependency-free and erasable-syntax-only.
//
// Placeholders: {imdbId}/{imdb_id}, {tmdbId}/{tmdb_id}, {type} (movie or
// series), {id} (the Stremio id: the IMDb id, else "tmdb:<id>") and {shape}
// ("poster"). A trailing "?" ({tmdb_id?}) makes one optional: when the title
// has no value it is sent empty instead of dropping the whole poster. This is
// the form Posters+ (and other Nuvio-style poster services) emit.
const ALLOWED: Set<string> = new Set(['imdbId', 'imdb_id', 'tmdbId', 'tmdb_id', 'type', 'id', 'shape']);
const IDENTIFIERS: Set<string> = new Set(['imdbId', 'imdb_id', 'tmdbId', 'tmdb_id', 'id']);

function normalizeEncodedPlaceholders(value: unknown): string {
  return String(value || '').replace(/%7b([^%{}]+)%7d/gi, (_match: string, name: string) => '{' + name + '}');
}

function baseName(placeholder: string): string {
  return placeholder.endsWith('?') ? placeholder.slice(0, -1) : placeholder;
}

export type PosterValidation =
  | { ok: true; value: string; placeholders: string[] }
  | { ok: false; error: string };

function validate(template: unknown): PosterValidation {
  const value = normalizeEncodedPlaceholders(String(template || '').trim());
  if (!value) return { ok: false, error: 'Enter a custom poster URL template.' };
  if (value.length > 2048) return { ok: false, error: 'The custom poster template is too long.' };
  if (/\s|[\u0000-\u001f\u007f]/.test(value)) return { ok: false, error: 'The template cannot contain spaces or control characters.' };
  const placeholders: string[] = [];
  value.replace(/\{([^{}]+)\}/g, (_match: string, name: string) => { placeholders.push(name); return _match; });
  const residue = value.replace(/\{[^{}]+\}/g, '');
  if (/[{}]/.test(residue)) return { ok: false, error: 'The template contains an incomplete placeholder.' };
  const unknown = placeholders.find((name) => !ALLOWED.has(baseName(name)));
  if (unknown) return { ok: false, error: 'Unknown placeholder {' + unknown + '}.' };
  if (!placeholders.some((name) => IDENTIFIERS.has(baseName(name)))) {
    return { ok: false, error: 'Include at least one IMDb or TMDB ID placeholder.' };
  }
  let parsed: URL;
  try { parsed = new URL(value); } catch { return { ok: false, error: 'Enter a complete HTTPS URL template.' }; }
  if (parsed.protocol !== 'https:') return { ok: false, error: 'Custom poster templates must use HTTPS.' };
  if (parsed.username || parsed.password) return { ok: false, error: 'URL usernames and passwords are not allowed.' };
  return { ok: true, value, placeholders };
}

function imdbValue(value: unknown): string {
  const match = String(value || '').match(/tt\d+/i);
  return match ? match[0].toLowerCase() : '';
}

function tmdbValue(value: unknown): string {
  return /^\d+$/.test(String(value || '')) ? String(value) : '';
}

export interface PosterMedia {
  imdbId?: unknown;
  id?: unknown;
  tmdbId?: unknown;
  type?: unknown;
}

function resolve(template: unknown, media: PosterMedia | null | undefined): string | null {
  const checked = validate(template);
  if (!checked.ok) return null;
  const source: PosterMedia = media || {};
  const imdb = imdbValue(source.imdbId || source.id);
  const tmdb = tmdbValue(source.tmdbId);
  const values: Record<string, string> = {
    imdbId: imdb,
    imdb_id: imdb,
    tmdbId: tmdb,
    tmdb_id: tmdb,
    type: source.type === 'movie' ? 'movie' : 'series',
    id: imdb || (tmdb ? 'tmdb:' + tmdb : ''),
    shape: 'poster',
  };
  // A required placeholder with no value drops the poster (the row keeps its
  // own); an optional one is simply sent empty. Every template still needs
  // one identifier with a value, or there is nothing to draw.
  for (const name of checked.placeholders) {
    if (!name.endsWith('?') && !values[name]) return null;
  }
  if (!checked.placeholders.some((name) => IDENTIFIERS.has(baseName(name)) && values[baseName(name)])) return null;
  return checked.value.replace(/\{([^{}]+)\}/g, (_match: string, name: string) => encodeURIComponent(values[baseName(name)] || ''));
}

function apply<T>(row: T, template: unknown): T {
  if (!row || typeof row !== 'object') return row;
  const url = resolve(template, row as PosterMedia);
  return url ? Object.assign({}, row, { poster: url, posterShape: 'poster' }) : row;
}

// Posters+ (ElfHosted and self-hosted instances): the link its configurator
// copies ("Copy config"), turned into a template this module resolves. The
// link carries the style and usually an access key and API keys, so it is a
// secret: it is stored sealed and only ever turned into poster URLs. A bare
// instance address gets the identifier set Posters+ documents for Nuvio.
// Placeholders this module does not know (another client's) are dropped.
const POSTERS_PLUS_IDS = 'tmdb_id={tmdb_id?}&imdb_id={imdb_id?}&stremio_id={id}&type={type}&shape={shape}';

function fromPostersPlus(link: unknown): PosterValidation {
  const raw = normalizeEncodedPlaceholders(String(link || '').trim());
  if (!raw) return { ok: false, error: 'Paste your Posters+ link.' };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { ok: false, error: 'Paste the full Posters+ link (it starts with https://).' }; }
  if (parsed.protocol !== 'https:') return { ok: false, error: 'Posters+ links must use HTTPS.' };
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path && path !== '/poster' && !path.endsWith('/poster')) {
    return { ok: false, error: 'That is not a Posters+ poster link. In Posters+, press Copy config and paste that link.' };
  }
  const base = parsed.origin + (path.endsWith('/poster') ? path : path + '/poster');
  // Rebuild the query by hand: URLSearchParams would percent-encode the braces.
  const query = raw.indexOf('?') >= 0 ? raw.slice(raw.indexOf('?') + 1).split('#')[0] || '' : '';
  const kept: string[] = [];
  for (const part of query.split('&')) {
    if (!part) continue;
    const placeholder = part.match(/\{([^{}]+)\}/);
    if (placeholder && !ALLOWED.has(baseName(placeholder[1] as string))) continue;
    kept.push(part);
  }
  const hasId = kept.some((part) => /^(tmdb_id|imdb_id|stremio_id)=/.test(part) && /\{/.test(part));
  const template = base + '?' + (hasId ? kept.join('&') : [POSTERS_PLUS_IDS, ...kept.filter((part) => !/^(tmdb_id|imdb_id|stremio_id|type|shape)=/.test(part))].join('&'));
  return validate(template);
}

export interface PosterTemplateApi {
  validate: typeof validate;
  resolve: typeof resolve;
  apply: typeof apply;
  fromPostersPlus: typeof fromPostersPlus;
}

module.exports = { validate, resolve, apply, fromPostersPlus } satisfies PosterTemplateApi;
