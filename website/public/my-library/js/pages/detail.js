// ── Detail View (TMDB Detail + Torrent Search) ────────────────

let _detailTrailerKey = null;

function openTMDBDetail(item) {
  _detailTrailerKey = null;
  const type = item.mt === 'tv' ? 'Series' : 'Movie';
  const stars = item.rating ? '\u2605 ' + item.rating.toFixed(1) : '';
  const backdrop = item.backdrop ? 'https://image.tmdb.org/t/p/w1280' + item.backdrop : '';
  const poster = item.poster ? 'https://image.tmdb.org/t/p/w500' + item.poster : '';
  const inWatch = isInWatchlist(item.id, item.mt);

  const detailEl = document.createElement('div');
  detailEl.id = 'detailPage';

  const heroHtml = backdrop
    ? `<div class="detail-hero"><img src="${backdrop}" onerror="this.parentElement.style.display='none'" /><div class="detail-hero-overlay"></div></div>`
    : '';

  const posterHtml = poster
    ? `<div class="detail-poster"><img src="${poster}" onerror="this.parentElement.style.display='none'" /></div>`
    : '';

  const trailerUrl = item.id ? `/api/tmdb/${item.mt === 'tv' ? 'tv' : 'movie'}/${item.id}/videos?api_key=${App.keys.tmdbKey}` : '';

  // Fetch trailer
  fetch(trailerUrl).then(r => r.json()).then(d => {
    const vids = d.results || [];
    const trailer = vids.find(v => v.type === 'Trailer' && v.site === 'YouTube');
    if (trailer) {
      _detailTrailerKey = trailer.key;
      const btn = document.getElementById('btnTrailer');
      if (btn) { btn.style.display = 'inline-flex'; btn.onclick = () => openTrailer(trailer.key); }
    }
  }).catch(() => {});

  detailEl.innerHTML = `
    <div style="position:sticky;top:0;z-index:10;background:linear-gradient(var(--bg),transparent);padding:12px 16px;display:flex;justify-content:space-between;align-items:center;max-width:900px;margin:0 auto">
      <button onclick="closeDetail()" style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 14px;border-radius:6px;font-size:13px;cursor:pointer;font-family:var(--font)">&#8592; Back</button>
      <div style="display:flex;gap:6px">
        <button id="btnTrailer" style="display:none;background:var(--border);color:var(--text);padding:6px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font);border:none">&#9654; Trailer</button>
        <button onclick="toggleDetailWatchlist(${item.id},'${item.mt}','${escHtml(item.title).replace(/'/g, "\\'")}','${item.poster || ''}','${item.backdrop || ''}')" style="background:${inWatch ? 'var(--amber)' : 'var(--surface)'};color:${inWatch ? 'var(--bg)' : 'var(--text)'};border:1px solid var(--border);padding:6px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font)">${inWatch ? '&#11088; Saved' : '&#9734; Save'}</button>
        <a href="/" style="background:var(--amber);color:var(--bg);padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer;font-family:var(--font);text-decoration:none;font-weight:600">Home</a>
      </div>
    </div>
    ${heroHtml}
    <div class="detail-info">${posterHtml}
      <div class="detail-text">
        <h1 class="detail-title">${escHtml(item.title)}</h1>
        <div class="detail-meta">${item.year || ''} \u00B7 ${type}${stars ? ` \u00B7 <span style="color:var(--amber)">${stars}</span>` : ''}</div>
      </div>
    </div>
    <p class="detail-overview">${escHtml(item.overview || 'No description available.')}</p>
    <div class="filter-bar"><input type="text" id="filterInput" placeholder="&#128270; Filter results..." oninput="filterTorrents()" /><button onclick="resetFilter()">Reset</button></div>
    <div class="tag-bar" id="tagBar"></div>
    <div class="torrent-grid" id="torrentGrid"></div>
    <div id="torrentLoading" style="display:none;text-align:center;padding:2rem"><div class="spinner"></div><p style="color:var(--muted);font-size:13px">Searching across sources...</p></div>
    <div style="text-align:center;padding:1rem"><button id="btnSearchTorrents" style="background:var(--amber);color:var(--bg);border:none;border-radius:8px;padding:10px 32px;font-weight:700;font-size:14px;cursor:pointer;font-family:var(--font)">&#128270; Search Torrents</button></div>
  `;

  document.body.appendChild(detailEl);
  document.body.style.overflow = 'hidden';
  setTimeout(() => detailEl.scrollTop = 0, 10);

  const searchBtn = document.getElementById('btnSearchTorrents');
  if (searchBtn) {
    searchBtn.onclick = () => searchTorrents(item.title, item.id, item.mt);
  }
}

function closeDetail() {
  const el = document.getElementById('detailPage');
  if (el) el.remove();
  document.body.style.overflow = '';
}

function toggleDetailWatchlist(id, type, title, poster, backdrop) {
  if (isInWatchlist(id, type)) {
    removeFromWatchlist(id, type);
    showToast('Removed from watchlist');
  } else {
    addToWatchlist({ tmdbId: id, type, title, posterPath: poster, backdropPath: backdrop });
    showToast('Added to watchlist');
  }
  // Refresh the save button
  const btn = document.querySelector('#detailPage button[onclick*="toggleDetailWatchlist"]');
  if (btn) {
    const nowInWatch = isInWatchlist(id, type);
    btn.style.background = nowInWatch ? 'var(--amber)' : 'var(--surface)';
    btn.style.color = nowInWatch ? 'var(--bg)' : 'var(--text)';
    btn.innerHTML = nowInWatch ? '&#11088; Saved' : '&#9734; Save';
  }
}

async function searchTorrents(title, tmdbId, mediaType) {
  const grid = document.getElementById('torrentGrid');
  const loading = document.getElementById('torrentLoading');
  const btn = document.getElementById('btnSearchTorrents');
  if (!btn || !grid) return;
  const torboxKey = App.keys.torboxKey;
  btn.disabled = true;
  btn.textContent = '\u23F3 Searching...';
  grid.innerHTML = '';
  loading.style.display = 'block';

  const sources = [
    { name: 'APIBay', fn: () => scrapeSource('apibay', title) },
    { name: 'TorrentGalaxy', fn: () => scrapeSource('tgx', title) },
    { name: 'BTDigg', fn: () => scrapeSource('btdigg', title) },
    { name: 'Rutor', fn: () => scrapeSource('rutor', title) },
  ];

  const settled = await Promise.allSettled(sources.map(s => s.fn()));
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

  unique.sort((a, b) => (b.seeds || 0) - (a.seeds || 0));

  // Check cache status
  if (torboxKey && unique.length > 0) {
    const hashes = unique.filter(t => t.hash).map(t => t.hash).slice(0, 50);
    try {
      const cacheRes = await fetch('/api/torbox/torrents/checkcached?hash=' + hashes.join(','), {
        headers: { 'Authorization': 'Bearer ' + torboxKey }
      });
      const cacheData = await cacheRes.json();
      let cachedMap = null;
      if (cacheData.success && cacheData.data) cachedMap = cacheData.data;
      if (!cachedMap) {
        const cacheRes2 = await fetch('/api/torbox/torrents/checkcached', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + torboxKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ hashes })
        });
        const cacheData2 = await cacheRes2.json();
        if (cacheData2.success && cacheData2.data) cachedMap = cacheData2.data;
      }
      if (cachedMap) {
        unique.forEach(t => { if (t.hash && cachedMap[t.hash]) t.cached = true; });
      }
    } catch (e) {}

    // Fallback: check against user's mylist
    if (!unique.some(t => t.cached)) {
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
        unique.forEach(t => { if (t.hash && listHashes.has(t.hash)) t.cached = true; });
      } catch (e) {}
    }
  }

  loading.style.display = 'none';

  if (!unique.length) {
    grid.innerHTML = '<div style="padding:12px;text-align:center;color:var(--muted);font-size:12px">No torrents found across any source</div>';
    btn.disabled = false;
    btn.textContent = '\uD83D\uDD0D Search Again';
    return;
  }

  // Extract tags
  const allTags = {};
  unique.forEach(t => {
    const name = t.title || '';
    const yearMatch = name.match(/[\.\s\-\[\(](\d{4})[\.\s\-\[\)]/);
    if (yearMatch) { const y = parseInt(yearMatch[1]); if (y >= 1900 && y <= 2099) allTags[yearMatch[1]] = true; }
    if (/\b(1080p|720p|2160p|4K)\b/i.test(name)) { const q = name.match(/\b(1080p|720p|2160p|4K)\b/i)[1]; allTags[q] = true; }
    if (/\b(WEBRip|WEB-?DL|BluRay|REMUX|TELESYNC|CAM|HDRip)\b/i.test(name)) { const q = name.match(/\b(WEBRip|WEB-?DL|BluRay|REMUX|TELESYNC|CAM|HDRip)\b/i)[1]; allTags[q] = true; }
    if (/\b(Dual|Dubbed|Subbed|VOSTFR|VFF|VFQ)\b/i.test(name)) { const q = name.match(/\b(Dual|Dubbed|Subbed|VOSTFR|VFF|VFQ)\b/i)[1]; allTags[q] = true; }
  });

  const tagBar = document.getElementById('tagBar');
  if (tagBar) {
    tagBar.innerHTML = Object.keys(allTags).map(tag =>
      `<div class="tag-chip" data-tag="${escHtml(tag)}" onclick="toggleTag(this,'${escHtml(tag).replace(/'/g, "\\'")}')">${escHtml(tag)}</div>`
    ).join('');
  }

  function detectBadge(name) {
    const hasSeasonEp = /\bS\d{1,2}E\d{1,2}\b/i.test(name);
    const hasExtras = /\b(Extras?|Bonus|Featurettes?|Making.?Of|Behind.?The.?Scenes|Deleted.?Scenes)\b/i.test(name);
    if (hasSeasonEp) return { label: 'Single', cls: 'badge-single' };
    if (hasExtras) return { label: 'With extras', cls: 'badge-extras' };
    return { label: 'Single', cls: 'badge-single' };
  }

  const displayResults = unique.slice(0, 50);
  grid.innerHTML = displayResults.map(t => {
    const name = t.title || 'Unknown torrent';
    const size = t.size ? formatBytes(t.size) : '';
    const seeds = t.seeds || 0;
    const cached = t.cached || false;
    const hash = t.hash || '';
    const magnet = t.magnet || (hash ? 'magnet:?xt=urn:btih:' + hash : '');
    const badge = detectBadge(name);

    const safeName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const safeHash = hash.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const safeMagnet = magnet.replace(/'/g, "\\'").replace(/"/g, '&quot;');

    const actionHtml = cached
      ? `<button class="btn-action btn-instant" onclick="instantAdd('${safeName}','${safeHash}','${safeMagnet}')">\u26A1 Instant TB</button>`
      : `<button class="btn-action btn-download" onclick="addTorrent('${safeName}','${safeHash}','${safeMagnet}')">\uD83D\uDCE5 DL with TB</button>`;

    const copyBtn = magnet
      ? `<button class="btn-action btn-copy" onclick="copyMagnet('${safeMagnet}')">\uD83D\uDCCB Copy</button>`
      : '';

    return `<div class="torrent-card">
      <div class="torrent-card-title" title="${escHtml(name)}">${escHtml(name)}</div>
      <div class="torrent-card-meta">
        <span class="torrent-card-badge ${badge.cls}">${badge.label}</span>
        ${size ? `<span>${size}</span>` : ''}
        ${seeds ? `<span>\u2191 ${seeds}</span>` : ''}
        ${cached ? '<span style="color:var(--success);font-weight:700">\u26A1 CACHED</span>' : ''}
      </div>
      <div class="torrent-card-actions">${actionHtml}${copyBtn}<button class="btn-action btn-report" onclick="showToast('Reported \u2014 thank you!')">\u26A0 Report</button></div>
    </div>`;
  }).join('');

  btn.disabled = false;
  btn.textContent = '\uD83D\uDD0D Search Again';
}

async function instantAdd(name, hash, magnet) {
  const torboxKey = App.keys.torboxKey;
  if (!torboxKey) { showToast('Enter your TorBox API key first', 'error'); return; }
  try {
    const body = {};
    if (magnet) body.magnet = magnet;
    else if (hash) body.magnet = 'magnet:?xt=urn:btih:' + hash;
    else throw new Error('No magnet link or hash available');
    body.add_only_if_cached = true;
    await torboxPost('/torrents/createtorrent', body, torboxKey);
    showToast('Added to TorBox!');
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

async function addTorrent(name, hash, magnet) {
  const torboxKey = App.keys.torboxKey;
  if (!torboxKey) { showToast('Enter your TorBox API key first', 'error'); return; }
  try {
    const body = {};
    if (magnet) body.magnet = magnet;
    else if (hash) body.magnet = 'magnet:?xt=urn:btih:' + hash;
    else throw new Error('No magnet link or hash available');
    await torboxPost('/torrents/createtorrent', body, torboxKey);
    showToast('Added to TorBox \u2014 downloading...');
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

async function copyMagnet(magnet) {
  try {
    await navigator.clipboard.writeText(magnet);
    showToast('Magnet link copied!');
  } catch (err) {
    showToast('Failed to copy', 'error');
  }
}

function filterTorrents() {
  const query = document.getElementById('filterInput').value.toLowerCase();
  document.querySelectorAll('.torrent-card').forEach(card => {
    const title = card.querySelector('.torrent-card-title').textContent.toLowerCase();
    card.style.display = title.includes(query) ? '' : 'none';
  });
}

function resetFilter() {
  const input = document.getElementById('filterInput');
  if (input) { input.value = ''; filterTorrents(); }
}

function toggleTag(el, tag) {
  el.classList.toggle('active');
  const activeTags = [];
  document.querySelectorAll('.tag-chip.active').forEach(c => activeTags.push(c.dataset.tag.toLowerCase()));
  document.querySelectorAll('.torrent-card').forEach(card => {
    const title = card.querySelector('.torrent-card-title').textContent.toLowerCase();
    const textQuery = document.getElementById('filterInput')?.value?.toLowerCase() || '';
    const matchesText = !textQuery || title.includes(textQuery);
    const matchesTags = activeTags.length === 0 || activeTags.some(t => title.includes(t));
    card.style.display = (matchesText && matchesTags) ? '' : 'none';
  });
}
