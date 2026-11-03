# Changelog

Notes for the current version. Every earlier version is on [GitHub Releases](https://github.com/leleasley/LeLibrary/releases).

## [5.9.3]

### Fixes

- The poster style you pick is the one you get. Before, a ratings key saved earlier (for example an ERDB token brought across from an old setup, which the setup page no longer showed) could take over every poster, so switching to BetterPosters or another style seemed to do nothing.
- Posters inside LeLibrary Movie Collections folders load again. They could stay blank on Nuvio, and they now fall back to the normal poster when a ratings service fails.
- Posters+ preset links (such as .../p/bar_sash/{type}/{imdb_id|tmdb_id}.jpg) are accepted again. Some browsers kept an older copy of the setup page's poster helper and rejected them; the setup page now always loads the current one.

### Heads up for v6

- Bringing an old setup across from the old account system ends in v6. The Import old setup button goes away then, and every email address still stored from the old setups is deleted from our database. If you still have an old setup to move, do it before v6.
