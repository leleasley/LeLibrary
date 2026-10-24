'use strict';
// Folder-name signals for cloud folders that are not downloads (Premiumize
// cloud files, WebDAV shares): is a folder a release, a catch-all category,
// or a season of a show? Moved unchanged from premiumize.ts.

// Strong media signals in a folder name (year, season/episode, resolution,
// release tag, codec, or a bracketed anime group).
const MEDIA_RE = [
  /\b(19[5-9]\d|20[0-3]\d)\b/,
  /\b[Ss]\d{1,2}(?:\s*[Ee]\d{1,2})?\b/,
  /\b(?:season|temporada)\s*\d+\b/i,
  /\b(2160p|1080p|720p|480p|360p|4k|uhd)\b/i,
  /\b(blu[-\s]?ray|web[-\s]?dl|web[-\s]?rip|webrip|bdrip|brrip|hdtv|dvdrip|remux)\b/i,
  /\b(x264|x265|h\.?26[45]|hevc|avc|xvid)\b/i,
  /^\[[^\]]+\]/,
];
function looksMediaLike(name: string): boolean {
  return MEDIA_RE.some(re => re.test(String(name || '')));
}

// Generic container/category words ("My Files", "Movies", "Action", "TV Shows",
// ...): these are catch-all parents that should be descended into, not library
// items. Without the genre/category words, a folder named "Action" or "Drama"
// would parse as a plain title and swallow every movie inside it into one item.
const GENERIC_TOKENS = new Set([
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
function looksGeneric(name: string): boolean {
  if (/^\d{4}$/.test(String(name || '').trim())) return true;
  const words = String(name || '').trim().replace(/[._-]/g, ' ').replace(/\s{2,}/g, ' ').toLowerCase().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every(w => GENERIC_TOKENS.has(w));
}

// "Season 1", "Temporada 1", "S01": the tell-tale sign a folder is a show
// container (its subfolders are seasons) rather than a catch-all category.
function isSeasonLike(name: string): boolean {
  return /\b(?:season|temporada)\s*\d+\b/i.test(name) || /\b\d+[aªº°]\s*temporada\b/i.test(name) || /\b[Ss]\d{1,2}(?!\s*[Ee])/.test(name);
}

export interface FolderItemsApi {
  looksMediaLike: (name: string) => boolean;
  looksGeneric: (name: string) => boolean;
  isSeasonLike: (name: string) => boolean;
}

module.exports = { looksMediaLike, looksGeneric, isSeasonLike } satisfies FolderItemsApi;
