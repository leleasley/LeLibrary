'use strict';
// Shared fixes: owners teaching LeLibrary about exact releases.
//
// When someone fixes a file on the Library page, the fix is also recorded as
// a vote for that exact release: its info hash, and its exact (lower-cased)
// name. Other libraries holding the same release can then use it:
//   - with 1 vote, only where automatic matching FAILED (never replacing a
//     confident automatic match on one person's word);
//   - with 2+ agreeing libraries, before the automatic matcher.
// When votes disagree, the top answer must strictly outnumber the next.
// A library's own fix always wins in that library. Ignores are personal and
// never shared. Voters are stored as a one-way hash of the library id.

const crypto = require('crypto');
const db = require('./db.ts');
const store = require('./store.ts');

export interface SharedFix {
  tmdbId: number;
  mediaType: 'movie' | 'series' | 'anime';
  season: number | null;
  episode: number | null;
  votes: number;
}

export interface ReleaseKeys {
  hash: string | null;
  name: string | null;
}

const HASH_RE = /^[a-f0-9]{40}$|^[a-f0-9]{32}$/;

function releaseKeys(raw: unknown, name: unknown): ReleaseKeys {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const hashValue = String(record['hash'] || record['infohash'] || record['info_hash'] || '').trim().toLowerCase();
  const plainName = String(name || record['name'] || record['filename'] || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return {
    hash: HASH_RE.test(hashValue) ? hashValue : null,
    // A bare-hash name says nothing beyond the hash itself; very short names
    // are too generic to identify one release.
    name: plainName.length >= 6 && !HASH_RE.test(plainName) ? plainName.slice(0, 400) : null,
  };
}

function voterFor(scopeId: string): string {
  return crypto.createHash('sha256').update(`lelibrary-shared-fix:${scopeId}`).digest('hex').slice(0, 24);
}

function keyPairs(keys: ReleaseKeys): [string, string][] {
  const out: [string, string][] = [];
  if (keys.hash) out.push(['hash', keys.hash]);
  if (keys.name) out.push(['name', keys.name]);
  return out;
}

async function vote(scopeId: string, keys: ReleaseKeys, fix: Omit<SharedFix, 'votes'>): Promise<void> {
  const pairs = keyPairs(keys);
  if (!pairs.length) return;
  const pool = await store.ensure();
  const voter = voterFor(scopeId);
  for (const [kind, key] of pairs) {
    await pool.query(
      `INSERT INTO lib_shared_fixes (key_kind, key, voter, tmdb_id, media_type, season, episode)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (key_kind, key, voter) DO UPDATE SET
         tmdb_id = EXCLUDED.tmdb_id, media_type = EXCLUDED.media_type,
         season = EXCLUDED.season, episode = EXCLUDED.episode, created_at = now()`,
      [kind, key, voter, fix.tmdbId, fix.mediaType, fix.season, fix.episode]
    );
  }
}

async function unvote(scopeId: string, keys: ReleaseKeys): Promise<void> {
  const pairs = keyPairs(keys);
  if (!pairs.length) return;
  const pool = await store.ensure();
  const voter = voterFor(scopeId);
  for (const [kind, key] of pairs) {
    await pool.query('DELETE FROM lib_shared_fixes WHERE key_kind = $1 AND key = $2 AND voter = $3', [kind, key, voter]);
  }
}

// Votes for one release key: the top answer must strictly outnumber the next.
function chooseConsensus(list: SharedFix[]): SharedFix | null {
  const sorted = [...list].sort((a, b) => b.votes - a.votes);
  const [top, next] = sorted;
  if (!top) return null;
  if (next && next.votes >= top.votes) return null;
  return top;
}

// Consensus for a batch of releases: one query. The hash is the stronger key,
// so it is used whenever it has votes; the exact name is the fallback.
async function bestFor(keysList: ReleaseKeys[]): Promise<(SharedFix | null)[]> {
  const pool = db.getPool();
  const pairs = keysList.flatMap((keys) => keyPairs(keys));
  if (!pool || !pairs.length) return keysList.map(() => null);
  const { rows } = await pool.query(
    `SELECT key_kind, key, tmdb_id, media_type, season, episode, count(DISTINCT voter)::int AS votes
       FROM lib_shared_fixes
      WHERE (key_kind, key) IN (SELECT * FROM unnest($1::text[], $2::text[]))
      GROUP BY key_kind, key, tmdb_id, media_type, season, episode`,
    [pairs.map((p) => p[0]), pairs.map((p) => p[1])]
  );
  const byKey = new Map<string, SharedFix[]>();
  for (const row of rows) {
    const id = `${row.key_kind}\u0000${row.key}`;
    const list = byKey.get(id) || [];
    list.push({ tmdbId: row.tmdb_id, mediaType: row.media_type, season: row.season, episode: row.episode, votes: row.votes });
    byKey.set(id, list);
  }
  const decide = (kind: string, key: string | null): SharedFix | null =>
    (key ? chooseConsensus(byKey.get(`${kind}\u0000${key}`) || []) : null);
  return keysList.map((keys) => decide('hash', keys.hash) || decide('name', keys.name));
}

// After a new vote, give libraries where the same release FAILED another
// try: the matcher picks them up on its next pass and uses the shared fix.
async function requeueFailedElsewhere(scopeId: string, keys: ReleaseKeys): Promise<number> {
  if (!keys.hash && !keys.name) return 0;
  const pool = await store.ensure();
  const { rowCount } = await pool.query(
    `UPDATE lib_items SET match_version = NULL, match_next_retry_at = NULL
      WHERE scope_id <> $1 AND removed_at IS NULL
        AND (match_status = 'failed' OR (match_status = 'skipped' AND match_error IS NOT NULL))
        AND (($2::text IS NOT NULL AND lower(raw->>'hash') = $2) OR ($3::text IS NOT NULL AND lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = $3))`,
    [scopeId, keys.hash, keys.name]
  );
  return rowCount || 0;
}

// How many agreeing libraries a shared fix needs before it is used for
// another library. One person's fix never spreads on its own.
const MIN_VOTES_ON_FAILURE = 2;
const MIN_VOTES_BEFORE_RESOLVER = 3;

function sharedFixUsable(fix: { votes: number } | null | undefined, phase: 'on-failure' | 'before-resolver'): boolean {
  if (!fix || !Number.isFinite(fix.votes)) return false;
  return fix.votes >= (phase === 'before-resolver' ? MIN_VOTES_BEFORE_RESOLVER : MIN_VOTES_ON_FAILURE);
}

export interface SharedFixesApi {
  sharedFixUsable: typeof sharedFixUsable;
  releaseKeys: typeof releaseKeys;
  chooseConsensus: typeof chooseConsensus;
  voterFor: typeof voterFor;
  vote: typeof vote;
  unvote: typeof unvote;
  bestFor: typeof bestFor;
  requeueFailedElsewhere: typeof requeueFailedElsewhere;
}

module.exports = { sharedFixUsable, releaseKeys, chooseConsensus, voterFor, vote, unvote, bestFor, requeueFailedElsewhere } satisfies SharedFixesApi;
