// ── Dashboard View ────────────────────────────────────────────

function renderDashboard() {
  const content = document.getElementById('content');
  const dashboard = document.getElementById('dashboard');
  if (!dashboard) return;

  hideAllViews();
  dashboard.style.display = 'block';
  document.getElementById('searchBarWrap').style.display = 'block';
  document.getElementById('searchBarWrap').style.order = '-1';

  const items = App.allItems || [];
  const stats = getLibStats();
  const totalSize = stats.totalSize;
  const movieCount = stats.movieCount;
  const seriesCount = stats.seriesCount;
  const hasTB = !!App.keys.torboxKey;
  const hasRD = !!App.keys.rdKey;

  // Provider badges
  let providerBadges = '';
  if (hasTB) providerBadges += '<span class="provider-badge tb">TorBox</span>';
  if (hasRD) providerBadges += '<span class="provider-badge rd">Real-Debrid</span>';

  // Recent items for Continue Watching
  const recent = items.slice()
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 10);

  // Activity items (last 5)
  const activity = items.slice()
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 5);

  const watchlist = getWatchlist();

  dashboard.innerHTML = `
    <div class="dash-welcome">
      <h1>My Library</h1>
      <p>Browse and manage your downloads</p>
      ${providerBadges ? `<div class="provider-badges">${providerBadges}</div>` : ''}
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">&#128230;</div>
        <div class="stat-value">${items.length}</div>
        <div class="stat-label">Total Items</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">&#127916;</div>
        <div class="stat-value">${movieCount}</div>
        <div class="stat-label">Movies</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">&#128250;</div>
        <div class="stat-value">${seriesCount}</div>
        <div class="stat-label">Series</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">&#128190;</div>
        <div class="stat-value">${formatBytes(totalSize)}</div>
        <div class="stat-label">Total Size</div>
      </div>
    </div>

    <div class="quick-actions">
      <a class="action-card" onclick="navigateTo('browse-movies')">
        <div class="action-icon">&#127916;</div>
        <div class="action-label">Movies</div>
      </a>
      <a class="action-card" onclick="navigateTo('browse-series')">
        <div class="action-icon">&#128250;</div>
        <div class="action-label">Series</div>
      </a>
      <a class="action-card" onclick="navigateTo('library')">
        <div class="action-icon">&#128194;</div>
        <div class="action-label">My Library</div>
        <div class="action-count">${items.length} items</div>
      </a>
      <a class="action-card" onclick="navigateTo('watchlist')">
        <div class="action-icon">&#11088;</div>
        <div class="action-label">Watchlist</div>
        <div class="action-count">${watchlist.length} saved</div>
      </a>
      <a class="action-card" onclick="navigateTo('genres')">
        <div class="action-icon">&#127917;</div>
        <div class="action-label">Genres</div>
      </a>
      <a class="action-card" onclick="navigateTo('recent')">
        <div class="action-icon">&#128197;</div>
        <div class="action-label">Recent</div>
      </a>
      <a class="action-card" onclick="navigateTo('queue')">
        <div class="action-icon">&#128229;</div>
        <div class="action-label">Queue</div>
      </a>
      <a class="action-card" onclick="navigateTo('profile')">
        <div class="action-icon">&#128100;</div>
        <div class="action-label">Profile</div>
      </a>
    </div>

    ${recent.length > 0 ? `
    <div class="dash-section">
      <div class="dash-section-header">
        <div class="dash-section-title">&#128197; Recently Added</div>
        <button class="dash-section-link" onclick="navigateTo('recent')">View all &#8250;</button>
      </div>
      <div class="scroll-row" id="recentRow"></div>
    </div>
    ` : ''}

    ${activity.length > 0 ? `
    <div class="dash-section">
      <div class="dash-section-header">
        <div class="dash-section-title">&#9889; Recent Activity</div>
      </div>
      <div class="activity-list" id="activityList"></div>
    </div>
    ` : ''}
  `;

  // Render recent row
  const recentRow = document.getElementById('recentRow');
  if (recentRow && recent.length > 0) {
    recent.forEach(item => {
      const parsed = parseTitle(item.name || item.filename || '');
      const state = (item.download_state || '').toLowerCase();
      const card = document.createElement('div');
      card.className = 'card';
      card.onclick = () => navigateTo('detail', { itemName: item.name || item.filename });
      card.innerHTML = `
        <div class="card-info">
          <div class="card-title" title="${escHtml(parsed.cleanName)}">${escHtml(parsed.cleanName)}</div>
          <div class="card-year">${parsed.year || ''}</div>
          <div class="card-rating"><span class="badge badge-${state}">${state}</span></div>
        </div>
      `;
      recentRow.appendChild(card);
    });
  }

  // Render activity list
  const activityList = document.getElementById('activityList');
  if (activityList && activity.length > 0) {
    activity.forEach(item => {
      const parsed = parseTitle(item.name || item.filename || '');
      const state = (item.download_state || '').toLowerCase();
      const stateIcon = state === 'completed' ? '&#9989;' : state === 'seeding' ? '&#128257;' : '&#128196;';
      const el = document.createElement('div');
      el.className = 'activity-item';
      el.innerHTML = `
        <div class="activity-icon">${stateIcon}</div>
        <div class="activity-info">
          <div class="activity-title">${escHtml(parsed.cleanName)}</div>
          <div class="activity-meta"><span class="badge badge-${state}">${state}</span> &middot; ${item.source === 'realdebrid' ? 'RD' : 'TorBox'}</div>
        </div>
        <div class="activity-time">${timeAgo(item.created_at)}</div>
      `;
      activityList.appendChild(el);
    });
  }

  // Update bottom nav active state
  updateBottomNav('dashboard');
}
