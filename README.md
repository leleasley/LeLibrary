<p align="center">
  <img src="website/public/LeLibrary.png" width="100" alt="LeLibrary">
</p>

<h1 align="center">LeLibrary</h1>

<p align="center">
  <strong>Your TorBox, Real-Debrid, AllDebrid & Premiumize library. Actually organized.</strong><br>
  <sub>A Stremio & Nuvio addon + web UI that smart-groups your library, enriches it with TMDB metadata, and makes it feel like a real streaming service.</sub>
</p>

<p align="center">
  <a href="https://buymeacoffee.com/lelew" target="_blank">
    <img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=&slug=lelew&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a coffee" width="200">
  </a>
</p>

<p align="center">
  <a href="#the-problem">The Problem</a> ·
  <a href="#the-solution">The Solution</a> ·
  <a href="#addon-core">Addon</a> ·
  <a href="#website">Website</a> ·
  <a href="#quick-deploy">Deploy</a>
</p>

---

## The Problem

You add a series to your TorBox, Real-Debrid, AllDebrid or Premiumize library. Now you've got 14 posters for the same show — one per file. No grouping, no season structure, no metadata. Just a wall of filenames.

That drove me crazy. So I built LeLibrary.

## The Solution

LeLibrary smart-groups your debrid downloads into proper series with seasons and episodes, enriches everything with TMDB metadata, and serves it as a clean Stremio/Nuvio addon — plus a full web UI to browse and manage your library.

**One addon. One library. No duplicates.**

---

## Addon Core

A Stremio/Nuvio addon that turns raw TorBox, Real-Debrid, AllDebrid and Premiumize downloads into a browsable catalog with full TMDB metadata.

### What it does

- **Groups episodes into seasons** — supports multi-episode packs like `S02E02-03`
- **Deduplicates series** — one poster per show, not one per file
- **Enriches everything** with TMDB metadata — posters, backdrops, ratings, cast, trailers
- **Detects anime** via TMDB (Japanese original language + Animation genre)
- **Shows only what you own** — no phantom episodes
- **Formats streams** with quality, codec, HDR, audio, size, and release group — fully customisable presets or your own template
- **Trending & Popular discovery rows** — TMDB-powered, optionally backed by external stream addons (Torrentio, Comet, Meteor, MediaFusion)
- **LeLibrary Collections** — each franchise you own becomes a folder of plain movies
- **Plays directly** from the CDN
- Optional **poster enhancement** via ERDB, RPDB, BetterPosters or Fanart.tv — ratings badges, high-res art
- Optional **ratings enrichment** from OMDB — IMDb, Rotten Tomatoes & Metacritic scores
- Optional **custom streams** — inject your own stream URLs alongside debrid results

### Catalogs

Movies, Series, and Anime appear as separate Stremio catalogs, plus the Trending/Popular discovery rows and LeLibrary Collections. Torrents, Usenet, Real-Debrid, AllDebrid and Premiumize are all supported. Choose to merge providers or keep them in separate catalogs.

### Cache system

| Data | TTL | Notes |
|---|---|---|
| Catalog | 1 h | Rebuilt on download hash change; kept warm by background touch |
| Streams | 10 min | |
| Metadata | 24 h | |
| TMDB matches (disk) | 5 min | Failed matches retry soon |
| Background refresh | 2 min | Checks for new downloads, touches catalog TTL when unchanged |

Auto-invalidation compares a fingerprint of your downloads (`id:updated_at` per item) — new files **and** in-place edits (renames, file changes) trigger a catalog rebuild. When nothing changed, the background refresh simply extends the catalog cache TTL so it never expires and forces a slow rebuild.

### Clear cache

From the configure page (`/configure` after install), click **"Refresh catalog"** — this calls `/api/clear-cache/:token` which deletes only your cache entries. Then refresh Stremio.

---

### Optional Enhancements

All enhancements are configured from the `/configure` page and are entirely optional — the addon works perfectly with just the required API keys.

#### Poster & Ratings Enhancement

- **ERDB** (EasyRatingsDB) — Free, open-source, self-hostable. Renders IMDb/Rotten Tomatoes/Metacritic/AniList/etc ratings directly onto posters, backdrops, and logos. Get a token at [easyratingsdb.com/configurator](https://easyratingsdb.com/configurator).
- **RPDB** (Rating Poster DB) — Paid (Patreon). Similar to ERDB — renders rating badges on posters, backdrops, and logos. Key available via [Patreon](https://www.patreon.com/rpdb).
- **Fanart.tv** — Free. Provides high-resolution alternative posters, backgrounds, and logos (clean art without rating overlays). API key at [fanart.tv](https://fanart.tv).
- **OMDB** — Free (1,000 req/day). Supplements detail pages with IMDb rating, Rotten Tomatoes, Metacritic scores, and awards text. Key at [omdbapi.com](https://www.omdbapi.com/apikey.aspx).

You can use only one poster service at a time (chosen via dropdown). Background and logo enhancement can be toggled independently.

#### Custom Streams

Add your own direct stream URLs alongside debrid streams in Stremio. Useful for:
- Self-hosted media (Plex/Jellyfin/Emby direct links)
- Google Drive or other cloud-stored content
- Any HTTP-accessible video file

Configured from the `/configure` page — add entries with a name, URL, and content type (movies, series, or all).

---

## Website

A standalone website served alongside the addon, providing a client-side UI for configuration, library browsing, and content discovery — inspired by the tools we all use.

### Architecture

All website features are **client-side**. Your API keys are encrypted with your password (Web Crypto API — AES-256-GCM, PBKDF2 100k iterations) and stored in `localStorage`. The encryption password is saved to `sessionStorage` (cleared when browser closes) so you don't need to re-enter it each page load — once per browser session is enough. Keys are decrypted in memory and sent directly to APIs through thin CORS proxies. The server never sees your keys.

The server provides only thin CORS proxies for APIs that block cross-origin requests. These proxies do not log or store any data — they simply forward requests from your browser to the upstream API. Also includes **one-click key verification** (`/api/verify/erdb`, `/rpdb`, `/omdb`, `/fanart`) so you can validate tokens before saving.

### Provider Support

Choose any combination of **TorBox, Real-Debrid, AllDebrid and Premiumize** from the config page. Catalog modes let you merge all items or keep each provider separate.

### Security

API keys are encrypted in `localStorage` using Web Crypto API (AES-256-GCM with PBKDF2, 100k iterations). The encryption password is stored in `sessionStorage` (cleared when browser closes) — you re-enter it once per browser session. Keys are only ever decrypted in memory and never written to `localStorage` in any form.

**What goes where:**
- **API keys**: encoded in the addon URL as a compact base64 token (your debrid providers, TMDB key, and optional poster/rating tokens) — sent to the server only when Stremio/Nuvio fetches your library, never stored in a database or logged
- **Heavy stream settings** (custom formatter templates, custom streams, stream addon choices): saved server-side in Redis keyed by your account hash, and merged back by the addon on every request — this keeps the install URL short and means nothing can break it. These are stream settings only, never API keys
- **Configure page**: the `/configure` page has no server-side auth — anyone with the URL can access it. No tracking, analytics, or third-party requests.

### Push to Stremio / Nuvio (Beta)

Push lives at the very end of the configure flow as **Step 5: "Push to your account"** (right after the install links are generated). Sign in with Stremio or Nuvio, pick your catalogues, and push — no copy/pasting URLs. It is **fully client-side**: the browser talks directly to the platform's own API and the auth token never touches this server.

**Stremio** — email + password sign-in (the only supported method). Credentials are sent only to Stremio's `POST /api/login`; the returned session token is used for the push and saved in the browser's `localStorage` so you stay signed in.

**Nuvio** — email + password sign-in. It shows a loading state, then loads your **Nuvio profiles** into a dropdown so you can pick which profile to install on.

The push **adds or updates only LeLibrary** — all your other addons are preserved (a backup list of your previous addon URLs is still shown at the end). The normal install links from Step 4 remain available.

Stremio flow:

```
POST https://api.strem.io/api/login               { type: 1, email, password }   → { result: { authKey, user } }
POST https://api.strem.io/api/addonCollectionGet  { authKey }                    → { result: { addons: [...] } }   (backup)
POST https://api.strem.io/api/addonCollectionSet  { authKey, addons }            → { result: { msg } }             (replace)
```

The addon descriptor is built from the live manifest as `{ transportUrl, transportName, flags, manifest }`. Errors (invalid credentials, expired session, rate limits, "Max descriptor size reached") are surfaced inline.

Nuvio flow (email/password → profiles → replace addons → push collections):

```
POST https://api.nuvio.tv/auth/v1/token?grant_type=password   { email, password }  → { access_token, user }
POST https://api.nuvio.tv/rest/v1/rpc/sync_pull_profiles      {}                   → profiles
POST https://api.nuvio.tv/rest/v1/rpc/get_sync_owner          {}                   → owner id
GET  https://api.nuvio.tv/rest/v1/addons?select=*&user_id=eq.X&profile_id=eq.Y     → existing (backup)
POST https://api.nuvio.tv/rest/v1/addons                      [{ user_id, profile_id, url, name, enabled, sort_order }]
POST https://api.nuvio.tv/rest/v1/rpc/sync_push_collections   { p_profile_id, p_collections_json }
```

(Headers for Nuvio calls carry `apikey: <Nuvio's public publishable key>` and, once signed in, `Authorization: Bearer <access_token>`.)

**Catalogues (Beta):** the Catalogues tab is an editor for which catalogues get pushed — **LeLibrary Collections** (each franchise you own becomes a folder of plain movies, never a series), plus **Trending** and **Popular** (TMDB-driven discovery rows). Importing catalogues/collections from other addons is planned. Pushing itself happens on the Setup tab (Step 5).

**Stream Addons (Beta):** in the Setup tab you can enable external stream addons (Torrentio, Comet, Meteor, MediaFusion) that LeLibrary pulls streams from server-side. These power the **Trending** and **Popular** discovery rows only — your library rows (My Movies, My Series, LeLibrary Collections) keep using your own debrid copies and are never touched. None are enabled by default.

**Franchise folders:** in Nuvio, "LeLibrary Collections" has one folder per franchise showing its films as plain movies; in Stremio each franchise is its own movie catalogue row. New films added to a franchise you already own appear automatically. A brand-new franchise needs one re-push so its folder/row is added.

**Privacy implications:** the Stremio / Nuvio session token is saved in the browser's `localStorage` on the user's own device so they stay signed in across refreshes. It is never written to `sessionStorage`, cookies, or logs, and never sent to LeLibrary's servers. On load the saved session is re-validated against the platform in the background (Nuvio's access token is refreshed automatically); if it has expired the user is prompted to sign in again. **Disconnect** clears it from `localStorage`. Each push targets the signed-in user's own account — nobody else's.

---

## Quick Deploy

### 1. Use my instance (free)

Go to **[lelibrary.uk/configure](https://lelibrary.uk/configure)**, enter your keys, generate the install link, and add it to Stremio/Nuvio. That's it.

### 2. Docker (self-hosted — recommended if you have your own domain)

```bash
git clone https://github.com/leleasley/LeLibrary.git
cd LeLibrary
cp .env.example .env
cp compose.example.yml compose.yml
docker compose up -d --build
```

Open `http://localhost:7860/configure` and enter your API keys.

**Commands:**
```bash
docker compose logs -f          # watch logs
docker compose restart          # restart
docker compose down             # stop
docker compose up -d --build    # rebuild after changes
```

## Environment Variables

All optional — the addon works with defaults.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7860` | Server port |
| `CACHE_TTL_CATALOG` | `3600` | Catalog cache TTL (seconds) |
| `CACHE_TTL_STREAM` | `600` | Stream cache TTL (seconds) |
| `REDIS_HOST` | — | Redis host (`redis` for Docker Compose) |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | — | Redis password |
| `REDIS_TLS` | `false` | Enable TLS |
| `REDIS_URL` | — | Full Redis URL |
| `UPSTASH_REDIS_URL` | — | Upstash compatibility alias |

---

## Troubleshooting

**Empty catalog** — Check API keys. Only `completed`, `seeding`, `cached`, `finalized` downloads are shown.

**New movie not showing** — Click **"Refresh catalog"** on the configure page, then refresh Stremio.

**No streams** — Stream links expire after a few hours. Close and reopen the title in Stremio.

**Wrong episodes** — Clear cache via the refresh button and reload.

**Anime in Series** — TMDB must tag it as Japanese + Animation genre.

---

## License

MIT
