// ── Download Manager (Add magnets/links) ─────────────────────

function renderDownloadView() {
  hideAllViews();
  const view = document.getElementById('downloadView');
  if (!view) return;
  view.style.display = 'block';

  const hasTB = !!App.keys.torboxKey;
  const hasRD = !!App.keys.rdKey;

  view.innerHTML = `
    <div class="browse-header">
      <h2>${icon('download', 18)} Add Download</h2>
      <button class="btn btn-secondary btn-sm" onclick="loadLibrary()">Refresh Library</button>
    </div>

    <div class="download-card">
      <div class="download-desc">Paste one or more magnet links (or direct TorBox/RD add URLs) below. Lines starting with <code>http</code> are treated as <em>watch folders</em> on your chosen provider.</div>

      <div class="input-wrap">
        <label>Magnets / Links <span style="color:var(--amber)">*</span></label>
        <textarea id="dlInput" rows="6" placeholder="magnet:?xt=urn:btih:&#8230;&#10;magnet:?xt=urn:btih:&#8230;&#10;https://&#8230;"></textarea>
      </div>

      <div class="input-wrap" id="dlProviderWrap">
        <label>Send to</label>
        <div class="dl-providers">
          ${hasTB ? `<label class="dl-provider"><input type="checkbox" id="dlTB" ${hasRD ? '' : 'checked'} /> TorBox</label>` : ''}
          ${hasRD ? `<label class="dl-provider"><input type="checkbox" id="dlRD" ${hasTB ? '' : 'checked'} /> Real-Debrid</label>` : ''}
        </div>
        ${!hasTB && !hasRD ? '<p class="hint">No provider keys loaded. Re-enter your API keys.</p>' : ''}
      </div>

      <button class="btn-load" id="dlSubmit" onclick="submitDownloads()" ${!hasTB && !hasRD ? 'disabled' : ''}>Add to Library</button>

      <div id="dlResults" style="margin-top:16px"></div>
    </div>
  `;

  addBackBtn(view);
  updateBottomNav('download');
}

function _dlLineParts(line) {
  const magnet = line.match(/magnet:\?xt=urn:btih:([A-Fa-f0-9]+)/i);
  const http = line.match(/^https?:\/\/\S+$/i);
  if (magnet) return { kind: 'magnet', value: line.trim(), hash: magnet[1].toLowerCase() };
  if (http) return { kind: 'url', value: line.trim() };
  return null;
}

async function submitDownloads() {
  const input = document.getElementById('dlInput');
  const resultsEl = document.getElementById('dlResults');
  const btn = document.getElementById('dlSubmit');
  const lines = (input.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (lines.length === 0) { showToast('Paste at least one magnet or link', 'error'); return; }

  const hasTB = !!App.keys.torboxKey;
  const hasRD = !!App.keys.rdKey;
  const wantTB = hasTB && document.getElementById('dlTB')?.checked;
  const wantRD = hasRD && document.getElementById('dlRD')?.checked;
  if (!wantTB && !wantRD) { showToast('Choose at least one provider', 'error'); return; }

  btn.disabled = true;
  btn.textContent = 'Adding...';

  const results = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parts = _dlLineParts(line);
    if (!parts) {
      results.push({ line: line.slice(0, 60), ok: false, msg: 'Not a magnet or link' });
      continue;
    }

    for (const provider of [wantTB ? 'torbox' : null, wantRD ? 'realdebrid' : null]) {
      if (!provider) continue;
      try {
        if (provider === 'torbox') {
          await addTorboxMagnet(parts.value, App.keys.torboxKey);
          results.push({ line: parts.value.slice(0, 60), ok: true, msg: 'Added to TorBox' });
        } else {
          await addRdMagnet(parts.value, App.keys.rdKey);
          results.push({ line: parts.value.slice(0, 60), ok: true, msg: 'Added to Real-Debrid' });
        }
      } catch (err) {
        results.push({ line: parts.value.slice(0, 60), ok: false, msg: provider + ': ' + err.message });
      }
    }
  }

  resultsEl.innerHTML = results.map(r => `
    <div class="dl-result ${r.ok ? 'ok' : 'err'}">
      <span class="dl-result-icon">${r.ok ? icon('check', 14) : icon('x', 14)}</span>
      <span class="dl-result-line" title="${escHtml(r.line)}">${escHtml(r.line)}</span>
      <span class="dl-result-msg">${escHtml(r.msg)}</span>
    </div>
  `).join('');

  const okCount = results.filter(r => r.ok).length;
  showToast(`Added ${okCount}/${results.length}`, okCount > 0 ? 'success' : 'error');

  btn.disabled = false;
  btn.textContent = 'Add to Library';
  input.value = '';

  // Refresh library in background so newly added items show up
  if (okCount > 0) {
    refreshInBackground();
    setTimeout(() => navigateTo('queue'), 1200);
  }
}
