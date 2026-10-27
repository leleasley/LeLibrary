# Changelog

Notes for the current version. Every earlier version is on [GitHub Releases](https://github.com/leleasley/LeLibrary/releases).

## [5.7.0]

### Library

- Choose which TorBox downloads make up your library: torrents, usenet, web downloads, or any mix. If you only want the NZBs you add yourself in My Movies and My Shows, untick Torrents and Web downloads. Unticked downloads are left out of every catalogue, collection and search, and stay in your TorBox account untouched. All three are on by default, so nothing changes unless you pick. Find it under library options in Quick Look and in the Metadata step of Settle In and Move In, and on your setup's edit page.
- Changing the choice updates your library straight away. Downloads you turn back on return after LeLibrary matches them again; any fixes you made on your Library page are kept.

### Matching

- Films whose file name year is right are no longer hidden by a different US release date. Soul (2020), Cam (2018) and M (1931) used to fail or match the wrong film because TMDB was asked for US dates, where Soul is listed as 2024.
- Short titles shared by several films of the same year (Prey, Vice, Life, Run, CODA, Sing and many more) now go to the well-known film when it clearly stands out, instead of failing. A real tie is still left for you to fix.
- A film that TMDB dates one year after its release name (300, Bug, May) is found again.
- A movie name that carries its IMDb id (for example "{imdb-tt0116191}") is matched by that id.
- Several films that were matched to the wrong title are now corrected, for example Bad Trip, Brick, The Hunt, Mr. Nobody and Triangle. Every library re-checks its matches once in the background after this update; a title never loses its match because of the re-check.

### Home rows

- Your Simkl, Trakt and MDBList watchlists can now be picked, ordered and renamed as Home rows in Settle In and Move In. On Nuvio, only the watchlists you pick appear on Home; the others stay available in Discover. Setups made before this update keep their watchlists on Home, and the edit page shows them as picked rows.

### Nuvio

- Pushing a setup to a Nuvio profile now changes only that profile. It used to remove LeLibrary's collections and Home rows from every other profile on the account, so two people could not each have their own setup. Now everyone in a household can push their own setup to their own profile.
- New in the Playback step of Settle In and Move In: "Only auto-play LeLibrary's streams". With it on, Nuvio's auto-play never picks a source from your other addons, so it plays the copy you own; you can still choose another source from the list yourself. Switching it off later puts Nuvio back to every source, unless you picked your own addons in Nuvio, which are left as they are.

### Monitoring

- The hosted status page now shows the latest database backup result and the time of the last successful backup. This is hosted-only and adds no setup requirement for self-hosted installs.
