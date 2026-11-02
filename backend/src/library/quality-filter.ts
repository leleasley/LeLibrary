// "Your 4K" and "HDR & Dolby Vision" library rows.
//
// They are the same library as My Movies / My Shows (same item ids, so watch
// progress is shared), narrowed to titles that have at least one release of
// that quality. Quality comes from the release and file names the provider
// gave us, the same tags the stream formatter shows: nothing extra is stored.
//
// Catalogue ids: `{prefix}-movies-4k`, `{prefix}-series-4k`,
// `{prefix}-movies-hdr`, `{prefix}-series-hdr` (prefix = torbox, rd, ...).

// '4k' | 'hdr' (release quality), 'g-<slug>' (one "Your genres" row) or
// 'genres' (the Hub's Genres folder catalogue: the genre comes in the genre
// extra). Genres are filtered by TMDB facts (library/genres.ts), not names.
type Variant = '4k' | 'hdr' | 'genres' | `g-${string}`;
type Row = { name?: unknown; raw?: unknown; [key: string]: unknown };

const VARIANTS: readonly Variant[] = ['4k', 'hdr'];
const LIBRARY_ID = /^([a-z]+)-(movies|series|anime)(?:-(4k|hdr|genres|g-[a-z0-9]+))?$/;

const TESTS: Record<'4k' | 'hdr', RegExp> = {
  '4k': /\b(?:2160P|4K|UHD)\b/,
  hdr: /DOLBY.?VISION|\bDV\b|\bDOVI\b|\bHDR(?:10)?(?:\+|PLUS)?\b/,
};

function parseLibraryCatalogId(id: unknown): { prefix: string; kind: 'movies' | 'series' | 'anime'; variant: Variant | null } | null {
  const match = String(id || '').match(LIBRARY_ID);
  if (!match) return null;
  const kind = match[2] as 'movies' | 'series' | 'anime';
  const variant = (match[3] as Variant | undefined) || null;
  if (variant && kind === 'anime') return null;
  if (variant && variant.startsWith('g-')) {
    const genre = require('./genres.ts').genreBySlug(variant.slice(2));
    if (!genre || !(kind === 'movies' ? genre.movie : genre.tv)) return null;
  }
  return { prefix: match[1] as string, kind, variant };
}

function isGenreVariant(variant: unknown): variant is `g-${string}` | 'genres' {
  return typeof variant === 'string' && (variant.startsWith('g-') || variant === 'genres');
}

// Every name a release carries: the item name, and file names where the
// provider lists files (TorBox, WebDAV), so a season pack named without tags
// still counts when its files have them.
function releaseNames(item: Row): string[] {
  const out: string[] = [];
  const add = (value: unknown) => { if (typeof value === 'string' && value) out.push(value); };
  // Index rows keep the provider item in `raw`; the legacy path passes the
  // provider item itself.
  const raw = item?.raw && typeof item.raw === 'object' ? item.raw as Record<string, unknown> : null;
  for (const source of [item as Record<string, unknown>, raw]) {
    if (!source) continue;
    add(source['name']);
    add(source['filename']);
    const files = Array.isArray(source['files']) ? source['files'] : [];
    for (const file of files.slice(0, 400)) {
      if (typeof file === 'string') { add(file); continue; }
      if (!file || typeof file !== 'object') continue;
      const f = file as Record<string, unknown>;
      add(f['name']); add(f['short_name']); add(f['path']); add(f['filename']);
    }
  }
  return out;
}

function matchesVariant(item: Row, variant: Variant | null): boolean {
  if (!variant) return true;
  // Genre rows are filtered by TMDB genre (library/genres.ts), not names.
  if (isGenreVariant(variant)) return true;
  const test = TESTS[variant as '4k' | 'hdr'];
  return releaseNames(item).some((name) => test.test(name.toUpperCase()));
}

export interface QualityFilterApi {
  VARIANTS: readonly Variant[];
  parseLibraryCatalogId: typeof parseLibraryCatalogId;
  matchesVariant: typeof matchesVariant;
  isGenreVariant: typeof isGenreVariant;
}

module.exports = { VARIANTS, parseLibraryCatalogId, matchesVariant, isGenreVariant } satisfies QualityFilterApi;
