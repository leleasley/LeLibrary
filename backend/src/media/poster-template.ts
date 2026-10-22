// Custom poster URL templates.
//
// Server core (catalog builders validate and resolve these per row). The
// frozen legacy /configure page loads a type-stripped build of this module
// at /poster-template.js; that shim dies with the /configure cutover.
const ALLOWED: Set<string> = new Set(['imdbId', 'imdb_id', 'tmdbId', 'tmdb_id', 'type']);
const IDENTIFIERS: Set<string> = new Set(['imdbId', 'imdb_id', 'tmdbId', 'tmdb_id']);

function normalizeEncodedPlaceholders(value: unknown): string {
  return String(value || '').replace(/%7b([^%{}]+)%7d/gi, (_match: string, name: string) => '{' + name + '}');
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
  const unknown = placeholders.find((name) => !ALLOWED.has(name));
  if (unknown) return { ok: false, error: 'Unknown placeholder {' + unknown + '}.' };
  if (!placeholders.some((name) => IDENTIFIERS.has(name))) {
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
  const values: Record<string, string> = {
    imdbId: imdbValue(source.imdbId || source.id),
    imdb_id: imdbValue(source.imdbId || source.id),
    tmdbId: tmdbValue(source.tmdbId),
    tmdb_id: tmdbValue(source.tmdbId),
    type: source.type === 'movie' ? 'movie' : 'series',
  };
  for (const name of checked.placeholders) {
    if (!values[name]) return null;
  }
  return checked.value.replace(/\{([^{}]+)\}/g, (_match: string, name: string) => encodeURIComponent(values[name] as string));
}

function apply<T>(row: T, template: unknown): T {
  if (!row || typeof row !== 'object') return row;
  const url = resolve(template, row as PosterMedia);
  return url ? Object.assign({}, row, { poster: url, posterShape: 'poster' }) : row;
}

export interface PosterTemplateApi {
  validate: typeof validate;
  resolve: typeof resolve;
  apply: typeof apply;
}

module.exports = { validate, resolve, apply } satisfies PosterTemplateApi;
