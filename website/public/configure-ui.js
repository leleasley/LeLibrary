/* Nuvio-first configure workspace presentation layer. */
(function () {
  'use strict';

  function state() {
    return window.LeConfigureState ? window.LeConfigureState.snapshot() : null;
  }

  function setExperienceClass(platform) {
    document.body.classList.toggle('experience-nuvio', platform !== 'stremio');
    document.body.classList.toggle('experience-stremio', platform === 'stremio');

    document.querySelectorAll('.nuvio-only').forEach((element) => {
      element.hidden = platform === 'stremio';
    });

    const hint = document.getElementById('platformHint');
    if (hint && platform === 'nuvio') {
      hint.textContent = 'Nuvio adds native Collections, artwork, focus GIFs and profile-specific synchronisation.';
    } else if (hint && platform === 'stremio') {
      hint.textContent = 'Stremio uses the content builder as Home rows. Nuvio-only collection controls are hidden.';
    }
  }

  function sourcePill(label, value, className) {
    const escape = (input) => String(input ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    return `<span class="review-pill ${className || ''}"><strong>${escape(label)}</strong><span>${escape(value)}</span></span>`;
  }

  function renderReview() {
    const target = document.getElementById('reviewSummary');
    const current = state();
    if (!target || !current) return;
    const platform = current.setup.platform === 'nuvio' ? 'Nuvio' : current.setup.platform === 'stremio' ? 'Stremio' : 'Choose a platform';
    const builtIns = current.content.builtInSources;
    const library = [
      builtIns.movies && 'My Movies',
      builtIns.shows && 'My Shows',
      builtIns.collections && 'LeLibrary Collections',
      builtIns.anime && 'Anime',
    ].filter(Boolean);
    const discovery = current.content.discoveryRows.length
      ? current.content.discoveryRows.join(', ')
      : 'None selected';
    const profile = current.nuvio.profile ? `Profile ${current.nuvio.profile}` : 'Profile selected during connection';

    target.innerHTML = `
      <div class="review-summary-head">
        <div><span class="section-kicker">REVIEW &amp; SYNC</span><h3>Your LeLibrary experience</h3><p>Review the layers you are sending to ${platform}. Library sources, discovery rows and Nuvio Collections stay separate.</p></div>
        <span class="review-platform ${current.setup.platform || ''}">${platform}</span>
      </div>
      <div class="review-pill-grid">
        ${sourcePill('Library', library.join(' · ') || 'None selected', 'review-owned')}
        ${sourcePill('Discovery', discovery, 'review-discovery')}
        ${sourcePill('Home layout', current.content.homeRows, 'review-home')}
        ${sourcePill('Collections', current.nuvio.collectionPacks, current.setup.platform === 'stremio' ? 'review-muted' : 'review-nuvio')}
        ${sourcePill('Imported content', current.content.importedRows, 'review-import')}
        ${sourcePill('Nuvio target', current.setup.platform === 'nuvio' ? profile : 'Not applicable', 'review-target')}
      </div>`;
  }

  function refresh() {
    const current = state();
    setExperienceClass(current?.setup.platform || null);
    renderReview();
  }

  document.addEventListener('DOMContentLoaded', () => {
    refresh();
    document.addEventListener('input', refresh);
    document.addEventListener('change', refresh);
    document.addEventListener('click', () => setTimeout(refresh, 0));
  });
})();
