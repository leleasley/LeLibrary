'use strict';
const { protocolManifest } = require('../manifest');
module.exports = {
  id: 'strmr', label: 'STRMR', status: 'testing', manifestMode: 'stremio',
  manifest: ({ manifest }) => protocolManifest(manifest, { types: ['movie', 'series'], idPrefixes: ['torbox:', 'tt'] }),
  capabilities: { resources: ['catalog', 'meta', 'stream'], types: ['movie', 'series'], nativeFolderPush: false, acceptsBaseUrl: true, search: true, requiresScreenPlacement: true, directHttpStreams: true },
  requestPolicy: { manifestMs: 2500, catalogMs: 11000, metaMs: 11000, streamMs: 15000, externalMs: 9000 },
};
