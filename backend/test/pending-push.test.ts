// @ts-nocheck
// The pending-publish job: the contract between the push route (which schedules
// it) and the handler (which finishes the push once the owned library exists).
//
// These tests exist because the first version of this pair silently did nothing:
// the handler reads the setup uuid from the payload, but the scheduler only put
// it in the job id. The runner then reported "finished" without publishing
// anything, which would have dropped a user's library folders without a trace.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const jobs = require('../src/runtime/jobs.ts');
const pendingPush = require('../src/setup/pending-push.ts');

const UUID = 'cce692a7-8341-45fd-93c4-1ec6bd56385f';

test('the scheduled payload carries everything the handler needs', async () => {
  const scheduled = await pendingPush.schedulePendingPublish({
    uuid: UUID, origin: 'https://example.test', profileId: 2,
  });
  assert.ok(scheduled, 'nothing was scheduled');
  const record = jobs.jobState(pendingPush.JOB_KIND, UUID);
  assert.equal(record.payload.uuid, UUID, 'handler cannot load the setup without it');
  assert.equal(record.payload.origin, 'https://example.test');
  assert.equal(record.payload.profileId, 2);
  await pendingPush.cancelPendingPublish(UUID);
});

test('a pending publish without an origin or uuid is not silently accepted', async () => {
  assert.equal(await pendingPush.schedulePendingPublish({ uuid: '', origin: 'https://example.test' }), null);
  assert.equal(await pendingPush.schedulePendingPublish({ uuid: UUID, origin: '' }), null);
  // A payload that reached the handler incomplete retries rather than claiming
  // success, so the work cannot vanish.
  assert.equal(await pendingPush.finishPendingPush({ uuid: UUID }), 'retry');
  assert.equal(await pendingPush.finishPendingPush({ origin: 'https://example.test' }), 'done');
});

test('rescheduling a partial push refreshes the one job instead of stacking', async () => {
  await pendingPush.schedulePendingPublish({ uuid: UUID, origin: 'https://example.test', profileId: 0 });
  await pendingPush.schedulePendingPublish({ uuid: UUID, origin: 'https://example.test', profileId: 1 });
  assert.equal(jobs.jobState(pendingPush.JOB_KIND, UUID).payload.profileId, 1);
  await pendingPush.cancelPendingPublish(UUID);
  assert.equal(jobs.jobState(pendingPush.JOB_KIND, UUID), null);
});
