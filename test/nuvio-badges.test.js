const test = require('node:test');
const assert = require('node:assert/strict');

const formatter = require('../website/public/formatter.js');
const { BADGES, GROUPS, badgeSvg, svgColor, manifest } = require('../src/nuvio-badges');

function asJsRegex(pattern) {
  // Nuvio uses Java/Kotlin regexes. Its inline case-insensitive flag maps to
  // the JavaScript flag for this compatibility check.
  return new RegExp(pattern.replace(/^\(\?i\)/, ''), 'i');
}

test('LeLibrary Premium badge manifest has valid grouped local images', () => {
  const data = manifest('https://lelibrary.example');
  const groupIds = new Set(GROUPS.map(([id]) => id));
  assert.equal(data.filters.length, BADGES.length);
  assert.equal(new Set(data.filters.map((filter) => filter.id)).size, data.filters.length);

  for (const filter of data.filters) {
    assert.ok(groupIds.has(filter.groupId), `${filter.id} has a known group`);
    assert.match(filter.imageURL, /^https:\/\/lelibrary\.example\/api\/nuvio-badges\/lelibrary-premium\/[\w-]+\.png\?v=\d+$/);
    assert.match(badgeSvg(filter.id), /^<svg\b/);
    assert.doesNotThrow(() => asJsRegex(filter.pattern), filter.id);
  }
  assert.equal(badgeSvg('not-a-badge'), null);
});

test('badge pills size to their text like community packs', () => {
  const widthOf = (svg) => Number(/width="(\d+)"/.exec(svg)[1]);
  const short = widthOf(badgeSvg('res-4k'));
  const long = widthOf(badgeSvg('edition-criterion'));
  assert.ok(short < 160, `4K pill stays compact (got ${short})`);
  assert.ok(long > short, 'longer labels get wider pills');
  assert.ok(long < 400, `longest pill stays bounded (got ${long})`);
});

test('badge SVG colors convert Nuvio AARRGGBB to plain RGB', () => {
  assert.equal(svgColor('#FF1769AA'), '#1769AA');
  assert.equal(svgColor('#FF2E8B57'), '#2E8B57');
  assert.equal(svgColor('#121820'), '#121820');
  const svg = badgeSvg('res-4k');
  assert.ok(svg.includes('fill="#1769AA"'), '4K badge uses converted blue');
  assert.ok(!svg.includes('#FF1769AA'), 'no raw AARRGGBB leaks into SVG output');
});

test('badge SVGs rasterise to real PNGs', async () => {
  const sharp = require('sharp');
  for (const id of ['res-4k', 'source-remux', 'audio-atmos']) {
    const png = await sharp(Buffer.from(badgeSvg(id))).png().toBuffer();
    assert.deepEqual(png.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    assert.ok(png.length > 1000, `${id} PNG is not trivially empty`);
  }
});

test('formatter output contains reliable text for each local badge category', () => {
  const filenames = [
    'Film.2026.2160p.BluRay.REMUX.IMAX.DV.HDR10+.HEVC.10bit.TrueHD.Atmos.7.1-Group.mkv',
    'Film.2026.1080p.WEB-DL.H.264.AAC.5.1.English.mkv',
    'Film.2026.2160p.WEB-DL.AV1.DDP.5.1.Dual.Audio.PT-BR.mkv',
    'Film.2026.720p.WEBRip.x265.DTS-HD.MA.5.1.Spanish.mkv',
  ];
  const text = filenames.map((filename) => {
    const output = formatter.formatStream(
      formatter.presets.technical.name,
      formatter.presets.technical.description,
      filename,
      'torbox',
      73900000000,
    );
    return `${output.name}\n${output.description}`;
  }).join('\n');

  const filters = manifest('https://lelibrary.example').filters;
  for (const group of ['resolution', 'source', 'edition', 'visual', 'audio', 'channels', 'codec', 'language']) {
    assert.ok(filters.filter((filter) => filter.groupId === group).some((filter) => asJsRegex(filter.pattern).test(text)), `${group} has a match`);
  }
  for (const id of ['source-remux', 'edition-imax', 'visual-dv', 'audio-atmos-truehd', 'codec-av1', 'lang-pt', 'lang-es']) {
    const filter = filters.find((entry) => entry.id === id);
    assert.match(text, asJsRegex(filter.pattern), id);
  }
});
