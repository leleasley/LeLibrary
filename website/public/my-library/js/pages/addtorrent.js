// ── Add Torrent Modal (drag-drop file or paste link) ─────────

let atFile = null;

function openAddTorrentModal() {
  if (document.getElementById('addTorrentModal')) return;
  atFile = null;

  const hasTB = !!App.keys.torboxKey;
  const hasRD = !!App.keys.rdKey;
  const defaultTB = !hasRD; // if only one provider, preselect it

  const overlay = document.createElement('div');
  overlay.className = 'at-overlay';
  overlay.id = 'addTorrentModal';
  overlay.onclick = (e) => { if (e.target === overlay) closeAddTorrentModal(); };

  overlay.innerHTML = `
    <div class="at-box">
      <div class="at-header">
        <h3>${icon('plus', 16)} Add Torrent</h3>
        <button class="at-close" onclick="closeAddTorrentModal()">&times;</button>
      </div>

      <div class="at-body">
        <div class="at-dropzone" id="atDropzone">
          <div class="at-drop-icon">${icon('upload', 28)}</div>
          <div class="at-drop-text"><strong>Drop .torrent file here</strong><br/>or click to browse</div>
          <div class="at-drop-name" id="atDropName" style="display:none"></div>
          <input type="file" id="atFileInput" accept=".torrent" style="display:none" />
        </div>

        <div class="at-divider"><span>OR</span></div>

        <div class="input-wrap">
          <label>Paste magnet link or URL</label>
          <textarea id="atLink" rows="3" placeholder="magnet:?xt=urn:btih:&#8230;&#10;https://&#8230;"></textarea>
        </div>

        <div class="at-providers">
          ${hasTB ? `<label class="dl-provider"><input type="checkbox" id="atTB" ${defaultTB ? 'checked' : ''} /> TorBox</label>` : ''}
          ${hasRD ? `<label class="dl-provider"><input type="checkbox" id="atRD" ${hasTB ? '' : 'checked'} /> Real-Debrid</label>` : ''}
        </div>

        <button class="btn-load" id="atSubmit" onclick="submitAddTorrent()">Add Torrent</button>

        <!-- Loader (progress) -->
        <div class="at-loader" id="atLoader" style="display:none">
          <div class="at-loader-bar"><div class="at-loader-fill" id="atLoaderFill"></div></div>
          <div class="at-loader-status" id="atLoaderStatus">Preparing...</div>
        </div>

        <div class="at-results" id="atResults" style="display:none"></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Dropzone handlers
  const dz = document.getElementById('atDropzone');
  const fileInput = document.getElementById('atFileInput');
  dz.addEventListener('click', () => fileInput.click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag');
    const f = e.dataTransfer.files?.[0];
    if (f) setAtFile(f);
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) setAtFile(f);
  });
}

function setAtFile(file) {
  atFile = file;
  document.getElementById('atDropName').textContent = file.name;
  document.getElementById('atDropName').style.display = 'block';
  document.getElementById('atDropZone').classList.add('has-file');
}

function closeAddTorrentModal() {
  const el = document.getElementById('addTorrentModal');
  if (el) el.remove();
  atFile = null;
}

function _atSetLoader(pct, status) {
  const loader = document.getElementById('atLoader');
  const fill = document.getElementById('atLoaderFill');
  const statusEl = document.getElementById('atLoaderStatus');
  if (!loader) return;
  loader.style.display = 'block';
  fill.style.width = (pct || 0) + '%';
  if (status) statusEl.textContent = status;
}

function _atSetResults(ok, msg) {
  const el = document.getElementById('atResults');
  if (!el) return;
  el.style.display = 'block';
  el.className = 'at-results ' + (ok ? 'ok' : 'err');
  el.textContent = msg;
}

async function submitAddTorrent() {
  const link = (document.getElementById('atLink')?.value || '').trim();
  const hasTB = !!App.keys.torboxKey;
  const hasRD = !!App.keys.rdKey;
  const wantTB = hasTB && document.getElementById('atTB')?.checked;
  const wantRD = hasRD && document.getElementById('atRD')?.checked;
  const btn = document.getElementById('atSubmit');

  if (!atFile && !link) { _atSetResults(false, 'Drop a .torrent file or paste a magnet link.'); return; }
  if (!wantTB && !wantRD) { _atSetResults(false, 'Choose at least one provider.'); return; }

  btn.disabled = true;
  btn.textContent = 'Adding...';

  try {
    const jobs = [];
    if (wantTB && atFile) {
      _atSetLoader(0, 'Uploading torrent file to TorBox...');
      jobs.push(uploadTorrentFile(atFile, App.keys.torboxKey, (pct) => {
        _atSetLoader(pct, `Uploading ${pct}%...`);
      }).then(() => 'TorBox'));
    }
    if (wantTB && link) {
      _atSetLoader(0, 'Adding to TorBox...');
      jobs.push(addTorboxMagnet(link, App.keys.torboxKey)
        .then(() => { _atSetLoader(100, 'Added to TorBox.'); return 'TorBox'; }));
    }
    if (wantRD && link) {
      _atSetLoader(0, 'Adding to Real-Debrid...');
      jobs.push(addRdMagnet(link, App.keys.rdKey)
        .then(() => { _atSetLoader(100, 'Added to Real-Debrid.'); return 'Real-Debrid'; }));
    }
    if (wantRD && atFile) {
      _atSetLoader(0, 'Real-Debrid does not accept .torrent files — paste a magnet link instead.');
      // fall through; magnets handled above
    }

    if (jobs.length === 0) {
      _atSetLoader(0, 'Nothing to add.');
      _atSetResults(false, 'Nothing was added. Real-Debrid doesn\'t accept .torrent files — paste a magnet link instead, or use TorBox.');
      btn.disabled = false;
      btn.textContent = 'Add Torrent';
      return;
    }

    await Promise.all(jobs);
    _atSetLoader(100, 'Done.');
    _atSetResults(true, 'Torrent added successfully.');
    btn.disabled = false;
    btn.textContent = 'Add Torrent';

    // Refresh library in background + clean up
    refreshInBackground();
    setTimeout(closeAddTorrentModal, 1500);
    setTimeout(() => navigateTo('queue'), 1600);
  } catch (err) {
    _atSetLoader(0, 'Failed.');
    _atSetResults(false, err.message);
    btn.disabled = false;
    btn.textContent = 'Add Torrent';
  }
}
