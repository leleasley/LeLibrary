// ── Recent View ───────────────────────────────────────────────

function renderRecentView() {
  hideAllViews();
  const recentView = document.getElementById('recentView');
  recentView.style.display = 'block';

  const items = (App.allItems || [])
    .slice()
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 20);

  recentView.innerHTML = `
    <div class="browse-header"><h2>${icon('calendar', 18)} Recently Added</h2><span class="count">Last ${items.length} items</span></div>
    <div id="recentContent"></div>
  `;

  addBackBtn(recentView);

  const container = document.getElementById('recentContent');

  if (items.length === 0) {
    container.innerHTML = `<div class="empty"><div class="icon">${icon('calendar', 32)}</div><h3>No recent items</h3><p>Items you add will appear here.</p></div>`;
    return;
  }

  items.forEach(item => {
    const name = item.name || item.filename || 'Unknown';
    const parsed = parseTitle(name);
    const state = (item.download_state || '').toLowerCase();
    const size = item.size ? formatBytes(item.size) : '';
    let sourceLabel, sourceClass;
    if (item.source === 'realdebrid') { sourceLabel = 'RD'; sourceClass = 'rd'; }
    else if (item.source === 'usenet') { sourceLabel = 'Usenet'; sourceClass = 'usenet'; }
    else { sourceLabel = 'Torrent'; sourceClass = 'torrent'; }

    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <div class="list-info">
        <div class="list-title">${escHtml(parsed.cleanName)}${parsed.year ? `<span class="year">(${escHtml(parsed.year)})</span>` : ''}</div>
        <div class="list-filename" title="${escHtml(name)}">${escHtml(name)}</div>
        <div class="list-meta">
          <span>${size}</span>
          <span class="sep">&middot;</span>
          <span class="badge badge-${sourceClass}">${sourceLabel}</span>
          <span class="sep">&middot;</span>
          <span class="badge badge-${state}">${state}</span>
        </div>
      </div>
      <div class="activity-time">${timeAgo(item.created_at)}</div>
    `;
    container.appendChild(el);
  });

  updateBottomNav('recent');
}
