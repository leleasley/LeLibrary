// ── Library View (Downloads) ────────────────────────────────

let libraryState = {
  currentTab: 'all',
  selectedIds: new Set(),
  viewMode: 'list',
  filteredItems: [],
  duplicateMode: false,
  duplicateGroups: {},
};

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
      <button class="${libraryState.viewMode === 'list' ? 'active' : ''}" onclick="setLibraryViewMode('list')" title="List view">&#9776;</button>
      <button class="${libraryState.viewMode === 'card' ? 'active' : ''}" onclick="setLibraryViewMode('card')" title="Card view">&#9638;</button>
    </div>
  `;

  libraryView.innerHTML = `
    <div class="content-header">
      <div class="meta"><strong>${items.length}</strong> items &middot; <strong>${formatBytes(totalSize)}</strong></div>
      <div class="header-actions">
        ${viewToggle}
        <button class="btn btn-secondary btn-sm" id="btnFindDupes" onclick="toggleDuplicateMode()">&#128269; Find Duplicates</button>
        <button class="btn btn-secondary btn-sm" onclick="selectAllToggle()">Select All</button>
        <button class="btn btn-danger btn-sm" id="btnDeleteSelected" style="display:none" onclick="deleteSelected()">Delete Selected</button>
        <button class="btn btn-primary btn-sm" onclick="loadLibrary()">Refresh</button>
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

    <div class="duplicate-bar" id="duplicateBar" style="display:none">
      <span id="dupeSummary" style="font-size:12px"></span>
      <button class="btn btn-danger btn-sm" onclick="deleteDuplicateExtras()">Delete Extra Copies</button>
      <button class="btn btn-secondary btn-sm" onclick="clearDuplicateMode()">Cancel</button>
    </div>

    <div class="search-bar">
      <input type="text" id="libSearchInput" placeholder="Filter by title or filename..." oninput="handleLibrarySearch()" />
    </div>

    <div class="list" id="libraryContent"></div>

    <div id="libStatus" style="text-align:center;padding:8px;font-size:11px;color:var(--muted);font-family:var(--mono)"></div>
  `;

  addBackBtn(libraryView);

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

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < items.length; i++) {
    fragment.appendChild(createLibraryListItem(items[i], i));
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

  // Reset scroll
  const container = document.getElementById('libScrollContainer');
  renderLibraryList();
}

function getFilteredLibraryItems() {
  let items = libraryState.currentTab === 'all' ? App.allItems
    : libraryState.currentTab === 'movie' ? App.allItems.filter(i => !isSeries(i.name || i.filename || ''))
    : App.allItems.filter(i => isSeries(i.name || i.filename || ''));

  const q = (document.getElementById('libSearchInput')?.value || '').trim().toLowerCase();
  if (q) {
    items = items.filter(i => {
      const name = (i.name || i.filename || '').toLowerCase();
      return name.includes(q);
    });
  }
  return items;
}

function handleLibrarySearch() {
  libraryState.selectedIds.clear();
  updateBatchBar();
  libraryState.filteredItems = getFilteredLibraryItems();
  const container = document.getElementById('libScrollContainer');
  renderLibraryList();
}

function createLibraryListItem(item, idx) {
  const name = item.name || item.filename || 'Unknown';
  const parsed = parseTitle(name);
  const state = (item.download_state || '').toLowerCase();
  const stateLabel = state.charAt(0).toUpperCase() + state.slice(1);
  const size = item.size ? formatBytes(item.size) : '';
  let sourceLabel, sourceClass;
  if (item.source === 'realdebrid') { sourceLabel = 'RD'; sourceClass = 'rd'; }
  else if (item.source === 'usenet') { sourceLabel = 'Usenet'; sourceClass = 'usenet'; }
  else { sourceLabel = 'Torrent'; sourceClass = 'torrent'; }
  const isSelected = libraryState.selectedIds.has(item.id);
  const isDupe = isDuplicateExtra(item);
  const dupeBadge = isDupe ? ' <span class="badge badge-dupe">DUPE</span>' : '';

  const el = document.createElement('div');
  el.className = 'list-item' + (isSelected ? ' selected' : '');
  el.setAttribute('data-item-id', item.id);

  el.innerHTML = `
    <div class="cb"><input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleLibrarySelect(${item.id}, this.checked)" /></div>
    <div class="list-info">
      <div class="list-title">${escHtml(parsed.cleanName)}${parsed.year ? `<span class="year">(${escHtml(parsed.year)})</span>` : ''}${dupeBadge}</div>
      <div class="list-filename" title="${escHtml(name)}">${escHtml(name)}</div>
      <div class="list-meta">
        <span>${size}</span>
        <span class="sep">&middot;</span>
        <span class="badge badge-${sourceClass}">${sourceLabel}</span>
        <span class="sep">&middot;</span>
        <span class="badge badge-${state}">${stateLabel}</span>
      </div>
    </div>
    <button class="btn-delete" onclick='deleteLibraryItem(${JSON.stringify(item).replace(/'/g, "&#39;")})' title="Delete">&#128465;&#65039;</button>
  `;

  return el;
}

function toggleLibrarySelect(id, checked) {
  if (checked) libraryState.selectedIds.add(id); else libraryState.selectedIds.delete(id);
  // Update all visible items
  document.querySelectorAll('#libraryContent .list-item').forEach(el => {
    const itemId = parseInt(el.getAttribute('data-item-id'));
    if (itemId === id) {
      el.classList.toggle('selected', checked);
      const cb = el.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = checked;
    }
  });
  updateBatchBar();
}

function selectAllToggle() {
  const filtered = libraryState.filteredItems;
  const allSelected = filtered.length > 0 && filtered.every(i => libraryState.selectedIds.has(i.id));
  if (allSelected) {
    filtered.forEach(i => libraryState.selectedIds.delete(i.id));
  } else {
    filtered.forEach(i => libraryState.selectedIds.add(i.id));
  }
  // Update visible checkboxes
  document.querySelectorAll('#libraryContent .list-item').forEach(el => {
    const id = parseInt(el.getAttribute('data-item-id'));
    const cb = el.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = libraryState.selectedIds.has(id);
    el.classList.toggle('selected', libraryState.selectedIds.has(id));
  });
  updateBatchBar();
}

function clearSelection() {
  libraryState.selectedIds.clear();
  document.querySelectorAll('#libraryContent .list-item').forEach(el => {
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
  const name = item.name || item.filename || 'Unknown';
  const provider = item.source === 'realdebrid' ? 'Real-Debrid' : 'TorBox';
  if (!confirm(`Delete "${name}" from ${provider}?`)) return;

  try {
    if (item.source === 'realdebrid') {
      await rdDelete('/torrents/delete/' + item.id, rdKey);
    } else {
      const path = item.source === 'torrent' ? '/torrents/' + item.id : '/usenet/' + item.id;
      await torboxDelete(path, tbKey);
    }
    App.allItems = App.allItems.filter(i => i.id !== item.id);
    libraryState.selectedIds.delete(item.id);
    libraryState.filteredItems = getFilteredLibraryItems();
    const container = document.getElementById('libScrollContainer');
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
  let deleted = 0;
  for (const id of libraryState.selectedIds) {
    const item = App.allItems.find(i => i.id === id);
    if (!item) continue;
    try {
      if (item.source === 'realdebrid') {
        await rdDelete('/torrents/delete/' + id, rdKey);
      } else {
        const path = item.source === 'torrent' ? '/torrents/' + id : '/usenet/' + id;
        await torboxDelete(path, tbKey);
      }
      deleted++;
    } catch (err) {
      showError('Delete failed for item ' + id + ': ' + err.message);
    }
  }
  App.allItems = App.allItems.filter(i => !libraryState.selectedIds.has(i.id));
  libraryState.selectedIds.clear();
  libraryState.filteredItems = getFilteredLibraryItems();
  const container = document.getElementById('libScrollContainer');
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
      libraryState.selectedIds.add(sorted[i].id);
    }
  }

  // Update UI
  const bar = document.getElementById('duplicateBar');
  const summary = document.getElementById('dupeSummary');
  const btnDupes = document.getElementById('btnFindDupes');
  if (bar) bar.style.display = 'flex';
  if (summary) summary.innerHTML = `<strong style="color:var(--warning)">${Object.keys(dupeGroups).length}</strong> duplicate groups &middot; <strong style="color:var(--error)">${dupeCount}</strong> extra copies selected`;
  if (btnDupes) { btnDupes.innerHTML = '&#10005; Clear'; btnDupes.classList.add('active-dupe'); }

  // Re-render with highlights
  libraryState.filteredItems = getFilteredLibraryItems();
  const container = document.getElementById('libScrollContainer');
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
  if (btnDupes) { btnDupes.innerHTML = '&#128269; Find Duplicates'; btnDupes.classList.remove('active-dupe'); }
  libraryState.filteredItems = getFilteredLibraryItems();
  const container = document.getElementById('libScrollContainer');
  renderLibraryList();
  updateBatchBar();
}

function isDuplicateExtra(item) {
  if (!libraryState.duplicateMode) return false;
  return libraryState.selectedIds.has(item.id);
}

function deleteDuplicateExtras() {
  if (libraryState.selectedIds.size === 0) return;
  const count = libraryState.selectedIds.size;
  if (!confirm(`Delete ${count} duplicate extra copies? (Keeping the largest file in each group)`)) return;
  deleteSelected(true).then(() => {
    clearDuplicateMode();
  });
}
