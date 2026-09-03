(function (root) {
  'use strict';
  const LOCAL = '/api/nuvio-badges/lelibrary-premium.json';
  const PACKS = [
    { id: 'lelibrary-premium', name: 'LeLibrary Premium', url: LOCAL, local: true, description: 'Original local 4K, REMUX, HDR, audio, codec and language badges.' },
    { id: 'nard-full', name: 'NardBadges Full', url: 'https://raw.githubusercontent.com/vowl313/NardBadges/refs/heads/main/NardBadges.json', description: 'Community full set with tier styling.' },
    { id: 'nard-slim', name: 'NardBadges Slim', url: 'https://raw.githubusercontent.com/vowl313/NardBadges/refs/heads/main/NardBadges_Slim.json', description: 'Community set without tier indicators.' },
    { id: 'better-colored', name: 'BetterFormatter Colored', url: 'https://raw.githubusercontent.com/9mousaa/BetterFormatter/main/presets/colored-bgb-combo-always.json', description: 'Community coloured badge-combo layout.' },
    { id: 'better-mono', name: 'BetterFormatter Mono', url: 'https://raw.githubusercontent.com/9mousaa/BetterFormatter/main/presets/mono-bgb-combo-nodv.json', description: 'Community monochrome badge-combo layout.' },
    { id: 'elite', name: 'Elite Badges', url: 'https://raw.githubusercontent.com/leonevz/Elite-Badges/main/badges.json', description: 'Community premium-styled badge set.' },
    { id: 'minimal-white', name: 'Minimalist White', url: 'https://raw.githubusercontent.com/sweatycab/nuvio-minimalist-badges/main/badges-white.json', description: 'Community high-contrast TV-friendly badges.' },
    { id: 'minimal-mixed', name: 'Minimalist Mixed', url: 'https://raw.githubusercontent.com/sweatycab/nuvio-minimalist-badges/main/badges-mixed.json', description: 'Community mixed-colour minimalist badges.' },
    { id: 'custom', name: 'Choose your own…', url: '', description: 'Paste any HTTPS badge JSON URL.' },
  ];
  const LOCAL_SAMPLE = ['res-4k', 'source-remux', 'visual-dv', 'audio-atmos', 'ch-71', 'codec-hevc'];
  const SAMPLE_STREAM_TEXT = 'Toy Story 2 1999 2160p BluRay HEVC TrueHD 7.1 Atmos FRDS 2.63 GB';
  const remotePreviews = new Map();
  function esc(v) { return String(v || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]); }
  function validUrl(value) { try { const u = new URL(value); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } }
  function cssColor(value, fallback = '#858283') {
    const raw = String(value || '').trim();
    const match = /^#([0-9a-f]{8})$/i.exec(raw);
    if (match) return `#${match[1].slice(2)}${match[1].slice(0, 2)}`; // Nuvio stores AARRGGBB.
    return /^#[0-9a-f]{6}$/i.test(raw) ? raw : fallback;
  }
  function copy(value) { return navigator.clipboard?.writeText(value).catch(() => { const area = document.createElement('textarea'); area.value = value; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); }); }
  function remoteBadgeMatches(filters, manifestGroups, manifestUrl) {
    const seenGroups = new Set();
    const groupStyles = new Map((Array.isArray(manifestGroups) ? manifestGroups : []).map(group => [group?.id, group]));
    const matches = [];
    for (const filter of Array.isArray(filters) ? filters : []) {
      const imageURL = filter?.imageURL || filter?.imageUrl;
      if (!imageURL || !filter?.pattern) continue;
      const group = filter.groupId || filter.group || filter.name || imageURL;
      if (seenGroups.has(group)) continue;
      try {
        const expression = String(filter.pattern).replace(/^\(\?[imsuxU-]+\)/, '');
        if (!new RegExp(expression, 'i').test(SAMPLE_STREAM_TEXT)) continue;
        const resolved = new URL(imageURL, manifestUrl).href;
        if (!validUrl(resolved)) continue;
        seenGroups.add(group);
        const groupStyle = groupStyles.get(filter.groupId) || {};
        matches.push({ name: filter.name || 'Badge', imageURL: resolved, borderColor: cssColor(filter.borderColor || groupStyle.borderColor || groupStyle.color), tagColor: cssColor(filter.tagColor || groupStyle.color, 'transparent'), bordered: /border/i.test(String(filter.tagStyle || '')) });
        if (matches.length === 7) break;
      } catch { /* A Nuvio-only regex can simply be skipped in this browser preview. */ }
    }
    return matches;
  }
  function loadRemotePreview(url, onReady) {
    if (!validUrl(url)) return;
    const cached = remotePreviews.get(url);
    if (cached?.state === 'ready' || cached?.state === 'failed' || cached?.state === 'loading') return;
    remotePreviews.set(url, { state: 'loading', badges: [] });
    fetch(url, { cache: 'force-cache' })
      .then(response => { if (!response.ok) throw new Error('Badge manifest unavailable'); return response.json(); })
      .then(data => { remotePreviews.set(url, { state: 'ready', badges: remoteBadgeMatches(data?.filters, data?.groups, url) }); onReady?.(); })
      .catch(() => { remotePreviews.set(url, { state: 'failed', badges: [] }); onReady?.(); });
  }
  function previewHtml(pack, url) {
    const preset = PACKS.find(p => p.id === pack) || PACKS[0];
    if (preset.local) return `<div class="stream-badge-preview" aria-label="LeLibrary Premium badge preview"><span>BADGES</span>${LOCAL_SAMPLE.map(id => `<img src="/api/nuvio-badges/lelibrary-premium/${id}.svg" alt="">`).join('')}</div>`;
    const preview = remotePreviews.get(url);
    if (preview?.state === 'ready' && preview.badges.length) return `<div class="stream-badge-preview" aria-label="${esc(preset.name)} badge preview"><span>BADGES</span>${preview.badges.map(badge => `<i class="stream-badge-remote${badge.bordered ? ' is-bordered' : ''}" style="--badge-border:${esc(badge.borderColor)};--badge-fill:${esc(badge.tagColor)}"><img src="${esc(badge.imageURL)}" alt="${esc(badge.name)}" title="${esc(badge.name)}" loading="lazy"></i>`).join('')}</div>`;
    const detail = preview?.state === 'loading' ? 'Loading matching badge images…' : preview?.state === 'failed' ? 'Badge images could not be fetched by this browser.' : 'Loading badge images…';
    return `<div class="stream-badge-preview stream-badge-preview-note"><span>BADGES</span><strong>${esc(preset.name)}</strong><small>${detail}</small></div>`;
  }
  function mount(element, { pack = 'lelibrary-premium', url = '', onChange = () => {}, onPreviewChange = () => {} } = {}) {
    if (!element) return null;
    let selected = PACKS.some(p => p.id === pack) ? pack : (url ? 'custom' : 'lelibrary-premium');
    let custom = url || '';
    function current() { const preset = PACKS.find(p => p.id === selected) || PACKS[0]; const url = selected === 'custom' ? custom.trim() : new URL(preset.url, location.origin).href; return { pack: selected, url: validUrl(url) ? url : '' }; }
    function notify() { const value = current(); onChange(value); return value; }
    function loadPreview() { const value = current(); if (selected !== 'lelibrary-premium') loadRemotePreview(value.url, onPreviewChange); }
    function render() {
      const preset = PACKS.find(p => p.id === selected) || PACKS[0];
      const value = current();
      element.innerHTML = `<div class="badge-pack-picker"><div class="field"><label class="field-label" for="nuvioBadgePack">Nuvio badge pack</label><select id="nuvioBadgePack">${PACKS.map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select><small class="field-hint">Independent from stream formatting. Nuvio imports this once per profile.</small></div>${selected === 'custom' ? `<div class="field"><label class="field-label" for="nuvioBadgeUrl">Badge JSON URL</label><input type="url" id="nuvioBadgeUrl" class="badge-url-input" value="${esc(custom)}" placeholder="https://example.com/badges.json" inputmode="url" autocapitalize="none" spellcheck="false"><small class="field-hint" id="badgeUrlHint">Use a direct HTTP(S) JSON URL.</small></div>` : ''}<div class="badge-pack-info"><strong>${esc(preset.name)}</strong><span>${esc(preset.description)}</span></div>${preset.local ? '' : `<div class="badge-pack-external">This pack stays hosted by its community maintainer. Its official URL will be copied below.</div>`}<div class="badge-pack-actions"><button type="button" class="btn-copy-url" id="copyBadgeJson" ${!validUrl(value.url) ? 'disabled' : ''}>Copy badge JSON URL</button><a class="btn-copy-url" href="https://nuvio.wiki/settings/badges" target="_blank" rel="noopener">Nuvio import help</a></div></div>`;
      element.querySelector('#nuvioBadgePack').addEventListener('change', e => { selected = e.target.value; render(); loadPreview(); notify(); onPreviewChange(); });
      element.querySelector('#nuvioBadgeUrl')?.addEventListener('input', e => { custom = e.target.value; element.querySelector('#badgeUrlHint').textContent = validUrl(custom.trim()) ? 'Ready to copy into Nuvio.' : 'Enter a valid HTTP(S) JSON URL.'; element.querySelector('#copyBadgeJson').disabled = !validUrl(custom.trim()); loadPreview(); notify(); onPreviewChange(); });
      element.querySelector('#copyBadgeJson').addEventListener('click', () => { const next = current(); if (validUrl(next.url)) copy(next.url); });
    }
    render(); loadPreview();
    return { set(nextPack, nextUrl) { selected = PACKS.some(p => p.id === nextPack) ? nextPack : (nextUrl ? 'custom' : 'lelibrary-premium'); custom = nextUrl || ''; render(); loadPreview(); onPreviewChange(); }, get: current };
  }
  root.LeBadgePacks = { PACKS, mount, previewHtml, validUrl };
})(window);
