'use strict';
// Boot data for the React shell and the prerendered home page.
//
// The menu (is Releases on?) and the provider status pill used to be fetched
// after the page loaded, so every refresh painted the header without them and
// then popped them in. The server already knows both, so it ships them in the
// HTML as an inert JSON block (`<script type="application/json">`, never
// executed) that the hooks start from. For the prerendered home page the
// status spots also carry `data-boot` markers that are filled in here, using
// the same rules as the browser, so the first paint and the first React render
// match and hydration keeps the HTML as it is.

interface ProviderLike { status?: unknown }
interface StatusLike { overall?: unknown; providers?: unknown }

export interface BootData {
  features: { releases: boolean; savedSetups: boolean; unavailableStreamAddons?: string[]; webdavSource?: boolean };
  status?: unknown;
}

// Mirrors statusClass() in frontend/src/features/site/site-hooks.ts.
function statusClass(overall: unknown): string {
  return overall === 'operational' ? 'op'
    : overall === 'maintenance' ? 'maintenance'
    : overall === 'degraded' ? 'deg'
    : overall === 'down' ? 'down'
    : 'unknown';
}

// English labels, mirroring statusLabel(): only English visitors hydrate the
// prerendered home page (others render fresh), so English is what must match.
function statusLabel(overall: unknown): string {
  return overall === 'operational' ? 'Operational'
    : overall === 'maintenance' ? 'Maintenance'
    : overall === 'degraded' ? 'Degraded'
    : overall === 'down' ? 'Down'
    : 'Unknown';
}

export interface StatusSummary {
  footerLabel: string;
  pillClass: string;
  pillCount: string;
  heroCount: string;
  heroWarn: boolean;
}

// What the banner pill and the home hero show for a status payload. Mirrors
// SiteBanner (operational only) and HomePage servicesUp (operational or up).
function summarize(status: unknown): StatusSummary {
  const record = (status && typeof status === 'object' ? status : null) as StatusLike | null;
  if (!record) return { footerLabel: 'Unknown', pillClass: 'unknown', pillCount: '–', heroCount: '–', heroWarn: false };
  // Providers we could not check ('unknown') are left out of the counts.
  // Mirrors checkedProviders() in site-hooks.ts.
  const providers = ((Array.isArray(record.providers) ? record.providers : []) as ProviderLike[])
    .filter((p) => !(p && p.status === 'unknown'));
  const operational = providers.filter((p) => p && p.status === 'operational').length;
  const up = providers.filter((p) => p && (p.status === 'operational' || p.status === 'up')).length;
  return {
    footerLabel: statusLabel(record.overall),
    pillClass: statusClass(record.overall),
    pillCount: `${operational}/${providers.length}`,
    heroCount: providers.length ? `${up}/${providers.length}` : '–',
    heroWarn: providers.length > 0 && up < providers.length,
  };
}

// JSON for an inline <script> block: < > & and U+2028/U+2029 escaped so a
// value can never close the tag.
function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function injectBoot(html: string, boot: BootData): string {
  const block = `<script type="application/json" id="ll-boot">${inlineJson(boot)}</script>`;
  return html.includes('</head>') ? html.replace('</head>', () => `${block}\n</head>`) : html;
}

// Fill the prerendered home page's status markers. Only touches elements that
// carry a data-boot marker, so the rest of the HTML is left byte for byte.
function patchHome(html: string, status: unknown): string {
  const s = summarize(status);
  return html
    .replace(/<a\b[^>]*\bdata-boot="pill"[^>]*>/g, (tag) => tag.replace(/\bbanner-pill unknown\b/, `banner-pill ${s.pillClass}`))
    .replace(/(<[^>]+\bdata-boot="pill-count"[^>]*>)[^<]*(<)/g, (_m, open, close) => `${open}${s.pillCount}${close}`)
    .replace(/(<[^>]+\bdata-boot="hero-count"[^>]*>)[^<]*(<)/g, (_m, open, close) => `${open}${s.heroCount}${close}`)
    .replace(/<div\b[^>]*\bdata-boot="footer-status"[^>]*>/g, (tag) => tag.replace(/\bfooter-status unknown\b/, `footer-status ${s.pillClass}`))
    .replace(/(<[^>]+\bdata-boot="footer-label"[^>]*>)[^<]*(<)/g, (_m, open, close) => `${open}${s.footerLabel}${close}`)
    .replace(/<span\b[^>]*\bdata-boot="hero-live"[^>]*>/g, (tag) => (s.heroWarn && !/\bis-warn\b/.test(tag) ? tag.replace(/class="hm-live/, 'class="hm-live is-warn') : tag));
}

interface BootHtmlApi {
  summarize: typeof summarize;
  injectBoot: typeof injectBoot;
  patchHome: typeof patchHome;
  inlineJson: typeof inlineJson;
}

module.exports = { summarize, injectBoot, patchHome, inlineJson } satisfies BootHtmlApi;
