    // AbortSignal.timeout() polyfill (Safari ≤15.4 / Chrome ≤102): nine fetch
    // call sites below pass it inline, and on browsers without it each one
    // would throw a TypeError at request-build time. A tiny controller-based
    // shim keeps the timeouts working everywhere.
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout !== 'function') {
      AbortSignal.timeout = function (ms) {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), Math.max(0, Number(ms) || 0));
        return controller.signal;
      };
    }

    function toggleVis(id, btn) {
      const el = document.getElementById(id);
      const isPass = el.type === 'password';
      el.type = isPass ? 'text' : 'password';
      btn.textContent = isPass ? '🙈' : '👁';
    }

    // ── Load an existing setup ──
    // Self-host + hosted friendly: pasting a legacy token decodes it right here
    // in the browser; an opaque/account token falls back to the server page-load
    // path which resolves it and injects __INITIAL_CONFIG__.
    // ── Self-hosted saved configs ──
    // Only shown on self-hosted installs (window.__HOSTED__ === false). The
    // hosted instance uses account tokens instead and never exposes these.
    async function loadSavedConfigs() {
      try {
        const r = await fetch('/api/selfhost-configs', { cache: 'no-store' });
        if (r.status === 404) return; // hosted instance: not available
        if (r.status === 401) { renderSelfhostDisabled(); return; } // no SELFHOST_CONFIGS_SECRET set
        const d = await r.json();
        renderSavedConfigs(d.configs || []);
      } catch (e) { /* ignore */ }
    }

    function renderSelfhostDisabled() {
      const box = document.getElementById('selfhostSavedConfigs');
      const list = document.getElementById('selfhostConfigList');
      if (!box || !list) return;
      box.style.display = 'block';
      list.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:0.82rem;line-height:1.5">Saved setups are disabled on this instance.<br>Set <code>SELFHOST_CONFIGS_SECRET</code> in <code>.env</code> and restart to enable them.</div>';
      const saveBtn = document.getElementById('saveCurrentSetupBtn');
      if (saveBtn) saveBtn.style.display = 'none';
    }

    function renderSavedConfigs(configs) {
      const box = document.getElementById('selfhostSavedConfigs');
      const list = document.getElementById('selfhostConfigList');
      if (!box || !list) return;
      const saveBtn = document.getElementById('saveCurrentSetupBtn');
      if (saveBtn) saveBtn.style.display = '';
      if (!configs.length) {
        box.style.display = 'block';
        list.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:0.82rem">No saved configs yet. Configure the addon, then "Save current setup".</div>';
        return;
      }
      box.style.display = 'block';
      list.innerHTML = configs.map((c) => {
        const date = c.created_at ? new Date(c.created_at).toLocaleDateString() : '';
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <strong style="font-size:0.82rem;color:var(--text);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(c.label || 'My setup')}</strong>
            <small style="color:var(--muted)">${date}</small>
          </div>
          <button type="button" class="btn-main btn-gen" style="padding:6px 12px;font-size:0.76rem" onclick="loadSavedConfig('${c.id}')">Load</button>
          <button type="button" class="btn-copy-url" style="padding:6px 10px;font-size:0.76rem" onclick="deleteSavedConfig('${c.id}')" title="Delete">🗑</button>
        </div>`;
      }).join('');
    }

    async function saveCurrentConfig() {
      const cfg = getCurrentConfig();
      if (!cfg.provider || cfg.provider === 'none') { showToast('Configure the addon first before saving', 'error'); return; }
      const label = await showNameModal('Name this config', cfg.provider + ' setup');
      if (label === null) return;
      try {
        const r = await fetch('/api/selfhost-configs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: label || 'My setup', config: cfg }),
        });
        if (!r.ok) {
          if (r.status === 401) { showToast('Saved setups are disabled: set SELFHOST_CONFIGS_SECRET in .env', 'error'); return; }
          showToast('Could not save config', 'error'); return;
        }
        showToast('Config saved ✓', 'success');
        loadSavedConfigs();
      } catch (e) { showToast('Could not save config', 'error'); }
    }

    async function loadSavedConfig(id) {
      try {
        const r = await fetch('/api/selfhost-configs', { cache: 'no-store' });
        const d = await r.json();
        const c = (d.configs || []).find((x) => x.id === id);
        if (!c || !c.config) { showToast('Config not found', 'error'); return; }
        applyConfig(c.config);
        goToStep(7);
        showToast('Config loaded ✓', 'success');
      } catch (e) { showToast('Could not load config', 'error'); }
    }

    // ── In-house confirm modal (replaces the browser's confirm()) ──
    let confirmResolve = null;
    function showConfirmModal(title, text, okLabel) {
      const modal = document.getElementById('confirmModal');
      if (!modal) return Promise.resolve(true); // fallback if markup missing
      document.getElementById('confirmModalTitle').textContent = title;
      document.getElementById('confirmModalText').textContent = text;
      const ok = document.getElementById('confirmModalOk');
      ok.textContent = okLabel || 'Confirm';
      modal.classList.add('show');
      ok.focus();
      return new Promise((resolve) => { confirmResolve = resolve; });
    }
    function closeConfirmModal() {
      const modal = document.getElementById('confirmModal');
      if (modal) modal.classList.remove('show');
      if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
    }
    function runConfirm() {
      const modal = document.getElementById('confirmModal');
      if (modal) modal.classList.remove('show');
      if (confirmResolve) { confirmResolve(true); confirmResolve = null; }
    }
    const confirmModalEl = document.getElementById('confirmModal');
    if (confirmModalEl) {
      confirmModalEl.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeConfirmModal(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeConfirmModal(); });
    }

    // ── In-house name-input modal (replaces the browser's prompt()) ──
    let nameResolve = null;
    function showNameModal(title, initial) {
      const modal = document.getElementById('nameModal');
      if (!modal) return Promise.resolve(initial || '');
      document.getElementById('nameModalTitle').textContent = title;
      const input = document.getElementById('nameModalInput');
      input.value = initial || '';
      modal.classList.add('show');
      setTimeout(() => { input.focus(); input.select(); }, 50);
      return new Promise((resolve) => { nameResolve = resolve; });
    }
    function closeNameModal() {
      const modal = document.getElementById('nameModal');
      if (modal) modal.classList.remove('show');
      if (nameResolve) { nameResolve(null); nameResolve = null; }
    }
    function runNameModal() {
      const modal = document.getElementById('nameModal');
      const val = document.getElementById('nameModalInput').value;
      if (modal) modal.classList.remove('show');
      if (nameResolve) { nameResolve(val); nameResolve = null; }
    }
    const nameModalEl = document.getElementById('nameModal');
    if (nameModalEl) {
      nameModalEl.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeNameModal(); });
      document.getElementById('nameModalInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); runNameModal(); }
      });
    }

    async function deleteSavedConfig(id) {
      const ok = await showConfirmModal('Delete this saved config?', 'This removes the saved setup from this instance. Your addon keeps working as it is.', 'Delete');
      if (!ok) return;
      try {
        const r = await fetch('/api/selfhost-configs/' + encodeURIComponent(id), { method: 'DELETE' });
        if (!r.ok) { showToast('Could not delete config', 'error'); return; }
        loadSavedConfigs();
      } catch (e) { showToast('Could not delete config', 'error'); }
    }

    function toggleLoadConfig() {
      const box = document.getElementById('loadConfigBox');
      if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
    }

    // Pull the token out of whatever the user pasted: a bare base64 token, a
    // full manifest URL, a configure URL, or an opaque account token id.
    function extractToken(raw) {
      let t = String(raw || '').trim();
      if (!t) return '';
      const m = t.match(/\/([A-Za-z0-9_-]{8,})(?:\/manifest\.json|\/configure)?$/);
      if (m) t = m[1];
      return t;
    }

    function loadConfigFromInput() {
      const err = document.getElementById('loadConfigError');
      const hide = () => { if (err) err.style.display = 'none'; };
      const fail = (msg) => { if (err) { err.textContent = msg; err.style.display = 'block'; } };
      hide();
      const raw = document.getElementById('loadConfigInput')?.value || '';
      const token = extractToken(raw);
      if (!token) { fail('Could not read a token from that link.'); return; }

      // Fast path: legacy base64 config decodes entirely client-side.
      try {
        const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
        const json = JSON.parse(atob(b64 + '=='.slice((4 - (b64.length % 4)) % 4)));
        const cfg = window.TOKEN_MAP && window.TOKEN_MAP.normalizeConfig(json);
        if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
          applyConfig(cfg);
          goToStep(7);
          showToast('Config loaded ✓', 'success');
          return;
        }
      } catch (e) { /* not a legacy token: fall through to server resolve */ }

      // Opaque / unknown token: let the server resolve it (works on hosted for
      // account tokens; same page, injected config). Legacy tokens that somehow
      // failed to decode also hit here and show a clear error if invalid.
      window.location.href = '/' + encodeURIComponent(token) + '/configure';
    }

    function encodeConfig(cfg) {
      // Compact token format (short field names, packed arrays, defaults
      // dropped); the server maps it back on decode. See token-map.js.
      if (window.TOKEN_MAP && typeof window.TOKEN_MAP.encodeConfig === 'function') {
        return window.TOKEN_MAP.encodeConfig(cfg);
      }
      // Fallback: the old full-name encoding (kept so a blocked script never
      // bricks the page).
      return btoa(unescape(encodeURIComponent(JSON.stringify(cfg))))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }

    // Central place for building the addon URLs from a config so the Install
    // step and the Collections tab share the exact same token.
    function buildUrls(cfg) {
      // Account-backed tokens are opaque server-side ids. Never replace one
      // with a client-generated config token: doing so both makes the URL much
      // longer and can expose account configuration in the address bar. The
      // short id remains the canonical token for every generated URL.
      const current = currentToken();
      const encoded = ACCOUNT_TOKEN && current ? current : encodeConfig(cfg);
      const origin       = window.location.origin;
      const manifestUrl  = `${origin}/${encoded}/manifest.json`;
      return {
        encoded,
        manifestUrl,
        collectionsUrl: `${origin}/${encoded}/collections.json`,
        stremioDeep: manifestUrl.replace(/^https?:\/\//, 'stremio://'),
        stremioWeb: `https://web.stremio.com/#/addons?addon=${encodeURIComponent(manifestUrl)}`,
        nuvioDeep: manifestUrl.replace(/^https?:\/\//, 'nuvio://'),
      };
    }

    let lastUrls = null;   // { manifestUrl, collectionsUrl, encoded, ... } from the last generate()
    let initialConfig = null;
    let customStreams = [];
    let hasExistingToken = false;
    // Account-backed tokens keep their source of truth on the server. Do not
    // persist drafts or platform credentials in this browser for those URLs.
    const ACCOUNT_TOKEN = window.__ACCOUNT_TOKEN__ === true;

    // ── Config draft (sessionStorage) ─────────────────────────────────────
    // The form state is snapshotted here whenever the user changes something,
    // so a refresh / accidental reload doesn't wipe their work in progress. It
    // is cleared on Save / Push / Reset and expires after DRAFT_TTL. Stored
    // against the current install token so a draft never leaks onto a
    // different account's configure page.
    const DRAFT_KEY = 'lelibrary_config_draft';
    const DRAFT_TTL = 60 * 60 * 1000;   // 1 hour
    let draftArmed = false;             // only snapshot once the initial load settled
    let draftTimer = null;
    let draftSuppressUntil = 0;         // window where saveDraft is ignored (after Reset)

    function currentToken() {
      const parts = window.location.pathname.split('/').filter(Boolean);
      const t = parts[0] === 'accounts' ? parts[1] : parts[0];
      return t && t !== 'configure' ? t : '';
    }

    function configurePath(token = currentToken()) {
      const safeToken = encodeURIComponent(token || '');
      return ACCOUNT_TOKEN ? `/accounts/${safeToken}/configure` : `/${safeToken}/configure`;
    }

    function snapshotConfig() {
      // getCurrentConfig() carries the whole form (incl. the server-side-only
      // stream settings + filter chips) so a restored draft looks exactly like
      // what the user left.
      return getCurrentConfig();
    }

    function saveDraft() {
      if (ACCOUNT_TOKEN) return;
      if (!draftArmed) return;
      if (Date.now() < draftSuppressUntil) return; // post-Reset: let the token config reload
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => {
        try {
          sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
            ts: Date.now(),
            token: currentToken(),
            config: snapshotConfig(),
          }));
        } catch { /* storage unavailable / full: non-fatal */ }
      }, 400);
    }

    function loadDraft(expectedToken) {
      if (ACCOUNT_TOKEN) return null;
      let raw = null;
      try { raw = sessionStorage.getItem(DRAFT_KEY); } catch { return null; }
      if (!raw) return null;
      let d = null;
      try { d = JSON.parse(raw); } catch { return null; }
      if (!d || typeof d.config !== 'object') return null;
      if (!d.ts || (Date.now() - d.ts) > DRAFT_TTL) { clearDraft(); return null; }
      if ((d.token || '') !== (expectedToken || '')) return null; // different URL/account
      return d;
    }

    function clearDraft() {
      clearTimeout(draftTimer);
      try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
    }

    // After the address-bar token is replaced (save / push / load-time
    // re-encode) keep the draft pointing at the new token so a later refresh
    // still restores it.
    function refreshDraftToken(newToken) {
      if (ACCOUNT_TOKEN) return;
      try {
        const raw = sessionStorage.getItem(DRAFT_KEY);
        if (!raw) return;
        const d = JSON.parse(raw);
        if (!d || typeof d.config !== 'object') return;
        d.token = newToken || '';
        d.ts = Date.now();
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
      } catch { /* non-fatal */ }
    }

    // Apply a config object (token, server store, or restored draft) to the
    // form fields. Shared by the initial token load and the draft restore so
    // both paths behave identically.
    function applyConfig(cfg) {
      if (!cfg || typeof cfg !== 'object') return;
      if (cfg.provider) {
        document.getElementById('provider').value = cfg.provider;
        onProviderChange();
      }
      if (cfg.torboxApiKey) document.getElementById('torboxApiKey').value = cfg.torboxApiKey;
      if (cfg.tmdbApiKey) document.getElementById('tmdbApiKey').value = cfg.tmdbApiKey;
      if (cfg.rdApiKey) document.getElementById('rdApiKey').value = cfg.rdApiKey;
      if (cfg.adApiKey) document.getElementById('adApiKey').value = cfg.adApiKey;
      if (cfg.pmApiKey) document.getElementById('pmApiKey').value = cfg.pmApiKey;
      if (cfg.rdCatalog) document.getElementById('rdCatalog').value = cfg.rdCatalog;
      if (cfg.sortBy) document.getElementById('sortBy').value = cfg.sortBy;
      if (cfg.lang) document.getElementById('lang').value = cfg.lang;
      if (document.getElementById('searchScope')) document.getElementById('searchScope').value = ['combined', 'library', 'tmdb'].includes(cfg.searchScope) ? cfg.searchScope : 'combined';
      if (cfg.posterProvider) {
        document.getElementById('posterProvider').value = cfg.posterProvider;
        onPosterChange();
      }
      if (cfg.erdbToken) { document.getElementById('erdbToken').value = cfg.erdbToken; updatePosterPreview(); }
      if (cfg.rpdbKey) { document.getElementById('rpdbKey').value = cfg.rpdbKey; updatePosterPreview(); }
      if (cfg.fanartKey) document.getElementById('fanartKey').value = cfg.fanartKey;
      if (cfg.omdbKey) document.getElementById('omdbKey').value = cfg.omdbKey;
      if (cfg.enhanceBackground != null) document.getElementById('enhanceBackground').checked = cfg.enhanceBackground;
      if (cfg.enhanceLogo != null) document.getElementById('enhanceLogo').checked = cfg.enhanceLogo;
      if (cfg.customStreams && Array.isArray(cfg.customStreams)) {
        customStreams = cfg.customStreams;
        renderCustomStreams();
      }
      if (cfg.catNameMovies) catNames.movies = cfg.catNameMovies;
      if (cfg.catNameSeries) catNames.series = cfg.catNameSeries;
      if (cfg.catNameAnime) catNames.anime = cfg.catNameAnime;
      if (cfg.libraryNames && typeof cfg.libraryNames === 'object') Object.assign(libraryNames, cfg.libraryNames);
      if (cfg.watchlistNames && typeof cfg.watchlistNames === 'object') Object.assign(watchlistNames, cfg.watchlistNames);
      // Explicit boolean restores: applyConfig is always given a full-shape
      // config (token, draft or saved setup), so an absent field means "off".
      // Truthy-only checks used to leave stale ticks when loading config B
      // over config A.
      if (document.getElementById('hideAnime')) document.getElementById('hideAnime').checked = !!cfg.hideAnime;
      applyLibraryCatalogs(cfg);
      if (cfg.libraryIdMode === 'tt') {
        if (document.getElementById('libraryIdMode')) document.getElementById('libraryIdMode').checked = true;
      } else if (cfg.libraryIdMode === '') {        if (document.getElementById('libraryIdMode')) document.getElementById('libraryIdMode').checked = false;
      }
      if (cfg.streamPreset) document.getElementById('streamPreset').value = cfg.streamPreset;
      if (window._badgePicker) window._badgePicker.set(cfg.nuvioBadgePack, cfg.nuvioBadgeUrl);
      if (cfg.streamNotices === 'off') {
        const sn = document.getElementById('streamNotices');
        if (sn) sn.checked = false;
      }
      if (cfg.streamPreset === 'custom') {
        if (cfg.streamNameTemplate) document.getElementById('streamNameTemplate').value = cfg.streamNameTemplate;
        if (cfg.streamDescTemplate) document.getElementById('streamDescTemplate').value = cfg.streamDescTemplate;
      } else {
        onStreamPresetChange();
      }
      if (cfg.mdblistKey && document.getElementById('mdblistKey')) document.getElementById('mdblistKey').value = cfg.mdblistKey;
      // Streams 2.0: restore filter + sort settings
      if (cfg.streamSort) document.getElementById('streamSort').value = cfg.streamSort;
      const sf = (cfg.streamFilters && typeof cfg.streamFilters === 'object') ? cfg.streamFilters : {};
      if (sf.minQuality) document.getElementById('streamMinQuality').value = sf.minQuality;
      if (sf.maxQuality) document.getElementById('streamMaxQuality').value = sf.maxQuality;
      if (sf.minSizeGB) document.getElementById('streamMinSizeGB').value = sf.minSizeGB;
      if (document.getElementById('streamCachedOnly')) document.getElementById('streamCachedOnly').checked = !!sf.cachedOnly;
      // Accept both the token shape (excludeQualities array) and the draft
      // shape (excludeLow boolean): otherwise "Exclude low quality" silently
      // reset on reload when restored from the session draft.
      if ((Array.isArray(sf.excludeQualities) && sf.excludeQualities.length) || sf.excludeLow) document.getElementById('streamExcludeLow').checked = true;
      if (cfg.catalogTrending) catSelection.trending = true;
      // Discovery rows tick individually; legacy catalogTrending/catalogPopular
      // (both at once) still work for older tokens.
      if (cfg.catalogTrendingMovies || cfg.catalogTrending) catSelection.trendingMovies = true;
      if (cfg.catalogTrendingSeries || cfg.catalogTrending) catSelection.trendingSeries = true;
      if (cfg.catalogPopularMovies || cfg.catalogPopular) catSelection.popularMovies = true;
      if (cfg.catalogPopularSeries || cfg.catalogPopular) catSelection.popularSeries = true;
      if (cfg.catalogMovies === false) catSelection.movies = false;
      if (cfg.catalogSeries === false) catSelection.series = false;
      if (cfg.catalogAnime === false) catSelection.anime = false;
      if (cfg.catalogFranchises === false) catSelection.franchises = false;
      if (document.getElementById('pinCollections')) document.getElementById('pinCollections').checked = cfg.pinCollections === true;
      // Catalogue names (Edit Catalogues): per-catalogue fields with legacy
      // single trendingName/popularName fallback.
      if (cfg.trendingMoviesName) catNames.trendingMovies = cfg.trendingMoviesName;
      else if (cfg.trendingName) catNames.trendingMovies = cfg.trendingName;
      if (cfg.trendingSeriesName) catNames.trendingSeries = cfg.trendingSeriesName;
      else if (cfg.trendingName) catNames.trendingSeries = cfg.trendingName;
      if (cfg.popularMoviesName) catNames.popularMovies = cfg.popularMoviesName;
      else if (cfg.popularName) catNames.popularMovies = cfg.popularName;
      if (cfg.popularSeriesName) catNames.popularSeries = cfg.popularSeriesName;
      else if (cfg.popularName) catNames.popularSeries = cfg.popularName;
      if (cfg.collectionsName) catNames.franchises = cfg.collectionsName;
      if (Array.isArray(cfg.catalogOrder) && cfg.catalogOrder.length) {
        catOrder = cfg.catalogOrder.slice();
        for (const k of DEFAULT_CAT_ORDER) {
          if (!catOrder.includes(k)) catOrder.push(k);
        }
      }
      if (cfg.streamAddons && Array.isArray(cfg.streamAddons)) streamAddons = cfg.streamAddons;
      // Restore Filters & Preferences
      if (cfg.filterResolutions && Array.isArray(cfg.filterResolutions)) {
        // Migrate old labels: 2160p→4K, 1440p→2K
        const migrated = cfg.filterResolutions.map(r => r === '2160p' ? '4K' : r === '1440p' ? '2K' : r);
        filterState.resIncluded = new Set(migrated);
        filterState.resolutions = migrated.slice();
        for (const r of ALL_RESOLUTIONS) { if (!filterState.resolutions.includes(r)) filterState.resolutions.push(r); }
      }
      if (cfg.filterResOrder && Array.isArray(cfg.filterResOrder)) {
        filterState.resolutions = cfg.filterResOrder.map(r => r === '2160p' ? '4K' : r === '1440p' ? '2K' : r);
        for (const r of ALL_RESOLUTIONS) { if (!filterState.resolutions.includes(r)) filterState.resolutions.push(r); }
      }
      if (cfg.filterQualities && Array.isArray(cfg.filterQualities)) filterState.qualities = new Set(cfg.filterQualities);
      if (cfg.filterSources && Array.isArray(cfg.filterSources)) filterState.sources = new Set(cfg.filterSources);
      if (cfg.filterCodecs && Array.isArray(cfg.filterCodecs)) filterState.codecs = new Set(cfg.filterCodecs);
      if (cfg.filterHdr && Array.isArray(cfg.filterHdr)) filterState.hdr = new Set(cfg.filterHdr);
      if (cfg.filterAudio && Array.isArray(cfg.filterAudio)) filterState.audio = new Set(cfg.filterAudio);
      if (cfg.filterMinSize) document.getElementById('filterMinSize').value = cfg.filterMinSize;
      if (cfg.filterMaxSize) document.getElementById('filterMaxSize').value = cfg.filterMaxSize;
      if (document.getElementById('filterCachedOnly')) document.getElementById('filterCachedOnly').checked = !!cfg.filterCachedOnly;
      renderAllFilterChips();
      renderCataloguesOptions();
      renderStreamAddons();
      updateStreamPreview();
    }

    // The "Review & Save" banner button: jump to the Install step and scroll the
    // Save / Generate button into view so it can't be missed on small screens.
    function reviewAndSave() {
      goToStep(7);
      setTimeout(() => {
        const btn = document.getElementById('btnGenerate');
        if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 250);
    }

    // Persist the heavy stream settings (addons + format) server-side in Redis
    // keyed by the user's hash, so they survive reloads, device switches and
    // re-pushes and keep the install token small. Normal saves are deliberately
    // non-blocking; an install can opt into awaiting this request so an opaque
    // account token is updated before its manifest is installed.
    // Cloudflare Turnstile (managed mode: invisible, validates in the
    // background and only interrupts if challenged). Active only when the
    // server injects a site key (hosted dev/prod carry their own widget keys
    // via TURNSTILE_SITE_KEY). Without a key no Cloudflare JS is ever loaded
    // and saves go out exactly as before (self-hosters unaffected).
    let turnstileWidgetId = null;
    let turnstileLoading = null;
    let turnstilePendingResolve = null;
    function ensureTurnstile() {
      const siteKey = window.__TURNSTILE_SITE_KEY__ || '';
      if (!siteKey) return Promise.resolve(false);
      if (turnstileLoading) return turnstileLoading;
      turnstileLoading = new Promise((resolve) => {
        const mount = () => {
          try {
            let holder = document.getElementById('turnstileHolder');
            if (!holder) {
              holder = document.createElement('div');
              holder.id = 'turnstileHolder';
              holder.style.display = 'none';
              document.body.appendChild(holder);
            }
            turnstileWidgetId = window.turnstile.render(holder, {
              sitekey: siteKey,
              size: 'invisible',
              action: 'save-config',
              callback: (token) => {
                if (turnstilePendingResolve) {
                  const done = turnstilePendingResolve;
                  turnstilePendingResolve = null;
                  done(token || '');
                }
              },
              'expired-callback': () => {
                if (turnstilePendingResolve) {
                  const done = turnstilePendingResolve;
                  turnstilePendingResolve = null;
                  done('');
                }
              },
              'error-callback': () => {
                if (turnstilePendingResolve) {
                  const done = turnstilePendingResolve;
                  turnstilePendingResolve = null;
                  done('');
                }
              },
            });
            resolve(true);
          } catch { resolve(false); }
        };
        if (window.turnstile) return mount();
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
        script.async = true;
        script.defer = true;
        script.onload = mount;
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
      });
      return turnstileLoading;
    }
    // Fail-open on the client: if the widget can't load or execute (offline,
    // blocked CDN), the save still goes out and the server decides.
    function fetchTurnstileToken() {
      return ensureTurnstile().then((ready) => {
        if (!ready || !window.turnstile || turnstileWidgetId === null || turnstileWidgetId === undefined) return '';
        return new Promise((resolve) => {
          turnstilePendingResolve = resolve;
          try {
            window.turnstile.execute(turnstileWidgetId);
          } catch {
            turnstilePendingResolve = null;
            resolve('');
            return;
          }
          setTimeout(() => {
            if (turnstilePendingResolve) {
              turnstilePendingResolve = null;
              resolve('');
            }
          }, 15000);
        });
      });
    }
    function resetTurnstile() {
      try {
        if (window.turnstile && turnstileWidgetId !== null && turnstileWidgetId !== undefined) {
          window.turnstile.reset(turnstileWidgetId);
        }
      } catch { /* a failed reset must never break the save flow */ }
    }

    function saveConfigToServer(cfg, { wait = false } = {}) {
      if (!cfg || typeof cfg !== 'object') return Promise.resolve({ ok: true, skipped: true });
      // The install token intentionally omits the heavy/variable stream settings
      // (custom formatter templates, custom streams, stream addons): they'd
      // blow up the URL. Re-add them here so the server-side store has them for
      // the addon to merge back in. Always set them (even empty) so clearing
      // sticks.
      const serverCfg = { ...cfg };
      if (document.getElementById('streamPreset')?.value === 'custom') {
        const nameT = document.getElementById('streamNameTemplate')?.value.trim();
        const descT = document.getElementById('streamDescTemplate')?.value.trim();
        if (nameT) serverCfg.streamNameTemplate = nameT;
        if (descT) serverCfg.streamDescTemplate = descT;
      }
      serverCfg.customStreams = customStreams;
      serverCfg.streamAddons = streamAddons;
      const badgePack = window._badgePicker?.get();
      serverCfg.nuvioBadgePack = badgePack?.pack || 'lelibrary-premium';
      serverCfg.nuvioBadgeUrl = badgePack?.url || '';
      // Always send the toggle ('tt' or '') so an untick clears the server-side
      // value and the change takes effect without re-pushing the link.
      serverCfg.libraryIdMode = (document.getElementById('libraryIdMode') && document.getElementById('libraryIdMode').checked) ? 'tt' : '';
      // Stream notices toggle ('on'/'off', default on): always sent so an
      // untick sticks server-side without re-pushing the link.
      serverCfg.streamNotices = (document.getElementById('streamNotices') && !document.getElementById('streamNotices').checked) ? 'off' : 'on';
      // Heavy filter / collection state lives in Redis, not the token
      serverCfg.filterResolutions = [...filterState.resIncluded];
      serverCfg.filterResOrder = filterState.resolutions.slice();
      serverCfg.filterQualities = [...filterState.qualities];
      serverCfg.filterSources = [...filterState.sources];
      serverCfg.filterCodecs = [...filterState.codecs];
      serverCfg.filterHdr = [...filterState.hdr];
      serverCfg.filterAudio = [...filterState.audio];
      serverCfg.filterMinSize = parseFloat(document.getElementById('filterMinSize')?.value) || 0;
      serverCfg.filterMaxSize = parseFloat(document.getElementById('filterMaxSize')?.value) || 0;
      serverCfg.filterCachedOnly = !!(document.getElementById('filterCachedOnly') && document.getElementById('filterCachedOnly').checked);
      serverCfg.nuvioCollectionPacks = Array.isArray(nuvioCollectionPacks) ? nuvioCollectionPacks.slice() : [];
      serverCfg.nuvioCollectionOverrides = nuvioCollectionOverrides ? JSON.parse(JSON.stringify(nuvioCollectionOverrides)) : {};
      serverCfg.importedRows = Array.isArray(importedRows) ? JSON.parse(JSON.stringify(importedRows)) : [];
      serverCfg.libraryCatalogs = Array.isArray(libraryCatalogs) ? libraryCatalogs.slice() : [];
      serverCfg.libHomeHidden = Array.isArray(libHomeHidden) ? libHomeHidden.slice() : [];
      try {
        // For an opaque account token the URL doesn't carry the config, so pass
        // the token id so the server can persist the full config to the account
        // row. Legacy base64 tokens skip this (their config lives in the URL).
        const pathToken = currentToken();
        const body = { config: serverCfg, warmCollections: wait };
        if (pathToken && pathToken !== 'configure' && pathToken.length <= 64) body.token = pathToken;
        // Anonymous/legacy saves carry a fresh managed-mode token when the
        // widget is active; the token is single-use so the widget resets after
        // every attempt and the next save executes a new challenge.
        const request = fetchTurnstileToken().then((tsToken) => {
          if (tsToken) body['cf-turnstile-response'] = tsToken;
          return fetch('/api/save-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        }).then(async (response) => {
          resetTurnstile();
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data?.ok === false) throw new Error(data?.error || 'Could not save your configuration');
          return data;
        }, (err) => { resetTurnstile(); throw err; });
        if (!wait) request.catch(() => {});
        return request;
      } catch (err) {
        return wait ? Promise.reject(err) : Promise.resolve({ ok: false });
      }
    }

    // Build the TRIMMED config object that goes into the token (only
    // non-default / non-empty values). Used by both generate() and the push
    // flow so the token stays well under the 2048-char server limit: the full
    // form state (getCurrentConfig) would blow past it for 4 providers.
    function buildSavedConfig() {
      const KEY_FIELD = { torbox: 'torboxApiKey', realdebrid: 'rdApiKey', alldebrid: 'adApiKey', premiumize: 'pmApiKey' };
      const provider = document.getElementById('provider').value;
      const tmdbApiKey = document.getElementById('tmdbApiKey').value.trim();
      const rdCatalog = document.getElementById('rdCatalog').value;
      const sortBy = document.getElementById('sortBy').value;
      const lang = document.getElementById('lang').value;
      const posterProvider = document.getElementById('posterProvider').value;
      const erdbToken = document.getElementById('erdbToken').value.trim();
      const rpdbKey = document.getElementById('rpdbKey').value.trim();
      const fanartKey = document.getElementById('fanartKey').value.trim();
      const omdbKey = document.getElementById('omdbKey').value.trim();
      const enhanceBackground = document.getElementById('enhanceBackground').checked;
      const enhanceLogo = document.getElementById('enhanceLogo').checked;
      const hideAnime = document.getElementById('hideAnime').checked;

      const cfg = { provider, tmdbApiKey, sortBy, lang, rdCatalog };
      for (const id of getProviderSet()) {
        const el = document.getElementById(KEY_FIELD[id]);
        const key = (el && el.value.trim()) || '';
        if (key) cfg[KEY_FIELD[id]] = key;
      }
      if (posterProvider) {
        cfg.posterProvider = posterProvider;
        if (posterProvider === 'erdb' && erdbToken) cfg.erdbToken = erdbToken;
        else if (posterProvider === 'rpdb' && rpdbKey) cfg.rpdbKey = rpdbKey;
        else if (posterProvider === 'fanart' && fanartKey) cfg.fanartKey = fanartKey;
        if (posterProvider === 'erdb' || posterProvider === 'rpdb') {
          cfg.enhanceBackground = enhanceBackground;
          cfg.enhanceLogo = enhanceLogo;
        }
      }
      if (omdbKey) cfg.omdbKey = omdbKey;
      const mdblistKey = document.getElementById('mdblistKey')?.value.trim();
      if (mdblistKey) cfg.mdblistKey = mdblistKey;
      if (catNames.movies && catNames.movies !== '🎬 My Movies') cfg.catNameMovies = catNames.movies;
      if (catNames.series && catNames.series !== '📺 My Series') cfg.catNameSeries = catNames.series;
      if (catNames.anime && catNames.anime !== '🍥 LeLibrary Anime') cfg.catNameAnime = catNames.anime;
      if (Object.keys(libraryNames).length) cfg.libraryNames = { ...libraryNames };
      if (Object.keys(watchlistNames).length) cfg.watchlistNames = { ...watchlistNames };
      if (watchlistHomeHidden.length) cfg.watchlistHomeHidden = watchlistHomeHidden.slice();
      if (hideAnime) cfg.hideAnime = true;
      if (document.getElementById('libraryIdMode') && document.getElementById('libraryIdMode').checked) cfg.libraryIdMode = 'tt';
      // Heavy collections / filter state lives in Redis (via saveConfigToServer), not the token, so the URL stays small.
      // Keep the token minimal: provider keys, TMDB, language, etc. only.
      const streamPreset = document.getElementById('streamPreset').value;
      if (streamPreset && streamPreset !== 'lelibrary') {
        // Only the preset id goes in the token: the custom templates are saved
        // server-side (see saveConfigToServer) and merged back by the addon, so
        // a long custom formatter can't blow up the install URL.
        cfg.streamPreset = streamPreset;
      }
      // Streams 2.0: discovery filter + sort settings (small, stays in token)
      const streamSort = document.getElementById('streamSort')?.value;
      if (streamSort) cfg.streamSort = streamSort;
      const streamFilters = {};
      const sminQ = document.getElementById('streamMinQuality')?.value;
      const smaxQ = document.getElementById('streamMaxQuality')?.value;
      const sminGB = parseFloat(document.getElementById('streamMinSizeGB')?.value) || 0;
      if (sminQ) streamFilters.minQuality = sminQ;
      if (smaxQ) streamFilters.maxQuality = smaxQ;
      if (sminGB > 0) streamFilters.minSizeGB = sminGB;
      if (document.getElementById('streamCachedOnly')?.checked) streamFilters.cachedOnly = true;
      if (document.getElementById('streamExcludeLow')?.checked) streamFilters.excludeQualities = ['CAM', 'TS'];
      if (Object.keys(streamFilters).length) cfg.streamFilters = streamFilters;
      if (catSelection.trendingMovies) cfg.catalogTrendingMovies = true;
      if (catSelection.trendingSeries) cfg.catalogTrendingSeries = true;
      if (catSelection.popularMovies) cfg.catalogPopularMovies = true;
      if (catSelection.popularSeries) cfg.catalogPopularSeries = true;
      if (!catSelection.movies) cfg.catalogMovies = false;
      if (!catSelection.series) cfg.catalogSeries = false;
      if (!catSelection.anime) cfg.catalogAnime = false;
      if (!catSelection.franchises) cfg.catalogFranchises = false;
      // Keep false explicit: a previous pinned Nuvio collection must be
      // actively unpinned after save/reload, not left to a stale default.
      cfg.pinCollections = document.getElementById('pinCollections')?.checked === true;
      if (catNames.trendingMovies && catNames.trendingMovies !== '🔥 Trending Movies') cfg.trendingMoviesName = catNames.trendingMovies;
      if (catNames.trendingSeries && catNames.trendingSeries !== '🔥 Trending Series') cfg.trendingSeriesName = catNames.trendingSeries;
      if (catNames.popularMovies && catNames.popularMovies !== '⭐ Popular Movies') cfg.popularMoviesName = catNames.popularMovies;
      if (catNames.popularSeries && catNames.popularSeries !== '⭐ Popular Series') cfg.popularSeriesName = catNames.popularSeries;
      if (catNames.franchises && catNames.franchises !== 'LeLibrary Collections') cfg.collectionsName = catNames.franchises;
      if (catOrder && JSON.stringify(catOrder) !== JSON.stringify(DEFAULT_CAT_ORDER)) cfg.catalogOrder = catOrder.slice();
      // Stream/filter heavy state is now in Redis (saveConfigToServer), not the token — keeps the URL tiny.
      // Notices are also in Redis; the token stays minimal.
      return cfg;
    }

    const PROVIDER_META = {
      torbox: { label: 'TorBox', logo: '/provider-logos/torbox.png' },
      realdebrid: { label: 'Real-Debrid', logo: '/provider-logos/realdebrid.svg' },
      alldebrid: { label: 'AllDebrid', logo: '/provider-logos/alldebrid.png' },
      premiumize: { label: 'Premiumize', logo: '/provider-logos/premiumize.svg' },
    };

    function toggleCollCard(header) {
      const body = header.nextElementSibling;
      const arrow = header.querySelector('.coll-arrow');
      if (body) body.classList.toggle('open');
      if (arrow) arrow.classList.toggle('open');
    }

    function getProviderSet() {
      const v = document.getElementById('provider').value;
      if (!v || v === 'none') return [];
      if (v === 'both') return ['torbox', 'realdebrid'];
      return v.split(',').map(s => s.trim()).filter(Boolean);
    }

    function toggleProviderCard(id) {
      const set = new Set(getProviderSet());
      if (set.has(id)) set.delete(id); else set.add(id);
      const arr = [...set];
      // Keep legacy 'both' for the exact TorBox+Real-Debrid combo; otherwise a
      // comma-separated list (the server normalizes both).
      document.getElementById('provider').value =
        arr.length === 0 ? 'none'
        : arr.length === 2 && arr.includes('torbox') && arr.includes('realdebrid') ? 'both'
        : arr.join(',');
      onProviderChange();
      checkChanged();
    }

    function updateSetupSummary() {
      const set = getProviderSet();
      const chips = set.map(id => `<span class="chip"><img src="${PROVIDER_META[id].logo}" alt="" />${PROVIDER_META[id].label}</span>`).join('');
      document.getElementById('setupChips').innerHTML = chips || '<span class="chip dim">No provider set</span>';
      document.getElementById('setupCount').textContent = set.length + '/4 providers';

      const catMode = document.getElementById('rdCatalog').value;
      document.getElementById('setupCatalogMode').textContent = set.length < 2 ? '-' : catMode === 'separate' ? 'Separate' : 'Merged';

      const tmdb = document.getElementById('tmdbApiKey').value.trim();
      document.getElementById('setupTmdb').textContent = !tmdb ? 'Not set' : looksLikeV4Token(tmdb) ? '⚠️ v4: use v3' : '✓ Set';

      const posters = { '': 'TMDB', erdb: 'ERDB', rpdb: 'RPDB', betterposter: 'BetterPosters', fanart: 'Fanart.tv' };
      document.getElementById('setupPoster').textContent = posters[document.getElementById('posterProvider').value] || 'TMDB';

      const presetVal = document.getElementById('streamPreset').value;
      document.getElementById('setupFormat').textContent = PRESET_LABELS[presetVal] || (presetVal === 'custom' ? 'Custom' : 'LeLibrary');

      document.getElementById('setupStreams').textContent = customStreams.length ? `${customStreams.length} added` : 'None';

    }

    function onHideAnimeChange() {
      checkChanged();
    }

    function onPosterChange() {
      const val = document.getElementById('posterProvider').value;
      document.getElementById('erdbField').style.display = val === 'erdb' ? 'flex' : 'none';
      document.getElementById('rpdbField').style.display = val === 'rpdb' ? 'flex' : 'none';
      document.getElementById('fanartField').style.display = val === 'fanart' ? 'flex' : 'none';
      document.getElementById('betterposterField').style.display = val === 'betterposter' ? 'flex' : 'none';
      document.getElementById('posterToggles').style.display = (val === 'erdb' || val === 'rpdb') ? 'flex' : 'none';
      updatePosterPreview();
      checkChanged();
    }

    function updatePosterPreview() {
      const provider = document.getElementById('posterProvider').value;
      const samples = { erdb: { url: () => {
        const t = document.getElementById('erdbToken').value.trim();
        return t ? `https://easyratingsdb.com/${encodeURIComponent(t)}/poster/tt0133093.jpg` : null;
      }, label: 'ERDB' }, rpdb: { url: () => {
        const k = document.getElementById('rpdbKey').value.trim();
        return k ? `https://api.ratingposterdb.com/${encodeURIComponent(k)}/imdb/poster-default/tt0133093.jpg?fallback=true` : null;
      }, label: 'RPDB' }, betterposter: { url: () => 'https://btttr.cc/poster/imdb/poster-default/tt0114709.jpg', label: 'BetterPoster' }, fanart: { url: () => null, label: 'Fanart.tv' } };
      const s = samples[provider];
      let html;
      if (!provider) {
        html = '<span>Select a poster service above<br>to see a live preview</span>';
      } else if (provider === 'fanart') {
        html = '<span style="font-size:0.78rem;color:var(--muted)">Fanart.tv doesn\'t embed ratings on posters -<br>configure a service above to preview</span>';
      } else if (!s || !s.url()) {
        html = `<span>Enter your ${s.label} key above<br>to see a live preview</span>`;
      } else {
        html = `<img src="${s.url()}" alt="Poster preview" style="max-width:150px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.3)" onerror="this.parentElement.innerHTML='<span style=color:var(--error);font-size:0.78rem>Preview failed: invalid key?</span>'" />`;
      }
      document.getElementById('sidebarPosterPreview').innerHTML = html;
      document.getElementById('mobilePosterPreview').innerHTML = html;
    }

    function onProviderChange() {
      const set = getProviderSet();
      const hasTB = set.includes('torbox');
      const hasRD = set.includes('realdebrid');
      const hasAD = set.includes('alldebrid');
      const hasPM = set.includes('premiumize');
      document.getElementById('tbCard').classList.toggle('active', hasTB);
      document.getElementById('rdCard').classList.toggle('active', hasRD);
      document.getElementById('adCard').classList.toggle('active', hasAD);
      document.getElementById('pmCard').classList.toggle('active', hasPM);
      document.getElementById('tbKeyField').style.display = hasTB ? 'flex' : 'none';
      document.getElementById('rdKeyField').style.display = hasRD ? 'flex' : 'none';
      document.getElementById('adKeyField').style.display = hasAD ? 'flex' : 'none';
      document.getElementById('pmKeyField').style.display = hasPM ? 'flex' : 'none';
      document.getElementById('tbReq').textContent = hasTB ? '*' : '';
      document.getElementById('rdReq').textContent = hasRD ? '*' : '';
      document.getElementById('adReq').textContent = hasAD ? '*' : '';
      document.getElementById('pmReq').textContent = hasPM ? '*' : '';
      document.getElementById('catalogModeSection').style.display = set.length >= 2 ? 'block' : 'none';
      updateSetupSummary();
      checkChanged();
    }

    function getCurrentConfig() {
      return {
        provider: document.getElementById('provider').value,
        torboxApiKey: document.getElementById('torboxApiKey').value.trim(),
        rdApiKey: document.getElementById('rdApiKey').value.trim(),
        adApiKey: document.getElementById('adApiKey').value.trim(),
        pmApiKey: document.getElementById('pmApiKey').value.trim(),
        tmdbApiKey: document.getElementById('tmdbApiKey').value.trim(),
        rdCatalog: document.getElementById('rdCatalog').value,
        sortBy: document.getElementById('sortBy').value,
        lang: document.getElementById('lang').value,
        searchScope: document.getElementById('searchScope')?.value || 'combined',
        posterProvider: document.getElementById('posterProvider').value,
        erdbToken: document.getElementById('erdbToken').value.trim(),
        rpdbKey: document.getElementById('rpdbKey').value.trim(),
        fanartKey: document.getElementById('fanartKey').value.trim(),
        omdbKey: document.getElementById('omdbKey').value.trim(),
        mdblistKey: (document.getElementById('mdblistKey')?.value || '').trim(),
        enhanceBackground: document.getElementById('enhanceBackground').checked,
        enhanceLogo: document.getElementById('enhanceLogo').checked,
        customStreams: customStreams,
        catNameMovies: catNames.movies,
        catNameSeries: catNames.series,
        catNameAnime: catNames.anime,
        hideAnime: document.getElementById('hideAnime').checked,
        streamPreset: document.getElementById('streamPreset').value,
        streamNameTemplate: document.getElementById('streamNameTemplate').value,
        streamDescTemplate: document.getElementById('streamDescTemplate').value,
        nuvioBadgePack: window._badgePicker?.get().pack || 'lelibrary-premium',
        nuvioBadgeUrl: window._badgePicker?.get().url || '',
        streamSort: document.getElementById('streamSort')?.value || '',
        streamFilters: {
          minQuality: document.getElementById('streamMinQuality')?.value || '',
          maxQuality: document.getElementById('streamMaxQuality')?.value || '',
          minSizeGB: parseFloat(document.getElementById('streamMinSizeGB')?.value) || 0,
          cachedOnly: !!(document.getElementById('streamCachedOnly') && document.getElementById('streamCachedOnly').checked),
          excludeLow: !!(document.getElementById('streamExcludeLow') && document.getElementById('streamExcludeLow').checked),
        },
        catalogTrendingMovies: catSelection.trendingMovies,
        catalogTrendingSeries: catSelection.trendingSeries,
        catalogPopularMovies: catSelection.popularMovies,
        catalogPopularSeries: catSelection.popularSeries,
        catalogMovies: catSelection.movies,
        catalogSeries: catSelection.series,
        catalogAnime: catSelection.anime,
        catalogFranchises: catSelection.franchises,
        pinCollections: document.getElementById('pinCollections')?.checked === true,
        libraryIdMode: !!(document.getElementById('libraryIdMode') && document.getElementById('libraryIdMode').checked) ? 'tt' : '',
        libraryCatalogs: libraryCatalogs.slice(),
        libHomeHidden: libHomeHidden.slice(),
        watchlistNames: { ...watchlistNames },
        watchlistHomeHidden: watchlistHomeHidden.slice(),
        nuvioCollectionPacks: nuvioCollectionPacks.slice(),
        nuvioCollectionOverrides: JSON.parse(JSON.stringify(nuvioCollectionOverrides)),
        importedRows: JSON.parse(JSON.stringify(importedRows)),
        trendingMoviesName: catNames.trendingMovies,
        trendingSeriesName: catNames.trendingSeries,
        popularMoviesName: catNames.popularMovies,
        popularSeriesName: catNames.popularSeries,
        collectionsName: catNames.franchises,
        catalogOrder: catOrder.slice(),
        streamAddons: streamAddons,
        filterResolutions: [...filterState.resIncluded],
        filterResOrder: filterState.resolutions.slice(),
        filterQualities: [...filterState.qualities],
        filterSources: [...filterState.sources],
        filterCodecs: [...filterState.codecs],
        filterHdr: [...filterState.hdr],
        filterAudio: [...filterState.audio],
        filterMinSize: parseFloat(document.getElementById('filterMinSize')?.value) || 0,
        filterMaxSize: parseFloat(document.getElementById('filterMaxSize')?.value) || 0,
        filterCachedOnly: !!(document.getElementById('filterCachedOnly') && document.getElementById('filterCachedOnly').checked),
        streamNotices: (document.getElementById('streamNotices') && !document.getElementById('streamNotices').checked) ? 'off' : 'on',
      };
    }

    // Canonical equality: both sides are always produced by getCurrentConfig()
    // (initialConfig is assigned from it), so JSON snapshots have identical
    // key order and a plain string compare is exact. The old hand-maintained
    // field list kept missing persisted fields (stream filters, library rows,
    // collection packs, imports...) which left changes undetected and hid the
    // Save button while users believed their setup had been saved.
    function configsEqual(a, b) {
      return JSON.stringify(a || {}) === JSON.stringify(b || {});
    }

    function hasUnsavedConfigChanges() {
      return !!initialConfig && !configsEqual(getCurrentConfig(), initialConfig);
    }

    function checkChanged() {
      saveDraft();
      updateSetupSummary();
      try{ if(typeof updateManualSetupLinks==='function') updateManualSetupLinks(); }catch{}
      if (typeof updateCataloguesUI === 'function') updateCataloguesUI();
      if (!initialConfig) return;
      const changed = hasUnsavedConfigChanges();
      const btn = document.getElementById('btnGenerate');
      const banner = document.getElementById('unsavedBanner');
      banner.style.display = changed ? 'flex' : 'none';
      updateInstallPushHint();
      if (hasExistingToken) {
        btn.style.display = changed ? '' : 'none';
      } else {
        if (changed && btn.style.display === 'none') {
          btn.style.display = '';
        } else if (!changed && btn.style.display !== 'none') {
          btn.style.display = 'none';
          document.getElementById('btnDesktop').classList.remove('show');
          document.getElementById('btnWeb').classList.remove('show');
          document.getElementById('btnNuvio').classList.remove('show');
          document.getElementById('urlRow').classList.remove('show');
          document.getElementById('manifestUrl').textContent = '';
        }
      }
    }

    function closeReinstallModal() {
      document.getElementById('reinstallModal').style.display = 'none';
    }

    function copyModalUrl() {
      const url = document.getElementById('modalManifestUrl').textContent;
      copyText(url, 'URL copied!');
    }

    // Copy with a fallback for non-HTTPS (LAN) contexts where the async
    // Clipboard API is unavailable, plus feedback on failure.
    function copyText(text, okMsg) {
      const done = () => showToast(okMsg || 'Copied!', 'success');
      const fail = () => showToast('Copy failed: select the text and copy manually', 'error');
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done).catch(fail);
        return;
      }
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? done() : fail();
      } catch { fail(); }
    }

    function showToast(msg, type) {
      if (window.LeToast) {
        return LeToast.show(msg, type || 'info');
      } else {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2200);
        return t;
      }
    }

    function addCustomStream() {
      const name = document.getElementById('csName').value.trim();
      const url  = document.getElementById('csUrl').value.trim();
      const type = document.getElementById('csType').value;
      if (!name || !url) { showToast('Enter a name and URL'); return; }
      customStreams.push({ name, url, type });
      document.getElementById('csName').value = '';
      document.getElementById('csUrl').value = '';
      renderCustomStreams();
      checkChanged();
    }

    function removeCustomStream(i) {
      customStreams.splice(i, 1);
      renderCustomStreams();
      checkChanged();
    }

    function renderCustomStreams() {
      const container = document.getElementById('customStreamsList');
      const empty = document.getElementById('csEmpty');
      if (customStreams.length === 0) {
        container.innerHTML = '';
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';
      container.innerHTML = customStreams.map((cs, i) =>
        `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;font-size:0.82rem">
          <span style="flex:1">${escHtml(cs.name)} <span style="color:var(--border2)">- ${escHtml(cs.url)}</span></span>
          <span style="font-size:0.7rem;padding:2px 8px;background:var(--surface);border-radius:4px;color:var(--border2)">${cs.type === '*' ? 'All' : cs.type}</span>
          <button class="btn-icon" type="button" onclick="removeCustomStream(${i})" style="width:30px;color:var(--error)" title="Remove">✕</button>
        </div>`
      ).join('');
    }

    function escHtml(s) {
      const d = document.createElement('div');
      d.textContent = s == null ? '' : String(s);
      // innerHTML round-tripping only escapes & < >. Also rewrite quotes so
      // the result is safe inside double/single-quoted HTML attributes
      // (value="...", onclick='...'): several callers rely on that.
      return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Produces a complete JS string literal ("...") that is safe to embed
    // inside a double-quoted HTML event-handler attribute. JSON-escape the
    // value first (handles quotes, backslashes, newlines), then HTML-escape
    // the resulting quote characters so they cannot terminate the attribute.
    // Use WITHOUT surrounding manual quotes: onclick="fn(${jsStr(v)})".
    function jsStr(v) {
      return escHtml(JSON.stringify(String(v == null ? '' : v)));
    }

    // Successful checks are remembered only for this browser session. We store
    // a SHA-256 fingerprint, never the API key itself; changing a key creates
    // a different fingerprint and therefore always verifies it again.
    const VALIDATION_SESSION_PREFIX = 'lelibrary:validated-key:v1:';
    async function validationFingerprint(service, key) {
      if (!window.crypto?.subtle || !window.TextEncoder) return null;
      const bytes = new TextEncoder().encode(`${service}:${key}`);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    async function wasValidatedThisSession(service, key) {
      try {
        const fingerprint = await validationFingerprint(service, key);
        return !!fingerprint && sessionStorage.getItem(VALIDATION_SESSION_PREFIX + fingerprint) === '1';
      } catch { return false; }
    }
    async function rememberValidatedKey(service, key) {
      try {
        const fingerprint = await validationFingerprint(service, key);
        if (fingerprint) sessionStorage.setItem(VALIDATION_SESSION_PREFIX + fingerprint, '1');
      } catch { /* Validation still works when sessionStorage is unavailable. */ }
    }

    async function verifyKey(service) {
      const inputMap = { tmdb: 'tmdbApiKey', torbox: 'torboxApiKey', realdebrid: 'rdApiKey', alldebrid: 'adApiKey', premiumize: 'pmApiKey', erdb: 'erdbToken', rpdb: 'rpdbKey', omdb: 'omdbKey', fanart: 'fanartKey' };
      const labels   = { tmdb: 'TMDB', torbox: 'TorBox', realdebrid: 'Real-Debrid', alldebrid: 'AllDebrid', premiumize: 'Premiumize', erdb: 'ERDB', rpdb: 'RPDB', omdb: 'OMDB', fanart: 'Fanart' };
      const id = inputMap[service];
      const el = document.getElementById(id);
      const btn = document.getElementById('verify' + service.charAt(0).toUpperCase() + service.slice(1));
      const val = el.value.trim();
      if (!val) { showToast('Enter a key first'); return; }
      if (await wasValidatedThisSession(service, val)) {
        btn.className = 'btn-verify verified';
        btn.textContent = '✓';
        el.classList.remove('invalid');
        showToast(labels[service] + ' key already validated this session', 'success');
        return;
      }
      btn.disabled = true;
      btn.textContent = '⏳';
      btn.className = 'btn-verify';
      try {
        const r = await fetch('/api/verify/' + service, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: val })
        });
        const d = await r.json();
        if (d.valid) {
          rememberValidatedKey(service, val);
          btn.className = 'btn-verify verified';
          btn.textContent = '✓';
          el.classList.remove('invalid');
          showToast(labels[service] + ' key is valid!', 'success');
        } else {
          btn.className = 'btn-verify failed';
          btn.textContent = '✕';
          el.classList.add('invalid');
          if (d.code === 'V4_ACCESS_TOKEN') {
            showV4Warning(true);
            showToast('TMDB v4 token detected: use your v3 API key');
          } else if (d.needPin) {
            // Premiumize device authorization required
            showPinModal(d.pin || '', d.deviceUrl || 'https://www.premiumize.me/device', service);
            btn.disabled = false;
            return;
          } else {
            showToast(d.error || 'Invalid key');
          }
        }
      } catch (e) {
        btn.className = 'btn-verify failed';
        btn.textContent = '✕';
        showToast('Verification failed');
      }
      btn.disabled = false;
    }

    // TMDB v4 Read Access Tokens are JWTs (eyJ….<segment>.<segment>).
    // v3 API keys are 32-char hex strings.
    function looksLikeV4Token(key) {
      return /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(key || '');
    }

    // Premiumize device authorization modal: shows the PIN and re-polls the
    // verify endpoint until the user has authorized the key.
    function showPinModal(pin, deviceUrl, service) {
      const existing = document.getElementById('pinModal');
      if (existing) existing.remove();
      const inputId = { premiumize: 'pmApiKey', alldebrid: 'adApiKey' }[service] || service + 'ApiKey';
      const overlay = document.createElement('div');
      overlay.id = 'pinModal';
      overlay.className = 'pin-overlay';
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
      overlay.innerHTML = `
        <div class="pin-box">
          <div class="pin-header">
            <h3>Authorize your ${escHtml(service)} key</h3>
            <button class="pin-close" onclick="this.closest('.pin-overlay').remove()" aria-label="Close">&times;</button>
          </div>
          <p>Premiumize needs you to authorize this key from a new device. Open the link and enter this PIN:</p>
          <div class="pin-code">${escHtml(pin)}</div>
          <a class="btn btn-amber" href="${escHtml(deviceUrl)}" target="_blank" rel="noopener">Open premiumize.me/device ↗</a>
          <button class="btn-load" id="pinRecheck">I've done it: recheck</button>
          <p class="pin-status" id="pinStatus"></p>
        </div>`;
      document.body.appendChild(overlay);
      const recheck = document.getElementById('pinRecheck');
      const status = document.getElementById('pinStatus');
      recheck.onclick = async () => {
        const val = (document.getElementById(inputId)?.value || '').trim();
        recheck.disabled = true;
        status.textContent = 'Checking…';
        try {
          const r = await fetch('/api/verify/' + service, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: val })
          });
          const d = await r.json();
          if (d.valid) {
            rememberValidatedKey(service, val);
            overlay.remove();
            const el = document.getElementById(inputId);
            if (el) el.classList.remove('invalid');
            const btn = document.getElementById('verify' + service.charAt(0).toUpperCase() + service.slice(1));
            if (btn) { btn.className = 'btn-verify verified'; btn.textContent = '✓'; }
            showToast(service + ' key is valid!', 'success');
          } else if (d.needPin) {
            status.textContent = 'Still waiting: have you entered the PIN on the Premiumize page?';
            recheck.disabled = false;
          } else {
            status.textContent = d.error || 'Invalid key';
            recheck.disabled = false;
          }
        } catch (e) {
          status.textContent = 'Could not reach the service: try again.';
          recheck.disabled = false;
        }
      };
    }

    function showV4Warning(show) {
      document.getElementById('tmdbV4Warning').style.display = show ? 'block' : 'none';
    }

    function checkTmdbKey() {
      const el = document.getElementById('tmdbApiKey');
      const isV4 = looksLikeV4Token(el.value.trim());
      showV4Warning(isV4);
      if (isV4) el.classList.add('invalid');
      else el.classList.remove('invalid');
    }

    async function generate(opts = {}) {
      const { skipVerify = false, skipSave = false, suppressReinstall = false } = opts;
      const provider     = document.getElementById('provider').value;
      if (provider === 'none' || provider === '') { showToast('Select at least one provider'); return; }
      const providerSet  = getProviderSet();
      const KEY_FIELD = { torbox: 'torboxApiKey', realdebrid: 'rdApiKey', alldebrid: 'adApiKey', premiumize: 'pmApiKey' };
      const torboxApiKey = document.getElementById('torboxApiKey').value.trim();
      const tmdbApiKey   = document.getElementById('tmdbApiKey').value.trim();
      const rdApiKey     = document.getElementById('rdApiKey').value.trim();
      const adApiKey     = document.getElementById('adApiKey').value.trim();
      const pmApiKey     = document.getElementById('pmApiKey').value.trim();
      const rdCatalog    = document.getElementById('rdCatalog').value;
      const sortBy       = document.getElementById('sortBy').value;
      const lang         = document.getElementById('lang').value;
      const posterProvider = document.getElementById('posterProvider').value;
      const erdbToken    = document.getElementById('erdbToken').value.trim();
      const rpdbKey      = document.getElementById('rpdbKey').value.trim();
      const fanartKey    = document.getElementById('fanartKey').value.trim();
      const omdbKey      = document.getElementById('omdbKey').value.trim();
      const enhanceBackground = document.getElementById('enhanceBackground').checked;
      const enhanceLogo  = document.getElementById('enhanceLogo').checked;
      const catNameMovies = catNames.movies;
      const catNameSeries = catNames.series;
      const catNameAnime  = catNames.anime;
      const hideAnime     = document.getElementById('hideAnime').checked;

      let valid = true;
      for (const id of providerSet) {
        const el = document.getElementById(KEY_FIELD[id]);
        const key = (el && el.value.trim()) || '';
        if (!key) { el?.classList.add('invalid'); valid = false; }
        else el?.classList.remove('invalid');
      }
      const tmdbEl = document.getElementById('tmdbApiKey');
      if (!tmdbApiKey) {
        tmdbEl.classList.add('invalid');
        valid = false;
      } else if (looksLikeV4Token(tmdbApiKey)) {
        // v4 Read Access Tokens expire: force users onto the v3 API key
        tmdbEl.classList.add('invalid');
        showV4Warning(true);
        valid = false;
      } else {
        tmdbEl.classList.remove('invalid');
        showV4Warning(false);
      }
      if (!valid) {
        if (!tmdbApiKey) showToast('Fill in the required fields');
        else if (looksLikeV4Token(tmdbApiKey)) showToast('TMDB v4 token detected: use your v3 API key');
        else showToast('Fill in the required fields');
        return;
      }

      const btn = document.getElementById('btnGenerate');
      const originalLabel = document.getElementById('genBtnTitle').textContent;
      const originalSmall = document.querySelector('#btnGenerate small').textContent;

      // Verify the required API keys before producing install links.
      // If a provider can't be reached (network), proceed anyway rather than
      // blocking a valid user on our own verification hiccup.
      if (!skipVerify) {
        const labels = { tmdb: 'TMDB', torbox: 'TorBox', realdebrid: 'Real-Debrid', alldebrid: 'AllDebrid', premiumize: 'Premiumize' };
        const checks = [];
        for (const id of providerSet) {
          const el = document.getElementById(KEY_FIELD[id]);
          checks.push({ service: id, key: (el && el.value.trim()) || '', el });
        }
        checks.push({ service: 'tmdb', key: tmdbApiKey, el: tmdbEl });

        btn.disabled = true;
        document.getElementById('genBtnTitle').textContent = 'Generating…';
        document.querySelector('#btnGenerate small').textContent = 'Validating your API keys';

        const results = await Promise.all(checks.map(async c => {
          if (await wasValidatedThisSession(c.service, c.key)) return { ...c, d: { valid: true, sessionCached: true } };
          return fetch('/api/verify/' + c.service, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: c.key })
          })
            .then(r => r.json().catch(() => ({ networkError: true })))
            .then(d => ({ ...c, d }))
            .catch(() => ({ ...c, d: { networkError: true } }));
        }));

        btn.disabled = false;
        document.getElementById('genBtnTitle').textContent = originalLabel;
        document.querySelector('#btnGenerate small').textContent = originalSmall;

        let allValid = true;
        for (const { el, d, service } of results) {
          if (d.valid) {
            if (!d.sessionCached) rememberValidatedKey(service, (el?.value || '').trim());
            el.classList.remove('invalid');
          } else if (d.networkError) {
            // Can't confirm: don't block
          } else if (d.needPin) {
            // Premiumize device authorization: show the PIN modal and wait
            btn.disabled = false;
            showPinModal(d.pin || '', d.deviceUrl || 'https://www.premiumize.me/device', service);
            return;
          } else {
            el.classList.add('invalid');
            allValid = false;
            if (d.code === 'V4_ACCESS_TOKEN') showV4Warning(true);
            showToast(labels[service] + ': ' + (d.error || 'invalid key'));
            break;
          }
        }
        if (!allValid) return;

        // All keys good: confirm before producing the links
        showToast('Keys validated ✓', 'success');
      }

      const cfg = buildSavedConfig();
      if (!skipSave) {
        saveConfigToServer(cfg);
        // A real Save/Push persisted the config: the in-progress draft is no
        // longer needed (the new token in the address bar carries it now).
        clearDraft();
      }

      const urls = buildUrls(cfg);
      lastUrls = urls;
      const { manifestUrl, stremioDeep, stremioWeb, nuvioDeep } = urls;

      // The server rejects tokens beyond ~2048 chars. Big imports (many
      // folders × artwork URLs) can silently cross the line: warn instead of
      // letting install/push fail later with a cryptic "descriptor too large".
      if (urls.encoded && urls.encoded.length > 2000) {
        showToast('This setup is very large: the install link may be rejected. Try removing imported collections or custom streams.', 'error');
      }

      // For existing installs, "Save" updates the address bar to the NEW token
      // so a refresh keeps these settings (previously the old token stayed in
      // the URL and your changes were silently lost on reload).
      if (hasExistingToken) {
        try { history.replaceState(null, '', `${window.location.origin}${configurePath(urls.encoded)}`); } catch {}
        refreshDraftToken(urls.encoded);
      }

      // Show the install links regardless (for both new and existing users)
      document.getElementById('manifestUrl').textContent = manifestUrl;
      document.getElementById('btnDesktop').href = stremioDeep;
      document.getElementById('btnWeb').href = stremioWeb;
      document.getElementById('btnNuvio').href = nuvioDeep;
      document.getElementById('btnDesktop').classList.add('show');
      document.getElementById('btnWeb').classList.add('show');
      document.getElementById('btnNuvio').classList.add('show');
      document.getElementById('urlRow').classList.add('show');
      try{ updateManualSetupLinks(); }catch{}

      if (hasExistingToken) {
        if (initialConfig && configsEqual(getCurrentConfig(), initialConfig)) {
          // No changes: just show links, no flashing, no modal
          document.getElementById('modalManifestUrl').textContent = manifestUrl;
          try{ updateManualSetupLinks(); }catch{}
          btn.disabled = false;
          document.getElementById('genBtnTitle').textContent = 'Save';
          return;
        }
        if (suppressReinstall) {
          // Load-time rebuild (e.g. after a draft was restored): point the URL
          // and links at the latest form state without nagging: the reinstall
          // modal appears when the user actually clicks Save.
          document.getElementById('modalManifestUrl').textContent = manifestUrl;
          try{ updateManualSetupLinks(); }catch{}
          btn.disabled = false;
          document.getElementById('genBtnTitle').textContent = 'Save';
          return;
        }
        // Changes detected: show modal
        document.getElementById('modalManifestUrl').textContent = manifestUrl;
        initialConfig = getCurrentConfig();
        document.getElementById('unsavedBanner').style.display = 'none';
        document.getElementById('btnGenerate').style.display = 'none';
        btn.disabled = false;
        document.getElementById('genBtnTitle').textContent = 'Save';
        if (streamAddons.length > 0) {
          document.getElementById('modalReinstallText').innerHTML =
            `You have configured ${streamAddons.length} stream addon${streamAddons.length > 1 ? 's' : ''}.<br>` +
            `<strong style="color:var(--text)">Save, then re-add the addon to Stremio / Nuvio</strong> for these changes to apply.`;
        } else {
          document.getElementById('modalReinstallText').innerHTML =
            `Your config token has changed.<br><strong style="color:var(--text)">Reinstall the addon</strong> in Stremio or Nuvio to apply your new settings.`;
        }
        document.getElementById('reinstallModal').style.display = 'flex';
        return;
      }
      // New user: scroll to links
      initialConfig = getCurrentConfig();
      btn.disabled = false;
      document.getElementById('genBtnTitle').textContent = originalLabel;
      document.getElementById('btnDesktop').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function copyUrl(btn) {
      const url = document.getElementById('manifestUrl').textContent;
      // Delegate to the shared copy helper: the old inline fallback treated
      // execCommand('copy') returning false (its failure signal) as success.
      copyText(url, 'URL copied!');
      flashCopied(btn);
    }

    function flashCopied(btn) {
      const original = btn.textContent;
      btn.textContent = 'Copied';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 1600);
    }

    function resetForm() {
      clearDraft();
      // Don't let Reset's own change handlers re-save an empty draft: a reload
      // right after Reset should bring back the token config, not a blank form.
      draftSuppressUntil = Date.now() + 1000;
      ['torboxApiKey', 'rdApiKey', 'adApiKey', 'pmApiKey', 'tmdbApiKey', 'erdbToken', 'rpdbKey', 'fanartKey', 'omdbKey'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = '';
        el.classList.remove('invalid');
      });
      showV4Warning(false);
      document.getElementById('provider').value = 'none';
      document.getElementById('lang').value = 'en-US';
      document.getElementById('sortBy').value = 'data_adicao';
      document.getElementById('rdCatalog').value = 'merge';
      document.getElementById('posterProvider').value = '';
      document.getElementById('enhanceBackground').checked = false;
      document.getElementById('enhanceLogo').checked = false;
      document.getElementById('hideAnime').checked = false;
      customStreams = [];
      renderCustomStreams();
      onPosterChange();
      updatePosterPreview();
      document.getElementById('catalogModeSection').style.display = 'block';
      document.getElementById('btnDesktop').classList.remove('show');
      document.getElementById('btnWeb').classList.remove('show');
      document.getElementById('btnNuvio').classList.remove('show');
      document.getElementById('urlRow').classList.remove('show');
      document.getElementById('manifestUrl').textContent = '';
      hasExistingToken = false;
      document.getElementById('genBtnTitle').textContent = 'Generate install links';
      document.querySelector('#btnGenerate small').textContent = 'Create links with your keys';
      document.getElementById('btnGenerate').style.display = '';
      document.getElementById('unsavedBanner').style.display = 'none';
      initialConfig = null;
      onProviderChange();
      goToStep(1);
    }

    const APP_VERSION = '4.9.0';

    async function checkVersion() {
      const el = document.getElementById('versionDisplay');
      try {
        const r = await fetch('https://api.github.com/repos/leleasley/LeLibrary/releases/latest', {
          headers: { 'Accept': 'application/vnd.github.v3+json' },
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        const latest = (data.tag_name || '').replace(/^v/, '');
        if (!latest) throw new Error('No tag');
        if (latest !== APP_VERSION) {
          el.textContent = `📢 v${latest}`;
          el.style.color = 'var(--amber)';
          el.title = `v${latest} available: update on GitHub`;
          el.onclick = () => window.open('https://github.com/leleasley/LeLibrary/releases', '_blank');
          el.style.cursor = 'pointer';
        } else {
          el.textContent = `v${APP_VERSION}`;
        }
      } catch (e) {
        el.textContent = `v${APP_VERSION}`;
      }
    }

    // Password-locked opaque token: keep the normal configure page underneath a
    // focused modal. A successful unlock uses the returned config in memory and
    // fades the modal away, so the user never lands on a second locked screen.
    function showTokenLockScreen() {
      const tokenId = window.__TOKEN_ID__ || '';
      document.body.classList.add('token-locked');
      const backdrop = document.createElement('div');
      backdrop.className = 'token-lock-backdrop';
      backdrop.innerHTML = `
        <div class="token-lock-modal" role="dialog" aria-modal="true" aria-labelledby="tokenLockTitle">
          <div class="token-lock-icon">🔒</div>
          <h1 id="tokenLockTitle">Unlock configuration</h1>
          <p>Enter the password to view and edit this setup.</p>
          <form id="tokenLockForm" data-form-type="other">
            <label class="token-lock-label" for="tokenLockPassword">Password</label>
            <input type="password" id="tokenLockPassword" placeholder="Enter password" autocomplete="off" autofocus data-lpignore="true" data-1p-ignore data-bitwarden-manually-managed="true" />
            <p id="tokenLockError" class="token-lock-error" role="alert" aria-live="polite"></p>
            <button type="submit" class="token-lock-button" id="tokenLockBtn">Unlock</button>
          </form>
        </div>`;
      document.body.appendChild(backdrop);
      window.submitTokenLock = async () => {
        const pw = document.getElementById('tokenLockPassword').value;
        const err = document.getElementById('tokenLockError');
        const btn = document.getElementById('tokenLockBtn');
        if (!pw) {
          err.textContent = 'Enter your password';
          err.classList.add('visible');
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Checking…';
        err.classList.remove('visible');
        try {
          const res = await fetch(`/api/token/${encodeURIComponent(tokenId)}/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw }),
          });
          if (res.status === 200) {
            const data = await res.json();
            window.__INITIAL_CONFIG__ = data.config || {};
            window.__TOKEN_LOCKED__ = false;
            showToast('Password valid', 'success');
            backdrop.classList.add('unlocked');
            setTimeout(() => {
              backdrop.remove();
              document.body.classList.remove('token-locked');
              // Re-run the normal page initialization now that the config has
              // been supplied. The first pass returned at the lock guard.
              document.dispatchEvent(new Event('DOMContentLoaded'));
            }, 420);
            return;
          }
          err.textContent = res.status === 403 ? 'Password incorrect' : 'Could not unlock this configuration';
          err.classList.add('visible');
          document.getElementById('tokenLockPassword')?.select();
        } catch (e) {
          err.textContent = 'Could not reach the server. Try again.';
          err.classList.add('visible');
        }
        btn.disabled = false;
        btn.textContent = 'Unlock';
      };
      document.getElementById('tokenLockForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        window.submitTokenLock();
      });
      setTimeout(() => document.getElementById('tokenLockPassword')?.focus(), 0);
    }

    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('versionDisplay').textContent = `v${APP_VERSION}`;

      // Self-hosted installs have no account area: hide account-only nav and
      // links so the page is clean for self-hosters. (window.__HOSTED__ is
      // injected server-side; defaults to true when absent for safety.)
      if (window.__HOSTED__ === false) {
        for (const sel of ['#accountLink', 'a[href="/account"]']) {
          const els = document.querySelectorAll(sel);
          els.forEach((el) => { el.style.display = 'none'; });
        }
        const acctP = document.querySelector('.form-header p a[href="/account"]');
        if (acctP) {
          const parent = acctP.closest('p');
          if (parent) parent.innerHTML = parent.innerHTML.replace(/: or <a href="\/account"[^>]*>[^<]*<\/a>/g, '');
        }
        // Load the self-host saved-configs list (hosted uses accounts instead).
        loadSavedConfigs();
        // Self-hosted instances have no status page (/api/status returns a
        // placeholder and /status redirects to /configure), so hide the pill
        // instead of polling it every 60s for a 0/0 readout.
        document.getElementById('navStatusPill')?.remove();
      }

      // A password-locked opaque token: show the unlock screen and stop the
      // wizard from loading. The config is only revealed after the password
      // POSTs to /api/token/:id/unlock.
      if (window.__TOKEN_LOCKED__) {
        showTokenLockScreen();
        return;
      }

      checkVersion();
      if (window.__HOSTED__ !== false) {
        loadStatusPill();
        setInterval(loadStatusPill, 60000);
      }
      renderAllFilterChips();
      renderCataloguesOptions();
      renderStreamAddons();
      renderConnectAll();
      goToStep(1);
      loadLibCatalogDefs();
      loadCuratedCollectionPacks();
      loadWatchlistsForConfigure();
      if (ACCOUNT_TOKEN) accountConnectionReady = restoreAccountConnect();
      if (restoreConnect()) {
        // Saved session: quietly validate it in the background
        renderConnectAll();
        verifyRestoredConnect();
      }
      // A Step 1 platform-only choice (no saved session) is restored too: make
      // sure the platform step + install panel reflect it.
      if (connectState.selectedPlatform) {
        renderPlatformStep();
        renderConnectAll();
      }
      const token = currentToken();
      const hasToken = token && token !== 'configure';
      hasExistingToken = hasToken;
      if (hasToken) {
        document.getElementById('btnRefresh').style.display = '';
        document.getElementById('genBtnTitle').textContent = 'Save';
        document.querySelector('#btnGenerate small').textContent = 'Save your config changes';
      }
      const sideLabel = hasToken ? 'Save' : 'Generate install links';
      document.getElementById('btnGenerateSide').textContent = sideLabel;

      mountBadgePicker();
      const cfg = window.__INITIAL_CONFIG__;
      if (cfg) {
        applyConfig(cfg);
        initialConfig = getCurrentConfig();
        if (hasToken) document.getElementById('btnGenerate').style.display = 'none';
      } else {
        initialConfig = null;
      }
      // From here on, every form change is snapshotted to sessionStorage so a
      // refresh / accidental reload keeps your work in progress. The draft is
      // cleared on Save / Push / Reset and expires after DRAFT_TTL.
      draftArmed = true;

      const finishLoad = () => {
        // Baseline = the token (+ server store) state as loaded. Kept separate
        // from the draft so any draft differences still show as unsaved.
        if (cfg) initialConfig = getCurrentConfig();
        // Restore any in-progress draft on top of the loaded token.
        const draft = loadDraft(currentToken());
        if (draft) {
          applyConfig(draft.config);
          if (!cfg) initialConfig = getCurrentConfig(); // fresh page: the draft is the baseline
        }
        if (!initialConfig) initialConfig = getCurrentConfig();
        updateSetupSummary();
        checkChanged();
        // Rebuild the install links from the final form state. On a token page
        // this also migrates the address-bar token to the compact format.
        if (cfg) {
          setTimeout(() => generate({ skipVerify: true, skipSave: true, suppressReinstall: true }), 100);
        }
      };

      if (cfg && hasToken) {
        // Pre-fill stream settings from the server-side store when the token
        // itself lacks them (they're saved to Redis on every Save/Push), then
        // restore any in-progress draft on top.
        fetch('/api/config/' + encodeURIComponent(token))
          .then(r => r.json().catch(() => null))
          .then(stored => {
            if (stored && typeof stored === 'object') {
              let applied = false;
              if (Array.isArray(stored.streamAddons) && !streamAddonsTouched) { streamAddons = stored.streamAddons; applied = true; }
              if (Array.isArray(stored.customStreams) && stored.customStreams.length) { customStreams = stored.customStreams; applied = true; }
              if (stored.streamPreset) {
                document.getElementById('streamPreset').value = stored.streamPreset;
                applied = true;
              }
              if (stored.nuvioBadgePack || stored.nuvioBadgeUrl) {
                window._badgePicker?.set(stored.nuvioBadgePack, stored.nuvioBadgeUrl);
                applied = true;
              }
              if (stored.libraryIdMode === 'tt') {
                if (document.getElementById('libraryIdMode')) document.getElementById('libraryIdMode').checked = true;
                applied = true;
              } else if (stored.libraryIdMode === '') {
                if (document.getElementById('libraryIdMode')) document.getElementById('libraryIdMode').checked = false;
                applied = true;
              }
              if (stored.streamNotices === 'off') {
                const sn = document.getElementById('streamNotices');
                if (sn && sn.checked) { sn.checked = false; applied = true; }
              }
              if (stored.streamPreset === 'custom') {
                if (stored.streamNameTemplate) document.getElementById('streamNameTemplate').value = stored.streamNameTemplate;
                if (stored.streamDescTemplate) document.getElementById('streamDescTemplate').value = stored.streamDescTemplate;
              } else if (stored.streamPreset && FMT && FMT.presets[stored.streamPreset]) {
                document.getElementById('streamNameTemplate').value = FMT.presets[stored.streamPreset].name;
                document.getElementById('streamDescTemplate').value = FMT.presets[stored.streamPreset].description;
              }
              if (applied) {
                renderStreamAddons();
                updateStreamPreview();
              }
            }
            finishLoad();
          })
          .catch(() => finishLoad());
      } else {
        finishLoad();
      }
      updateSetupSummary();

      // Watch for changes on all config fields
      const watchIds = ['provider', 'torboxApiKey', 'rdApiKey', 'adApiKey', 'pmApiKey', 'tmdbApiKey', 'rdCatalog', 'sortBy', 'lang', 'searchScope', 'posterProvider', 'erdbToken', 'rpdbKey', 'fanartKey', 'omdbKey', 'streamPreset', 'filterMinSize', 'filterMaxSize', 'filterCachedOnly'];
      watchIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          const ev = el.tagName === 'SELECT' ? 'change' : 'input';
          el.addEventListener(ev, checkChanged);
        }
      });
      ['enhanceBackground', 'enhanceLogo', 'hideAnime'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', checkChanged);
      });
      ['csName', 'csUrl', 'csType'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', checkChanged);
      });
      // Custom formatter templates: mark them changed so the unsaved banner
      // and the sessionStorage draft pick them up.
      ['streamNameTemplate', 'streamDescTemplate'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', checkChanged);
      });
      ['erdbToken', 'rpdbKey'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updatePosterPreview);
      });
      // Reject TMDB v4 Read Access Tokens in real time
      const tmdbInput = document.getElementById('tmdbApiKey');
      if (tmdbInput) {
        tmdbInput.addEventListener('input', () => {
          checkTmdbKey();
          checkChanged();
        });
        checkTmdbKey();
      }
    });

    // NOTE: there is deliberately no global Enter→generate() keyboard
    // shortcut. Connect boxes, rename modals and custom-stream fields each
    // handle Enter locally with their own actions; a document-level handler
    // used to ALSO fire the full generate() pipeline whenever any <button>
    // was keyboard-activated (e.g. Enter on Delete deleted AND regenerated).

    async function clearCache() {
      const btn = document.getElementById('btnRefresh');
      const token = currentToken();
      if (!token || token === 'configure') { btn.textContent = '❌ Install the addon first'; btn.style.opacity = '0.5'; setTimeout(() => { btn.style.opacity = '1'; btn.innerHTML = '🔄 Refresh catalog<small>Clears server cache</small>'; }, 2000); return; }
      btn.disabled = true;
      btn.innerHTML = '<div class="ico">⏳</div><div class="txt"><span>Clearing cache...</span></div>';
      try {
        const r = await fetch('/api/clear-cache/' + token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const d = await r.json();
        if (d.success) {
          btn.innerHTML = '<div class="ico">✅</div><div class="txt"><span>Cache cleared!</span><small>Now refresh your app</small></div>';
          setTimeout(() => { btn.disabled = false; btn.innerHTML = '<div class="ico">🔄</div><div class="txt"><span>Refresh catalog</span><small>Clears server cache: then refresh in Stremio or Nuvio</small></div><span class="arr">›</span>'; }, 3000);
        } else {
          btn.innerHTML = '<div class="ico">❌</div><div class="txt"><span></span></div>'; const errSpan = btn.querySelector('.txt span'); if (errSpan) errSpan.textContent = 'Error: ' + (d.error || 'unknown');
          setTimeout(() => { btn.disabled = false; btn.innerHTML = '<div class="ico">🔄</div><div class="txt"><span>Refresh catalog</span><small>Clears server cache: then refresh in Stremio or Nuvio</small></div><span class="arr">›</span>'; }, 3000);
        }
      } catch (e) {
        btn.innerHTML = '<div class="ico">❌</div><div class="txt"><span></span></div>';
        const failSpan = btn.querySelector('.txt span');
        if (failSpan) failSpan.textContent = 'Failed: ' + (e && e.message ? e.message : 'unknown');
        setTimeout(() => { btn.disabled = false; btn.innerHTML = '<div class="ico">🔄</div><div class="txt"><span>Refresh catalog</span><small>Clears server cache: then refresh in Stremio or Nuvio</small></div><span class="arr">›</span>'; }, 3000);
      }
    }

    // ── Stream Preview ──
    // Rendered through the shared formatter engine (FMT) with the user's
    // selected preset/custom templates: see renderPreview below.

    const SAMPLES = [
      { filename: 'Sonic.the.Hedgehog.3.2024.1080p.WEB-DL.H265.Dual.Audio.PT-BR.DD5.1-BIOMA.mkv', size: 9126805504, source: 'torbox' },
      { filename: 'Dune.Part.Two.2024.2160p.BluRay.HEVC.HDR10Plus.TrueHD.Atmos-GROUP.mkv', size: 45097156608, source: 'torbox' },
      { filename: 'Game.of.Thrones.S01E01.720p.WEBRip.x264-FoV.mkv', size: 1258291200, source: 'realdebrid' },
    ];

    function previewStreamTemplates() {
      if (!FMT) return { nameT: '', descT: '' };
      // The textareas hold the selected preset's (or custom) templates, so the
      // preview reflects the user's actual stream format choice.
      let nameT = (document.getElementById('streamNameTemplate') || {}).value || '';
      let descT = (document.getElementById('streamDescTemplate') || {}).value || '';
      if (!nameT && !descT) {
        nameT = (FMT.presets.lelibrary || {}).name || '';
        descT = (FMT.presets.lelibrary || {}).description || '';
      }
      return { nameT, descT };
    }

    function streamSampleRowsHtml() {
      if (!FMT) return '<div class="fp-loading">Formatter engine failed to load: hard refresh to retry</div>';
      const { nameT, descT } = previewStreamTemplates();
      return SAMPLES.map(s => {
        const ctx = FMT.buildLeContext(s.filename, s.source, s.size);
        const name = FMT.render(nameT, ctx);
        const desc = FMT.render(descT, ctx);
        return `<div class="stream-row">
          <div class="stream-label">${escHtml(name)}</div>
          <div class="stream-detail">${escHtml(desc)}</div>
        </div>`;
      }).join('');
    }

    function renderPreview() {
      const container = document.getElementById('previewCards');
      container.innerHTML = streamSampleRowsHtml();
    }

    function togglePreview() {
      const btn  = document.getElementById('previewToggle');
      const body = document.getElementById('previewBody');
      const isOpen = body.classList.toggle('open');
      btn.classList.toggle('open', isOpen);
      if (isOpen) renderPreview();
    }

    // Legacy alias: old code called toggleSection on a .collapsible-header
    function toggleSection(header) { toggleCollCard(header); }


    // ── Filter preferences ──
    const ALL_RESOLUTIONS = ['4K', '2K', '1080p', '720p', '480p', '360p', '240p'];
    const ALL_QUALITIES = ['BluRay REMUX', 'BluRay', 'WEB-DL', 'WEBRip', 'HDRip', 'DVDRip', 'HDTV', 'CAM', 'TS', 'TC'];
    const ALL_SOURCES = ['BluRay', 'WEB-DL', 'WEBRip', 'HDRip', 'DVDRip', 'HDTV', 'CAM', 'TS'];
    const ALL_CODECS = ['AV1', 'HEVC', 'AVC', 'XviD'];
    const ALL_HDR = ['Dolby Vision', 'HDR10+', 'HDR10', 'HDR', 'SDR'];
    const ALL_AUDIO = ['TrueHD Atmos', 'TrueHD', 'DTS-HD MA', 'DTS-HD', 'DTS', 'Atmos', 'DD+ 5.1', 'DD 5.1', 'AAC', 'FLAC'];

    const filterState = {
      resolutions: ALL_RESOLUTIONS.slice(),    // ordered preference (top = most preferred)
      resIncluded: new Set(ALL_RESOLUTIONS),   // which resolutions are enabled
      qualities: new Set(ALL_QUALITIES),       // included quality tags
      sources: new Set(ALL_SOURCES),           // included sources
      codecs: new Set(ALL_CODECS),             // included codecs
      hdr: new Set(ALL_HDR),                   // included HDR tags
      audio: new Set(ALL_AUDIO),               // included audio formats
    };

    function renderFilterChips(containerId, items, includedSet, setName) {
      const el = document.getElementById(containerId);
      if (!el) return;
      el.innerHTML = items.map(item => {
        const active = includedSet.has(item);
        return `<button type="button" onclick="toggleFilterItem(${jsStr(setName)}, ${jsStr(item)})"
          style="display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border-radius:8px;font-size:0.78rem;font-weight:600;cursor:pointer;transition:all 0.15s;font-family:var(--font);border:1px solid ${active ? 'var(--amber)' : 'var(--border2)'};background:${active ? 'var(--amber-glow)' : 'var(--surface2)'};color:${active ? 'var(--amber)' : 'var(--muted)'}">${escHtml(item)}</button>`;
      }).join('');
    }

    function toggleFilterItem(setName, item) {
      const set = filterState[setName];
      if (set.has(item)) set.delete(item); else set.add(item);
      // For resolutions: auto-remove from preference order when unticked, re-add at end when ticked
      if (setName === 'resIncluded') {
        if (!set.has(item)) {
          filterState.resolutions = filterState.resolutions.filter(r => r !== item);
        } else if (!filterState.resolutions.includes(item)) {
          filterState.resolutions.push(item);
        }
      }
      renderAllFilterChips();
      checkChanged();
    }

    function renderAllFilterChips() {
      renderFilterChips('resolutionInclude', ALL_RESOLUTIONS, filterState.resIncluded, 'resIncluded');
      renderFilterChips('qualityInclude', ALL_QUALITIES, filterState.qualities, 'qualities');
      renderFilterChips('sourceInclude', ALL_SOURCES, filterState.sources, 'sources');
      renderFilterChips('codecInclude', ALL_CODECS, filterState.codecs, 'codecs');
      renderFilterChips('hdrInclude', ALL_HDR, filterState.hdr, 'hdr');
      renderFilterChips('audioInclude', ALL_AUDIO, filterState.audio, 'audio');
      renderResolutionPreference();
    }

    function renderResolutionPreference() {
      const el = document.getElementById('resolutionPreference');
      if (!el) return;
      el.innerHTML = filterState.resolutions.map((res, i) => {
        const active = filterState.resIncluded.has(res);
        return `<div class="res-chip" data-idx="${i}"
          style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:8px;font-size:0.78rem;font-weight:600;cursor:grab;transition:all 0.15s;border:1px solid ${active ? 'var(--border2)' : 'var(--border)'};background:${active ? 'var(--surface2)' : 'var(--bg)'};color:${active ? 'var(--text)' : 'var(--border2)'};opacity:${active ? '1' : '0.4'};touch-action:none;user-select:none;-webkit-user-select:none;">
          <span style="cursor:grab;opacity:0.5">⠿</span>${res}
          <span style="font-size:0.7rem;opacity:0.4;margin-left:2px">#${i + 1}</span>
        </div>`;
      }).join('');
      // Bind touch + mouse drag handlers
      el.querySelectorAll('.res-chip').forEach(chip => {
        chip.addEventListener('mousedown', resDragStart);
        chip.addEventListener('touchstart', resDragStart, { passive: false });
      });
    }

    // ── Unified touch + mouse reorder for resolution chips ──
    let _resDragging = false;
    let _resFromIdx = -1;
    let _resOverIdx = -1;
    let _resClone = null;
    let _resStartY = 0;
    let _resStartX = 0;

    function resDragStart(e) {
      const chip = e.target.closest('.res-chip');
      if (!chip) return;
      _resFromIdx = parseInt(chip.dataset.idx, 10);
      _resDragging = true;
      const touch = e.touches ? e.touches[0] : e;
      _resStartX = touch.clientX;
      _resStartY = touch.clientY;

      // Create a floating clone for visual feedback
      _resClone = chip.cloneNode(true);
      _resClone.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;opacity:0.9;transform:scale(1.05);box-shadow:0 4px 16px rgba(0,0,0,0.4);transition:none;';
      _resClone.style.left = (touch.clientX - 40) + 'px';
      _resClone.style.top = (touch.clientY - 20) + 'px';
      document.body.appendChild(_resClone);
      chip.style.opacity = '0.3';

      if (e.touches) e.preventDefault();
      document.addEventListener('mousemove', resDragMove);
      document.addEventListener('touchmove', resDragMove, { passive: false });
      document.addEventListener('mouseup', resDragEnd);
      document.addEventListener('touchend', resDragEnd);
    }

    function resDragMove(e) {
      if (!_resDragging) return;
      const touch = e.touches ? e.touches[0] : e;
      if (_resClone) {
        _resClone.style.left = (touch.clientX - 40) + 'px';
        _resClone.style.top = (touch.clientY - 20) + 'px';
      }

      // Find which chip we're over
      const el = document.getElementById('resolutionPreference');
      if (!el) return;
      const chips = el.querySelectorAll('.res-chip');
      let foundIdx = -1;
      chips.forEach(chip => {
        const rect = chip.getBoundingClientRect();
        if (touch.clientX >= rect.left && touch.clientX <= rect.right && touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
          foundIdx = parseInt(chip.dataset.idx, 10);
        }
      });
      if (foundIdx !== -1 && foundIdx !== _resOverIdx) {
        _resOverIdx = foundIdx;
        chips.forEach(c => c.style.transform = '');
        if (foundIdx !== _resFromIdx) {
          chips[foundIdx].style.transform = 'scale(1.05)';
        }
      }
      if (e.touches) e.preventDefault();
    }

    function resDragEnd(e) {
      if (!_resDragging) return;
      _resDragging = false;
      document.removeEventListener('mousemove', resDragMove);
      document.removeEventListener('touchmove', resDragMove);
      document.removeEventListener('mouseup', resDragEnd);
      document.removeEventListener('touchend', resDragEnd);

      if (_resClone) { _resClone.remove(); _resClone = null; }

      // Reset all chip styles
      const el = document.getElementById('resolutionPreference');
      if (el) el.querySelectorAll('.res-chip').forEach(c => { c.style.opacity = ''; c.style.transform = ''; });

      if (_resFromIdx >= 0 && _resOverIdx >= 0 && _resFromIdx !== _resOverIdx) {
        const item = filterState.resolutions.splice(_resFromIdx, 1)[0];
        filterState.resolutions.splice(_resOverIdx, 0, item);
        renderResolutionPreference();
        checkChanged();
      }
      _resFromIdx = -1;
      _resOverIdx = -1;
    }

    // ── Step-by-step wizard navigation ──
    const STEP_LABELS = { 1: 'Next: Providers', 2: 'Next: Metadata', 3: 'Next: Stream Preferences', 4: 'Next: Content Builder', 5: 'Next: Appearance & Streams', 6: 'Next: Review & Install', 7: '' };
    const STEP_TITLES = { 1: 'Platform & Setup', 2: 'Providers', 3: 'Metadata', 4: 'Stream Preferences', 5: 'Content Builder', 6: 'Appearance & Streams', 7: 'Review & Install' };
    const STEP_COUNT = 7;
    let currentStep = 1;

    function goToStep(n) {
      n = Math.max(1, Math.min(STEP_COUNT, n));
      currentStep = n;
      for (let i = 1; i <= STEP_COUNT; i++) {
        const panel = document.getElementById('panel-' + i);
        if (panel) panel.classList.toggle('visible', i === n);
        const btn = document.querySelector('.step-btn[data-step="' + i + '"]');
        if (btn) btn.classList.toggle('active', i === n);
      }
      // "How far you have left": progress bar + step counter.
      const progText = document.getElementById('stepProgressText');
      if (progText) progText.textContent = `Step ${n} of ${STEP_COUNT}`;
      const progTitle = document.getElementById('stepProgressTitle');
      if (progTitle) progTitle.textContent = STEP_TITLES[n] || '';
      const progFill = document.getElementById('stepProgressFill');
      if (progFill) progFill.style.width = Math.round((n / STEP_COUNT) * 100) + '%';
      const next = document.getElementById('btnNextStep');
      next.style.display = n === STEP_COUNT ? 'none' : '';
      document.getElementById('nextStepLabel').textContent = STEP_LABELS[n] || 'Continue';
      // Add a back button at the top of each step (except the first)
      document.querySelectorAll('.step-back-top').forEach(b => b.remove());
      if (n > 1) {
        const panel = document.getElementById('panel-' + n);
        const stepHead = panel && panel.querySelector('.step-head');
        if (stepHead) {
          const back = document.createElement('button');
          back.type = 'button';
          back.className = 'step-back-top';
          back.textContent = '← Back';
          back.onclick = () => goToStep(n - 1);
          stepHead.insertAdjacentElement('beforebegin', back);
        }
      }
      if (n === STEP_COUNT) renderConnectAll();
      if (n === STEP_COUNT - 1) {
        renderConnectAll();
        maybeAutoGenerate();
      }
      requestAnimationFrame(() => {
        const fa = document.querySelector('.form-area');
        if (fa && fa.scrollHeight > fa.clientHeight) fa.scrollTo({ top: 0, behavior: 'smooth' });
        else window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    // Go to the push step (Install).
    function goToPushStep() {
      goToStep(STEP_COUNT);
    }

    // Step navigation with in-place API-key verification. When advancing past
    // the Providers step (2) the provider keys are checked, and past Metadata
    // (3) the TMDB key is checked: a "Verifying…" state is shown on the step
    // button, then fields turn green with a toast before the step changes.
    // Going back is instant; keys we can't confirm (network blip) don't block.
    function advanceStep(n) {
      n = Math.max(1, Math.min(STEP_COUNT, n));
      if (n <= currentStep) { goToStep(n); return; }
      // Provider → API key input id (KEY_FIELD elsewhere is function-scoped, so
      // it's inlined here to avoid a reference error).
      const KEY_FIELD = { torbox: 'torboxApiKey', realdebrid: 'rdApiKey', alldebrid: 'adApiKey', premiumize: 'pmApiKey' };
      const checks = [];
      if (currentStep === 2) {
        for (const id of getProviderSet()) {
          const el = document.getElementById(KEY_FIELD[id]);
          if (el && el.value.trim()) checks.push({ service: id, key: el.value.trim(), el });
        }
      } else if (currentStep === 3) {
        const el = document.getElementById('tmdbApiKey');
        if (el && el.value.trim()) checks.push({ service: 'tmdb', key: el.value.trim(), el });
      }
      if (checks.length === 0) { goToStep(n); return; }
      // Verify in the background and always land on the next step: a slow or
      // unreachable key service must never leave the wizard stuck.
      verifyKeysForAdvance(n, checks).catch(() => goToStep(n));
    }

    async function verifyKeysForAdvance(n, checks) {
      const stepBtn = document.querySelector('.step-btn[data-step="' + currentStep + '"]');
      const origStepHtml = stepBtn ? stepBtn.innerHTML : null;
      const nextBtn = document.getElementById('btnNextStep');
      const nextLabel = document.getElementById('nextStepLabel');
      const nextSmall = nextBtn ? nextBtn.querySelector('small') : null;
      const origLabel = nextLabel ? nextLabel.textContent : '';
      const origSmall = nextSmall ? nextSmall.textContent : '';

      if (stepBtn) {
        stepBtn.classList.remove('active', 'verified');
        stepBtn.classList.add('verifying');
        stepBtn.innerHTML = '<span></span>Verifying…';
      }
      if (nextBtn) nextBtn.disabled = true;
      if (nextLabel) nextLabel.textContent = 'Verifying keys…';
      if (nextSmall) nextSmall.textContent = 'Checking your API keys: one moment';
      const verifyingToast = showToast('Verifying your API keys…');

      // Verify each key with a hard cap so a slow upstream (TorBox can take a
      // few seconds) never leaves the wizard frozen.
      let results;
      try {
        results = await Promise.all(checks.map(async c => {
          if (await wasValidatedThisSession(c.service, c.key)) return { ...c, d: { valid: true, sessionCached: true } };
          return fetch('/api/verify/' + c.service, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: c.key }),
            signal: AbortSignal.timeout(15000)
          })
            .then(r => r.json().catch(() => ({ networkError: true })))
            .then(d => ({ ...c, d }))
            .catch(() => ({ ...c, d: { networkError: true } }));
        }));
      } catch {
        results = checks.map(c => ({ ...c, d: { networkError: true } }));
      }

      if (stepBtn) {
        stepBtn.classList.remove('verifying');
        if (origStepHtml) stepBtn.innerHTML = origStepHtml;
        stepBtn.classList.add('active');
      }
      if (nextBtn) nextBtn.disabled = false;
      if (nextLabel) nextLabel.textContent = origLabel;
      if (nextSmall) nextSmall.textContent = origSmall;

      let allOk = true;
      let anyConfirmed = false;
      for (const { el, d, service } of results) {
        if (d.valid) {
          if (!d.sessionCached) rememberValidatedKey(service, (el?.value || '').trim());
          el.classList.remove('invalid');
          el.classList.add('verified');
          anyConfirmed = true;
        } else if (d.networkError) {
          // Can't confirm: don't block the user on our own hiccup
        } else if (d.needPin) {
          // Premiumize device authorization: show the PIN modal, wait for it
          showPinModal(d.pin || '', d.deviceUrl || 'https://www.premiumize.me/device', service);
          return;
        } else {
          el.classList.add('invalid');
          allOk = false;
        }
      }
      // Dismiss verifying toast quickly so it doesn't bulk with the result
      if (verifyingToast) {
        if (window.LeToast && window.LeToast.dismiss) window.LeToast.dismiss(verifyingToast);
        else if (verifyingToast.classList) verifyingToast.classList.remove('show');
      }
      if (allOk && anyConfirmed) {
        if (stepBtn) stepBtn.classList.add('verified');
        showToast('Keys validated ✓', 'success');
      } else if (!allOk) {
        showToast('Some keys could not be verified: check the marked fields', 'info');
      }
      goToStep(n);
    }

    // If the setup fields are already valid, generate the install links for them
    function maybeAutoGenerate() {
      if (lastUrls) return;
      const provider = document.getElementById('provider').value;
      const tmdb = document.getElementById('tmdbApiKey').value.trim();
      if (!provider || provider === 'none' || !tmdb) return;
      generate({ skipVerify: true });
    }

    // Sidebar / mobile "Generate" buttons jump to the install step and generate
    function goGenerate() {
      goToStep(STEP_COUNT);
      generate();
    }

    // ── Push to your account (Step 5): Sign in with Stremio / Nuvio ──
    // Legacy/public tokens keep platform session state in localStorage so the
    // browser can reconnect after a refresh. Account-backed tokens are the
    // exception: their source of truth is the encrypted account connection and
    // the browser never persists this state.
    const STREMIO_API = 'https://api.strem.io/api';
    const NUVIO_API_BASE        = 'https://api.nuvio.tv';
    const NUVIO_PUBLISHABLE_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';
    const CONNECT_STORAGE_KEY   = 'lelibrary_connect';
    const NUVIO_CLIENT_ID_KEY   = 'lelibrary_nuvio_client_id';

    const connectState = {
      platform: null,          // 'stremio' | 'nuvio': the platform currently connected (authed)
      selectedPlatform: null,  // 'stremio' | 'nuvio': the platform chosen on Step 1 (target)
      stremioAuth: null,
      stremioUser: null,
      nuvioToken: null,
      nuvioRefresh: null,
      nuvioUser: null,
      nuvioProfiles: [],
      nuvioSelectedProfile: null,
    };
    // Safe summaries for account-issued tokens. These never contain platform
    // credentials and are not persisted in browser storage.
    const accountConnections = { nuvio: null, stremio: null };
    let accountConnectionReady = Promise.resolve();

    // Which catalogues the user wants pushed (shared by Step 5 and the Catalogues tab)
    const catSelection = { franchises: true, trendingMovies: false, trendingSeries: false, popularMovies: false, popularSeries: false, movies: true, series: true, anime: true };
    // Renameable display names for each catalogue (stored in the config token)
    const catNames = {
      trendingMovies: '🔥 Trending Movies',
      trendingSeries: '🔥 Trending Series',
      popularMovies: '⭐ Popular Movies',
      popularSeries: '⭐ Popular Series',
      movies: '🎬 My Movies',
      series: '📺 My Series',
      anime: '🍥 LeLibrary Anime',
      franchises: 'LeLibrary Collections',
    };
    // Custom names for library rows (Home Rows picker): keyed by catalog id
    const libraryNames = {};
    const watchlistNames = {};
    // Default order: new/latest at top, then trending, then library. Streaming
    // and genre rows (libraryCatalogs) are ordered separately below.
    const DEFAULT_CAT_ORDER = ['trendingMovies', 'trendingSeries', 'popularMovies', 'popularSeries', 'movies', 'series', 'franchises', 'anime'];
    let catOrder = DEFAULT_CAT_ORDER.slice();
    // External stream addons the user has enabled (Trending/Popular only)
    let streamAddons = [];
    // Set once the user clicks an addon checkbox: the async server-side restore
    // must not clobber a selection made while the settings were still loading.
    let streamAddonsTouched = false;

    function persistConnect() {
      if (ACCOUNT_TOKEN) return;
      try {
        localStorage.setItem(CONNECT_STORAGE_KEY, JSON.stringify({
          platform: connectState.platform,
          selectedPlatform: connectState.selectedPlatform,
          stremioAuth: connectState.stremioAuth,
          stremioUser: connectState.stremioUser,
          nuvioToken: connectState.nuvioToken,
          nuvioRefresh: connectState.nuvioRefresh,
          nuvioUser: connectState.nuvioUser,
          nuvioProfiles: connectState.nuvioProfiles,
          nuvioSelectedProfile: connectState.nuvioSelectedProfile,
        }));
      } catch { /* storage unavailable: fall back to session-only */ }
    }

    // Standalone configure is intentionally browser-only. Account connections
    // are created and managed in Account Settings, never mirrored from this
    // local-storage flow.
    function syncPushConnectToAccount() {
      return undefined;
    }

    function clearPersistedConnect() {
      try { localStorage.removeItem(CONNECT_STORAGE_KEY); } catch {}
    }

    function nuvioOriginClientId() {
      if (ACCOUNT_TOKEN) return `lelibrary-web-${crypto.randomUUID?.() || Date.now()}`;
      try {
        let id = localStorage.getItem(NUVIO_CLIENT_ID_KEY);
        if (!id) {
          id = `lelibrary-web-${crypto.randomUUID()}`;
          localStorage.setItem(NUVIO_CLIENT_ID_KEY, id);
        }
        return id;
      } catch {
        return `lelibrary-web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
    }

    function restoreConnect() {
      if (ACCOUNT_TOKEN) return false;
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(CONNECT_STORAGE_KEY) || 'null'); } catch {}
      if (!saved || !saved.platform) {
        // A platform-only preference (Step 1 choice, not yet connected) is still restored.
        connectState.selectedPlatform = saved && (saved.selectedPlatform === 'stremio' || saved.selectedPlatform === 'nuvio') ? saved.selectedPlatform : null;
        return false;
      }
      connectState.platform = saved.platform;
      connectState.selectedPlatform = saved && (saved.selectedPlatform === 'stremio' || saved.selectedPlatform === 'nuvio') ? saved.selectedPlatform : saved.platform;
      connectState.stremioAuth = saved.stremioAuth || null;
      connectState.stremioUser = saved.stremioUser || null;
      connectState.nuvioToken = saved.nuvioToken || null;
      connectState.nuvioRefresh = saved.nuvioRefresh || null;
      connectState.nuvioUser = saved.nuvioUser || null;
      connectState.nuvioProfiles = Array.isArray(saved.nuvioProfiles) ? saved.nuvioProfiles : [];
      connectState.nuvioSelectedProfile = saved.nuvioSelectedProfile || null;
      return true;
    }

    // Account-backed tokens deliberately do not keep platform credentials in
    // browser storage. Restore the safe server-side connection summary so a
    // refresh still shows the account as connected without exposing tokens.
    async function restoreAccountConnect() {
      try {
        const tokenId = currentToken();
        const accountConnectBase = ACCOUNT_TOKEN && tokenId
          ? `/api/account/tokens/${encodeURIComponent(tokenId)}/push-connect`
          : '/api/account/push-connect';
        const responses = await Promise.all([
          fetch(`${accountConnectBase}/nuvio`, { credentials: 'same-origin' }),
          fetch(`${accountConnectBase}/stremio`, { credentials: 'same-origin' }),
        ]);
        const [nuvioResponse, stremioResponse] = responses;
        const [nuvio, stremio] = await Promise.all(responses.map(response => response.ok ? response.json() : null));
        const n = nuvio?.connected ? nuvio : null;
        const s = stremio?.connected ? stremio : null;
        accountConnections.nuvio = n;
        accountConnections.stremio = s;
        const platform = (connectState.selectedPlatform && accountConnections[connectState.selectedPlatform])
          ? connectState.selectedPlatform
          : (n ? 'nuvio' : s ? 'stremio' : null);
        if (!platform) return;
        applyAccountConnection(platform);
        renderPlatformStep();
        renderConnectAll();
      } catch {
        // Account session unavailable: the normal sign-in UI remains.
      }
    }

    function applyAccountConnection(platform) {
      const connection = accountConnections[platform];
      connectState.selectedPlatform = platform;
      connectState.platform = connection ? platform : null;
      if (platform === 'nuvio') {
        connectState.nuvioUser = connection?.user ? { email: connection.user } : null;
        connectState.nuvioProfiles = Array.isArray(connection?.profiles) ? connection.profiles : [];
        connectState.nuvioSelectedProfile = connection?.profile || null;
      } else {
        connectState.stremioUser = connection?.user ? { email: connection.user } : null;
      }
    }

    // ── Step 1 platform chooser ──
    let showPlatformChooser = false;
    let connectionPanelActive = false; // only true when user explicitly clicked a card
    function togglePlatformChooser(v) {
      showPlatformChooser = !!v;
      renderPlatformStep();
      renderConnectAll();
    }

    // Fade transition helpers: CSS animation based, no setTimeout lag
    function fadeOut(el, cb) {
      if (!el) return cb && cb();
      el.style.animation = 'fadeSlideOut 0.2s ease forwards';
      el.style.willChange = 'opacity, transform';
      const onEnd = () => {
        el.removeEventListener('animationend', onEnd);
        el.style.display = 'none';
        el.style.animation = '';
        el.style.willChange = '';
        el.style.opacity = '0';
        if (cb) cb();
      };
      el.addEventListener('animationend', onEnd, { once: true });
    }
    function fadeIn(el) {
      if (!el) return;
      el.style.display = '';
      el.style.opacity = '0';
      el.style.willChange = 'opacity, transform';
      // Force a reflow so the browser registers the initial state
      void el.offsetWidth;
      el.style.animation = 'fadeSlideIn 0.25s ease forwards';
      el.addEventListener('animationend', () => {
        el.style.animation = '';
        el.style.willChange = '';
        el.style.opacity = '';
      }, { once: true });
    }

    function selectPlatform(plat) {
      if (ACCOUNT_TOKEN) {
        applyAccountConnection(plat);
        showPlatformChooser = false;
        connectionPanelActive = true;
        renderPlatformStep();
        renderConnectAll();
        const wrap = document.getElementById('platformSelectionWrap');
        const panel = document.getElementById('platformConnectionPanel');
        fadeOut(wrap, () => { renderConnectionPanel(plat); fadeIn(panel); });
        return;
      }
      connectState.selectedPlatform = (plat === 'nuvio' || plat === 'stremio') ? plat : null;
      showPlatformChooser = false;
      connectionPanelActive = true;
      persistConnect();
      renderPlatformStep();
      renderConnectAll();
      checkChanged();
      // Fade out cards → fade in connection panel
      const wrap = document.getElementById('platformSelectionWrap');
      const panel = document.getElementById('platformConnectionPanel');
      fadeOut(wrap, () => {
        renderConnectionPanel(plat);
        fadeIn(panel);
      });
    }

    function changePlatform() {
      // Back should just return to the chooser, not wipe the logins. Keep both Nuvio and Stremio tokens.
      showPlatformChooser = true;
      connectionPanelActive = false;
      persistConnect();
      const panel = document.getElementById('platformConnectionPanel');
      if (panel) panel.innerHTML = '';
      const wrap = document.getElementById('platformSelectionWrap');
      fadeOut(panel, () => fadeIn(wrap));
      renderPlatformStep();
      renderConnectAll();
      checkChanged();
    }

    function targetPlatform() {
      return connectState.selectedPlatform || connectState.platform || null;
    }

    function targetPlatformName() {
      return targetPlatform() === 'nuvio' ? 'Nuvio' : 'Stremio';
    }

    function renderPlatformStep() {
      const p = targetPlatform();
      for (const key of ['Stremio', 'Nuvio']) {
        const card = document.getElementById('platform' + key);
        if (card) card.classList.toggle('active', p === key.toLowerCase());
      }
      const hint = document.getElementById('platformHint');
      if (hint) {
        hint.textContent = p === 'nuvio'
          ? 'Nuvio: your catalogue rows arrive as collections with artwork and focus gifs, plus home rows.'
          : p === 'stremio'
            ? 'Stremio: your catalogue rows arrive as home rows: pick which ones on the Catalogues step.'
            : 'Pick one: it decides whether you get collections (Nuvio) or home rows (Stremio) when you install.';
      }
      // Install step: "Push to" pill + change link
      const tabs = document.getElementById('installPlatformTabs');
      if (tabs) {
        if (p && !showPlatformChooser) {
          const img = p === 'nuvio' ? '/nuvio.png' : '/stremio.svg';
          const name = p === 'nuvio' ? 'Nuvio' : 'Stremio';
          tabs.innerHTML = `
            <span class="ptab active ptab-static"><img src="${img}" alt="" /> ${name}</span>
            <a class="ptab-change" href="#" onclick="togglePlatformChooser(true);return false">change</a>`;
        } else {
          tabs.innerHTML = `
            <button type="button" class="ptab${p === 'stremio' ? ' active' : ''}" data-plat="stremio" onclick="selectPlatform('stremio')"><img src="/stremio.svg" alt="" /> Stremio</button>
            <button type="button" class="ptab${p === 'nuvio' ? ' active' : ''}" data-plat="nuvio" onclick="selectPlatform('nuvio')"><img src="/nuvio.png" alt="" /> Nuvio</button>`;
        }
      }
      const nameEl = document.getElementById('installPlatformName');
      if (nameEl) nameEl.textContent = targetPlatformName();
      const notConn = document.getElementById('pushNotConnectedPlat');
      if (notConn) notConn.textContent = targetPlatformName();
      // If the connection panel is active (user clicked a card), keep it updated
      if (connectionPanelActive) {
        const connPanel = document.getElementById('platformConnectionPanel');
        if (connPanel) renderConnectionPanel(p || connectState.platform);
      }
    }

    // Single-platform sign-in box (used on Platform step + Install step).
    // open=true renders the form expanded (used after picking a platform).
    function singleConnectBox(platform, prefix, open) {
      const isS = platform === 'stremio';
      const name = isS ? 'Stremio' : 'Nuvio';
      const logo = isS ? '/stremio.svg' : '/nuvio.png';
      const fn = isS ? 'connectStremio' : 'connectNuvio';
      if (ACCOUNT_TOKEN) {
        return `
          <div class="connect-box connect-expand open" id="${prefix}ConnectBox">
            <div class="cb-head"><img src="${logo}" alt="${name}" /><div><h3>${name} connection</h3><p>Managed securely by your LeLibrary account</p></div></div>
            <div class="connect-form connect-expand-body" style="display:block">
              <p class="field-hint">This account-issued link never stores platform credentials in this browser. Connect or reconnect ${name} in Account Settings, then return here.</p>
              <a class="btn-main btn-gen" href="/account/settings" style="cursor:pointer;font-family:var(--font);text-decoration:none"><div class="ico">⚙️</div><div class="txt"><span>Open Account Settings</span><small>Manage your saved ${name} connection</small></div><span class="arr">›</span></a>
            </div>
          </div>`;
      }
      return `
        <div class="connect-box connect-expand${open ? ' open' : ''}" id="${prefix}ConnectBox">
          <div class="cb-head connect-expand-head" onclick="document.getElementById('${prefix}ConnectBox').classList.toggle('open')">
            <img src="${logo}" alt="${name}" />
            <div><h3>Sign in with ${name}</h3><p>Email + password</p></div>
            <span class="arr connect-expand-arr">▸</span>
          </div>
          <div class="connect-form connect-expand-body">
            <div class="field">
              <div class="field-label">${name} email</div>
              <input type="email" id="${prefix}-${platform}Email" placeholder="you@example.com" autocomplete="off"
                onkeydown="if(event.key==='Enter') ${fn}('${prefix}')" />
            </div>
            <div class="field">
              <div class="field-label">Password</div>
              <div class="input-row">
                <input type="password" id="${prefix}-${platform}Pass" placeholder="••••••••" autocomplete="off"
                  onkeydown="if(event.key==='Enter') ${fn}('${prefix}')" />
                <button class="btn-icon" type="button" onclick="toggleVis('${prefix}-${platform}Pass',this)">👁</button>
              </div>
            </div>
            <button class="btn-main btn-gen" onclick="${fn}('${prefix}')" style="cursor:pointer;font-family:var(--font)">
              <div class="ico">🔑</div>
              <div class="txt"><span>Sign in with ${name}</span><small>Connects your ${name} account</small></div>
              <span class="arr">›</span>
            </button>
          </div>
        </div>`;
    }

    // Full branded connection panel (fades in when a platform card is clicked)
    function renderConnectionPanel(platform) {
      const el = document.getElementById('platformConnectionPanel');
      if (!el || !platform) { if (el) el.innerHTML = ''; return; }
      const isNuvio = platform === 'nuvio';
      const name = isNuvio ? 'Nuvio' : 'Stremio';
      const logo = isNuvio ? '/nuvio.png' : '/stremio.svg';

      // Connected state
      if (connectState.platform === platform) {
        const email = isNuvio
          ? (connectState.nuvioUser && (connectState.nuvioUser.email || connectState.nuvioUser.name)) || 'Nuvio account'
          : (connectState.stremioUser && (connectState.stremioUser.email || connectState.stremioUser.name)) || 'Stremio account';
        el.innerHTML = `
          <div class="connection-panel">
            <button class="connection-back" onclick="changePlatform()">← Back</button>
            <img src="${logo}" alt="${name}" class="connection-logo" />
            <h2>Connected to ${name}</h2>
            <p class="connection-desc">${escHtml(email)}</p>
            <div class="connected-card" style="margin:0 auto 16px;max-width:400px">
              <img src="${logo}" alt="" style="width:30px;height:30px;border-radius:6px" />
              <div class="cc-info"><strong>Connected to ${name}</strong><small>${escHtml(email)}</small></div>
            </div>
            <p style="color:var(--muted);font-size:0.82rem;text-align:center">Continue through the steps, then push on the Install step.</p>
          </div>`;
        return;
      }

      // Sign-in state
      if (ACCOUNT_TOKEN) {
        el.innerHTML = `
          <div class="connection-panel">
            <button class="connection-back" onclick="changePlatform()">← Back</button>
            <img src="${logo}" alt="${name}" class="connection-logo" />
            <h2>Connect ${name} in your account</h2>
            <p class="connection-desc">This is an account-issued token, so platform credentials remain encrypted on the server and are never kept in this browser.</p>
            <a class="btn-main btn-gen" href="/account/settings" style="max-width:420px;margin:18px auto 0;text-decoration:none;cursor:pointer;font-family:var(--font)"><div class="ico">⚙️</div><div class="txt"><span>Open Account Settings</span><small>Connect ${name}, then return to this token</small></div><span class="arr">›</span></a>
          </div>`;
        return;
      }
      const fn = isNuvio ? 'connectNuvio' : 'connectStremio';
      el.innerHTML = `
        <div class="connection-panel">
          <button class="connection-back" onclick="changePlatform()">← Back</button>
          <img src="${logo}" alt="${name}" class="connection-logo" />
          <h2>Your ${name} Account</h2>
          <p class="connection-desc">We will sign into your existing ${name} account, load its profiles, and set up your library.</p>
          <div class="connection-privacy">
            <span>🔒</span>
            <span>No login credentials are stored: everything runs in your browser.</span>
          </div>
          <div class="connection-form">
            <div class="field">
              <div class="field-label">Email address</div>
              <input type="email" id="conn-${platform}Email" placeholder="you@example.com" autocomplete="off"
                onkeydown="if(event.key==='Enter') ${fn}('conn')" />
            </div>
            <div class="field">
              <div class="field-label">Password</div>
              <input type="password" id="conn-${platform}Pass" placeholder="••••••••" autocomplete="off"
                onkeydown="if(event.key==='Enter') ${fn}('conn')" />
            </div>
            <div class="connection-status" id="conn-${platform}Status"></div>
            <button class="btn-main btn-gen" id="conn-${platform}Submit" onclick="${fn}('conn')" style="width:100%;justify-content:center;cursor:pointer;font-family:var(--font)">
              <div class="ico" id="conn-${platform}Ico">🔑</div>
              <div class="txt"><span id="conn-${platform}BtnLabel">Sign in with ${name}</span><small>Connects your ${name} account</small></div>
              <span class="arr">›</span>
            </button>
          </div>
          ${isNuvio ? `<div class="connection-notice" style="margin-top:16px;background:rgba(255,255,255,0.04);border:1px solid var(--border);color:var(--muted)"><strong style="color:var(--text)">Nuvio</strong> will install LeLibrary on the selected profile.</div>` : ''}
        </div>`;
    }

    // Keep the Step 5 and Catalogues-tab checkboxes in sync
    const CATALOGUE_META = {
      trendingMovies: { desc: 'Trending movies from TMDB, backed by other stream addons.', enable: 'trendingMovies' },
      trendingSeries: { desc: 'Trending series from TMDB, backed by other stream addons.', enable: 'trendingSeries' },
      popularMovies:  { desc: 'Popular movies from TMDB, backed by other stream addons.',  enable: 'popularMovies' },
      popularSeries:  { desc: 'Popular series from TMDB, backed by other stream addons.',  enable: 'popularSeries' },
      movies:   { desc: 'Your owned movies.', enable: 'movies' },
      series:   { desc: 'Your owned series.', enable: 'series' },
      anime:    { desc: 'Your owned anime.', enable: 'anime' },
      franchises: { desc: 'One collections row: every franchise you own, as folders in Nuvio and a genre filter in Stremio.', enable: 'franchises' },
    };

    function setCatOption(key, checked) {
      catSelection[key] = checked;
      renderCataloguesOptions();
      checkChanged();
    }

    async function removeHomeRow(key) {
      const value = String(key || '');
      let title = catNames[value] || value;
      if (value.startsWith('collectionPack:')) {
        title = curatedCollectionDefs.find((pack) => pack.id === value.slice('collectionPack:'.length))?.title || 'this collection';
      } else if (value.startsWith('importedCollection:')) {
        title = importedCollectionEntries().find((entry) => entry.key === value)?.collection?.title || 'this imported collection';
      }
      const ok = await showConfirmModal(`Remove ${title}?`, 'It will be removed from your Home layout. You can add it again later from its picker.', 'Remove');
      if (!ok) return;
      if (value.startsWith('collectionPack:')) {
        toggleCuratedCollectionPack(value.slice('collectionPack:'.length), false);
      } else if (value.startsWith('importedCollection:')) {
        const entry = importedCollectionEntries().find((item) => item.key === value);
        if (entry) toggleImportedCollection(entry.source.id, entry.collection.id, false);
      } else {
        const meta = CATALOGUE_META[value];
        if (meta?.enable) setCatOption(meta.enable, false);
      }
      showToast(`${title} removed from Home`, 'success');
    }

    function moveCatalogue(key, dir) {
      const i = catOrder.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= catOrder.length) return;
      catOrder.splice(i, 1);
      catOrder.splice(j, 0, key);
      renderCataloguesOptions();
      checkChanged();
    }

    function importedCollectionKey(sourceId, collectionId) {
      return `importedCollection:${sourceId}:${collectionId}`;
    }

    function curatedCollectionKey(id) {
      return `collectionPack:${id}`;
    }

    function importedCollectionEntries() {
      return importedRows.flatMap(source => (source.collections || []).map(collection => ({ source, collection, key: importedCollectionKey(source.id, collection.id) })));
    }

    function syncImportedCollectionOrder() {
      const entries = importedCollectionEntries();
      const keys = new Set(entries.map(entry => entry.key));
      catOrder = catOrder.filter(key => !String(key).startsWith('importedCollection:') || keys.has(key));
      for (const entry of entries) if (!catOrder.includes(entry.key)) catOrder.push(entry.key);
    }

    function syncCuratedCollectionOrder() {
      const selected = new Set(nuvioCollectionPacks);
      catOrder = catOrder.filter(key => !String(key).startsWith('collectionPack:') || selected.has(String(key).slice('collectionPack:'.length)));
      for (const id of nuvioCollectionPacks) {
        const key = curatedCollectionKey(id);
        if (!catOrder.includes(key)) catOrder.push(key);
      }
    }

    // ── Catalogue drag-to-reorder (touch + mouse) ──
    let _catDragging = false;
    let _catFromIdx = -1;
    let _catClone = null;
    let _catStartY = 0;
    let _catMoved = false;
    let _catDragEl = null;  // the actual DOM element being dragged

    function catDragStart(e) {
      const handle = e.target.closest('.cat-drag-handle');
      if (!handle) return;
      const item = handle.closest('.cat-drag-item');
      if (!item) return;
      _catFromIdx = parseInt(item.dataset.catIdx, 10);
      _catDragEl = item;
      _catDragging = true;
      _catMoved = false;
      const touch = e.touches ? e.touches[0] : e;
      _catStartY = touch.clientY;
      // Create floating clone
      _catClone = item.cloneNode(true);
      _catClone.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;opacity:0.9;transform:scale(1.02);box-shadow:0 4px 16px rgba(0,0,0,0.4);transition:none;width:' + item.offsetWidth + 'px;left:' + (item.getBoundingClientRect().left) + 'px;top:' + (touch.clientY - 20) + 'px;';
      document.body.appendChild(_catClone);
      item.style.opacity = '0.25';
      item.style.transition = 'none';
      if (e.touches) e.preventDefault();
      document.addEventListener('mousemove', catDragMove, { passive: false });
      document.addEventListener('touchmove', catDragMove, { passive: false });
      document.addEventListener('mouseup', catDragEnd);
      document.addEventListener('touchend', catDragEnd);
    }

    function catDragMove(e) {
      if (!_catDragging) return;
      e.preventDefault();
      const touch = e.touches ? e.touches[0] : e;
      const dy = Math.abs(touch.clientY - _catStartY);
      if (dy > 5) _catMoved = true;
      if (_catClone) _catClone.style.top = (touch.clientY - 20) + 'px';

      // Find which item we're hovering over by pointer position
      const list = document.getElementById('catalogueList');
      if (!list) return;
      const items = [...list.querySelectorAll('.cat-drag-item')];
      let targetIdx = -1;
      for (const el of items) {
        const rect = el.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (touch.clientY < mid) { targetIdx = items.indexOf(el); break; }
      }
      if (targetIdx === -1) targetIdx = items.length - 1;
      const visibleKeys = items.map(el => el.dataset.catKey);
      const draggedKey = _catDragEl?.dataset.catKey;
      const targetKey = visibleKeys[targetIdx];
      const fromOrderIdx = catOrder.indexOf(draggedKey);
      const targetOrderIdx = catOrder.indexOf(targetKey);
      if (!draggedKey || fromOrderIdx < 0 || targetOrderIdx < 0 || draggedKey === targetKey) return;

      // Swap in catOrder
      catOrder.splice(fromOrderIdx, 1);
      catOrder.splice(catOrder.indexOf(targetKey) + (targetIdx > items.indexOf(_catDragEl) ? 1 : 0), 0, draggedKey);

      // Swap DOM elements directly: no re-render, no event rebinding needed
      const draggedEl = _catDragEl;
      const targetEl = items.find(el => el.dataset.catKey === targetKey);
      if (draggedEl && targetEl && draggedEl !== targetEl) {
        if (targetIdx < _catFromIdx) {
          targetEl.parentNode.insertBefore(draggedEl, targetEl);
        } else {
          targetEl.parentNode.insertBefore(draggedEl, targetEl.nextSibling);
        }
      }
      // Update data-cat-idx on all items to match new catOrder
      list.querySelectorAll('.cat-drag-item').forEach((el, i) => {
        el.dataset.catIdx = i;
        if (el === draggedEl) el.style.opacity = '0.25';
      });
      _catFromIdx = targetIdx;
      _catDragEl = draggedEl;
    }

    function catDragEnd(e) {
      if (!_catDragging) return;
      _catDragging = false;
      document.removeEventListener('mousemove', catDragMove);
      document.removeEventListener('touchmove', catDragMove);
      document.removeEventListener('mouseup', catDragEnd);
      document.removeEventListener('touchend', catDragEnd);
      if (_catClone) { _catClone.remove(); _catClone = null; }
      if (_catDragEl) { _catDragEl.style.opacity = ''; _catDragEl.style.transition = ''; _catDragEl = null; }
      if (_catMoved) checkChanged();
      _catFromIdx = -1;
      _catMoved = false;
    }

    // Nuvio collection packs have their own ordering. They are collections,
    // not catalogue rows, so keep their drag state separate from catOrder.
    let _collectionDragging = false;
    let _collectionDragEl = null;
    let _collectionClone = null;
    let _collectionStartY = 0;
    let _collectionMoved = false;

    function collectionDragStart(e) {
      const handle = e.target.closest('.collection-drag-handle');
      const item = handle?.closest('.collection-drag-item');
      if (!item) return;
      _collectionDragging = true;
      _collectionMoved = false;
      _collectionDragEl = item;
      const point = e.touches ? e.touches[0] : e;
      _collectionStartY = point.clientY;
      _collectionClone = item.cloneNode(true);
      _collectionClone.style.cssText = `position:fixed;z-index:9999;pointer-events:none;opacity:.9;transform:scale(1.02);box-shadow:0 4px 16px rgba(0,0,0,.4);transition:none;width:${item.offsetWidth}px;left:${item.getBoundingClientRect().left}px;top:${point.clientY - 20}px;`;
      document.body.appendChild(_collectionClone);
      item.style.opacity = '.25';
      item.style.transition = 'none';
      if (e.touches) e.preventDefault();
      document.addEventListener('mousemove', collectionDragMove, { passive: false });
      document.addEventListener('touchmove', collectionDragMove, { passive: false });
      document.addEventListener('mouseup', collectionDragEnd);
      document.addEventListener('touchend', collectionDragEnd);
    }

    function collectionDragMove(e) {
      if (!_collectionDragging || !_collectionDragEl) return;
      e.preventDefault();
      const point = e.touches ? e.touches[0] : e;
      if (Math.abs(point.clientY - _collectionStartY) > 5) _collectionMoved = true;
      if (_collectionClone) _collectionClone.style.top = `${point.clientY - 20}px`;
      const list = document.getElementById('catalogueList');
      const items = list ? [...list.querySelectorAll('.collection-drag-item')] : [];
      if (!items.length) return;
      let target = items.find((item) => point.clientY < item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2) || items[items.length - 1];
      if (target === _collectionDragEl) return;
      const draggedId = _collectionDragEl.dataset.collectionPack;
      const targetId = target.dataset.collectionPack;
      const from = nuvioCollectionPacks.indexOf(draggedId);
      const to = nuvioCollectionPacks.indexOf(targetId);
      if (from < 0 || to < 0) return;
      nuvioCollectionPacks.splice(from, 1);
      nuvioCollectionPacks.splice(to, 0, draggedId);
      if (from < to) target.parentNode.insertBefore(_collectionDragEl, target.nextSibling);
      else target.parentNode.insertBefore(_collectionDragEl, target);
    }

    function collectionDragEnd() {
      if (!_collectionDragging) return;
      _collectionDragging = false;
      document.removeEventListener('mousemove', collectionDragMove);
      document.removeEventListener('touchmove', collectionDragMove);
      document.removeEventListener('mouseup', collectionDragEnd);
      document.removeEventListener('touchend', collectionDragEnd);
      if (_collectionClone) { _collectionClone.remove(); _collectionClone = null; }
      if (_collectionDragEl) { _collectionDragEl.style.opacity = ''; _collectionDragEl.style.transition = ''; }
      _collectionDragEl = null;
      if (_collectionMoved) checkChanged();
      _collectionMoved = false;
    }

    function toggleHideAnime(checked) {
      const adv = document.getElementById('hideAnime');
      if (adv) adv.checked = checked;
      renderCataloguesOptions();
      if (curatedCollectionDefs.length) renderCuratedCollectionPacks();
      checkChanged();
    }

    let _renderingCatalogues = false;
    function renderCataloguesOptions() {
      if (_renderingCatalogues) return;
      _renderingCatalogues = true;
      try { _renderCataloguesOptionsInner(); } finally { _renderingCatalogues = false; }
    }
    function _renderCataloguesOptionsInner() {
      const list = document.getElementById('catalogueList');
      if (!list) return;
      syncImportedCollectionOrder();
      const hideAnime = !!(document.getElementById('hideAnime') && document.getElementById('hideAnime').checked);
      const rows = [];
      catOrder.forEach((key, i) => {
        if (String(key).startsWith('collectionPack:')) {
          const pack = curatedCollectionDefs.find((item) => item.id === String(key).slice('collectionPack:'.length));
          if (!pack || !nuvioCollectionPacks.includes(pack.id)) return;
          const folderCount = (pack.folders || []).length;
          rows.push(`<div class="cg-row collection-summary-row cat-drag-item" data-cat-key="${escHtml(key)}" data-cat-idx="${i}"><span class="cat-drag-handle cg-row-handle">⠿</span><span class="watchlist-row-icon">${escHtml(pack.icon || '📦')}</span><div class="cg-row-name">${escHtml(pack.title)}<span class="cg-row-desc">${folderCount} folders in Nuvio · Collection</span></div><span class="imported-badge">Collection</span><label class="cg-switch" title="Remove collection"><input type="checkbox" checked onchange="toggleCuratedCollectionPack(${jsStr(pack.id)}, false)" /><span class="cg-slider"></span></label><div class="cg-kebab-wrap"><button type="button" class="cg-kebab-btn" onclick="toggleCatKebab(event, ${jsStr(`collection-${pack.id}`)})">⋯</button><div class="cg-kebab-menu" id="kebab-collection-${escHtml(pack.id)}"><button type="button" onclick="closeCatKebabs();editCuratedPack(${jsStr(pack.id)})">✎ Edit collection</button><button type="button" onclick="closeCatKebabs();toggleCuratedPackDetails(${jsStr(pack.id)})">👁 View folders</button><button type="button" onclick="closeCatKebabs();removeHomeRow(${jsStr(key)})">🗑 Remove from Home</button></div></div></div>`);
          return;
        }
        if (String(key).startsWith('importedCollection:')) {
          const entry = importedCollectionEntries().find(item => item.key === key);
          if (!entry || entry.collection.enabled === false) return;
          const folderCount = (entry.collection.folders || []).filter(folder => folder.enabled !== false).length;
          rows.push(`<div class="cg-row cat-drag-item imported-collection-summary-row" data-cat-key="${escHtml(key)}" data-cat-idx="${i}"><span class="cat-drag-handle cg-row-handle">⠿</span><div class="cg-row-name">${escHtml(entry.collection.title || 'Imported collection')}<span class="cg-row-desc">${folderCount} folder${folderCount === 1 ? '' : 's'} from ${escHtml(entry.source.title)}</span></div><span class="imported-badge">Collection</span><label class="cg-switch"><input type="checkbox" checked onchange="toggleImportedCollection(${jsStr(entry.source.id)},${jsStr(entry.collection.id)},false)" /><span class="cg-slider"></span></label><div class="cg-kebab-wrap"><button type="button" class="cg-kebab-btn" onclick="toggleCatKebab(event, ${jsStr(key)})">⋯</button><div class="cg-kebab-menu" id="kebab-${escHtml(key)}"><button type="button" onclick="closeCatKebabs();removeHomeRow(${jsStr(key)})">🗑 Remove from Home</button></div></div></div>`);
          return;
        }
        const meta = CATALOGUE_META[key] || {};
        if (key === 'anime' && hideAnime) return;
        const enabled = meta.enable ? !!catSelection[meta.enable] : true;
        // The summary is for active Home rows only. Disabled discovery rows
        // stay available in the Home Rows picker below instead of cluttering
        // this list.
        if (meta.enable && !enabled) return;
        rows.push(`<div class="cg-row cat-drag-item" data-cat-key="${escHtml(key)}" data-cat-idx="${i}"><span class="cat-drag-handle cg-row-handle">⠿</span><div class="cg-row-name">${escHtml(catNames[key] || key)}<span class="cg-row-desc">${meta.desc || ''}</span></div><label class="cg-switch">${meta.enable ? `<input type="checkbox" ${enabled ? 'checked' : ''} onchange="setCatOption(${jsStr(meta.enable)}, this.checked)" />` : '<input type="checkbox" checked disabled />'}<span class="cg-slider"></span></label><div class="cg-kebab-wrap"><button type="button" class="cg-kebab-btn" onclick="toggleCatKebab(event, ${jsStr(key)})">⋯</button><div class="cg-kebab-menu" id="kebab-${escHtml(key)}"><button type="button" onclick="closeCatKebabs();previewCatalogue(${jsStr(key)})">👁 Preview</button><button type="button" onclick="closeCatKebabs();editCatalogueName(${jsStr(key)})">✎ Rename</button><button type="button" onclick="closeCatKebabs();removeHomeRow(${jsStr(key)})">🗑 Remove from Home</button></div></div></div>`);
      });
      // Library selections are Home rows too. Keep them visible even when
      // hidden from Home so the switch can be toggled back on without
      // hunting in the picker.
      (Array.isArray(libraryCatalogs) ? libraryCatalogs : []).forEach((id) => {
        const def = (libCatalogDefs || []).find((item) => item.id === id)
          || { id, name: id, type: 'movie', description: 'Added from the Home Rows library' };
        const hidden = libHomeHidden.includes(id);
        rows.push(`<div class="cg-row library-summary-row${hidden ? ' row-hidden' : ''}" data-library-id="${escHtml(id)}"><span class="cg-row-handle cg-row-handle-muted">⠿</span><div class="cg-row-name">${escHtml(catalogDisplayName(def))}<span class="cg-row-desc">${escHtml(def.description || 'Added from the Home Rows library')}${hidden ? ' · hidden from Home' : ''}</span></div><label class="cg-switch" title="${hidden ? 'Show on Home' : 'Hide from Home'}"><input type="checkbox" ${hidden ? '' : 'checked'} onchange="toggleLibHomeHidden(${jsStr(id)})" /><span class="cg-slider"></span></label><div class="cg-kebab-wrap"><button type="button" class="cg-kebab-btn" onclick="toggleCatKebab(event, ${jsStr('lib-' + id)})">⋯</button><div class="cg-kebab-menu" id="kebab-lib-${escHtml(id)}"><button type="button" onclick="closeCatKebabs();editLibraryRowName(${jsStr(id)})">✎ Rename</button><button type="button" onclick="closeCatKebabs();toggleLibCatalog(${jsStr(id)}, false); checkChanged();">🗑 Remove</button></div></div></div>`);
      });
      // Account-backed watchlists are shown only in My Rows. Connecting a
      // service is enough: its credentials stay server-side in the account.
      if (connectedWatchlists) {
        for (const [id, name, icon] of [['simkl', 'Simkl', '🎬'], ['trakt', 'Trakt', '🎬'], ['mdblist', 'MDBList', '🎯']]) {
          if (!connectedWatchlists[id]?.connected) continue;
          for (const [, label] of [['movie', 'Movies'], ['series', 'Series']]) {
            const watchlistId = `torbox-watchlist-${id}-${label === 'Movies' ? 'movie' : 'series'}`;
            const defaultName = `${name} Watchlist · ${label}`;
            const hidden = watchlistHomeHidden.includes(watchlistId);
            const displayName = watchlistNames[watchlistId] || defaultName;
            rows.push(`<div class="cg-row library-summary-row watchlist-summary-row${hidden ? ' row-hidden' : ''}" data-watchlist-id="${escHtml(watchlistId)}"><span class="cg-row-handle cg-row-handle-muted">⠿</span><span class="watchlist-row-icon">${icon}</span><div class="cg-row-name">${escHtml(displayName)}<span class="cg-row-desc">Synced securely from your LeLibrary account${hidden ? ' · hidden from Home' : ''}</span></div><label class="cg-switch" title="${hidden ? 'Show on Home' : 'Hide from Home'}"><input type="checkbox" ${hidden ? '' : 'checked'} onchange="toggleWatchlistHomeHidden(${jsStr(watchlistId)})" /><span class="cg-slider"></span></label><div class="cg-kebab-wrap"><button type="button" class="cg-kebab-btn" onclick="toggleCatKebab(event, 'watchlist-${escHtml(watchlistId)}')">⋯</button><div class="cg-kebab-menu" id="kebab-watchlist-${escHtml(watchlistId)}"><button type="button" onclick="closeCatKebabs();editWatchlistRowName(${jsStr(watchlistId)}, ${jsStr(defaultName)})">✎ Rename</button></div></div></div>`);
          }
        }
      }
      importedRows.forEach((source) => (source.rows || []).sort((a,b)=>(a.order||0)-(b.order||0)).forEach((row) => {
        const enabled = row.enabled !== false;
        rows.push(`<div class="cg-row library-summary-row imported-summary-row${enabled ? '' : ' row-hidden'}" data-imported-row="${escHtml(row.id)}"><span class="cg-row-handle cg-row-handle-muted">⬇</span><div class="cg-row-name">${escHtml(row.title)}<span class="cg-row-desc">Imported from ${escHtml(source.title)}${enabled ? '' : ' · hidden'}</span></div><span class="imported-badge">Imported</span><label class="cg-switch" title="${enabled ? 'Hide' : 'Show'}"><input type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleImportedRow('${source.id}','${row.id}',this.checked)" /><span class="cg-slider"></span></label></div>`);
      }));
      list.innerHTML = rows.join('');
      const total = document.getElementById('yourRowsTotal');
      // Hidden rows stay listed so they can be restored, but they are not
      // selected Home rows and must not inflate the summary badge.
      if (total) total.textContent = `${rows.filter((row) => !row.includes(' row-hidden')).length} selected`;
      // Bind drag-to-reorder on handles only
      list.querySelectorAll('.cat-drag-item .cat-drag-handle').forEach(handle => {
        handle.addEventListener('mousedown', catDragStart);
        handle.addEventListener('touchstart', catDragStart, { passive: false });
      });
      list.querySelectorAll('.collection-drag-handle').forEach(handle => {
        handle.addEventListener('mousedown', collectionDragStart);
        handle.addEventListener('touchstart', collectionDragStart, { passive: false });
      });
      // Sync the standalone "Hide anime" toggle with the Advanced-step state.
      const ha = document.getElementById('editHideAnime');
      if (ha && ha.checked !== hideAnime) { ha.checked = hideAnime; }
      // Keep the older per-row checkbox ids alive for code that still references them.
      const syncId = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
      syncId('editCatFranchises', catSelection.franchises);
      syncId('editCatTrendingMovies', catSelection.trendingMovies);
      syncId('editCatTrendingSeries', catSelection.trendingSeries);
      syncId('editCatPopularMovies', catSelection.popularMovies);
      syncId('editCatPopularSeries', catSelection.popularSeries);
      syncId('editCatMovies', catSelection.movies);
      syncId('editCatSeries', catSelection.series);
      syncId('editCatAnime', catSelection.anime);
      for (const [id, name] of [['editCatFranchisesTitle', catNames.franchises], ['editCatTrendingTitle', catNames.trending], ['editCatPopularTitle', catNames.popular], ['editCatMoviesTitle', catNames.movies], ['editCatSeriesTitle', catNames.series], ['editCatAnimeTitle', catNames.anime]]) {
        const t = document.getElementById(id);
        if (t) t.textContent = name;
      }
      loadConnectedWatchlists();
    }

    async function loadConnectedWatchlists(force = false) {
      // Account watchlists can only be attached to an opaque account token.
      // A generic /configure page creates a standalone token, so showing rows
      // there would promise a connection that cannot be saved with it.
      if (!ACCOUNT_TOKEN) return;
      if (!window.WatchlistShared?.fetchWatchlistStatus || connectedWatchlistsLoading) return;
      if (connectedWatchlists && !force) return;
      connectedWatchlistsLoading = true;
      try {
        const status = await window.WatchlistShared.fetchWatchlistStatus();
        const changed = JSON.stringify(status) !== JSON.stringify(connectedWatchlists);
        connectedWatchlists = status;
        if (changed) renderCataloguesOptions();
      } catch {
        connectedWatchlists = { simkl: { connected: false }, trakt: { connected: false }, mdblist: { connected: false } };
      } finally {
        connectedWatchlistsLoading = false;
      }
    }

    async function updateWatchlistAccountCta() {
      const cta = document.getElementById('watchlistAccountSettings');
      if (!cta) return;
      const title = document.getElementById('watchlistConnectTitle');
      const copy = document.getElementById('watchlistAccountCopy');
      const steps = document.getElementById('watchlistAccountSteps');
      const statusPanel = document.getElementById('watchlistTokenStatus');
      if (ACCOUNT_TOKEN) {
        if (title) title.textContent = 'Your watchlists are linked to this account token';
        if (copy) copy.textContent = 'Manage Simkl, Trakt or MDBList in Account Settings. Any connected watchlists sync automatically into My Rows for this token, so you can continue configuring and installing it here.';
        if (steps) steps.innerHTML = '<li><strong>Manage services</strong> in Account Settings.</li><li><strong>Save a connection</strong> to sync its watchlists.</li><li><strong>Continue this setup</strong> and install your token.</li>';
      }
      try {
        const response = await fetch('/api/account/me', { cache: 'no-store', credentials: 'same-origin' });
        if (response.status === 404) return; // Self-hosted: no account area.
        cta.hidden = false;
        cta.textContent = response.status === 200 ? 'Open Account Settings' : 'Create or sign in';
        cta.href = response.status === 200 ? '/account/settings' : '/account/login?next=%2Faccount%2Fsettings';
        if (ACCOUNT_TOKEN && response.status === 200 && statusPanel && window.WatchlistShared?.renderWatchlistSection) {
          statusPanel.hidden = false;
          await window.WatchlistShared.renderWatchlistSection('watchlistTokenStatusRows', { showAddButton: false, showActions: false });
        }
      } catch { /* Account features are unavailable here. */ }
    }

    function closeCatKebabs() { document.querySelectorAll('.cg-kebab-menu.open').forEach(m => m.classList.remove('open')); }
    function toggleCatKebab(e, key) { e.stopPropagation(); const menu = document.getElementById('kebab-' + key); const wasOpen = menu && menu.classList.contains('open'); closeCatKebabs(); if (menu && !wasOpen) menu.classList.add('open'); }
    document.addEventListener('click', closeCatKebabs);

    // ── Live catalogue preview (Step 4) ────────────────────────────────────
    // Each catalogue row's 👁 button renders the first titles the catalogue
    // will show, straight from the REAL catalog pipeline (/:token/preview/…),
    // so the preview always matches what Stremio/Nuvio receive.
    const CATALOGUE_PREVIEW_MAP = {
      trendingMovies: ['movie', 'torbox-trending-movies'],
      trendingSeries: ['series', 'torbox-trending-series'],
      popularMovies:  ['movie', 'torbox-popular-movies'],
      popularSeries:  ['series', 'torbox-popular-series'],
      movies:         ['movie', 'torbox-movies'],
      series:         ['series', 'torbox-series'],
      anime:          ['series', 'torbox-anime'],
      franchises:     ['movie', 'torbox-collections'],
    };

    let _catPreviewAbort = null;

    function catPreviewOpen() {
      const wrap = document.getElementById('catPreviewWrap');
      const body = document.getElementById('catPreviewBody');
      if (!wrap || !body) return;
      wrap.style.display = 'block';
      body.classList.add('open');
      wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    async function previewCatalogue(key) {
      const pair = CATALOGUE_PREVIEW_MAP[key];
      const grid = document.getElementById('catPreviewGrid');
      const head = document.getElementById('catPreviewHead');
      const foot = document.getElementById('catPreviewFooter');
      if (!pair || !grid || !head || !foot) return;
      catPreviewOpen();
      const label = catNames[key] || key;
      head.textContent = 'Previewing "' + label + '"…';
      if (_catPreviewAbort) _catPreviewAbort.abort();
      const controller = new AbortController();
      _catPreviewAbort = controller;
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:14px 0">Loading preview…</div>';
      foot.textContent = '';
      let cfg;
      try { cfg = buildSavedConfig(); }
      catch (e) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--error);padding:14px 0">Could not read the form: ' + escHtml(e.message || e) + '</div>'; return; }
      try {
        const r = await fetch('/api/preview', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ config: cfg, type: pair[0], catalogId: pair[1] }) });
        if (!r.ok) throw new Error('Preview request failed (' + r.status + ')');
        const data = await r.json();
        if (controller.signal.aborted) return;
        const metas = Array.isArray(data.metas) ? data.metas : [];
        if (data.error === 'missing_keys') { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--amber);padding:14px 0">Enter your provider and TMDB keys first: the catalogue would be empty until then.</div>'; head.textContent = 'Previewing "' + label + '"'; return; }
        if (!metas.length) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:14px 0">No titles yet: check your keys, or add files to your provider account.</div>'; head.textContent = 'Previewing "' + label + '"'; return; }
        grid.innerHTML = metas.map(m => `<div style="text-align:center">${m.poster ? `<img src="${escHtml(m.poster)}" alt="${escHtml(m.name || '')}" loading="lazy" style="width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:8px;background:var(--panel);border:1px solid var(--border)" onerror="this.style.opacity=0.25" />` : '<div style="width:100%;aspect-ratio:2/3;border-radius:8px;background:var(--panel);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:0.6rem;padding:4px;box-sizing:border-box">No poster</div>'}<div style="font-size:0.6rem;color:var(--muted);margin-top:4px;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(m.name || '')}">${escHtml(m.name || '')}</div></div>`).join('');
        head.textContent = 'Previewing "' + label + '": first ' + metas.length + (data.total > metas.length ? ' of ' + data.total : '') + ' titles';
        foot.textContent = data.total > metas.length ? 'Showing the first ' + metas.length + ' of ' + data.total + ' titles: the full catalogue loads when installed.' : 'Rendered from the same pipeline Stremio and Nuvio receive';
      } catch (e) { if (controller.signal.aborted) return; grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--error);padding:14px 0">Preview failed: ' + escHtml(e.message || e) + '</div>'; head.textContent = 'Previewing "' + label + '"'; }
    }

    // ── Full-setup preview modal (Install step) ────────────────────────────
    // Every enabled catalogue rendered as a poster strip straight from the
    // REAL catalog pipeline (same endpoint as the per-row preview), plus the
    // stream format section: a scrollable look at the whole addon before
    // installing. Rows load in parallel; failures stay isolated per row.
    let _fullPreviewAbort = null;

    function fullPreviewRows() {
      const rows = [];
      catOrder.forEach((key) => {
        const meta = CATALOGUE_META[key] || {};
        const pair = CATALOGUE_PREVIEW_MAP[key];
        if (!pair) return;
        if (meta.enable && !catSelection[meta.enable]) return;
        if (key === 'anime' && document.getElementById('hideAnime') && document.getElementById('hideAnime').checked) return;
        rows.push({ name: catNames[key] || key, type: pair[0], catalogId: pair[1] });
      });
      (Array.isArray(libraryCatalogs) ? libraryCatalogs : []).forEach((id) => {
        const def = (Array.isArray(libCatalogDefs) ? libCatalogDefs : []).find((d) => d.id === id);
        rows.push({ name: (def && def.name) || id, type: (def && def.type) || 'movie', catalogId: id });
      });
      return rows;
    }

    function openFullSetupPreview() {
      const modal = document.getElementById('fullPreviewModal');
      const body = document.getElementById('fullPreviewBody');
      if (!modal || !body) return;

      let cfg;
      try {
        cfg = buildSavedConfig();
      } catch (e) {
        showToast('Could not read the form: ' + (e.message || e));
        return;
      }
      if (!cfg || !Object.keys(cfg).length) { showToast('Fill in your setup first'); return; }

      if (_fullPreviewAbort) _fullPreviewAbort.abort();
      const controller = new AbortController();
      _fullPreviewAbort = controller;

      const rows = fullPreviewRows();
      const sub = document.getElementById('fullPreviewSub');
      if (sub) sub.textContent = rows.length + ' rows · rendered from the same pipeline Stremio and Nuvio receive';

      body.innerHTML = rows.map((row, i) => `
        <section class="fp-row">
          <div class="fp-row-head"><strong>${escHtml(row.name)}</strong><small id="fpCount-${i}"></small></div>
          <div class="fp-strip" id="fpStrip-${i}"><div class="fp-loading">Loading preview…</div></div>
        </section>`).join('')
        + '<section class="fp-row fp-streams">'
        + '<div class="fp-row-head"><strong>Stream format</strong><small>How your streams will look in the player</small></div>'
        + '<div id="fpStreams">' + streamSampleRowsHtml() + '</div>'
        + '</section>';

      rows.forEach((row, i) => {
        fetch('/api/preview', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ config: cfg, type: row.type, catalogId: row.catalogId }),
        })
          .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then((data) => {
            if (controller.signal.aborted) return;
            const strip = document.getElementById('fpStrip-' + i);
            const count = document.getElementById('fpCount-' + i);
            if (!strip) return;
            const metas = Array.isArray(data.metas) ? data.metas : [];
            if (data.error === 'missing_keys') {
              strip.innerHTML = '<div class="fp-error">Enter your provider and TMDB keys first: this row would be empty until then.</div>';
              return;
            }
            if (!metas.length) {
              strip.innerHTML = '<div class="fp-loading">No titles yet: add files to your provider account, or check your keys.</div>';
              return;
            }
            if (count) count.textContent = metas.length + (data.total > metas.length ? ' of ' + data.total : '') + ' titles';
            strip.innerHTML = metas.map((m) => `
              <div class="fp-card">
                ${m.poster
                  ? `<img src="${escHtml(m.poster)}" alt="${escHtml(m.name || '')}" loading="lazy" onerror="this.style.opacity=0.25">`
                  : '<div style="aspect-ratio:2/3;border-radius:8px;background:var(--panel,#1a1a1f);border:1px solid var(--border,#26262c);display:flex;align-items:center;justify-content:center;color:var(--muted,#9a9aa5);font-size:0.55rem;padding:4px;box-sizing:border-box">No poster</div>'}
                <div class="fp-name" title="${escHtml(m.name || '')}">${escHtml(m.name || '')}</div>
              </div>`).join('');
          })
          .catch((err) => {
            if (controller.signal.aborted) return;
            const strip = document.getElementById('fpStrip-' + i);
            if (strip) strip.innerHTML = '<div class="fp-error">Preview failed: ' + escHtml(err.message || err) + '</div>';
          });
      });

      modal.hidden = false;
      document.body.style.overflow = 'hidden';
    }

    function closeFullSetupPreview() {
      const modal = document.getElementById('fullPreviewModal');
      if (modal) modal.hidden = true;
      document.body.style.overflow = '';
      if (_fullPreviewAbort) { _fullPreviewAbort.abort(); _fullPreviewAbort = null; }
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('fullPreviewModal');
        if (modal && !modal.hidden) closeFullSetupPreview();
      }
    });
    document.addEventListener('click', (e) => {
      const modal = document.getElementById('fullPreviewModal');
      if (modal && !modal.hidden && e.target === modal) closeFullSetupPreview();
    });

    // Rename a catalogue: prompt for the new display name and sync every
    // checkbox/title that shows it (Step 5 + Catalogues tab).
    // Rename a catalogue: inline modal with a real input (prompt() can mangle
    // emojis on some devices). Emojis are fully supported in catalogue names.
    function editCatalogueName(key) {
      const current = catNames[key] || '';
      const label = catNames[key] || key;
      const existing = document.getElementById('renameModal');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'renameModal';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1200;display:flex;align-items:center;justify-content:center';
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
      overlay.innerHTML = `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;max-width:400px;width:92%;text-align:center">
          <h3 style="margin:0 0 6px 0;color:var(--white);font-size:1rem">Rename "${escHtml(current || label)}"</h3>
          <p style="color:var(--muted);font-size:0.78rem;margin:0 0 14px 0">Emojis welcome.</p>
          <input id="renameInput" type="text" value="${escHtml(current || label)}" autofocus maxlength="40"
            style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:0.95rem;font-family:var(--font);box-sizing:border-box"
            onkeydown="if(event.key==='Enter'){saveRename('${key}');} if(event.key==='Escape'){this.closest('#renameModal').remove();}" />
          <div style="display:flex;gap:8px;margin-top:16px">
            <button type="button" style="flex:1;padding:9px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer" onclick="this.closest('#renameModal').remove()">Cancel</button>
            <button type="button" style="flex:1;padding:9px;border-radius:8px;border:1px solid var(--amber);background:var(--amber-glow);color:var(--amber);cursor:pointer;font-weight:600" onclick="saveRename('${key}')">Save</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const input = document.getElementById('renameInput');
      if (input) { input.focus(); input.select(); }
    }

    function saveRename(key) {
      const input = document.getElementById('renameInput');
      if (!input) return;
      const trimmed = input.value.trim();
      if (!trimmed) { input.focus(); return; }
      catNames[key] = trimmed;
      const modal = document.getElementById('renameModal');
      if (modal) modal.remove();
      renderCataloguesOptions();
      checkChanged();
      showToast('Catalogue renamed: remember to save and re-push');
    }

    function editLibraryRowName(id) {
      const def = (libCatalogDefs || []).find(c => c.id === id);
      const current = libraryNames[id] || (def ? catalogDisplayName(def) : id);
      const existing = document.getElementById('renameModal');
      if (existing) existing.remove();
      const overlay = document.createElement('div');
      overlay.id = 'renameModal';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1200;display:flex;align-items:center;justify-content:center';
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
      overlay.innerHTML = `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;max-width:400px;width:92%;text-align:center">
          <h3 style="margin:0 0 6px 0;color:var(--white);font-size:1rem">Rename "${escHtml(current)}"</h3>
          <p style="color:var(--muted);font-size:0.78rem;margin:0 0 14px 0">Emojis welcome. This name appears in My Rows and on your Home.</p>
          <input id="renameInput" type="text" value="${escHtml(current)}" autofocus maxlength="40"
            style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:0.95rem;font-family:var(--font);box-sizing:border-box"
            onkeydown="if(event.key==='Enter'){saveLibraryRename(${jsStr(id)});} if(event.key==='Escape'){this.closest('#renameModal').remove();}" />
          <div style="display:flex;gap:8px;margin-top:16px">
            <button type="button" style="flex:1;padding:9px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer" onclick="this.closest('#renameModal').remove()">Cancel</button>
            <button type="button" style="flex:1;padding:9px;border-radius:8px;border:1px solid var(--amber);background:var(--amber-glow);color:var(--amber);cursor:pointer;font-weight:600" onclick="saveLibraryRename(${jsStr(id)})">Save</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const input = document.getElementById('renameInput');
      if (input) { input.focus(); input.select(); }
    }

    function saveLibraryRename(id) {
      const input = document.getElementById('renameInput');
      if (!input) return;
      const trimmed = input.value.trim();
      if (!trimmed) { input.focus(); return; }
      libraryNames[id] = trimmed;
      const modal = document.getElementById('renameModal');
      if (modal) modal.remove();
      renderCataloguesOptions();
      renderLibraryGroups();
      checkChanged();
      showToast('Home row renamed: remember to save', 'success');
    }

    // ── V5 Catalog library picker (grouped) ─────────────────────────
    // The 451-row catalog library (streaming services, studios, actors,
    // franchises, themes…). Fetched once from /api/catalog-library; the user
    // toggles rows into `libraryCatalogs`, which is saved in the config token.
    let libCatalogDefs = null;
    let libraryCatalogs = [];
    let libHomeHidden = [];
    let watchlistHomeHidden = [];
    let connectedWatchlists = null;
    let connectedWatchlistsLoading = false;
    let curatedCollectionDefs = [];
    let nuvioCollectionPacks = [];
    let nuvioCollectionOverrides = {};
    let importedRows = [];
    let catGroupExpanded = new Set();

    function curatedAnimeHidden() {
      return !!document.getElementById('hideAnime')?.checked;
    }
    function isAnimeCuratedFolder(folder) {
      return (folder.catalogSources || []).some((source) => String(source.catalogId || '').replace(/^lib-/, '').startsWith('studio_ghibli_'));
    }
    function visibleCuratedPack(pack) {
      if (!curatedAnimeHidden()) return pack;
      return { ...pack, folders: (pack.folders || []).filter((folder) => !isAnimeCuratedFolder(folder)) };
    }

    async function loadLibCatalogDefs() {
      try {
        const r = await fetch('/api/catalog-library', { cache: 'no-store' });
        const data = await r.json();
        libCatalogDefs = (data.catalogs || []).sort((a, b) => (a.group + a.name).localeCompare(b.group + b.name));
        renderLibraryGroups();
        // A pack may be selected before this catalogue-library request
        // finishes. Refresh Home layout once definitions arrive so those
        // selected sources become visible immediately.
        renderCataloguesOptions();
      } catch { /* non-fatal */ }
    }

    async function loadCuratedCollectionPacks() {
      try {
        const r = await fetch('/api/curated-collections', { cache: 'no-store' });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Could not load collection packs');
      curatedCollectionDefs = Array.isArray(data.collections) ? data.collections : [];
        cleanupFlattenedCuratedSources();
        renderCuratedCollectionPacks();
        renderCataloguesOptions();
      } catch (err) {
        console.warn('[collections] curated pack load failed:', err.message);
      }
    }

    function friendlyCatalogSourceName(catalogId, type) {
      const id = String(catalogId || '').replace(/^lib-/, '');
      const known = libCatalogDefs && libCatalogDefs.find((source) => source.id === id || source.catalogId === catalogId);
      if (known && known.name) return known.name;
      const suffix = type === 'series' ? ' Series' : type === 'movie' ? ' Movies' : '';
      return id.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(/ Movies| Series$/, '') + suffix;
    }

    function curatedPackFolderList(pack) {
      const folders = Array.isArray(pack.folders) ? pack.folders : [];
      const renderFolder = (folder) => {
        const sources = (folder.catalogSources || []).map((source) => source.title || friendlyCatalogSourceName(source.catalogId, source.type)).filter(Boolean).join(' · ');
        const art = folder.focusGifUrl || folder.coverImageUrl || '';
        const artHtml = art
          ? `<img class="curated-folder-art" src="${escHtml(art)}" alt="" loading="lazy" />`
          : '<span class="curated-folder-art curated-folder-art-fallback">▦</span>';
        return `<div class="curated-folder-item">${artHtml}<span><strong>${escHtml(folder.title || 'Untitled folder')}</strong><small>${escHtml(sources || 'Curated catalogue source')}</small></span></div>`;
      };
      const sections = Array.isArray(pack.sections) ? pack.sections : [];
      const groupedFolderIds = new Set(sections.flatMap((section) => section.folders || []));
      return sections.length
        ? sections.map((section) => {
          const sectionFolders = folders.filter((folder) => (section.folders || []).includes(folder.id));
          if (!sectionFolders.length) return '';
          return `<div class="curated-pack-section"><div class="curated-pack-section-head"><strong>${escHtml(section.title || 'Section')}</strong><span>${sectionFolders.length} folder${sectionFolders.length === 1 ? '' : 's'}</span></div>${sectionFolders.map(renderFolder).join('')}</div>`;
        }).join('') + folders.filter((folder) => !groupedFolderIds.has(folder.id)).map(renderFolder).join('')
        : folders.map(renderFolder).join('');
    }

    function curatedSectionEditorPack(pack, section) {
      return { ...pack, id: `${pack.id}:${section.id}`, title: section.title, sections: [], folders: (pack.folders || []).filter((folder) => (section.folders || []).includes(folder.id)) };
    }

    function renderCuratedCollectionPacks() {
      const el = document.getElementById('curatedPackList');
      const total = document.getElementById('curatedPackTotal');
      if (!el) return;
      const selected = new Set(nuvioCollectionPacks);
      el.innerHTML = curatedCollectionDefs.map(visibleCuratedPack).map((pack) => {
        const on = selected.has(pack.id);
        const folders = Array.isArray(pack.folders) ? pack.folders : [];
        const splitSpecial = pack.id === 'lelibrary-special' && on && Array.isArray(pack.sections)
          ? `<div class="curated-special-sections">${pack.sections.map((section) => { const sectionPack = curatedSectionEditorPack(pack, section); return `<div class="curated-special-section"><span><strong>${escHtml(section.title)}</strong><small>${sectionPack.folders.length} folders · separate Nuvio collection</small></span><button type="button" class="curated-pack-edit" onclick="editCuratedPack(${jsStr(sectionPack.id)})">Edit collection</button></div>`; }).join('')}</div>`
          : '';
        return `<div class="curated-pack-card ${on ? 'selected' : ''}">
          <div class="curated-pack-head">
            <label class="curated-pack-choice"><input type="checkbox" ${on ? 'checked' : ''} onchange="toggleCuratedCollectionPack(${jsStr(pack.id)}, this.checked)" /><span class="curated-pack-icon">${escHtml(pack.icon || '✨')}</span><span class="ci-name"><b>${escHtml(pack.title)}</b><small>${escHtml(pack.description || '')}</small></span></label>
            <span class="catgroup-count">${folders.length} folders</span>
            <button type="button" class="curated-pack-view" onclick="toggleCuratedPackDetails(${jsStr(pack.id)})">View folders</button>
            <button type="button" class="curated-pack-edit" onclick="editCuratedPack(${jsStr(pack.id)})">Edit</button>
          </div>
          <div class="curated-pack-details" id="curated-pack-details-${escHtml(pack.id)}"></div>${splitSpecial}
        </div>`;
      }).join('') || '<div style="padding:14px;color:var(--muted);font-size:0.82rem">No curated packs available</div>';
      if (total) total.textContent = `${nuvioCollectionPacks.length} selected`;
    }

    function toggleCuratedPackDetails(id) {
      const details = document.getElementById(`curated-pack-details-${id}`);
      const button = details?.previousElementSibling?.querySelector('.curated-pack-view');
      if (!details) return;
      const open = details.classList.toggle('open');
      if (open && !details.dataset.loaded) {
        const pack = curatedCollectionDefs.find((item) => item.id === id);
        details.innerHTML = pack ? (curatedPackFolderList(visibleCuratedPack(pack)) || '<span class="field-hint">No folders in this pack.</span>') : '<span class="field-hint">No folders in this pack.</span>';
        details.dataset.loaded = 'true';
      }
      if (button) button.textContent = open ? 'Hide folders' : 'View folders';
    }

    // Curated packs and imported Nuvio exports use the same native folder
    // contract. Keep their editing UI in one place so imported artwork and
    // presentation settings never become a second-class, hidden data shape.
    function collectionPackSettingsEditor(settings, attribute = 'data-pack-setting', disabled = false) {
      const off = disabled ? ' disabled' : '';
      return `<div class="curated-pack-settings"><strong>Nuvio collection settings</strong><div class="curated-pack-settings-grid"><label><span>Display mode</span><select ${attribute}="viewMode"${off}><option value="TABBED_GRID" ${settings.viewMode === 'TABBED_GRID' ? 'selected' : ''}>Tabbed grid</option><option value="FOLLOW_LAYOUT" ${settings.viewMode === 'FOLLOW_LAYOUT' ? 'selected' : ''}>Follow layout</option></select></label><label class="curated-edit-toggle"><input type="checkbox" ${attribute}="pinToTop" ${settings.pinToTop ? 'checked' : ''}${off}><span class="curated-fake-toggle"></span> Pin to top</label><label class="curated-edit-toggle"><input type="checkbox" ${attribute}="focusGlowEnabled" ${settings.focusGlowEnabled !== false ? 'checked' : ''}${off}><span class="curated-fake-toggle"></span> Focus glow</label><label class="curated-edit-toggle"><input type="checkbox" ${attribute}="showAllTab" ${settings.showAllTab !== false ? 'checked' : ''}${off}><span class="curated-fake-toggle"></span> Show All tab</label></div><small>These settings apply to this Nuvio collection only. Pinning is optional and does not affect catalogue ordering.</small></div>`;
    }

    function collectionFolderEditor(folder, { edit = folder, includeEnabled = false, readOnly = false } = {}) {
      const off = readOnly ? ' disabled' : '';
      const artworkField = (label, field, placeholder, hint) => `<label class="curated-art-field"><span>${label}</span><div class="curated-art-input"><input data-field="${field}" value="${escHtml(displayCollectionArtwork(edit[field] || ''))}" placeholder="${placeholder || 'https://…'}"${off} /><button type="button" title="Reset to imported value" data-field="${field}" data-original="${escHtml(displayCollectionArtwork(folder[field] || ''))}" onclick="resetCollectionField(this)"${off}>↶</button></div><small class="curated-art-hint">${hint}</small></label>`;
      const sources = (folder.catalogSources || []).map((source) => `<span class="curated-source-pill">${escHtml(source.title || source.sourceTitle || friendlyCatalogSourceName(source.catalogId, source.type))}</span>`).join('');
      const unresolvedHint = folder._unresolved ? `<span class="field-hint" style="color:#e67e22">Source not available: this folder has been disabled and will be skipped on push.</span>` : '';
      return `<div class="curated-edit-row" data-folder-id="${escHtml(folder.id)}">
        <div class="curated-edit-folder-head">${includeEnabled ? `<label class="curated-edit-toggle"><input type="checkbox" data-import-enabled ${folder.enabled !== false ? 'checked' : ''}${off}><span class="curated-fake-toggle"></span></label>` : ''}<div class="curated-edit-preview"><img data-preview="cover" src="${escHtml(displayCollectionArtwork(edit.coverImageUrl || edit.heroBackdropUrl || ''))}" alt="" onload="this.nextElementSibling.style.display='none'" onerror="this.style.display='none'" /><span>▱</span></div><div class="curated-edit-gif-preview" title="Focus GIF preview"><img data-preview="gif" src="${escHtml(displayCollectionArtwork(edit.focusGifUrl || ''))}" alt="" onload="this.parentElement.classList.add('has-image')" onerror="this.parentElement.classList.remove('has-image')" /><span>GIF</span></div><div class="curated-edit-title"><strong data-preview="title">${escHtml(edit.title || 'Folder')}</strong><small>${escHtml(folder.id)}</small></div><span class="curated-source-count">${(folder.catalogSources || []).length} source${(folder.catalogSources || []).length === 1 ? '' : 's'}</span></div>
        <label class="curated-edit-name">Folder name<input data-field="title" value="${escHtml(edit.title || '')}" maxlength="100"${off}></label>
        <div class="curated-art-grid">${artworkField('Cover image', 'coverImageUrl', 'https://…/cover.png', 'PNG, JPG/JPEG, WebP or animated GIF')}${artworkField('Hero backdrop', 'heroBackdropUrl', 'https://…/backdrop.jpg', 'PNG, JPG/JPEG or WebP')}${artworkField('Focus animation', 'focusGifUrl', 'https://…/focus.webp', 'Animated GIF or WebP')}${artworkField('Title logo', 'titleLogoUrl', 'https://…/logo.png', 'PNG, JPG/JPEG or WebP')}</div>
        <div class="curated-edit-options"><label class="curated-edit-toggle"><input type="checkbox" data-field="focusGifEnabled" ${edit.focusGifEnabled ? 'checked' : ''}${off}><span class="curated-fake-toggle"></span> Focus GIF enabled</label><label class="curated-edit-toggle"><input type="checkbox" data-field="showTitle" ${!edit.hideTitle ? 'checked' : ''}${off}><span class="curated-fake-toggle"></span> Show title</label><label class="curated-edit-shape">Tile shape<select data-field="tileShape"${off}><option value="LANDSCAPE" ${(edit.tileShape || 'LANDSCAPE') === 'LANDSCAPE' ? 'selected' : ''}>Landscape</option><option value="PORTRAIT" ${edit.tileShape === 'PORTRAIT' ? 'selected' : ''}>Poster</option></select></label></div>
        <div class="curated-sources"><strong>Catalog sources</strong><div>${sources || '<span class="field-hint">No catalog sources</span>'}${unresolvedHint ? `<div style="margin-top:6px">${unresolvedHint}</div>` : ''}</div></div>
      </div>`;
    }

    function bindCollectionEditorPreviews(modal) {
      modal.addEventListener('input', (event) => {
        const row = event.target.closest('.curated-edit-row');
        if (!row) return;
        if (event.target.dataset.field === 'title') {
          const title = row.querySelector('[data-preview="title"]');
          if (title) title.textContent = event.target.value.trim() || 'Folder';
          return;
        }
        const preview = row.querySelector(`[data-preview="${event.target.dataset.field === 'focusGifUrl' ? 'gif' : 'cover'}"]`);
        if (!preview || !event.target.dataset.field?.match(/Url$/)) return;
        const value = event.target.value.trim();
        preview.src = value;
        if (event.target.dataset.field === 'focusGifUrl') preview.parentElement.classList.toggle('has-image', !!value);
        preview.style.display = value ? '' : 'none';
      });
    }

    function editCuratedPack(id) {
      const [baseId, sectionId] = String(id).split(':');
      const originalPack = curatedCollectionDefs.find((item) => item.id === baseId);
      const section = sectionId ? originalPack?.sections?.find((item) => item.id === sectionId) : null;
      const pack = originalPack ? visibleCuratedPack(section ? curatedSectionEditorPack(originalPack, section) : originalPack) : null;
      if (!pack) return;
      document.getElementById('curatedEditModal')?.remove();
      const overrides = nuvioCollectionOverrides[id]?.folders || {};
      const baseSettings = pack.settings || { viewMode: 'TABBED_GRID', pinToTop: false, showAllTab: true, focusGlowEnabled: true };
      const settings = { ...baseSettings, ...(nuvioCollectionOverrides[id]?.settings || {}) };
      const folders = pack.folders || [];
      const renderEditFolder = (folder) => collectionFolderEditor(folder, { edit: { ...folder, ...(overrides[folder.id] || {}) } });
      const sections = Array.isArray(pack.sections) ? pack.sections : [];
      const groupedFolderIds = new Set(sections.flatMap((section) => section.folders || []));
      const rows = sections.length
        ? sections.map((section) => {
          const sectionFolders = folders.filter((folder) => (section.folders || []).includes(folder.id));
          if (!sectionFolders.length) return '';
          return `<div class="curated-edit-section-heading"><strong>${escHtml(section.title || 'Section')}</strong><span>${sectionFolders.length} folder${sectionFolders.length === 1 ? '' : 's'}</span></div>${sectionFolders.map(renderEditFolder).join('')}`;
        }).join('') + folders.filter((folder) => !groupedFolderIds.has(folder.id)).map(renderEditFolder).join('')
        : folders.map(renderEditFolder).join('');
      const modal = document.createElement('div');
      modal.id = 'curatedEditModal';
      modal.className = 'curated-edit-modal';
      modal.innerHTML = `<div class="curated-edit-dialog">
        <div class="curated-edit-head"><div><h3>Edit ${escHtml(pack.title)}</h3><p>Customize the artwork and folder names used in Nuvio.</p></div><button type="button" onclick="document.getElementById('curatedEditModal').remove()">×</button></div>
        <div class="curated-edit-body">${collectionPackSettingsEditor(settings)}${rows || '<p class="field-hint">This pack has no folders.</p>'}</div>
        <div class="curated-edit-actions"><button type="button" class="btn-copy-url" onclick="resetCuratedPack(${jsStr(id)})">Reset to original</button><span></span><button type="button" class="btn-copy-url" onclick="document.getElementById('curatedEditModal').remove()">Cancel</button><button type="button" class="btn-main btn-gen" onclick="saveCuratedPack(${jsStr(id)})">Save changes</button></div>
      </div>`;
      modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
      bindCollectionEditorPreviews(modal);
      document.body.appendChild(modal);
    }

    function resetCollectionField(button) {
      const row = button.closest('.curated-edit-row');
      const field = button.dataset.field;
      const input = row?.querySelector(`[data-field="${field}"]`);
        if (input) {
          input.value = button.dataset.original || '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    function displayCollectionArtwork(value) {
      if (!value || typeof value !== 'string') return '';
      try {
        const url = new URL(value, window.location.origin);
        if (url.origin === window.location.origin && url.pathname.startsWith('/collection-assets/')) return url.href;
      } catch { /* keep user-entered artwork unchanged */ }
      return value;
    }

    function storeCollectionArtwork(value) {
      if (!value || typeof value !== 'string') return '';
      try {
        const url = new URL(value, window.location.origin);
        if (url.origin === window.location.origin && url.pathname.startsWith('/collection-assets/')) return url.pathname + url.search;
      } catch { /* keep user-entered artwork unchanged */ }
      return value;
    }

    const CURATED_ARTWORK_RULES = {
      coverImageUrl: { label: 'Cover image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      heroBackdropUrl: { label: 'Hero backdrop', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
      focusGifUrl: { label: 'Focus animation', extensions: ['gif', 'webp'] },
      titleLogoUrl: { label: 'Title logo', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
    };

    function artworkUrlHint(field) {
      if (field === 'focusGifUrl') return 'GIF or WebP';
      if (field === 'coverImageUrl') return 'PNG, JPG/JPEG, WebP, or GIF';
      return 'PNG, JPG/JPEG, or WebP';
    }

    function validCuratedArtworkUrl(value, extensions) {
      if (!value) return true;
      try {
        const url = new URL(value, window.location.origin);
        if (!['http:', 'https:'].includes(url.protocol)) {
          if (!(url.origin === window.location.origin && url.pathname.startsWith('/collection-assets/'))) return false;
        }
        const pathname = url.pathname.toLowerCase();
        return extensions.some((extension) => pathname.endsWith(`.${extension}`));
      } catch {
        return false;
      }
    }

    function saveCuratedPack(id) {
      const modal = document.getElementById('curatedEditModal');
      if (!modal) return;
      const folders = {};
      const packSettings = {};
      modal.querySelectorAll('[data-pack-setting]').forEach((control) => {
        packSettings[control.dataset.packSetting] = control.type === 'checkbox' ? !!control.checked : control.value;
      });
      for (const row of modal.querySelectorAll('.curated-edit-row')) {
        for (const [field, rule] of Object.entries(CURATED_ARTWORK_RULES)) {
          const input = row.querySelector(`[data-field="${field}"]`);
          const value = input?.value.trim() || '';
          if (!validCuratedArtworkUrl(value, rule.extensions)) {
            input?.focus();
            showToast(`${rule.label} must be a ${artworkUrlHint(field)} URL`);
            return;
          }
        }
      }
      modal.querySelectorAll('.curated-edit-row').forEach((row) => {
        const value = (field) => row.querySelector(`[data-field="${field}"]`);
        folders[row.dataset.folderId] = {
          title: value('title')?.value.trim() || '',
          coverImageUrl: storeCollectionArtwork(value('coverImageUrl')?.value.trim() || ''),
          focusGifUrl: storeCollectionArtwork(value('focusGifUrl')?.value.trim() || ''),
          heroBackdropUrl: storeCollectionArtwork(value('heroBackdropUrl')?.value.trim() || ''),
          titleLogoUrl: storeCollectionArtwork(value('titleLogoUrl')?.value.trim() || ''),
          focusGifEnabled: !!value('focusGifEnabled')?.checked,
          hideTitle: !value('showTitle')?.checked,
          tileShape: value('tileShape')?.value === 'PORTRAIT' ? 'PORTRAIT' : 'LANDSCAPE',
        };
      });
      nuvioCollectionOverrides[id] = { settings: packSettings, folders };
      modal.remove();
      renderCuratedCollectionPacks();
      checkChanged();
      showToast('Pack artwork saved: save and re-push to apply it in Nuvio');
    }

    function resetCuratedPack(id) {
      delete nuvioCollectionOverrides[id];
      document.getElementById('curatedEditModal')?.remove();
      renderCuratedCollectionPacks();
      checkChanged();
      showToast('Pack reset to its original artwork');
    }

    function toggleCuratedCollectionPack(id, enabled) {
      const pack = curatedCollectionDefs.find((item) => item.id === id);
      if (!pack) return;
      if (enabled) {
        if (!nuvioCollectionPacks.includes(id)) nuvioCollectionPacks.push(id);
        syncCuratedCollectionOrder();
        renderCataloguesOptions();
      } else {
        nuvioCollectionPacks = nuvioCollectionPacks.filter((item) => item !== id);
        syncCuratedCollectionOrder();
        Object.keys(nuvioCollectionOverrides).filter((key) => key === id || key.startsWith(`${id}:`)).forEach((key) => delete nuvioCollectionOverrides[key]);
        renderCataloguesOptions();
        // Do not remove sources: they may have been selected independently or
        // be used by another selected pack.
      }
      renderCuratedCollectionPacks();
      checkChanged();
    }

    function cleanupFlattenedCuratedSources() {
      let changed = false;
      for (const pack of curatedCollectionDefs.filter((item) => nuvioCollectionPacks.includes(item.id))) {
        const sourceIds = [...new Set((pack.folders || []).flatMap((folder) => (folder.catalogSources || []).map((source) => String(source.catalogId || '').replace(/^lib-/, ''))).filter(Boolean))];
        // Migrate the old behavior only when the complete pack source set is
        // present, which identifies sources previously added automatically.
        if (!sourceIds.length || !sourceIds.every((sourceId) => libraryCatalogs.includes(sourceId))) continue;
        const sourceSet = new Set(sourceIds);
        const next = libraryCatalogs.filter((sourceId) => !sourceSet.has(sourceId));
        if (next.length !== libraryCatalogs.length) { libraryCatalogs = next; changed = true; }
        libHomeHidden = libHomeHidden.filter((sourceId) => !sourceSet.has(sourceId));
      }
      if (changed) checkChanged();
    }

    function groupIcon(g) { return ({Streaming:'📺', Genres:'🎭', Anime:'🍥', Themes:'🎨', Studios:'🏰', Decades:'📅', Runtime:'🕒', World:'🌍'})[g] || '📁'; }
    function catalogsByGroup() { const m = new Map(); for (const c of (libCatalogDefs || [])) { if (!m.has(c.group)) m.set(c.group, []); m.get(c.group).push(c); } return m; }
    function catalogDisplayName(c) {
      const custom = libraryNames[c.id];
      if (custom) return custom;
      const type = c.type === 'series' ? 'Series' : c.type === 'movie' ? 'Movies' : c.type || '';
      const id = String(c.id || '').toLowerCase();
      const variant = id.includes('top10') ? 'Top 10' : id.includes('top50') ? 'Top 50' : id.includes('latest') ? 'Latest' : '';
      return [c.name, type, variant].filter(Boolean).join(' · ');
    }
    function onLibCatalogSearch() {
      const q = (document.getElementById('libCatalogFilter')?.value || '').trim().toLowerCase();
      if (q) { catGroupExpanded = new Set(); for (const [g, items] of catalogsByGroup()) if (items.some(c => catalogDisplayName(c).toLowerCase().includes(q) || c.id.toLowerCase().includes(q))) catGroupExpanded.add(g); }
      renderLibraryGroups();
    }
    function renderLibraryGroups() {
      const el = document.getElementById('catGroupList'), total = document.getElementById('catGroupTotal'); if (!el || !libCatalogDefs) return;
      const q = (document.getElementById('libCatalogFilter')?.value || '').trim().toLowerCase(); let enabledTotal = 0;
      const groupPriority = (g) => {
        const l = String(g).toLowerCase();
        if (l.includes('trending') || l.includes('popular') || l.includes('latest') || l.includes('new')) return 0;
        if (l.includes('streaming')) return 1;
        if (l.includes('genre')) return 2;
        if (l.includes('collection')) return 3;
        if (l.includes('studio') || l.includes('network') || l.includes('company')) return 4;
        if (l.includes('anime')) return 5;
        return 6;
      };
      const html = [...catalogsByGroup()].sort(([a],[b]) => groupPriority(a) - groupPriority(b) || a.localeCompare(b)).map(([g, all]) => { const items = q ? all.filter(c => catalogDisplayName(c).toLowerCase().includes(q) || c.id.toLowerCase().includes(q)) : all; if (q && !items.length) return ''; const n = items.filter(c => libraryCatalogs.includes(c.id)).length; enabledTotal += n; const open = catGroupExpanded.has(g); return `<div class="catgroup-section"><div class="catgroup-header" onclick="toggleCatGroupOpen(${jsStr(g)})"><input type="checkbox" class="catgroup-check" ${items.length && n === items.length ? 'checked' : ''} onclick="event.stopPropagation()" onchange="toggleCatGroupAll(${jsStr(g)}, this.checked)" /><span class="catgroup-icon">${groupIcon(g)}</span><span class="catgroup-name">${escHtml(g)}</span><span class="catgroup-count">${n}/${items.length} catalogs</span><span class="catgroup-arrow${open ? ' open' : ''}">▸</span></div><div class="catgroup-body${open ? ' open' : ''}">${items.map(c => { const on = libraryCatalogs.includes(c.id), hidden = on && libHomeHidden.includes(c.id); return `<label class="catgroup-item"><input type="checkbox" ${on ? 'checked' : ''} onchange="toggleLibCatalog('${c.id}', this.checked)" /><span>${c.icon || '🎬'}</span><span class="ci-name">${escHtml(catalogDisplayName(c))}</span><button type="button" class="ci-home" onclick="event.preventDefault();toggleLibHomeHidden('${c.id}')" style="opacity:${on ? 1 : .35};color:${hidden ? 'var(--amber)' : 'var(--muted)'}">${hidden ? '🏠' : '👁'}</button></label>`; }).join('')}</div></div>`; }).join('');
      el.innerHTML = html || '<div style="padding:14px;color:var(--muted);font-size:0.82rem">No matching catalogs</div>'; if (total) total.textContent = enabledTotal + ' added';
    }
    function toggleCatGroupOpen(g) { if (catGroupExpanded.has(g)) catGroupExpanded.delete(g); else catGroupExpanded.add(g); renderLibraryGroups(); }
    function toggleCatGroupAll(g, checked) { const ids = (catalogsByGroup().get(g) || []).map(c => c.id); if (checked) ids.forEach(id => { if (!libraryCatalogs.includes(id)) libraryCatalogs.push(id); }); else { libraryCatalogs = libraryCatalogs.filter(id => !ids.includes(id)); libHomeHidden = libHomeHidden.filter(id => !ids.includes(id)); } renderLibraryGroups(); checkChanged(); }
    async function addLeLibrarySpecialHomeRows() {
      const specialSources = ['trending_movies','trending_series','tmdb_popular_movies','tmdb_popular_series','upcoming_movies','trending_imdb_top100_movies','streaming_netflix_movies','streaming_disney_movies','streaming_prime_movies','streaming_hbo_movies','streaming_crave_movies','streaming_hayu_movies','streaming_magellan_movies','streaming_starz_movies','genre_action_movies','genre_comedy_movies','genre_horror_movies','genre_scifi_movies','genre_documentary_movies','genre_mystery_movies','collection_marvel_universe_mdb','collection_star_wars','collection_harry_potter','collection_lord_of_the_rings'];
      // Ensure catalog defs are loaded
      if (!libCatalogDefs || !libCatalogDefs.length) {
        try {
          const r = await fetch('/api/catalog-library', { cache: 'no-store' });
          const j = await r.json();
          if (Array.isArray(j.catalogs)) {
            libCatalogDefs = j.catalogs;
          }
        } catch {}
      }
      let added = 0, unhidden = 0, skipped = 0;
      const missing = [];
      for (const id of specialSources) {
        const def = typeof getSourceDefinition === 'function' ? getSourceDefinition(id) : (libCatalogDefs || []).find(c => c.id === id);
        if (!def || def.available === false) { missing.push(id); skipped++; continue; }
        if (!libraryCatalogs.includes(id)) { libraryCatalogs.push(id); added++; }
        else if (libHomeHidden.includes(id)) { libHomeHidden = libHomeHidden.filter(x => x !== id); unhidden++; }
      }
      if (added === 0 && unhidden === 0) {
        if (missing.length) showToast(`All Special rows already in My Rows (skipped ${missing.length} unavailable)`, 'info');
        else showToast('All LeLibrary Special rows are already in My Rows', 'info');
      } else {
        const total = added + unhidden;
        let msg = `Added ${added} new${unhidden ? `, unhid ${unhidden}` : ''}: find them in My Rows`;
        if (missing.length) msg += ` (${missing.length} unavailable)`;
        showToast(msg, 'success');
      }
      renderLibraryGroups(); renderCataloguesOptions(); checkChanged();
      const acc = document.getElementById('libraryAccordion'); if (acc && !acc.open) acc.open = true;
      const homeAcc = document.getElementById('yourRowsAccordion'); if (homeAcc && !homeAcc.open) homeAcc.open = true;
      setTimeout(() => document.getElementById('catalogueList')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
      // Debug: log to console for verification
      console.log('[LeLibrary Special] added', added, 'unhidden', unhidden, 'missing', missing, 'now total', libraryCatalogs.length);
    }
    function toggleLibCatalog(id, on) {
      if (on) { if (!libraryCatalogs.includes(id)) libraryCatalogs.push(id); }
      else {
        libraryCatalogs = libraryCatalogs.filter((x) => x !== id);
        libHomeHidden = libHomeHidden.filter((x) => x !== id);
      }
      renderLibraryGroups();
      renderCataloguesOptions();
      checkChanged();
    }

    function toggleLibHomeHidden(id) {
      if (libHomeHidden.includes(id)) libHomeHidden = libHomeHidden.filter((x) => x !== id);
      else libHomeHidden.push(id);
      renderLibraryGroups();
      renderCataloguesOptions();
      checkChanged();
    }

    function toggleWatchlistHomeHidden(id) {
      if (watchlistHomeHidden.includes(id)) watchlistHomeHidden = watchlistHomeHidden.filter((x) => x !== id);
      else watchlistHomeHidden.push(id);
      renderCataloguesOptions();
      checkChanged();
    }

    function editWatchlistRowName(id, defaultName) {
      document.getElementById('renameModal')?.remove();
      const current = watchlistNames[id] || defaultName;
      const overlay = document.createElement('div');
      overlay.id = 'renameModal';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1200;display:flex;align-items:center;justify-content:center';
      overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };
      overlay.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;max-width:400px;width:92%;text-align:center"><h3 style="margin:0 0 6px;color:var(--white);font-size:1rem">Rename watchlist row</h3><p style="color:var(--muted);font-size:.78rem;margin:0 0 14px">This name appears in My Rows and on your Home screen.</p><input id="renameInput" type="text" value="${escHtml(current)}" maxlength="60" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.95rem;font-family:var(--font);box-sizing:border-box" onkeydown="if(event.key==='Enter'){saveWatchlistRowName(${jsStr(id)});} if(event.key==='Escape'){this.closest('#renameModal').remove();}" /><div style="display:flex;gap:8px;margin-top:16px"><button type="button" style="flex:1;padding:9px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer" onclick="this.closest('#renameModal').remove()">Cancel</button><button type="button" style="flex:1;padding:9px;border-radius:8px;border:1px solid var(--amber);background:var(--amber-glow);color:var(--amber);cursor:pointer;font-weight:600" onclick="saveWatchlistRowName(${jsStr(id)})">Save</button></div></div>`;
      document.body.appendChild(overlay);
      const input = document.getElementById('renameInput');
      if (input) { input.focus(); input.select(); }
    }

    function saveWatchlistRowName(id) {
      const input = document.getElementById('renameInput');
      const name = input?.value.trim();
      if (!name) { input?.focus(); return; }
      watchlistNames[id] = name;
      document.getElementById('renameModal')?.remove();
      renderCataloguesOptions();
      checkChanged();
      showToast('Watchlist row renamed: remember to save', 'success');
    }

    function applyLibraryCatalogs(cfg) {
      if (Array.isArray(cfg.libraryCatalogs)) libraryCatalogs = cfg.libraryCatalogs.slice();
      if (Array.isArray(cfg.libHomeHidden)) libHomeHidden = cfg.libHomeHidden.slice();
      if (Array.isArray(cfg.watchlistHomeHidden)) watchlistHomeHidden = cfg.watchlistHomeHidden.slice();
      if (Array.isArray(cfg.nuvioCollectionPacks)) nuvioCollectionPacks = cfg.nuvioCollectionPacks.slice();
      if (cfg.nuvioCollectionOverrides && typeof cfg.nuvioCollectionOverrides === 'object') nuvioCollectionOverrides = cfg.nuvioCollectionOverrides;
      if (Array.isArray(cfg.importedRows)) importedRows = cfg.importedRows.map(normaliseImportedSource).filter(Boolean);
      syncImportedCollectionOrder();
      syncCuratedCollectionOrder();
      if (libCatalogDefs) renderLibraryGroups();
      if (curatedCollectionDefs.length) renderCuratedCollectionPacks();
      renderImportedRows();
    }

    // ── Imported rows / external Nuvio folders ────────────────────────
    // Imported data is intentionally a small, normalized selection rather
    // than a copy of a huge manifest. This keeps install URLs usable while
    // retaining the source addon's identity for Nuvio sync.
    function importedId(value) {
      let hash = 0; for (const ch of String(value || 'imported')) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
      return `imported-${Math.abs(hash).toString(36)}`;
    }
    function importedSourceFromManifest(manifest, sourceUrl) {
      if (!manifest || !Array.isArray(manifest.catalogs) || !manifest.id) throw new Error('That JSON is not an addon manifest.');
      const sourceId = importedId(`${manifest.id}|${sourceUrl}`);
      const rows = manifest.catalogs.filter(c => c && c.id && c.type).map((catalog, index) => ({
        id: `${sourceId}-${index}`,
        title: catalog.name || catalog.id,
        description: catalog.extra?.find?.(e => e.name === 'genre')?.options?.join(', ') || '',
        kind: 'home',
        enabled: true,
        order: index,
        source: { addonId: manifest.id, catalogId: catalog.id, type: catalog.type, extra: catalog.extra || [] },
        coverImageUrl: '', focusGifUrl: '',
      }));
      return { id: sourceId, kind: 'manifest', title: manifest.name || manifest.id, addonId: manifest.id, sourceUrl, rows, collections: [] };
    }
    function importedTypeForCatalog(id, manifest) {
      const found = manifest?.catalogs?.find(c => c.id === id);
      if (found?.type) return found.type;
      const value = String(id || '').toLowerCase();
      return /series|show|tv|anime/.test(value) ? 'series' : 'movie';
    }
    // Classify only source IDs we can reproduce faithfully. The importer never
    // guesses here: title-based suggestions are handled later in an explicit
    // review modal.
    function importedNativeReference(source) {
      const id = String(source?.catalogId || '').replace(/^lib-/, '');
      const type = source?.type === 'series' ? 'series' : 'movie';
      const known = (libCatalogDefs || []).find(item => item.id === id && item.type === type && item.available !== false);
      if (known) return `lib:${id}`;
      let match = id.match(/^tmdb_collection_(\d+)_movies$/);
      if (match && type === 'movie') return `tmdb-collection:${match[1]}`;
      match = id.match(/^tmdb_list_(\d+)_(movies|series)$/);
      if (match) return `tmdb-list:${match[1]}`;
      match = id.match(/^tmdb_network_(\d+)_series$/);
      if (match) return `tmdb-network:${match[1]}`;
      match = id.match(/^tmdb_company_(\d+)_(movies|series)$/);
      if (match) return `tmdb-company:${match[1]}`;
      match = id.match(/^tmdb_person_(\d+)_movies$/);
      if (match) return `tmdb-person:${match[1]}`;
      match = id.match(/^tmdb_discover_([A-Za-z0-9_-]+)_(movies|series)$/);
      if (match) return `tmdb-discover:${match[1]}`;
      match = id.match(/^trakt_list_(\d+)_(movies|series)$/);
      if (match) return `trakt-list:${match[1]}`;
      return '';
    }
    function nativeImportedSource(source) {
      const ref = importedNativeReference(source);
      if (!ref) return null;
      return {
        ...source,
        externalSource: { addonId: source.addonId, catalogId: source.catalogId, type: source.type || 'movie', genre: source.genre || '' },
        addonId: '__lelibrary__',
        catalogId: `lelibrary-import-${source.type === 'series' ? 'series' : 'movie'}`,
        genre: ref,
        compatibility: ref.startsWith('lib:') ? 'exact' : 'native',
      };
    }
    const BEST_EFFORT_FOLDER_SOURCES = {
      action: ['genre_action_movies', 'genre_action_series'], comedy: ['genre_comedy_movies', 'genre_comedy_series'], crime: ['genre_crime_movies', 'genre_crime_series'], drama: ['genre_drama_movies', 'genre_drama_series'], horror: ['genre_horror_movies', 'genre_horror_series'], romance: ['genre_romance_movies', 'genre_romance_series'], thriller: ['genre_thriller_movies', 'genre_thriller_series'], netflix: ['streaming_netflix_movies', 'streaming_netflix_series'], disney: ['streaming_disney_movies', 'streaming_disney_series'], hbo: ['streaming_hbo_movies', 'streaming_hbo_series'], 'prime video': ['streaming_prime_movies', 'streaming_prime_series'], hulu: ['streaming_hulu_movies', 'streaming_hulu_series'], paramount: ['streaming_paramount_movies', 'streaming_paramount_series'], peacock: ['streaming_peacock_movies', 'streaming_peacock_series'], shudder: ['streaming_shudder_movies', 'streaming_shudder_series'], crunchyroll: ['streaming_crunchyroll_movies', 'streaming_crunchyroll_series'], marvel: ['studio_marvel_movies', 'studio_marvel_series'], pixar: ['studio_pixar_movies', 'studio_pixar_series'], a24: ['studio_a24_movies', 'studio_a24_series']
    };
    function importedBestEffortSuggestion(folder) {
      const title = String(folder?.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const candidates = BEST_EFFORT_FOLDER_SOURCES[title] || [];
      const available = new Set((libCatalogDefs || []).filter(item => item.available !== false).map(item => item.id));
      const types = new Set((folder.catalogSources || []).map(item => item.type || 'movie'));
      return candidates.filter(id => available.has(id) && types.has(id.endsWith('_series') ? 'series' : 'movie'));
    }
    function applyImportedCompatibility(source) {
      for (const collection of source.collections || []) {
        for (const folder of collection.folders || []) {
          const original = folder.catalogSources || [];
          folder.catalogSources = original.map(item => nativeImportedSource(item) || item);
        }
      }
      // An export has no addon ID of its own when it uses Nuvio's built-in
      // TMDB/Trakt providers. Determine the warning state only after sources
      // have been normalized, never from that wrapper-level omission.
      source.unresolved = importedMissingFolderSourceCount(source) > 0;
      return source;
    }

    function importedMissingFolderSourceCount(source) {
      return (source?.collections || []).reduce((count, collection) => count + (collection.folders || []).filter(folder => {
        if (folder.enabled === false) return false;
        return !(folder.catalogSources || []).some(item => item && item.catalogId && item.addonId);
      }).length, 0);
    }
    // Nuvio's own profile export keeps source definitions in `folder.sources`
    // and leaves `catalogSources` as an empty presentation field. Convert its
    // public TMDB/Trakt list references into the same canonical shape used by
    // the Xperience-style exports before compatibility matching runs.
    function normaliseNuvioExportSource(source) {
      if (!source || typeof source !== 'object') return null;
      if (source.catalogId) return { ...source, addonId: source.addonId || source.addon_id || '' };
      const type = String(source.mediaType || source.type || '').toUpperCase() === 'TV' ? 'series' : 'movie';
      if (source.provider === 'trakt' && Number.isFinite(Number(source.traktListId))) {
        return { addonId: '', catalogId: `trakt_list_${Number(source.traktListId)}_${type === 'series' ? 'series' : 'movies'}`, type, genre: '', sourceTitle: source.title || '' };
      }
      if (source.provider === 'tmdb') {
        const kind = String(source.tmdbSourceType || 'LIST').toUpperCase();
        if (Number.isFinite(Number(source.tmdbId))) {
          if (kind === 'LIST') return { addonId: '', catalogId: `tmdb_list_${Number(source.tmdbId)}_${type === 'series' ? 'series' : 'movies'}`, type, genre: '', sourceTitle: source.title || '' };
          if (kind === 'COLLECTION' && type === 'movie') return { addonId: '', catalogId: `tmdb_collection_${Number(source.tmdbId)}_movies`, type, genre: '', sourceTitle: source.title || '' };
          // TMDB networks are TV-only; streaming-platform folders (Crave, Hayu,
          // Magellan…) use them. Companies cover movie/series production brands.
          if (kind === 'NETWORK') return { addonId: '', catalogId: `tmdb_network_${Number(source.tmdbId)}_series`, type: 'series', genre: '', sourceTitle: source.title || '' };
          if (kind === 'COMPANY') return { addonId: '', catalogId: `tmdb_company_${Number(source.tmdbId)}_${type === 'series' ? 'series' : 'movies'}`, type, genre: '', sourceTitle: source.title || '' };
          if (kind === 'PERSON') return { addonId: '', catalogId: `tmdb_person_${Number(source.tmdbId)}_movies`, type: 'movie', genre: '', sourceTitle: source.title || '' };
        }
        // DISCOVER covers generic TMDB discover queries: streaming platforms
        // (Crave, Hayu, Magellan etc.) are typically DISCOVER with watch providers
        // or networks. Encode the filters so they can be served without addons.
        if (kind === 'DISCOVER' || kind === 'PERSON' || kind === 'DIRECTOR') {
          try {
            const payload = { sortBy: source.sortBy || '', filters: source.filters || {}, mediaType: type === 'series' ? 'TV' : 'MOVIE', kind };
            if (kind === 'PERSON' || kind === 'DIRECTOR') payload.tmdbId = Number(source.tmdbId) || undefined;
            const json = JSON.stringify(payload);
            const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            if (!b64 || b64.length > 1200) return null;
            return { addonId: '', catalogId: `tmdb_discover_${b64}_${type === 'series' ? 'series' : 'movies'}`, type, genre: '', sourceTitle: source.title || '' };
          } catch { return null; }
        }
      }
      return null;
    }

    // A published version of the Streaming Perfect Setup export contains a
    // truncated Netflix cover URL (`…/gh/luckynumb`). The neighbouring focus,
    // title and backdrop URLs still identify the exact repository asset, so
    // repair only that known malformed value rather than guessing at artwork.
    function repairImportedCollectionArtwork(folder) {
      const broken = String(folder?.coverImageUrl || '').trim().replace(/\/+$/, '');
      if (broken !== 'https://cdn.jsdelivr.net/gh/luckynumb') return folder;
      const sibling = [folder.focusGifUrl, folder.titleLogoUrl, folder.heroBackdropUrl]
        .map(value => String(value || '').trim())
        .find(value => /^https:\/\/cdn\.jsdelivr\.net\/gh\/luckynumb3rs\/stremio-perfect-setup\/collections\//i.test(value));
      const match = sibling?.match(/^https:\/\/cdn\.jsdelivr\.net\/gh\/luckynumb3rs\/stremio-perfect-setup\/collections\/([^/]+)\/(?:focused|title|backdrop)\/([^/?#.]+)\.[^/?#]+/i);
      if (!match) return folder;
      return {
        ...folder,
        coverImageUrl: `https://cdn.jsdelivr.net/gh/luckynumb3rs/stremio-perfect-setup/collections/${match[1]}/cover/${match[2]}.png`,
      };
    }

    function normaliseImportedFolders(collections, sourceAddonId = '', manifest = null, sourceId = 'imported') {
      return (collections || []).map((collection, index) => ({
        ...collection,
        id: `collection-${sourceId}-${index}`,
        folders: (collection.folders || []).map((rawFolder, folderIndex) => {
          const folder = repairImportedCollectionArtwork(rawFolder);
          const existing = Array.isArray(folder.catalogSources) ? folder.catalogSources.filter(source => source && source.catalogId) : [];
          const nuvioSources = Array.isArray(folder.sources) ? folder.sources.map(normaliseNuvioExportSource).filter(Boolean) : [];
          const rows = Array.isArray(folder.rows) ? folder.rows : [];
          const catalogSources = existing.length ? existing.map(source => ({ ...source, addonId: source.addonId || source.addon_id || sourceAddonId || '' })) : nuvioSources.length ? nuvioSources : rows.map(catalogId => ({
            addonId: folder.addonId || sourceAddonId || '',
            catalogId: typeof catalogId === 'string' ? catalogId : catalogId.catalogId || catalogId.id,
            type: typeof catalogId === 'object' ? catalogId.type || 'movie' : importedTypeForCatalog(catalogId, manifest),
            genre: typeof catalogId === 'object' ? catalogId.genre || '' : '',
          })).filter(source => source.catalogId);
          const hadSources = (Array.isArray(folder.sources) && folder.sources.length) || (Array.isArray(folder.catalogSources) && folder.catalogSources.length) || (Array.isArray(folder.rows) && folder.rows.length);
          const hasValidSource = catalogSources.length > 0;
          // If the original folder had sources but none mapped, disable it and
          // keep a flag so the UI can explain why it is unticked.
          const enabled = folder.enabled !== false && (hadSources ? hasValidSource : true);
          return { ...folder, id: folder.id || `folder-${sourceId}-${index}-${folderIndex}`, enabled, catalogSources, _unresolved: hadSources && !hasValidSource };
        }),
      }));
    }
    function importedSourceFromProject(data, sourceUrl, manifest = null) {
      const sourceId = importedId(`${sourceUrl}|project|${JSON.stringify(data).slice(0, 2000)}`);
      const addonId = data.addonId || data.addon_id || data.manifest?.id || manifest?.id || '';
      const selected = Array.isArray(data.selectedCatalogs) ? data.selectedCatalogs : [];
      const rows = selected.map((catalog, index) => {
        const id = typeof catalog === 'string' ? catalog : catalog.id || catalog.catalogId;
        return { id: `${sourceId}-${index}`, kind: 'home', title: typeof catalog === 'object' ? catalog.name || id : id, enabled: true, order: index, source: { addonId, catalogId: id, type: typeof catalog === 'object' ? catalog.type || importedTypeForCatalog(id, manifest) : importedTypeForCatalog(id, manifest), extra: [] }, coverImageUrl: '', focusGifUrl: '' };
      }).filter(row => row.source.catalogId);
      return applyImportedCompatibility({ id: sourceId, kind: 'project', title: data.name || data.title || 'Imported project', addonId, sourceUrl, rows, collections: normaliseImportedFolders(data.collections || [], addonId, manifest, sourceId), unresolved: false });
    }
    function importedSourceFromJson(data, sourceUrl) {
      const doc = Array.isArray(data) ? { collections: data } : (data?.document || data);
      if (!doc || typeof doc !== 'object') throw new Error('The imported value is not JSON.');
      if (Array.isArray(doc.catalogs) && doc.id) return importedSourceFromManifest(doc, sourceUrl);
      if (Array.isArray(doc.selectedCatalogs) || Array.isArray(doc.customCatalogs) || doc.project || doc.setup) return importedSourceFromProject(doc.project || doc, sourceUrl);
      const collections = Array.isArray(doc.collections) ? doc.collections : [];
      const home = Array.isArray(doc.home_rows) ? doc.home_rows : (Array.isArray(doc.homeRows) ? doc.homeRows : []);
      if (!collections.length && !home.length) throw new Error('No addon catalogs, home rows, or Nuvio collections were found.');
      const sourceId = importedId(`${sourceUrl}|${JSON.stringify(collections).slice(0, 2000)}`);
      const rows = home.map((row, index) => {
        const source = row.source || row.catalogSource || row;
        return { id: `${sourceId}-${index}`, kind: 'home', title: row.title || row.name || source.catalogId || source.id || `Imported row ${index + 1}`, enabled: row.enabled !== false, order: index, source: { addonId: source.addonId || source.addon_id, catalogId: source.catalogId || source.catalog_id || source.id, type: source.type || 'movie', genre: source.genre || '', extra: source.extra || [] }, coverImageUrl: '', focusGifUrl: '' };
      }).filter(row => row.source.addonId && row.source.catalogId);
      const addonId = rows[0]?.source.addonId || doc.addonId || doc.addon_id || '';
      return applyImportedCompatibility({ id: sourceId, kind: 'collections', title: doc.name || doc.title || 'Imported Nuvio setup', addonId, sourceUrl, rows, collections: normaliseImportedFolders(collections, addonId, null, sourceId), unresolved: false });
    }
    function normaliseImportedSource(source) {
      if (!source || typeof source !== 'object' || !Array.isArray(source.rows)) return null;
      const sourceId = String(source.id || importedId(source.sourceUrl || source.title));
      const isGeneratedManifestFolderPack = source.kind === 'manifest' || (source.sourceUrl && source.sourceUrl !== 'pasted-json' && Array.isArray(source.collections)
        && source.collections.length > 0 && source.collections.every(collection => String(collection.id || '').startsWith(`collection-${source.id}`)));
      const normalised = {
        ...source,
        kind: source.kind || 'home',
        unresolved: false,
        id: sourceId,
        title: String(source.title || source.addonId || 'Imported rows'),
        rows: source.rows.map((row, index) => ({ ...row, kind: 'home', id: String(row.id || `${source.id || 'imported'}-${index}`), title: String(row.title || row.source?.catalogId || `Imported row ${index + 1}`), order: Number.isFinite(Number(row.order)) ? Number(row.order) : index, enabled: row.enabled !== false, coverImageUrl: '', focusGifUrl: '', source: { ...(row.source || {}), addonId: row.source?.addonId || row.source?.addon_id, catalogId: row.source?.catalogId || row.source?.catalog_id || row.source?.id, type: row.source?.type || 'movie' } })),
        collections: isGeneratedManifestFolderPack ? [] : normaliseImportedFolders(source.collections || [], source.addonId || '', null, sourceId),
      };
      return applyImportedCompatibility(normalised);
    }
    function importedMatchLabel(row) {
      const title = String(row.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const type = row.source?.type;
      const candidates = Object.entries(CATALOGUE_META || {}).map(([key, meta]) => ({ key, title: String(catNames[key] || meta.label || key).replace(/^[^a-z]+/i, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), type: /Movies|movies/.test(key) || key === 'movies' ? 'movie' : /Series|series/.test(key) || key === 'series' ? 'series' : null }));
      const match = candidates.find(item => item.type === type && (item.title === title || title === item.key.toLowerCase() || (item.key === 'movies' && ['movies', 'my movies'].includes(title)) || (item.key === 'series' && ['series', 'my series', 'shows'].includes(title))));
      return match ? `Matches LeLibrary ${catNames[match.key] || match.key}` : '';
    }
    function importedExternalDependencies(source) {
      const ids = new Set();
      for (const row of source?.rows || []) if (row.source?.addonId) ids.add(String(row.source.addonId));
      for (const collection of source?.collections || []) for (const folder of collection.folders || []) for (const catalog of folder.catalogSources || []) if (catalog.addonId) ids.add(String(catalog.addonId));
      return [...ids].filter(id => id !== '__lelibrary__' && !/(^|[.:_-])(?:community\.)?lelibrary(?:[.:_-]|$)/i.test(id));
    }
    function importedDependencyName(id) {
      const value = String(id);
      if (/aio.?metadata/i.test(value)) return 'AIOMetadata';
      if (/aio.?streams/i.test(value)) return 'AIOStreams';
      if (/xperience/i.test(value)) return 'Xperience';
      return value;
    }
    function importedDependencyNotice(source, compact = false) {
      const dependencies = importedExternalDependencies(source);
      if (!dependencies.length && !source?.unresolved) return '';
      const names = dependencies.map(importedDependencyName).join(', ');
      return `<div class="imported-dependency-warning"><strong>External addon required</strong><span>${source?.unresolved ? 'Some folders have no addon source.' : `${escHtml(names)} ${dependencies.length === 1 ? 'is' : 'are'} referenced by this setup.`} Install and enable ${dependencies.length === 1 ? 'it' : 'them'} in the same Nuvio profile, or the folders may be empty.</span>${compact ? '' : '<small>LeLibrary keeps these source links intact; it does not proxy the other addon.</small>'}</div>`;
    }
    function importedUnresolvedNotice(source) {
      const unresolved = (source?.collections || []).flatMap(c => c.folders || []).filter(f => f._unresolved);
      if (!unresolved.length) return '';
      const count = unresolved.length;
      const names = unresolved.slice(0, 4).map(f => escHtml(f.title || 'Untitled')).join(', ');
      const more = unresolved.length > 4 ? ` and ${unresolved.length - 4} more` : '';
      return `<div class="imported-dependency-warning" style="border-left-color:#e67e22"><strong>${count} folder${count === 1 ? '' : 's'} auto-disabled: source not available</strong><span>${names}${more} ${count === 1 ? 'uses' : 'use'} a source type LeLibrary cannot serve yet. ${count === 1 ? 'It has' : 'They have'} been unticked; the rest will still be pushed. If this is a standard TMDB streaming-platform folder (e.g. Crave, Hayu), please report it: it should now map via DISCOVER.</span></div>`;
    }
    function importedBestEffortCandidates(source) {
      return (source.collections || []).flatMap(collection => (collection.folders || []).map(folder => ({ collection, folder, ids: importedBestEffortSuggestion(folder) })).filter(item => {
        // A Nuvio built-in TMDB/Trakt source is already an exact internal
        // match. Do not offer a vague title-based replacement on top of it.
        const sources = item.folder.catalogSources || [];
        const alreadyNative = sources.length > 0 && sources.every(catalog => catalog?.addonId === '__lelibrary__');
        return !alreadyNative && item.ids.length;
      }));
    }
    function renderImportedRows() {
      const el = document.getElementById('importedRowsList'); const total = document.getElementById('importedRowsTotal'); if (!el) return;
      const count = importedRows.reduce((n, source) => n + (source.rows || []).filter(row => row.enabled !== false).length, 0);
      const folders = importedRows.reduce((n, source) => n + (source.collections || []).reduce((m, collection) => m + (collection.folders || []).filter(folder => folder.enabled !== false).length, 0), 0);
      if (total) total.textContent = importedRows.length ? `${count} rows${folders ? ` · ${folders} folders` : ''}` : '';
      el.innerHTML = importedRows.length ? importedRows.map(source => { const sourceRows = source.rows.filter(r => r.enabled !== false); const sourceFolders = (source.collections || []).reduce((n, c) => n + (c.folders || []).filter(f => f.enabled !== false).length, 0); const candidates = importedBestEffortCandidates(source); const unresolvedFolders = (source.collections || []).flatMap(c => c.folders || []).filter(f => f._unresolved).length; return `<div class="imported-source-card"><div class="imported-source-head"><div><strong>${escHtml(source.title)}</strong><small>${sourceRows.length}/${source.rows.length} rows${source.collections?.length ? ` · ${source.collections.length} collection${source.collections.length === 1 ? '' : 's'} · ${sourceFolders} folder${sourceFolders === 1 ? '' : 's'}${unresolvedFolders ? ` · <span style="color:#e67e22">${unresolvedFolders} disabled</span>` : ''}` : ''}</small></div><div class="imported-source-actions"><button type="button" class="curated-pack-view" onclick="toggleImportedSource('${source.id}')">View / expand</button>${candidates.length ? `<button type="button" class="curated-pack-edit" onclick="reviewImportedCompatibility('${source.id}')">Review ${candidates.length} matches</button>` : ''}<button type="button" class="curated-pack-edit" onclick="editImportedSource('${source.id}')">Edit</button><button type="button" class="curated-pack-edit danger" onclick="removeImportedSource('${source.id}')">Remove</button></div></div>${importedDependencyNotice(source)}${importedUnresolvedNotice(source)}</div>`; }).join('') : '<div class="imported-empty">No imported rows yet. Import an addon manifest or a Nuvio JSON export to add one.</div>';
    }
    function toggleImportedSource(id) { editImportedSource(id, true); }
    function toggleImportedRow(sourceId, rowId, enabled) { const source = importedRows.find(s => s.id === sourceId); const row = source?.rows.find(r => r.id === rowId); if (!row) return; row.enabled = enabled; const folder = source.collections?.flatMap(c => c.folders || []).find(f => f.id === `folder-${row.id}`); if (folder) folder.enabled = enabled; renderImportedRows(); renderCataloguesOptions(); checkChanged(); }
    function toggleImportedCollection(sourceId, collectionId, enabled) { const source = importedRows.find(s => s.id === sourceId); const collection = source?.collections?.find(c => c.id === collectionId); if (!collection) return; collection.enabled = enabled; syncImportedCollectionOrder(); renderImportedRows(); renderCataloguesOptions(); checkChanged(); }
    function removeImportedSource(id) { importedRows = importedRows.filter(source => source.id !== id); renderImportedRows(); renderCataloguesOptions(); checkChanged(); }

    // ── Nuvio Public Collections ──────────────────────────────────────
    // Nuvio's public catalogue is authenticated and does not enable browser
    // CORS. Legacy setups send their in-memory Nuvio session through the
    // narrow read-only proxy. Account-backed tokens use the saved connection
    // server-side instead, so no Nuvio credential reaches browser storage.
    let nuvioCommunityBrowse = { items: [], page: 1, hasNextPage: false, loading: false, error: '', search: '', sort: 'popular', filter: '' };

    function nuvioPublicVisibleItems() {
      const wanted = String(nuvioCommunityBrowse.filter || '');
      if (!wanted) return nuvioCommunityBrowse.items;
      return nuvioCommunityBrowse.items.filter(item => {
        const needsAddon = nuvioCommunityRequirements(item).length > 0;
        return wanted === 'needs' ? needsAddon : !needsAddon;
      });
    }

    function setNuvioPublicCollectionFilter(value) {
      nuvioCommunityBrowse.filter = String(value || '');
      renderNuvioPublicCollections();
    }

    function safeExternalUrl(value) {
      try {
        const url = new URL(String(value || ''));
        return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
      } catch { return ''; }
    }

    function nuvioCommunityRequirements(item) {
      const requirements = item?.envelope?.requirements || item?.requirements || item?.item?.envelope?.requirements || {};
      return Array.isArray(requirements.addons) ? requirements.addons.filter(Boolean) : [];
    }

    function nuvioCommunityItems(data) {
      const candidates = [];
      const visit = (value, depth = 0) => {
        if (depth > 3 || value == null) return;
        if (Array.isArray(value)) { candidates.push(value); return; }
        if (typeof value !== 'object') return;
        for (const key of ['items', 'collections', 'results', 'communityCollections', 'data', 'payload']) visit(value[key], depth + 1);
      };
      visit(data);
      for (const values of candidates) {
        const items = values.filter(item => /^[a-z0-9][a-z0-9-]{0,127}$/i.test(String(item?.public_id || item?.publicId || item?.id || '')));
        if (items.length || values.length === 0) return items;
      }
      return [];
    }

    async function fetchNuvioCommunity(path, params = {}) {
      const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '').map(([key, value]) => [key, String(value)]));
      const suffix = `${path}${query.size ? `?${query}` : ''}`;
      let response;
      if (ACCOUNT_TOKEN) {
        // The account status lookup may refresh Nuvio's server-side session.
        // Do not race that startup work with the first browse request.
        await accountConnectionReady;
        const tokenId = currentToken();
        if (!tokenId) throw new Error('Could not identify this saved LeLibrary token.');
        response = await fetch(`/api/account/tokens/${encodeURIComponent(tokenId)}/nuvio-community/${suffix}`, {
          credentials: 'same-origin',
          cache: 'no-store',
        });
      } else {
        if (!connectState.nuvioToken) {
          try{
            const saved = JSON.parse(localStorage.getItem(CONNECT_STORAGE_KEY)||'null');
            if (saved && saved.nuvioToken) Object.assign(connectState, saved);
          }catch{}
        }
        if (!connectState.nuvioToken) throw new Error('Connect Nuvio in Step 1 before browsing its public collections.');
        response = await fetch(`/api/nuvio-community/${suffix}`, {
          headers: { 'X-Nuvio-Access-Token': connectState.nuvioToken },
          cache: 'no-store',
        });
      }
      const data = await response.json().catch(() => ({}));
      if (ACCOUNT_TOKEN && response.status === 401 && data.error === 'Not signed in') {
        throw new Error('Sign in to the LeLibrary account that owns this token to use its saved Nuvio connection.');
      }
      if (!response.ok) throw new Error(data.error || 'Could not load Nuvio public collections.');
      return data;
    }

    function nuvioCommunityAddonPills(requirements) {
      if (!requirements.length) return '<span class="nuvio-public-state ready">No additional addon</span>';
      return `<span class="nuvio-public-state needs">Needs additional addon${requirements.length === 1 ? '' : 's'}</span><div class="nuvio-public-addon-pills">${requirements.map(requirement => {
        const name = requirement.addonName || requirement.addon_name || requirement.name || requirement.addonId || requirement.addon_id || 'Required addon';
        const url = safeExternalUrl(requirement.manifestUrl || requirement.manifest_url || requirement.url || requirement.setupUrl || requirement.setup_url);
        return `<span class="nuvio-public-addon-pill">${escHtml(name)}${url ? ` <a href="${escHtml(url)}" target="_blank" rel="noopener noreferrer">Open setup ↗</a>` : ''}</span>`;
      }).join('')}</div>`;
    }

    function nuvioCommunityDescription(value) {
      return String(value || '')
        .replace(/!?(?:\[[^\]]*\])?\([^)]*\)/g, '')
        .replace(/[`*_>#]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 260) || 'A community collection ready to review and import into your Nuvio setup.';
    }

    function renderNuvioPublicCollections() {
      const modal = document.getElementById('nuvioPublicCollectionsModal');
      const list = modal?.querySelector('#nuvioPublicCollectionsList');
      const more = modal?.querySelector('#nuvioPublicCollectionsMore');
      const status = modal?.querySelector('#nuvioPublicCollectionsStatus');
      if (!modal || !list) return;
      if (status) status.textContent = nuvioCommunityBrowse.loading
        ? 'Loading public collections…'
        : nuvioCommunityBrowse.error || `${nuvioPublicVisibleItems().length} collection${nuvioPublicVisibleItems().length === 1 ? '' : 's'} shown`;
      const skeletons = '<div class="nuvio-public-skeletons">' + Array.from({ length: 4 }, () => '<div class="nuvio-public-skeleton"><div class="nps-art nps-shimmer"></div><div class="nps-copy"><i class="nps-line nps-shimmer"></i><i class="nps-line short nps-shimmer"></i><i class="nps-line nps-shimmer"></i><i class="nps-line tiny nps-shimmer"></i></div><div class="nps-actions"><i class="nps-button nps-shimmer"></i><i class="nps-button nps-shimmer"></i></div></div>').join('') + '</div>';
      list.innerHTML = nuvioCommunityBrowse.loading && !nuvioCommunityBrowse.items.length ? skeletons : nuvioPublicVisibleItems().length ? nuvioPublicVisibleItems().map(item => {
        const id = String(item.public_id || item.publicId || item.id || '');
        const title = item.title || item.name || item.envelope?.title || 'Untitled collection';
        const description = nuvioCommunityDescription(item.description || item.envelope?.description);
        const image = safeExternalUrl(item.image_url || item.imageUrl || item.coverImageUrl || item.envelope?.coverImageUrl || item.envelope?.collection?.coverImageUrl);
        const stats = item.stats || {};
        const requirements = nuvioCommunityRequirements(item);
        const collectionCount = Number(stats.collectionCount || stats.collection_count || 1);
        const folderCount = Number(stats.folderCount || stats.folder_count || 0);
        const sourceCount = Number(stats.sourceCount || stats.source_count || 0);
        return `<article class="nuvio-public-card"><div class="nuvio-public-art">${image ? `<img src="${escHtml(image)}" alt="" loading="lazy" onerror="this.style.display='none'">` : '<span>▦</span>'}<span class="nuvio-public-art-label">COMMUNITY PACK</span></div><div class="nuvio-public-copy"><div class="nuvio-public-title"><div><span class="nuvio-public-eyebrow">NUVIO COLLECTION</span><strong>${escHtml(title)}</strong></div>${requirements.length ? '<span class="nuvio-public-state needs">Needs addon</span>' : '<span class="nuvio-public-state ready">Ready to import</span>'}</div><p>${escHtml(description)}</p><div class="nuvio-public-meta"><span>${collectionCount} collection${collectionCount === 1 ? '' : 's'}</span><span>${folderCount} folders</span><span>${sourceCount} sources</span></div>${requirements.length ? nuvioCommunityAddonPills(requirements) : ''}</div><div class="nuvio-public-actions"><button type="button" class="curated-pack-view" onclick="openNuvioPublicCollectionDetail(${jsStr(id)})">Preview</button><button type="button" class="curated-pack-edit" onclick="importNuvioPublicCollection(${jsStr(id)})">Import</button></div></article>`;
      }).join('') : nuvioCommunityBrowse.error
        ? `<div class="imported-empty">${escHtml(nuvioCommunityBrowse.error)}<br><button type="button" class="curated-pack-edit" style="margin-top:10px" onclick="loadNuvioPublicCollections({reset:true})">Try again</button></div>`
        : '<div class="imported-empty">No public collections match that search.</div>';
      if (more) { more.hidden = !nuvioCommunityBrowse.hasNextPage; more.disabled = nuvioCommunityBrowse.loading; more.textContent = nuvioCommunityBrowse.loading ? 'Loading…' : 'Load more'; }
    }

    async function loadNuvioPublicCollections({ reset = false } = {}) {
      const modal = document.getElementById('nuvioPublicCollectionsModal');
      if (!modal || nuvioCommunityBrowse.loading) return;
      if (reset) { nuvioCommunityBrowse.items = []; nuvioCommunityBrowse.page = 1; nuvioCommunityBrowse.hasNextPage = false; nuvioCommunityBrowse.error = ''; }
      nuvioCommunityBrowse.loading = true; renderNuvioPublicCollections();
      try {
        const data = await fetchNuvioCommunity('collections', { sort: nuvioCommunityBrowse.sort, search: nuvioCommunityBrowse.search, page: nuvioCommunityBrowse.page, limit: 24, type: 'all' });
        const items = nuvioCommunityItems(data);
        const pagination = data?.pagination || data?.pageInfo || data?.data?.pagination || {};
        nuvioCommunityBrowse.items = [...nuvioCommunityBrowse.items, ...items.filter(item => !nuvioCommunityBrowse.items.some(existing => String(existing.public_id || existing.publicId || existing.id) === String(item.public_id || item.publicId || item.id)))];
        nuvioCommunityBrowse.hasNextPage = pagination.hasNextPage === true || pagination.has_next_page === true || (items.length === 24 && pagination.hasNextPage !== false && pagination.has_next_page !== false);
        if (nuvioCommunityBrowse.hasNextPage) nuvioCommunityBrowse.page += 1;
      } catch (err) {
        nuvioCommunityBrowse.error = err.message || 'Could not load Nuvio public collections.';
        showToast(err.message || 'Could not load Nuvio public collections.', 'error');
      } finally {
        nuvioCommunityBrowse.loading = false; renderNuvioPublicCollections();
      }
    }

    function searchNuvioPublicCollections() {
      const modal = document.getElementById('nuvioPublicCollectionsModal');
      if (!modal) return;
      nuvioCommunityBrowse.search = modal.querySelector('#nuvioPublicCollectionsSearch')?.value.trim() || '';
      nuvioCommunityBrowse.sort = modal.querySelector('#nuvioPublicCollectionsSort')?.value || 'popular';
      loadNuvioPublicCollections({ reset: true });
    }

    function openNuvioPublicCollectionsModal() {
      document.getElementById('nuvioPublicCollectionsModal')?.remove();
      const modal = document.createElement('div');
      modal.id = 'nuvioPublicCollectionsModal'; modal.className = 'curated-edit-modal';
      modal.innerHTML = `<div class="curated-edit-dialog nuvio-public-dialog"><div class="curated-edit-head"><div><span class="section-kicker">NUVIO COMMUNITY</span><h3>Browse Public Collections</h3><p>Import a community collection directly into your LeLibrary Nuvio setup.</p></div><button type="button" onclick="this.closest('.curated-edit-modal').remove()">×</button></div><div class="curated-edit-body"><div class="nuvio-public-toolbar"><form onsubmit="event.preventDefault();searchNuvioPublicCollections()"><input id="nuvioPublicCollectionsSearch" class="cg-search" placeholder="Search collections…"><button type="submit" class="search-btn">Search</button></form><select id="nuvioPublicCollectionsSort" onchange="searchNuvioPublicCollections()"><option value="popular">Popular</option><option value="recent">Recent</option></select><select id="nuvioPublicCollectionsFilter" onchange="setNuvioPublicCollectionFilter(this.value)"><option value="">All</option><option value="ready">No addon needed</option><option value="needs">Needs addon</option></select></div><div class="nuvio-public-note"><strong>Compatibility is shown before import</strong><span>Collections with required addons show every declared addon. Where Nuvio provides a manifest/setup URL, use the Open setup link before importing.</span></div><p id="nuvioPublicCollectionsStatus" class="field-hint">Loading public collections…</p><div id="nuvioPublicCollectionsList" class="nuvio-public-list"></div><button id="nuvioPublicCollectionsMore" type="button" class="btn-copy-url nuvio-public-more" onclick="loadNuvioPublicCollections()" hidden>Load more</button></div><div class="curated-edit-actions"><span></span><span></span><button type="button" class="btn-copy-url" onclick="this.closest('.curated-edit-modal').remove()">Close</button></div></div>`;
      modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
      document.body.appendChild(modal);
      nuvioCommunityBrowse = { items: [], page: 1, hasNextPage: false, loading: false, error: '', search: '', sort: 'popular' };
      loadNuvioPublicCollections({ reset: true });
    }

    function nuvioPublicDetailCollections(detail, item) {
      const root = detail?.item || detail || item || {};
      const envelope = root?.envelope || item?.envelope || root;
      const collections = Array.isArray(envelope?.collections) ? envelope.collections : envelope?.collection ? [envelope.collection] : [];
      return { root, envelope, collections };
    }

    function restoreNuvioPublicBrowseView() {
      const modal = document.getElementById('nuvioPublicCollectionsModal');
      const body = modal?.querySelector('.curated-edit-body');
      if (!body) return;
      body.innerHTML = '<div class="nuvio-public-toolbar"><form onsubmit="event.preventDefault();searchNuvioPublicCollections()"><input id="nuvioPublicCollectionsSearch" class="cg-search" placeholder="Search collections…"><button type="submit" class="search-btn">Search</button></form><select id="nuvioPublicCollectionsSort" onchange="searchNuvioPublicCollections()"><option value="popular">Popular</option><option value="recent">Recent</option></select><select id="nuvioPublicCollectionsFilter" onchange="setNuvioPublicCollectionFilter(this.value)"><option value="">All</option><option value="ready">No addon needed</option><option value="needs">Needs addon</option></select></div><div class="nuvio-public-note"><strong>Compatibility is shown before import</strong><span>Collections with required addons show every declared addon. Where Nuvio provides a manifest/setup URL, use the Open setup link before importing.</span></div><p id="nuvioPublicCollectionsStatus" class="field-hint"></p><div id="nuvioPublicCollectionsList" class="nuvio-public-list"></div><button id="nuvioPublicCollectionsMore" type="button" class="btn-copy-url nuvio-public-more" onclick="loadNuvioPublicCollections()" hidden>Load more</button>';
      body.querySelector('#nuvioPublicCollectionsSearch').value = nuvioCommunityBrowse.search;
      body.querySelector('#nuvioPublicCollectionsSort').value = nuvioCommunityBrowse.sort;
      body.querySelector('#nuvioPublicCollectionsFilter').value = nuvioCommunityBrowse.filter || '';
      renderNuvioPublicCollections();
    }

    function renderNuvioPublicCollectionDetail(detail, item) {
      const modal = document.getElementById('nuvioPublicCollectionsModal');
      const body = modal?.querySelector('.curated-edit-body');
      if (!modal || !body) return;
      const { root, envelope, collections } = nuvioPublicDetailCollections(detail, item);
      const id = String(item?.public_id || item?.publicId || item?.id || root?.public_id || root?.publicId || root?.id || '');
      const title = root?.title || root?.name || envelope?.title || item?.title || 'Nuvio collection';
      const description = root?.description || envelope?.description || item?.description || 'Community collection for Nuvio.';
      const image = safeExternalUrl(root?.image_url || root?.imageUrl || root?.coverImageUrl || envelope?.coverImageUrl || collections[0]?.coverImageUrl);
      const requirements = nuvioCommunityRequirements(root).length ? nuvioCommunityRequirements(root) : nuvioCommunityRequirements(item);
      const collectionMarkup = collections.length ? collections.map(collection => {
        const folders = Array.isArray(collection?.folders) ? collection.folders : [];
        return `<section class="nuvio-public-detail-pack"><div class="nuvio-public-detail-pack-head"><div><strong>${escHtml(collection?.title || 'Collection')}</strong><small>${folders.length} folder${folders.length === 1 ? '' : 's'}</small></div><span>${escHtml(String(collection?.viewMode || collection?.displayMode || 'Tabbed grid').replace(/_/g, ' ').toLowerCase())}</span></div><div class="nuvio-public-folder-grid">${folders.length ? folders.map(folder => {
          const art = safeExternalUrl(folder?.coverImageUrl || folder?.focusGifUrl || folder?.heroBackdropUrl);
          // Nuvio folders carry every source (addon + TMDB + Trakt) in
          // `sources`; `catalogSources` is only the addon subset and can be
          // empty for packs built on TMDB lists/discover (e.g. Streaming
          // Services). Count all of them so previews match what imports.
          const allSources = Array.isArray(folder?.sources) && folder.sources.length ? folder.sources : (Array.isArray(folder?.catalogSources) ? folder.catalogSources : []);
          const builtInCount = allSources.filter(source => ['tmdb', 'trakt'].includes(String(source?.provider || '').toLowerCase())).length;
          const sourceLabel = `${allSources.length} source${allSources.length === 1 ? '' : 's'}`;
          const providerNote = builtInCount ? ` · ${builtInCount === allSources.length ? 'Nuvio built-in' : `${allSources.length - builtInCount} addon + ${builtInCount} built-in`}` : '';
          return `<article class="nuvio-public-folder"><div class="nuvio-public-folder-art">${art ? `<img src="${escHtml(art)}" alt="" loading="lazy" onerror="this.style.display='none'">` : '<span>▦</span>'}</div><div><strong>${escHtml(folder?.title || folder?.name || 'Untitled folder')}</strong><small>${sourceLabel}${providerNote}${folder?.tileShape ? ` · ${escHtml(String(folder.tileShape).toLowerCase())}` : ''}</small></div></article>`;
        }).join('') : '<p class="field-hint">No folders were included in this collection.</p>'}</div></section>`;
      }).join('') : '<div class="imported-empty">Nuvio did not provide the folder preview for this item, but it can still be imported.</div>';
      body.innerHTML = `<button type="button" class="nuvio-public-back" onclick="restoreNuvioPublicBrowseView()">← Back to browse</button><section class="nuvio-public-detail-hero">${image ? `<img src="${escHtml(image)}" alt="">` : '<div class="nuvio-public-detail-fallback">▦</div>'}<div><span class="section-kicker">NUVIO COMMUNITY COLLECTION</span><h3>${escHtml(title)}</h3><p>${escHtml(description)}</p>${nuvioCommunityAddonPills(requirements)}</div></section><div class="nuvio-public-detail-summary"><span>${collections.length} collection${collections.length === 1 ? '' : 's'}</span><span>${collections.reduce((count, collection) => count + (collection?.folders?.length || 0), 0)} folders</span><span>${requirements.length ? 'Additional addon required' : 'No additional addon'}</span></div><div class="nuvio-public-detail-packs">${collectionMarkup}</div><div class="nuvio-public-detail-actions"><button type="button" class="btn-copy-url" onclick="restoreNuvioPublicBrowseView()">Back</button><button type="button" class="btn-main btn-gen" onclick="importNuvioPublicCollection(${jsStr(id)})">Import collection</button></div>`;
    }

    async function openNuvioPublicCollectionDetail(id) {
      const modal = document.getElementById('nuvioPublicCollectionsModal');
      const body = modal?.querySelector('.curated-edit-body');
      const item = nuvioCommunityBrowse.items.find(entry => String(entry.public_id || entry.publicId || entry.id) === String(id));
      if (!modal || !body || !item) return;
      body.innerHTML = '<div class="nuvio-public-detail-loading"><div class="nps-art nps-shimmer"></div><div><i class="nps-line nps-shimmer"></i><i class="nps-line short nps-shimmer"></i><i class="nps-line nps-shimmer"></i></div></div>';
      try {
        const detail = await fetchNuvioCommunity(`collections/${encodeURIComponent(id)}`);
        renderNuvioPublicCollectionDetail(detail, item);
      } catch (error) {
        nuvioCommunityBrowse.error = error?.message || 'Could not open this Nuvio collection.';
        restoreNuvioPublicBrowseView();
      }
    }

    async function importNuvioPublicCollection(id) {
      const modal = document.getElementById('nuvioPublicCollectionsModal');
      const item = nuvioCommunityBrowse.items.find(entry => String(entry.public_id || entry.publicId || entry.id) === String(id));
      if (!modal || !item) return;
      try {
        const data = await fetchNuvioCommunity(`collections/${encodeURIComponent(id)}`);
        const detail = data?.item || data;
        const envelope = detail?.envelope || item?.envelope || detail;
        const collections = Array.isArray(envelope?.collections) ? envelope.collections : envelope?.collection ? [envelope.collection] : [];
        if (!collections.length) throw new Error('This public collection did not include an importable Nuvio collection document.');
        const source = importedSourceFromJson({ collections }, `nuvio-community:${id}`);
        source.title = detail?.title || item.title || 'Nuvio public collection';
        source.community = { publicId: String(id), requirements: nuvioCommunityRequirements(detail).length ? nuvioCommunityRequirements(detail) : nuvioCommunityRequirements(item) };
        applyImportedCompatibility(source);
        importedRows = [...importedRows.filter(existing => existing.id !== source.id), source];
        syncImportedCollectionOrder(); renderImportedRows(); renderCataloguesOptions(); checkChanged();
        modal.remove(); showToast('Nuvio public collection imported. Save and push to add it to your profile.');
      } catch (err) {
        showToast(err.message || 'Could not import this Nuvio public collection.', 'error');
      }
    }

    function openImportedRowsModal(mode = 'manifest') {
      document.getElementById('importedRowsModal')?.remove();
      const collections = mode === 'collections';
      const modal = document.createElement('div');
      modal.id = 'importedRowsModal';
      modal.className = 'curated-edit-modal';
      modal.dataset.importMode = mode;
      const manifestFields = collections ? '' : `<label class="field-label">Manifest URL<input id="importedUrl" class="cg-search" placeholder="https://example.com/manifest/.../manifest.json"></label><button type="button" class="imported-add-url" onclick="addImportedManifestUrl()">＋ Add another manifest URL</button><div id="importedManifestUrls"></div><p class="field-hint">A manifest imports catalogue rows for Home. It does not contain native Nuvio folders.</p>`;
      const collectionFields = collections ? `<div class="import-file-drop"><span class="import-file-icon">⇧</span><strong>Choose collections.json</strong><small>Upload the export from Nuvio or another collection manager</small><label class="btn-copy-url">Choose file<input id="importedJsonFile" type="file" accept=".json,application/json" onchange="importedFileSelected(this)"></label></div><div class="imported-divider"><span>or paste the JSON below</span></div><textarea id="importedJson" class="imported-json-input" placeholder="[{ &quot;id&quot;: &quot;...&quot;, &quot;title&quot;: &quot;...&quot;, &quot;folders&quot;: [...] }, ...]"></textarea><p class="field-hint">Collections JSON preserves groups, folders, artwork and the addon that owns each catalogue.</p><div class="imported-dependency-warning"><strong>External sources are preserved</strong><span>Some folders may use AIOMetadata, AIOStreams, Xperience or another addon. Those addons must also be installed and enabled in the same Nuvio profile.</span></div>` : '';
      modal.innerHTML = `<div class="curated-edit-dialog imported-dialog"><div class="curated-edit-head"><div><span class="section-kicker">${collections ? 'NATIVE NUVIO SETUP' : 'CATALOGUE SOURCES'}</span><h3>${collections ? 'Import Collections' : 'Import Manifest'}</h3><p>${collections ? 'Bring in a collections.json export with its folders and presentation settings.' : 'Bring catalogue rows from a Stremio-compatible manifest.'}</p></div><button type="button" onclick="this.closest('.curated-edit-modal').remove()">×</button></div><div class="curated-edit-body">${manifestFields}${collectionFields}<div id="importedPreview" class="imported-preview"></div><div class="curated-edit-actions"><button type="button" class="btn-copy-url" onclick="this.closest('.curated-edit-modal').remove()">Cancel</button><button type="button" class="btn-main btn-gen" onclick="importImportedConfiguration()">${collections ? 'Import Collections' : 'Fetch Manifest'}</button></div></div></div>`;
      modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
      document.body.appendChild(modal);
    }
    function addImportedManifestUrl() { const list = document.getElementById('importedManifestUrls'); if (!list) return; const input = document.createElement('input'); input.className = 'cg-search imported-manifest-url'; input.placeholder = 'https://example.com/manifest/.../manifest.json'; list.appendChild(input); }
    function importedFileSelected(input) { const file = input.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { const target = document.getElementById('importedJson'); if (target) target.value = String(reader.result || ''); }; reader.onerror = () => showToast('Could not read that JSON file'); reader.readAsText(file); }
    async function fetchImportedPayload(url) {
      const response = await fetch(`/api/import-json?url=${encodeURIComponent(url)}`); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Import failed'); return data;
    }
    async function importImportedConfiguration() {
      const modal = document.getElementById('importedRowsModal'); if (!modal) return;
      const profileName = 'Imported setup';
      const manifestUrls = [...modal.querySelectorAll('.imported-manifest-url'), document.getElementById('importedUrl')].map(input => input?.value.trim()).filter(Boolean);
      const pasted = document.getElementById('importedJson')?.value.trim(); const collectionsUrl = document.getElementById('importedCollectionsUrl')?.value.trim();
      if (!manifestUrls.length && !pasted && !collectionsUrl) return showToast('Add a manifest URL, Collections URL, or JSON file');
      const preview = document.getElementById('importedPreview'); if (preview) preview.textContent = 'Fetching and validating…';
      try {
        const sources = []; const manifests = [];
        for (const url of [...new Set(manifestUrls)]) { const payload = await fetchImportedPayload(url); manifests.push(payload); const source = importedSourceFromJson(payload, url); source.title = manifestUrls.length > 1 ? `${profileName} · ${source.title}` : profileName; sources.push(source); }
        // A pasted/uploaded document deliberately wins over a Collections URL.
        if (pasted || collectionsUrl) {
          const data = pasted ? JSON.parse(pasted) : await fetchImportedPayload(collectionsUrl);
          const collectionSource = (Array.isArray(data?.selectedCatalogs) || Array.isArray(data?.customCatalogs) || data?.project || data?.setup)
            ? importedSourceFromProject(data.project || data, pasted ? 'pasted-json' : collectionsUrl, manifests[0])
            : importedSourceFromJson(data, pasted ? 'pasted-json' : collectionsUrl);
          collectionSource.title = profileName;
          if (sources.length) sources[0].collections = [...(sources[0].collections || []), ...(collectionSource.collections || [])]; else sources.push(collectionSource);
        }
        sources.forEach(applyImportedCompatibility);
        const rows = sources.reduce((n, source) => n + source.rows.filter(row => row.enabled !== false).length, 0); const folders = sources.reduce((n, source) => n + (source.collections || []).reduce((m, c) => m + (c.folders || []).length, 0), 0);
        if (preview) preview.textContent = `Ready to import ${rows} Home row${rows === 1 ? '' : 's'} and ${folders} collection folder${folders === 1 ? '' : 's'}.`;
        importedRows = [...importedRows.filter(item => !sources.some(source => source.id === item.id)), ...sources];
        syncImportedCollectionOrder();
        modal.remove(); renderImportedRows(); renderCataloguesOptions(); checkChanged(); showToast('Import ready. Save and push to apply it.');
      } catch (err) {
        // Keep the user-facing error short and styled, while preserving the
        // full exception and imported-data context for browser-console debug.
        console.error('[Import] Cannot import collection setup:', err, { manifestUrls, hasPastedJson: !!pasted, hasCollectionsUrl: !!collectionsUrl });
        if (preview) preview.textContent = 'Cannot import this setup. Open the browser console for the technical detail.';
        showToast('Cannot import this setup. Check the file or browser console.', 'error');
      }
    }
    function addImportedSource(source) { importedRows = [...importedRows.filter(item => item.id !== source.id), source]; syncImportedCollectionOrder(); document.getElementById('importedRowsModal')?.remove(); renderImportedRows(); renderCataloguesOptions(); checkChanged(); showToast('Imported rows added. Save and push to apply them.'); }
    function editImportedSource(id, viewOnly = false) {
      const source = importedRows.find(item => item.id === id); if (!source) return;
      const rows = source.rows.slice().sort((a,b)=>(a.order||0)-(b.order||0));
      const collections = (source.collections || []).map(collection => {
        const settings = { viewMode: 'TABBED_GRID', pinToTop: false, showAllTab: true, focusGlowEnabled: true, ...collection };
        const folders = (collection.folders || []).map(folder => collectionFolderEditor(folder, { includeEnabled: true, readOnly: viewOnly })).join('');
        const heading = source.collections.length > 1 ? `<div class="imported-pack-section-head"><strong>${escHtml(collection.title || 'Imported collection')}</strong><small>${(collection.folders || []).length} folders</small></div>` : '';
        return `<section class="imported-pack-section" data-import-collection-id="${escHtml(collection.id)}">${heading}${collectionPackSettingsEditor(settings, 'data-import-pack-setting', viewOnly)}${folders || '<p class="field-hint">This collection has no folders.</p>'}</section>`;
      }).join('');
      const homeRows = rows.map(row => `<div class="imported-edit-row" data-row-id="${escHtml(row.id)}"><label><input type="checkbox" data-import-enabled ${row.enabled !== false ? 'checked' : ''} ${viewOnly ? 'disabled' : ''}> <strong>${escHtml(row.title)}</strong></label>${viewOnly ? `<small>${escHtml(importedMatchLabel(row) || row.source?.catalogId || '')}</small>` : `<input data-import-title value="${escHtml(row.title)}" placeholder="Row name">`}</div>`).join('');
      const editTitle = source.collections?.length === 1 ? (source.collections[0].title || source.title) : source.title;
      document.getElementById('importedRowsModal')?.remove(); const modal = document.createElement('div'); modal.id = 'importedRowsModal'; modal.className = 'curated-edit-modal'; modal.dataset.importSourceId = id; modal.innerHTML = `<div class="curated-edit-dialog"><div class="curated-edit-head"><div><h3>${viewOnly ? 'View' : 'Edit'} ${escHtml(editTitle)}</h3><p>${collections ? 'Customize the artwork and folder names used in Nuvio.' : 'Choose the imported Home rows and adjust their labels.'}</p></div><button type="button" onclick="this.closest('.curated-edit-modal').remove()">×</button></div><div class="curated-edit-body">${importedDependencyNotice(source)}${importedUnresolvedNotice(source)}${homeRows}${collections}${!homeRows && !collections ? '<p class="field-hint">This import has no rows or folders.</p>' : ''}</div>${viewOnly ? '' : `<div class="curated-edit-actions"><button type="button" class="btn-copy-url" onclick="resetImportedEditorFields()">Reset to original</button><span></span><button type="button" class="btn-copy-url" onclick="this.closest('.curated-edit-modal').remove()">Cancel</button><button type="button" class="btn-main btn-gen" onclick="saveImportedSource('${id}')">Save changes</button></div>`}</div>`; modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); }); bindCollectionEditorPreviews(modal); document.body.appendChild(modal);
    }

    function resetImportedEditorFields() {
      const modal = document.getElementById('importedRowsModal');
      if (!modal) return;
      // Nothing is persisted until Save. Closing and reopening restores the
      // original imported values and exactly mirrors the curated-pack reset.
      if (modal.dataset.importSourceId) editImportedSource(modal.dataset.importSourceId);
    }
    function saveImportedSource(id) {
      const source = importedRows.find(item => item.id === id); const modal = document.getElementById('importedRowsModal'); if (!source || !modal) return;
      for (const row of modal.querySelectorAll('.curated-edit-row[data-folder-id]')) {
        for (const [field, rule] of Object.entries(CURATED_ARTWORK_RULES)) {
          const input = row.querySelector(`[data-field="${field}"]`); const value = input?.value.trim() || '';
          if (!validCuratedArtworkUrl(value, rule.extensions)) { input?.focus(); showToast(`${rule.label} must be a valid ${artworkUrlHint(field)} URL`); return; }
        }
      }
      for (const rowEl of modal.querySelectorAll('.imported-edit-row[data-row-id]')) {
        const row = source.rows.find(item => item.id === rowEl.dataset.rowId); if (!row) continue;
        row.enabled = !!rowEl.querySelector('[data-import-enabled]')?.checked;
        const title = rowEl.querySelector('[data-import-title]'); if (title) row.title = title.value.trim() || row.title;
      }
      for (const collectionEl of modal.querySelectorAll('[data-import-collection-id]')) {
        const collection = source.collections?.find(item => item.id === collectionEl.dataset.importCollectionId); if (!collection) continue;
        collectionEl.querySelectorAll('[data-import-pack-setting]').forEach(control => { collection[control.dataset.importPackSetting] = control.type === 'checkbox' ? !!control.checked : control.value; });
        for (const rowEl of collectionEl.querySelectorAll('.curated-edit-row[data-folder-id]')) {
          const folder = (collection.folders || []).find(item => item.id === rowEl.dataset.folderId); if (!folder) continue;
          const value = field => rowEl.querySelector(`[data-field="${field}"]`);
          folder.enabled = !!rowEl.querySelector('[data-import-enabled]')?.checked;
          folder.title = value('title')?.value.trim() || folder.title;
          folder.coverImageUrl = storeCollectionArtwork(value('coverImageUrl')?.value.trim() || '');
          folder.focusGifUrl = storeCollectionArtwork(value('focusGifUrl')?.value.trim() || '');
          folder.heroBackdropUrl = storeCollectionArtwork(value('heroBackdropUrl')?.value.trim() || '');
          folder.titleLogoUrl = storeCollectionArtwork(value('titleLogoUrl')?.value.trim() || '');
          folder.focusGifEnabled = !!value('focusGifEnabled')?.checked;
          folder.hideTitle = !value('showTitle')?.checked;
          folder.tileShape = value('tileShape')?.value === 'PORTRAIT' ? 'PORTRAIT' : 'LANDSCAPE';
        }
      }
      modal.remove(); syncImportedCollectionOrder(); renderImportedRows(); renderCataloguesOptions(); checkChanged(); showToast('Imported Nuvio artwork and settings saved. Save and push to apply them.');
    }

    function reviewImportedCompatibility(id) {
      const source = importedRows.find(item => item.id === id); if (!source) return;
      const candidates = importedBestEffortCandidates(source); if (!candidates.length) return showToast('No safe best-effort matches found for this import');
      document.getElementById('importedCompatibilityModal')?.remove();
      const modal = document.createElement('div'); modal.id = 'importedCompatibilityModal'; modal.className = 'curated-edit-modal';
      modal.innerHTML = `<div class="curated-edit-dialog imported-dialog"><div class="curated-edit-head"><div><span class="section-kicker">REVIEW REQUIRED</span><h3>Best-effort replacements</h3><p>These replacements use LeLibrary sources based on the folder title. They can differ from Xperience’s original filters, so none are selected automatically.</p></div><button type="button" onclick="this.closest('.curated-edit-modal').remove()">×</button></div><div class="curated-edit-body"><div class="imported-dependency-warning"><strong>Keep the external source unless you approve a replacement</strong><span>Choosing a match replaces that folder’s external catalog sources. The original source IDs are retained in the saved setup for reference.</span></div>${candidates.map((item, index) => `<label class="imported-edit-row imported-compatibility-row"><input type="checkbox" data-compat-index="${index}"><span><strong>${escHtml(item.folder.title || 'Untitled folder')}</strong><small>Replace with: ${escHtml(item.ids.map(friendlyCatalogSourceName).join(' · '))}</small></span></label>`).join('')}</div><div class="curated-edit-actions"><button type="button" class="btn-copy-url" onclick="this.closest('.curated-edit-modal').remove()">Keep external</button><button type="button" class="btn-main btn-gen" onclick="applyImportedCompatibilityReview('${id}')">Apply selected matches</button></div></div>`;
      modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); }); document.body.appendChild(modal);
    }
    function applyImportedCompatibilityReview(id) {
      const source = importedRows.find(item => item.id === id); const modal = document.getElementById('importedCompatibilityModal'); if (!source || !modal) return;
      const candidates = importedBestEffortCandidates(source); let applied = 0;
      modal.querySelectorAll('[data-compat-index]:checked').forEach(input => {
        const candidate = candidates[Number(input.dataset.compatIndex)]; if (!candidate) return;
        const folder = candidate.folder; folder.externalCatalogSources = JSON.parse(JSON.stringify(folder.catalogSources || []));
        folder.catalogSources = candidate.ids.map(sourceId => ({ addonId: '__lelibrary__', catalogId: `lelibrary-import-${sourceId.endsWith('_series') ? 'series' : 'movie'}`, type: sourceId.endsWith('_series') ? 'series' : 'movie', genre: `lib:${sourceId}`, compatibility: 'best-effort' }));
        folder.compatibility = 'best-effort'; applied++;
      });
      modal.remove(); renderImportedRows(); renderCataloguesOptions(); checkChanged(); showToast(applied ? `${applied} best-effort replacement${applied === 1 ? '' : 's'} applied. Save and push to use them.` : 'No replacements selected.');
    }

    // ── Stream Addons (Trending/Popular only) ──
    const STREAM_ADDONS = [
      { id: 'torrentio',    name: 'Torrentio',    logo: 'https://cdn.brandfetch.io/idmo5AU-sJ/w/204/h/185/theme/dark/logo.png?c=1dxbfHSJFAPEGdCLU4o5B', desc: 'Torrent + debrid streams from a wide provider network.' },
      { id: 'comet',        name: 'Comet',        logo: 'https://raw.githubusercontent.com/g0ldyy/comet/refs/heads/main/comet/assets/icon.png', desc: "Stremio's fast torrent/debrid stream addon." },
      { id: 'meteor',       name: 'Meteor',       logo: 'https://meteorfortheweebs.midnightignite.me/static/icon.png', desc: 'Torrent + debrid streams with usenet support.' },
      { id: 'mediafusion',  name: 'MediaFusion',  logo: 'https://raw.githubusercontent.com/mhdzumair/MediaFusion/refs/heads/main/resources/images/mediafusion_logo.png', desc: 'Universal streams for movies, series and anime.' },
      { id: 'jackettio',    name: 'Jackettio',    logo: 'https://raw.githubusercontent.com/Jackett/Jackett/bbea5febd623f6e536e11aa1fa8d6674d8d4043f/src/Jackett.Common/Content/jacket_medium.png', desc: 'Extra tracker results using your existing debrid account.' },
    ];

    function toggleStreamAddon(id, checked) {
      streamAddonsTouched = true;
      if (checked) {
        if (!streamAddons.includes(id)) streamAddons.push(id);
      } else {
        streamAddons = streamAddons.filter(x => x !== id);
      }
      renderStreamAddons();
      checkChanged();
    }

    let streamAddonDragging = null;
    function moveStreamAddon(id, direction) {
      const from = streamAddons.indexOf(id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= streamAddons.length) return;
      [streamAddons[from], streamAddons[to]] = [streamAddons[to], streamAddons[from]];
      streamAddonsTouched = true;
      renderStreamAddons();
      checkChanged();
    }
    function streamAddonDragStart(event, id) {
      if (!streamAddons.includes(id)) { event.preventDefault(); return; }
      streamAddonDragging = id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
    }
    function streamAddonDragOver(event, id) {
      if (!streamAddonDragging || !streamAddons.includes(id) || id === streamAddonDragging) return;
      event.preventDefault();
      event.currentTarget.classList.add('drag-over');
    }
    function streamAddonDragLeave(event) { event.currentTarget.classList.remove('drag-over'); }
    function streamAddonDrop(event, targetId) {
      event.preventDefault();
      event.currentTarget.classList.remove('drag-over');
      const sourceId = streamAddonDragging || event.dataTransfer.getData('text/plain');
      streamAddonDragging = null;
      const from = streamAddons.indexOf(sourceId);
      const to = streamAddons.indexOf(targetId);
      if (from < 0 || to < 0 || from === to) return;
      streamAddons.splice(from, 1);
      streamAddons.splice(to, 0, sourceId);
      streamAddonsTouched = true;
      renderStreamAddons();
      checkChanged();
    }
    function streamAddonDragEnd() {
      streamAddonDragging = null;
      document.querySelectorAll('.stream-priority-card.drag-over').forEach(card => card.classList.remove('drag-over'));
    }

    function renderStreamAddons() {
      const list = document.getElementById('streamAddonList');
      if (!list) return;
      const ordered = [
        ...streamAddons.map(id => STREAM_ADDONS.find(addon => addon.id === id)).filter(Boolean),
        ...STREAM_ADDONS.filter(addon => !streamAddons.includes(addon.id)),
      ];
      list.innerHTML = `<div class="stream-priority-head"><div><strong>Provider priority</strong><small>Enabled providers run after your owned copy, in the order shown.</small></div><span class="stream-priority-pill">Comet is usually faster: put it first if speed matters most.</span></div>
        <div class="stream-priority-list">${ordered.map(addon => {
          const priority = streamAddons.indexOf(addon.id);
          const enabled = priority >= 0;
          return `<div class="stream-priority-card${enabled ? ' enabled' : ''}" draggable="${enabled}" ondragstart="streamAddonDragStart(event, '${addon.id}')" ondragover="streamAddonDragOver(event, '${addon.id}')" ondragleave="streamAddonDragLeave(event)" ondrop="streamAddonDrop(event, '${addon.id}')" ondragend="streamAddonDragEnd()">
            <span class="stream-priority-rank">${enabled ? priority + 1 : '–'}</span>
            <img src="${escHtml(addon.logo)}" alt="${escHtml(addon.name)}" loading="lazy" onerror="this.style.display='none'" />
            <span class="stream-priority-copy"><strong>${escHtml(addon.name)}</strong><small>${escHtml(addon.desc)}</small></span>
            <span class="stream-priority-controls">
              <button type="button" aria-label="Move ${escHtml(addon.name)} up" ${!enabled || priority === 0 ? 'disabled' : ''} onclick="moveStreamAddon('${addon.id}', -1)">↑</button>
              <button type="button" aria-label="Move ${escHtml(addon.name)} down" ${!enabled || priority === streamAddons.length - 1 ? 'disabled' : ''} onclick="moveStreamAddon('${addon.id}', 1)">↓</button>
              <label class="stream-priority-toggle"><input type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleStreamAddon('${addon.id}', this.checked)"><i></i></label>
            </span>
          </div>`;
        }).join('')}</div>`;
      const enabledCount = streamAddons.length;
      const card = document.getElementById('streamAddonsCard');
      if (card) {
        const existing = card.querySelector('.streamAddonsStatus');
        if (existing) existing.remove();
        if (enabledCount > 0) {
          const badge = document.createElement('div');
          badge.className = 'streamAddonsStatus coll-note';
          badge.style.cssText = 'margin-top:10px;font-size:0.78rem;color:var(--success)';
          badge.textContent = `${enabledCount} stream addon${enabledCount > 1 ? 's' : ''} enabled: they power Trending/Popular streams only.`;
          card.appendChild(badge);
        }
      }
    }

    function connectWidgetHTML(s, focus) {
      return `
        <div class="connect-widget">
          <div class="connect-intro">
            <strong>${focus ? `Connect ${focus === 'stremio' ? 'Stremio' : 'Nuvio'}` : 'Optional'}</strong>: sign in to install LeLibrary straight into your account and
            import your catalogues, no copy/pasting URLs.
            <span class="ci-sub">All Stremio / Nuvio credentials are <strong>never sent to our servers</strong>: they go only to the
            platform's own API. Your login is saved in this browser so you stay signed in; Disconnect clears it.</span>
          </div>
          <div class="connect-grid">
            <!-- STREMIO BOX -->
            <div class="connect-box${focus === 'stremio' ? ' cb-focus' : ''}">
              <div class="cb-head">
                <img src="/stremio.svg" alt="Stremio" />
                <div><h3>Sign in with Stremio</h3><p>Email + password</p></div>
              </div>
              <div class="connect-form">
                <div class="field">
                  <div class="field-label">Stremio email</div>
                  <input type="email" id="${s}-stremioEmail" placeholder="you@example.com" autocomplete="off"
                    onkeydown="if(event.key==='Enter') connectStremio('${s}')" />
                </div>
                <div class="field">
                  <div class="field-label">Password</div>
                  <div class="input-row">
                    <input type="password" id="${s}-stremioPass" placeholder="••••••••" autocomplete="off"
                      onkeydown="if(event.key==='Enter') connectStremio('${s}')" />
                    <button class="btn-icon" type="button" onclick="toggleVis('${s}-stremioPass',this)">👁</button>
                  </div>
                  <p class="field-hint" id="${s}-stremioStatus">Sent only to Stremio's API (api.strem.io). Never stored.</p>
                </div>
                <button class="btn-main btn-gen" id="${s}-stremioSubmit" type="button" onclick="connectStremio('${s}')">
                  <div class="ico" id="${s}-stremioIco">🔑</div>
                  <div class="txt"><span id="${s}-stremioBtnLabel">Sign in with Stremio</span><small>Connects your Stremio account</small></div>
                  <span class="arr">›</span>
                </button>
              </div>
            </div>
            <!-- NUVIO BOX -->
            <div class="connect-box${focus === 'nuvio' ? ' cb-focus' : ''}">
              <div class="cb-head">
                <img src="/nuvio.png" alt="Nuvio" />
                <div><h3>Sign in with Nuvio</h3><p>Email + password</p></div>
              </div>
              <div class="connect-form">
                <div class="field">
                  <div class="field-label">Nuvio email</div>
                  <input type="email" id="${s}-nuvioEmail" placeholder="you@example.com" autocomplete="off"
                    onkeydown="if(event.key==='Enter') connectNuvio('${s}')" />
                </div>
                <div class="field">
                  <div class="field-label">Password</div>
                  <div class="input-row">
                    <input type="password" id="${s}-nuvioPass" placeholder="••••••••" autocomplete="off"
                      onkeydown="if(event.key==='Enter') connectNuvio('${s}')" />
                    <button class="btn-icon" type="button" onclick="toggleVis('${s}-nuvioPass',this)">👁</button>
                  </div>
                  <p class="field-hint" id="${s}-nuvioStatus">Sent only to Nuvio's API (api.nuvio.tv). Never stored.</p>
                </div>
                <button class="btn-main btn-gen" id="${s}-nuvioSubmit" type="button" onclick="connectNuvio('${s}')">
                  <div class="ico" id="${s}-nuvioIco">🔑</div>
                  <div class="txt"><span id="${s}-nuvioBtnLabel">Sign in with Nuvio</span><small>Connects your Nuvio account</small></div>
                  <span class="arr">›</span>
                </button>
              </div>
            </div>
          </div>
          <p class="connect-note warn">🔒 Only for Catalogues (Beta). Your login is saved in this browser (localStorage) so you don't sign in
          again: it never touches our server. <strong>Disconnect</strong> to clear it.</p>
        </div>`;
    }

    // Render Step 4 (Connect) and Step 5 (Push panel)
    function renderConnectAll() {
      renderInstallPush();
      updateInstallPushHint();
    }

    // Step 4: the sign-in boxes, or a connected card if signed in
    function renderConnectStep() {
      const el = document.getElementById('installPush');
      if (!connectState.platform) {
        el.innerHTML = connectWidgetHTML('step');
        return;
      }
      const plat = connectState.platform === 'stremio' ? 'Stremio' : 'Nuvio';
      const logo = connectState.platform === 'stremio' ? '/stremio.svg' : '/nuvio.png';
      const acc = connectState.platform === 'nuvio'
        ? escHtml(connectState.nuvioUser?.email || 'Nuvio account')
        : escHtml(connectState.stremioUser?.email || 'Stremio account');
      el.innerHTML = `
        <div class="connected-card">
          <img src="${logo}" alt="" style="width:30px;height:30px;border-radius:6px" />
          <div class="cc-info">
            <strong>Connected to ${plat}</strong>
            <small>${acc}</small>
          </div>
          <button class="btn-copy-url" type="button" onclick="disconnectConnect()">Disconnect</button>
        </div>
        <p class="field-hint" style="margin-top:10px">You're all set: push LeLibrary to your account below.</p>`;
    }

    function hasCollectionsForManual() {
      // Show Collections URL when any collection pack or imported collection is active
      if (Array.isArray(nuvioCollectionPacks) && nuvioCollectionPacks.length) return true;
      if (Array.isArray(importedRows) && importedRows.some(s => (s.collections || []).some(c => (c.folders || []).some(f => f.enabled !== false)))) return true;
      if (catSelection && catSelection.franchises) return true;
      return false;
    }
    function updateManualSetupLinks() {
      const urls = lastUrls || (function(){ try{ return buildUrls(buildSavedConfig()); }catch{return null;}})();
      const manManifest = document.getElementById('manualManifestUrl');
      const manCollections = document.getElementById('manualCollectionsUrl');
      const manConfigure = document.getElementById('manualConfigureUrl');
      const manField = document.getElementById('manualCollectionsField');
      if (urls) {
        if (manManifest) manManifest.textContent = urls.manifestUrl || '';
        if (manCollections) manCollections.textContent = urls.collectionsUrl || '';
        if (manConfigure) {
          const cfgUrl = urls.encoded ? `${window.location.origin}${configurePath(urls.encoded)}` : '';
          manConfigure.textContent = cfgUrl;
        }
        if (manField) manField.style.display = hasCollectionsForManual() ? '' : 'none';
        // Also keep legacy hidden fields in sync
        const legacy = document.getElementById('manifestUrl');
        if (legacy) legacy.textContent = urls.manifestUrl || '';
        const legacyRow = document.getElementById('urlRow');
        if (legacyRow) legacyRow.classList.toggle('show', !!urls.manifestUrl);
        const d = document.getElementById('btnDesktop');
        const w = document.getElementById('btnWeb');
        const n = document.getElementById('btnNuvio');
        if (d && urls.stremioDeep) d.href = urls.stremioDeep;
        if (w && urls.stremioWeb) w.href = urls.stremioWeb;
        if (n && urls.nuvioDeep) n.href = urls.nuvioDeep;
        const openBtn = document.getElementById('btnOpenStremio');
        if (openBtn && urls.stremioDeep) openBtn.dataset.href = urls.stremioDeep;
      }
    }
    function toggleManualSetup() {
      const body = document.getElementById('manualSetupBody');
      const arrow = document.getElementById('manualSetupArrow');
      if (!body) return;
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      if (arrow) arrow.textContent = open ? '∨' : '∧';
      const card = document.getElementById('manualSetupCard');
      if (card) card.classList.toggle('open', !open);
      if (!open) updateManualSetupLinks();
    }
    function handleOpenInStremio() {
      const btn = document.getElementById('btnOpenStremio');
      const href = btn?.dataset.href || lastUrls?.stremioDeep;
      if (href) window.location.href = href;
      else { try{ generate(); const u = lastUrls?.stremioDeep; if(u) window.location.href=u; }catch{} }
    }
    function handleOpenInStremioWeb() {
      const href = lastUrls?.stremioWeb;
      if (href) { window.open(href, '_blank', 'noopener'); return; }
      try { generate(); if (lastUrls?.stremioWeb) window.open(lastUrls.stremioWeb, '_blank', 'noopener'); } catch {}
    }
    function toggleStremioInstall() {
      const options = document.getElementById('stremioInstallOptions');
      const arrow = document.getElementById('stremioInstallArrow');
      const card = document.getElementById('stremioInstallCard');
      if (!options) return;
      const open = !options.hidden;
      options.hidden = open;
      if (arrow) arrow.textContent = open ? '›' : '⌄';
      if (card) card.classList.toggle('open', !open);
    }
    function handleShareProfile() {
      const url = lastUrls?.collectionsUrl || document.getElementById('manualCollectionsUrl')?.textContent.trim();
      if (!url) { showToast('Generate the setup links first'); return; }
      copyText(url, 'Profile link copied');
    }
    function handleCopyInstallLink(btn) {
      const url = lastUrls?.manifestUrl || document.getElementById('manualManifestUrl')?.textContent || document.getElementById('manifestUrl')?.textContent;
      if (!url) { try{ generate({skipVerify:true}); const u2 = lastUrls?.manifestUrl; if(u2) { copyText(u2,'URL copied!'); flashCopied(btn); } }catch{} return; }
      copyText(url,'URL copied!');
      flashCopied(btn);
    }
    function copyManualUrl(kind, btn) {
      const map = { manifest: 'manualManifestUrl', collections: 'manualCollectionsUrl', configure: 'manualConfigureUrl' };
      const id = map[kind];
      const el = document.getElementById(id);
      const url = el ? el.textContent.trim() : '';
      if (!url) { showToast('Generate the links first'); return; }
      copyText(url,'URL copied!');
      flashCopied(btn);
    }

    // Step 5: push panel: no sign-in here, just the push action.
    function renderInstallPush() {
      const el = document.getElementById('installPush');
      renderPlatformStep();
      const target = targetPlatform();
      const notConn = document.getElementById('pushNotConnectedHint');
      // Robust detection: for non-account tokens also consider localStorage fallback like public collections
      const effectivePlatform = connectState.platform || (function(){
        try{
          const saved = JSON.parse(localStorage.getItem(CONNECT_STORAGE_KEY)||'null');
          return saved && saved.platform ? saved.platform : null;
        }catch{return null;}
      })();
      // If account token, also consider accountConnections as fallback while async loads
      const accountFallback = ACCOUNT_TOKEN && (accountConnections.nuvio || accountConnections.stremio) ? (accountConnections.nuvio ? 'nuvio' : 'stremio') : null;
      const displayPlatform = connectState.platform || accountFallback || effectivePlatform;
      if (!connectState.platform) {
        // Hydrate from localStorage if memory was cleared (or token was obtained but platform not yet set)
        if (!ACCOUNT_TOKEN) {
          try{
            const saved = JSON.parse(localStorage.getItem(CONNECT_STORAGE_KEY)||'null');
            if (saved && (saved.nuvioToken || saved.stremioAuth || saved.platform)) {
              // Restore any missing fields without wiping current in-memory token
              for (const k of ['platform','selectedPlatform','stremioAuth','stremioUser','nuvioToken','nuvioRefresh','nuvioUser','nuvioProfiles','nuvioSelectedProfile']) {
                if (saved[k] != null && connectState[k] == null) connectState[k] = saved[k];
                if (Array.isArray(saved[k]) && (!Array.isArray(connectState[k]) || !connectState[k].length)) connectState[k] = saved[k];
              }
              if (connectState.platform) { renderInstallPush(); return; }
            }
          }catch{}
        }
        // Nuvio verified but profile not yet confirmed: show the picker, but if a profile is already selected (from Step 1) auto-connect and show Push
        if (connectState.nuvioToken && connectState.nuvioProfiles && connectState.nuvioProfiles.length) {
          if (connectState.nuvioSelectedProfile != null) {
            connectState.platform = 'nuvio';
            if (!connectState.selectedPlatform) connectState.selectedPlatform = 'nuvio';
            try{ persistConnect(); }catch{}
            // Fall through to the connected Push desk below
          } else {
            const profilesPick = connectState.nuvioProfiles
              .map(p => `<option value="${p.profile_index}" ${connectState.nuvioSelectedProfile === p.profile_index ? 'selected' : ''}>${escHtml(p.name)}</option>`)
              .join('') || '<option value="">No profiles found</option>';
            el.innerHTML = `<div class="publish-desk" style="border-color:rgba(84,173,255,.35);background:linear-gradient(135deg,rgba(84,173,255,.08),rgba(255,255,255,.02))">
              <div class="publish-desk-main">
                <div class="publish-desk-icon"><img src="/nuvio.png" alt="Nuvio"></div>
                <div class="publish-desk-copy">
                  <h3>Choose a profile</h3>
                  <p>Nuvio verified: pick the profile to publish to, then push.</p>
                  <div class="field" style="margin-top:10px">
                    <div class="field-label">Push to profile</div>
                    <select id="nuvioProfilePickInstall">${profilesPick}</select>
                  </div>
                </div>
              </div>
              <div class="publish-desk-action">
                <button class="btn-main btn-gen" type="button" onclick="(function(){const s=document.getElementById('nuvioProfilePickInstall'); if(s&&s.value){connectState.nuvioSelectedProfile=parseInt(s.value,10)||null;} nuvioConfirmProfile(); })()" style="min-width:160px;justify-content:center">
                  <div class="ico"><img src="/nuvio.png" alt=""></div><div class="txt"><span>Connect to Nuvio</span><small>Install on this profile</small></div><span class="arr">›</span>
                </button>
              </div>
            </div>`;
            if (notConn) notConn.style.display = 'none';
            return;
          }
        }
        if (connectState.nuvioToken) {
          // Token exists but profiles not yet in memory (e.g., after reload before confirm): load them
          el.innerHTML = `<div class="connect-box" style="text-align:center;padding:20px"><p style="color:var(--muted);font-size:0.85rem;margin:0">Loading Nuvio profiles…</p></div>`;
          loadNuvioProfiles().then(()=>{ try{persistConnect();}catch{}; renderInstallPush(); }).catch(()=>{});
          if (notConn) notConn.style.display = 'none';
          return;
        }
        if (connectState.stremioAuth) {
          // Stremio token exists but platform not set (edge): recover
          connectState.platform = 'stremio';
          try{persistConnect();}catch{}
          renderInstallPush(); return;
        }
        el.innerHTML = `<div class="connect-box" style="text-align:center;padding:20px"><p style="color:var(--muted);font-size:0.85rem;margin:0">Sign in on the <strong>Platform step</strong> (Step 1) to connect${target ? ' to ' + (target === 'nuvio' ? 'Nuvio' : 'Stremio') : ''}.</p></div>`;
        if (notConn) notConn.style.display = target ? '' : 'none';
        return;
      }
      if (notConn) notConn.style.display = 'none';
      const plat = connectState.platform === 'stremio' ? 'Stremio' : 'Nuvio';
      const profiles = connectState.nuvioProfiles
        .map(p => `<option value="${p.profile_index}" ${connectState.nuvioSelectedProfile === p.profile_index ? 'selected' : ''}>${escHtml(p.name)}</option>`)
        .join('') || '<option value="">No profiles found</option>';
      const lang = (document.getElementById('lang')?.value || 'en-US');
      const isStremio = connectState.platform === 'stremio';
      el.innerHTML = `
        <div class="publish-desk">
          <div class="publish-desk-main">
            <div class="publish-desk-icon"><img src="${isStremio ? '/stremio.svg' : '/nuvio.png'}" alt="${plat}"></div>
            <div class="publish-desk-copy">
              <h3>Publish to ${plat}</h3>
              <p>One click saves this setup and pushes your Home rows and collections to the selected profile.</p>
              <div class="publish-desk-pills">
                <span class="publish-desk-pill on">${escHtml(plat)}</span>
                <span class="publish-desk-pill">${escHtml(lang)}</span>
              </div>
              <div class="field" id="cataloguesProfileField" style="display:${connectState.platform === 'nuvio' ? 'block' : 'none'};margin-top:10px">
                <div class="field-label">Push to profile</div>
                <select id="cataloguesProfile" onchange="connectState.nuvioSelectedProfile = parseInt(this.value,10) || null; persistConnect();">${profiles}</select>
              </div>
              <div class="step-card" id="setupGuard" style="display:none;margin-top:10px;background:var(--amber-glow);border-color:rgba(245,158,11,0.35);padding:12px">
                <div style="display:flex;gap:12px;align-items:flex-start">
                  <span style="font-size:1.3rem;line-height:1.2">⚠️</span>
                  <div style="flex:1">
                    <strong style="color:var(--white);font-size:0.9rem">Finish the Setup tab first</strong>
                    <p style="font-size:0.82rem;color:var(--text);line-height:1.5;margin-top:6px">
                      You're trying to add <strong>LeLibrary Collections</strong>, but no Debrid providers or TMDB key are set up yet.
                      Collections are built from your own library, so we need those before we can configure them.
                    </p>
                  </div>
                </div>
              </div>
              <div class="field-hint" id="pushCataloguesStatus" style="margin-top:8px"></div>
              <div class="info-card" id="pushResultCard" style="display:none;margin-top:8px">
                <h4>Previous addons (backup)</h4>
                <p class="field-hint" style="margin:6px 0 10px 0">These were on your account before this push. Copy any you want to reinstall later.</p>
                <div class="backup-list" id="backupList"></div>
              </div>
            </div>
          </div>
          <div class="publish-desk-action">
            <button class="btn-main btn-gen" id="btnPushCatalogues" onclick="pushCatalogues()" style="min-width:160px;justify-content:center">
              <div class="ico"><img src="${isStremio ? '/stremio.svg' : '/nuvio.png'}" alt=""></div>
              <div class="txt"><span id="pushCataloguesLabel">Push to ${plat}</span><small id="pushCataloguesSmall">Adds or updates LeLibrary and keeps your other addons</small></div>
              <span class="arr">›</span>
            </button>
            <p class="field-hint" style="margin-top:8px;text-align:center">Your saved setup is ready to push again.</p>
          </div>
        </div>`;
      renderSecondaryPlatformAction(isStremio);
      updateCataloguesUI();
      updateManualSetupLinks();
    }

    function renderSecondaryPlatformAction(mainIsStremio) {
      const host = document.getElementById('secondaryPlatformAction');
      if (!host) return;
      if (mainIsStremio) {
        host.innerHTML = `<button class="account-action-row" type="button" onclick="pushAddonTo('nuvio')">
          <span class="account-action-icon nuvio"><img src="/nuvio.png" alt=""></span><span><strong>Push to Nuvio</strong><small>Connect Nuvio and publish this saved setup to a profile.</small></span><b>›</b>
        </button>`;
        return;
      }
      host.innerHTML = `<div class="account-action-card" id="stremioInstallCard">
        <button class="account-action-row" type="button" onclick="toggleStremioInstall()">
          <span class="account-action-icon stremio"><img src="/stremio.svg" alt=""></span><span><strong>Add to Stremio</strong><small>Choose the Stremio app or Stremio Web.</small></span><b id="stremioInstallArrow">›</b>
        </button>
        <div class="account-action-options" id="stremioInstallOptions" hidden>
          <button type="button" onclick="handleOpenInStremio()"><img src="/stremio.svg" alt="">Add to Stremio app<small>Opens the installed Stremio app.</small></button>
          <button type="button" onclick="handleOpenInStremioWeb()"><img src="/stremio.svg" alt="">Add to Stremio Web<small>Opens the addon page in Stremio Web.</small></button>
        </div>
      </div>`;
    }

    // Guard: LeLibrary Collections are built from your own library, so a debrid
    // provider + TMDB key must be set on the Setup tab before we can push them.
    function setupComplete() {
      const provider = document.getElementById('provider').value;
      if (!provider || provider === 'none') return false;
      const KEY_FIELD = { torbox: 'torboxApiKey', realdebrid: 'rdApiKey', alldebrid: 'adApiKey', premiumize: 'pmApiKey' };
      for (const id of getProviderSet()) {
        if (!(document.getElementById(KEY_FIELD[id])?.value.trim())) return false;
      }
      return !!document.getElementById('tmdbApiKey').value.trim();
    }

    function updateCataloguesUI() {
      if (!connectState.platform) return;
      const guard = !setupComplete();
      const el = id => document.getElementById(id);
      el('setupGuard').style.display = guard ? '' : 'none';
      el('pushActions')?.style && (el('pushActions').style.display = guard ? 'none' : '');
      // The Nuvio profile picker is always relevant once connected: it must not
      // be hidden behind the setup guard (which only gates the actual push).
      el('cataloguesProfileField').style.display = connectState.platform === 'nuvio' ? '' : 'none';
      const warn = document.querySelector('#installPush .url-warning strong');
      if (warn) warn.textContent = `Your other addons are kept: LeLibrary is added or updated on ${connectState.platform === 'stremio' ? 'Stremio' : 'Nuvio'}`;
      const changed = hasUnsavedConfigChanges();
      const platformName = connectState.platform === 'stremio' ? 'Stremio' : 'Nuvio';
      const pushLabel = el('pushCataloguesLabel');
      const pushSmall = el('pushCataloguesSmall');
      if (pushLabel) pushLabel.textContent = `${changed ? 'Save & Push to' : 'Push to'} ${platformName}`;
      if (pushSmall) pushSmall.textContent = changed
        ? 'Saves your changes first, then installs LeLibrary'
        : 'Adds or updates LeLibrary and keeps your other addons';
      el('pushCataloguesStatus').textContent = '';
      el('pushCataloguesStatus').style.color = '';
      el('pushCataloguesStatus').style.display = guard ? 'none' : '';
      el('pushResultCard').style.display = 'none';
    }

    function disconnectConnect() {
      if (ACCOUNT_TOKEN) {
        showToast('Manage this saved platform connection in Account Settings.', 'info');
        return;
      }
      const prevPlatform = connectState.platform; // capture before clearing
      connectState.platform = null;
      connectState.stremioAuth = null;
      connectState.stremioUser = null;
      connectState.nuvioToken = null;
      connectState.nuvioRefresh = null;
      connectState.nuvioUser = null;
      connectState.nuvioProfiles = [];
      connectState.nuvioSelectedProfile = null;
      clearPersistedConnect();
      renderConnectAll();
      showToast('Disconnected: login cleared from this browser');
    }

    async function stremioCall(path, body) {
      const r = await fetch(`${STREMIO_API}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      if (r.status === 429) throw Object.assign(new Error('Stremio rate limit reached: wait a minute and try again'), { code: 'RATE_LIMIT' });
      let data = null;
      try { data = await r.json(); } catch { /* non-JSON */ }
      if (!r.ok || data?.error) {
        const msg = data?.error?.message || `Stremio API error (HTTP ${r.status})`;
        throw Object.assign(new Error(msg), { code: data?.error?.code });
      }
      return data;
    }

    async function connectStremio(s) {
      if (ACCOUNT_TOKEN) { showToast('Connect Stremio in Account Settings for this saved token.', 'info'); return; }
      const email = document.getElementById(`${s}-stremioEmail`).value.trim();
      const pass  = document.getElementById(`${s}-stremioPass`).value;
      if (!email || !pass) { showToast('Enter your Stremio email and password'); return; }
      const submit = document.getElementById(`${s}-stremioSubmit`);
      const ico = document.getElementById(`${s}-stremioIco`);
      const label = document.getElementById(`${s}-stremioBtnLabel`);
      const status = document.getElementById(`${s}-stremioStatus`);
      if (submit) submit.disabled = true;
      if (ico) ico.classList.add('spin');
      if (label) label.textContent = 'Signing in…';
      try {
        const data = await stremioCall('login', { type: 1, email, password: pass });
        const authKey = data.result?.authKey || data.result?.token;
        if (!authKey) throw new Error('Stremio did not return a session token');
        connectState.stremioUser = data.result?.user || null;
        connectState.stremioAuth = authKey;
        connectState.platform = 'stremio';
        if (!connectState.selectedPlatform) connectState.selectedPlatform = 'stremio';
        persistConnect();
        renderPlatformStep();
        renderConnectAll();
        showToast('Connected to Stremio ✓: you can push below');
      } catch (err) {
        if (ico) ico.classList.remove('spin');
        if (submit) submit.disabled = false;
        if (label) label.textContent = 'Sign in with Stremio';
        if (status) status.textContent = '';
        showToast(err.code === 2 ? 'Stremio: user not found' : 'Stremio: ' + (err.message || 'login failed'), 'error');
      }
    }

    async function nuvioRpc(token, path, body) {
      const r = await fetch(`${NUVIO_API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: NUVIO_PUBLISHABLE_KEY, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body || {}),
        signal: AbortSignal.timeout(20000),
      });
      let data = null;
      try { data = await r.json(); } catch { /* non-JSON */ }
      if (!r.ok) {
        const msg = data?.msg || data?.message || data?.error_description || data?.error || `Nuvio API error (HTTP ${r.status})`;
        throw Object.assign(new Error(String(msg)), { code: data?.error_code || data?.code });
      }
      return data;
    }

    async function nuvioRest(token, path, options = {}) {
      const r = await fetch(`${NUVIO_API_BASE}${path}`, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json', apikey: NUVIO_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, ...(options.headers || {}) },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(20000),
      });
      let data = null;
      try { data = await r.json(); } catch { /* non-JSON */ }
      if (!r.ok) {
        const msg = data?.msg || data?.message || data?.error || `Nuvio API error (HTTP ${r.status})`;
        throw Object.assign(new Error(String(msg)), { code: data?.error_code || data?.code });
      }
      return data;
    }

    async function connectNuvio(s) {
      if (ACCOUNT_TOKEN) { showToast('Connect Nuvio in Account Settings for this saved token.', 'info'); return; }
      const email = document.getElementById(`${s}-nuvioEmail`).value.trim();
      const pass  = document.getElementById(`${s}-nuvioPass`).value;
      if (!email || !pass) { showToast('Enter your Nuvio email and password'); return; }
      const submit = document.getElementById(`${s}-nuvioSubmit`);
      const ico = document.getElementById(`${s}-nuvioIco`);
      const label = document.getElementById(`${s}-nuvioBtnLabel`);
      const status = document.getElementById(`${s}-nuvioStatus`);
      if (submit) submit.disabled = true;
      if (ico) ico.classList.add('spin');
      if (label) label.textContent = 'Signing in…';
      try {
        const r = await fetch(`${NUVIO_API_BASE}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: NUVIO_PUBLISHABLE_KEY },
          body: JSON.stringify({ email, password: pass }),
          signal: AbortSignal.timeout(20000),
        });
        let data = null;
        try { data = await r.json(); } catch { /* non-JSON */ }
        if (!r.ok || !data?.access_token) {
          const msg = data?.msg || data?.message || data?.error_description || 'sign-in failed';
          throw new Error(msg);
        }
        connectState.nuvioToken = data.access_token;
        connectState.nuvioRefresh = data.refresh_token || null;
        connectState.nuvioUser = data.user || null;
        // Persist immediately so Step 7 / public collections see the token even before profile confirm
        try{ persistConnect(); }catch{}
        if (label) label.textContent = 'Loading profiles…';
        await loadNuvioProfiles();
        try{ persistConnect(); }catch{}
        // Auto-select first profile and mark as connected so Step 7 can show "Connected / Push" directly.
        if (connectState.nuvioSelectedProfile == null && connectState.nuvioProfiles.length) {
          connectState.nuvioSelectedProfile = connectState.nuvioProfiles[0].profile_index;
        }
        if (connectState.nuvioSelectedProfile != null) {
          connectState.platform = 'nuvio';
          if (!connectState.selectedPlatform) connectState.selectedPlatform = 'nuvio';
          persistConnect();
          renderPlatformStep();
          renderConnectAll();
          showToast('Connected to Nuvio ✓');
          return;
        }
        renderNuvioProfilePicker(s);
        showToast('Nuvio verified ✓: choose a profile to connect');
      } catch (err) {
        if (ico) ico.classList.remove('spin');
        if (submit) submit.disabled = false;
        if (label) label.textContent = 'Sign in with Nuvio';
        if (status) status.textContent = '';
        showToast('Nuvio: ' + (err.message || 'could not connect'), 'error');
      }
    }

    // Stage 2 of the Nuvio connect: account verified, now pick the profile.
    function renderNuvioProfilePicker(prefix) {
      // Render into the appropriate container: connection panel (Step 1), #platformConnect, or #installPush
      let el;
      if (prefix === 'conn' && document.getElementById('platformConnectionPanel')) {
        el = document.getElementById('platformConnectionPanel');
      } else if (prefix === 'plat' && document.getElementById('platformConnect')) {
        el = document.getElementById('platformConnect');
      } else {
        el = document.getElementById('installPush');
      }
      if (!el) return;
      const email = (connectState.nuvioUser && (connectState.nuvioUser.email || connectState.nuvioUser.name)) || 'Nuvio account';
      const profiles = connectState.nuvioProfiles
        .map(p => `<option value="${p.profile_index}" ${connectState.nuvioSelectedProfile === p.profile_index ? 'selected' : ''}>${escHtml(p.name)}</option>`)
        .join('') || '<option value="">No profiles found</option>';

      if (prefix === 'conn') {
        // Render inside the branded connection panel
        el.innerHTML = `
          <div class="connection-panel">
            <button class="connection-back" onclick="changePlatform()">← Back</button>
            <img src="/nuvio.png" alt="Nuvio" class="connection-logo" />
            <h2>Your Nuvio Account</h2>
            <div class="connected-card" style="margin:0 auto 16px;max-width:400px">
              <img src="/nuvio.png" alt="" style="width:30px;height:30px;border-radius:6px" />
              <div class="cc-info"><strong>Nuvio verified ✓</strong><small>${escHtml(email)}</small></div>
            </div>
            <div class="connection-profile">
              <div class="field-label" style="font-size:0.78rem;color:var(--muted);font-weight:600;letter-spacing:0.02em">Choose a profile</div>
              <select id="nuvioProfilePick">${profiles}</select>
              <p style="color:var(--muted);font-size:0.78rem;margin-top:6px">LeLibrary is installed on this profile, with your collections and home rows.</p>
            </div>
            <button class="btn-main btn-nuvio" type="button" onclick="nuvioConfirmProfile()" style="width:100%;justify-content:center;margin-top:16px;cursor:pointer;font-family:var(--font)">
              <div class="ico"><img src="/nuvio.png" alt="Nuvio" style="width:20px;height:20px" /></div>
              <div class="txt"><span>Connect to Nuvio</span><small>Install LeLibrary on this profile</small></div>
              <span class="arr">›</span>
            </button>
            <div class="connection-notice" style="margin-top:16px;background:rgba(255,255,255,0.04);border:1px solid var(--border);color:var(--muted)"><strong style="color:var(--text)">Nuvio</strong> will install LeLibrary on the selected profile.</div>
          </div>`;
      } else {
        el.innerHTML = `
          <div class="step-card">
            <div class="connected-card">
              <img src="/nuvio.png" alt="" style="width:30px;height:30px;border-radius:6px" />
              <div class="cc-info"><strong>Nuvio verified ✓</strong><small>${escHtml(email)}</small></div>
            </div>
            <div class="field" style="margin-top:14px">
              <div class="field-label">Choose a profile</div>
              <select id="nuvioProfilePick">${profiles}</select>
              <p class="field-hint">LeLibrary is installed on this profile, with your collections and home rows.</p>
            </div>
            <button class="btn-main btn-nuvio" type="button" onclick="nuvioConfirmProfile()" style="margin-top:12px;cursor:pointer;font-family:var(--font)">
              <div class="ico"><img src="/nuvio.png" alt="Nuvio" style="width:20px;height:20px" /></div>
              <div class="txt"><span>Connect to Nuvio</span><small>Install LeLibrary on this profile</small></div>
              <span class="arr">›</span>
            </button>
          </div>`;
      }
    }

    function nuvioConfirmProfile() {
      const sel = document.getElementById('nuvioProfilePick');
      if (sel && sel.value !== '') {
        const idx = parseInt(sel.value, 10);
        if (!Number.isNaN(idx)) connectState.nuvioSelectedProfile = idx;
      } else if (connectState.nuvioProfiles.length) {
        connectState.nuvioSelectedProfile = connectState.nuvioProfiles[0].profile_index;
      }
      connectState.platform = 'nuvio';
      if (!connectState.selectedPlatform) connectState.selectedPlatform = 'nuvio';
      persistConnect();
      renderPlatformStep();
      renderConnectAll();
      showToast('Connected to Nuvio ✓: push below');
    }

    async function loadNuvioProfiles() {
      let list = [];
      try {
        const data = await nuvioRpc(connectState.nuvioToken, '/rest/v1/rpc/sync_pull_profiles', {});
        list = Array.isArray(data) ? data : (data?.profiles || data?.data || []);
      } catch (err) {
        console.warn('[Nuvio] loadNuvioProfiles failed:', err.message);
      }
      const seen = new Map();
      for (const p of list) {
        const idx = Math.trunc(Number(p.profile_index ?? p.id ?? p.profileId));
        if (!Number.isFinite(idx) || idx < 1 || seen.has(idx)) continue;
        seen.set(idx, {
          profile_index: idx,
          name: String(p.name || p.profile_name || '').trim() || `Profile ${idx}`,
          uses_primary_addons: !!(p.uses_primary_addons ?? p.usesPrimaryAddons),
        });
      }
      // A Nuvio account always has at least one profile. If the RPC came back
      // empty (older accounts, transient blips), fall back to a default so the
      // profile picker still comes through.
      if (!seen.size) {
        console.warn('[Nuvio] No profiles returned: falling back to Profile 1');
        seen.set(1, { profile_index: 1, name: 'Profile 1', uses_primary_addons: false });
      }
      connectState.nuvioProfiles = Array.from(seen.values()).sort((a, b) => a.profile_index - b.profile_index);
      return connectState.nuvioProfiles;
    }

    // Nuvio's sync_* RPCs return json columns (settings_json, collections_json)
    // as either a parsed object or a JSON string: accept both.
    function parseNuvioJson(value, fallback) {
      if (value && typeof value === 'object') return value;
      if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return fallback; }
      }
      return fallback;
    }

    // Remove old LeLibrary collection data from another profile. Other user
    // collections are preserved, and this repairs copies created by the earlier
    // account-wide push behavior. The collections part always runs (so profiles
    // that don't use the primary's addons never keep stale LeLibrary folders);
    // the home-row cleanup is best-effort and needs the manifest.
    async function removeLeLibraryFromNuvioProfile(token, profileId, manifest) {
      const collectionId = 'collection-lelibrary-franchises';
      const isLeLibraryCollection = (collection) => String(collection?.id || '').startsWith('collection-lelibrary');
      try {
        const pulled = await nuvioRpc(token, '/rest/v1/rpc/sync_pull_collections', {
          p_profile_id: profileId,
        });
        const row = Array.isArray(pulled) ? pulled[0] : pulled;
        let collections = row?.collections_json;
        if (typeof collections === 'string') {
          try { collections = JSON.parse(collections); } catch { collections = []; }
        }
        if (Array.isArray(collections)) {
          const filtered = collections.filter(c => !isLeLibraryCollection(c));
          if (filtered.length !== collections.length) {
            await nuvioRpc(token, '/rest/v1/rpc/sync_push_collections', {
              p_profile_id: profileId,
              p_collections_json: filtered,
              p_origin_client_id: nuvioOriginClientId(),
            });
          }
        }

        if (manifest && manifest.id) {
          const platform = 'home_catalog_shared';
          const homePulled = await nuvioRpc(token, '/rest/v1/rpc/sync_pull_home_catalog_settings', {
            p_profile_id: profileId,
            p_platform: platform,
          });
          const homeRow = Array.isArray(homePulled) ? homePulled[0] : homePulled;
          const settings = parseNuvioJson(homeRow?.settings_json, {});
          const items = Array.isArray(settings.items) ? settings.items : [];
          const filteredItems = items.filter(item => {
            const catalog = String(item.catalog_id || '');
            const itemKey = String(item.key || '');
            return !(String(item.collection_id || '').startsWith('collection-lelibrary') ||
              itemKey.startsWith('collection_collection-lelibrary') ||
              (item.addon_id && item.addon_id === manifest.id &&
                (catalog === 'torbox-collections' || catalog.startsWith('torbox-collection-'))));
          });
          if (filteredItems.length !== items.length) {
            await nuvioRpc(token, '/rest/v1/rpc/sync_push_home_catalog_settings', {
              p_profile_id: profileId,
              p_platform: platform,
              p_settings_json: {
                show_catalog_type: settings.show_catalog_type !== false,
                hide_unreleased_content: settings.hide_unreleased_content === true,
                items: filteredItems,
              },
              p_origin_client_id: nuvioOriginClientId(),
            });
          }
        }
      } catch (err) {
        console.warn(`[Push] Could not clean old LeLibrary data from Nuvio profile ${profileId}:`, err.message);
      }
    }

    // Order Nuvio's Home rows to match the user's catalogue order in the
    // Edit Catalogues tab (manifest order reflects it), with the collections
    // row hidden (it renders as the pinned "LeLibrary Collections" collection).
    // Nuvio keeps its own saved home-catalog order, so manifest order alone
    // isn't enough: this pushes the settings NuvioWeb reads (platform
    // 'home_catalog_shared').
    async function syncNuvioHomeOrder(token, profileId, manifest, externalRows = [], collections = []) {
      try {
        if (!manifest || !Array.isArray(manifest.catalogs)) return;
        const platform = 'home_catalog_shared';
        const pulled = await nuvioRpc(token, '/rest/v1/rpc/sync_pull_home_catalog_settings', {
          p_profile_id: profileId,
          p_platform: platform,
        });
        const row = Array.isArray(pulled) ? pulled[0] : pulled;
        const settings = parseNuvioJson(row?.settings_json, {});
        const items = Array.isArray(settings.items) ? settings.items.slice() : [];
        // Nuvio derives Home keys from the item fields with underscores. Do
        // not trust an old persisted `key` value: earlier LeLibrary pushes
        // wrote colon-separated keys, which created duplicate entries and
        // left the stale collection placement in charge.
        const canonicalHomeKey = (item) => {
          if (item?.is_collection === true || item?.isCollection === true || item?.collection_id || item?.collectionId) {
            return `collection_${item.collection_id || item.collectionId}`;
          }
          return `${item?.addon_id || item?.addonId || ''}_${item?.type || ''}_${item?.catalog_id || item?.catalogId || ''}`;
        };
        const byKey = new Map();
        const managedKeys = new Set();
        for (const item of items) {
          const key = canonicalHomeKey(item);
          const prior = byKey.get(key);
          if (!prior || Number(item?.order) < Number(prior?.order)) byKey.set(key, item);
        }

        let order = 0;
        for (const catalog of manifest.catalogs) {
          const key = `${manifest.id}_${catalog.type}_${catalog.id}`;
          const existing = byKey.get(key) || {};
          const isFranchise = String(catalog.id || '') === 'torbox-collections' ||
            String(catalog.id || '').startsWith('torbox-collection-');
          const hiddenFromHome = catalog.showInHome === false;
          // Hidden catalogue routes are supporting machinery for search,
          // folders and Discover. Putting them in Nuvio's saved Home order
          // causes Nuvio to move an unpinned collection after that whole
          // invisible addon block. They belong in neither the visible order
          // nor its disabled-items list.
          if (hiddenFromHome || isFranchise) {
            byKey.delete(key);
            continue;
          }
          const currentOrder = order++;
          byKey.set(key, {
            ...existing,
            addon_id: manifest.id,
            type: catalog.type,
            catalog_id: catalog.id,
            enabled: true,
            order: currentOrder,
            custom_title: existing.custom_title || '',
            is_collection: false,
            collection_id: existing.collection_id || '',
            key,
          });
          managedKeys.add(key);
        }

        // Collections are separate Home entries in Nuvio. Do not manufacture
        // or re-order them here: their persisted `collection_<id>` positions
        // belong to the user and are independent from manifest catalog order.

        const disabledExternalKeys = new Set();
        for (const source of (externalRows || [])) for (const imported of (source.rows || [])) {
          const external = imported.source || {};
          if (!external.addonId || !external.catalogId) continue;
          const externalKey = `${external.addonId}_${external.type || 'movie'}_${external.catalogId}`;
          if (imported.enabled === false) disabledExternalKeys.add(externalKey);
        }
        for (const key of disabledExternalKeys) byKey.delete(key);
        // External addon rows can be placed in Nuvio's shared Home settings
        // when the source addon is installed. Stremio ignores this Nuvio RPC.
        for (const source of (externalRows || [])) {
          for (const imported of (source.rows || []).filter(row => row.enabled !== false)) {
            const external = imported.source || {};
            if (!external.addonId || !external.catalogId) continue;
            const key = `${external.addonId}_${external.type || 'movie'}_${external.catalogId}`;
            const existing = byKey.get(key) || {};
            byKey.set(key, { ...existing, addon_id: external.addonId, type: external.type || 'movie', catalog_id: external.catalogId, enabled: true, order: order++, custom_title: imported.title || existing.custom_title || '', key });
          }
        }

        // Drop stale rows left over from older pushes (e.g. the removed
        // per-franchise catalogs, or the old "LeLibrary Collections" series
        // catalog) so they can't linger on Home.
        const manifestCatalogKeys = new Set(manifest.catalogs.map(c => `${manifest.id}_${c.type}_${c.id}`));
        for (const [key, item] of byKey) {
          if (item && item.addon_id === manifest.id && !manifestCatalogKeys.has(key) && item.is_collection !== true) {
            byKey.delete(key);
          }
        }

        // The manifest cannot express a native Nuvio collection's position.
        // Build the saved sequence from the same catOrder array that powers
        // the Home layout drag handles, then assign fresh consecutive order
        // values. This avoids ties with older Nuvio settings, which otherwise
        // leave collections at the bottom even when their stored order is 2.
        const configKeyForCatalog = (catalog) => {
          const id = String(catalog?.id || '');
          if (id === 'torbox-trending-movies') return 'trendingMovies';
          if (id === 'torbox-trending-series') return 'trendingSeries';
          if (id === 'torbox-popular-movies') return 'popularMovies';
          if (id === 'torbox-popular-series') return 'popularSeries';
          if (id.endsWith('-movies')) return 'movies';
          if (id.endsWith('-series')) return 'series';
          if (id.endsWith('-anime')) return 'anime';
          if (id.startsWith('torbox-watchlist-')) return 'watchlist';
          if (id.startsWith('lib-')) return 'library';
          if (id.startsWith('lelibrary-import-')) return 'imports';
          return '';
        };
        const managedByConfigKey = new Map();
        for (const catalog of manifest.catalogs) {
          const key = `${manifest.id}_${catalog.type}_${catalog.id}`;
          if (!managedKeys.has(key)) continue;
          const configKey = configKeyForCatalog(catalog);
          if (!configKey) continue;
          const group = managedByConfigKey.get(configKey) || [];
          group.push(key);
          managedByConfigKey.set(configKey, group);
        }
        const collectionKeysForConfigKey = (configKey) => {
          if (configKey === 'franchises') return [];
          if (String(configKey).startsWith('collectionPack:')) {
            const packId = String(configKey).slice('collectionPack:'.length);
            return Array.from(byKey.keys()).filter(key => key.startsWith(`collection_collection-lelibrary-pack-${packId}`));
          }
          if (String(configKey).startsWith('importedCollection:')) {
            const entry = importedCollectionEntries().find(item => item.key === configKey);
            const collectionId = String(entry?.collection?.id || '');
            return collectionId ? [`collection_${collectionId.startsWith('collection-imported-') ? collectionId : `collection-imported-${collectionId}`}`] : [];
          }
          return [];
        };
        const orderedManagedKeys = [];
        for (const configKey of catOrder) {
          for (const key of (managedByConfigKey.get(configKey) || [])) if (!orderedManagedKeys.includes(key)) orderedManagedKeys.push(key);
          for (const key of collectionKeysForConfigKey(configKey)) if (managedKeys.has(key) && !orderedManagedKeys.includes(key)) orderedManagedKeys.push(key);
        }
        // Older configs did not retain a collection slot. Keep those valid
        // collections visible, after the explicitly ordered entries.
        for (const key of managedKeys) if (!orderedManagedKeys.includes(key)) orderedManagedKeys.push(key);
        const franchiseKey = 'collection_collection-lelibrary-franchises';
        const hasFranchise = (collections || []).some(c => String(c?.id || '') === 'collection-lelibrary-franchises');
        if (hasFranchise) {
          const existingFranchise = byKey.get(franchiseKey) || {};
          byKey.set(franchiseKey, {
            ...existingFranchise,
            is_collection: true,
            collection_id: 'collection-lelibrary-franchises',
            enabled: true,
            custom_title: existingFranchise.custom_title || '',
            key: franchiseKey,
          });
        } else {
          byKey.delete(franchiseKey);
        }

        const existingKeys = items.map(canonicalHomeKey)
          .filter(key => key !== franchiseKey && byKey.has(key))
          .filter((key, index, all) => all.indexOf(key) === index);
        const remainingKeys = existingKeys.length
          ? existingKeys
          : Array.from(byKey.keys()).filter(key => key !== franchiseKey && !managedKeys.has(key))
            .sort((a, b) => (Number(byKey.get(a)?.order) || 0) - (Number(byKey.get(b)?.order) || 0));
        const finalKeys = [...remainingKeys, ...orderedManagedKeys.filter(key => key !== franchiseKey && !remainingKeys.includes(key))];
        if (byKey.has(franchiseKey)) {
          finalKeys.push(franchiseKey);
        }
        const orderedItems = finalKeys.map((key, index) => ({ ...byKey.get(key), key, order: index }));

        await nuvioRpc(token, '/rest/v1/rpc/sync_push_home_catalog_settings', {
          p_profile_id: profileId,
          p_platform: platform,
          p_settings_json: {
            show_catalog_type: settings.show_catalog_type !== false,
            hide_unreleased_content: settings.hide_unreleased_content === true,
            items: orderedItems,
          },
          p_origin_client_id: nuvioOriginClientId(),
        });
        console.log('[Push] Nuvio Home order synced to Edit Catalogues order');
      } catch (err) {
        console.warn('[Push] Could not sync Nuvio Home order:', err.message);
      }
    }

    // Apply the selected badge pack to the target Nuvio profile. Nuvio renders
    // badges from the profile's own badge settings, so pushing collections
    // alone leaves whichever pack was imported before. Only the badge rules
    // value is replaced; every other profile setting passes through untouched.
    // Best-effort: badge failures never fail the push.
    async function syncNuvioBadgePack(token, profileId) {
      try {
        const packs = (window.LeBadgePacks && window.LeBadgePacks.PACKS) || [];
        const cfg = getCurrentConfig();
        const pack = cfg.nuvioBadgePack || 'lelibrary-premium';
        const preset = packs.find(p => p.id === pack) || packs[0] || { id: 'lelibrary-premium', url: '/api/nuvio-badges/lelibrary-premium.json', local: true };
        let sourceUrl = '';
        if (pack === 'custom') {
          sourceUrl = String(cfg.nuvioBadgeUrl || '').trim();
        } else if (preset.local) {
          sourceUrl = new URL(preset.url, location.origin).href;
        } else {
          sourceUrl = preset.url || '';
        }
        try { const u = new URL(sourceUrl); if (!['http:', 'https:'].includes(u.protocol)) return; }
        catch { return; }
        // Route remote manifests through the SSRF-hardened JSON proxy so the
        // browser never fetches user-supplied hosts directly.
        const manifestUrl = preset.local || pack === 'custom' && new URL(sourceUrl).origin === location.origin
          ? sourceUrl
          : `/api/import-json?url=${encodeURIComponent(sourceUrl)}`;
        const manifestResponse = await fetch(manifestUrl, { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(20000) });
        if (!manifestResponse.ok) throw new Error(`Badge manifest unavailable (HTTP ${manifestResponse.status})`);
        const manifest = await manifestResponse.json();
        const filters = (Array.isArray(manifest?.filters) ? manifest.filters : [])
          .filter(f => f && typeof f === 'object' && String(f.pattern || '').trim() && String(f.imageURL || f.imageUrl || '').trim())
          .slice(0, 200)
          .map(f => {
            const out = {};
            for (const key of ['id', 'groupId', 'name', 'pattern', 'imageURL', 'imageUrl', 'isEnabled', 'tagColor', 'borderColor', 'tagStyle', 'textColor']) {
              if (f[key] === undefined) continue;
              out[key] = typeof f[key] === 'boolean' ? f[key] : String(f[key]).slice(0, 2000);
            }
            if (out.imageUrl && !out.imageURL) { out.imageURL = out.imageUrl; delete out.imageUrl; }
            if (out.isEnabled === undefined) out.isEnabled = true;
            return out;
          });
        if (!filters.length) throw new Error('That badge pack has no usable badges.');
        const groups = (Array.isArray(manifest?.groups) ? manifest.groups : [])
          .filter(g => g && typeof g === 'object').slice(0, 50)
          .map(g => {
            const out = {};
            for (const key of ['id', 'name', 'color', 'borderColor', 'tagColor']) {
              if (g[key] === undefined) continue;
              out[key] = String(g[key]).slice(0, 500);
            }
            return out;
          });
        const badgeImport = { sourceUrl, filters, groups, isActive: true };
        // TV and mobile apps sync separate settings blobs ('tv' vs 'mobile'):
        // write the pack to each one that exists so every app shows it.
        for (const badgePlatform of ['tv', 'mobile']) {
          try {
            const pulled = await nuvioRpc(token, '/rest/v1/rpc/sync_pull_profile_settings_blob', {
              p_profile_id: profileId,
              p_platform: badgePlatform,
            });
            const row = Array.isArray(pulled) ? pulled[0] : pulled;
            const blob = row?.settings_json;
            if (!blob || typeof blob !== 'object') continue;
            const next = JSON.parse(JSON.stringify(blob));
            next.features = next.features && typeof next.features === 'object' ? next.features : {};
            const badge = next.features.stream_badge_settings && typeof next.features.stream_badge_settings === 'object'
              ? next.features.stream_badge_settings : {};
            badge.stream_badge_rules = { type: 'string', value: JSON.stringify({ imports: [badgeImport] }) };
            next.features.stream_badge_settings = badge;
            await nuvioRpc(token, '/rest/v1/rpc/sync_push_profile_settings_blob', {
              p_profile_id: profileId,
              p_settings_json: next,
              p_platform: badgePlatform,
              p_origin_client_id: nuvioOriginClientId(),
            });
            console.log('[Push] Nuvio badge pack synced (' + badgePlatform + '):', sourceUrl);
          } catch (platformErr) {
            console.warn('[Push] Could not sync Nuvio badge pack (' + badgePlatform + '):', platformErr.message);
          }
        }
      } catch (err) {
        console.warn('[Push] Could not sync Nuvio badge pack:', err.message);
      }
    }

    // After restoring a saved session, quietly confirm the token still works.
    // If it's expired, drop back to the sign-in boxes so the user can reconnect.
    async function verifyRestoredConnect() {
      try {
        if (connectState.platform === 'nuvio' && connectState.nuvioToken) {
          if (connectState.nuvioRefresh) {
            try {
              const r = await fetch(`${NUVIO_API_BASE}/auth/v1/token?grant_type=refresh_token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: NUVIO_PUBLISHABLE_KEY },
                body: JSON.stringify({ refresh_token: connectState.nuvioRefresh }),
                signal: AbortSignal.timeout(20000),
              });
              const d = await r.json().catch(() => null);
              if (r.ok && d?.access_token) {
                connectState.nuvioToken = d.access_token;
                connectState.nuvioRefresh = d.refresh_token || connectState.nuvioRefresh;
              }
            } catch { /* keep existing token; validation below decides */ }
          }
          await loadNuvioProfiles();
        } else if (connectState.platform === 'stremio' && connectState.stremioAuth) {
          const data = await stremioCall('addonCollectionGet', { authKey: connectState.stremioAuth });
          if (!Array.isArray(data.result?.addons)) throw new Error('Session no longer valid');
        } else {
          throw new Error('Nothing to verify');
        }
        persistConnect();
        renderConnectAll();
      } catch {
        // Expired / invalid session: clear and ask them to sign in again
        connectState.platform = null;
        connectState.stremioAuth = null;
        connectState.nuvioToken = null;
        connectState.nuvioRefresh = null;
        clearPersistedConnect();
        renderConnectAll();
        showToast('Your saved session expired: sign in again', 'error');
      }
    }

    // ── Push catalogues (replaces all addons, with backup list) ──
    function ensureManifestUrl() {
      // Always rebuild from the CURRENT form state: never reuse a stale URL
      // from an earlier generate(), or ticking a catalogue after that would be
      // silently dropped from the pushed token. Uses the trimmed config so the
      // token stays under the server's 2048-char limit.
      const provider = document.getElementById('provider').value;
      if (!provider || provider === 'none') return null;
      try { return buildUrls(buildSavedConfig()); } catch { return null; }
    }

    function setSyncProgress(step) {
      document.querySelectorAll('#syncProgress [data-sync-step]').forEach((item) => {
        const n = Number(item.dataset.syncStep);
        item.classList.toggle('active', n === step);
        item.classList.toggle('done', n < step);
      });
    }

    // Show the replaced addons with their names (fetched from each manifest when
    // not already known) plus a per-row Copy button for the manifest URL.
    async function renderBackupList(entries) {
      const box = document.getElementById('backupList');
      document.getElementById('pushResultCard').style.display = 'block';
      const items = (entries || []).map(e => typeof e === 'string' ? { url: e, name: '' } : e);
      if (items.length === 0) {
        box.innerHTML = '<div class="bl-empty">No previous addons found.</div>';
        return;
      }
      box.innerHTML = '<div class="bl-empty">Loading addon names…</div>';
      // Best-effort: fetch each addon's manifest for its name (parallel, short timeout)
      await Promise.all(items.map(async it => {
        if (it.name || !it.url || !/^https?:\/\//.test(it.url)) return;
        try {
          const r = await fetch(it.url, { signal: AbortSignal.timeout(6000) });
          const m = await r.json();
          if (m && (m.name || m.id)) it.name = m.name || m.id;
        } catch { /* keep url only */ }
      }));
      window.__backupUrls = items.map(it => it.url);
      box.innerHTML = items.map((it, i) => `
        <div class="bl-item">
          <div class="bl-top">
            <span class="bl-name" title="${escHtml(it.url)}">${escHtml(it.name || ('Addon ' + (i + 1)))}</span>
            <button class="btn-copy-url" type="button" onclick="copyBackupUrl(this, ${i})">Copy</button>
          </div>
          <div class="bl-url">${escHtml(it.url)}</div>
        </div>`).join('');
    }

    function copyBackupUrl(btn, i) {
      const url = (window.__backupUrls || [])[i];
      if (!url) return;
      copyText(url, 'Manifest URL copied!');
      flashCopied(btn);
    }

    async function pushAccountTokenCatalogues() {
      const tokenId = currentToken();
      const platform = connectState.platform;
      if (!tokenId || !platform) {
        showToast('Connect the selected platform in Account Settings first.', 'error');
        return;
      }
      const btn = document.getElementById('btnPushCatalogues');
      const label = document.getElementById('pushCataloguesLabel');
      const small = document.getElementById('pushCataloguesSmall');
      const status = document.getElementById('pushCataloguesStatus');
      const originalLabel = label?.textContent;
      const originalSmall = small?.textContent;
      if (btn) btn.disabled = true;
      try {
        if (hasUnsavedConfigChanges()) {
          if (label) label.textContent = 'Saving config…';
          if (small) small.textContent = 'Saving your latest changes before install';
          await saveConfigToServer(buildSavedConfig(), { wait: true });
          initialConfig = getCurrentConfig();
          clearDraft();
          const banner = document.getElementById('unsavedBanner');
          if (banner) banner.style.display = 'none';
          const saveButton = document.getElementById('btnGenerate');
          if (saveButton && hasExistingToken) saveButton.style.display = 'none';
        }
        if (label) label.textContent = 'Installing…';
        if (small) small.textContent = `Using your saved ${platform === 'nuvio' ? 'Nuvio' : 'Stremio'} connection`;
        const meResponse = await fetch('/api/account/me', { credentials: 'same-origin', cache: 'no-store' });
        const me = meResponse.ok ? await meResponse.json() : null;
        if (!me?.csrfToken) {
          showToast('Sign in to your LeLibrary account to install this saved token.', 'error');
          return;
        }
        const profileId = platform === 'nuvio' ? connectState.nuvioSelectedProfile : null;
        const response = await fetch(`/api/account/tokens/${encodeURIComponent(tokenId)}/install`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrfToken },
          credentials: 'same-origin',
          body: JSON.stringify({ platform, ...(profileId ? { profile_id: profileId } : {}) }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok) throw new Error(data?.detail || data?.error || 'Install failed');
        setSyncProgress(6);
        if (status) {
          status.style.color = 'var(--success)';
          status.textContent = `Installed to ${platform === 'nuvio' ? 'Nuvio' : 'Stremio'} using your saved account connection.`;
        }
        showToast(`Pushed to ${platform === 'nuvio' ? 'Nuvio' : 'Stremio'} ✓`, 'success');
      } catch (error) {
        showToast(`Push failed: ${error?.message || 'network error'}`, 'error');
      } finally {
        if (btn) btn.disabled = false;
        if (label) label.textContent = hasUnsavedConfigChanges()
          ? (originalLabel || `Save & Push to ${platform === 'nuvio' ? 'Nuvio' : 'Stremio'}`)
          : `Push to ${platform === 'nuvio' ? 'Nuvio' : 'Stremio'}`;
        if (small) small.textContent = hasUnsavedConfigChanges()
          ? (originalSmall || 'Saves your changes first, then installs LeLibrary')
          : 'Adds or updates LeLibrary and keeps your other addons';
      }
    }

    async function pushCatalogues() {
      if (ACCOUNT_TOKEN) return pushAccountTokenCatalogues();
      // Use the Install-step tab if present, otherwise fall back to the global platform.
      // This lets Step 7 push to Stremio even if Step 1 was set to Nuvio, without wiping Nuvio creds.
      const tabPlat = (function(){
        const tabs=document.getElementById('installPlatformTabs');
        const active=tabs?.querySelector('.ptab.active');
        const attr=active?.dataset?.plat;
        if(attr==='stremio'||attr==='nuvio') return attr;
        // No tab yet — fall back to the selected platform
        return targetPlatform();
      })();
      const platform = tabPlat || connectState.platform;
      if (!platform) { showToast('Sign in to Stremio or Nuvio first'); return; }
      // Temporarily use the tab's platform for this push so we don't clobber the other login
      const prevPlatform = connectState.platform;
      connectState.platform = platform;
      if (!setupComplete()) {
        updateCataloguesUI();
        showToast('Complete the Setup tab first: providers and a TMDB key are needed', 'error');
        document.getElementById('setupGuard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      const importedDependencies = [...new Set(importedRows.flatMap(importedExternalDependencies))];
      if (importedDependencies.length) {
        showToast(`Imported folders reference external addons: ${importedDependencies.map(importedDependencyName).join(', ')}. Make sure they are installed in this profile.`, 'warning');
      }
      const btn = document.getElementById('btnPushCatalogues');
      const label = document.getElementById('pushCataloguesLabel');
      const small = document.getElementById('pushCataloguesSmall');
      const status = document.getElementById('pushCataloguesStatus');
      const origLabel = label.textContent;
      const origSmall = small.textContent;
      btn.disabled = true;

      // 1) Save the config: build the token URL from the current form (pushing
      //    always saves, even if the user never pressed "Save").
      setSyncProgress(1);
      const saveNeeded = hasUnsavedConfigChanges();
      label.textContent = saveNeeded ? 'Saving config…' : 'Preparing install…';
      small.textContent = saveNeeded ? 'Saving your latest changes before install' : 'Building your configuration';
      await new Promise(r => setTimeout(r, 400));
      const urls = ensureManifestUrl();
      if (!urls) {
        btn.disabled = false;
        label.textContent = origLabel;
        small.textContent = origSmall;
        showToast('Fill in your providers and keys on the Setup tab first');
        return;
      }
      try {
        // Await persistence before changing the URL or making platform calls.
        // This is essential for short account tokens, whose manifest reads its
        // configuration from the server rather than the URL.
        await saveConfigToServer(buildSavedConfig(), { wait: true });
      } catch (err) {
        btn.disabled = false;
        label.textContent = origLabel;
        small.textContent = origSmall;
        showToast(`Could not save your configuration, so nothing was pushed: ${err?.message || 'network error'}`, 'error');
        return;
      }
      // Point the address bar at the freshly-saved token so a refresh keeps it.
      try { history.replaceState(null, '', `${window.location.origin}${configurePath(urls.encoded)}`); } catch {}
      setSyncProgress(2);
      // The push saved the config: the in-progress draft is no longer needed.
      clearDraft();

      // 2) Push to the platform.
      label.textContent = 'Now pushing…';
      small.textContent = 'Installing LeLibrary on your ' + (connectState.platform === 'stremio' ? 'Stremio' : 'Nuvio') + ' account';
      await new Promise(r => setTimeout(r, 400));

      try {
        // Warm the collections build BEFORE the addon is installed. The folders'
        // contents need to exist: otherwise Nuvio folders show "No Items Found".
        // The collections.json route builds synchronously when empty.
        small.textContent = 'Building your catalogues…';
        let warmedCollections = null;
        try {
          warmedCollections = await fetch(urls.collectionsUrl, { signal: AbortSignal.timeout(60000) }).then(r => r.json());
        } catch { /* keep going: the addon still installs even if the build is slow */ }

        if (connectState.platform === 'stremio') {
          // Collection packs are Nuvio-native. Mark this install explicitly so
          // the manifest never adds their supporting lib rows to Stremio.
          const stremioManifestUrl = `${urls.manifestUrl}${urls.manifestUrl.includes('?') ? '&' : '?'}integration=stremio`;
          small.textContent = 'Reading your current addons…';
          const getData = await stremioCall('addonCollectionGet', { authKey: connectState.stremioAuth });
          const addons = Array.isArray(getData.result?.addons) ? getData.result.addons : [];
          const backup = addons.map(a => ({ url: a.transportUrl, name: (a.manifest && a.manifest.name) || '' })).filter(b => b.url);
          small.textContent = 'Installing LeLibrary…';
          const manifest = await fetch(stremioManifestUrl, { signal: AbortSignal.timeout(10000) }).then(r => r.json());
          const descriptor = { transportUrl: stremioManifestUrl, transportName: 'http', flags: {}, manifest };
          // Upsert: keep every addon, replace only a previous LeLibrary entry.
          const ours = addons.filter(a => (a.manifest?.id || a.id) !== manifest.id);
          ours.push(descriptor);
          // Stremio owns Home rows at addon level. For a URL-based manifest
          // import, install the source addon alongside LeLibrary so its rows
          // can actually appear; pasted JSON without a source URL is Nuvio-
          // only because Stremio has no native collection/home-row RPC.
          for (const source of importedRows) {
            if (!source.sourceUrl || source.sourceUrl === 'pasted-json') continue;
            try {
              const importedManifest = await fetch(`/api/import-json?url=${encodeURIComponent(source.sourceUrl)}`, { signal: AbortSignal.timeout(15000) }).then(r => r.json());
              if (!importedManifest?.id || ours.some(addon => (addon.manifest?.id || addon.id) === importedManifest.id)) continue;
              ours.push({ transportUrl: source.sourceUrl, transportName: 'http', flags: {}, manifest: importedManifest });
            } catch (err) { console.warn('[Push] Could not add imported Stremio addon:', err.message); }
          }
          await stremioCall('addonCollectionSet', { authKey: connectState.stremioAuth, addons: ours });
          setSyncProgress(3);
          status.style.color = 'var(--success)';
          status.textContent = 'Installed: all your addons kept and catalogues imported. Please refresh Stremio.';
          renderBackupList(backup);
        } else {
          const profileIndex = parseInt(document.getElementById('cataloguesProfile').value, 10);
          if (!Number.isFinite(profileIndex) || profileIndex < 1) { showToast('Select a Nuvio profile first'); return; }
          const profile = connectState.nuvioProfiles.find(p => p.profile_index === profileIndex) || {};
          small.textContent = 'Preparing your profile…';
          // If the profile shares the primary profile's addons, switch it to its
          // own addons FIRST: otherwise the addon we push lands on the primary
          // profile and Nuvio reports "addon not found" on this profile's collections.
          if (profile.uses_primary_addons) {
            try {
              const profData = await nuvioRpc(connectState.nuvioToken, '/rest/v1/rpc/sync_pull_profiles', {});
              const rawProfiles = Array.isArray(profData) ? profData : (profData?.profiles || []);
              const pushed = rawProfiles.map(p => {
                const idx = Math.trunc(Number(p.profile_index ?? p.id));
                const isTarget = idx === profileIndex;
                return {
                  profile_index: idx,
                  name: String(p.name || '').trim() || `Profile ${idx}`,
                  avatar_color_hex: String(p.avatar_color_hex || p.avatarColorHex || '').trim() || '#1E88E5',
                  uses_primary_addons: isTarget ? false : !!(p.uses_primary_addons ?? p.usesPrimaryAddons),
                  uses_primary_plugins: !!(p.uses_primary_plugins ?? p.usesPrimaryPlugins),
                  avatar_id: p.avatar_url ? null : (p.avatar_id || null),
                  avatar_url: p.avatar_url || null,
                };
              });
              await nuvioRpc(connectState.nuvioToken, '/rest/v1/rpc/sync_push_profiles', {
                p_profiles: pushed,
                p_origin_client_id: nuvioOriginClientId(),
              });
              console.log('[Push] Profile switched to own addons');
              connectState.nuvioProfiles = connectState.nuvioProfiles.map(p =>
                p.profile_index === profileIndex ? { ...p, uses_primary_addons: false } : p);
            } catch (err) {
              console.warn('[Push] Profile switch failed (continuing):', err.message);
            }
          }
          small.textContent = 'Reading your current addons…';
          const ownerData = await nuvioRpc(connectState.nuvioToken, '/rest/v1/rpc/get_sync_owner', {});
          const ownerId = Array.isArray(ownerData) && typeof ownerData[0] === 'string' ? ownerData[0]
            : (typeof ownerData === 'string' ? ownerData : ownerData?.owner_id || ownerData?.id);
          if (!ownerId) throw new Error('Could not resolve the Nuvio sync owner');
          const existing = await nuvioRest(connectState.nuvioToken,
            `/rest/v1/addons?select=*&user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileIndex}`);
          const list = Array.isArray(existing) ? existing : [];
          const backup = list.map(a => ({ url: a.url, name: a.name || '' })).filter(b => b.url);
          small.textContent = 'Installing LeLibrary…';
          // Upsert: keep every addon, remove only a previous LeLibrary row.
          for (const a of list) {
            const isOurs = String(a.url || '').includes('/manifest.json') &&
              String(a.url || '').startsWith(window.location.origin);
            if (!isOurs && String(a.name || '').toLowerCase() !== 'lelibrary') continue;
            await nuvioRest(connectState.nuvioToken,
              `/rest/v1/addons?id=eq.${encodeURIComponent(a.id)}&profile_id=eq.${profileIndex}`,
              { method: 'DELETE' });
          }
          // Nuvio caches manifests by URL. Give each Nuvio push a fresh URL so
          // retired hidden backing catalogues cannot remain visible on Home.
          const nuvioManifestUrl = `${urls.manifestUrl}${urls.manifestUrl.includes('?') ? '&' : '?'}sync=${Date.now().toString(36)}`;
          console.log('[Push] Manifest URL length:', nuvioManifestUrl.length);
          const addRes = await nuvioRest(connectState.nuvioToken, '/rest/v1/addons', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: [{ user_id: ownerId, profile_id: profileIndex, url: nuvioManifestUrl, name: 'LeLibrary', enabled: true, sort_order: 0 }],
          });
          console.log('[Push] Addon add response:', JSON.stringify(addRes));
          // Verify the addon is registered on this profile; retry once if not
          let afterAdd = await nuvioRest(connectState.nuvioToken,
            `/rest/v1/addons?select=*&user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileIndex}`);
          let found = (afterAdd || []).some(a => String(a.url) === nuvioManifestUrl);
          if (!found) {
            console.warn('[Push] Addon missing after first add: retrying…');
            await nuvioRest(connectState.nuvioToken, '/rest/v1/addons', {
              method: 'POST',
              headers: { Prefer: 'return=representation' },
              body: [{ user_id: ownerId, profile_id: profileIndex, url: nuvioManifestUrl, name: 'LeLibrary', enabled: true, sort_order: 0 }],
            });
            afterAdd = await nuvioRest(connectState.nuvioToken,
              `/rest/v1/addons?select=*&user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileIndex}`);
            found = (afterAdd || []).some(a => String(a.url) === nuvioManifestUrl);
          }
          console.log('[Push] Addons on profile after add:', JSON.stringify((afterAdd || []).map(a => ({ name: a.name, url: a.url }))));
          if (!found) {
            throw new Error('LeLibrary could not be registered on this Nuvio profile. Try selecting a different profile, then push again.');
          }
          setSyncProgress(3);
          // Give Nuvio a moment to process the new addon before pushing collections
          await new Promise(r => setTimeout(r, 1500));
          let manifestForNuvio = null;
          try {
            manifestForNuvio = await fetch(nuvioManifestUrl, { signal: AbortSignal.timeout(10000) }).then(r => r.json());
          } catch (err) {
            console.warn('[Push] Could not fetch the Nuvio manifest:', err.message);
          }
          if (catSelection.franchises || nuvioCollectionPacks.length || importedRows.some(source => (source.collections || []).length)) {
            setSyncProgress(4);
            small.textContent = 'Importing your LeLibrary Collections…';
            const collections = Array.isArray(warmedCollections) ? warmedCollections : [];
            if (Array.isArray(collections) && collections.length > 0) {
              // Preserve other collections on this profile. Replace only the
              // LeLibrary group, rather than overwriting the user's collection set.
              const pulledCollections = await nuvioRpc(connectState.nuvioToken, '/rest/v1/rpc/sync_pull_collections', {
                p_profile_id: profileIndex,
              });
              const remoteRow = Array.isArray(pulledCollections) ? pulledCollections[0] : pulledCollections;
              let existingCollections = remoteRow?.collections_json;
              if (typeof existingCollections === 'string') {
                try { existingCollections = JSON.parse(existingCollections); } catch { existingCollections = []; }
              }
              if (!Array.isArray(existingCollections)) existingCollections = [];
              // sync_push_collections replaces the whole blob. Replace each
              // LeLibrary object at its current array slot and append only a
              // genuinely new one: rebuilding a library must never move the
              // user's existing Collections order or mutate unrelated JSON.
              const generatedById = new Map(collections
                .filter(collection => collection && collection.id)
                .map(collection => [String(collection.id), collection]));
              const franchiseId = 'collection-lelibrary-franchises';
              const mergedCollections = [];
              for (const collection of existingCollections) {
                const id = String(collection?.id || '');
                if (id === franchiseId && generatedById.has(id)) {
                  // Franchise is always forced to the very bottom
                  continue;
                }
                if (generatedById.has(id)) {
                  mergedCollections.push(generatedById.get(id));
                  generatedById.delete(id);
                } else {
                  mergedCollections.push(collection);
                }
              }
              const remaining = [...generatedById.values()];
              const franchise = remaining.find(c => String(c?.id) === franchiseId);
              const others = remaining.filter(c => String(c?.id) !== franchiseId);
              mergedCollections.push(...others, ...(franchise ? [{ ...franchise, pinToTop: false }] : []));
              await nuvioRpc(connectState.nuvioToken, '/rest/v1/rpc/sync_push_collections', {
                p_profile_id: profileIndex,
                p_collections_json: mergedCollections,
                p_origin_client_id: nuvioOriginClientId(),
              });
              // Clean stale LeLibrary collections from every other profile so
              // the "LeLibrary Collections" collection only lives on the profile
              // the user just pushed to. Profiles that use the primary profile's
              // addons still read their own per-profile collections, so this
              // respects the "Use primary addons" toggle. Home-row cleanup is
              // also done when the manifest is available (best effort).
              await Promise.all(connectState.nuvioProfiles
                .filter(p => p.profile_index !== profileIndex)
                .map(p => removeLeLibraryFromNuvioProfile(connectState.nuvioToken, p.profile_index, manifestForNuvio)));
              setSyncProgress(5);
              status.style.color = 'var(--success)';
              status.textContent = 'Installed: collections imported. New films appear automatically; a brand-new franchise just needs one more quick re-push to add its folder. Please refresh Nuvio.';
            } else {
              status.style.color = 'var(--success)';
              status.textContent = 'Installed. Your catalogues will appear once your library has been scanned.';
            }
          } else {
            status.style.color = 'var(--success)';
            status.textContent = 'Installed: all catalogues have been imported. Please refresh Nuvio.';
          }
          // Sync Nuvio's Home row order to the Edit Catalogues order (and drop
          // stale/disabled LeLibrary rows) regardless of the franchises toggle.
          if (manifestForNuvio) {
            await syncNuvioHomeOrder(connectState.nuvioToken, profileIndex, manifestForNuvio, importedRows, warmedCollections);
          }
          // Apply the selected badge pack to this profile as well, so Nuvio
          // shows the pack chosen here instead of a previously imported one.
          await syncNuvioBadgePack(connectState.nuvioToken, profileIndex);
          setSyncProgress(5);
          renderBackupList(backup);
        }
        // The push saved the config: clear the "unsaved changes" state so the
        // Save button and warning disappear (no point asking again). It returns
        // automatically if the user edits something else.
        initialConfig = getCurrentConfig();
        document.getElementById('unsavedBanner').style.display = 'none';
        document.getElementById('btnGenerate').style.display = 'none';
        setSyncProgress(6);
        const pushToast = connectState.platform === 'stremio'
          ? 'Pushed to Stremio ✓ New franchise rows appear automatically'
          : 'Pushed to Nuvio ✓ Re-push once when you add a brand-new franchise';
        showToast(pushToast, 'success');
      } catch (err) {
        if (/session does not exist|invalid.*token|expired|jwt/i.test(err.message)) {
          showToast('Session expired: reconnect', 'error');
          disconnectConnect();
        } else if (/descriptor|too large/i.test(err.message)) {
          showToast('Stremio rejected the addon (descriptor too large?)', 'error');
        } else {
          showToast('Push failed: ' + (err.message || 'network error'), 'error');
        }
      } finally {
        btn.disabled = false;
        label.textContent = origLabel;
        small.textContent = origSmall;
        // Restore the previous platform if we temporarily switched for the tab push
        if (typeof prevPlatform !== 'undefined' && prevPlatform !== platform) {
          connectState.platform = prevPlatform;
          persistConnect();
          renderPlatformStep();
          renderConnectAll();
        }
      }
    }

    // ── Install-section "Push to X" buttons ────────────────────────────────
    // The Install-step push button pushes to the chosen platform, reusing the
    // same pushCatalogues() flow as the Catalogues tab. If the platform isn't
    // connected, point the user at the sign-in boxes (focused on that platform).
    async function pushAddonTo(platform) {
      connectState.selectedPlatform = (platform === 'nuvio' || platform === 'stremio') ? platform : null;
      persistConnect();
      renderPlatformStep();
      const plat = platform === 'nuvio' ? 'Nuvio' : 'Stremio';
      if (connectState.platform !== platform) {
        goToStep(7); // the sign-in boxes live in the Install panel (panel-7)
        showToast(`Connect ${plat} first, then push`, 'error');
        return;
      }
      goToStep(7); // renders the push panel before pushCatalogues() reads it
      await pushCatalogues();
    }

    // The "You haven't connected {platform}. Sign in…" note only shows next to
    // the manual buttons while no platform is connected but one is chosen.
    function updateInstallPushHint() {
      const hint = document.getElementById('pushNotConnectedHint');
      if (!hint) return;
      const hasToken = !!(connectState.nuvioToken || connectState.stremioAuth);
      // Intermediate Nuvio state (token but no platform yet) is handled inside renderInstallPush with a profile picker; don't show the generic hint
      hint.style.display = (!connectState.platform && targetPlatform() && !hasToken) ? '' : 'none';
    }

    // ── Stream formatter ───────────────────────────────────────────────────
    // Presets and template engine come from /formatter.js (window.LeFormatter),
    // the same engine the addon uses server-side.
    const FMT = (typeof window !== 'undefined' && window.LeFormatter) || null;
    function mountBadgePicker(pack, url) {
      const target = document.getElementById('badgePackPicker');
      if (!target || !window.LeBadgePacks) return;
      window._badgePicker = window.LeBadgePacks.mount(target, { pack, url, onChange: () => { updateStreamPreview(); checkChanged(); }, onPreviewChange: updateStreamPreview });
    }

    const PRESET_LABELS = {
      lelibrary: 'LeLibrary', torrentio: 'Torrentio', torbox: 'Torbox',
      gdrive: 'Google Drive', lightgdrive: 'Light GDrive',
      minimalisticgdrive: 'Minimalistic GDrive', prism: 'Prism', tamtaro: 'Tamtaro',
      cinema: 'Cinema cards', remux: 'Premium REMUX', compact: 'Clean compact', technical: 'Technical detail',
    };

    function onStreamPresetChange() {
      const preset = document.getElementById('streamPreset').value;
      if (preset === 'custom') {
        // Start Custom with empty boxes, not the previous preset.
        document.getElementById('streamNameTemplate').value = '';
        document.getElementById('streamDescTemplate').value = '';
      } else if (FMT && FMT.presets[preset]) {
        document.getElementById('streamNameTemplate').value = FMT.presets[preset].name;
        document.getElementById('streamDescTemplate').value = FMT.presets[preset].description;
      }
      updateStreamPreview();
      checkChanged();
    }

    function updateStreamPreview() {
      let nameT = document.getElementById('streamNameTemplate').value;
      let descT = document.getElementById('streamDescTemplate').value;
      const el = document.getElementById('streamPreview');
      if (!FMT) {
        el.innerHTML = '<span style="color:var(--muted)">Formatter engine failed to load: hard refresh to retry</span>';
        return;
      }
      // The LeLibrary preset is the default and intentionally carries no config,
      // so when the boxes are empty the preview should still show it.
      if (!nameT && !descT) {
        nameT = (FMT.presets.lelibrary || {}).name || '';
        descT = (FMT.presets.lelibrary || {}).description || '';
      }
      // Sample stream for the live preview. The textareas hold the selected
      // preset's (or custom) templates, so the preview reflects the choice.
      const ctx = FMT.buildLeContext('Toy.Story.2.1999.2160p.BluRay.HEVC.TrueHD.7.1.Atmos-FRDS', 'torbox', 2630000000);
      const name = FMT.render(nameT, ctx);
      const desc = FMT.render(descT, ctx);
      const badgeChoice = window._badgePicker?.get() || { pack: 'lelibrary-premium', url: '' };
      const badges = window.LeBadgePacks?.previewHtml(badgeChoice.pack, badgeChoice.url) || '';
      el.innerHTML = '<div style="color:var(--white);font-weight:600;margin-bottom:6px;white-space:pre-line">' + escHtml(name) + '</div>'
        + '<div style="color:var(--muted);white-space:pre-line;font-size:0.78rem">' + escHtml(desc) + '</div>' + badges;
    }

    // ── Provider status pill (topbar) ──────────────────────────────────────
    function statusClass(s) {
      return s === 'operational' ? 'op' : s === 'degraded' ? 'deg' : s === 'down' ? 'down' : 'unknown';
    }
    function statusLabel(s) {
      return s === 'operational' ? 'Operational' : s === 'degraded' ? 'Degraded' : s === 'down' ? 'Down' : 'Unknown';
    }
    function renderStatusPill(data) {
      const pills = document.querySelectorAll('.status-pill');
      if (!pills.length) return;
      const cls = data ? statusClass(data.overall) : 'unknown';
      const total = data && Array.isArray(data.providers) ? data.providers.length : 4;
      const up = data && Array.isArray(data.providers) ? data.providers.filter(p => p.status === 'operational').length : 0;
      pills.forEach(pill => {
        pill.classList.remove('op', 'deg', 'down', 'unknown');
        pill.classList.add(cls);
        const c = pill.querySelector('.status-pill-count');
        if (c) c.textContent = data ? `${up}/${total}` : '\u2013';
        pill.title = data && Array.isArray(data.providers)
          ? data.providers.map(p => `${p.name}: ${statusLabel(p.status)}`).join(' \u00b7 ')
          : 'Provider status';
      });
    }
    async function loadStatusPill() {
      try {
        const r = await fetch('/api/status', { signal: AbortSignal.timeout(15000), cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        window._lelibraryStatus = data;
        renderStatusPill(data);
      } catch (e) {
        renderStatusPill(null);
      }
    }

    // ── Watchlists for Step 3 ────────────────────────────────────────────
    window.onWatchlistKeyChange = function() {
      clearTimeout(window._watchlistKeyTimer);
      window._watchlistKeyTimer = setTimeout(() => loadWatchlistsForConfigure(), 400);
    };
    async function loadWatchlistsForConfigure() {
      const wrap = document.getElementById('watchlistRowsStep3') || document.getElementById('watchlistRowsStep7') || document.getElementById('watchlistRowsConfigure');
      if (!wrap) return;
      const targetId = wrap.id;
      // Use shared util if available (with SVGs and server fetch)
      if (window.WatchlistShared && window.WatchlistShared.renderWatchlistSection) {
        try {
          await window.WatchlistShared.renderWatchlistSection(targetId, { showAddButton: false });
          // Also wire up MDBList key input to refresh
          const mdblistInput = document.getElementById('mdblistKey');
          if (mdblistInput && !mdblistInput._watchlistListener) {
            mdblistInput.addEventListener('input', () => {
              clearTimeout(mdblistInput._watchlistTimer);
              mdblistInput._watchlistTimer = setTimeout(() => loadWatchlistsForConfigure(), 500);
            });
            mdblistInput._watchlistListener = true;
          }
          return;
        } catch {}
      }
      // Fallback to old logic
      const prompt = document.getElementById('watchlistConnectPrompt');
      const isAccount = !!window.ACCOUNT_TOKEN;
      const mdblistKey = (document.getElementById('rpdbKey')?.value || document.getElementById('mdblistKey')?.value || '').trim();
      if (!isAccount) {
        const hasMdbKey = !!(document.getElementById('mdblistKey')?.value.trim() || document.getElementById('rpdbKey')?.value.trim());
        if (!hasMdbKey) {
          wrap.innerHTML = '<div class="field-hint">No watchlists connected yet.</div>';
          if (prompt) prompt.style.display = 'block';
          return;
        }
      }
      if (prompt) prompt.style.display = 'none';
      try {
        let watchlists = [];
        if (isAccount) {
          const [simkl, trakt, caps] = await Promise.all([
            fetch('/api/account/watchlist/simkl', { cache: 'no-store' }).then(r => r.json().catch(() => ({}))).catch(() => ({})),
            fetch('/api/account/watchlist/trakt', { cache: 'no-store' }).then(r => r.json().catch(() => ({}))).catch(() => ({})),
            fetch('/api/account/watchlist-capabilities', { cache: 'no-store' }).then(r => r.json().catch(() => ({}))).catch(() => ({}))
          ]);
          const simklOn = !!(simkl && simkl.connected);
          const traktOn = !!(trakt && trakt.connected);
          const traktEnabled = !!(caps && caps.traktEnabled);
          const mdblistOn = !!(caps && caps.mdblistKey) || !!mdblistKey;
          if (simklOn) watchlists.push({ id: 'simkl', name: 'Simkl Watchlist', icon: '🎬', desc: 'Your Simkl watchlist as Home Rows', available: true });
          if (traktOn) watchlists.push({ id: 'trakt', name: 'Trakt Watchlist', icon: '🎬', desc: traktEnabled ? 'Your Trakt watchlist as Home Rows' : 'Trakt connected (best-effort, no VIP)', available: true });
          if (mdblistOn) watchlists.push({ id: 'mdblist', name: 'MDBList Watchlist', icon: '🎯', desc: 'Your MDBList watchlist as Home Rows', available: true });
          if (!watchlists.length) {
            wrap.innerHTML = '<div class="field-hint">No watchlists connected. Connect in <a href="/account/settings">Account → Watchlists</a> or add an MDBList key below.</div>';
            if (!isAccount && prompt) prompt.style.display = 'block';
            return;
          }
        } else {
          // Self-hosted / normal configure without account: check for MDBList key in form
          const hasMdb = !!mdblistKey;
          if (hasMdb) watchlists.push({ id: 'mdblist', name: 'MDBList Watchlist', icon: '🎯', desc: 'MDBList watchlist (key in form) as Home Rows', available: true });
          else {
            wrap.innerHTML = '<div class="field-hint">No watchlists yet. Add an MDBList key to enable one.</div>';
            if (prompt) prompt.style.display = 'block';
            return;
          }
        }
        wrap.innerHTML = watchlists.map(w => {
          const catIdMovie = `torbox-watchlist-${w.id}-movie`;
          const catIdSeries = `torbox-watchlist-${w.id}-series`;
          const hasMovie = libraryCatalogs.includes(catIdMovie) || libraryCatalogs.includes(`lib-${catIdMovie}`);
          const hasSeries = libraryCatalogs.includes(catIdSeries) || libraryCatalogs.includes(`lib-${catIdSeries}`);
          const allAdded = hasMovie && hasSeries;
          return `<div class="cg-row" style="padding:10px 12px"><span style="font-size:1.1rem">${w.icon}</span><div class="cg-row-name">${escHtml(w.name)}<span class="cg-row-desc">${escHtml(w.desc)}</span></div><button type="button" class="${allAdded ? 'btn-copy-url' : 'btn-main btn-gen'}" style="padding:6px 12px; font-size:0.78rem" onclick="addWatchlistRows('${w.id}')" ${allAdded ? 'disabled' : ''}>${allAdded ? 'Added' : 'Add to My Rows'}</button></div>`;
        }).join('');
      } catch (e) {
        wrap.innerHTML = '<div class="field-hint" style="color:var(--error)">Could not load watchlists.</div>';
      }
    }

    function addWatchlistRows(service) {
      const ids = service === 'mdblist'
        ? ['torbox-watchlist-mdblist-movie', 'torbox-watchlist-mdblist-series']
        : service === 'simkl'
        ? ['torbox-watchlist-simkl-movie', 'torbox-watchlist-simkl-series']
        : ['torbox-watchlist-trakt-movie', 'torbox-watchlist-trakt-series'];
      let added = 0;
      for (const id of ids) {
        // Library rows for watchlists use the full catalog id (with lib- prefix handling in render)
        const libId = id;
        if (!libraryCatalogs.includes(libId) && !libraryCatalogs.includes(`lib-${libId}`)) {
          // Try both forms: the watchlist rows use the raw torbox-watchlist-* id, not lib-*
          // Check if a lib-* variant exists, otherwise use raw
          const def = (libCatalogDefs || []).find(c => c.id === libId);
          if (def) { libraryCatalogs.push(libId); added++; }
          else if (!libraryCatalogs.includes(id)) { libraryCatalogs.push(id); added++; }
        }
      }
      if (added === 0) showToast('Watchlist rows are already in My Rows', 'info');
      else showToast(`Added ${added} watchlist row${added === 1 ? '' : 's'}: find them in My Rows`, 'success');
      renderLibraryGroups(); renderCataloguesOptions(); checkChanged();
      const acc = document.getElementById('yourRowsAccordion'); if (acc && !acc.open) acc.open = true;
      document.getElementById('catalogueList')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ── Step completion tracking ───────────────────────────────────────────
    const completedSteps = new Set();
    const originalGoToStep = goToStep;
    goToStep = function(n) {
      if (n > currentStep && currentStep >= 1) completedSteps.add(currentStep);
      originalGoToStep(n);
      // Mark completed step buttons green
      for (const s of completedSteps) {
        const btn = document.querySelector('.step-btn[data-step="' + s + '"]');
        if (btn) btn.classList.add('verified');
      }
      // Color connector lines: line between step i and i+1 is green if step i is verified
      const lines = document.querySelectorAll('.step-dot-line');
      lines.forEach((line, idx) => {
        const stepBtn = document.querySelector('.step-btn[data-step="' + (idx + 1) + '"]');
        line.classList.toggle('done', stepBtn && stepBtn.classList.contains('verified'));
      });
      // Explain the account-first watchlist flow in setup. Rows are only
      // shown for an account token, because that is what owns the connection.
      if (n === 3) updateWatchlistAccountCta();
      if (n === 5 && ACCOUNT_TOKEN) {
        connectedWatchlists = null;
        loadConnectedWatchlists(true);
      }
    };
