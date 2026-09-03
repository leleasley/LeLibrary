/*
 * Configure state facade.
 *
 * The legacy configure engine still owns token compatibility and platform
 * pushes. This small facade gives the redesigned UI one stable, non-secret
 * view of the draft without duplicating or exposing API keys.
 */
(function () {
  'use strict';

  const text = (id) => {
    const element = document.getElementById(id);
    return String(element?.value ?? element?.textContent ?? '').trim();
  };
  const checked = (id) => !!document.getElementById(id)?.checked;
  const countText = (id) => text(id).replace(/\s+/g, ' ');

  function snapshot() {
    const platform = text('platform') || null;
    const provider = text('provider');
    const providers = provider.split(',').map((item) => item.trim()).filter(Boolean);
    return {
      setup: {
        platform,
        providers,
        hasTmdb: !!text('tmdbApiKey'),
        posterProvider: text('posterProvider') || 'tmdb',
      },
      content: {
        builtInSources: {
          movies: !document.getElementById('editCatMovies') || checked('editCatMovies'),
          shows: !document.getElementById('editCatSeries') || checked('editCatSeries'),
          collections: !document.getElementById('editCatFranchises') || checked('editCatFranchises'),
          anime: !document.getElementById('editCatAnime') || checked('editCatAnime'),
        },
        homeRows: countText('yourRowsTotal') || 'No rows selected',
        discoveryRows: [
          checked('editCatTrendingMovies') && 'Trending Movies',
          checked('editCatTrendingSeries') && 'Trending Series',
          checked('editCatPopularMovies') && 'Popular Movies',
          checked('editCatPopularSeries') && 'Popular Series',
        ].filter(Boolean),
        importedRows: countText('importedRowsTotal') || 'None',
      },
      nuvio: {
        collectionPacks: countText('curatedPackTotal') || 'None selected',
        profile: text('cataloguesProfile') || null,
        libraryIdMode: checked('libraryIdMode') ? 'tt' : 'torbox',
        pinCollections: checked('pinCollections'),
      },
    };
  }

  window.LeConfigureState = { snapshot };
})();
