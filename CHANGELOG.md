# Changelog

Notes for the current version. Every earlier version is on [GitHub Releases](https://github.com/leleasley/LeLibrary/releases).

## [5.9.5]

### Security

- Closed a security issue in the old-setup import. Importing an old account setup by email did not check that the request came from the account owner, so someone who knew an old account's email address could read that old setup's saved keys and sign-ins. Importing by email has been switched off and the "Bring your old setup across" card has been removed, ahead of its planned removal in v6.
- Setups created in v5.5 or later were never affected. Only accounts from the old account system, before v5.5, were.
- If you used LeLibrary's old account system before v5.5, we recommend you reset the keys and sign-ins it held: your debrid API key (TorBox, Real-Debrid, AllDebrid or Premiumize), your TMDB and MDBList keys, and sign out of Nuvio, Trakt or Simkl and back in.

### Heads up for v6

- The remaining old account data, including every email address still stored from the old setups, is deleted in v6.
