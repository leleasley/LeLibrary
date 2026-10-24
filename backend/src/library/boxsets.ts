'use strict';
// Box sets: one cloud item holding several films ("The Fast And The Furious -
// The Complete Collection (2001-2023)"). Instead of failing the whole folder,
// each film inside becomes its own library entry that points at its own
// file(s). Nothing in the debrid account is moved or copied.
//
// Child rows live in lib_items like any other row, with source_id
// "<parent source_id>#film:<key>" and raw = the parent's provider record cut
// down to that film's files (so streams and links-on-demand play exactly that
// file). Their raw carries _boxset.tmdbId so a later re-match keeps the same
// film. Sync never removes a child on its own (it is not a provider item);
// it goes when its parent goes (store.reconcile). The parent row becomes
// match_status 'expanded', which catalogs never show.
//
// Matching is constrained: the folder name finds the TMDB collection, then
// each file is matched against that collection's films only (title + year).
// Files outside the collection fall back to the normal strict resolver.

const store = require('./store.ts');
const overrides = require('./overrides.ts');
const { normalizeTitle } = require('./diff.ts');
const { matchVersion } = require('../matching/resolve.ts');

const CHILD_MARK = '#film:';
const VIDEO = /\.(mkv|mp4|avi|m4v|ts|m2ts|webm|mov)$/i;
const EXTRA = /(^|[^a-z])(sample|trailer|teaser|featurette|extras?|bonus|behind[ ._-]?the[ ._-]?scenes|deleted[ ._-]?scenes|interview|making[ ._-]?of)([^a-z]|$)/i;
const BOXSET_NAME = /(complete[ ._-]+collection|\bcollection\b|\btrilogy\b|\bquadrilogy\b|\bpentalogy\b|\banthology\b|box[ ._-]?set|\bsaga\b|\(\s*(19|20)\d{2}\s*-\s*(19|20)\d{2}\s*\)|\b\d+[ ._-]*(movies|films)\b)/i;
const MIN_FEATURE_BYTES = 400 * 1024 * 1024;

export interface BoxFile { id: number | string; name: string; size: number }
export interface FilmGroup { key: string; title: string; year: number | null; files: BoxFile[] }

function fileList(raw: any): BoxFile[] {
  const out: BoxFile[] = [];
  for (const key of ['files', 'file_list', 'innerFiles']) {
    const value = raw && raw[key];
    const list = Array.isArray(value) ? value : (value && typeof value === 'object' ? Object.values(value) : []);
    for (const f of list as any[]) {
      const full = String((f && (f.short_name || f.name || f.path || f.filename)) || '');
      const name = full.split(/[\\/]/).pop() || '';
      if (name && f && f.id != null) out.push({ id: f.id, name, size: Number(f.size || f.bytes || 0) });
    }
  }
  return out;
}

// Feature-length videos only: no samples, trailers or extras.
function featureFiles(raw: any): BoxFile[] {
  return fileList(raw).filter((f) => VIDEO.test(f.name) && !EXTRA.test(f.name) && f.size >= MIN_FEATURE_BYTES);
}

function looksLikeBoxSet(name: string, raw: any): boolean {
  return BOXSET_NAME.test(String(name || '')) && featureFiles(raw).length >= 2;
}

// Title and year of one film file. Box-set files usually start with the year
// ("2001.The.Fast.And.The.Furious.1920x816..."); a WIDTHxHEIGHT resolution is
// never a year.
function parseFilm(fileName: string): { title: string; year: number | null; part: number | null } {
  let base = fileName.replace(VIDEO, '').replace(/\b\d{3,4}x\d{3,4}\b/g, ' ');
  let year: number | null = null;
  const lead = /^\s*((?:19|20)\d{2})[ ._-]+/.exec(base);
  if (lead) {
    year = Number(lead[1]);
    base = base.slice(lead[0].length);
  }
  const partMatch = /(?:^|[ ._-])(?:part|pt|cd|disc|disk)[ ._-]*(\d{1,2})(?=$|[ ._-])/i.exec(base);
  const part = partMatch ? Number(partMatch[1]) : null;
  // Cut at the first release tag (or a trailing year when there was no lead year).
  const tagAt = base.search(/[ ._\[(-]+(?:(?:19|20)\d{2}|\d{3,4}p|bdrip|brrip|bluray|blu-ray|web[ ._-]?dl|webrip|hdtv|dvdrip|remux|x26[45]|h[ .]?26[45]|hevc|uhd|4k|extended|unrated|directors?[ ._-]?cut|theatrical|imax|proper|repack)(?=$|[ ._\])-])/i);
  let titlePart = tagAt > 0 ? base.slice(0, tagAt) : base;
  if (year == null) {
    const tail = /(?:^|[ ._(\[-])((?:19|20)\d{2})(?=$|[ ._)\]-])/.exec(base.slice(Math.max(0, tagAt)));
    if (tail) year = Number(tail[1]);
  }
  titlePart = titlePart.replace(/(?:^|[ ._-])(?:part|pt|cd|disc|disk)[ ._-]*\d{1,2}(?=$|[ ._-])/ig, ' ');
  const title = titlePart.replace(/[._]+/g, ' ').replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return { title, year, part };
}

// Multi-part films (Part 1/Part 2, CD1/CD2) and duplicate cuts become one film.
function groupFilms(raw: any): FilmGroup[] {
  const groups = new Map<string, FilmGroup>();
  for (const f of featureFiles(raw)) {
    const p = parseFilm(f.name);
    const key = `${normalizeTitle(p.title)}|${p.year ?? ''}`;
    const g = groups.get(key) || { key, title: p.title, year: p.year, files: [] };
    g.files.push(f);
    groups.set(key, g);
  }
  return [...groups.values()];
}

function tokens(s: string): Set<string> {
  // UK/US spellings compare equal ("Colour" / "Color"); both sides get it.
  return new Set(normalizeTitle(s).split(' ').filter((w: string) => w && w !== 'the' && w !== 'a' && w !== 'and')
    .map((w: string) => (w.length > 4 ? w.replace(/our$/, 'or').replace(/ise$/, 'ize') : w)));
}

function similarity(a: string, b: string): number {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return (2 * common) / (x.size + y.size);
}

// The franchise name from the folder name, for TMDB's collection search.
function collectionQuery(folderName: string): string {
  return String(folderName || '')
    .replace(/[\[(][^\])]*[\])]/g, ' ')
    .replace(/\b(the\s+)?(complete\s+)?(collection|trilogy|quadrilogy|pentalogy|anthology|saga|box\s*set)\b.*$/i, ' ')
    .replace(/\b(bdrip|brrip|bluray|1080p|2160p|720p|4k|remux|x26[45]|hevc)\b/ig, ' ')
    .replace(/[._]+/g, ' ').replace(/\s*-\s*$/g, ' ').replace(/[-:]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

interface CollectionPart { id: number; title: string; originalTitle: string; year: number | null }

async function findCollection(apiKey: string, folderName: string, lang: string): Promise<{ id: number; name: string; parts: CollectionPart[] } | null> {
  const query = collectionQuery(folderName);
  if (!query) return null;
  const found = await overrides.tmdbGet(apiKey, '/search/collection', { query, language: lang, page: 1 }).catch(() => null);
  const results: any[] = (found && Array.isArray(found.results)) ? found.results : [];
  let best: any = null;
  let bestScore = 0;
  for (const r of results.slice(0, 8)) {
    const name = String(r.name || '').replace(/\bcollection\b/i, '').trim();
    const score = similarity(name, query);
    if (score > bestScore) { best = r; bestScore = score; }
  }
  if (!best || bestScore < 0.6) return null;
  const detail = await overrides.tmdbGet(apiKey, `/collection/${best.id}`, { language: lang }).catch(() => null);
  const parts: CollectionPart[] = (detail && Array.isArray(detail.parts) ? detail.parts : []).map((p: any) => ({
    id: Number(p.id),
    title: String(p.title || ''),
    originalTitle: String(p.original_title || ''),
    year: /^\d{4}/.test(String(p.release_date || '')) ? Number(String(p.release_date).slice(0, 4)) : null,
  })).filter((p: CollectionPart) => Number.isInteger(p.id) && p.title);
  return parts.length ? { id: best.id, name: String(best.name || ''), parts } : null;
}

// Pick the collection film for one file: a clear title match agreeing on year,
// or the only film released that year when the titles still overlap.
function matchToPart(film: FilmGroup, parts: CollectionPart[]): CollectionPart | null {
  const scored = parts.map((p) => {
    const titleScore = Math.max(similarity(film.title, p.title), similarity(film.title, p.originalTitle));
    const yearOk = film.year == null || p.year == null || Math.abs(film.year - p.year) <= 1;
    return { p, titleScore, yearOk, exactYear: film.year != null && p.year === film.year };
  }).filter((s) => s.yearOk);
  scored.sort((a, b) => b.titleScore - a.titleScore);
  const [top, next] = scored;
  if (top && top.titleScore >= 0.75 && (!next || top.titleScore - next.titleScore >= 0.15 || top.exactYear)) return top.p;
  const sameYear = scored.filter((s) => s.exactYear);
  if (sameYear.length === 1 && sameYear[0].titleScore > 0) return sameYear[0].p;
  return null;
}

// A film split into "Part 1 / Part 2" files that TMDB lists as a miniseries
// (the Pratchett adaptations): one show whose first season has exactly that
// many episodes, a near-exact title and an air year within one. Only a single
// such show counts; anything less certain stays with the movie fallback.
async function findMiniseries(apiKey: string, film: FilmGroup, lang: string): Promise<{ id: number; episodes: { file: BoxFile; episode: number }[] } | null> {
  const numbered = film.files.map((file) => ({ file, episode: parseFilm(file.name).part }));
  const parts = new Set(numbered.map((n) => n.episode));
  if (numbered.length < 2 || parts.has(null) || parts.size !== numbered.length) return null;
  const found = await overrides.tmdbGet(apiKey, '/search/tv', { query: film.title, language: lang, page: 1 }).catch(() => null);
  const results: any[] = (found && Array.isArray(found.results)) ? found.results : [];
  const close = results.slice(0, 5).filter((r) => {
    const year = /^\d{4}/.test(String(r.first_air_date || '')) ? Number(String(r.first_air_date).slice(0, 4)) : null;
    const titleScore = Math.max(similarity(film.title, String(r.name || '')), similarity(film.title, String(r.original_name || '')));
    return titleScore >= 0.9 && (film.year == null || (year != null && Math.abs(year - film.year) <= 1));
  });
  const fits: number[] = [];
  for (const r of close) {
    const detail = await overrides.tmdbGet(apiKey, `/tv/${r.id}`, { language: lang }).catch(() => null);
    const first = detail && Array.isArray(detail.seasons) ? detail.seasons.find((x: any) => x && x.season_number === 1) : null;
    if (first && Number(first.episode_count) === numbered.length && Math.max(...(parts as Set<number>)) === numbered.length) fits.push(Number(r.id));
  }
  if (fits.length !== 1) return null;
  return { id: fits[0], episodes: numbered.map((n) => ({ file: n.file, episode: n.episode as number })) };
}

// Expand one box-set parent row. Returns the number of films matched, or -1
// when the item is not a box set the bot can handle (normal matching goes on).
async function expand(job: any, { tmdbApiKey, lang = 'en-US', resolveFallback }: { tmdbApiKey: string; lang?: string; resolveFallback?: (name: string) => Promise<{ tmdbId: number; mediaType: 'movie' | 'series' } | null> }): Promise<number> {
  const raw = job.raw || {};
  const name = String(job.name || raw.name || '');
  if (!tmdbApiKey || String(job.source_id || '').includes(CHILD_MARK) || !looksLikeBoxSet(name, raw)) return -1;
  const films = groupFilms(raw);
  if (films.length < 2) return -1;
  const collection = await findCollection(tmdbApiKey, name, lang);

  const plans: { film: FilmGroup; tmdbId: number | null; mediaType: 'movie' | 'series'; season?: number; episode?: number }[] = [];
  for (const film of films) {
    const part = collection ? matchToPart(film, collection.parts) : null;
    if (part) { plans.push({ film, tmdbId: part.id, mediaType: 'movie' }); continue; }
    // Miniseries: each part file becomes its own episode entry.
    const show = await findMiniseries(tmdbApiKey, film, lang);
    if (show) {
      for (const ep of show.episodes) {
        plans.push({ film: { ...film, key: `${film.key}|e${ep.episode}`, files: [ep.file] }, tmdbId: show.id, mediaType: 'series', season: 1, episode: ep.episode });
      }
      continue;
    }
    const fallback = resolveFallback ? await resolveFallback(`${film.title}${film.year ? ` ${film.year}` : ''}`).catch(() => null) : null;
    plans.push({ film, tmdbId: fallback ? fallback.tmdbId : null, mediaType: fallback ? fallback.mediaType : 'movie' });
  }
  const matchedCount = plans.filter((p) => p.tmdbId).length;
  if (matchedCount === 0) return -1;

  const pool = await store.ensure();
  const parentKey = String(job.source_id);
  const keep: string[] = [];
  for (const plan of plans) {
    const childKey = `${parentKey}${CHILD_MARK}${plan.tmdbId ? `tmdb-${plan.tmdbId}${plan.episode ? `-s${plan.season}e${plan.episode}` : ''}` : `file-${plan.film.files[0].id}`}`;
    keep.push(childKey);
    const fileIds = new Set(plan.film.files.map((f) => String(f.id)));
    const childRaw = {
      ...raw,
      name: plan.film.files[0].name,
      files: (Array.isArray(raw.files) ? raw.files : []).filter((f: any) => fileIds.has(String(f && f.id))),
      size: plan.film.files.reduce((total, f) => total + f.size, 0),
      _boxset: { parent: parentKey, collectionId: collection ? collection.id : null, tmdbId: plan.tmdbId, mediaType: plan.mediaType, season: plan.season ?? null, episode: plan.episode ?? null },
    };
    const { rows } = await pool.query(
      `INSERT INTO lib_items (scope_id, provider, source_id, source_kind, name, norm_title, search_text, media_type, is_series, is_anime,
                              year, size, source_updated_at, source_created_at, state, raw, content_hash, match_status, removed_at, synced_at)
       SELECT scope_id, provider, $2, source_kind, $3, $4, $5, $6, $7, false, $8, $9, source_updated_at, source_created_at, state, $10, $11,
              'pending', NULL, now()
         FROM lib_items WHERE id = $1
       ON CONFLICT (scope_id, provider, source_id) DO UPDATE SET
         name = EXCLUDED.name, raw = EXCLUDED.raw, size = EXCLUDED.size, content_hash = EXCLUDED.content_hash,
         removed_at = NULL, synced_at = now()
       RETURNING id, provider, source_id, raw, season, episode, season_start, season_end`,
      [job.id, childKey, plan.film.files[0].name, normalizeTitle(plan.film.title), normalizeTitle(plan.film.title),
        plan.mediaType, plan.mediaType !== 'movie', plan.film.year, childRaw.size, JSON.stringify(childRaw),
        `${job.content_hash || ''}:${[...fileIds].sort().join(',')}`]
    );
    const child = rows[0];
    if (plan.tmdbId) {
      await overrides.apply(child, { action: 'match', tmdbId: plan.tmdbId, mediaType: plan.mediaType, season: plan.season ?? null, episode: plan.episode ?? null }, { tmdbApiKey, lang, origin: 'boxset' });
    } else {
      // Left for the Library page: the person can fix just this film.
      await store.saveMatch(child.id, { status: 'failed', error: 'no-candidate [box-set file]', version: require('../matching/resolve.ts').retryVersion() });
    }
  }
  // Films no longer produced by this box set (it changed) go away.
  await pool.query(
    `UPDATE lib_items SET removed_at = now(), match_status = 'skipped'
      WHERE scope_id = (SELECT scope_id FROM lib_items WHERE id = $1) AND removed_at IS NULL
        AND source_id LIKE $2 AND NOT (source_id = ANY($3::text[]))`,
    [job.id, `${parentKey.replace(/[\\%_]/g, (c) => `\\${c}`)}${CHILD_MARK}%`, keep]
  );
  await pool.query(
    `UPDATE lib_items SET match_status = 'expanded', match_error = NULL, match_version = $2, match_next_retry_at = NULL,
            match_meta = $3
      WHERE id = $1`,
    [job.id, matchVersion(), JSON.stringify({ boxset: { collectionId: collection ? collection.id : null, collection: collection ? collection.name : null, films: plans.length, matched: matchedCount } })]
  );
  return matchedCount;
}

export interface BoxSetsApi {
  CHILD_MARK: string;
  looksLikeBoxSet: typeof looksLikeBoxSet;
  parseFilm: typeof parseFilm;
  groupFilms: typeof groupFilms;
  collectionQuery: typeof collectionQuery;
  matchToPart: typeof matchToPart;
  expand: typeof expand;
}

module.exports = { CHILD_MARK, looksLikeBoxSet, parseFilm, groupFilms, collectionQuery, matchToPart, expand } satisfies BoxSetsApi;
