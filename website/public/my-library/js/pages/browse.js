// ── Search View (TMDB) ────────────────────────────────────────
async function renderSearchView(query) {
  browseState.type = 'movies';
  browseState.searchQuery = query;
  browseState.items = [];
  browseState.page = 1;
  browseState.hasMore = false;
  browseState.isLoading = false;
  browseState.reqToken++;
  disconnectBrowseScroll();

  const tmdbKey = App.keys.tmdbKey;
  if (!tmdbKey) { showToast('TMDB API key required', 'error'); navigateTo('dashboard'); return; }

  hideAllViews();
  const browseView = document.getElementById('browseView');
  browseView.style.display = 'block';

  browseView.innerHTML = `
    <div class="browse-header">
      <h2>${icon('search', 18)} Results for &ldquo;${escHtml(query)}&rdquo;</h2>
    </div>
    <div class="browse-grid" id="browseContent"></div>
    <div id="browseLoadMore" style="text-align:center;padding:1rem;display:none"><div class="spinner"></div></div>
    <button id="backToTop" class="back-to-top" title="Back to top" aria-label="Back to top">${icon('back', 14)}</button>
  `;

  addBackBtn(browseView);

  const browseEl = document.getElementById('browseView');
  const bttBtn = document.getElementById('backToTop');
  if (browseEl && bttBtn) {
    window.addEventListener('scroll', function _bttScroll() {
      if (!document.getElementById('backToTop')) { window.removeEventListener('scroll', _bttScroll); return; }
      bttBtn.classList.toggle('visible', window.scrollY > 400);
    });
    bttBtn.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const content = document.getElementById('browseContent');
  content.innerHTML = '<div style="text-align:center;padding:2rem"><div class="spinner"></div></div>';
  loadSearchPage(query, 1, true);
}

async function loadSearchPage(query, page, replace) {
  if (browseState.isLoading) return;
  browseState.isLoading = true;
  const myToken = browseState.reqToken;
  const content = document.getElementById('browseContent');
  const loadMore = document.getElementById('browseLoadMore');
  if (!content) return;

  try {
    const data = await tmdbGet('/search/multi?query=' + encodeURIComponent(query) + '&language=en-US&page=' + page);
    if (myToken !== browseState.reqToken) return;
    const items = (data.results || []).filter(i => i.poster_path && (i.media_type === 'movie' || i.media_type === 'tv'));

    if (replace) content.innerHTML = '';

    if (items.length === 0 && page === 1) {
      content.innerHTML = '<div class="watchlist-empty"><div class="icon">' + icon('search', 32) + '</div><h3>No results</h3><p>Try a different title.</p></div>';
      if (loadMore) loadMore.style.display = 'none';
      browseState.isLoading = false;
      return;
    }

    items.forEach(item => {
      const title = item.title || item.name || '';
      const year = (item.release_date || item.first_air_date || '').split('-')[0];
      const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
      const mt = item.media_type === 'tv' ? 'tv' : 'movie';
      const card = document.createElement('div');
      card.className = 'card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', 'Open details: ' + title + (year ? ' (' + year + ')' : ''));
      card.onclick = () => openTMDBDetail({ id: item.id, mt, title, year, poster: item.poster_path, backdrop: item.backdrop_path, overview: item.overview || '', rating: item.vote_average || 0 });
      card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.onclick(); } };
      card.innerHTML =
        `<img class="card-poster" src="https://image.tmdb.org/t/p/w342${item.poster_path}" alt="${escHtml(title)}" loading="lazy" />` +
        `<div class="card-info"><div class="card-title" title="${escHtml(title)}">${escHtml(title)}</div>` +
        `<div class="card-year">${year}${mt === 'tv' ? ' \u00B7 Series' : ''}</div>` +
        (rating ? `<div class="card-rating">\u2605 ${rating}</div>` : '') +
        '</div>';
      content.appendChild(card);
    });

    browseState.page = page;
    browseState.hasMore = page < (data.total_pages || 1);
    const existingIds = new Set(browseState.items.map(i => i.id));
    const newItems = items.filter(i => !existingIds.has(i.id));
    browseState.items = browseState.items.concat(newItems);

    if (loadMore) loadMore.style.display = 'none';
    if (browseState.hasMore) connectBrowseScroll();
  } catch (err) {
    if (loadMore) {
      loadMore.innerHTML = `<p style="color:var(--error);font-size:12px">${escHtml(friendlyError(err, 'Could not load results — check your TMDB key and connection.'))}</p>`;
      loadMore.style.display = 'block';
    }
  } finally {
    browseState.isLoading = false;
  }
}

// ── Browse View (Movies + Series) ─────────────────────────────

let browseState = {
  type: '',
  section: '',
  page: 1,
  hasMore: false,
  isLoading: false,
  items: [],
  scrollObserver: null,
  viewMode: 'grid', // 'grid' or 'list'
  searchQuery: '',
  reqToken: 0,
};

function renderBrowseView(type) {
  browseState.type = type;
  browseState.searchQuery = '';
  browseState.items = [];
  browseState.page = 1;
  browseState.hasMore = false;
  browseState.isLoading = false;
  browseState.reqToken++;
  disconnectBrowseScroll();

  const tmdbKey = App.keys.tmdbKey;
  if (!tmdbKey) { showToast('TMDB API key required', 'error'); navigateTo('dashboard'); return; }

  hideAllViews();
  const browseView = document.getElementById('browseView');
  browseView.style.display = 'block';

  const sections = type === 'movies' ? [
    { key: 'trending', title: `${icon('flame', 14)} Trending`, endpoint: '/trending/movie/week' },
    { key: 'now_playing', title: `${icon('play', 14)} Now Playing`, endpoint: '/movie/now_playing' },
    { key: 'upcoming', title: `${icon('calendar', 14)} Upcoming`, endpoint: '/movie/upcoming' },
    { key: 'top_rated', title: `${icon('star', 14)} Top Rated`, endpoint: '/movie/top_rated' },
    { key: 'popular', title: `${icon('heart', 14)} Popular`, endpoint: '/movie/popular' },
  ] : [
    { key: 'trending', title: `${icon('flame', 14)} Trending`, endpoint: '/trending/tv/week' },
    { key: 'airing_today', title: `${icon('sun', 14)} Airing Today`, endpoint: '/tv/airing_today' },
    { key: 'on_the_air', title: `${icon('tv', 14)} On The Air`, endpoint: '/tv/on_the_air' },
    { key: 'top_rated', title: `${icon('star', 14)} Top Rated`, endpoint: '/tv/top_rated' },
    { key: 'popular', title: `${icon('heart', 14)} Popular`, endpoint: '/tv/popular' },
  ];

  const viewToggle = `
    <div class="view-toggle">
      <button class="${browseState.viewMode === 'grid' ? 'active' : ''}" onclick="setBrowseViewMode('grid')" title="Grid view">${icon('grid', 14)}</button>
      <button class="${browseState.viewMode === 'list' ? 'active' : ''}" onclick="setBrowseViewMode('list')" title="List view">${icon('list', 14)}</button>
    </div>
  `;

  const tabsHtml = '<div class="browse-tabs">' +
    sections.map((s, i) =>
      `<button class="browse-tab${i === 0 ? ' active' : ''}" data-key="${s.key}" data-endpoint="${s.endpoint}" onclick="switchBrowseTab(this)">${s.title}</button>`
    ).join('') + '</div>';

  browseView.innerHTML = `
    <div class="browse-header">
      <h2>${type === 'movies' ? icon('movie', 18) + ' Movies' : icon('tv', 18) + ' Series'}</h2>
      ${viewToggle}
    </div>
    ${tabsHtml}
    <div class="${browseState.viewMode === 'grid' ? 'browse-grid' : 'list'}" id="browseContent"></div>
    <div id="browseLoadMore" style="text-align:center;padding:1rem;display:none"><div class="spinner"></div></div>
    <button id="backToTop" class="back-to-top" title="Back to top">${icon('back', 14)}</button>
  `;

  addBackBtn(browseView);

  // Show/hide back-to-top on scroll
  const browseEl = document.getElementById('browseView');
  const bttBtn = document.getElementById('backToTop');
  if (browseEl && bttBtn) {
    const scrollTarget = browseEl.closest('#content') || browseEl;
    window.addEventListener('scroll', function _bttScroll() {
      if (!document.getElementById('backToTop')) { window.removeEventListener('scroll', _bttScroll); return; }
      bttBtn.classList.toggle('visible', window.scrollY > 400);
    });
    bttBtn.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  browseState.section = sections[0].key;
  loadBrowseSection(sections[0].endpoint, 1, true);
  updateBottomNav(type === 'movies' ? 'browse-movies' : 'browse-series');
}

function setBrowseViewMode(mode) {
  browseState.viewMode = mode;
  renderBrowseView(browseState.type);
}

function switchBrowseTab(el) {
  document.querySelectorAll('.browse-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  browseState.section = el.dataset.key;
  browseState.page = 1;
  browseState.items = [];
  browseState.hasMore = false;
  browseState.reqToken++;
  disconnectBrowseScroll();
  loadBrowseSection(el.dataset.endpoint, 1, true);
}

async function loadBrowseSection(endpoint, page, replace) {
  if (browseState.isLoading) return;
  browseState.isLoading = true;
  const myToken = browseState.reqToken;
  const content = document.getElementById('browseContent');
  const loadMore = document.getElementById('browseLoadMore');

  if (replace) {
    content.innerHTML = '';
    loadMore.style.display = 'block';
  }

  try {
    const sep = endpoint.includes('?') ? '&' : '?';
    const data = await tmdbGet(endpoint + sep + 'page=' + page);
    if (myToken !== browseState.reqToken) return;
    const items = (data.results || []).filter(i => i.poster_path);

    if (replace) content.innerHTML = '';

    if (browseState.viewMode === 'grid') {
      items.forEach(item => {
        const title = item.title || item.name || '';
        const year = (item.release_date || item.first_air_date || '').split('-')[0];
        const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
        const inLib = isInLibrary(title);
        const inWatch = isInWatchlist(item.id, browseState.type === 'movies' ? 'movie' : 'tv');
        const mt = item.media_type || (browseState.type === 'movies' ? 'movie' : 'tv');
        const card = document.createElement('div');
        card.className = 'card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', 'Open details: ' + title + (year ? ' (' + year + ')' : ''));
        card.onclick = () => openTMDBDetail({ id: item.id, mt, title, year, poster: item.poster_path, backdrop: item.backdrop_path, overview: item.overview || '', rating: item.vote_average || 0 });
        card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.onclick(); } };
        card.innerHTML =
          (inLib ? '<div class="card-badge">In Library</div>' : '') +
          `<img class="card-poster" src="https://image.tmdb.org/t/p/w342${item.poster_path}" alt="${escHtml(title)}" loading="lazy" />` +
          `<div class="card-info"><div class="card-title" title="${escHtml(title)}">${escHtml(title)}</div>` +
          `<div class="card-year">${year}${mt === 'tv' ? ' \u00B7 Series' : ''}</div>` +
          (rating ? `<div class="card-rating">\u2605 ${rating}</div>` : '') +
          '</div>';
        content.appendChild(card);
      });
    } else {
      items.forEach(item => {
        const title = item.title || item.name || '';
        const year = (item.release_date || item.first_air_date || '').split('-')[0];
        const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
        const inLib = isInLibrary(title);
        const mt = item.media_type || (browseState.type === 'movies' ? 'movie' : 'tv');
        const el = document.createElement('div');
        el.className = 'list-item';
        el.style.cursor = 'pointer';
        el.onclick = () => openTMDBDetail({ id: item.id, mt, title, year, poster: item.poster_path, backdrop: item.backdrop_path, overview: item.overview || '', rating: item.vote_average || 0 });
        el.innerHTML = `
          <img src="https://image.tmdb.org/t/p/w92${item.poster_path}" alt="" style="width:40px;height:60px;border-radius:4px;object-fit:cover;flex-shrink:0" loading="lazy" />
          <div class="list-info">
            <div class="list-title">${escHtml(title)}${year ? `<span class="year">(${year})</span>` : ''}</div>
            <div class="list-meta">
              ${rating ? `<span>\u2605 ${rating}</span>` : ''}
              ${inLib ? '<span class="badge badge-completed">In Library</span>' : ''}
            </div>
          </div>
        `;
        content.appendChild(el);
      });
    }

    browseState.page = page;
    browseState.hasMore = page < (data.total_pages || 1);
    const existingIds = new Set(browseState.items.map(i => i.id));
    const newItems = items.filter(i => !existingIds.has(i.id));
    browseState.items = browseState.items.concat(newItems);
    loadMore.style.display = 'none';

    if (browseState.hasMore) connectBrowseScroll(endpoint);
  } catch (err) {
    loadMore.innerHTML = `<p style="color:var(--error);font-size:12px">${escHtml(friendlyError(err, 'Could not load content — check your TMDB key and connection.'))}</p>`;
    loadMore.style.display = 'block';
  } finally {
    browseState.isLoading = false;
  }
}

function connectBrowseScroll(endpoint) {
  disconnectBrowseScroll();
  const sentinel = document.getElementById('browseLoadMore');
  if (!sentinel) return;
  sentinel.style.display = 'block';
  sentinel.innerHTML = '<div class="spinner"></div>';
  browseState.scrollObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && browseState.hasMore && !browseState.isLoading) {
      if (browseState.searchQuery) {
        loadSearchPage(browseState.searchQuery, browseState.page + 1, false);
      } else if (endpoint) {
        loadBrowseSection(endpoint, browseState.page + 1, false);
      }
    }
  }, { rootMargin: '300px' });
  browseState.scrollObserver.observe(sentinel);
}

function disconnectBrowseScroll() {
  if (browseState.scrollObserver) { browseState.scrollObserver.disconnect(); browseState.scrollObserver = null; }
}
