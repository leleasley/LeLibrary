// @ts-nocheck
// ── 5.8 collection packs ───────────────────────────────────────
//
// Data only. curated-collections.ts owns the folder() helper, the media-pair
// merge, the per-pack source dedupe and the API shape; this module only says
// which folders each new pack holds. Every source id is an existing
// catalogue (catalogdefs*.ts); a test fails on an unknown id.
//
// Folder metadata the picker uses:
// - regions: ISO 3166-1 countries where the watch provider exists. The
//   picker derives the region from the setup language (region.ts) and hides
//   a folder outside it. Only provider rows carry regions.
// - season: a yearly window ({ from: 'MM-DD', to: 'MM-DD' }, may wrap the
//   year end). Outside it the folder is still addable, marked "In season
//   from <date>". Seasonal folders may also carry regions (Thanksgiving).
// - needsMdblistKey (pack-level requiresMdblistKey): locked until the setup
//   has an MDBList key (operator decision for Charts, 2026-10-28).
//
// Pack covers: four TMDB poster paths per pack, picked from the 2026-10-28
// verification fetch (Docs/research/new-packs-verification-2026-10-28.md).
// curated-collections.ts turns them into a generated-cover URL.
//
// Persona bundles reference folders of other packs by their folder() id,
// never by a copy, so one folder is defined exactly once.

// Where each watch provider exists. Verified 2026-10-28: every provider row
// was fetched in all seven setup languages (GB, BR, ES, FR, DE, IT, JP);
// countries outside those seven come from TMDB's per-region provider lists
// (Docs/research/collections-ideas-2026-10-28.md, section 3).
const { REGIONS, GLOBAL } = require('./curated-regions-58.ts');

// null = available in every setup region (never hidden).
function regionsFor(sourceId) {
  if (GLOBAL.has(sourceId)) return null;
  const regions = REGIONS[sourceId];
  if (!regions) throw new Error(`no regions recorded for provider row ${sourceId}`);
  return regions;
}

function buildNewPacks({ folder }) {
  // A provider folder: movies (+ series via the media-pair merge) with regions.
  function service(id, title, movieSourceId, extra = []) {
    const regions = regionsFor(movieSourceId);
    return { ...folder(id, title, movieSourceId, {}, extra), ...(regions ? { regions } : {}) };
  }
  function seasonal(id, title, sourceId, season, extra = [], regions = null) {
    return { ...folder(id, title, sourceId, {}, extra), season, ...(regions ? { regions } : {}) };
  }

  const STREAMING_REGION = {
    id: 'streaming-region', title: 'Streaming by Region', icon: '🗺️', kind: 'pack', filters: ['streaming', 'world'],
    description: 'The services in your country, from the big global ones to local channels and free streaming.',
    folders: [
      service('sr-netflix', 'Netflix', 'streaming_netflix_movies'),
      service('sr-prime', 'Prime Video', 'streaming_prime_movies'),
      service('sr-disney', 'Disney+', 'streaming_disney_movies'),
      service('sr-apple', 'Apple TV+', 'streaming_apple_movies'),
      service('sr-hbo', 'HBO Max', 'streaming_hbo_movies'),
      service('sr-paramount', 'Paramount+', 'streaming_paramount_movies'),
      service('sr-hulu', 'Hulu', 'streaming_hulu_movies'),
      service('sr-peacock', 'Peacock', 'streaming_peacock_movies'),
      service('sr-skyshowtime', 'SkyShowtime', 'svc_skyshowtime_movies'),
      service('sr-crunchyroll', 'Crunchyroll', 'streaming_crunchyroll_movies'),
      service('sr-mubi', 'MUBI', 'streaming_mubi_movies'),
      service('sr-shudder', 'Shudder', 'streaming_shudder_movies'),
      service('sr-discovery', 'Discovery+', 'streaming_discovery_movies'),
      service('sr-curiosity', 'Curiosity Stream', 'streaming_curiosity_movies'),
      service('sr-bbc-iplayer', 'BBC iPlayer', 'svc_bbc_iplayer_movies'),
      service('sr-itvx', 'ITVX', 'svc_itvx_movies'),
      service('sr-channel4', 'Channel 4', 'svc_channel4_movies'),
      service('sr-channel5', 'Channel 5', 'svc_channel5_movies'),
      service('sr-now', 'NOW', 'svc_now_movies'),
      service('sr-sky-go', 'Sky Go', 'svc_sky_go_movies'),
      service('sr-stv', 'STV Player', 'svc_stv_player_movies'),
      service('sr-joyn', 'Joyn', 'svc_joyn_movies'),
      service('sr-rtl-plus', 'RTL+', 'svc_rtl_plus_movies'),
      service('sr-wow', 'WOW', 'svc_wow_movies'),
      service('sr-magenta', 'MagentaTV', 'svc_magenta_tv_movies'),
      service('sr-ard', 'ARD Mediathek', 'svc_ard_mediathek_movies'),
      service('sr-canal-plus', 'Canal+', 'svc_canal_plus_movies'),
      service('sr-arte', 'Arte', 'svc_arte_movies'),
      service('sr-m6-plus', 'M6+', 'svc_m6_plus_movies'),
      service('sr-tf1-plus', 'TF1+', 'svc_tf1_plus_movies'),
      service('sr-movistar', 'Movistar Plus+', 'svc_movistar_plus_movies'),
      service('sr-atresplayer', 'Atresplayer', 'svc_atresplayer_movies'),
      service('sr-rtve', 'RTVE Play', 'svc_rtve_movies'),
      service('sr-filmin', 'Filmin', 'svc_filmin_movies'),
      service('sr-raiplay', 'RaiPlay', 'svc_raiplay_movies'),
      service('sr-mediaset', 'Mediaset Infinity', 'svc_mediaset_infinity_movies'),
      service('sr-timvision', 'TIMvision', 'svc_timvision_movies'),
      service('sr-globoplay', 'Globoplay', 'svc_globoplay_movies'),
      service('sr-claro', 'Claro video', 'svc_claro_video_movies'),
      service('sr-unext', 'U-NEXT', 'svc_unext_movies'),
      service('sr-adn', 'ADN', 'svc_adn_anime_movies'),
      service('sr-tubi', 'Tubi', 'streaming_tubi_movies'),
      service('sr-pluto', 'Pluto TV', 'svc_pluto_tv_movies'),
      service('sr-plex', 'Plex', 'svc_plex_movies'),
    ],
  };

  // Windows (operator decision 2026-10-28): Christmas Nov 15 - Jan 6,
  // Halloween Oct 1 - Nov 2, Thanksgiving Nov 1 - 30 (US/CA), Valentine's
  // Feb 1 - 15, Summer Jun - Aug; New Year Dec 26 - Jan 4.
  const SEASONAL = {
    id: 'seasonal', title: 'Seasonal & Holidays', icon: '🗓️', kind: 'pack', filters: ['seasonal'],
    description: 'Holiday favourites that come into season through the year. Add them now, they are ready when the date comes.',
    folders: [
      seasonal('season-halloween', 'Halloween', 'season_halloween_movies', { from: '10-01', to: '11-02' }, ['collection_halloween']),
      seasonal('season-thanksgiving', 'Thanksgiving', 'themed_thanksgiving', { from: '11-01', to: '11-30' }, [], ['US', 'CA']),
      seasonal('season-christmas', 'Christmas', 'themed_christmas_movies', { from: '11-15', to: '01-06' }, ['themed_christmas_tv_movies', 'season_christmas_series']),
      seasonal('season-new-year', "New Year's Eve", 'season_new_year_movies', { from: '12-26', to: '01-04' }),
      seasonal('season-valentines', "Valentine's Day", 'season_valentines_movies', { from: '02-01', to: '02-15' }, ['genre_romantic_comedy_movies']),
      seasonal('season-summer', 'Summer', 'season_summer_movies', { from: '06-01', to: '08-31' }),
    ],
  };

  const HORROR_VAULT = {
    id: 'horror-vault', title: 'Horror Vault', icon: '🩸', kind: 'pack', filters: ['genres'],
    description: 'A deep dive for horror fans: sub-genres, horror labels, slasher sagas, every decade and scares from around the world.',
    sections: [
      { id: 'subgenres', title: 'Horror Sub-genres', folders: ['hv-slasher', 'hv-supernatural', 'hv-found-footage', 'hv-folk', 'hv-body', 'hv-cosmic', 'hv-creature', 'hv-zombies', 'hv-vampires', 'hv-werewolves', 'hv-haunted', 'hv-psychological', 'hv-giallo', 'hv-home-invasion', 'hv-witches'] },
      { id: 'studios', title: 'Horror Labels', folders: ['hv-blumhouse', 'hv-a24', 'hv-hammer', 'hv-atomic-monster', 'hv-ghost-house', 'hv-platinum-dunes'] },
      { id: 'franchises', title: 'Horror Franchises', folders: ['hv-halloween', 'hv-scream', 'hv-saw', 'hv-conjuring', 'hv-elm-street', 'hv-evil-dead', 'hv-friday-13th', 'hv-texas-chainsaw', 'hv-28-days', 'hv-insidious', 'hv-final-destination', 'hv-alien'] },
      { id: 'decades', title: 'Horror by Decade', folders: ['hv-1970s', 'hv-1980s', 'hv-1990s', 'hv-2000s', 'hv-2010s', 'hv-2020s'] },
      { id: 'world', title: 'World Horror', folders: ['hv-japanese', 'hv-korean', 'hv-spanish', 'hv-italian', 'hv-french'] },
    ],
    folders: [
      folder('hv-slasher', 'Slasher', 'horror_slasher_movies'),
      folder('hv-supernatural', 'Supernatural', 'horror_supernatural_movies'),
      folder('hv-found-footage', 'Found Footage', 'horror_found_footage_movies'),
      folder('hv-folk', 'Folk Horror', 'horror_folk_movies'),
      folder('hv-body', 'Body Horror', 'horror_body_movies'),
      folder('hv-cosmic', 'Cosmic Horror', 'horror_cosmic_movies'),
      folder('hv-creature', 'Creature Features', 'horror_creature_movies'),
      folder('hv-zombies', 'Zombies', 'themed_zombies'),
      folder('hv-vampires', 'Vampires', 'horror_vampire_movies'),
      folder('hv-werewolves', 'Werewolves', 'horror_werewolf_movies'),
      folder('hv-haunted', 'Haunted Houses', 'horror_haunted_house_movies'),
      folder('hv-psychological', 'Psychological Horror', 'horror_psychological_movies'),
      folder('hv-giallo', 'Giallo', 'horror_giallo_movies'),
      folder('hv-home-invasion', 'Home Invasion', 'horror_home_invasion_movies'),
      folder('hv-witches', 'Witches', 'horror_witch_movies'),
      folder('hv-blumhouse', 'Blumhouse', 'studio_blumhouse_movies'),
      folder('hv-a24', 'A24 Horror', 'horror_a24_movies'),
      folder('hv-hammer', 'Hammer Films', 'horror_hammer_movies'),
      folder('hv-atomic-monster', 'Atomic Monster', 'horror_atomic_monster_movies'),
      folder('hv-ghost-house', 'Ghost House Pictures', 'horror_ghost_house_movies'),
      folder('hv-platinum-dunes', 'Platinum Dunes', 'horror_platinum_dunes_movies'),
      folder('hv-halloween', 'Halloween', 'collection_halloween'),
      folder('hv-scream', 'Scream', 'collection_scream'),
      folder('hv-saw', 'Saw', 'collection_saw'),
      folder('hv-conjuring', 'The Conjuring', 'collection_conjuring'),
      folder('hv-elm-street', 'A Nightmare on Elm Street', 'collection_nightmare_elm_street'),
      folder('hv-evil-dead', 'Evil Dead', 'collection_evil_dead'),
      folder('hv-friday-13th', 'Friday the 13th', 'collection_friday_13th'),
      folder('hv-texas-chainsaw', 'The Texas Chainsaw Massacre', 'collection_texas_chainsaw'),
      folder('hv-28-days', '28 Days Later', 'collection_28_days_later'),
      folder('hv-insidious', 'Insidious', 'collection_insidious'),
      folder('hv-final-destination', 'Final Destination', 'collection_final_destination'),
      folder('hv-alien', 'Alien', 'collection_alien'),
      folder('hv-1970s', '70s Horror', 'horror_1970s_movies'),
      folder('hv-1980s', '80s Horror', 'horror_1980s_movies'),
      folder('hv-1990s', '90s Horror', 'horror_1990s_movies'),
      folder('hv-2000s', '2000s Horror', 'horror_2000s_movies'),
      folder('hv-2010s', '2010s Horror', 'horror_2010s_movies'),
      folder('hv-2020s', '2020s Horror', 'horror_2020s_movies'),
      folder('hv-japanese', 'J-Horror', 'horror_japanese_movies'),
      folder('hv-korean', 'K-Horror', 'horror_korean_movies'),
      folder('hv-spanish', 'Spanish-Language Horror', 'horror_spanish_movies'),
      folder('hv-italian', 'Italian Horror', 'horror_italian_movies'),
      folder('hv-french', 'French Horror', 'horror_french_movies'),
    ],
  };

  const KIDS_FAMILY = {
    id: 'kids-family', title: 'Kids & Family', icon: '🧸', kind: 'pack', filters: ['kids'],
    description: 'A safe shelf for shared profiles: films by age, the big animation studios, kids TV channels and family sagas.',
    sections: [
      { id: 'ages', title: 'By Age', folders: ['kf-little-ones', 'kf-kids', 'kf-tweens', 'kf-teens'] },
      { id: 'animation', title: 'Animation Studios', folders: ['kf-pixar', 'kf-disney', 'kf-dreamworks', 'kf-illumination', 'kf-sony-animation', 'kf-aardman', 'kf-laika', 'kf-cartoon-saloon', 'kf-blue-sky', 'kf-ghibli'] },
      { id: 'tv', title: 'Kids TV', folders: ['kf-kids-tv', 'kf-disney-channel', 'kf-nickelodeon', 'kf-cartoon-network'] },
      { id: 'franchises', title: 'Family Franchises', folders: ['kf-toy-story', 'kf-shrek', 'kf-httyd', 'kf-kung-fu-panda', 'kf-despicable-me', 'kf-minions', 'kf-ice-age', 'kf-frozen', 'kf-incredibles', 'kf-finding-nemo', 'kf-madagascar', 'kf-paddington', 'kf-cars'] },
    ],
    folders: [
      folder('kf-little-ones', 'Little Ones (G)', 'kids_little_ones_movies'),
      folder('kf-kids', 'Kids (PG)', 'kids_pg_movies'),
      folder('kf-tweens', 'Tweens (PG-13)', 'kids_tweens_movies'),
      folder('kf-teens', 'Teens & Coming of Age', 'kids_coming_of_age_movies'),
      folder('kf-pixar', 'Pixar', 'studio_pixar_movies'),
      folder('kf-disney', 'Disney Animation', 'studio_disney_animated_movies'),
      folder('kf-dreamworks', 'DreamWorks', 'studio_dreamworks_movies'),
      folder('kf-illumination', 'Illumination', 'studio_illumination_movies'),
      folder('kf-sony-animation', 'Sony Pictures Animation', 'kids_sony_animation_movies'),
      folder('kf-aardman', 'Aardman', 'kids_aardman_movies'),
      folder('kf-laika', 'Laika', 'kids_laika_movies'),
      folder('kf-cartoon-saloon', 'Cartoon Saloon', 'kids_cartoon_saloon_movies'),
      folder('kf-blue-sky', 'Blue Sky Studios', 'kids_blue_sky_movies'),
      folder('kf-ghibli', 'Studio Ghibli', 'studio_ghibli_movies'),
      folder('kf-kids-tv', 'Kids TV', 'kids_tv_series'),
      folder('kf-disney-channel', 'Disney Channel', 'kids_disney_channel_series'),
      folder('kf-nickelodeon', 'Nickelodeon', 'kids_nickelodeon_series'),
      folder('kf-cartoon-network', 'Cartoon Network', 'kids_cartoon_network_series'),
      folder('kf-toy-story', 'Toy Story', 'collection_toy_story'),
      folder('kf-shrek', 'Shrek', 'collection_shrek'),
      folder('kf-httyd', 'How to Train Your Dragon', 'collection_httyd'),
      folder('kf-kung-fu-panda', 'Kung Fu Panda', 'collection_kung_fu_panda'),
      folder('kf-despicable-me', 'Despicable Me', 'collection_despicable_me'),
      folder('kf-minions', 'Minions', 'collection_minions'),
      folder('kf-ice-age', 'Ice Age', 'collection_ice_age'),
      folder('kf-frozen', 'Frozen', 'collection_frozen'),
      folder('kf-incredibles', 'The Incredibles', 'collection_incredibles'),
      folder('kf-finding-nemo', 'Finding Nemo', 'collection_finding_nemo'),
      folder('kf-madagascar', 'Madagascar', 'collection_madagascar'),
      folder('kf-paddington', 'Paddington', 'collection_paddington'),
      folder('kf-cars', 'Cars', 'collection_cars'),
    ],
  };

  const WORLD_TV = {
    id: 'world-tv', title: 'World TV & Dramas', icon: '🌏', kind: 'pack', filters: ['world'],
    description: 'K-dramas, British channels, Nordic noir, telenovelas and series from around the world.',
    sections: [
      { id: 'asia', title: 'Asian Dramas', folders: ['wt-kdrama', 'wt-jdrama', 'wt-cdrama', 'wt-thai'] },
      { id: 'british', title: 'British TV', folders: ['wt-bbc-one', 'wt-bbc-two', 'wt-channel4', 'wt-itv1', 'wt-sky-atlantic', 'wt-e4'] },
      { id: 'world', title: 'Around the World', folders: ['wt-nordic-noir', 'wt-euro-crime', 'wt-turkish', 'wt-telenovelas', 'wt-spanish', 'wt-indian', 'wt-australian'] },
    ],
    folders: [
      folder('wt-kdrama', 'K-Drama', 'worldtv_kdrama_series', {}, ['worldtv_tvn_series', 'worldtv_jtbc_series']),
      folder('wt-jdrama', 'J-Drama', 'worldtv_jdrama_series'),
      folder('wt-cdrama', 'C-Drama', 'worldtv_cdrama_series'),
      folder('wt-thai', 'Thai Drama', 'worldtv_thai_drama_series'),
      folder('wt-bbc-one', 'BBC One', 'worldtv_bbc_one_series'),
      folder('wt-bbc-two', 'BBC Two', 'worldtv_bbc_two_series'),
      folder('wt-channel4', 'Channel 4', 'worldtv_channel4_series'),
      folder('wt-itv1', 'ITV1', 'worldtv_itv1_series'),
      folder('wt-sky-atlantic', 'Sky Atlantic', 'worldtv_sky_atlantic_series'),
      folder('wt-e4', 'E4', 'worldtv_e4_series'),
      folder('wt-nordic-noir', 'Nordic Noir', 'worldtv_nordic_noir_series'),
      folder('wt-euro-crime', 'Euro Crime', 'worldtv_euro_crime_series'),
      folder('wt-turkish', 'Turkish Dizi', 'worldtv_turkish_dizi_series'),
      folder('wt-telenovelas', 'Telenovelas', 'worldtv_telenovelas_series'),
      folder('wt-spanish', 'Spanish TV', 'worldtv_spanish_series'),
      folder('wt-indian', 'Indian Series', 'worldtv_indian_series'),
      folder('wt-australian', 'Australian TV', 'worldtv_australian_series'),
    ],
  };

  const ANIME_HUB = {
    id: 'anime-hub', title: 'Anime Hub', icon: '🍥', kind: 'pack', filters: ['world', 'genres'],
    description: 'Popular, new and top-rated anime, the big genres, the studios behind them and where to stream.',
    sections: [
      { id: 'discover', title: 'Anime', folders: ['ah-popular', 'ah-new', 'ah-best', 'ah-films'] },
      { id: 'genres', title: 'Anime Genres', folders: ['ah-isekai', 'ah-mecha', 'ah-shounen', 'ah-slice-of-life', 'ah-dark-fantasy'] },
      { id: 'studios', title: 'Anime Studios', folders: ['ah-mappa', 'ah-ufotable', 'ah-wit', 'ah-bones', 'ah-kyoani', 'ah-madhouse', 'ah-toei', 'ah-production-ig', 'ah-a1', 'ah-cloverworks'] },
    ],
    folders: [
      folder('ah-popular', 'Popular Anime', 'anime_popular_series'),
      folder('ah-new', 'New Anime', 'anime_new_series'),
      folder('ah-best', 'Highest Rated', 'anime_best_series'),
      folder('ah-films', 'Anime Films', 'anime_films_movies'),
      folder('ah-isekai', 'Isekai', 'anime_isekai_series'),
      folder('ah-mecha', 'Mecha', 'anime_mecha_series'),
      folder('ah-shounen', 'Shounen', 'anime_shounen_series'),
      folder('ah-slice-of-life', 'Slice of Life', 'anime_slice_of_life_series'),
      folder('ah-dark-fantasy', 'Dark Fantasy', 'anime_dark_fantasy_series'),
      folder('ah-mappa', 'MAPPA', 'anime_mappa_series'),
      folder('ah-ufotable', 'ufotable', 'anime_ufotable_series'),
      folder('ah-wit', 'Wit Studio', 'anime_wit_studio_series'),
      folder('ah-bones', 'Bones', 'anime_bones_series'),
      folder('ah-kyoani', 'Kyoto Animation', 'anime_kyoto_animation_series'),
      folder('ah-madhouse', 'Madhouse', 'anime_madhouse_series'),
      folder('ah-toei', 'Toei Animation', 'anime_toei_series'),
      folder('ah-production-ig', 'Production I.G', 'anime_production_ig_series'),
      folder('ah-a1', 'A-1 Pictures', 'anime_a1_pictures_series'),
      folder('ah-cloverworks', 'CloverWorks', 'anime_cloverworks_series'),
    ],
  };

  const SHARED_UNIVERSES = {
    id: 'shared-universes', title: 'Shared Universes', icon: '🪐', kind: 'pack', filters: ['franchises'],
    description: 'Universes that span several film series, in release order so you can watch them start to finish.',
    folders: [
      folder('su-mcu', 'Marvel Cinematic Universe', 'universe_mcu_order_movies'),
      folder('su-dceu', 'DC Extended Universe', 'collection_dc_universe_mdb'),
      folder('su-star-wars', 'Star Wars', 'collection_star_wars'),
      folder('su-wizarding-world', 'Wizarding World', 'universe_wizarding_world'),
      folder('su-middle-earth', 'Middle-earth', 'universe_middle_earth'),
      folder('su-star-trek', 'Star Trek', 'universe_star_trek'),
      folder('su-monsterverse', 'MonsterVerse', 'universe_monsterverse'),
      folder('su-alien-predator', 'Alien vs. Predator', 'universe_alien_predator'),
      folder('su-xmen', 'X-Men', 'collection_xmen'),
      folder('su-spider-verse', 'Spider-Verse', 'universe_spider_verse'),
      folder('su-conjuring', 'The Conjuring Universe', 'universe_conjuring'),
      folder('su-rocky-creed', 'Rocky & Creed', 'universe_rocky_creed'),
      folder('su-planet-apes', 'Planet of the Apes', 'collection_planet_of_apes'),
    ],
  };

  const CINEPHILE = {
    id: 'cinephile', title: 'Cinephile & Arthouse', icon: '🎞️', kind: 'pack', filters: ['people', 'world'],
    description: 'Arthouse labels, the all-time greats, international cinema, auteurs and the services that stream them.',
    sections: [
      { id: 'labels', title: 'Arthouse Labels', folders: ['ci-a24', 'ci-neon', 'ci-searchlight', 'ci-focus', 'ci-annapurna', 'ci-plan-b', 'ci-working-title', 'ci-ifc', 'ci-film4', 'ci-bbc-film', 'ci-studiocanal'] },
      { id: 'acclaimed', title: 'Acclaimed', folders: ['ci-masterpieces', 'ci-international', 'ci-golden-age', 'ci-silent', 'ci-docs', 'ci-rotten-tomatoes'] },
      { id: 'auteurs', title: 'Auteurs', folders: ['ci-coppola', 'ci-coen', 'ci-aronofsky', 'ci-cuaron', 'ci-inarritu', 'ci-bigelow', 'ci-refn', 'ci-carpenter'] },
      { id: 'streaming', title: 'Where Cinephiles Stream', folders: ['ci-mubi', 'ci-bfi', 'ci-curzon', 'ci-filmin'] },
    ],
    folders: [
      folder('ci-a24', 'A24', 'studio_a24_movies'),
      folder('ci-neon', 'Neon', 'cine_neon_movies'),
      folder('ci-searchlight', 'Searchlight Pictures', 'cine_searchlight_movies'),
      folder('ci-focus', 'Focus Features', 'cine_focus_features_movies'),
      folder('ci-annapurna', 'Annapurna Pictures', 'cine_annapurna_movies'),
      folder('ci-plan-b', 'Plan B Entertainment', 'cine_plan_b_movies'),
      folder('ci-working-title', 'Working Title', 'cine_working_title_movies'),
      folder('ci-ifc', 'IFC Films', 'cine_ifc_films_movies'),
      folder('ci-film4', 'Film4', 'cine_film4_movies'),
      folder('ci-bbc-film', 'BBC Film', 'cine_bbc_film_movies'),
      folder('ci-studiocanal', 'StudioCanal', 'cine_studiocanal_movies'),
      folder('ci-masterpieces', 'Masterpieces', 'cine_masterpieces_movies'),
      folder('ci-international', 'International Acclaim', 'cine_international_movies'),
      folder('ci-golden-age', 'Golden Age Classics', 'cine_golden_age_movies'),
      folder('ci-silent', 'Silent Era', 'cine_silent_era_movies'),
      folder('ci-docs', 'Acclaimed Documentaries', 'cine_acclaimed_docs_movies'),
      folder('ci-rotten-tomatoes', '100% on Rotten Tomatoes', 'themed_rotten_tomatoes_movies'),
      folder('ci-coppola', 'Francis Ford Coppola', 'director_francis_ford_coppola_movies'),
      folder('ci-coen', 'Joel Coen', 'director_joel_coen_movies'),
      folder('ci-aronofsky', 'Darren Aronofsky', 'director_darren_aronofsky_movies'),
      folder('ci-cuaron', 'Alfonso Cuarón', 'director_alfonso_cuaron_movies'),
      folder('ci-inarritu', 'Alejandro G. Iñárritu', 'director_alejandro_gonzalez_inarritu_movies'),
      folder('ci-bigelow', 'Kathryn Bigelow', 'director_kathryn_bigelow_movies'),
      folder('ci-refn', 'Nicolas Winding Refn', 'director_nicolas_winding_refn_movies'),
      folder('ci-carpenter', 'John Carpenter', 'director_john_carpenter_movies'),
      service('ci-mubi', 'MUBI', 'streaming_mubi_movies'),
      service('ci-bfi', 'BFI Player', 'svc_bfi_player_movies'),
      service('ci-curzon', 'Curzon Home Cinema', 'svc_curzon_movies'),
      service('ci-filmin', 'Filmin', 'svc_filmin_movies'),
    ],
  };

  const MOODS = {
    id: 'moods', title: 'Moods & Vibes', icon: '🌈', kind: 'pack', filters: ['genres'],
    description: 'Pick by feeling, not genre: mind-benders, feel-good, date night, dark comedy, cult classics and more.',
    folders: [
      folder('mv-mind-benders', 'Mind-Benders', 'themed_mindfuck'),
      folder('mv-plot-twists', 'Plot Twists', 'themed_plot_twists'),
      folder('mv-feel-good', 'Feel-Good', 'mood_feel_good_movies'),
      folder('mv-date-night', 'Date Night', 'genre_romantic_comedy_movies'),
      folder('mv-big-laughs', 'Big Laughs', 'mood_big_laughs_movies'),
      folder('mv-dark-comedy', 'Dark Comedy', 'mood_dark_comedy_movies'),
      folder('mv-edge-of-seat', 'Edge of Your Seat', 'mood_edge_of_seat_movies'),
      folder('mv-cult', 'Cult Classics', 'mood_cult_classics_movies'),
      folder('mv-neo-noir', 'Neo-Noir', 'mood_neo_noir_movies'),
      folder('mv-under-90', 'Under 90 Minutes', 'mood_under_90_movies'),
      folder('mv-epic', 'Epic Length', 'themed_epics'),
      folder('mv-nostalgia', '80s & 90s Nostalgia', 'themed_nostalgic_80s_90s'),
      folder('mv-sitcoms', 'Comfort Sitcoms', 'mood_sitcoms_series'),
    ],
  };

  const BASED_ON = {
    id: 'based-on', title: 'Based On', icon: '📖', kind: 'pack', filters: ['genres'],
    description: 'Stories that started somewhere else: books, comics, true events, video games, manga and real lives.',
    folders: [
      folder('bo-books', 'Books', 'basedon_book_movies'),
      folder('bo-comics', 'Comics', 'basedon_comic_movies'),
      folder('bo-true-stories', 'True Stories', 'themed_based_on_true_story', {}, ['basedon_true_story_series']),
      folder('bo-video-games', 'Video Games', 'basedon_video_game_movies'),
      folder('bo-manga', 'Manga', 'basedon_manga_movies'),
      folder('bo-biopics', 'Biopics', 'basedon_biopic_movies'),
    ],
  };

  const HISTORY_WAR = {
    id: 'history-war', title: 'History & War', icon: '🏛️', kind: 'pack', filters: ['genres'],
    description: 'From ancient Rome and samurai to the world wars, the Cold War, spies and the old West.',
    folders: [
      folder('hw-war', 'War', 'genre_war_movies'),
      folder('hw-history', 'History', 'genre_history_movies'),
      folder('hw-ww2', 'World War II', 'hist_ww2_movies'),
      folder('hw-vietnam', 'Vietnam War', 'hist_vietnam_war_movies'),
      folder('hw-cold-war', 'Cold War', 'hist_cold_war_movies'),
      folder('hw-spy', 'Spy Thrillers', 'hist_spy_movies'),
      folder('hw-ancient-rome', 'Ancient Rome', 'hist_ancient_rome_movies'),
      folder('hw-medieval', 'Medieval', 'hist_medieval_movies'),
      folder('hw-samurai', 'Samurai', 'hist_samurai_movies'),
      folder('hw-wuxia', 'Wuxia', 'hist_wuxia_movies'),
      folder('hw-victorian', 'Victorian Era', 'hist_victorian_movies'),
      folder('hw-period-dramas', 'Period Dramas', 'hist_period_drama_series'),
      folder('hw-westerns', 'Westerns', 'genre_western_movies'),
      folder('hw-spaghetti-westerns', 'Spaghetti Westerns', 'hist_spaghetti_western_movies'),
    ],
  };

  const SPORTS_MUSIC = {
    id: 'sports-music', title: 'Sports, Music & Performance', icon: '🏟️', kind: 'pack', filters: ['genres'],
    description: 'Sports dramas and documentaries, musicals, concert films, dance and stand-up.',
    sections: [
      { id: 'sports', title: 'Sports', folders: ['sm-sports', 'sm-boxing', 'sm-football', 'sm-basketball', 'sm-motorsport', 'sm-underdog', 'sm-sports-docs'] },
      { id: 'music', title: 'Music & Performance', folders: ['sm-musicals', 'sm-music', 'sm-concerts', 'sm-music-docs', 'sm-hip-hop', 'sm-dance', 'sm-stand-up'] },
    ],
    folders: [
      folder('sm-sports', 'Sports', 'genre_sports_movies'),
      folder('sm-boxing', 'Boxing', 'sport_boxing_movies'),
      folder('sm-football', 'Football', 'sport_football_movies'),
      folder('sm-basketball', 'Basketball', 'sport_basketball_movies'),
      folder('sm-motorsport', 'Motorsport', 'sport_motorsport_movies'),
      folder('sm-underdog', 'Underdog Stories', 'sport_underdog_movies'),
      folder('sm-sports-docs', 'Sports Documentaries', 'sport_documentaries_movies', {}, ['sport_docuseries_series']),
      folder('sm-musicals', 'Musicals', 'music_musicals_movies'),
      folder('sm-music', 'Music', 'genre_music_movies'),
      folder('sm-concerts', 'Concert Films', 'music_concert_films_movies'),
      folder('sm-music-docs', 'Music Documentaries', 'music_documentaries_movies'),
      folder('sm-hip-hop', 'Hip-Hop', 'music_hip_hop_movies'),
      folder('sm-dance', 'Dance', 'music_dance_movies'),
      folder('sm-stand-up', 'Stand-up Comedy', 'themed_standup_comedy_movies'),
    ],
  };

  const CHARTS = {
    id: 'charts', title: "Charts & What's Hot", icon: '🔥', kind: 'pack', filters: ['charts'], requiresMdblistKey: true,
    description: 'What everyone is watching right now: trending charts, this week\'s most watched, new on Blu-ray and the critics\' must-sees.',
    folders: [
      folder('ch-trakt-trending', 'Trending on Trakt', 'trakt_trending_movies'),
      folder('ch-imdb-today', 'Popular on IMDb Today', 'trakt_popular_movies'),
      folder('ch-watched-week', 'Most Watched This Week', 'chart_watched_week_movies'),
      folder('ch-moviemeter', 'IMDb Moviemeter', 'chart_moviemeter_movies'),
      folder('ch-imdb-top-shows', 'IMDb Top 250 Shows', 'chart_imdb_top_shows_series'),
      folder('ch-upcoming', 'Coming to Theatres', 'trakt_anticipated_movies'),
      folder('ch-bluray', 'New on Blu-ray', 'chart_bluray_movies'),
      folder('ch-pirated', 'Most Pirated This Week', 'chart_pirated_week_movies'),
      folder('ch-metacritic', 'Metacritic Must-See', 'chart_metacritic_movies'),
      folder('ch-trending-anime', 'Trending Anime', 'chart_trending_anime_series'),
    ],
  };

  return [STREAMING_REGION, SEASONAL, HORROR_VAULT, KIDS_FAMILY, WORLD_TV, ANIME_HUB, SHARED_UNIVERSES, CINEPHILE, MOODS, BASED_ON, HISTORY_WAR, SPORTS_MUSIC, CHARTS];
}

// Persona bundles: ready-made sets of collections, each section one Nuvio
// collection, built only from folders defined in other packs (by folder()
// id). curated-collections.ts resolves the references and throws on an
// unknown one.
const PERSONA_BUNDLES = [
  {
    id: 'persona-starter', title: 'Starter', icon: '🚀', kind: 'bundle', filters: ['charts', 'streaming', 'genres', 'franchises'],
    description: 'A first set that covers the basics: what is hot, your streaming services, the main genres and the biggest film series.',
    sections: [
      { id: 'discover', title: 'Discover', refs: ['discover-trending-movies', 'discover-popular-movies', 'discover-new-releases', 'discover-top-rated', 'discover-on-air'] },
      { id: 'streaming', title: 'Streaming', refs: ['sr-netflix', 'sr-prime', 'sr-disney', 'sr-apple', 'sr-hbo', 'sr-paramount', 'sr-hulu', 'sr-skyshowtime', 'sr-bbc-iplayer', 'sr-itvx', 'sr-channel4', 'sr-now', 'sr-joyn', 'sr-rtl-plus', 'sr-canal-plus', 'sr-movistar', 'sr-raiplay', 'sr-globoplay', 'sr-unext'] },
      { id: 'genres', title: 'Genres', refs: ['genre-action', 'genre-comedy', 'genre-drama', 'genre-thriller', 'genre-horror', 'genre-scifi', 'genre-animation'] },
      { id: 'franchises', title: 'Film Collections', refs: ['franchise-marvel', 'franchise-star-wars', 'franchise-harry-potter', 'franchise-bond', 'franchise-lotr', 'franchise-jurassic'] },
    ],
  },
  {
    id: 'persona-cinephile', title: 'Cinephile', icon: '🎬', kind: 'bundle', filters: ['people', 'world'],
    description: 'For film lovers: arthouse labels, the acclaimed canon, great directors and world cinema.',
    sections: [
      { id: 'labels', title: 'Arthouse Labels', refs: ['ci-a24', 'ci-neon', 'ci-searchlight', 'ci-focus', 'ci-plan-b', 'ci-studiocanal'] },
      { id: 'acclaimed', title: 'Acclaimed', refs: ['ci-masterpieces', 'ci-international', 'ci-golden-age', 'ci-docs'] },
      { id: 'directors', title: 'Directors', refs: ['preset-directors-kubrick', 'preset-directors-scorsese', 'preset-directors-nolan', 'preset-directors-villeneuve', 'preset-directors-bong_joon_ho', 'preset-directors-wes_anderson', 'preset-directors-pt_anderson', 'preset-directors-david_lynch', 'ci-coen', 'ci-cuaron'] },
      { id: 'world', title: 'World Cinema', refs: ['preset-world-cinema-japanese', 'preset-world-cinema-korean', 'preset-world-cinema-french', 'preset-world-cinema-italian', 'preset-world-cinema-spanish'] },
      { id: 'streaming', title: 'Where Cinephiles Stream', refs: ['ci-mubi', 'ci-bfi', 'ci-curzon', 'ci-filmin'] },
    ],
  },
  {
    id: 'persona-family', title: 'Family', icon: '👨‍👩‍👧', kind: 'bundle', filters: ['kids', 'seasonal'],
    description: 'Films for every age, the animation studios kids love, family sagas and the holidays.',
    sections: [
      { id: 'ages', title: 'By Age', refs: ['kf-little-ones', 'kf-kids', 'kf-tweens', 'kf-teens'] },
      { id: 'animation', title: 'Animation Studios', refs: ['kf-pixar', 'kf-disney', 'kf-dreamworks', 'kf-illumination', 'kf-aardman', 'kf-ghibli'] },
      { id: 'franchises', title: 'Family Franchises', refs: ['kf-toy-story', 'kf-shrek', 'kf-httyd', 'kf-despicable-me', 'kf-frozen', 'kf-paddington'] },
      { id: 'holidays', title: 'Holidays', refs: ['season-christmas', 'season-halloween', 'season-summer'] },
    ],
  },
  {
    id: 'persona-anime', title: 'Anime Fan', icon: '🍥', kind: 'bundle', filters: ['world'],
    description: 'Popular and new anime, the studios behind them, Japanese film and where to stream it.',
    sections: [
      { id: 'anime', title: 'Anime', refs: ['ah-popular', 'ah-new', 'ah-best', 'ah-films', 'ch-trending-anime'] },
      { id: 'genres', title: 'Anime Genres', refs: ['ah-isekai', 'ah-mecha', 'ah-shounen', 'ah-slice-of-life', 'ah-dark-fantasy'] },
      { id: 'studios', title: 'Anime Studios', refs: ['ah-mappa', 'ah-ufotable', 'ah-wit', 'ah-bones', 'ah-kyoani', 'ah-madhouse'] },
      { id: 'japan', title: 'Japanese Film & Streaming', refs: ['kf-ghibli', 'preset-world-cinema-japanese', 'sr-crunchyroll', 'sr-adn', 'sr-unext'] },
    ],
  },
  {
    id: 'persona-horror', title: 'Horror Fan', icon: '🎃', kind: 'bundle', filters: ['genres', 'seasonal'],
    description: 'The best of the Horror Vault plus Halloween, ready for every night of the year.',
    sections: [
      { id: 'subgenres', title: 'Horror Sub-genres', refs: ['hv-slasher', 'hv-supernatural', 'hv-found-footage', 'hv-folk', 'hv-creature', 'hv-zombies', 'hv-psychological'] },
      { id: 'franchises', title: 'Horror Franchises', refs: ['hv-halloween', 'hv-scream', 'hv-conjuring', 'hv-evil-dead', 'hv-friday-13th', 'hv-elm-street'] },
      { id: 'labels', title: 'Horror Labels', refs: ['hv-blumhouse', 'hv-a24', 'hv-hammer', 'sr-shudder'] },
      { id: 'season', title: 'Halloween', refs: ['season-halloween', 'hv-1980s', 'hv-japanese', 'hv-korean'] },
    ],
  },
  {
    id: 'persona-binge', title: 'Binge TV', icon: '📺', kind: 'bundle', filters: ['streaming', 'world'],
    description: 'Series first: your services, prestige channels, fresh episodes, world dramas and comfort sitcoms.',
    sections: [
      { id: 'streaming', title: 'Streaming', refs: ['sr-netflix', 'sr-prime', 'sr-disney', 'sr-apple', 'sr-hbo', 'sr-paramount', 'sr-hulu', 'sr-skyshowtime', 'sr-bbc-iplayer', 'sr-itvx', 'sr-now', 'sr-rtl-plus', 'sr-movistar', 'sr-raiplay', 'sr-globoplay', 'sr-unext'] },
      { id: 'prestige', title: 'Prestige TV', refs: ['preset-prestige-tv-hbo', 'preset-prestige-tv-fx', 'preset-prestige-tv-more', 'wt-sky-atlantic', 'wt-bbc-one'] },
      { id: 'fresh', title: 'Fresh Episodes', refs: ['preset-tv-binge-live', 'preset-tv-binge-popular', 'mv-sitcoms'] },
      { id: 'world', title: 'World Dramas', refs: ['wt-kdrama', 'wt-nordic-noir', 'wt-euro-crime', 'wt-turkish', 'wt-telenovelas'] },
    ],
  },
];

// Pack covers: four TMDB poster paths each (see the header).
const PACK_COVERS = require('./curated-covers-58.ts').PACK_COVERS;

export interface CuratedPacks58Api {
  buildNewPacks: any;
  PERSONA_BUNDLES: any;
  PACK_COVERS: Record<string, string[]>;
  REGIONS: Record<string, string[]>;
}

module.exports = { buildNewPacks, PERSONA_BUNDLES, PACK_COVERS, REGIONS } satisfies CuratedPacks58Api;
