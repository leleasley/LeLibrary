/* Pictorium Poster Studio.
   Shared by the legacy and account configure pages. Pictorium is a separate
   AGPL-3.0 service; this only builds the option set and shows a live preview
   through LeLibrary's poster proxy. */
(function (root) {
  'use strict';

  var OPT = root.LePictoriumOptions;
  if (!OPT) return;

  var STATE = null;
  var ELS = null;

  var DEFAULT_SAMPLE = { type: 'movie', id: '550', title: 'Fight Club' };

  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    if (attrs) for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (html != null) node.innerHTML = html;
    return node;
  }

  function seg(options, current, onPick) {
    var wrap = el('div', { 'class': 'picstudio-seg' });
    options.forEach(function (opt) {
      var b = el('button', { type: 'button' }, opt.label);
      if (String(current) === String(opt.value)) b.classList.add('active');
      b.addEventListener('click', function () {
        wrap.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        onPick(opt.value);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function selectField(list, current, onPick) {
    var select = el('select');
    (list || []).forEach(function (pair) {
      var opt = el('option', { value: pair[0] }, pair[1]);
      if (String(current) === String(pair[0])) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', function () { onPick(select.value); });
    return select;
  }

  function toggle(label, value, onPick) {
    var wrap = el('label', { 'class': 'picstudio-switch' });
    wrap.appendChild(el('span', null, label));
    var input = el('input', { type: 'checkbox' });
    input.checked = value !== '0';
    input.addEventListener('change', function () { onPick(input.checked ? '1' : '0'); });
    wrap.appendChild(input);
    return wrap;
  }

  function checks(list, values, onToggle) {
    var wrap = el('div', { 'class': 'picstudio-seg' });
    var selected = {};
    (values || []).forEach(function (value) { selected[String(value)] = true; });
    list.forEach(function (opt) {
      var b = el('button', { type: 'button' }, opt.label);
      if (selected[String(opt.value)]) b.classList.add('active');
      b.addEventListener('click', function () {
        var nowOn = !b.classList.contains('active');
        b.classList.toggle('active', nowOn);
        onToggle(opt.value, nowOn);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function buildModal() {
    var overlay = el('div', { 'class': 'picstudio-overlay', id: 'picstudioOverlay' });
    overlay.innerHTML = [
      '<div class="picstudio" role="dialog" aria-modal="true" aria-label="Poster Studio">',
      '  <div class="picstudio-head">',
      '    <div><span class="picstudio-kicker">Poster Studio</span><h3>Build your posters</h3>',
      '      <p>Live artwork with ratings, quality and ranking, rendered by Pictorium. No paid poster key: your existing TMDB key is used.</p></div>',
      '    <button type="button" class="picstudio-close" aria-label="Close">&#10005;</button>',
      '  </div>',
      '  <div class="picstudio-body">',
      '    <div class="picstudio-form">',
      '      <div class="picstudio-tabs">',
      '        <button type="button" data-tab="style" class="active">Style</button>',
      '        <button type="button" data-tab="badges">Badges</button>',
      '        <button type="button" data-tab="ratings">Ratings</button>',
      '        <button type="button" data-tab="background">Background</button>',
      '      </div>',
      '      <div class="picstudio-group active" data-group="style">',
      '        <div class="picstudio-field"><label>Badge style</label><div data-field="bs"></div></div>',
      '        <div class="picstudio-field"><label>Ranking badge</label><div data-field="rs"></div><p class="picstudio-hint">Automatic uses the Netflix Top 10 ribbon when the title has a rank.</p></div>',
      '        <div class="picstudio-field"><label>Ribbon and logo side</label><div data-field="side"></div></div>',
      '        <div class="picstudio-row"><div class="picstudio-field"><label>Metadata language</label><div data-field="lang"></div></div>',
      '        <div class="picstudio-field"><label>Region</label><div data-field="region"></div></div></div>',
      '        <p class="picstudio-hint" style="margin:-8px 0 0">Region drives the ranking charts, streaming quality and the cinema release detection.</p>',
      '        <div class="picstudio-row"><div class="picstudio-field"><label>Accent colour</label><div data-field="ac"></div></div>',
      '        <div class="picstudio-field"><label>Coming soon effect</label><div data-field="pre"></div><p class="picstudio-hint">Cinema-only films get a veil and ribbon.</p></div></div>',
      '      </div>',
      '      <div class="picstudio-group" data-group="badges">',
      '        <div class="picstudio-field"><label>Components</label><div data-field="bq"></div><div data-field="br"></div><div data-field="by"></div><div data-field="bg"></div></div>',
      '        <div class="picstudio-field"><label>Show badges</label><div data-field="badges"></div><div data-field="netLogo"></div></div>',
      '      </div>',
      '      <div class="picstudio-group" data-group="ratings">',
      '        <div class="picstudio-field"><label>Rating sources</label><div data-field="rsrc"></div><p class="picstudio-hint">These feed the poster\u2019s aggregate score. Leave only IMDb and TMDB checked for the default mix.</p></div>',
      '      </div>',
      '      <div class="picstudio-group" data-group="background">',
      '        <div class="picstudio-field"><label>Blurred background</label><div data-field="be"></div></div>',
      '        <div class="picstudio-field"><label>Blur strength</label><input type="range" min="0" max="30" step="1" data-range="blur"><p class="picstudio-hint" data-out="blur"></p></div>',
      '        <div class="picstudio-field"><label>Bottom gradient</label><input type="range" min="5" max="100" step="5" data-range="gradHeight"><p class="picstudio-hint" data-out="gradHeight"></p></div>',
      '      </div>',
      '      <div class="picstudio-field" style="margin-top:18px"><label for="picstudioUrl">Your own Pictorium URL (optional)</label>',
      '        <input type="url" id="picstudioUrl" placeholder="https://pictorium.example.com">',
      '        <p class="picstudio-hint">Leave empty to use the built-in studio. Only enter a URL if you self-host your own Pictorium, and it must be a public HTTPS address.</p></div>',
      '    </div>',
      '    <div class="picstudio-preview">',
      '      <h4>Live preview</h4>',
      '      <div class="picstudio-poster" data-preview></div>',
      '    </div>',
      '  </div>',
      '  <div class="picstudio-actions">',
      '    <span class="picstudio-credit">Powered by <a href="https://github.com/Eful97/Pictorium" target="_blank" rel="noopener">Pictorium</a></span>',
      '    <div class="picstudio-buttons"><button type="button" class="picstudio-btn" data-cancel>Cancel</button><button type="button" class="picstudio-btn primary" data-save>Use these posters</button></div>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(overlay);
    return overlay;
  }

  // Slider drags and colour picking fire many input events; coalesce them so
  // the live preview (and the server behind it) is not hammered.
  var previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 140);
  }

  function renderPreview() {
    if (!ELS || !STATE) return;
    var host = ELS.overlay.querySelector('[data-preview]');
    var token = STATE.token;
    var hasCustomPreview = typeof STATE.previewUrl === 'function';
    if (!token && !hasCustomPreview) {
      host.innerHTML = '<div class="picstudio-empty">Save this setup once so the preview and your posters can be built.</div>';
      return;
    }
    var qs = OPT.toQuery(STATE.options);
    var title = encodeURIComponent(STATE.sampleTitle || 'Fight Club');
    var src;
    if (typeof STATE.previewUrl === 'function') {
      // Caller-provided (for example the account wizard's authenticated
      // artwork route, which has no manifest token).
      src = STATE.previewUrl(STATE.options, Date.now());
    } else {
      // The nonce forces a fresh image on every option change, so a style tweak
      // is always visible even if a proxy or browser would otherwise reuse a copy.
      src = '/' + encodeURIComponent(token) + '/pictorium/' + STATE.sampleType + '/' + encodeURIComponent(STATE.sampleId) + '.jpg?preview=1&_=' + Date.now() + '&title=' + title + (qs ? '&' + qs : '');
    }
    host.innerHTML = '<img alt="Poster preview" src="' + src + '">';
    var img = host.querySelector('img');
    if (img) img.onerror = function () {
      host.innerHTML = '<div class="picstudio-empty">Preview is not available right now. Make sure your TMDB key is set, then try again.</div>';
    };
  }

  function setField(name, html) {
    var host = ELS.overlay.querySelector('[data-field="' + name + '"]');
    if (host) host.replaceChildren(html);
  }

  function renderControls() {
    var o = STATE.options;
    setField('bs', seg([
      { value: 'shadow', label: 'Shadow' }, { value: 'pill', label: 'Pill' }, { value: 'bar', label: 'Bar' },
      { value: 'colored', label: 'Colored' }, { value: 'bordo', label: 'Bordo' }, { value: 'vetro', label: 'Glass' },
    ], o.bs, function (v) { o.bs = v; renderPreview(); }));
    setField('rs', seg([
      { value: 'default', label: 'Automatic' }, { value: 'netflix', label: 'Netflix ribbon' }, { value: 'bar', label: 'Bar' },
      { value: 'colored', label: 'Colored' }, { value: 'pill', label: 'Pill' },
    ], o.rs, function (v) { o.rs = v; renderPreview(); }));
    setField('side', seg([
      { value: '', label: 'Automatic' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' },
    ], o.side, function (v) { o.side = v; renderPreview(); }));
    setField('lang', selectField(OPT.LANGUAGES, o.lang, function (v) { o.lang = v; renderPreview(); }));
    setField('region', selectField(OPT.REGIONS, o.region, function (v) { o.region = v; renderPreview(); }));
    setField('rsrc', checks(OPT.RATING_SOURCES.map(function (source) { return { value: source[0], label: source[1] }; }), o.rsrc ? o.rsrc.split(',') : ['imdb', 'tmdb'], function (id, on) {
      var list = o.rsrc ? o.rsrc.split(',') : ['imdb', 'tmdb'];
      if (on && list.indexOf(id) === -1) list.push(id);
      if (!on) list = list.filter(function (item) { return item !== id; });
      o.rsrc = OPT.sanitize({ rsrc: list }).rsrc;
      renderPreview();
    }));
    var colorInput = el('input', { type: 'color', value: /^#[0-9a-f]{6}$/.test(o.ac) ? o.ac : '#f59e0b' });
    var colorWrap = el('div', { 'class': 'picstudio-seg' });
    colorWrap.appendChild(colorInput);
    var clear = el('button', { type: 'button' }, 'Auto');
    if (!o.ac) clear.classList.add('active');
    clear.addEventListener('click', function () { o.ac = ''; colorInput.value = '#f59e0b'; renderControls(); renderPreview(); });
    colorInput.addEventListener('input', function () { o.ac = colorInput.value; schedulePreview(); });
    colorWrap.appendChild(clear);
    setField('ac', colorWrap);
    setField('pre', toggle('Add the Coming soon veil', o.pre === '1' ? '1' : '0', function (v) { o.pre = v === '1' ? '1' : ''; renderPreview(); }));
    setField('bq', toggle('Streaming quality', o.bq, function (v) { o.bq = v; renderPreview(); }));
    setField('br', toggle('Rating', o.br, function (v) { o.br = v; renderPreview(); }));
    setField('by', toggle('Year', o.by, function (v) { o.by = v; renderPreview(); }));
    setField('bg', toggle('Genre', o.bg, function (v) { o.bg = v; renderPreview(); }));
    setField('badges', toggle('Show the genre and rating badge', o.badges, function (v) { o.badges = v; renderPreview(); }));
    setField('netLogo', toggle('Show the network or studio logo', o.netLogo, function (v) { o.netLogo = v; renderPreview(); }));
    setField('be', toggle('Add a blurred backdrop', o.be, function (v) { o.be = v; renderPreview(); }));
    var blur = ELS.overlay.querySelector('[data-range="blur"]');
    blur.value = o.blur;
    ELS.overlay.querySelector('[data-out="blur"]').textContent = 'Strength ' + o.blur;
    blur.oninput = function () { o.blur = parseInt(blur.value, 10); ELS.overlay.querySelector('[data-out="blur"]').textContent = 'Strength ' + o.blur; schedulePreview(); };
    var grad = ELS.overlay.querySelector('[data-range="gradHeight"]');
    grad.value = o.gradHeight;
    ELS.overlay.querySelector('[data-out="gradHeight"]').textContent = 'Height ' + o.gradHeight + '%';
    grad.oninput = function () { o.gradHeight = parseInt(grad.value, 10); ELS.overlay.querySelector('[data-out="gradHeight"]').textContent = 'Height ' + o.gradHeight + '%'; schedulePreview(); };
  }

  function open(config) {
    config = config || {};
    STATE = {
      token: config.token || '',
      options: OPT.sanitize(config.options || {}),
      sampleType: config.sampleType || DEFAULT_SAMPLE.type,
      sampleId: String(config.sampleId || DEFAULT_SAMPLE.id),
      sampleTitle: config.sampleTitle || DEFAULT_SAMPLE.title,
      previewUrl: typeof config.previewUrl === 'function' ? config.previewUrl : null,
      onResolve: null,
    };
    ELS = ELS || { overlay: buildModal() };
    var overlay = ELS.overlay;
    overlay.querySelector('#picstudioUrl').value = config.url || '';
    renderControls();
    renderPreview();
    overlay.classList.add('show');
    return new Promise(function (resolve) {
      STATE.onResolve = resolve;
    });
  }

  function close(result) {
    if (!ELS) return;
    ELS.overlay.classList.remove('show');
    var resolver = STATE && STATE.onResolve;
    STATE = null;
    if (resolver) resolver(result);
  }

  function bindOnce() {
    if (!ELS) ELS = { overlay: buildModal() };
    var overlay = ELS.overlay;
    overlay.querySelector('.picstudio-close').addEventListener('click', function () { close(null); });
    overlay.querySelector('[data-cancel]').addEventListener('click', function () { close(null); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(null); });
    overlay.querySelector('[data-save]').addEventListener('click', function () {
      if (!STATE) return close(null);
      close({ options: OPT.sanitize(STATE.options), url: overlay.querySelector('#picstudioUrl').value.trim() });
    });
    overlay.querySelectorAll('.picstudio-tabs button').forEach(function (tab) {
      tab.addEventListener('click', function () {
        overlay.querySelectorAll('.picstudio-tabs button').forEach(function (t) { t.classList.remove('active'); });
        overlay.querySelectorAll('.picstudio-group').forEach(function (g) { g.classList.remove('active'); });
        tab.classList.add('active');
        overlay.querySelector('[data-group="' + tab.dataset.tab + '"]').classList.add('active');
      });
    });
  }

  root.PictoriumStudio = {
    open: function (config) { bindOnce(); return open(config); },
  };
})(typeof self !== 'undefined' ? self : this);
