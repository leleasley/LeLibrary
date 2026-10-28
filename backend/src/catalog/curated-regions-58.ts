// @ts-nocheck
// ── Where each streaming service exists ──────────────────────
//
// Keyed by the provider folder's primary (movie) catalogue id. Verified
// 2026-10-28 by fetching every provider row (movies and series) with a real
// TMDB key in all seven setup languages, whose watch regions are GB, BR, ES,
// FR, DE, IT and JP (region.ts). A region is listed when either row returned
// titles there. Countries outside those seven (US, CA, IE, AU, NZ, MX...)
// come from TMDB's per-region provider lists recorded in
// Docs/research/collections-ideas-2026-10-28.md, section 3; no setup language
// maps to them today, so they only matter if a language is added.
// Full results: Docs/research/new-packs-verification-2026-10-28.md.
//
// GLOBAL: returned titles in all seven regions, so the picker never hides it.

const GLOBAL = new Set([
  'streaming_netflix_movies',
  'streaming_prime_movies',
  'streaming_disney_movies',
  'streaming_apple_movies',
  'streaming_mubi_movies',
  'streaming_curiosity_movies',
  'streaming_magellan_movies',
  'svc_plex_movies',
]);

const REGIONS = {
  // Big services that are missing in some of the seven.
  streaming_hbo_movies: ['GB', 'BR', 'ES', 'FR', 'DE', 'IT', 'US', 'MX', 'NL', 'SE', 'AU'],
  streaming_paramount_movies: ['GB', 'BR', 'FR', 'DE', 'IT', 'US', 'CA', 'AU', 'MX'],
  streaming_crunchyroll_movies: ['GB', 'BR', 'ES', 'FR', 'DE', 'IT', 'US', 'CA', 'AU', 'MX', 'IE', 'NZ'],
  streaming_tubi_movies: ['GB', 'US', 'CA', 'AU', 'MX'],
  streaming_shudder_movies: ['GB', 'US', 'CA', 'IE', 'AU', 'NZ'],
  streaming_discovery_movies: ['GB', 'DE', 'IT', 'US', 'CA'],
  streaming_hayu_movies: ['GB', 'ES', 'FR', 'DE', 'IT', 'IE', 'CA'],
  streaming_hulu_movies: ['JP', 'US'],
  // Hulu's "latest" rows are aliases of the provider row.
  streaming_latest_hulu_movies: ['JP', 'US'],
  // No titles in any of the seven: US / Canada / Australia only.
  streaming_peacock_movies: ['US'],
  streaming_starz_movies: ['US'],
  streaming_mgm_movies: ['US'],
  streaming_britbox_movies: ['US', 'CA', 'AU'],
  streaming_crave_movies: ['CA'],
  // UK and Ireland
  svc_bbc_iplayer_movies: ['GB'],
  svc_itvx_movies: ['GB'],
  svc_channel4_movies: ['GB', 'IE'],
  svc_channel5_movies: ['GB'],
  svc_stv_player_movies: ['GB'],
  svc_bfi_player_movies: ['GB'],
  svc_curzon_movies: ['GB'],
  svc_now_movies: ['GB', 'IT', 'IE'],
  svc_sky_go_movies: ['GB', 'DE', 'IT', 'IE'],
  // Germany
  svc_joyn_movies: ['DE'],
  svc_rtl_plus_movies: ['DE'],
  svc_wow_movies: ['DE'],
  svc_magenta_tv_movies: ['DE'],
  svc_ard_mediathek_movies: ['DE'],
  // France
  svc_canal_plus_movies: ['FR'],
  svc_m6_plus_movies: ['FR'],
  svc_tf1_plus_movies: ['FR'],
  svc_adn_anime_movies: ['FR', 'DE'],
  svc_arte_movies: ['GB', 'ES', 'FR', 'DE', 'IT'],
  // Spain
  svc_movistar_plus_movies: ['ES'],
  svc_filmin_movies: ['ES'],
  svc_atresplayer_movies: ['ES'],
  svc_rtve_movies: ['ES'],
  svc_skyshowtime_movies: ['ES', 'NL', 'SE'],
  // Italy
  svc_raiplay_movies: ['IT'],
  svc_mediaset_infinity_movies: ['IT'],
  svc_timvision_movies: ['IT'],
  // Brazil and Japan
  svc_globoplay_movies: ['BR'],
  svc_claro_video_movies: ['BR', 'MX'],
  svc_unext_movies: ['JP'],
  // Free streaming
  svc_pluto_tv_movies: ['GB', 'BR', 'ES', 'FR', 'DE', 'IT', 'US', 'CA', 'MX'],
};

export interface CuratedRegions58Api {
  REGIONS: Record<string, string[]>;
  GLOBAL: Set<string>;
}

module.exports = { REGIONS, GLOBAL } satisfies CuratedRegions58Api;
