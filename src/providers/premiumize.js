const axios = require('axios');
const { guessMediaInfo } = require('../parser');

const PM_BASE = 'https://www.premiumize.me/api';

// Premiumize: auth via `Authorization: Bearer <key>`. Responses are
// `{ status: 'success', ...fields }` or `{ status: 'error', message, code }`.
// The PIN field may appear on errors when Premiumize demands device
// authorization for a key used from a new IP.
async function pmRequest(apiKey, method, path, params = {}, form = {}) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  // Premiumize also accepts the API key as an `apikey` query param (what
  // StremThru/AIOStreams send); sending it alongside the Bearer header
  // guarantees compatibility with every auth path.
  params.apikey = apiKey;
  try {
    const opts = { headers, timeout: 30000, validateStatus: s => s < 500 };
    if (method === 'GET') {
      opts.params = params;
    } else {
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opts.params = params;
      opts.data = new URLSearchParams(form).toString();
    }
    const res = await axios({ method, url: `${PM_BASE}${path}`, ...opts });
    const body = res.data || {};
    if (body.status === 'error') {
      let pin = body.pin || null;
      if (!pin && typeof body.message === 'string') {
        const m = body.message.match(/pin[:\s]+([A-Za-z0-9-]+)/i);
        if (m) pin = m[1];
      }
      return { error: body.message || body.code || 'Premiumize error', status: res.status, pin };
    }
    return { data: body, status: res.status };
  } catch (err) {
    return { error: err.response?.data?.message || err.message, status: err.response?.status };
  }
}

const PM_VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.ts', '.wmv', '.webm', '.m2ts', '.mpg', '.mpeg', '.flv', '.vob', '.divx'];
function isPmVideoFile(name = '') {
  return PM_VIDEO_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));
}

// ── Cloud scanning via /item/listall ──────────────────────────
// `item/listall` returns EVERY file in the user's cloud as a flat list with
// full paths (`{ id, name, path, size, mime_type, created_at }`). Using it as
// the source of truth means content inside folders (organized manually or by
// transfers) is always found, with no depth limit and no reliance on the
// transfer list. Links are not included here — they're resolved per-file via
// /item/details when a stream or download is actually requested.

// Short in-memory cache for the flat file list (one call returns the whole
// cloud, so we avoid hammering it on every catalog/meta/stream rebuild).
const listAllCache = new Map();
const LISTALL_TTL = 45000;

async function pmListAllFiles(apiKey) {
  const now = Date.now();
  const hit = listAllCache.get(apiKey);
  if (hit && now - hit.at < LISTALL_TTL) return hit.files;
  const { data, error } = await pmRequest(apiKey, 'GET', '/item/listall');
  if (error || !Array.isArray(data?.files)) {
    console.warn(`[Premiumize] /item/listall failed: ${error || 'unexpected response'}`);
    return [];
  }
  listAllCache.set(apiKey, { at: now, files: data.files });
  return data.files;
}

// Logical item id scheme:
//   single file: `f:<fileId>`
//   folder group (by path): `d:<base64url(full folder path)>`
//   folder group (by id, from the root walk): `g:<base64url(folderId)>`
// Legacy numeric ids (transfer ids) are still accepted for backward compat.
function pmItemIdForFile(fileId)     { return 'f:' + String(fileId); }
function pmItemIdForFolder(path)     { return 'd:' + Buffer.from(path, 'utf8').toString('base64url'); }
function pmItemIdForFolderId(folderId) { return 'g:' + Buffer.from(String(folderId), 'utf8').toString('base64url'); }
function pmDecodeItemId(id) {
  if (typeof id !== 'string') return null;
  if (id.startsWith('f:')) return { kind: 'file', fileId: id.slice(2) };
  if (id.startsWith('d:')) {
    try { return { kind: 'folder', path: Buffer.from(id.slice(2), 'base64url').toString('utf8') }; }
    catch { return null; }
  }
  if (id.startsWith('g:')) {
    try { return { kind: 'folderId', folderId: Buffer.from(id.slice(2), 'base64url').toString('utf8') }; }
    catch { return null; }
  }
  return null;
}

function pmFirstCreatedAt(files) {
  let min = null;
  for (const f of files) {
    if (f.created_at && (min === null || f.created_at < min)) min = f.created_at;
  }
  return min ? new Date(min * 1000).toISOString() : undefined;
}

// Strong media signals in a folder name (year, season/episode, resolution,
// release tag, codec, or a bracketed anime group).
const PM_MEDIA_RE = [
  /\b(19[5-9]\d|20[0-3]\d)\b/,
  /\b[Ss]\d{1,2}(?:\s*[Ee]\d{1,2})?\b/,
  /\b(?:season|temporada)\s*\d+\b/i,
  /\b(2160p|1080p|720p|480p|360p|4k|uhd)\b/i,
  /\b(blu[-\s]?ray|web[-\s]?dl|web[-\s]?rip|webrip|bdrip|brrip|hdtv|dvdrip|remux)\b/i,
  /\b(x264|x265|h\.?26[45]|hevc|avc|xvid)\b/i,
  /^\[[^\]]+\]/,
];
function pmLooksMediaLike(name) {
  return PM_MEDIA_RE.some(re => re.test(String(name || '')));
}

// Generic container/category words ("My Files", "Movies", "Action", "TV Shows",
// ...) — these are catch-all parents that should be descended into, not library
// items. Without the genre/category words, a folder named "Action" or "Drama"
// would parse as a plain title and swallow every movie inside it into one item.
const PM_GENERIC_TOKENS = new Set([
  // generic containers
  'my', 'files', 'file', 'home', 'root', 'library', 'media', 'video', 'videos',
  'all', 'everything', 'misc', 'stuff', 'other', 'general', 'mixed', 'archive',
  'downloads', 'download', 'folder', 'folders',
  // media collections
  'movies', 'movie', 'films', 'film', 'cinema', 'collection', 'collections',
  'series', 'shows', 'show', 'tv', 'television', 'episodes', 'episode',
  'complete', 'pack', 'packs', 'anthology',
  // genres / categories
  'action', 'adventure', 'animation', 'anime', 'biography', 'comedy', 'crime',
  'documentary', 'documentaries', 'docs', 'drama', 'family', 'fantasy', 'history',
  'horror', 'musical', 'music', 'mystery', 'romance', 'science', 'sci', 'fi',
  'scifi', 'thriller', 'war', 'western', 'cartoons', 'cartoon', 'kids',
  'children', 'sports', 'sport', 'noir', 'reality',
]);
function pmLooksGeneric(name) {
  if (/^\d{4}$/.test(String(name || '').trim())) return true;
  const words = String(name || '').trim().replace(/[._-]/g, ' ').replace(/\s{2,}/g, ' ').toLowerCase().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every(w => PM_GENERIC_TOKENS.has(w));
}

// "Season 1", "Temporada 1", "S01" — the tell-tale sign a folder is a show
// container (its subfolders are seasons) rather than a catch-all category.
function pmIsSeasonLike(name) {
  return /\b(?:season|temporada)\s*\d+\b/i.test(name) || /\b\d+[aªº°]\s*temporada\b/i.test(name) || /\b[Ss]\d{1,2}(?!\s*[Ee])/.test(name);
}

function pmMakeFolderItem(groupPath, name, files) {
  return {
    id:                pmItemIdForFolder(groupPath),
    name,
    filename:          name,
    source:            'premiumize',
    download_state:    'completed',
    download_finished: true,
    progress:          1,
    size:              files.reduce((s, f) => s + (f.size || 0), 0),
    created_at:        pmFirstCreatedAt(files),
  };
}

function pmMakeFileItem(file) {
  return {
    id:                pmItemIdForFile(file.id),
    name:              file.name || '',
    filename:          file.name || '',
    source:            'premiumize',
    download_state:    'completed',
    download_finished: true,
    progress:          1,
    size:              file.size || 0,
    created_at:        file.created_at ? new Date(file.created_at * 1000).toISOString() : undefined,
  };
}

// Build library items from the flat /item/listall response.
//
// Strategy: group files by their top-level folder. Container folders whose
// names are generic parents ("My Files", "Movies", ...) are descended into so
// organized content still produces items named after the actual show/movie
// folder. A folder is treated as a content unit when it directly holds video
// files, its name carries strong media signals, or its name parses as a title.
// Root-level files each become their own item; groups with no video files are
// skipped so stray .txt/.nfo don't appear as library rows.
function pmGroupCloudFiles(files) {
  const items = [];
  const root = [];
  const byTop = new Map();

  for (const f of files) {
    const path = f.path || f.name || '';
    const slash = path.indexOf('/');
    if (slash === -1) { root.push(f); continue; }
    const top = path.slice(0, slash);
    if (!byTop.has(top)) byTop.set(top, []);
    byTop.get(top).push(f);
  }

  for (const f of root) items.push(pmMakeFileItem(f));

  for (const [top, gf] of byTop) {
    pmGroupDescend(items, gf, [top], 0);
  }

  return items;
}

function pmGroupDescend(items, files, prefixParts, depth) {
  const name = prefixParts[prefixParts.length - 1];
  const hasAnyVideo = files.some(f => isPmVideoFile(f.name || ''));
  if (!hasAnyVideo) return;

  const isDirect = f => (f.path || '').split('/').length === prefixParts.length + 1;
  const hasDirectVideo = files.some(f => isDirect(f) && isPmVideoFile(f.name || ''));

  // A folder is a content row when it directly holds video files, its name has
  // strong media signals, or its subfolders are seasons (a show container like
  // "Breaking.Bad/Season 1/..."). A name that merely *parses* as a title is NOT
  // enough — catch-all categories ("Classic Films", "4K Collection") parse too
  // and would swallow every movie inside them.
  const nextSegs = new Set();
  for (const f of files) {
    const parts = (f.path || '').split('/');
    if (parts.length > prefixParts.length + 1) nextSegs.add(parts[prefixParts.length]);
  }
  const hasSeasonSubfolders = [...nextSegs].some(s => pmIsSeasonLike(s));
  const parsesAsTitle = !pmLooksGeneric(name) && guessMediaInfo(name);

  if (hasDirectVideo || pmLooksMediaLike(name) || (hasSeasonSubfolders && parsesAsTitle) || depth >= 4) {
    items.push(pmMakeFolderItem(prefixParts.join('/'), name, files));
    return;
  }

  // Descend: group by the next path segment so a non-media parent ("My Files",
  // "Classic Films", ...) doesn't swallow its content into one useless item.
  const next = new Map();
  for (const f of files) {
    const parts = (f.path || '').split('/');
    const seg = parts.length > prefixParts.length ? parts[prefixParts.length] : (f.name || '');
    if (!next.has(seg)) next.set(seg, []);
    next.get(seg).push(f);
  }
  for (const [seg, sf] of next) {
    pmGroupDescend(items, sf, [...prefixParts, seg], depth + 1);
  }
}

// Build library rows from finished/seeding transfers (transfer/list). Each
// transfer becomes a row; its files are resolved lazily via a deep recursive
// /folder/list walk. This is the battle-tested approach AIOStreams/StremThru
// use, so it works even when /item/listall is flaky for an account.
async function pmTransferItems(apiKey) {
  const { data, error } = await pmRequest(apiKey, 'GET', '/transfer/list');
  if (error || !Array.isArray(data?.transfers)) {
    console.warn(`[Premiumize] /transfer/list failed: ${error || 'unexpected response'}`);
    return [];
  }
  return data.transfers
    .filter(t => t.status === 'finished' || t.status === 'seeding')
    .map(t => ({
      id:                String(t.id),
      name:              t.name || '',
      filename:          t.name || '',
      source:            'premiumize',
      download_state:    t.status === 'seeding' ? 'seeding' : 'completed',
      download_finished: true,
      progress:          1,
    }))
    .filter(i => i.name);
}

// ── Tier-3 fallback: walk the cloud from the root folder ─────
// Dedicated Premiumize addons (e.g. Josherinos' stremio-premiumize-addon)
// browse content with /folder/list and stream each file's direct link — they
// never rely on /transfer/list or /item/listall. Walking the root folder
// therefore finds EVERYTHING in the cloud: transfers, manually-organised
// folders, uploads. Used when the other two sources come back empty.

const rootWalkCache = new Map();
const ROOTWALK_TTL = 45000;

// Recursively build a folder tree from /folder/list (bounded depth safety net).
async function pmWalkFolder(apiKey, folderId, depth) {
  if (depth > 10) return null;
  const { data, error } = await pmRequest(apiKey, 'GET', '/folder/list', { id: folderId || '' });
  if (error || !Array.isArray(data?.content)) return null;
  const children = [];
  for (const c of data.content) {
    if (c.type === 'folder') {
      const sub = await pmWalkFolder(apiKey, c.id, depth + 1);
      if (sub) children.push(sub);
    } else {
      children.push({ type: 'file', id: String(c.id), name: c.name || '', size: c.size || 0, link: c.link || null });
    }
  }
  return { type: 'folder', id: data.folder_id || folderId || '', name: data.name || '', children };
}

// Turn the folder tree into library rows using the same media-likeness rules
// as the listall grouping: a folder holding videos directly, or one whose
// subfolders are seasons (a show container), becomes a row; catch-all category
// folders are descended into so their content isn't swallowed.
function pmTreeToItems(node, depth) {
  if (!node || node.type !== 'folder') return [];
  const directVideos = node.children.filter(c => c.type === 'file' && isPmVideoFile(c.name));
  if (directVideos.length === 0 && !node.children.some(c => c.type === 'folder')) return [];
  const name = node.name || '';
  const subFolders = node.children.filter(c => c.type === 'folder');
  const hasSeasonSubfolders = subFolders.some(c => pmIsSeasonLike(c.name));
  const parsesAsTitle = !pmLooksGeneric(name) && guessMediaInfo(name);
  if (directVideos.length > 0 || pmLooksMediaLike(name) || (hasSeasonSubfolders && parsesAsTitle) || depth >= 4) {
    return [{
      id:                pmItemIdForFolderId(node.id),
      name,
      filename:          name,
      source:            'premiumize',
      download_state:    'completed',
      download_finished: true,
      progress:          1,
      size:              node.children.filter(c => c.type === 'file').reduce((s, c) => s + (c.size || 0), 0),
    }];
  }
  const items = [];
  for (const c of node.children) {
    if (c.type === 'folder') items.push(...pmTreeToItems(c, depth + 1));
  }
  return items;
}

async function pmRootWalkItems(apiKey) {
  const now = Date.now();
  const hit = rootWalkCache.get(apiKey);
  if (hit && now - hit.at < ROOTWALK_TTL) return hit.items;
  const root = await pmWalkFolder(apiKey, '', 0);
  if (!root) return [];
  const items = [];
  for (const c of root.children) {
    if (c.type === 'file' && isPmVideoFile(c.name)) {
      items.push({
        id:                pmItemIdForFile(c.id),
        name:              c.name,
        filename:          c.name,
        source:            'premiumize',
        download_state:    'completed',
        download_finished: true,
        progress:          1,
        size:              c.size || 0,
      });
    } else if (c.type === 'folder') {
      items.push(...pmTreeToItems(c, 0));
    }
  }
  rootWalkCache.set(apiKey, { at: now, items });
  return items;
}

// ── File-based library items ──────────────────────────────────
// The simplest, most reliable model (what the user asked for): walk into every
// folder, pull out the video files, and make EACH video file a library entry.
// The file names are real release names, so the addon's normal movie/show
// matching puts movies in My Movies and shows in My Shows — no folder-name
// guessing needed. When a file name is generic ("movie.mkv", "s01e01.mkv") the
// nearest media-like parent folder name is used instead.
function pmBestDisplayName(f) {
  const raw = f.name || '';
  const fname = raw.replace(/\.[^.]+$/, '');
  if (pmLooksMediaLike(fname) && guessMediaInfo(fname)) return fname;
  const parts = (f.path || raw || '').split('/');
  parts.pop(); // drop the file name
  for (let i = parts.length - 1; i >= 0; i--) {
    const seg = parts[i] || '';
    if (pmIsSeasonLike(seg)) continue; // "Season 1" is structural, not content
    if (pmLooksMediaLike(seg) || (!pmLooksGeneric(seg) && guessMediaInfo(seg))) return seg;
  }
  return fname || (parts[parts.length - 1] || '');
}

function pmFilesToItems(files) {
  const items = [];
  for (const f of files) {
    if (!isPmVideoFile(f.name || '')) continue;
    const name = pmBestDisplayName(f);
    if (!name) continue;
    items.push({
      id:                pmItemIdForFile(f.id),
      name,
      filename:          name,
      source:            'premiumize',
      download_state:    'completed',
      download_finished: true,
      progress:          1,
      size:              f.size || 0,
      created_at:        f.created_at ? new Date(f.created_at * 1000).toISOString() : undefined,
    });
  }
  return items;
}

async function getPremiumizeDownloads(apiKey) {
  // /item/listall covers the whole cloud (including manually-organised content
  // that never went through a transfer). When it returns files, use it. If it
  // returns nothing (erroring or empty for the account), fall back to the
  // transfer list, then to a full root-folder walk, so a flaky /item/listall
  // can never empty someone's library.
  const files = await pmListAllFiles(apiKey);
  if (files.length > 0) {
    const items = pmFilesToItems(files);
    if (items.length > 0) {
      console.log(`[Premiumize] Downloads: ${items.length} items (from ${files.length} cloud files)`);
      return items;
    }
  }
  const transferItems = await pmTransferItems(apiKey);
  if (transferItems.length > 0) {
    console.log(`[Premiumize] Downloads (transfer fallback): ${transferItems.length} items`);
    return transferItems;
  }
  const rootItems = await pmRootWalkItems(apiKey);
  console.log(`[Premiumize] Downloads (root-walk fallback): ${rootItems.length} items`);
  return rootItems;
}

// ── Files & stream links ──────────────────────────────────────
// Legacy: walk a transfer's folder (bounded depth) collecting files.
async function listTransferFiles(apiKey, transferId) {
  const { data, error } = await pmRequest(apiKey, 'GET', '/transfer/list');
  if (error || !Array.isArray(data?.transfers)) return [];
  const t = data.transfers.find(x => String(x.id) === String(transferId));
  if (!t) return [];

  if (t.file_id) {
    const { data: details } = await pmRequest(apiKey, 'GET', '/item/details', { id: t.file_id });
    if (details?.id) {
      return [{ id: String(details.id), name: details.name || '', size: details.size || 0, link: details.link || null }];
    }
    return [];
  }
  if (t.folder_id) {
    return listFolderFiles(apiKey, t.folder_id);
  }
  return [];
}

// Walk a folder recursively collecting file entries (used by the legacy
// transfer-id path; new ids resolve straight from the listall scan). The depth
// cap is only a safety net — StremThru/AIOStreams walk folders to any depth.
async function listFolderFiles(apiKey, folderId, depth = 0) {
  const { data, error } = await pmRequest(apiKey, 'GET', '/folder/list', { id: folderId });
  if (error || !Array.isArray(data?.content)) return [];
  let files = [];
  for (const c of data.content) {
    if (c.type === 'file') {
      files.push({ id: String(c.id), name: c.name || '', size: c.size || 0, link: c.link || null });
    } else if (c.type === 'folder' && depth < 12) {
      files = files.concat(await listFolderFiles(apiKey, c.id, depth + 1));
    }
  }
  return files;
}

async function getPremiumizeFiles(apiKey, itemId) {
  const dec = pmDecodeItemId(itemId);
  if (dec?.kind === 'file') {
    const { data: details } = await pmRequest(apiKey, 'GET', '/item/details', { id: dec.fileId });
    if (details?.id) {
      return [{ id: String(details.id), name: details.name || '', size: details.size || 0, link: details.link || null }];
    }
    return [];
  }
  if (dec?.kind === 'folder') {
    const files = await pmListAllFiles(apiKey);
    const prefix = dec.path + '/';
    return files
      .filter(f => (f.path || '').startsWith(prefix))
      .map(f => ({ id: String(f.id), name: f.name || '', size: f.size || 0, link: null }));
  }
  if (dec?.kind === 'folderId') {
    return listFolderFiles(apiKey, dec.folderId);
  }
  // Legacy numeric transfer id
  return listTransferFiles(apiKey, itemId);
}

// Premiumize files carry a direct `link` (via /item/details) — streamable with
// no unlock step. listall doesn't include links, so they're resolved lazily.
async function pmDetailsLink(apiKey, fileId) {
  if (!fileId) return null;
  const { data, error } = await pmRequest(apiKey, 'GET', '/item/details', { id: fileId });
  return (!error && data?.link) ? data.link : null;
}

async function getPremiumizeStreamLink(apiKey, itemId, fileId) {
  const dec = pmDecodeItemId(itemId);
  if (dec?.kind === 'file') {
    return pmDetailsLink(apiKey, dec.fileId);
  }
  if (dec?.kind === 'folder') {
    const files = await getPremiumizeFiles(apiKey, itemId);
    const target = (fileId && files.find(f => String(f.id) === String(fileId))) || files[0];
    return target ? pmDetailsLink(apiKey, target.id) : null;
  }
  if (dec?.kind === 'folderId') {
    const files = await listFolderFiles(apiKey, dec.folderId);
    const file = (fileId && files.find(f => String(f.id) === String(fileId))) || files[0];
    return file?.link || null;
  }
  // Legacy numeric transfer id
  const files = await listTransferFiles(apiKey, itemId);
  const file = (fileId && files.find(f => String(f.id) === String(fileId))) || files[0];
  return file?.link || null;
}

// Verification — PIN-aware: a new-IP device-authorization prompt is surfaced
// as { needPin: true, pin, deviceUrl } so the UI can walk the user through it.
async function verifyPremiumizeKey(apiKey) {
  const { data, error, pin } = await pmRequest(apiKey, 'GET', '/account/info');
  if (error || !data) {
    if (pin) {
      return { valid: false, needPin: true, pin, deviceUrl: 'https://www.premiumize.me/device', error: 'Authorize your Premiumize key' };
    }
    return { valid: false, error: error === 'authentication_failed' ? 'Invalid Premiumize API key' : (error || 'Invalid Premiumize API key') };
  }
  return { valid: true, username: data.customer_id ? String(data.customer_id) : null, premiumUntil: data.premium_until ?? null };
}

module.exports = { getPremiumizeDownloads, getPremiumizeFiles, getPremiumizeStreamLink, verifyPremiumizeKey };
