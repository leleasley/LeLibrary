// @ts-nocheck
// Season packs: TorBox names each file with its folder in front. The episode
// must come from the file's own name, not the folder's season-only name.
const test = require('node:test');
const assert = require('node:assert/strict');
const { episodeFileInfo } = require('../src/catalog/builder.ts');

test('a season pack file is read by its own name, not its folder', () => {
  const info = episodeFileInfo({ name: 'Show.Name.S02.2160p.WEB-DL.x265-GRP/Show.Name.S02E03.2160p.WEB-DL.x265-GRP.mkv' });
  assert.equal(info.season, 2);
  assert.equal(info.episode, 3);
});

test('short_name wins when TorBox sends it', () => {
  const info = episodeFileInfo({ name: 'Pack.S01-S09.1080p/Pack.S01.1080p/Show.S01E07.1080p.mkv', short_name: 'Show.S01E07.1080p.mkv' });
  assert.equal(info.episode, 7);
});

test('1x02 style and nested season folders still work', () => {
  assert.equal(episodeFileInfo({ name: 'Show.S01.1080p/Show.1x02.Title.1080p.mkv' }).episode, 2);
  const nested = episodeFileInfo({ name: 'Show Name/S04/Show Name S04E01 Title.mkv' });
  assert.equal(nested.season, 4);
  assert.equal(nested.episode, 1);
});

test('a file with no episode in its own name falls back to the full path', () => {
  const info = episodeFileInfo({ name: 'Show.S03E05.1080p/video.mkv' });
  assert.equal(info.season, 3);
  assert.equal(info.episode, 5);
});
