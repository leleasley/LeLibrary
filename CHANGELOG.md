# Changelog

Notes for the current version. Every earlier version is on [GitHub Releases](https://github.com/leleasley/LeLibrary/releases).

## [5.8.0]

### Manage Nuvio from your setup

- The edit page has a new Nuvio view. Sign in once and manage each profile from LeLibrary: turn addons on or off, reorder, rename, remove or add them, and see your Home rows, collections and playback settings.
- Profiles can be created, renamed, recoloured, copied and deleted. Deleting asks you to type the profile's exact name first.
- LeLibrary takes a backup before every change it makes to Nuvio. You can restore a backup or undo the last change at any time.
- Home rows now show their real catalogue names instead of internal ids.
- Settle In now signs in to Nuvio or Stremio at the start, like Move In. Creating a Settle In or Move In setup fills in playback and Hide unreleased from your Nuvio profile, and the edit page shows what the profile has set right now.

### Collections

- 19 new packs and bundles: Streaming by Region, Seasonal and Holidays, Horror Vault, Kids and Family, World TV and Dramas, Anime Hub, Shared Universes, Cinephile and Arthouse, Moods and Vibes, Based On, History and War, Sports Music and Performance, Charts and What's Hot, plus Starter, Cinephile, Family, Anime Fan, Horror Fan and Binge TV bundles.
- A new pack picker: bundles first, search and filters, covers and folder counts, a look inside every pack where you can untick single folders, no duplicate folders, and a meter for how full your Nuvio Home will be.
- Streaming services outside your region are hidden, seasonal packs show up in season, and Hide anime now applies in the picker.
- Packs built on MDBList charts stay locked until an MDBList key is saved under Optional list sources.
- New packs now show up straight away instead of after a day.

### LeLibrary's own artwork

- Every collection folder now has LeLibrary's own cover and animated focus art, designed in-house from film stills, posters and official logos. The community artwork used before has been retired. Thank you to everyone who shared it.
- Live rows such as Trending, charts and streaming services redraw their covers by themselves as their titles change, at the same link, so Nuvio picks up the new art without pushing again.
- Franchises fan out their own posters with the real title logo and the run of years. Genres, moods and decades use timeless stills, so they do not date.
- Collections you already pushed switch to the new art on their own.

### Fixes

- Many catalogues pointed at the wrong studio, network, service or keyword and showed the wrong titles. They are corrected, broken collections and dead lists are replaced, and decade rows each have their own list.
- Streaming service rows use the region of your setup language (English is the UK).
- The poster preview in setup no longer redraws non-stop, and previews load faster.
- The setup pages load faster, most noticeably on slow connections and VPNs: much smaller images, no outside font service, and fewer requests.
- Folder artwork links in the collection editor are always full links.
