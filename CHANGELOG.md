# Changelog

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
