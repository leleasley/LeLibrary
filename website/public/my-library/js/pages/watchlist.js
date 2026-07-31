// ── Watchlist View ────────────────────────────────────────────

function renderWatchlistView() {
  hideAllViews();
  const watchlistView = document.getElementById('watchlistView');
  watchlistView.style.display = 'block';

  const watchlist = getWatchlist();

  watchlistView.innerHTML = `
    <div class="browse-header"><h2>${icon('star', 18)} Watchlist</h2><span class="count">${watchlist.length} saved</span></div>
    <div class="watchlist-disclaimer">${icon('alert', 14)} Watchlist items are stored only in this browser. If you clear your browser data or use a different device, your saved items will not appear.</div>
    <div id="watchlistContent"></div>
  `;

  addBackBtn(watchlistView);

  const container = document.getElementById('watchlistContent');

  if (watchlist.length === 0) {
    container.innerHTML = `
      <div class="watchlist-empty">
        <div class="icon">${icon('star', 32)}</div>
        <h3>Your watchlist is empty</h3>
        <p>Save movies and series from the browse pages to watch later.</p>
        <button class="btn btn-primary" style="margin-top:16px" onclick="navigateTo('browse-movies')">Browse Movies</button>
      </div>
    `;
    updateBottomNav('watchlist');
    return;
  }

  watchlist.forEach(item => {
    const poster = item.posterPath ? `https://image.tmdb.org/t/p/w185${item.posterPath}` : '';
    const typeLabel = item.type === 'tv' ? 'Series' : 'Movie';
    const el = document.createElement('div');
    el.className = 'list-item';
    el.style.cursor = 'pointer';
    el.onclick = () => openWatchlistItem(item);
    el.innerHTML = `
      ${poster ? `<img src="${poster}" alt="" style="width:40px;height:60px;border-radius:4px;object-fit:cover;flex-shrink:0" loading="lazy" />` : ''}
      <div class="list-info">
        <div class="list-title">${escHtml(item.title)}</div>
        <div class="list-meta">
          <span class="badge badge-torrent">${typeLabel}</span>
          <span class="sep">&middot;</span>
          <span>Added ${timeAgo(item.addedAt)}</span>
        </div>
      </div>
      <button class="btn-delete" style="opacity:1" onclick="event.stopPropagation();removeFromWatchlist(${item.tmdbId},'${item.type}');renderWatchlistView()" title="Remove">${icon('trash', 14)}</button>
    `;
    container.appendChild(el);
  });

  updateBottomNav('watchlist');
}

async function openWatchlistItem(item) {
  // If we already have overview/rating, open directly
  if (item.overview || item.rating) {
    openTMDBDetail({
      id: item.tmdbId, mt: item.type, title: item.title,
      poster: item.posterPath, backdrop: item.backdropPath || '',
      overview: item.overview || '', rating: item.rating || 0,
      year: item.year || ''
    });
    return;
  }
  // Fetch full TMDB data
  try {
    const endpoint = item.type === 'tv' ? '/tv/' + item.tmdbId : '/movie/' + item.tmdbId;
    const data = await tmdbGet(endpoint);
    openTMDBDetail({
      id: item.tmdbId, mt: item.type,
      title: data.title || data.name || item.title,
      poster: data.poster_path || item.posterPath || '',
      backdrop: data.backdrop_path || item.backdropPath || '',
      overview: data.overview || '',
      rating: data.vote_average || 0,
      year: (data.release_date || data.first_air_date || '').split('-')[0]
    });
  } catch (e) {
    // Fallback with what we have
    openTMDBDetail({
      id: item.tmdbId, mt: item.type, title: item.title,
      poster: item.posterPath, backdrop: item.backdropPath || '',
      overview: '', rating: 0, year: ''
    });
  }
}
