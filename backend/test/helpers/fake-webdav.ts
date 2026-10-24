// @ts-nocheck
// A tiny in-memory WebDAV server for tests: PROPFIND (Depth 0/1, or the whole
// tree when `ignoreDepth`) and GET/HEAD with Range. Synthetic credentials only.
const http = require('node:http');

function encodePath(p) { return p.split('/').map(encodeURIComponent).join('/'); }

function createFakeWebdav({ files = {}, user = 'u', pass = 'p', ignoreDepth = false, prefix = '' } = {}) {
  // files: { '/Movies/Heat (1995)/Heat.mkv': Buffer | number(size) }
  const log = [];
  const closed = { count: 0 };
  const entries = new Map();
  for (const [path, body] of Object.entries(files)) {
    entries.set(path, typeof body === 'number' ? { size: body, body: null } : { size: body.length, body });
    const parts = path.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) entries.set('/' + parts.slice(0, i).join('/') + '/', { dir: true });
  }
  entries.set('/', { dir: true });
  const children = (dir, deep) => [...entries.keys()].filter((p) => p !== dir && p.startsWith(dir)
    && (deep || !p.slice(dir.length).replace(/\/$/, '').includes('/')));
  const responseXml = (p) => {
    const e = entries.get(p);
    const props = e.dir ? '<D:resourcetype><D:collection/></D:resourcetype>'
      : `<D:resourcetype/><D:getcontentlength>${e.size}</D:getcontentlength><D:getlastmodified>Mon, 01 Sep 2026 10:00:00 GMT</D:getlastmodified>`;
    return `<D:response><D:href>${prefix}${encodePath(p)}</D:href><D:propstat><D:prop>${props}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
  };
  const server = http.createServer((req, res) => {
    log.push({ method: req.method, url: req.url, depth: req.headers.depth, auth: req.headers.authorization || null, range: req.headers.range || null });
    if (server.redirectTo && req.method === 'GET') { res.writeHead(302, { Location: server.redirectTo }); return res.end(); }
    if (req.headers.authorization !== 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="dav"' }); return res.end();
    }
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (prefix && path.startsWith(prefix)) path = path.slice(prefix.length) || '/';
    if (req.method === 'PROPFIND') {
      const key = entries.has(path) ? path : (entries.has(path + '/') ? path + '/' : null);
      if (!key) { res.writeHead(404); return res.end(); }
      const deep = ignoreDepth || req.headers.depth === undefined || req.headers.depth === 'infinity';
      const list = req.headers.depth === '0' ? [key] : [key, ...children(key, deep)];
      res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
      return res.end(`<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${list.map(responseXml).join('')}</D:multistatus>`);
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const e = entries.get(path);
      if (!e || e.dir) { res.writeHead(404); return res.end(); }
      const body = e.body || Buffer.alloc(e.size, 7);
      res.on('close', () => { closed.count++; });
      const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      const headers = { 'Accept-Ranges': 'bytes', 'Content-Type': 'video/x-matroska', ETag: '"e1"', 'Set-Cookie': 'x=1' };
      if (m) {
        const start = Number(m[1]); const end = m[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1;
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1 });
        return req.method === 'HEAD' ? res.end() : res.end(body.subarray(start, end + 1));
      }
      res.writeHead(200, { ...headers, 'Content-Length': body.length });
      if (req.method === 'HEAD') return res.end();
      if (server.slow) { res.write(body.subarray(0, 1024)); return; } // never finishes
      return res.end(body);
    }
    res.writeHead(405); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}${prefix}`;
    resolve({ server, url, log, closed, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) });
  }));
}

module.exports = { createFakeWebdav };
