// ── Queue View (Download Queue) ───────────────────────────────

let queuePollTimer = null;
let _pmPinShown = false;

function renderQueueView() {
  hideAllViews();
  const queueView = document.getElementById('queueView');
  queueView.style.display = 'block';

  queueView.innerHTML = `
    <div class="browse-header"><h2>${icon('queue', 18)} Download Queue</h2><button class="btn btn-secondary btn-sm" onclick="refreshQueue()">${icon('refresh', 13)} Refresh</button></div>
    <div id="queueContent">
      <div class="loading-area"><div class="spinner"></div><p>Loading downloads...</p></div>
    </div>
  `;

  addBackBtn(queueView);

  refreshQueue();
  startQueuePolling();
  updateBottomNav('queue');
}

async function refreshQueue() {
  const container = document.getElementById('queueContent');
  if (!container) return;

  const torboxKey = App.keys.torboxKey;
  const rdKey = App.keys.rdKey;
  const adKey = App.keys.adKey;
  const pmKey = App.keys.pmKey;

  if (!torboxKey && !rdKey && !adKey && !pmKey) {
    container.innerHTML = `<div class="empty"><div class="icon">${icon('queue', 32)}</div><h3>No provider connected</h3><p>Connect a provider to see your download queue.</p></div>`;
    return;
  }

  try {
    const results = await Promise.allSettled([
      torboxKey ? torboxGet('/torrents/mylist', torboxKey) : Promise.resolve([]),
      torboxKey ? torboxGet('/usenet/mylist', torboxKey) : Promise.resolve([]),
      rdKey ? rdGet('/torrents', rdKey) : Promise.resolve([]),
      adKey ? adPost('/v4.1/magnet/status', { ids: 'all' }, adKey) : Promise.resolve(null),
      pmKey ? pmGet('/transfer/list', pmKey) : Promise.resolve(null),
    ]);

    // A rejected call must not silently masquerade as an empty queue — surface
    // auth failures so the user knows their key is wrong.
    const isAuthErr = e => e && e.status && (e.status === 401 || e.status === 403);
    if (torboxKey) {
      const authErr = [results[0], results[1]].find(r => r.status === 'rejected' && isAuthErr(r.reason))?.reason;
      if (authErr) throw authErr;
    }
    if (rdKey && results[2].status === 'rejected' && isAuthErr(results[2].reason)) throw results[2].reason;
    if (adKey && results[3].status === 'rejected' && isAuthErr(results[3].reason)) throw results[3].reason;
    if (pmKey && results[4].status === 'rejected') {
      if (results[4].reason?.needPin) {
        // Show the PIN modal once per session, not on every 5s poll
        if (!_pmPinShown) { _pmPinShown = true; showPinModal(results[4].reason.pin, results[4].reason.deviceUrl, () => refreshQueue()); }
      } else if (isAuthErr(results[4].reason)) {
        throw results[4].reason;
      }
    }

    const torrents = (results[0].status === 'fulfilled' ? results[0].value : [])
      .map(i => ({ ...i, source: 'torrent', provider: 'TorBox' }));
    const usenet = (results[1].status === 'fulfilled' ? results[1].value : [])
      .map(i => ({ ...i, source: 'usenet', provider: 'TorBox' }));
    const rdTorrents = (results[2].status === 'fulfilled' && Array.isArray(results[2].value) ? results[2].value : [])
      .map(t => ({
        id: t.id, name: t.filename, filename: t.filename, size: t.bytes,
        source: 'realdebrid', provider: 'Real-Debrid',
        download_state: t.status === 'downloaded' ? 'completed' : t.status,
        download_finished: t.status === 'downloaded',
        progress: t.progress || 0,
      }));
    const adMagnets = (results[3].status === 'fulfilled' && results[3].value?.data?.magnets ? results[3].value.data.magnets : [])
      .map(m => ({
        id: String(m.id), name: m.filename || m.name || '', filename: m.filename || m.name || '',
        size: m.size || 0, source: 'alldebrid', provider: 'AllDebrid',
        download_state: m.statusCode === 5 ? 'completed' : 'downloading',
        download_finished: m.statusCode === 5,
        progress: m.statusCode === 5 ? 1 : 0,
      }));
    const pmTransfers = (results[4].status === 'fulfilled' && results[4].value?.data?.transfers ? results[4].value.data.transfers : [])
      .map(t => ({
        id: String(t.id), name: t.name || '', filename: t.name || '',
        source: 'premiumize', provider: 'Premiumize',
        download_state: t.status, download_finished: t.status === 'finished' || t.status === 'seeding',
        progress: t.progress || 0,
      }));

    const all = [...torrents, ...usenet, ...rdTorrents, ...adMagnets, ...pmTransfers];

    // Categorize — TorBox reports progress on a 0-1 scale (1 = done),
    // Real-Debrid on a 0-100 scale. Treat both correctly.
    const isDone = i => {
      if (i.download_finished === true) return true;
      const state = (i.download_state || '').toLowerCase();
      if (state === 'completed' || state === 'seeding' || state === 'cached' || state === 'finalized') return true;
      const p = i.progress;
      if (p != null) return i.source === 'realdebrid' ? p >= 100 : p >= 1;
      return false;
    };
    const active = all.filter(i => {
      if (isDone(i)) return false;
      const state = (i.download_state || '').toLowerCase();
      // Anything that isn't explicitly done or failed counts as in progress —
      // queued / waiting_files_selection / compressing / dead states etc. must
      // stay visible rather than silently vanishing from the queue.
      if (state === 'error' || state === 'failed') return false;
      return true;
    });
    const completed = all.filter(isDone);
    const failed = all.filter(i => {
      const state = (i.download_state || '').toLowerCase();
      return state === 'error' || state === 'failed';
    });

    let html = '';

    if (active.length > 0) {
      html += `<div class="queue-section"><div class="queue-section-title">${icon('zap', 14)} Active Downloads</div>`;
      active.forEach(item => {
        const parsed = parseTitle(item.name || item.filename || '');
        const state = (item.download_state || '').toLowerCase();
        const size = item.size ? formatBytes(item.size) : '';
        const pct = item.source === 'realdebrid' ? (item.progress || 0) : Math.round((item.progress || 0) * 100);
        html += `<div class="queue-item">
          <div class="queue-item-info">
            <div class="queue-item-title">${escHtml(parsed.cleanName)}</div>
            <div class="queue-item-meta">${item.provider} \u00B7 ${size} \u00B7 ${state}</div>
            <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
          </div>
          <span class="badge badge-downloading">${pct}%</span>
        </div>`;
      });
      html += '</div>';
    }

    if (completed.length > 0) {
      html += `<div class="queue-section"><div class="queue-section-title">${icon('check', 14)} Completed</div>`;
      completed.forEach(item => {
        const parsed = parseTitle(item.name || item.filename || '');
        const state = (item.download_state || '').toLowerCase();
        const size = item.size ? formatBytes(item.size) : '';
        html += `<div class="queue-item">
          <div class="queue-item-info">
            <div class="queue-item-title">${escHtml(parsed.cleanName)}</div>
            <div class="queue-item-meta">${item.provider} \u00B7 ${size}</div>
          </div>
          <span class="badge badge-${state}">${state}</span>
        </div>`;
      });
      html += '</div>';
    }

    if (failed.length > 0) {
      html += `<div class="queue-section"><div class="queue-section-title">${icon('alert', 14)} Failed</div>`;
      failed.forEach(item => {
        const parsed = parseTitle(item.name || item.filename || '');
        html += `<div class="queue-item">
          <div class="queue-item-info">
            <div class="queue-item-title">${escHtml(parsed.cleanName)}</div>
            <div class="queue-item-meta">${item.provider}</div>
          </div>
          <span class="badge badge-error">Failed</span>
        </div>`;
      });
      html += '</div>';
    }

    if (!html) {
      html = `<div class="empty"><div class="icon">${icon('queue', 32)}</div><h3>No active downloads</h3><p>Your download queue is empty.</p></div>`;
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="empty"><div class="icon">${icon('alert', 32)}</div><h3>Error loading queue</h3><p>${escHtml(err.message)}</p></div>`;
  }
}

function startQueuePolling() {
  stopQueuePolling();
  queuePollTimer = setInterval(() => {
    if (document.getElementById('queueView')?.style.display !== 'none') {
      refreshQueue();
    } else {
      stopQueuePolling();
    }
  }, 5000);
}

function stopQueuePolling() {
  if (queuePollTimer) { clearInterval(queuePollTimer); queuePollTimer = null; }
}
