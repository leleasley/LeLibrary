// Hosted-only capability gate. A feature is hosted-only when its server-side
// capability artefact is present: the Releases feature needs a shared TMDB key
// that only the hosted deployment sets. Self-hosters get the variable name with
// an empty value in .env.example, so this is false for them and every Releases
// surface (API router, page route, nav flag, sync job) stays off.
//
// This mirrors the pre-existing "private artefact present = hosted" pattern used
// by ACCOUNTS_AVAILABLE / the gitignored registry, without adding a second
// gating system.
export interface HostedApi {
  releasesKey: () => string;
  releasesEnabled: () => boolean;
}

function releasesKey(): string {
  return String(process.env.RELEASES_TMDB_API_KEY || '').trim();
}

function releasesEnabled(): boolean {
  return releasesKey().length > 0;
}

module.exports = { releasesKey, releasesEnabled } satisfies HostedApi;
