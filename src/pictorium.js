// ── Pictorium poster studio (AGPL-3.0 companion) ─────────────
//
// Pictorium is a separate service under AGPL-3.0. We only ever call its stable
// poster endpoint over the network (never copy its renderer), which keeps
// LeLibrary's licence clean. The user's own TMDB key is sent per request via
// the api_key param, and the key never reaches the client: clients fetch our
// proxy route, which fills the key in server-side.
//
// Poster requests are derived from the curated option set in
// website/public/pictorium-options.js. Unknown keys are dropped.

const options = require('../website/public/pictorium-options');

const DEFAULT_BASE = 'http://pictorium:8080';
// Bump when our poster defaults change so Pictorium's CDN treats old URLs as
// new. Pictorium's own render version is internal; this is only cache-busting.
const INTEGRATION_RV = 'lelibrary-v1';

// Cloud metadata endpoints are always refused: the classic SSRF target and
// never a legitimate Pictorium.
function isMetadataHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (h === 'metadata.google.internal' || h.endsWith('.metadata.google.internal')) return true;
  if (h === 'metadata.goog' || h === 'metadata') return true;
  if (h === '100.100.100.200') return true;          // Alibaba metadata
  if (h === 'fd00:ec2::254') return true;            // AWS metadata (IPv6)
  if (h === '169.254.169.254') return true;          // AWS/GCP/Azure metadata
  return false;
}

// Private/internal ranges. The operator's own instance is allowed to live here
// (configured through PICTORIUM_URL), but a user-supplied URL is not: it must
// not be able to probe the host's internal network.
function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h.endsWith('.local')) return true;
  // A bare hostname with no dot and no colon is an internal service name
  // (for example the "pictorium" Docker service), never a public host.
  if (!h.includes('.') && !h.includes(':')) return true;
  if (/^127\./.test(h) || /^169\.254\./.test(h)) return true; // loopback + link-local
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

// `allowPrivate` is only ever set for the operator's PICTORIUM_URL, never for a
// user-entered URL. Both paths still reject credentials, non-HTTP schemes and
// metadata endpoints.
function safeBase(raw, { allowPrivate = false } = {}) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  let url;
  try { url = new URL(raw.trim()); } catch (_) { return ''; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  // A user-supplied instance must be HTTPS: the poster request carries their
  // TMDB key in transit. The operator's own instance may be internal HTTP.
  if (!allowPrivate && url.protocol !== 'https:') return '';
  if (url.username || url.password) return '';
  if (isMetadataHost(url.hostname)) return '';
  if (!allowPrivate && isPrivateHost(url.hostname)) return '';
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

// Resolution order: the user's own public instance, then the operator's
// backend instance (trusted, may be internal), then the Docker default.
function resolveBase(config = {}) {
  const override = safeBase(config.pictoriumUrl);
  if (override) return override;
  const env = safeBase(process.env.PICTORIUM_URL, { allowPrivate: true });
  if (env) return env;
  return DEFAULT_BASE;
}

function apiType(type) {
  return type === 'movie' ? 'movie' : 'series';
}

function isImdb(id) {
  return /^tt\d{1,20}$/i.test(String(id || ''));
}

// Pictorium only treats standalone on/off switches as customization when an
// explicit artwork path is also named. But naming one disables Pictorium's own
// metadata and aggregate-rating fetch, so we always render in its automatic
// mode and let the honored query contract carry the customization instead.

// Upstream Pictorium poster URL. `withKey` is the user's TMDB key.
function requestUrl({ base, apiKey, type, id, title, releaseDate, imdbId, lang, region, mdblistKey, options: opts }) {
  const params = new URLSearchParams();
  // The TMDB key is sent by the caller as an x-api-key header, never in the URL,
  // so it cannot leak through upstream access logs or referrers.
  if (title) params.set('title', String(title).slice(0, 200));
  if (releaseDate) params.set('rd', String(releaseDate).slice(0, 10));
  if (imdbId && isImdb(imdbId)) params.set('imdbId', String(imdbId).toLowerCase());
  if (lang) params.set('lang', String(lang).slice(0, 5));
  if (region) params.set('region', String(region).slice(0, 5));
  // Aggregate ratings (RT, Metacritic, Letterboxd, Trakt, ...) come from
  // MDBList, so the user's own key unlocks them. Server-side only.
  if (mdblistKey) params.set('mdblist_key', String(mdblistKey).slice(0, 120));
  params.set('rv', INTEGRATION_RV);
  const extra = options.toQuery(opts);
  return `${base}/api/poster/${apiType(type)}/${encodeURIComponent(id)}?${params.toString()}${extra ? `&${extra}` : ''}`;
}

// Client-facing URL served by our proxy. No key, no internal host.
function proxyPath({ token, type, id, title, releaseDate, imdbId, options: opts, fallback, preview }) {
  const extra = options.toQuery(opts);
  const params = new URLSearchParams();
  if (extra) new URLSearchParams(extra).forEach((value, key) => params.set(key, value));
  if (title) params.set('title', String(title).slice(0, 200));
  if (releaseDate) params.set('rd', String(releaseDate).slice(0, 10));
  if (imdbId && isImdb(imdbId)) params.set('imdbId', String(imdbId).toLowerCase());
  if (fallback) params.set('fallback', fallback);
  if (preview) params.set('preview', '1');
  const suffix = params.toString();
  return `/${encodeURIComponent(token)}/pictorium/${apiType(type)}/${encodeURIComponent(id)}.jpg${suffix ? `?${suffix}` : ''}`;
}

// Only our own generated artwork is a valid fallback target; never redirect a
// client to an arbitrary URL from a crafted config.
function safeFallback(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return '';
    const host = url.hostname.toLowerCase();
    if (host !== 'image.tmdb.org') return '';
    return url.toString();
  } catch (_) { return ''; }
}

module.exports = {
  DEFAULT_BASE,
  INTEGRATION_RV,
  resolveBase,
  safeBase,
  safeFallback,
  requestUrl,
  proxyPath,
  apiType,
  isImdb,
};
