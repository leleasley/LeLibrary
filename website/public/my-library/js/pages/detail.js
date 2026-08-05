// ── Detail View (TMDB Detail + Torrent Search) ────────────────

let _detailTrailerKey = null;
let _detailItem = null;
let _detailSeasons = [];
let _detailCurrentSeason = 1;
let _detailResults = [];
let _detailCachedFirst = false;
let _detailLangFilter = 'all';
let _detailToken = 0;
let _detailScrapeFailed = false;

// Escape a string for embedding inside an inline `onclick="..."` attribute
// where the JS uses single-quoted string literals. Handles HTML decoding,
// JS string escaping and attribute termination (double quotes, < > &).
function jsInlineStr(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '')
    .replace(/\n/g, ' ')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

// Guard: aborts async callbacks that belong to a previous detail overlay.
function detailIsCurrent() {
  return document.getElementById('detailPage')?.dataset.openToken === String(_detailToken);
}

function openTMDBDetail(item) {
  _detailTrailerKey = null;
  _detailItem = item;
  _detailSeasons = [];
  _detailCurrentSeason = 1;
  _detailResults = [];
  _detailCachedFirst = false;
  _detailLangFilter = 'all';
  _detailToken = Date.now();
  _detailScrapeFailed = false;

  // Remove any existing detail overlay (e.g. navigating from a recommendation)
  document.getElementById('detailPage')?.remove();

  // Update URL hash for deep linking
  const hashType = item.mt === 'tv' ? 'series' : 'movie';
  window.history.replaceState(null, '', '#/' + hashType + '/' + item.id);

  const type = item.mt === 'tv' ? 'Series' : 'Movie';
  const backdrop = item.backdrop ? 'https://image.tmdb.org/t/p/w1280' + item.backdrop : '';
  const poster = item.poster ? 'https://image.tmdb.org/t/p/w500' + item.poster : '';
  const inWatch = isInWatchlist(item.id, item.mt);

  const detailEl = document.createElement('div');
  detailEl.id = 'detailPage';
  detailEl.dataset.openToken = String(_detailToken);

  detailEl.innerHTML = `
    <div class="detail-hero">
      <img src="${backdrop || ''}" onerror="this.style.display='none'" />
      <div class="detail-hero-overlay"></div>
      <div class="detail-hero-content">
        <button onclick="closeDetail()" class="detail-back-btn">${icon('back', 14)} Back</button>
        <div class="detail-actions-row">
          <button id="btnTrailer" style="display:none" class="detail-action-btn">${icon('play', 12)} Trailer</button>
          <button onclick="toggleDetailWatchlist(${item.id},'${jsInlineStr(item.mt)}','${jsInlineStr(item.title)}','${jsInlineStr(item.poster || '')}','${jsInlineStr(item.backdrop || '')}')" class="detail-action-btn detail-save-btn" style="background:${inWatch ? 'var(--amber)' : 'rgba(22,27,34,0.8)'};color:${inWatch ? 'var(--bg)' : 'var(--text)'}">${icon('star', 13)} ${inWatch ? 'Saved' : 'Save'}</button>
        </div>
      </div>
    </div>
    <div class="detail-layout">
      <div class="detail-left">
        <div class="detail-sticky">
          <div class="detail-info">
            ${poster ? `<div class="detail-poster"><img src="${poster}" onerror="this.parentElement.style.display='none'" /></div>` : ''}
            <div class="detail-text">
              <h1 class="detail-title">${escHtml(item.title)}</h1>
              <div class="detail-meta">
                ${item.year ? `<span>${item.year}</span>` : ''}
                <span>\u00B7</span>
                <span>${type}</span>
                ${item.rating ? `<span class="tmdb-badge">\u2605 ${item.rating.toFixed(1)}</span>` : ''}
                <span id="imdbRating"></span>
              </div>
            </div>
          </div>
          <p class="detail-overview">${escHtml(item.overview || 'No description available.')}</p>
          <div class="detail-genre-bar" id="genreBar"></div>
          ${item.mt === 'tv' ? '<div class="detail-season-bar" id="seasonBar"></div>' : ''}
          <div class="detail-rec" id="recSection" style="display:none">
            <div class="detail-rec-title">${icon('film', 14)} More like this</div>
            <div class="detail-rec-grid" id="recRow"></div>
          </div>
        </div>
      </div>
      <div class="detail-right">
        <div class="detail-torrent-header">
          <div class="detail-torrent-title">${icon('search', 14)} Torrents</div>
          <div class="detail-filter-row"><input type="text" id="filterInput" placeholder="Filter..." oninput="applyFilters()" aria-label="Filter torrent results" /></div>
        </div>
        <div class="detail-search-row">
          <input type="text" id="torrentQuery" placeholder="Search query..." aria-label="Search query" onkeydown="if(event.key==='Enter')manualTorrentSearch()" />
          <button class="btn-action btn-download" onclick="manualTorrentSearch()" aria-label="Search torrents">${icon('search', 12)} Search</button>
          <button id="btnCachedFirst" class="btn-action btn-copy" onclick="toggleCachedFirst()" title="Put cached (Instant TB) torrents first" aria-label="Cached first">\u26A1 Cached first</button>
        </div>
        <div class="detail-lang-bar" id="langBar">
          <button class="lang-chip active" onclick="setLangFilter('all', this)">All</button>
          <button class="lang-chip" onclick="setLangFilter('dual', this)">Dual</button>
          <button class="lang-chip" onclick="setLangFilter('subs', this)">Subs</button>
          <button class="lang-chip" onclick="setLangFilter('eng', this)">English</button>
        </div>
        ${item.mt === 'tv' ? `
        <div class="detail-batch-bar" id="batchBar" style="display:none">
          <div class="batch-title">${icon('zap', 12)} Season add</div>
          <div class="batch-providers" id="batchProviders"></div>
          <div class="batch-actions">
            <button class="btn-action btn-instant" onclick="handleBatchAdd('season')" title="Find a complete cached season pack and add it">${icon('zap', 12)} Add season</button>
            <button class="btn-action btn-instant" onclick="handleBatchAdd('episodes')" title="Add each individually cached episode of this season">${icon('film', 12)} Add episodes</button>
          </div>
          <div class="batch-status" id="batchStatus"></div>
        </div>` : ''}
        <div id="torrentLoading" style="display:none" class="detail-loading"><div class="spinner"></div><p>Searching across sources...</p></div>
        <div id="autoSearchHint" class="detail-auto-hint">Loading torrents...</div>
        <div class="torrent-grid" id="torrentGrid"></div>
      </div>
    </div>
  `;

  document.body.appendChild(detailEl);
  document.body.style.overflow = 'hidden';
  setTimeout(() => detailEl.scrollTop = 0, 10);

  // Fetch trailer
  const trailerPath = item.id ? `/api/tmdb/${item.mt === 'tv' ? 'tv' : 'movie'}/${item.id}/videos` : '';
  if (trailerPath) {
    fetch(trailerPath, { headers: { 'x-tmdb-key': App.keys.tmdbKey } }).then(r => r.json()).then(d => {
      if (!detailIsCurrent()) return;
      const vids = d.results || [];
      const trailer = vids.find(v => v.type === 'Trailer' && v.site === 'YouTube');
      if (trailer) {
        _detailTrailerKey = trailer.key;
        const btn = document.getElementById('btnTrailer');
        if (btn) { btn.style.display = 'inline-flex'; btn.onclick = () => openTrailer(trailer.key); }
      }
    }).catch(() => {});
  }

  // Fetch IMDB link via TMDB external IDs
  if (item.id) {
    const extPath = `/api/tmdb/${item.mt === 'tv' ? 'tv' : 'movie'}/${item.id}/external_ids`;
    fetch(extPath, { headers: { 'x-tmdb-key': App.keys.tmdbKey } }).then(r => r.json()).then(d => {
      if (!detailIsCurrent()) return;
      const imdbId = d.imdb_id;
      if (imdbId) {
        const el = document.getElementById('imdbRating');
        if (el) el.innerHTML = `<a href="https://www.imdb.com/title/${imdbId}" target="_blank" rel="noopener" class="imdb-badge"><img src="https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/IMDB_Logo_2016.svg/330px-IMDB_Logo_2016.svg.png" alt="IMDB" style="height:14px" /></a>`;
      }
    }).catch(() => {});
  }

  // Load recommendations
  if (item.id) loadRecommendations(item);

  // For TV shows, fetch seasons then auto-search
  if (item.mt === 'tv') {
    fetchTVSeasons(item.id);
  } else {
    document.getElementById('autoSearchHint').style.display = 'block';
    autoSearchTorrents(item.title, item.year, item.id, item.mt, 1);
  }
}

function closeDetail() {
  const el = document.getElementById('detailPage');
  if (el) el.remove();
  document.body.style.overflow = '';
  // Reset URL hash back to previous page
  const page = App.currentPage || 'dashboard';
  window.history.replaceState(null, '', '#' + (page === 'dashboard' ? '' : page));
}

function toggleDetailWatchlist(id, type, title, poster, backdrop) {
  if (isInWatchlist(id, type)) {
    removeFromWatchlist(id, type);
    showToast('Removed from watchlist');
  } else {
    addToWatchlist({ tmdbId: id, type, title, posterPath: poster, backdropPath: backdrop });
    showToast('Added to watchlist');
  }
  const btn = document.querySelector('#detailPage .detail-save-btn');
  if (btn) {
    const nowInWatch = isInWatchlist(id, type);
    btn.style.background = nowInWatch ? 'var(--amber)' : 'rgba(22,27,34,0.8)';
    btn.style.color = nowInWatch ? 'var(--bg)' : 'var(--text)';
    btn.innerHTML = icon('star', 13) + (nowInWatch ? ' Saved' : ' Save');
  }
}

// ── Recommendations ────────────────────────────────────────────
async function loadRecommendations(item) {
  const section = document.getElementById('recSection');
  if (!section) return;
  const type = item.mt === 'tv' ? 'tv' : 'movie';

  // Fetch detail data (for genres) + recommendations in parallel
  const endpoint = item.mt === 'tv' ? '/tv/' : '/movie/';
  const detailEndpoint = `${endpoint}${item.id}`;
  const recEndpoint = `${endpoint}${item.id}/recommendations`;

  try {
    const [detailData, recData] = await Promise.all([
      tmdbGet(detailEndpoint).catch(() => ({})),
      tmdbGet(recEndpoint).catch(() => ({})),
    ]);
    if (!detailIsCurrent()) return;

    // Display genres
    const genres = detailData.genres || [];
    const genreBar = document.getElementById('genreBar');
    if (genreBar && genres.length > 0) {
      genreBar.innerHTML = genres.slice(0, 4).map(g =>
        `<span class="genre-badge">${escHtml(g.name)}</span>`
      ).join('');
    }

    // Recommendations from TMDB
    const recs = (recData.results || []).filter(i => i.poster_path).slice(0, 12);

    // Also fetch "Same Genre" if we have genre IDs
    let sameGenreRecs = [];
    if (genres.length > 0 && recs.length < 6) {
      const genreId = genres[0].id;
      const discoverEndpoint = `/discover/movie?with_genres=${genreId}&sort_by=popularity.desc&vote_count.gte=500`;
      try {
        const genreData = await tmdbGet(discoverEndpoint);
        const seenIds = new Set(recs.map(r => r.id).concat([item.id]));
        sameGenreRecs = (genreData.results || [])
          .filter(i => i.poster_path && !seenIds.has(i.id))
          .slice(0, 12 - recs.length);
      } catch (e) {}
    }

    const allRecs = [...recs, ...sameGenreRecs];
    if (allRecs.length === 0) return;

    const row = document.getElementById('recRow');
    row.innerHTML = allRecs.map(r => {
      const title = r.title || r.name || '';
      const year = (r.release_date || r.first_air_date || '').split('-')[0];
      const mt = r.media_type || type;
      const rec = {
        id: r.id,
        mt: jsInlineStr(mt),
        title: jsInlineStr(title),
        year: jsInlineStr(year),
        poster: jsInlineStr(r.poster_path || ''),
        backdrop: jsInlineStr(r.backdrop_path || ''),
        overview: jsInlineStr(r.overview || ''),
        rating: r.vote_average || 0,
      };
      return `<div class="card" role="button" tabindex="0" aria-label="Open details: ${escHtml(title)}"
        onclick="openTMDBDetail({id:${rec.id},mt:'${rec.mt}',title:'${rec.title}',year:'${rec.year}',poster:'${rec.poster}',backdrop:'${rec.backdrop}',overview:'${rec.overview}',rating:${rec.rating}})">
        <img src="https://image.tmdb.org/t/p/w185${r.poster_path}" alt="${escHtml(title)}" loading="lazy" />
        <div class="card-info"><div class="card-title" title="${escHtml(title)}">${escHtml(title)}</div>${year ? `<div class="card-year">${year}</div>` : ''}</div>
      </div>`;
    }).join('');
    section.style.display = 'block';
  } catch (e) {}
}

// ── TV Seasons ─────────────────────────────────────────────────
async function fetchTVSeasons(tmdbId) {
  try {
    const data = await tmdbGet('/tv/' + tmdbId);
    if (!detailIsCurrent()) return;
    _detailSeasons = (data.seasons || [])
      .filter(s => s.season_number > 0)
      .map(s => ({ season_number: s.season_number, name: s.name, episode_count: s.episode_count || 0 }));
    renderSeasonBar();
    renderBatchBar();
    searchSeason(1);
  } catch (e) {
    if (!detailIsCurrent()) return;
    document.getElementById('autoSearchHint').style.display = 'block';
    autoSearchTorrents(_detailItem.title, _detailItem.year, _detailItem.id, _detailItem.mt, 1);
  }
}

function renderSeasonBar() {
  const bar = document.getElementById('seasonBar');
  if (!bar || _detailSeasons.length === 0) { if (bar) bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  bar.innerHTML = _detailSeasons.map(s =>
    `<button class="season-btn${s.season_number === _detailCurrentSeason ? ' active' : ''}" onclick="searchSeason(${s.season_number})" title="${escHtml(s.name || 'Season ' + s.season_number)}">S${s.season_number}</button>`
  ).join('');
}

function searchSeason(num) {
  _detailCurrentSeason = num;
  document.querySelectorAll('.season-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.textContent.replace('S', '')) === num);
  });
  const seasonName = _detailSeasons.find(s => s.season_number === num)?.name || ('Season ' + num);
  document.getElementById('autoSearchHint').style.display = 'block';
  document.getElementById('autoSearchHint').textContent = 'Searching for ' + seasonName + '...';
  autoSearchTorrents(_detailItem.title, _detailItem.year, _detailItem.id, _detailItem.mt, num);
}

// ── Season batch add (whole season / every episode) ─────────────
// Modeled on Debrid Media Manager's "Instant RD (Whole Season)" and
// "Instant RD (Every Episode)" actions. Because the public scrapers only give
// us title/hash (no per-file manifest), "whole season" matches title-level
// complete-season packs and "every episode" matches single-episode torrents.
const BATCH_PROVIDERS = [
  { key: 'torbox', label: 'TorBox', has: () => !!App.keys.torboxKey },
  { key: 'rd', label: 'Real-Debrid', has: () => !!App.keys.rdKey },
  { key: 'ad', label: 'AllDebrid', has: () => !!App.keys.adKey },
  { key: 'pm', label: 'Premiumize', has: () => !!App.keys.pmKey },
];

function renderBatchBar() {
  const bar = document.getElementById('batchBar');
  const wrap = document.getElementById('batchProviders');
  if (!bar || !wrap) return;
  const enabled = BATCH_PROVIDERS.filter(p => p.has());
  if (!enabled.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  wrap.innerHTML = enabled.map((p, i) =>
    `<label class="batch-provider"><input type="checkbox" data-prov="${p.key}" ${i === 0 ? 'checked' : ''} /> ${p.label}</label>`
  ).join('');
}

function getSelectedBatchProviders() {
  return BATCH_PROVIDERS
    .filter(p => p.has())
    .filter(p => document.querySelector(`#batchProviders input[data-prov="${p.key}"]`)?.checked);
}

function batchStatus(msg, isErr) {
  const el = document.getElementById('batchStatus');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isErr ? 'var(--error)' : 'var(--muted)';
}

async function handleBatchAdd(mode) {
  const provs = getSelectedBatchProviders();
  if (!provs.length) { batchStatus('Select at least one provider', true); return; }

  const seasonNum = _detailCurrentSeason;
  const expected = currentSeasonEpisodeCount();

  // Candidates: complete-season packs (mode 'season') or single-episode
  // torrents (mode 'episodes') for the current season, skipping anything the
  // user already owns across any provider.
  const seen = new Set();
  const candidates = _detailResults
    .filter(t => t.hash && !libraryHashSet().has(String(t.hash).toLowerCase()))
    .map(t => ({ t, a: analyzeSeasonTorrent(t, seasonNum, expected) }))
    .filter(x => mode === 'season' ? x.a.seasonPack : x.a.isSingle)
    .filter(x => { if (seen.has(x.t.hash)) return false; seen.add(x.t.hash); return true; })
    .map(x => x.t);

  if (!candidates.length) {
    batchStatus(mode === 'season'
      ? 'No complete-season torrents found in results'
      : 'No single-episode torrents found in results', true);
    return;
  }

  batchStatus('Checking cache across providers...');
  const hashes = candidates.map(t => t.hash);
  const lines = [];
  let anyAdded = false;

  for (const p of provs) {
    let cachedSet;
    try {
      cachedSet = await {
        torbox: () => torboxCachedSet(hashes, App.keys.torboxKey),
        rd: () => rdCachedSet(hashes, App.keys.rdKey),
        ad: () => adCachedSet(hashes, App.keys.adKey),
        pm: () => pmCachedSet(hashes, App.keys.pmKey),
      }[p.key]();
    } catch (e) { cachedSet = new Set(); }

    const cachedCandidates = candidates.filter(t => cachedSet.has(String(t.hash).toLowerCase()));
    if (!cachedCandidates.length) { lines.push(p.label + ': no cached matches'); continue; }
    // "Season" mode picks the single best-quality cached pack (results are
    // quality-sorted); "episodes" mode adds every cached individual episode.
    const toAdd = mode === 'season' ? cachedCandidates.slice(0, 1) : cachedCandidates;

    batchStatus(p.label + ': adding ' + toAdd.length + ' cached...');
    let added = 0;
    for (const t of toAdd) {
      try {
        await addCachedByProvider(p.key, magnetFromHash(t.hash), App.keys[p.key + 'Key']);
        added++;
      } catch (e) { /* skip a failed add and keep going */ }
    }
    if (added > 0) anyAdded = true;
    lines.push(p.label + ': ' + added + ' added');
  }

  invalidateLibraryHashSet();
  if (anyAdded) { showToast('Added to your library'); refreshInBackground(); }
  batchStatus(lines.join(' · '));
}


// ── Smart Search Query Builder ──────────────────────────────────
function buildSearchQuery(title, year, mediaType, seasonNum) {
  let cleanTitle = title.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
  let query = (year ? year + ' ' : '') + cleanTitle;
  if (mediaType === 'tv' && seasonNum) {
    query += ' S' + String(seasonNum).padStart(2, '0');
  }
  return query;
}

// ── Season episode analysis ─────────────────────────────────────
// The public scrapers only return {title, size, hash, seeds, source}, so
// episode coverage has to be inferred from the torrent title. These helpers
// power the episode-completeness badge and the batch "add season/episodes".

// Expected episode count for the currently selected season (from TMDB).
function currentSeasonEpisodeCount() {
  const s = _detailSeasons.find(x => x.season_number === _detailCurrentSeason);
  return (s && s.episode_count) || 0;
}

// Episode numbers of the given season present in a torrent title (SxxExx / nxx).
function extractEpisodeNums(title, seasonNum) {
  const sn = String(seasonNum).padStart(2, '0');
  const eps = new Set();
  const patterns = [
    new RegExp('\\bS' + sn + 'E(\\d{1,2})\\b', 'gi'),
    new RegExp('\\b' + seasonNum + 'x(\\d{1,2})\\b', 'i'),
    new RegExp('\\bseason\\s*' + seasonNum + '\\b', 'i'),
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(title)) !== null) {
      if (m[1]) eps.add(parseInt(m[1], 10));
      else eps.add(seasonNum); // "Season N" counts as a full pack signal
    }
  }
  return [...eps].filter(n => n > 0).sort((a, b) => a - b);
}

// Is this torrent a complete-season (or multi-season) pack for the season?
function isCompleteSeasonTorrent(title, seasonNum, expected) {
  const sn = String(seasonNum).padStart(2, '0');
  const lower = title.toLowerCase();
  const eps = extractEpisodeNums(title, seasonNum);

  // Explicit "S01 COMPLETE" / "Season 1 Complete" markers
  if (new RegExp('\\b(s' + sn + '|season\\s*' + seasonNum + ')[^a-z0-9]{0,5}(complete|full|whole)\\b', 'i').test(lower)) return true;
  // Explicit "S01E01-E10" or "S01E01-S01E10" ranges
  const rm = title.match(new RegExp('\\bS' + sn + 'E(\\d{1,2})[^0-9]{1,8}(?:S' + sn + ')?E(\\d{1,2})\\b', 'i'));
  if (rm) {
    const start = parseInt(rm[1], 10), end = parseInt(rm[2], 10);
    if (end - start + 1 >= Math.min(5, Math.max(1, expected))) return true;
  }
  // "Complete Series" / "All Seasons" (covers any season)
  if (/\b(complete.?series|all seasons|entire.?series|full.?series)\b/i.test(lower)) return true;
  // A pack with enough distinct episodes to be the whole season
  if (expected > 0 && eps.length >= Math.max(5, expected - 2)) return true;
  return false;
}

// Classify a torrent against the current season for the badge + batch add.
function analyzeSeasonTorrent(t, seasonNum, expected) {
  const eps = extractEpisodeNums(t.title, seasonNum);
  const isSingle = eps.length === 1;
  const seasonPack = isCompleteSeasonTorrent(t.title, seasonNum, expected);
  return { eps, isSingle, seasonPack };
}

// Set of every infohash already in the user's library (all providers), so a
// batch add can skip content they already own.
let _libHashSet = null;
function libraryHashSet() {
  if (_libHashSet) return _libHashSet;
  const set = new Set();
  (App.allItems || []).forEach(it => {
    [it.hash, it._rdHash, it._adHash, it.info_hash, it.magnet].forEach(v => {
      if (!v) return;
      const mm = String(v).match(/btih:([a-f0-9]{40})/i);
      if (mm) set.add(mm[1].toLowerCase());
      else set.add(String(v).toLowerCase());
    });
  });
  _libHashSet = set;
  return set;
}
function invalidateLibraryHashSet() { _libHashSet = null; }

// ── Search Core (shared by auto + manual) ─────────────────────
async function runTorrentSearch(query) {
  const grid = document.getElementById('torrentGrid');
  const loading = document.getElementById('torrentLoading');
  const hint = document.getElementById('autoSearchHint');
  if (!grid) return;

  grid.innerHTML = '';
  loading.style.display = 'flex';
  if (hint) hint.style.display = 'none';

  // Reflect the query in the editable search box
  const qInput = document.getElementById('torrentQuery');
  if (qInput) qInput.value = query;

  const torboxKey = App.keys.torboxKey;

  const sources = [
    { name: 'APIBay', fn: () => scrapeSource('apibay', query) },
    { name: 'TorrentGalaxy', fn: () => scrapeSource('tgx', query) },
    { name: 'BTDigg', fn: () => scrapeSource('btdigg', query) },
    { name: 'Rutor', fn: () => scrapeSource('rutor', query) },
  ];

  const settled = await Promise.allSettled(sources.map(s => s.fn()));
  if (!detailIsCurrent()) return;
  _detailScrapeFailed = settled.length > 0 && settled.every(r => r.status === 'rejected');
  let allResults = [];
  settled.forEach(r => {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      allResults = allResults.concat(r.value);
    }
  });

  const seen = new Set();
  const unique = allResults.filter(t => {
    const key = t.hash || t.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Smart filter: keep only results relevant to the current title
  const titleLower = (_detailItem?.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const filtered = unique.filter(t => {
    const name = (t.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return !titleLower || name.includes(titleLower) || titleLower.includes(name);
  });

  _detailResults = sortTorrentsByQuality(filtered);

  if (torboxKey && _detailResults.length > 0) {
    await checkTorBoxCache(_detailResults, torboxKey);
  }
  if (!detailIsCurrent()) return;

  loading.style.display = 'none';

  renderFromResults();
}

// ── Auto Search (on open) ──────────────────────────────────────
async function autoSearchTorrents(title, year, tmdbId, mediaType, seasonNum) {
  const query = buildSearchQuery(title, year, mediaType, seasonNum);
  await runTorrentSearch(query);
}

// ── Manual Search (editable query) ─────────────────────────────
async function searchTorrents(title, tmdbId, mediaType, customQuery) {
  const seasonNum = mediaType === 'tv' ? _detailCurrentSeason : 1;
  const query = (customQuery && customQuery.trim()) || buildSearchQuery(title, _detailItem?.year, mediaType, seasonNum);
  await runTorrentSearch(query);
}

function manualTorrentSearch() {
  const input = document.getElementById('torrentQuery');
  const q = (input?.value || '').trim();
  if (!q || !_detailItem) return;
  document.getElementById('autoSearchHint').style.display = 'block';
  document.getElementById('autoSearchHint').textContent = 'Searching...';
  searchTorrents(_detailItem.title, _detailItem.id, _detailItem.mt, q);
}

// ── Cached-first toggle ────────────────────────────────────────
function toggleCachedFirst() {
  _detailCachedFirst = !_detailCachedFirst;
  const btn = document.getElementById('btnCachedFirst');
  if (btn) btn.classList.toggle('active', _detailCachedFirst);
  renderFromResults();
}

// ── Render from current results (applies cached-first sort) ───
function renderFromResults() {
  const grid = document.getElementById('torrentGrid');
  if (!grid) return;

  if (!_detailResults.length) {
    grid.innerHTML = _detailScrapeFailed
      ? '<div class="detail-empty">Torrent sources are unreachable right now — check your connection and try again.</div>'
      : '<div class="detail-empty">No torrents found</div>';
    return;
  }

  let results = _detailResults;
  if (_detailCachedFirst) {
    // Stable sort: cached on top, quality order preserved within each group
    results = results.slice().sort((a, b) => (b.cached ? 1 : 0) - (a.cached ? 1 : 0));
  }

  renderTorrentCards(results, grid);
  applyFilters();
}

// ── Language filter ────────────────────────────────────────────
function setLangFilter(lang, el) {
  _detailLangFilter = lang;
  document.querySelectorAll('.lang-chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  applyFilters();
}

// ── Quality Sort ────────────────────────────────────────────────
function sortTorrentsByQuality(torrents) {
  function getQualityScore(name) {
    const lower = (name || '').toLowerCase();
    // CAM / TELESYNC / TS / TC / SCREENER always sink to the bottom,
    // regardless of any resolution tag they also carry.
    if (/\b(?:cam|hdcam|camrip|telesync|ts|tc|scr|screener)\b/i.test(lower)) return 10;
    if (/2160p|4k|uhd/i.test(lower)) return 1;
    if (/bluray|bdrip|remux/i.test(lower)) return 0.5;
    if (/1080p/i.test(lower)) return 2;
    if (/720p/i.test(lower)) return 3;
    if (/480p/i.test(lower)) return 4;
    if (/web-?dl/i.test(lower)) return 1.5;
    if (/webrip/i.test(lower)) return 1.8;
    if (/hdtv|hdrip/i.test(lower)) return 2.5;
    if (/dvdrip/i.test(lower)) return 3.5;
    return 3;
  }

  return torrents.sort((a, b) => {
    const qa = getQualityScore(a.title);
    const qb = getQualityScore(b.title);
    if (qa !== qb) return qa - qb;
    return (b.seeds || 0) - (a.seeds || 0);
  });
}

// ── TorBox Cache Check ──────────────────────────────────────────
async function checkTorBoxCache(torrents, torboxKey) {
  const allHashes = torrents.filter(t => t.hash).map(t => t.hash);
  const CHUNK_SIZE = 20;
  let cachedMap = {};

  for (let i = 0; i < allHashes.length; i += CHUNK_SIZE) {
    const chunk = allHashes.slice(i, i + CHUNK_SIZE);
    try {
      const cacheRes = await fetch('/api/torbox/torrents/checkcached', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + torboxKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashes: chunk })
      });
      const cacheData = await cacheRes.json();
      if (cacheData.success && cacheData.data) Object.assign(cachedMap, cacheData.data);
    } catch (e) {}
  }

  if (Object.keys(cachedMap).length > 0) {
    torrents.forEach(t => { if (t.hash && cachedMap[t.hash]) t.cached = true; });
  }

  // Fallback: check against user's mylist
  if (!torrents.some(t => t.cached)) {
    try {
      const listRes = await fetch('/api/torbox/torrents/mylist', {
        headers: { 'Authorization': 'Bearer ' + torboxKey }
      });
      const listData = await listRes.json();
      const listHashes = new Set();
      if (listData.data) {
        listData.data.forEach(item => {
          if (item.hash) listHashes.add(item.hash.toLowerCase());
        });
      }
      torrents.forEach(t => { if (t.hash && listHashes.has(t.hash)) t.cached = true; });
    } catch (e) {}
  }
}

// ── Render Torrent Cards ────────────────────────────────────────
function renderTorrentCards(torrents, grid) {
  function detectBadge(name, isTv, seasonNum, expected) {
    if (/\b(Extras?|Bonus|Featurettes?|Making.?Of|Behind.?The.?Scenes|Deleted.?Scenes)\b/i.test(name)) {
      return { label: 'Extras', cls: 'badge-extras' };
    }
    if (isTv && seasonNum) {
      const { eps, seasonPack } = analyzeSeasonTorrent({ title: name }, seasonNum, expected);
      if (eps.length === 1) return { label: 'E' + String(eps[0]).padStart(2, '0'), cls: 'badge-single' };
      if (seasonPack) return { label: 'Full S' + String(seasonNum).padStart(2, '0'), cls: 'badge-full' };
      if (eps.length > 1) return { label: eps.length + '/' + (expected || '?') + ' eps', cls: 'badge-partial' };
      return { label: 'Single', cls: 'badge-single' };
    }
    return { label: 'Single', cls: 'badge-single' };
  }

  const isTv = _detailItem?.mt === 'tv';
  const seasonNum = isTv ? _detailCurrentSeason : null;
  const expected = isTv ? currentSeasonEpisodeCount() : 0;

  const displayResults = torrents.slice(0, 50);
  grid.innerHTML = displayResults.map(t => {
    const name = t.title || 'Unknown torrent';
    const size = t.size ? formatBytes(t.size) : '';
    const seeds = t.seeds || 0;
    const cached = t.cached || false;
    const hash = t.hash || '';
    const magnet = t.magnet || (hash ? 'magnet:?xt=urn:btih:' + hash : '');
    const badge = detectBadge(name, isTv, seasonNum, expected);

    const safeName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ');
    const safeHash = hash.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const safeMagnet = magnet.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ');

    const actionHtml = cached
      ? `<button class="btn-action btn-instant" onclick="instantAdd(this.dataset.name,this.dataset.hash,this.dataset.magnet)" data-name="${safeName}" data-hash="${safeHash}" data-magnet="${safeMagnet}">\u26A1 Instant TB</button>`
      : `<button class="btn-action btn-download" onclick="addTorrent(this.dataset.name,this.dataset.hash,this.dataset.magnet)" data-name="${safeName}" data-hash="${safeHash}" data-magnet="${safeMagnet}">\uD83D\uDCE5 DL with TB</button>`;

    const copyBtn = magnet
      ? `<button class="btn-action btn-copy" aria-label="Copy magnet link to clipboard" onclick="copyMagnet(this,'${safeMagnet}')">\uD83D\uDCCB Copy</button>`
      : '';

    return `<div class="torrent-card">
      <div class="torrent-card-title" title="${escHtml(name)}">${escHtml(name)}</div>
      <div class="torrent-card-meta">
        <span class="torrent-card-badge ${badge.cls}">${badge.label}</span>
        ${size ? `<span>${size}</span>` : ''}
        ${seeds ? `<span>\u2191 ${seeds}</span>` : ''}
        ${cached ? '<span style="color:var(--success);font-weight:700">\u26A1 CACHED</span>' : ''}
      </div>
      <div class="torrent-card-actions">${actionHtml}${copyBtn}</div>
    </div>`;
  }).join('');
}

// ── Torrent Actions ─────────────────────────────────────────────
async function instantAdd(name, hash, magnet) {
  const torboxKey = App.keys.torboxKey;
  if (!torboxKey) { showToast('Enter your TorBox API key first', 'error'); return; }
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = '\u23F3 Adding...'; }
  try {
    const body = {};
    if (magnet) body.magnet = magnet;
    else if (hash) body.magnet = 'magnet:?xt=urn:btih:' + hash;
    else throw new Error('No magnet link or hash available');
    body.add_only_if_cached = true;
    await torboxPost('/torrents/createtorrent', body, torboxKey);
    showToast('\u26A1 Added to TorBox!');
    if (btn) { btn.textContent = '\u2713 Added'; btn.style.background = 'var(--success)'; }
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '\u26A1 Instant TB'; }
  }
}

async function addTorrent(name, hash, magnet) {
  const torboxKey = App.keys.torboxKey;
  if (!torboxKey) { showToast('Enter your TorBox API key first', 'error'); return; }
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = '\u23F3 Adding...'; }
  try {
    const body = {};
    if (magnet) body.magnet = magnet;
    else if (hash) body.magnet = 'magnet:?xt=urn:btih:' + hash;
    else throw new Error('No magnet link or hash available');
    await torboxPost('/torrents/createtorrent', body, torboxKey);
    showToast('\uD83D\uDCE5 Added to TorBox \u2014 downloading...');
    if (btn) { btn.textContent = '\u2713 Added'; btn.style.background = 'var(--success)'; }
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '\uD83D\uDCE5 DL with TB'; }
  }
}

async function copyMagnet(btn, magnet) {
  try {
    await navigator.clipboard.writeText(magnet);
    const orig = btn.innerHTML;
    btn.innerHTML = '\u2713 Copied!';
    btn.disabled = true;
    setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 1500);
  } catch (err) {
    showToast('Failed to copy', 'error');
  }
}

// ── Filter (text + language combined) ──────────────────────────
function applyFilters() {
  const q = (document.getElementById('filterInput')?.value || '').toLowerCase();
  const lang = _detailLangFilter;
  document.querySelectorAll('.torrent-card').forEach(card => {
    const title = card.querySelector('.torrent-card-title').textContent.toLowerCase();
    let show = !q || title.includes(q);
    if (show && lang !== 'all') {
      if (lang === 'dual') show = /\b(dual|dubbed|multi)\b/i.test(title);
      else if (lang === 'subs') show = /\b(subbed|subs|vostfr|vost|vff|vfq|multi.?subs)\b/i.test(title);
      else if (lang === 'eng') show = /\beng(?:lish)?\b/i.test(title);
    }
    card.style.display = show ? '' : 'none';
  });
}
