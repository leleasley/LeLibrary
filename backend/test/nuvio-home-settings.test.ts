// @ts-nocheck
'use strict';
// Nuvio's Home-catalog settings blob carries hide_unreleased_content for both
// TV and mobile. LeLibrary already pulls and pushes that blob for Home rows;
// the setup's choice must override the field only when it was set, and must
// preserve the user's value otherwise.
const test = require('node:test');
const assert = require('node:assert/strict');

const { homeSettingsPayload } = require('../src/catalog/nuvio-home-settings.ts');

test('preserves the existing choice when the setup leaves it unchanged', () => {
  const payload = homeSettingsPayload({ show_catalog_type: false, hide_unreleased_content: true, extra: 1 }, ['row'], null);
  assert.deepEqual(payload, {
    show_catalog_type: false,
    hide_unreleased_content: true,
    items: ['row'],
  });
});

test('defaults to showing unreleased titles when there is no stored value', () => {
  assert.equal(homeSettingsPayload(null, [], null).hide_unreleased_content, false);
});

test('overrides the stored value when the setup chose hide or show', () => {
  assert.equal(homeSettingsPayload({ hide_unreleased_content: false }, [], true).hide_unreleased_content, true);
  assert.equal(homeSettingsPayload({ hide_unreleased_content: true }, [], false).hide_unreleased_content, false);
});

test('keeps the items array intact', () => {
  const items = [{ catalog_id: 'a' }];
  assert.deepEqual(homeSettingsPayload({}, items, true).items, items);
});

export interface NuvioHomeSettingsTestModule {}
