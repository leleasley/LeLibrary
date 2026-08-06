// ── Settings View ─────────────────────────────────────────────

function renderSettingsView() {
  hideAllViews();
  const settingsView = document.getElementById('settingsView');
  settingsView.style.display = 'block';

  const settings = getSettings();
  const accentColor = settings.accentColor || 'amber';

  settingsView.innerHTML = `
    <div class="browse-header"><h2>${icon('settings', 18)} Settings</h2></div>
    <div class="settings-section">

      <div class="settings-card">
        <h3>${icon('palette', 15)} Appearance</h3>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Accent Color</div>
            <div class="settings-row-desc">Choose your preferred accent color</div>
          </div>
          <div class="color-options">
            <div class="color-option ${accentColor === 'amber' ? 'active' : ''}" style="background:#f59e0b" onclick="setAccentColor('amber')" title="Amber"></div>
            <div class="color-option ${accentColor === 'blue' ? 'active' : ''}" style="background:#58a6ff" onclick="setAccentColor('blue')" title="Blue"></div>
            <div class="color-option ${accentColor === 'green' ? 'active' : ''}" style="background:#3fb950" onclick="setAccentColor('green')" title="Green"></div>
            <div class="color-option ${accentColor === 'purple' ? 'active' : ''}" style="background:#a855f7" onclick="setAccentColor('purple')" title="Purple"></div>
            <div class="color-option ${accentColor === 'red' ? 'active' : ''}" style="background:#f85149" onclick="setAccentColor('red')" title="Red"></div>
          </div>
        </div>
      </div>

      <div class="settings-card">
        <h3>${icon('disk', 15)} Data</h3>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Clear All Data</div>
            <div class="settings-row-desc">Remove all saved API keys, watchlist, and settings</div>
          </div>
          <button class="btn btn-danger btn-sm" onclick="clearAllData()">Clear Data</button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Export Watchlist</div>
            <div class="settings-row-desc">Download your watchlist as JSON</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="exportWatchlist()">Export</button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Import Watchlist</div>
            <div class="settings-row-desc">Import a previously exported watchlist</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="document.getElementById('importWatchlistInput').click()">Import</button>
          <input type="file" id="importWatchlistInput" accept=".json" style="display:none" onchange="importWatchlist(event)" />
        </div>
      </div>

      <div class="settings-card">
        <h3>${icon('keyboard', 15)} Keyboard Shortcuts</h3>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Enable Keyboard Shortcuts</div>
            <div class="settings-row-desc">Press ? to see all shortcuts</div>
          </div>
          <div class="toggle-switch ${getSetting('shortcutsEnabled', true) ? 'active' : ''}" onclick="toggleShortcutsSetting(this)"></div>
        </div>
      </div>

      <div class="settings-card">
        <h3>${icon('cloud', 15)} Provider Status</h3>
        <div id="providerStatusList">
          <div class="status-item"><div class="status-item-detail">Checking provider status&hellip;</div></div>
        </div>
        <div class="settings-row">
          <div class="settings-row-desc" id="providerStatusMeta"></div>
        </div>
      </div>

      <div class="settings-card">
        <h3>Info About</h3>
        <div class="settings-row">
          <div class="settings-row-label">LeLibrary</div>
          <div class="settings-row-desc" style="color:var(--amber)">v${APP_VERSION}</div>
        </div>
        <div class="settings-row" id="versionCheckRow" style="display:none">
          <div class="settings-row-label">Update</div>
          <div class="settings-row-desc" id="versionCheckMsg"></div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">GitHub</div>
          <a href="https://github.com/leleasley/LeLibrary" target="_blank" class="settings-row-desc">View Source</a>
        </div>
      </div>

    </div>
  `;

  checkMylibraryVersion();
  renderProviderStatus();

  addBackBtn(settingsView);

  updateBottomNav('settings');
}

const PROVIDER_LOGO = {
  torbox: '/provider-logos/torbox.png',
  realdebrid: '/provider-logos/realdebrid.svg',
  alldebrid: '/provider-logos/alldebrid.png',
  premiumize: '/provider-logos/premiumize.svg',
};

function statusLabel(s) {
  return s === 'operational' ? 'Operational' : s === 'degraded' ? 'Degraded' : s === 'down' ? 'Down' : 'Unknown';
}

async function renderProviderStatus() {
  const list = document.getElementById('providerStatusList');
  if (!list) return;

  let data = window._lelibraryStatus || (await fetchProviderStatus());
  if (!data || !Array.isArray(data.providers)) {
    list.innerHTML = '<div class="status-item"><div class="status-item-detail">Could not load provider status.</div></div>';
    return;
  }

  list.innerHTML = data.providers.map(p => `
    <div class="status-item">
      <img src="${PROVIDER_LOGO[p.id] || ''}" alt="${p.name}" loading="lazy" />
      <div class="status-item-info">
        <div class="status-item-name">${p.name}</div>
        <div class="status-item-detail">${p.detail || ''}</div>
      </div>
      <a class="status-item-state state-${p.status}" href="${p.url}" target="_blank" rel="noopener">${statusLabel(p.status)} ${icon('external', 12)}</a>
    </div>`).join('');

  const meta = document.getElementById('providerStatusMeta');
  if (meta && data.updatedAt) {
    meta.textContent = 'Last checked ' + new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

function setAccentColor(color) {
  saveSetting('accentColor', color);
  const colors = {
    amber: '#f59e0b',
    blue: '#58a6ff',
    green: '#3fb950',
    purple: '#a855f7',
    red: '#f85149',
  };
  const dimColors = {
    amber: '#b45309',
    blue: '#388bfd',
    green: '#238636',
    purple: '#8b5cf6',
    red: '#da3633',
  };
  document.documentElement.style.setProperty('--amber', colors[color] || colors.amber);
  document.documentElement.style.setProperty('--amber-dim', dimColors[color] || dimColors.amber);
  document.documentElement.style.setProperty('--amber-glow', (colors[color] || colors.amber) + '1f');

  // Update active state
  document.querySelectorAll('.color-option').forEach(el => el.classList.remove('active'));
  document.querySelector(`.color-option[onclick*="${color}"]`)?.classList.add('active');
}

function toggleShortcutsSetting(el) {
  const current = getSetting('shortcutsEnabled', true);
  saveSetting('shortcutsEnabled', !current);
  el.classList.toggle('active');
}

async function clearAllData() {
  if (!confirm('This will remove all your API keys, watchlist, and settings. Are you sure?')) return;
  localStorage.removeItem('lelibrary_encrypted');
  localStorage.removeItem('lelibrary_watchlist');
  localStorage.removeItem('lelibrary_settings');
  localStorage.removeItem('lelibrary_watched');
  sessionStorage.removeItem('lelibrary_password');
  await clearLibraryCache();
  window.location.reload();
}

function exportWatchlist() {
  const watchlist = getWatchlist();
  const blob = new Blob([JSON.stringify(watchlist, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lelibrary-watchlist.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Watchlist exported');
}

function importWatchlist(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) throw new Error('Invalid format');
      const existing = getWatchlist();
      const merged = [...imported, ...existing];
      const unique = merged.filter((item, idx, arr) =>
        arr.findIndex(i => i.tmdbId === item.tmdbId && i.type === item.type) === idx
      );
      saveWatchlist(unique);
      showToast(`Imported ${imported.length} items`);
      renderSettingsView();
    } catch (err) {
      showToast('Import failed: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

const APP_VERSION = '4.5.2';
async function checkMylibraryVersion() {
  const row = document.getElementById('versionCheckRow');
  const msg = document.getElementById('versionCheckMsg');
  if (!row || !msg) return;
  try {
    const r = await fetch('https://api.github.com/repos/leleasley/LeLibrary/releases/latest', {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const latest = (data.tag_name || '').replace(/^v/, '');
    if (!latest) throw new Error('No tag');
    if (latest !== APP_VERSION) {
      msg.innerHTML = `v${latest} available ${icon('external', 12)}`;
      msg.style.color = 'var(--amber)';
      row.style.display = 'flex';
      row.querySelector('.settings-row-desc').onclick = () => window.open('https://github.com/leleasley/LeLibrary/releases', '_blank');
    }
  } catch (e) {
    // silently ignore
  }
}
