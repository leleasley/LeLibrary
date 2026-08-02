const fs   = require('fs');
const axios = require('axios');
const { getTorBoxDownloads, getTorBoxStreamLink, getTorBoxFiles, isVideoFile, isJunkVideo } = require('./torbox');
const { getRealDebridDownloads, getRealDebridFiles, getRealDebridStreamLink } = require('./realdebrid');
const providers = require('./providers');
const { searchMetadata, searchCandidates, getMetadata, findEpisodeByAirDate } = require('./tmdb');
const { guessMediaInfo } = require('./parser');
const NodeCache = require('node-cache');

const CACHE_FILE = '/tmp/torbox-tmdb-cache.json';
const matchCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

function loadPersistentCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      let n = 0;
      for (const [k, v] of Object.entries(data)) { matchCache.set(k, v); n++; }
      console.log(`[Cache] Loaded ${n} entries from disk`);
    }
  } catch (e) { console.error('[Cache] Load error:', e.message); }
}

function savePersistentCache() {
  try {
    const data = {};
    for (const k of matchCache.keys()) {
      const v = matchCache.get(k);
      if (v !== undefined) data[k] = v;
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
  } catch (e) { console.error('[Cache] Save error:', e.message); }
}

loadPersistentCache();
setInterval(savePersistentCache, 60_000);

const omdbCache    = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
// Per-user index: `${userKey}:series:12345` → [{item, season, episode}].
// Keyed by user so one user's downloads never leak into another user's
// seasons/episodes/streams.
const tmdbindex = new Map();

// Limit concurrent TMDB API calls to avoid rate-limiting
async function pLimit(tasks, limit) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try { results[idx] = await tasks[idx](); }
      catch (err) { results[idx] = { error: err }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function populateTmdbIndexFromMetas(metas, userKey = '') {
  if (!Array.isArray(metas)) return;
  for (const meta of metas) {
    if (!meta?.torboxItem || !meta.tmdbId) continue;
    const indexKey = `${userKey}:${meta.type || 'movie'}:${meta.tmdbId}`;
    const entry = {
      item: meta.torboxItem,
      season: meta.season,
      episode: meta.episode,
      episodeEnd: meta.episodeEnd ?? null,
    };
    if (!tmdbindex.has(indexKey)) {
      tmdbindex.set(indexKey, [entry]);
    } else {
      const existing = tmdbindex.get(indexKey);
      const already = existing.some(e => e.item.id === entry.item.id && e.item.source === entry.item.source);
      if (!already) existing.push(entry);
    }
  }
}

function buildErdbUrl(token, type, id) {
  if (!token || !type || !id) return null;
  return `https://easyratingsdb.com/${token}/${type}/${id}.jpg`;
}

function buildRpdbUrl(key, idType, posterType, mediaId) {
  if (!key || !mediaId) return null;
  return `https://api.ratingposterdb.com/${key}/${idType}/${posterType}/${mediaId}.jpg?fallback=true`;
}

async function getOmdbRatings(apiKey, imdbId) {
  if (!apiKey || !imdbId) return null;
  const key = `omdb:${imdbId}`;
  const cached = omdbCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const res = await axios.get(`https://www.omdbapi.com/?apikey=${apiKey}&i=${imdbId}&plot=short`, { timeout: 8000 });
    if (res.data?.Response === 'False') { omdbCache.set(key, null); return null; }
    const ratings = {
      imdbRating: res.data.imdbRating || null,
      rtRating: null,
      mcRating: null,
      awards: res.data.Awards || null,
      metascore: res.data.Metascore || null,
    };
    if (res.data.Ratings) {
      for (const r of res.data.Ratings) {
        if (r.Source === 'Rotten Tomatoes') ratings.rtRating = r.Value;
        if (r.Source === 'Metacritic') ratings.mcRating = r.Value;
      }
    }
    omdbCache.set(key, ratings);
    return ratings;
  } catch {
    omdbCache.set(key, null);
    return null;
  }
}

async function getFanartArt(apiKey, tmdbId, type) {
  if (!apiKey || !tmdbId) return null;
  const endpoint = type === 'movie' ? `/movies/${tmdbId}` : `/tv/${tmdbId}`;
  const cacheKey = `fanart:${type}:${tmdbId}`;
  const cached = omdbCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const res = await axios.get(`https://webservice.fanart.tv/v3${endpoint}?api_key=${apiKey}`, { timeout: 8000 });
    const art = {
      poster: res.data.movieposter?.[0]?.url || res.data.tvposter?.[0]?.url || null,
      background: res.data.moviebackground?.[0]?.url || res.data.showbackground?.[0]?.url || null,
      logo: res.data.hdmovieclearart?.[0]?.url || res.data.hdtvlogo?.[0]?.url || null,
    };
    omdbCache.set(cacheKey, art);
    return art;
  } catch {
    omdbCache.set(cacheKey, null);
    return null;
  }
}

function isTmdbAnime(result) {
  return result && (result.isJapaneseAnimation === true);
}

// Parser-level anime detection for a filename (release groups, CJK, anime ep format)
function infoAnime(_meta, name) {
  try {
    return !!(name && guessMediaInfo(name)?.isAnime);
  } catch {
    return false;
  }
}

async function matchItem(item, tmdbApiKey, type, lang) {
  const name     = item.name || item.filename || '';
  const tmdbType = type === 'movie' ? 'movie' : 'series';
  const cacheKey = `match:${type}:${lang}:${name}`;

  const cached = matchCache.get(cacheKey);
  if (cached !== undefined) {
    if (!cached) return null;
    // Re-validate the anime guard on reuse: cached entries may predate the
    // anime filter (disk-persisted across versions) and could otherwise leak
    // anime into the series catalog.
    const cachedAnime = isTmdbAnime(cached);
    if (type === 'series' && (cachedAnime || infoAnime(cached, name))) {
      matchCache.set(cacheKey, null);
      return null;
    }
    if (type === 'anime' && !cachedAnime && !infoAnime(cached, name)) {
      matchCache.set(cacheKey, null);
      return null;
    }
    // Never reuse another user's torrent item — attach the caller's item.
    return { ...cached, torboxItem: item };
  }

  const info = guessMediaInfo(name);
  if (!info) { matchCache.set(cacheKey, null); return null; }

  // Simplified type validation
  if (type === 'movie' && info.isSeries) { matchCache.set(cacheKey, null); return null; }
  if (type === 'series' && (!info.isSeries || info.isAnime)) { matchCache.set(cacheKey, null); return null; }
  if (type === 'anime' && !info.isSeries) { matchCache.set(cacheKey, null); return null; }

  try {
    let season     = info.season;
    let episode    = info.episode;
    let episodeEnd = info.episodeEnd ?? null;

    let result;
    if (info.airDate || (info.airDates && info.airDates.length)) {
      const dates = (info.airDates && info.airDates.length) ? info.airDates : [info.airDate];
      const candidates = await searchCandidates(tmdbApiKey, info.title, 'tv', undefined, lang);
      const verified = [];
      for (const c of candidates) {
        for (const d of dates) {
          const resolved = await findEpisodeByAirDate(tmdbApiKey, c.id, d, lang);
          if (resolved) { verified.push({ result: c, resolved }); break; }
        }
      }
      if (verified.length > 0) {
        verified.sort((a, b) => (b.result.vote_count || 0) - (a.result.vote_count || 0));
        const pick = verified[0];
        result = pick.result;
        season = pick.resolved.season;
        episode = pick.resolved.episode;
        episodeEnd = null;
      } else {
        result = candidates[0] || null;
      }
    } else {
      result = await searchMetadata(tmdbApiKey, info.title, tmdbType, info.year, lang);
    }
    if (!result) { matchCache.set(cacheKey, null); return null; }

    const isAnime = isTmdbAnime(result);

    if (type === 'series' && (isAnime || info.isAnime)) {
      console.log(`[TMDB] "${info.title}" is anime — excluded from series`);
      matchCache.set(cacheKey, null);
      return null;
    }

    if (type === 'anime' && !isAnime && !info.isAnime) {
      matchCache.set(cacheKey, null);
      return null;
    }

    console.log(`[TMDB] "${info.title}" → "${result.title || result.name}" (${result.id}) anime=${isAnime}`);

    const stremioType = type === 'anime' ? 'series' : type;

    const meta = {
      id:                   `torbox:${stremioType}:${result.id}`,
      type:                 stremioType,
      name:                 result.title || result.name,
      poster:               result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : null,
      releaseInfo:          (result.release_date || result.first_air_date || '').split('-')[0],
      released:             result.release_date || result.first_air_date,
      tmdbId:               result.id,
      catalogType:          type,
      isJapaneseAnimation:  isAnime,
      torboxItem:           item,
      season,
      episode,
      episodeEnd,
    };

    matchCache.set(cacheKey, meta);
    return meta;
  } catch (err) {
    console.error(`[TMDB] Error "${name}": ${err.message}`);
    matchCache.set(cacheKey, null);
    return null;
  }
}

async function buildCatalog(downloads, tmdbApiKey, type, sortBy, extra, lang = 'pt-BR', enhance = {}, opts = {}) {
  const skip      = parseInt(extra?.skip) || 0;
  const search    = extra?.search?.toLowerCase();
  const PAGE_SIZE = 50;
  const { progressive = false } = opts;
  const userKey   = opts.userKey || '';
  const hideAnime = !!opts.hideAnime;

  const allRelevant = [];
  for (const item of downloads) {
    const name = item.name || item.filename || '';
    const info = guessMediaInfo(name);
    if (!info) continue;
    if (type === 'movie'  && (info.isSeries || info.isAnime))  continue;
    if (type === 'series' && (!info.isSeries || info.isAnime)) continue;
    if (type === 'anime'  && !info.isSeries)                   continue; // anime uses SxxExx or custom format
    // "Hide anime" must strip anime from the movie/series catalogs too,
    // not just remove the anime catalog from the manifest.
    if (hideAnime && type !== 'anime' && info.isAnime) continue;
    allRelevant.push({ item, info });
  }

  console.log(`[Catalog] type=${type} | raw=${downloads.length} → filtered=${allRelevant.length}${hideAnime ? ' (hideAnime)' : ''}`);

  // Progressive mode: split into already-matched (instant) vs new (background).
  // New items are still matched — just after responding, not blocking it.
  const BATCH_SIZE = 6;
  let tasks;
  let completion = null;

  let freshCount = 0;
  if (progressive) {
    const cached = [];
    const fresh  = [];
    for (const { item, info } of allRelevant) {
      const name   = item.name || item.filename || '';
      const ck     = `match:${type}:${lang}:${name}`;
      if (matchCache.has(ck)) cached.push({ item, info });
      else fresh.push({ item, info });
    }
    freshCount = fresh.length;
    console.log(`[Catalog] Progressive: ${cached.length} cached, ${fresh.length} to match in background`);
    // Only fast-return a partial when the majority is already matched.
    // A cold or near-cold cache (few cached) would return a near-empty page —
    // worse than blocking for the full build, so fall back to the full build.
    if (cached.length === 0 || cached.length < fresh.length) {
      tasks = allRelevant.map(({ item }) => () => matchItem(item, tmdbApiKey, type, lang));
    } else {
      tasks = cached.map(({ item }) => () => matchItem(item, tmdbApiKey, type, lang));
      if (fresh.length > 0) {
        completion = pLimit(fresh.map(({ item }) => () => matchItem(item, tmdbApiKey, type, lang)), BATCH_SIZE);
      }
    }
  } else {
    tasks = allRelevant.map(({ item }) => () => matchItem(item, tmdbApiKey, type, lang));
  }

  const rawResults = await pLimit(tasks, BATCH_SIZE);
  let results = rawResults.filter(r => r && !r.error);

  // When anime is hidden, drop TMDB-flagged anime from movie/series catalogs
  // (parser-level anime was already excluded above / in matchItem).
  if (hideAnime && type !== 'anime') {
    results = results.filter(r => !r.isJapaneseAnimation);
  }

  const seen = new Map();
  for (const meta of results) {
    const indexKey = `${userKey}:${meta.type}:${meta.tmdbId}`;
    const entry    = { item: meta.torboxItem, season: meta.season, episode: meta.episode, episodeEnd: meta.episodeEnd ?? null };

    if (!tmdbindex.has(indexKey)) {
      tmdbindex.set(indexKey, [entry]);
    } else {
      const existing = tmdbindex.get(indexKey);
      if (!existing.some(e => e.item.id === entry.item.id)) existing.push(entry);
    }

    if (!seen.has(meta.id)) seen.set(meta.id, { ...meta, torboxItems: [entry] });
  }

  let metas = Array.from(seen.values());
  if (search) metas = metas.filter(m => m.name?.toLowerCase().includes(search));

  if (sortBy === 'data_lancamento') {
    metas.sort((a, b) => (b.released || '').localeCompare(a.released || ''));
  } else if (sortBy === 'titulo') {
    metas.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
  } else {
    metas.sort((a, b) => {
      const aDate = a.torboxItems?.[0]?.item?.created_at || '';
      const bDate = b.torboxItems?.[0]?.item?.created_at || '';
      return bDate.localeCompare(aDate);
    });
  }

  const paginated = metas.slice(skip, skip + PAGE_SIZE);
  console.log(`[Catalog] Returning ${paginated.length} items (skip=${skip}, total=${metas.length})`);

  const { erdbToken, rpdbKey } = enhance;
  if (erdbToken || rpdbKey) {
    for (const m of paginated) {
      const t = m.catalogType === 'series' ? 'tv' : 'movie';
      if (erdbToken && m.tmdbId) {
        m.poster = buildErdbUrl(erdbToken, 'poster', `tmdb:${t}:${m.tmdbId}`);
      } else if (rpdbKey && m.tmdbId) {
        m.poster = buildRpdbUrl(rpdbKey, 'tmdb', 'poster-default', `${t}-${m.tmdbId}`);
      }
    }
  }

  const output = paginated
    .map(({ torboxItem, torboxItems, tmdbId, released, catalogType, isJapaneseAnimation, season, episode, ...rest }) => rest)
    .filter(m => m.poster);

  if (completion) return { metas: output, completion, _fresh: freshCount };
  return output;
}

async function buildMeta(tmdbId, type, tmdbApiKey, lang, config = {}, enhance = {}, userKey = '') {
  const tmdbType = type === 'series' || type === 'anime' ? 'series' : 'movie';

  // Check if tmdbindex already has entries (per-user) before fetching downloads
  const indexKey = `${userKey}:${type}:${tmdbId}`;
  const existingEntries = tmdbindex.get(indexKey)
    || tmdbindex.get(`${userKey}:series:${tmdbId}`)
    || tmdbindex.get(`${userKey}:anime:${tmdbId}`);

  // Fetch TMDB metadata; downloads only if needed.
  // One provider failing (expired key, API hiccup) must not empty the result.
  const [meta, downloads] = await Promise.all([
    getMetadata(tmdbApiKey, tmdbId, tmdbType, lang),
    existingEntries?.length ? Promise.resolve([]) : providers.fetchDownloads(config),
  ]);

  if (!meta) return meta;

  try {
    if (tmdbType === 'movie') {
      // Movies skip the episode-availability pass (nothing to filter) — but
      // still fall through to the poster/rating enhancement below.
    } else {
    const availableEps = new Set();
    const indexEntries = [];

    // If tmdbindex already has entries for this title (populated by catalog), use directly
    if (existingEntries?.length > 0) {
      for (const { item, season, episode, episodeEnd } of existingEntries) {
        indexEntries.push({ item, season, episode, episodeEnd });
        if (episode != null && season != null) {
          const epFrom = parseInt(episode, 10);
          const epTo   = episodeEnd != null ? parseInt(episodeEnd, 10) : epFrom;
          for (let ep = epFrom; ep <= epTo; ep++) availableEps.add(`${season}:${ep}`);
        } else if (season != null) {
          availableEps.add(`season:${season}`);
        } else {
          availableEps.add('all');
        }
      }
    } else {
      // Index not populated — full match, but in parallel per unique title
      const titleCache = new Map();
      const toSearch   = [];

      for (const item of downloads) {
        const name = item.name || item.filename || '';
        const info = guessMediaInfo(name);
        if (!info || !info.isSeries) continue;

        let matched = false;
        let cachedMeta = null;

        for (const t of ['anime', 'series']) {
          for (const l of [lang, 'pt-BR', 'en-US']) {
            const c = matchCache.get(`match:${t}:${l}:${name}`);
            if (c && String(c.tmdbId) === String(tmdbId)) {
              matched = true; cachedMeta = c; break;
            }
          }
          if (matched) break;
        }

        if (!matched) {
          const tk = info.airDate ? info.title : (info.title + '|' + (info.year || ''));
          toSearch.push({ item, info, tk, cachedMeta: null });
        } else {
          toSearch.push({ item, info, tk: null, cachedMeta });
        }
      }

      // Fetch unique titles on TMDB in parallel
      const uniqueTitles = [...new Set(toSearch.filter(x => x.tk).map(x => x.tk))];
      await Promise.all(uniqueTitles.map(async tk => {
        if (titleCache.has(tk)) return;
        const [title, year] = tk.split('|');
        try {
          if (year === undefined) {
            const cands = await searchCandidates(tmdbApiKey, title, 'tv', undefined, lang);
            titleCache.set(tk, cands.map(c => String(c.id)));
          } else {
            const r = await searchMetadata(tmdbApiKey, title, 'tv', year || undefined, lang);
            titleCache.set(tk, r ? String(r.id) : null);
          }
        } catch { titleCache.set(tk, null); }
      }));

      for (const { item, info, tk, cachedMeta } of toSearch) {
        const matched = cachedMeta != null
          || (info.airDate
            ? (titleCache.get(tk) || []).some(id => String(id) === String(tmdbId))
            : (tk && titleCache.get(tk) === String(tmdbId)));
        if (!matched) continue;

        let season     = cachedMeta?.season     ?? info.season;
        let episode    = cachedMeta?.episode    ?? info.episode;
        let episodeEnd = cachedMeta?.episodeEnd ?? info.episodeEnd;
        if ((info.airDate || (info.airDates && info.airDates.length)) && episode == null) {
          const dates = (info.airDates && info.airDates.length) ? info.airDates : [info.airDate];
          for (const d of dates) {
            const resolved = await findEpisodeByAirDate(tmdbApiKey, tmdbId, d, lang);
            if (resolved) { season = resolved.season; episode = resolved.episode; episodeEnd = null; break; }
          }
        }

        indexEntries.push({ item, season, episode, episodeEnd });

        if (episode != null && season != null) {
          const epFrom = parseInt(episode, 10);
          const epTo   = episodeEnd != null ? parseInt(episodeEnd, 10) : epFrom;
          for (let ep = epFrom; ep <= epTo; ep++) availableEps.add(`${season}:${ep}`);
        } else if (season != null) {
          availableEps.add(`season:${season}`);
        } else {
          availableEps.add('all');
        }
      }
    }

    if (indexEntries.length > 0) {
      tmdbindex.set(indexKey, indexEntries);
      console.log(`[Meta] Index updated: ${indexKey} → ${indexEntries.length} items`);
    }

    if (availableEps.size > 0) {
      const totalBefore = meta.videos?.length || 0;
      meta.videos = (meta.videos || []).filter(v =>
        availableEps.has(`${v.season}:${v.episode}`) ||
        availableEps.has(`season:${v.season}`) ||
        availableEps.has('all')
      );
      console.log(`[Meta] tmdbId=${tmdbId} → ${meta.videos.length}/${totalBefore} eps available`);
    } else {
      meta.videos = [];
      console.log(`[Meta] tmdbId=${tmdbId} → no episodes available`);
    }
    }
  } catch (e) {
    console.error('[Meta] Error filtering episodes:', e.message);
  }

  if (meta) {
    const { erdbToken, rpdbKey, omdbKey, fanartKey, posterProvider, enhanceBackground, enhanceLogo } = enhance;
    const imdbId = meta.imdbId;

    if (erdbToken && imdbId) {
      meta.poster = buildErdbUrl(erdbToken, 'poster', imdbId);
      if (enhanceBackground) meta.background = buildErdbUrl(erdbToken, 'backdrop', imdbId);
      if (enhanceLogo) meta.logo = buildErdbUrl(erdbToken, 'logo', imdbId);
    } else if (rpdbKey && imdbId) {
      meta.poster = buildRpdbUrl(rpdbKey, 'imdb', 'poster-default', imdbId);
      if (enhanceBackground) meta.background = buildRpdbUrl(rpdbKey, 'imdb', 'backdrop-default', imdbId);
      if (enhanceLogo) meta.logo = buildRpdbUrl(rpdbKey, 'imdb', 'logo-default', imdbId);
    } else if (fanartKey && meta.tmdbId) {
      const tmdbType = meta.type === 'movie' ? 'movie' : 'tv';
      const art = await getFanartArt(fanartKey, meta.tmdbId, tmdbType).catch(() => null);
      if (art) {
        if (enhanceBackground && art.background) meta.background = art.background;
        if (enhanceLogo && art.logo) meta.logo = art.logo;
        if (!erdbToken && !rpdbKey && art.poster) meta.poster = art.poster;
      }
    }

    if (omdbKey && imdbId) {
      const ratings = await getOmdbRatings(omdbKey, imdbId).catch(() => null);
      if (ratings) {
        if (ratings.imdbRating) meta.imdbRating = ratings.imdbRating;
        if (!meta.app_extras) meta.app_extras = {};
        meta.app_extras.ratings = {};
        if (ratings.rtRating) meta.app_extras.ratings.rottenTomatoes = ratings.rtRating;
        if (ratings.mcRating) meta.app_extras.ratings.metacritic = ratings.mcRating;
        if (ratings.awards) meta.app_extras.awards = ratings.awards;
      }
    }
  }

  return meta;
}

async function buildStreams(config = {}, tmdbApiKey, type, tmdbId, season, episode, lang, customStreams, userKey = '') {
  // Try both indexes (series and anime) since ID is always torbox:series:X
  const possibleKeys = [
    `${userKey}:${type === 'anime' ? 'series' : type}:${tmdbId}`,
    `${userKey}:series:${tmdbId}`,
    `${userKey}:anime:${tmdbId}`
  ];
  
  let entries = null;
  let usedKey = null;
  
  for (const key of possibleKeys) {
    const found = tmdbindex.get(key);
    if (found && found.length > 0) {
      entries = found;
      usedKey = key;
      break;
    }
  }

  console.log(`[Stream] Looking up tmdbId=${tmdbId} type=${type} | s=${season} e=${episode}`);
  console.log(`[Stream] Index found: ${usedKey || 'none'} (${entries?.length || 0} items)`);

  if (!entries || entries.length === 0) {
    console.log(`[Stream] Rebuilding index...`);
    entries = [];
    const downloads = await providers.fetchDownloads(config);

    for (const item of downloads) {
      const name = item.name || item.filename || '';
      let found  = false;

      for (const t of ['anime', 'series', 'movie']) {
        for (const l of [lang, 'pt-BR', 'en-US']) {
          const c = matchCache.get(`match:${t}:${l}:${name}`);
          if (c && String(c.tmdbId) === String(tmdbId)) {
            entries.push({ item, season: c.season, episode: c.episode, episodeEnd: c.episodeEnd ?? null });
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }

    if (entries.length === 0 && tmdbApiKey) {
      console.log(`[Stream] TMDB fallback...`);
      const tmdbType = type === 'movie' ? 'movie' : 'series';
      const candidates = (downloads || []).filter(item => {
        const name = item.name || item.filename || '';
        const info = guessMediaInfo(name);
        if (!info) return false;
        if (tmdbType === 'movie'  && info.isSeries)  return false;
        if (tmdbType === 'series' && !info.isSeries) return false;
        return true;
      });

      const candidateTasks = candidates.map(item => async () => {
        const name = item.name || item.filename || '';
        const info = guessMediaInfo(name);
        try {
          if (info.airDate || (info.airDates && info.airDates.length)) {
            const cands = await searchCandidates(tmdbApiKey, info.title, 'tv', undefined, lang);
            const hit = cands.find(c => String(c.id) === String(tmdbId));
            if (hit) {
              const dates = (info.airDates && info.airDates.length) ? info.airDates : [info.airDate];
              let resolved = null;
              for (const d of dates) {
                resolved = await findEpisodeByAirDate(tmdbApiKey, hit.id, d, lang);
                if (resolved) break;
              }
              entries.push({ item, season: resolved?.season ?? null, episode: resolved?.episode ?? null, episodeEnd: null });
            }
            return;
          }
          const result = await searchMetadata(tmdbApiKey, info.title, tmdbType, info.year, lang);
          if (result && String(result.id) === String(tmdbId)) {
            entries.push({ item, season: info.season, episode: info.episode, episodeEnd: info.episodeEnd ?? null });
          }
        } catch {}
      });
      await pLimit(candidateTasks, 6);
    }

    if (entries.length > 0) {
      const saveKey = `${userKey}:${type === 'movie' ? 'movie' : 'series'}:${tmdbId}`;
      tmdbindex.set(saveKey, entries);
      console.log(`[Stream] Index saved: ${saveKey} → ${entries.length} items`);
    }
  }

  if (!entries || entries.length === 0) {
    console.log(`[Stream] No items found`);
    return [];
  }

  console.log(`[Stream] Filtering ${entries.length} items`);

  let filtered;
  if (type === 'series' || type === 'anime') {
    const strict = entries.filter(({ season: s, episode: e, episodeEnd: eEnd }) => {
      // If season doesn't match, reject
      if (season != null && season !== '' && s != null && String(s) !== String(season)) return false;
      
      // If item has no specific episode (full pack), accept by season
      if (e == null) return true;
      
      // If has episode, validate range
      if (episode != null && episode !== '') {
        const epReq  = parseInt(episode, 10);
        const epFrom = parseInt(e, 10);
        const epTo   = (eEnd != null) ? parseInt(eEnd, 10) : epFrom;
        if (epReq < epFrom || epReq > epTo) return false;
      }
      return true;
    });

    if (strict.length > 0) {
      filtered = strict;
      console.log(`[Stream] Strict filter: ${filtered.length} entries`);
    } else {
      const epOnly = (episode != null && episode !== '')
        ? entries.filter(({ episode: e, episodeEnd: eEnd }) => {
            if (e == null) return false;
            const epReq  = parseInt(episode, 10);
            const epFrom = parseInt(e, 10);
            const epTo   = (eEnd != null) ? parseInt(eEnd, 10) : epFrom;
            return epReq >= epFrom && epReq <= epTo;
          })
        : [];

      if (epOnly.length > 0) {
        filtered = epOnly;
        console.log(`[Stream] Fallback ep-only: ${filtered.length} entries`);
      } else {
        // Last resort: match by season only (never return every entry across
        // all seasons — that was serving the wrong seasons/episodes).
        filtered = season != null && season !== ''
          ? entries.filter(({ season: s }) => s != null && String(s) === String(season))
          : [];
        console.log(`[Stream] Fallback season-only: ${filtered.length} entries`);
      }
    }
  } else {
    filtered = entries;
  }
  
  console.log(`[Stream] ${filtered.length} item(s) filtered | s=${season} e=${episode}`);

  const rawStreams = [];
  await Promise.all(filtered.map(async ({ item }) => {
    const getFiles = () => providers.getFiles(config, item);
    const getLink  = (fileId) => providers.getStreamLink(config, item, fileId);

    const files      = await getFiles();
    let videoFiles = files.filter(f => isVideoFile(f.name || f.short_name));
    // Drop sample/trailer/featurette files, but only if real files remain
    const realFiles = videoFiles.filter(f => !isJunkVideo(f.name || f.short_name));
    if (realFiles.length > 0) videoFiles = realFiles;

    let targetFiles = videoFiles;
    if ((type === 'series' || type === 'anime') && episode != null && episode !== '' && videoFiles.length > 1) {
      const byEp = videoFiles.filter(f => {
        const fname = f.name || f.short_name || '';
        const info  = guessMediaInfo(fname);
        if (!info || info.episode == null) return false;
        const epReq  = parseInt(episode, 10);
        const epFrom = parseInt(info.episode, 10);
        const epTo   = (info.episodeEnd != null) ? parseInt(info.episodeEnd, 10) : epFrom;
        return epReq >= epFrom && epReq <= epTo;
      });
      if (byEp.length > 0) {
        targetFiles = byEp;
      } else {
        targetFiles = [];
        console.log(`[Stream] No file matches s=${season} e=${episode} → no streams`);
      }
    }

    const bingeKey = item.source + ':' + item.id;

    if (targetFiles.length > 0) {
      for (const file of targetFiles) {
        try {
          const url = await getLink(file.id);
          if (!url) continue;
          const fname = file.name || file.short_name || item.name || '';
          rawStreams.push({ url, fname, size: file.size || 0, source: item.source, bingeKey });
        } catch {}
      }
    } else if (videoFiles.length <= 1) {
      // Single-file torrent (or unparseable filenames) — serve the whole item.
      // When the requested episode didn't match inside a multi-file torrent,
      // return nothing instead of playing the wrong file.
      try {
        const url = await getLink(0);
        if (url) rawStreams.push({ url, fname: item.name || '', size: item.size || 0, source: item.source, bingeKey });
      } catch {}
    } else {
      console.log(`[Stream] No matching file for s=${season} e=${episode} — skipping`);
    }
  }));

  const langCode = (lang || 'pt-BR').split('-')[0].toLowerCase();
  rawStreams.sort((a, b) => {
    const dl = langScore(b.fname, langCode) - langScore(a.fname, langCode);
    if (dl !== 0) return dl;
    const dq = qualityScore(b.fname) - qualityScore(a.fname);
    if (dq !== 0) return dq;
    return b.size - a.size;
  });

  const result = rawStreams.map(({ url, fname, size, source, bingeKey }) => {
    const behaviorHints = { notWebReady: false };
    // Subtitle addons hash-match on the bare filename, not the folder path
    const baseName = (fname || '').split('/').pop();
    if (baseName) behaviorHints.filename = baseName;
    if (bingeKey) behaviorHints.bingeGroup = bingeKey;
    return {
      url,
      name:        formatStreamName(fname, source),
      description: formatStreamDesc(fname, size, source),
      behaviorHints,
    };
  });

  if (customStreams && Array.isArray(customStreams)) {
    for (const cs of customStreams) {
      if (cs.type === type || cs.type === '*') {
        result.push({
          name: cs.name || 'Custom',
          url: cs.url,
          description: cs.description || `🎯 ${cs.name || 'Custom Stream'}`,
          behaviorHints: { notWebReady: true },
        });
      }
    }
  }

  return result;
}

function langScore(n = '', langCode = 'pt') {
  const u = n.toUpperCase();
  if (langCode === 'pt') {
    if (u.match(/\bDUAL\b|\bDUBLADO\b|\bNACIONAL\b/)) return 3;
    if (u.match(/\bPT.?BR\b|\bPT.?PT\b/))              return 2;
    if (u.match(/\bLEGENDADO\b|\bPLSUB\b/))            return 1;
  }
  if (langCode === 'en' && u.match(/\bENGLISH\b|\bENG\b/)) return 2;
  return 0;
}

function qualityScore(n = '') {
  const u = n.toUpperCase();
  if (u.match(/\b(2160P|4K|UHD)\b/)) return 4;
  if (u.match(/\b1080P\b/))           return 3;
  if (u.match(/\b720P\b/))            return 2;
  if (u.match(/\b480P\b/))            return 1;
  return 0;
}

// ── Unicode small caps ────────────────────────────────────────────────────
const SMALL_CAPS_MAP = {
  a:'ᴀ', b:'ʙ', c:'ᴄ', d:'ᴅ', e:'ᴇ', f:'ғ', g:'ɢ', h:'ʜ',
  i:'ɪ', j:'ᴊ', k:'ᴋ', l:'ʟ', m:'ᴍ', n:'ɴ', o:'ᴏ', p:'ᴘ',
  r:'ʀ', s:'s', t:'ᴛ', u:'ᴜ', v:'ᴠ', w:'ᴡ', y:'ʏ', z:'ᴢ',
};
function toSmallCaps(str = '') {
  return str.toLowerCase().split('').map(c => SMALL_CAPS_MAP[c] || c).join('');
}

// ── Brazilian release groups (flag 🇧🇷) ──────────────────────────────
const BR_GROUP_RE = /^(bioma|c76|franceira|sigla|sf|tossato|sh4down|7sprit7|pia|riper|tomtom|andrehsa|fly|cza)$/i;

// ── Extractors ────────────────────────────────────────────────────────────

function extractQuality(n = '') {
  const u = n.toUpperCase();
  if (u.match(/\b(2160P|4K|UHD)\b/)) return '4K';
  if (u.match(/\b1080P\b/))           return '1080p';
  if (u.match(/\b720P\b/))            return '720p';
  if (u.match(/\b576P\b/))            return '576p';
  if (u.match(/\b480P\b/))            return '480p';
  return '';
}

/** Returns array of visual tags in AIOStreams style (HDR10+, DV, 10bit…) */
function extractVisualTags(n = '') {
  const u = n.toUpperCase();
  const tags = [];
  if (u.match(/DOLBY.?VISION|\bDV\b/))    tags.push('⭐ ᴅᴠ');
  if (u.match(/HDR10(\+|PLUS)/))           tags.push('💫 ʜᴅʀ¹⁰⁺');
  else if (u.match(/\bHDR10\b/))           tags.push('🌟 ʜᴅʀ¹⁰');
  else if (u.match(/\bHDR\b/))             tags.push('🌟 ʜᴅʀ');
  if (u.match(/\b10.?BIT\b/))              tags.push('🎨 10ʙɪᴛ');
  return tags;
}

function extractCodec(n = '') {
  const u = n.toUpperCase();
  if (u.match(/\bH\.?265\b|\bHEVC\b|\bX265\b/)) return 'ʜᴇᴠᴄ';
  if (u.match(/\bH\.?264\b|\bAVC\b|\bX264\b/))  return 'ᴀᴠᴄ';
  if (u.match(/\bAV1\b/))                         return 'ᴀᴠ1';
  return '';
}

function extractSource(n = '') {
  const u = n.toUpperCase();
  if (u.match(/\bBLURAY\b|\bBLU.RAY\b|\bBDRIP\b/)) return 'BluRay';
  if (u.match(/\bWEB.DL\b|\bWEBDL\b/))              return 'WEB-DL';
  if (u.match(/\bWEBRIP\b|\bWEB.RIP\b/))            return 'WEBRip';
  if (u.match(/\bHDTV\b/))                           return 'HDTV';
  if (u.match(/\bDVDRIP\b/))                         return 'DVDRip';
  return '';
}

function extractAudio(n = '') {
  const u = n.toUpperCase();
  const parts = [];
  if      (u.match(/\bDUAL\b|\bDUBLADO\b/))      parts.push('Dublado');
  else if (u.match(/\bNACIONAL\b|\bPT.?BR\b/))    parts.push('PT-BR');
  else if (u.match(/\bPT.?PT\b/))                 parts.push('PT-PT');
  else if (u.match(/\bLEGENDADO\b/))              parts.push('Leg.');
  else if (u.match(/\bENG(LISH)?\b/))             parts.push('EN');
  // Audio codec: TrueHD + Atmos can coexist
  if (u.match(/\bTRUEHD\b/))                      parts.push('TrueHD');
  if (u.match(/\bATMOS\b/))                        parts.push('Atmos');
  else if (!u.match(/\bTRUEHD\b/)) {
    if      (u.match(/\bDTS.?HD\b/))              parts.push('DTS-HD');
    else if (u.match(/\bDTS\b/))                  parts.push('DTS');
    else if (u.match(/\bDDP?5\.?1\b|\bDD5\.?1\b/)) parts.push('DD5.1');
    else if (u.match(/\bAAC\b/))                  parts.push('AAC');
  }
  return parts.join(' · ');
}

function extractSubs(n = '') {
  const u = n.toUpperCase();
  if (u.match(/\bMULTI.?SUB\b/))                         return 'Multi';
  if (u.match(/\bPLSUB\b/))                              return 'PT';
  if (u.match(/\bLEGENDADO\b/) && !u.match(/\bDUAL\b/)) return 'PT-BR';
  return '';
}

function extractReleaseGroup(n = '') {
  const base = n.replace(/\.(mkv|mp4|avi|mov|ts|wmv|m4v|webm)$/i, '');
  const m = base.match(/-([A-Za-z0-9]{2,12})$/);
  return m ? m[1] : '';
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1024 / 1024 / 1024;
  return gb >= 1
    ? `${gb.toFixed(2)} ɢʙ`
    : `${(bytes / 1024 / 1024).toFixed(0)} ᴍʙ`;
}

// ── Main formatters ───────────────────────────────────────────────────────

/**
 * Stream title line (`name` field).
 * Format inspired by AIOStreams:
 *   Line 1 → provider + ⚡ cached indicator
 *   Line 2 → resolution · source
 *   Line 3 → visual tags (HDR / DV / 10bit) — only if present
 */
function formatStreamName(filename = '', source = '') {
  const pid = providers.providerBySource(source);
  const provider = pid === 'realdebrid' ? '🔴 RD'
    : pid === 'alldebrid' ? '💠 AD'
    : pid === 'premiumize' ? '🧲 PM'
    : '📦 TorBox';

  const quality  = extractQuality(filename);
  const resLabel = { '4K':'🟣 4ᴋ', '1080p':'🔵 ғʜᴅ', '720p':'🟢 ʜᴅ', '576p':'⚫ sᴅ', '480p':'⚫ sᴅ' }[quality] || '';
  const src      = extractSource(filename);

  const line1 = `${provider} ⚡`;
  const line2  = [resLabel, src].filter(Boolean).join(' · ');
  const tags   = extractVisualTags(filename).join(' ');

  return [line1, line2, tags].filter(Boolean).join('\n');
}

/**
 * Detailed stream description (`description` field).
 * Format inspired by AIOStreams:
 *   Line 1 → size  codec
 *   Line 2 → audio  subtitles
 *   Line 3 → group (with 🇧🇷 if Brazilian group)
 *   Line 4 → filename in smallcaps
 */
function formatStreamDesc(filename = '', size, source) {
  const display   = filename.replace(/\.(mkv|mp4|avi|mov|ts|wmv|m4v|webm)$/i, '');
  const sz        = size ? `💾 ${formatBytes(size)}` : '';
  const codec     = extractCodec(filename);
  const langStr   = extractAudio(filename);
  const subs      = extractSubs(filename);
  const group     = extractReleaseGroup(filename);
  const isBR      = group && BR_GROUP_RE.test(group);

  const lines = [];

  // Line 1: size + codec
  const infoRow = [sz, codec ? `⚙️ ${codec}` : ''].filter(Boolean).join('   ');
  if (infoRow) lines.push(infoRow);

  // Line 2: audio + subtitles
  const audioRow = [
    langStr ? `🔊 ${langStr}` : '',
    subs    ? `💬 ${subs}`    : '',
  ].filter(Boolean).join('   ');
  if (audioRow) lines.push(audioRow);

  // Line 3: group (BR flag for known groups)
  if (group) {
    const flag = isBR ? '🇧🇷 ' : '';
    lines.push(`${flag}🫟 ${toSmallCaps(group)}`);
  }

  // Line 4: filename in smallcaps
  if (display) lines.push(`✔️${toSmallCaps(display)}`);

  return lines.join('\n');
}

module.exports = { buildCatalog, buildMeta, buildStreams, getRealDebridDownloads, getOmdbRatings, populateTmdbIndexFromMetas };
