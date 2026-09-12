'use strict';

const { freezeAdapter } = require('./contract');
const { installUrls } = require('./install-urls');

const adapters = ['generic', 'stremio', 'nuvio', 'strmr', 'fusion', 'vidi', 'wuplay']
  .map(name => freezeAdapter(require(`./adapters/${name}`)));
const byId = new Map(adapters.map(adapter => [adapter.id, adapter]));

function getClientIntegration(id, { fallback = true } = {}) {
  return byId.get(String(id || '').toLowerCase()) || (fallback ? byId.get('generic') : null);
}

function listClientIntegrations() {
  return adapters.map(adapter => ({ id: adapter.id, label: adapter.label, status: adapter.status, capabilities: adapter.capabilities }));
}

function clientInstallUrls({ origin, token, client }) {
  const adapter = getClientIntegration(client, { fallback: false });
  if (!adapter) return null;
  return installUrls({ origin, token, client: adapter.id, scheme: adapter.deepLinkScheme || '' });
}

module.exports = { getClientIntegration, listClientIntegrations, clientInstallUrls };
