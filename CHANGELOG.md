# Changelog

Notes for the current version. Every earlier version is on [GitHub Releases](https://github.com/leleasley/LeLibrary/releases).

## [5.9.6]

### Security hardening

- A setup without a password can now only be opened for editing with its own install link. Before, knowing its setup id was enough. Every setup made through the setup pages already has a password, so this closes a gap rather than changing anything for most people.
- The install links LeLibrary keeps for each library are now encrypted in the database, like every other saved key, and are no longer sent back in library status replies.
- Self-hosted: the server's setup key is never replaced on its own. If it cannot be read, LeLibrary now stops and says so, instead of quietly making a new key that would lock you out of your saved setups.
- Self-hosted: saved configs only include API keys when you send your own SELFHOST_CONFIGS_SECRET header, never for an ordinary visitor of your site.
- Server logs no longer contain any part of an install link.

### Fixes

- If your saved settings fail to load when you open your setup, you now see an error and can try again, instead of an empty page that looked like your settings were gone.
- Background jobs that keep failing now give up after a fixed number of tries.
