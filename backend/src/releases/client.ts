// Shared, memoised TMDB client for the Releases feature. Rebuilt only when the
// configured key changes. The client is never exposed to a request handler that
// returns its internals; the router only uses its methods.
const { releasesKey } = require('../platform/hosted.ts');
const { createTmdbClient } = require('./tmdb.ts');

let client: any = null;
let key = '';

function getClient(): any {
  const current = releasesKey();
  if (!client || key !== current) {
    client = createTmdbClient({ apiKey: current });
    key = current;
  }
  return client;
}

export interface ReleasesClientApi {
  getClient: () => any;
}

module.exports = { getClient } satisfies ReleasesClientApi;
