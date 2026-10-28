// LeLibrary's own ids for the Nuvio settings the manager shows, mapped to the
// key, group and `{type,value}` encoding each Nuvio app uses.
//
// Verified against Docs/research/nuvio-tv-sync-settings.md (TV, blob platform
// 'tv') and nuvio-mobile-sync-settings.md (phone/tablet, platform 'mobile').
// The two apps rename some keys (subtitle languages), and a wrong `type` tag
// makes an app drop the key, which resets it to the default after the app
// clears the group. So every key carries its exact type here, once.
//
// Rules this module enforces (pure functions, no I/O):
// - only keys inside a group that already exists in an existing blob are
//   written; a missing blob or group is never created (the TV would clear the
//   group to just our keys, the phone resets every group missing from a blob);
// - every other key, group and the blob's `version` stay exactly as pulled;
// - `string_set` values are written sorted, as both apps export them.

export type SettingId =
  | 'autoPlayMode'
  | 'autoPlayRegex'
  | 'autoPlaySource'
  | 'autoPlayTimeout'
  | 'nextEpisode'
  | 'preloadNextEpisode'
  | 'nextEpisodeThresholdMode'
  | 'nextEpisodeThresholdPercent'
  | 'nextEpisodeThresholdMinutes'
  | 'stillWatching'
  | 'stillWatchingEpisodes'
  | 'skipSegments'
  | 'audioLanguage'
  | 'audioLanguage2'
  | 'subtitleLanguage'
  | 'subtitleLanguage2'
  | 'forcedSubtitles'
  | 'hideUnreleased';

export type SettingsPlatform = 'tv' | 'mobile';
export type ValueType = 'string' | 'boolean' | 'int' | 'float' | 'string_set';
export type SettingValues = Partial<Record<SettingId, unknown>>;

interface KeyRef { group: string; key: string; type: ValueType }

interface SettingDef {
  tv: KeyRef | null;
  mobile: KeyRef | null;
  // null when the value is not acceptable for this setting.
  validate: (value: unknown) => { value: unknown } | null;
  // Stored value -> LeLibrary value (after the type tag was checked).
  decode?: (raw: unknown) => unknown;
  // LeLibrary value -> stored value. undefined removes the key.
  encode?: (value: unknown, previous: unknown) => unknown;
}

const PLAYER = 'player_settings';
const LAYOUT = 'layout_settings';
const UNLIMITED_TIMEOUT = 2147483647;
const TIMEOUT_STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, -1];
const SKIP_SEGMENTS = ['intro', 'recap', 'outro'];
const MAX_REGEX_LENGTH = 300;
// ISO 639 code with an optional region ("pt-br", "zh-CN", "es-419"), or one of
// the apps' own special values. '' removes the key: each app then uses its
// own default (TV: device language, mobile: none for subtitles).
const LANGUAGE_RE = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,4})?$/;
const LANGUAGE_SPECIAL = ['none', 'device', 'default', 'original', 'forced'];

function both(group: string, key: string, type: ValueType): { tv: KeyRef; mobile: KeyRef } {
  return { tv: { group, key, type }, mobile: { group, key, type } };
}

function oneOf(values: readonly string[]) {
  return (value: unknown) => (typeof value === 'string' && values.includes(value) ? { value } : null);
}

function bool(value: unknown) {
  return typeof value === 'boolean' ? { value } : null;
}

function stepRange(min: number, max: number, step: number) {
  return (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return null;
    const steps = (value - min) / step;
    return Math.abs(steps - Math.round(steps)) < 1e-9 ? { value } : null;
  };
}

function language(value: unknown) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return { value: '' };
  if (LANGUAGE_SPECIAL.includes(text.toLowerCase())) return { value: text.toLowerCase() };
  return LANGUAGE_RE.test(text) ? { value: text } : null;
}

const removeWhenEmpty = (value: unknown): unknown => (value === '' ? undefined : value);

const SETTINGS: Record<SettingId, SettingDef> = {
  autoPlayMode: { ...both(PLAYER, 'stream_auto_play_mode', 'string'), validate: oneOf(['MANUAL', 'FIRST_STREAM', 'REGEX_MATCH']) },
  autoPlayRegex: {
    ...both(PLAYER, 'stream_auto_play_regex', 'string'),
    // Not compiled: Nuvio uses Java patterns, which JavaScript may reject.
    validate: (value) => (typeof value === 'string' && value.trim().length <= MAX_REGEX_LENGTH ? { value: value.trim() } : null),
  },
  autoPlaySource: { ...both(PLAYER, 'stream_auto_play_source', 'string'), validate: oneOf(['ALL_SOURCES', 'INSTALLED_ADDONS_ONLY']) },
  autoPlayTimeout: {
    ...both(PLAYER, 'stream_auto_play_timeout_seconds', 'int'),
    validate: (value) => (typeof value === 'number' && TIMEOUT_STEPS.includes(value) ? { value } : null),
    // 2147483647 is "Unlimited"; the legacy 11 also means Unlimited.
    decode: (raw) => (raw === UNLIMITED_TIMEOUT || raw === 11 ? -1 : raw),
    encode: (value) => (value === -1 ? UNLIMITED_TIMEOUT : value),
  },
  nextEpisode: { ...both(PLAYER, 'stream_auto_play_next_episode_enabled', 'boolean'), validate: bool },
  preloadNextEpisode: { ...both(PLAYER, 'preload_next_episode_sources', 'boolean'), validate: bool },
  nextEpisodeThresholdMode: { ...both(PLAYER, 'next_episode_threshold_mode', 'string'), validate: oneOf(['PERCENTAGE', 'MINUTES_BEFORE_END']) },
  nextEpisodeThresholdPercent: { ...both(PLAYER, 'next_episode_threshold_percent_v2', 'float'), validate: stepRange(97, 100, 0.5) },
  nextEpisodeThresholdMinutes: { ...both(PLAYER, 'next_episode_threshold_minutes_before_end_v2', 'float'), validate: stepRange(0, 3.5, 0.5) },
  // TV only: the phone app has no "Are you still watching?".
  stillWatching: { tv: { group: PLAYER, key: 'still_watching_enabled', type: 'boolean' }, mobile: null, validate: bool },
  stillWatchingEpisodes: {
    tv: { group: PLAYER, key: 'still_watching_episode_threshold', type: 'int' },
    mobile: null,
    validate: (value) => (Number.isInteger(value) && (value as number) >= 2 && (value as number) <= 6 ? { value } : null),
  },
  skipSegments: {
    ...both(PLAYER, 'auto_skip_segment_types', 'string_set'),
    validate: (value) => {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !SKIP_SEGMENTS.includes(entry))) return null;
      return { value: Array.from(new Set(value as string[])).sort() };
    },
    // Only the three segments the manager shows; others (movie-credits) stay.
    decode: (raw) => (raw as string[]).filter((entry) => SKIP_SEGMENTS.includes(entry)).sort(),
    encode: (value, previous) => {
      const kept = Array.isArray(previous) ? (previous as unknown[]).filter((entry): entry is string => typeof entry === 'string' && !SKIP_SEGMENTS.includes(entry)) : [];
      return Array.from(new Set([...(value as string[]), ...kept])).sort();
    },
  },
  audioLanguage: { ...both(PLAYER, 'preferred_audio_language', 'string'), validate: language, encode: removeWhenEmpty },
  audioLanguage2: { ...both(PLAYER, 'secondary_preferred_audio_language', 'string'), validate: language, encode: removeWhenEmpty },
  // Renamed between the apps.
  subtitleLanguage: {
    tv: { group: PLAYER, key: 'subtitle_preferred_language', type: 'string' },
    mobile: { group: PLAYER, key: 'preferred_subtitle_language', type: 'string' },
    validate: language,
    encode: removeWhenEmpty,
  },
  subtitleLanguage2: {
    tv: { group: PLAYER, key: 'subtitle_secondary_language', type: 'string' },
    mobile: { group: PLAYER, key: 'secondary_preferred_subtitle_language', type: 'string' },
    validate: language,
    encode: removeWhenEmpty,
  },
  forcedSubtitles: { ...both(PLAYER, 'subtitle_use_forced_subtitles', 'boolean'), validate: bool },
  // TV keeps a copy in its layout group; the phone reads only the Home
  // settings, which the service writes as well.
  hideUnreleased: { tv: { group: LAYOUT, key: 'hide_unreleased_content', type: 'boolean' }, mobile: null, validate: bool },
};

const SETTING_IDS = Object.keys(SETTINGS) as SettingId[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function keyRef(id: SettingId, platform: SettingsPlatform): KeyRef | null {
  const def = SETTINGS[id];
  return platform === 'tv' ? def.tv : def.mobile;
}

// One typed entry, or undefined when the tag or value does not match (the
// apps skip such a key too).
function decodeEntry(entry: unknown, type: ValueType): unknown {
  if (!isRecord(entry) || entry['type'] !== type) return undefined;
  const value = entry['value'];
  switch (type) {
    case 'string': return typeof value === 'string' ? value : undefined;
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 'false') return value === 'true';
      return undefined;
    case 'int': return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
    case 'float': return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    case 'string_set': return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;
    default: return undefined;
  }
}

function encodeEntry(value: unknown, type: ValueType): { type: ValueType; value: unknown } {
  switch (type) {
    case 'int': return { type, value: Math.trunc(Number(value)) };
    case 'float': return { type, value: Number(value) };
    case 'boolean': return { type, value: value === true };
    case 'string_set': return { type, value: (value as string[]).slice().sort() };
    default: return { type, value: String(value) };
  }
}

function groupOf(blob: unknown, group: string): Record<string, unknown> | null {
  if (!isRecord(blob) || !isRecord(blob['features'])) return null;
  const found = (blob['features'] as Record<string, unknown>)[group];
  return isRecord(found) ? found : null;
}

// The values one platform's blob holds for the mapped settings.
function readBlob(blob: unknown, platform: SettingsPlatform): SettingValues {
  const out: SettingValues = {};
  for (const id of SETTING_IDS) {
    const ref = keyRef(id, platform);
    if (!ref) continue;
    const group = groupOf(blob, ref.group);
    if (!group || !(ref.key in group)) continue;
    const raw = decodeEntry(group[ref.key], ref.type);
    if (raw === undefined) continue;
    const decode = SETTINGS[id].decode;
    out[id] = decode ? decode(raw) : raw;
  }
  return out;
}

// Only keys present on Nuvio. The TV blob wins where both have a value; the
// phone fills in what the TV blob does not hold.
function readSettings(tvBlob: unknown, mobileBlob: unknown): SettingValues {
  return { ...readBlob(mobileBlob, 'mobile'), ...readBlob(tvBlob, 'tv') };
}

// Validate a browser payload. Unknown ids and bad values are errors, never
// silently dropped: a half-applied save would be worse than a refusal.
function normaliseValues(input: unknown): { values: SettingValues; errors: string[] } {
  const values: SettingValues = {};
  const errors: string[] = [];
  if (!isRecord(input)) return { values, errors: ['values'] };
  for (const [id, value] of Object.entries(input)) {
    if (!Object.prototype.hasOwnProperty.call(SETTINGS, id)) { errors.push(id); continue; }
    const checked = SETTINGS[id as SettingId].validate(value);
    if (!checked) { errors.push(id); continue; }
    values[id as SettingId] = checked.value;
  }
  return { values, errors };
}

// A new blob with only the mapped keys changed, or blob: null when the blob is
// unusable. Keys whose group is missing are skipped (listed in `skipped`).
function applySettings(
  blob: unknown,
  platform: SettingsPlatform,
  values: SettingValues,
): { blob: Record<string, unknown> | null; changed: SettingId[]; skipped: SettingId[] } {
  if (!isRecord(blob) || !isRecord(blob['features'])) return { blob: null, changed: [], skipped: [] };
  const next = JSON.parse(JSON.stringify(blob)) as Record<string, unknown>;
  const features = next['features'] as Record<string, unknown>;
  const changed: SettingId[] = [];
  const skipped: SettingId[] = [];
  for (const id of Object.keys(values) as SettingId[]) {
    const ref = keyRef(id, platform);
    if (!ref) continue;
    const group = features[ref.group];
    if (!isRecord(group)) { skipped.push(id); continue; }
    const def = SETTINGS[id];
    const previousRaw = decodeEntry(group[ref.key], ref.type);
    const stored = def.encode ? def.encode(values[id], previousRaw) : values[id];
    const before = JSON.stringify(group[ref.key]);
    if (stored === undefined) {
      if (ref.key in group) delete group[ref.key];
    } else {
      group[ref.key] = encodeEntry(stored, ref.type);
    }
    if (JSON.stringify(group[ref.key]) !== before) changed.push(id);
  }
  return { blob: next, changed, skipped };
}

function mappedKey(id: SettingId, platform: SettingsPlatform): KeyRef | null {
  const ref = keyRef(id, platform);
  return ref ? { ...ref } : null;
}

export interface SettingsMapApi {
  SETTING_IDS: SettingId[];
  UNLIMITED_TIMEOUT: number;
  mappedKey: (id: SettingId, platform: SettingsPlatform) => KeyRef | null;
  readBlob: (blob: unknown, platform: SettingsPlatform) => SettingValues;
  readSettings: (tvBlob: unknown, mobileBlob: unknown) => SettingValues;
  normaliseValues: (input: unknown) => { values: SettingValues; errors: string[] };
  applySettings: (blob: unknown, platform: SettingsPlatform, values: SettingValues) =>
    { blob: Record<string, unknown> | null; changed: SettingId[]; skipped: SettingId[] };
}

module.exports = {
  SETTING_IDS,
  UNLIMITED_TIMEOUT,
  mappedKey,
  readBlob,
  readSettings,
  normaliseValues,
  applySettings,
} satisfies SettingsMapApi;
