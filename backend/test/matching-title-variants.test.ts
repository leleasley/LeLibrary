// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const { titleSearchVariants } = require('../src/matching/resolve.ts');

// Cases found wrong by the match bench (scripts/match-bench.ts).

test('punctuation does not split a Latin title into lone words', () => {
  const v = titleSearchVariants('Amore, Matrimoni E Altri Disastri');
  assert.ok(!v.includes('Amore'), `searched a lone first word: ${JSON.stringify(v)}`);
  assert.equal(v[0], 'Amore, Matrimoni E Altri Disastri');
});

test('mixed-script names still search each script, keeping "!"', () => {
  const v = titleSearchVariants('Скуби-ду! Маска Синего Сокола Scooby-doo! Mask Of The Blue Falcon');
  assert.ok(v.includes('Scooby-doo! Mask Of The Blue Falcon'), JSON.stringify(v));
  assert.ok(!v.includes('Scooby-doo'), JSON.stringify(v));
});

test('one- and two-letter Latin debris is never searched alone', () => {
  const v = titleSearchVariants('Предместьеtheburbswebdl1080p|p|winmedia');
  assert.ok(!v.includes('p'), JSON.stringify(v));
});

test('a title that is only a year is also searched in words', () => {
  assert.ok(titleSearchVariants('1984').includes('Nineteen Eighty-Four'));
  assert.ok(!titleSearchVariants('2046').some((v) => /Twenty/.test(v)));
  assert.ok(!titleSearchVariants('Blade Runner 2049').some((v) => /Thousand|Twenty/.test(v)));
});
