// ── Queue View (Download Queue) ───────────────────────────────

let queuePollTimer = null;

function renderQueueView() {
  hideAllViews();
  const queueView = document.getElementById('queueView');
  queueView.style.display = 'block';

  queueView.innerHTML = `
    <div class="browse-header"><h2>&#128229; Download Queue</h2><button class="btn btn-secondary btn-sm" onclick="refreshQueue()">Refresh</button></div>
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

  if (!torboxKey && !rdKey) {
    container.innerHTML = '<div class="empty"><div class="icon">&#128229;</div><h3>No provider connected</h3><p>Connect TorBox or Real-Debrid to see your download queue.</p></div>';
    return;
  }

  try {
    const results = await Promise.allSettled([
      torboxKey ? torboxGet('/torrents/mylist', torboxKey) : Promise.resolve([]),
      torboxKey ? torboxGet('/usenet/mylist', torboxKey) : Promise.resolve([]),
      rdKey ? rdGet('/torrents', rdKey) : Promise.resolve([]),
    ]);

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

    const all = [...torrents, ...usenet, ...rdTorrents];

    // Categorize
    const active = all.filter(i => {
      const state = (i.download_state || '').toLowerCase();
      return state === 'downloading' || state === 'checking' || state === 'fetching_metadata' || (i.progress && i.progress < 100);
    });
    const completed = all.filter(i => {
      const state = (i.download_state || '').toLowerCase();
      return state === 'completed' || state === 'seeding' || state === 'cached' || state === 'finalized' || i.download_finished === true;
    });
    const failed = all.filter(i => {
      const state = (i.download_state || '').toLowerCase();
      return state === 'error' || state === 'failed';
    });

    let html = '';

    if (active.length > 0) {
      html += '<div class="queue-section"><div class="queue-section-title">&#9889; Active Downloads</div>';
      active.forEach(item => {
        const parsed = parseTitle(item.name || item.filename || '');
        const state = (item.download_state || '').toLowerCase();
        const size = item.size ? formatBytes(item.size) : '';
        const progress = item.progress || 0;
        html += `<div class="queue-item">
          <div class="queue-item-info">
            <div class="queue-item-title">${escHtml(parsed.cleanName)}</div>
            <div class="queue-item-meta">${item.provider} \u00B7 ${size} \u00B7 ${state}</div>
            <div class="progress-bar"><div class="progress-bar-fill" style="width:${progress}%"></div></div>
          </div>
          <span class="badge badge-downloading">${Math.round(progress)}%</span>
        </div>`;
      });
      html += '</div>';
    }

    if (completed.length > 0) {
      html += '<div class="queue-section"><div class="queue-section-title">&#9989; Completed</div>';
      completed.slice(0, 10).forEach(item => {
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
      html += '<div class="queue-section"><div class="queue-section-title">&#10060; Failed</div>';
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
      html = '<div class="empty"><div class="icon">&#128229;</div><h3>No active downloads</h3><p>Your download queue is empty.</p></div>';
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="empty"><div class="icon">&#9888;&#65039;</div><h3>Error loading queue</h3><p>${escHtml(err.message)}</p></div>`;
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
