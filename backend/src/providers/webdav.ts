'use strict';
// WebDAV library source (self-host only): a NAS, rclone `serve webdav`,
// Nextcloud or Synology share becomes a library like a debrid account.
//
// Off unless WEBDAV_SOURCE=on. A server on the local network (or loopback)
// also needs WEBDAV_ALLOW_PRIVATE=on, so a shared install cannot be pointed at
// its own network; plain HTTP is only accepted for such private servers, never
// across the internet (the password would travel in clear text).
//
// The crawl asks for one folder level at a time (explicit Depth: 1 on every
// request: Apache/nginx refuse "infinity", Sabre quietly downgrades it, rclone
// treats a missing Depth as the whole tree) and gives up past fixed limits
// rather than returning half a library, so a partial scan can never empty an
// indexed library. A finished scan is reused for WEBDAV_SCAN_MINUTES.
//
// One item per folder that holds videos ("Breaking Bad/Season 1" becomes
// "Breaking Bad Season 1"); videos loose in the top folder or in a category
// folder ("Movies") are one item each. File ids are base64url of the path
// below the server address, so playback needs no lookup.
//
// Never logged: the address, user, password, folder or file names.

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const axios = require('axios');
const { PROPFIND_BODY, parseMultistatus, hrefToPath, encodePath } = require('./webdav-xml.ts');
const { isBlockedIp } = require('../streams/aiostreams.ts');
const { looksGeneric, isSeasonLike } = require('./folder-items.ts');

const SCAN_MAX_ENTRIES = 50000;
const SCAN_MAX_DEPTH = 8;
const SCAN_CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_LISTING_BYTES = 8 * 1024 * 1024;
const SIDE_FILE_MAX_BYTES = 1024 * 1024;
const VIDEO_RE = /\.(mkv|mp4|avi|m4v|ts|m2ts|webm|mov|wmv)$/i;
const SIDE_RE = /\.(nfo|sfv)$/i;

export type DavErrorCode = 'disabled' | 'bad-url' | 'blocked-host' | 'unreachable' | 'auth' | 'not-webdav' | 'timeout' | 'too-large';
export interface DavConnection { base: URL; basePath: string; auth: string; scopeSeed: string; cacheKey: string }
export interface DavFile { id: string; name: string; short_name: string; size: number }
export interface WebdavItem {
  id: string; name: string; filename: string; source: 'webdav'; size: number;
  created_at?: string; updated_at?: string; download_finished: true; download_state: 'completed';
  files: DavFile[];
}

function webdavEnabled(env: Record<string, any> = process.env): boolean {
  return String(env.WEBDAV_SOURCE || '').toLowerCase() === 'on';
}

function allowPrivate(env: Record<string, any> = process.env): boolean {
  return String(env.WEBDAV_ALLOW_PRIVATE || '').toLowerCase() === 'on';
}

function scanTtlMs(env: Record<string, any> = process.env): number {
  const minutes = Number(env.WEBDAV_SCAN_MINUTES);
  return Math.max(5, Number.isFinite(minutes) && minutes > 0 ? minutes : 15) * 60 * 1000;
}

function davError(code: DavErrorCode): Error & { code: DavErrorCode } {
  return Object.assign(new Error(`webdav ${code}`), { code });
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function davConnection(config: any): DavConnection | null {
  const raw = String((config && config.webdavUrl) || '').trim();
  if (!raw) return null;
  let base: URL;
  try { base = new URL(raw); } catch { return null; }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
  if (base.username || base.password) return null;
  base.hash = '';
  base.search = '';
  const basePath = hrefToPath(base.pathname);
  const user = String((config && config.webdavUser) || '');
  const password = String((config && config.webdavPassword) || '');
  const auth = `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
  const scopeSeed = `${base.origin}${basePath}|${user}`;
  return { base, basePath, auth, scopeSeed, cacheKey: `davscan:${sha256(`${scopeSeed}|${sha256(auth)}`)}` };
}

// Resolve once, enforce the host rules, and pin the request to that address
// (no DNS rebinding between the check and the request).
async function pinnedFor(base: URL): Promise<(host: string, options: any, cb: any) => void> {
  const host = base.hostname.replace(/^\[|\]$/g, '');
  let records: { address: string; family: number }[];
  try {
    records = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true, verbatim: true });
  } catch { throw davError('unreachable'); }
  if (!records.length) throw davError('unreachable');
  const isPrivate = records.some((record) => isBlockedIp(record.address));
  if (isPrivate && !allowPrivate()) throw davError('blocked-host');
  if (!isPrivate && base.protocol === 'http:') throw davError('blocked-host');
  const { address, family } = records[0];
  return (_host, options, cb) => {
    if (options && options.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
}

function requestError(err: any): Error & { code: DavErrorCode } {
  if (err && typeof err.code === 'string' && ['disabled', 'bad-url', 'blocked-host', 'unreachable', 'auth', 'not-webdav', 'timeout', 'too-large'].includes(err.code)) return err;
  const message = String((err && err.message) || '');
  if (/maxContentLength|maxBodyLength/i.test(message)) return davError('too-large');
  if (err && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || /timeout/i.test(message))) return davError('timeout');
  return davError('unreachable');
}

// One request to the WebDAV server, at `path` (decoded, absolute on the
// server). Callers decide what a status means; nothing is followed.
async function davRequest(conn: DavConnection, { method, path, headers = {}, data, responseType = 'text', timeout = REQUEST_TIMEOUT_MS, maxContentLength = MAX_LISTING_BYTES, decompress = true, signal, auth = true }: {
  method: string; path: string; headers?: Record<string, string>; data?: string; responseType?: 'text' | 'stream';
  timeout?: number; maxContentLength?: number; decompress?: boolean; signal?: AbortSignal; auth?: boolean;
}): Promise<any> {
  const lookup = await pinnedFor(conn.base);
  try {
    return await axios({
      method, url: `${conn.base.origin}${encodePath(path)}`, data,
      headers: { ...(auth ? { Authorization: conn.auth } : {}), ...headers },
      lookup, maxRedirects: 0, timeout, maxContentLength, maxBodyLength: maxContentLength,
      validateStatus: () => true, responseType, decompress, signal,
    });
  } catch (err) { throw requestError(err); }
}

// Depth: 1 listing of one folder. Folder requests end in "/" (Apache answers
// a folder without one with a redirect).
async function propfind(conn: DavConnection, dirPath: string) {
  const res = await davRequest(conn, {
    method: 'PROPFIND', path: dirPath === '/' ? '/' : `${dirPath}/`, data: PROPFIND_BODY,
    headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8', 'Accept-Encoding': 'gzip' },
  });
  if (res.status === 401 || res.status === 403) throw davError('auth');
  const body = typeof res.data === 'string' ? res.data : '';
  if (res.status !== 207 || !/multistatus/i.test(body)) throw davError('not-webdav');
  return parseMultistatus(body, dirPath);
}

function parentOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at <= 0 ? '/' : path.slice(0, at);
}

// Breadth-first, a few folders at a time. Only direct children of each folder
// are used, so a server that ignores Depth still gives each file once.
async function crawl(conn: DavConnection, { maxEntries, maxDepth }: { maxEntries: number; maxDepth: number }) {
  const files: { path: string; size: number; modified: string | null }[] = [];
  const queue: { path: string; depth: number }[] = [{ path: conn.basePath, depth: 0 }];
  const seen = new Set<string>([conn.basePath]);
  let total = 0;
  let failure: Error | null = null;
  const worker = async () => {
    while (queue.length && !failure) {
      const dir = queue.shift() as { path: string; depth: number };
      let entries;
      try { entries = await propfind(conn, dir.path); } catch (err) { failure = err as Error; return; }
      total += entries.length;
      if (total > maxEntries) { failure = davError('too-large'); return; }
      for (const entry of entries) {
        if (parentOf(entry.path) !== dir.path) continue;
        if (entry.isDir) {
          if (seen.has(entry.path)) continue;
          if (dir.depth + 1 > maxDepth) { failure = davError('too-large'); return; }
          seen.add(entry.path);
          queue.push({ path: entry.path, depth: dir.depth + 1 });
        } else {
          files.push({ path: entry.path, size: entry.size, modified: entry.modified });
        }
      }
    }
  };
  // Workers pick up folders as earlier ones add them.
  while (queue.length && !failure) {
    await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, queue.length) }, worker));
  }
  if (failure) throw failure;
  return files;
}

function fileRef(relPath: string): string {
  return Buffer.from(relPath, 'utf8').toString('base64url');
}

// A file id back to its path below the server address, or null for anything
// that could leave it.
function fileRefToPath(ref: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,1500}$/.test(String(ref || ''))) return null;
  const path = Buffer.from(ref, 'base64url').toString('utf8');
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('\0')) return null;
  if (path.split('/').some((segment) => segment === '..' || segment === '.')) return null;
  if (path === '/' || path.endsWith('/')) return null;
  return path;
}

function iso(value: string | null): string | undefined {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function groupItems(files: { path: string; size: number; modified: string | null }[], basePath: string): WebdavItem[] {
  const rel = (path: string) => (basePath === '/' ? path : path.slice(basePath.length) || '/');
  const byDir = new Map<string, { videos: typeof files; sides: typeof files }>();
  for (const file of files) {
    const isVideo = VIDEO_RE.test(file.path);
    const isSide = SIDE_RE.test(file.path) && file.size <= SIDE_FILE_MAX_BYTES;
    if (!isVideo && !isSide) continue;
    const dir = parentOf(rel(file.path));
    const group = byDir.get(dir) || { videos: [], sides: [] };
    (isVideo ? group.videos : group.sides).push({ ...file, path: rel(file.path) });
    byDir.set(dir, group);
  }
  const items: WebdavItem[] = [];
  const dates = (list: typeof files) => {
    const times = list.map((f) => iso(f.modified)).filter(Boolean).sort() as string[];
    return { created_at: times[0], updated_at: times[times.length - 1] };
  };
  for (const [dir, group] of byDir) {
    if (!group.videos.length) continue;
    const segments = dir.split('/').filter(Boolean);
    const folder = segments[segments.length - 1] || '';
    const looseFiles = !folder || (looksGeneric(folder) && !isSeasonLike(folder));
    if (looseFiles) {
      for (const video of group.videos) {
        const name = baseName(video.path);
        items.push({
          id: `w:${sha256(`file:${video.path}`).slice(0, 24)}`, name, filename: name, source: 'webdav', size: video.size,
          ...dates([video]), download_finished: true, download_state: 'completed',
          files: [{ id: fileRef(video.path), name, short_name: name, size: video.size }],
        });
      }
      continue;
    }
    let name = folder;
    if (isSeasonLike(folder)) {
      const show = segments.slice(0, -1).reverse().find((segment) => !isSeasonLike(segment) && !looksGeneric(segment));
      if (show) name = `${show} ${folder}`;
    }
    const all = [...group.videos, ...group.sides].sort((a, b) => a.path.localeCompare(b.path));
    items.push({
      id: `w:${sha256(`dir:${dir}`).slice(0, 24)}`, name, filename: name, source: 'webdav',
      size: group.videos.reduce((total, f) => total + f.size, 0),
      ...dates(group.videos), download_finished: true, download_state: 'completed',
      files: all.map((f) => ({ id: fileRef(f.path), name: `${folder}/${baseName(f.path)}`, short_name: baseName(f.path), size: f.size })),
    });
  }
  return items.sort((a, b) => a.id.localeCompare(b.id));
}

const inFlight = new Map<string, Promise<WebdavItem[]>>();

async function listWebdavLibrary(config: any, { fresh = false, deps = {} }: { fresh?: boolean; deps?: { cache?: { get: Function; set: Function }; now?: () => number; maxEntries?: number; maxDepth?: number } } = {}): Promise<WebdavItem[]> {
  void fresh; // a finished scan is reused for the whole interval, even for a "fresh" sync
  if (!webdavEnabled()) throw davError('disabled');
  const conn = davConnection(config);
  if (!conn) throw davError('bad-url');
  const cache = deps.cache || require('../runtime/cache.ts');
  const now = deps.now || Date.now;
  const hit = await Promise.resolve(cache.get(conn.cacheKey)).catch(() => null);
  if (hit && Number.isFinite(hit.at) && now() - hit.at < scanTtlMs() && Array.isArray(hit.items)) return hit.items;
  const running = inFlight.get(conn.cacheKey);
  if (running) return running;
  const scan = (async () => {
    const files = await crawl(conn, { maxEntries: deps.maxEntries ?? SCAN_MAX_ENTRIES, maxDepth: deps.maxDepth ?? SCAN_MAX_DEPTH });
    const items = groupItems(files, conn.basePath);
    await Promise.resolve(cache.set(conn.cacheKey, { at: now(), items }, Math.ceil(scanTtlMs() / 1000))).catch(() => {});
    return items;
  })();
  inFlight.set(conn.cacheKey, scan);
  try { return await scan; } finally { inFlight.delete(conn.cacheKey); }
}

// Items always carry their file list (the scan builds it).
async function getWebdavFiles(_config: any, item: any): Promise<DavFile[]> {
  return Array.isArray(item && item.files) ? item.files : [];
}

async function verifyWebdav({ url, user, password }: { url?: string; user?: string; password?: string }): Promise<{ valid: boolean; error?: DavErrorCode; folders?: number; videos?: number }> {
  if (!webdavEnabled()) return { valid: false, error: 'disabled' };
  const conn = davConnection({ webdavUrl: url, webdavUser: user, webdavPassword: password });
  if (!conn) return { valid: false, error: 'bad-url' };
  try {
    const entries = await propfind(conn, conn.basePath);
    const direct = entries.filter((entry: any) => parentOf(entry.path) === conn.basePath);
    return {
      valid: true,
      folders: direct.filter((entry: any) => entry.isDir).length,
      videos: direct.filter((entry: any) => !entry.isDir && VIDEO_RE.test(entry.path)).length,
    };
  } catch (err: any) {
    return { valid: false, error: requestError(err).code };
  }
}

export interface WebdavApi {
  SCAN_MAX_ENTRIES: number; SCAN_MAX_DEPTH: number; SCAN_CONCURRENCY: number; REQUEST_TIMEOUT_MS: number; MAX_LISTING_BYTES: number;
  webdavEnabled: typeof webdavEnabled;
  allowPrivate: typeof allowPrivate;
  scanTtlMs: typeof scanTtlMs;
  davConnection: typeof davConnection;
  davRequest: typeof davRequest;
  fileRefToPath: typeof fileRefToPath;
  listWebdavLibrary: typeof listWebdavLibrary;
  getWebdavFiles: typeof getWebdavFiles;
  verifyWebdav: typeof verifyWebdav;
}

module.exports = {
  SCAN_MAX_ENTRIES, SCAN_MAX_DEPTH, SCAN_CONCURRENCY, REQUEST_TIMEOUT_MS, MAX_LISTING_BYTES,
  webdavEnabled, allowPrivate, scanTtlMs, davConnection, davRequest, fileRefToPath, listWebdavLibrary, getWebdavFiles, verifyWebdav,
} satisfies WebdavApi;
