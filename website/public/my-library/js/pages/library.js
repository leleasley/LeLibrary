// ── Library View (Downloads) ────────────────────────────────

let libraryState = {
  currentTab: 'all',
  selectedIds: new Set(),
  viewMode: 'list',
  filteredItems: [],
  duplicateMode: false,
  duplicateGroups: {},
  sortBy: 'newest',
  sizeFilter: 'all',
  yearFilter: '',
  providerFilter: 'all',
};

// Selection identity must include the source: TorBox torrents, TorBox usenet
// and Real-Debrid all use their own independent numeric id sequences, so a
// raw id can refer to multiple different downloads.
function selKey(item) {
  return (item.source || 'tb') + '|' + item.id;
}

function renderLibraryView() {
  // Cleanup previous observer
  if (libraryState.scrollObserver) { libraryState.scrollObserver.disconnect(); libraryState.scrollObserver = null; }

  hideAllViews();
  const libraryView = document.getElementById('libraryView');
  libraryView.style.display = 'block';

  const items = App.allItems || [];
  libraryState.currentTab = 'all';
  libraryState.selectedIds.clear();
  // Pre-compute counts once
  let movieCount = 0, seriesCount = 0;
  for (const i of items) {
    if (isSeries(i.name || i.filename || '')) seriesCount++;
    else movieCount++;
  }
  const totalSize = items.reduce((s, i) => s + (i.size || 0), 0);

  const viewToggle = `
    <div class="view-toggle">
      <button class="${libraryState.viewMode === 'list' ? 'active' : ''}" onclick="setLibraryViewMode('list')" title="List view">${icon('list', 14)}</button>
      <button class="${libraryState.viewMode === 'card' ? 'active' : ''}" onclick="setLibraryViewMode('card')" title="Card view">${icon('grid', 14)}</button>
    </div>
  `;

  libraryView.innerHTML = `
    <div class="content-header">
      <div class="meta"><strong>${items.length}</strong> items &middot; <strong>${formatBytes(totalSize)}</strong></div>
      <div class="header-actions">
        ${viewToggle}
        <button class="btn btn-primary btn-sm" onclick="openAddTorrentModal()">${icon('plus', 14)} Add Torrent</button>
        <button class="btn btn-secondary btn-sm" id="btnFindDupes" onclick="toggleDuplicateMode()">${icon('search', 13)} Find Duplicates</button>
        <button class="btn btn-secondary btn-sm" onclick="selectAllToggle()">Select All</button>
        <button class="btn btn-danger btn-sm" id="btnDeleteSelected" style="display:none" onclick="deleteSelected()">Delete Selected</button>
        <button class="btn btn-secondary btn-sm" onclick="loadLibrary()">${icon('refresh', 13)} Refresh</button>
      </div>
    </div>

    <div class="tabs" id="libTabs">
      <button class="tab active" onclick="switchLibraryTab('all', this)">All <span class="count">${items.length}</span></button>
      <button class="tab" onclick="switchLibraryTab('movie', this)">Movies <span class="count">${movieCount}</span></button>
      <button class="tab" onclick="switchLibraryTab('series', this)">Series <span class="count">${seriesCount}</span></button>
    </div>

    <div class="batch-bar" id="batchBar">
      <span><span class="count" id="batchCount">0</span> selected</span>
      <button class="btn btn-danger btn-sm" onclick="deleteSelected()">Delete Selected</button>
      <button class="btn btn-secondary btn-sm" onclick="clearSelection()">Clear</button>
    </div>

    <div class="dupe-panel" id="duplicateBar" style="display:none">
      <div class="dupe-panel-header">
        <div class="dupe-stats">
          <div class="dupe-stat">
            <span class="dupe-stat-num" id="dupeGroupCount">0</span>
            <span class="dupe-stat-label">duplicate groups</span>
          </div>
          <div class="dupe-stat dupe-stat-warn">
            <span class="dupe-stat-num" id="dupeExtraCount">0</span>
            <span class="dupe-stat-label">extra copies</span>
          </div>
        </div>
        <div class="dupe-panel-actions">
          <button class="btn btn-danger btn-sm" onclick="deleteDuplicateExtras()">Delete Extra Copies</button>
          <button class="btn btn-secondary btn-sm" onclick="clearDuplicateMode()">Cancel</button>
        </div>
      </div>
      <div id="dupeGroupList" class="dupe-group-list"></div>
    </div>

    <div class="search-bar">
      <input type="text" id="libSearchInput" placeholder="Filter by title or filename..." oninput="handleLibrarySearch()" />
    </div>

    <div class="lib-toolbar">
      <select id="libSort" onchange="setLibrarySort(this.value)" title="Sort">
        <option value="newest">Newest</option>
        <option value="name">A\u2192Z Name</option>
        <option value="nameDesc">Z\u2192A Name</option>
        <option value="sizeDesc">Size \u2193</option>
        <option value="sizeAsc">Size \u2191</option>
      </select>
      <select id="libSizeFilter" onchange="setLibrarySizeFilter(this.value)" title="Size filter">
        <option value="all">All sizes</option>
        <option value="small">&lt; 2 GB</option>
        <option value="medium">2&#8211;10 GB</option>
        <option value="large">&gt; 10 GB</option>
      </select>
      <select id="libProviderFilter" onchange="setLibraryProviderFilter(this.value)" title="Provider filter">
        <option value="all">All providers</option>
        <option value="torbox">TorBox</option>
        <option value="realdebrid">Real-Debrid</option>
        <option value="alldebrid">AllDebrid</option>
        <option value="premiumize">Premiumize</option>
      </select>
      <input type="text" id="libYearFilter" placeholder="Year" inputmode="numeric" maxlength="4" oninput="setLibraryYearFilter(this.value)" />
      <button class="btn btn-secondary btn-sm" id="btnResetFilters" style="display:none" onclick="resetLibraryFilters()" title="Clear all filters">${icon('x', 12)} Reset</button>
    </div>

    <div class="list" id="libraryContent"></div>

    <div id="libStatus" style="text-align:center;padding:8px;font-size:11px;color:var(--muted);font-family:var(--mono)"></div>
  `;

  addBackBtn(libraryView);

  // Re-apply the persisted sort/filter values to the freshly-built controls so
  // the dropdowns don't visually disagree with the active sort/filter.
  const sortSel = document.getElementById('libSort');
  if (sortSel) sortSel.value = libraryState.sortBy;
  const sizeSel = document.getElementById('libSizeFilter');
  if (sizeSel) sizeSel.value = libraryState.sizeFilter;
  const yearInp = document.getElementById('libYearFilter');
  if (yearInp) yearInp.value = libraryState.yearFilter;
  const providerSel = document.getElementById('libProviderFilter');
  if (providerSel) providerSel.value = libraryState.providerFilter;

  libraryState.filteredItems = getFilteredLibraryItems();
  renderLibraryList();
  updateBottomNav('library');
}

function renderLibraryList() {
  const container = document.getElementById('libraryContent');
  const status = document.getElementById('libStatus');
  if (!container) return;

  const items = libraryState.filteredItems;
  container.innerHTML = '';
  container.className = libraryState.viewMode === 'card' ? 'browse-grid' : 'list';

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < items.length; i++) {
    fragment.appendChild(libraryState.viewMode === 'card' ? createLibraryCard(items[i], i) : createLibraryListItem(items[i], i));
  }
  container.appendChild(fragment);

  if (status) {
    status.textContent = items.length > 200
      ? `Showing ${items.length} items`
      : `${items.length} items`;
  }

  updateResetFiltersBtn();
}

function setLibraryViewMode(mode) {
  libraryState.viewMode = mode;
  libraryState.filteredItems = getFilteredLibraryItems();
  renderLibraryList();
}

function switchLibraryTab(tab, el) {
  libraryState.currentTab = tab;
  document.querySelectorAll('#libTabs .tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  libraryState.selectedIds.clear();
  updateBatchBar();
  document.getElementById('libSearchInput').value = '';
  libraryState.filteredItems = getFilteredLibraryItems();

  renderLibraryList();
}

function getFilteredLibraryItems() {
  let items = libraryState.currentTab === 'all' ? App.allItems
    : libraryState.currentTab === 'movie' ? App.allItems.filter(i => !isSeries(i.name || i.filename || ''))
    : App.allItems.filter(i => isSeries(i.name || i.filename || ''));

  const q = (document.getElementById('libSearchInput')?.value || '').trim().toLowerCase();
  if (q) {
    // Normalize punctuation so "Monsters University" matches "Monsters.University.2013..."
    const qNorm = q.replace(/[^a-z0-9]/g, '');
    items = items.filter(i => {
      const name = (i.name || i.filename || '').toLowerCase();
      return name.includes(q) || name.replace(/[^a-z0-9]/g, '').includes(qNorm);
    });
  }

  // Size filter
  const sizeF = libraryState.sizeFilter;
  if (sizeF === 'small') items = items.filter(i => (i.size || 0) < 2 * 1024 * 1024 * 1024);
  else if (sizeF === 'medium') items = items.filter(i => {
    const s = i.size || 0;
    return s >= 2 * 1024 * 1024 * 1024 && s <= 10 * 1024 * 1024 * 1024;
  });
  else if (sizeF === 'large') items = items.filter(i => (i.size || 0) > 10 * 1024 * 1024 * 1024);

  // Year filter
  if (libraryState.yearFilter) {
    const y = libraryState.yearFilter;
    items = items.filter(i => {
      const m = (i.name || i.filename || '').match(/[.\s\-\[\(](\d{4})[.\s\-\[\)]/);
      return m && m[1] === y;
    });
  }

  // Provider filter
  const pf = libraryState.providerFilter;
  if (pf !== 'all') items = items.filter(i => itemProviderGroup(i) === pf);

  // Sort
  const sorter = libraryState.sortBy;
  items = items.slice().sort((a, b) => {
    const nameA = (a.name || a.filename || '').toLowerCase();
    const nameB = (b.name || b.filename || '').toLowerCase();
    if (sorter === 'name') return nameA.localeCompare(nameB);
    if (sorter === 'nameDesc') return nameB.localeCompare(nameA);
    if (sorter === 'sizeDesc') return (b.size || 0) - (a.size || 0);
    if (sorter === 'sizeAsc') return (a.size || 0) - (b.size || 0);
    return (b.created_at || '').localeCompare(a.created_at || '');
  });

  return items;
}

function setLibrarySort(val) {
  libraryState.sortBy = val;
  libraryState.selectedIds.clear();
  updateBatchBar();
  libraryState.filteredItems = getFilteredLibraryItems();
  renderLibraryList();
}

function setLibrarySizeFilter(val) {
  libraryState.sizeFilter = val;
  libraryState.selectedIds.clear();
  updateBatchBar();
  libraryState.filteredItems = getFilteredLibraryItems();
  renderLibraryList();
}

function setLibraryYearFilter(val) {
  libraryState.yearFilter = (val || '').replace(/\D/g, '').slice(0, 4);
  libraryState.selectedIds.clear();
  updateBatchBar();
  libraryState.filteredItems = getFilteredLibraryItems();
  renderLibraryList();
}

function itemProviderGroup(item) {
  if (item.source === 'realdebrid') return 'realdebrid';
  if (item.source === 'alldebrid') return 'alldebrid';
  if (item.source === 'premiumize') return 'premiumize';
  return 'torbox'; // TorBox torrents + usenet
}

function setLibraryProviderFilter(val) {
  libraryState.providerFilter = val;
  libraryState.selectedIds.clear();
  updateBatchBar();
  libraryState.filteredItems = getFilteredLibraryItems();
  renderLibraryList();
}

function resetLibraryFilters() {
  libraryState.sizeFilter = 'all';
  libraryState.yearFilter = '';
  libraryState.providerFilter = 'all';
  const s = document.getElementById('libSizeFilter'); if (s) s.value = 'all';
  const y = document.getElementById('libYearFilter'); if (y) y.value = '';
  const p = document.getElementById('libProviderFilter'); if (p) p.value = 'all';
  const q = document.getElementById('libSearchInput'); if (q) q.value = '';
  libraryState.selectedIds.clear();
  updateBatchBar();
  libraryState.filteredItems = getFilteredLibraryItems();
  renderLibraryList();
}

function updateResetFiltersBtn() {
  const btn = document.getElementById('btnResetFilters');
  if (!btn) return;
  const active = libraryState.sizeFilter !== 'all' || !!libraryState.yearFilter
    || libraryState.providerFilter !== 'all'
    || !!(document.getElementById('libSearchInput')?.value || '');
  btn.style.display = active ? 'inline-block' : 'none';
}

function handleLibrarySearch() {
  libraryState.selectedIds.clear();
  updateBatchBar();
  libraryState.filteredItems = getFilteredLibraryItems();
  renderLibraryList();
}

function createLibraryListItem(item, idx) {
  const name = item.name || item.filename || 'Unknown';
  const parsed = parseTitle(name);
  const state = (item.download_state || '').toLowerCase();
  const stateLabel = state.charAt(0).toUpperCase() + state.slice(1);
  const size = item.size ? formatBytes(item.size) : '';
  const sourceLabel = providerLabel(item.source);
  const sourceClass = providerBadgeClass(item.source);
  const isSelected = libraryState.selectedIds.has(selKey(item));
  const isDupe = isDuplicateExtra(item);
  const dupeBadge = isDupe ? ' <span class="badge badge-dupe">DUPE</span>' : '';
  const payload = JSON.stringify(itemPayload(item)).replace(/'/g, "&#39;");

  const el = document.createElement('div');
  el.className = 'list-item' + (isSelected ? ' selected' : '');
  el.setAttribute('data-sel-key', selKey(item));

  el.innerHTML = `
    <div class="cb"><input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleLibrarySelect('${selKey(item)}', this.checked)" /></div>
    <div class="list-info">
      <div class="list-title" onclick='showItemPreview(${payload})' style="cursor:pointer">${escHtml(parsed.cleanName)}${parsed.year ? `<span class="year">(${escHtml(parsed.year)})</span>` : ''}${dupeBadge}</div>
      <div class="list-filename" title="${escHtml(name)}">${escHtml(name)}</div>
      <div class="list-meta">
        <span>${size}</span>
        <span class="sep">&middot;</span>
        <span class="badge badge-${sourceClass}">${sourceLabel}</span>
        <span class="sep">&middot;</span>
        <span class="badge badge-${state}">${stateLabel}</span>
      </div>
    </div>
    <button class="btn-view" onclick='showItemPreview(${payload})' title="Preview">${icon('eye', 14)}</button>
    <button class="btn-view" onclick='openItemActionsData(${payload})' title="View files & actions">${icon('folder', 14)}</button>
    <button class="btn-delete" onclick='deleteLibraryItem(${JSON.stringify(item).replace(/'/g, "&#39;")})' title="Delete">${icon('trash', 14)}</button>
  `;

  return el;
}

function createLibraryCard(item, idx) {
  const name = item.name || item.filename || 'Unknown';
  const parsed = parseTitle(name);
  const state = (item.download_state || '').toLowerCase();
  const stateLabel = state.charAt(0).toUpperCase() + state.slice(1);
  const size = item.size ? formatBytes(item.size) : '';
  const sourceLabel = providerLabel(item.source);
  const sourceClass = providerBadgeClass(item.source);
  const isSelected = libraryState.selectedIds.has(selKey(item));
  const isDupe = isDuplicateExtra(item);
  const payload = JSON.stringify(itemPayload(item)).replace(/'/g, "&#39;");

  const el = document.createElement('div');
  el.className = 'card' + (isSelected ? ' selected' : '');
  el.setAttribute('data-sel-key', selKey(item));
  el.style.cursor = 'pointer';

  el.innerHTML = `
    <div class="cb lib-card-cb"><input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleLibrarySelect('${selKey(item)}', this.checked)" title="Select" /></div>
    ${isDupe ? '<div class="card-badge" style="background:var(--error)">DUPE</div>' : ''}
    <div class="card-info">
      <div class="card-title" title="${escHtml(name)}">${escHtml(parsed.cleanName)}${parsed.year ? ` <span style="color:var(--muted);font-weight:400">(${escHtml(parsed.year)})</span>` : ''}</div>
      <div class="list-filename" title="${escHtml(name)}">${escHtml(name)}</div>
      <div class="list-meta">
        ${size ? `<span>${size}</span>` : ''}
        <span class="sep">&middot;</span>
        <span class="badge badge-${sourceClass}">${sourceLabel}</span>
        <span class="badge badge-${state}">${stateLabel}</span>
      </div>
    </div>
    <div class="torrent-card-actions" style="padding:8px">
      <button class="btn-action btn-info" onclick='showItemPreview(${payload})' title="Preview">${icon('eye', 10)} Preview</button>
      <button class="btn-action btn-info" onclick='openItemActionsData(${payload})' title="View files & actions">${icon('folder', 10)} Files</button>
      <button class="btn-action btn-report" onclick='deleteLibraryItem(${JSON.stringify(item).replace(/'/g, "&#39;")})' title="Delete" aria-label="Delete: ${escHtml(parsed.cleanName)}">${icon('trash', 10)} Delete</button>
    </div>
  `;
  el.onclick = (e) => {
    if (e.target.closest('button') || e.target.closest('input')) return;
    toggleLibrarySelect(selKey(item), !isSelected);
  };
  return el;
}

function toggleLibrarySelect(key, checked) {
  if (checked) libraryState.selectedIds.add(key); else libraryState.selectedIds.delete(key);
  // Update all visible items
  document.querySelectorAll('#libraryContent [data-sel-key]').forEach(el => {
    if (el.getAttribute('data-sel-key') === key) {
      el.classList.toggle('selected', checked);
      const cb = el.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = checked;
    }
  });
  updateBatchBar();
}

function selectAllToggle() {
  const filtered = libraryState.filteredItems;
  const allSelected = filtered.length > 0 && filtered.every(i => libraryState.selectedIds.has(selKey(i)));
  if (allSelected) {
    filtered.forEach(i => libraryState.selectedIds.delete(selKey(i)));
  } else {
    filtered.forEach(i => libraryState.selectedIds.add(selKey(i)));
  }
  // Update visible checkboxes
  document.querySelectorAll('#libraryContent [data-sel-key]').forEach(el => {
    const key = el.getAttribute('data-sel-key');
    const cb = el.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = libraryState.selectedIds.has(key);
    el.classList.toggle('selected', libraryState.selectedIds.has(key));
  });
  updateBatchBar();
}

function clearSelection() {
  libraryState.selectedIds.clear();
  document.querySelectorAll('#libraryContent [data-sel-key]').forEach(el => {
    el.classList.remove('selected');
    const cb = el.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = false;
  });
  updateBatchBar();
}

function updateBatchBar() {
  const bar = document.getElementById('batchBar');
  const count = libraryState.selectedIds.size;
  const batchCount = document.getElementById('batchCount');
  const btnDelete = document.getElementById('btnDeleteSelected');
  if (batchCount) batchCount.textContent = count;
  if (bar) bar.classList.toggle('show', count > 0);
  if (btnDelete) btnDelete.style.display = count > 0 ? 'inline-block' : 'none';
}

async function deleteLibraryItem(item) {
  const tbKey = App.keys.torboxKey;
  const rdKey = App.keys.rdKey;
  const adKey = App.keys.adKey;
  const pmKey = App.keys.pmKey;
  const name = item.name || item.filename || 'Unknown';
  const provider = { realdebrid: 'Real-Debrid', alldebrid: 'AllDebrid', premiumize: 'Premiumize', usenet: 'TorBox Usenet', torrent: 'TorBox' }[item.source] || 'TorBox';
  if (!confirm(`Delete "${name}" from ${provider}?`)) return;

  try {
    if (item.source === 'realdebrid') {
      await rdDelete('/torrents/delete/' + item.id, rdKey);
    } else if (item.source === 'alldebrid') {
      await adDelete('/v4/magnet/delete/' + item.id, adKey);
    } else if (item.source === 'premiumize') {
      await pmDelete('/item/' + item.id, pmKey);
    } else {
      const path = item.source === 'torrent' ? '/torrents/' + item.id : '/usenet/' + item.id;
      await torboxDelete(path, tbKey);
    }
    App.allItems = App.allItems.filter(i => !(i.source === item.source && String(i.id) === String(item.id)));
    libraryState.selectedIds.delete(selKey(item));
    libraryState.filteredItems = getFilteredLibraryItems();
    buildLibraryIndex();
    renderLibraryList();
    showToast('Deleted "' + name + '"');
  } catch (err) {
    showError('Delete failed: ' + err.message);
  }
}

async function deleteSelected(skipConfirm) {
  if (libraryState.selectedIds.size === 0) return;
  if (!skipConfirm && !confirm(`Delete ${libraryState.selectedIds.size} item(s)?`)) return;

  const tbKey = App.keys.torboxKey;
  const rdKey = App.keys.rdKey;
  const adKey = App.keys.adKey;
  const pmKey = App.keys.pmKey;
  let deleted = 0;
  for (const key of libraryState.selectedIds) {
    const item = App.allItems.find(i => selKey(i) === key);
    if (!item) continue;
    try {
      if (item.source === 'realdebrid') {
        await rdDelete('/torrents/delete/' + item.id, rdKey);
      } else if (item.source === 'alldebrid') {
        await adDelete('/v4/magnet/delete/' + item.id, adKey);
      } else if (item.source === 'premiumize') {
        await pmDelete('/item/' + item.id, pmKey);
      } else {
        const path = item.source === 'torrent' ? '/torrents/' + item.id : '/usenet/' + item.id;
        await torboxDelete(path, tbKey);
      }
      deleted++;
    } catch (err) {
      showError('Delete failed for item ' + item.id + ': ' + err.message);
    }
  }
  App.allItems = App.allItems.filter(i => !libraryState.selectedIds.has(selKey(i)));
  libraryState.selectedIds.clear();
  libraryState.filteredItems = getFilteredLibraryItems();
  buildLibraryIndex();
  updateBatchBar();
  renderLibraryList();
  showToast('Deleted ' + deleted + ' item(s)');
}

// ── Duplicate Detection ──────────────────────────────────────

function toggleDuplicateMode() {
  if (libraryState.duplicateMode) {
    clearDuplicateMode();
    return;
  }
  findDuplicates();
}

function findDuplicates() {
  const items = libraryState.filteredItems;
  const parsed = [];

  for (const item of items) {
    const info = guessMediaInfo(item.name || item.filename || '');
    if (!info) continue;
    const norm = info.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    parsed.push({ item, info, norm });
  }

  // Phase 1: group by normalized-title + year (+ season/episode for series)
  const prelimMap = new Map();
  for (const p of parsed) {
    let key;
    if (p.info.isSeries) {
      if (p.info.season && p.info.episode) key = `s|${p.norm}|${p.info.year || ''}|s${p.info.season}e${p.info.episode}`;
      else if (p.info.season) key = `s|${p.norm}|${p.info.year || ''}|s${p.info.season}`;
      else key = `s|${p.norm}|${p.info.year || ''}|full`;
    } else {
      key = `m|${p.norm}|${p.info.year || ''}`;
    }
    if (!prelimMap.has(key)) {
      prelimMap.set(key, {
        norm: p.norm, year: p.info.year || '',
        season: p.info.season, episode: p.info.episode,
        type: p.info.isSeries ? 'series' : 'movie',
        title: p.info.title, items: [],
      });
    }
    prelimMap.get(key).items.push(p.item);
  }

  // Phase 2: merge groups where one title is a substring of another (same
  // year, same season+episode for series).  "Die Another Day" merges into
  // "James Bond Die Another Day" because norm "dieanotherday" is inside
  // "jamesbonddieanotherday".
  const merged = [];
  for (const [, group] of prelimMap) {
    let wasMerged = false;
    for (const mg of merged) {
      if (mg.year !== group.year) continue;
      if (group.type === 'series' && (mg.season !== group.season || mg.episode !== group.episode)) continue;
      if (mg.norm.includes(group.norm) || group.norm.includes(mg.norm)) {
        mg.items.push(...group.items);
        if (group.title.length > mg.title.length) mg.title = group.title;
        wasMerged = true;
        break;
      }
    }
    if (!wasMerged) merged.push({ ...group });
  }

  // Build result
  const dupeGroups = {};
  let totalExtras = 0;
  for (let i = 0; i < merged.length; i++) {
    const g = merged[i];
    if (g.items.length < 2) continue;
    g.items.sort((a, b) => (b.size || 0) - (a.size || 0));
    dupeGroups[i] = { title: g.title, year: g.year, type: g.type, season: g.season, episode: g.episode, items: g.items, keepSize: g.items[0].size || 0 };
    totalExtras += g.items.length - 1;
  }

  if (Object.keys(dupeGroups).length === 0) {
    showToast('No duplicates found!', 'success');
    return;
  }

  libraryState.duplicateMode = true;
  libraryState.duplicateGroups = dupeGroups;
  libraryState.selectedIds.clear();
  for (const g of Object.values(dupeGroups)) {
    for (let i = 1; i < g.items.length; i++) {
      libraryState.selectedIds.add(selKey(g.items[i]));
    }
  }

  const bar = document.getElementById('duplicateBar');
  const groupCountEl = document.getElementById('dupeGroupCount');
  const extraCountEl = document.getElementById('dupeExtraCount');
  if (bar) bar.style.display = 'block';
  if (groupCountEl) groupCountEl.textContent = Object.keys(dupeGroups).length;
  if (extraCountEl) extraCountEl.textContent = totalExtras;
  const list = document.getElementById('dupeGroupList');
  if (list) {
    list.innerHTML = Object.values(dupeGroups).map(g => `
      <div class="dupe-group">
        <div class="dupe-group-info">
          <span class="dupe-group-title">${escHtml(g.title)}${g.year ? ` <span class="dupe-group-year">(${escHtml(g.year)})</span>` : ''}</span>
          ${g.type === 'series' ? `<span class="badge badge-series">${g.season && g.episode ? `S${g.season}E${g.episode}` : g.season ? `Season ${g.season}` : 'Series'}</span>` : ''}
        </div>
        <div class="dupe-group-meta">
          <span class="dupe-group-copies">${g.items.length} copies</span>
          <span class="dupe-group-keep">${formatBytes(g.keepSize)} kept</span>
        </div>
      </div>`).join('');
  }
  const btnDupes = document.getElementById('btnFindDupes');
  if (btnDupes) { btnDupes.innerHTML = `${icon('x', 13)} Clear`; btnDupes.classList.add('active-dupe'); }

  renderLibraryList();
  updateBatchBar();
}

function clearDuplicateMode() {
  libraryState.duplicateMode = false;
  libraryState.duplicateGroups = {};
  libraryState.selectedIds.clear();
  const bar = document.getElementById('duplicateBar');
  const list = document.getElementById('dupeGroupList');
  const btnDupes = document.getElementById('btnFindDupes');
  if (bar) bar.style.display = 'none';
  if (list) list.innerHTML = '';
  if (btnDupes) { btnDupes.innerHTML = `${icon('search', 13)} Find Duplicates`; btnDupes.classList.remove('active-dupe'); }
  libraryState.filteredItems = getFilteredLibraryItems();
  renderLibraryList();
  updateBatchBar();
}

function isDuplicateExtra(item) {
  if (!libraryState.duplicateMode) return false;
  return libraryState.selectedIds.has(selKey(item));
}

function deleteDuplicateExtras() {
  if (libraryState.selectedIds.size === 0) return;
  const count = libraryState.selectedIds.size;
  if (!confirm(`Delete ${count} duplicate extra copies? (Keeping the largest file in each group)`)) return;
  deleteSelected(true).then(() => {
    clearDuplicateMode();
  });
}
