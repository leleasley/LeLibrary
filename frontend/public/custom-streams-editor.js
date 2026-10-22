(function (root) {
  'use strict';

  const ID_RE = /^tt\d+(?::\d+:\d+)?$/;
  const MAX_BYTES = 256 * 1024;
  const MAX_ROWS = 500;
  const MAX_EXPIRY_MS = 24 * 60 * 60 * 1000;

  function text(value, max, name, required) {
    const out = value == null ? '' : String(value).trim();
    if (required && !out) throw new Error(`${name} is required`);
    if (/[\u0000-\u001f\u007f]/.test(out)) throw new Error(`${name} contains unsupported characters`);
    if (out.length > max) throw new Error(`${name} is too long`);
    return out;
  }

  function normalizeUrl(value) {
    const raw = text(value, 4096, 'URL', true);
    let parsed;
    try { parsed = new URL(raw); } catch { throw new Error('Enter a complete http:// or https:// URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL must use http:// or https://');
    if (parsed.username || parsed.password) throw new Error('URL usernames and passwords are not supported');
    if (parsed.hash) throw new Error('URL fragments are not supported');
    return parsed.href;
  }

  function normalizeRow(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each row must be an object');
    const type = text(raw.type || '*', 16, 'Type').toLowerCase();
    if (!['*', 'movie', 'series'].includes(type)) throw new Error('Type must be All, Movies, or Series');
    let supplied = raw.ids !== undefined ? raw.ids : raw.id !== undefined ? [raw.id] : [];
    if (typeof supplied === 'string') supplied = [supplied];
    if (!Array.isArray(supplied) || supplied.length > 64) throw new Error('Use at most 64 IMDb IDs per row');
    const ids = [];
    for (const value of supplied) {
      let id = text(value, 64, 'IMDb ID').toLowerCase();
      if (!id) continue;
      if (!ID_RE.test(id)) throw new Error(`Invalid IMDb ID: ${id}`);
      const episode = id.match(/^(tt\d+):(\d+):(\d+)$/);
      if (episode) id = `${episode[1]}:${episode[2].replace(/^0+(?=\d)/, '')}:${episode[3].replace(/^0+(?=\d)/, '')}`;
      if (type === 'movie' && id.includes(':')) throw new Error('Episode IDs must use Series');
      if (!ids.includes(id)) ids.push(id);
    }
    if (type === 'series' && ids.some(id => id.split(':').length !== 3)) throw new Error('Mapped Series rows require an exact season and episode');
    const row = {
      name: text(raw.name || raw.label, 120, 'Name', true),
      url: normalizeUrl(raw.url),
      type,
    };
    if (ids.length) row.ids = ids;
    if (raw.tmdbId !== undefined && raw.tmdbId !== null && raw.tmdbId !== '') {
      const tmdbId = Number(raw.tmdbId);
      if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) throw new Error('TMDB ID must be a positive integer');
      row.tmdbId = tmdbId;
    }
    if (raw.expiresAt !== undefined && raw.expiresAt !== null && raw.expiresAt !== '') {
      const expiresAt = Number(raw.expiresAt);
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) throw new Error('Expiry must be a valid timestamp');
      if (expiresAt > Date.now() + MAX_EXPIRY_MS + (5 * 60 * 1000)) throw new Error('Expiry cannot be more than 24 hours away');
      row.expiresAt = expiresAt;
    }
    const description = text(raw.description, 500, 'Description');
    const filename = text(raw.filename, 255, 'Filename');
    const bingeGroup = text(raw.bingeGroup, 160, 'Binge group');
    if (description) row.description = description;
    if (filename) row.filename = filename;
    if (bingeGroup) row.bingeGroup = bingeGroup;
    return row;
  }

  function normalizeRows(input, partial) {
    if (!Array.isArray(input)) throw new Error('Import an array or an object containing customStreams');
    if (input.length > MAX_ROWS) throw new Error(`A maximum of ${MAX_ROWS} rows can be imported`);
    const rows = [];
    const errors = [];
    input.forEach((raw, index) => {
      try { rows.push(normalizeRow(raw)); }
      catch (error) { errors.push({ index, message: error.message }); }
    });
    if (errors.length && !partial) throw new Error(`Row ${errors[0].index + 1}: ${errors[0].message}`);
    const bytes = new TextEncoder().encode(JSON.stringify(rows)).length;
    if (bytes > MAX_BYTES) throw new Error('Custom Streams is larger than 256 KB');
    return { rows, errors, bytes };
  }

  function maskedUrl(value) {
    try {
      const parsed = new URL(value);
      const tail = parsed.pathname.split('/').filter(Boolean).pop() || '';
      return `${parsed.protocol}//${parsed.host}/${tail ? `…/${tail}` : '…'}`;
    } catch { return 'Invalid URL'; }
  }

  function targetLabel(row) {
    if (!row.ids || row.ids.length === 0) return row.type === '*' ? 'Every title' : `Every ${row.type}`;
    if (row.ids.length === 1) return row.ids[0];
    return `${row.ids[0]} +${row.ids.length - 1}`;
  }

  function isActive(row, now) {
    return row?.expiresAt == null || Number(row.expiresAt) > (now ?? Date.now());
  }

  function expiryLabel(row, now) {
    if (row?.expiresAt == null) return 'No automatic expiry';
    const remaining = Number(row.expiresAt) - (now ?? Date.now());
    if (remaining <= 0) return 'Expired';
    const minutes = Math.max(1, Math.ceil(remaining / 60000));
    if (minutes < 60) return `Expires in ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const extraMinutes = minutes % 60;
    return `Expires in ${hours}h${extraMinutes ? ` ${extraMinutes}m` : ''}`;
  }

  class Editor {
    constructor(options) {
      this.options = options || {};
      this.editIndex = -1;
      this.searchResults = [];
      this.selection = null;
      this.episodes = [];
      this.searchTimer = null;
      this.searchSequence = 0;
      if (typeof window !== 'undefined') this.expiryTimer = window.setInterval(() => this.render(), 30000);
    }

    rows() { return Array.isArray(this.options.getRows?.()) ? this.options.getRows() : []; }
    toast(message, type) { this.options.toast?.(message, type); }
    changed() { this.options.changed?.(); }

    modeChanged() { this.renderSelection(); }
    typeChanged() { this.renderSelection(); }

    searchChanged() {
      clearTimeout(this.searchTimer);
      const query = String(document.getElementById('csTitleSearch')?.value || '').trim();
      if (query.length < 2) {
        this.searchSequence++;
        const results = document.getElementById('csSearchResults');
        if (results) { results.innerHTML = ''; results.hidden = true; }
        return;
      }
      this.searchTimer = setTimeout(() => this.search(), 320);
    }

    async seasonChanged() {
      const rawSeason = String(document.getElementById('csSeason')?.value || '');
      const season = Number(rawSeason);
      const episodeSelect = document.getElementById('csEpisode');
      const status = document.getElementById('csEpisodeStatus');
      if (!episodeSelect || !rawSeason || !Number.isInteger(season)) {
        if (episodeSelect) { episodeSelect.innerHTML = '<option value="">Choose an episode</option>'; episodeSelect.disabled = true; }
        if (status) status.textContent = 'Choose a season to load its episodes.';
        return;
      }
      episodeSelect.disabled = true;
      episodeSelect.innerHTML = '<option value="">Loading episodes…</option>';
      status.textContent = 'Loading episodes from TMDB…';
      let rows = [];
      try {
        const token = this.options.getSearchToken?.();
        if (token) {
          const tmdb = this.selection.tmdbId ? `?tmdbId=${encodeURIComponent(this.selection.tmdbId)}` : '';
          const response = await fetch(`/${encodeURIComponent(token)}/custom-streams/series/${encodeURIComponent(this.selection.id)}/season/${season}.json${tmdb}`);
          rows = response.ok ? (await response.json()).episodes || [] : [];
        } else if (this.options.accountSearch === true) {
          const tmdb = this.selection.tmdbId ? `&tmdbId=${encodeURIComponent(this.selection.tmdbId)}` : '';
          const response = await fetch(`/api/account/custom-streams/episodes?id=${encodeURIComponent(this.selection.id)}&season=${season}${tmdb}`, { credentials: 'same-origin' });
          rows = response.ok ? (await response.json()).episodes || [] : [];
        }
      } catch { rows = []; }
      this.episodes = rows.map(item => ({ season: Number(item.season), episode: Number(item.episode), name: item.name || item.title || '' }))
        .filter(item => item.season === season && Number.isInteger(item.episode) && item.episode >= 1);
      episodeSelect.innerHTML = '<option value="">Choose an episode</option>' + this.episodes.map(item =>
        `<option value="${item.episode}">E${item.episode} · ${this.options.escape(item.name || `Episode ${item.episode}`)}</option>`
      ).join('');
      episodeSelect.disabled = this.episodes.length === 0;
      status.textContent = this.episodes.length ? `${this.episodes.length} episode${this.episodes.length === 1 ? '' : 's'} available in Season ${season}.` : 'No episodes were returned for this season.';
    }

    formRow() {
      if (!this.selection || !/^tt\d+$/.test(this.selection.id || '')) throw new Error('Search for and select a movie or series first');
      const type = this.selection.type;
      const row = {
        name: this.selection.name,
        url: document.getElementById('csUrl')?.value,
        type,
        tmdbId: this.selection.tmdbId,
      };
      const expirySeconds = Number(document.getElementById('csExpiry')?.value);
      if (!Number.isInteger(expirySeconds) || expirySeconds <= 0 || expirySeconds > 86400) {
        throw new Error('Choose a valid automatic expiry');
      }
      row.expiresAt = Date.now() + (expirySeconds * 1000);
      if (type === 'series') {
        const rawSeason = String(document.getElementById('csSeason')?.value || '');
        const rawEpisode = String(document.getElementById('csEpisode')?.value || '');
        const season = Number(rawSeason);
        const episode = Number(rawEpisode);
        const exists = this.episodes.some(item => item.season === season && item.episode === episode);
        if (!rawSeason || !rawEpisode || !exists) throw new Error('Choose an available season and episode');
        row.ids = [`${this.selection.id}:${season}:${episode}`];
      } else {
        row.ids = [this.selection.id];
      }
      const old = this.editIndex >= 0 ? this.rows()[this.editIndex] : null;
      if (old?.bingeGroup) row.bingeGroup = old.bingeGroup;
      return normalizeRow(row);
    }

    save() {
      try {
        const row = this.formRow();
        const rows = this.rows().slice();
        if (this.editIndex >= 0) rows[this.editIndex] = row;
        else rows.push(row);
        const normalized = normalizeRows(rows, false).rows;
        this.options.setRows?.(normalized);
        this.toast(this.editIndex >= 0 ? 'Custom stream updated' : 'Custom stream added', 'success');
        this.reset();
        this.render();
        this.changed();
      } catch (error) { this.toast(error.message, 'error'); }
    }

    async edit(index) {
      const row = this.rows()[index];
      if (!row) return;
      const onlyId = Array.isArray(row.ids) && row.ids.length === 1 ? row.ids[0] : '';
      const match = onlyId.match(/^(tt\d+)(?::(\d+):(\d+))?$/);
      if (!match) return this.toast('This older global or multi-title mapping can be removed, but not edited in the simplified editor.', 'info');
      this.editIndex = index;
      this.selection = { id: match[1], type: row.type === 'series' ? 'series' : 'movie', name: row.name || match[1], poster: '', tmdbId: row.tmdbId };
      document.getElementById('csUrl').value = row.url || '';
      const expiry = document.getElementById('csExpiry');
      if (expiry) {
        if (row.expiresAt) {
          const remaining = Math.max(0, Number(row.expiresAt) - Date.now());
          const choices = [...expiry.options].map(option => Number(option.value)).filter(Number.isFinite);
          expiry.value = String(choices.reduce((best, seconds) => Math.abs((seconds * 1000) - remaining) < Math.abs((best * 1000) - remaining) ? seconds : best, 10800));
        } else {
          expiry.value = '10800';
        }
      }
      document.getElementById('csSaveButton').textContent = 'Save changes';
      const editorTitle = document.getElementById('csEditorTitle');
      if (editorTitle) editorTitle.textContent = 'Edit stream';
      document.getElementById('csCancelEdit').hidden = false;
      this.renderSelection();
      if (row.type === 'series') {
        await this.loadEpisodes();
        document.getElementById('csSeason').value = match[2] || '';
        await this.seasonChanged();
        document.getElementById('csEpisode').value = match[3] || '';
      }
      document.getElementById('csUrl').focus();
    }

    remove(index) {
      const rows = this.rows().slice();
      rows.splice(index, 1);
      this.options.setRows?.(rows);
      if (this.editIndex === index) this.reset();
      this.render();
      this.changed();
    }

    reset() {
      this.editIndex = -1;
      this.selection = null;
      this.episodes = [];
      for (const id of ['csUrl', 'csTitleSearch']) {
        const input = document.getElementById(id);
        if (input) input.value = '';
      }
      const expiry = document.getElementById('csExpiry');
      if (expiry) expiry.value = '10800';
      document.getElementById('csSaveButton').textContent = 'Add stream';
      const editorTitle = document.getElementById('csEditorTitle');
      if (editorTitle) editorTitle.textContent = 'Add a stream';
      document.getElementById('csCancelEdit').hidden = true;
      const results = document.getElementById('csSearchResults');
      if (results) { results.innerHTML = ''; results.hidden = true; }
      this.renderSelection();
    }

    render() {
      const container = document.getElementById('customStreamsList');
      const empty = document.getElementById('csEmpty');
      if (!container || !empty) return;
      const sourceRows = this.rows();
      const rows = sourceRows.filter(row => isActive(row));
      if (rows.length !== sourceRows.length) {
        this.options.setRows?.(rows);
        if (this.editIndex >= 0) this.reset();
        this.changed();
      }
      empty.hidden = rows.length > 0;
      container.innerHTML = rows.map((row, index) => `
        <div class="cs-row">
          <div class="cs-row-main"><strong>${this.options.escape(row.name)}</strong><span>${this.options.escape(maskedUrl(row.url))}</span><small class="cs-expiry">${this.options.escape(expiryLabel(row))}</small></div>
          <span class="cs-target">${this.options.escape(targetLabel(row))}</span>
          <button class="btn-icon" type="button" onclick="editCustomStream(${index})" title="Edit" ${Array.isArray(row.ids) && row.ids.length === 1 ? '' : 'disabled'}>✎</button>
          <button class="btn-icon cs-remove" type="button" onclick="removeCustomStream(${index})" title="Remove">✕</button>
        </div>`).join('');
    }

    async search() {
      const query = String(document.getElementById('csTitleSearch')?.value || '').trim();
      if (query.length < 2) return;
      const token = this.options.getSearchToken?.();
      const accountSearch = this.options.accountSearch === true;
      if (!token && !accountSearch) return this.toast('Add your required TMDB key first', 'error');
      const resultsBox = document.getElementById('csSearchResults');
      resultsBox.hidden = false;
      resultsBox.innerHTML = '<span class="cs-search-status">Searching…</span>';
      const sequence = ++this.searchSequence;
      try {
        const encoded = encodeURIComponent(query);
        let payloads;
        if (!token && accountSearch) {
          const response = await fetch(`/api/account/custom-streams/search?q=${encoded}`, { credentials: 'same-origin' });
          const payload = response.ok ? await response.json() : { results: [] };
          payloads = [{ metas: (payload.results || []).filter(item => item.type === 'movie') }, { metas: (payload.results || []).filter(item => item.type === 'series') }];
        } else {
          const requests = [
            fetch(`/${encodeURIComponent(token)}/catalog/movie/lelibrary-search-movies/search=${encoded}.json`),
            fetch(`/${encodeURIComponent(token)}/catalog/series/lelibrary-search-series/search=${encoded}.json`),
          ];
          payloads = await Promise.all(requests.map(request => request.then(response => response.ok ? response.json() : { metas: [] })));
        }
        if (sequence !== this.searchSequence) return;
        const seen = new Set();
        this.searchResults = payloads.flatMap((payload, group) => (payload.metas || []).map(meta => ({
          id: String(meta.id || ''), type: group === 0 ? 'movie' : 'series', name: meta.name || meta.title || '', year: meta.releaseInfo || meta.year || '', poster: meta.poster || '', tmdbId: Number(meta.tmdbId) || undefined,
        }))).filter(item => /^tt\d+$/.test(item.id) && !seen.has(item.id) && seen.add(item.id)).slice(0, 12);
        resultsBox.innerHTML = this.searchResults.length ? this.searchResults.map((item, index) => `
          <button type="button" class="cs-search-result" onclick="selectCustomStreamTitle(${index})">
            ${item.poster ? `<img src="${this.options.escape(item.poster)}" alt="">` : '<span class="cs-search-poster">▶</span>'}
            <span><strong>${this.options.escape(item.name)}</strong><small>${this.options.escape(`${item.type === 'movie' ? 'Movie' : 'Series'}${item.year ? ` · ${item.year}` : ''} · ${item.id}`)}</small></span>
          </button>`).join('') : '<span class="cs-search-status">No matching IMDb titles found.</span>';
      } catch { if (sequence === this.searchSequence) resultsBox.innerHTML = '<span class="cs-search-status">Search unavailable. Check the TMDB key and try again.</span>'; }
    }

    async selectSearch(index) {
      const item = this.searchResults[index];
      if (!item) return;
      this.selection = item;
      document.getElementById('csSearchResults').hidden = true;
      this.renderSelection();
      if (item.type === 'series') await this.loadEpisodes();
      (item.type === 'series' ? document.getElementById('csSeason') : document.getElementById('csUrl'))?.focus();
    }

    clearSelection() {
      this.selection = null;
      this.episodes = [];
      const search = document.getElementById('csTitleSearch');
      if (search) search.value = '';
      this.renderSelection();
      search?.focus();
    }

    renderSelection() {
      const selected = document.getElementById('csSelected');
      const picker = document.getElementById('csTargetFields');
      const episodeFields = document.getElementById('csEpisodeFields');
      if (!selected || !picker || !episodeFields) return;
      const item = this.selection;
      picker.hidden = !!item;
      selected.hidden = !item;
      episodeFields.hidden = !item || item.type !== 'series';
      if (!item) {
        selected.innerHTML = '';
        for (const id of ['csSeason', 'csEpisode']) {
          const select = document.getElementById(id);
          if (select) { select.innerHTML = `<option value="">Choose ${id === 'csSeason' ? 'a season' : 'an episode'}</option>`; select.disabled = true; }
        }
        return;
      }
      selected.innerHTML = `
        ${item.poster ? `<img src="${this.options.escape(item.poster)}" alt="">` : '<span class="cs-search-poster">▶</span>'}
        <div><strong>${this.options.escape(item.name)}</strong><small>${this.options.escape(`${item.type === 'series' ? 'Series' : 'Movie'}${item.year ? ` · ${item.year}` : ''} · ${item.id}`)}</small></div>
        <button type="button" onclick="clearCustomStreamSelection()">Change</button>`;
    }

    async loadEpisodes() {
      if (!this.selection || this.selection.type !== 'series') return;
      const seasonSelect = document.getElementById('csSeason');
      const episodeSelect = document.getElementById('csEpisode');
      const status = document.getElementById('csEpisodeStatus');
      seasonSelect.disabled = true;
      episodeSelect.disabled = true;
      status.textContent = 'Loading available episodes from TMDB…';
      try {
        const token = this.options.getSearchToken?.();
        let rows = [];
        if (token) {
          const tmdb = this.selection.tmdbId ? `?tmdbId=${encodeURIComponent(this.selection.tmdbId)}` : '';
          const response = await fetch(`/${encodeURIComponent(token)}/custom-streams/series/${encodeURIComponent(this.selection.id)}/seasons.json${tmdb}`);
          const payload = response.ok ? await response.json() : {};
          rows = payload.seasons || [];
        } else if (this.options.accountSearch === true) {
          const tmdb = this.selection.tmdbId ? `&tmdbId=${encodeURIComponent(this.selection.tmdbId)}` : '';
          const response = await fetch(`/api/account/custom-streams/seasons?id=${encodeURIComponent(this.selection.id)}${tmdb}`, { credentials: 'same-origin' });
          const payload = response.ok ? await response.json() : {};
          rows = payload.seasons || [];
        }
        const seasonRows = rows.map(item => ({ season: Number(item.season), name: String(item.name || '') }))
          .filter(item => Number.isInteger(item.season) && item.season >= 0).sort((a, b) => a.season - b.season);
        const seasons = seasonRows.map(item => item.season);
        seasonSelect.innerHTML = '<option value="">Choose a season</option>' + seasonRows.map(item => `<option value="${item.season}">${this.options.escape(item.name || (item.season === 0 ? 'Specials' : `Season ${item.season}`))}</option>`).join('');
        seasonSelect.disabled = seasons.length === 0;
        episodeSelect.innerHTML = '<option value="">Choose an episode</option>';
        status.textContent = seasons.length ? `${seasons.length} season${seasons.length === 1 ? '' : 's'} available. Choose one to load its episodes.` : 'No episodes were returned for this series.';
      } catch {
        this.episodes = [];
        status.textContent = 'Episodes could not be loaded. Check the TMDB key and try another title.';
      }
    }

    async verify() {
      let url;
      try { url = normalizeUrl(document.getElementById('csUrl')?.value); }
      catch (error) { return this.toast(error.message, 'error'); }
      if (location.protocol === 'https:' && url.startsWith('http:')) {
        return this.toast('URL is valid. Browsers may block HTTP, but a native client on your network can still play it.', 'info');
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        await fetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', signal: controller.signal });
        this.toast('URL responded from this browser. Playback still depends on the client and media format.', 'success');
      } catch {
        this.toast('Could not reach it from this browser. You can still save it for a LAN/native client.', 'info');
      } finally { clearTimeout(timer); }
    }

    async importFile(input) {
      const file = input?.files?.[0];
      if (!file) return;
      try {
        if (file.size > MAX_BYTES) throw new Error('Import file is larger than 256 KB');
        const parsed = JSON.parse(await file.text());
        const incoming = Array.isArray(parsed) ? parsed : parsed?.customStreams;
        const imported = normalizeRows(incoming, true);
        const merged = normalizeRows([...this.rows(), ...imported.rows], false).rows;
        this.options.setRows?.(merged);
        this.render();
        this.changed();
        const rejected = imported.errors.length;
        this.toast(`Imported ${imported.rows.length} stream${imported.rows.length === 1 ? '' : 's'}${rejected ? `; rejected ${rejected} invalid row${rejected === 1 ? '' : 's'}` : ''}.`, rejected ? 'info' : 'success');
      } catch (error) { this.toast(error.message || 'Could not import that file', 'error'); }
      finally { input.value = ''; }
    }

    exportRows() {
      if (!this.rows().length) return this.toast('There are no Custom Streams to export', 'error');
      const blob = new Blob([JSON.stringify({ version: 1, customStreams: this.rows() }, null, 2)], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = 'lelibrary-custom-streams.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      this.toast('Exported. Keep the file private: stream URLs may contain signed access parameters.', 'info');
    }
  }

  const api = { Editor, normalizeRow, normalizeRows, maskedUrl, targetLabel, isActive, expiryLabel };
  root.LeCustomStreamsEditor = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
