// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStreams, populateTmdbIndexFromMetas } = require('../src/catalog/builder.ts');

test('owned episode streams keep their batch group across episodes and distinguish batches', async () => {
  const userKey = 'binge-group-test';
  const tmdbId = '987654321';
  const batches = ['english', 'japanese'].map((language, index) => ({
    id: `batch-${index}`,
    source: 'torrent',
    name: `Example.Show.S01.${language}`,
    files: [1, 2].map(episode => ({
      id: episode,
      name: `Example.Show.S01E0${episode}.${language}.mkv`,
      size: 200 * 1024 * 1024,
    })),
  }));
  populateTmdbIndexFromMetas(batches.map(item => ({
    type: 'series', tmdbId, season: 1, episode: null, torboxItem: item,
  })), userKey);

  const config = { provider: 'torbox', torboxApiKey: 'test', streamNotices: 'off' };
  const getEpisode = episode => buildStreams(config, '', 'series', tmdbId, 1, episode, 'en-US', [], userKey, { lazyLinks: true });
  const first = await getEpisode(1);
  const second = await getEpisode(2);
  const groups = (streams, episode) => {
    assert.equal(streams.length, 2);
    return Object.fromEntries(streams.map(stream => {
      const filename = stream.behaviorHints.filename;
      assert.match(filename, new RegExp(`S01E0${episode}`));
      const language = filename.includes('.english.') ? 'english' : 'japanese';
      assert.ok(stream.behaviorHints.bingeGroup);
      return [language, stream.behaviorHints.bingeGroup];
    }));
  };
  const firstGroups = groups(first, 1);
  assert.notEqual(firstGroups.english, firstGroups.japanese);
  assert.deepEqual(groups(second, 2), firstGroups);
});

export interface BatchBingeGroupTestModule {};
