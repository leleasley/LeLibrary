// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const boot = require('../src/platform/boot-html.ts');

const STATUS = { overall: 'degraded', providers: [{ status: 'operational' }, { status: 'operational' }, { status: 'up' }, { status: 'down' }] };

test('summary counts like the browser: pill counts operational, hero counts operational or up', () => {
  assert.deepEqual(boot.summarize(STATUS), { footerLabel: 'Degraded', pillClass: 'deg', pillCount: '2/4', heroCount: '3/4', heroWarn: true });
  assert.deepEqual(boot.summarize(null), { footerLabel: 'Unknown', pillClass: 'unknown', pillCount: '–', heroCount: '–', heroWarn: false });
});

test('the prerendered home markers are filled in and nothing else changes', () => {
  const html = '<head></head><a class="banner-pill unknown" title="Provider status" data-boot="pill" href="/status"><span class="banner-dot"></span><span data-boot="pill-count">–</span></a>'
    + '<div class="footer-status unknown" data-boot="footer-status"><span class="footer-status-dot"></span> <span data-boot="footer-label">Unknown</span></div>'
    + '<li><span class="hm-live" aria-hidden="true" data-boot="hero-live"></span><a href="/status"><b data-boot="hero-count">–</b> services up</a></li><p>Other – text</p>';
  const out = boot.patchHome(html, STATUS);
  assert.ok(out.includes('class="banner-pill deg" title="Provider status" data-boot="pill"'));
  assert.ok(out.includes('<span data-boot="pill-count">2/4</span>'));
  assert.ok(out.includes('<b data-boot="hero-count">3/4</b> services up'));
  assert.ok(out.includes('class="hm-live is-warn"'));
  assert.ok(out.includes('class="footer-status deg" data-boot="footer-status"'));
  assert.ok(out.includes('<span data-boot="footer-label">Degraded</span>'));
  assert.ok(out.endsWith('<p>Other – text</p>'), 'unmarked text is untouched');
  assert.equal(boot.patchHome(html, null), html, 'no status leaves the placeholders');
});

test('the boot block is inert JSON that cannot close its script tag', () => {
  const html = boot.injectBoot('<html><head><title>x</title></head><body></body></html>', { features: { releases: true, savedSetups: false }, status: { overall: '</script><script>alert(1)</script>' } });
  assert.ok(html.includes('<script type="application/json" id="ll-boot">'));
  assert.equal((html.match(/<\/script>/g) || []).length, 1, 'only the block\'s own closing tag');
  const json = html.slice(html.indexOf('id="ll-boot">') + 13, html.indexOf('</script>'));
  assert.equal(JSON.parse(json).status.overall, '</script><script>alert(1)</script>');
});
