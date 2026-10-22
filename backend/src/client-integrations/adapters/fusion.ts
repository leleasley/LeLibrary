// @ts-nocheck
'use strict';
const { protocolManifest } = require('../manifest.ts');
module.exports = { id: 'fusion', label: 'Fusion', status: 'testing', manifestMode: 'stremio', manifest: ({ manifest }) => protocolManifest(manifest, { types: ['movie', 'series'], idPrefixes: ['torbox:', 'tt'] }), capabilities: { resources: ['catalog', 'meta', 'stream'], types: ['movie', 'series'], nativeFolderPush: false, acceptsBaseUrl: true, search: true, directHttpStreams: true }, requestPolicy: { catalogMs: 20000, metaMs: 20000, streamMs: 25000, externalMs: 15000 } };

export interface FusionAdapter { [key: string]: any };
