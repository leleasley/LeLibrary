# Changelog

Notes for the current version. Every earlier version is on [GitHub Releases](https://github.com/leleasley/LeLibrary/releases).

## [6.0.0]

### New

- A new layout for every setup page. The steps sit along the top, a side panel shows how far along your setup is (what is required, what is optional, your collections, folders and sources) and Continue is always in view at the bottom, so you never have to scroll down to find it. On phones the top bar has buttons for Preview and Arrange home.
- Arrange home: drag your collections and Home rows into the order they should appear in Nuvio, from any step. Collections always stay above your Home rows, as Nuvio shows them.
- Preview your setup as it looks in Nuvio. Press Open preview (on phones, the play button at the top) on any setup page, while creating or editing, and a full screen copy of Nuvio opens: your Home rows in order with real posters, your collections and folders, a details page with sample streams in your stream style, on a phone layout or a TV layout. Stremio has its own view too. It shows your unsaved changes and never pushes or saves anything.
- A new API keys section. TMDB, TVDB, OMDb and MDBList now have the same cards as the library providers, and the MDBList card shows which account it is connected to.
- A separate Integrations section for Simkl and AniList. Once you connect, the card shows the account name straight away.
- Simkl rows: connect Simkl to add Up Next, Airing Next, Plan to Watch, Watching and Completed rows.
- Your MDBList lists: with an MDBList key you can pick your own lists, the lists you liked, your watchlist and Up Next straight from the Home rows and folder pickers, without adding each list somewhere else first.
- AniList rows: connect AniList to get Watching, Plan to Watch and Completed anime rows, private lists included.
- Content filters, on Settle In and Move In: one Setup section with Use Main Metadata, Hide anime, Hide adult content and the categories you want left out (Anime, Animation, Reality TV, Talk Shows, Kids, Family, Musical, Documentary, News, Soap Operas, Horror). A title is hidden when any of its categories is ticked, everywhere Hide anime already worked: My Movies, My Shows, the Hub, collections and search. Hide adult content drops titles TMDB flags as adult or rates NC-17 or X (films) and TV-MA (shows); unrated titles stay. Titles TMDB has not described yet are never hidden by a guess.
- TorBox sources now look like proper cards (Torrents, Usenet, Web downloads), and Use Main Metadata says plainly that turning it on lets your library rows bring through streams you have enabled, so leave it off if you only want your own files.
- Nuvio now lists far fewer LeLibrary catalogues. Collection folders already shared one catalogue, but every pack source was still listed on its own as a hidden row, so a setup with packs showed well over a hundred catalogues in Nuvio. Only the rows you actually picked for Home are listed now. Push again or restart Nuvio to see the smaller list.

### Changes

- On the edit page, connecting or disconnecting Simkl, AniList or Trakt now waits for Save like every other change. The card says "not saved yet" until you save, and Clear my edits undoes it.
- Clicking a key card now also switches it on, the same as clicking its switch.
- Buttons that cannot be pressed yet (for example Unlock before you type a password) now look greyed out instead of ready.
- In the Collections picker, LeLibrary's own essentials are listed first.
- AniList can only be connected now. The old username option is gone: a saved username is not shown, cannot be added and no longer serves any rows. Connect AniList to keep your anime rows.
- Library row names are no longer on Settle In or Move In. Rows are named where you add them, in Home rows; names already saved keep working.
- Trakt can no longer be connected to new setups. Setups that already use it keep it.
- Importing an old account setup is gone for good. It was switched off in 5.9.5 and all old account data has been deleted. Old account links still open the setup page.
- Keys, sign-ins and your own stream addon links you type in before creating a setup are no longer kept in your browser's storage. They stay only while the page is open, so after a reload you enter them again. Settings that are not secret are still kept as before.
- A push to Nuvio now updates the badge pack, TMDB enrichment and playback settings in one go instead of three separate writes, and skips the write when nothing changed. This should stop one app on your account overwriting the others halfway through.

### Fixes

- Importing a public Nuvio collection that uses Nuvio's own TMDB or Trakt lists (for example "no addons" packs) brought the folders in with 0 sources. Every source now comes across and is sent to Nuvio as the pack has it. If you imported one of these before, remove it and import it again.
- Simkl and MDBList watchlist rows were always empty since 5.5. They now show your list, including rows you pushed before.
- MDBList lists with more than 100 titles now show all of them.
- Saving Custom Streams on a setup made in v5.5 or later no longer fails with "Could not protect Custom Streams".
- Movie Collections warming now uses the same poster settings as the collection page, so Pictorium and Posters+ setups get warmed copies too.

### Security

- A Cloudflare check now appears under the password when you create a setup or unlock one to edit it, and the button waits until the check has passed. It only appears on sites that have Turnstile set up; self-hosted installs without it work as before.
- Setup pages can no longer be shown inside another website's frame, which protects the password screens from click-jacking tricks.
- An old settings endpoint could be told to save stream and poster settings for a setup it did not own. It now only saves for the browser's own settings, and setups made in v5.5 or later are always edited from their own setup page.
- The fingerprints that keep one setup's cached posters, ratings and streams apart from another's are much longer now, so two setups can never share a cache entry by chance. Cached pages rebuild once after the update.
- Several in-memory lists that could grow forever on a busy server now have limits.
- Many leftovers from the old account system were removed from the code, and the Docker build no longer copies private notes or tooling into the image.

### Upgrading

- Nothing to do for most people. After updating, the first page loads can be a little slower while caches rebuild, and Nuvio shows the shorter catalogue list after your next push or a restart of the app.
