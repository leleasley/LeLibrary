// ── App State & Routing ───────────────────────────────────────

const App = {
  keys: { torboxKey: '', rdKey: '', tmdbKey: '' },
  allItems: [],
  currentPage: 'dashboard',
};

// ── Navigation ────────────────────────────────────────────────
function navigateTo(page, data) {
  // Stop queue polling when leaving queue
  if (App.currentPage === 'queue') stopQueuePolling();

  App.currentPage = page;
  window.location.hash = page === 'dashboard' ? '' : page;

  switch (page) {
    case 'dashboard':
      renderDashboard();
      break;
    case 'browse-movies':
      renderBrowseView('movies');
      break;
    case 'browse-series':
      renderBrowseView('series');
      break;
    case 'library':
      renderLibraryView();
      break;
    case 'genres':
      renderGenreView();
      break;
    case 'recent':
      renderRecentView();
      break;
    case 'profile':
      renderProfileView();
      break;
    case 'watchlist':
      renderWatchlistView();
      break;
    case 'queue':
      renderQueueView();
      break;
    case 'settings':
      renderSettingsView();
      break;
    default:
      renderDashboard();
  }
}

function navigateHash() {
  const hash = window.location.hash.slice(1);
  if (!hash || hash === 'dashboard') {
    if (App.allItems.length > 0) navigateTo('dashboard');
    return;
  }
  if (App.allItems.length > 0) navigateTo(hash);
}

// ── Bottom Nav ────────────────────────────────────────────────
function updateBottomNav(active) {
  document.querySelectorAll('.bottom-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === active);
  });
}

// ── Login / Auth ──────────────────────────────────────────────
function onProviderChange() {
  const provider = document.getElementById('providerSelect').value;
  document.getElementById('tbKeyWrap').style.display = provider === 'realdebrid' ? 'none' : 'block';
  document.getElementById('rdKeyWrap').style.display = provider === 'torbox' ? 'none' : 'block';
}

function toggleVis(id, btn) {
  const el = document.getElementById(id);
  const isPass = el.type === 'password';
  el.type = isPass ? 'text' : 'password';
  btn.textContent = isPass ? '\uD83D\uDE48' : '\uD83D\uDC41';
}

async function handleLoad() {
  const provider = document.getElementById('providerSelect').value;
  const hasEncrypted = localStorage.getItem('lelibrary_encrypted');

  if (hasEncrypted) {
    const password = document.getElementById('decPassword').value.trim();
    if (!password) { showError('Please enter your encryption password'); return; }
    try {
      const encObj = JSON.parse(hasEncrypted);
      const keys = await decryptData(encObj, password);
      document.getElementById('apiKey').value = keys.torboxKey || '';
      document.getElementById('rdApiKey').value = keys.rdKey || '';
      document.getElementById('tmdbKey').value = keys.tmdbKey || '';
      if (keys.torboxKey) App.keys.torboxKey = keys.torboxKey;
      if (keys.rdKey) App.keys.rdKey = keys.rdKey;
      if (keys.tmdbKey) App.keys.tmdbKey = keys.tmdbKey;
      sessionStorage.setItem('lelibrary_password', password);
      await loadLibrary();
    } catch (err) {
      showError('Wrong password \u2014 could not decrypt your keys');
    }
  } else {
    const apiKey = document.getElementById('apiKey').value.trim();
    const rdApiKey = document.getElementById('rdApiKey').value.trim();
    const tmdbKey = document.getElementById('tmdbKey').value.trim();
    const password = document.getElementById('encPassword').value.trim();
    if ((provider === 'torbox' || provider === 'both') && !apiKey) { showError('Please enter your TorBox API key'); return; }
    if ((provider === 'realdebrid' || provider === 'both') && !rdApiKey) { showError('Please enter your Real-Debrid API key'); return; }
    if (!tmdbKey) { showError('Please enter your TMDB API key'); return; }
    if (!password) { showError('Please choose an encryption password'); return; }
    if (password.length < 4) { showError('Password must be at least 4 characters'); return; }
    try {
      const encrypted = await encryptData({ torboxKey: apiKey, rdKey: rdApiKey, tmdbKey }, password);
      localStorage.setItem('lelibrary_encrypted', JSON.stringify(encrypted));
      sessionStorage.setItem('lelibrary_password', password);
      await loadLibrary();
    } catch (err) {
      showError('Encryption failed: ' + err.message);
    }
  }
}

async function loadLibrary() {
  const apiKey = document.getElementById('apiKey')?.value?.trim() || '';
  const rdApiKey = document.getElementById('rdApiKey')?.value?.trim() || '';
  const tmdbKey = document.getElementById('tmdbKey')?.value?.trim() || '';
  if (!apiKey && !rdApiKey) { showError('Enter at least one API key (TorBox or Real-Debrid)'); return; }

  if (apiKey) App.keys.torboxKey = apiKey;
  if (rdApiKey) App.keys.rdKey = rdApiKey;
  if (tmdbKey) App.keys.tmdbKey = tmdbKey;

  hideError();
  document.getElementById('loginSection').style.display = 'none';
  document.getElementById('content').style.display = 'none';
  document.getElementById('loadingScreen').style.display = 'flex';
  document.getElementById('btnLoad').classList.add('loading');

  // Show cached data instantly while fetching fresh data
  const cached = await getCachedLibrary();
  if (cached.items.length > 0) {
    App.allItems = cached.items;
    buildLibraryIndex();
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('content').style.display = 'block';
    document.getElementById('authNav').style.display = 'inline';
    document.getElementById('authNavMobile').style.display = 'block';
    const savedColor = getSetting('accentColor', 'amber');
    if (savedColor !== 'amber') setAccentColor(savedColor);
    showToast('Loaded ' + cached.items.length + ' items (cached)');
    navigateHash();

    // Refresh in background
    refreshInBackground();
    document.getElementById('btnLoad')?.classList.remove('loading');
    return;
  }

  // No cache — full load
  try {
    const completed = await loadLibraryFromProviders();

    if (completed.length === 0) {
      document.getElementById('loadingScreen').style.display = 'none';
      document.getElementById('emptyState').style.display = 'block';
      return;
    }

    App.allItems = completed;
    buildLibraryIndex();
    cacheLibrary(completed); // save to IndexedDB

    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('content').style.display = 'block';
    document.getElementById('authNav').style.display = 'inline';
    document.getElementById('authNavMobile').style.display = 'block';

    const savedColor = getSetting('accentColor', 'amber');
    if (savedColor !== 'amber') setAccentColor(savedColor);

    showToast('Loaded ' + completed.length + ' items');
    navigateHash();
  } catch (err) {
    showError(err.message);
  } finally {
    document.getElementById('btnLoad')?.classList.remove('loading');
  }
}

// Background refresh — fetch fresh data without blocking UI
async function refreshInBackground() {
  try {
    const completed = await loadLibraryFromProviders();
    App.allItems = completed;
    buildLibraryIndex();
    cacheLibrary(completed);
  } catch (e) {
    // Silent fail — cached data is still shown
  }
}

// ── Logout ────────────────────────────────────────────────────
function logout() {
  if (!confirm('Log out? Your API keys will remain saved.')) return;
  App.allItems = [];
  App.keys = { torboxKey: '', rdKey: '', tmdbKey: '' };
  _libNameSet = null;
  _libStats = null;
  stopQueuePolling();
  document.getElementById('content').style.display = 'none';
  document.getElementById('authNav').style.display = 'none';
  document.getElementById('authNavMobile').style.display = 'none';
  document.getElementById('loginSection').style.display = 'block';
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('loadingScreen').style.display = 'none';
  // Show return user form if keys are saved
  if (localStorage.getItem('lelibrary_encrypted')) {
    document.getElementById('newUserForm').style.display = 'none';
    document.getElementById('returnUserForm').style.display = 'block';
    document.getElementById('loginDesc').textContent = 'Enter your password to unlock your saved library.';
  } else {
    document.getElementById('newUserForm').style.display = 'block';
    document.getElementById('returnUserForm').style.display = 'none';
    document.getElementById('loginDesc').textContent = 'Browse your downloads from TorBox and/or Real-Debrid.';
  }
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  onProviderChange();
  initKeyboardShortcuts();

  // Auto-load using stored password
  const savedPw = sessionStorage.getItem('lelibrary_password');
  const hasEncrypted = localStorage.getItem('lelibrary_encrypted');

  if (savedPw && hasEncrypted) {
    try {
      const encObj = JSON.parse(hasEncrypted);
      decryptData(encObj, savedPw).then(keys => {
        document.getElementById('apiKey').value = keys.torboxKey || '';
        document.getElementById('rdApiKey').value = keys.rdKey || '';
        document.getElementById('tmdbKey').value = keys.tmdbKey || '';
        if (keys.torboxKey) App.keys.torboxKey = keys.torboxKey;
        if (keys.rdKey) App.keys.rdKey = keys.rdKey;
        if (keys.tmdbKey) App.keys.tmdbKey = keys.tmdbKey;
        loadLibrary();
      }).catch(() => {
        if (hasEncrypted) {
          document.getElementById('newUserForm').style.display = 'none';
          document.getElementById('returnUserForm').style.display = 'block';
          document.getElementById('loginDesc').textContent = 'Enter your password to unlock your saved library.';
        }
      });
      return;
    } catch (e) {}
  }

  if (hasEncrypted) {
    document.getElementById('newUserForm').style.display = 'none';
    document.getElementById('returnUserForm').style.display = 'block';
    document.getElementById('loginDesc').textContent = 'Enter your password to unlock your saved library.';
    setTimeout(() => document.getElementById('decPassword')?.focus(), 100);
  }

  // Enter key on inputs
  ['apiKey', 'rdApiKey', 'tmdbKey', 'encPassword', 'decPassword'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') handleLoad(); });
  });

  window.addEventListener('hashchange', navigateHash);
});
