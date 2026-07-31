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
