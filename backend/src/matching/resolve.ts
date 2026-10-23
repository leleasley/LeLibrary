// @ts-nocheck
// The single place that decides what a release is. Filename in, canonical
// identity out. Every consumer (background matcher, catalog/meta/stream
// request paths) uses this and treats the result read-only: nothing
// downstream may substitute filename numbering, re-pick candidates, or
// invent fallbacks. That is the whole point — the 2026-09-17 outage was five
// stacked layers each re-deciding the season slightly differently.
//
// Resolution algorithm (series, the movie path is a straight pick):
//   1. parse (subtitle preserved in the RAW name for redirect gating)
//   2. title-redirect pre-check (standalone TMDB entries the parser's bare
//      title can never reach, e.g. Monster S04 = 299939 S01)
//   3. ranked candidates (best pick first, then the rest, deduped)
//   4. per candidate: split-season remap, then SEASON-MUST-EXIST validation
//      against cached season counts. A missing season tries the next
//      candidate; it never returns a match that is doomed to be filtered.
//   5. date-based releases resolve via air-date lookup per candidate.
// A season the tables DIM covers with rows the search never returns still
// resolves: the redirect synthesizes the candidate, validation confirms it.
const parser = require('../media/parser.ts');
const tmdb = require('../media/tmdb.ts');
const { lookupSplitSeason, lookupTitleRedirect, tableVersion } = require('./tables.ts');

const RESOLVER_VERSION = 'v4';
// r6 introduces a finite eight-attempt budget and transient/permanent backoff
// schedules; old failed rows are reconsidered once under the new policy.
// r7 fixes yearless TV remakes/variants: requested-season existence now gets
// to disambiguate exact-title candidates before the retryable failure path.
// r8 adds the guarded near-title fallback (and/&, " - " prefixes, typos).
// r9 fixes the shared search cache key for non-Latin queries.
// r10 retries names with a scene group's name in front ("honor-...").
const MATCH_RETRY_VERSION = 'r10';
// Parser-only corrections should re-open failed/terminal rows without marking
// every already-matched library row stale. Bump this when parser semantics
// change in a way that can recover a prior failure.
// p3: edition-then-year, aspect ratios, one-letter titles, site prefixes.
// p4: URL-encoded release names are decoded.
// p5: Russian voice-over and subtitle labels end the title.
// p6: "S1.S9" season pairs are read as a season range.
const MATCH_PARSER_VERSION = 'p6';
// Eight attempts are enough for the exponential schedule to cover transient
// outages and recoverable catalog changes without retrying permanent misses
// forever. Operators can explicitly requeue; changing this retry version
// also makes terminal rows eligible again.
const MAX_MATCH_ATTEMPTS = 8;

function titleSearchVariants(title) {
  const source = String(title || '').trim();
  const variants = [source];
  const addVariant = (value) => {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (clean && !variants.includes(clean)) variants.push(clean);
  };
  // Release edition labels are not part of the title indexed by TMDB. Keep
  // the original query for context, but also try the canonical base title.
  // Do not strip collection/box-set labels: those are not single film titles.
  const editionSuffixes = [
    /\s+director['’]?s\s+cut$/i,
    /\s+unrated(?:\s+(?:cut|edition|version))?$/i,
    /\s+extended(?:\s+(?:cut|edition|version))?$/i,
    /\s+theatrical(?:\s+(?:cut|edition|version))?$/i,
    /\s+remastered(?:\s+(?:cut|edition|version))?$/i,
  ];
  let baseEdition = source;
  for (const suffix of editionSuffixes) {
    const stripped = baseEdition.replace(suffix, '').trim();
    if (stripped !== baseEdition) { addVariant(stripped); baseEdition = stripped; }
  }
  // Releases often carry both the title used by TMDB and an AKA separated
  // by this marker. Search the two names independently so either can find
  // the same canonical candidate; identity is still decided by the resolver.
  for (const part of source.split(/\s+(?:aka|a\.?k\.?a\.?)\s+/i)) addVariant(part);
  // Release names can combine localized and English titles. Search each
  // script run too, without adding title-specific aliases.
  const latinRuns = source.match(/[\p{Script=Latin}][\p{Script=Latin}\p{M}\p{N}'’ -]*/gu) || [];
  const latinOnly = latinRuns.join(' ').replace(/\s+/g, ' ').trim();
  if (latinOnly && latinOnly !== source) variants.push(latinOnly);
  // A localized release can contain unrelated Latin-script site branding
  // before its English title. Searching only the joined Latin text makes
  // that branding part of the query and can hide the usable title from TMDB.
  // Keep the joined fallback for compatibility, but search each independent
  // Latin run as well.
  for (const run of latinRuns) {
    const cleanRun = run.replace(/\s+/g, ' ').trim();
    if (cleanRun && cleanRun !== source) variants.push(cleanRun);
  }
  const otherScripts = source.replace(/[\p{Script=Latin}\p{M}\p{N}'’ -]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (otherScripts && otherScripts !== source) variants.push(otherScripts);

  // Some installment titles use Roman numerals instead of a trailing number.
  const toRoman = (number) => {
    const values = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
    let n = number, out = '';
    for (const [value, numeral] of values) while (n >= value) { out += numeral; n -= value; }
    return out;
  };
  const tail = source.match(/^(.*\S)\s+(\d{1,3})$/);
  if (tail && Number(tail[2]) > 0 && Number(tail[2]) <= 50) variants.push(tail[1] + ' ' + toRoman(Number(tail[2])));
  return [...new Set(variants.filter(Boolean))];
}

// ── Near-title fallback ────────────────────────────────────────────────
// Last resort when every normal query found nothing and the file names a
// release year. TMDB search is exact about spelling and punctuation, so a
// release can miss its own title over "and" vs "&" ("Manny & Lo"), a
// performer or channel prefix ("Dave Chapelle - Sticks and Stones"), or a
// typo ("Order of the Pheonix"). These queries are never trusted the way the
// normal ones are: a candidate is accepted only with the exact parsed year
// and a near-identical title once case, spacing and punctuation are ignored.
// Anything weaker, or two equally good answers, stays unresolved.
const NEAR_TITLE_MIN_SIMILARITY = 0.9;

function compactTitle(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '');
}

function titleSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Very short titles must match exactly; one edit is a different word.
  if (Math.min(a.length, b.length) < 8) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

function nearTitlePlan(title) {
  const source = String(title || '').replace(/\s+/g, ' ').trim();
  const queries = [];
  const add = (value) => {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (clean && clean !== source && !queries.includes(clean)) queries.push(clean);
  };
  const ampersand = (value) => value.replace(/\s+and\s+/gi, ' & ');
  add(ampersand(source));
  const sides = source.split(/\s+[-–]\s+/);
  const right = sides.length > 1 ? sides[sides.length - 1] : null;
  if (right && right.split(' ').length >= 2) { add(right); add(ampersand(right)); }
  const words = source.split(' ');
  for (let n = words.length - 1; n >= Math.max(2, words.length - 3); n--) add(words.slice(0, n).join(' '));
  if (/^the\s+/i.test(source)) add(source.replace(/^the\s+/i, ''));
  // A match on the part after " - " is weaker evidence than a match on the
  // whole name, so a full-name match wins when both exist.
  const references = [{ text: compactTitle(source), weight: 1 }];
  if (right) references.push({ text: compactTitle(right), weight: 0.95 });
  return { queries, references };
}

async function nearTitleCandidate(d, info, isSeries, lang) {
  const plan = nearTitlePlan(info.title);
  const scored = new Map();
  let failures = 0;
  for (const query of plan.queries) {
    let found = [];
    try { found = (await d.search(query, isSeries ? 'tv' : 'movie', info.year, lang)) || []; }
    catch { failures++; continue; }
    for (const candidate of found) {
      if (!candidate || candidate.id == null) continue;
      const candidateYear = parseInt(String(candidate.release_date || candidate.first_air_date || '').slice(0, 4), 10);
      if (candidateYear !== info.year) continue;
      const names = [candidate.title, candidate.name, candidate.original_title, candidate.original_name].filter(Boolean).map(compactTitle);
      let best = 0;
      for (const name of names) for (const ref of plan.references) best = Math.max(best, titleSimilarity(name, ref.text) * ref.weight);
      if (best < NEAR_TITLE_MIN_SIMILARITY) continue;
      const key = String(candidate.id);
      if (!scored.has(key) || scored.get(key).score < best) scored.set(key, { candidate, score: best });
    }
  }
  const ranked = [...scored.values()].sort((a, b) => b.score - a.score);
  if (!ranked.length) return { candidate: null, failures };
  if (ranked.length > 1 && ranked[1].score === ranked[0].score) return { candidate: null, failures, ambiguous: true };
  return { candidate: ranked[0].candidate, failures };
}

// Cache namespace for everything derived from matching decisions (meta,
// stream keys). Table edits or resolver logic changes alter it, orphaning
// stale entries automatically instead of needing manual flushes. Stable
// across restarts and deploys: it only moves when the inputs move.
function matchVersion() {
  return `mv${RESOLVER_VERSION}.${tableVersion()}`;
}

function retryVersion() {
  // Retry eligibility tracks both matching rules and parser semantics, while
  // matchVersion() remains reserved for resolved identity/cache invalidation.
  return `${MATCH_RETRY_VERSION}:${MATCH_PARSER_VERSION}:${matchVersion()}`;
}

// Default live dependencies. The TMDB key MUST be threaded explicitly: every
// TMDB call below is key-scoped, and an unkeyed default silently turns the
// whole resolver into failures (caught the hard way: background matches
// silently failed while stubbed unit tests stayed green). The layer param
// exists so tests can assert the threading with a recording fake.
function defaultDeps(tmdbApiKey, layer) {
  const t = layer || tmdb;
  return {
    parse: (name) => parser.guessMediaInfo(name),
    search: (query, type, year, lang) => t.searchCandidates(tmdbApiKey, query, type, year, lang),
    pick: (query, candidates, year) => t.pickBestResult(query, candidates, year),
    seasonCounts: (tmdbId, lang) => t.getSeasonEpisodeCounts(tmdbApiKey, tmdbId, lang),
    isAnimeCandidate: (cand) => !!(cand && cand.isJapaneseAnimation === true),
    titleScore: (query, cand) => t.titleScore(query, cand),
    findEpisode: (tmdbId, date, lang) => t.findEpisodeByAirDate(tmdbApiKey, tmdbId, date, lang),
  };
}

function rankedCandidates(pick, candidates) {
  const out = [];
  const seen = new Set();
  for (const cand of [pick, ...(candidates || [])]) {
    if (!cand || cand.id == null) continue;
    const key = String(cand.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cand);
  }
  return out;
}

function displayTitle(redirectName, cand, fallback) {
  if (redirectName) return redirectName;
  if (cand && (cand.title || cand.name)) return cand.title || cand.name;
  return fallback;
}

// Season-exists validation with per-call memo. Returns:
//   { state: 'ok' } | { state: 'missing' } | { state: 'unknown' }
async function checkSeason(deps, memo, tmdbId, season, lang) {
  const key = `${tmdbId}:${lang}`;
  if (!memo.has(key)) {
    memo.set(key, Promise.resolve().then(() => deps.seasonCounts(tmdbId, lang))
      .then((counts) => Array.isArray(counts) ? counts : null).catch(() => null));
  }
  const counts = await memo.get(key);
  if (!counts) return { state: 'unknown' };
  const row = counts.find((c) => c && c.season === season);
  if (row && (row.count || 0) > 0) return { state: 'ok' };
  return { state: 'missing' };
}

function canonical({ tmdbId, tmdbType, season, seasonStart, seasonEnd, episode, episodeEnd, title, year, candidate }) {
  return {
    ok: true,
    tmdbId,
    tmdbType,
    season,
    seasonStart: seasonStart ?? null,
    seasonEnd: seasonEnd ?? null,
    episode: episode ?? null,
    episodeEnd: episodeEnd ?? null,
    title,
    year: year ?? null,
    // Raw winning TMDB object for meta construction (poster/dates). Null for
    // redirect hits: the caller synthesizes from the curated identity.
    candidate: candidate || null,
    resolverVersion: RESOLVER_VERSION,
    tableVersion: tableVersion(),
  };
}

function failure(reason, tried) {
  return { ok: false, reason, tried, resolverVersion: RESOLVER_VERSION, tableVersion: tableVersion() };
}

// Resolve one release name. Pure decision apart from the injected deps
// (default: real parser + key-scoped TMDB layer; tests inject stubs). Never
// throws: TMDB/network failures become retryable Failure reasons.
async function resolveMatch({ name, mediaType = 'series', lang = 'en-US', tmdbApiKey = null, requireUniqueStrongYear = false }, deps, shared = null) {
  const baseDeps = deps || defaultDeps(tmdbApiKey);
  const d = shared ? { ...baseDeps } : baseDeps;
  const seasonMemo = shared?.seasonCounts || new Map();
  if (shared) {
    const search = baseDeps.search;
    d.search = (query, type, year, searchLang) => {
      // Keep letters from every script: a Latin-only key made a mixed
      // "Cyrillic + English" query and its English-only variant share one
      // cache entry, so the variant was never actually searched.
      const normalized = String(query || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const key = `${type}|${searchLang}|${year || ''}|${normalized}`;
      if (shared.searches.has(key)) {
        shared.stats.searchHits++;
        return shared.searches.get(key);
      }
      shared.stats.searchMisses++;
      const pending = Promise.resolve().then(() => search(query, type, year, searchLang))
        .catch((err) => { shared.searches.delete(key); throw err; });
      shared.searches.set(key, pending);
      return pending;
    };
  }
  const tried = [];
  try {
    let info = null;
    try {
      info = d.parse(name);
    } catch {
      info = null;
    }
    if (!info || !info.title) return failure('unparseable', tried);
    if (mediaType === 'movie' && info.isSeries && info.season != null) {
      // Episode packs misread as movies are recovered by the caller
      // re-resolving as series; resolving them as movies would stick.
      return failure('type-mismatch', tried);
    }

    const isSeries = mediaType === 'series' || mediaType === 'anime';
    // A rescued title ("M 1931", "Dual 2022", "(Untitled) (2009)") is a film.
    // Rows stored as series from before the parser could read them must not
    // resolve to a TV show; the next library sync files them as movies.
    if (isSeries && info.recovered) return failure('type-mismatch', tried);
    const tmdbType = mediaType === 'anime' ? 'series' : mediaType;
    const fileSeason = info.season != null ? parseInt(info.season, 10) : null;

    // Date-based releases carry no season/episode: resolve per candidate.
    const dates = (info.airDates && info.airDates.length ? info.airDates : (info.airDate ? [info.airDate] : []));

    // Title-redirect pre-check: synthesize the standalone entry as the
    // top-ranked candidate. The parser's bare title could never reach it.
    let redirect = null;
    if (isSeries && fileSeason != null) {
      redirect = lookupTitleRedirect(name, info.title, fileSeason);
    }

    let candidates = [];
    let picked = null;
    let pickedScore = -1;
    let searchFailures = 0;
    // Year from filename disambiguates remakes (torrent 2025 vs TMDB 2026 is
    // retried year-free inside the search layer); date-based lookups never
    // send it, exactly like the old matcher.
    const yearParam = dates.length > 0 ? undefined : (info.year ?? undefined);
    const queries = titleSearchVariants(info.title);
    // If a release title itself ends with a plausible year that conflicts
    // with the parser's selected year, that trailing number may be a second
    // release year accidentally retained in the title. Search the clean base
    // title as another candidate query; never replace the parsed identity or
    // add a title-specific correction.
    if (Number.isInteger(info.year)) {
      const trailingYear = String(info.title).match(/^(.*\S)\s+(18(?:8[89]|9\d)|19\d{2}|20\d{2})$/);
      if (trailingYear && Number(trailingYear[2]) !== info.year) {
        for (const variant of titleSearchVariants(trailingYear[1])) if (!queries.includes(variant)) queries.push(variant);
      }
    }
    for (const query of queries) {
      let found = [];
      try { found = (await d.search(query, isSeries ? 'tv' : 'movie', yearParam, lang)) || []; }
      catch { searchFailures++; found = []; }
      // A wrong/misparsed movie year can filter out the exact title entirely.
      // Retry this query without a year only on an empty year-filtered result;
      // candidate ranking still uses the original parsed year when evidence
      // exists and the documented title/year tiers remain authoritative.
      if (!found.length && yearParam != null && !isSeries) {
        try { found = (await d.search(query, 'movie', undefined, lang)) || []; }
        catch { searchFailures++; found = []; }
      }
      const seen = new Set(candidates.map((candidate) => String(candidate.id)));
      for (const candidate of found) {
        if (!candidate || candidate.id == null || seen.has(String(candidate.id))) continue;
        seen.add(String(candidate.id));
        candidates.push(candidate);
      }
      if (found.length) {
        let bestForQuery = null;
        try { bestForQuery = d.pick(query, found, info.year ?? undefined); } catch { /* keep other query results */ }
        const score = bestForQuery ? d.titleScore(query, bestForQuery) : 0;
        if (score > pickedScore) { picked = bestForQuery; pickedScore = score; }
      }
    }
    if (candidates.length === 0 && !redirect && searchFailures === 0 && Number.isInteger(info.year) && dates.length === 0) {
      const near = await nearTitleCandidate(d, info, isSeries, lang);
      searchFailures += near.failures;
      if (near.ambiguous) return failure('ambiguous-candidate', tried);
      if (near.candidate) {
        candidates.push(near.candidate);
        picked = near.candidate;
        tried.push(`near-title:${near.candidate.id}`);
      }
    }
    // Very short titles ("X", "W.", "K-9") make TMDB return loosely related
    // films, and the movie path takes the best of whatever came back. With a
    // year, accept only an exact title from that exact year.
    const shortTitle = compactTitle(info.title);
    // Also for rows stored as series whose name has no season or episode
    // marker: real season packs keep their normal ranking.
    if ((!isSeries || !info.isSeries) && Number.isInteger(info.year) && shortTitle.length > 0 && shortTitle.length <= 4 && candidates.length) {
      const exact = candidates.filter((candidate) => {
        const candidateYear = parseInt(String(candidate.release_date || candidate.first_air_date || '').slice(0, 4), 10);
        const names = [candidate.title, candidate.original_title, candidate.name, candidate.original_name].filter(Boolean).map(compactTitle);
        return candidateYear === info.year && names.includes(shortTitle);
      });
      if (exact.length > 1) return failure('ambiguous-candidate', tried);
      candidates = exact;
      picked = exact[0] || null;
    }
    if (candidates.length === 0 && !redirect) {
      // A failed TMDB request is not evidence that a title has no match.
      // Keep this transient condition distinct so the engine retries it soon
      // instead of hiding it behind the normal no-candidate backoff.
      return failure(searchFailures > 0 ? 'search-unavailable' : 'no-candidate', tried);
    }

    // A single embedded movie filename can correct a stale series
    // classification only when TMDB returns exactly one candidate with both
    // an exact title and the exact parsed year. This deliberately bypasses
    // popularity ranking; ambiguous or yearless evidence stays unresolved.
    if (requireUniqueStrongYear) {
      if (mediaType !== 'movie' || info.year == null) return failure('ambiguous-candidate', tried);
      const strong = candidates.filter((candidate) => {
        if (!candidate || candidate.id == null) return false;
        const candidateYear = String(candidate.release_date || '').slice(0, 4);
        if (candidateYear !== String(info.year)) return false;
        return queries.some((query) => d.titleScore(query, candidate) === 100);
      });
      if (strong.length !== 1) return failure(strong.length ? 'ambiguous-candidate' : 'no-candidate', tried);
      const winner = strong[0];
      return canonical({
        tmdbId: winner.id,
        tmdbType: 'movie',
        season: null,
        seasonStart: null,
        seasonEnd: null,
        episode: null,
        episodeEnd: null,
        title: displayTitle(null, winner, info.title),
        year: info.year,
        candidate: winner,
      });
    }

    const ranked = rankedCandidates(picked, candidates);
    if (redirect) ranked.unshift({ id: redirect.tmdbId, __redirect: redirect });

    // When a yearless movie has several exact-title candidates from different
    // years, votes alone are not enough to distinguish remakes. For a series
    // season pack, validate the requested season on every exact-title
    // candidate, then use the existing picker among valid candidates. This
    // preserves the usual vote-count tie-break and fails closed on a true tie.
    if (info.year == null) {
      const exactYears = new Set(ranked
        .filter((candidate) => !candidate.__redirect && queries.some((query) => d.titleScore(query, candidate) === 100))
        .map((candidate) => String(candidate.release_date || candidate.first_air_date || '').slice(0, 4))
        .filter((year) => /^\d{4}$/.test(year)));
      if (exactYears.size > 1) {
        const hasSeasonRange = info.seasonStart != null && info.seasonEnd != null
          && Number.isInteger(info.seasonStart) && Number.isInteger(info.seasonEnd)
          && info.seasonStart > 0 && info.seasonEnd >= info.seasonStart;
        const requestedSeasons = fileSeason != null
          ? [fileSeason]
          : hasSeasonRange ? Array.from({ length: info.seasonEnd - info.seasonStart + 1 }, (_, i) => info.seasonStart + i) : null;
        if (isSeries && requestedSeasons && !redirect) {
          const exactCandidates = ranked.filter((candidate) => !candidate.__redirect
            && queries.some((query) => d.titleScore(query, candidate) === 100));
          const seasonMatches = [];
          let seasonUnknown = false;
          for (const candidate of exactCandidates) {
            const candidateAnime = d.isAnimeCandidate(candidate);
            if ((mediaType === 'series' && (candidateAnime || info.isAnime))
              || (mediaType === 'anime' && !candidateAnime && !info.isAnime)) continue;
            let allPresent = true;
            let candidateUnknown = false;
            let winnerId = candidate.id;
            let winnerSeason = fileSeason;
            for (const requestedSeason of requestedSeasons) {
              // Existing split-season mappings apply to one requested season.
              // For a range, validate the complete range on one candidate and
              // do not stitch separate series identities together.
              const split = requestedSeasons.length === 1 ? lookupSplitSeason(candidate.id, requestedSeason) : null;
              const effectiveId = split ? split.tmdbId : candidate.id;
              const effectiveSeason = split ? split.season : requestedSeason;
              const validation = await checkSeason(d, seasonMemo, effectiveId, effectiveSeason, lang);
              if (validation.state === 'unknown') candidateUnknown = true;
              if (validation.state !== 'ok') allPresent = false;
              if (requestedSeasons.length === 1) { winnerId = effectiveId; winnerSeason = effectiveSeason; }
            }
            if (allPresent) seasonMatches.push({ candidate, effectiveId: winnerId, effectiveSeason: winnerSeason });
            else if (candidateUnknown) seasonUnknown = true;
          }
          if (seasonMatches.length === 1 && !seasonUnknown) {
            const winner = seasonMatches[0];
            return canonical({
              tmdbId: winner.effectiveId,
              tmdbType,
              season: fileSeason != null ? winner.effectiveSeason : null,
              seasonStart: hasSeasonRange ? info.seasonStart : null,
              seasonEnd: hasSeasonRange ? info.seasonEnd : null,
              episode: info.episode ?? null,
              episodeEnd: info.episodeEnd ?? null,
              title: displayTitle(null, winner.candidate, info.title),
              year: null,
              candidate: winner.candidate,
            });
          }
          if (seasonMatches.length > 1) {
            // Season validity narrows the pool, but it must not replace the
            // normal TMDB ordering inside that pool. In particular, weekly
            // shows and same-title variants rely on pickBestResult's existing
            // exact-title/year tier and vote_count tie-break. Only fail closed
            // when that same ordering leaves the top candidates indistinguishable.
            const seasonCandidates = seasonMatches.map((entry) => entry.candidate);
            let selected = null;
            try { selected = d.pick(info.title, seasonCandidates, info.year ?? undefined); } catch { /* ambiguous below */ }
            const winner = seasonMatches.find((entry) => String(entry.candidate.id) === String(selected?.id));
            if (!winner) return failure('ambiguous-candidate', tried);
            const winnerScore = d.titleScore(info.title, winner.candidate);
            const winnerVotes = Number(winner.candidate.vote_count || 0);
            const unresolvedTie = seasonMatches.some((entry) => String(entry.candidate.id) !== String(winner.candidate.id)
              && d.titleScore(info.title, entry.candidate) === winnerScore
              && Number(entry.candidate.vote_count || 0) === winnerVotes);
            if (unresolvedTie) return failure('ambiguous-candidate', tried);
            return canonical({
              tmdbId: winner.effectiveId,
              tmdbType,
              season: fileSeason != null ? winner.effectiveSeason : null,
              seasonStart: hasSeasonRange ? info.seasonStart : null,
              seasonEnd: hasSeasonRange ? info.seasonEnd : null,
              episode: info.episode ?? null,
              episodeEnd: info.episodeEnd ?? null,
              title: displayTitle(null, winner.candidate, info.title),
              year: null,
              candidate: winner.candidate,
            });
          }
          if (seasonUnknown) return failure('season-unverified', tried);
          return failure('season-missing', tried);
        }
        return failure('ambiguous-candidate', tried);
      }
    }

    // Season-exists fallback (step 4) exists so a release never lands on an
    // entry missing the season it names. It must not become a way for a
    // WORSE-TITLED sibling to absorb the release: with candidates
    // ["MasterChef", "MasterChef Australia"] and no season 1 on the exact
    // entry, the fallback used to hand a bare "MasterChef S01E01" file to
    // MasterChef Australia. An exact title is the strongest evidence about
    // what a release name means, so once one is in the pool, only exact-title
    // candidates may take over. Regional variants still win on their own
    // merit ("MasterChef Australia S01E01" matches Australia exactly), and
    // partial/alias releases keep the fallback that Kitchen Nightmares needs.
    const isExactTitle = (cand) => queries.some((query) => d.titleScore(query, cand) === 100);
    const hasExactTitle = ranked.some((cand) => !cand.__redirect && isExactTitle(cand));
    const eligible = hasExactTitle
      ? ranked.filter((cand) => cand.__redirect || isExactTitle(cand))
      : ranked;
    for (const dropped of ranked) {
      if (!eligible.includes(dropped)) tried.push(`title-downgrade:${dropped.id}`);
    }

    // Movies carry no seasons to validate: best non-anime pick wins.
    if (!isSeries) {
      const winner = ranked[0] || null;
      if (!winner) return failure('no-candidate', tried);
      return canonical({
        tmdbId: winner.id,
        tmdbType,
        season: null,
        seasonStart: null,
        seasonEnd: null,
        episode: null,
        episodeEnd: null,
        title: displayTitle(null, winner, info.title),
        year: info.year ?? null,
        candidate: winner.__redirect ? null : winner,
      });
    }

    const memo = seasonMemo;
    let unverified = false;
    for (const cand of eligible) {
      const cid = cand.id;
      const redir = cand.__redirect || null;

      // Anime gate mirrors the old matcher: anime candidates never back a
      // series request and vice versa.
      const candAnime = d.isAnimeCandidate(cand);
      if (isSeries && mediaType === 'series' && (candAnime || info.isAnime)) {
        tried.push(`anime-excluded:${cid}`);
        continue;
      }
      if (mediaType === 'anime' && !candAnime && !info.isAnime) {
        tried.push(`anime-excluded:${cid}`);
        continue;
      }

      // Date-based releases carry no SxxExx, so fileSeason is null and the
      // no-season early return below used to fire FIRST: their air date was
      // never checked against any candidate's episode list. They came back
      // with season/episode null and could sit on a show that never aired that
      // day (a "WWE RAW 2026 10 05" release landing on WWE Raw Top 10). The
      // date lookup now runs first and fills in the real numbering.
      //
      // It is best-effort by design. A miss falls through to the no-season
      // return rather than failing closed: TMDB has real gaps in episode air
      // dates, and dropping hundreds of correctly-titled releases because a
      // date is missing from the upstream data would be far worse than keeping
      // the title match without episode numbering. A miss never substitutes a
      // worse-titled candidate (see `eligible`).
      if (dates.length > 0 && info.episode == null) {
        const hits = [];
        for (const cand of eligible) {
          if (isSeries && mediaType === 'series' && (d.isAnimeCandidate(cand) || info.isAnime)) continue;
          if (mediaType === 'anime' && !d.isAnimeCandidate(cand) && !info.isAnime) continue;
          for (const date of dates) {
            let resolved = null;
            try {
              resolved = await d.findEpisode(cand.id, date, lang);
            } catch {
              resolved = null;
            }
            if (resolved && resolved.season != null) {
              hits.push({ cand, resolved });
              break;
            }
          }
        }
        if (hits.length > 0) {
          hits.sort((a, b) => ((b.cand.vote_count || 0) - (a.cand.vote_count || 0)));
          const winner = hits[0];
          return canonical({
            tmdbId: winner.cand.id,
            tmdbType,
            season: winner.resolved.season,
            seasonStart: null,
            seasonEnd: null,
            episode: winner.resolved.episode ?? null,
            episodeEnd: null,
            title: displayTitle(null, winner.cand, info.title),
            year: info.year ?? null,
            candidate: winner.cand,
          });
        }
        for (const cand of eligible) tried.push(`date-miss:${cand.id}`);
        // Season packs (fileSeason != null) still fall through to the
        // split-season and season-exists checks on the next candidate.
        if (fileSeason != null) continue;
      }

      // Season packs and whole-show matches carry no season to validate.
      if (fileSeason == null) {
        return canonical({
          tmdbId: redir ? redir.tmdbId : cid,
          tmdbType,
          season: null,
          seasonStart: info.seasonStart ?? null,
          seasonEnd: info.seasonEnd ?? null,
          episode: info.episode ?? null,
          episodeEnd: null,
          title: displayTitle(redir && redir.name, cand, info.title),
          year: info.year ?? null,
          candidate: redir ? null : cand,
        });
      }

      const split = lookupSplitSeason(cid, fileSeason);
      const effId = split ? split.tmdbId : (redir ? redir.tmdbId : cid);
      const effSeason = split ? split.season : (redir ? redir.season : fileSeason);
      const check = await checkSeason(d, memo, effId, effSeason, lang);
      if (check.state === 'ok') {
        return canonical({
          tmdbId: effId,
          tmdbType,
          season: effSeason,
          seasonStart: info.seasonStart ?? null,
          seasonEnd: info.seasonEnd ?? null,
          episode: info.episode ?? null,
          episodeEnd: info.episodeEnd ?? null,
          title: displayTitle(redir && redir.name, cand, info.title),
          year: info.year ?? null,
          candidate: redir ? null : cand,
        });
      }
      if (check.state === 'unknown') unverified = true;
      tried.push(`season-missing:${effId}:${effSeason}`);
    }

    if (unverified && tried.length === 0) return failure('no-candidate', tried);
    if (unverified) return failure('season-unverified', tried);
    if (tried.some((t) => t.startsWith('anime-excluded:')) && tried.every((t) => t.startsWith('anime-excluded:'))) {
      return failure('anime-excluded', tried);
    }
    return failure('season-missing', tried);
  } catch (err) {
    // Infrastructure/lookup failures must not be reported as a title miss.
    // Keep the stored reason safe and categorical; never persist upstream URLs
    // or provider response text here.
    return failure('lookup-error', tried);
  }
}

export interface MatchingApi {
  resolveMatch: any;
  RESOLVER_VERSION: any;
  MAX_MATCH_ATTEMPTS: any;
  matchVersion: any;
  retryVersion: any;
  defaultDeps: any;
  nearTitlePlan: any;
  titleSimilarity: any;
  compactTitle: any;
}

module.exports = { resolveMatch, RESOLVER_VERSION, MAX_MATCH_ATTEMPTS, matchVersion, retryVersion, defaultDeps, nearTitlePlan, titleSimilarity, compactTitle } satisfies MatchingApi;
