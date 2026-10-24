// @ts-nocheck
const axios = require('axios');
const https = require('https');
const http = require('http');

const RD_BASE = 'https://api.real-debrid.com/rest/1.0';

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 32, keepAliveMsecs: 30000 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 32, keepAliveMsecs: 30000 });

const infoCache = new Map();

async function getRealDebridInfoCached(apiKey, itemId) {
  const key = `${apiKey}:${itemId}`;
  if (infoCache.has(key)) return infoCache.get(key);
  const promise = rdGet(`/torrents/info/${itemId}`, apiKey).then(res => {
    setTimeout(() => infoCache.delete(key), 60000);
    return res;
  });
  infoCache.set(key, promise);
  return promise;
}

async function rdGet(path, apiKey, params = {}) {
  try {
    const res = await axios.get(`${RD_BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      params,
      timeout: 20000,
      httpAgent,
      httpsAgent,
    });
    return { data: res.data };
  } catch (err) {
    return { error: err.response?.data?.error || err.message, status: err.response?.status };
  }
}

async function getRealDebridDownloads(apiKey) {
  // Fetch first page to see if there are more
  const { data: first, error } = await rdGet('/torrents', apiKey, { page: 1, limit: 100 });
  if (error) {
    console.error(`[RD] Torrents error: ${error}`);
    throw new Error(`[RD] Torrents error: ${error}`);
  }
  if (!Array.isArray(first)) {
    throw new Error('[RD] Unexpected response format from /torrents');
  }
  if (first.length === 0) return [];

  // If the first page is already full, fetch subsequent pages in parallel batches
  // without capping at 1,000 items, supporting 2,000 to 5,000+ items fast.
  let allPages = [first];
  let currentPage = 2;
  const CHUNK_SIZE = 8;
  while (allPages[allPages.length - 1].length === 100) {
    const pageNumbers = Array.from({ length: CHUNK_SIZE }, (_, i) => currentPage + i);
    const rest = await Promise.all(
      pageNumbers.map((page) =>
        rdGet('/torrents', apiKey, { page, limit: 100 })
          .then((r) => (Array.isArray(r.data) ? r.data : []))
          .catch(() => [])
      )
    );
    let finished = false;
    for (const data of rest) {
      if (!data.length) { finished = true; break; }
      allPages.push(data);
      if (data.length < 100) { finished = true; break; }
    }
    if (finished) break;
    currentPage += CHUNK_SIZE;
  }

  const items = [];
  for (const page of allPages) {
    for (const t of page) {
      if (t.status !== 'downloaded') continue;
      const filename = t.filename || '';

      items.push({
        id:               t.id,
        name:             t.filename,
        filename:         t.filename,
        size:             t.bytes,
        source:           'realdebrid',
        download_state:   'completed',
        download_finished: true,
        created_at:       t.added,
        _rdHash:          t.hash,
      });
    }
  }

  console.log(`[RD] Downloads: ${items.length} items`);
  return items;
}

async function getRealDebridFiles(apiKey, itemId) {
  const { data, error } = await getRealDebridInfoCached(apiKey, itemId);
  if (error || !data) return [];
  return (data.files || [])
    .filter(f => f.selected === 1)
    .map(f => ({ id: f.id, name: f.path?.split('/').pop() || f.path, size: f.bytes }));
}

async function getRealDebridStreamLink(apiKey, itemId, fileId) {
  // 1. Pega links do torrent
  const { data: info, error } = await getRealDebridInfoCached(apiKey, itemId);
  if (error || !info?.links?.length) return null;

  // fileId is 1-based index of selected files
  const selectedFiles = (info.files || []).filter(f => f.selected === 1);
  const fileIndex = selectedFiles.findIndex(f => f.id === fileId);
  const link = info.links[fileIndex >= 0 ? fileIndex : 0];
  if (!link) return null;

  // 2. Unrestrict o link
  const { data: unrestricted } = await axios.post(
    `${RD_BASE}/unrestrict/link`,
    new URLSearchParams({ link }),
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 }
  ).catch(() => ({ data: null }));

  return unrestricted?.download || null;
}

// Change probe (library/change-probe.ts): one small request whose headers
// matter (x-total-count). Throws on any failure so the probe reports unknown.
async function realDebridProbeGet(apiKey, path, params = {}) {
  const res = await axios.get(`${RD_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` }, params, timeout: 15000, httpAgent, httpsAgent,
  });
  return { data: res.data, headers: res.headers || {} };
}

export interface RealdebridApi {
  realDebridProbeGet: any;
  getRealDebridDownloads: any;
  getRealDebridFiles: any;
  getRealDebridStreamLink: any;
}

export interface RealdebridApi {
  getRealDebridDownloads: (config: any) => Promise<any[]>;
  getRealDebridFiles: (item: any, config: any) => Promise<any[]>;
  getRealDebridStreamLink: (config: any, item: any, file: any) => Promise<string>;
}

module.exports = { realDebridProbeGet, getRealDebridDownloads, getRealDebridFiles, getRealDebridStreamLink } satisfies RealdebridApi
