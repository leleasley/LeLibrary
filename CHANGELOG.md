# Changelog

## [3.0.0]

### Addon / Core

- **Faster library loading**: results load near-instantly and your library builds progressively, so you see content right away
- **Smarter refresh**: renames and edits to your downloads now show up immediately
- **Cleaner streams**: sample files, trailers and behind-the-scenes clips no longer clutter your stream list
- **Better subtitle matching**: subtitles now line up with your streams more accurately
- **Date-based episodes**: shows with dates in the filename are now matched to the right series and episode
- **More accurate titles**: improved matching, including shows that have been renamed on TMDB
- **More reliable caching**: your catalogue stays fast and consistent, even during brief API issues

### Website / My Library

- **Download manager**: add magnets or links straight to TorBox or Real-Debrid from the web
- **Add torrents**: drag-and-drop `.torrent` files or paste magnet links, with progress tracking
- **Library improvements**: sort and filter your library by name, size, year and more
- **Mark as watched**: keep track of what you've watched with badges
- **Queue fixes**: completed downloads no longer show as still downloading, and the full history is visible
- **Cleaner icons**: one consistent, modern icon set across the whole app
- **Reliable connections**: fixed TorBox and Real-Debrid proxy and deletion issues
- **Redesigned detail page**: full-width backdrop, season selector and built-in torrent search
- **Auto torrent search**: results load automatically when you open a movie or series
- **Smarter search**: queries use the title, year and season for more relevant results
- **Quality-first sorting**: results sorted by quality (4K, 1080p, 720p…) then seeders
- **Copy confirmation**: clear feedback when you copy a magnet link
- **IMDB integration**: a badge links straight to the IMDB page
- **Shareable links**: open a movie or series and get a direct URL to refresh or share
- **Back to top**: quick-scroll button on browse pages
- **Better watchlist**: saved items now load full details when opened
- **Faster cached detection**: instantly-playable torrents are flagged correctly
- **Large library support**: handles libraries of 1000+ items without timing out
- **Custom torrent search**: tweak the search term on the detail page (e.g. "4K BluRay")
- **Cached-first toggle**: one click to put instantly-playable results at the top
- **Language filters**: filter results by Dual / Subs / English
- **Recommendations**: "More like this" grid on every movie and series
- **Genre badges**: see genres at a glance on the detail page
- **Responsive layout**: the detail page now stacks nicely on mobile
- **Redesigned dashboard**: a clean, simple grid of quick actions
- **Polished navigation**: tidier topbar and reliable back-to-dashboard
- **Fixed torrent buttons**: download/add buttons work with any link
- **Accessibility**: keyboard navigation and screen-reader labels throughout
- **Keyboard shortcuts**: press 1–9 to jump straight to any section
- **Working global search**: hit Enter in the search bar for real TMDB results

## [2.2.2]

- Stale cache fallback during API outages (serve previous catalog instead of empty)
- Cache invalidation order fixed: only clear after successful rebuild, not before
- API errors now throw properly (previously swallowed, causing empty catalog poisoning)
- Foreground/background hash computation aligned (previously mismatched, triggering unnecessary rebuilds)
- `tmdbindex` auto-populated from cached catalogs (fixes "catalog shows movie but no streams" after restart)
- Stream caches invalidated alongside meta caches on catalog rebuild
- TMDB API calls batched (limit 6 concurrent) to avoid rate-limiting on large libraries
- TorBox timeout increased 20s → 45s for downloads, 10s → 30s for files/stream links

## [2.2.0]

- Poster/ratings enhancement section (ERDB, RPDB, Fanart.tv, OMDB)
- Custom streams (add your own stream URLs)
- Collapsible config sections (Poster, Catalog Display, Custom Streams)
- Catalog display customization (rename catalogs, hide anime)
- Unsaved changes indicator + Save button for existing token users
- Reinstall modal on config save
- Verify buttons for API keys
- Stream preview with selectable presets
- Emoji support in catalog names
- Page titles updated to "Page | LeLibrary" format

## [2.1.1]

- Version display moved to topbar on configure page
- Version badge now driven dynamically from JS constant

## [2.1.0]

- Poster/ratings enhancement (ERDB, RPDB, Fanart.tv, OMDB)
- Custom stream injection
- Smart duplicate detection (find, highlight, batch-delete)
- Verify buttons for API keys in configure page
- Collapsible config sections
- Desktop dashboard redesign with card grid layout
- Cache-busting query params for CDN/Cloudflare
- TMDB search autocomplete dropdown with posters
- Version check banner for self-hosters
- Removed private website files from public repo

## [2.0.0] — Multi-provider support

- TorBox + Real-Debrid support (single or both)
- Merge or separate catalog modes
- Provider selection in config token
- Unified addon for both services
- Nuvio compatibility
- Revamped my-library page with virtual scroll, watchlist, queue

## [1.0.0] — Initial release

- TorBox-only addon
- Basic catalog, meta, stream endpoints
- TMDB metadata integration
- Filename parsing
- Simple configure page
