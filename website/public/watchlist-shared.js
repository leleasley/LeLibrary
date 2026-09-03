// Shared watchlist UI for both account settings and configure page.
// This file is public (github) and can be used by both.
// It handles fetching watchlist status from the server (not localStorage) and rendering the buttons with SVGs.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WatchlistShared = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // SVG icons as inline data URIs or img src
  const ICONS = {
    simkl: '/simkl.svg',
    trakt: '/trakt.svg',
    mdblist: '/mdblist.svg'
  };
  let statusCache = null;
  let statusCacheAt = 0;

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Render a single watchlist row with SVG, status, and button
  function renderWatchlistRow(service, status, onAdd, showActions = true) {
    const isConnected = status.connected;
    const isEnabled = status.enabled !== false; // for Trakt
    const badgeClass = isConnected ? 'ok' : 'off';
    const badgeText = isConnected ? 'connected' : 'not connected';
    const buttonText = isConnected ? (service === 'mdblist' ? 'Manage' : 'Reconnect') : 'Connect';
    const buttonDisabled = service === 'trakt' && !isEnabled && !isConnected ? 'disabled' : '';
    const subText = {
      simkl: 'Plan to Watch + history as addon rows',
      trakt: isEnabled ? 'Your personal Trakt watchlist as addon rows' : 'Trakt sign-in is not enabled on this server yet',
      mdblist: isConnected ? 'Your MDBList watchlist is saved securely to your account' : 'Add your MDBList key from Account settings to use this watchlist'
    }[service] || '';

    const addButton = onAdd ? `<button class="btn btn-outline btn-sm" onclick="WatchlistShared.addToHomeRows('${service}')" style="margin-left:8px">Add to Home Rows</button>` : '';

    return `
      <div class="connect-row" style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);margin-bottom:8px">
        <div class="connect-logo" style="width:40px;height:40px;display:grid;place-items:center;background:var(--bg);border-radius:8px;flex-shrink:0"><img src="${ICONS[service]}" alt="${service}" style="width:28px;height:28px"></div>
        <div class="connect-info" style="flex:1;min-width:0">
          <strong style="display:block;color:var(--text);font-size:0.9rem">${service.charAt(0).toUpperCase() + service.slice(1)}</strong>
          <div class="connect-sub" style="color:var(--muted);font-size:0.78rem;margin-top:2px">${escapeHtml(subText)}</div>
        </div>
        <span class="badge ${badgeClass}" style="padding:4px 8px;border-radius:999px;font-size:0.7rem;font-weight:700;background:${isConnected ? 'rgba(34,197,94,0.15)' : 'rgba(113,113,122,0.15)'};color:${isConnected ? '#22c55e' : '#71717a'};border:1px solid ${isConnected ? 'rgba(34,197,94,0.3)' : 'rgba(113,113,122,0.3)'}">${badgeText}</span>
        ${showActions ? `<div class="connect-actions" style="display:flex;gap:8px;flex-shrink:0">
          <button class="watchlist-action watchlist-action-primary" onclick="WatchlistShared.connect('${service}')" ${buttonDisabled}>${buttonText}<span aria-hidden="true">→</span></button>
          ${isConnected && service !== 'mdblist' ? `<button class="watchlist-action watchlist-action-secondary" onclick="WatchlistShared.disconnect('${service}')">Disconnect</button>` : ''}
          ${addButton}
        </div>` : ''}
      </div>
    `;
  }

  // Fetch watchlist status from server (not localStorage)
  async function fetchWatchlistStatus() {
    // A signed-in account uses its session cookie. Account tokens are not
    // exposed to the page, so do not gate this on a browser-side token.
    if (statusCache && Date.now() - statusCacheAt < 15000) return statusCache;
    try {
      const [simkl, trakt, caps, keys] = await Promise.all([
        fetch('/api/account/watchlist/simkl', { cache: 'no-store', credentials: 'same-origin' }).then(r => r.ok ? r.json() : ({})).catch(() => ({})),
        fetch('/api/account/watchlist/trakt', { cache: 'no-store', credentials: 'same-origin' }).then(r => r.ok ? r.json() : ({})).catch(() => ({})),
        fetch('/api/account/watchlist-capabilities', { cache: 'no-store', credentials: 'same-origin' }).then(r => r.ok ? r.json() : ({})).catch(() => ({})),
        fetch('/api/account/keys', { cache: 'no-store', credentials: 'same-origin' }).then(r => r.ok ? r.json() : ({})).catch(() => ({}))
      ]);
      statusCache = {
        simkl: { connected: !!simkl.connected, data: simkl },
        trakt: { connected: !!trakt.connected, enabled: !!caps.trakt, data: trakt },
        mdblist: { connected: !!keys.services?.mdblistKey, data: keys },
        capabilities: caps
      };
      statusCacheAt = Date.now();
      return statusCache;
    } catch (e) {
      return {
        simkl: { connected: false },
        trakt: { connected: false },
        mdblist: { connected: false },
        capabilities: {}
      };
    }
  }

  // Connect handlers
  function connect(service) {
    if (service === 'mdblist') {
      const el = document.getElementById('mdblistKey') || document.getElementById('rpdbKey');
      if (el) el.focus();
      else window.location.href = '/account/settings';
      return;
    }
    // OAuth watchlists belong to an account. Give configure-page visitors a
    // useful sign-in route instead of sending a signed-out browser to a 401.
    fetch('/api/account/me', { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => {
        if (r.status === 401) {
          window.location.href = '/account/login?next=' + encodeURIComponent('/configure');
          return;
        }
        if (!r.ok) return;
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = service === 'simkl' ? `/api/oauth/simkl?next=${next}` : `/api/oauth/trakt?next=${next}`;
      })
      .catch(() => {});
  }

  function disconnect(service) {
    fetch(`/api/account/watchlist/${service}/disconnect`, { method: 'POST', credentials: 'same-origin' })
      .then((r) => {
        if (!r.ok) throw new Error('disconnect failed');
        window.location.reload();
      })
      .catch(() => {
        // No browser alert() per project UI rules: use the shared toast.
        if (window.LeToast) LeToast.show('Could not disconnect. Please try again.', 'error');
        else if (typeof showToast === 'function') showToast('Could not disconnect', 'error');
      });
  }

  function addToHomeRows(service) {
    // Add watchlist rows to Home Rows (libraryCatalogs)
    const ids = service === 'mdblist'
      ? ['torbox-watchlist-mdblist-movie', 'torbox-watchlist-mdblist-series']
      : service === 'simkl'
      ? ['torbox-watchlist-simkl-movie', 'torbox-watchlist-simkl-series']
      : ['torbox-watchlist-trakt-movie', 'torbox-watchlist-trakt-series'];

    // Check if we're on the configure page with libraryCatalogs
    if (typeof window.libraryCatalogs !== 'undefined' && Array.isArray(window.libraryCatalogs)) {
      let added = 0;
      for (const id of ids) {
        if (!window.libraryCatalogs.includes(id)) {
          window.libraryCatalogs.push(id);
          added++;
        }
      }
      if (window.renderLibraryGroups) window.renderLibraryGroups();
      if (window.renderCataloguesOptions) window.renderCataloguesOptions();
      if (window.checkChanged) window.checkChanged();
      if (added > 0 && window.LeToast) window.LeToast.success(`Added ${added} watchlist row${added === 1 ? '' : 's'}: find them in My Rows`);
      else if (window.LeToast) window.LeToast.info('Watchlist rows are already in My Rows');
    } else {
      // Fallback: try to add via API or show message
      if (window.LeToast) window.LeToast.info('Open Home Rows to add watchlist rows');
    }
  }

  // Render all watchlist rows for a container
  async function renderWatchlistSection(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '<div class="field-hint">Loading watchlists…</div>';
    const status = await fetchWatchlistStatus();
    const accountLink = document.getElementById('watchlistAccountSettings');
    if (accountLink) {
      const accountCheck = await fetch('/api/account/me', { cache: 'no-store', credentials: 'same-origin' }).catch(() => null);
      accountLink.hidden = !accountCheck || accountCheck.status === 404;
    }
    const showAddButton = options.showAddButton !== false;
    const showActions = options.showActions !== false;
    const rows = [
      renderWatchlistRow('simkl', status.simkl, showAddButton, showActions),
      renderWatchlistRow('trakt', status.trakt, showAddButton, showActions),
      renderWatchlistRow('mdblist', status.mdblist, showAddButton, showActions)
    ].join('');
    container.innerHTML = rows;
    // Update badge counts if needed
    if (window.updateWatchlistSummary) window.updateWatchlistSummary(status);
  }

  return {
    ICONS,
    renderWatchlistRow,
    fetchWatchlistStatus,
    connect,
    disconnect,
    addToHomeRows,
    renderWatchlistSection
  };
}));
