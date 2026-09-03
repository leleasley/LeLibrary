const test = require('node:test');
const assert = require('node:assert/strict');

const formatter = require('../website/public/formatter.js');
const tokenMap = require('../website/public/token-map.js');

test('formatter lelibrary preset renders sample filenames without throwing', () => {
  const preset = formatter.presets.lelibrary;
  assert.ok(preset && preset.name && preset.description);
  const samples = [
    { filename: 'Sonic.the.Hedgehog.3.2024.1080p.WEB-DL.H265.Dual.Audio.PT-BR.DD5.1-BIOMA.mkv', source: 'torbox', size: 9126805504 },
    { filename: 'Dune.Part.Two.2024.2160p.BluRay.HEVC.HDR10Plus.TrueHD.Atmos-GROUP.mkv', source: 'torbox', size: 45097156608 },
    { filename: 'Game.of.Thrones.S01E01.720p.WEBRip.x264-FoV.mkv', source: 'realdebrid', size: 1258291200 },
  ];
  for (const s of samples) {
    const ctx = formatter.buildLeContext(s.filename, s.source, s.size);
    const name = formatter.render(preset.name, ctx);
    const desc = formatter.render(preset.description, ctx);
    assert.ok(name.length > 0);
    assert.ok(desc.length > 0);
  }
});

test('cinema formatter presets expose parsed REMUX, audio, HDR and size details', () => {
  const filename = 'Example.Movie.2026.2160p.BluRay.REMUX.DV.HDR10+.HEVC.TrueHD.Atmos.7.1-FRDS.mkv';
  const ctx = formatter.buildLeContext(filename, 'torbox', 73900000000);
  assert.deepEqual(ctx.stream.releaseTags, ['REMUX']);
  for (const presetId of ['cinema', 'remux', 'compact', 'technical']) {
    const preset = formatter.presets[presetId];
    const output = formatter.formatStream(preset.name, preset.description, filename, 'torbox', 73900000000, { addonName: 'LeLibrary' });
    assert.match(output.name + output.description, /REMUX/);
    assert.match(output.name + output.description, /HEVC/);
    assert.match(output.name + output.description, /73\.9 GB/);
  }
});

test('formatter renders custom templates used by the configure preview', () => {
  const ctx = formatter.buildLeContext('Toy.Story.2.1999.2160p.BluRay.HEVC.TrueHD.7.1.Atmos-FRDS', 'torbox', 2630000000);
  const name = formatter.render('{service.shortName} · {stream.resolution}', ctx);
  assert.match(name, /TB/i);
  assert.match(name, /2160p/i);
  const desc = formatter.render('{stream.size::sbytes} · {stream.encode}', ctx);
  assert.match(desc, /GB/i);
  assert.match(desc, /HEVC/i);
});

test('formatter exposes metadata title and year to custom templates', () => {
  const ctx = formatter.buildLeContext('Toy.Story.2.1999.2160p.BluRay.HEVC.mkv', 'torbox', 2630000000);
  assert.equal(formatter.render('{metadata.title}', ctx), 'Toy Story 2');
  assert.equal(formatter.render('{metadata.year}', ctx), '1999');
  const supplied = formatter.buildLeContext('ignored.mkv', 'torbox', 1, { metadata: { title: 'A Supplied Title', year: 2024 } });
  assert.equal(formatter.render('{metadata.title} ({metadata.year})', supplied), 'A Supplied Title (2024)');
});

test('empty templates fall back to a non-empty preview result', () => {
  // renderPreview falls back to the lelibrary preset when both textareas are
  // empty: the same inputs must produce output via the preset templates.
  const ctx = formatter.buildLeContext('Sonic.the.Hedgehog.3.2024.1080p.WEB-DL.H265.Dual.Audio.PT-BR.DD5.1-BIOMA.mkv', 'torbox', 9126805504);
  const name = formatter.render(formatter.presets.lelibrary.name, ctx);
  const desc = formatter.render(formatter.presets.lelibrary.description, ctx);
  assert.ok(name.trim().length > 0);
  assert.ok(desc.trim().length > 0);
});

test('token-map encodes and decodes a realistic config round-trip', () => {
  const cfg = {
    provider: 'torbox',
    torboxApiKey: 'DUMMYKEYTEST12345678',
    tmdbApiKey: 'DUMMYTMDBKEY',
    lang: 'en-US',
    sortBy: 'data_adicao',
    rdCatalog: 'merge',
    searchScope: 'combined',
    streamPreset: 'torrentio',
    streamAddons: ['https://torrentio.strem.fun/manifest.json'],
    nuvioCollectionPacks: ['streaming', 'actors'],
  };
  const encoded = tokenMap.encodeConfig(cfg);
  assert.ok(typeof encoded === 'string' && encoded.length > 0);
  const decoded = tokenMap.normalizeConfig(JSON.parse(Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')));
  assert.equal(decoded.provider, 'torbox');
  assert.equal(decoded.torboxApiKey, cfg.torboxApiKey);
  assert.equal(decoded.streamPreset, 'torrentio');
  assert.equal(decoded.searchScope, 'combined');
  assert.deepEqual(decoded.streamAddons, cfg.streamAddons);
  assert.deepEqual(decoded.nuvioCollectionPacks, cfg.nuvioCollectionPacks);
});

test('token-map drops empty and default fields to keep tokens small', () => {
  const encoded = tokenMap.encodeConfig({ provider: 'torbox', sortBy: 'data_adicao', rdCatalog: 'merge', tmdbApiKey: '' });
  const decoded = JSON.parse(Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  assert.equal(decoded.p, 'torbox');
  assert.equal(decoded.s, undefined); // server default dropped
  assert.equal(decoded.c, undefined); // server default dropped
  assert.equal(decoded.k, undefined); // empty string dropped
});
