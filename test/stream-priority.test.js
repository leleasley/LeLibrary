const test = require('node:test');
const assert = require('node:assert/strict');

const { compareExternalProviderPriority } = require('../src/streamAddons');

test('external stream provider priority wins over response speed and size', () => {
  const streams = [
    { name: 'Comet large', behaviorHints: { videoSize: 20_000 }, _externalPriority: 1 },
    { name: 'Torrentio small', behaviorHints: { videoSize: 1_000 }, _externalPriority: 0 },
    { name: 'Meteor medium', behaviorHints: { videoSize: 10_000 }, _externalPriority: 2 },
  ];
  assert.deepEqual(
    streams.slice().sort(compareExternalProviderPriority).map(stream => stream.name),
    ['Torrentio small', 'Comet large', 'Meteor medium']
  );
});
