    function toggleVis(id, btn) {
      const el = document.getElementById(id);
      const isPass = el.type === 'password';
      el.type = isPass ? 'text' : 'password';
      btn.textContent = isPass ? '🙈' : '👁';
    }

    function encodeConfig(cfg) {
      // Compact token format (short field names, packed arrays, defaults
      // dropped) — the server maps it back on decode. See token-map.js.
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
      const encoded      = encodeConfig(cfg);
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
      const t = window.location.pathname.split('/')[1];
      return t && t !== 'configure' ? t : '';
    }

    function snapshotConfig() {
      // getCurrentConfig() carries the whole form (incl. the server-side-only
      // stream settings + filter chips) so a restored draft looks exactly like
      // what the user left.
      return getCurrentConfig();
    }

    function saveDraft() {
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
        } catch { /* storage unavailable / full — non-fatal */ }
      }, 400);
    }

    function loadDraft(expectedToken) {
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
      if (cfg.hideAnime) {
        document.getElementById('hideAnime').checked = true;
      }
      if (cfg.pinCollections) {
        if (document.getElementById('pinCollections')) document.getElementById('pinCollections').checked = true;
      }
      if (cfg.libraryIdMode === 'tt') {
        if (document.getElementById('libraryIdMode')) document.getElementById('libraryIdMode').checked = true;
      } else if (cfg.libraryIdMode === '') {
        if (document.getElementById('libraryIdMode')) document.getElementById('libraryIdMode').checked = false;
      }
      if (cfg.streamPreset) document.getElementById('streamPreset').value = cfg.streamPreset;
      if (cfg.streamPreset === 'custom') {
        if (cfg.streamNameTemplate) document.getElementById('streamNameTemplate').value = cfg.streamNameTemplate;
        if (cfg.streamDescTemplate) document.getElementById('streamDescTemplate').value = cfg.streamDescTemplate;
      } else {
        onStreamPresetChange();
      }
      // Streams 2.0 — restore filter + sort settings
      if (cfg.streamSort) document.getElementById('streamSort').value = cfg.streamSort;
      const sf = (cfg.streamFilters && typeof cfg.streamFilters === 'object') ? cfg.streamFilters : {};
      if (sf.minQuality) document.getElementById('streamMinQuality').value = sf.minQuality;
      if (sf.maxQuality) document.getElementById('streamMaxQuality').value = sf.maxQuality;
      if (sf.minSizeGB) document.getElementById('streamMinSizeGB').value = sf.minSizeGB;
      if (sf.cachedOnly) document.getElementById('streamCachedOnly').checked = true;
      if (Array.isArray(sf.excludeQualities) && sf.excludeQualities.length) document.getElementById('streamExcludeLow').checked = true;
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
      // Catalogue names (Edit Catalogues) — per-catalogue fields with legacy
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
      if (cfg.filterCachedOnly) document.getElementById('filterCachedOnly').checked = true;
      renderAllFilterChips();
      renderCataloguesOptions();
      renderStreamAddons();
      updateStreamPreview();
    }

    // The "Review & Save" banner button: jump to the Install step and scroll the
    // Save / Generate button into view so it can't be missed on small screens.
    function reviewAndSave() {
      goToStep(6);
      setTimeout(() => {
        const btn = document.getElementById('btnGenerate');
        if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 250);
    }

    // Persist the heavy stream settings (addons + format) server-side in Redis
    // keyed by the user's hash, so they survive reloads, device switches and
    // re-pushes and keep the install token small. Fire-and-forget: the token
    // itself is still saved normally, this is a supplement.
    function saveConfigToServer(cfg) {
      if (!cfg || typeof cfg !== 'object') return;
      // The install token intentionally omits the heavy/variable stream settings
      // (custom formatter templates, custom streams, stream addons) — they'd
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
      // Always send the toggle ('tt' or '') so an untick clears the server-side
      // value and the change takes effect without re-pushing the link.
      serverCfg.libraryIdMode = (document.getElementById('libraryIdMode') && document.getElementById('libraryIdMode').checked) ? 'tt' : '';
      try {
        fetch('/api/save-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: serverCfg }),
        }).catch(() => {});
      } catch { /* non-fatal */ }
    }

    // Build the TRIMMED config object that goes into the token (only
    // non-default / non-empty values). Used by both generate() and the push
    // flow so the token stays well under the 2048-char server limit — the full
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
      if (catNames.movies && catNames.movies !== '🎬 My Movies') cfg.catNameMovies = catNames.movies;
      if (catNames.series && catNames.series !== '📺 My Series') cfg.catNameSeries = catNames.series;
      if (catNames.anime && catNames.anime !== '🍥 LeLibrary Anime') cfg.catNameAnime = catNames.anime;
      if (hideAnime) cfg.hideAnime = true;
      if (document.getElementById('libraryIdMode') && document.getElementById('libraryIdMode').checked) cfg.libraryIdMode = 'tt';
      const streamPreset = document.getElementById('streamPreset').value;
      if (streamPreset && streamPreset !== 'lelibrary') {
        // Only the preset id goes in the token — the custom templates are saved
        // server-side (see saveConfigToServer) and merged back by the addon, so
        // a long custom formatter can't blow up the install URL.
        cfg.streamPreset = streamPreset;
      }
      // Streams 2.0 — discovery filter + sort settings (small, stays in token)
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
      if (document.getElementById('pinCollections') && document.getElementById('pinCollections').checked) cfg.pinCollections = true;
      if (catNames.trendingMovies && catNames.trendingMovies !== '🔥 Trending Movies') cfg.trendingMoviesName = catNames.trendingMovies;
      if (catNames.trendingSeries && catNames.trendingSeries !== '🔥 Trending Series') cfg.trendingSeriesName = catNames.trendingSeries;
      if (catNames.popularMovies && catNames.popularMovies !== '⭐ Popular Movies') cfg.popularMoviesName = catNames.popularMovies;
      if (catNames.popularSeries && catNames.popularSeries !== '⭐ Popular Series') cfg.popularSeriesName = catNames.popularSeries;
      if (catNames.franchises && catNames.franchises !== 'LeLibrary Collections') cfg.collectionsName = catNames.franchises;
      if (catOrder && JSON.stringify(catOrder) !== JSON.stringify(DEFAULT_CAT_ORDER)) cfg.catalogOrder = catOrder.slice();
      // Filters & Preferences — ONLY the fields the addon actually reads go in
      // the token (resolution include list, max size, cached-only). The quality/
      // source/codec/HDR/audio chips, resolution preference order and min size
      // are kept in the configure draft (UI state) but dropped here so they
      // can't bloat the install URL.
      const fResInc = [...filterState.resIncluded];
      if (fResInc.length < ALL_RESOLUTIONS.length) cfg.filterResolutions = fResInc;
      const fMaxSize = parseFloat(document.getElementById('filterMaxSize')?.value) || 0;
      if (fMaxSize > 0) cfg.filterMaxSize = fMaxSize;
      if (document.getElementById('filterCachedOnly')?.checked) cfg.filterCachedOnly = true;
      // Stream addons go IN THE TOKEN too (not just Redis) so external streams
      // survive a Redis flush/expiry — small array, well under the size cap.
      if (Array.isArray(streamAddons) && streamAddons.length > 0) cfg.streamAddons = streamAddons.slice();
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
      document.getElementById('setupCatalogMode').textContent = set.length < 2 ? '—' : catMode === 'separate' ? 'Separate' : 'Merged';

      const tmdb = document.getElementById('tmdbApiKey').value.trim();
      document.getElementById('setupTmdb').textContent = !tmdb ? 'Not set' : looksLikeV4Token(tmdb) ? '⚠️ v4 — use v3' : '✓ Set';

      const posters = { '': 'TMDB', erdb: 'ERDB', rpdb: 'RPDB', betterposter: 'BetterPosters', fanart: 'Fanart.tv' };
      document.getElementById('setupPoster').textContent = posters[document.getElementById('posterProvider').value] || 'TMDB';

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
        html = '<span style="font-size:0.78rem;color:var(--muted)">Fanart.tv doesn\'t embed ratings on posters —<br>configure a service above to preview</span>';
      } else if (!s || !s.url()) {
        html = `<span>Enter your ${s.label} key above<br>to see a live preview</span>`;
      } else {
        html = `<img src="${s.url()}" alt="Poster preview" style="max-width:150px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.3)" onerror="this.parentElement.innerHTML='<span style=color:var(--error);font-size:0.78rem>Preview failed — invalid key?</span>'" />`;
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
        posterProvider: document.getElementById('posterProvider').value,
        erdbToken: document.getElementById('erdbToken').value.trim(),
        rpdbKey: document.getElementById('rpdbKey').value.trim(),
        fanartKey: document.getElementById('fanartKey').value.trim(),
        omdbKey: document.getElementById('omdbKey').value.trim(),
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
        pinCollections: !!(document.getElementById('pinCollections') && document.getElementById('pinCollections').checked),
        libraryIdMode: !!(document.getElementById('libraryIdMode') && document.getElementById('libraryIdMode').checked) ? 'tt' : '',
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
      };
    }

    function configsEqual(a, b) {
      return a.provider === b.provider &&
        a.torboxApiKey === b.torboxApiKey &&
        a.rdApiKey === b.rdApiKey &&
        a.adApiKey === b.adApiKey &&
        a.pmApiKey === b.pmApiKey &&
        a.tmdbApiKey === b.tmdbApiKey &&
        a.rdCatalog === b.rdCatalog &&
        a.sortBy === b.sortBy &&
        a.lang === b.lang &&
        a.posterProvider === b.posterProvider &&
        a.erdbToken === b.erdbToken &&
        a.rpdbKey === b.rpdbKey &&
        a.fanartKey === b.fanartKey &&
        a.omdbKey === b.omdbKey &&
        a.enhanceBackground === b.enhanceBackground &&
        a.enhanceLogo === b.enhanceLogo &&
        JSON.stringify(a.customStreams || []) === JSON.stringify(b.customStreams || []) &&
        a.catNameMovies === b.catNameMovies &&
        a.catNameSeries === b.catNameSeries &&
        a.catNameAnime === b.catNameAnime &&
        a.hideAnime === b.hideAnime &&
        a.streamPreset === b.streamPreset &&
        a.streamNameTemplate === b.streamNameTemplate &&
        a.streamDescTemplate === b.streamDescTemplate &&
        a.catalogTrendingMovies === b.catalogTrendingMovies &&
        a.catalogTrendingSeries === b.catalogTrendingSeries &&
        a.catalogPopularMovies === b.catalogPopularMovies &&
        a.catalogPopularSeries === b.catalogPopularSeries &&
        a.catalogMovies === b.catalogMovies &&
        a.catalogSeries === b.catalogSeries &&
        a.catalogAnime === b.catalogAnime &&
        a.catalogFranchises === b.catalogFranchises &&
        a.pinCollections === b.pinCollections &&
        a.libraryIdMode === b.libraryIdMode &&
        a.trendingMoviesName === b.trendingMoviesName &&
        a.trendingSeriesName === b.trendingSeriesName &&
        a.popularMoviesName === b.popularMoviesName &&
        a.popularSeriesName === b.popularSeriesName &&
        a.collectionsName === b.collectionsName &&
        JSON.stringify(a.catalogOrder || []) === JSON.stringify(b.catalogOrder || []) &&
        JSON.stringify(a.streamAddons || []) === JSON.stringify(b.streamAddons || []) &&
        JSON.stringify(a.filterResolutions || []) === JSON.stringify(b.filterResolutions || []) &&
        JSON.stringify(a.filterResOrder || []) === JSON.stringify(b.filterResOrder || []) &&
        JSON.stringify(a.filterQualities || []) === JSON.stringify(b.filterQualities || []) &&
        JSON.stringify(a.filterSources || []) === JSON.stringify(b.filterSources || []) &&
        JSON.stringify(a.filterCodecs || []) === JSON.stringify(b.filterCodecs || []) &&
        JSON.stringify(a.filterHdr || []) === JSON.stringify(b.filterHdr || []) &&
        JSON.stringify(a.filterAudio || []) === JSON.stringify(b.filterAudio || []) &&
        (a.filterMinSize || 0) === (b.filterMinSize || 0) &&
        (a.filterMaxSize || 0) === (b.filterMaxSize || 0) &&
        (a.filterCachedOnly || false) === (b.filterCachedOnly || false);
    }

    function checkChanged() {
      saveDraft();
      updateSetupSummary();
      if (typeof updateCataloguesUI === 'function') updateCataloguesUI();
      if (!initialConfig) return;
      const changed = !configsEqual(getCurrentConfig(), initialConfig);
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
      const done = () => showToast(okMsg || 'Copied!');
      const fail = () => showToast('Copy failed — select the text and copy manually', 'error');
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

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2200);
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
          <span style="flex:1">${escHtml(cs.name)} <span style="color:var(--border2)">— ${escHtml(cs.url)}</span></span>
          <span style="font-size:0.7rem;padding:2px 8px;background:var(--surface);border-radius:4px;color:var(--border2)">${cs.type === '*' ? 'All' : cs.type}</span>
          <button class="btn-icon" type="button" onclick="removeCustomStream(${i})" style="width:30px;color:var(--error)" title="Remove">✕</button>
        </div>`
      ).join('');
    }

    function escHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    async function verifyKey(service) {
      const inputMap = { tmdb: 'tmdbApiKey', torbox: 'torboxApiKey', realdebrid: 'rdApiKey', alldebrid: 'adApiKey', premiumize: 'pmApiKey', erdb: 'erdbToken', rpdb: 'rpdbKey', omdb: 'omdbKey', fanart: 'fanartKey' };
      const labels   = { tmdb: 'TMDB', torbox: 'TorBox', realdebrid: 'Real-Debrid', alldebrid: 'AllDebrid', premiumize: 'Premiumize', erdb: 'ERDB', rpdb: 'RPDB', omdb: 'OMDB', fanart: 'Fanart' };
      const id = inputMap[service];
      const el = document.getElementById(id);
      const btn = document.getElementById('verify' + service.charAt(0).toUpperCase() + service.slice(1));
      const val = el.value.trim();
      if (!val) { showToast('Enter a key first'); return; }
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
          btn.className = 'btn-verify verified';
          btn.textContent = '✓';
          el.classList.remove('invalid');
          showToast(labels[service] + ' key is valid!');
        } else {
          btn.className = 'btn-verify failed';
          btn.textContent = '✕';
          el.classList.add('invalid');
          if (d.code === 'V4_ACCESS_TOKEN') {
            showV4Warning(true);
            showToast('TMDB v4 token detected — use your v3 API key');
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
          <button class="btn-load" id="pinRecheck">I've done it — recheck</button>
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
            overlay.remove();
            const el = document.getElementById(inputId);
            if (el) el.classList.remove('invalid');
            const btn = document.getElementById('verify' + service.charAt(0).toUpperCase() + service.slice(1));
            if (btn) { btn.className = 'btn-verify verified'; btn.textContent = '✓'; }
            showToast(service + ' key is valid!');
          } else if (d.needPin) {
            status.textContent = 'Still waiting — have you entered the PIN on the Premiumize page?';
            recheck.disabled = false;
          } else {
            status.textContent = d.error || 'Invalid key';
            recheck.disabled = false;
          }
        } catch (e) {
          status.textContent = 'Could not reach the service — try again.';
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
        // v4 Read Access Tokens expire — force users onto the v3 API key
        tmdbEl.classList.add('invalid');
        showV4Warning(true);
        valid = false;
      } else {
        tmdbEl.classList.remove('invalid');
        showV4Warning(false);
      }
      if (!valid) {
        if (!tmdbApiKey) showToast('Fill in the required fields');
        else if (looksLikeV4Token(tmdbApiKey)) showToast('TMDB v4 token detected — use your v3 API key');
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

        const results = await Promise.all(checks.map(c =>
          fetch('/api/verify/' + c.service, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: c.key })
          })
            .then(r => r.json().catch(() => ({ networkError: true })))
            .then(d => ({ ...c, d }))
            .catch(() => ({ ...c, d: { networkError: true } }))
        ));

        btn.disabled = false;
        document.getElementById('genBtnTitle').textContent = originalLabel;
        document.querySelector('#btnGenerate small').textContent = originalSmall;

        let allValid = true;
        for (const { el, d, service } of results) {
          if (d.valid) {
            el.classList.remove('invalid');
          } else if (d.networkError) {
            // Can't confirm — don't block
          } else if (d.needPin) {
            // Premiumize device authorization — show the PIN modal and wait
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

        // All keys good — confirm before producing the links
        showToast('Keys validated ✓');
      }

      const cfg = buildSavedConfig();
      if (!skipSave) {
        saveConfigToServer(cfg);
        // A real Save/Push persisted the config — the in-progress draft is no
        // longer needed (the new token in the address bar carries it now).
        clearDraft();
      }

      const urls = buildUrls(cfg);
      lastUrls = urls;
      const { manifestUrl, stremioDeep, stremioWeb, nuvioDeep } = urls;

      // For existing installs, "Save" updates the address bar to the NEW token
      // so a refresh keeps these settings (previously the old token stayed in
      // the URL and your changes were silently lost on reload).
      if (hasExistingToken) {
        try { history.replaceState(null, '', `${window.location.origin}/${urls.encoded}/configure`); } catch {}
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

      if (hasExistingToken) {
        if (initialConfig && configsEqual(getCurrentConfig(), initialConfig)) {
          // No changes — just show links, no flashing, no modal
          document.getElementById('modalManifestUrl').textContent = manifestUrl;
          btn.disabled = false;
          document.getElementById('genBtnTitle').textContent = 'Save';
          return;
        }
        if (suppressReinstall) {
          // Load-time rebuild (e.g. after a draft was restored): point the URL
          // and links at the latest form state without nagging — the reinstall
          // modal appears when the user actually clicks Save.
          document.getElementById('modalManifestUrl').textContent = manifestUrl;
          btn.disabled = false;
          document.getElementById('genBtnTitle').textContent = 'Save';
          return;
        }
        // Changes detected — show modal
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
      // New user — scroll to links
      initialConfig = getCurrentConfig();
      btn.disabled = false;
      document.getElementById('genBtnTitle').textContent = originalLabel;
      document.getElementById('btnDesktop').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function copyUrl(btn) {
      const url = document.getElementById('manifestUrl').textContent;
      const flash = () => flashCopied(btn);
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url).then(() => { showToast('URL copied!'); flash(); }).catch(() => flash());
        return;
      }
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); showToast('URL copied!'); } catch { showToast('Copy failed — select the URL manually', 'error'); }
      document.body.removeChild(ta);
      flash();
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
      document.getElementById('posterProvider').value = 'tmdb';
      document.getElementById('enhanceBackground').checked = false;
      document.getElementById('enhanceLogo').checked = false;
      document.getElementById('hideAnime').checked = false;
      if (document.getElementById('pinCollections')) document.getElementById('pinCollections').checked = false;
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
          el.title = `v${latest} available — update on GitHub`;
          el.onclick = () => window.open('https://github.com/leleasley/LeLibrary/releases', '_blank');
          el.style.cursor = 'pointer';
        } else {
          el.textContent = `v${APP_VERSION}`;
        }
      } catch (e) {
        el.textContent = `v${APP_VERSION}`;
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('versionDisplay').textContent = `v${APP_VERSION}`;
      checkVersion();
      loadStatusPill();
      setInterval(loadStatusPill, 60000);
      renderAllFilterChips();
      renderCataloguesOptions();
      renderStreamAddons();
      renderConnectAll();
      goToStep(1);
      if (restoreConnect()) {
        // Saved session — quietly validate it in the background
        renderConnectAll();
        verifyRestoredConnect();
      }
      const token = window.location.pathname.split('/')[1];
      const hasToken = token && token !== 'configure';
      hasExistingToken = hasToken;
      if (hasToken) {
        document.getElementById('btnRefresh').style.display = '';
        document.getElementById('genBtnTitle').textContent = 'Save';
        document.querySelector('#btnGenerate small').textContent = 'Save your config changes';
      }
      const sideLabel = hasToken ? 'Save' : 'Generate install links';
      document.getElementById('btnGenerateSide').textContent = sideLabel;

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
              if (stored.libraryIdMode === 'tt') {
                if (document.getElementById('libraryIdMode')) document.getElementById('libraryIdMode').checked = true;
                applied = true;
              } else if (stored.libraryIdMode === '') {
                if (document.getElementById('libraryIdMode')) document.getElementById('libraryIdMode').checked = false;
                applied = true;
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
      const watchIds = ['provider', 'torboxApiKey', 'rdApiKey', 'adApiKey', 'pmApiKey', 'tmdbApiKey', 'rdCatalog', 'sortBy', 'lang', 'posterProvider', 'erdbToken', 'rpdbKey', 'fanartKey', 'omdbKey', 'streamPreset', 'filterMinSize', 'filterMaxSize', 'filterCachedOnly'];
      watchIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          const ev = el.tagName === 'SELECT' ? 'change' : 'input';
          el.addEventListener(ev, checkChanged);
        }
      });
      ['enhanceBackground', 'enhanceLogo', 'hideAnime', 'pinCollections'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', checkChanged);
      });
      ['csName', 'csUrl', 'csType'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', checkChanged);
      });
      // Custom formatter templates — mark them changed so the unsaved banner
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

    // Enter on inputs triggers generate; everywhere else (custom-stream fields,
    // modal, buttons) it must NOT silently regenerate/override the form.
    document.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const t = e.target;
      if (t && t.tagName && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      generate();
    });

    async function clearCache() {
      const btn = document.getElementById('btnRefresh');
      const token = window.location.pathname.split('/')[1];
      if (!token || token === 'configure') { btn.textContent = '❌ Install the addon first'; btn.style.opacity = '0.5'; setTimeout(() => { btn.style.opacity = '1'; btn.innerHTML = '🔄 Refresh catalog<small>Clears server cache</small>'; }, 2000); return; }
      btn.disabled = true;
      btn.innerHTML = '<div class="ico">⏳</div><div class="txt"><span>Clearing cache...</span></div>';
      try {
        const r = await fetch('/api/clear-cache/' + token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const d = await r.json();
        if (d.success) {
          btn.innerHTML = '<div class="ico">✅</div><div class="txt"><span>Cache cleared!</span><small>Now refresh your app</small></div>';
          setTimeout(() => { btn.disabled = false; btn.innerHTML = '<div class="ico">🔄</div><div class="txt"><span>Refresh catalog</span><small>Clears server cache — then refresh in Stremio or Nuvio</small></div><span class="arr">›</span>'; }, 3000);
        } else {
          btn.innerHTML = '<div class="ico">❌</div><div class="txt"><span>Error: ' + d.error + '</span></div>';
          setTimeout(() => { btn.disabled = false; btn.innerHTML = '<div class="ico">🔄</div><div class="txt"><span>Refresh catalog</span><small>Clears server cache — then refresh in Stremio or Nuvio</small></div><span class="arr">›</span>'; }, 3000);
        }
      } catch (e) {
        btn.innerHTML = '<div class="ico">❌</div><div class="txt"><span>Failed: ' + e.message + '</span></div>';
        setTimeout(() => { btn.disabled = false; btn.innerHTML = '<div class="ico">🔄</div><div class="txt"><span>Refresh catalog</span><small>Clears server cache — then refresh in Stremio or Nuvio</small></div><span class="arr">›</span>'; }, 3000);
      }
    }

    // ── Stream Preview ──
    const SMALL_CAPS_MAP = {
      a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ғ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',
      l:'ʟ',m:'ᴍ',n:'ɴ',o:'ᴏ',p:'ᴘ',r:'ʀ',s:'s',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',y:'ʏ',z:'ᴢ',
    };
    const toSC = s => s.toLowerCase().split('').map(c => SMALL_CAPS_MAP[c]||c).join('');
    const BR_GROUPS = /^(bioma|c76|franceira|sigla|sf|tossato|sh4down|7sprit7|pia|riper|tomtom|andrehsa|fly|cza)$/i;

    function pvQuality(n) {
      const u = n.toUpperCase();
      if (u.match(/\b(2160P|4K|UHD)\b/)) return '4K';
      if (u.match(/\b1080P\b/))           return '1080p';
      if (u.match(/\b720P\b/))            return '720p';
      if (u.match(/\b480P\b/))            return '480p';
      return '';
    }
    function pvVisualTags(n) {
      const u = n.toUpperCase(), t = [];
      if (u.match(/DOLBY.?VISION|\bDV\b/)) t.push('DV');
      if (u.match(/HDR10(\+|PLUS)/))        t.push('HDR10+');
      else if (u.match(/\bHDR10\b/))        t.push('HDR10');
      else if (u.match(/\bHDR\b/))          t.push('HDR');
      if (u.match(/\b10.?BIT\b/))           t.push('10-bit');
      return t.join(' · ');
    }
    function pvCodec(n) {
      const u = n.toUpperCase();
      if (u.match(/\bH\.?265\b|\bHEVC\b|\bX265\b/)) return 'HEVC';
      if (u.match(/\bH\.?264\b|\bAVC\b|\bX264\b/))  return 'AVC';
      if (u.match(/\bAV1\b/))                         return 'AV1';
      return '';
    }
    function pvSource(n) {
      const u = n.toUpperCase();
      if (u.match(/\bBLURAY\b|\bBLU.RAY\b|\bBDRIP\b/)) return 'BluRay';
      if (u.match(/\bWEB.DL\b|\bWEBDL\b/))              return 'WEB-DL';
      if (u.match(/\bWEBRIP\b/))                         return 'WEBRip';
      return '';
    }
    function pvAudio(n) {
      const u = n.toUpperCase(), p = [];
      if      (u.match(/\bDUAL\b|\bDUBLADO\b/))      p.push('Dubbed');
      else if (u.match(/\bNACIONAL\b|\bPT.?BR\b/))    p.push('PT-BR');
      else if (u.match(/\bLEGENDADO\b/))              p.push('Subbed');
      else if (u.match(/\bENG(LISH)?\b/))             p.push('EN');
      if (u.match(/\bTRUEHD\b/))                       p.push('TrueHD');
      if (u.match(/\bATMOS\b/))                        p.push('Atmos');
      else if (!u.match(/\bTRUEHD\b/)) {
        if      (u.match(/\bDTS.?HD\b/))              p.push('DTS-HD');
        else if (u.match(/\bDTS\b/))                  p.push('DTS');
        else if (u.match(/\bDDP?5\.?1\b|\bDD5\.?1\b/)) p.push('DD5.1');
        else if (u.match(/\bAAC\b/))                  p.push('AAC');
      }
      return p.join(' · ');
    }
    function pvGroup(n) {
      const base = n.replace(/\.(mkv|mp4|avi|mov|ts|wmv|m4v|webm)$/i,'');
      const m = base.match(/-([A-Za-z0-9]{2,12})$/);
      return m ? m[1] : '';
    }
    function pvBytes(b) {
      if (!b) return '';
      const gb = b/1024/1024/1024;
      return gb>=1 ? `${gb.toFixed(2)} GB` : `${(b/1024/1024).toFixed(0)} MB`;
    }
    function buildStreamName(filename, source) {
      const provider = source === 'realdebrid' ? '🔴 RD' : '⚡ TorBox';
      const q = pvQuality(filename);
      const resLabel = {'4K':'🟣 4K','1080p':'🔵 FHD','720p':'🟢 HD','480p':'⚫ SD'}[q]||'';
      const src = pvSource(filename);
      const line2 = [resLabel, src].filter(Boolean).join(' · ');
      const tags = pvVisualTags(filename);
      return [provider+' ⚡', line2, tags].filter(Boolean).join('\n');
    }
    function buildStreamDesc(filename, size, source) {
      const display = filename.replace(/\.(mkv|mp4|avi|mov|ts|wmv|m4v|webm)$/i,'');
      const sz = pvBytes(size);
      const codec = pvCodec(filename);
      const audio = pvAudio(filename);
      const group = pvGroup(filename);
      const isBR  = group && BR_GROUPS.test(group);
      const lines = [];
      const infoRow = [sz ? `💾 ${sz}` : '', codec ? `⚙️ ${codec}` : ''].filter(Boolean).join('   ');
      if (infoRow) lines.push(infoRow);
      if (audio) lines.push(`🔊 ${audio}`);
      if (group) lines.push(`${isBR ? '🇧🇷 ' : ''}🫟 ${toSC(group)}`);
      if (display) lines.push(`✔️ ${toSC(display)}`);
      return lines.join('\n');
    }

    const SAMPLES = [
      { filename: 'Sonic.the.Hedgehog.3.2024.1080p.WEB-DL.H265.Dual.Audio.PT-BR.DD5.1-BIOMA.mkv', size: 9126805504, source: 'torbox' },
      { filename: 'Dune.Part.Two.2024.2160p.BluRay.HEVC.HDR10Plus.TrueHD.Atmos-GROUP.mkv', size: 45097156608, source: 'torbox' },
      { filename: 'Game.of.Thrones.S01E01.720p.WEBRip.x264-FoV.mkv', size: 1258291200, source: 'realdebrid' },
    ];

    function renderPreview() {
      const container = document.getElementById('previewCards');
      container.innerHTML = SAMPLES.map(s => {
        const name = buildStreamName(s.filename, s.source);
        const desc = buildStreamDesc(s.filename, s.size, s.source);
        return `<div class="stream-row">
          <div class="stream-label">${name}</div>
          <div class="stream-detail">${desc}</div>
        </div>`;
      }).join('');
    }

    function togglePreview() {
      const btn  = document.getElementById('previewToggle');
      const body = document.getElementById('previewBody');
      const isOpen = body.classList.toggle('open');
      btn.classList.toggle('open', isOpen);
      if (isOpen) renderPreview();
    }

    // ── Configure tabs (Setup | Catalogues) ──
    function toggleCollCard(header) {
      const body = header.nextElementSibling;
      const arrow = header.querySelector('.coll-arrow');
      if (body) body.classList.toggle('open');
      if (arrow) arrow.classList.toggle('open');
    }
    // Legacy alias — old code called toggleSection on a .collapsible-header
    function toggleSection(header) { toggleCollCard(header); }
    // Tabs removed — this is a no-op for backward compatibility
    function switchTab() {}


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

    function renderFilterChips(containerId, items, includedSet, onChange) {
      const el = document.getElementById(containerId);
      if (!el) return;
      el.innerHTML = items.map(item => {
        const active = includedSet.has(item);
        return `<button type="button" onclick="${onChange}('${item.replace(/'/g, "\'")}')"
          style="display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border-radius:8px;font-size:0.78rem;font-weight:600;cursor:pointer;transition:all 0.15s;font-family:var(--font);border:1px solid ${active ? 'var(--amber)' : 'var(--border2)'};background:${active ? 'var(--amber-glow)' : 'var(--surface2)'};color:${active ? 'var(--amber)' : 'var(--muted)'}">${item}</button>`;
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
      renderFilterChips('resolutionInclude', ALL_RESOLUTIONS, filterState.resIncluded, 'toggleFilterItem.bind(null,\'resIncluded\')');
      renderFilterChips('qualityInclude', ALL_QUALITIES, filterState.qualities, 'toggleFilterItem.bind(null,\'qualities\')');
      renderFilterChips('sourceInclude', ALL_SOURCES, filterState.sources, 'toggleFilterItem.bind(null,\'sources\')');
      renderFilterChips('codecInclude', ALL_CODECS, filterState.codecs, 'toggleFilterItem.bind(null,\'codecs\')');
      renderFilterChips('hdrInclude', ALL_HDR, filterState.hdr, 'toggleFilterItem.bind(null,\'hdr\')');
      renderFilterChips('audioInclude', ALL_AUDIO, filterState.audio, 'toggleFilterItem.bind(null,\'audio\')');
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
          chips[foundIdx > _resFromIdx ? foundIdx : foundIdx].style.transform = 'scale(1.05)';
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
    const STEP_LABELS = { 1: 'Next: Metadata', 2: 'Next: Filters', 3: 'Next: Catalogues', 4: 'Next: Streams & Look', 5: 'Next: Install', 6: '' };
    let currentStep = 1;

    function goToStep(n) {
      n = Math.max(1, Math.min(6, n));
      currentStep = n;
      for (let i = 1; i <= 6; i++) {
        const panel = document.getElementById('panel-' + i);
        if (panel) panel.classList.toggle('visible', i === n);
        const btn = document.querySelector('.step-btn[data-step="' + i + '"]');
        if (btn) btn.classList.toggle('active', i === n);
      }
      // "How far you have left" — progress bar + step counter.
      const STEP_TITLES = { 1: 'Providers', 2: 'Metadata', 3: 'Filters & Preferences', 4: 'Catalogues', 5: 'Streams & Look', 6: 'Install' };
      const progText = document.getElementById('stepProgressText');
      if (progText) progText.textContent = `Step ${n} of 6`;
      const progTitle = document.getElementById('stepProgressTitle');
      if (progTitle) progTitle.textContent = STEP_TITLES[n] || '';
      const progFill = document.getElementById('stepProgressFill');
      if (progFill) progFill.style.width = Math.round((n / 5) * 100) + '%';
      document.getElementById('btnPrevStep').style.visibility = n > 1 ? 'visible' : 'hidden';
      const next = document.getElementById('btnNextStep');
      next.style.display = n === 6 ? 'none' : '';
      document.getElementById('nextStepLabel').textContent = STEP_LABELS[n] || 'Continue';
      if (n === 6) renderConnectAll();
      if (n === 5) {
        renderConnectAll();
        maybeAutoGenerate();
      }
      // Smoothly settle the scroll position after the panel swap (the swap itself
      // is animated via CSS), so the new step appears from the top with no jump.
      requestAnimationFrame(() => {
        const fa = document.querySelector('.form-area');
        if (fa && fa.scrollHeight > fa.clientHeight) fa.scrollTo({ top: 0, behavior: 'smooth' });
        else window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    // Go to the push step: Step 5 if connected, otherwise Step 4 (connect first)
    function goToPushStep() {
      goToStep(5);
    }

    // Step navigation with in-place API-key verification. When advancing past
    // the Providers step (1) the provider keys are checked, and past Metadata
    // (2) the TMDB key is checked — a "Verifying…" state is shown on the step
    // button, then fields turn green with a toast before the step changes.
    // Going back is instant; keys we can't confirm (network blip) don't block.
    function advanceStep(n) {
      n = Math.max(1, Math.min(6, n));
      if (n <= currentStep) { goToStep(n); return; }
      // Provider → API key input id (KEY_FIELD elsewhere is function-scoped, so
      // it's inlined here to avoid a reference error).
      const KEY_FIELD = { torbox: 'torboxApiKey', realdebrid: 'rdApiKey', alldebrid: 'adApiKey', premiumize: 'pmApiKey' };
      const checks = [];
      if (currentStep === 1) {
        for (const id of getProviderSet()) {
          const el = document.getElementById(KEY_FIELD[id]);
          if (el && el.value.trim()) checks.push({ service: id, key: el.value.trim(), el });
        }
      } else if (currentStep === 2) {
        const el = document.getElementById('tmdbApiKey');
        if (el && el.value.trim()) checks.push({ service: 'tmdb', key: el.value.trim(), el });
      }
      if (checks.length === 0) { goToStep(n); return; }
      // Verify in the background and always land on the next step — a slow or
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
      if (nextSmall) nextSmall.textContent = 'Checking your API keys — one moment';
      showToast('Verifying your API keys…');

      // Verify each key with a hard cap so a slow upstream (TorBox can take a
      // few seconds) never leaves the wizard frozen.
      let results;
      try {
        results = await Promise.all(checks.map(c =>
          fetch('/api/verify/' + c.service, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: c.key }),
            signal: AbortSignal.timeout(15000)
          })
            .then(r => r.json().catch(() => ({ networkError: true })))
            .then(d => ({ ...c, d }))
            .catch(() => ({ ...c, d: { networkError: true } }))
        ));
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
          el.classList.remove('invalid');
          el.classList.add('verified');
          anyConfirmed = true;
        } else if (d.networkError) {
          // Can't confirm — don't block the user on our own hiccup
        } else if (d.needPin) {
          // Premiumize device authorization — show the PIN modal, wait for it
          showPinModal(d.pin || '', d.deviceUrl || 'https://www.premiumize.me/device', service);
          return;
        } else {
          el.classList.add('invalid');
          allOk = false;
        }
      }
      if (allOk && anyConfirmed) {
        if (stepBtn) stepBtn.classList.add('verified');
        showToast('Keys validated ✓');
      } else if (!allOk) {
        showToast('Some keys could not be verified — check the marked fields');
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
      goToStep(5);
      generate();
    }

    // ── Push to your account (Step 5): Sign in with Stremio / Nuvio ──
    // Everything is client-side. The session token is stored in localStorage on
    // this device (so you stay signed in across refreshes) and never touches our
    // server. Disconnect clears it.
    const STREMIO_API = 'https://api.strem.io/api';
    const NUVIO_API_BASE        = 'https://api.nuvio.tv';
    const NUVIO_PUBLISHABLE_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';
    const CONNECT_STORAGE_KEY   = 'lelibrary_connect';
    const NUVIO_CLIENT_ID_KEY   = 'lelibrary_nuvio_client_id';

    const connectState = {
      platform: null,          // 'stremio' | 'nuvio'
      stremioAuth: null,
      stremioUser: null,
      nuvioToken: null,
      nuvioRefresh: null,
      nuvioUser: null,
      nuvioProfiles: [],
      nuvioSelectedProfile: null,
    };

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
    // Default order of catalogue rows in the Edit Catalogues tab + manifest.
    const DEFAULT_CAT_ORDER = ['trendingMovies', 'trendingSeries', 'popularMovies', 'popularSeries', 'movies', 'series', 'anime', 'franchises'];
    let catOrder = DEFAULT_CAT_ORDER.slice();
    // External stream addons the user has enabled (Trending/Popular only)
    let streamAddons = [];
    // Set once the user clicks an addon checkbox — the async server-side restore
    // must not clobber a selection made while the settings were still loading.
    let streamAddonsTouched = false;

    function persistConnect() {
      try {
        localStorage.setItem(CONNECT_STORAGE_KEY, JSON.stringify({
          platform: connectState.platform,
          stremioAuth: connectState.stremioAuth,
          stremioUser: connectState.stremioUser,
          nuvioToken: connectState.nuvioToken,
          nuvioRefresh: connectState.nuvioRefresh,
          nuvioUser: connectState.nuvioUser,
          nuvioProfiles: connectState.nuvioProfiles,
          nuvioSelectedProfile: connectState.nuvioSelectedProfile,
        }));
      } catch { /* storage unavailable — fall back to session-only */ }
    }

    function clearPersistedConnect() {
      try { localStorage.removeItem(CONNECT_STORAGE_KEY); } catch {}
    }

    function nuvioOriginClientId() {
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
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(CONNECT_STORAGE_KEY) || 'null'); } catch {}
      if (!saved || !saved.platform) return false;
      connectState.platform = saved.platform;
      connectState.stremioAuth = saved.stremioAuth || null;
      connectState.stremioUser = saved.stremioUser || null;
      connectState.nuvioToken = saved.nuvioToken || null;
      connectState.nuvioRefresh = saved.nuvioRefresh || null;
      connectState.nuvioUser = saved.nuvioUser || null;
      connectState.nuvioProfiles = Array.isArray(saved.nuvioProfiles) ? saved.nuvioProfiles : [];
      connectState.nuvioSelectedProfile = saved.nuvioSelectedProfile || null;
      return true;
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

    function moveCatalogue(key, dir) {
      const i = catOrder.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= catOrder.length) return;
      catOrder.splice(i, 1);
      catOrder.splice(j, 0, key);
      renderCataloguesOptions();
      checkChanged();
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
        if (touch.clientY < mid) { targetIdx = parseInt(el.dataset.catIdx, 10); break; }
      }
      if (targetIdx === -1) targetIdx = items.length - 1;
      if (targetIdx === _catFromIdx) return;

      // Swap in catOrder
      const draggedKey = catOrder.splice(_catFromIdx, 1)[0];
      catOrder.splice(targetIdx, 0, draggedKey);

      // Swap DOM elements directly — no re-render, no event rebinding needed
      const draggedEl = items.find(el => parseInt(el.dataset.catIdx, 10) === _catFromIdx)
                     || items.find(el => el === _catDragEl);
      const targetEl = items.find(el => parseInt(el.dataset.catIdx, 10) === targetIdx);
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

    function toggleHideAnime(checked) {
      const adv = document.getElementById('hideAnime');
      if (adv) adv.checked = checked;
      renderCataloguesOptions();
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
      const hideAnime = !!(document.getElementById('hideAnime') && document.getElementById('hideAnime').checked);
      const rows = [];
      catOrder.forEach((key, i) => {
        const meta = CATALOGUE_META[key] || {};
        if (key === 'anime' && hideAnime) return;
        const enabled = meta.enable ? !!catSelection[meta.enable] : true;
        rows.push(`
          <div class="cat-option cat-drag-item" data-cat-key="${key}" data-cat-idx="${i}" style="align-items:center;flex-wrap:wrap;touch-action:none;user-select:none;-webkit-user-select:none;">
            <span class="cat-drag-handle" style="cursor:grab;opacity:0.4;font-size:0.9rem;flex-shrink:0;margin-right:2px;touch-action:none;">⠿</span>
            ${meta.enable
              ? `<input type="checkbox" id="editCat-${key}" ${enabled ? 'checked' : ''} onchange="setCatOption('${meta.enable}', this.checked)" />`
              : '<input type="checkbox" checked disabled style="opacity:0.5" />'}
            <div class="co-info">
              <strong>${escHtml(catNames[key] || key)}</strong>
              <small>${meta.desc || ''}</small>
            </div>
            <button class="btn-copy-url" type="button" onclick="editCatalogueName('${key}')" title="Rename">✎ Rename</button>
          </div>`);
      });
      list.innerHTML = rows.join('');
      // Bind drag-to-reorder on handles only
      list.querySelectorAll('.cat-drag-handle').forEach(handle => {
        handle.addEventListener('mousedown', catDragStart);
        handle.addEventListener('touchstart', catDragStart, { passive: false });
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
    }

    // Rename a catalogue — prompt for the new display name and sync every
    // checkbox/title that shows it (Step 5 + Catalogues tab).
    // Rename a catalogue — inline modal with a real input (prompt() can mangle
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
      showToast('Catalogue renamed — remember to save and re-push');
    }

    // ── Stream Addons (Trending/Popular only) ──
    const STREAM_ADDONS = [
      { id: 'torrentio',    name: 'Torrentio',    logo: 'https://cdn.brandfetch.io/idmo5AU-sJ/w/204/h/185/theme/dark/logo.png?c=1dxbfHSJFAPEGdCLU4o5B', desc: 'Torrent + debrid streams from a wide provider network.' },
      { id: 'comet',        name: 'Comet',        logo: 'https://raw.githubusercontent.com/g0ldyy/comet/refs/heads/main/comet/assets/icon.png', desc: "Stremio's fast torrent/debrid stream addon." },
      { id: 'meteor',       name: 'Meteor',       logo: 'https://meteorfortheweebs.midnightignite.me/static/icon.png', desc: 'Torrent + debrid streams with usenet support.' },
      { id: 'mediafusion',  name: 'MediaFusion',  logo: 'https://raw.githubusercontent.com/mhdzumair/MediaFusion/refs/heads/main/resources/images/mediafusion_logo.png', desc: 'Universal streams for movies, series and anime.' },
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

    function renderStreamAddons() {
      const list = document.getElementById('streamAddonList');
      if (!list) return;
      list.innerHTML = STREAM_ADDONS.map(a => `
        <label class="cat-option" style="align-items:center">
          <input type="checkbox" id="addon-${a.id}" ${streamAddons.includes(a.id) ? 'checked' : ''} onchange="toggleStreamAddon('${a.id}', this.checked)" />
          <img src="${escHtml(a.logo)}" alt="${escHtml(a.name)}" loading="lazy"
            style="width:34px;height:34px;border-radius:8px;object-fit:contain;background:rgba(255,255,255,0.06);padding:4px;flex-shrink:0"
            onerror="this.style.display='none'" />
          <div class="co-info">
            <strong>${a.name}</strong>
            <small>${a.desc}</small>
          </div>
        </label>`).join('');
      const enabledCount = streamAddons.length;
      const card = document.getElementById('streamAddonsCard');
      if (card) {
        const existing = card.querySelector('.streamAddonsStatus');
        if (existing) existing.remove();
        if (enabledCount > 0) {
          const badge = document.createElement('div');
          badge.className = 'streamAddonsStatus coll-note';
          badge.style.cssText = 'margin-top:10px;font-size:0.78rem;color:var(--success)';
          badge.textContent = `${enabledCount} stream addon${enabledCount > 1 ? 's' : ''} enabled — they power Trending/Popular streams only.`;
          card.appendChild(badge);
        }
      }
    }

    function connectWidgetHTML(s) {
      return `
        <div class="connect-widget">
          <div class="connect-intro">
            <strong>Optional</strong> — connect Stremio or Nuvio to install LeLibrary straight into your account and
            import your catalogues, no copy/pasting URLs.
            <span class="ci-sub">All Stremio / Nuvio credentials are <strong>never sent to our servers</strong> — they go only to the
            platform's own API. Your login is saved in this browser so you stay signed in; Disconnect clears it.</span>
          </div>
          <div class="connect-grid">
            <!-- STREMIO BOX -->
            <div class="connect-box">
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
            <div class="connect-box">
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
          again — it never touches our server. <strong>Disconnect</strong> to clear it.</p>
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
        <p class="field-hint" style="margin-top:10px">You're all set — push LeLibrary to your account below.</p>`;
    }

    // Step 5: the push panel (only rendered when connected)
    function renderInstallPush() {
      const el = document.getElementById('installPush');
      // Always show the connect widget if not connected, otherwise show connected card
      if (!connectState.platform) {
        el.innerHTML = connectWidgetHTML('step');
        return;
      }
      const plat = connectState.platform === 'stremio' ? 'Stremio' : 'Nuvio';
      const profiles = connectState.nuvioProfiles
        .map(p => `<option value="${p.profile_index}" ${connectState.nuvioSelectedProfile === p.profile_index ? 'selected' : ''}>${escHtml(p.name)}</option>`)
        .join('') || '<option value="">No profiles found</option>';

      el.innerHTML = `
        <div class="step-card">
          <div class="step-card" id="setupGuard" style="display:none;background:var(--amber-glow);border-color:rgba(245,158,11,0.35)">
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
          <div id="pushActions">
            <div class="field" id="cataloguesProfileField" style="display:none">
              <div class="field-label">Push to profile</div>
              <select id="cataloguesProfile" onchange="connectState.nuvioSelectedProfile = parseInt(this.value,10) || null; persistConnect();">${profiles}</select>
              <p class="field-hint">Select the Nuvio profile to install LeLibrary on.</p>
            </div>
            <button class="btn-main btn-outline show" type="button" onclick="goToStep(3)" style="margin-bottom:12px">
              <div class="ico">✏️</div>
              <div class="txt"><span>Configure your catalogues here</span><small>Go to Catalogues step to reorder, rename, or toggle rows</small></div>
              <span class="arr">›</span>
            </button>
            <div class="url-warning">
              <strong>Your other addons are kept</strong> — LeLibrary is simply added (or updated if it was already installed).
            </div>
            <button class="btn-main btn-gen" id="btnPushCatalogues" onclick="pushCatalogues()">
              <div class="ico">⬆️</div>
              <div class="txt">
                <span id="pushCataloguesLabel">Push to ${plat}</span>
                <small id="pushCataloguesSmall">Adds or updates LeLibrary and keeps your other addons</small>
              </div>
              <span class="arr">›</span>
            </button>
          </div>
          <div class="field-hint" id="pushCataloguesStatus"></div>
          <div class="info-card" id="pushResultCard" style="display:none">
            <h4>Previous addons (backup)</h4>
            <p class="field-hint" style="margin:6px 0 10px 0">These were on your account before this push. Copy any you want to reinstall later.</p>
            <div class="backup-list" id="backupList"></div>
          </div>
        </div>`;
      updateCataloguesUI();
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
      el('pushActions').style.display = guard ? 'none' : '';
      el('cataloguesProfileField').style.display = (connectState.platform === 'nuvio' && !guard) ? '' : 'none';
      const warn = document.querySelector('#installPush .url-warning strong');
      if (warn) warn.textContent = `Your other addons are kept — LeLibrary is added or updated on ${connectState.platform === 'stremio' ? 'Stremio' : 'Nuvio'}`;
      el('pushCataloguesStatus').textContent = '';
      el('pushCataloguesStatus').style.color = '';
      el('pushCataloguesStatus').style.display = guard ? 'none' : '';
      el('pushResultCard').style.display = 'none';
    }

    function disconnectConnect() {
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
      showToast('Disconnected — login cleared from this browser');
    }

    async function stremioCall(path, body) {
      const r = await fetch(`${STREMIO_API}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      if (r.status === 429) throw Object.assign(new Error('Stremio rate limit reached — wait a minute and try again'), { code: 'RATE_LIMIT' });
      let data = null;
      try { data = await r.json(); } catch { /* non-JSON */ }
      if (!r.ok || data?.error) {
        const msg = data?.error?.message || `Stremio API error (HTTP ${r.status})`;
        throw Object.assign(new Error(msg), { code: data?.error?.code });
      }
      return data;
    }

    async function connectStremio(s) {
      const email = document.getElementById(`${s}-stremioEmail`).value.trim();
      const pass  = document.getElementById(`${s}-stremioPass`).value;
      if (!email || !pass) { showToast('Enter your Stremio email and password'); return; }
      const submit = document.getElementById(`${s}-stremioSubmit`);
      const ico = document.getElementById(`${s}-stremioIco`);
      const label = document.getElementById(`${s}-stremioBtnLabel`);
      const status = document.getElementById(`${s}-stremioStatus`);
      submit.disabled = true;
      ico.classList.add('spin');
      label.textContent = 'Signing in…';
      try {
        const data = await stremioCall('login', { type: 1, email, password: pass });
        const authKey = data.result?.authKey || data.result?.token;
        if (!authKey) throw new Error('Stremio did not return a session token');
        connectState.stremioUser = data.result?.user || null;
        connectState.stremioAuth = authKey;
        connectState.platform = 'stremio';
        persistConnect();
        renderConnectAll();
        showToast('Connected to Stremio ✓ — you can push below');
      } catch (err) {
        ico.classList.remove('spin');
        submit.disabled = false;
        label.textContent = 'Sign in with Stremio';
        status.textContent = '';
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
      const email = document.getElementById(`${s}-nuvioEmail`).value.trim();
      const pass  = document.getElementById(`${s}-nuvioPass`).value;
      if (!email || !pass) { showToast('Enter your Nuvio email and password'); return; }
      const submit = document.getElementById(`${s}-nuvioSubmit`);
      const ico = document.getElementById(`${s}-nuvioIco`);
      const label = document.getElementById(`${s}-nuvioBtnLabel`);
      const status = document.getElementById(`${s}-nuvioStatus`);
      submit.disabled = true;
      ico.classList.add('spin');
      label.textContent = 'Signing in…';
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
        label.textContent = 'Loading profiles…';
        await loadNuvioProfiles();
        if (connectState.nuvioProfiles.length === 1) connectState.nuvioSelectedProfile = connectState.nuvioProfiles[0].profile_index;
        connectState.platform = 'nuvio';
        persistConnect();
        renderConnectAll();
        showToast('Connected to Nuvio ✓ — pick a profile and push below');
      } catch (err) {
        ico.classList.remove('spin');
        submit.disabled = false;
        label.textContent = 'Sign in with Nuvio';
        status.textContent = '';
        showToast('Nuvio: ' + (err.message || 'could not connect'), 'error');
      }
    }

    async function loadNuvioProfiles() {
      const data = await nuvioRpc(connectState.nuvioToken, '/rest/v1/rpc/sync_pull_profiles', {});
      const list = Array.isArray(data) ? data : (data?.profiles || []);
      const seen = new Map();
      for (const p of list) {
        const idx = Math.trunc(Number(p.profile_index ?? p.id));
        if (!Number.isFinite(idx) || idx < 1 || seen.has(idx)) continue;
        seen.set(idx, {
          profile_index: idx,
          name: String(p.name || '').trim() || `Profile ${idx}`,
          uses_primary_addons: !!(p.uses_primary_addons ?? p.usesPrimaryAddons),
        });
      }
      connectState.nuvioProfiles = Array.from(seen.values()).sort((a, b) => a.profile_index - b.profile_index);
      return connectState.nuvioProfiles;
    }

    // Nuvio's sync_* RPCs return json columns (settings_json, collections_json)
    // as either a parsed object or a JSON string — accept both.
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
          const filtered = collections.filter(c => c?.id !== collectionId);
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
            return !(item.collection_id === collectionId ||
              itemKey === `collection_${collectionId}` ||
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
    // isn't enough — this pushes the settings NuvioWeb reads (platform
    // 'home_catalog_shared').
    async function syncNuvioHomeOrder(token, profileId, manifest) {
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
        const byKey = new Map(items.map(item => {
          const key = item.key || `${item.addon_id}:${item.type}:${item.catalog_id}`;
          return [key, item];
        }));

        let order = 0;
        for (const catalog of manifest.catalogs) {
          const key = `${manifest.id}:${catalog.type}:${catalog.id}`;
          const existing = byKey.get(key) || {};
          const isFranchise = String(catalog.id || '') === 'torbox-collections' ||
            String(catalog.id || '').startsWith('torbox-collection-');
          const currentOrder = order++;
          byKey.set(key, {
            ...existing,
            addon_id: manifest.id,
            type: catalog.type,
            catalog_id: catalog.id,
            enabled: !isFranchise,
            order: isFranchise ? (Number(existing.order) || 999) : currentOrder,
            custom_title: existing.custom_title || '',
            is_collection: false,
            collection_id: existing.collection_id || '',
            key,
          });
        }

        // Drop stale rows left over from older pushes (e.g. the removed
        // per-franchise catalogs, or the old "LeLibrary Collections" series
        // catalog) so they can't linger on Home.
        const manifestCatalogKeys = new Set(manifest.catalogs.map(c => `${manifest.id}:${c.type}:${c.id}`));
        for (const [key, item] of byKey) {
          if (item && item.addon_id === manifest.id && !manifestCatalogKeys.has(key) && item.is_collection !== true) {
            byKey.delete(key);
          }
        }

        await nuvioRpc(token, '/rest/v1/rpc/sync_push_home_catalog_settings', {
          p_profile_id: profileId,
          p_platform: platform,
          p_settings_json: {
            show_catalog_type: settings.show_catalog_type !== false,
            hide_unreleased_content: settings.hide_unreleased_content === true,
            items: Array.from(byKey.values()).sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)),
          },
          p_origin_client_id: nuvioOriginClientId(),
        });
        console.log('[Push] Nuvio Home order synced to Edit Catalogues order');
      } catch (err) {
        console.warn('[Push] Could not sync Nuvio Home order:', err.message);
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
        // Expired / invalid session — clear and ask them to sign in again
        connectState.platform = null;
        connectState.stremioAuth = null;
        connectState.nuvioToken = null;
        connectState.nuvioRefresh = null;
        clearPersistedConnect();
        renderConnectAll();
        showToast('Your saved session expired — sign in again', 'error');
      }
    }

    // ── Push catalogues (replaces all addons, with backup list) ──
    function ensureManifestUrl() {
      // Always rebuild from the CURRENT form state — never reuse a stale URL
      // from an earlier generate(), or ticking a catalogue after that would be
      // silently dropped from the pushed token. Uses the trimmed config so the
      // token stays under the server's 2048-char limit.
      const provider = document.getElementById('provider').value;
      if (!provider || provider === 'none') return null;
      try { return buildUrls(buildSavedConfig()); } catch { return null; }
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

    async function pushCatalogues() {
      if (!connectState.platform) { showToast('Sign in to Stremio or Nuvio first'); return; }
      if (!setupComplete()) {
        updateCataloguesUI();
        showToast('Complete the Setup tab first — providers and a TMDB key are needed', 'error');
        document.getElementById('setupGuard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
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
      label.textContent = 'Saving config…';
      small.textContent = 'Building your configuration';
      await new Promise(r => setTimeout(r, 400));
      const urls = ensureManifestUrl();
      if (!urls) {
        btn.disabled = false;
        label.textContent = origLabel;
        small.textContent = origSmall;
        showToast('Fill in your providers and keys on the Setup tab first');
        return;
      }
      // Point the address bar at the freshly-saved token so a refresh keeps it.
      try { history.replaceState(null, '', `${window.location.origin}/${urls.encoded}/configure`); } catch {}
      // Persist stream settings server-side too (fire and forget).
      saveConfigToServer(buildSavedConfig());
      // The push saved the config — the in-progress draft is no longer needed.
      clearDraft();

      // 2) Push to the platform.
      label.textContent = 'Now pushing…';
      small.textContent = 'Installing LeLibrary on your ' + (connectState.platform === 'stremio' ? 'Stremio' : 'Nuvio') + ' account';
      await new Promise(r => setTimeout(r, 400));

      try {
        // Warm the collections build BEFORE the addon is installed. The folders'
        // contents need to exist — otherwise Nuvio folders show "No Items Found".
        // The collections.json route builds synchronously when empty.
        small.textContent = 'Building your catalogues…';
        let warmedCollections = null;
        try {
          warmedCollections = await fetch(urls.collectionsUrl, { signal: AbortSignal.timeout(60000) }).then(r => r.json());
        } catch { /* keep going — the addon still installs even if the build is slow */ }

        if (connectState.platform === 'stremio') {
          small.textContent = 'Reading your current addons…';
          const getData = await stremioCall('addonCollectionGet', { authKey: connectState.stremioAuth });
          const addons = Array.isArray(getData.result?.addons) ? getData.result.addons : [];
          const backup = addons.map(a => ({ url: a.transportUrl, name: (a.manifest && a.manifest.name) || '' })).filter(b => b.url);
          small.textContent = 'Installing LeLibrary…';
          const manifest = await fetch(urls.manifestUrl, { signal: AbortSignal.timeout(10000) }).then(r => r.json());
          const descriptor = { transportUrl: urls.manifestUrl, transportName: 'http', flags: {}, manifest };
          // Upsert: keep every addon, replace only a previous LeLibrary entry.
          const ours = addons.filter(a => (a.manifest?.id || a.id) !== manifest.id);
          ours.push(descriptor);
          await stremioCall('addonCollectionSet', { authKey: connectState.stremioAuth, addons: ours });
          status.style.color = 'var(--success)';
          status.textContent = 'Installed — all your addons kept and catalogues imported. Please refresh Stremio.';
          renderBackupList(backup);
        } else {
          const profileIndex = parseInt(document.getElementById('cataloguesProfile').value, 10);
          if (!Number.isFinite(profileIndex) || profileIndex < 1) { showToast('Select a Nuvio profile first'); return; }
          const profile = connectState.nuvioProfiles.find(p => p.profile_index === profileIndex) || {};
          small.textContent = 'Preparing your profile…';
          // If the profile shares the primary profile's addons, switch it to its
          // own addons FIRST — otherwise the addon we push lands on the primary
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
          console.log('[Push] Manifest URL length:', urls.manifestUrl.length);
          const addRes = await nuvioRest(connectState.nuvioToken, '/rest/v1/addons', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: [{ user_id: ownerId, profile_id: profileIndex, url: urls.manifestUrl, name: 'LeLibrary', enabled: true, sort_order: 0 }],
          });
          console.log('[Push] Addon add response:', JSON.stringify(addRes));
          // Verify the addon is registered on this profile; retry once if not
          let afterAdd = await nuvioRest(connectState.nuvioToken,
            `/rest/v1/addons?select=*&user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileIndex}`);
          let found = (afterAdd || []).some(a => String(a.url) === urls.manifestUrl);
          if (!found) {
            console.warn('[Push] Addon missing after first add — retrying…');
            await nuvioRest(connectState.nuvioToken, '/rest/v1/addons', {
              method: 'POST',
              headers: { Prefer: 'return=representation' },
              body: [{ user_id: ownerId, profile_id: profileIndex, url: urls.manifestUrl, name: 'LeLibrary', enabled: true, sort_order: 0 }],
            });
            afterAdd = await nuvioRest(connectState.nuvioToken,
              `/rest/v1/addons?select=*&user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileIndex}`);
            found = (afterAdd || []).some(a => String(a.url) === urls.manifestUrl);
          }
          console.log('[Push] Addons on profile after add:', JSON.stringify((afterAdd || []).map(a => ({ name: a.name, url: a.url }))));
          if (!found) {
            throw new Error('LeLibrary could not be registered on this Nuvio profile. Try selecting a different profile, then push again.');
          }
          // Give Nuvio a moment to process the new addon before pushing collections
          await new Promise(r => setTimeout(r, 1500));
          let manifestForNuvio = null;
          try {
            manifestForNuvio = await fetch(urls.manifestUrl, { signal: AbortSignal.timeout(10000) }).then(r => r.json());
          } catch (err) {
            console.warn('[Push] Could not fetch the Nuvio manifest:', err.message);
          }
          if (catSelection.franchises) {
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
              const leLibraryId = 'collection-lelibrary-franchises';
              const mergedCollections = [
                ...existingCollections.filter(c => c?.id !== leLibraryId),
                ...collections.filter(c => c?.id !== leLibraryId),
              ];
              const leLibraryCollection = collections.find(c => c?.id === leLibraryId);
              if (leLibraryCollection) {
                const franchiseIdx = catOrder.indexOf('franchises');
                const moviesIdx = catOrder.indexOf('movies');
                if (franchiseIdx === 0 || (franchiseIdx !== -1 && moviesIdx !== -1 && franchiseIdx < moviesIdx)) {
                  mergedCollections.unshift(leLibraryCollection);
                } else {
                  mergedCollections.push(leLibraryCollection);
                }
              }
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
              status.style.color = 'var(--success)';
              status.textContent = 'Installed — collections imported. New films appear automatically; a brand-new franchise just needs one more quick re-push to add its folder. Please refresh Nuvio.';
            } else {
              status.style.color = 'var(--success)';
              status.textContent = 'Installed. Your catalogues will appear once your library has been scanned.';
            }
          } else {
            status.style.color = 'var(--success)';
            status.textContent = 'Installed — all catalogues have been imported. Please refresh Nuvio.';
          }
          // Sync Nuvio's Home row order to the Edit Catalogues order (and drop
          // stale/disabled LeLibrary rows) regardless of the franchises toggle.
          if (manifestForNuvio) {
            await syncNuvioHomeOrder(connectState.nuvioToken, profileIndex, manifestForNuvio);
          }
          renderBackupList(backup);
        }
        // The push saved the config — clear the "unsaved changes" state so the
        // Save button and warning disappear (no point asking again). It returns
        // automatically if the user edits something else.
        initialConfig = getCurrentConfig();
        document.getElementById('unsavedBanner').style.display = 'none';
        document.getElementById('btnGenerate').style.display = 'none';
        const pushToast = connectState.platform === 'stremio'
          ? 'Pushed to Stremio ✓ New franchise rows appear automatically'
          : 'Pushed to Nuvio ✓ Re-push once when you add a brand-new franchise';
        showToast(pushToast);
      } catch (err) {
        if (/session does not exist|invalid.*token|expired|jwt/i.test(err.message)) {
          showToast('Session expired — reconnect', 'error');
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
      }
    }

    // ── Install-section "Push to X" buttons ────────────────────────────────
    // The Step-6 install buttons push straight to the connected platform,
    // reusing the same pushCatalogues() flow as the Catalogues tab. If the
    // platform isn't connected, point the user at the Connect step instead.
    async function pushAddonTo(platform) {
      const plat = platform === 'nuvio' ? 'Nuvio' : 'Stremio';
      if (connectState.platform !== platform) {
        updateInstallPushHint();
        showToast(`You haven't configured ${plat}. Sign in to be able to use the push to feature`, 'error');
        goToStep(5); // Step 4 panel holds the sign-in boxes
        return;
      }
      goToStep(6); // renders the push panel before pushCatalogues() reads it
      await pushCatalogues();
    }

    // The "You haven't configured Nuvio/Stremio. Sign in…" note only shows next
    // to the install buttons while they're visible and no platform is connected.
    function updateInstallPushHint() {
      const hint = document.getElementById('pushNotConnectedHint');
      if (!hint) return;
      const btn = document.getElementById('btnNuvio');
      const visible = btn && btn.classList.contains('show') && btn.style.display !== 'none';
      hint.style.display = (visible && !connectState.platform) ? '' : 'none';
    }

    // ── Stream formatter ───────────────────────────────────────────────────
    // Presets and template engine come from /formatter.js (window.LeFormatter),
    // the same engine the addon uses server-side.
    const FMT = (typeof window !== 'undefined' && window.LeFormatter) || null;

    const PRESET_LABELS = {
      lelibrary: 'LeLibrary', torrentio: 'Torrentio', torbox: 'Torbox',
      gdrive: 'Google Drive', lightgdrive: 'Light GDrive',
      minimalisticgdrive: 'Minimalistic GDrive', prism: 'Prism', tamtaro: 'Tamtaro',
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
      const nameT = document.getElementById('streamNameTemplate').value;
      const descT = document.getElementById('streamDescTemplate').value;
      const el = document.getElementById('streamPreview');
      if (!FMT) {
        el.innerHTML = '<span style="color:var(--muted)">Formatter engine failed to load — hard refresh to retry</span>';
        return;
      }
      // Sample stream for the live preview. The textareas hold the selected
      // preset's (or custom) templates, so the preview reflects the choice.
      const ctx = FMT.buildLeContext('Toy.Story.2.1999.2160p.BluRay.HEVC.TrueHD.7.1.Atmos-FRDS', 'torbox', 2630000000);
      const name = FMT.render(nameT, ctx);
      const desc = FMT.render(descT, ctx);
      el.innerHTML = '<div style="color:var(--white);font-weight:600;margin-bottom:6px;white-space:pre-line">' + escHtml(name) + '</div>'
        + '<div style="color:var(--muted);white-space:pre-line;font-size:0.78rem">' + escHtml(desc) + '</div>';
    }

    function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

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
    };

