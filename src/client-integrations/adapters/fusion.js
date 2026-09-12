'use strict';
const { protocolManifest } = require('../manifest');
module.exports = { id: 'fusion', label: 'Fusion', status: 'testing', manifestMode: 'stremio', manifest: ({ manifest }) => protocolManifest(manifest, { types: ['movie', 'series'], idPrefixes: ['torbox:', 'tt'] }), capabilities: { resources: ['catalog', 'meta', 'stream'], types: ['movie', 'series'], nativeFolderPush: false, acceptsBaseUrl: true, search: true, directHttpStreams: true }, requestPolicy: { catalogMs: 20000, metaMs: 20000, streamMs: 25000, externalMs: 15000 } };
