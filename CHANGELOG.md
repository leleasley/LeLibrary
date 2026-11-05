# Changelog

Notes for the current version. Every earlier version is on [GitHub Releases](https://github.com/leleasley/LeLibrary/releases).

## [6.0.0]

### New

- Preview your setup as it looks in Nuvio. Press Preview at the bottom of any setup page, while creating or editing, and a full screen copy of Nuvio opens: your Home rows in order with real posters, your collections and folders, a details page with sample streams in your stream style, on a phone layout or a TV layout. Stremio has its own view too. It shows your unsaved changes and never pushes or saves anything.
- A new API keys section. TMDB, TVDB, OMDb and MDBList now have the same cards as the library providers, and the MDBList card shows which account it is connected to.
- Simkl rows: connect Simkl to add Up Next, Airing Next, Plan to Watch, Watching and Completed rows.
- Your MDBList lists: with an MDBList key you can pick your own lists, the lists you liked, your watchlist and Up Next straight from the Home rows and folder pickers, without adding each list somewhere else first.
- AniList rows: add your AniList username (or connect AniList for private lists) to get Watching, Plan to Watch and Completed anime rows.
- Nuvio now lists far fewer LeLibrary catalogues. Collection folders already shared one catalogue, but every pack source was still listed on its own as a hidden row, so a setup with packs showed well over a hundred catalogues in Nuvio. Only the rows you actually picked for Home are listed now. Push again or restart Nuvio to see the smaller list.

### Changes

- Trakt can no longer be connected to new setups. Setups that already use it keep it.
- Importing an old account setup is gone for good. It was switched off in 5.9.5 and all old account data has been deleted. Old account links still open the setup page.
- Keys, sign-ins and your own stream addon links you type in before creating a setup are no longer kept in your browser's storage. They stay only while the page is open, so after a reload you enter them again. Settings that are not secret are still kept as before.
- A push to Nuvio now updates the badge pack, TMDB enrichment and playback settings in one go instead of three separate writes, and skips the write when nothing changed. This should stop one app on your account overwriting the others halfway through.

### Fixes

- Simkl and MDBList watchlist rows were always empty since 5.5. They now show your list, including rows you pushed before.
- MDBList lists with more than 100 titles now show all of them.
- Saving Custom Streams on a setup made in v5.5 or later no longer fails with "Could not protect Custom Streams".
- Movie Collections warming now uses the same poster settings as the collection page, so Pictorium and Posters+ setups get warmed copies too.

### Security

- An old settings endpoint could be told to save stream and poster settings for a setup it did not own. It now only saves for the browser's own settings, and setups made in v5.5 or later are always edited from their own setup page.
- The fingerprints that keep one setup's cached posters, ratings and streams apart from another's are much longer now, so two setups can never share a cache entry by chance. Cached pages rebuild once after the update.
- Several in-memory lists that could grow forever on a busy server now have limits.
- Many leftovers from the old account system were removed from the code, and the Docker build no longer copies private notes or tooling into the image.

### Upgrading

- Nothing to do for most people. After updating, the first page loads can be a little slower while caches rebuild, and Nuvio shows the shorter catalogue list after your next push or a restart of the app.
