const axios = require('axios');
const { guessMediaInfo } = require('../parser');

const PM_BASE = 'https://www.premiumize.me/api';

// Premiumize: auth via `Authorization: Bearer <key>`. Responses are
// `{ status: 'success', ...fields }` or `{ status: 'error', message, code }`.
// The PIN field may appear on errors when Premiumize demands device
// authorization for a key used from a new IP.
async function pmRequest(apiKey, method, path, params = {}, form = {}) {
  const headers = { Authorization: `Bearer ${apiKey}` };
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
  if (error || !Array.isArray(data?.files)) return [];
  listAllCache.set(apiKey, { at: now, files: data.files });
  return data.files;
}

// Logical item id scheme:
//   single file: `f:<fileId>`
//   folder group: `d:<base64url(full folder path)>`
// Legacy numeric ids (transfer ids) are still accepted for backward compat.
function pmItemIdForFile(fileId)  { return 'f:' + String(fileId); }
function pmItemIdForFolder(path)  { return 'd:' + Buffer.from(path, 'utf8').toString('base64url'); }
function pmDecodeItemId(id) {
  if (typeof id !== 'string') return null;
  if (id.startsWith('f:')) return { kind: 'file', fileId: id.slice(2) };
  if (id.startsWith('d:')) {
    try { return { kind: 'folder', path: Buffer.from(id.slice(2), 'base64url').toString('utf8') }; }
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

  if (hasDirectVideo || pmLooksMediaLike(name) || (!pmLooksGeneric(name) && guessMediaInfo(name)) || depth >= 4) {
    items.push(pmMakeFolderItem(prefixParts.join('/'), name, files));
    return;
  }

  // Descend: group by the next path segment so a non-media parent ("My Files")
  // doesn't swallow its content into one useless item.
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

async function getPremiumizeDownloads(apiKey) {
  const files = await pmListAllFiles(apiKey);
  const items = pmGroupCloudFiles(files);
  console.log(`[Premiumize] Downloads: ${items.length} items (from ${files.length} cloud files)`);
  return items;
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
// transfer-id path; new ids resolve straight from the listall scan).
async function listFolderFiles(apiKey, folderId, depth = 0) {
  const { data, error } = await pmRequest(apiKey, 'GET', '/folder/list', { id: folderId });
  if (error || !Array.isArray(data?.content)) return [];
  let files = [];
  for (const c of data.content) {
    if (c.type === 'file') {
      files.push({ id: String(c.id), name: c.name || '', size: c.size || 0, link: c.link || null });
    } else if (c.type === 'folder' && depth < 4) {
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
