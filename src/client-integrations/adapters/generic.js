'use strict';

module.exports = {
  id: 'generic', label: 'Compatible addon client', manifestMode: 'stremio',
  status: 'testing',
  manifest: ({ manifest }) => manifest,
  capabilities: { resources: ['catalog', 'meta', 'stream'], types: ['movie', 'series', 'anime'], nativeFolderPush: false, acceptsBaseUrl: true, search: true },
};
