// Read side of the index-first engine: turn persisted, pre-matched local rows
// into Stremio/Nuvio catalog metas. A warm catalog request is a single SQL
// query plus in-memory assembly: no provider scan, no TMDB search.
const builder = require('../builder');
const { getImdbIds } = require('../tmdb');
const { guessMediaInfo } = require('../parser');
const store = require('./store');
const metrics = require('./metrics');

function hashShort(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Rebuild the catalog meta shape from a persisted match_meta + the raw provider
// item, preserving everything the stream/meta paths rely on.
function rowToMeta(row) {
  const match = row.match_meta && typeof row.match_meta === 'object' ? row.match_meta : null;
  if (!match) return null;
  const meta = {
    ...match,
    tmdbId: row.tmdb_id || match.tmdbId,
    catalogType: row.media_type || match.catalogType,
    season: row.season != null ? row.season : match.season,
    seasonStart: row.season_start != null ? row.season_start : match.seasonStart,
    seasonEnd: row.season_end != null ? row.season_end : match.seasonEnd,
    episode: row.episode != null ? row.episode : match.episode,
    episodeEnd: row.episode_end != null ? row.episode_end : match.episodeEnd,
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

function applyPosterEnhance(metas, enhance) {
  const { erdbToken, rpdbKey, posterProvider, customPosterTemplate } = enhance || {};
  const pictoriumOn = !!(enhance && enhance.pictorium && enhance.pictorium.enabled);
  if (!erdbToken && !rpdbKey && posterProvider !== 'custom' && !pictoriumOn) return metas;
  for (const m of metas) {
    const t = m.catalogType === 'series' || m.catalogType === 'anime' ? 'tv' : 'movie';
    const customPoster = posterProvider === 'custom'
      ? require('../../website/public/poster-template').resolve(customPosterTemplate, { ...m, type: m.catalogType })
      : null;
    if (customPoster) {
      m.poster = customPoster;
      m.posterShape = 'poster';
    } else if (posterProvider === 'custom') {
      continue;
    } else if (pictoriumOn && m.tmdbId) {
      const url = builder.buildPictoriumPosterUrl(enhance, { type: m.catalogType, id: m.tmdbId, title: m.name, releaseDate: m.released, imdbId: m.imdbId, fallback: m.poster });
      if (url) { m.poster = url; m.posterShape = 'poster'; }
    } else if (erdbToken && m.tmdbId) {
      m.poster = builder.erdbProxyUrl(enhance, 'poster', `tmdb:${t}:${m.tmdbId}`, m.poster) || m.poster;
    } else if (rpdbKey && m.tmdbId) {
      m.poster = builder.buildRpdbUrl(rpdbKey, 'tmdb', 'poster-default', `${t}-${m.tmdbId}`);
    }
  }
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
    paginate = true,
  } = opts;
  let metas = assembleMetas(rows, userKey);
  sortMetas(metas, sortBy);

  if (paginate) metas = metas.slice(skip, skip + limit);

  // "Use Main Meta": rewrite library rows to canonical tt: ids so Nuvio can
  // enrich them and external stream addons answer them. Batched.
  if (libraryIdMode === 'tt' && tmdbApiKey) {
    const movieIds = metas.filter((m) => m.tmdbId && m.catalogType !== 'series' && m.catalogType !== 'anime').map((m) => m.tmdbId);
    const tvIds = metas.filter((m) => m.tmdbId && (m.catalogType === 'series' || m.catalogType === 'anime')).map((m) => m.tmdbId);
    const [movieImdb, tvImdb] = await Promise.all([
      getImdbIds(tmdbApiKey, 'movie', movieIds).catch(() => new Map()),
      getImdbIds(tmdbApiKey, 'tv', tvIds).catch(() => new Map()),
    ]);
    for (const m of metas) {
      const imdb = (m.catalogType === 'series' || m.catalogType === 'anime' ? tvImdb : movieImdb).get(m.tmdbId) || null;
      if (imdb) m.id = imdb;
      else m._drop = true;
    }
  }

  applyPosterEnhance(metas, enhance);
  return toOutput(metas);
}

async function buildIndexedCatalog({ scopeId, provider = null, type, sortBy, skip, limit, libraryIdMode, tmdbApiKey, lang, enhance, userKey }) {
  const started = Date.now();
  const rows = await store.catalogRows(scopeId, type, provider);
  const metas = await buildFromRows(rows, { userKey, sortBy, skip, limit: limit || 50, type, libraryIdMode, tmdbApiKey, lang, enhance });
  metrics.time('catalogMs', Date.now() - started);
  metrics.request('catalogIndexed');
  return metas;
}

module.exports = { buildIndexedCatalog, buildFromRows, assembleMetas, sortMetas, applyPosterEnhance, hashShort, rowToMeta };
