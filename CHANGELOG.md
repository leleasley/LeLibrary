# Changelog

Notes for the current version. Every earlier version is on [GitHub Releases](https://github.com/leleasley/LeLibrary/releases).

## [5.9.0]

### Your library

- New Your genres rows, made only from what you own: every TMDB genre, over 80 themes (Zombies, Heists, Superheroes, Time Travel, Slashers, Rom-Coms, Christmas, Based on a True Story and many more) and world cinema (Anime, K-Drama, Indian, French, Nordic and more). Add any of them as a Home row or put them in a folder, like the 4K and HDR rows.
- The LeLibrary Hub gets a Genres folder with its own cover and animation. It opens on a tab for every genre you own at least 10 titles of, most-owned first, and updates each time you push.
- Genres are looked up once per title in the background, so a big library fills in over the first hour.
- The Library page now shows your library at a glance: how much is in your cloud, how many titles are in 4K and in HDR or Dolby Vision, how many arrived this week, and posters of the newest.

### A tidier setup

- Settle In is now four short pages (Connect, Setup, Home rows, Protect) and Move In five (Connect, Setup, Home, Collections, Protect). Your player login always comes first.
- The Setup page folds everything into sections (Integrations, Streams, Posters, Formatting, Preferences), each with a one-line summary of what you picked, so you only open what you want to change.
- Playback filters are redesigned: pick a preset (Everything, Best quality, Save space, Smallest files), tap resolutions on or off and drag them into order, and keep the finer options in their own folds.
- Home rows start empty: press Add rows to open a full browser (full screen on phones) and pick what goes on your Home.
- MDBList users get a short note on turning on now-watching scrobbling inside Nuvio.

### Search options

- Settle In and Move In get a Search section: choose what to search (TMDB, your library or both), order results by best match, popularity, newest or rating, and hide little-known titles (a title you type in full always shows).
- New optional search rows: Anime in its own row (and out of Series), Similar titles (search a title, get what people who liked it also watched) and People (search an actor, get their films and shows). All plain TMDB search, no AI.
- Search your collections is back as an option, off by default: a row for the films in your LeLibrary Collections.
- Rename any LeLibrary search row, or turn LeLibrary off in search entirely.

### Finishing a setup

- No more pop-up at the end. Creating a setup shows a short loading screen, then a Ready page with your push to Nuvio (showing which account it goes to, with a "Not you?" link), Add to Stremio, and a More players fold for other apps, manual setup and sharing.
- New: Revoke and regenerate. If you shared your install link by mistake, make a new one from Manual setup or the Settings page of your setup. The old link stops working straight away; your settings, keys, password and edit address stay the same, and you can push again so your player picks up the new link.

### More film collections

- Ten new packs: Heroes & Villains, Action Franchises, Sci-Fi Sagas, Fantasy Sagas, Disney Vault, Comedy Franchises, Crime & Thriller, Martial Arts, Westerns and Classic Franchises (films from TV shows, cartoons and toys). Together with the existing ones that is about 200 new collection folders, from Venom and Die Hard to Paddington, Police Academy and The Muppets.
- Packs share sagas instead of copying them: Bond, Star Wars or Rocky & Creed appear wherever they fit and are only added once.
- Kids & Family gains an Animated Sagas section (Moana, Zootopia, Trolls, Wallace & Gromit and more), Anime Hub and the Anime Fan bundle gain Anime Movie Sagas (Pokemon, Dragon Ball, One Piece, Naruto and more), and Horror Fan gains Hatchet, Silent Hill, Tremors, Leprechaun, Blair Witch, Universal Monsters, Stephen King and more.
- New actors (Arnold Schwarzenegger, Sylvester Stallone, Bruce Willis, Denzel Washington, Tom Cruise, Adam Sandler, Jim Carrey, Eddie Murphy, Rowan Atkinson), M. Night Shyamalan, and new themes such as Sharks, Dinosaurs, Disasters, Robots & AI and Courtroom Dramas.
- Batman and Spider-Man now hold every era of films.
- Adding LeLibrary Special also adds the LeLibrary Hub and your Movie Collections, since they are part of the same LeLibrary set.
- Collections now keep the order you give them on Nuvio. Your collections follow your Home rows in the order of the Collections page, Movie Collections sits wherever you put its Home row, and renaming that row renames it on Nuvio. The LeLibrary Hub can be moved and removed like any other collection.
- Every collection gets a backdrop (its own, else its pack cover or first folder), on the setup page and on Nuvio TV.
- The folder source picker lists your own LeLibrary rows first: My Movies, My Shows, 4K, HDR and every genre, theme and world cinema row. An older Hub now shows its Genres, 4K and HDR folders without being re-added.
- Posters+ preset links (the newer /p/ style, such as .../p/bar_sash/{type}/{imdb_id|tmdb_id}.jpg) now work.

### Fixes

- Director collections now hold only the films that person directed. Before, a film they wrote, produced or worked on as an assistant could appear.
- Every collection was checked against TMDB so each one holds the films it is named after.
- Better matching for downloads whose name gives too little away. A film whose title starts like a season (S4: The Bob Lazar Story) or holds a date (Turning Point: Generation 9/11) is no longer read as a TV show, and a download name with no year (The First Time, or a mostly non-English name) now uses the year and title from the film file inside it. Files that failed before are tried once more.
