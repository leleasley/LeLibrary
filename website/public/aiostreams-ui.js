/* My AIOStreams connector UI (shared).
 *
 * One small module used by the public and account Configure pages. It owns the
 * connector card, the connect/replace/remove modal, validation states and the
 * loop confirmation. Each page passes a small storage adapter so the UI never
 * knows whether the secret lives in the account vault or a self-host record.
 *
 * Styling reuses the app's own classes (connect-box, app-modal, btn/btn-gen/
 * btn-outline/btn-danger, field-hint) so it matches both Configure pages
 * without adding new CSS.
 *
 * The configured URL is never kept in the DOM after connecting, never logged in
 * full, and never re-displayed. Only the adapter sees it.
 */
(function () {
  'use strict';

  const CHIP = 'display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:0.72rem;font-weight:600;border:1px solid var(--border2);color:var(--muted)';
  const CHIP_OK = 'display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:0.72rem;font-weight:600;border:1px solid rgba(52,211,153,0.4);color:#34d399;background:rgba(52,211,153,0.12)';
  const NOTE = 'font-size:0.74rem;color:var(--muted);line-height:1.5;margin:0';

  function mk(tag, cls, style, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (style) n.style.cssText = style;
    if (text != null) n.textContent = text;
    return n;
  }

  function chip(connected) {
    const c = mk('span', '', connected ? CHIP_OK : CHIP);
    c.append(mk('span', '', 'width:7px;height:7px;border-radius:50%;background:currentColor'));
    c.append(document.createTextNode(connected ? 'Connected' : 'Not connected'));
    return c;
  }

  function mount(opts) {
    const host = typeof opts.el === 'string' ? document.getElementById(opts.el) : opts.el;
    const adapter = opts.adapter || {};
    if (!host || !adapter) return null;
    let state = { connected: false, name: null, version: null, logo: null, fingerprint: null, ref: (opts.initial && opts.initial.ref) || null };

    host.replaceChildren();
    const card = mk('div', 'connect-box');
    const head = mk('div', 'cb-head');
    const title = mk('h3', '', 'color:var(--white);font-size:0.95rem;margin:0', 'My AIOStreams');
    const chipSlot = mk('span');
    head.append(title, chipSlot);
    const desc = mk('p', '', NOTE, 'Use your own configured AIOStreams install as an extra stream source for public IMDb rows. The URL stays on the server and is never added to your install link.');
    const actions = mk('div', 'connect-form');
    const scope = mk('p', '', NOTE, 'AIOStreams appears only on public IMDb rows. My Library and Collections need "Use Main metadata" enabled to use it.');
    card.append(head, desc, actions, scope);
    host.append(card);

    function setStatus(msg, isError) {
      const s = mk('p', '', NOTE + (isError ? ';color:#f87171' : ';color:#34d399'), msg);
      s.setAttribute('role', 'status');
      s.setAttribute('aria-live', 'polite');
      desc.after(s);
      setTimeout(() => s.remove(), 6000);
    }

    function render() {
      chipSlot.replaceChildren(chip(state.connected));
      actions.replaceChildren();
      if (state.connected) {
        const meta = mk('span', '', NOTE, (state.name || 'AIOStreams') + (state.version ? ' v' + state.version : ''));
        const test = mk('button', 'btn-main btn-outline show', '', 'Test again'); test.type = 'button';
        const replace = mk('button', 'btn-main btn-outline show', '', 'Replace'); replace.type = 'button';
        const remove = mk('button', 'btn-main btn-danger', '', 'Remove'); remove.type = 'button';
        test.onclick = () => doTest(test);
        replace.onclick = () => openModal();
        remove.onclick = () => doRemove(remove);
        actions.append(meta, test, replace, remove);
      } else {
        const connect = mk('button', 'btn-main btn-gen', '', 'Connect'); connect.type = 'button';
        connect.onclick = () => openModal();
        actions.append(connect);
      }
      if (typeof opts.onState === 'function') opts.onState({ connected: state.connected, ref: state.ref });
    }

    async function refresh() {
      try {
        if (typeof adapter.status === 'function') {
          const s = await adapter.status();
          if (s) state = { ...state, ...s };
        }
      } catch (_) { /* keep last state */ }
      render();
    }

    async function doTest(btn) {
      btn.disabled = true; btn.textContent = 'Testing…';
      try {
        const r = (typeof adapter.test === 'function') ? await adapter.test() : await adapter.status();
        if (r && r.ok !== false && r.connected !== false) setStatus('AIOStreams is reachable.');
        else setStatus('Could not reach AIOStreams. Check the URL and try again.', true);
      } catch (_) { setStatus('Could not reach AIOStreams.', true); }
      btn.disabled = false; btn.textContent = 'Test again';
      refresh();
    }

    async function doRemove(btn) {
      btn.disabled = true; btn.textContent = 'Removing…';
      try {
        await adapter.remove();
        state = { connected: false, name: null, version: null, logo: null, fingerprint: null, ref: null };
        setStatus('AIOStreams removed.');
      } catch (_) { setStatus('Could not remove AIOStreams.', true); }
      render();
    }

    function openModal() {
      const overlay = mk('div', 'app-modal show');
      const box = mk('div', 'app-modal-box');
      const mhead = mk('div', 'app-modal-head');
      mhead.append(mk('h3', '', '', 'Connect My AIOStreams'));
      const x = mk('button', 'app-modal-x', '', '✕');
      x.type = 'button'; x.setAttribute('aria-label', 'Close');
      mhead.append(x);
      const body = mk('div', 'app-modal-body');
      const intro = mk('p', '', '', 'Paste the fully configured AIOStreams install URL that ends in /manifest.json. It is stored encrypted on the server and is never added to your LeLibrary install link.');
      const urlLabel = mk('label', '', 'display:block;font-size:0.78rem;font-weight:600;color:var(--text);margin:4px 0 8px', 'AIOStreams manifest URL');
      urlLabel.setAttribute('for', 'aioStreamsUrl');
      const input = mk('input'); input.type = 'url'; input.id = 'aioStreamsUrl';
      input.placeholder = 'https://your-aiostreams.example/uuid/password/manifest.json';
      input.autocomplete = 'off'; input.spellcheck = false;
      const loopLabel = mk('label', '', 'display:flex;gap:8px;align-items:flex-start;font-size:0.76rem;color:var(--muted);line-height:1.5;cursor:pointer');
      const loop = mk('input'); loop.type = 'checkbox'; loop.style.marginTop = '2px';
      loopLabel.append(loop, document.createTextNode(' I understand this AIOStreams setup must not also include this LeLibrary setup, which would loop.'));
      const status = mk('p', '', 'font-size:0.76rem;color:#f87171;margin:10px 0 0;min-height:1em');
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      body.append(intro, urlLabel, input, loopLabel, status);
      const facts = mk('div', 'app-modal-actions');
      const cancel = mk('button', 'btn-main btn-outline show', '', 'Cancel'); cancel.type = 'button';
      const save = mk('button', 'btn-main btn-gen', '', 'Verify & connect'); save.type = 'button';
      facts.append(cancel, save);
      box.append(mhead, body, facts);
      overlay.append(box);
      document.body.append(overlay);
      input.focus();

      function close() {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        if (typeof opts.onFocusReturn === 'function') opts.onFocusReturn();
      }
      function onKey(e) { if (e.key === 'Escape') close(); }
      document.addEventListener('keydown', onKey);
      x.onclick = close; cancel.onclick = close;
      overlay.onclick = (e) => { if (e.target === overlay) close(); };
      save.onclick = async () => {
        const url = input.value.trim();
        if (!/^https:\/\//i.test(url) || !/\/manifest\.json$/i.test(url)) { status.textContent = 'Enter the https URL that ends in /manifest.json.'; return; }
        if (!loop.checked) { status.textContent = 'Please confirm the loop warning first.'; return; }
        status.textContent = '';
        save.disabled = true; save.textContent = 'Checking…';
        try {
          const r = await adapter.connect(url);
          if (r && r.ok) {
            state = { connected: true, name: r.name || 'AIOStreams', version: r.version || null, logo: r.logo || null, fingerprint: r.fingerprint || null, ref: r.ref || null };
            close(); setStatus('AIOStreams connected.'); render();
          } else {
            status.textContent = (r && r.error) ? r.error : 'Could not connect. Check the URL is a valid AIOStreams manifest.';
          }
        } catch (_) {
          status.textContent = 'Could not connect. Try again.';
        }
        save.disabled = false; save.textContent = 'Verify & connect';
      };
    }

    render();
    refresh();
    return {
      get: () => ({ connected: state.connected, ref: state.ref }),
      refresh,
    };
  }

  window.LeAioStreams = { mount };
})();
