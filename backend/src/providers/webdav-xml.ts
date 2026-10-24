'use strict';
// WebDAV listing (PROPFIND) parsing. Pure: no I/O.
//
// Servers differ in the details, so this follows RFC 4918 rather than any one
// of them: an href is an absolute URI or an absolute path, namespace prefixes
// are arbitrary (D:, d:, lp1:), and a Depth: 1 listing starts with the folder
// itself. Entities are never expanded (fast-xml-parser has had entity
// expansion CVEs), and values stay strings ("0012" must not become 12).

const { XMLParser } = require('fast-xml-parser');

export interface DavEntry {
  path: string;
  isDir: boolean;
  size: number;
  modified: string | null;
  etag: string | null;
}

// Only what the crawler needs. Never allprop: some servers open every file to
// guess its content type.
const PROPFIND_BODY = '<?xml version="1.0" encoding="utf-8"?>'
  + '<D:propfind xmlns:D="DAV:"><D:prop>'
  + '<D:resourcetype/><D:getcontentlength/><D:getlastmodified/><D:getetag/>'
  + '</D:prop></D:propfind>';

const parser = new XMLParser({
  processEntities: false,
  htmlEntities: false,
  removeNSPrefix: true,
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name: string) => name === 'response' || name === 'propstat',
});

function decodeSegment(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}

// Decoded absolute path, no trailing slash ("/" stays "/").
function hrefToPath(href: string): string {
  let path = String(href || '').trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(path);
  if (scheme) path = path.slice(scheme[0].length);
  path = path.split('?')[0].split('#')[0];
  if (!path.startsWith('/')) path = `/${path}`;
  const decoded = path.split('/').map(decodeSegment).join('/');
  return decoded.length > 1 ? decoded.replace(/\/+$/, '') : decoded;
}

function encodePath(path: string): string {
  return String(path || '').split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function text(value: any): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && typeof value['#text'] === 'string') return value['#text'];
  return null;
}

// Basic XML entities in values (paths, etags) are decoded here, by hand.
function unescapeXml(value: string): string {
  return value.replace(/&(lt|gt|quot|apos|amp);/g, (_m, name) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' } as Record<string, string>)[name]);
}

function parseMultistatus(xml: string, requestPath: string): DavEntry[] {
  let doc: any;
  try { doc = parser.parse(String(xml || '')); } catch { return []; }
  const responses: any[] = (doc && doc.multistatus && doc.multistatus.response) || [];
  const self = hrefToPath(requestPath);
  const entries: DavEntry[] = [];
  for (const response of responses) {
    const href = text(response && response.href);
    if (!href) continue;
    const path = hrefToPath(unescapeXml(href));
    if (path === self) continue;
    // Merge the props of every propstat that reports 200.
    const props: Record<string, any> = {};
    for (const propstat of (response.propstat || [])) {
      const status = text(propstat && propstat.status) || '';
      if (!/\s200\s/.test(` ${status} `)) continue;
      Object.assign(props, propstat.prop || {});
    }
    if (!Object.keys(props).length) continue;
    const resourcetype = props.resourcetype;
    const isDir = Boolean(resourcetype && typeof resourcetype === 'object' && 'collection' in resourcetype);
    const length = Number(text(props.getcontentlength));
    const etag = text(props.getetag);
    entries.push({
      path,
      isDir,
      size: Number.isFinite(length) && length > 0 ? length : 0,
      modified: text(props.getlastmodified),
      etag: etag ? unescapeXml(etag) : null,
    });
  }
  return entries;
}

export interface WebdavXmlApi {
  PROPFIND_BODY: string;
  parseMultistatus: typeof parseMultistatus;
  hrefToPath: typeof hrefToPath;
  encodePath: typeof encodePath;
}

module.exports = { PROPFIND_BODY, parseMultistatus, hrefToPath, encodePath } satisfies WebdavXmlApi;
