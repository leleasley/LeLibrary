// @ts-nocheck
'use strict';

// Cross-provider ID mapping (imdb <-> tmdb/tvdb), sourced from the keyless
// Wikidata-Fetcher CSVs that AIOStreams also uses. It lets us resolve a
// `tt` id without a TMDB /find or /external_ids call, and resolve a TMDB id
// back to `tt` without /external_ids.
//
// Layout: both directions are kept as sorted Int32Array columns so lookups are
// a binary search and the whole thing is a few MB of RAM:
//   forward  (imdb -> tmdb/tvdb) : fKey / fTmdb / fTvdb, sorted by fKey
//   reverse  (tmdb -> imdb)      : rTmdb / rImdb,         sorted by rTmdb
// Movie and TV ids live in separate namespaces, so each gets its own table.
//
// The dataset is a hint, not the authority: TMDB's own external_ids still
// wins when it is already cached, and any miss falls through to the normal
// per-provider lookup. IDs claimed by more than one title are dropped (upstream
// Wikidata conflicts), matching AIOStreams' conflict handling.

const axios = require('axios');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const MOVIE_URL = process.env.ID_MAP_MOVIE_URL
  || 'https://raw.githubusercontent.com/0xConstant1/Wikidata-Fetcher/main/data/movie_mappings.csv';
const TV_URL = process.env.ID_MAP_TV_URL
  || 'https://raw.githubusercontent.com/0xConstant1/Wikidata-Fetcher/main/data/tv_mappings.csv';
const REFRESH_MS = Math.max(3600, parseInt(process.env.ID_MAP_REFRESH_SECONDS, 10) || 86400) * 1000;
const MAX_BYTES = 60 * 1024 * 1024;
// Persisted processed copy so a restart loads instantly and survives GitHub
// being unreachable at boot. Point at a mounted volume to keep it across
// container recreates.
const BIN_PATH = process.env.ID_MAP_PATH || path.join(os.tmpdir(), 'lelibrary-id-map.bin');

// On-disk layout: header + the ten sorted columns. Counts in the header are
// the forward (imdb-keyed) and reverse (tmdb-keyed) lengths per table.
//   0  u32 magic
//   4  u32 version
//   8  u32 movie forward count
//  12  u32 movie reverse count
//  16  u32 tv forward count
//  20  u32 tv reverse count
//  24  f64 lastUpdated
//  32  data: movie fKey,fTmdb,fTvdb,rTmdb,rImdb then tv fKey,fTmdb,fTvdb,rTmdb,rImdb
const MAGIC = 0x4c4c4944; // 'LLID'
const VERSION = 1;
const HEADER_BYTES = 32;

function emptyTable() {
  return {
    fKey: new Int32Array(0), fTmdb: new Int32Array(0), fTvdb: new Int32Array(0),
    rTmdb: new Int32Array(0), rImdb: new Int32Array(0),
  };
}

let movie = emptyTable();
let tv = emptyTable();
let ready = false;
let started = false;
let loading = null;

function imdbToNum(value) {
  const m = /^tt(\d{1,10})$/i.exec(String(value || '').trim());
  return m ? Number(m[1]) : 0;
}

// IMDb ids are stored numerically to keep the columns compact. Rebuild the
// canonical form with the 7-digit zero padding older titles use (newer
// 8-digit ids are unaffected by a minimum width of 7).
function formatImdb(num) {
  return `tt${String(num).padStart(7, '0')}`;
}

// Exact-index binary search on a sorted Int32Array, or -1.
function find(arr, value) {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = arr[mid];
    if (v === value) return mid;
    if (v < value) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

function parseCsv(text) {
  const rows = [];
  const lines = String(text || '').split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(',');
    const imdb = imdbToNum(parts[0]);
    if (!imdb) continue;
    const tvdb = parts[1] ? (Number(parts[1]) || 0) : 0;
    const tmdb = parts[2] ? (Number(parts[2]) || 0) : 0;
    if (!tmdb && !tvdb) continue;
    rows.push([imdb, tmdb, tvdb]);
  }
  return rows;
}

function buildTable(rows) {
  // Collapse to one row per imdb id (last non-zero value wins per provider).
  const merged = new Map();
  for (const [imdb, tmdb, tvdb] of rows) {
    const existing = merged.get(imdb);
    if (!existing) merged.set(imdb, [tmdb, tvdb]);
    else {
      if (tmdb) existing[0] = tmdb;
      if (tvdb) existing[1] = tvdb;
    }
  }
  // A tmdb id claimed by more than one imdb id is ambiguous: drop it.
  const claimant = new Map();
  const conflicted = new Set();
  for (const [imdb, [tmdb]] of merged) {
    if (!tmdb) continue;
    const first = claimant.get(tmdb);
    if (first === undefined) claimant.set(tmdb, imdb);
    else if (first !== imdb) conflicted.add(tmdb);
  }

  const keys = Int32Array.from(merged.keys()).sort();
  const fTmdb = new Int32Array(keys.length);
  const fTvdb = new Int32Array(keys.length);
  const reverse = [];
  for (let i = 0; i < keys.length; i++) {
    const [tmdb, tvdb] = merged.get(keys[i]);
    const keep = tmdb && !conflicted.has(tmdb) ? tmdb : 0;
    fTmdb[i] = keep;
    fTvdb[i] = tvdb || 0;
    if (keep) reverse.push([keep, keys[i]]);
  }
  reverse.sort((a, b) => a[0] - b[0]);
  const rTmdb = new Int32Array(reverse.length);
  const rImdb = new Int32Array(reverse.length);
  for (let i = 0; i < reverse.length; i++) {
    rTmdb[i] = reverse[i][0];
    rImdb[i] = reverse[i][1];
  }
  return { fKey: keys, fTmdb, fTvdb, rTmdb, rImdb };
}

function columns(table) {
  return [table.fKey, table.fTmdb, table.fTvdb, table.rTmdb, table.rImdb];
}

function totalInts(movieTable, tvTable) {
  return 3 * movieTable.fKey.length + 2 * movieTable.rTmdb.length
    + 3 * tvTable.fKey.length + 2 * tvTable.rTmdb.length;
}

function encode(movieTable, tvTable) {
  const ints = totalInts(movieTable, tvTable);
  const out = Buffer.allocUnsafe(HEADER_BYTES + ints * 4);
  out.writeUInt32LE(MAGIC, 0);
  out.writeUInt32LE(VERSION, 4);
  out.writeUInt32LE(movieTable.fKey.length, 8);
  out.writeUInt32LE(movieTable.rTmdb.length, 12);
  out.writeUInt32LE(tvTable.fKey.length, 16);
  out.writeUInt32LE(tvTable.rTmdb.length, 20);
  out.writeDoubleLE(Date.now(), 24);
  let offset = HEADER_BYTES;
  for (const column of [...columns(movieTable), ...columns(tvTable)]) {
    Buffer.from(column.buffer, column.byteOffset, column.byteLength).copy(out, offset);
    offset += column.byteLength;
  }
  return out;
}

function decode(buf) {
  if (!buf || buf.length < HEADER_BYTES || buf.readUInt32LE(0) !== MAGIC) return null;
  if (buf.readUInt32LE(4) !== VERSION) return null;
  const movieForward = buf.readUInt32LE(8);
  const movieReverse = buf.readUInt32LE(12);
  const tvForward = buf.readUInt32LE(16);
  const tvReverse = buf.readUInt32LE(20);
  const ints = 3 * movieForward + 2 * movieReverse + 3 * tvForward + 2 * tvReverse;
  if (buf.length !== HEADER_BYTES + ints * 4) return null;
  const body = buf.subarray(HEADER_BYTES);
  const aligned = (body.byteOffset & 3) === 0 ? body : Buffer.from(body);
  const all = new Int32Array(aligned.buffer, aligned.byteOffset, ints);
  let at = 0;
  const take = (length) => { const view = all.subarray(at, at + length); at += length; return view; };
  const table = (forward, reverse) => ({
    fKey: take(forward), fTmdb: take(forward), fTvdb: take(forward),
    rTmdb: take(reverse), rImdb: take(reverse),
  });
  const movieTable = table(movieForward, movieReverse);
  const tvTable = table(tvForward, tvReverse);
  return { movie: movieTable, tv: tvTable, lastUpdated: buf.readDoubleLE(24) };
}

function readFromDisk() {
  try {
    return decode(fs.readFileSync(BIN_PATH));
  } catch {
    return null;
  }
}

async function writeToDisk() {
  try {
    const buf = encode(movie, tv);
    const tmp = `${BIN_PATH}.tmp`;
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, BIN_PATH);
  } catch (err) {
    console.warn('[IDMap] cache write failed:', err.message);
  }
}

async function download(url) {
  const res = await axios.get(url, {
    responseType: 'text',
    timeout: 60000,
    maxContentLength: MAX_BYTES,
    maxBodyLength: MAX_BYTES,
    headers: { 'User-Agent': 'LeLibrary/5.2' },
  });
  return typeof res.data === 'string' ? res.data : String(res.data || '');
}

async function load() {
  const [movieCsv, tvCsv] = await Promise.all([download(MOVIE_URL), download(TV_URL)]);
  // Build both tables before swapping so a failed build leaves the old map.
  const nextMovie = buildTable(parseCsv(movieCsv));
  const nextTv = buildTable(parseCsv(tvCsv));
  movie = nextMovie;
  tv = nextTv;
  ready = true;
  console.log(`[IDMap] loaded movie=${movie.fKey.length} tv=${tv.fKey.length}`);
  await writeToDisk();
}

function loadNow() {
  if (loading) return loading;
  loading = load()
    .catch((err) => { console.warn('[IDMap] load failed:', err.message); })
    .finally(() => { loading = null; });
  return loading;
}

// Fire-and-forget startup + daily refresh. Never blocks the server.
function start() {
  if (started) return;
  started = true;
  if (process.env.ID_MAP_DISABLED === 'true') {
    console.log('[IDMap] disabled via ID_MAP_DISABLED');
    return;
  }
  // Load the persisted copy first so lookups work immediately and survive a
  // GitHub outage at boot. Only hit the network now if it is missing or older
  // than the refresh interval.
  const cached = readFromDisk();
  if (cached) {
    movie = cached.movie;
    tv = cached.tv;
    ready = true;
    console.log(`[IDMap] loaded from cache movie=${movie.fKey.length} tv=${tv.fKey.length}`);
  }
  const age = cached ? Date.now() - cached.lastUpdated : Infinity;
  if (age > REFRESH_MS) loadNow();
  const timer = setInterval(loadNow, REFRESH_MS);
  timer.unref?.();
}

function isReady() { return ready; }

// `tt` id -> TVDB id, or null. Wikidata's map carries tvdb for both movie and
// tv rows; prefer the requested media type but fall back to the other table.
function imdbToTvdb(imdbId, mediaType) {
  if (!ready) return null;
  const num = imdbToNum(imdbId);
  if (!num) return null;
  const order = mediaType === 'movie' ? [movie, tv]
    : (mediaType === 'tv' || mediaType === 'series') ? [tv, movie]
    : [tv, movie];
  for (const table of order) {
    const index = find(table.fKey, num);
    if (index >= 0 && table.fTvdb[index]) return table.fTvdb[index];
  }
  return null;
}

// TMDB id -> TVDB id via the IMDb id, or null. No extra network call.
function tmdbToTvdb(mediaType, tmdbId) {
  const imdb = tmdbToImdb(mediaType, tmdbId);
  return imdb ? imdbToTvdb(imdb, mediaType) : null;
}

// TMDB id -> `tt` id, or null. mediaType is 'movie' or 'tv'/'series'.
function tmdbToImdb(mediaType, tmdbId) {
  if (!ready) return null;
  const table = mediaType === 'tv' || mediaType === 'series' ? tv : movie;
  const id = Number(tmdbId) || 0;
  if (!id) return null;
  const index = find(table.rTmdb, id);
  return index >= 0 ? formatImdb(table.rImdb[index]) : null;
}

// `tt` id -> { tmdbId, type } (type is 'movie' | 'series'), or null.
function imdbToTmdb(imdbId) {
  if (!ready) return null;
  const num = imdbToNum(imdbId);
  if (!num) return null;
  let index = find(movie.fKey, num);
  if (index >= 0 && movie.fTmdb[index]) return { tmdbId: movie.fTmdb[index], type: 'movie' };
  index = find(tv.fKey, num);
  if (index >= 0 && tv.fTmdb[index]) return { tmdbId: tv.fTmdb[index], type: 'series' };
  return null;
}

export interface IdMapApi {
  start: any;
  isReady: any;
  tmdbToImdb: any;
  imdbToTmdb: any;
  imdbToTvdb: any;
  tmdbToTvdb: any;
}

module.exports = { start, isReady, tmdbToImdb, imdbToTmdb, imdbToTvdb, tmdbToTvdb } satisfies IdMapApi;
