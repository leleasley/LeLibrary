// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const dav = require('../src/providers/webdav-xml.ts');

// rclone / golang x/net/webdav: "D:" prefix, absolute-path hrefs.
const RCLONE = `<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response><D:href>/Movies/</D:href><D:propstat><D:prop>
    <D:resourcetype><D:collection/></D:resourcetype><D:getlastmodified>Mon, 01 Sep 2026 10:00:00 GMT</D:getlastmodified>
  </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
  <D:response><D:href>/Movies/Heat%20(1995)/</D:href><D:propstat><D:prop>
    <D:resourcetype><D:collection/></D:resourcetype>
  </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
  <D:response><D:href>/Movies/Heat.1995.1080p.mkv</D:href><D:propstat><D:prop>
    <D:resourcetype/><D:getcontentlength>1500000000</D:getcontentlength><D:getetag>"0012"</D:getetag>
    <D:getlastmodified>Mon, 01 Sep 2026 10:00:00 GMT</D:getlastmodified>
  </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
</D:multistatus>`;

// Nextcloud / Sabre: "d:" prefix plus oc: extras, hrefs under the user root.
const NEXTCLOUD = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns">
 <d:response><d:href>/remote.php/dav/files/u/Movies/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><oc:size>9</oc:size></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/files/u/Movies/Heat%20(1995)/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/files/u/Movies/Heat.1995.1080p.mkv</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>1500000000</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;

// Apache mod_dav: lp1: prefixes, absolute-URI hrefs, a 404 propstat.
const APACHE = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:ns0="DAV:">
<D:response xmlns:lp1="DAV:"><D:href>http://nas.local:8080/dav/Shows/</D:href>
<D:propstat><D:prop><lp1:resourcetype><D:collection/></lp1:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
<D:response xmlns:lp1="DAV:"><D:href>http://nas.local:8080/dav/Shows/A%20B/%23x%25.mkv</D:href>
<D:propstat><D:prop><lp1:resourcetype/><lp1:getcontentlength>42</lp1:getcontentlength></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
<D:propstat><D:prop><D:getetag/></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat></D:response>
</D:multistatus>`;

test('PROPFIND body asks for exactly the four properties', () => {
  for (const name of ['resourcetype', 'getcontentlength', 'getlastmodified', 'getetag']) assert.match(dav.PROPFIND_BODY, new RegExp(`<[a-zA-Z]*:?${name}\\s*/>`));
  assert.doesNotMatch(dav.PROPFIND_BODY, /allprop/);
});

test('rclone listing: folder itself skipped, folder and file entries parsed', () => {
  const entries = dav.parseMultistatus(RCLONE, '/Movies');
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { path: '/Movies/Heat (1995)', isDir: true, size: 0, modified: null, etag: null });
  assert.equal(entries[1].path, '/Movies/Heat.1995.1080p.mkv');
  assert.equal(entries[1].isDir, false);
  assert.equal(entries[1].size, 1500000000);
  assert.equal(entries[1].etag, '"0012"');
  assert.equal(entries[1].modified, 'Mon, 01 Sep 2026 10:00:00 GMT');
});

test('Nextcloud listing gives the same entries under its user root', () => {
  const entries = dav.parseMultistatus(NEXTCLOUD, '/remote.php/dav/files/u/Movies/');
  assert.deepEqual(entries.map((e) => [e.path, e.isDir]), [
    ['/remote.php/dav/files/u/Movies/Heat (1995)', true],
    ['/remote.php/dav/files/u/Movies/Heat.1995.1080p.mkv', false],
  ]);
});

test('Apache listing: absolute URI hrefs, other prefixes, 404 propstat ignored', () => {
  const entries = dav.parseMultistatus(APACHE, '/dav/Shows');
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], { path: '/dav/Shows/A B/#x%.mkv', isDir: false, size: 42, modified: null, etag: null });
});

test('href and path encoding round-trip odd names', () => {
  assert.equal(dav.hrefToPath('http://h:8080/dav/A%20B/%23x%25.mkv'), '/dav/A B/#x%.mkv');
  assert.equal(dav.hrefToPath('/dav/Folder/'), '/dav/Folder');
  assert.equal(dav.encodePath('/dav/A B/#x%.mkv'), '/dav/A%20B/%23x%25.mkv');
  assert.equal(dav.hrefToPath(dav.encodePath('/Ünïcode +plus/é 🎬.mkv')), '/Ünïcode +plus/é 🎬.mkv');
});

test('entities in a hostile listing are never expanded', () => {
  const hostile = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa">]>
<D:multistatus xmlns:D="DAV:"><D:response><D:href>/x/&a;.mkv</D:href><D:propstat><D:prop><D:resourcetype/></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`;
  const entries = dav.parseMultistatus(hostile, '/');
  assert.ok(entries.every((e) => !e.path.includes('aaaaaaaaaa')));
});
