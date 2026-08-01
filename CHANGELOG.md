# Changelog

## [3.1.0]

### Your privacy & safety

- **Your API keys are never shown in URLs or server logs anymore** — previously a small fragment could end up in your browser history and our logs
- **Fixed a security hole on the configure page**: a specially crafted install link could run code on that page — it's now safely neutralised
- **Clearing your cache is locked down**: it can only clear your own data, needs to be triggered deliberately, and can't be fired off by a random webpage

### Clearer errors, fewer surprises

- **You'll know if you used the wrong TMDB key**: paste a TMDB v4 "Read Access Token" (these expire and don't work) and you'll be told straight away — as you type it, when you log in, and again if TMDB still rejects it. You want the v3 API key, and it tells you exactly how to get it
- **Plain-English messages everywhere**: wrong TorBox/Real-Debrid/TMDB keys, rate limits and provider outages now explain what's wrong instead of showing a number or a blank screen
- **A bad key can no longer hide behind a loading spinner** or masquerade as an empty library or an empty download queue
- **Torrent search tells you when the search sources are down** instead of just saying "no torrents found"

### Fixes & improvements

- **Snappier key checks and catalog loading**: the app now reuses its connections to TorBox, Real-Debrid and TMDB instead of reconnecting for every call — so key verification responds quicker and big libraries build without the extra connection overhead
- **Movie pages now show your chosen artwork and ratings** (ERDB / RPDB / Fanart.tv / OMDB) — previously this only worked for series
- **Renaming a download on Real-Debrid now shows up in your catalog** right away
- **Fixed a crash** that a malformed request could trigger on the addon
- **Selecting, marking as watched and deleting is more reliable** when torrents, usenet and Real-Debrid items happen to share the same number
- **Logout really logs out** now, and there's a new "Use different keys" option to switch accounts
- **"Clear all data" clears everything** — no leftover cached items from a previous account
- **The dashboard stays up to date** after refreshing instead of showing stale counts
- **The detail page can't trap you anymore**: missing artwork no longer hides the Back and Save buttons
- **Shared links work even with an empty library**: opening a saved movie/series link no longer silently drops you to the dashboard
- **Fast re-searches don't show stale results** anymore
- **The download queue shows everything**, including items in uncommon states (queued, waiting for file selection…)
- **The HTTP "watch folder" hint is now honest**: the TorBox/Real-Debrid add APIs only accept magnets, and the page says so instead of silently failing
- **Adding a `.torrent` file to Real-Debrid no longer claims success** — RD needs a magnet link, and it tells you
- **Empty library messages name the right provider**, and the profile page safely escapes account data

### Configure page

- **Reset now resets everything** (poster service, custom streams, catalog names, hide-anime…) instead of leaving old settings in your install link
- **Copy buttons work without HTTPS** (local/LAN installs) and give feedback either way
- **Pressing Enter no longer silently regenerates your install links** while you're typing in the custom-stream fields
- **Typing in the custom-stream fields marks the form as "unsaved"** like every other field

## [3.0.3]

### Website / Configure

- **Your keys are checked before you get install links**: click "Generate" and it validates your TorBox, Real-Debrid and TMDB keys, flashes "Keys validated ✓", and flags any field that's wrong — no more installing a broken key and wondering why nothing works

## [3.0.2]

### Addon / Core

- **The right seasons & episodes for you**: your downloads are tracked separately per user, so you never see someone else's seasons or the wrong episode list
- **Streams match what you clicked**: an episode that isn't in a download no longer plays a random file from it
- **"Hide anime" really hides anime now** — it's removed from the Movies and Series rows too, not just the anime row
- **A broken provider key no longer empties your library**: if one service's key is expired, the other service's content still shows
- **You're warned about TMDB v4 tokens** (they expire and silently break things) and pointed to the v3 API key
- **Keys are verified before you install**, with a check button on each field
- **Separate-catalog mode no longer creates duplicate rows** when you give catalogs custom names

## [3.0.1]

### Addon / Core

- **Your poster ratings actually show up now**: the poster service you chose applies to your catalog and takes effect immediately instead of showing old images
- **Episode titles make sense**: clear "Episode X" numbering alongside the real title
- **Full library on first open**: no more home rows with a single lonely item
- **Accurate streams**: episodes you don't have no longer return the wrong files
- **More date formats recognised**: shows with European dates (day.month.year) in the filename match the right episode

## [3.0.0]

### Addon / Core

- **Much faster library loading**: results appear near-instantly, and the library builds in the background while you browse
- **Smarter refresh**: renames and edits to your downloads show up immediately
- **Cleaner stream list**: sample files, trailers and behind-the-scenes clips are filtered out
- **Better subtitle matching**: subtitles line up with the right files more reliably
- **Date-based episodes**: shows with dates in the filename now match the right series and episode
- **More accurate titles**, including shows that have been renamed on TMDB
- **More resilient caching**: your catalog stays fast and consistent even during brief API hiccups

### Website / My Library

- **Download manager**: add magnets or links straight to TorBox or Real-Debrid
- **Add torrents**: drag-and-drop `.torrent` files or paste magnets, with progress
- **Library sorting & filtering**: by name, size, year and more
- **Mark as watched**: keep track with badges
- **Queue fixes**: finished downloads no longer show as still downloading, full history visible
- **Redesigned detail page**: full-width backdrop, season selector and built-in torrent search
- **Auto torrent search**: results load when you open a movie or series, sorted by quality (4K → 1080p → 720p → seeders)
- **Cached-first toggle**: put instantly-playable results at the top
- **Language filters**: Dual / Subs / English
- **Recommendations**: "More like this" on every title
- **Shareable links**: get a direct URL to refresh or share
- **Bigger libraries supported**: 1000+ items without timeouts
- **Keyboard shortcuts**: press 1–9 to jump straight to any section; press ? to see them all
- **Working global search**: Enter in the search bar returns real TMDB results
- Plus a cleaner dashboard, one consistent icon set, IMDB badges, genre badges, back-to-top, mobile-friendly layouts and screen-reader labels

## [2.2.2]

- **Still see your library during outages**: if an API is briefly down, you get your last catalog instead of a blank screen
- **No more blank screens while rebuilding**: your catalog no longer clears itself before the new one is ready
- **Errors no longer hide**, so an empty result is never silently served as if everything were fine
- **Fewer unnecessary refreshes**: background and foreground checks now agree, so you're not constantly rebuilding
- **Streams work right after a restart**: the library index is rebuilt from cache, fixing "shows in catalog but no streams"
- **Refreshing your catalog also refreshes your streams**, not just posters
- **Large libraries stay fast**: TMDB calls are batched so big collections don't hit rate limits
- **More reliable streaming**: longer timeouts for downloads, files and stream links

## [2.2.0]

- **Poster & ratings enhancement**: ERDB, RPDB, Fanart.tv and OMDB options
- **Custom streams**: add your own stream URLs
- **Collapsible config sections** (Poster, Catalog Display, Custom Streams)
- **Catalog display options**: rename catalogs, hide anime
- **Unsaved-changes indicator** and a Save button for existing users
- **Reinstall modal** when you save config changes
- **Verify buttons** for every API key
- **Stream preview** with selectable presets
- **Emoji support** in catalog names
- **Page titles** updated to "Page | LeLibrary"

## [2.1.1]

- The version number now shows in the top bar of the configure page

## [2.1.0]

- **Poster & ratings enhancement** (ERDB, RPDB, Fanart.tv, OMDB)
- **Custom stream injection**
- **Smart duplicate detection**: find, highlight and batch-delete duplicates
- **Verify buttons** for API keys on the configure page
- **Collapsible config sections**
- **Redesigned desktop dashboard** with a card grid
- **Cache-busting** for CDN/Cloudflare
- **TMDB search autocomplete** with posters
- **Version check banner** for self-hosters
- Removed private website files from the public repo

## [2.0.0] — Multi-provider support

- **TorBox + Real-Debrid** — use one, the other, or both
- **Merge or separate catalog modes**
- **Pick your provider** in the config
- **One addon** that works with both services
- **Nuvio compatible**
- **Revamped My Library**: virtual scroll, watchlist and queue

## [1.0.0] — Initial release

- TorBox-only addon
- Basic catalog, meta and stream endpoints
- TMDB metadata integration
- Filename parsing
- Simple configure page
