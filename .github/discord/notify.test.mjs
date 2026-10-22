// node --test .github/discord/notify.test.mjs
// Pure checks with fixture payloads and a fake fetch: no network, no secret.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LIMITS, buildPushMessage, buildReleaseMessage, buildTestMessage, checkWebhookUrl,
  deliver, embedLength, escapeMarkdown, notesForDiscord, run, truncateNotes,
} from './notify.mjs';

const CONTEXT = { server: 'https://github.com', repository: 'leleasley/LeLibrary' };
const FAKE_HOOK = 'https://discord.com/api/webhooks/123456789/fake-token_for-tests';
const sha = (n) => String(n).repeat(40).slice(0, 40);

function pushEvent(overrides = {}) {
  return {
    ref: 'refs/heads/v5.5',
    before: sha(1),
    after: sha(3),
    created: false,
    deleted: false,
    forced: false,
    sender: { login: 'leleasley', html_url: 'https://github.com/leleasley', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
    pusher: { name: 'leleasley' },
    commits: [
      { id: sha(2), message: 'fix: first change\n\nlong body', distinct: true, author: { username: 'leleasley' } },
      { id: sha(3), message: 'feat: second *change* [x](y)', distinct: true, author: { name: 'Lewis' } },
    ],
    head_commit: { timestamp: '2026-10-22T10:00:00Z' },
    ...overrides,
  };
}

function release(overrides = {}) {
  return {
    tag_name: 'v5.5.0',
    name: 'LeLibrary v5.5.0',
    html_url: 'https://github.com/leleasley/LeLibrary/releases/tag/v5.5.0',
    body: '### New things\n\n- One\n- Two\n\n```\ndocker pull ghcr.io/leleasley/lelibrary:v5.5.0\n```',
    prerelease: false,
    published_at: '2026-10-22T12:00:00Z',
    assets: [],
    ...overrides,
  };
}

const response = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

test('push message links every commit by its full SHA on github.com', () => {
  const { embeds, allowed_mentions } = buildPushMessage(pushEvent(), { ...CONTEXT, total: 2 });
  const [embed] = embeds;
  assert.deepEqual(allowed_mentions, { parse: [] });
  assert.equal(embed.title, '[LeLibrary:v5.5] 2 new commits');
  assert.ok(embed.description.includes(`(https://github.com/leleasley/LeLibrary/commit/${sha(2)})`));
  assert.ok(embed.description.includes(`(https://github.com/leleasley/LeLibrary/commit/${sha(3)})`));
  assert.ok(!embed.description.includes('api.github.com'));
  assert.ok(embed.description.includes('fix: first change'));
  assert.ok(!embed.description.includes('long body'), 'only the subject line is shown');
  assert.ok(embed.description.includes('\\*change\\* \\[x\\](y)'), 'markdown in messages is escaped');
  assert.equal(embed.url, `https://github.com/leleasley/LeLibrary/compare/${sha(1)}...${sha(3)}`);
  const fields = Object.fromEntries(embed.fields.map((field) => [field.name, field.value]));
  assert.equal(fields.Commits, '2');
  assert.equal(fields.Branch, '[v5.5](https://github.com/leleasley/LeLibrary/tree/v5.5)');
  assert.equal(embed.author.name, 'leleasley');
});

test('a big push is grouped into one message and says how many are hidden', () => {
  const commits = Array.from({ length: 20 }, (_, i) => ({ id: sha((i % 9) + 1), message: `change ${i}`, distinct: true }));
  const [embed] = buildPushMessage(pushEvent({ commits }), { ...CONTEXT, total: 57 }).embeds;
  assert.equal(embed.title, '[LeLibrary:v5.5] 57 new commits');
  assert.equal((embed.description.match(/\/commit\//g) || []).length, 10);
  assert.ok(embed.description.includes('...and 47 more commits.'));
});

test('a new branch links its history, a fast-forward does not re-list old commits', () => {
  const created = buildPushMessage(pushEvent({ created: true, before: '0'.repeat(40) }), { ...CONTEXT, total: 2 }).embeds[0];
  assert.equal(created.url, `https://github.com/leleasley/LeLibrary/commits/${sha(3)}`);
  assert.ok(created.fields.some((field) => field.value.includes('(new)')));

  const ff = buildPushMessage(pushEvent({ ref: 'refs/heads/main', commits: pushEvent().commits.map((c) => ({ ...c, distinct: false })) }), { ...CONTEXT, total: 0 }).embeds[0];
  assert.equal(ff.title, '[LeLibrary:main] branch updated');
  assert.ok(ff.description.includes('already pushed to another branch'));
});

test('release message carries name, tag, date, notes, link and downloads', () => {
  const [embed] = buildReleaseMessage(release({
    assets: [{ name: 'lelibrary.tar.gz', size: 2_500_000, browser_download_url: 'https://github.com/leleasley/LeLibrary/releases/download/v5.5.0/lelibrary.tar.gz' }],
  }), CONTEXT).embeds;
  assert.equal(embed.title, 'LeLibrary v5.5.0');
  assert.equal(embed.url, 'https://github.com/leleasley/LeLibrary/releases/tag/v5.5.0');
  assert.ok(embed.description.startsWith('**New things**'), 'headings become bold lines');
  assert.equal(embed.timestamp, '2026-10-22T12:00:00Z');
  const fields = Object.fromEntries(embed.fields.map((field) => [field.name, field.value]));
  assert.equal(fields.Version, '`v5.5.0`');
  assert.equal(fields.Type, 'Release');
  assert.equal(fields.Published, `<t:${Date.parse('2026-10-22T12:00:00Z') / 1000}:F>`);
  assert.ok(fields.Downloads.includes('[lelibrary.tar.gz](https://github.com/leleasley/LeLibrary/releases/download/v5.5.0/lelibrary.tar.gz) (2.4 MB)'));
  assert.ok(fields.Downloads.includes('/archive/refs/tags/v5.5.0.zip'));
  assert.equal(fields['Docker image'], '```\ndocker pull ghcr.io/leleasley/lelibrary:v5.5.0\n```');
});

test('a pre-release is labelled and coloured differently', () => {
  const [embed] = buildReleaseMessage(release({ tag_name: 'v5.6.0-rc.1', name: '', prerelease: true }), CONTEXT).embeds;
  assert.equal(embed.title, 'LeLibrary v5.6.0-rc.1 (pre-release)');
  assert.notEqual(embed.color, buildReleaseMessage(release(), CONTEXT).embeds[0].color);
});

test('long release notes are cut cleanly, fences closed, with a link to the rest', () => {
  const body = Array.from({ length: 400 }, (_, i) => (i === 200 ? '```' : `- line number ${i} with some words`)).join('\n');
  const [embed] = buildReleaseMessage(release({ body }), CONTEXT).embeds;
  assert.ok(embed.description.length <= LIMITS.description);
  assert.ok(embedLength(embed) <= LIMITS.total);
  assert.ok(embed.description.includes('[Read the full release notes on GitHub](https://github.com/leleasley/LeLibrary/releases/tag/v5.5.0)'));
  assert.equal((embed.description.match(/```/g) || []).length % 2, 0);
});

test('a cut never ends on an empty group heading', () => {
  const text = `**One**\n\n${'- a fairly long line of notes\n'.repeat(30)}\n**Two**\n\n${'- more notes here\n'.repeat(30)}`;
  const cut = truncateNotes(text, 1000, 'https://x');
  assert.ok(!/\*\*Two\*\*\n\.\.\./.test(cut));
  assert.ok(cut.endsWith('(https://x)**'));
});

test('truncateNotes leaves short notes alone', () => {
  assert.equal(truncateNotes('short', 100, 'https://x'), 'short');
});

test('notesForDiscord turns headings bold and drops HTML comments', () => {
  assert.equal(notesForDiscord('## Title\n<!-- hidden -->\ntext'), '**Title**\n\ntext');
});

test('escapeMarkdown neutralises link and formatting syntax', () => {
  assert.equal(escapeMarkdown('[a](b) *c* `d` <@1>'), '\\[a\\](b) \\*c\\* \\`d\\` \\<@1>');
});

test('every embed fits Discord limits even with huge inputs', () => {
  const huge = 'x'.repeat(10_000);
  for (const payload of [
    buildPushMessage(pushEvent({ ref: `refs/heads/${huge}`, commits: [{ id: sha(4), message: huge, distinct: true }] }), { ...CONTEXT, total: 1 }),
    buildReleaseMessage(release({ name: huge, body: huge }), CONTEXT),
  ]) {
    const [embed] = payload.embeds;
    assert.ok(embed.title.length <= LIMITS.title);
    assert.ok(embed.description.length <= LIMITS.description);
    for (const field of embed.fields) assert.ok(field.value.length <= LIMITS.fieldValue);
    assert.ok(embedLength(embed) <= LIMITS.total);
  }
});

test('test message is clearly labelled', () => {
  const [embed] = buildTestMessage({ ...CONTEXT, actor: 'leleasley', runId: '42' }).embeds;
  assert.equal(embed.title, 'Test notification');
  assert.equal(embed.url, 'https://github.com/leleasley/LeLibrary/actions/runs/42');
  assert.match(embed.footer.text, /test/i);
});

test('only real Discord webhook URLs are accepted', () => {
  assert.equal(checkWebhookUrl('').reason, 'missing');
  assert.equal(checkWebhookUrl(undefined).reason, 'missing');
  assert.equal(checkWebhookUrl('http://discord.com/api/webhooks/1/abc').reason, 'invalid');
  assert.equal(checkWebhookUrl('https://evil.example/api/webhooks/1/abc').reason, 'invalid');
  assert.equal(checkWebhookUrl('not a url').reason, 'invalid');
  const ok = checkWebhookUrl(FAKE_HOOK);
  assert.ok(ok.ok);
  assert.equal(ok.url.searchParams.get('wait'), 'true');
});

test('deliver confirms the message id and retries a 429 using retry_after', async () => {
  const calls = [];
  const waits = [];
  const answers = [response(429, { retry_after: 1.5, message: 'You are being rate limited.' }), response(200, { id: '999' })];
  const result = await deliver(new URL(FAKE_HOOK), { content: 'x' }, {
    fetchImpl: async (url, init) => { calls.push(init); return answers.shift(); },
    wait: async (ms) => { waits.push(ms); },
    log: () => {},
  });
  assert.deepEqual(result, { status: 200, id: '999' });
  assert.equal(calls.length, 2);
  assert.equal(waits[0], 1750);
});

test('deliver retries network errors and 5xx, then fails without the URL', async () => {
  const logs = [];
  let attempts = 0;
  await assert.rejects(
    deliver(new URL(FAKE_HOOK), {}, {
      fetchImpl: async () => { attempts += 1; if (attempts % 2) throw new TypeError(`fetch failed ${FAKE_HOOK}`); return response(502, { message: 'bad gateway' }); },
      wait: async () => {},
      log: (line) => logs.push(line),
    }),
    (error) => {
      assert.match(error.message, /HTTP 502/);
      assert.ok(!error.message.includes('fake-token'));
      return true;
    },
  );
  assert.equal(attempts, 4);
  assert.ok(logs.every((line) => !line.includes('fake-token')));
});

test('deliver explains a deleted webhook and does not retry 4xx', async () => {
  let attempts = 0;
  await assert.rejects(
    deliver(new URL(FAKE_HOOK), {}, { fetchImpl: async () => { attempts += 1; return response(404, { code: 10015, message: 'Unknown Webhook' }); }, wait: async () => {}, log: () => {} }),
    /Unknown Webhook.*DISCORD_WEBHOOK_URL repository secret/,
  );
  assert.equal(attempts, 1);
});

test('deliver refuses to claim success without a message id', async () => {
  await assert.rejects(
    deliver(new URL(FAKE_HOOK), {}, { fetchImpl: async () => response(204), wait: async () => {}, log: () => {} }),
    /cannot be confirmed/,
  );
});

function eventFile(payload) {
  const dir = mkdtempSync(join(tmpdir(), 'discord-notify-'));
  const file = join(dir, 'event.json');
  writeFileSync(file, JSON.stringify(payload));
  return file;
}

test('run: a missing secret skips automatic runs but fails the manual test', async () => {
  const logs = [];
  const base = { GITHUB_REPOSITORY: 'leleasley/LeLibrary', GITHUB_EVENT_PATH: eventFile(pushEvent()) };
  assert.deepEqual(await run({ ...base, NOTIFY_MODE: 'push' }, { log: (line) => logs.push(line) }), { skipped: true });
  assert.match(logs[0], /^::warning::/);
  await assert.rejects(run({ ...base, NOTIFY_MODE: 'test' }, { log: () => {} }), /Nothing was sent/);
});

test('run: sends the right message per mode and logs no secret', async () => {
  const logs = [];
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return response(200, { id: '1' }); };
  const env = { DISCORD_WEBHOOK_URL: FAKE_HOOK, GITHUB_REPOSITORY: 'leleasley/LeLibrary', GITHUB_SERVER_URL: 'https://github.com' };
  await run({ ...env, NOTIFY_MODE: 'push', GITHUB_EVENT_PATH: eventFile(pushEvent()) }, { fetchImpl, log: (l) => logs.push(l) });
  await run({ ...env, NOTIFY_MODE: 'release', GITHUB_EVENT_PATH: eventFile({ action: 'published', release: release() }) }, { fetchImpl, log: (l) => logs.push(l) });
  await run({ ...env, NOTIFY_MODE: 'test', GITHUB_EVENT_PATH: eventFile({}), GITHUB_ACTOR: 'leleasley' }, { fetchImpl, log: (l) => logs.push(l) });
  assert.deepEqual(sent.map((entry) => entry.body.embeds[0].title), ['[LeLibrary:v5.5] 2 new commits', 'LeLibrary v5.5.0', 'Test notification']);
  assert.ok(sent.every((entry) => entry.url.endsWith('?wait=true')));
  assert.ok(sent.every((entry) => !JSON.stringify(entry.body).includes('fake-token')));
  assert.ok(logs.every((line) => !line.includes('fake-token')));
});

test('run: deleted branches and tag pushes are not announced', async () => {
  const env = { DISCORD_WEBHOOK_URL: FAKE_HOOK, GITHUB_REPOSITORY: 'leleasley/LeLibrary', NOTIFY_MODE: 'push' };
  const fetchImpl = async () => { throw new Error('should not send'); };
  assert.deepEqual(await run({ ...env, GITHUB_EVENT_PATH: eventFile(pushEvent({ deleted: true, commits: [] })) }, { fetchImpl, log: () => {} }), { skipped: true });
  assert.deepEqual(await run({ ...env, GITHUB_EVENT_PATH: eventFile(pushEvent({ ref: 'refs/tags/v5.5.0' })) }, { fetchImpl, log: () => {} }), { skipped: true });
});
