<p align="center">
  <img src="website/public/LeLibrary.png" width="100" alt="LeLibrary">
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
  <a href="https://lelibrary.uk/account">Account</a> ·
  <a href="https://github.com/leleasley/LeLibrary/releases">Releases</a>
</p>

## What LeLibrary does

LeLibrary turns downloads from TorBox, Real-Debrid, AllDebrid and Premiumize into a clean media library for Stremio and Nuvio.

- Groups episodes into series, seasons and episodes.
- Shows only content that exists in your library.
- Adds posters, backdrops, ratings, descriptions, cast and trailers through TMDB.
- Detects anime and provides a dedicated anime catalogue.
- Supports native movie and series search from inside Stremio and Nuvio.
- Returns standard IMDb-style `tt...` IDs for discovery and search results.
- Keeps library content in the private `torbox:` namespace by default.
- Supports configurable stream names and descriptions.
- Supports optional poster, rating and artwork providers.

## Install

### Hosted installation

1. Open [lelibrary.uk/configure](https://lelibrary.uk/configure).
2. Choose your debrid provider and enter the required keys.
3. Add your TMDB key for metadata and search.
4. Generate the addon link.
5. Install the link in Stremio or Nuvio.

### Self-hosted installation

Create an empty directory for LeLibrary and generate its local secret:

```bash
mkdir lelibrary && cd lelibrary
umask 077
printf 'SELFHOST_CONFIGS_SECRET=%s\n' "$(openssl rand -hex 32)" > .env
```

Save the following as `compose.yml` in that directory:

```yaml
services:
  lelibrary:
    image: ghcr.io/leleasley/lelibrary:latest
    container_name: lelibrary
    restart: unless-stopped
    ports:
      - "7860:7860"
    environment:
      REDIS_HOST: redis
      REDIS_PORT: 6379
      # Loaded automatically from the .env file generated above.
      # Compose refuses to start when the value is missing or empty.
      SELFHOST_CONFIGS_SECRET: ${SELFHOST_CONFIGS_SECRET:?Generate SELFHOST_CONFIGS_SECRET in .env first}
    depends_on:
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:7860/health"]
      interval: 60s
      timeout: 5s
      retries: 3

  redis:
    image: redis:7-alpine
    container_name: lelibrary-redis
    restart: unless-stopped
    volumes:
      - lelibrary-data:/data
    command: redis-server --save 60 1 --loglevel warning --maxmemory 512mb --maxmemory-policy allkeys-lfu
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 3s
      retries: 3

volumes:
  lelibrary-data:
```

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
image: ghcr.io/leleasley/lelibrary:v5.1.0
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

Self-hosted saved setups require `SELFHOST_CONFIGS_SECRET` in `.env`. The Configure page uses it automatically; command-line requests can authenticate with the `x-selfhost-secret` header. Keep this value private and regenerate it if the instance is exposed publicly. Without it, the saved-setups list on the Configure page shows as disabled rather than failing silently.

Your saved setups, library caches and stream settings live in the `lelibrary-data` volume. `docker compose down` and upgrades are safe; `docker compose down -v` wipes them.

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
for the public release workflow. The dedicated ignore file prevents hosted
account code, private website files, secrets and development files from entering
the GHCR build context.

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

## Collections and accounts

Hosted users can sign in at [lelibrary.uk/account](https://lelibrary.uk/account).

The account area provides:

- Profile-aware collection configuration.
- Separate Nuvio and Stremio destinations.
- Presets and a Collections Wizard.
- Home-row configuration.
- List importing and metadata resolution.
- Collection item previews with posters and resolution status.
- Separate Nuvio profile handling.

Collections are scoped to the account, destination and selected profile. Nuvio collections do not automatically become Stremio configuration, and one Nuvio profile does not inherit another profile's LeLibrary configuration.

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
- Hosted account secrets are encrypted at rest.
- Browser-side configuration uses encrypted local storage.
- Account sessions use secure cookies and CSRF protection.
- The addon does not require tracking or analytics.

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

## Third-party artwork

Optional Nuvio collection packs include locally served artwork imported from
[`rrevanth/nuvio-assets`](https://github.com/rrevanth/nuvio-assets) and
[`ImKaptain/nuvio-assets`](https://github.com/ImKaptain/nuvio-assets), and
[`luckynumb3rs/stremio-perfect-setup`](https://github.com/luckynumb3rs/stremio-perfect-setup).
Additional community-curated artwork is documented in the asset provenance file.
Each imported file retains its source path in
`website/public/collection-assets/sources.json`.

## License

MIT
