// @ts-nocheck
// Background metadata matching for the index-first engine. The match DECISION
// comes from the single core (matching/resolve.ts); this module only builds
// the full meta from the canonical identity, resolves IMDb ids, persists the
// result, and publishes it to the shared match cache for request paths.
const builder = require('../catalog/builder.ts');
const cache = require('../runtime/cache.ts');
const { resolveMatch, matchVersion, retryVersion } = require('../matching/resolve.ts');
const { guessMediaInfo } = require('../media/parser.ts');
const { getImdbId } = require('../media/tmdb.ts');
const { offlineMatchFromItem, normalizeTitle } = require('./diff.ts');
const store = require('./store.ts');
const overrides = require('./overrides.ts');
const sharedFixes = require('./shared-fixes.ts');
const boxsets = require('./boxsets.ts');
const tmdbKey = require('./tmdb-key.ts');
const metrics = require('./metrics.ts');
const { pLimit } = require('./util.ts');

function offlineEnabled() {
  return process.env.LIBRARY_MATCH_OFFLINE === '1' || process.env.LIBRARY_MATCH_OFFLINE === 'true';
}

// Pack signal for the transitional safety net: two or more video files
// embedded on the item (mirrors the legacy probe gate, cheaply).
function hasPackFiles(raw) {
  try {
    const list = [];
    for (const key of ['files', 'file_list', 'innerFiles']) {
      const files = raw && raw[key];
      if (Array.isArray(files)) list.push(...files);
      else if (files && typeof files === 'object') list.push(...Object.values(files));
    }
    let videos = 0;
    for (const file of list) {
      const n = String((file && (file.name || file.path || file.filename)) || '').toLowerCase();
      if (!n) continue;
      if (/\.(mkv|mp4|avi|ts|m2ts|webm|mov)$/.test(n)) videos++;
      if (videos >= 2) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function embeddedVideoFiles(raw) {
  const files = [];
  for (const key of ['files', 'file_list', 'innerFiles']) {
    const value = raw && raw[key];
    if (Array.isArray(value)) files.push(...value);
    else if (value && typeof value === 'object') files.push(...Object.values(value));
  }
  return files.filter((file) => {
    const filename = String((file && (file.name || file.short_name || file.path || file.filename)) || '');
    return /\.(mkv|mp4|avi|ts|m2ts|webm|mov)$/i.test(filename);
  });
}

// Some scene groups put their name FIRST: "honor-wwe.wrestlemania.15.1999.
// 720p.web.h264.mkv". The parser keeps "honor" in the title and TMDB finds
// nothing. Only a short lower-case word glued by '-' to a dotted release name
// that carries a year or a quality/source tag counts, and it is only tried
// after the normal search found no candidate.
function stripLeadingGroupPrefix(name) {
  const base = String(name || '').trim();
  const m = /^([a-z0-9]{2,12})-([a-z0-9][^\s]*\.[^\s]*)$/.exec(base);
  if (!m) return null;
  const rest = m[2];
  if (!/(^|[.])((19|20)\d{2}|\d{3,4}p|web|webrip|web-dl|bluray|bdrip|hdtv|dvdrip|x26[45]|h\.?26[45])([.]|$)/i.test(rest)) return null;
  return rest;
}

// Extra release names for a hash-named item, best first: the scene release
// name an .nfo/.sfv file carries ("amadeus.1984.dc.internal.repack.1080p.
// bluray.x264-classic.nfo" next to "cls-amadeusrp.mkv"), then inner video
// names without a leading group ("s7-flipped.1080p.mkv"). Only names with a
// year or a quality/source tag count, so a random file never becomes a title.
function releaseNameHints(raw) {
  const names = [];
  for (const key of ['files', 'file_list', 'innerFiles']) {
    const value = raw && raw[key];
    const list = Array.isArray(value) ? value : (value && typeof value === 'object' ? Object.values(value) : []);
    for (const file of list) {
      const full = String((file && (file.name || file.short_name || file.path || file.filename)) || '');
      if (full) names.push(mediaFileName(full));
    }
  }
  const tagged = (value) => /(^|[.\s_-])((19|20)\d{2}|\d{3,4}p|web|webrip|web-dl|bluray|bdrip|hdtv|dvdrip|x26[45]|h\.?26[45])([.\s_-]|$)/i.test(value);
  const hints = [];
  const add = (value) => { const v = String(value || '').trim(); if (v && tagged(v) && !hints.includes(v)) hints.push(v); };
  for (const n of names) {
    if (/\.(nfo|sfv)$/i.test(n) && !/sample/i.test(n)) add(n.replace(/\.(nfo|sfv)$/i, ''));
  }
  for (const n of names) {
    if (!/\.(mkv|mp4|avi|ts|m2ts|webm|mov)$/i.test(n) || /sample/i.test(n)) continue;
    const bare = n.replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)$/, '');
    const stripped = stripLeadingGroupPrefix(bare) || (/^[a-z0-9]{2,12}-[^\s]+$/.test(bare) ? bare.replace(/^[a-z0-9]{2,12}-/, '') : null);
    if (stripped) add(stripped);
  }
  return hints.slice(0, 3);
}

function isOpaqueOuterName(name) {
  return /^[a-f0-9]{32,}$/i.test(String(name || '').replace(/\.[^.]+$/, '').trim());
}

function mediaFileName(value) {
  const parts = String(value || '').split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(value || '');
}

// Recover a movie title from embedded video filenames when the provider's
// outer download name finds no TMDB candidate. For multi-video packs, require
// one title/year to account for a strict majority of all video files; a mixed
// collection is left unresolved rather than guessed.
function embeddedMovieCandidate(files) {
  const videos = (Array.isArray(files) ? files : []).map((file) => ({
    file,
    name: mediaFileName(file && (file.name || file.short_name || file.path || file.filename)),
  })).filter(({ name }) => /\.(mkv|mp4|avi|ts|m2ts|webm|mov)$/i.test(name));
  if (!videos.length) return null;

  const groups = new Map();
  for (const { name } of videos) {
    let info = null;
    try { info = guessMediaInfo(name); } catch { /* malformed embedded filename */ }
    if (!info?.title || info.isSeries || info.season != null) continue;
    const title = String(info.title).trim();
    const year = Number.isInteger(info.year) ? info.year : null;
    const key = `${normalizeTitle(title)}|${year || ''}`;
    const group = groups.get(key) || { key, title, year, count: 0 };
    group.count++;
    groups.set(key, group);
  }
  const ranked = [...groups.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const best = ranked[0];
  if (!best) return null;
  if (videos.length > 1 && (best.count < 2 || best.count <= videos.length / 2)) return null;
  return { title: best.title, year: best.year };
}

// Some providers give multi-file torrents an opaque outer name even when
// almost all of the video data is one feature film plus tiny extras. In that
// shape, file-count consensus is misleading. Use the byte-dominant video only
// when it accounts for at least 90% of all embedded video bytes and parses as
// a dated movie. The caller still requires a unique exact-title/year TMDB hit.
function embeddedDominantMovieCandidate(files) {
  const videos = (Array.isArray(files) ? files : []).map((file) => ({
    file,
    name: mediaFileName(file && (file.name || file.short_name || file.path || file.filename)),
    size: Number(file && (file.size ?? file.bytes ?? file.file_size)),
  })).filter(({ name, size }) =>
    /\.(mkv|mp4|avi|ts|m2ts|webm|mov)$/i.test(name) && Number.isFinite(size) && size > 0);
  if (!videos.length) return null;
  const totalBytes = videos.reduce((sum, video) => sum + video.size, 0);
  const dominant = videos.reduce((best, video) => video.size > best.size ? video : best);
  if (dominant.size / totalBytes < 0.9) return null;
  let info = null;
  try { info = guessMediaInfo(dominant.name); } catch { /* malformed embedded filename */ }
  if (!info?.title || info.isSeries || info.season != null || !Number.isInteger(info.year)) return null;
  return { title: String(info.title).trim(), year: info.year };
}

function parsedTypeCorrection(mediaType, parsed, failureReason) {
  if (failureReason === 'type-mismatch' && mediaType === 'movie' && parsed?.isSeries) {
    return parsed.isAnime ? 'anime' : 'series';
  }
  if (failureReason === 'no-candidate' && mediaType === 'anime' && parsed && !parsed.isSeries
    && Number.isInteger(parsed.year)) return 'movie-strong';
  return null;
}

async function resolveEmbeddedMovieTypeConflict({ mediaType, files, lang, tmdbApiKey }, deps, shared) {
  if (mediaType !== 'series' || !Array.isArray(files) || files.length !== 1) return null;
  const movie = embeddedMovieCandidate(files);
  if (!movie || !movie.year) return null;
  return resolveMatch({
    name: `${movie.title} ${movie.year}`,
    mediaType: 'movie',
    lang,
    tmdbApiKey,
    requireUniqueStrongYear: true,
  }, deps, shared);
}

function embeddedSummaryName(summary) {
  let name = summary.title;
  if (summary.seasonStart != null && summary.seasonEnd != null) {
    name += ' S' + String(summary.seasonStart).padStart(2, '0')
      + '-S' + String(summary.seasonEnd).padStart(2, '0');
  } else if (summary.season != null && summary.episode != null) {
    name += ' S' + String(summary.season).padStart(2, '0')
      + 'E' + String(summary.episode).padStart(2, '0');
  } else if (summary.season != null) {
    name += ' Season ' + summary.season;
  }
  if (summary.year) name += ' ' + summary.year;
  return name;
}

async function resolveImdb(tmdbApiKey, meta, existing) {
  if (existing) return existing;
  if (!meta || !meta.tmdbId) return null;
  if (offlineEnabled()) return null;
  try {
    return await getImdbId(tmdbApiKey, meta.type === 'movie' ? 'movie' : 'tv', meta.tmdbId) || null;
  } catch {
    return null;
  }
}

// Save a failed match, unless this was a re-check of a row that was already
// matched: then the old match stays (a resolver change or a TMDB hiccup must
// never make a title disappear). True when the old match was kept.
async function failOrKeep(job, payload) {
  if (job.prev_status === 'matched' && await store.keepPreviousMatch(job.id).catch(() => false)) {
    metrics.add('matchKeptPrevious');
    return true;
  }
  await store.saveMatch(job.id, payload);
  return false;
}

// Process up to `batch` pending items for a scope. Returns aggregate counts.
// Pending items are claimed atomically (FOR UPDATE SKIP LOCKED), so two workers
// or two overlapping syncs never match the same item twice.
async function matchScopeInner(scope, { batch = 50, concurrency = 4, budgetMs = 0 } = {}) {
  const { scopeId, config, tmdbApiKey, lang } = scope;
  const started = Date.now();
  let processed = 0;
  let matched = 0;
  let failed = 0;
  const sharedMatchLookups = { searches: new Map(), seasonCounts: new Map(), stats: { searchHits: 0, searchMisses: 0 } };

  // A missing or rejected TMDB key would fail every row and spend its retries.
  // Leave the queue alone until the key works (tmdb-key.ts).
  if (!offlineEnabled()) {
    const keyState = await tmdbKey.check(tmdbApiKey);
    const before = tmdbKey.noteScope(scopeId, keyState);
    if (keyState === 'missing' || keyState === 'rejected') {
      return { processed: 0, matched: 0, failed: 0, keyProblem: keyState, candidateSearches: 0, candidateSearchDedupeHits: 0, seasonLookups: 0 };
    }
    if (keyState === 'ok' && before !== 'ok') await store.requeueSearchFailures(scopeId).catch(() => 0);
  }

  for (;;) {
    if (budgetMs > 0 && Date.now() - started > budgetMs) break;
    const jobs = await store.claimMatchJobs(scopeId, batch);
    if (!jobs.length) break;
    // Owner fixes from the Library page win over the resolver. A failed
    // lookup only means this pass falls back to normal matching.
    const fixes = await overrides.forJobs(scopeId, jobs).catch(() => new Map());
    // What other owners taught LeLibrary about these exact releases.
    const sharedList = await sharedFixes.bestFor(jobs.map((job) => sharedFixes.releaseKeys(job.raw, job.name)))
      .catch(() => jobs.map(() => null));
    const sharedById = new Map(jobs.map((job, index) => [job.id, sharedList[index]]));
    const applyShared = async (job, fix) => overrides.apply(job, {
      action: 'match', tmdbId: fix.tmdbId, mediaType: fix.mediaType, season: fix.season, episode: fix.episode,
    }, { tmdbApiKey, lang, origin: 'shared' });
    const outcomes = await pLimit(jobs, concurrency, async (job) => {
      const fix = fixes.size ? overrides.lookup(fixes, job) : undefined;
      if (fix) {
        const applied = await overrides.apply(job, fix, { tmdbApiKey, lang });
        if (applied === 'matched') matched++;
        else if (applied === 'failed') {
          await store.saveMatch(job.id, { status: 'failed', error: 'manual-fix-unavailable', version: retryVersion() });
          failed++;
        }
        processed++;
        return;
      }
      // A film carved out of a box set keeps the film it was matched to.
      const pinned = job.raw && job.raw._boxset;
      if (pinned && pinned.tmdbId) {
        const applied = await overrides.apply(job, { action: 'match', tmdbId: pinned.tmdbId, mediaType: pinned.mediaType || 'movie', season: Number.isInteger(pinned.season) ? pinned.season : null, episode: Number.isInteger(pinned.episode) ? pinned.episode : null }, { tmdbApiKey, lang, origin: 'boxset' });
        if (applied === 'matched') matched++;
        else failed++;
        processed++;
        return;
      }
      // A box set: each film inside becomes its own entry (library/boxsets.ts).
      if (!pinned && boxsets.looksLikeBoxSet(job.name || (job.raw && job.raw.name), job.raw)) {
        const films = await boxsets.expand(job, {
          tmdbApiKey, lang,
          resolveFallback: async (filmName) => {
            const r = await resolveMatch({ name: filmName, mediaType: 'movie', lang, tmdbApiKey, requireUniqueStrongYear: true }, undefined, sharedMatchLookups);
            return r?.ok && r.tmdbId ? { tmdbId: Number(r.tmdbId), mediaType: 'movie' } : null;
          },
        });
        if (films >= 0) {
          matched += films;
          processed++;
          return;
        }
      }
      // Matched normally now: drop film entries from an earlier box-set split.
      if (!pinned && job.prev_status === 'expanded') await boxsets.removeChildren(job).catch(() => 0);
      // Two or more libraries agree on this exact release: trust it first.
      const shared = sharedById.get(job.id) || null;
      if (sharedFixes.sharedFixUsable(shared, 'before-resolver') && await applyShared(job, shared) === 'matched') {
        matched++;
        processed++;
        return;
      }
      const raw = job.raw;
      const mediaType = job.media_type || 'movie';
      const name = (raw && (raw.name || raw.filename)) || '';
      let resolved = null;
      let packSummary = null;
      let resolvedType = mediaType;
      try {
        if (offlineEnabled()) {
          const meta = offlineMatchFromItem(raw);
          if (meta && meta.tmdbId) {
            const { torboxItem, ...stored } = meta;
            const imdbId = await resolveImdb(tmdbApiKey, meta, meta.imdbId || null);
            await store.saveMatch(job.id, {
              status: 'matched',
              tmdbId: meta.tmdbId,
              imdbId,
              matchMeta: { ...stored, imdbId: imdbId || undefined, torboxItem: undefined },
              // Canonical stamped version, always: claimMatchJobs re-queues
              // anything stamped otherwise, so a hand-rolled variant here
              // re-matches the whole library on every pass, forever.
              version: matchVersion(),
            });
            builder.publishMatchEntry(mediaType, lang, name, meta);
            matched++;
          } else {
            await store.saveMatch(job.id, { status: 'failed', error: 'offline-unmatched', version: retryVersion() });
            builder.publishMatchEntry(mediaType, lang, name, null);
            failed++;
          }
          processed++;
          return;
        }

        // Embedded episode filenames are stronger title/type evidence than
        // an outer download name. Summarize them for all download shapes,
        // rather than limiting file-based recovery to opaque hash names.
        const embedded = embeddedVideoFiles(raw);
        const embeddedSummary = builder.summarizePackEpisodes(embedded.map((file) =>
          file.name || file.short_name || file.path || file.filename || ''));
        packSummary = embeddedSummary;
        const embeddedType = embeddedSummary ? (embeddedSummary.isAnime ? 'anime' : 'series') : null;
        if (embeddedSummary || (isOpaqueOuterName(name) && embedded.length)) {
          let embeddedMeta = null;
          if (embeddedSummary) {
            let matchName = embeddedSummary.title;
            if (embeddedSummary.seasonStart != null && embeddedSummary.seasonEnd != null) {
              matchName += ' S' + String(embeddedSummary.seasonStart).padStart(2, '0')
                + '-S' + String(embeddedSummary.seasonEnd).padStart(2, '0');
            } else if (embeddedSummary.season != null && embeddedSummary.episode != null) {
              matchName += ' S' + String(embeddedSummary.season).padStart(2, '0')
                + 'E' + String(embeddedSummary.episode).padStart(2, '0');
            } else if (embeddedSummary.season != null) {
              matchName += ' Season ' + embeddedSummary.season;
            }
            if (embeddedSummary.year) matchName += ' ' + embeddedSummary.year;
            embeddedMeta = await builder.matchItem({ ...raw, name: matchName }, tmdbApiKey, embeddedType, lang, config);
            if (!embeddedMeta && embeddedType === 'series') {
              embeddedMeta = await builder.matchItem({ ...raw, name: matchName }, tmdbApiKey, 'anime', lang, config);
            }
            if (embeddedMeta) embeddedMeta = { ...embeddedMeta, torboxItem: raw };
          } else if (embedded.length === 1 && isOpaqueOuterName(name)) {
            const fileName = mediaFileName(embedded[0].name || embedded[0].short_name || embedded[0].path || embedded[0].filename);
            if (fileName) embeddedMeta = await builder.matchItem({ ...raw, name: fileName }, tmdbApiKey, 'movie', lang, config);
          }
          if (embeddedMeta && embeddedMeta.tmdbId) {
            const resolvedType = embeddedMeta.catalogType || embeddedMeta.type || embeddedType || 'movie';
            const { torboxItem, ...stored } = embeddedMeta;
            const imdbId = await resolveImdb(tmdbApiKey, embeddedMeta, embeddedMeta.imdbId || null);
            await store.saveMatch(job.id, {
              status: 'matched', tmdbId: embeddedMeta.tmdbId, imdbId,
              matchMeta: { ...stored, imdbId: imdbId || undefined, torboxItem: undefined },
              version: matchVersion(),
              classification: {
                mediaType: resolvedType,
                title: embeddedSummary?.title || embeddedMeta.name || null,
                year: embeddedSummary?.year || Number.parseInt(embeddedMeta.releaseInfo, 10) || null,
                season: embeddedMeta.season ?? null,
                seasonStart: embeddedMeta.seasonStart ?? null,
                seasonEnd: embeddedMeta.seasonEnd ?? null,
                episode: embeddedMeta.episode ?? null,
                episodeEnd: embeddedMeta.episodeEnd ?? null,
              },
            });
            builder.publishMatchEntry(resolvedType, lang, name, embeddedMeta);
            matched++;
            processed++;
            return;
          }
        }
        metrics.add('tmdbCalls');
        const parsedOuter = (() => { try { return guessMediaInfo(name); } catch { return null; } })();
        // Stored as a show, but the name is a dated title with no season or
        // episode marker and no episode files inside ("cky-1999",
        // "1984.1984.REMASTERED"): a strict film match (one exact title, exact
        // year) goes first. Otherwise the TV search accepts a loose show and
        // the old wrong type never gets corrected.
        if (mediaType === 'series' && parsedOuter && !parsedOuter.isSeries && parsedOuter.season == null
          && parsedOuter.episode == null && Number.isInteger(parsedOuter.year) && !embeddedSummary) {
          metrics.add('tmdbCalls');
          const movie = await resolveMatch({ name, mediaType: 'movie', lang, tmdbApiKey, requireUniqueStrongYear: true }, undefined, sharedMatchLookups);
          if (movie?.ok) { resolved = movie; resolvedType = 'movie'; }
        }
        if (!resolved?.ok) resolved = await resolveMatch({ name, mediaType, lang, tmdbApiKey }, undefined, sharedMatchLookups);
        // An explicit episode marker is stronger evidence than a stale movie
        // catalog classification. Retry in the parser-indicated TV namespace
        // instead of leaving a deterministic type mismatch as a failure.
        const typeCorrection = !resolved?.ok ? parsedTypeCorrection(mediaType, parsedOuter, resolved?.reason) : null;
        if (typeCorrection && typeCorrection !== 'movie-strong') {
          const correctedType = typeCorrection;
          metrics.add('tmdbCalls');
          const corrected = await resolveMatch({ name, mediaType: correctedType, lang, tmdbApiKey }, undefined, sharedMatchLookups);
          if (corrected?.ok) { resolved = corrected; resolvedType = correctedType; }
        }
        // Anime classification can be a false positive for a feature film.
        // Permit a type correction only with a dated, exact-title, unique
        // movie candidate; ambiguous or yearless results stay unresolved.
        if (!resolved?.ok && typeCorrection === 'movie-strong') {
          metrics.add('tmdbCalls');
          const movie = await resolveMatch({ name, mediaType: 'movie', lang, tmdbApiKey, requireUniqueStrongYear: true }, undefined, sharedMatchLookups);
          if (movie?.ok) { resolved = movie; resolvedType = 'movie'; }
        }
        // The outer series label can be stale while its sole embedded video
        // is an unambiguous movie release. Let the canonical resolver change
        // type only after an exact-title + exact-year unique-candidate check.
        if (!resolved?.ok && resolved?.reason === 'unparseable' && mediaType === 'series' && !embeddedSummary) {
          const movieConflict = await resolveEmbeddedMovieTypeConflict({ mediaType, files: embedded, lang, tmdbApiKey }, undefined, sharedMatchLookups);
          if (movieConflict) {
            resolved = movieConflict;
            if (movieConflict.ok) resolvedType = 'movie';
          }
        }
        // Catalog classification can be wrong even when the filename has no
        // season marker. If the requested media type has no candidate, try the
        // other film/TV namespace once; keep the first successful match and
        // persist its inferred type so later catalog reads are consistent.
        if (!resolved?.ok && resolved?.reason === 'no-candidate') {
          const alternateType = mediaType === 'movie'
            ? 'series'
            : (mediaType === 'series' && !parsedOuter?.isSeries && !embeddedSummary ? 'movie' : null);
          if (alternateType) {
            const alternate = await resolveMatch({ name, mediaType: alternateType, lang, tmdbApiKey }, undefined, sharedMatchLookups);
            if (alternate?.ok) { resolved = alternate; resolvedType = alternateType; }
          }
        }
        // A scene group's name in front of the release ("honor-..."): retry
        // without it, in the same type first and then the other one.
        if (!resolved?.ok && resolved?.reason === 'no-candidate') {
          const withoutGroup = stripLeadingGroupPrefix(name);
          if (withoutGroup) {
            for (const tryType of [mediaType, mediaType === 'movie' ? 'series' : 'movie']) {
              metrics.add('tmdbCalls');
              const again = await resolveMatch({ name: withoutGroup, mediaType: tryType, lang, tmdbApiKey }, undefined, sharedMatchLookups);
              if (again?.ok) { resolved = again; resolvedType = tryType; break; }
            }
          }
        }
        // A hash-named item: try the release names its other files carry.
        if (!resolved?.ok && isOpaqueOuterName(name)) {
          for (const hint of releaseNameHints(raw)) {
            let info = null;
            try { info = guessMediaInfo(hint); } catch { info = null; }
            const hintType = info?.isSeries ? 'series' : 'movie';
            metrics.add('tmdbCalls');
            const again = await resolveMatch({
              name: hint, mediaType: hintType, lang, tmdbApiKey,
              requireUniqueStrongYear: hintType === 'movie' && Boolean(info?.year),
            }, undefined, sharedMatchLookups);
            if (again?.ok) { resolved = again; resolvedType = hintType; break; }
          }
        }
        // If a series/anime release name has no search candidate but its
        // embedded episodes consistently identify a pack title, send that
        // normalized title and season range through the canonical resolver.
        // This keeps season validation and identity selection in one place.
        if (!resolved?.ok && resolved?.reason === 'no-candidate' && embeddedSummary && embeddedType) {
          const embeddedResolved = await resolveMatch({
            name: embeddedSummaryName(embeddedSummary),
            mediaType: embeddedType,
            lang,
            tmdbApiKey,
          }, undefined, sharedMatchLookups);
          if (embeddedResolved?.ok) { resolved = embeddedResolved; resolvedType = embeddedType; }
        }
        // If TMDB found nothing for a movie's outer download name, try its
        // actual video filename(s). This also covers non-hash outer names,
        // while the consensus gate avoids guessing from mixed video bundles.
        if (!resolved?.ok && resolved?.reason === 'no-candidate' && mediaType === 'movie') {
          const embeddedMovie = embeddedMovieCandidate(embedded);
          if (embeddedMovie) {
            const embeddedName = `${embeddedMovie.title}${embeddedMovie.year ? ` ${embeddedMovie.year}` : ''}`;
            const embeddedResolved = await resolveMatch({ name: embeddedName, mediaType: 'movie', lang, tmdbApiKey }, undefined, sharedMatchLookups);
            if (embeddedResolved?.ok) { resolved = embeddedResolved; resolvedType = 'movie'; }
          }
        }
        // Hash-named multi-video torrents often contain one feature file plus
        // small extras. The outer hash is parsed as a series by the generic
        // fallback, so the ordinary movie-only path above cannot see it.
        // Recover only from a byte-dominant, dated movie filename and require
        // the core resolver's unique exact-title + exact-year check.
        if (!resolved?.ok && isOpaqueOuterName(name) && !embeddedSummary) {
          const embeddedMovie = embeddedDominantMovieCandidate(embedded);
          if (embeddedMovie) {
            metrics.add('tmdbCalls');
            const embeddedResolved = await resolveMatch({
              name: `${embeddedMovie.title} ${embeddedMovie.year}`,
              mediaType: 'movie',
              lang,
              tmdbApiKey,
              requireUniqueStrongYear: true,
            }, undefined, sharedMatchLookups);
            if (embeddedResolved?.ok) { resolved = embeddedResolved; resolvedType = 'movie'; }
          }
        }
      } catch (err) {
        if (await failOrKeep(job, { status: 'failed', error: String(err.message || err).slice(0, 300), version: retryVersion() })) { processed++; return; }
        builder.publishMatchEntry(mediaType, lang, name, null);
        failed++;
        processed++;
        return;
      }
      if (!resolved || !resolved.ok) {
        const reason = resolved && !resolved.ok
          ? `${resolved.reason} [${(resolved.tried || []).join(',')}]`
          : 'no-result';
        // Transitional pack safety net (deleted when probing moves into the
        // core): bare-name packs ("Kitchen.Nightmares", a 30GB torrent whose
        // FILES are S01E01...) carry no season for the core to validate, so
        // the legacy inner-filename probe gets them. Seasoned releases fail
        // closed with the recorded reason: without this gate every
        // multi-file torrent fell through here and bypassed the core.
        let packSeason = null;
        try {
          packSeason = guessMediaInfo(name)?.season ?? null;
        } catch {
          packSeason = null;
        }
        // A re-check of a matched row never takes this legacy guess over the
        // stored match: only the core resolver may replace it (failOrKeep).
        if (config && packSeason == null && hasPackFiles(raw) && job.prev_status !== 'matched') {
          try {
            metrics.add('tmdbCalls');
            const packMeta = await builder.matchItem(raw, tmdbApiKey, mediaType, lang, config);
            if (packMeta && packMeta.tmdbId) {
              const { torboxItem, ...stored } = packMeta;
              const packImdb = await resolveImdb(tmdbApiKey, packMeta, packMeta.imdbId || null);
              await store.saveMatch(job.id, {
                status: 'matched',
                tmdbId: packMeta.tmdbId,
                imdbId: packImdb,
                matchMeta: { ...stored, imdbId: packImdb || undefined, torboxItem: undefined },
                version: matchVersion(),
              });
              builder.publishMatchEntry(mediaType, lang, name, packMeta);
              matched++;
              processed++;
              return;
            }
          } catch { /* fall through to the recorded failure */ }
        }
        // Automatic matching failed: one owner's fix for this exact release
        // is enough here (it cannot replace a confident automatic match).
        if (sharedFixes.sharedFixUsable(shared, 'on-failure') && await applyShared(job, shared).catch(() => 'failed') === 'matched') {
          matched++;
          processed++;
          return;
        }
        if (await failOrKeep(job, { status: 'failed', error: reason.slice(0, 300), version: retryVersion() })) { processed++; return; }
        builder.publishMatchEntry(mediaType, lang, name, null);
        failed++;
        processed++;
        return;
      }
      // Canonical identity in hand: build the full meta from it (never
      // re-derive the season). The source object comes from canonicalSource
      // (not the raw candidate): split-season remaps change the ENTRY, and
      // the pre-split candidate would bake the wrong tmdbId/title/artwork
      // into the stored match while the season looks right. Redirect hits
      // carry no search object, so the curated identity stands in and
      // artwork providers fill the poster.
      // The outer name resolved without a season ("...сезон1серии18из8...") but
      // every episode file inside is from one season of the same title: keep
      // that season rather than storing a bare whole-show pack.
      if (resolvedType !== 'movie' && resolved.season == null && resolved.seasonStart == null && resolved.episode == null
        && packSummary && Number.isInteger(packSummary.season) && packSummary.episode == null && packSummary.seasonStart == null
        && normalizeTitle(packSummary.title || '') === normalizeTitle(resolved.title || '')) {
        resolved = { ...resolved, season: packSummary.season };
      }
      metrics.add('tmdbCalls');
      const source = await builder.canonicalSource(tmdbApiKey, resolved, lang);
      const meta = builder.buildMatchMeta(
        source, resolvedType, raw,
        resolved.season, resolved.episode, resolved.episodeEnd,
        resolved.seasonStart, resolved.seasonEnd,
      );
      if (meta && meta.tmdbId) {
        const { torboxItem, ...stored } = meta;
        const imdbId = await resolveImdb(tmdbApiKey, meta, meta.imdbId || null);
        await store.saveMatch(job.id, {
          status: 'matched',
          tmdbId: meta.tmdbId,
          imdbId,
          matchMeta: { ...stored, imdbId: imdbId || undefined, torboxItem: undefined },
          version: matchVersion(),
          classification: {
            mediaType: resolvedType,
            title: resolved.title || meta.name || null,
            year: resolved.year ?? null,
            season: resolved.season ?? null,
            seasonStart: resolved.seasonStart ?? null,
            seasonEnd: resolved.seasonEnd ?? null,
            episode: resolved.episode ?? null,
            episodeEnd: resolved.episodeEnd ?? null,
          },
        });
        builder.publishMatchEntry(resolvedType, lang, name, meta);
        matched++;
      } else {
        if (!(await failOrKeep(job, { status: 'failed', error: 'meta-build-failed', version: retryVersion() }))) {
          builder.publishMatchEntry(resolvedType, lang, name, null);
          failed++;
        }
      }
      processed++;
    });
    // pLimit preserves the rest of the batch when one worker throws. A throw
    // here usually means a transient DB failure while persisting a match; the
    // row is still marked `matching`, which makes catalogRows hide it. Release
    // failed claims promptly and retry on the next drain instead of waiting for
    // the 10-minute stuck-claim sweep.
    const failedClaims = outcomes.flatMap((outcome, index) => outcome?.error ? [jobs[index].id] : []);
    if (failedClaims.length) {
      const firstError = outcomes.find((outcome) => outcome?.error)?.error;
      const errorCode = typeof firstError?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(firstError.code)
        ? firstError.code
        : 'worker_error';
      const parameterHint = errorCode === '42P08'
        ? String(firstError?.message || '').match(/parameter \$\d+/i)?.[0]
        : null;
      const released = await store.releaseMatchJobs(scopeId, failedClaims).catch(() => 0);
      console.warn(`[Library] match workers failed; requeued=${released || 0} error=${errorCode}${parameterHint ? ` ${parameterHint}` : ''}`);
      break;
    }
  }

  // Newly matched items change what their title's meta shows (a new episode
  // joins the videos[] list), but meta responses are cached 24h under keys
  // with no sync component - so without this, a new download stays invisible
  // on the detail page for a day even though the catalog card already lists
  // it. Evict this scope's metas (stream keys carry S/E, so new episodes are
  // fresh keys already; collection metas live under the same meta: prefix).
  // Rare by construction now that change-hashes ignore upload progress: this
  // only fires on passes that actually matched something new.
  if (matched > 0 && scopeId) {
    try {
      await cache.delPattern(`meta:*${scopeId}*`);
    } catch { /* meta rebuilds are cheap; a missed eviction just ages out */ }
  }

  metrics.time('matchMs', Date.now() - started);
  return { processed, matched, failed, candidateSearches: sharedMatchLookups.stats.searchMisses,
    candidateSearchDedupeHits: sharedMatchLookups.stats.searchHits,
    seasonLookups: sharedMatchLookups.seasonCounts.size };
}

async function matchScope(scope, options = {}) {
  const measured = await require('../media/tmdb.ts').withMatchRequestCounter(
    () => matchScopeInner(scope, options)
  );
  const result = { ...measured.value, tmdbHttpRequests: measured.requests };
  // Matching can run from either the background drain or a provider sync.
  // Count both entry paths here so retry metrics do not miss sync-triggered
  // passes.
  metrics.add('matchAttempts', result.processed || 0);
  metrics.add('matchTmdbHttpRequests', result.tmdbHttpRequests || 0);
  return result;
}

export interface MatcherApi {
  matchScope: any;
  offlineEnabled: any;
  embeddedVideoFiles: any;
  isOpaqueOuterName: any;
  stripLeadingGroupPrefix: any;
  releaseNameHints: any;
  mediaFileName: any;
  embeddedDominantMovieCandidate: any;
  parsedTypeCorrection: any;
  resolveEmbeddedMovieTypeConflict: any;
}

module.exports = { matchScope, offlineEnabled, embeddedVideoFiles, isOpaqueOuterName, stripLeadingGroupPrefix, releaseNameHints, mediaFileName, embeddedDominantMovieCandidate, parsedTypeCorrection, resolveEmbeddedMovieTypeConflict } satisfies MatcherApi;
