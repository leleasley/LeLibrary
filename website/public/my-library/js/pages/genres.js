// ── Genres View ───────────────────────────────────────────────

const TMDB_MOVIE_GENRES = [
  { id: 28, name: 'Action' }, { id: 12, name: 'Adventure' }, { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' }, { id: 80, name: 'Crime' }, { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' }, { id: 10751, name: 'Family' }, { id: 14, name: 'Fantasy' },
  { id: 36, name: 'History' }, { id: 27, name: 'Horror' }, { id: 10402, name: 'Music' },
  { id: 9648, name: 'Mystery' }, { id: 10749, name: 'Romance' }, { id: 878, name: 'Sci-Fi' },
  { id: 10770, name: 'TV Movie' }, { id: 53, name: 'Thriller' }, { id: 10752, name: 'War' },
  { id: 37, name: 'Western' },
];
const TMDB_TV_GENRES = [
  { id: 10759, name: 'Action & Adventure' }, { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' }, { id: 80, name: 'Crime' }, { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' }, { id: 10751, name: 'Family' }, { id: 10762, name: 'Kids' },
  { id: 9648, name: 'Mystery' }, { id: 10763, name: 'News' }, { id: 10764, name: 'Reality' },
  { id: 10765, name: 'Sci-Fi & Fantasy' }, { id: 10766, name: 'Soap' },
  { id: 10767, name: 'Talk' }, { id: 10768, name: 'War & Politics' },
];

let genreState = {
  type: 'movie',
  currentId: null,
  currentName: '',
  page: 1,
  hasMore: false,
  isLoading: false,
  items: [],
  scrollObserver: null,
};

function renderGenreView() {
  genreState.type = 'movie';
  genreState.currentId = null;
  genreState.items = [];
  genreState.page = 1;
  genreState.hasMore = false;

  hideAllViews();
  const genreView = document.getElementById('genreView');
  genreView.style.display = 'block';

  const toggleHtml = `<div class="genre-type-toggle" id="genreTypeToggle">
    <button class="genre-type-btn active" data-type="movie" onclick="switchGenreType('movie')">${icon('movie', 14)} Movies</button>
    <button class="genre-type-btn" data-type="tv" onclick="switchGenreType('tv')">${icon('tv', 14)} Series</button>
  </div>`;

  const genres = getGenreList('movie');
  const chipsHtml = '<div class="genre-grid" id="genreChipGrid">' +
    genres.map(g => `<div class="genre-chip" data-id="${g.id}" onclick="selectGenre(${g.id},'${g.name.replace(/'/g, "\\'")}')">${g.name}</div>`).join('') +
    '</div>';

  genreView.innerHTML = `
    <div class="browse-header"><h2>${icon('film', 18)} Browse by Genre</h2></div>
    ${toggleHtml}${chipsHtml}
    <div id="genreResultsHeader" style="display:none;margin-top:1rem"></div>
    <div class="browse-grid" id="genreGrid"></div>
    <div id="genreLoadMore" style="text-align:center;padding:1rem;display:none"><div class="spinner"></div></div>
  `;

  addBackBtn(genreView);

  updateBottomNav('genres');
}

function getGenreList(type) {
  return type === 'movie' ? TMDB_MOVIE_GENRES : TMDB_TV_GENRES;
}

function switchGenreType(type) {
  genreState.type = type;
  genreState.currentId = null;
  genreState.items = [];
  genreState.page = 1;
  genreState.hasMore = false;

  document.querySelectorAll('.genre-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === type);
  });

  const genres = getGenreList(type);
  document.getElementById('genreChipGrid').innerHTML = genres.map(g =>
    `<div class="genre-chip" data-id="${g.id}" onclick="selectGenre(${g.id},'${g.name.replace(/'/g, "\\'")}')">${g.name}</div>`
  ).join('');

  document.getElementById('genreGrid').innerHTML = '';
  document.getElementById('genreResultsHeader').style.display = 'none';
  document.getElementById('genreLoadMore').style.display = 'none';
}

function selectGenre(genreId, genreName) {
  genreState.currentId = genreId;
  genreState.currentName = genreName;
  genreState.items = [];
  genreState.page = 1;
  genreState.hasMore = false;

  document.querySelectorAll('.genre-chip').forEach(c => {
    c.classList.toggle('active', parseInt(c.dataset.id) === genreId);
  });

  const header = document.getElementById('genreResultsHeader');
  header.style.display = 'block';
  header.innerHTML = `<div class="browse-header"><h2>${escHtml(genreName)} ${genreState.type === 'movie' ? 'Movies' : 'Series'}</h2></div>`;

  const endpoint = genreState.type === 'movie'
    ? `/discover/movie?with_genres=${genreId}&sort_by=popularity.desc`
    : `/discover/tv?with_genres=${genreId}&sort_by=popularity.desc`;

  loadGenrePage(endpoint, 1, true);
}

async function loadGenrePage(endpoint, page, replace) {
  if (genreState.isLoading) return;
  genreState.isLoading = true;
  const grid = document.getElementById('genreGrid');
  const loadMore = document.getElementById('genreLoadMore');

  if (replace) {
    grid.innerHTML = '';
    loadMore.style.display = 'block';
    loadMore.innerHTML = '<div class="spinner"></div>';
  }

  try {
    const sep = endpoint.includes('?') ? '&' : '?';
    const data = await tmdbGet(endpoint + sep + 'page=' + page);
    const items = (data.results || []).filter(i => i.poster_path);

    if (replace) grid.innerHTML = '';

    items.forEach(item => {
      const title = item.title || item.name || '';
      const year = (item.release_date || item.first_air_date || '').split('-')[0];
      const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
      const inLib = isInLibrary(title);
      const mt = genreState.type === 'movie' ? 'movie' : 'tv';
      const card = document.createElement('div');
      card.className = 'card';
      card.onclick = () => openTMDBDetail({ id: item.id, mt, title, year, poster: item.poster_path, backdrop: item.backdrop_path, overview: item.overview || '', rating: item.vote_average || 0 });
      card.innerHTML =
        (inLib ? '<div class="card-badge">In Library</div>' : '') +
        `<img class="card-poster" src="https://image.tmdb.org/t/p/w342${item.poster_path}" alt="${escHtml(title)}" loading="lazy" />` +
        `<div class="card-info"><div class="card-title" title="${escHtml(title)}">${escHtml(title)}</div>` +
        `<div class="card-year">${year}${mt === 'tv' ? ' \u00B7 Series' : ''}</div>` +
        (rating ? `<div class="card-rating">\u2605 ${rating}</div>` : '') +
        '</div>';
      grid.appendChild(card);
    });

    genreState.page = page;
    genreState.hasMore = page < (data.total_pages || 1);
    const existingIds = new Set(genreState.items.map(i => i.id));
    const newItems = items.filter(i => !existingIds.has(i.id));
    genreState.items = genreState.items.concat(newItems);
    loadMore.style.display = 'none';

    if (genreState.hasMore) {
      loadMore.style.display = 'block';
      loadMore.innerHTML = '<div class="spinner"></div>';
      if (genreState.scrollObserver) { genreState.scrollObserver.disconnect(); genreState.scrollObserver = null; }
      genreState.scrollObserver = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && genreState.hasMore && !genreState.isLoading) {
          loadGenrePage(endpoint, genreState.page + 1, false);
        }
      }, { rootMargin: '300px' });
      genreState.scrollObserver.observe(loadMore);
    }
  } catch (err) {
    loadMore.innerHTML = '<p style="color:var(--error);font-size:12px">Error loading content</p>';
    loadMore.style.display = 'block';
  } finally {
    genreState.isLoading = false;
  }
}
