// @ts-nocheck
// ── 5.8 pack catalogues (hand-maintained) ────────────────────
//
// Catalogue rows behind the 5.8 packs (Docs/plans/5.8-collections.md):
// Streaming by Region, Seasonal & Holidays, Horror Vault, Kids & Family,
// World TV & Dramas, Anime Hub, Shared Universes, Cinephile & Arthouse,
// Moods & Vibes, Based On, History & War, Sports Music & Performance and
// Charts & What's Hot. Every row uses a handler libcatalog.ts already
// implements; nothing here needs a new service or key.
//
// Ids are new and never collide with the generated table, the extra families
// or each other (catalogdefs.ts throws on a clash, a test pins it). Like every
// other catalogue id they are permanent once shipped: saved setups and pushed
// Nuvio folders reference them, so fix what a row points at, never its id.
// Names are unique per media type too, because the Nuvio folder label is
// derived from name + type.
//
// Each row was fetched with a real TMDB key on 2026-10-28 (page 1, setup
// language en-US = region GB; provider rows in all seven setup languages).
// Results: Docs/research/new-packs-verification-2026-10-28.md.
//
// Provider rows carry `stable: true`: the daily release-window rotation
// (catalog-rotation.ts) would empty a small regional service on old windows.
// Keyword/company rows use tmdb_discover, which never rotates, with a vote
// floor so obscure single-vote titles stay out.

const STREAMING = '🎬 Streaming';
const SEASONAL = '🗓️ Seasonal';
const HORROR = '🩸 Horror';
const KIDS = '🧸 Kids & Family';
const WORLD_TV = '🌏 World TV';
const ANIME = '🍥 Anime';
const UNIVERSES = '🪐 Shared Universes';
const CINEPHILE = '🎞️ Cinephile';
const MOODS = '🎨 Themes';
const BASED_ON = '📖 Based On';
const HISTORY = '🏛️ History & War';
const SPORTS_MUSIC = '🏟️ Sports & Music';
const CHARTS = '🔥 Trending';
const FILM_COLLECTIONS = '📚 Film Collections';

function apiType(type) { return type === 'series' ? 'tv' : 'movie'; }

function discover(name, type, group, tmdb, icon) {
  return { name, type, group, handler: 'tmdb_discover', params: { apiType: apiType(type), tmdb: { sort_by: 'popularity.desc', ...tmdb } }, icon };
}

function provider(name, type, providerId) {
  return { name, type, group: STREAMING, handler: 'tmdb_provider', params: { providerId, stable: true }, icon: '📺' };
}

function collection(name, collectionId, group = UNIVERSES, icon = '🪐') {
  return { name, type: 'movie', group, handler: 'tmdb_collection', params: { collectionId }, icon };
}

function mdblist(name, type, user, slug, listName) {
  return { name, type, group: CHARTS, handler: 'mdb_list', params: { user, slug, listName }, icon: '🔥' };
}

const catalogs = {};
function add(id, def) {
  if (catalogs[id]) throw new Error(`duplicate pack catalogue ${id}`);
  catalogs[id] = def;
}
function both(base, name, make) {
  add(`${base}_movies`, make(name, 'movie'));
  add(`${base}_series`, make(name, 'series'));
}

// ── Streaming services by region (watch region = setup language) ──
// [id base, display name, TMDB watch provider id(s), movies?, series?]
const SERVICES = [
  ['svc_bbc_iplayer', 'BBC iPlayer', 38, true, true],
  ['svc_itvx', 'ITVX', '41|2300', true, true],
  ['svc_channel4', 'Channel 4 Streaming', 103, true, true],
  ['svc_now', 'NOW', 39, true, true],
  ['svc_sky_go', 'Sky Go', 29, true, true],
  ['svc_channel5', 'Channel 5 Streaming', 333, true, true],
  ['svc_stv_player', 'STV Player', 593, true, true],
  ['svc_bfi_player', 'BFI Player', 224, true, false],
  ['svc_curzon', 'Curzon Home Cinema', 189, true, false],
  ['svc_joyn', 'Joyn', 304, true, true],
  ['svc_rtl_plus', 'RTL+', 2750, true, true],
  ['svc_wow', 'WOW', 30, true, true],
  ['svc_magenta_tv', 'MagentaTV', 178, true, true],
  ['svc_ard_mediathek', 'ARD Mediathek', 219, true, true],
  ['svc_canal_plus', 'Canal+ Streaming', 381, true, true],
  ['svc_arte', 'Arte', 234, true, true],
  ['svc_m6_plus', 'M6+', 147, true, true],
  ['svc_tf1_plus', 'TF1+', 1754, true, true],
  ['svc_adn_anime', 'ADN Anime Digital Network', 415, true, true],
  ['svc_movistar_plus', 'Movistar Plus+', '2241|149', true, true],
  ['svc_filmin', 'Filmin', 63, true, true],
  ['svc_atresplayer', 'Atresplayer', 62, true, true],
  ['svc_skyshowtime', 'SkyShowtime', 1773, true, true],
  ['svc_rtve', 'RTVE Play', 541, true, true],
  ['svc_raiplay', 'RaiPlay', 222, true, true],
  ['svc_mediaset_infinity', 'Mediaset Infinity', 359, true, true],
  ['svc_timvision', 'TIMvision', 109, true, true],
  ['svc_globoplay', 'Globoplay', 307, true, true],
  ['svc_claro_video', 'Claro video', 167, true, true],
  ['svc_unext', 'U-NEXT', 84, true, true],
  ['svc_pluto_tv', 'Pluto TV', 300, true, true],
  ['svc_plex', 'Plex', 538, true, true],
];
for (const [base, name, id, movies, series] of SERVICES) {
  if (movies) add(`${base}_movies`, provider(name, 'movie', id));
  if (series) add(`${base}_series`, provider(name, 'series', id));
}

// ── Seasonal & holidays ──
const VOTES = { 'vote_count.gte': 50 };
add('season_halloween_movies', discover('Halloween Season', 'movie', SEASONAL, { with_keywords: 3335, ...VOTES }, '🎃'));
add('season_valentines_movies', discover("Valentine's Day", 'movie', SEASONAL, { with_keywords: 160404, 'vote_count.gte': 20 }, '💘'));
add('season_summer_movies', discover('Summer Vibes', 'movie', SEASONAL, { with_keywords: '13088|5767|7312', ...VOTES }, '☀️'));
add('season_new_year_movies', discover("New Year's Eve", 'movie', SEASONAL, { with_keywords: 613, 'vote_count.gte': 20 }, '🎆'));
add('season_christmas_series', discover('Christmas Specials', 'series', SEASONAL, { with_keywords: 207317, 'vote_count.gte': 5 }, '🎄'));

// ── Horror Vault ──
const HORROR_VOTES = { 'vote_count.gte': 30 };
const HORROR_SUBGENRES = [
  ['horror_slasher_movies', 'Slasher', 12339],
  ['horror_supernatural_movies', 'Supernatural Horror', 6152],
  ['horror_found_footage_movies', 'Found Footage', 163053],
  ['horror_folk_movies', 'Folk Horror', 209568],
  ['horror_body_movies', 'Body Horror', 283085],
  ['horror_cosmic_movies', 'Cosmic Horror', 215959],
  ['horror_creature_movies', 'Creature Features', 158126],
  ['horror_vampire_movies', 'Vampires', 3133],
  ['horror_werewolf_movies', 'Werewolves', 12564],
  ['horror_haunted_house_movies', 'Haunted Houses', 3358],
  ['horror_psychological_movies', 'Psychological Horror', 295907],
  ['horror_giallo_movies', 'Giallo', 361094],
  ['horror_home_invasion_movies', 'Home Invasion', 14903],
  ['horror_witch_movies', 'Witches', 616],
];
for (const [id, name, keyword] of HORROR_SUBGENRES) {
  add(id, discover(name, 'movie', HORROR, { with_keywords: keyword, with_genres: 27, ...HORROR_VOTES }, '🩸'));
}
const HORROR_STUDIOS = [
  ['horror_a24_movies', 'A24 Horror', 41077],
  ['horror_hammer_movies', 'Hammer Films', 1314],
  ['horror_atomic_monster_movies', 'Atomic Monster', 76907],
  ['horror_ghost_house_movies', 'Ghost House Pictures', 768],
  ['horror_platinum_dunes_movies', 'Platinum Dunes', 2481],
];
for (const [id, name, company] of HORROR_STUDIOS) {
  add(id, discover(name, 'movie', HORROR, { with_companies: company, with_genres: 27, 'vote_count.gte': 10 }, '🏚️'));
}
const HORROR_DECADES = [['1970s', 1970], ['1980s', 1980], ['1990s', 1990], ['2000s', 2000], ['2010s', 2010], ['2020s', 2020]];
for (const [label, start] of HORROR_DECADES) {
  add(`horror_${label}_movies`, discover(`${label} Horror`, 'movie', HORROR, {
    with_genres: 27,
    'primary_release_date.gte': `${start}-01-01`,
    'primary_release_date.lte': `${start + 9}-12-31`,
    'vote_count.gte': 100,
  }, '📼'));
}
const HORROR_WORLD = [
  ['horror_japanese_movies', 'J-Horror', 'ja'],
  ['horror_korean_movies', 'K-Horror', 'ko'],
  ['horror_spanish_movies', 'Spanish-Language Horror', 'es'],
  ['horror_italian_movies', 'Italian Horror', 'it'],
  ['horror_french_movies', 'French Horror', 'fr'],
];
for (const [id, name, language] of HORROR_WORLD) {
  add(id, discover(name, 'movie', HORROR, { with_genres: 27, with_original_language: language, 'vote_count.gte': 20 }, '🌍'));
}
add('collection_evil_dead', collection('Evil Dead', 1960, FILM_COLLECTIONS, '📚'));
add('collection_friday_13th', collection('Friday the 13th', 9735, FILM_COLLECTIONS, '📚'));
add('collection_texas_chainsaw', collection('The Texas Chainsaw Massacre', 111751, FILM_COLLECTIONS, '📚'));
add('collection_28_days_later', collection('28 Days Later', 1565, FILM_COLLECTIONS, '📚'));
add('collection_insidious', collection('Insidious', 228446, FILM_COLLECTIONS, '📚'));
add('collection_final_destination', collection('Final Destination', 8864, FILM_COLLECTIONS, '📚'));
// More horror franchises (TMDB collection ids checked 2026-10-29; '|' merges
// an original series with its reboot, in release order).
add('collection_childs_play', collection('Child\'s Play', 10455, FILM_COLLECTIONS, '📚'));
add('collection_hellraiser', collection('Hellraiser', 8917, FILM_COLLECTIONS, '📚'));
add('collection_candyman', collection('Candyman', 98580, FILM_COLLECTIONS, '📚'));
add('collection_the_omen', collection('The Omen', 10919, FILM_COLLECTIONS, '📚'));
add('collection_jaws', collection('Jaws', 2366, FILM_COLLECTIONS, '📚'));
add('collection_pet_sematary', collection('Pet Sematary', '10789|830781', FILM_COLLECTIONS, '📚'));
add('collection_paranormal_activity', collection('Paranormal Activity', 41437, FILM_COLLECTIONS, '📚'));
add('collection_annabelle', collection('Annabelle', 402074, FILM_COLLECTIONS, '📚'));
add('collection_sinister', collection('Sinister', 357173, FILM_COLLECTIONS, '📚'));
add('collection_the_ring', collection('The Ring', 14563, FILM_COLLECTIONS, '📚'));
add('collection_the_grudge', collection('The Grudge', 1974, FILM_COLLECTIONS, '📚'));
add('collection_the_purge', collection('The Purge', 256322, FILM_COLLECTIONS, '📚'));
add('collection_the_exorcist', collection('The Exorcist', 12263, FILM_COLLECTIONS, '📚'));
add('collection_wrong_turn', collection('Wrong Turn', 52985, FILM_COLLECTIONS, '📚'));
add('collection_hostel', collection('Hostel', 86578, FILM_COLLECTIONS, '📚'));
add('collection_terrifier', collection('Terrifier', 727761, FILM_COLLECTIONS, '📚'));
add('collection_it', collection('It', 477962, FILM_COLLECTIONS, '📚'));
add('collection_a_quiet_place', collection('A Quiet Place', 521226, FILM_COLLECTIONS, '📚'));
add('collection_resident_evil', collection('Resident Evil', 17255, FILM_COLLECTIONS, '📚'));
add('collection_jeepers_creepers', collection('Jeepers Creepers', 94899, FILM_COLLECTIONS, '📚'));
add('collection_hills_have_eyes', collection('The Hills Have Eyes', '267922|8918', FILM_COLLECTIONS, '📚'));
add('collection_poltergeist', collection('Poltergeist', 10453, FILM_COLLECTIONS, '📚'));
add('collection_smile', collection('Smile', 1100788, FILM_COLLECTIONS, '📚'));

// ── Kids & Family ──
// US certifications: TMDB's discover needs one certification country, and
// the US ratings are the most complete set on TMDB.
add('kids_little_ones_movies', discover('Little Ones (G)', 'movie', KIDS, { certification_country: 'US', certification: 'G', with_genres: '10751|16', 'vote_count.gte': 50 }, '🧸'));
add('kids_pg_movies', discover('Kids (PG)', 'movie', KIDS, { certification_country: 'US', certification: 'PG', with_genres: 10751, 'vote_count.gte': 50 }, '🎈'));
add('kids_tweens_movies', discover('Tweens (PG-13)', 'movie', KIDS, { certification_country: 'US', certification: 'PG-13', with_genres: 10751, 'vote_count.gte': 50 }, '🛹'));
both('kids_coming_of_age', 'Teens & Coming of Age', (name, type) => discover(name, type, KIDS, { with_keywords: 10683, 'vote_count.gte': type === 'series' ? 10 : 50 }, '🎒'));
const ANIMATION_STUDIOS = [
  ['kids_sony_animation_movies', 'Sony Pictures Animation', 2251],
  ['kids_aardman_movies', 'Aardman', 297],
  ['kids_laika_movies', 'Laika', 11537],
  ['kids_cartoon_saloon_movies', 'Cartoon Saloon', 23948],
  ['kids_blue_sky_movies', 'Blue Sky Studios', 9383],
];
for (const [id, name, company] of ANIMATION_STUDIOS) {
  add(id, discover(name, 'movie', KIDS, { with_companies: company, 'vote_count.gte': 5 }, '🎨'));
}
add('kids_disney_channel_series', discover('Disney Channel', 'series', KIDS, { with_networks: 54, 'vote_count.gte': 5 }, '📺'));
add('kids_nickelodeon_series', discover('Nickelodeon', 'series', KIDS, { with_networks: 13, 'vote_count.gte': 5 }, '📺'));
add('kids_cartoon_network_series', discover('Cartoon Network', 'series', KIDS, { with_networks: 56, 'vote_count.gte': 5 }, '📺'));
add('kids_tv_series', discover('Kids TV', 'series', KIDS, { with_genres: 10762, 'vote_count.gte': 20 }, '📺'));
add('collection_frozen', collection('Frozen', 386382, FILM_COLLECTIONS, '📚'));
add('collection_madagascar', collection('Madagascar', 14740, FILM_COLLECTIONS, '📚'));
add('collection_paddington', collection('Paddington', 488924, FILM_COLLECTIONS, '📚'));
add('collection_cars', collection('Cars', 87118, FILM_COLLECTIONS, '📚'));

// ── World TV & Dramas (series) ──
const DRAMA = { 'vote_count.gte': 20 };
add('worldtv_kdrama_series', discover('K-Drama', 'series', WORLD_TV, { with_original_language: 'ko', with_genres: 18, ...DRAMA }, '🇰🇷'));
add('worldtv_tvn_series', discover('tvN', 'series', WORLD_TV, { with_networks: 866, 'vote_count.gte': 10 }, '🇰🇷'));
add('worldtv_jtbc_series', discover('JTBC', 'series', WORLD_TV, { with_networks: 885, 'vote_count.gte': 10 }, '🇰🇷'));
add('worldtv_jdrama_series', discover('J-Drama', 'series', WORLD_TV, { with_original_language: 'ja', with_genres: 18, without_genres: 16, ...DRAMA }, '🇯🇵'));
add('worldtv_cdrama_series', discover('C-Drama', 'series', WORLD_TV, { with_original_language: 'zh', with_genres: 18, ...DRAMA }, '🇨🇳'));
add('worldtv_thai_drama_series', discover('Thai Drama', 'series', WORLD_TV, { with_original_language: 'th', with_genres: 18, 'vote_count.gte': 5 }, '🇹🇭'));
const BRITISH_NETWORKS = [
  ['worldtv_bbc_one_series', 'BBC One', 4],
  ['worldtv_bbc_two_series', 'BBC Two', 332],
  ['worldtv_channel4_series', 'Channel 4', 26],
  ['worldtv_itv1_series', 'ITV1', 9],
  ['worldtv_sky_atlantic_series', 'Sky Atlantic', 1063],
  ['worldtv_e4_series', 'E4', 136],
];
for (const [id, name, network] of BRITISH_NETWORKS) {
  add(id, discover(name, 'series', WORLD_TV, { with_networks: network, 'vote_count.gte': 10 }, '🇬🇧'));
}
add('worldtv_nordic_noir_series', discover('Nordic Noir', 'series', WORLD_TV, { with_origin_country: 'SE|DK|NO|IS|FI', with_genres: 80, 'vote_count.gte': 10 }, '❄️'));
add('worldtv_turkish_dizi_series', discover('Turkish Dizi', 'series', WORLD_TV, { with_origin_country: 'TR', with_genres: 18, 'vote_count.gte': 10 }, '🇹🇷'));
add('worldtv_telenovelas_series', discover('Telenovelas', 'series', WORLD_TV, { with_origin_country: 'MX|CO|AR|VE|BR', with_genres: '10766|18', 'vote_count.gte': 10 }, '💃'));
add('worldtv_spanish_series', discover('Spanish TV', 'series', WORLD_TV, { with_origin_country: 'ES', 'vote_count.gte': 20 }, '🇪🇸'));
add('worldtv_indian_series', discover('Indian Series', 'series', WORLD_TV, { with_origin_country: 'IN', 'vote_count.gte': 10 }, '🇮🇳'));
add('worldtv_euro_crime_series', discover('Euro Crime', 'series', WORLD_TV, { with_origin_country: 'FR|DE|IT|BE|NL|ES', with_genres: 80, 'vote_count.gte': 20 }, '🕵️'));
add('worldtv_australian_series', discover('Australian TV', 'series', WORLD_TV, { with_origin_country: 'AU', 'vote_count.gte': 20 }, '🇦🇺'));

// ── Anime Hub (ids carry "anime" so Hide anime removes them) ──
const JA_ANIMATION = { with_genres: 16, with_original_language: 'ja' };
add('anime_popular_series', discover('Anime Series', 'series', ANIME, { ...JA_ANIMATION, 'vote_count.gte': 50 }, '🍥'));
add('anime_films_movies', discover('Anime Films', 'movie', ANIME, { ...JA_ANIMATION, 'vote_count.gte': 50 }, '🍥'));
add('anime_best_series', discover('Highest Rated Anime', 'series', ANIME, { ...JA_ANIMATION, sort_by: 'vote_average.desc', 'vote_count.gte': 300 }, '🍥'));
add('anime_new_series', discover('New Anime', 'series', ANIME, { ...JA_ANIMATION, sort_by: 'first_air_date.desc', 'vote_count.gte': 10 }, '🍥'));
const ANIME_KEYWORDS = [
  ['anime_isekai_series', 'Isekai', 237451],
  ['anime_mecha_series', 'Mecha', 10046],
  ['anime_shounen_series', 'Shounen', 207826],
  ['anime_slice_of_life_series', 'Slice of Life Anime', 9914],
  ['anime_dark_fantasy_series', 'Dark Fantasy Anime', 177895],
];
for (const [id, name, keyword] of ANIME_KEYWORDS) {
  add(id, discover(name, 'series', ANIME, { ...JA_ANIMATION, with_keywords: keyword, 'vote_count.gte': 10 }, '🍥'));
}
const ANIME_STUDIOS = [
  ['anime_mappa_series', 'MAPPA', 21444],
  ['anime_ufotable_series', 'ufotable', 5887],
  ['anime_wit_studio_series', 'Wit Studio', 31058],
  ['anime_bones_series', 'Bones', 2849],
  ['anime_kyoto_animation_series', 'Kyoto Animation', 5438],
  ['anime_madhouse_series', 'Madhouse', 3464],
  ['anime_toei_series', 'Toei Animation', 5542],
  ['anime_production_ig_series', 'Production I.G', 529],
  ['anime_a1_pictures_series', 'A-1 Pictures', 13113],
  ['anime_cloverworks_series', 'CloverWorks', 121589],
];
for (const [id, name, company] of ANIME_STUDIOS) {
  add(id, discover(name, 'series', ANIME, { with_companies: company, 'vote_count.gte': 5 }, '🍥'));
}

// ── Shared Universes (several TMDB collections in release order) ──
add('universe_mcu_order_movies', discover('MCU in Release Order', 'movie', UNIVERSES, { with_keywords: 180547, sort_by: 'primary_release_date.asc', 'vote_count.gte': 100 }, '🪐'));
add('universe_wizarding_world', collection('Wizarding World', '1241|435259'));
add('universe_middle_earth', collection('Middle-earth', '119|121938'));
add('universe_monsterverse', collection('MonsterVerse', '535313|1539140'));
add('universe_star_trek', collection('Star Trek Universe', '151|115575'));
add('universe_alien_predator', collection('Alien vs. Predator', '8091|399|115762'));
add('universe_conjuring', collection('The Conjuring Universe', '313086|402074'));
add('universe_rocky_creed', collection('Rocky & Creed', '1575|553717'));
add('universe_spider_verse', collection('Spider-Verse', 573436));

// ── Cinephile & Arthouse ──
const LABELS = [
  ['cine_neon_movies', 'Neon', 90733],
  ['cine_searchlight_movies', 'Searchlight Pictures', '43|127929'],
  ['cine_focus_features_movies', 'Focus Features', 10146],
  ['cine_annapurna_movies', 'Annapurna Pictures', 13184],
  ['cine_plan_b_movies', 'Plan B Entertainment', 81],
  ['cine_working_title_movies', 'Working Title', 10163],
  ['cine_ifc_films_movies', 'IFC Films', 307],
  ['cine_film4_movies', 'Film4', 6705],
  ['cine_bbc_film_movies', 'BBC Film', 288],
  ['cine_studiocanal_movies', 'StudioCanal', 694],
];
for (const [id, name, company] of LABELS) {
  add(id, discover(name, 'movie', CINEPHILE, { with_companies: company, 'vote_count.gte': 20 }, '🎞️'));
}
add('cine_masterpieces_movies', discover('Masterpieces', 'movie', CINEPHILE, { sort_by: 'vote_average.desc', 'vote_average.gte': 8, 'vote_count.gte': 3000 }, '🏆'));
add('cine_international_movies', discover('International Acclaim', 'movie', CINEPHILE, { with_original_language: 'fr|it|ja|ko|es|de|sv|da|zh|fa|pt|ru|pl', sort_by: 'vote_average.desc', 'vote_average.gte': 7.5, 'vote_count.gte': 500 }, '🌍'));
add('cine_golden_age_movies', discover('Golden Age Classics', 'movie', CINEPHILE, { 'primary_release_date.lte': '1969-12-31', sort_by: 'vote_average.desc', 'vote_count.gte': 1000 }, '🎩'));
add('cine_silent_era_movies', discover('Silent Era', 'movie', CINEPHILE, { 'primary_release_date.lte': '1929-12-31', sort_by: 'vote_average.desc', 'vote_count.gte': 100 }, '🎹'));
add('cine_acclaimed_docs_movies', discover('Acclaimed Documentaries', 'movie', CINEPHILE, { with_genres: 99, sort_by: 'vote_average.desc', 'vote_average.gte': 7.5, 'vote_count.gte': 300 }, '🎥'));

// ── Moods & Vibes ──
add('mood_feel_good_movies', discover('Feel-Good', 'movie', MOODS, { with_keywords: '383896|319357|275276', 'vote_count.gte': 10 }, '😊'));
add('mood_dark_comedy_movies', discover('Dark Comedy', 'movie', MOODS, { with_keywords: 10123, 'vote_count.gte': 100 }, '🖤'));
add('mood_cult_classics_movies', discover('Cult Classics', 'movie', MOODS, { with_keywords: 34117, 'vote_count.gte': 100 }, '🛸'));
add('mood_neo_noir_movies', discover('Neo-Noir', 'movie', MOODS, { with_keywords: 207268, 'vote_count.gte': 100 }, '🌃'));
add('mood_sitcoms_series', discover('Comfort Sitcoms', 'series', MOODS, { with_keywords: 193171, 'vote_count.gte': 50 }, '🛋️'));
add('mood_under_90_movies', discover('Under 90 Minutes', 'movie', MOODS, { 'with_runtime.gte': 60, 'with_runtime.lte': 90, 'vote_count.gte': 1000 }, '⏱️'));
add('mood_edge_of_seat_movies', discover('Edge of Your Seat', 'movie', MOODS, { with_genres: 53, 'vote_average.gte': 7, 'vote_count.gte': 2000 }, '😬'));
add('mood_big_laughs_movies', discover('Big Laughs', 'movie', MOODS, { with_genres: 35, 'vote_average.gte': 7, 'vote_count.gte': 1500 }, '😂'));

// ── Based On ──
both('basedon_book', 'Based on a Book', (name, type) => discover(name, type, BASED_ON, { with_keywords: 818, 'vote_count.gte': type === 'series' ? 20 : 100 }, '📚'));
both('basedon_comic', 'Based on a Comic', (name, type) => discover(name, type, BASED_ON, { with_keywords: 9717, 'vote_count.gte': type === 'series' ? 20 : 100 }, '💥'));
both('basedon_video_game', 'Based on a Video Game', (name, type) => discover(name, type, BASED_ON, { with_keywords: 41645, 'vote_count.gte': type === 'series' ? 5 : 20 }, '🎮'));
add('basedon_manga_movies', discover('Based on a Manga', 'movie', BASED_ON, { with_keywords: 13141, without_genres: 16, 'vote_count.gte': 10 }, '🗾'));
add('basedon_biopic_movies', discover('Biopics', 'movie', BASED_ON, { with_keywords: 5565, 'vote_count.gte': 100 }, '🧑‍🎤'));
add('basedon_true_story_series', discover('True Story Series', 'series', BASED_ON, { with_keywords: 9672, 'vote_count.gte': 20 }, '📰'));

// ── History & War ──
const HISTORY_KEYWORDS = [
  ['hist_ancient_rome_movies', 'Ancient Rome', 5049],
  ['hist_medieval_movies', 'Medieval', '161257|235489|260887'],
  ['hist_samurai_movies', 'Samurai', 1462],
  ['hist_wuxia_movies', 'Wuxia', 184656],
  ['hist_victorian_movies', 'Victorian Era', '252596|8250'],
  ['hist_ww2_movies', 'World War II', 1956],
  ['hist_vietnam_war_movies', 'Vietnam War', 2957],
  ['hist_cold_war_movies', 'Cold War', 2106],
  ['hist_spy_movies', 'Spy Thrillers', 470],
  ['hist_spaghetti_western_movies', 'Spaghetti Westerns', 156212],
];
for (const [id, name, keyword] of HISTORY_KEYWORDS) {
  add(id, discover(name, 'movie', HISTORY, { with_keywords: keyword, 'vote_count.gte': 30 }, '🏛️'));
}
add('hist_period_drama_series', discover('Period Dramas', 'series', HISTORY, { with_keywords: '15060|192772', 'vote_count.gte': 20 }, '👑'));

// ── Sports, Music & Performance ──
const SPORTS = [
  ['sport_boxing_movies', 'Boxing', 209476],
  ['sport_football_movies', 'Football (Soccer)', 13042],
  ['sport_basketball_movies', 'Basketball', 6496],
  ['sport_motorsport_movies', 'Motorsport', 830],
  ['sport_underdog_movies', 'Underdog Stories', 240],
];
for (const [id, name, keyword] of SPORTS) {
  add(id, discover(name, 'movie', SPORTS_MUSIC, { with_keywords: keyword, 'vote_count.gte': 30 }, '🏟️'));
}
add('sport_documentaries_movies', discover('Sports Documentaries', 'movie', SPORTS_MUSIC, { with_genres: 99, with_keywords: 6075, 'vote_count.gte': 10 }, '🏅'));
add('sport_docuseries_series', discover('Sports Docuseries', 'series', SPORTS_MUSIC, { with_genres: 99, with_keywords: 6075, 'vote_count.gte': 5 }, '🏅'));
add('music_musicals_movies', discover('Big-Screen Musicals', 'movie', SPORTS_MUSIC, { with_keywords: 4344, 'vote_count.gte': 50 }, '🎭'));
add('music_concert_films_movies', discover('Concert Films', 'movie', SPORTS_MUSIC, { with_keywords: 156205, 'vote_count.gte': 5 }, '🎤'));
add('music_documentaries_movies', discover('Music Documentaries', 'movie', SPORTS_MUSIC, { with_genres: '99,10402', 'vote_count.gte': 20 }, '🎸'));
add('music_hip_hop_movies', discover('Hip-Hop', 'movie', SPORTS_MUSIC, { with_keywords: 898, 'vote_count.gte': 20 }, '🎧'));
add('music_dance_movies', discover('Dance', 'movie', SPORTS_MUSIC, { with_keywords: 1691, 'vote_count.gte': 30 }, '💃'));

// ── Charts & What's Hot (public MDBList lists) ──
add('chart_watched_week_movies', mdblist('Most Watched This Week', 'movie', 'linaspurinis', 'top-watched-movies-of-the-week', 'Top Watched Movies of the Week'));
add('chart_moviemeter_movies', mdblist('IMDb Moviemeter', 'movie', 'linaspurinis', 'imdb-moviemeter-top-100', 'IMDb Moviemeter Top 100'));
add('chart_imdb_top_shows_series', mdblist('IMDb Top 250 Shows', 'series', 'snoak', 'imdb-top-250-shows', 'IMDb Top 250 Shows'));
add('chart_trending_anime_series', mdblist('Trending Anime', 'series', 'snoak', 'trending-anime-shows', 'Trending Anime Shows'));
add('chart_bluray_movies', mdblist('New on Blu-ray', 'movie', 'garycrawfordgc', 'latest-blu-ray-releases', 'Latest Blu-ray Releases'));
add('chart_pirated_week_movies', mdblist('Most Pirated This Week', 'movie', 'k0meta', 'top-ten-pirated-movies-of-the-week-torrent-freakcom', 'Top 10 Pirated Movies of the Week'));
add('chart_metacritic_movies', mdblist('Metacritic Must-See', 'movie', 'k0meta', 'metacriticmustseemovies', 'Metacritic Must-See Movies'));
add('chart_metacritic_series', mdblist('Metacritic Must-See', 'series', 'k0meta', 'metacriticmustseeshows', 'Metacritic Must-See Shows'));

export interface CatalogdefsPacksApi {
  catalogs: any;
}

module.exports = { catalogs } satisfies CatalogdefsPacksApi;
