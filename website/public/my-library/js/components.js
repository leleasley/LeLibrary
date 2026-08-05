// ── Shared UI Components ──────────────────────────────────────

// ── Toast ─────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show toast-' + type;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.className = 'toast'; }, 2500);
}

// ── Error display ─────────────────────────────────────────────
function showError(msg) {
  const box = document.getElementById('errorBox');
  const errorMsg = document.getElementById('errorMsg');
  if (box && errorMsg) {
    errorMsg.textContent = msg;
    box.classList.add('show');
  }
  hideAllViews();
}

function hideError() {
  const box = document.getElementById('errorBox');
  if (box) box.classList.remove('show');
}

// ── View management ───────────────────────────────────────────
function hideAllViews() {
  ['dashboard', 'libraryView', 'browseView', 'genreView', 'recentView',
   'profileView', 'watchlistView', 'queueView', 'settingsView', 'downloadView'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  document.getElementById('itemPreviewBar')?.classList.remove('show');
  const tmdbGrid = document.getElementById('tmdbGrid');
  const tmdbLoading = document.getElementById('tmdbLoading');
  if (tmdbGrid) tmdbGrid.style.display = 'none';
  if (tmdbLoading) tmdbLoading.style.display = 'none';
  document.querySelectorAll('.back-btn').forEach(b => b.remove());
}

function showView(id) {
  hideAllViews();
  const el = document.getElementById(id);
  if (el) el.style.display = 'block';
}

// ── Back button ───────────────────────────────────────────────
function addBackBtn(container) {
  document.querySelectorAll('.back-btn').forEach(b => b.remove());
  const btn = document.createElement('button');
  btn.className = 'back-btn';
  btn.innerHTML = icon('back', 14) + ' Back to Dashboard';
  btn.onclick = () => navigateTo('dashboard');
  if (container) {
    container.insertBefore(btn, container.firstChild);
  }
  return btn;
}

// ── Keyboard shortcuts ────────────────────────────────────────
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (modalOpen()) return;
    if (getSetting('shortcutsEnabled', true) === false) return;

    // / or Ctrl+K — focus search
    if (e.key === '/' || (e.ctrlKey && e.key === 'k')) {
      e.preventDefault();
      const searchInput = document.getElementById('tmdbSearchInput');
      if (searchInput) searchInput.focus();
      return;
    }

    // ? — show shortcuts
    if (e.key === '?') {
      e.preventDefault();
      showShortcutsModal();
      return;
    }

    // Number keys — quick navigation
    const pageMap = {
      '1': 'dashboard', '2': 'browse-movies', '3': 'browse-series',
      '4': 'library', '5': 'watchlist', '6': 'queue',
      '7': 'profile', '8': 'settings', '9': 'download',
    };
    if (pageMap[e.key]) {
      e.preventDefault();
      navigateTo(pageMap[e.key]);
      return;
    }

    // Escape — go back
    if (e.key === 'Escape') {
      const trailer = document.getElementById('trailerModal');
      if (trailer) { closeTrailer(); return; }
      if (document.getElementById('detailPage')) { closeDetail(); return; }
      const shortcutsModal = document.getElementById('shortcutsModal');
      if (shortcutsModal) { shortcutsModal.remove(); return; }
      navigateTo('dashboard');
      return;
    }
  });
}

function showShortcutsModal() {
  if (document.getElementById('shortcutsModal')) return;
  const overlay = document.createElement('div');
  overlay.id = 'shortcutsModal';
  overlay.className = 'shortcuts-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="shortcuts-box">
      <h3>Keyboard Shortcuts</h3>
      <div class="shortcut-row"><span class="shortcut-label">Search</span><div class="shortcut-keys"><span class="kbd">/</span> or <span class="kbd">Ctrl+K</span></div></div>
      <div class="shortcut-row"><span class="shortcut-label">Go back</span><div class="shortcut-keys"><span class="kbd">Esc</span></div></div>
      <div class="shortcut-row"><span class="shortcut-label">Show shortcuts</span><div class="shortcut-keys"><span class="kbd">?</span></div></div>
      <div class="shortcut-row"><span class="shortcut-label">Dashboard</span><div class="shortcut-keys"><span class="kbd">1</span></div></div>
      <div class="shortcut-row"><span class="shortcut-label">Movies</span><div class="shortcut-keys"><span class="kbd">2</span></div></div>
      <div class="shortcut-row"><span class="shortcut-label">Series</span><div class="shortcut-keys"><span class="kbd">3</span></div></div>
      <div class="shortcut-row"><span class="shortcut-label">Library</span><div class="shortcut-keys"><span class="kbd">4</span></div></div>
      <div class="shortcut-row"><span class="shortcut-label">Watchlist</span><div class="shortcut-keys"><span class="kbd">5</span></div></div>
      <div class="shortcut-row"><span class="shortcut-label">Queue</span><div class="shortcut-keys"><span class="kbd">6</span></div></div>
      <div class="shortcut-row"><span class="shortcut-label">Profile</span><div class="shortcut-keys"><span class="kbd">7</span></div></div>
      <div class="shortcut-row"><span class="shortcut-label">Settings</span><div class="shortcut-keys"><span class="kbd">8</span></div></div>
      <div class="shortcut-row"><span class="shortcut-label">Add Download</span><div class="shortcut-keys"><span class="kbd">9</span></div></div>
      <button class="btn btn-secondary" style="width:100%;margin-top:12px" onclick="this.closest('.shortcuts-overlay').remove()">Close</button>
    </div>
  `;
  document.body.appendChild(overlay);
}

// ── Modal state check ─────────────────────────────────────────
function modalOpen() {
  return !!(document.getElementById('detailPage') || document.getElementById('trailerModal'));
}

// ── Trailer modal ─────────────────────────────────────────────
function openTrailer(videoKey) {
  const overlay = document.createElement('div');
  overlay.className = 'trailer-overlay';
  overlay.id = 'trailerModal';
  overlay.onclick = (e) => { if (e.target === overlay) closeTrailer(); };
  overlay.innerHTML = `
    <div class="trailer-box">
      <button class="trailer-close" onclick="closeTrailer()">&times;</button>
      <iframe src="https://www.youtube.com/embed/${videoKey}?autoplay=1&rel=0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
    </div>
  `;
  document.body.appendChild(overlay);
}

function closeTrailer() {
  const el = document.getElementById('trailerModal');
  if (el) el.remove();
}

// ── Mobile menu ───────────────────────────────────────────────
function toggleMenu() {
  document.getElementById('hamburger')?.classList.toggle('open');
  document.getElementById('mobileMenu')?.classList.toggle('open');
}

// ── Download progress bar (top, sweeping) ─────────────────────
let _dlBarTimer = null;
function showDownloadBar(msg, hold = false) {
  let bar = document.getElementById('downloadBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'downloadBar';
    bar.className = 'download-bar';
    bar.innerHTML = `<div class="download-bar-track"><div class="download-bar-fill"></div></div><span class="download-bar-label"></span>`;
    document.body.appendChild(bar);
  }
  const label = bar.querySelector('.download-bar-label');
  if (label) label.textContent = msg || 'Downloading…';
  bar.classList.add('show');
  clearTimeout(_dlBarTimer);
  if (!hold) _dlBarTimer = setTimeout(hideDownloadBar, 2600);
}
function hideDownloadBar() {
  clearTimeout(_dlBarTimer);
  document.getElementById('downloadBar')?.classList.remove('show');
}

// ── What's new modal (shows recent releases once each, scrollable) ─

// Strip Markdown formatting from release bodies so they display cleanly
// in the modal (GitHub releases are raw Markdown with ## headers, **bold**
// markers, and lots of blank lines).
function cleanReleaseBody(body) {
  if (!body) return '';
  return body
    .replace(/^## \[.*?\]\s*/m, '')          // strip top-level version header (duplicate of title)
    .replace(/^### /gm, '')                   // strip sub-header markers (keep text)
    .replace(/\*\*(.*?)\*\*/g, '$1')         // strip **bold** markers
    .replace(/\n{3,}/g, '\n\n')              // collapse 3+ blank lines to 2
    .replace(/^\n+/, '')                      // trim leading newlines
    .trim();
}

async function checkWhatsNew() {
  try {
    const r = await fetch('https://api.github.com/repos/leleasley/LeLibrary/releases?per_page=5', {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return;
    const releases = await r.json();
    if (!Array.isArray(releases) || releases.length === 0) return;

    // Seen tags (migrate the old single-key format if present)
    const rawSeen = (localStorage.getItem('lelibrary_seen_releases') || localStorage.getItem('lelibrary_seen_release') || '');
    const seen = new Set(rawSeen.split(',').map(s => s.trim()).filter(Boolean));

    const unseen = releases
      .filter(rel => { const tag = (rel.tag_name || '').replace(/^v/, ''); return tag && !seen.has(tag); });

    if (unseen.length === 0) return;

    // Mark EVERY fetched release as seen (not just the ones we display) so a
    // release that was pushed off the list doesn't reappear on the next load.
    for (const rel of releases) {
      const tag = (rel.tag_name || '').replace(/^v/, '');
      if (tag) seen.add(tag);
    }
    localStorage.setItem('lelibrary_seen_releases', [...seen].join(','));
    localStorage.removeItem('lelibrary_seen_release');

    showWhatsNewModal(unseen.slice(0, 4).map(rel => ({ title: rel.name || rel.tag_name, body: rel.body || '' })));
  } catch (e) { /* offline / blocked — skip silently */ }
}

function showWhatsNewModal(releases) {
  if (document.getElementById('whatsNewModal')) return;
  const items = Array.isArray(releases) && releases.length
    ? releases.map(r => ({ title: r.title || r.name || r.tag_name, body: cleanReleaseBody(r.body || '') }))
    : [{ title: 'Release notes', body: (typeof releases === 'string' ? releases : '') || 'Release notes are empty.' }];
  const count = items.length;
  const bodyHtml = items.map(r => `
    <div class="wn-release">
      <div class="wn-release-title">${escHtml(r.title || 'Release')}</div>
      <div class="wn-release-body">${escHtml(r.body || 'Release notes are empty.')}</div>
    </div>`).join('');

  const overlay = document.createElement('div');
  overlay.id = 'whatsNewModal';
  overlay.className = 'wn-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="wn-box">
      <div class="wn-header">
        <h3>${icon('zap', 16)} What's new${count > 1 ? ` (${count} releases)` : ''}</h3>
        <button class="wn-close" onclick="this.closest('.wn-overlay').remove()" aria-label="Close">&times;</button>
      </div>
      <div class="wn-body">${bodyHtml}</div>
      <div class="wn-footer">
        <a class="btn btn-secondary btn-sm" href="https://github.com/leleasley/LeLibrary/releases" target="_blank" rel="noopener">View all on GitHub ${icon('external', 12)}</a>
        <button class="btn btn-primary btn-sm" onclick="this.closest('.wn-overlay').remove()">Got it</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

// Premiumize device-authorization modal — shows the PIN, opens the device page,
// and re-polls /api/verify/premiumize until the key is authorized, then calls onDone.
function showPinModal(pin, deviceUrl, onDone) {
  if (document.getElementById('pinModal')) return;
  const overlay = document.createElement('div');
  overlay.id = 'pinModal';
  overlay.className = 'wn-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="wn-box">
      <div class="wn-header">
        <h3>${icon('zap', 16)} Authorize your Premiumize key</h3>
        <button class="wn-close" onclick="this.closest('.wn-overlay').remove()" aria-label="Close">&times;</button>
      </div>
      <div class="wn-body" style="text-align:center">
        <p>Premiumize needs you to authorize this key from a new device. Open the link and enter this PIN:</p>
        <div style="font-family:var(--mono, monospace);font-size:1.4rem;font-weight:700;letter-spacing:.15em;color:var(--amber);background:var(--surface2);border:1px dashed var(--border2);border-radius:8px;padding:14px;margin:14px 0">${escHtml(pin)}</div>
        <a class="btn btn-amber btn-sm" href="${escHtml(deviceUrl)}" target="_blank" rel="noopener">Open premiumize.me/device ${icon('external', 12)}</a>
      </div>
      <div class="wn-footer">
        <button class="btn btn-primary btn-sm" id="pinRecheck">I've done it — retry</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const recheck = document.getElementById('pinRecheck');
  recheck.onclick = async () => {
    recheck.disabled = true;
    try {
      const r = await fetch('/api/verify/premiumize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: App.keys.pmKey || '' })
      });
      const d = await r.json();
      if (d.valid) {
        overlay.remove();
        showToast('Premiumize authorized!');
        if (typeof onDone === 'function') onDone();
      } else if (d.needPin) {
        recheck.disabled = false;
        showToast('Still waiting — enter the PIN and retry', 'error');
      } else {
        recheck.disabled = false;
        showToast(d.error || 'Key still not valid', 'error');
      }
    } catch (e) {
      recheck.disabled = false;
      showToast('Could not reach Premiumize — try again', 'error');
    }
  };
}
