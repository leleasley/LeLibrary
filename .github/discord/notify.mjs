#!/usr/bin/env node
// Discord notifications for releases, pushes and a manual test, used by
// .github/workflows/discord-notifications.yml.
//
//   NOTIFY_MODE=release|push|test node .github/discord/notify.mjs
//
// Inputs (all from the workflow, never from the repository):
//   DISCORD_WEBHOOK_URL  the repository secret; never printed, never sent on
//   GITHUB_EVENT_PATH    the event payload GitHub wrote for this run
//   RELEASE_TAG          release mode only: announce this tag's release (fetched
//                        through the API) instead of the payload's release
//   GITHUB_TOKEN         read-only token for the release lookup and push totals
//   DISCORD_DRY_RUN=1    print the message JSON instead of sending it
//
// Only the built-in modules and fetch are used, so the runner needs nothing
// installed. Mentions are switched off on every message, so a commit message
// or release note can never ping @everyone or a role.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = 'LeLibrary';
const COLORS = { release: 0x2ecc71, prerelease: 0xf5a623, push: 0x5865f2, test: 0x95a5a6 };
const MAX_COMMITS_SHOWN = 10;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 4;
const MAX_WAIT_MS = 30_000;

// Discord's documented limits.
export const LIMITS = { title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, footer: 2048, author: 256, total: 6000 };
// Release notes stay well under the description cap, so the whole embed fits
// under the 6000-character total with its fields.
const NOTES_BUDGET = 3200;

export function truncate(text, max, suffix = '...') {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - suffix.length)).trimEnd() + suffix;
}

// Commit messages and branch names are plain text: escape Discord markdown so a
// message cannot break the list, fake a link or hide text.
export function escapeMarkdown(text) {
  return String(text ?? '').replace(/([\\*_~`|[\]<])/g, '\\$1');
}

// Release notes are markdown already. Embed descriptions do not render "#"
// headings, so they become bold lines; everything else passes through.
export function notesForDiscord(body) {
  return String(body ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, '**$1**')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Cut long notes at a paragraph or line boundary, close an open code fence and
// point at the full release.
export function truncateNotes(text, budget, moreUrl) {
  if (text.length <= budget) return text;
  const more = `\n\n**[Read the full release notes on GitHub](${moreUrl})**`;
  const room = budget - more.length - 8;
  let cut = text.slice(0, room);
  const paragraph = cut.lastIndexOf('\n\n');
  const line = cut.lastIndexOf('\n');
  if (paragraph > room * 0.6) cut = cut.slice(0, paragraph);
  else if (line > room * 0.6) cut = cut.slice(0, line);
  cut = cut.trimEnd();
  // A group heading left with nothing under it reads like a mistake.
  while (/\n\*\*[^\n]+\*\*$/.test(cut)) cut = cut.replace(/\n\*\*[^\n]+\*\*$/, '').trimEnd();
  if ((cut.match(/```/g) || []).length % 2 === 1) cut += '\n```';
  return `${cut}\n...${more}`;
}

const discordTime = (iso, style = 'F') => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:${style}>` : 'unknown';
};

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

export function embedLength(embed) {
  let total = (embed.title || '').length + (embed.description || '').length;
  total += (embed.footer?.text || '').length + (embed.author?.name || '').length;
  for (const field of embed.fields || []) total += field.name.length + field.value.length;
  return total;
}

// Clamp every part to Discord's limits, then shrink the description until the
// embed fits the total. Last line of defence: builders already stay inside.
export function clampEmbed(embed) {
  const out = { ...embed };
  if (out.title) out.title = truncate(out.title, LIMITS.title);
  if (out.description) out.description = truncate(out.description, LIMITS.description);
  if (out.author?.name) out.author = { ...out.author, name: truncate(out.author.name, LIMITS.author) };
  if (out.footer?.text) out.footer = { ...out.footer, text: truncate(out.footer.text, LIMITS.footer) };
  if (out.fields) {
    out.fields = out.fields.slice(0, LIMITS.fields).map((field) => ({
      ...field,
      name: truncate(field.name || '​', LIMITS.fieldName),
      value: truncate(field.value || '​', LIMITS.fieldValue),
    }));
  }
  const over = embedLength(out) - LIMITS.total;
  if (over > 0 && out.description) out.description = truncate(out.description, Math.max(0, out.description.length - over));
  return out;
}

function message(embed) {
  return { embeds: [clampEmbed(embed)], allowed_mentions: { parse: [] } };
}

// ---------------------------------------------------------------- release ---

export function buildReleaseMessage(release, { server, repository }) {
  const repoUrl = `${server}/${repository}`;
  const tag = release.tag_name;
  const url = release.html_url || `${repoUrl}/releases/tag/${encodeURIComponent(tag)}`;
  const name = release.name && release.name.trim() ? release.name.trim() : `${PROJECT} ${tag}`;
  const notes = notesForDiscord(release.body);
  const description = notes ? truncateNotes(notes, NOTES_BUDGET, url) : `No release notes were written. [Open the release](${url}).`;

  const downloads = (release.assets || [])
    .filter((asset) => asset && asset.browser_download_url)
    .map((asset) => {
      const size = formatSize(asset.size);
      return `[${escapeMarkdown(asset.name)}](${asset.browser_download_url})${size ? ` (${size})` : ''}`;
    });
  const shown = [];
  let used = 0;
  for (const line of downloads) {
    if (used + line.length + 1 > 800) break;
    shown.push(line);
    used += line.length + 1;
  }
  if (downloads.length > shown.length) shown.push(`...and ${downloads.length - shown.length} more on the [release page](${url})`);
  const source = `Source code: [zip](${repoUrl}/archive/refs/tags/${encodeURIComponent(tag)}.zip) | [tar.gz](${repoUrl}/archive/refs/tags/${encodeURIComponent(tag)}.tar.gz)`;

  // The tag workflow ends its notes with the image pull line; keep it visible
  // even when the notes themselves are cut short.
  const pull = /^docker pull (\S+)$/m.exec(String(release.body || ''));

  const fields = [
    { name: 'Version', value: `\`${tag}\``, inline: true },
    { name: 'Type', value: release.prerelease ? 'Pre-release' : 'Release', inline: true },
    { name: 'Published', value: discordTime(release.published_at || release.created_at), inline: true },
    ...(pull ? [{ name: 'Docker image', value: `\`\`\`\ndocker pull ${pull[1]}\n\`\`\``, inline: false }] : []),
    { name: 'Downloads', value: [...shown, source].join('\n'), inline: false },
  ];

  return message({
    author: { name: `${PROJECT} release`, url: repoUrl },
    title: release.prerelease ? `${name} (pre-release)` : name,
    url,
    description,
    color: release.prerelease ? COLORS.prerelease : COLORS.release,
    fields,
    footer: { text: repository },
    timestamp: release.published_at || release.created_at || new Date().toISOString(),
  });
}

// ------------------------------------------------------------------- push ---

const ZERO_SHA = /^0+$/;

export function buildPushMessage(event, { server, repository, total }) {
  const repoUrl = `${server}/${repository}`;
  const branch = String(event.ref || '').replace(/^refs\/heads\//, '');
  const branchUrl = `${repoUrl}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`;
  const commitUrl = (sha) => `${repoUrl}/commit/${sha}`;
  const all = Array.isArray(event.commits) ? event.commits : [];
  // Commits that already reached another branch were announced with that push.
  const fresh = all.filter((commit) => commit.distinct !== false);
  const count = Math.max(Number(total) || 0, fresh.length);
  const author = event.sender?.login || event.pusher?.name || 'unknown';
  const created = event.created === true || ZERO_SHA.test(event.before || '');
  const compareUrl = !created && event.before && event.after
    ? `${repoUrl}/compare/${event.before}...${event.after}`
    : `${repoUrl}/commits/${event.after || branch}`;

  const lines = fresh.slice(0, MAX_COMMITS_SHOWN).map((commit) => {
    const subject = truncate(String(commit.message || '').split('\n')[0].trim() || '(no message)', 90);
    const who = commit.author?.username || commit.author?.name || '';
    return `[\`${commit.id.slice(0, 7)}\`](${commitUrl(commit.id)}) ${escapeMarkdown(subject)}${who ? ` - ${escapeMarkdown(who)}` : ''}`;
  });
  const hidden = count - lines.length;
  if (hidden > 0) lines.push(`...and ${hidden} more commit${hidden === 1 ? '' : 's'}. [See them all](${compareUrl})`);
  if (!fresh.length && event.after) {
    lines.push(`Moved to [\`${event.after.slice(0, 7)}\`](${commitUrl(event.after)}), using commits already pushed to another branch.`);
  }

  const noun = count === 1 ? 'commit' : 'commits';
  const title = fresh.length
    ? `[${PROJECT}:${branch}] ${count} new ${noun}`
    : `[${PROJECT}:${branch}] branch updated`;

  return message({
    author: { name: author, url: event.sender?.html_url, icon_url: event.sender?.avatar_url },
    title,
    url: fresh.length === 1 ? commitUrl(fresh[0].id) : compareUrl,
    description: lines.join('\n'),
    color: COLORS.push,
    fields: [
      { name: 'Repository', value: `[${repository}](${repoUrl})`, inline: true },
      { name: 'Branch', value: `[${escapeMarkdown(branch)}](${branchUrl})${created ? ' (new)' : ''}`, inline: true },
      { name: 'Commits', value: String(count), inline: true },
      { name: event.forced ? 'Changes (force push)' : 'Changes', value: `[${created ? 'Commit history' : 'Compare'}](${compareUrl})`, inline: false },
    ],
    footer: { text: `Pushed by ${author}` },
    timestamp: event.head_commit?.timestamp || new Date().toISOString(),
  });
}

// ------------------------------------------------------------------- test ---

export function buildTestMessage({ server, repository, actor, runId }) {
  const repoUrl = `${server}/${repository}`;
  const runUrl = runId ? `${repoUrl}/actions/runs/${runId}` : `${repoUrl}/actions`;
  return message({
    author: { name: `${PROJECT} notifications`, url: repoUrl },
    title: 'Test notification',
    url: runUrl,
    description: 'This is a test from the Discord notifications workflow. If you can read this, release and push announcements will arrive in this channel.',
    color: COLORS.test,
    fields: [
      { name: 'Repository', value: `[${repository}](${repoUrl})`, inline: true },
      { name: 'Started by', value: escapeMarkdown(actor || 'unknown'), inline: true },
      { name: 'Workflow run', value: `[Open the run](${runUrl})`, inline: false },
    ],
    footer: { text: 'Manual test, safe to ignore' },
    timestamp: new Date().toISOString(),
  });
}

// --------------------------------------------------------------- delivery ---

export class NotifyError extends Error {}

// Accept only real Discord webhook endpoints, so a mistyped secret fails with
// a clear message instead of posting somewhere else.
export function checkWebhookUrl(raw) {
  if (!raw || !raw.trim()) return { ok: false, reason: 'missing' };
  let url;
  try { url = new URL(raw.trim()); } catch { return { ok: false, reason: 'invalid' }; }
  const host = url.hostname.toLowerCase();
  const discordHost = ['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com'].includes(host);
  if (url.protocol !== 'https:' || !discordHost || !/^\/api\/(v\d+\/)?webhooks\/\d+\/[\w-]+\/?$/.test(url.pathname)) {
    return { ok: false, reason: 'invalid' };
  }
  url.searchParams.set('wait', 'true');
  return { ok: true, url };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function retryAfterMs(response, body) {
  const fromBody = Number(body?.retry_after);
  if (Number.isFinite(fromBody) && fromBody >= 0) return fromBody * 1000;
  const fromHeader = Number(response.headers.get('retry-after'));
  return Number.isFinite(fromHeader) && fromHeader >= 0 ? fromHeader * 1000 : 2000;
}

// Error text never includes the URL: only the status and Discord's own
// error code/message, which do not contain it.
export async function deliver(webhookUrl, payload, { fetchImpl = fetch, log = console.log, wait = sleep } = {}) {
  let lastProblem = 'no attempt made';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'LeLibrary-Discord-Notify (github.com/leleasley/LeLibrary)' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      lastProblem = error?.name === 'TimeoutError' ? `no answer within ${REQUEST_TIMEOUT_MS / 1000}s` : 'network error reaching Discord';
      log(`Attempt ${attempt}: ${lastProblem}.`);
      if (attempt < MAX_ATTEMPTS) await wait(1000 * 2 ** (attempt - 1));
      continue;
    }

    const text = await response.text().catch(() => '');
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }

    if (response.ok) {
      if (!body || !body.id) throw new NotifyError(`Discord answered ${response.status} without a message id, so delivery cannot be confirmed.`);
      return { status: response.status, id: body.id };
    }

    const detail = body && (body.code || body.message) ? ` (Discord code ${body.code ?? '-'}: ${truncate(body.message ?? '', 200)})` : '';
    lastProblem = `Discord answered HTTP ${response.status}${detail}`;
    if (response.status === 429) {
      const delay = retryAfterMs(response, body);
      if (delay > MAX_WAIT_MS || attempt === MAX_ATTEMPTS) break;
      log(`Attempt ${attempt}: rate limited, retrying in ${Math.ceil(delay / 1000)}s.`);
      await wait(delay + 250);
      continue;
    }
    if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
      log(`Attempt ${attempt}: ${lastProblem}, retrying.`);
      await wait(1000 * 2 ** (attempt - 1));
      continue;
    }
    if (response.status === 401 || response.status === 404) {
      lastProblem += '. The webhook was probably deleted or regenerated: update the DISCORD_WEBHOOK_URL repository secret';
    }
    break;
  }
  throw new NotifyError(`Discord notification failed: ${lastProblem}.`);
}

// ----------------------------------------------------------------- GitHub ---

async function github(path, env) {
  const api = env.GITHUB_API_URL || 'https://api.github.com';
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'LeLibrary-Discord-Notify' };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const response = await fetch(`${api}${path}`, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new NotifyError(`GitHub API ${path} answered HTTP ${response.status}.`);
  return response.json();
}

// The webhook payload lists at most 20 commits; ask GitHub for the real total.
async function pushTotal(event, env) {
  const listed = (event.commits || []).filter((commit) => commit.distinct !== false).length;
  if (listed < 20 || !event.before || ZERO_SHA.test(event.before) || !event.after) return listed;
  try {
    const compare = await github(`/repos/${env.GITHUB_REPOSITORY}/compare/${event.before}...${event.after}`, env);
    return Number(compare.total_commits) || listed;
  } catch {
    return listed;
  }
}

async function loadRelease(event, env) {
  const tag = (env.RELEASE_TAG || '').trim();
  if (!tag) {
    if (!event.release) throw new NotifyError('This run has no release in its event and no RELEASE_TAG.');
    return event.release;
  }
  const release = await github(`/repos/${env.GITHUB_REPOSITORY}/releases/tags/${encodeURIComponent(tag)}`, env);
  if (release.draft) throw new NotifyError(`The release for ${tag} is still a draft, so it is not announced.`);
  return release;
}

// ------------------------------------------------------------------- main ---

export async function run(env = process.env, { fetchImpl, log = console.log } = {}) {
  const mode = (env.NOTIFY_MODE || '').trim();
  if (!['release', 'push', 'test'].includes(mode)) throw new NotifyError(`Unknown NOTIFY_MODE "${mode}".`);
  const dryRun = env.DISCORD_DRY_RUN === '1';

  const webhook = checkWebhookUrl(env.DISCORD_WEBHOOK_URL);
  if (!webhook.ok && !dryRun) {
    const why = webhook.reason === 'missing'
      ? 'The DISCORD_WEBHOOK_URL repository secret is empty or not available to this run'
      : 'The DISCORD_WEBHOOK_URL repository secret is not a Discord webhook URL (expected https://discord.com/api/webhooks/<id>/<token>)';
    // Automatic runs skip quietly (forks and copies of the repo have no
    // secret); the manual test must say clearly that nothing was sent.
    if (mode === 'test' || webhook.reason === 'invalid') throw new NotifyError(`${why}. Nothing was sent.`);
    log(`::warning::${why}. Skipping the Discord notification.`);
    return { skipped: true };
  }

  const event = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const context = { server: env.GITHUB_SERVER_URL || 'https://github.com', repository: env.GITHUB_REPOSITORY || event.repository?.full_name };
  if (!context.repository) throw new NotifyError('GITHUB_REPOSITORY is not set.');

  let payload;
  if (mode === 'release') {
    payload = buildReleaseMessage(await loadRelease(event, env), context);
  } else if (mode === 'push') {
    if (event.deleted) { log('Branch deleted, nothing to announce.'); return { skipped: true }; }
    if (!String(event.ref || '').startsWith('refs/heads/')) { log('Not a branch push, nothing to announce.'); return { skipped: true }; }
    payload = buildPushMessage(event, { ...context, total: await pushTotal(event, env) });
  } else {
    payload = buildTestMessage({ ...context, actor: env.GITHUB_ACTOR, runId: env.GITHUB_RUN_ID });
  }

  if (dryRun) {
    log(JSON.stringify(payload, null, 2));
    return { dryRun: true, payload };
  }
  const result = await deliver(webhook.url, payload, { fetchImpl, log });
  log(`Discord accepted the ${mode} notification (HTTP ${result.status}, message ${result.id}).`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    // Our own errors are written to never contain the URL; anything else is
    // reduced to its type so an unexpected message cannot leak it either.
    const text = error instanceof NotifyError ? error.message : `Unexpected ${error?.name || 'error'} while sending the notification.`;
    console.log(`::error::${text}`);
    process.exitCode = 1;
  });
}
