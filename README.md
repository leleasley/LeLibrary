<p align="center">
  <img src="frontend/public/LeLibrary.png" width="100" alt="LeLibrary">
</p>

<h1 align="center">LeLibrary</h1>

<p align="center">
  <strong>Your debrid library, organised for Stremio and Nuvio.</strong><br>
  <sub>Movies, series, anime, native search, metadata and streams in one addon.</sub>
</p>

<p align="center">
  <a href="https://buymeacoffee.com/lelew" target="_blank">
    <img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=&slug=lelew&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a coffee" width="200">
  </a>
</p>

<p align="center">
  <a href="https://lelibrary.uk/configure">Configure LeLibrary</a> ·
  <a href="SETUP.md">Setup guide</a> ·
  <a href="https://github.com/leleasley/LeLibrary/releases">Releases</a>
</p>

## Start here

New to LeLibrary, or not sure which option to pick? **[SETUP.md](SETUP.md)** walks
through the hosted setup, a self-hosted install, editing a setup later, and how
to find or move an existing setup. The short version is below.

## What LeLibrary does

LeLibrary turns downloads from TorBox, Real-Debrid, AllDebrid and Premiumize into a clean media library for Stremio and Nuvio: one addon where you pick a title and your own copy plays first, with catalogues, collections and extra stream sources built in.

- Groups episodes into series, seasons and episodes.
- Shows only content that exists in your library.
- Adds posters, backdrops, ratings, descriptions, cast and trailers through TMDB.
- Detects anime and provides a dedicated anime catalogue.
- Supports native movie and series search from inside Stremio and Nuvio.
- Returns standard IMDb-style `tt...` IDs for discovery and search results.
- Keeps library content in the private `torbox:` namespace by default.
- Plays your own copy first; optional stream sources (Torrentio, Comet, Meteor,
  MediaFusion, Jackettio, KNABEN, or up to three addons of your own such as
  StreamNZB) line up underneath in your order. Meteor also searches Usenet when
  your TorBox plan is Pro.
- Rename your library rows, and back up a setup's settings to a file to start a
  new setup from it.
- Supports configurable stream names and descriptions.
- Supports optional poster, rating and artwork providers.

## Install

### Hosted installation

1. Open [lelibrary.uk/configure](https://lelibrary.uk/configure) and pick a setup level:
   **Quick Look**, **Settle In** or **Move In**. The
   [guide](https://lelibrary.uk/guide) has a short video of each.
2. Choose your debrid provider and enter the required keys.
3. Add your TMDB key for metadata and search.
4. Choose a setup password. You get an install link of the form
   `https://lelibrary.uk/{setup-id}.{secret}/manifest.json`.
5. On the finish screen, press **Open in Stremio**, or **Copy for Nuvio** and
   paste the link into Nuvio's addons. Settle In and Move In can also push
   straight to a Nuvio profile.

The install link is the read capability: clients can use it with no password.
The password only unlocks editing at `https://lelibrary.uk/{setup-id}`. Save
both, because there is no account and no recovery flow.

### Self-hosted installation

Copy [`compose.example.yml`](compose.example.yml) to `compose.yml` and
[`.env.example`](.env.example) to `.env`, then set the values described in the
comments:

```bash
mkdir lelibrary && cd lelibrary
curl -fsSLO https://raw.githubusercontent.com/leleasley/LeLibrary/main/compose.example.yml
mv compose.example.yml compose.yml
curl -fsSLO https://raw.githubusercontent.com/leleasley/LeLibrary/main/.env.example
mv .env.example .env
chmod 600 .env
```

At minimum, set `DB_PASSWORD`, `CONFIG_SECRET` and `SELFHOST_CONFIGS_SECRET` in
`.env`. Generate keys with `openssl rand -hex 32`.

The compose file runs LeLibrary with Postgres (the indexed library engine) and
Redis (cache), and keeps `/data` in a named volume so the generated setup key
survives upgrades. Only the app port is published: Postgres and Redis stay
inside the Compose network.

Start the stack, then open `http://localhost:7860/configure`:

```bash
docker compose up -d
```

This deployment pulls the official GitHub Container Registry image and does
not require Git or a copy of the source repository. Redis is kept private
inside the Compose network; the `lelibrary-data` volume stores saved setups and
caches across upgrades and container recreation.

The image supports 64-bit Intel/AMD and ARM systems. Stable releases publish
`vX.Y.Z`, `vX.Y`, `vX` and `latest` tags. Preview releases publish only their
exact version tag. To pin or roll back, change the tag directly on the `image:`
line in `compose.yml`, for example:

```yaml
image: ghcr.io/leleasley/lelibrary:v5.5.0
```

Then run `docker compose pull && docker compose up -d`. Keep the generated
secret in `.env`; the selected image version and any port or memory-limit
customisation belong in `compose.yml`.

Useful maintenance commands:

```bash
# Check container health and recent output
docker compose ps
docker compose logs --tail=100 lelibrary

# Upgrade within the selected image tag
docker compose pull
docker compose up -d

# Back up Redis before maintenance
docker compose exec redis redis-cli SAVE
docker compose cp redis:/data/dump.rdb ./lelibrary-redis-backup.rdb
```

`docker compose down` preserves saved setups and caches. `docker compose down
-v` permanently removes the Redis volume and resets all self-hosted saved data.
Restore a backup only while Redis is stopped, then start the stack again.

```bash
docker compose stop redis
docker compose cp ./lelibrary-redis-backup.rdb redis:/data/dump.rdb
docker compose start redis
```

`SELFHOST_CONFIGS_SECRET` in `.env` unlocks the self-host features, including the
**Back to a previous setup** list on `/configure`. The page sets an access cookie
automatically; command-line requests can authenticate with the
`x-selfhost-secret` header. Keep the value private and regenerate it if the
instance is exposed publicly.

The list shows only setup names, tiers, password flags and dates, never install
secrets. On a shared instance set `SELFHOST_LIST_SETUPS=off` to hide it; pasting
a setup id or link still works.

Full walkthrough, including finding a setup on another device:
**[SETUP.md](SETUP.md)**.

Your saved setups, library index, caches and stream settings live in the
`lelibrary_data`, `postgres_data` and `redis_data` volumes. `docker compose down`
and upgrades are safe; `docker compose down -v` wipes them.

No account is needed to self-host: the update check, key verification, catalogue library and curated packs all work without signing in. The provider status pill and `/status` page are hosted-only and hidden on self-hosted installs.

### Verifying image provenance

Images published by the Release workflow include a GitHub/Sigstore-signed SLSA
build-provenance attestation and an SBOM. Verify a specific released image with
the GitHub CLI:

```bash
gh attestation verify \
  oci://ghcr.io/leleasley/lelibrary:vX.Y.Z \
  --repo leleasley/LeLibrary \
  --signer-workflow leleasley/LeLibrary/.github/workflows/release.yml
```

Replace `vX.Y.Z` with the exact release tag, or preferably pin the image by its
digest. A failed verification means the image was not produced by LeLibrary's
Release workflow.

### Build from source

Contributors who deliberately clone the repository can replace the `image:`
line in `compose.yml` with `build: .` and run `docker compose up -d --build`.
Release users should prefer the standalone published GHCR image above.

The normal `Dockerfile` is for local and hosted development builds.
`Dockerfile.ghcr` and its matching `Dockerfile.ghcr.dockerignore` are reserved
for the public release workflow. The dedicated ignore file prevents private
hosted files, secrets and development files from entering the GHCR build
context.

## Providers

You can use one or more of:

- TorBox
- Real-Debrid
- AllDebrid
- Premiumize

Providers can be merged into shared library rows or displayed separately.

## IDs and search

LeLibrary uses two public identity modes:

- `torbox:` IDs are used by the private library mode for My Movies, My Series and the existing LeLibrary-owned library collections. This keeps those streams isolated from other addons.
- Bare IMDb IDs such as `tt0468569` are used by discovery, native search and optional Main IDs mode. These IDs allow Nuvio and Stremio to use their normal metadata and stream ecosystem.
- Anime integrations may use `kitsu:...` IDs where appropriate.

Search is built into the addon. The combined setting shows separate global
Movies and Series results followed by My Movies, My Shows and LeLibrary
Collections. You can instead show only the global TMDB-backed sections or only
your owned-library sections. Global results use canonical IMDb IDs; owned
results keep your selected library ID mode.

## Setups, collections and home rows

Every setup is saved server-side and addressed by its install link. There is no
account to create and nothing to sign in to: the link is what Stremio and Nuvio
read, and the setup password only unlocks editing.

The setup flow offers three levels:

- **Quick Look**: library, posters, a Nuvio badge pack and the stream style.
- **Settle In**: Quick Look plus Home rows, playback filters, extra stream
  sources and Nuvio playback settings.
- **Move In**: everything, including collections, folders, Quick Packs and a
  one-click push to Nuvio.

To change a setup later, open its edit link (`/{setup-id}`) and enter the
password: the page you built it on opens with everything filled in. You can
also move a setup to another level there; it keeps the same install link. See
[Editing a setup](SETUP.md#editing-a-setup).

Collections are scoped to a setup and its destination. Nuvio collections do not
automatically become Stremio configuration, and one Nuvio profile does not
inherit another profile's LeLibrary configuration. Adding a new franchise to
Nuvio needs one re-push; existing folders refresh on their own.

## Metadata and artwork

TMDB is used for the main metadata layer and is required for the richest experience. Optional services include:

- ERDB for rating artwork.
- RPDB for rating artwork.
- Fanart.tv for additional posters, backgrounds and logos.
- OMDB for additional ratings and awards information.
- Custom Poster URL templates for direct artwork from a compatible HTTPS image
  service. Templates must contain an IMDb or TMDB ID placeholder and may use
  `{type}` for `movie` or `series` artwork.

These options are configured from the hosted configure page.

## Stream formatting

LeLibrary includes presets for common stream layouts, including LeLibrary, TorBox, Torrentio, GDrive, Prism and Tamtaro styles. You can also create custom stream name and description templates.

## Privacy and security

- Provider keys are not written to application logs.
- Saved setup keys are encrypted at rest with a server-held key, so a database
  dump is not readable on its own.
- The setup password is only an edit gate; it is never stored in the clear and
  is rate limited per IP and per setup.
- Reading a setup needs nothing but its install link, which is why the link
  itself must stay private.
- The addon does not use tracking or analytics.

Never share an addon URL that contains your private configuration.

## Troubleshooting

### My library is empty

Check that the provider key is valid and that the downloads have completed or are available to the provider. Use **Refresh catalog** on the configure page, then refresh Stremio or Nuvio.

### Search does not show results

Make sure a valid TMDB key is configured and reinstall or refresh the addon manifest after changing the configuration.

### A title has no streams

Owned library rows use the private `torbox:` namespace. Discovery and Main IDs rows use standard IMDb IDs and can use external stream addons when those addons are installed in the client.

### Nuvio metadata looks basic

Nuvio's richer metadata sections require a valid TMDB key in Nuvio's own settings on the active profile. Bare IMDb IDs are required for Nuvio's full enrichment pipeline.

## Special thanks

Thank you to the people in the Stremio and Nuvio community whose work ships
with LeLibrary:

**Stream badges** (the quality and format badges in stream lists):

- [vowl313](https://github.com/vowl313) for
  [NardBadges](https://github.com/vowl313/NardBadges).
- [leonevz](https://github.com/leonevz) for
  [Elite Badges](https://github.com/leonevz/Elite-Badges).
- [sweatycab](https://github.com/sweatycab) for
  [Nuvio Minimalist Badges](https://github.com/sweatycab/nuvio-minimalist-badges).
- [9mousaa](https://github.com/9mousaa) for
  [BetterFormatter](https://github.com/9mousaa/BetterFormatter) and its badges.

**Posters and metadata**: [TMDB](https://www.themoviedb.org/),
[Fanart.tv](https://fanart.tv/), [RPDB](https://ratingposterdb.com/),
[BetterPosters](https://btttr.cc/), ERDB, Pictorium and
[Posters+](https://github.com/UmbraProjects/PostersPlus). This product uses the
TMDB API but is not endorsed or certified by TMDB.

The full list of projects LeLibrary relies on is on the
[Supporters page](https://lelibrary.uk/supporters).

**Collection artwork**: every collection folder's cover and focus GIF is
LeLibrary's own, drawn in code from TMDB stills, posters and official logos
(see `frontend/public/collection-assets/ASSET_SOURCES.md`). Live rows such as
Trending, charts and streaming services are redrawn by the server as their
titles change. The community artwork used before 5.8 has been retired; thank
you to everyone who shared it.

## License

LeLibrary is licensed under the [GNU Affero General Public License v3.0](LICENSE)
(AGPL-3.0-only).

In short: you can self-host it, read it and change it. If you run a modified
version as a service other people use, you must publish your changes under the
same licence. Releases up to and including v5.5.0 were published under MIT and
stay available under those terms.
