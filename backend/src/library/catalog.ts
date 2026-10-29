// @ts-nocheck
// Read side of the index-first engine: turn persisted, pre-matched local rows
// into Stremio/Nuvio catalog metas. A warm catalog request is a single SQL
// query plus in-memory assembly: no provider scan, no TMDB search.
const builder = require('../catalog/builder.ts');
const { getImdbIds } = require('../media/tmdb.ts');
const { guessMediaInfo } = require('../media/parser.ts');
const store = require('./store.ts');
const metrics = require('./metrics.ts');

function hashShort(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Rebuild the catalog meta shape from a persisted match_meta + the raw provider
// item, preserving everything the stream/meta paths rely on. The MATCHED
// season/episode win over the parsed row columns: they are equal except when
// the match is smarter than the filename - split-season remaps (Kitchen
// Nightmares US S10 stored as season 10 on the row, resolved to season 3),
// pack-probe availability, date resolutions. Preferring the row there points
// the owned-episode index at seasons the canonical entry never had, so the
// episodes vanish from metas and streams.
function rowToMeta(row) {
  const match = row.match_meta && typeof row.match_meta === 'object' ? row.match_meta : null;
  if (!match) return null;
  const meta = {
    ...match,
    tmdbId: row.tmdb_id || match.tmdbId,
    catalogType: row.media_type || match.catalogType,
    season: match.season != null ? match.season : row.season,
    seasonStart: match.seasonStart != null ? match.seasonStart : row.season_start,
    seasonEnd: match.seasonEnd != null ? match.seasonEnd : row.season_end,
    episode: match.episode != null ? match.episode : row.episode,
    episodeEnd: match.episodeEnd != null ? match.episodeEnd : row.episode_end,
    imdbId: row.imdb_id || match.imdbId || undefined,
    torboxItem: row.raw,
  };
  // Date-based releases (weekly shows) have no season/episode. Expose the air
  // date so the owned-episode filter can match it to the TMDB episode date
  // instead of treating the whole series as owned.
  if (meta.season == null && meta.episode == null && !meta.airDate) {
    try {
      const info = guessMediaInfo(row.name || (row.raw && (row.raw.name || row.raw.filename)) || '');
      if (info && (info.airDate || (info.airDates && info.airDates.length))) {
        meta.airDate = info.airDate || null;
        meta.airDates = info.airDates || null;
      }
    } catch { /* non-fatal */ }
  }
  return meta;
}

function entryFor(meta) {
  return {
    item: meta.torboxItem,
    season: meta.season,
    seasonStart: meta.seasonStart ?? null,
    seasonEnd: meta.seasonEnd ?? null,
    episode: meta.episode,
    episodeEnd: meta.episodeEnd ?? null,
    episodeTitle: meta.episodeTitle ?? null,
    airDate: meta.airDate ?? null,
    airDates: Array.isArray(meta.airDates) ? meta.airDates : null,
  };
}

// Group rows sharing a TMDB id into one catalog card with all owned copies.
function assembleMetas(rows, userKey) {
  const seen = new Map();
  for (const row of rows) {
    const meta = rowToMeta(row);
    if (!meta || !meta.tmdbId) continue;
    const entry = entryFor(meta);
    if (seen.has(meta.id)) seen.get(meta.id).torboxItems.push(entry);
    else seen.set(meta.id, { ...meta, torboxItems: [entry] });
  }
  const metas = [...seen.values()];
  if (userKey) {
    // Seed the owned-episode index so meta/stream requests never fall back to a
    // full provider scan for a title we just served.
    builder.populateTmdbIndexFromMetas(metas.map((m) => ({ ...m, torboxItem: m.torboxItems[0]?.item })), userKey);
  }
  return metas;
}

function sortMetas(metas, sortBy) {
  if (sortBy === 'data_lancamento') {
    metas.sort((a, b) => (b.released || '').localeCompare(a.released || ''));
  } else if (sortBy === 'titulo') {
    metas.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en-US'));
  } else {
    metas.sort((a, b) => {
      const latest = (items) => (items || []).reduce((acc, it) => {
        const d = it?.item?.created_at || it?.item?.updated_at || '';
        return d > acc ? d : acc;
      }, '');
      return latest(b.torboxItems).localeCompare(latest(a.torboxItems));
    });
  }
  return metas;
}

// Poster precedence mirrors enhanceMeta/discovery: custom > pictorium >
// erdb > rpdb > betterposter > fanart. Async because the fanart branch
// fetches (shared cache); URL-construction branches cost nothing.
async function applyPosterEnhance(metas, enhance) {
  const { erdbToken, rpdbKey, fanartKey, posterProvider, customPosterTemplate } = enhance || {};
  const pictoriumOn = !!(enhance && enhance.pictorium && enhance.pictorium.enabled);
  if (!erdbToken && !rpdbKey && !fanartKey && posterProvider !== 'custom' && posterProvider !== 'betterposter' && !pictoriumOn) return metas;
  const { normalizeImdbId } = require('../media/identity.ts');
  await Promise.all(metas.map(async (m) => {
    const t = m.catalogType === 'movie' ? 'movie' : 'tv';
    const customPoster = posterProvider === 'custom'
      ? require('../media/poster-template.ts').resolve(customPosterTemplate, { ...m, type: m.catalogType })
      : null;
    if (customPoster) {
      m.poster = customPoster;
      m.posterShape = 'poster';
    } else if (posterProvider === 'custom') {
      return;
    } else if (pictoriumOn && m.tmdbId) {
      const url = builder.buildPictoriumPosterUrl(enhance, { type: m.catalogType, id: m.tmdbId, title: m.name, releaseDate: m.released, imdbId: m.imdbId, fallback: m.poster });
      if (url) { m.poster = url; m.posterShape = 'poster'; }
    } else if (erdbToken && m.tmdbId) {
      m.poster = builder.erdbProxyUrl(enhance, 'poster', `tmdb:${t}:${m.tmdbId}`, m.poster) || m.poster;
    } else if (rpdbKey && m.tmdbId) {
      m.poster = builder.buildRpdbUrl(rpdbKey, 'tmdb', 'poster-default', `${t}-${m.tmdbId}`);
    } else if (posterProvider === 'betterposter' && m.tmdbId) {
      const imdbId = m.imdbId || normalizeImdbId(m.id);
      if (imdbId) { m.poster = builder.buildBetterPosterUrl(imdbId, m.catalogType); m.posterShape = 'poster'; }
    } else if (fanartKey && m.tmdbId) {
      const art = await builder.getFanartArt(fanartKey, m.tmdbId, t).catch(() => null);
      if (art && art.poster) m.poster = art.poster;
    }
  }));
  return metas;
}

function toOutput(metas) {
  return metas
    .filter((m) => m.poster && !m._drop)
    .map(({ torboxItem, torboxItems, tmdbId, released, catalogType, isJapaneseAnimation, season, seasonStart, seasonEnd, episode, _drop, _freshMatch, ...rest }) => rest);
}

async function buildFromRows(rows, opts) {
  const {
    userKey = '', sortBy = 'data_adicao', skip = 0, limit = 50, type = 'movie',
    libraryIdMode = 'torbox', tmdbApiKey = '', lang = 'en-US', enhance = {},
    paginate = true, trace = null,
  } = opts;
  const time = async (name, fn) => {
    try {
      const { timeSpan } = require('../middleware/perf-timing.ts');
      return await timeSpan(trace, name, fn);
    } catch { return fn(); }
  };
  let metas = assembleMetas(rows, userKey);
  sortMetas(metas, sortBy);

  if (paginate) metas = metas.slice(skip, skip + limit);

  // "Use Main Meta": rewrite library rows to canonical tt: ids so Nuvio can
  // enrich them and external stream addons answer them. Uses stored imdb_id directly
  // from the indexed row, falling back to TMDB only for any missing items.
  if (libraryIdMode === 'tt') {
    const missingMovies = [];
    const missingTv = [];
    for (const m of metas) {
      if (m.imdbId) {
        m.id = m.imdbId;
      } else if (tmdbApiKey && m.tmdbId) {
        if (m.catalogType === 'series' || m.catalogType === 'anime') missingTv.push(m.tmdbId);
        else missingMovies.push(m.tmdbId);
      } else {
        m._drop = true;
      }
    }
    if ((missingMovies.length || missingTv.length) && tmdbApiKey) {
      const [movieImdb, tvImdb] = await time('catalog:imdb-fill', () => Promise.all([
        missingMovies.length ? getImdbIds(tmdbApiKey, 'movie', missingMovies).catch(() => new Map()) : Promise.resolve(new Map()),
        missingTv.length ? getImdbIds(tmdbApiKey, 'tv', missingTv).catch(() => new Map()) : Promise.resolve(new Map()),
      ]));
      for (const m of metas) {
        if (!m.id || !String(m.id).startsWith('tt')) {
          const imdb = (m.catalogType === 'series' || m.catalogType === 'anime' ? tvImdb : movieImdb).get(m.tmdbId) || null;
          if (imdb) m.id = imdb;
          else m._drop = true;
        }
      }
    }
  }

  await time('catalog:posters', () => applyPosterEnhance(metas, enhance));
  return toOutput(metas);
}

async function buildIndexedCatalog({ scopeId, provider = null, type, sortBy, skip, limit, libraryIdMode, tmdbApiKey, lang, enhance, userKey, trace = null }) {
  const started = Date.now();
  let rows;
  try {
    const { timeSpan } = require('../middleware/perf-timing.ts');
    rows = await timeSpan(trace, 'catalog:rows', () => store.catalogRows(scopeId, type, provider));
  } catch { rows = await store.catalogRows(scopeId, type, provider); }
  const metas = await buildFromRows(rows, { userKey, sortBy, skip, limit: limit || 50, type, libraryIdMode, tmdbApiKey, lang, enhance, trace });
  metrics.time('catalogMs', Date.now() - started);
  metrics.request('catalogIndexed');
  return metas;
}

export interface CatalogApi {
  buildIndexedCatalog: any;
  buildFromRows: any;
  assembleMetas: any;
  sortMetas: any;
  applyPosterEnhance: any;
  hashShort: any;
  rowToMeta: any;
  withoutTmdbAnime: any;
}

// Rows TMDB identifies as anime (original language Japanese + the Animation
// genre), as stored by the matcher in match_meta. Used by "Hide anime" for the
// non-anime rows; rows matched before the flag existed simply stay.
function withoutTmdbAnime(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    let meta = row?.match_meta;
    if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = null; } }
    return !(meta && meta.isJapaneseAnimation === true);
  });
}

module.exports = { buildIndexedCatalog, buildFromRows, assembleMetas, sortMetas, applyPosterEnhance, hashShort, rowToMeta, withoutTmdbAnime } satisfies CatalogApi;