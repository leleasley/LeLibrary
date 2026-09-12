'use strict';

function integrationBase({ origin, token, client }) {
  return `${String(origin).replace(/\/$/, '')}/${encodeURIComponent(token)}/i/${encodeURIComponent(client)}`;
}

function integrationManifestUrl(input) {
  return `${integrationBase(input)}/manifest.json`;
}

function installUrls({ origin, token, client, scheme = '' }) {
  const manifest = integrationManifestUrl({ origin, token, client });
  return {
    base: integrationBase({ origin, token, client }),
    manifest,
    deepLink: scheme ? `${scheme}://${manifest.replace(/^https?:\/\//, '')}` : '',
  };
}

module.exports = { integrationBase, integrationManifestUrl, installUrls };
