// @ts-nocheck
// Shared, opt-in Nuvio collection packs.
//
// This module deliberately contains no account-only code: both the hosted
// account area and the public /configure page consume the exact same pack
// definitions. Artwork is bundled and served locally, while catalog ids stay
// LeLibrary's own stable `lib-*` sources.

const { FOLDER_ART } = require('./curated-folder-art-58.ts');
const { getSourceDefinition, listSources, canonicalSourceId } = require('./catalog-source-registry.ts');
const fs = require('fs');
const path = require('path');

// Bump when the bundled collection cover/backdrop art changes. Long-lived
// immutable caching (Cloudflare + express.static) otherwise keeps serving the
// previous bytes for up to 30 days under the same URL.
const COLLECTION_ASSET_VERSION = '3';
function versionAsset(url) {
  if (typeof url !== 'string' || !url.startsWith('/collection-assets/')) return url;
  return url.includes('?') ? url : `${url}?v=${COLLECTION_ASSET_VERSION}`;
}

function artwork(category, name, extension = 'png', focus = false, coverFile = '', focusFile = '', focusUrl = '', coverUrl = '', backdropUrl = '') {
  return {
    _assetKind: 'collection',
    _coverExtension: extension,
    _hasFocusGif: focus,
    _coverFile: coverFile,
    _focusFile: focusFile,
    _focusUrl: focusUrl,
    _coverUrl: coverUrl,
    _backdropUrl: backdropUrl,
    artworkSource: 'rrevanth/nuvio-assets',
  };
}

function actorArtwork(name, backdrop = 'Backdrop') {
  return {
    _assetKind: 'person',
    _hasFocusGif: true,
    _hasHeroBackdrop: true,
    artworkSource: 'ImKaptain/nuvio-assets',
  };
}

function folder(id, title, sourceId, art = {}, extraSourceIds = []) {
  const asset = { ...art };
  if (asset._assetKind === 'collection') {
    asset.coverImageUrl = `/collection-assets/collections/covers/${asset._coverFile || `${id}.${asset._coverExtension}`}`;
    if (asset._coverUrl) asset.coverImageUrl = asset._coverUrl;
    asset.coverImageUrl = versionAsset(asset.coverImageUrl);
    asset.focusGifUrl = versionAsset(asset._focusUrl
      || (asset._focusFile ? `/collection-assets/collections/gifs/${asset._focusFile}` : '')
      || (asset._hasFocusGif ? `/collection-assets/collections/gifs/${id}-focus.gif` : ''));
    // If an artwork definition supplies a GIF URL, it should be live by
    // default. Older pack entries often supplied a focus file/URL without
    // also setting the separate boolean, leaving the animation invisible.
    asset.focusGifEnabled = !!(asset._hasFocusGif || asset.focusGifUrl);
    if (asset._backdropUrl) asset.heroBackdropUrl = versionAsset(asset._backdropUrl);
  } else if (asset._assetKind === 'person') {
    asset.coverImageUrl = versionAsset(`/collection-assets/people/covers/${id}.png`);
    asset.focusGifUrl = versionAsset(`/collection-assets/people/gifs/${id}.gif`);
    asset.focusGifEnabled = true;
    asset.heroBackdropUrl = versionAsset(`/collection-assets/people/backdrops/${id}.jpg`);
  }
  delete asset._assetKind;
  delete asset._coverExtension;
  delete asset._hasFocusGif;
  delete asset._coverFile;
  delete asset._focusFile;
  delete asset._focusUrl;
  delete asset._coverUrl;
  delete asset._backdropUrl;
  delete asset._hasHeroBackdrop;
  return {
    id: `folder-lelibrary-${id}`,
    title,
    tileShape: 'LANDSCAPE',
    hideTitle: false,
    heroBackdropUrl: '',
    heroVideoUrl: '',
    titleLogoUrl: '',
    ...asset,
    catalogSources: [sourceId, ...extraSourceIds].filter(Boolean).map((catalogId) => ({
      catalogId: `lib-${catalogId}`,
      type: getSourceDefinition(catalogId)?.type || 'movie',
    })),
  };
}

const DEFAULT_PACK_SETTINGS = Object.freeze({
  viewMode: 'TABBED_GRID',
  pinToTop: false,
  showAllTab: true,
  focusGlowEnabled: true,
});

function normalisePackSettings(settings = {}) {
  return {
    viewMode: settings.viewMode === 'FOLLOW_LAYOUT' ? 'FOLLOW_LAYOUT' : 'TABBED_GRID',
    pinToTop: settings.pinToTop === true,
    showAllTab: settings.showAllTab !== false,
    focusGlowEnabled: settings.focusGlowEnabled !== false,
  };
}

function pairedSourceId(sourceId) {
  const id = String(sourceId || '');
  if (id === 'tmdb_popular_movies') return 'tmdb_popular_series';
  if (id === 'tmdb_popular_series') return 'tmdb_popular_movies';
  if (id.endsWith('_movies')) return id.slice(0, -7) + '_series';
  if (id.endsWith('_series')) return id.slice(0, -7) + '_movies';
  return '';
}

function mergeCompatibleMediaSources(packs) {
  return packs.map((pack) => {
    const folders = [];
    const byPair = new Map();

    for (const original of pack.folders) {
      const sources = Array.isArray(original.catalogSources) ? original.catalogSources : [];
      const primary = sources[0];
      const sourceId = String(primary?.catalogId || '').replace(/^lib-/, '');
      const candidateId = pairedSourceId(sourceId);
      const candidate = candidateId ? getSourceDefinition(candidateId) : null;
      const pairKey = candidate?.available ? [sourceId, candidateId].sort().join('|') : sourceId;
      const existing = byPair.get(pairKey);

      if (existing) {
        for (const source of sources) {
          const sourceKey = String(source.catalogId || '').replace(/^lib-/, '');
          if (!existing.catalogSources.some((item) => String(item.catalogId || '').replace(/^lib-/, '') === sourceKey)) {
            existing.catalogSources.push(source);
          }
        }
        continue;
      }

      const folder = { ...original, catalogSources: sources.slice() };
      if (candidate?.available && / (Movies|Series)$/.test(folder.title || '')) {
        folder.title = folder.title.replace(/ (Movies|Series)$/, '');
      }
      if (candidate?.available && !folder.catalogSources.some((source) => String(source.catalogId || '').replace(/^lib-/, '') === candidateId)) {
        folder.catalogSources.push({ catalogId: `lib-${candidateId}`, type: candidate.type });
      }
      byPair.set(pairKey, folder);
      folders.push(folder);
    }

    return dedupePackSources({ ...pack, folders });
  });
}

// One folder per source: an alias (catalogdefs-fixes.ts) serves exactly its
// canonical definition, so a pack must never list the same canonical source
// twice. The first folder keeps it; a folder left with no source is dropped.
function dedupePackSources(pack) {
  const seen = new Set();
  const folders = [];
  for (const item of pack.folders) {
    const catalogSources = (item.catalogSources || []).filter((source) => {
      const key = `${source.type || 'movie'}:${canonicalSourceId(source.catalogId)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (catalogSources.length) folders.push({ ...item, catalogSources });
  }
  return { ...pack, folders };
}

// Preset packs for the hand-maintained source families (directors, decades and
// original-language world cinema). Kept out of LeLibrary Special on purpose:
// the special sampler stays lean while these remain opt-in, like the other
// presets. Each pack has its own wide artwork for the picker and collection
// backdrop; its individual folders remain intentionally simple.
const DIRECTOR_PACK_FOLDERS = [
  ['nolan', 'Christopher Nolan'], ['spielberg', 'Steven Spielberg'], ['tarantino', 'Quentin Tarantino'],
  ['scorsese', 'Martin Scorsese'], ['fincher', 'David Fincher'], ['kubrick', 'Stanley Kubrick'],
  ['villeneuve', 'Denis Villeneuve'], ['ridley_scott', 'Ridley Scott'], ['cameron', 'James Cameron'],
  ['peter_jackson', 'Peter Jackson'], ['wes_anderson', 'Wes Anderson'], ['bong_joon_ho', 'Bong Joon-ho'],
  ['tim_burton', 'Tim Burton'], ['hitchcock', 'Alfred Hitchcock'], ['david_lynch', 'David Lynch'],
  ['pt_anderson', 'Paul Thomas Anderson'], ['guy_ritchie', 'Guy Ritchie'], ['zack_snyder', 'Zack Snyder'],
  ['michael_bay', 'Michael Bay'], ['clint_eastwood', 'Clint Eastwood'], ['james_gunn', 'James Gunn'],
  ['taika_waititi', 'Taika Waititi'], ['jordan_peele', 'Jordan Peele'], ['robert_eggers', 'Robert Eggers'],
  ['ari_aster', 'Ari Aster'], ['greta_gerwig', 'Greta Gerwig'], ['sofia_coppola', 'Sofia Coppola'],
  ['spike_lee', 'Spike Lee'], ['guillermo_del_toro', 'Guillermo del Toro'], ['edgar_wright', 'Edgar Wright'],
].map(([key, title]) => folder(`preset-directors-${key}`, title, `director_${key}_movies`));

const DECADE_PACK_FOLDERS = ['2020s', '2010s', '2000s', '1990s', '1980s', '1970s', '1960s', '1950s'].map((label) => {
  const extra = ['2020s', '2010s', '2000s', '1990s', '1980s'].includes(label) ? [`decade_${label}_series`] : [];
  return folder(`preset-decades-${label}`, label, `decade_${label}_movies`, {}, extra);
});

const WORLD_CINEMA_FOLDERS = [
  ['japanese', 'Japanese'], ['korean', 'Korean'], ['spanish', 'Spanish'], ['french', 'French'],
  ['german', 'German'], ['italian', 'Italian'], ['hindi', 'Hindi'], ['chinese', 'Chinese'],
  ['portuguese', 'Portuguese'], ['russian', 'Russian'], ['turkish', 'Turkish'], ['thai', 'Thai'],
  ['indonesian', 'Indonesian'], ['swedish', 'Swedish'],
].map(([key, title]) => folder(`preset-world-cinema-${key}`, title, `language_${key}_movies`, {}, [`language_${key}_series`]));

const CURATED_COLLECTIONS = mergeCompatibleMediaSources([
  {
    id: 'discover', title: 'Discover', icon: '✨',
    description: 'The essential new, popular and all-time-great rows.',
    folders: [
      folder('discover-trending-movies', 'Trending Movies', 'trending_movies', artwork('discover', 'trending', 'jpg', true)),
      folder('discover-trending-series', 'Trending Series', 'trending_series', artwork('discover', 'trending-series', 'jpg', true)),
      folder('discover-popular-movies', 'Popular Movies', 'tmdb_popular_movies', artwork('discover', 'popular', 'jpg', true)),
      folder('discover-popular-series', 'Popular Series', 'tmdb_popular_series', artwork('discover', 'popular-series', 'jpg', true)),
      folder('discover-in-theaters', 'In Theaters', 'now_playing_movies', artwork('discover', 'in-theaters', 'jpg')),
      folder('discover-new-releases', 'New Releases', 'new_latest_releases_movies', artwork('discover', 'new-releases', 'jpg', false, 'discover-new-releases.jpg')),
      folder('discover-top-rated', 'IMDb Top 250', 'trending_imdb_top100_movies', artwork('discover', 'top-rated', 'jpg', true)),
      folder('discover-on-air', 'On The Air', 'on_the_air_series', artwork('discover', 'on-air', 'png', false, 'discover-on-air-series.png')),
    ],
  },
  {
    id: 'streaming', title: 'Streaming Services', icon: '📺',
    description: 'Browse the major streaming services without cluttering Home.',
    folders: [
      folder('streaming-netflix', 'Netflix', 'streaming_netflix_movies', artwork('streaming', 'netflix', 'png', true), ['streaming_netflix_series', 'streaming_netflix_top10_movies', 'streaming_netflix_top10_series', 'streaming_latest_netflix_movies', 'streaming_latest_netflix_series']),
      folder('streaming-prime', 'Prime Video', 'streaming_prime_movies', artwork('streaming', 'prime-video', 'png', true), ['streaming_prime_series', 'streaming_prime_top10_movies', 'streaming_prime_top10_series', 'streaming_latest_prime_movies', 'streaming_latest_prime_series']),
      folder('streaming-disney', 'Disney+', 'streaming_disney_movies', artwork('streaming', 'disney', 'png', true), ['streaming_disney_series', 'streaming_disney_top10_movies', 'streaming_disney_top10_series', 'streaming_latest_disney_movies', 'streaming_latest_disney_series']),
      folder('streaming-hbo', 'HBO Max', 'streaming_hbo_movies', artwork('streaming', 'hbo-max', 'png', true), ['streaming_hbo_series', 'streaming_hbo_top10_movies', 'streaming_hbo_top10_series', 'streaming_latest_hbo_movies', 'streaming_latest_hbo_series']),
      folder('streaming-apple', 'Apple TV+', 'streaming_apple_movies', artwork('streaming', 'apple-tv', 'png', true), ['streaming_apple_series', 'streaming_apple_top10_movies', 'streaming_apple_top10_series', 'streaming_latest_apple_movies', 'streaming_latest_apple_series']),
      folder('streaming-hulu', 'Hulu', 'streaming_hulu_movies', artwork('streaming', 'hulu', 'png', true), ['streaming_hulu_series', 'streaming_latest_hulu_movies', 'streaming_latest_hulu_series']),
      folder('streaming-paramount', 'Paramount+', 'streaming_paramount_movies', artwork('streaming', 'paramount', 'png', true), ['streaming_paramount_series', 'streaming_paramount_top10_movies', 'streaming_paramount_top10_series', 'streaming_latest_paramount_movies', 'streaming_latest_paramount_series']),
      folder('streaming-crunchyroll', 'Crunchyroll', 'streaming_crunchyroll_series', artwork('streaming', 'crunchyroll', 'png', true)),
      folder('streaming-crave', 'Crave', 'streaming_crave_movies', artwork('streaming', 'crave', 'png', false, 'special-crave.png', 'special-crave-focus.gif'), ['streaming_crave_series']),
      folder('streaming-hayu', 'Hayu', 'streaming_hayu_movies', artwork('streaming', 'hayu', 'png', false, 'special-hayu.png', 'special-hayu-focus.gif'), ['streaming_hayu_series']),
      folder('streaming-magellan', 'Magellan TV', 'streaming_magellan_movies', artwork('streaming', 'magellan', 'png', false, 'special-magellan.png', 'special-magellan-focus.gif'), ['streaming_magellan_series']),
      folder('streaming-starz', 'Starz', 'streaming_starz_movies', artwork('streaming', 'starz', 'png', false, 'special-starz.png', 'special-starz-focus.gif'), ['streaming_starz_series']),
      folder('streaming-mubi', 'Mubi', 'streaming_mubi_movies', artwork('streaming', 'mubi', 'png', false, 'special-mubi.png', 'special-mubi-focus.gif'), ['streaming_mubi_series']),
      folder('streaming-britbox', 'BritBox', 'streaming_britbox_movies', artwork('streaming', 'britbox', 'png', false, 'special-britbox.png', 'special-britbox-focus.gif'), ['streaming_britbox_series']),
      folder('streaming-curiosity', 'Curiosity Stream', 'streaming_curiosity_movies', artwork('streaming', 'curiosity', 'png', false, 'special-curiosity.png', 'special-curiosity-focus.gif'), ['streaming_curiosity_series']),
    ],
  },
  {
    id: 'franchises', title: 'Film Collections', icon: '🎬',
    description: 'Big-screen universes, sagas and favourite franchises.',
    folders: [
      folder('franchise-marvel', 'Marvel Cinematic Universe', 'collection_marvel_universe_mdb', artwork('franchises', 'mcu', 'jpg', true)),
      folder('franchise-dc', 'DC Universe', 'collection_dc_universe_mdb', artwork('franchises', 'dc-universe', 'jpg', true)),
      folder('franchise-star-wars', 'Star Wars', 'collection_star_wars', artwork('franchises', 'star-wars', 'jpg', false, 'franchise-star-wars.jpg')),
      folder('franchise-harry-potter', 'Harry Potter', 'collection_harry_potter', artwork('franchises', 'wizarding-world', 'png', false, 'franchise-harry-potter.png')),
      folder('franchise-bond', 'James Bond', 'collection_bond', artwork('franchises', '007', 'jpg')),
      folder('franchise-lotr', 'Lord of the Rings', 'collection_lord_of_the_rings', artwork('franchises', 'lord-of-the-rings', 'jpg', false, 'franchise-lotr.jpg')),
      folder('franchise-dune', 'Dune', 'collection_dune', artwork('franchises', 'dune', 'jpg', false, 'franchise-dune.jpg')),
      folder('franchise-john-wick', 'John Wick', 'collection_john_wick', artwork('franchises', 'john-wick', 'jpg')),
      folder('franchise-jurassic', 'Jurassic Park', 'collection_jurassic_park', artwork('franchises', 'jurassic-world', 'jpg')),
      folder('franchise-mission-impossible', 'Mission Impossible', 'collection_mission_impossible', artwork('franchises', 'mission-impossible', 'jpg')),
    ],
  },
  {
    id: 'genres', title: 'Genres', icon: '🎭',
    description: 'A compact genre shelf for the films you are in the mood for.',
    folders: [
      folder('genre-action', 'Action', 'genre_action_movies', artwork('genres', 'action', 'png', false, 'genre-action.png')),
      folder('genre-comedy', 'Comedy', 'genre_comedy_movies', artwork('genres', 'comedy', 'png', false, 'genre-comedy.png')),
      folder('genre-horror', 'Horror', 'genre_horror_movies', artwork('genres', 'horror', 'png', false, 'genre-horror.png')),
      folder('genre-scifi', 'Sci-Fi', 'genre_scifi_movies', artwork('genres', 'sci-fi', 'png', false, 'genre-scifi.png')),
      folder('genre-thriller', 'Thrillers', 'genre_thriller_movies', artwork('genres', 'thriller')),
      folder('genre-drama', 'Drama', 'genre_drama_movies', artwork('genres', 'drama')),
      folder('genre-fantasy', 'Fantasy', 'genre_fantasy_movies', artwork('genres', 'fantasy')),
      folder('genre-crime', 'Crime', 'genre_crime_movies', artwork('genres', 'crime')),
      folder('genre-family', 'Family', 'genre_family_movies', artwork('genres', 'kids')),
      folder('genre-animation', 'Animation', 'genre_animation_movies', artwork('genres', 'animation')),
    ],
  },
  {
    id: 'studios', title: 'Studios', icon: '🏢',
    description: 'A hand-picked studio shelf with the sources LeLibrary already serves.',
    folders: [
      folder('studio-marvel', 'Marvel', 'studio_marvel_movies', artwork('studios', 'marvel', 'jpg', true)),
      folder('studio-dc', 'DC', 'studio_dc_movies', artwork('studios', 'dc', 'jpg', true)),
      folder('studio-a24', 'A24', 'studio_a24_movies', artwork('studios', 'a24', 'jpg')),
      folder('studio-ghibli', 'Studio Ghibli', 'studio_ghibli_movies', artwork('studios', 'ghibli', 'png', true)),
      folder('studio-pixar', 'Pixar', 'studio_pixar_movies', artwork('studios', 'pixar', 'png', true)),
      folder('studio-disney', 'Disney Animated', 'studio_disney_animated_movies', artwork('studios', 'walt-disney-animation', 'gif')),
      folder('studio-warner', 'Warner Bros', 'studio_warner_movies', artwork('studios', 'warner', 'jpg')),
      folder('studio-universal', 'Universal Pictures', 'studio_universal_movies', artwork('studios', 'universal', 'png')),
    ],
  },
  {
    id: 'themes', title: 'Themes & Moods', icon: '🎨',
    description: 'Curated rabbit holes for when a normal genre is not enough.',
    folders: [
      folder('theme-mindfuck', 'Mindfuck', 'themed_mindfuck', artwork('moods', 'mind-bending', 'png', true)),
      folder('theme-plot-twists', 'Plot Twists', 'themed_plot_twists', artwork('moods', 'keep-you-guessing', 'jpg', true)),
      folder('theme-heists', 'Heists', 'themed_heists', artwork('moods', 'adrenaline-rush', 'png', true)),
      folder('theme-time-travel', 'Time Travel', 'themed_time_travel', artwork('moods', 'epic-sweeping', 'png', true)),
      folder('theme-zombies', 'Zombies', 'themed_zombies', artwork('moods', 'spooky-creepy', 'png', true)),
      folder('theme-hidden-gems', 'Hidden Gems', 'themed_hidden_gems_tmdb_movies', artwork('moods', 'turn-off-your-brain', 'png', true)),
      folder('theme-superhero', 'Superhero', 'themed_superhero', artwork('genres', 'superheroes', 'png', true)),
      folder('theme-true-crime', 'True Crime', 'themed_serial_killer', artwork('genres', 'true-crime', 'png', true)),
    ],
  },
  {
    id: 'actors', title: 'Actors', icon: '👥',
    description: 'A starter shelf of actor collections, with portrait, focus and backdrop artwork.',
    folders: [
      folder('actor-ana-de-armas', 'Ana de Armas', 'actor_ana_de_armas_movies', actorArtwork('Ana_de_Armas')),
      folder('actor-anne-hathaway', 'Anne Hathaway', 'actor_anne_hathaway_movies', actorArtwork('Anne_Hathaway', 'Background')),
      folder('actor-cillian-murphy', 'Cillian Murphy', 'actor_cillian_murphy_movies', actorArtwork('Cillian_Murphy')),
      folder('actor-daniel-craig', 'Daniel Craig', 'actor_daniel_craig_movies', actorArtwork('Daniel_Craig', 'Background')),
      folder('actor-emma-stone', 'Emma Stone', 'actor_emma_stone_movies', actorArtwork('Emma_Stone', 'Background')),
      folder('actor-jake-gyllenhaal', 'Jake Gyllenhaal', 'actor_jake_gyllenhaal_movies', actorArtwork('Jake_Gyllenhaal', 'Background')),
      folder('actor-keanu-reeves', 'Keanu Reeves', 'actor_keanu_reeves_movies', actorArtwork('Keanu_Reeves')),
      folder('actor-leonardo-dicaprio', 'Leonardo DiCaprio', 'actor_dicaprio_movies', actorArtwork('Leonardo_DiCaprio', 'Background')),
      folder('actor-margot-robbie', 'Margot Robbie', 'actor_robbie_movies', actorArtwork('Margot_Robbie')),
      folder('actor-pedro-pascal', 'Pedro Pascal', 'actor_pascal_movies', actorArtwork('Pedro_Pascal')),
    ],
  },
  {
    id: 'preset-just-added', title: 'Just Added', icon: '🆕', category: 'Discover', refresh: 'daily',
    description: 'A compact collection for current films and television episodes.',
    folders: [
      folder('preset-just-added-movies', 'New Movies', 'now_playing_movies', artwork('discover', 'in-theaters', 'jpg', false, 'discover-in-theaters.jpg'), ['new_latest_releases_movies']),
      folder('preset-just-added-series', 'New TV', 'airing_today_series', artwork('discover', 'on-air', 'png', false, 'discover-on-air-series.png'), ['on_the_air_series']),
    ],
  },
  {
    id: 'preset-family-night', title: 'Family Night', icon: '👨‍👩‍👧‍👦', category: 'Family', refresh: 'daily',
    description: 'Family films, television and animation for an easy shared watch.',
    folders: [
      folder('preset-family-night-movies', 'Family Movies', 'genre_family_latest_movies', artwork('genres', 'kids', 'png', false, 'genre-family.png'), ['genre_family_movies']),
      folder('preset-family-night-tv', 'Family TV', 'genre_family_latest_series', artwork('genres', 'kids', 'png', false, 'genre-family.png'), ['genre_family_series']),
      folder('preset-family-night-animation', 'Animation', 'genre_animation_movies', artwork('genres', 'animation', 'png', false, 'genre-animation.png'), ['genre_animation_series']),
    ],
  },
  {
    id: 'preset-hidden-gems', title: 'Hidden Gems', icon: '💎', category: 'Themes', refresh: 'daily',
    description: 'Less obvious movie and television discoveries worth finding.',
    folders: [
      folder('preset-hidden-gems-movies', 'Hidden Gem Movies', 'themed_hidden_gems_tmdb_movies', artwork('moods', 'turn-off-your-brain', 'png', false, 'theme-hidden-gems.png', 'theme-hidden-gems-focus.gif')),
      folder('preset-hidden-gems-series', 'Hidden Gem Series', 'themed_hidden_gems_tmdb_series', artwork('moods', 'turn-off-your-brain', 'png', false, 'theme-hidden-gems.png')),
      folder('preset-hidden-gems-acclaimed', 'Acclaimed Discoveries', 'themed_rotten_tomatoes_movies', artwork('discover', 'top-rated', 'jpg', false, 'discover-top-rated.jpg')),
    ],
  },
  {
    id: 'preset-documentaries', title: 'Documentaries', icon: '🎞️', category: 'Themes', refresh: 'daily',
    description: 'Documentary films, factual series, and feature documentaries.',
    folders: [
      folder('preset-documentaries-movies', 'Documentary Films', 'genre_documentary_movies', artwork('genres', 'documentary', 'png', false, 'theme-true-crime.png')),
      folder('preset-documentaries-series', 'Factual Series', 'genre_documentary_series', artwork('genres', 'documentary', 'png', false, 'theme-true-crime.png')),
      folder('preset-documentaries-features', 'Feature Documentaries', 'themed_feature_docs', artwork('genres', 'documentary', 'png', false, 'theme-true-crime.png')),
    ],
  },
  {
    id: 'preset-weekend-binge', title: 'Weekend Binge', icon: '🍿', category: 'Discover', refresh: 'daily',
    description: 'A changing mix of films and shows worth settling in for.',
    folders: [
      folder('preset-weekend-binge-trending', 'Trending This Weekend', 'trending_movies', artwork('discover', 'trending', 'jpg', false, 'discover-trending-movies.jpg', 'discover-trending-movies-focus.gif'), ['trending_series']),
      folder('preset-weekend-binge-popular', 'Popular Right Now', 'tmdb_popular_movies', artwork('discover', 'popular', 'jpg', false, 'discover-popular-movies.jpg'), ['tmdb_popular_series']),
    ],
  },
  {
    id: 'preset-cinema-now', title: 'Cinema Now', icon: '🎟️', category: 'Discover', refresh: 'daily',
    description: 'In theatres, upcoming releases and newly available films.',
    folders: [
      folder('preset-cinema-now-theatres', 'In Theatres', 'now_playing_movies', artwork('discover', 'in-theaters', 'jpg', false, 'discover-in-theaters.jpg')),
      folder('preset-cinema-now-next', 'Coming Soon', 'upcoming_movies', artwork('discover', 'new-releases', 'jpg', false, 'discover-new-releases.jpg'), ['new_latest_releases_movies']),
    ],
  },
  {
    id: 'preset-tv-binge', title: 'TV Binge', icon: '📺', category: 'Discover', refresh: 'daily',
    description: 'Fresh episodes, current series and shows everyone is watching.',
    folders: [
      folder('preset-tv-binge-live', 'Fresh Episodes', 'airing_today_series', artwork('discover', 'on-air', 'png', false, 'discover-on-air-series.png'), ['on_the_air_series', 'new_latest_airing_shows_series']),
      folder('preset-tv-binge-popular', 'Binge-worthy TV', 'trending_series', artwork('discover', 'trending-series', 'jpg', false, 'discover-trending-series.jpg'), ['tmdb_popular_series']),
    ],
  },
  {
    id: 'preset-action-rush', title: 'Action Rush', icon: '💥', category: 'Genres', refresh: 'daily',
    description: 'New, popular and highly rated action for an instant adrenaline hit.',
    folders: [
      folder('preset-action-rush-movies', 'Action Movies', 'genre_action_latest_movies', artwork('genres', 'action', 'png', false, 'genre-action.png'), ['genre_action_movies']),
      folder('preset-action-rush-series', 'Action Series', 'genre_action_latest_series', artwork('genres', 'action', 'png', false, 'genre-action.png'), ['genre_action_series']),
      folder('preset-action-rush-top-rated', 'Top-Rated Action', 'genre_action_toprated_movies', artwork('genres', 'action', 'png', false, 'genre-action.png'), ['genre_action_toprated_series']),
    ],
  },
  {
    id: 'preset-comedy-fix', title: 'Comedy Fix', icon: '😂', category: 'Genres', refresh: 'daily',
    description: 'Comedies, funny series and stand-up for a lighter watch.',
    folders: [
      folder('preset-comedy-fix-movies', 'Comedy Movies', 'genre_comedy_latest_movies', artwork('genres', 'comedy', 'png', false, 'genre-comedy.png'), ['genre_comedy_movies']),
      folder('preset-comedy-fix-series', 'Comedy Series', 'genre_comedy_latest_series', artwork('genres', 'comedy', 'png', false, 'genre-comedy.png'), ['genre_comedy_series']),
      folder('preset-comedy-fix-standup', 'Stand-up Comedy', 'themed_standup_comedy_movies', artwork('genres', 'comedy', 'png', false, 'genre-comedy.png')),
    ],
  },
  {
    id: 'preset-horror-night', title: 'Horror Night', icon: '👻', category: 'Genres', refresh: 'daily',
    description: 'Modern scares, horror classics and current favourites.',
    folders: [
      folder('preset-horror-night-new', 'New Horror', 'genre_horror_latest_movies', artwork('genres', 'horror', 'png', false, 'genre-horror.png'), ['themed_modern_horror_movies']),
      folder('preset-horror-night-classics', 'Horror Classics', 'themed_horror_classics_movies', artwork('genres', 'horror', 'png', false, 'genre-horror.png'), ['genre_horror_movies']),
      folder('preset-horror-night-series', 'Horror Series', 'genre_horror_latest_series', artwork('genres', 'horror', 'png', false, 'genre-horror.png'), ['genre_horror_series']),
    ],
  },
  {
    id: 'preset-scifi-worlds', title: 'Sci-Fi Worlds', icon: '🚀', category: 'Genres', refresh: 'daily',
    description: 'Science fiction, outer space and mind-bending journeys.',
    folders: [
      folder('preset-scifi-worlds-movies', 'Sci-Fi Movies', 'genre_scifi_latest_movies', artwork('genres', 'sci-fi', 'png', false, 'genre-scifi.png'), ['genre_scifi_movies']),
      folder('preset-scifi-worlds-series', 'Sci-Fi Series', 'genre_scifi_latest_series', artwork('genres', 'sci-fi', 'png', false, 'genre-scifi.png'), ['genre_scifi_series']),
      folder('preset-scifi-worlds-space', 'Outer Space & Time Travel', 'themed_outer_space_movies', artwork('genres', 'sci-fi', 'png', false, 'genre-scifi.png'), ['themed_time_travel']),
    ],
  },
  {
    id: 'preset-mystery-thriller', title: 'Mystery & Thriller', icon: '🔍', category: 'Genres', refresh: 'daily',
    description: 'Twists, mysteries and tense thrillers picked for tonight.',
    folders: [
      folder('preset-mystery-thriller-mystery', 'Mysteries', 'genre_mystery_movies', artwork('genres', 'mystery', 'png', false, 'genre-thriller.png'), ['genre_mystery_series']),
      folder('preset-mystery-thriller-thrillers', 'Thrillers', 'genre_thriller_movies', artwork('genres', 'thriller', 'png', false, 'genre-thriller.png'), ['genre_thriller_series']),
      folder('preset-mystery-thriller-twists', 'Plot Twists', 'themed_plot_twists', artwork('moods', 'keep-you-guessing', 'jpg', false, 'theme-plot-twists.jpg')),
    ],
  },
  {
    id: 'preset-romance-night', title: 'Romance Night', icon: '💖', category: 'Genres', refresh: 'daily',
    description: 'Romantic films and series, from new favourites to top-rated picks.',
    folders: [
      folder('preset-romance-night-movies', 'Romance Movies', 'genre_romance_latest_movies', artwork('genres', 'romance', 'png', false, 'genre-drama.png'), ['genre_romance_movies']),
      folder('preset-romance-night-series', 'Romance Series', 'genre_romance_latest_series', artwork('genres', 'romance', 'png', false, 'genre-drama.png'), ['genre_romance_series']),
      folder('preset-romance-night-top-rated', 'Top-Rated Romance', 'genre_romance_toprated_movies', artwork('genres', 'romance', 'png', false, 'genre-drama.png'), ['genre_romance_toprated_series']),
    ],
  },
  {
    id: 'preset-fantasy-adventure', title: 'Fantasy Adventures', icon: '🐉', category: 'Genres', refresh: 'daily',
    description: 'Fantasy worlds, epic quests and adventurous escapes.',
    folders: [
      folder('preset-fantasy-adventure-fantasy', 'Fantasy Worlds', 'genre_fantasy_movies', artwork('genres', 'fantasy', 'png', false, 'genre-fantasy.png'), ['genre_fantasy_series']),
      folder('preset-fantasy-adventure-adventure', 'Adventure', 'genre_adventure_movies', artwork('genres', 'fantasy', 'png', false, 'genre-fantasy.png'), ['genre_adventure_series']),
      folder('preset-fantasy-adventure-epics', 'Epic Quests', 'themed_epics', artwork('genres', 'fantasy', 'png', false, 'genre-fantasy.png')),
    ],
  },
  {
    id: 'preset-crime-files', title: 'Crime Files', icon: '🕵️', category: 'Genres', refresh: 'daily',
    description: 'Crime dramas, investigations, serial killers and true crime.',
    folders: [
      folder('preset-crime-files-dramas', 'Crime Dramas', 'genre_crime_latest_movies', artwork('genres', 'crime', 'png', false, 'genre-crime.png'), ['genre_crime_movies']),
      folder('preset-crime-files-series', 'Crime Series', 'genre_crime_latest_series', artwork('genres', 'crime', 'png', false, 'genre-crime.png'), ['genre_crime_series']),
      folder('preset-crime-files-true-crime', 'True Crime', 'themed_true_crime_movies', artwork('genres', 'true-crime', 'png', false, 'theme-true-crime.png'), ['themed_serial_killer']),
    ],
  },
  {
    id: 'preset-animation-station', title: 'Animation Station', icon: '🎨', category: 'Family', refresh: 'daily',
    description: 'Animated movies and shows for children, families and grown-ups.',
    folders: [
      folder('preset-animation-station-new', 'New Animation', 'genre_animation_latest_movies', artwork('genres', 'animation', 'png', false, 'genre-animation.png'), ['genre_animation_movies']),
      folder('preset-animation-station-series', 'Animated Series', 'genre_animation_latest_series', artwork('genres', 'animation', 'png', false, 'genre-animation.png'), ['genre_animation_series']),
      folder('preset-animation-station-studios', 'Pixar & DreamWorks', 'studio_pixar_movies', artwork('studios', 'pixar', 'png', false, 'studio-pixar.png'), ['studio_dreamworks_movies']),
    ],
  },
  {
    id: 'preset-true-stories', title: 'Based on True Stories', icon: '📖', category: 'Themes', refresh: 'daily',
    description: 'Real lives, real events, history and feature documentaries.',
    folders: [
      folder('preset-true-stories-dramas', 'True Story Dramas', 'themed_based_on_true_story', artwork('moods', 'true-stories', 'png', false, 'theme-true-crime.png')),
      folder('preset-true-stories-docs', 'Feature Documentaries', 'themed_feature_docs', artwork('genres', 'documentary', 'png', false, 'theme-true-crime.png')),
      folder('preset-true-stories-history', 'History & War', 'themed_history_war_movies', artwork('moods', 'true-stories', 'png', false, 'theme-true-crime.png')),
    ],
  },
  {
    id: 'preset-quick-watches', title: 'Quick Watches', icon: '⏱️', category: 'Themes', refresh: 'daily',
    description: 'Short films and easy watches when you do not have all night.',
    folders: [
      folder('preset-quick-watches-easy', 'Easy Watches', 'themed_quick_watches', artwork('moods', 'quick-watches', 'png', false, 'theme-hidden-gems.png')),
      folder('preset-quick-watches-shorts', 'Short Films', 'themed_short_films', artwork('moods', 'quick-watches', 'png', false, 'theme-hidden-gems.png')),
    ],
  },
  {
    id: 'preset-retro-rewind', title: '80s & 90s Rewind', icon: '📼', category: 'Themes', refresh: 'daily',
    description: 'Nostalgic favourites and acclaimed films from two iconic decades.',
    folders: [
      folder('preset-retro-rewind-favourites', '80s & 90s Favourites', 'themed_nostalgic_80s_90s', artwork('moods', 'retro', 'png', false, 'theme-time-travel.png')),
      folder('preset-retro-rewind-80s', 'Best of the 80s', 'themed_rt_best_80s', artwork('moods', 'retro', 'png', false, 'theme-time-travel.png')),
      folder('preset-retro-rewind-90s', 'Best of the 90s', 'themed_rt_best_90s', artwork('moods', 'retro', 'png', false, 'theme-time-travel.png')),
    ],
  },
  {
    id: 'preset-modern-classics', title: 'Modern Classics', icon: '🏆', category: 'Themes', refresh: 'daily',
    description: 'Acclaimed favourites from the 2000s and 2010s.',
    folders: [
      folder('preset-modern-classics-00s', 'Best of the 2000s', 'themed_rt_best_00s', artwork('moods', 'modern-classics', 'png', false, 'discover-top-rated.jpg')),
      folder('preset-modern-classics-10s', 'Best of the 2010s', 'themed_rt_best_10s', artwork('moods', 'modern-classics', 'png', false, 'discover-top-rated.jpg')),
      folder('preset-modern-classics-acclaimed', 'Acclaimed Favourites', 'themed_rotten_tomatoes_movies', artwork('moods', 'modern-classics', 'png', false, 'discover-top-rated.jpg')),
    ],
  },
  {
    id: 'preset-prestige-tv', title: 'Prestige TV', icon: '🏅', category: 'Television', refresh: 'daily',
    description: 'Standout series from HBO, FX, AMC and Starz.',
    folders: [
      folder('preset-prestige-tv-hbo', 'HBO', 'label_hbo_series', artwork('studios', 'prestige-tv', 'jpg', false, 'studio-warner.jpg'), ['label_hbo_latest_series']),
      folder('preset-prestige-tv-fx', 'FX', 'label_fx_series', artwork('studios', 'prestige-tv', 'jpg', false, 'studio-warner.jpg'), ['label_fx_latest_series']),
      folder('preset-prestige-tv-more', 'AMC & Starz', 'label_amc_series', artwork('studios', 'prestige-tv', 'jpg', false, 'studio-warner.jpg'), ['label_starz_series']),
    ],
  },
  {
    id: 'preset-streaming-top-ten', title: 'Streaming Top 10', icon: '🔥', category: 'Streaming', refresh: 'daily',
    description: 'Top-ten charts across the biggest streaming services.',
    folders: [
      folder('preset-streaming-top-ten-netflix', 'Netflix Top 10', 'streaming_netflix_top10_movies', artwork('streaming', 'netflix', 'png', false, 'streaming-netflix.png'), ['streaming_netflix_top10_series']),
      folder('preset-streaming-top-ten-prime', 'Prime Video Top 10', 'streaming_prime_top10_movies', artwork('streaming', 'prime', 'png', false, 'streaming-prime.png'), ['streaming_prime_top10_series']),
      folder('preset-streaming-top-ten-more', 'More Top 10', 'streaming_disney_top10_movies', artwork('streaming', 'disney', 'png', false, 'streaming-disney.png'), ['streaming_disney_top10_series', 'streaming_hbo_top10_movies', 'streaming_hbo_top10_series', 'streaming_apple_top10_movies', 'streaming_apple_top10_series']),
    ],
  },
  {
    id: 'preset-free-streaming', title: 'Free Streaming', icon: '🆓', category: 'Streaming', refresh: 'daily',
    description: 'Movies and series currently available through Tubi.',
    folders: [folder('preset-free-streaming', 'Free Streaming', 'streaming_tubi_movies', artwork('streaming', 'tubi', 'png', false, 'streaming-hulu.png'), ['streaming_tubi_series'])],
  },
  {
    id: 'preset-superhero-universe', title: 'Superhero Universe', icon: '🦸', category: 'Franchises', refresh: 'daily',
    description: 'Marvel, DC and superhero stories together in one collection.',
    folders: [
      folder('preset-superhero-universe-marvel', 'Marvel', 'collection_marvel_universe_mdb', artwork('franchises', 'marvel', 'jpg', false, 'franchise-marvel.jpg'), ['studio_marvel_movies', 'studio_marvel_series']),
      folder('preset-superhero-universe-dc', 'DC', 'collection_dc_universe_mdb', artwork('franchises', 'dc', 'jpg', false, 'franchise-dc.jpg'), ['studio_dc_movies', 'studio_dc_series']),
      folder('preset-superhero-universe-more', 'More Superheroes', 'themed_superhero', artwork('genres', 'superheroes', 'png', false, 'theme-superhero.png')),
    ],
  },
  {
    id: 'preset-epic-marathons', title: 'Epic Marathons', icon: '⚔️', category: 'Franchises', refresh: 'live',
    description: 'Long-running sagas ready for a proper movie marathon.',
    folders: [
      folder('preset-epic-marathons-space', 'Galaxies Far Away', 'collection_star_wars', artwork('franchises', 'star-wars', 'jpg', false, 'franchise-star-wars.jpg'), ['collection_star_trek']),
      folder('preset-epic-marathons-fantasy', 'Fantasy Sagas', 'collection_lord_of_the_rings', artwork('franchises', 'lord-of-the-rings', 'jpg', false, 'franchise-lotr.jpg'), ['collection_hobbit', 'collection_harry_potter']),
      folder('preset-epic-marathons-action', 'Action Sagas', 'collection_mission_impossible', artwork('franchises', 'mission-impossible', 'jpg', false, 'franchise-mission-impossible.jpg'), ['collection_bond', 'collection_bourne', 'collection_fast_furious']),
    ],
  },
  {
    id: 'preset-holiday-comfort', title: 'Holiday Comfort', icon: '🎄', category: 'Seasonal', refresh: 'daily',
    description: 'Christmas films, festive television and comforting family picks.',
    folders: [
      folder('preset-holiday-comfort-movies', 'Holiday Movies', 'themed_christmas_movies', artwork('moods', 'holiday', 'png', false, 'genre-family.png')),
      folder('preset-holiday-comfort-tv', 'Holiday TV', 'themed_christmas_tv_movies', artwork('moods', 'holiday', 'png', false, 'genre-family.png')),
      folder('preset-holiday-comfort-family', 'Family Favourites', 'genre_family_movies', artwork('genres', 'kids', 'png', false, 'genre-family.png'), ['genre_family_series']),
    ],
  },
  {
    id: 'preset-directors', title: 'Directors', icon: '🎬', category: 'People', refresh: 'daily',
    description: 'A filmography shelf for the directors everyone looks up.',
    coverImageUrl: '/collection-assets/collections/covers/preset-directors.png?v=2',
    backdropUrl: '/collection-assets/collections/covers/preset-directors.png?v=2',
    folders: DIRECTOR_PACK_FOLDERS,
  },
  {
    id: 'preset-decades', title: 'By Decade', icon: '📅', category: 'Discover', refresh: 'daily',
    description: 'The most popular films and shows from each decade.',
    coverImageUrl: '/collection-assets/collections/covers/preset-by-decade.png?v=2',
    backdropUrl: '/collection-assets/collections/covers/preset-by-decade.png?v=2',
    folders: DECADE_PACK_FOLDERS,
  },
  {
    id: 'preset-world-cinema', title: 'World Cinema', icon: '🌍', category: 'World Cinema', refresh: 'daily',
    description: 'Popular films and series by original language.',
    coverImageUrl: '/collection-assets/collections/covers/preset-world-cinema.png?v=2',
    backdropUrl: '/collection-assets/collections/covers/preset-world-cinema.png?v=2',
    folders: WORLD_CINEMA_FOLDERS,
  },
  {
    id: 'preset-latest-streaming', title: 'Latest Streaming', icon: '🆕', category: 'Streaming', refresh: 'daily',
    description: 'The newest films and shows on each major service.',
    folders: [
      folder('preset-latest-streaming-netflix', 'Netflix', 'streaming_latest_netflix_movies', artwork('streaming', 'netflix', 'png', false, 'streaming-netflix.png'), ['streaming_latest_netflix_series']),
      folder('preset-latest-streaming-prime', 'Prime Video', 'streaming_latest_prime_movies', artwork('streaming', 'prime', 'png', false, 'streaming-prime.png'), ['streaming_latest_prime_series']),
      folder('preset-latest-streaming-disney', 'Disney+', 'streaming_latest_disney_movies', artwork('streaming', 'disney', 'png', false, 'streaming-disney.png'), ['streaming_latest_disney_series']),
      folder('preset-latest-streaming-hbo', 'HBO Max', 'streaming_latest_hbo_movies', artwork('streaming', 'hbo', 'png', false, 'streaming-hbo.png'), ['streaming_latest_hbo_series']),
      folder('preset-latest-streaming-apple', 'Apple TV+', 'streaming_latest_apple_movies', artwork('streaming', 'apple', 'png', false, 'streaming-apple.png'), ['streaming_latest_apple_series']),
      folder('preset-latest-streaming-hulu', 'Hulu', 'streaming_latest_hulu_movies', artwork('streaming', 'hulu', 'png', false, 'streaming-hulu.png'), ['streaming_latest_hulu_series']),
      folder('preset-latest-streaming-paramount', 'Paramount+', 'streaming_latest_paramount_movies', artwork('streaming', 'paramount', 'png', false, 'streaming-paramount.png'), ['streaming_latest_paramount_series']),
    ],
  },
  {
    id: 'preset-top-rated', title: 'Top Rated', icon: '⭐', category: 'Genres', refresh: 'daily',
    description: 'The highest rated films and shows across the main genres.',
    folders: [
      folder('preset-top-rated-action', 'Action', 'genre_action_toprated_movies', artwork('genres', 'action', 'png', false, 'genre-action.png'), ['genre_action_toprated_series']),
      folder('preset-top-rated-comedy', 'Comedy', 'genre_comedy_toprated_movies', artwork('genres', 'comedy', 'png', false, 'genre-comedy.png'), ['genre_comedy_toprated_series']),
      folder('preset-top-rated-drama', 'Drama', 'genre_drama_toprated_movies', artwork('genres', 'drama', 'png', false, 'genre-drama.png'), ['genre_drama_toprated_series']),
      folder('preset-top-rated-thriller', 'Thrillers', 'genre_thriller_toprated_movies', artwork('genres', 'thriller', 'png', false, 'genre-thriller.png')),
      folder('preset-top-rated-scifi', 'Sci-Fi', 'genre_scifi_toprated_movies', artwork('genres', 'scifi', 'png', false, 'genre-scifi.png'), ['genre_scifi_toprated_series']),
      folder('preset-top-rated-crime', 'Crime', 'genre_crime_toprated_movies', artwork('genres', 'crime', 'png', false, 'genre-crime.png'), ['genre_crime_toprated_series']),
    ],
  },
  {
    id: 'preset-studio-spotlight', title: 'Studio Spotlight', icon: '🏢', category: 'Studios', refresh: 'daily',
    description: 'Signature films and shows from standout studios.',
    folders: [
      folder('preset-studio-spotlight-a24', 'A24', 'studio_a24_movies', artwork('studios', 'a24', 'jpg', false, 'studio-a24.jpg'), ['studio_a24_series']),
      folder('preset-studio-spotlight-ghibli', 'Studio Ghibli', 'studio_ghibli_movies', artwork('studios', 'ghibli', 'png', false, 'studio-ghibli.png')),
      folder('preset-studio-spotlight-pixar', 'Pixar', 'studio_pixar_movies', artwork('studios', 'pixar', 'png', false, 'studio-pixar.png'), ['studio_pixar_series']),
      folder('preset-studio-spotlight-blumhouse', 'Blumhouse', 'studio_blumhouse_movies', {}, ['studio_blumhouse_series']),
      folder('preset-studio-spotlight-lionsgate', 'Lionsgate', 'studio_lionsgate_movies', {}, ['studio_lionsgate_series']),
      folder('preset-studio-spotlight-legendary', 'Legendary', 'studio_legendary_movies', {}, ['studio_legendary_series']),
      folder('preset-studio-spotlight-sony', 'Sony Pictures', 'studio_sony_movies', {}, ['studio_sony_series']),
      folder('preset-studio-spotlight-20th', '20th Century', 'studio_20th_century_movies', {}, ['studio_20th_century_series']),
    ],
  },
  {
    // Sections and folders are derived below from the standard packs.
    id: 'lelibrary-special', title: 'LeLibrary Special', icon: '🌟',
    description: 'The ultimate LeLibrary sampler: big, bold, and packed with variety. Made for Home Rows and Nuvio Collections.',
    sections: [],
    folders: [],
  },
]);

// LeLibrary Special is the all-in-one sampler of the seven standard packs.
// It is a fixed list on purpose: the 5.8 themed packs (Horror Vault, Kids &
// Family...) are opt-in on their own and must not swell Special.
const STANDARD_PACK_IDS = ['discover', 'streaming', 'franchises', 'genres', 'studios', 'themes', 'actors'];
const SPECIAL_PACK = CURATED_COLLECTIONS.find((pack) => pack.id === 'lelibrary-special');
if (SPECIAL_PACK) {
  const standardPacks = STANDARD_PACK_IDS.map((id) => CURATED_COLLECTIONS.find((pack) => pack.id === id)).filter(Boolean);
  SPECIAL_PACK.sections = standardPacks.map((pack) => ({
    id: pack.id,
    title: pack.title,
    folders: pack.folders.map((folder) => folder.id),
  }));
  SPECIAL_PACK.folders = dedupePackSources({ folders: standardPacks.flatMap((pack) => pack.folders.map((folder) => ({
    ...folder,
    catalogSources: (folder.catalogSources || []).map((source) => ({ ...source })),
  }))) }).folders;
}

// ── 5.8 packs and persona bundles ─────────────────────────────────────
const { buildNewPacks, PERSONA_BUNDLES, PACK_COVERS } = require('./curated-packs-58.ts');
const FOLDER_PREFIX = 'folder-lelibrary-';

// Sections of the new packs name folders by their folder() id. Expand to the
// full id and keep only folders that survived the media-pair merge.
function resolveSections(pack) {
  if (!Array.isArray(pack.sections) || !pack.sections.length) return pack;
  const ids = new Set(pack.folders.map((item) => item.id));
  return {
    ...pack,
    exactSections: true,
    sections: pack.sections.map((section) => ({
      id: section.id,
      title: section.title,
      folders: section.folders.map((id) => `${FOLDER_PREFIX}${id}`).filter((id) => ids.has(id)),
    })),
  };
}

for (const pack of mergeCompatibleMediaSources(buildNewPacks({ folder }))) CURATED_COLLECTIONS.push(resolveSections(pack));

// A persona bundle only references folders defined by other packs. The
// copies keep the original folder id, so the picker sees "already added"
// across packs and bundles alike.
function buildBundle(definition, packs) {
  const byId = new Map();
  for (const pack of packs) {
    if (pack.id === 'lelibrary-special') continue;
    for (const item of pack.folders) if (!byId.has(item.id)) byId.set(item.id, item);
  }
  const folders = [];
  const sections = definition.sections.map((section) => {
    const ids = section.refs.map((ref) => {
      const id = `${FOLDER_PREFIX}${ref}`;
      const source = byId.get(id);
      if (!source) throw new Error(`bundle ${definition.id} references unknown folder ${ref}`);
      if (folders.some((item) => item.id === id)) throw new Error(`bundle ${definition.id} references folder ${ref} twice`);
      folders.push(clone(source));
      return id;
    });
    return { id: section.id, title: section.title, folders: ids };
  });
  const deduped = dedupePackSources({ folders });
  const kept = new Set(deduped.folders.map((item) => item.id));
  return {
    ...definition,
    exactSections: true,
    sections: sections.map((section) => ({ ...section, folders: section.folders.filter((id) => kept.has(id)) })),
    folders: deduped.folders,
  };
}

const BASE_PACKS = CURATED_COLLECTIONS.slice();
for (const bundle of PERSONA_BUNDLES) CURATED_COLLECTIONS.push(buildBundle(bundle, BASE_PACKS));
Object.freeze(CURATED_COLLECTIONS);

// Picker metadata for the packs that predate 5.8. kind: 'bundle' = a set of
// collections, 'pack' = a themed pack, 'single' = one focused collection.
// filters: the picker's fixed filter ids (see PACK_FILTERS).
const PACK_FILTERS = ['streaming', 'genres', 'franchises', 'people', 'world', 'seasonal', 'kids', 'charts'];
const LEGACY_PACK_META = {
  'lelibrary-special': { kind: 'bundle', filters: ['charts', 'streaming', 'franchises', 'genres', 'people'] },
  discover: { kind: 'pack', filters: ['charts'] },
  streaming: { kind: 'pack', filters: ['streaming'] },
  franchises: { kind: 'pack', filters: ['franchises'] },
  genres: { kind: 'pack', filters: ['genres'] },
  studios: { kind: 'pack', filters: ['franchises'] },
  themes: { kind: 'pack', filters: ['genres'] },
  actors: { kind: 'pack', filters: ['people'] },
  'preset-directors': { kind: 'pack', filters: ['people'] },
  'preset-decades': { kind: 'pack', filters: ['genres'] },
  'preset-world-cinema': { kind: 'pack', filters: ['world'] },
  'preset-latest-streaming': { kind: 'pack', filters: ['streaming'] },
  'preset-top-rated': { kind: 'pack', filters: ['genres'] },
  'preset-studio-spotlight': { kind: 'pack', filters: ['franchises'] },
  'preset-just-added': { kind: 'single', filters: ['charts'] },
  'preset-family-night': { kind: 'single', filters: ['kids'] },
  'preset-hidden-gems': { kind: 'single', filters: ['genres'] },
  'preset-documentaries': { kind: 'single', filters: ['genres'] },
  'preset-weekend-binge': { kind: 'single', filters: ['charts'] },
  'preset-cinema-now': { kind: 'single', filters: ['charts'] },
  'preset-tv-binge': { kind: 'single', filters: ['charts'] },
  'preset-action-rush': { kind: 'single', filters: ['genres'] },
  'preset-comedy-fix': { kind: 'single', filters: ['genres'] },
  'preset-horror-night': { kind: 'single', filters: ['genres'] },
  'preset-scifi-worlds': { kind: 'single', filters: ['genres'] },
  'preset-mystery-thriller': { kind: 'single', filters: ['genres'] },
  'preset-romance-night': { kind: 'single', filters: ['genres'] },
  'preset-fantasy-adventure': { kind: 'single', filters: ['genres'] },
  'preset-crime-files': { kind: 'single', filters: ['genres'] },
  'preset-animation-station': { kind: 'single', filters: ['kids', 'genres'] },
  'preset-true-stories': { kind: 'single', filters: ['genres'] },
  'preset-quick-watches': { kind: 'single', filters: ['genres'] },
  'preset-retro-rewind': { kind: 'single', filters: ['genres'] },
  'preset-modern-classics': { kind: 'single', filters: ['genres'] },
  'preset-prestige-tv': { kind: 'single', filters: ['streaming'] },
  'preset-streaming-top-ten': { kind: 'single', filters: ['streaming', 'charts'] },
  'preset-free-streaming': { kind: 'single', filters: ['streaming'] },
  'preset-superhero-universe': { kind: 'single', filters: ['franchises'] },
  'preset-epic-marathons': { kind: 'single', filters: ['franchises'] },
  'preset-holiday-comfort': { kind: 'single', filters: ['seasonal', 'kids'] },
};

// Regions for provider folders of the older packs (same verification as the
// 5.8 rows). A folder whose primary source is listed here is hidden by the
// picker outside those countries.
const { REGIONS: PROVIDER_REGIONS } = require('./curated-regions-58.ts');

function packMeta(pack) {
  const legacy = LEGACY_PACK_META[pack.id] || {};
  return {
    kind: pack.kind || legacy.kind || 'pack',
    filters: (pack.filters || legacy.filters || []).filter((id) => PACK_FILTERS.includes(id)),
  };
}

function packCoverUrl(pack) {
  const posters = PACK_COVERS[pack.id];
  if (!Array.isArray(posters) || !posters.length) return '';
  const { buildSpec, coverUrl } = require('./generated-covers.ts');
  const spec = buildSpec('poster', { posters, title: '' }, 'grid');
  return spec ? coverUrl(spec) : '';
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function isAnimeCuratedSource(source) {
  // Keep this source-level. A folder can deliberately combine an anime source
  // with a normal one: Hide anime must remove only the anime contribution,
  // never throw away the remaining catalogue sources.
  // Studio Ghibli, plus every 5.8 anime row (anime_*, the ADN service and
  // the trending-anime chart all carry "anime" as a whole id word).
  const id = String(source?.catalogId || '').replace(/^lib-/, '');
  return id.startsWith('studio_ghibli_') || /(^|_)anime(_|$)/.test(id);
}

function withoutAnimeSources(folder) {
  const catalogSources = (folder?.catalogSources || []).filter((source) => !isAnimeCuratedSource(source));
  return catalogSources.length ? { ...folder, catalogSources } : null;
}

function sectionContainsFolder(pack, section, folder) {
  // 5.8 packs and bundles list exact folder ids; only the older packs need
  // the loose match below.
  if (pack.exactSections) return (section.folders || []).includes(folder.id);
  const folderKey = folder.id.replace(`folder-${pack.id}-`, '').replace(/-(movies|series)$/, '');
  return (section.folders || []).some((id) => {
    const sectionKey = String(id).replace(/^special-/, '').replace(/-(movies|series)$/, '');
    return id === folder.id || folderKey === sectionKey;
  });
}

function generatedArtFor(folder) {
  const parts = FOLDER_ART[folder.id];
  if (!parts) return {};
  const art = require('./generated-covers.ts').generatedFolderArtwork(folder, parts, { short: true });
  // Only fill gaps: never replace a value the folder already has.
  const out = {};
  for (const [key, value] of Object.entries(art)) if (!folder[key]) out[key] = value;
  return out;
}

function collectionFromPack(pack, overrides = {}) {
  const folderOverrides = overrides && typeof overrides.folders === 'object' ? overrides.folders : {};
  const settings = normalisePackSettings({ ...DEFAULT_PACK_SETTINGS, ...(overrides.settings || {}) });
  const folders = clone(pack.folders).map((item) => {
    const edit = folderOverrides[item.id];
    if (!edit || typeof edit !== 'object') return item;
    const allowed = ['title', 'tileShape', 'hideTitle', 'coverImageUrl', 'focusGifUrl', 'focusGifEnabled', 'heroBackdropUrl', 'heroVideoUrl', 'titleLogoUrl'];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(edit, key)) item[key] = edit[key];
    }
    return item;
  });
  // Nuvio shows the source title in a folder's detail view. Keep it friendly
  // even when the actual catalogue id is later compacted into one generic
  // LeLibrary route with the source carried in `genre`.
  for (const folder of folders) {
    folder.catalogSources = (folder.catalogSources || []).map((source) => {
      const type = source.type || 'movie';
      return { ...source, type, title: source.title || curatedSourceDisplayName(source.catalogId, type) };
    });
    // No hand-made art: the generated cover from the folder's own posters
    // (curated-folder-art-58.ts). A user's own cover (override) still wins.
    if (!folder.coverImageUrl) Object.assign(folder, generatedArtFor(folder));
  }
  return {
    id: `collection-lelibrary-pack-${pack.id}`,
    title: pack.title,
    backdropUrl: pack.backdropUrl || '',
    ...settings,
    folders,
  };
}

// ── Canonical catalogue labels ────────────────────────────────────────
// A Nuvio folder source keeps the manifest-exact catalogue id and carries the
// human label in the `genre` extra, which Nuvio renders on the folder tab
// ("<catalogue name> · <genre>"). The label is therefore also the key the
// catalogue handler resolves the source back from, so it must be unique within
// a media type: two different sources sharing one label would make the folder
// serve whichever one happens to be matched first.
const SOURCE_VARIANT_WORDS = [
  [/top10/i, 'Top 10'],
  [/top50/i, 'Top 50'],
  [/(toprated|top_rated)/i, 'Top Rated'],
  [/latest/i, 'Latest'],
  [/classics?/i, 'Classics'],
  [/modern/i, 'Modern'],
  [/digital/i, 'Digital'],
];

function sourceVariantWord(rawId, base) {
  for (const [pattern, word] of SOURCE_VARIANT_WORDS) {
    if (!pattern.test(rawId)) continue;
    // Skip a word the label already reads with: "Latest Netflix Movies · Latest".
    return new RegExp(`\\b${word}\\b`, 'i').test(base) ? '' : word;
  }
  return '';
}

function curatedSourceDisplayName(catalogId, type) {
  const rawId = String(catalogId || '').replace(/^lib-/, '');
  const definition = getSourceDefinition(rawId) || getSourceDefinition(catalogId);
  const media = type === 'series' ? 'Series' : type === 'movie' ? 'Movies' : '';
  const listName = typeof definition?.params?.listName === 'string' ? definition.params.listName.trim() : '';
  const base = listName || String(definition?.name || rawId || 'Catalog')
    .replace(/\s+(Movies|Series)$/i, '')
    .trim();
  const withMedia = media && !/(movies|series|shows)\b/i.test(base) ? `${base} ${media}` : base;
  const variant = sourceVariantWord(rawId, withMedia);
  return variant ? `${withMedia} · ${variant}` : withMedia;
}

// Label index over every catalogue definition: `lib-<id>` → canonical label,
// and canonical label → id, each scoped by media type. Built once and cached.
let sourceLabelIndex = null;
function labelIndexKey(type, value) {
  return `${type === 'series' ? 'series' : 'movie'}\u0000${value}`;
}

// Id tokens that never distinguish two sources on their own (they either name
// the shelf rather than the source, or they are already implied by the label).
const GENERIC_ID_TOKENS = new Set([
  'new', 'the', 'and', 'of', 'top', 'rated', 'genre', 'themed', 'collection',
  'streaming', 'movies', 'movie', 'series', 'shows', 'show', 'list',
  'mdblist', 'label', 'studio', 'director', 'actor', 'kb', 'preset', 'special',
]);

// Readable disambiguation for a source whose plain label is shared: the
// definition name when it says something new, then the id's own distinguishing
// words ("universe", "digital", a list number), then the shelf it lives on.
function sourceLabelQualifier(definition, rawId, candidate) {
  const lower = candidate.toLowerCase();
  const name = String(definition?.name || '').trim();
  if (name && !lower.includes(name.toLowerCase())) return name;
  const tokens = [...new Set(String(rawId).split(/[^a-z0-9]+/i))]
    .map((token) => token.toLowerCase())
    .filter((token) => token && !GENERIC_ID_TOKENS.has(token) && !lower.includes(token));
  if (tokens.length) return tokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join(' ');
  return String(definition?.group || '').replace(/^[^\w]+/u, '').trim();
}

function curatedLabelIndex() {
  if (sourceLabelIndex) return sourceLabelIndex;
  const byId = new Map();
  const owners = new Map();
  const definitions = new Map();
  for (const source of listSources({ includeUnavailable: true })) {
    const type = source.type === 'series' ? 'series' : 'movie';
    const definition = getSourceDefinition(source.id);
    const label = curatedSourceDisplayName(source.id, type);
    definitions.set(labelIndexKey(type, source.id), definition);
    byId.set(labelIndexKey(type, source.id), label);
    const bucket = owners.get(labelIndexKey(type, label));
    if (bucket) bucket.push(source.id);
    else owners.set(labelIndexKey(type, label), [source.id]);
  }
  // Shared labels: give each member its own readable qualifier; a member that
  // still cannot be told apart resolves to nothing, and the folder falls back
  // to carrying the exact source id instead of a label.
  for (const [key, bucket] of owners) {
    if (bucket.length < 2) continue;
    const type = key.split('\u0000')[0];
    const candidate = key.split('\u0000')[1];
    const qualifiers = bucket.map((id) => sourceLabelQualifier(definitions.get(labelIndexKey(type, id)), id, candidate));
    const plain = qualifiers.filter((qualifier) => !qualifier).length;
    bucket.forEach((id, index) => {
      const qualifier = qualifiers[index];
      byId.set(labelIndexKey(type, id), qualifier ? `${candidate} · ${qualifier}` : (plain === 1 ? candidate : ''));
    });
  }
  // Verify: anything still sharing a label is ambiguous.
  const finalOwners = new Map();
  for (const [key, label] of byId) {
    if (!label) continue;
    const type = key.split('\u0000')[0];
    const bucket = finalOwners.get(labelIndexKey(type, label));
    if (bucket) bucket.push(key);
    else finalOwners.set(labelIndexKey(type, label), [key]);
  }
  const byLabel = new Map();
  for (const [key, bucket] of finalOwners) {
    byLabel.set(key, { id: bucket.length === 1 ? bucket[0].split('\u0000')[1] : '', unique: bucket.length === 1 });
    if (bucket.length > 1) for (const owner of bucket) byId.set(owner, '');
  }
  sourceLabelIndex = { byId, byLabel };
  return sourceLabelIndex;
}

// The label a pushed folder can use as its resolver key, or '' when this
// source's label is ambiguous (the caller then falls back to the exact id).
function curatedFolderLabel(catalogId, type) {
  const rawId = String(catalogId || '').replace(/^lib-/, '');
  const definition = getSourceDefinition(rawId);
  const mediaType = definition ? (definition.type === 'series' ? 'series' : 'movie') : (type === 'series' ? 'series' : 'movie');
  return curatedLabelIndex().byId.get(labelIndexKey(mediaType, rawId)) || '';
}

// Reverse of the above: the source id a folder label refers to, or '' when the
// label is unknown or ambiguous.
function resolveCuratedSourceLabel(label, type) {
  const entry = curatedLabelIndex().byLabel.get(labelIndexKey(type, String(label || '').trim()));
  return entry && entry.unique ? entry.id : '';
}

function folderRegions(item) {
  if (Array.isArray(item.regions) && item.regions.length) return item.regions.slice();
  const raw = String(item.catalogSources?.[0]?.catalogId || '').replace(/^lib-/, '');
  // Regions are keyed by the movie row; a series-first folder uses its pair.
  const movie = raw.replace(/_series$/, '_movies');
  const regions = PROVIDER_REGIONS[raw] || PROVIDER_REGIONS[canonicalSourceId(raw)] || PROVIDER_REGIONS[movie];
  return Array.isArray(regions) ? regions.slice() : null;
}

function folderNeedsMdblistKey(pack, item) {
  if (pack.requiresMdblistKey === true) return true;
  return (item.catalogSources || []).some((source) => {
    const definition = getSourceDefinition(String(source.catalogId || '').replace(/^lib-/, ''));
    return definition?.handler === 'mdb_list' && !!definition.params?.listId;
  });
}

function listCuratedCollections(options = {}) {
  return CURATED_COLLECTIONS.filter((pack) => !pack.hidden).map((pack) => {
    const visible = pack.folders.map((item) => options.hideAnime === true ? withoutAnimeSources(item) : item).filter(Boolean);
    const sections = (pack.sections || []).map((section) => ({
      id: section.id,
      title: section.title,
      folders: visible
        .filter((item) => sectionContainsFolder(pack, section, item))
        .map((item) => item.id),
    }));
    const meta = packMeta(pack);
    return {
      id: pack.id,
      title: pack.title,
      icon: pack.icon,
      category: pack.category || (pack.id.startsWith('preset-') ? 'More picks' : pack.title),
      refresh: pack.refresh || 'live',
      description: pack.description,
      coverImageUrl: pack.coverImageUrl || '',
      backdropUrl: pack.backdropUrl || '',
      // 5.8 picker metadata (additive: older clients ignore it).
      kind: meta.kind,
      filters: meta.filters,
      generatedCoverUrl: packCoverUrl(pack),
      requiresMdblistKey: pack.requiresMdblistKey === true,
      collectionCount: sections.length ? sections.filter((section) => section.folders.length).length : 1,
      folderCount: visible.length,
      settings: normalisePackSettings(pack.settings),
      sections,
      folders: visible.map((item) => {
        const regions = folderRegions(item);
        // No hand-made art: the same generated cover the push uses.
        const generated = item.coverImageUrl ? {} : generatedArtFor(item);
        return {
          id: item.id,
          title: item.title,
          tileShape: item.tileShape || '',
          hideTitle: !!item.hideTitle,
          coverImageUrl: item.coverImageUrl || generated.coverImageUrl || '',
          focusGifUrl: item.focusGifUrl || '',
          focusGifEnabled: !!item.focusGifEnabled,
          heroBackdropUrl: item.heroBackdropUrl || generated.heroBackdropUrl || '',
          heroVideoUrl: item.heroVideoUrl || '',
          titleLogoUrl: item.titleLogoUrl || '',
          sourceIds: [...new Set((item.catalogSources || []).map((source) => canonicalSourceId(source.catalogId)))],
          ...(regions ? { regions } : {}),
          ...(item.season ? { season: { from: item.season.from, to: item.season.to } } : {}),
          needsMdblistKey: folderNeedsMdblistKey(pack, item),
          catalogSources: (item.catalogSources || []).map((source) => {
            const type = source.type || 'movie';
            return {
              catalogId: source.catalogId,
              type,
              title: curatedSourceDisplayName(source.catalogId, type),
            };
          }),
        };
      }),
      sources: pack.folders.flatMap((f) => f.catalogSources.map((source) => source.catalogId.slice(4))),
    };
  });
}

// The /api/curated-collections body. `aliases` maps an old catalogue id to
// the one it serves, so the picker can tell a folder is already present when
// an older collection still names the alias.
// Fields a folder carries by default: omitted from the compact payload.
const FOLDER_DEFAULTS = { focusGifUrl: '', focusGifEnabled: false, heroBackdropUrl: '', heroVideoUrl: '', titleLogoUrl: '', hideTitle: false, needsMdblistKey: false };

function compactFolder(folder) {
  const out = {};
  for (const [key, value] of Object.entries(folder || {})) {
    if (key in FOLDER_DEFAULTS && value === FOLDER_DEFAULTS[key]) continue;
    if (Array.isArray(value) && value.length === 0 && key !== 'catalogSources') continue;
    out[key] = value;
  }
  // sourceIds is the catalogue ids without "lib-" unless an alias is involved:
  // only send it when it says something the sources do not.
  const derived = (out.catalogSources || []).map((source) => String(source.catalogId || '').replace(/^lib-/, ''));
  if (Array.isArray(out.sourceIds) && JSON.stringify(out.sourceIds) === JSON.stringify(derived)) delete out.sourceIds;
  return out;
}

// The picker's payload. Bundles and LeLibrary Special reuse the folders of the
// packs they include, so each folder is sent once in `folderIndex` and packs
// list folder ids (the browser rebuilds the full packs). A folder whose id is
// reused with different content stays inline. Default-valued fields and the
// per-pack source list (unused by the picker) are left out.
function curatedCollectionsPayload(options = {}) {
  const aliases = {};
  for (const source of listSources({ includeUnavailable: true })) if (source.aliasOf) aliases[source.id] = source.aliasOf;
  // Full links: art saved into a setup or shown anywhere else must work off
  // this host too (Nuvio needs absolute URLs).
  const origin = typeof options.origin === 'string' ? options.origin.replace(/\/+$/, '') : '';
  const abs = (value) => (origin ? require('./collection-artwork.ts').absoluteLocalArtwork(value, origin) : value);
  const collections = listCuratedCollections(options).map((pack) => ({
    ...pack,
    coverImageUrl: abs(pack.coverImageUrl),
    backdropUrl: abs(pack.backdropUrl),
    generatedCoverUrl: abs(pack.generatedCoverUrl),
    folders: (pack.folders || []).map((folder) => ({
      ...folder,
      coverImageUrl: abs(folder.coverImageUrl),
      focusGifUrl: abs(folder.focusGifUrl),
      heroBackdropUrl: abs(folder.heroBackdropUrl),
      heroVideoUrl: abs(folder.heroVideoUrl),
      titleLogoUrl: abs(folder.titleLogoUrl),
    })),
  }));
  if (options.compact !== true) return { collections, aliases };
  const folderIndex = {};
  const seen = {};
  const out = collections.map((pack) => {
    const { sources: _sources, ...rest } = pack;
    const folders = (pack.folders || []).map((folder) => {
      const compact = compactFolder(folder);
      const text = JSON.stringify(compact);
      if (!(folder.id in seen)) { seen[folder.id] = text; folderIndex[folder.id] = compact; return folder.id; }
      return seen[folder.id] === text ? folder.id : compact;
    });
    return { ...rest, folders };
  });
  return { collections: out, folderIndex, aliases };
}

// Packs folded into another. A saved selection of the old pack (and its
// section overrides) moves to the new one, so a setup keeps its folders.
const RETIRED_PACKS = { 'horror-vault': { to: 'persona-horror', sections: { studios: 'labels' } } };

function currentPackIds(packIds) {
  if (!Array.isArray(packIds)) return [];
  return [...new Set(packIds.map((id) => RETIRED_PACKS[id]?.to || id))];
}

function currentPackOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return overrides;
  const out = { ...overrides };
  for (const [old, { to, sections }] of Object.entries(RETIRED_PACKS)) {
    for (const key of Object.keys(overrides)) {
      if (key !== old && !key.startsWith(`${old}:`)) continue;
      const section = key.slice(old.length + 1);
      const next = section ? `${to}:${sections[section] || section}` : to;
      if (!(next in out)) out[next] = overrides[key];
      delete out[key];
    }
  }
  return out;
}

function buildCuratedCollections(packIds = [], overrides = {}, options = {}) {
  const wanted = new Set(currentPackIds(packIds));
  overrides = currentPackOverrides(overrides) || {};
  // LeLibrary Special already contains these four sections. Keeping an older
  // standalone selection as well would push the same folders twice and make
  // Nuvio do needless parallel catalogue work, which is particularly rough
  // on mobile clients.
  const special = CURATED_COLLECTIONS.find((pack) => pack.id === 'lelibrary-special');
  const specialTitles = wanted.has('lelibrary-special')
    ? new Set((special?.sections || []).map((section) => String(section.title || '').trim().toLowerCase()))
    : new Set();
  return CURATED_COLLECTIONS.filter((pack) => wanted.has(pack.id) &&
    (pack.id === 'lelibrary-special' || !specialTitles.has(String(pack.title || '').trim().toLowerCase()))).map((pack) => {
    const collection = collectionFromPack(pack, overrides[pack.id] || {});
    if (options.hideAnime === true) collection.folders = collection.folders.map(withoutAnimeSources).filter(Boolean);
    return pack.sections?.length
      ? pack.sections.map((section) => {
        // A section is a real Nuvio collection, not merely a visual group.
        // Keep the pack-level override for backward compatibility, then let
        // a section override customise its own settings/folders independently.
        const sectionOverride = overrides[`${pack.id}:${section.id}`] || {};
        const sectionCollection = collectionFromPack(pack, {
          settings: { ...(overrides[pack.id]?.settings || {}), ...(sectionOverride.settings || {}) },
          folders: { ...(overrides[pack.id]?.folders || {}), ...(sectionOverride.folders || {}) },
        });
        if (options.hideAnime === true) sectionCollection.folders = sectionCollection.folders.map(withoutAnimeSources).filter(Boolean);
        return {
          ...sectionCollection,
          id: `collection-lelibrary-pack-${pack.id}-${section.id}`,
          title: sectionOverride.title || section.title,
          // The media-source merge prefixes folder ids with the pack id so that
          // folders from different packs can never collide.  Sections keep the
          // readable source ids, so accept both forms here.
          folders: sectionCollection.folders.filter((folder) => sectionContainsFolder(pack, section, folder)),
        };
      }).filter((section) => section.folders.length)
      : collection;
  }).flat();
}

function curatedSourceIds(packIds = []) {
  const ids = buildCuratedCollections(currentPackIds(packIds))
    .flatMap((collection) => collection.folders)
    .flatMap((item) => item.catalogSources.map((source) => source.catalogId.slice(4)));
  return [...new Set(ids)];
}

function validateCuratedCollections() {
  const errors = [];
  for (const pack of CURATED_COLLECTIONS) {
    if (!/^[a-z0-9-]+$/.test(pack.id)) errors.push(`${pack.id}: invalid pack id`);
    for (const item of pack.folders) {
      const sources = Array.isArray(item.catalogSources) ? item.catalogSources : [];
      if (!sources.length) errors.push(`${pack.id}/${item.id}: no catalog sources`);
      for (const source of sources) {
        const sourceId = String(source.catalogId || '').replace(/^lib-/, '');
        if (!getSourceDefinition(sourceId)?.available) errors.push(`${pack.id}/${item.id}: unavailable source ${sourceId}`);
      }
      for (const key of ['coverImageUrl', 'focusGifUrl', 'heroBackdropUrl', 'heroVideoUrl', 'titleLogoUrl']) {
        const value = item[key];
        if (!value) continue;
        if (value.startsWith('/collection-assets/')) {
          // Artwork lives in frontend/public (copied verbatim to frontend/dist
          // at build): accept either, so validation works with or without a build.
          const relative = value.split('?')[0].split('#')[0].replace(/^\/+/, '');
          const candidates = [
            path.join(__dirname, '..', '..', '..', 'frontend', 'dist', relative),
            path.join(__dirname, '..', '..', '..', 'frontend', 'public', relative),
          ];
          if (!candidates.some((diskPath) => fs.existsSync(diskPath))) errors.push(`${pack.id}/${item.id}: missing local ${key}`);
        } else if (value.startsWith('/collection-art/') || value.startsWith('/art/folder/') || value.startsWith('/art/hero/')) {
          // LeLibrary's own art: only ever set from own-art.ts, which checked the file.
          if (!require('./own-art.ts').ownArtEntry(item.id)) errors.push(`${pack.id}/${item.id}: ${key} names own art this install does not have`);
        } else if (!/^https:\/\//.test(value) && !value.startsWith('/art/generated/')) {
          errors.push(`${pack.id}/${item.id}: ${key} must use HTTPS or /collection-assets/`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors, packs: CURATED_COLLECTIONS.length, folders: CURATED_COLLECTIONS.reduce((n, p) => n + p.folders.length, 0) };
}

// A curated folder by id (first pack that has it), for the Live art route.
let folderById = null;
function curatedFolderById(id) {
  if (!folderById) {
    folderById = new Map();
    for (const pack of CURATED_COLLECTIONS) for (const folder of pack.folders || []) if (!folderById.has(folder.id)) folderById.set(folder.id, folder);
  }
  return folderById.get(String(id || '')) || null;
}

export interface CuratedCollectionsApi {
  curatedFolderById: any;
  retiredArtworkTarget: any;
  buildCuratedCollections: any;
  curatedSourceIds: any;
  currentPackIds: any;
  currentPackOverrides: any;
  curatedSourceDisplayName: any;
  curatedFolderLabel: any;
  resolveCuratedSourceLabel: any;
  listCuratedCollections: any;
  curatedCollectionsPayload: any;
  validateCuratedCollections: any;
  PACK_FILTERS: string[];
}

module.exports = { curatedFolderById, retiredArtworkTarget, buildCuratedCollections, curatedSourceIds, currentPackIds, currentPackOverrides, curatedSourceDisplayName, curatedFolderLabel, resolveCuratedSourceLabel, listCuratedCollections, curatedCollectionsPayload, validateCuratedCollections, PACK_FILTERS } satisfies CuratedCollectionsApi;

// ── LeLibrary's own art (5.8) ─────────────────────────────────────────
// Every folder uses LeLibrary's own cover and focus GIF (own-art.ts) when this
// install has them, else its generated cover. The community artwork that used
// to ship in /collection-assets/ was retired in 5.8: those files are gone, and
// every old link (already pushed to Nuvio, or saved in a setup) is sent to the
// art that replaced it. Only the Hub art in /collection-assets/ is ours and
// stays.
const HUB_ART = /^\/collection-assets\/collections\/(?:covers|gifs)\/lelibrary-hub-(?:movies|shows)(?:-focus)?-v3\.(?:jpg|gif)$/;
const HUB_COVER_PATH = '/collection-assets/collections/covers/lelibrary-hub-movies-v3.jpg';
const RETIRED_ART = new Map();
const bareUrl = (value) => String(value || '').split('?')[0].split('#')[0];
function isRetiredCommunityArt(value) {
  const url = bareUrl(value);
  return url.startsWith('/collection-assets/') && !HUB_ART.test(url);
}

function applyOwnArt(folder) {
  const before = { cover: folder.coverImageUrl, gif: folder.focusGifUrl, hero: folder.heroBackdropUrl };
  if (isRetiredCommunityArt(before.cover)) folder.coverImageUrl = '';
  if (isRetiredCommunityArt(before.gif)) { folder.focusGifUrl = ''; folder.focusGifEnabled = false; }
  if (isRetiredCommunityArt(before.hero)) folder.heroBackdropUrl = '';
  if (isRetiredCommunityArt(folder.titleLogoUrl)) folder.titleLogoUrl = '';
  const own = folder.coverImageUrl ? null : require('./own-art.ts').ownArtFor(folder);
  if (own) {
    folder.coverImageUrl = own.coverImageUrl;
    folder.focusGifUrl = own.focusGifUrl;
    folder.focusGifEnabled = own.focusGifEnabled;
    if (!folder.heroBackdropUrl && own.heroBackdropUrl) folder.heroBackdropUrl = own.heroBackdropUrl;
  } else if (!folder.coverImageUrl) {
    Object.assign(folder, generatedArtFor(folder));
  }
  const cover = folder.coverImageUrl || HUB_COVER_PATH;
  if (isRetiredCommunityArt(before.cover) && !RETIRED_ART.has(bareUrl(before.cover))) RETIRED_ART.set(bareUrl(before.cover), cover);
  if (isRetiredCommunityArt(before.gif) && !RETIRED_ART.has(bareUrl(before.gif))) RETIRED_ART.set(bareUrl(before.gif), folder.focusGifUrl || cover);
  if (isRetiredCommunityArt(before.hero) && !RETIRED_ART.has(bareUrl(before.hero))) RETIRED_ART.set(bareUrl(before.hero), folder.heroBackdropUrl || cover);
}

for (const pack of CURATED_COLLECTIONS) {
  for (const key of ['coverImageUrl', 'backdropUrl']) {
    if (!isRetiredCommunityArt(pack[key])) continue;
    if (!RETIRED_ART.has(bareUrl(pack[key]))) RETIRED_ART.set(bareUrl(pack[key]), packCoverUrl(pack) || HUB_COVER_PATH);
    pack[key] = '';
  }
  for (const folder of pack.folders || []) applyOwnArt(folder);
}

// Where an old /collection-assets/ link goes now. Exact matches first (the
// file a curated folder used), then the folder named by the file (old files
// of folders since merged or renamed), else the Hub cover. '' for our own Hub
// art, which is still served as a file.
function retiredArtworkTarget(value) {
  const url = bareUrl(value);
  if (!isRetiredCommunityArt(url)) return '';
  if (RETIRED_ART.has(url)) return RETIRED_ART.get(url);
  const gif = url.endsWith('.gif');
  const stem = (url.split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '').replace(/-focus$/, '');
  const base = stem.replace(/-(movies|series)$/, '');
  for (const id of [stem, base, `${base}-movies`, `${base}-series`]) {
    const folder = curatedFolderById(`folder-lelibrary-${id}`);
    if (folder && folder.coverImageUrl) return (gif && folder.focusGifUrl) || folder.coverImageUrl;
  }
  return HUB_COVER_PATH;
}
