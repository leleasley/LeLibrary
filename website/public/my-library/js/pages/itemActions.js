// ── Item Actions (view files / download / zip / airlock / edit / magnet) ──

let _itemModalItem = null;
let _previewItem = null;

function providerLogo(src) {
  return src === 'realdebrid' ? '/provider-logos/realdebrid.svg'
    : src === 'alldebrid' ? '/provider-logos/alldebrid.png'
    : src === 'premiumize' ? '/provider-logos/premiumize.svg'
    : '/provider-logos/torbox.png';
}
function isTorBoxItem(item) { return item.source === 'torrent' || item.source === 'usenet'; }

// Minimal serializable payload (avoids stuffing the full files array into an
// onclick attribute).
function itemPayload(item) {
  return {
    id: item.id, name: item.name, filename: item.filename, size: item.size,
    source: item.source, download_state: item.download_state,
    hash: item.hash, magnet: item.magnet,
    airlocked: item.airlocked, tags: item.tags, alternative_hashes: item.alternative_hashes,
    _rdHash: item._rdHash, _adHash: item._adHash,
  };
}
function openItemActionsData(data) { openItemActions(data); }

// ── Bottom preview bar (TorBox-style) ──────────────────────────
function showItemPreview(item) {
  _previewItem = item;
  const bar = document.getElementById('itemPreviewBar');
  if (!bar) return;
  const tb = isTorBoxItem(item);
  bar.innerHTML = `
    <img class="provider-logo" src="${providerLogo(item.source)}" alt="" />
    <div class="item-preview-info">
      <div class="item-preview-name">${escHtml(item.name || item.filename || 'Unknown')}</div>
      <div class="item-preview-meta">${providerLabel(item.source)}${item.size ? ' · ' + formatBytes(item.size) : ''}${tb ? ' · ' + (item.airlocked ? 'Airlocked' : 'Not airlocked') : ''}</div>
    </div>
    <button class="btn-action btn-download" onclick="previewDownload()" title="Download">${icon('download', 13)} Download</button>
    <button class="btn-action btn-info" onclick="openItemActions(_previewItem)" title="View files & more">${icon('folder', 13)} View files</button>
    <button class="btn-action btn-close" onclick="closeItemPreview()" title="Close">${icon('x', 13)}</button>
  `;
  bar.classList.add('show');
}

function closeItemPreview() {
  _previewItem = null;
  document.getElementById('itemPreviewBar')?.classList.remove('show');
}

async function previewDownload() {
  if (!_previewItem) return;
  try { await downloadItem(_previewItem); showToast('Download started'); }
  catch (err) { showToast(friendlyError(err, 'Download failed'), 'error'); }
}

// ── Item modal ─────────────────────────────────────────────────
function openItemActions(item) {
  _itemModalItem = item;
  renderItemModal(item);
}

function closeItemModal() {
  document.getElementById('itemModal')?.remove();
  document.body.style.overflow = '';
  _itemModalItem = null;
}

function renderItemModal(item) {
  document.getElementById('itemModal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'itemModal';
  overlay.className = 'wn-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) closeItemModal(); };

  const tb = isTorBoxItem(item);
  const magnetShort = itemMagnetShort(item);
  const magnetFull = itemMagnetFull(item);
  const state = (item.download_state || '').toLowerCase();

  overlay.innerHTML = `
    <div class="wn-box item-modal">
      <div class="wn-header">
        <h3>${escHtml(item.name || item.filename || 'Item')}</h3>
        <button class="wn-close" onclick="closeItemModal()" aria-label="Close">&times;</button>
      </div>
      <div class="item-modal-meta">
        <span class="badge badge-${providerBadgeClass(item.source)}">${providerLabel(item.source)}</span>
        ${item.size ? `<span>${formatBytes(item.size)}</span>` : ''}
        <span class="badge badge-${state}">${state || 'unknown'}</span>
        ${tb ? `<span class="airlock-chip" id="airlockChip">${item.airlocked ? 'Airlocked' : 'Not airlocked'}</span>` : ''}
      </div>

      <div class="item-modal-actions">
        <button class="btn btn-primary btn-sm" onclick="itemAction('download')">${icon('download', 12)} Download</button>
        ${tb ? `<button class="btn btn-secondary btn-sm" onclick="itemAction('zip')">${icon('box', 12)} Download as Zip</button>` : ''}
        ${magnetShort ? `<button class="btn btn-secondary btn-sm" onclick="itemAction('copyShort')">${icon('link', 12)} Copy magnet (short)</button>` : ''}
        ${magnetFull && magnetFull !== magnetShort ? `<button class="btn btn-secondary btn-sm" onclick="itemAction('copyFull')">${icon('link', 12)} Copy magnet (full)</button>` : ''}
        ${magnetShort ? `<button class="btn btn-secondary btn-sm" onclick="itemAction('export')">${icon('download', 12)} Export .magnet</button>` : ''}
        ${tb ? `<button class="btn btn-secondary btn-sm" id="btnAirlock" onclick="itemAction('airlock')">${item.airlocked ? 'Un-airlock' : 'Airlock'}</button>` : ''}
      </div>

      <div class="item-modal-files">
        <div class="item-modal-section-title">${icon('folder', 13)} View files</div>
        <div id="itemFiles"><div class="loading-area"><div class="spinner"></div><p>Loading files...</p></div></div>
      </div>

      ${tb ? `
      <div class="item-modal-edit">
        <div class="item-modal-section-title">${icon('settings', 13)} Edit</div>
        <div class="item-edit-row"><label>Name</label><input type="text" id="editName" value="${escHtml(item.name || '')}" /></div>
        <div class="item-edit-row"><label>Tags</label><input type="text" id="editTags" value="${escHtml((item.tags || []).join(', '))}" placeholder="tag1, tag2" /></div>
        <div class="item-edit-row"><label>Alt hashes</label><code class="item-hashes">${escHtml((item.alternative_hashes || []).join(', ') || 'None')}</code></div>
        <div class="item-edit-row"><label><input type="checkbox" id="editAirlock" ${item.airlocked ? 'checked' : ''} /> Airlocked</label></div>
        <div class="item-edit-row">
          <button class="btn btn-primary btn-sm" onclick="itemAction('save')">Save</button>
          <span id="editStatus" style="font-size:12px;color:var(--muted)"></span>
        </div>
      </div>` : ''}
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  loadItemFiles(item);
}

async function loadItemFiles(item) {
  const el = document.getElementById('itemFiles');
  if (!el) return;
  try {
    const files = await getItemFiles(item);
    if (!el.isConnected) return;
    if (!files.length) { el.innerHTML = '<div class="detail-empty">No files available</div>'; return; }
    el.innerHTML = files.map(f => `
      <div class="item-file-row">
        <span class="item-file-name" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
        <span class="item-file-size">${formatBytes(f.size)}</span>
        <button class="btn-action btn-download" onclick="downloadModalFile(${f.id})" title="Download file">${icon('download', 12)} Download</button>
      </div>`).join('');
  } catch (err) {
    if (el.isConnected) el.innerHTML = '<div class="detail-empty">' + escHtml(friendlyError(err, 'Could not load files')) + '</div>';
  }
}

async function downloadModalFile(fileId) {
  const item = _itemModalItem;
  if (!item) return;
  try { await downloadItem(item, fileId); showToast('Download started'); }
  catch (err) { showToast(friendlyError(err, 'Download failed'), 'error'); }
}

// ── Action dispatcher ──────────────────────────────────────────
async function itemAction(action) {
  const item = _itemModalItem;
  if (!item) return;
  try {
    if (action === 'download') {
      await downloadItem(item);
      showToast('Download started');
    } else if (action === 'zip') {
      await downloadItemZip(item);
      showToast('ZIP download started');
    } else if (action === 'copyShort') {
      await copyMagnetText(itemMagnetShort(item));
      showToast('Short magnet copied');
    } else if (action === 'copyFull') {
      await copyMagnetText(itemMagnetFull(item));
      showToast('Full magnet copied');
    } else if (action === 'export') {
      exportMagnetFile(item);
      showToast('Magnet exported');
    } else if (action === 'airlock') {
      const newVal = !item.airlocked;
      await tbEditTorrent(item.id, { airlocked: newVal });
      item.airlocked = newVal;
      showToast(newVal ? 'Airlock enabled' : 'Airlock disabled');
      const chip = document.getElementById('airlockChip');
      if (chip) chip.textContent = newVal ? 'Airlocked' : 'Not airlocked';
      const b = document.getElementById('btnAirlock');
      if (b) b.textContent = newVal ? 'Un-airlock' : 'Airlock';
      const eb = document.getElementById('editAirlock');
      if (eb) eb.checked = newVal;
    } else if (action === 'save') {
      const status = document.getElementById('editStatus');
      if (status) status.textContent = 'Saving…';
      const name = document.getElementById('editName')?.value.trim();
      const tags = (document.getElementById('editTags')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      const airlocked = document.getElementById('editAirlock')?.checked;
      const fields = {};
      if (name && name !== item.name) fields.name = name;
      if (JSON.stringify(tags) !== JSON.stringify(item.tags || [])) fields.tags = tags;
      if (airlocked !== item.airlocked) fields.airlocked = airlocked;
      if (Object.keys(fields).length) await tbEditTorrent(item.id, fields);
      if (fields.name !== undefined) item.name = name;
      if (fields.tags !== undefined) item.tags = tags;
      if (fields.airlocked !== undefined) item.airlocked = airlocked;
      showToast('Saved');
      if (status) status.textContent = '';
      renderLibraryList();
      const chip = document.getElementById('airlockChip');
      if (chip) chip.textContent = item.airlocked ? 'Airlocked' : 'Not airlocked';
      const b = document.getElementById('btnAirlock');
      if (b) b.textContent = item.airlocked ? 'Un-airlock' : 'Airlock';
    }
  } catch (err) {
    showToast(friendlyError(err, 'Action failed'), 'error');
  }
}
