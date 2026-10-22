// @ts-nocheck
// Pure helpers for the index-first library engine: per-item change hashing,
// media-type derivation, search-text normalisation and the incremental
// new/changed/unchanged/removed diff. No I/O, so these are unit tested.
const crypto = require('crypto');
const { guessMediaInfo } = require('../media/parser.ts');
const providers = require('../providers/index.ts');

function itemFiles(item) {
  for (const key of ['files', 'file_list', 'innerFiles']) {
    const value = item && item[key];
    if (Array.isArray(value) && value.length) return value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const files = Object.values(value);
      if (files.length) return files;
    }
  }
  return [];
}

function itemMediaInfo(item) {
  const name = item?.name || item?.filename || '';
  let outer = null;
  try { outer = guessMediaInfo(name); } catch { /* malformed source name */ }

  // A parsed episode file is stronger evidence of a series than an outer
  // torrent title that looks like a movie or cannot be parsed at all. Group
  // files by their own parsed title so unrelated bonus clips do not win.
  const groups = new Map();
  for (const file of itemFiles(item)) {
    const filename = String(file?.name || file?.short_name || file?.path || file?.filename || '');
    if (!/\.(mkv|mp4|avi|mov|ts|wmv|m4v|webm)$/i.test(filename)) continue;
    const base = filename.split(/[\\/]+/).filter(Boolean).pop() || filename;
    let info = null;
    try { info = guessMediaInfo(base); } catch { /* malformed embedded name */ }
    if (!info?.isSeries || info.episode == null) continue;
    const key = `${normalizeTitle(info.title)}|${info.year || ''}`;
    const group = groups.get(key) || { info: null, infoRank: null, isAnime: false, count: 0 };
    group.count++;
    // Provider file order is not stable. For files in one show, select the
    // same representative episode (earliest season/episode) every time.
    const rank = [
      info.seasonStart ?? info.season ?? Number.MAX_SAFE_INTEGER,
      info.episode ?? Number.MAX_SAFE_INTEGER,
    ];
    if (!group.infoRank || rank[0] < group.infoRank[0]
      || (rank[0] === group.infoRank[0] && rank[1] < group.infoRank[1])) {
      group.info = info;
      group.infoRank = rank;
    }
    if (info.isAnime) group.isAnime = true;
    groups.set(key, group);
  }
  // Resolve equal-sized title groups by normalized title/year, not insertion
  // order, so bonus clips or multi-show packs cannot flip identity between
  // identical provider scans.
  const embeddedGroup = [...groups.entries()]
    .sort(([keyA, a], [keyB, b]) => b.count - a.count || keyA.localeCompare(keyB))[0]?.[1] || null;
  let embedded = embeddedGroup?.info || null;
  if (embedded && embeddedGroup.isAnime && !embedded.isAnime) embedded = { ...embedded, isAnime: true };
  if (embedded && (!outer || !outer.isSeries)) return embedded;
  return outer || embedded;
}

// One compact signature per download. Deliberately mirrors the fields the
// legacy hashDownloads() used for change detection (identity, updated/created,
// size, file count, state, hash/magnet, plus an id|name|size file signature) so
// add / remove / rename / completed / file-layout changes all flip the hash.
// Volatile progress/speed fields stay out.
function itemContentHash(item) {
  if (!item || typeof item !== 'object') return '';
  const files = itemFiles(item);
  let fileSig = '';
  for (const file of files) {
    fileSig += `${file?.id ?? ''}\u0001${file?.name || file?.path || file?.filename || ''}\u0001${file?.size || file?.bytes || ''}\u0002`;
  }
  const line = [
    item.source, item.id, item.name || item.filename,
    item.updated_at || item.created_at || item.last_state_change,
    item.size || item.bytes || item.total_size,
    item.file_count || item.fileCount || files.length,
    item.download_finished === true ? 'finished' : (item.download_state || item.status || ''),
    // NOTE: `total_downloaded` is deliberately EXCLUDED: it climbs on every
    // provider poll for seeding torrents, and including it re-pended the whole
    // library (and wiped every match) on every 2-minute sync. Upload progress
    // says nothing about library identity.
    item.hash, item.magnet, item.torrent_file, item.download_path,
    JSON.stringify(item.tags || ''), JSON.stringify(item.alternative_hashes || ''),
    fileSig,
  ].join('\u0001');
  return crypto.createHash('sha1').update(line).digest('hex');
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function providerOf(item) {
  try { return providers.providerBySource(item?.source) || String(item?.source || 'unknown'); }
  catch { return String(item?.source || 'unknown'); }
}

// TorBox numbers torrents, usenet and web downloads separately, so a torrent
// and an NZB can share an id. Every TorBox family is provider 'torbox', so
// usenet and web downloads carry their family in the key ("usenet:123");
// torrents keep the bare id so existing rows are untouched. A migration in
// db.ts renames rows stored before this rule.
const PREFIXED_TORBOX_SOURCES = new Set(['usenet', 'webdl']);

function sourceIdOf(item) {
  const raw = item?.id ?? item?.hash ?? item?.magnet ?? item?.name ?? item?.filename;
  const id = String(raw == null ? '' : raw);
  if (item?.id != null && PREFIXED_TORBOX_SOURCES.has(String(item?.source || '')) && providerOf(item) === 'torbox') {
    return `${item.source}:${id}`;
  }
  return id;
}

// Which catalog namespace an item belongs to. Mirrors the legacy buildCatalog
// filter: each release matches exactly one of movie / series / anime based on
// how its filename parses.
function deriveMediaType(item) {
  const info = itemMediaInfo(item);
  if (info && info.isAnime) return 'anime';
  if (info && info.isSeries) return 'series';
  if (info) return 'movie';
  // Unparseable outer name: only the series pack-content probe can rescue it.
  return 'series';
}

function parsedFields(item) {
  const name = item?.name || item?.filename || '';
  const info = itemMediaInfo(item);
  return {
    is_series: !!(info && info.isSeries),
    is_anime: !!(info && info.isAnime),
    year: info && Number.isInteger(info.year) ? info.year : null,
    season: info && info.season != null ? info.season : null,
    episode: info && info.episode != null ? info.episode : null,
    season_start: info && info.seasonStart != null ? info.seasonStart : null,
    season_end: info && info.seasonEnd != null ? info.seasonEnd : null,
    episode_end: info && info.episodeEnd != null ? info.episodeEnd : null,
    norm_title: info && info.title ? normalizeTitle(info.title) : normalizeTitle(name),
  };
}

// Text used by the local search index: parsed title, the raw release name, and
// the individual file names (so a query can match an episode title inside a
// pack). Kept lowercase-normalised for predictable prefix matching.
function buildSearchText(item, parsed) {
  const parts = [];
  if (parsed && parsed.norm_title) parts.push(parsed.norm_title);
  const raw = normalizeTitle(item?.name || item?.filename || '');
  if (raw && raw !== (parsed && parsed.norm_title)) parts.push(raw);
  for (const file of itemFiles(item)) {
    const n = normalizeTitle(file?.name || file?.path || file?.filename || '');
    if (n) parts.push(n);
  }
  return parts.join(' ').slice(0, 4000);
}

function buildRecord(item, sourceId) {
  const parsed = parsedFields(item);
  return {
    provider: providerOf(item),
    source_id: sourceId,
    source_kind: item?.source || null,
    name: String(item?.name || item?.filename || ''),
    media_type: deriveMediaType(item),
    content_hash: itemContentHash(item),
    raw: item,
    ...parsed,
    search_text: buildSearchText(item, parsed),
    size: Number(item?.size || item?.bytes || item?.total_size) || null,
    source_updated_at: item?.updated_at || item?.created_at || item?.last_state_change || null,
    source_created_at: item?.created_at || null,
    state: item?.download_finished === true ? 'finished' : (item?.download_state || item?.status || null),
  };
}

// Pure incremental diff. `existing` is a Map keyed `${provider}\u0001${source_id}`
// (or any stable key) with { content_hash, removed }. Returns the batch to
// write, plus counts. Unchanged items are not touched at all.
function diffRecords(existing, incoming, keyOf) {
  const key = keyOf || ((r) => `${r.provider}\u0001${r.source_id}`);
  const toWrite = [];
  const seen = new Set();
  let unchanged = 0;
  for (const record of incoming) {
    const k = key(record);
    seen.add(k);
    const prev = existing.get(k);
    if (!prev) { toWrite.push(record); continue; }
    if (prev.removed) { toWrite.push(record); continue; }
    if (prev.content_hash !== record.content_hash) { toWrite.push(record); continue; }
    unchanged++;
  }
  const removedKeys = [];
  for (const [k, prev] of existing) {
    if (!seen.has(k) && !prev.removed) removedKeys.push(k);
  }
  return {
    toWrite,
    removedKeys,
    counts: {
      scanned: incoming.length,
      added: toWrite.filter((r) => !existing.has(key(r))).length,
      changed: toWrite.filter((r) => existing.has(key(r))).length,
      unchanged,
      removed: removedKeys.length,
    },
  };
}

// Fixture/offline matching support: a fixture item may carry a `__match` object
// with the title's known TMDB identity, letting the acceptance tests exercise
// ingestion, catalog, search and meta without any live TMDB key.
function offlineMatchFromItem(item) {
  const m = item && item.__match;
  if (!m || !m.tmdbId) return null;
  const stremioType = m.type === 'movie' ? 'movie' : (m.type === 'anime' ? 'series' : 'series');
  const catalogType = m.type || 'movie';
  const info = parsedFields(item);
  return {
    id: `torbox:${stremioType}:${m.tmdbId}`,
    type: stremioType,
    catalogType,
    name: m.title || item.name || item.filename,
    poster: m.poster || null,
    background: m.background || null,
    description: m.description || null,
    releaseInfo: m.year ? String(m.year) : '',
    released: m.releaseDate || (m.year ? `${m.year}-01-01` : undefined),
    tmdbId: Number(m.tmdbId),
    imdbId: m.imdbId || null,
    isJapaneseAnimation: catalogType === 'anime',
    season: m.season != null ? m.season : info.season,
    episode: m.episode != null ? m.episode : info.episode,
    seasonStart: info.season_start,
    seasonEnd: info.season_end,
    episodeEnd: info.episode_end,
  };
}

export interface DiffApi {
  itemContentHash: any;
  normalizeTitle: any;
  providerOf: any;
  sourceIdOf: any;
  deriveMediaType: any;
  parsedFields: any;
  buildSearchText: any;
  buildRecord: any;
  diffRecords: any;
  offlineMatchFromItem: any;
}

module.exports = {
  itemContentHash,
  normalizeTitle,
  providerOf,
  sourceIdOf,
  deriveMediaType,
  parsedFields,
  buildSearchText,
  buildRecord,
  diffRecords,
  offlineMatchFromItem,
  recordKey: (r: any) => `${r.provider}\u0001${r.source_id}`,
} satisfies DiffApi;
