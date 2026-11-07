# Setting up LeLibrary

LeLibrary turns the downloads in your debrid account into a clean library for
Stremio and Nuvio. You need one debrid account (TorBox, Real-Debrid, AllDebrid
or Premiumize) and a free TMDB API key. Nothing else is required to start.

There are three ways in:

- **Hosted**: use [lelibrary.uk/configure](https://lelibrary.uk/configure) and
  let the site host the setup for you.
- **Self-hosted**: run the Docker image on your own machine or server.
- **Moving an existing setup**: open it by its link and edit it. An older
  (pre-5.5) setup cannot be imported; create a new one instead.

Every setup ends with one thing: an install link. Keep it.

---

## Hosted setup

1. Open [lelibrary.uk/configure](https://lelibrary.uk/configure).
2. Pick how much you want to set up now. You can move up a level later
   without reinstalling (see [Editing a setup](#editing-a-setup)).
   - **Quick Look** (about 2 minutes): your library, posters, a Nuvio badge
     pack and the stream style, on one page.
   - **Settle In** (about 5 minutes): Quick Look plus Home rows, playback
     filters, search options, extra stream sources and Nuvio playback
     settings, on four short pages.
   - **Move In** (about 10 minutes): everything, including collections and
     folders, Quick Packs and a one-click push to Nuvio, on five pages.
   The [guide](https://lelibrary.uk/guide) has a short video walkthrough of
   each level.
3. Turn on your debrid service and paste its key. The page checks it before
   you continue.
4. Add your TMDB key. Matching, posters, search and Nuvio's detail pages all
   depend on it. TVDB and OMDb keys are optional.
5. Choose a setup password (at least 8 characters). It only protects editing;
   installing never asks for it.
6. Press **Create my manifest** (Quick Look) or **Create my setup** (Settle In
   and Move In).

### Settle In and Move In, page by page

- **Connect**: pick Nuvio or Stremio and sign in (optional, but it lets
  LeLibrary push your Home rows and collections for you) and name the setup.
- **Setup**: one page of sections. Each starts closed and shows a one-line
  summary of what you picked; open only what you want to change.
  - **API keys**: your debrid keys (Library providers), then TMDB (required),
    TVDB, OMDb and MDBList (Metadata and lists). Once an MDBList key is
    checked, the card shows which MDBList account it belongs to.
  - **Integrations** (optional): Simkl, and AniList by public username or a
    connect for private lists. Each adds its personal rows (Up Next, Watching,
    Plan to Watch and more) to the Home rows and folder pickers.
  - **Streams**: playback filters (presets such as Best quality or Save
    space, resolutions you can tap and reorder, size limits), extra stream
    sources and your own addons.
  - **Search**: see [Search options](#search-options).
  - **Posters**: poster style and rating badges.
  - **Formatting**: Nuvio badge pack and how streams are written.
  - **Preferences**: language, library order, Main Metadata, hide anime,
    TorBox sources, stream notices, library row names and Nuvio playback.
- **Home rows** (Move In: **Home**): starts empty. Press **Add rows** to pick
  what goes on your Home screen (full screen on a phone), then drag to order.
- **Collections** (Move In only): Quick Packs and your own folders. On Nuvio
  your collections always sit above your Home rows, in the order of this page.
  **LeLibrary Movie Collections** (franchise folders built from the films you
  own) is a card here too: move it, rename it or remove it. Its folders are
  made for you, so they cannot be edited.
- **Protect**: your password, then **Create my setup**.

### When it is created

Quick Look's finish screen has **Open in Stremio** (installs in one click),
**Copy for Nuvio** (paste it into Nuvio's addons) and copy buttons for other
apps (STRMR, Fusion, Vidi, WuPlay).

Settle In and Move In show a short "Creating your setup" screen, then a
**Ready** page:

- **Push to Nuvio** (or Stremio) sends your Home rows and collections to the
  account you signed in with. It says which account (**Pushing to ...**);
  press **Not you?** to sign in with another.
- **Add to Stremio** opens the install link in Stremio or copies it.
- **More players** holds the other apps, sharing (Move In) and **Manual
  setup**: the install link, the collections file, **Clear cached data** and
  **Revoke and regenerate** (see [If your install link leaks](#if-your-install-link-leaks)).

Every level gives you:

- the **install link**, which looks like
  `https://lelibrary.uk/{setup-id}.{secret}/manifest.json`
- the **setup id** and the **edit link** (`https://lelibrary.uk/{setup-id}`)

Keep the install link and your password. The install link is what Stremio and
Nuvio read. It needs no password, which is why it must stay private: anyone
holding it can watch from your library. There is no account, no email and no
recovery. If you lose both, you start a new setup.

---

## Editing a setup

1. Open your edit link, `https://lelibrary.uk/{setup-id}`. A box asks for your
   password, with the setup id already filled in.
2. Enter the password. The same page you created the setup on opens, with
   every key, choice, Home row and collection already filled in. Saved keys
   arrive filled in but hidden; edit one only if you want to replace it.
3. Change anything and press **Save** (in the bar along the top, or on the
   last page). Only what you changed is sent, and your install link stays
   exactly the same, so nothing needs reinstalling.

The **Settings** tab on that page also lets you:

- **Switch level**, for example from Quick Look up to Move In. The switch is
  staged and only happens when you save (a **Save changes** bar appears right
  there); the setup keeps the same id and install link.
- copy your install link again, or **Regenerate link** if it leaked,
- **Download settings backup**,
- **Clear my edits** to throw away unsaved changes,
- **Delete** the setup.

Settle In and Move In setups can push again to Nuvio from the same page after
a save.

### Preview

The **Preview** tab on the edit page shows what your player will show, using
what is saved now: on Nuvio your collections first, then your Home rows in
order, with real posters; tap a collection to see its folders and a folder to
see what is inside it. Switch to **Stremio** to see its board rows instead.
Preview only reads: it never pushes or saves anything. If you have unsaved
changes, save first to see them.

### Your library

Once a setup is unlocked, the edit page has a **Library** tab. It
shows what LeLibrary found in your debrid account (or WebDAV server) and how it
matched each file:

- The top of the tab shows your library at a glance: how much is in your
  cloud, how many titles are in 4K and in HDR or Dolby Vision, how many
  arrived this week, and posters of the newest.
- **Need attention** lists files that could not be matched, with the reason.
  Press **Fix** to pick the right film or show (search by title, TMDB id or IMDb
  id; for a show you can pick the season or episode). **Ignore** hides a file
  that is not a film or show at all. Both can be undone.
- **Try matching again** retries everything that failed.
- A fix you make here also helps other people: once two or more libraries agree
  on the same fix for the exact same release, LeLibrary uses it for others whose
  matching failed. One person's fix never spreads on its own.

Box sets are split automatically: a folder holding several films (a complete
Fast and Furious collection, a director's films) shows up as one entry per film,
each playing its own file. Miniseries split into parts (Part 1, Part 2) become
episodes. Nothing in your account is moved or copied.

New downloads usually appear within about 30 seconds while you are using the
addon, and within a few minutes otherwise.

---

## More options worth knowing

- **Rename your library rows.** Call "My Movies" whatever you like. On Quick
  Look this is under **Your library rows** in step 1, where you can also hide
  a row you do not want. On Settle In and Move In it is under **Library row
  names** in Setup > Preferences (visibility there comes from your Home rows).
- **Language.** Quick Look has the metadata language under **More library
  options**; Settle In and Move In have it in Setup > Preferences.
- **Choose your TorBox sources.** By default your library holds everything in
  your TorBox account: torrents, usenet and web downloads. Untick any of them
  to leave them out of My Movies, My Shows, collections and search, for
  example to keep only the NZBs you add yourself. Quick Look has it under
  **More library options**; Settle In and Move In have it in Setup >
  Preferences. At least one stays on. Your TorBox account itself is not changed.
- **Add your own stream addon** (Settle In and Move In, Setup > Streams). Paste
  the link to any Stremio stream addon you use, such as StreamNZB or your own
  AIOStreams, up to three. It joins the stream source list and follows your
  order. The link is stored sealed with your keys and is never shown again;
  remove it and add it again to change it. The hosted site only reaches public
  HTTPS addons.
- **Your genres rows** (Settle In and Move In). In **Add rows**, the **Your
  genres**, **Your themes** and **Your world cinema** groups have a row per
  genre, theme (Zombies, Heists, Time Travel...) and world cinema (Anime,
  K-Drama...), made only from what you own. Use them as Home rows or in a
  folder. On Move In the LeLibrary Hub also has a **Genres** folder: it shows
  a tab for every genre you own at least 10 titles of, most-owned first, and
  is updated each time you push.
  Genres are looked up once per title in the background, so on a big library
  the rows fill in over the first hour. They need the library database
  (always on the hosted site; self-hosters need Postgres).
- **Settings backup.** On your setup's edit page, **Download settings backup**
  saves the setup's settings to a file. Keys, your password and player logins
  are never included. On the setup page, **Start from a settings backup** fills
  in a brand-new setup from that file: you add your own keys and password and
  get a new install link. Handy for setting someone else in your home up the
  same way.

---

## Search options

Settle In and Move In have a **Search** section on the Setup page. It decides
which LeLibrary rows appear when you search in Nuvio or Stremio. Everything is
plain TMDB search; nothing here uses AI.

- **Include LeLibrary in search**: turn it off to search with your other
  addons only.
- **What to search**: TMDB and your library (separate rows), only your
  library, or only TMDB.
- **Order results by**: best match, most popular, newest first or highest
  rated (titles with only a few votes sit below properly rated ones).
- **Hide little-known results**: leaves out titles hardly anyone has rated. A
  title you type in full always shows.
- **Anime in its own row**: anime gets its own row and leaves the Series row.
  Not available while **Hide anime** is on.
- **Similar titles row**: search a title and get a row of titles people who
  liked it also watched. It only appears when your search clearly names one
  title.
- **People row**: search an actor ("tom hanks") and get their films and shows.
  It only appears when your search spells the person's name.
- **Search your collections** (off by default): adds a row for the films in
  your LeLibrary Collections. They are already in My Movies, so they can show
  twice.
- **Rename rows**: change what any of these rows is called in your player.

After saving, reinstall the addon in Stremio, or push again to Nuvio, so the
player picks up the new rows.

---

## If your install link leaks

Anyone with your install link can watch from your library. If you shared it
by mistake, make a new one:

1. Open your edit link and unlock it, or use the Ready page right after
   creating a setup.
2. Press **Regenerate link** (Settings tab, or at the bottom of **Manual
   setup**) and confirm.
3. The old link stops working straight away. Your settings, keys, password and
   edit link stay exactly the same.
4. Add the new link to every device you watch on. For Nuvio, press **Push to
   Nuvio again** and it picks up the new link itself.

---

## Self-hosted setup

You need Docker with the Compose plugin. LeLibrary runs from the published
image (`ghcr.io/leleasley/lelibrary`); you never build anything.

### 1. Make a folder and a `.env`

```bash
mkdir -p /opt/lelibrary && cd /opt/lelibrary
```

Create `.env` in that folder with your secrets (then `chmod 600 .env`):

```bash
# A strong password for the bundled Postgres.
DB_PASSWORD=change-me-to-something-long
# Seals saved keys. Generate with: openssl rand -hex 32
CONFIG_SECRET=
# Unlocks the self-host features. Generate with: openssl rand -hex 32
SELFHOST_CONFIGS_SECRET=
```

Every other option is listed, with an explanation, in
[`.env.example`](.env.example). Add any you want to the same `.env`.

### 2. Create `compose.yml`

Save this as `compose.yml` next to `.env`. It is the same file as
[`compose.example.yml`](compose.example.yml).

```yaml
services:
  lelibrary:
    image: ghcr.io/leleasley/lelibrary:latest
    container_name: lelibrary
    restart: unless-stopped
    # Secrets and any extra option from .env.example live in .env next to
    # this file (chmod 600). The lines under `environment:` win over it.
    env_file:
      - .env
    environment:
      - TZ=Europe/London
      - PORT=7860
      # Seals every saved setup's keys. Generate once with `openssl rand -hex 32`
      # and keep it safe: losing it makes saved setups unreadable.
      - CONFIG_SECRET=${CONFIG_SECRET}
      # Unlocks the self-host features, including the saved-setups list.
      - SELFHOST_CONFIGS_SECRET=${SELFHOST_CONFIGS_SECRET}
      # Library index + saved setups. Remove to run without a database.
      # Recommended: use a normal login instead of the superuser, see SETUP.md
      # (lelibrary_app with ${DB_APP_PASSWORD}).
      - DATABASE_URL=postgres://lelibrary:${DB_PASSWORD}@postgres:5432/lelibrary
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      # Optional. Hide the saved-setups list on an instance shared with others.
      # - SELFHOST_LIST_SETUPS=off
      # Optional. Let "Add your own addon" reach your own network (StreamNZB on
      # the LAN or Tailscale). Never on an instance other people use.
      # - CUSTOM_ADDONS_ALLOW_PRIVATE=on
      # Optional. Stream sources your server cannot reach (for example if
      # Torrentio blocks its IP): shown as unavailable and skipped.
      # - STREAM_ADDONS_UNAVAILABLE=torrentio
      # Optional. Use your own WebDAV server (NAS, rclone, Nextcloud,
      # Synology) as a library. Playback streams through this server.
      # - WEBDAV_SOURCE=on
      # Also needed when that WebDAV server is on your own network.
      # - WEBDAV_ALLOW_PRIVATE=on
      # Minutes between WebDAV scans (default 15, minimum 5).
      # - WEBDAV_SCAN_MINUTES=15
    volumes:
      # Keeps the generated setup key if CONFIG_SECRET is left empty.
      - lelibrary_data:/data
    ports:
      - 7860:7860 # Remove if a reverse proxy on the same network serves it
    mem_limit: 1g
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:7860/health"]
      interval: 60s
      timeout: 5s
      retries: 3
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    # networks:
    #   - default
    #   - proxy

  postgres:
    image: postgres:16-alpine
    container_name: lelibrary-db
    restart: unless-stopped
    environment:
      - POSTGRES_USER=lelibrary
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=lelibrary
    volumes:
      - postgres_data:/var/lib/postgresql/data
    mem_limit: 512m
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U lelibrary -d lelibrary"]
      interval: 30s
      timeout: 5s
      retries: 5
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    # No ports: only LeLibrary talks to the database.

  redis:
    image: redis:7-alpine
    container_name: lelibrary-redis
    restart: unless-stopped
    # Cache only, capped. Safe to empty at any time; setups live in Postgres.
    command: redis-server --save 60 1 --loglevel warning --maxmemory 512mb --maxmemory-policy allkeys-lfu
    volumes:
      - redis_data:/data
    mem_limit: 768m
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 3s
      retries: 3
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    # No ports: only LeLibrary talks to the cache.

volumes:
  lelibrary_data:
  postgres_data:
  redis_data:

# Using a reverse proxy (Caddy, Traefik, Nginx Proxy Manager) on a shared
# Docker network? Uncomment this and the `networks:` block under lelibrary.
# networks:
#   proxy:
#     external: true
```

### 3. Start it

```bash
docker compose up -d
docker compose logs -f lelibrary   # Ctrl+C to stop watching
```

Open `http://your-server:7860/configure` and use the same steps as the hosted
setup.

**Stremio needs HTTPS** for an addon on another device (a TV, a phone). Put
LeLibrary behind your reverse proxy with a domain: uncomment the `networks`
blocks, remove the `ports` line, and point the proxy at `lelibrary:7860`. With
Caddy that is one site block:

```
lelibrary.example.com {
  reverse_proxy lelibrary:7860
}
```

Install links then use your domain automatically.

To update: `docker compose pull && docker compose up -d`.

### 4. What each container does

- `lelibrary`: the addon, setup pages and API.
- `postgres`: the library index and the saved setups.
- `redis`: cache only. It can be emptied without losing setups.

Only the app port is published. Postgres and Redis stay on the Compose network.

### 5. Keep these safe

- `.env`, especially `CONFIG_SECRET` and `SELFHOST_CONFIGS_SECRET`.
- The `lelibrary_data` volume (holds the generated setup key when
  `CONFIG_SECRET` is unset).
- The `postgres_data` volume (holds the setups).
- Each setup's install link and password.

Backups: `docker compose exec postgres pg_dump -U lelibrary lelibrary > backup.sql`
plus a copy of `.env`. Restoring the same `.env` and database restores every
setup.

### 6. Optional: run the database as a normal login (recommended)

Out of the box the Postgres image makes `lelibrary` a database **superuser**,
and LeLibrary logs in with it. Everything LeLibrary sends to the database is
parameterised, but a separate login with only the rights it needs is good
practice: if anything ever went wrong, a normal login cannot create users,
read other databases or run commands on the server.

1. Back up first (see above).
2. Add a long random password to `.env`:

   ```bash
   echo "DB_APP_PASSWORD=$(openssl rand -hex 32)" >> .env
   ```

3. Download
   [`selfhost/postgres-app-role.sql`](https://github.com/leleasley/LeLibrary/blob/main/selfhost/postgres-app-role.sql)
   next to your `compose.yml` and run it once. It creates the login
   `lelibrary_app` and hands it the LeLibrary database and tables. It is safe to
   run again and deletes nothing.

   ```bash
   set -a; . ./.env; set +a
   docker compose exec -T -e DB_APP_PASSWORD postgres \
     psql -v ON_ERROR_STOP=1 -U lelibrary -d lelibrary < postgres-app-role.sql
   ```

4. In `compose.yml`, change LeLibrary's `DATABASE_URL` line to use the new
   login, then restart:

   ```yaml
         - DATABASE_URL=postgres://lelibrary_app:${DB_APP_PASSWORD}@postgres:5432/lelibrary
   ```

   ```bash
   docker compose up -d
   ```

Keep `DB_PASSWORD` too: it is still the admin login for backups and upgrades
(`pg_dump -U lelibrary` keeps working). To undo, put the old `DATABASE_URL`
line back and restart.

---

## Your own WebDAV server (self-hosted only)

A self-hosted LeLibrary can read a WebDAV server as a library, next to (or
instead of) a debrid service: a NAS, `rclone serve webdav`, Nextcloud or
Synology. Its videos are matched and shown in My Movies and My Shows like a
debrid library.

1. Add `WEBDAV_SOURCE=on` to the `lelibrary` environment in `compose.yml`.
   If the WebDAV server is on your own network (almost always), add
   `WEBDAV_ALLOW_PRIVATE=on` too. Never set these on an instance other people
   use. Restart with `docker compose up -d`.
2. In the setup, open **Your own WebDAV server** under the providers, fill in
   the address, username and password, and press **Check connection**.

Example addresses:

| Server | Address |
|---|---|
| rclone `serve webdav` | `http://192.168.1.10:8080/` |
| Nextcloud | `https://cloud.example.com/remote.php/dav/files/USERNAME/` (use an app password if you have two-factor login) |
| Synology | `https://nas.local:5006/` |

Good to know:

- **Playback goes through this LeLibrary server.** Players cannot send a
  WebDAV password, so LeLibrary fetches the file and passes it on, with
  seeking. It uses this server's bandwidth.
- **New files show up within 15 minutes** (`WEBDAV_SCAN_MINUTES`). Each folder
  that holds videos becomes one title; videos loose in a "Movies" style folder
  are one title each.
- **Plain `http://` is only accepted for servers on your own network.** Over
  the internet, use `https://`.
- **Only Basic login is supported** (every server above uses it). Apache
  setups that require Digest login are not.
- **Using TorBox, Premiumize, AllDebrid or Real-Debrid?** Add that service
  directly instead of its WebDAV: it plays straight from the service and is
  faster.
- The address, username and password are sealed like your other keys and are
  never shown again. To change them, type them again.

## Nuvio playback (Settle In and Move In only)

Settle In and Move In include a **Nuvio playback** block in Setup >
Preferences. It appears only when the setup is going to Nuvio.

1. Turn on **Set these in Nuvio when I push**.
2. Choose Auto Stream Selection:
   - **Manual (choose stream)**: always show the source list.
   - **Auto-play first source**: play the first available source.
   - **Auto-play regex match**: play the first source whose text matches your
     pattern, for example `(2160p|4k|remux)`.
3. Optionally turn on **Auto-play next episode**.

### Keep watching the same batch

LeLibrary gives episodes from the same owned download a shared binge group.
In Nuvio TV's playback settings, enable **Prefer Binge Group** and **Auto-play
next episode**, then choose the English-dub batch for an episode. Nuvio can
use that group to find the next episode in the same download. **Reuse Binge
Groups** can also remember the group when you return to the show. Settings
and behavior may differ in other Nuvio clients and versions.

This is a preference, not a guarantee: if the matching episode is missing or
slow to arrive, Nuvio may fall back to another source depending on its settings
and playback path. Check the source and audio, especially when changing seasons
or downloads, and select manually when necessary. Restricting auto-play to
LeLibrary's streams does not distinguish two batches within LeLibrary.

Alternatively, **Auto-play regex match** can select text unique to the English
release in the displayed source text. Check that it matches each episode; a
filename label is not proof of the audio track, and a pattern that matches both
releases cannot distinguish them.

The values are written to the Nuvio profile you selected when you press the
setup's push button. Nuvio applies them on its next sync. If you leave the block
off, your existing Nuvio player settings are not touched.

Quick Look does not show this block because it has no Nuvio sign-in.

### Nuvio library (unreleased titles)

Settle In and Move In also include a **Nuvio library** block with an
**Unreleased content** choice:

- **Leave unchanged**: keep whatever your Nuvio profile already has.
- **Hide unreleased movies and shows**: hide titles that have not been released
  yet on Home, search and recommendations.
- **Show unreleased titles**: show upcoming titles as well.

The choice is written to the Nuvio profile you selected when you press the
setup's push button, and Nuvio applies it on its next sync. It is also available
from the edit page.

## Finding a setup again

### On the same browser

`/configure` keeps a short list of setups you created or unlocked there. Click
one to open its password page, or forget it from the list.

### On another device, or after clearing browser data

If the self-hoster set `SELFHOST_CONFIGS_SECRET`, the same page lists the 10
most recent setups saved on that instance. Only the name, tier, password flag
and dates are shown. The install link itself is never listed, because the
server cannot hand back the secret.

If the list is not available, paste any of these into the box under the tier
cards and press **Open**:

- the setup id: `123e4567-e89b-12d3-a456-426614174000`
- the edit link: `https://your-instance/123e4567-e89b-12d3-a456-426614174000`
- the install link: `https://your-instance/123e4567-....{secret}/manifest.json`

The pasted secret is discarded; only the setup id is used. You still need the
password to change anything.

### If the operator turned the list off

Setting `SELFHOST_LIST_SETUPS=off` hides the server list on a shared instance.
The paste box and each setup's own link keep working.

---

## Moving from an older version

Old configurations still work through their own install link. There is no
way to import an old setup or old account into a new one: that import was
closed in 5.9.5 for security reasons and removed in v6, and the old account
data has been deleted. To move to a current setup, create a new one with Quick
Look, Settle In or Move In and enter your keys again.

An older link that points at `/{token}/configure`, or an old account link
under `/accounts/...`, now opens the setup picker at `/configure`.

---

## Troubleshooting

**The saved setups section is missing.**
It only appears when `SELFHOST_CONFIGS_SECRET` is set and
`SELFHOST_LIST_SETUPS` is not `off`. Restart the container after changing
`.env`.

**I forgot the password.**
There is no reset. The install link still works for watching. Create a new
setup and delete the old one from its edit page (the password is required to
delete too), or remove the row from Postgres.

**My library is empty.**
Check the provider key and that the downloads exist on the provider. Use
**Clear cached data** (edit page, **More players** > **Manual setup**), then
reopen the addon in Stremio or Nuvio. The first index can take a few minutes
on a large account. The **Library** tab on the edit page shows anything that
could not be matched.

**Search returns nothing.**
Add a valid TMDB key to the setup. The native search catalogs only appear after
a TMDB key is saved. Also check that **Include LeLibrary in search** is on
(Setup > Search), then reinstall or push again.

**I shared my install link.**
See [If your install link leaks](#if-your-install-link-leaks).

**A title has no streams.**
Library rows use the private `torbox:` namespace and are answered by LeLibrary
only. Discovery and Main IDs rows use IMDb ids and can use external stream
addons installed in the same client.

**Nuvio's detail page looks basic.**
Nuvio builds production logos, collections, recommendations and clickable cast
itself. It needs a TMDB key in Nuvio's own settings on the active profile, and
bare IMDb ids (turn on **Use Main Metadata** in Setup > Preferences) rather than `torbox:`
ids.

**Setup storage is unavailable.**
The setup routes need Postgres. Check `DATABASE_URL`/`DB_PASSWORD` and that the
`postgres` container is healthy.

---

## Security notes

- Keys and sign-ins you type in before creating a setup are held only while
  the page is open, never in your browser's storage. After a reload, enter
  them again; your other choices are kept.
- Provider keys are never written to logs. Saved keys are sealed on the server,
  so a database dump is not readable on its own.
- The install link is a capability. Treat it like a password. Use **Regenerate
  link** if it leaks (see [If your install link leaks](#if-your-install-link-leaks)).
- The setup password is stored hashed and rate limited per IP and per setup.
- No tracking, no analytics and no advertising cookies.
