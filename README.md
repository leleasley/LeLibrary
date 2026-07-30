<p align="center">
  <img src="website/public/LeLibrary.png" width="100" alt="LeLibrary">
</p>

<h1 align="center">LeLibrary</h1>

<p align="center">
  <strong>Your TorBox & Real-Debrid library. Actually organized.</strong><br>
  <sub>A Stremio & Nuvio addon + web UI that smart-groups your library, enriches it with TMDB metadata, and makes it feel like a real streaming service.</sub>
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

You add a series to your TorBox or Real-Debrid library. Now you've got 14 posters for the same show — one per file. No grouping, no season structure, no metadata. Just a wall of filenames.

That drove me crazy. So I built LeLibrary.

## The Solution

LeLibrary smart-groups your TorBox and Real-Debrid downloads into proper series with seasons and episodes, enriches everything with TMDB metadata, and serves it as a clean Stremio/Nuvio addon — plus a full web UI to browse and manage your library.

**One addon. One library. No duplicates.**

---

## Addon Core

A Stremio/Nuvio addon that turns raw TorBox and Real-Debrid downloads into a browsable catalog with full TMDB metadata.

### What it does

- **Groups episodes into seasons** — supports multi-episode packs like `S02E02-03`
- **Deduplicates series** — one poster per show, not one per file
- **Enriches everything** with TMDB metadata — posters, backdrops, ratings, cast, trailers
- **Detects anime** via TMDB (Japanese original language + Animation genre)
- **Shows only what you own** — no phantom episodes
- **Formats streams** with quality, codec, HDR, audio, size, and release group
- **Plays directly** from the CDN
- Optional **poster enhancement** via ERDB, RPDB, or Fanart.tv — ratings badges, high-res art
- Optional **ratings enrichment** from OMDB — IMDb, Rotten Tomatoes & Metacritic scores
- Optional **custom streams** — inject your own stream URLs alongside debrid results

### Catalogs

Movies, Series, and Anime appear as separate Stremio catalogs. Torrents, Usenet, and Real-Debrid are all supported. Choose to merge providers or keep them in separate catalogs.

### Cache system

| Data | TTL | Notes |
|---|---|---|
| Catalog | 1 min | Rebuilt on download hash change |
| Streams | 10 min | |
| Metadata | 24 h | |
| TMDB matches (disk) | 5 min | Failed matches retry soon |
| Background refresh | 2 min | Checks for new downloads |

Auto-invalidation compares a hash of your downloads — new files trigger an immediate catalog rebuild.

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

Choose **TorBox only**, **Real-Debrid only**, or **Both** from the config page. Catalog modes let you merge all items or keep each provider separate.

### Security

API keys are encrypted in `localStorage` using Web Crypto API (AES-256-GCM with PBKDF2, 100k iterations). The encryption password is stored in `sessionStorage` (cleared when browser closes) — you re-enter it once per browser session. Keys are only ever decrypted in memory and never written to `localStorage` in any form.

**What goes where:**
- **API keys**: encoded in the addon URL (base64 JSON with `provider`, `torboxApiKey`, `rdApiKey`, `tmdbApiKey`, plus optional `erdbToken`, `rpdbKey`, `omdbKey`, `fanartKey`, `customStreams`) — sent to the server only when Stremio/Nuvio fetches your library, never stored in a database or logged
- **Configure page**: the `/configure` page has no server-side auth — anyone with the URL can access it. No tracking, analytics, or third-party requests.

---

## Quick Deploy

### 1. Use my instance (free)

Go to **[lelibrary.uk/configure](https://lelibrary.uk/configure)**, enter your keys, generate the install link, and add it to Stremio/Nuvio. That's it.

### 2. Docker (self-hosted — recommended if you have your own domain)

```bash
git clone https://github.com/leleasley/LeLibrary.git
cd LeLibrary
cp .env.example .env
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

### 3. Vercel (free) — Retiring soon

[![Deploy with Vercel](https://camo.githubusercontent.com/7015516519ae874ab75537283bc75f86b3d46386ed994093a3790a1180913164/68747470733a2f2f76657263656c2e636f6d2f627574746f6e)](https://vercel.com/new/clone?repository-url=https://github.com/leleasley/LeLibrary)

No configuration needed. Optional: set `REDIS_URL` for persistent cache (e.g. from [Upstash](https://upstash.com)).

---

## Environment Variables

All optional — the addon works with defaults.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7860` | Server port |
| `CACHE_TTL_CATALOG` | `300` | Catalog cache TTL (seconds) |
| `CACHE_TTL_STREAM` | `1800` | Stream cache TTL (seconds) |
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
