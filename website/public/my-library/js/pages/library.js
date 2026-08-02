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
      <button class="btn btn-secondary btn-sm" onclick="markSelectedWatched()">${icon('check', 13)} Mark Watched</button>
      <button class="btn btn-danger btn-sm" onclick="deleteSelected()">Delete Selected</button>
      <button class="btn btn-secondary btn-sm" onclick="clearSelection()">Clear</button>
    </div>

    <div class="duplicate-bar" id="duplicateBar" style="display:none">
      <span id="dupeSummary" style="font-size:12px"></span>
      <button class="btn btn-danger btn-sm" onclick="deleteDuplicateExtras()">Delete Extra Copies</button>
      <button class="btn btn-secondary btn-sm" onclick="clearDuplicateMode()">Cancel</button>
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
      <input type="text" id="libYearFilter" placeholder="Year" inputmode="numeric" maxlength="4" oninput="setLibraryYearFilter(this.value)" />
      <button class="btn btn-secondary btn-sm" onclick="markSelectedWatched()" title="Mark selected as watched">${icon('check', 13)} Watched</button>
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

function markSelectedWatched() {
  if (libraryState.selectedIds.size === 0) return;
  const items = App.allItems.filter(i => libraryState.selectedIds.has(selKey(i)));
  markManyWatched(items);
  libraryState.selectedIds.clear();
  updateBatchBar();
  renderLibraryList();
  showToast('Marked ' + items.length + ' as watched');
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
  const watched = isWatched(item);
  const watchedBadge = watched ? ` <span class="badge badge-watched" title="Watched">${icon('check', 10)}</span>` : '';
  const payload = JSON.stringify(itemPayload(item)).replace(/'/g, "&#39;");

  const el = document.createElement('div');
  el.className = 'list-item' + (isSelected ? ' selected' : '') + (watched ? ' watched' : '');
  el.setAttribute('data-sel-key', selKey(item));

  el.innerHTML = `
    <div class="cb"><input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleLibrarySelect('${selKey(item)}', this.checked)" /></div>
    <div class="list-info">
      <div class="list-title" onclick='showItemPreview(${payload})' style="cursor:pointer">${escHtml(parsed.cleanName)}${parsed.year ? `<span class="year">(${escHtml(parsed.year)})</span>` : ''}${dupeBadge}${watchedBadge}</div>
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
    <button class="btn-watch" onclick="toggleWatchedItem('${selKey(item)}')" title="${watched ? 'Mark as not watched' : 'Mark as watched'}">${watched ? icon('x', 14) : icon('check', 14)}</button>
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
  const watched = isWatched(item);
  const payload = JSON.stringify(itemPayload(item)).replace(/'/g, "&#39;");

  const el = document.createElement('div');
  el.className = 'card' + (isSelected ? ' selected' : '') + (watched ? ' watched' : '');
  el.setAttribute('data-sel-key', selKey(item));
  el.style.cursor = 'pointer';

  el.innerHTML = `
    <div class="cb lib-card-cb"><input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleLibrarySelect('${selKey(item)}', this.checked)" title="Select" /></div>
    ${isDupe ? '<div class="card-badge" style="background:var(--error)">DUPE</div>' : ''}
    ${watched ? '<div class="card-badge" style="right:38px;background:var(--success)">✓</div>' : ''}
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
      <button class="btn-action btn-download" onclick="toggleWatchedItem('${selKey(item)}')" title="${watched ? 'Mark as not watched' : 'Mark as watched'}" aria-label="${watched ? 'Mark as not watched' : 'Mark as watched'}: ${escHtml(parsed.cleanName)}">${watched ? icon('x', 10) + ' Unwatch' : icon('check', 10) + ' Watched'}</button>
      <button class="btn-action btn-report" onclick='deleteLibraryItem(${JSON.stringify(item).replace(/'/g, "&#39;")})' title="Delete" aria-label="Delete: ${escHtml(parsed.cleanName)}">${icon('trash', 10)} Delete</button>
    </div>
  `;
  el.onclick = (e) => {
    if (e.target.closest('button') || e.target.closest('input')) return;
    toggleLibrarySelect(selKey(item), !isSelected);
  };
  return el;
}

function toggleWatchedItem(key) {
  const item = App.allItems.find(i => selKey(i) === key);
  if (!item) return;
  toggleWatched(item);
  renderLibraryList();
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
      await pmDelete('/transfer/delete/' + item.id, pmKey);
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
        await pmDelete('/transfer/delete/' + item.id, pmKey);
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
  const groups = {};

  // Group items by duplicate key
  for (const item of items) {
    const key = getDuplicateKey(item);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  // Only keep groups with 2+ items
  const dupeGroups = {};
  let dupeCount = 0;
  for (const [key, group] of Object.entries(groups)) {
    if (group.length >= 2) {
      dupeGroups[key] = group;
      dupeCount += group.length - 1; // extras (keep 1, delete rest)
    }
  }

  if (Object.keys(dupeGroups).length === 0) {
    showToast('No duplicates found!', 'success');
    return;
  }

  libraryState.duplicateMode = true;
  libraryState.duplicateGroups = dupeGroups;

  // Collect all duplicate item IDs — select extras for deletion
  libraryState.selectedIds.clear();
  for (const group of Object.values(dupeGroups)) {
    const sorted = group.slice().sort((a, b) => (b.size || 0) - (a.size || 0));
    for (let i = 1; i < sorted.length; i++) {
      libraryState.selectedIds.add(selKey(sorted[i]));
    }
  }

  // Update UI
  const bar = document.getElementById('duplicateBar');
  const summary = document.getElementById('dupeSummary');
  const btnDupes = document.getElementById('btnFindDupes');
  if (bar) bar.style.display = 'flex';
  if (summary) summary.innerHTML = `<strong style="color:var(--warning)">${Object.keys(dupeGroups).length}</strong> duplicate groups &middot; <strong style="color:var(--error)">${dupeCount}</strong> extra copies selected`;
  if (btnDupes) { btnDupes.innerHTML = `${icon('x', 13)} Clear`; btnDupes.classList.add('active-dupe'); }

  // Re-render with highlights
  libraryState.filteredItems = getFilteredLibraryItems();
  renderLibraryList();
  updateBatchBar();
}

function clearDuplicateMode() {
  libraryState.duplicateMode = false;
  libraryState.duplicateGroups = {};
  libraryState.selectedIds.clear();
  const bar = document.getElementById('duplicateBar');
  const btnDupes = document.getElementById('btnFindDupes');
  if (bar) bar.style.display = 'none';
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
