'use strict';

// Auto-updating scene-title mappings, sourced from Sonarr's public
// scene-mapping list (the same feed AIOStreams uses). Scene releases routinely
// use a different name than the show's official title ("BBC QI XL" vs
// "BBC QI XL (Quite Interesting)", "CSI Las Vegas" vs "CSI"), so mapping the
// release name back to the searchable title fixes a whole class of mismatches
// without a code change per show.
//
// Only entries whose title actually differs from its searchTitle are kept, so
// the map is a few hundred rows. Loaded in the background, refreshed daily and
// cached on disk so restarts are instant.

const axios = require('axios');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeTitle } = require('./title-aliases');

const SCENE_URL = process.env.SCENE_MAP_URL || 'https://services.sonarr.tv/v1/scenemapping';
const REFRESH_MS = Math.max(3600, parseInt(process.env.SCENE_MAP_REFRESH_SECONDS, 10) || 86400) * 1000;
const MAX_BYTES = 40 * 1024 * 1024;
const CACHE_PATH = process.env.SCENE_MAP_PATH || path.join(os.tmpdir(), 'lelibrary-scene-map.json');

let sceneMap = new Map();
let ready = false;
let started = false;
let loading = null;

function buildMap(rows) {
  const map = new Map();
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    const title = row && row.title;
    const search = row && row.searchTitle;
    if (typeof title !== 'string' || typeof search !== 'string' || !search.trim()) continue;
    const key = normalizeTitle(title);
    if (!key) continue;
    if (key === normalizeTitle(search)) continue; // no rename
    map.set(key, search.trim());
  }
  return map;
}

function readFromDisk() {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    if (data && data.map && typeof data.map === 'object') {
      return { map: new Map(Object.entries(data.map)), updatedAt: Number(data.updatedAt) || 0 };
    }
  } catch { /* no cache yet */ }
  return null;
}

async function writeToDisk() {
  try {
    const tmp = `${CACHE_PATH}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify({ updatedAt: Date.now(), map: Object.fromEntries(sceneMap) }));
    await fsp.rename(tmp, CACHE_PATH);
  } catch (err) {
    console.warn('[SceneMap] cache write failed:', err.message);
  }
}

async function load() {
  const res = await axios.get(SCENE_URL, {
    responseType: 'json',
    timeout: 60000,
    maxContentLength: MAX_BYTES,
    maxBodyLength: MAX_BYTES,
    headers: { 'User-Agent': 'LeLibrary/5.2' },
  });
  const rows = Array.isArray(res.data) ? res.data : (res.data && (res.data.mappings || res.data.data)) || [];
  const next = buildMap(rows);
  if (next.size === 0) throw new Error('empty scene mapping response');
  sceneMap = next;
  ready = true;
  console.log(`[SceneMap] loaded ${sceneMap.size} renames`);
  await writeToDisk();
}

function loadNow() {
  if (loading) return loading;
  loading = load()
    .catch((err) => { console.warn('[SceneMap] load failed:', err.message); })
    .finally(() => { loading = null; });
  return loading;
}

function start() {
  if (started) return;
  started = true;
  if (process.env.SCENE_MAP_DISABLED === 'true') {
    console.log('[SceneMap] disabled via SCENE_MAP_DISABLED');
    return;
  }
  const cached = readFromDisk();
  if (cached) {
    sceneMap = cached.map;
    ready = true;
    console.log(`[SceneMap] loaded from cache ${sceneMap.size} renames`);
  }
  const age = cached ? Date.now() - cached.updatedAt : Infinity;
  if (age > REFRESH_MS) loadNow();
  const timer = setInterval(loadNow, REFRESH_MS);
  timer.unref?.();
}

function isReady() { return ready; }

// Searchable title for a scene release name, or null when there is no mapping.
function searchTitleFor(title) {
  if (!ready || !title) return null;
  return sceneMap.get(normalizeTitle(title)) || null;
}

module.exports = { start, isReady, searchTitleFor, buildMap };
