# Changelog

## [Unreleased]

### Library

- Box sets of films are now split into their films (a box set of TV seasons stays one show). A folder like a complete Fast and Furious, Critters or Mission: Impossible collection used to fail as one item; now every film inside shows up in your movies on its own and plays its own file. Nothing in your debrid account is moved or copied.
- Films are matched against the franchise's TMDB collection first, then one by one. A film LeLibrary cannot match with confidence is left for you to fix, without holding up the rest of the box set.
- Miniseries split into parts inside a box set (for example Hogfather or Going Postal) show up in your shows, one episode per part.
- UK and US spellings of a title (Colour and Color) are treated as the same when matching box sets.
- A screen size in a file name (for example 1920x816) is no longer mistaken for the release year, so those files match the right film. Files that failed to match for this reason are tried again automatically.
- Smarter matching for release names that used to go wrong: names with "+" instead of spaces, Russian releases that list dubs, voice-overs and subtitles ("Dub + 2x VO + Sub"), titles with commas or exclamation marks, titles that are a number (1984 now finds Nineteen Eighty-Four) and short titles TMDB lists under another name. Several films that were matched to the wrong title (for example Tower Heist, Get Shorty, Flight of the Navigator and the 9-1-1 seasons) are now found correctly.
- After this update every library re-checks its existing matches once in the background, so old wrong matches get corrected. A title that is already matched never disappears because of the re-check: if nothing better is found, it keeps its current match.
- If your TMDB key is missing or TMDB stops accepting it, matching now pauses and your Library page tells you, instead of reporting TMDB as unavailable and giving up on those files. Once the key works again, the paused files are matched straight away.

### Self-hosted

- Your own WebDAV server as a library: a NAS, rclone, Nextcloud or Synology share can be added in setup next to (or instead of) a debrid service. Its videos are matched and shown in My Movies and My Shows, and play with seeking through your LeLibrary server. Self-hosted only, off unless WEBDAV_SOURCE=on is set; see SETUP.md.

### Faster

- Your own copies now appear straight away when you open a title. LeLibrary only asks your debrid service for the playback link when you press play, and the video still streams directly from your debrid service. This also stops opening titles from using up your debrid service's link limits.

### Fixes

- The LeLibrary Movie Collection and other collections pushed to Nuvio now use a poster shape Nuvio accepts. Nuvio TV rejected the old value, which could stop the collection from working and turn posters landscape after pinning it. Push to Nuvio again to update an existing collection. Hotfixed on lelibrary.uk.
- Public Nuvio collections imported in Move In keep their poster shape instead of turning landscape.
- Switching the stream display style from Custom back to LeLibrary (or any other style) now takes effect. The old custom style used to stay in place until the setup was deleted. Hotfixed on lelibrary.uk.

## [5.5.3]

### Faster

- Large libraries are now stored compressed in the cache, about ten times smaller. One big library refreshing no longer slows everyone else down, and the cache uses far less memory. Nothing to do after updating.

### Streams

- A stream source the server cannot reach can be switched off for the whole instance. It shows as unavailable in setup with a short note, and setups skip it quietly instead of showing an error. On lelibrary.uk this applies to Torrentio, which currently blocks the hosted server. Self-hosters are not affected unless they turn it on (STREAM_ADDONS_UNAVAILABLE in .env).

### Project

- Dependency updates for the server and website are now checked automatically every week.

## [5.5.2]

### Fixes

- Your own cloud copy shows up again when you open a title from another addon or from your Stremio or Nuvio library, not only when you open it from LeLibrary.
- Importing an old setup with your email no longer stops with a "JWT expired" error. An old Nuvio sign-in is renewed automatically, and if that is not possible you are asked to connect Nuvio again.
- Browse public Nuvio collections works again in Move In, including when you edit a saved setup.
- The status page no longer shows the cache as unavailable for a moment while large libraries are being saved.
- The status page shows Torrentio as "not checked" when it blocks our server, instead of reporting an outage.

## [5.5.1]

### Fixes

- The status page no longer reports the library engine as failed and the database as not configured while the library is busy syncing, for example just after an update.

### Project

- LeLibrary is now licensed under AGPL-3.0. Releases up to and including 5.5.0 stay available under MIT.
- The build and release automation uses the current versions of its GitHub Actions.

## [5.5.0]

### No more accounts: a setup is a link you keep

- The account system is gone. There is no sign up and no account page.
- Every setup gets its own install link that carries everything Stremio or Nuvio needs. Add it to your player and you are done.
- A password is optional and only protects editing. It never gets in the way of installing or watching.
- Saved keys are sealed on the server, so a copy of the database on its own cannot read them.
- Old account links still go somewhere sensible: an old setup opens for import, anything else opens the setup page.

### Three ways to set up

- Pick how much you want to do. Quick Look gets you a working addon in four short steps. Settle In adds Home rows, playback filters and stream formatting. Move In is the full editor, with collection folders and sending everything straight to Nuvio.
- The Configure page compares the three side by side, with a preview of each and an "Already have a setup?" section for opening or pasting an existing one.
- Each level has a short walkthrough video, recorded from the real pages.
- At the end you get one-click "Open in Stremio" and "Copy for Nuvio" buttons, quick copies for STRMR, Fusion, Vidi and WuPlay, a summary of your setup, and your setup id and edit link (shown once, so keep them).

### Editing and backups

- Open your setup's link, enter the password, and the same page you built it on opens with everything filled in. Only what you change is saved.
- Move a setup to another level, for example from Quick Look up to Move In, without reinstalling: the link stays the same.
- Download a setup's settings as a backup and start a new setup from that file, for example for someone else in your home. Keys, passwords and player logins are never included.

### Bring an old setup across

- Settle In and Move In can import a setup from the old account system: enter your old email, pick the setup, and your keys, player login, settings and Home rows land on the page. Move In also brings your collections; Settle In says clearly when it cannot.
- The card shows what comes across before you start, and exactly what was found afterwards.
- Once your new setup is created, the old one is removed. Your old account and email address are deleted when nothing is left on it.

### More control in every setup

- Rename My Movies, My Series and LeLibrary Anime. In Quick Look your row names show right under your keys with a Rename button, and you can hide a row or reset to the defaults.
- Hide anime now removes anime everywhere it can be spotted: My Movies, My Series, Trending, Popular and your genre, studio and streaming-service rows. A title counts as anime when TMDB lists it as Japanese animation, such as Your Name. or One Piece.
- Quick Look lets you choose the metadata language, and its library options show your current choices at a glance.
- Add up to three of your own Stremio stream addons in Settle In and Move In, such as StreamNZB or your own AIOStreams. The link is stored sealed like your keys, and the hosted site only reaches public HTTPS addons.

### Nuvio

- Settle In and Move In can set Nuvio's stream auto-play (manual, first source or a regex match) and auto-play next episode when you push.
- They can also hide or show unreleased titles in Nuvio, or leave your Nuvio setting alone.
- Rows you did not pick for Home no longer appear on Nuvio Mobile and Desktop or fill their Hero. Open Nuvio again or push once after updating.
- Pushing turns on Nuvio's own TMDB enrichment for the chosen profile, so Home rows and collections show richer details.
- New artwork for the Movies and Shows folders in the LeLibrary collection, with matching animations when a folder is highlighted. Push again to get it.
- LeLibrary Movie Collections now sits at the bottom of the Nuvio collection list instead of being pinned to the top of Home.

### Redesigned setup pages

- A calmer look that works properly on phones, with a progress bar that ticks off each step and a small dock for the preview and Continue button on phones.
- Provider cards light up in each provider's colour, posters have a live preview, Nuvio badge packs show real previews, and there are more stream styles to choose from.
- The password step explains that a password protects editing only, shows its strength and confirms when both entries match.
- Collections and Home rows are easier to manage: collapsible shelves, full-width rows with Movies and Series tags, your Home order kept in view, and an "Add folder" tile in every collection.
- Cancelling a new folder really cancels it, and folders without artwork show a clean placeholder.
- Pop-up messages are clearer and can be closed or, on phones, swiped away. On phones they sit at the top, clear of the keyboard.
- An "Unsaved changes" marker shows while you have anything not yet saved, and a refresh restores your progress until you create.

### Poster Studio, rebuilt for Pictorium 1.25.9

- The Poster Studio has been rebuilt from scratch and is much simpler: a big live preview (switch between a film and a series), six one-click looks to start from, and clear sections for badges, rankings, ratings, background and logos. Fine-tuning sizes and positions is tucked away until you want it, and you can see how many things you have changed and reset in one click.
- Every Pictorium poster option now has a control. New ones include age rating badges (using your own country, not Pictorium's Italian default), Halloween and Christmas frames, new layouts, new ranking styles (Netflix colour, corner, number, outlined and glass), a minimal badge style, Dolby Vision, HDR, Atmos and IMAX marks, separate ratings in the order you choose, top badges in your own priority order, top shade height and light or dark text.
- More languages and regions, including Latin American Spanish, Brazilian Portuguese and a worldwide region.
- Fixed settings that Pictorium had changed or removed, so every choice in the studio now shows up on your posters.
- Posters you have not touched render exactly as before.

### Faster, more complete library

- Large TorBox libraries sync much faster, and large Real-Debrid libraries are no longer cut off after the first pages.
- My Movies and My Shows open almost instantly from the local index, and stay fast while the background sync runs.
- New files are picked up when you open your library, without waiting for the next scheduled check.
- A TorBox torrent and a Usenet or web download that shared the same number could hide each other. Both now show up.

### Better matching

- Fewer wrong or missing titles, and anything uncertain stays unmatched rather than guessed. Improvements include:
  - Weekly shows named by date (such as WWE Raw) and regional versions (MasterChef vs MasterChef Australia) land on the right show.
  - Season packs named like "S1.S9" or "S01 S02 S03" show every season, not just the first.
  - Hash-only torrents and oddly named packs are matched from the files inside them.
  - Edition labels, alternate titles (AKA), "and" vs "&", very short titles like X or K-9, small spelling slips and website prefixes are all handled.
  - Releases named in two languages no longer match a completely different title.
- Your library is rechecked in the background, so matches improve without you doing anything.

### Streams

- KNABEN is a new optional stream source. It never receives your debrid key, and nothing is added to your debrid account just by opening a title.
- Meteor includes Usenet results when your TorBox plan is Pro.
- TorBox playback links are refreshed every five minutes, so expired links fail far less often.

### Website

- A new home page about what LeLibrary is for, with a one-minute video tour, real examples from Stremio and Nuvio, and what is out this week. It appears straight away, even on slow connections.
- A new Releases page: digital film releases by date, a TV guide for any day with premiere and finale badges, search, and a page for every title with its release dates and episodes. Hosted only.
- The status page shows LeLibrary itself, debrid providers and stream sources at a glance.
- The About page is now Supporters, thanking the artists, projects and services behind LeLibrary by name.
- The privacy policy, guide and error pages have been redesigned, and the guide has a contents list and better troubleshooting.
- English and Spanish throughout, following your browser's language.
- Pages show placeholders while they load instead of a line of text, and a page left open during an update reloads itself instead of showing an error.
- Better on phones, with nothing running off the screen edge, and better for keyboards and screen readers.

### Self-hosting

- The self-hosting guide has a complete, commented Docker Compose file you can copy as it is, plus what each container does and how to add HTTPS.
- New optional hardening step: run LeLibrary's database as a normal login instead of the Postgres superuser. One included script sets it up safely.

### Fixes

- Changed poster settings now refresh your movie, series and anime rows properly.
- Logos, icons and videos refresh after an update instead of staying cached for up to a month.
- The menu and the service status no longer pop in a moment after a page loads. Releases and the status count are there from the first paint, and the home page no longer redraws itself while it loads.

## [5.2.0]

### A much faster library

- LeLibrary now keeps a local index of your Debrid library and refreshes it in the background, so My Movies, My Shows and My Anime open without waiting on your provider or on a fresh round of metadata lookups. This is now the core of how LeLibrary works and it is on by default.
- The included Docker setup now runs a small Postgres service to hold that index, so self-hosters get the faster library automatically with no extra setup. Running without a database is still fine: LeLibrary keeps its previous behaviour, and the index can be turned off if you prefer.
- Catalogs, search and detail pages are served from the local index. Warm requests are near instant, and opening the addon no longer triggers a full library scan.
- Searching your own library uses the index, results are remembered, and repeat searches are instant.
- The library survives restarts, so a redeploy does not rebuild everything from scratch, and a routine refresh only touches titles that actually changed.
- On a brand new setup the first request uses the previous path until the first build finishes, so your library is never briefly empty.
- Setup health and a per install sync status let you check the library engine without touching any keys.

### Smarter matching, TV and anime

- Titles are now matched across several metadata sources instead of TMDB alone. TV series pick up TheTVDB identities, and anime resolves through Kitsu, AniList and MyAnimeList, including alternate, romaji and native titles.
- Anime is identified from real signals rather than a filename keyword, and a show confirmed as anime now appears in the anime catalogue automatically.
- Releases that use a show's shorthand or a renamed scene title now find the right series instead of being dropped or mixed up. This covers weekly shows such as Raw and SmackDown, plus renamed shows like CSI Las Vegas.
- Movies and shows released under a different name now match the right title too, because matching also checks each candidate's known alternative titles.
- Weekly, date named shows such as WWE Raw now show only the episodes you actually own, and each episode lists its own correct file, instead of showing the whole series or mixing files between episodes.
- When sources disagree on episode numbers, LeLibrary can match the episode by its title, so the right episode plays instead of showing no sources or the wrong one.
- Fixed episodes you do not own showing a different episode's file. Opening a missing episode now correctly reports no streams instead of playing episode one or two from another season.
- Fixed a number of series that showed no sources because of differing season and episode numbering between sources.
- The scene-title dataset refreshes itself daily, so this replaces a growing pile of one-off fixes. Operators can add their own aliases with a simple list.

### Optional TheTVDB key

- You can now save a TheTVDB API key in Settings on both the normal and account Configure pages. It is completely optional: without it everything still works using the existing metadata.
- TheTVDB adds extra series matching and episode data in the background, and when a key is saved, episode details and alternate titles are stored locally so episode pages open without a live lookup. A "Get key" link is included, the key can be verified in the page, and TVDB has its own logo next to the other services.

### Speed across LeLibrary

- The two-minute refresh now updates title matches in batches and only touches titles that changed, so large libraries cost far less time and CPU per cycle.
- Cached results are kept in memory for as long as they are valid, searches resolve their ids in one pass, and repeated searches are served instantly and stay warm across restarts.
- A local cross-provider id map is loaded in the background, so converting between IMDb and TMDB ids is instant instead of an API call. It is saved to disk so restarts are immediate, and any title missing from it still falls back to TMDB as before.
- Streams reuse the file list already held for your library instead of asking the provider again for every copy, link resolution no longer fires everything at once, and large Real-Debrid libraries scan their remaining pages in parallel.
- Collections build in parallel and share their TMDB data, so several requests never rebuild the same collection at once.
- Pictorium posters are generated and cached ahead of time in a lighter size, so grids fill in quickly. If one is not ready your normal TMDB poster shows instantly and the Pictorium version takes over, and choosing ERDB works the same way.
- Fixed Trending and Popular rows ignoring your chosen poster provider: they now respect Pictorium instead of always using another service.
- Search now retries once and shares duplicate requests, so a slow metadata moment no longer leaves the Movies and Series sections empty in Nuvio.
- The Configure page's collections and catalogue lists are built once and kept in memory, and text responses are compressed so self-hosted and direct connections move far less data.
- Startup no longer blocks while reading the saved match cache, simultaneous lookups for the same new title share one request, long-running memory use is capped, and a restart now finishes in-flight requests and saves pending results instead of dropping them.

### Streams

- The default LeLibrary stream format now includes the file name along with source, codec, audio, languages and size, in a cleaner layout, for both your own files and external streams.
- Stream notices can now be turned on or off individually: No streams found, Provider rate limit and Digital release not found. You can keep the helpful ones and hide the rest.
- Very large result lists are trimmed to a sensible size, so stream menus open faster without missing your own copies.

### My AIOStreams (optional)

- You can now connect your own AIOStreams setup to LeLibrary. Paste your configured AIOStreams manifest link on the Configure page, confirm the loop warning, and its streams join your public IMDb rows after your own copies.
- The link is stored encrypted on the server and is never added to your LeLibrary install link or shown again after connecting. You can test, replace or remove it at any time.
- Off by default, and never used for My Library or Collections unless you enable Use Main metadata.

### A friendlier way to configure

- Quick Setup is now a separate connection screen beneath the familiar LeLibrary header: choose a player, enter provider and TMDB keys, and generate a private manifest with Pictorium posters selected by default. The full editor remains available without losing your entries.
- Quick Setup validates keys and waits for saving to succeed before showing install links. Failed saves keep your entries available for retry.
- Opening the main Configure page now offers a choice: Quick setup for the essentials, or Full setup for every option. Install links and saved setups still open the full editor directly.
- Quick Setup on the main page now includes the full Custom Streams editor: search a title, pick the exact episode when needed, paste its direct link and set an expiry, just like the full editor.
- The Pictorium panel cycles through pairs of real posters on its own, one film and one series each, with a smooth crossfade. Rotation pauses off-screen, every pair is tried once, and verifying your TMDB key now loads the preview straight away.
- The full editor's poster preview rotates through the same film and series examples with the same gentle fade, across every poster service (ERDB, RPDB, BetterPoster, Custom and Pictorium).

### Hosted account guide

- A searchable account guide covers first setup, service keys, Stremio and Nuvio installation, Home rows, collections and troubleshooting. It is available from the account navigation and matches the account styling.
- Setup health is now a real page: it checks saved keys, providers and install tokens, and offers a small, non-sensitive diagnostics download. Guide and Setup health appear in the account menu on both desktop and mobile.
- The setup guide has been rebuilt with product screenshots for each section, and the Google and GitHub sign-in confirmation screen now fits mobile screens properly instead of appearing zoomed out.
- The account guide remains exclusive to the hosted account area. Self-hosted installations receive Quick Setup on the normal Configure page.

## [5.1.5]

### Faster fetching and collections

- TorBox download sources fetch concurrently and overlapping profiles share one scan. Account and endpoint rate limits are isolated, HTTP/API errors are handled correctly, and temporary source failures retain the previous library data.
- Public collections show cached rows immediately while refreshing in the background. Protected lists revalidate expired data and discard stale results when access is revoked.
- Poster lookups persist across restarts and overlapping requests share work. Optional Fanart artwork loads in the background without delaying catalogue rows, and website previews prioritise their first visible posters.
- Playback concurrency slots are released reliably, and optional performance diagnostics report aggregate timings without exposing download details.
- Series matching strips pack and season markers from titles so valid shows are not dropped.

## [5.1.4]

### Fixes

- **Wizard push uses the updated code immediately**: The Collections Wizard script is now cache-busted, so the faster push fix from 5.1.3 is picked up without a hard refresh.

## [5.1.3]

### Fixes

- **Pushing to Nuvio now finishes straight away**: On a cold start the push could spend a minute preparing every collection before it responded, so the browser gave up and showed "Push failed" even though the install had actually completed. The push now answers immediately and finishes preparing collections in the background. If you saw a failed push before, just try again.

## [5.1.2]

### Fixes

- **Misnamed packs find their show**: A download whose name is cut short, such as a torrent called "Law" that actually contains Law & Order episodes, is now matched to the real series so its season and episodes appear instead of being dropped.

## [5.1.1]

### Fixes

- **Collections use your selected posters**: Curated and owned collection folders now apply the poster provider you chose, including the new Poster Studio, instead of keeping the old artwork.
- **Posters default to English**: Genre labels now read as Drama, Action and Comedy instead of Italian. You can still choose another language and region in the Poster Studio.
- **No more phantom movies**: A download whose name is cut short, such as a torrent named "Law" that actually contains Law & Order episodes, is no longer added to My Movies as an obscure film. It is matched to the real series instead.

## [5.1.0]

### Better search in Nuvio and Stremio

- **Reliable international searches**: Searches in non-Latin scripts now keep their own results instead of accidentally showing results from another title.
- **Better title matching with years**: Adding a year to your search keeps exact title matches ahead of more popular partial matches.
- **Cleaner, more resilient results**: Duplicate titles are removed, and an invalid release date no longer causes the entire search to come back empty.
- **Complete results and lighter posters**: A previous search with fewer results no longer cuts short later searches. Search posters also use smaller images suited to browsing grids.

### Faster catalogues and details

- **Faster repeat opens**: Hot catalogue, metadata and stream responses can now be reused by supported clients instead of being forced through a complete refresh every time.
- **Fewer cold-start lookups**: Library title matches are loaded together and retained across restarts, substantially reducing repeated metadata work on large libraries.
- **Fresh pagination after library changes**: Additions, removals and ordering changes now invalidate every stale page for that user after a successful full-library rebuild, immediately restore the newest first pages and refill older pages on demand without making another provider request.
- **New downloads appear sooner in clients**: Owned library catalogue hints now refresh every two minutes while the durable server cache remains long-lived, preventing Nuvio from holding an outdated My Movies/My Shows page for an hour without increasing provider scans.
- **Quicker movie and series details**: Cold detail pages use one combined TMDB request for the main metadata, artwork, credits, IDs and ratings instead of several separate requests.
- **Long-running shows load more safely**: Season data is cached across restarts and fetched with controlled concurrency, avoiding large bursts for shows with many seasons.
- **Resilient rich metadata**: Previously successful rich metadata remains available during a temporary metadata-addon outage, with a short recovery circuit preventing repeated slow failures.
- **Faster artwork grids**: Catalogue posters use TMDB's direct image CDN at a grid-appropriate size. Images are never proxied through LeLibrary, while full detail backdrops and posters keep their larger sizes.
- **Tighter playback waits**: External stream sources share a shorter default response budget so one slow integration is less likely to hold the whole player open; operators can still tune the budget.
- **Privacy-safe diagnostics**: Provider refresh logs report counts and timings without printing sample download IDs, availability records or tracker messages.

### Library matching, boxsets and Specials

- **Correct movie/series pack classification**: Bare TV packs with episode files no longer leak into Movies through a similarly named film match. Ambiguous inspections reuse embedded files or one coalesced, cached provider lookup across every catalogue builder.
- **Complete TV boxsets stay complete**: Names such as `S00-S26`, `S01-S14` and `Seasons 1-15` now expose their full owned season range instead of only the first season, with exact season-and-episode selection inside multi-season packs.
- **Misleading episode names recover safely**: A large or multi-file download named like one episode is checked against its inner files, allowing cases such as a Bob's Burgers `S03E05` outer name to recover seasons 1-8. Embedded files cost no extra provider request; otherwise one coalesced result is cached by a non-secret hash-derived identity across restarts.
- **Specials are included**: Owned season 0 episodes now appear as Specials alongside regular seasons when TMDB provides them.
- **Ranged episode packs stay complete**: A download named like `S01E03-04` now counts both episodes even when the provider only lists the first file inside it, so the second episode no longer shows as missing.
- **Misnamed season packs recover fully**: A download named like one episode but holding a whole season, such as a pack named `S08E07`, now exposes every episode inside it instead of only the episode in the name.
- **The right show is chosen**: An exact series title such as Stranger Things is no longer attached to a newer spin-off whose name merely starts with the same words, even when the spin-off is more recent.

### Playback reliability

- **TorBox link bursts are bounded**: One playback screen now requests at most eight owned links, with no more than three candidate files taken from a single download. The best language, quality and size options are retained, while external addon results remain unaffected.
- **Duplicate link requests are shared**: Concurrent requests for the same TorBox file now share one in-flight `requestdl` operation and continue reusing successful links from the six-hour cache.
- **Empty results recover quickly**: A throttled or temporarily failed provider response now tells Nuvio and Stremio to retry after 60 seconds instead of accidentally caching a notice-only result for ten minutes.
- **Clear TorBox cooldown notices**: When TorBox actually returns a playback 429 and no TorBox link succeeds, the stream list now explains that TorBox is temporarily rate-limiting playback and shows a rounded retry time. Cached, custom and external streams remain available, while the anonymous cooldown survives a restart without storing keys, tokens or media details.

### Pictorium Poster Studio

- **Free custom posters**: Build your own posters with rating, quality and ranking overlays without a paid poster key. Your existing TMDB key is all that is needed.
- **A proper poster editor**: Open the Poster Studio to choose the badge style, ranking ribbon, aggregate rating sources, metadata language, region, accent colour, backdrop blur and coming-soon veil, with a live preview that updates as you change each option.
- **Your country and language**: Choose the region that drives the ranking charts, streaming quality and cinema release detection, and the language used for artwork and titles.
- **Coming soon by default**: Films that are in cinemas but not yet streaming now get the Coming soon veil automatically.
- **Rotten Tomatoes, Metacritic and more**: Pick which rating sources feed the poster score. Your saved MDBList key unlocks the wider sources such as Rotten Tomatoes, Metacritic, Letterboxd and Trakt; without it the poster keeps the default IMDb and TMDB mix.
- **Every setup screen**: The same studio and preview are available from the standard Configure page, an account setup, and the Collections Wizard.
- **Your own server, optional**: If you self-host Pictorium, enter its public URL; otherwise the built-in studio is used automatically.
- **Keys stay private**: The poster is rendered by the server, so your TMDB key is never placed in the poster link.
- **Reliable previews and hiding**: Studio switches refresh the sample image, and turning a badge toggle off removes that overlay.
- **Powered by Pictorium**: Pictorium is a separate open-source project, credited wherever the studio is offered.

### MDBList collection sources

- **Recognisable MDBList setup**: The folder source picker now uses MDBList's own logo beside its list builder.
- **Add a list by ID**: The Collection Wizard folder picker can turn an MDBList list ID or ID-bearing URL into Movies, Series, or both with an optional friendly name.
- **Scoped to one setup**: A source is saved only in the collection setup where it was added. Other tokens, profiles and accounts cannot resolve or use it.
- **Live list contents**: Nuvio folders continue fetching the saved list source, so list changes appear after the normal cache refresh without recreating the folder.
- **API-conscious caching**: Fresh results are shared within the setup's credential scope, concurrent requests are coalesced, and a last-known-good result is retained for temporary MDBList failures.
- **Keys remain private**: Creating a source checks only whether an MDBList key exists. The encrypted key and list contents are not exposed to the browser.

### Accounts

- **Rebuilt saved-setup management**: The Tokens page now has a compact setup overview, a clear creation form, readable full-width setup rows, unmistakable primary actions and responsive in-page dialogs for password protection, revoking and deletion.

### Quick Picks

- **Movie Collections stay visible**: LeLibrary Hub setups restore Movie Collections as their own fixed bottom collection when its older hidden setting is absent; an explicit off choice remains off.
- **Richer focused packs**: Family, genre, theme and seasonal starters now split their useful sources into clear folders, so they are proper browseable collections rather than one crowded row.
- **Finished artwork for major packs**: Directors, By Decade and World Cinema now have dedicated collection artwork instead of blank tiles.
- **More focused presets**: Added Just Added, Family Night, Hidden Gems and Documentaries packs.
- **A much larger Quick Pack library**: Added 22 more ready-made choices covering cinema, TV binges, genres, moods, streaming services, superheroes, franchises, family viewing and seasonal comfort picks.
- **A proper pack browser**: Quick Packs now open in a large searchable and filterable modal instead of being squeezed into a horizontal scroller.
- **A cleaner Collections Studio**: The Quick Pack launcher and library have been redesigned with compact cards, category chips, clearer add states and a mobile-friendly list layout.
- **LeLibrary stays at the bottom**: LeLibrary Hub and LeLibrary Movie Collections are kept together after every regular collection in both the editor and Nuvio, including when only the Hub is enabled or another pack is imported later.
- **Fresh picks automatically**: Dynamic genre, provider, studio, network and theme sources rotate on a daily cache cycle, while Nuvio continues loading each folder from its live catalogue source without needing another push.
- **A lighter Home-row LeLibrary Special**: The catalogue-row sampler now uses six balanced rows instead of twenty, reducing first-load work and Home-screen clutter.
- **A roomier folder editor**: Folder editing now uses a larger sectioned workspace with a sticky live preview, grouped name, artwork and source controls, clearer animation settings and a fixed save area.
- **A readable source picker**: Adding folder sources now uses properly spaced dark catalogue rows, clearly separated titles and metadata, a compact labelled MDBList form and a dedicated scrolling list with always-accessible actions.

### Catalogue presentation

- **Simpler imported catalogue labels**: Imported sources now show a short "LeLibrary" prefix followed by the source name in Nuvio, removing repeated labels such as "LeLibrary Imported Movies" while keeping each source's real name visible.

### Nuvio integration

- **Public collection sessions recover automatically**: Normal Configure and account-backed pages refresh expired Nuvio sessions before browsing community collections, use Nuvio's current public integration key and show a clear wait message when Nuvio rate-limits requests instead of reporting a generic gateway error.
- **Large community packs browse reliably**: LeLibrary accepts today's larger bounded Nuvio responses, sends only lightweight summaries to the browse screen and fetches full collection resources only when a user opens or imports that collection.
- **Nuvio community browsing restored**: Public collection requests now follow Nuvio's current filter contract across normal Configure, account Configure and the Collections Wizard, preventing the "All" filter from being rejected upstream.
- **Current profile syncing**: Collection pushes now use Nuvio's current five-profile sync contract, so a selected profile can reliably keep its own addon setup.
- **Clear addon requirements**: Community packs keep their original external catalogue references and clearly show when another addon must be installed in the same Nuvio profile.

### Custom Streams

- **Play your own stream links**: Add a direct HTTP or HTTPS link to a selected IMDb movie or exact TV episode. Existing advanced mappings remain compatible.
- **Debrid is optional**: A Custom Streams-only setup can run without a debrid provider. A TMDB key is still required for reliable title matching, posters, metadata and exact episode selection.
- **Fast mapping editor**: Search for a movie or series, select the real title, choose an available TMDB season and episode when needed, then paste the direct URL. Free-typed IDs and episode numbers can no longer create broken mappings.
- **Live account-backed lookup**: Normal Configure, account Configure and the Collections Wizard all load current TMDB search results and fetch only the selected series season, keeping even long-running shows responsive.
- **Reliable season loading**: Token-based season and episode requests now reach the picker correctly instead of being caught by the website's missing-page handler. The exact selected TMDB series is retained, with a full-series metadata fallback when the direct request is unavailable, so valid long-running shows no longer appear to have no episodes.
- **Automatic stream expiry**: Choose 30 minutes, 1 hour, 3 hours, 6 hours, 12 hours or 24 hours when adding a link. Expired links disappear from setup and are no longer returned for playback, while existing links created before this option remain compatible.
- **Optional Home rows**: Active links can appear in separate Custom Streams Movies and Series rows with normal TMDB posters and metadata. Multiple links for one title remain separate playback choices while its poster appears only once.
- **Cleaner setup screen**: The mapping editor now focuses on the essentials: title, exact episode when needed, direct URL and expiry, with consistent dark controls across Configure and the Collections Wizard.
- **Safer links and private storage**: LeLibrary checks mappings before saving them, masks URLs in the editor and encrypts mappings saved to hosted accounts. It does not open, proxy or include your media URLs in logs.
- **Reliable stream ordering**: Your owned copy remains first when available, followed by enabled external sources and your matching Custom Streams. Changes apply immediately without reinstalling the addon.
- **Compatibility guidance**: HTTPS MP4 links offer the widest client support. HLS links and local-network HTTP addresses may depend on the app, device and network being used.

### Client integrations

- **Correct Nuvio logo loading**: Configure now requests the bundled PNG directly instead of briefly requesting a missing SVG and producing a browser-console 404.
- **Dedicated setup links for more apps**: Configure now provides tailored testing links for STRMR, Fusion, Vidi and WuPlay alongside the existing Stremio and Nuvio options.
- **More reliable STRMR support**: STRMR now receives the correct Movies and TV setup, responds within the app's time limits and can play an owned library copy from a public IMDb title or episode.
- **Clear STRMR setup instructions**: The install card explains that LeLibrary must be assigned to Movies, TV or both inside STRMR before its rows and streams appear.
- **Your library IDs stay consistent**: Public discovery titles continue to use IMDb IDs, while My Movies and My Shows keep their private LeLibrary IDs unless you enable Use Main Metadata.
- **Guidance that matches each app**: Fusion and WuPlay explain where their widgets, screens or hubs are managed. Vidi receives only the direct HTTP or HTTPS stream links it supports.
- **Existing installs keep working**: Current Stremio and Nuvio install links are unchanged. The new app-specific links use stable addresses designed for each supported client.
- **Stremio and Nuvio stay unchanged**: Regression coverage locks their existing manifests and capabilities to the original pass-through behavior while other apps receive tailored projections.
- **Private troubleshooting details**: Failed or slow requests can be identified without recording setup tokens, API keys or media URLs.
- **Clearer client timing diagnostics**: Testing integrations now report privacy-safe timings for setup resolution, ID mapping, caches, metadata and stream building, making slow STRMR requests easier to pinpoint without exposing private values.

### Self-hosting

- **Official Docker release images**: Version tags can now publish LeLibrary to GitHub Container Registry for both 64-bit Intel/AMD and ARM systems, with stable and preview releases kept separate.
- **Simpler installs and upgrades**: The example Docker Compose setup pulls the official image and lets you upgrade, pin or roll back by changing the GHCR tag directly on the service's `image:` line.
- **Smaller, safer public image**: The release image runs as a non-root user and excludes hosted accounts, private website files, credentials, development files and Git history.
- **Clearer release build layout**: Public GHCR builds now use clearly named, dedicated build files, keeping them separate from local and hosted development builds.
- **Better self-hosting guide**: The README now covers first-time setup, health checks, logs, upgrades, version pinning, Redis backups, restores and full resets.

### Search

- **Separate global and library results**: The combined Search option now shows global Movies and Series separately from My Movies, My Shows and LeLibrary Collections instead of mixing them into shared rows.
- **The three familiar choices remain**: Choose Movies & Series plus Your Library, Only your Library, or Only Movies & Series from TMDB from the selector at the top of Configure.
- **Correct IDs in every section**: Global results keep their public IMDb IDs, while owned results retain the selected library ID mode and continue opening the correct owned streams.
- **Search stays off Home**: All dedicated result sections remain hidden from Home and appear only when a search is performed.

### Custom Posters

- **Cleaner artwork setup**: The Collections Wizard now uses a balanced provider picker, grouped enhancement controls and a contained live preview that remains readable across desktop, tablet and mobile layouts.
- **Use your own poster service**: Custom Poster is now available alongside TMDB, ERDB, RPDB, BetterPosters and Fanart.tv in normal Configure, account Configure and the Collections Wizard.
- **One reusable URL template**: Supply an HTTPS image URL containing an IMDb or TMDB placeholder, with an optional movie/series placeholder. LeLibrary fills it separately for every title.
- **Live example and clear validation**: The setup page shows the resolved sample URL and poster while you type, and explains invalid protocols, placeholders or incomplete templates before saving.
- **Encoded templates work too**: Poster services that provide URL-encoded placeholders such as `%7Bimdb_id%7D` now resolve correctly and load a real preview in Configure and the Collections Wizard.
- **Works throughout LeLibrary**: Custom artwork applies to discovery, global search, library rows, collection films and detail pages. Titles missing an ID required by the template keep their normal poster.
- **Direct and private**: The media app downloads the resolved image directly. LeLibrary does not fetch, proxy, scrape, cache or log image contents.
- **Title-level artwork only**: A poster template cannot inspect the exact file chosen for playback, so Dub/Sub artwork depends on rules provided by the external poster service.

## [5.0.2]

### Self-host fixes

- **Simpler install step when nothing is connected**: if you have not signed in to Stremio or Nuvio, the install step now skips the push section and goes straight to Generate install links plus the manual setup links. Connect on the Platform step any time and the push options reappear.
- **Your rows now show on Home**: self-hosted library rows (My Movies, My Series, Collections and curated picks) no longer carry a hidden-from-Home flag, so they appear on Nuvio Home as expected. Search rows stay hidden as before, and account collection folders work exactly as they did.
- **Switching a row off no longer loses it**: turning off a Home row now keeps it listed, dimmed, so you can switch it straight back on instead of losing it with no way back.
- **Saved setups actually persist**: self-hosted saved setups are now stored without an expiry date instead of silently expiring, so they survive restarts and rebuilds.
- **Saved setups are easier to find**: the saved setups section opens automatically when you have setups saved, and there is a new Save current setup button on the install step next to the manual links.
- **The save reminder clears after generating**: the Unsaved changes banner now goes away once your install links are generated, instead of nagging after a successful save.

## [5.0.1]

### Series matching

- **Missing Kitchen Nightmares seasons are back**: libraries that name the 2023 revival onward as seasons 8, 9 and 10 (the Sonarr/TVDB numbering) now show those episodes under the 2023 series with the correct artwork and streams, instead of silently dropping them.
- **More reliable episode matching on first load**: series details now resolve correctly even when the cache is empty, so episodes appear the first time you open a show.

## [5.0.0]

### Security and self-hosting

- **Safer self-hosted saved setups**: self-hosters must now set `SELFHOST_CONFIGS_SECRET` in `.env` before saving, loading or deleting saved setups. Generate one with `openssl rand -hex 32`; the Configure page uses it automatically once the instance is rebuilt.
- **Clearer message when saved setups are off**: self-hosted installs without that secret now explain how to enable saved setups instead of failing silently.
- **Cleaner self-hosted Configure page**: the provider status pill is hidden where there is no status page, so self-hosters no longer see a placeholder readout.
- **Hardened network and dependency handling**: removed an unused vulnerable dependency, limited image proxy responses, and added safeguards against oversized saved configurations.

### External streams

- **More stream coverage with Jackettio**: you can now enable Jackettio alongside Torrentio, Comet, Meteor and MediaFusion for additional discovery streams. It uses the debrid provider you have already connected, so there is no extra API key or setup screen.
- **Works wherever you use public IMDb rows**: external sources apply to Trending, Popular, imported or created Home rows, and My Library or Collections when you enable Use Main Metadata. The default isolated library mode remains owned-only.
- **Faster first stream loads**: owned and external sources now start together, repeat player requests share the same in-progress result, and opening a public title warms its stream list in the background.

### Stream notices

- **Friendly "no streams" message**: when nothing is found, LeLibrary shows a clear "No streams found" row instead of an app error.
- **Heads-up for unreleased films**: films still in cinemas, or without a digital release yet, show a helpful note explaining why sources may be limited. The digital release date is included when available.
- **Turn it off any time**: stream notices are enabled by default and can be disabled in the Filters step.
- **Instantly applied**: changing this setting takes effect without re-installing your addon.

### Configure key validation

- **No repeated checks in one session**: once an API key has been successfully validated in normal Configure or account Configure, re-saving and moving through setup skips the same network check for the rest of that browser session. Changing a key always checks it again.
- **Keys stay private**: this session cache stores only a SHA-256 fingerprint of the service/key pair, never the API key itself.

### Curated collection artwork

- **Much better collection artwork**: streaming services, film collections, themes and studios now use refreshed locally hosted covers instead of relying on the old plain or generated artwork.
- **Animated artwork is handled correctly**: animated GIF covers can be used where supplied, while focus GIFs are kept separate for the Nuvio focus state. Marvel and Star Wars now use static JPG covers with their focus artwork separated correctly.
- **More polished themes and studios**: True Crime, Zombies, Time Travel, Heists, Plot Twists, Marvel, DC, A24, Warner Bros and Universal now use refreshed artwork.
- **Live artwork previews**: changing a collection cover or focus GIF in the configure editor updates its preview immediately before saving.
- **Local and reliable artwork**: imported artwork is served from LeLibrary’s own asset directory, with provenance recorded for each file instead of fetching images from third-party hosts at runtime.

### My Library

- **The in-browser library view has been retired**: this lets LeLibrary focus on the addon and catalogue experience. Your debrid downloads continue to work in the addon, and watchlists such as Simkl and MDBList still appear as addon rows.

### Accounts

- **Account pages rebuilt to match the main site**: the account dashboard, settings and sign-in page now share the main site's polished design and work cleanly on smaller screens.
- **Sign in with GitHub or Google**: no passwords to remember and no email verification. Sign in once and your API keys are saved to your account, encrypted at rest, so you do not need to enter them again on another device.
- **Shorter, safer install links**: signed-in installs use a short random ID instead of putting your keys in the URL.
- **Account-owned install tokens**: only the account owner can manage a saved token, its settings and its connected services. You can password-protect its configuration page or revoke it at any time.
- **Your tokens, in one place**: label saved installs, copy their URLs, protect their configuration pages with a password, or revoke them instantly. A revoked link stops working immediately.
- **Every key verified before saving**: each provider key is checked with its service when you save, so typos are caught before they reach your setup. Every field links directly to where you can get that API key.
- **Connect Nuvio and Stremio from your account**: sign in from the account area, without reopening the configure page. Your connection is stored securely so collections can stay in sync with your install.
- **Watchlist connections**: connect Simkl for Plan to Watch, or save an MDBList key, and your watchlist appears as addon rows with plain IMDb IDs.
- **Sign out and stay in control**: your keys remain encrypted on the server and are never shown back to you in plain text. Clearing a field removes it.
- **Privacy policy**: a clear privacy policy is now available, explaining what LeLibrary stores, how account data is protected and what stays on your own device.
- **Backward compatible**: existing install links keep working, and self-hosters can continue to run LeLibrary without accounts.

### Account Collections

- **A full account Collections builder**: create and manage up to five saved Nuvio collection setups from your account, each with its own short install token, folders, Home rows and Nuvio profile target.
- **Separate account configuration pages**: account-token installs now use their own `/accounts/{token}/configure` experience, keeping account-only controls out of the standard Configure page while preserving existing links.
- **Better Nuvio publishing**: select the target Nuvio profile when you push, see clear publishing progress, and only LeLibrary-managed collections are replaced—your other Nuvio addons and collections remain untouched.
- **LeLibrary Hub and Movie Collections**: optionally add a clean Movies/Shows Hub, or an owned Movie Collections area grouped into franchise folders. The Hub and franchise collection stay together at the bottom of Nuvio Collections without overriding the order of your normal packs.
- **Reliable imported profiles**: Xperience imports now resolve their private source definitions from the correct saved setup, so large imported folder sets remain available after reopening or publishing.
- **Accurate saved-state controls**: Quick Packs now correctly show whether LeLibrary Hub and Movie Collections are already included, and imports no longer silently re-enable optional packs.
- **More polished collection editing**: folder names support emoji, Square tiles have been removed, and Landscape/Poster changes update folder previews before you save.
- **Cleaner setup limits**: the Collections page shows a colour-coded setup count, prevents creating a sixth setup, and deleted cards animate away while the count updates immediately.

### Library refresh and caching

- **New downloads update automatically in Collections**: account installs share the same provider-aware Redis refresh system as the normal Configure page. My Movies and My Shows refresh from a single provider snapshot every two minutes without a re-save or re-push.
- **Newly matched titles no longer get stuck off-screen**: when a download becomes matchable, LeLibrary now clears the affected rendered catalogue page as well as metadata and streams. A new film appears in My Movies instead of waiting for the old page cache to expire.
- **Faster recovery after a restart**: active account installs run one safe shared refresh as the server comes back, rather than waiting for the first background interval.
- **Stronger fresh TorBox checks**: live library polls explicitly bypass provider and HTTP caches while retaining the shared rate-limit protection.

### Watchlists

- **Simkl connect**: link your Simkl account and your Plan to Watch list becomes movie and series rows in the addon.
- **MDBList watchlist**: save your MDBList key and your MDBList watchlist appears in the same way.
- **Plain IMDb IDs throughout**: watchlist rows use bare `tt` IDs, so external stream addons can contribute streams and Nuvio can show its full detail page.

### Catalog library

- **Hundreds of ready-made rows**: the Catalogue Library adds streaming services, genres, studios, actors, franchises and themed lists to your addon. Enable the rows you want and they work with external stream addons and Nuvio metadata.
- **Daily rotating discovery rows**: broad streaming, genre, studio, network and theme catalogues now draw from a different TMDB result pool every day. Trending, Popular, Top Rated, new-release, franchise, actor and curated-list rows stay stable where that makes more sense. Rotation is automatic for hosted accounts and self-hosted installs, with shared caching and last-good results to keep TMDB load low.

### Stream formatting

- **New polished stream styles**: choose Cinema Cards, Premium REMUX, Clean Compact or Technical Detail from normal Configure, account Configure, or the Collections Wizard. They safely show parsed resolution, REMUX/release flags, source, HDR/Dolby Vision, codec, audio/channels, release group and file size in actual Stremio/Nuvio stream text.

### Nuvio stream badges

- **Badge packs alongside every formatter**: normal Configure, account Configure and the Collections Wizard now let you select a Nuvio-only badge pack independently from the stream formatting preset. Changing a formatter never changes the badge pack.
- **LeLibrary Premium included**: an original locally hosted badge manifest covers resolution, source, REMUX/edition flags, HDR/Dolby Vision, audio, channels, codec and languages. Its JSON URL and image assets work on hosted and self-hosted installs.
- **More packs, without copying artwork**: NardBadges, BetterFormatter, Elite and Minimalist official community pack URLs are available in the picker, along with a validated custom JSON URL option. Copy the selected URL and import it once in the relevant Nuvio profile’s Fusion badge settings.

### Search

- **Search LeLibrary directly in Nuvio and Stremio**: searches for films and series now include a dedicated LeLibrary results row with titles from across TMDB, not only the rows already in your addon.
- **Choose what Search includes**: in both Configure experiences, choose between Movies & Series plus Your Library, Your Library only, or TMDB Movies & Series only. The choice is saved with your setup and applies to the addon search rows.

### Configure page

- **SELF-HOSTED ONLY — load an existing setup with a click**: paste an old self-hosted install link or token and the Configure page fills itself in. Saved self-hosted setups stay on your own instance.
- **Self-hosted saved setups**: save your current self-hosted setup with a name, then load or remove it whenever you need. Everything remains on your own instance.
- **Cleaner for self-hosters**: self-hosted installs no longer show the Sign in link because accounts do not apply there.
- **Home Rows are configured separately**: choose which built-in and library rows appear on Home, drag them into the order you want, and keep optional catalogue rows available without putting them on Home.
- **Optional Nuvio collection packs**: curated packs such as Discover, Streaming Services, Film Collections, Themes and Studios create folders inside Nuvio Collections without automatically adding every folder as a Home row.
- **Per-pack display controls**: each Nuvio pack can use Tabbed Grid or Follow Layout, with optional Pin to top, Focus Glow, Show All tab, Landscape or Poster tiles, and editable folder artwork.
- **Live collection artwork editing**: cover and focus GIF changes preview immediately, with local artwork paths supported and static images restricted to PNG/JPG/JPEG while focus artwork accepts GIFs.
- **Anime visibility stays consistent**: enabling Hide Anime removes the Anime catalogue and Studio Ghibli from the curated Studios pack as well.
- **Imported Home Rows**: import one or more manifest URLs, a Collections URL, pasted collections JSON, or a `.json` file. Preview the number of rows and folders, then edit the imported rows before saving.
- **Smart Import**: the Import tool now detects addon manifests, Nuvio collections, project files, and raw collection arrays automatically, placing Home rows and collection folders in the appropriate sections.

### Xperience profile imports

- **Import Xperience profiles without keeping Xperience installed**: supported Xperience catalogue recipes are reconstructed as LeLibrary sources, so imported TMDB Discover, TMDB public list, TMDB collection and Trakt public-list folders continue to run through LeLibrary.
- **Private sources stay private**: where an identical LeLibrary catalogue does not already exist, the imported recipe is stored only in the owner’s selected collection profile. Source IDs are never used as permission to access another account’s imports.
- **Cleaner imported collections**: imported folders keep their human-readable names and artwork where safe. The interface no longer exposes Xperience addon IDs or opaque source hashes in normal use.
- **Safe import preview**: Xperience exports are fetched server-side from the allowed export host, checked for malformed or oversized data, and reduced to a sanitized preview. Signed export links, API keys, tokens and raw profile configuration are not stored or sent back to the browser.
- **Honest compatibility review**: unsupported Xperience catalogue types are clearly grouped for review instead of being guessed, silently changed, or creating empty Nuvio folders. Imports with no compatible sources are blocked before anything is created.
- **More reliable first import**: secure Xperience previews now allow a bounded wait for a cold Xperience export response, with a clear retry message if the remote service remains unavailable.

### TorBox

- **All your torrents now show**: LeLibrary now reads your full TorBox library instead of stopping at the first 1,000 torrents. Older downloads and titles beyond the first page now appear in My Movies, My Shows and LeLibrary Collections.
- **Web Downloads now show in your library**: TorBox Web Downloads are included alongside torrents and Usenet, so eligible downloads appear in your library automatically.
- **More reliable TorBox access**: LeLibrary now spaces out requests and recovers gracefully from busy periods, helping large libraries load reliably.

### Reliability and privacy

- **Long-running series are matched more reliably**: shows such as WWE Raw and The Simpsons no longer lose episodes because a filename includes a recent year.
- **Failed matches recover faster**: temporary metadata problems are retried on a later request instead of holding a title back for a full day.
- **Secure account storage**: account details, saved tokens and watchlist connections are stored securely. Secrets are encrypted at rest and token passwords are securely hashed, never stored as plain text.
- **Safer account sessions**: account actions and sign-in connections have additional protection against unauthorised requests.
- **Hosted accounts stay separate from self-hosting**: the private account system is not included with self-hosted installs. Self-hosters receive the standalone addon and configure page.
- **Background collection sync**: connected Nuvio and Stremio installs can keep collections in sync after you save.
- **Consistent collection artwork**: catalogue folders use locally hosted portrait, landscape and logo artwork instead of relying on third-party image services.

### Library fixes

- **Fixed detail pages that could show a blank page for some series**: an error in the certification lookup could return no details for certain titles. Those pages now load correctly.
- **Fixed movies with version numbers being grouped as a TV series**: films that include a version in the title were sometimes read as a series date. They now stay in My Movies where they belong.
- **Fixed newly added titles not appearing when the release year differs**: if the file name year does not match the database year, the lookup now falls back to a year free search so the title is found. New downloads also appear at the top of My Movies and My Shows within seconds without needing to clear the cache.

## [4.9.0]

### Provider Status Page

- **Dedicated status page at `/status`**: a full-page live status dashboard for all four debrid providers (TorBox, Real-Debrid, AllDebrid, Premiumize). Each provider shows a row of individual 60-second check beats that update live, current status, ping latency, and a link to the provider's own status page. Toggle between the last 24 checks and last 7 checks
- **Status pill in the nav bar**: every page (landing, configure, My Library, status) now shows a small pill in the top nav with a live count (e.g. "4/4") and a colored dot that reflects the overall provider status. Clicking it takes you straight to the status page
- **Server-side background pings**: the server now pings all four providers every 60 seconds in the background, so the status page and nav pills always show fresh data without waiting for a live check on page load. Each check also reports its round-trip latency in milliseconds
- **Self-hosters get a graceful fallback**: the status page is a private file (like the landing page), so it only appears on the hosted instance. Self-hosters are quietly redirected to the configure page if they visit `/status`

### Website

- **New three-column footer**: the landing and status pages now have a three-column footer with a brand description, product links (Features, How it works, Streams, My Library), a "Get Started" column with a live provider status indicator, social links (GitHub, Reddit), and a bottom bar with a "Not affiliated with any debrid provider or streaming service" disclaimer
- **Removed the Manifest link from the footer**: the Stremio manifest link is no longer shown in the site footer
- **Animated gradient glow on the hero mockup**: the configure page mockup in the hero section now has a subtle amber glow that pulses in and out, giving the landing page a more alive, premium feel
- **Glassmorphism on feature cards**: the six feature cards now use a semi-transparent background with a backdrop blur, and the hover effect is smoother with a deeper shadow and amber glow
- **Scroll-triggered reveals**: all feature cards, section headings, and the CTA section now fade in and slide up as you scroll into view. The feature grid cards cascade in one by one with a staggered delay

### Configure page

- **Your setup survives a refresh**: while you configure the addon, your changes are now saved in the browser as you type. If the page reloads or you lose it by accident, everything comes back exactly where you left it. The draft clears itself automatically once you save or push, and after an hour in the same tab
- **Much shorter install links**: the token in your addon URL is now up to around half the length, because only the settings the addon actually uses are stored in it. Easier to copy, and it takes up far less room in Stremio and Nuvio. Existing installs switch over to the shorter link automatically when you open your configure page
- **The "Review & Save" button now takes you straight to the Save button**: it jumps to the Install step and scrolls the Save or Generate button into view, so it can't be missed on mobile. The configure page also accepts your token even if you paste it the wrong way round, so a mangled link no longer loses your setup

### My Library

- **Series search no longer includes the year in the query**: when you open a TV show in My Library, the search now queries "Title S01" instead of "1999 Title S01", so individual episodes and season packs are found much more reliably. The year is still searched as a fallback, just not shown as the primary search term
- **Only the season you are browsing shows up**: opening a TV show no longer floods the results with complete season packs from other seasons. Results are filtered to the season you selected, and multi-season packs that include it still appear
- **Correct season labels on season packs**: a "Family Guy Complete Season 18" torrent now shows "Full S18" instead of being mislabeled as the season you happen to be viewing
- **Smoother torrent searches**: episode and season searches now run in small batches instead of firing a wall of requests at once, so searches finish without tripping rate limits
- **"In Library" badges now actually work**: movies and shows you already have in your debrid library are correctly marked on the browse, search and genre pages, and the badges refresh automatically when new files land in your library
- **Duplicate cleanup shows its work**: clearing duplicate files now opens a proper dialog that lists every duplicate group with checkboxes, so you can pick exactly which copies to delete. The largest file in each group is marked as the one that stays, and a spinner shows while the deletion runs

### Design

- **Denser movie grid on wide screens**: the browse pages pack in more titles per row on larger monitors with tighter spacing, so the grid feels less sparse
- **More interactive posters**: hovering a poster now zooms it slightly with a soft gradient at the bottom and a gentle lift, and the title row slides up with it
- **Compact genre chips**: the genre buttons are now neat little pills that wrap, instead of big full-width blocks
- **Smoother, less cluttered look**: cards, buttons, tabs, inputs and list rows use softer borders, gentler shadows and eased animations throughout, so the pages feel more polished

### Trending & Popular

- **Your filters and sort order apply straight away**: changing the resolution/quality filters or the stream sort for the Trending and Popular rows now takes effect immediately, instead of waiting up to ten minutes for the cached streams to refresh
- **Your sort order is respected even without stream addons**: when no external stream addons are enabled, your owned streams on Trending and Popular rows are now ordered by your chosen sort, the same as they would be with addons on

### Streams

- **Streams appear on the first try**: your owned movies and shows now load sources more consistently across every app, including Android TV. Some apps occasionally showed "no sources found" when you first opened an episode, then found them after you reopened the show, because the first request had to re-examine your whole library and could time out. Titles you have already watched or browsed are now remembered between sessions, so the first click is just as quick as every one after it

## [4.8.1]

### Trending & Popular

- **Much longer Trending & Popular rows**: these rows now load up to three times more titles to browse (around 50 on the first page, with more coming in as you keep scrolling), instead of stopping after 20

### My Library

- **Tell your rows apart when using several providers**: if you keep your movies and series as separate rows per provider, each row now shows which provider it comes from, like "My Movies [TB]" for TorBox and "My Movies [AD]" for AllDebrid. Your custom row names are kept, the tag is just added at the end. Nothing changes when your rows are merged

## [4.8.0]

### Trending & Popular

- **Your poster service now covers the Trending & Popular rows**: ERDB, RPDB, BetterPosters and Fanart.tv artwork now shows on the discovery catalog grids, not just on the title pages
- **Discovery title pages now use the same rich metadata as Xperience and AIOStreams**: actor images, full cast, trailers, age ratings and episode lists all come through with your chosen posters and ratings on top
- **Known note**: the IMDb metadata fetching is still being refined. The switch is in place and titles load through the rich metadata source; clickable actors and "More like this" polish is coming in a follow-up.

### My Library

- **Optional "main metadata" for your library**: a new setting in the setup (off by default) switches My Movies / My Shows / LeLibrary Collections from isolated TorBox ids to IMDb ids, so they load through the same metadata as every other title and external stream addons can contribute streams. When off (default), everything stays exactly as before: owned streams only, owned episodes only. Change it on the configure page, save, and it applies without re-pushing the install link
- **Better torrent search for TV shows**: searching for a season now runs multiple queries in parallel (e.g. "Breaking Bad S01", "Breaking Bad Season 1", "Breaking Bad 2008 S01", and simplified title variants) instead of a single guess, catching more results across different torrent naming styles
- **Faster search across all sources**: every query hits all 4 torrent sources at the same time, and all queries run in parallel, so even with multiple search variants the results come back quickly
- **Live search progress**: a progress indicator now shows how many sources have been searched while results are loading
- **Better season pack detection**: more patterns recognised for complete seasons, multi-season packs (S01-S03), and quality+complete combos (e.g. "1080p Full")
- **Improved episode extraction**: now handles comma-separated episodes (S01E01,E02,E03), concatenated episodes (S01E01E02E03), 1x01-style ranges, and bare 3-digit codes (101 = S01E01)

### Configure page

- **"Unsaved changes" banner**: a small banner now stays visible at the bottom of the screen on mobile and desktop whenever you have changes you have not saved yet, with a quick "Review & Save" button that jumps to the Install step

## [4.7.0]

### Setup wizard redesign

- **Proper 6-step setup wizard**: Providers, Metadata, Filters, Catalogues, Streams & Look, Install, no more tabs
- **Left step rail**: numbered dots with titles and descriptions, done steps turn green with a checkmark, current step glows amber
- **Progress header**: "Step X of 6" with a thin amber progress bar that fills as you go
- **Mobile step rail**: collapses to compact numbered dots in a single row on small screens
- **Back / Continue buttons**: fixed under each step, Back is hidden on step 1

### Filters & Preferences (new step)

- **Resolution filtering**: tick the resolutions you want to see (4K, 2K, 1080p, 720p, etc.) and unticked ones are hidden entirely
- **Preferred resolution order**: drag to reorder. When sorting by quality, streams at the top are preferred
- **Auto-sync**: unticking a resolution removes it from the preference order; re-ticking adds it back at the bottom
- **Quality & Source filters**: include/exclude by quality tags (BluRay, WEB-DL, CAM, etc.) and sources
- **Audio & HDR filters**: include/exclude by video codecs, HDR tags and audio formats
- **Size & Cache**: min/max file size, cached-only toggle
- **Max streams per title**: slider from 10 to 65, default 35

### Stream speed & reliability

- **No more stream caps**: external addons return all their streams, the resolution filter and total cap run after fetching so the best matching streams survive
- **Faster discovery streams**: external addon responses settle after 3 working addons (or all done), so a slow or failing addon never holds up the response
- **Downloads cached in Redis**: TorBox/Real-Debrid downloads are cached for 10 minutes so the discovery owned-bridge checks the cache instead of re-fetching from the provider every time
- **IMDb to TMDB mapping cached**: the lookup is cached for 30 days so discovery titles load near-instantly on repeat visits
- **Discovery owned-bridge skips the slow TMDB fallback**: when you click a discovery title, the owned-check only consults cached downloads and matches, never triggers the expensive per-candidate TMDB search
- **Comet config cleaned**: removed extra fields that caused different stream results

### Catalogues

- **Drag to reorder**: grab the handle and drag catalogue rows to reorder them (works on desktop and mobile with touch)
- **Pin Collections default off**: the "Pin LeLibrary Collections to top" checkbox is unchecked by default for new users

### Stream format & sorting

- **Owned first, then size**: default sort is now "owned first, then size", your library copy is always first, external streams sorted by largest
- **1440p / 2K detected**: stream quality detection now recognises 1440p/2K files, ranked between 4K and 1080p
- **Resolution labels use proper names**: filter chips show "4K" and "2K" instead of raw "2160p" / "1440p"
- **Old tokens migrated**: existing config tokens with old resolution labels are automatically updated on load

### More reliable settings

- **Stream addons saved in the token**: addon choices are now embedded in the install token itself, so external streams survive a Redis flush or expiry
- **Your stream settings also live on our servers**: custom templates and addon choices are stored server-side as a supplement

### Fixes

- **Progress header updates on step change**: the step title and progress bar now update correctly when navigating between steps
- **Catalogue reorder persists**: the reorder guard prevents recursive re-renders from resetting the list

## [4.6.10]

### Stream badges show where they came from

- **External streams now show their real source**: a Torrentio stream gets a [TR+] badge, Comet [CM+], Meteor [ME+] and MediaFusion [MF+], instead of wrongly showing your own debrid provider's badge. At a glance you can now tell where each discovery stream actually comes from

## [4.6.9]

### BetterPosters look right now

- **BetterPosters artwork displays properly**: posters now use the same smart-tag format as the BetterPosters addon and declare the correct poster shape, so they show at full size instead of getting squashed or cropped

## [4.6.8]

### Custom formatter settings stored reliably

- **Your custom stream formatting always applies now**: the formatter templates and stream addon settings are stored server-side instead of being squeezed into the install link, so a long custom template can't break your install link and your formatting shows up every time

## [4.6.7]

### Custom formatter install links fixed

- **Custom formatter links work again**: a long custom stream template no longer breaks your install link. Templates are now stored server-side instead of being squeezed into the URL, so the install link stays short and installs cleanly

## [4.6.6]

### Premiumize files now show up properly

- **Everything inside your folders appears now**: instead of trying to guess titles from folder names, LeLibrary pulls out each video file and sorts it into My Movies or My Shows by its real name, so content inside category folders (4K, Classic Films, TV Shows and so on) finally shows up

## [4.6.5]

### Premiumize scans everything, every time

- **Nothing in your Premiumize cloud is missed anymore**: if the cloud scan and transfer list both come up empty, LeLibrary now walks your folders directly (the same way dedicated Premiumize addons do), so manually-organised files always appear in your library

## [4.6.4]

### Premiumize library reliability

- **Your Premiumize library no longer disappears**: if the full-cloud scan comes back empty for your account, LeLibrary now falls back to listing your transfers with everything inside their folders, so your library always shows your content
- **Deeper folder scanning**: files nested several folders deep inside a transfer are now found

## [4.6.3]

### Premiumize scans your folders properly

- **Your whole Premiumize cloud shows up now**: movies and shows inside category folders (Action, Drama, TV Shows and so on) are picked up with their real titles instead of a couple of unrelated results

## [4.6.2]

### Your other Nuvio catalogues stay put

- **Pushing LeLibrary no longer clears your other catalogues**: the Home rows from your other Nuvio addons are now preserved when you push or re-push

## [4.6.1]

### Cast photos in your library

- **Actors now show on your library titles**: My Movies, My Shows and LeLibrary Collections detail pages now show the cast with their photos, just like the Trending and Popular rows

## [4.6.0]

### Trending and Popular catalogues

- **Trending and Popular rows are here**: new discovery catalogues powered by TMDB, with titles opening with their IMDb metadata
- **Other stream addons can power these rows**: add Torrentio, Comet, Meteor or MediaFusion from the setup page and LeLibrary gathers their streams for Trending and Popular titles, so you get plenty of options even for titles you don't own
- **Series in Trending and Popular find their streams again**: episodes are now routed by their IMDb id, so your stream addons (Torrentio, Comet, Meteor, MediaFusion) can answer even for shows you don't own
- **Rich detail pages for Trending and Popular titles**: actors are clickable, trailers play and network links show up, while My Movies, My Shows and LeLibrary Collections stay clean
- **Stream rows show where they came from**: every stream now carries its source addon's name (Torrentio, Comet and so on) while still using the formatting style you picked
- **Cleaner stream lists**: the number of streams returned for a title is capped, and the odd "More from the saga" row no longer appears as a playable stream on mobile
- **Your library stays untouched**: My Movies, My Series and LeLibrary Collections always use your own debrid copies, and none of the new stream addons are enabled by default
- **LeLibrary Franchises is now LeLibrary Collections**: same feature, cleaner name
- **Rename your catalogues**: use the Edit option in the Catalogues tab to give LeLibrary Collections, Trending or Popular a name you like
- **Clear reinstall reminder**: when you add stream addons, you're prompted to save and re-add the addon to Stremio or Nuvio so the change takes effect

### Custom stream formatting

- **Style your stream rows**: pick a preset (LeLibrary, Torrentio, Torbox, Google Drive, Prism, Tamtaro and more) or write your own name and description template for how every stream appears in the player list
- **Live preview while you pick**: see exactly how a stream will look as you tweak the template, before you install
- **Your chosen style everywhere**: streams gathered from other addons are now reformatted with the preset you chose, so owned and external streams look consistent
- **Formatting fixes**: several presets now render cleanly instead of showing broken bracket characters, and the preview updates live when you switch presets
- **Stream Addons made clearer**: the optional stream addons section has its own heading and shows the Torrentio, Comet, Meteor and MediaFusion logos
- **Finished steps turn green**: the setup wizard now marks each completed step so you always know what you have done

### My Library improvements

- **Duplicate detector redesigned**: the duplicate panel now shows large stat numbers at a glance, with each duplicate group on its own row showing the title, copy count and size kept, and stacks cleanly on mobile
- **Release notes modal redesigned**: the What's New modal now renders bullet points and section headers properly instead of plain text, shows release dates, and opens with a smooth animation
- **View Files scrolls properly**: the file list in the item modal now scrolls within the modal instead of overflowing off the screen, on both desktop and mobile
- **TorBox subscription fields fixed**: the Profile page now correctly shows your next billing date, expiry and subscription price for TorBox accounts
- **Premiumize scans your whole cloud**: files inside folders now show up in My Movies, My Series and the web library, including content organized into your own folder structure

## [4.5.2]

### AllDebrid library loads again

- **Finished AllDebrid downloads now appear in your library**: a status mismatch in the AllDebrid API meant ready-to-watch files were being filtered out, so AllDebrid libraries could look empty. Fixed for the addon catalogues, the web library and the queue page.

## [4.5.1]

### Safer account push

- **Existing addons stay installed**: pushing LeLibrary now adds or updates only LeLibrary instead of removing the rest of your Stremio or Nuvio setup
- **Existing collections stay installed**: pushing new LeLibrary franchises now replaces only the LeLibrary collection and preserves your other collections
- **Old LeLibrary copies are cleaned safely**: stale LeLibrary entries on other Nuvio profiles are removed without touching unrelated addons or collections
- **Franchise Home rows stay hidden**: LeLibrary Franchises remains available in Collections without duplicating every franchise across Home
- **Collections are no longer forced to the very top**: the LeLibrary collection is placed above the normal library rows without being pinned permanently

## [4.5.0]

### One-click setup

- **Push LeLibrary directly to Stremio or Nuvio**: connect your account from the final setup step instead of copying addon URLs manually
- **Choose the Nuvio profile**: sign in once, select the profile, and install LeLibrary and its catalogues together
- **Safer replacement flow**: previous addon names and manifest links are shown with individual copy buttons before you reinstall anything
- **Sessions stay on your device**: Stremio and Nuvio login sessions are saved locally in your browser, never on LeLibrary's server, and can be cleared with Disconnect

### Franchises and catalogues

- **LeLibrary Franchises now use a tabbed grid in Nuvio**: your owned films are grouped into one clean collection instead of being scattered across separate collection pages
- **Franchise rows stay available to Collections without cluttering Home**: Nuvio Home settings hide the duplicate franchise rows while the collection folders continue to work
- **New films are picked up by existing franchises**: refresh Nuvio to see the latest files, while a new franchise can be added with another push
- **Edit catalogues separately**: the Catalogues tab now controls what gets pushed, with imports from other catalogue files planned next

### Cleaner setup

- **Five-step configure wizard**: Providers, Metadata, Advanced settings, Connect, then Preview and install
- **Responsive mobile layout**: the old sticky Save and Generate bar is gone, and the wizard stays within the phone screen
- **Manual install remains available**: users who do not connect an account can still generate normal install links, with a clear explanation of what the manual route includes

### More reliable playback

- **TorBox stream links are reused**: repeated plays no longer request a fresh link for the same file every time
- **TorBox rate limits are handled more gracefully**: temporary throttling no longer causes a long chain of repeated failed requests
- **Temporary empty stream results recover faster**: a short provider outage no longer leaves a stale empty result behind for the full cache period
- **Collections survive temporary provider empty responses**: a brief library API hiccup no longer wipes working franchise folders

### Live provider status

- **A live status bar for all four providers**: the website and My Library now show the current health of TorBox, Real-Debrid, AllDebrid and Premiumize. Each provider gets its own card with its logo and a green, amber or red dot, so you can see at a glance if a service is slow or down
- **Status in the top navigation**: the Status link in the site's top bar carries all four provider logos with live dots, on desktop and mobile. My Library shows the same in its top bar and on the Settings page
- **Tap through to official status pages**: every provider card links straight to that provider's own status page for the full picture

### Smoother library

- **Episodes no longer vanish for a day**: if TMDB stumbles while loading a show's episodes, it retries after a few minutes instead of leaving the detail page empty for 24 hours
- **Brief provider hiccups no longer blank your library**: if a provider returns nothing for a moment, you keep your last good catalog instead of an empty row
- **Release notes cover everything you missed**: if you skipped a release or two, My Library now shows all recent release notes at once instead of just the newest

### Fixes

- **AllDebrid downloads now actually show up**: a connected AllDebrid account used to see an empty library because the app was calling the wrong AllDebrid endpoint. Your downloads now load on both the addon and My Library

## [4.0.1]

### Fixes

- **Series episodes can't disappear for a day anymore**: if TMDB has a hiccup while loading a show's episodes, it retries in a few minutes instead of showing an empty detail page for 24 hours
- **AllDebrid and Premiumize provider cards work on the configure page**: selecting them now actually activates the card and reveals the key field (a hidden dropdown was silently discarding the new providers)

## [4.0.0]

### Configure page redesign

- **A brand new setup flow**: the configure page is now a clear 1–2–3–4 walkthrough: pick your providers, add your TMDB key, tweak the optional extras, then install
- **Pick your providers with cards**: TorBox and Real-Debrid now show as tappable cards with their logos: click one (or both) and its key field opens right there, no more dropdown
- **Nothing is pre-selected**: when you first land on the page it's blank until you choose a provider, so you always know what you've actually set up
- **A live "Your setup" panel** on the right shows exactly what you've configured as you go: which providers, catalog mode, TMDB status and more
- **Advanced options tucked away**: catalog names, poster & ratings services and custom streams live in their own "Advanced settings" step so the main flow stays simple
- **Privacy front and centre**: how LeLibrary works, what we do with your keys and what you need are now always visible at the bottom of the page
- **Referral links moved into the provider cards**: sign up for TorBox or Real-Debrid (with your referral already applied) right where you'd enter the key
- **A clearer mobile experience**: a sticky bar keeps the Generate button in reach while you scroll, and everything stacks neatly on small screens

### Four debrid providers

- **AllDebrid and Premiumize are here**: alongside TorBox and Real-Debrid, you can now connect AllDebrid and Premiumize: any combination of two, three or all four in one addon
- **Per-provider catalog mode**: merge everything into one unified library, or keep a separate catalog row per provider (TorBox / Real-Debrid / AllDebrid / Premiumize), with custom catalog names still supported
- **Premiumize PIN flow built in**: the first time a key is used from a new IP, Premiumize asks you to authorize it: we show the PIN and walk you through it on the configure page, and again in My Library if it crops up mid-session
- **My Library supports all four**: per-provider login rows, logos on the dashboard, account cards in Profile, and the download/queue/add views all offer the new providers (AllDebrid & Premiumize take magnets, not .torrent files)
- **Your keys are still yours**: they live only in your browser (encrypted), and cache namespaces are now hashed rather than keyed on a key fragment

### My Library

- **Library item actions**: every download now has a preview bar and a "View files" modal with real actions: download the whole torrent, download as a ZIP (TorBox), download individual files, copy the magnet (short or full), and export a .magnet file. TorBox items also get an airlock toggle, rename, tags and alternative hashes, all saved straight to TorBox
- **Download progress bar**: starting any download shows a sweeping progress bar at the top ("Preparing download…" then "Download started") so you always know something is happening
- **What's new modal**: when a new release comes out, My Library shows the release notes once (dismiss it and it won't nag again)

### Branding

- **Provider logos**: TorBox, Real-Debrid, AllDebrid and Premiumize now show their own logos across the app instead of plain text badges
- **Reddit community link**: the footer and the configure page now link to the r/LeLibrary subreddit with a Reddit icon, right alongside GitHub

## [3.1.0]

### Your privacy & safety

- **Your API keys are never shown in URLs or server logs anymore**: previously a small fragment could end up in your browser history and our logs
- **Fixed a security hole on the configure page**: a specially crafted install link could run code on that page: it's now safely neutralised
- **Clearing your cache is locked down**: it can only clear your own data, needs to be triggered deliberately, and can't be fired off by a random webpage

### Clearer errors, fewer surprises

- **You'll know if you used the wrong TMDB key**: paste a TMDB v4 "Read Access Token" (these expire and don't work) and you'll be told straight away: as you type it, when you log in, and again if TMDB still rejects it. You want the v3 API key, and it tells you exactly how to get it
- **Plain-English messages everywhere**: wrong TorBox/Real-Debrid/TMDB keys, rate limits and provider outages now explain what's wrong instead of showing a number or a blank screen
- **A bad key can no longer hide behind a loading spinner** or masquerade as an empty library or an empty download queue
- **Torrent search tells you when the search sources are down** instead of just saying "no torrents found"

### Fixes & improvements

- **Snappier key checks and catalog loading**: the app now reuses its connections to TorBox, Real-Debrid and TMDB instead of reconnecting for every call: so key verification responds quicker and big libraries build without the extra connection overhead
- **Movie pages now show your chosen artwork and ratings** (ERDB / RPDB / Fanart.tv / OMDB): previously this only worked for series
- **Renaming a download on Real-Debrid now shows up in your catalog** right away
- **Fixed a crash** that a malformed request could trigger on the addon
- **Selecting, marking as watched and deleting is more reliable** when torrents, usenet and Real-Debrid items happen to share the same number
- **Logout really logs out** now, and there's a new "Use different keys" option to switch accounts
- **"Clear all data" clears everything**: no leftover cached items from a previous account
- **The dashboard stays up to date** after refreshing instead of showing stale counts
- **The detail page can't trap you anymore**: missing artwork no longer hides the Back and Save buttons
- **Shared links work even with an empty library**: opening a saved movie/series link no longer silently drops you to the dashboard
- **Fast re-searches don't show stale results** anymore
- **The download queue shows everything**, including items in uncommon states (queued, waiting for file selection…)
- **The HTTP "watch folder" hint is now honest**: the TorBox/Real-Debrid add APIs only accept magnets, and the page says so instead of silently failing
- **Adding a `.torrent` file to Real-Debrid no longer claims success**: RD needs a magnet link, and it tells you
- **Empty library messages name the right provider**, and the profile page safely escapes account data

### Configure page

- **Reset now resets everything** (poster service, custom streams, catalog names, hide-anime…) instead of leaving old settings in your install link
- **Copy buttons work without HTTPS** (local/LAN installs) and give feedback either way
- **Pressing Enter no longer silently regenerates your install links** while you're typing in the custom-stream fields
- **Typing in the custom-stream fields marks the form as "unsaved"** like every other field

## [3.0.3]

### Website / Configure

- **Your keys are checked before you get install links**: click "Generate" and it validates your TorBox, Real-Debrid and TMDB keys, flashes "Keys validated ✓", and flags any field that's wrong: no more installing a broken key and wondering why nothing works

## [3.0.2]

### Addon / Core

- **The right seasons & episodes for you**: your downloads are tracked separately per user, so you never see someone else's seasons or the wrong episode list
- **Streams match what you clicked**: an episode that isn't in a download no longer plays a random file from it
- **"Hide anime" really hides anime now**: it's removed from the Movies and Series rows too, not just the anime row
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

## [2.0.0]

- **TorBox + Real-Debrid**: use one, the other, or both
- **Merge or separate catalog modes**
- **Pick your provider** in the config
- **One addon** that works with both services
- **Nuvio compatible**
- **Revamped My Library**: virtual scroll, watchlist and queue

## [1.0.0]

- TorBox-only addon
- Basic catalog, meta and stream endpoints
- TMDB metadata integration
- Filename parsing
- Simple configure page
