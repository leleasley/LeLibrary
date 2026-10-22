# Discord notifications

`.github/workflows/discord-notifications.yml` posts to the project's Discord
channel through the `DISCORD_WEBHOOK_URL` repository secret. `notify.mjs` builds
and sends the messages; it uses only Node's built-ins.

## What sends a message

| Event | When | Message |
|---|---|---|
| Release | A release is published, either by the tag workflow or by hand in the GitHub UI | Release name and tag, release or pre-release, publish date, the release notes, the `docker pull` line, asset downloads plus source zip/tar.gz, and a link to the release |
| Push | Any branch push except `dependabot/**`, from a person (bot pushes are skipped) | One message per push: repository, branch, who pushed, how many commits, up to 10 commit subjects each linked by full SHA, and a compare link (or the commit history for a new branch) |
| Manual | Actions > Discord notifications > Run workflow | A grey "Test notification" message, or a release announcement if you give it a tag |

Details:

- Releases made by `release.yml` use `GITHUB_TOKEN`, and GitHub never turns those
  into a `release` event. So `release.yml` calls this workflow as its last job,
  and every release is announced once whichever way it was published.
- Tag pushes are not announced as pushes. The release covers them.
- Commits that already reached another branch (for example when `main`
  fast-forwards to work pushed on `v5.5`) are not listed a second time.
- Long release notes are cut at a paragraph and end with a link to the full
  release. Every message stays inside Discord's embed limits.
- Mentions are switched off, so text in a commit or release cannot ping anyone.
- There is no pull request trigger, so code from a fork never sees the webhook.

## Running the manual test

1. Open **Actions > Discord notifications > Run workflow**.
2. Leave **release_tag** empty and press **Run workflow**.
3. The run goes green only once Discord has confirmed the message (the log shows
   `Discord accepted the test notification (HTTP 200, message <id>)`). A
   missing or wrong secret, or any delivery failure, turns the run red.

To resend an announcement for a release that was missed, run it again with that
tag in **release_tag** (for example `v5.5.0`). Draft releases are refused.

## When a message does not arrive

The webhook URL is never printed. Errors show only the HTTP status and
Discord's own error code.

- **"secret is empty or not available"**: the secret is missing or misnamed.
  Automatic runs skip with a warning; the manual test fails.
- **"not a Discord webhook URL"**: the secret must be a
  `https://discord.com/api/webhooks/...` address.
- **HTTP 401 or 404 (code 10015, Unknown Webhook)**: the webhook was deleted or
  regenerated in Discord. Create a new one and replace the secret.
- **HTTP 429**: Discord rate limited the webhook. The script waits and retries
  up to four times, then fails the run.
- **HTTP 5xx, timeouts or network errors**: retried with back-off, then the run
  fails. Re-run the job, or resend a release with the manual test.
- **No run at all for a push**: the branch is `dependabot/**`, the push came
  from a bot, the branch was deleted, or the commit message has `[skip ci]`.

Local checks (no network, no secret):

```
node --test .github/discord/notify.test.mjs
DISCORD_DRY_RUN=1 NOTIFY_MODE=push GITHUB_REPOSITORY=leleasley/LeLibrary \
  GITHUB_EVENT_PATH=path/to/push-event.json node .github/discord/notify.mjs
```
