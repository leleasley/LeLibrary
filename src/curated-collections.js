// Shared, opt-in Nuvio collection packs.
//
// This module deliberately contains no account-only code: both the hosted
// account area and the public /configure page consume the exact same pack
// definitions. Artwork is bundled and served locally, while catalog ids stay
// LeLibrary's own stable `lib-*` sources.

const { getSourceDefinition } = require('./catalog-source-registry');
const fs = require('fs');
const path = require('path');

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
    asset.focusGifUrl = asset._focusUrl
      || (asset._focusFile ? `/collection-assets/collections/gifs/${asset._focusFile}` : '')
      || (asset._hasFocusGif ? `/collection-assets/collections/gifs/${id}-focus.gif` : '');
    // If an artwork definition supplies a GIF URL, it should be live by
    // default. Older pack entries often supplied a focus file/URL without
    // also setting the separate boolean, leaving the animation invisible.
    asset.focusGifEnabled = !!(asset._hasFocusGif || asset.focusGifUrl);
    if (asset._backdropUrl) asset.heroBackdropUrl = asset._backdropUrl;
  } else if (asset._assetKind === 'person') {
    asset.coverImageUrl = `/collection-assets/people/covers/${id}.png`;
    asset.focusGifUrl = `/collection-assets/people/gifs/${id}.gif`;
    asset.focusGifEnabled = true;
    asset.heroBackdropUrl = `/collection-assets/people/backdrops/${id}.jpg`;
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

    return { ...pack, folders };
  });
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
      folder('streaming-crave', 'Crave', 'streaming_crave_movies', artwork('streaming', 'crave', 'png', false, 'special-crave.png'), ['streaming_crave_series']),
      folder('streaming-hayu', 'Hayu', 'streaming_hayu_movies', artwork('streaming', 'hayu', 'png', false, 'special-hayu.png'), ['streaming_hayu_series']),
      folder('streaming-magellan', 'Magellan TV', 'streaming_magellan_movies', artwork('streaming', 'magellan', 'png', false, 'special-magellan.png'), ['streaming_magellan_series']),
      folder('streaming-starz', 'Starz', 'streaming_starz_movies', artwork('streaming', 'starz', 'png', false, 'special-starz.png'), ['streaming_starz_series']),
      folder('streaming-mubi', 'Mubi', 'streaming_mubi_movies', artwork('streaming', 'mubi', 'png', false, 'special-mubi.png'), ['streaming_mubi_series']),
      folder('streaming-britbox', 'BritBox', 'streaming_britbox_movies', artwork('streaming', 'britbox', 'png', false, 'special-britbox.png'), ['streaming_britbox_series']),
      folder('streaming-curiosity', 'Curiosity Stream', 'streaming_curiosity_movies', artwork('streaming', 'curiosity', 'png', false, 'special-curiosity.png'), ['streaming_curiosity_series']),
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
      folder('preset-cinema-now-next', 'Coming Soon', 'upcoming_movies', artwork('discover', 'new-releases', 'jpg', false, 'discover-new-releases.jpg'), ['new_latest_digital_movies', 'new_latest_releases_movies']),
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
    coverImageUrl: '/collection-assets/collections/covers/preset-directors.png',
    backdropUrl: '/collection-assets/collections/covers/preset-directors.png',
    folders: DIRECTOR_PACK_FOLDERS,
  },
  {
    id: 'preset-decades', title: 'By Decade', icon: '📅', category: 'Discover', refresh: 'daily',
    description: 'The most popular films and shows from each decade.',
    coverImageUrl: '/collection-assets/collections/covers/preset-by-decade.png',
    backdropUrl: '/collection-assets/collections/covers/preset-by-decade.png',
    folders: DECADE_PACK_FOLDERS,
  },
  {
    id: 'preset-world-cinema', title: 'World Cinema', icon: '🌍', category: 'World Cinema', refresh: 'daily',
    description: 'Popular films and series by original language.',
    coverImageUrl: '/collection-assets/collections/covers/preset-world-cinema.png',
    backdropUrl: '/collection-assets/collections/covers/preset-world-cinema.png',
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
    id: 'lelibrary-special', title: 'LeLibrary Special', icon: '🌟',
    description: 'The ultimate LeLibrary sampler: big, bold, and packed with variety. Made for Home Rows and Nuvio Collections.',
    sections: [
      { id: 'discover', title: 'Discover', folders: ['special-trending-movies', 'special-trending-series', 'special-popular-movies', 'special-popular-series', 'special-new-releases', 'special-top-rated'] },
      { id: 'streaming', title: 'Streaming Services', folders: ['special-netflix', 'special-prime', 'special-disney', 'special-hbo', 'special-apple', 'special-hulu', 'special-paramount', 'special-crave', 'special-hayu', 'special-magellan', 'special-starz', 'special-mubi', 'special-britbox', 'special-curiosity'] },
      { id: 'genres', title: 'Genres', folders: ['special-action', 'special-comedy', 'special-horror', 'special-scifi', 'special-documentary', 'special-mystery', 'special-romance', 'special-war', 'special-adventure'] },
      { id: 'franchises', title: 'Film Collections', folders: ['special-marvel', 'special-star-wars', 'special-harry-potter', 'special-lotr', 'special-dune', 'special-avatar', 'special-planet-of-the-apes', 'special-taken', 'special-minions', 'special-avengers', 'special-john-wick', 'special-jurassic', 'special-mission-impossible', 'special-fast-furious', 'special-matrix', 'special-pirates', 'special-transformers', 'special-hunger-games'] },
    ],
    folders: [
      folder('special-trending-movies', 'Trending Now', 'trending_movies', artwork('discover', 'trending', 'jpg', false, 'discover-trending-movies.jpg', 'discover-trending-movies-focus.gif')),
      folder('special-trending-series', 'Trending Series', 'trending_series', artwork('discover', 'trending-series', 'jpg', false, 'discover-trending-series.jpg', 'discover-trending-series-focus.gif')),
      folder('special-popular-movies', 'Popular Movies', 'tmdb_popular_movies', artwork('discover', 'popular', 'jpg', false, 'discover-popular-movies.jpg', 'discover-popular-movies-focus.gif')),
      folder('special-popular-series', 'Popular Series', 'tmdb_popular_series', artwork('discover', 'popular-series', 'jpg', false, 'discover-popular-series.jpg', 'discover-popular-series-focus.gif')),
      folder('special-new-releases', 'New Releases', 'upcoming_movies', artwork('discover', 'new-releases', 'jpg', false, 'discover-new-releases.jpg')),
      folder('special-top-rated', 'Top Rated', 'trending_imdb_top100_movies', artwork('discover', 'top-rated', 'jpg', false, 'discover-top-rated.jpg', 'discover-top-rated-focus.gif')),
      folder('special-netflix', 'Netflix', 'streaming_netflix_movies', artwork('streaming', 'netflix', 'png', false, 'streaming-netflix.png', 'streaming-netflix-focus.gif'), ['streaming_netflix_series', 'streaming_netflix_top10_movies', 'streaming_netflix_top10_series', 'streaming_latest_netflix_movies', 'streaming_latest_netflix_series']),
      folder('special-prime', 'Prime Video', 'streaming_prime_movies', artwork('streaming', 'prime-video', 'png', false, 'streaming-prime.png', 'streaming-prime-focus.gif'), ['streaming_prime_series', 'streaming_prime_top10_movies', 'streaming_prime_top10_series', 'streaming_latest_prime_movies', 'streaming_latest_prime_series']),
      folder('special-disney', 'Disney+', 'streaming_disney_movies', artwork('streaming', 'disney', 'png', false, 'streaming-disney.png', 'streaming-disney-focus.gif'), ['streaming_disney_series', 'streaming_disney_top10_movies', 'streaming_disney_top10_series', 'streaming_latest_disney_movies', 'streaming_latest_disney_series']),
      folder('special-hbo', 'HBO Max', 'streaming_hbo_movies', artwork('streaming', 'hbo-max', 'png', false, 'streaming-hbo.png', 'streaming-hbo-focus.gif'), ['streaming_hbo_series', 'streaming_hbo_top10_movies', 'streaming_hbo_top10_series', 'streaming_latest_hbo_movies', 'streaming_latest_hbo_series']),
      folder('special-apple', 'Apple TV+', 'streaming_apple_movies', artwork('streaming', 'apple-tv', 'png', false, 'streaming-apple.png', 'streaming-apple-focus.gif'), ['streaming_apple_series', 'streaming_apple_top10_movies', 'streaming_apple_top10_series', 'streaming_latest_apple_movies', 'streaming_latest_apple_series']),
      folder('special-hulu', 'Hulu', 'streaming_hulu_movies', artwork('streaming', 'hulu', 'png', false, 'streaming-hulu.png', 'streaming-hulu-focus.gif'), ['streaming_hulu_series', 'streaming_latest_hulu_movies', 'streaming_latest_hulu_series']),
      folder('special-paramount', 'Paramount+', 'streaming_paramount_movies', artwork('streaming', 'paramount', 'png', false, 'streaming-paramount.png', 'streaming-paramount-focus.gif'), ['streaming_paramount_series', 'streaming_paramount_top10_movies', 'streaming_paramount_top10_series', 'streaming_latest_paramount_movies', 'streaming_latest_paramount_series']),
      folder('special-crave', 'Crave', 'streaming_crave_movies', artwork('streaming', 'crave', 'png', true, 'special-crave.png'), ['streaming_crave_series']),
      folder('special-hayu', 'Hayu', 'streaming_hayu_movies', artwork('streaming', 'hayu', 'png', true, 'special-hayu.png'), ['streaming_hayu_series']),
      folder('special-magellan', 'Magellan TV', 'streaming_magellan_movies', artwork('streaming', 'magellan', 'png', true, 'special-magellan.png'), ['streaming_magellan_series']),
      folder('special-starz', 'Starz', 'streaming_starz_movies', artwork('streaming', 'starz', 'png', true, 'special-starz.png'), ['streaming_starz_series']),
      folder('special-mubi', 'Mubi', 'streaming_mubi_movies', artwork('streaming', 'mubi', 'png', true, 'special-mubi.png'), ['streaming_mubi_series']),
      folder('special-britbox', 'BritBox', 'streaming_britbox_movies', artwork('streaming', 'britbox', 'png', true, 'special-britbox.png'), ['streaming_britbox_series']),
      folder('special-curiosity', 'Curiosity Stream', 'streaming_curiosity_movies', artwork('streaming', 'curiosity', 'png', true, 'special-curiosity.png'), ['streaming_curiosity_series']),
      folder('special-action', 'Action', 'genre_action_movies', artwork('genres', 'action', 'png', false, 'genre-action.png', '', 'https://imkaptain.github.io/nuvio-assets/Genres/Action/Action_Hover.gif')),
      folder('special-comedy', 'Comedy', 'genre_comedy_movies', artwork('genres', 'comedy', 'png', false, 'genre-comedy.png', '', 'https://imkaptain.github.io/nuvio-assets/Genres/Comedy/Comedy_Hover.gif')),
      folder('special-horror', 'Horror', 'genre_horror_movies', artwork('genres', 'horror', 'png', false, 'genre-horror.png', '', 'https://imkaptain.github.io/nuvio-assets/Genres/Horror/Horror_Hover.gif')),
      folder('special-scifi', 'Sci-Fi', 'genre_scifi_movies', artwork('genres', 'sci-fi', 'png', false, 'genre-scifi.png', '', 'https://imkaptain.github.io/nuvio-assets/Genres/Science%20Fiction/Science_Fiction_Hover.gif')),
      folder('special-documentary', 'Documentary', 'genre_documentary_movies', artwork('genres', 'documentary', 'png', false, 'genre-action.png', '', 'https://imkaptain.github.io/nuvio-assets/Genres/Documentary/Documentary_Hover.gif')),
      folder('special-mystery', 'Mystery', 'genre_mystery_movies', artwork('genres', 'mystery', 'png', false, 'genre-thriller.png', '', 'https://imkaptain.github.io/nuvio-assets/Genres/Mystery/Mystery_Hover.gif')),
      folder('special-romance', 'Romance', 'genre_romance_movies', artwork('genres', 'romance', 'png', false, 'genre-drama.png', '', 'https://imkaptain.github.io/nuvio-assets/Genres/Romance/Romance_Hover.gif')),
      folder('special-war', 'War', 'genre_war_movies', artwork('genres', 'war', 'png', false, 'genre-action.png', '', 'https://imkaptain.github.io/nuvio-assets/Genres/War/War_Hover.gif')),
      folder('special-adventure', 'Adventure', 'genre_adventure_movies', artwork('genres', 'adventure', 'png', false, 'genre-fantasy.png', '', 'https://imkaptain.github.io/nuvio-assets/Genres/Adventure/Adventure_Hover.gif')),
      folder('special-marvel', 'Marvel', 'collection_marvel_universe_mdb', artwork('franchises', 'mcu', 'jpg', false, 'franchise-marvel.jpg', 'franchise-marvel-focus.gif')),
      folder('special-star-wars', 'Star Wars', 'collection_star_wars', artwork('franchises', 'star-wars', 'jpg', false, 'franchise-star-wars.jpg')),
      folder('special-harry-potter', 'Harry Potter', 'collection_harry_potter', artwork('franchises', 'wizarding-world', 'png', false, 'franchise-harry-potter.png')),
      folder('special-lotr', 'Lord of the Rings', 'collection_lord_of_the_rings', artwork('franchises', 'lord-of-the-rings', 'jpg', false, 'franchise-lotr.jpg')),
      folder('special-dune', 'Dune', 'collection_dune', artwork('franchises', 'dune', 'jpg', false, 'franchise-dune.jpg')),
      folder('special-avatar', 'Avatar', 'collection_avatar', artwork('franchises', 'avatar', 'jpg', false, '', '', '',
        'https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main/collections/Avatar_Collection/Avatar_Collection_Base.jpg',
        'https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main/collections/Avatar_Collection/Avatar_Collection_Backdrop.jpg')),
      folder('special-planet-of-the-apes', 'Planet of the Apes', 'collection_planet_of_apes', artwork('franchises', 'planet-of-the-apes', 'jpg', false, '', '', '',
        'https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main/collections/Planet_of_the_Apes__Reboot__Collection/Planet_of_the_Apes__Reboot__Collection_Base.jpg',
        'https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main/collections/Planet_of_the_Apes__Reboot__Collection/Planet_of_the_Apes__Reboot__Collection_Backdrop.jpg')),
      folder('special-taken', 'Taken', 'collection_taken', artwork('franchises', 'taken', 'jpg', false, '', '', '',
        'https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main/collections/Taken_Collection/Taken_Collection_Base.jpg',
        'https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main/collections/Taken_Collection/Taken_Collection_Backdrop.jpg')),
      folder('special-minions', 'Minions', 'collection_minions', artwork('franchises', 'minions', 'jpg', false, '', '', '',
        'https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main/collections/Minions_Collection/Minions_Collection_Base.jpg',
        'https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main/collections/Minions_Collection/Minions_Collection_Backdrop.jpg')),
      folder('special-avengers', 'The Avengers', 'collection_avengers', artwork('franchises', 'the-avengers', 'jpg', false, '', '', '',
        'https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main/collections/The_Avengers_Collection/The_Avengers_Collection_Base.jpg',
        'https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main/collections/The_Avengers_Collection/The_Avengers_Collection_Backdrop.jpg')),
      folder('special-john-wick', 'John Wick', 'collection_john_wick', artwork('franchises', 'john-wick', 'jpg', false, '', '', '',
        'https://raw.githubusercontent.com/rrevanth/nuvio-assets/main/franchises/john-wick/john-wick-landscape.jpg')),
      folder('special-jurassic', 'Jurassic Park', 'collection_jurassic_park', artwork('franchises', 'jurassic-world', 'jpg', false, '', '', '',
        'https://raw.githubusercontent.com/rrevanth/nuvio-assets/main/franchises/jurassic-world/jurassic-world-landscape.jpg')),
      folder('special-mission-impossible', 'Mission: Impossible', 'collection_mission_impossible', artwork('franchises', 'mission-impossible', 'jpg', false, '', '', '',
        'https://raw.githubusercontent.com/rrevanth/nuvio-assets/main/franchises/mission-impossible/mission-impossible-landscape.jpg')),
      folder('special-fast-furious', 'Fast & Furious', 'collection_fast_furious', artwork('franchises', 'fast-furious', 'webp', false, '', '', '',
        'https://imkaptain.github.io/nuvio-assets/assets/images/b132769f.webp')),
      folder('special-matrix', 'The Matrix', 'collection_matrix', artwork('franchises', 'matrix', 'png', false, '', '',
        'https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main/assets/images/Action_The%20Matrix_1080p_Opt01_Hover.gif',
        'https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main/assets/images/Action_The%20Matrix_1080p_Opt01_Base.png',
        'https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main/assets/images/Action_The%20Matrix_1080p_Opt01_Base.png')),
      folder('special-pirates', 'Pirates of the Caribbean', 'collection_pirates', artwork('franchises', 'pirates-caribbean', 'jpg', false, '', '',
        'https://raw.githubusercontent.com/rrevanth/nuvio-assets/main/franchises/pirates-caribbean/pirates-caribbean.gif',
        'https://raw.githubusercontent.com/rrevanth/nuvio-assets/main/franchises/pirates-caribbean/pirates-caribbean-landscape.jpg',
        '')),
      folder('special-transformers', 'Transformers', 'collection_transformers', artwork('franchises', 'transformers', 'jpg', false, '', '', '',
        'https://raw.githubusercontent.com/rrevanth/nuvio-assets/main/franchises/transformers/transformers-landscape.jpg')),
      folder('special-hunger-games', 'The Hunger Games', 'collection_hunger_games', artwork('franchises', 'hunger-games', 'jpg', false, '', '', '',
        'https://raw.githubusercontent.com/rrevanth/nuvio-assets/main/franchises/hunger-games/hunger-games-landscape.jpg')),
    ],
  },
]);

// LeLibrary Special is the all-in-one choice. Derive it from every normal
// pack so a new curated source is automatically included here too. The
// selection logic below suppresses those normal packs when Special is chosen,
// which keeps its folders inside the seven Special sections instead of adding
// duplicate ordinary collections or Home rows.
const SPECIAL_PACK = CURATED_COLLECTIONS.find((pack) => pack.id === 'lelibrary-special');
if (SPECIAL_PACK) {
  const standardPacks = CURATED_COLLECTIONS.filter((pack) => pack !== SPECIAL_PACK && !pack.id.startsWith('preset-'));
  SPECIAL_PACK.sections = standardPacks.map((pack) => ({
    id: pack.id,
    title: pack.title,
    folders: pack.folders.map((folder) => folder.id),
  }));
  SPECIAL_PACK.folders = standardPacks.flatMap((pack) => pack.folders.map((folder) => ({
    ...folder,
    catalogSources: (folder.catalogSources || []).map((source) => ({ ...source })),
  })));
}
Object.freeze(CURATED_COLLECTIONS);

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function isAnimeCuratedSource(source) {
  // Keep this source-level. A folder can deliberately combine an anime source
  // with a normal one: Hide anime must remove only the anime contribution,
  // never throw away the remaining catalogue sources.
  return String(source?.catalogId || '').replace(/^lib-/, '').startsWith('studio_ghibli_');
}

function withoutAnimeSources(folder) {
  const catalogSources = (folder?.catalogSources || []).filter((source) => !isAnimeCuratedSource(source));
  return catalogSources.length ? { ...folder, catalogSources } : null;
}

function sectionContainsFolder(pack, section, folder) {
  const folderKey = folder.id.replace(`folder-${pack.id}-`, '').replace(/-(movies|series)$/, '');
  return (section.folders || []).some((id) => {
    const sectionKey = String(id).replace(/^special-/, '').replace(/-(movies|series)$/, '');
    return id === folder.id || folderKey === sectionKey;
  });
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
  }
  return {
    id: `collection-lelibrary-pack-${pack.id}`,
    title: pack.title,
    backdropUrl: pack.backdropUrl || '',
    ...settings,
    folders,
  };
}

function curatedSourceDisplayName(catalogId, type) {
  const rawId = String(catalogId || '').replace(/^lib-/, '');
  const definition = getSourceDefinition(rawId) || getSourceDefinition(catalogId);
  if (typeof definition?.params?.listName === 'string' && definition.params.listName.trim()) {
    return definition.params.listName.trim();
  }
  const base = String(definition?.name || rawId || 'Catalog')
    .replace(/\s+(Movies|Series)$/i, '')
    .trim();
  let variant = '';
  if (/^streaming_.*_top10_/i.test(rawId)) variant = ' Top 10';
  else if (/^streaming_latest_/i.test(rawId)) variant = ' Latest';
  else if (/^kb_.*_top50/i.test(rawId)) variant = ' Top 50';
  const media = type === 'series' ? 'Series' : type === 'movie' ? 'Movies' : '';
  return `${base}${variant}${media ? ` ${media}` : ''}`.trim();
}

function listCuratedCollections(options = {}) {
  return CURATED_COLLECTIONS.map((pack) => ({
    id: pack.id,
    title: pack.title,
    icon: pack.icon,
    category: pack.category || (pack.id.startsWith('preset-') ? 'More picks' : pack.title),
    refresh: pack.refresh || 'live',
    description: pack.description,
    coverImageUrl: pack.coverImageUrl || '',
    backdropUrl: pack.backdropUrl || '',
    folderCount: pack.folders.filter((folder) => options.hideAnime !== true || !!withoutAnimeSources(folder)).length,
    settings: normalisePackSettings(pack.settings),
    sections: (pack.sections || []).map((section) => ({
      id: section.id,
      title: section.title,
      folders: pack.folders
        .filter((folder) => (options.hideAnime !== true || !!withoutAnimeSources(folder)) && sectionContainsFolder(pack, section, folder))
        .map((folder) => folder.id),
    })),
    folders: pack.folders.map((folder) => options.hideAnime === true ? withoutAnimeSources(folder) : folder).filter(Boolean).map((folder) => ({
      id: folder.id,
      title: folder.title,
      tileShape: folder.tileShape || '',
      hideTitle: !!folder.hideTitle,
      coverImageUrl: folder.coverImageUrl || '',
      focusGifUrl: folder.focusGifUrl || '',
      focusGifEnabled: !!folder.focusGifEnabled,
      heroBackdropUrl: folder.heroBackdropUrl || '',
      heroVideoUrl: folder.heroVideoUrl || '',
      titleLogoUrl: folder.titleLogoUrl || '',
      catalogSources: (folder.catalogSources || []).map((source) => {
        const type = source.type || 'movie';
        return {
          catalogId: source.catalogId,
          type,
          title: curatedSourceDisplayName(source.catalogId, type),
        };
      }),
    })),
    sources: pack.folders.flatMap((f) => f.catalogSources.map((source) => source.catalogId.slice(4))),
  }));
}

function buildCuratedCollections(packIds = [], overrides = {}, options = {}) {
  const wanted = new Set(Array.isArray(packIds) ? packIds : []);
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
  const ids = buildCuratedCollections(packIds)
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
          const diskPath = path.join(__dirname, '..', 'website', 'public', value);
          if (!fs.existsSync(diskPath)) errors.push(`${pack.id}/${item.id}: missing local ${key}`);
        } else if (!/^https:\/\//.test(value)) {
          errors.push(`${pack.id}/${item.id}: ${key} must use HTTPS or /collection-assets/`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors, packs: CURATED_COLLECTIONS.length, folders: CURATED_COLLECTIONS.reduce((n, p) => n + p.folders.length, 0) };
}

module.exports = { buildCuratedCollections, curatedSourceIds, curatedSourceDisplayName, listCuratedCollections, validateCuratedCollections };
