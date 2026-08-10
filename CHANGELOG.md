# Changelog

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

- **Pushing LeLibrary no longer clears your other catalogues**: the Home rows from your other Nuvio addons (Torrentio, AIOMetadata and so on) are now preserved when you push or re-push

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
