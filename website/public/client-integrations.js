(function (root) {
  'use strict';

  const COPY = {
    strmr: ['STRMR', 'Copy a compatible manifest for STRMR.'],
    fusion: ['Fusion', 'Copy a compatible manifest for Fusion.'],
    vidi: ['Vidi', 'Copy a compatible manifest for Vidi.'],
    wuplay: ['WuPlay', 'Copy a compatible manifest for WuPlay.'],
  };

  const LOGOS = {
    strmr: '/client-logos/strmr.png',
    fusion: '/client-logos/fusion.jpg',
    vidi: '/client-logos/vidi.png',
    wuplay: '/client-logos/wuplay.png',
  };

  function integrationManifest(legacyUrl, client) {
    if (!legacyUrl) return '';
    try {
      const base = typeof location !== 'undefined' ? location.origin : 'http://localhost';
      const url = new URL(legacyUrl, base);
      url.search = '';
      url.hash = '';
      url.pathname = url.pathname.replace(/\/i\/[a-z0-9-]+\/manifest\.json$/i, '/manifest.json');
      if (!url.pathname.endsWith('/manifest.json')) return '';
      url.pathname = url.pathname.replace(/\/manifest\.json$/, `/i/${encodeURIComponent(client)}/manifest.json`);
      return url.href;
    } catch { return ''; }
  }

  class ClientList {
    constructor(element, options) {
      this.element = element;
      this.options = options || {};
      this.clients = [];
      element.addEventListener('click', event => {
        const button = event.target.closest('[data-client-copy]');
        if (button) this.copy(button.dataset.clientCopy, button);
      });
    }

    toast(message, type) { this.options.toast?.(message, type); }

    async load() {
      try {
        const response = await fetch('/api/client-integrations', { cache: 'force-cache' });
        const payload = response.ok ? await response.json() : { clients: [] };
        this.clients = (payload.clients || []).filter(client => COPY[client.id]);
      } catch { this.clients = Object.keys(COPY).map(id => ({ id, label: COPY[id][0], status: 'testing' })); }
      this.render();
    }

    manifest(client) { return integrationManifest(this.options.getManifestUrl?.() || '', client); }

    async copy(client, button) {
      const manifest = this.manifest(client);
      if (!manifest) return this.toast('Save or generate this setup first', 'error');
      try {
        await navigator.clipboard.writeText(manifest);
        const message = button.querySelector('[data-client-message]');
        const old = message?.textContent;
        if (message) message.textContent = 'Manifest copied';
        setTimeout(() => { if (message) message.textContent = old; }, 1400);
        this.toast(`${COPY[client][0]} manifest copied`, 'success');
      } catch { this.toast('Could not copy the manifest URL', 'error'); }
    }

    render() {
      this.element.innerHTML = `<div class="client-integration-heading"><div><strong>More client integrations</strong><small>Choose an app to copy its compatible manifest.</small></div></div><div class="client-integration-list">${this.clients.map(client => {
        const info = COPY[client.id];
        const status = client.status === 'supported' ? 'supported' : 'testing';
        return `<button type="button" class="client-integration-row" data-client-copy="${client.id}" aria-label="Copy ${info[0]} manifest"><span class="client-integration-icon client-integration-icon-${client.id}" aria-hidden="true"><img src="${LOGOS[client.id]}" alt=""></span><span class="client-integration-copy"><span class="client-integration-title"><strong>${info[0]}</strong><span class="client-status ${status}">${status === 'supported' ? 'Supported' : 'Testing'}</span></span><small data-client-message aria-live="polite">${info[1]}</small></span><b aria-hidden="true">›</b></button>`;
      }).join('')}</div>`;
    }
  }

  const api = {
    integrationManifest,
    mount(element, options) { if (!element) return null; const list = new ClientList(element, options); list.load(); return list; },
  };
  root.LeClientIntegrations = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
