'use strict';
const { protocolManifest } = require('../manifest');
module.exports = { id: 'wuplay', label: 'WuPlay', status: 'testing', manifestMode: 'stremio', manifest: ({ manifest }) => protocolManifest(manifest, { types: ['movie', 'series'], idPrefixes: ['torbox:', 'tt'] }), capabilities: { resources: ['catalog', 'meta', 'stream'], types: ['movie', 'series'], nativeFolderPush: false, acceptsBaseUrl: true, search: true, directHttpStreams: true } };
