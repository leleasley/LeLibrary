// ── Watchlist View ────────────────────────────────────────────

function renderWatchlistView() {
  hideAllViews();
  const watchlistView = document.getElementById('watchlistView');
  watchlistView.style.display = 'block';

  const watchlist = getWatchlist();

  watchlistView.innerHTML = `
    <div class="browse-header"><h2>&#11088; Watchlist</h2><span class="count">${watchlist.length} saved</span></div>
    <div id="watchlistContent"></div>
  `;

  addBackBtn(watchlistView);

  const container = document.getElementById('watchlistContent');

  if (watchlist.length === 0) {
    container.innerHTML = `
      <div class="watchlist-empty">
        <div class="icon">&#11088;</div>
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
    el.onclick = () => openTMDBDetail({
      id: item.tmdbId, mt: item.type, title: item.title,
      poster: item.posterPath, backdrop: item.backdropPath || '',
      overview: '', rating: 0, year: ''
    });
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
      <button class="btn-delete" style="opacity:1" onclick="event.stopPropagation();removeFromWatchlist(${item.tmdbId},'${item.type}');renderWatchlistView()" title="Remove">&#128465;&#65039;</button>
    `;
    container.appendChild(el);
  });

  updateBottomNav('watchlist');
}
