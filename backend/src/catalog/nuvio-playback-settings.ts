// Nuvio playback controls that LeLibrary can set from the setup flow.
//
// Nuvio stores these in the per-profile settings blob under
// `features.player_settings` (key names and `{type,value}` wrappers verified
// against the TV and mobile clients). The client clears that whole bucket
// before applying a pulled blob, which is why this module refuses to create one:
// writing three keys into a missing bucket would reset every other player
// preference the user has.
const PLAYBACK_MODES = ['MANUAL', 'FIRST_STREAM', 'REGEX_MATCH'] as const;
type PlaybackMode = (typeof PLAYBACK_MODES)[number];

const MAX_REGEX_LENGTH = 300;
const MODE_KEY = 'stream_auto_play_mode';
const REGEX_KEY = 'stream_auto_play_regex';
const NEXT_EPISODE_KEY = 'stream_auto_play_next_episode_enabled';
// Auto-play scope. Nuvio filters candidates by the addon's display name, and
// the push installs LeLibrary under this name (push.ts installAddonOnNuvio).
const SOURCE_KEY = 'stream_auto_play_source';
const SELECTED_ADDONS_KEY = 'stream_auto_play_selected_addons';
const LELIBRARY_ADDON_NAME = 'LeLibrary';

export interface PlaybackSettings {
  mode: PlaybackMode;
  regex: string;
  nextEpisode: boolean;
  // Auto-play only LeLibrary's own streams.
  onlyLeLibrary: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Absent or unusable input means "leave Nuvio alone" (null). Never guess a mode:
// pushing MANUAL over a user's FIRST_STREAM would silently change their player.
function normalisePlaybackSettings(input: unknown): PlaybackSettings | null {
  if (!isRecord(input)) return null;
  const mode = typeof input.mode === 'string' ? input.mode.trim().toUpperCase() : '';
  if (!PLAYBACK_MODES.includes(mode as PlaybackMode)) return null;
  const regex = typeof input.regex === 'string' ? input.regex.trim() : '';
  if (regex.length > MAX_REGEX_LENGTH) return null;
  // Not compiled with JavaScript RegExp on purpose: Nuvio accepts Java patterns
  // (its own preset uses `(?is)`), which JS rejects.
  if (mode === 'REGEX_MATCH' && !regex) return null;
  return {
    mode: mode as PlaybackMode,
    regex,
    nextEpisode: input.nextEpisode === true,
    onlyLeLibrary: input.onlyLeLibrary === true,
  };
}

function isOurScope(player: Record<string, unknown>): boolean {
  const source = player[SOURCE_KEY] as { value?: unknown } | undefined;
  const selected = player[SELECTED_ADDONS_KEY] as { value?: unknown } | undefined;
  return Boolean(source && source.value === 'INSTALLED_ADDONS_ONLY' && selected && Array.isArray(selected.value)
    && selected.value.length === 1 && selected.value[0] === LELIBRARY_ADDON_NAME);
}

function applyPlaybackSettingsToBlob(
  blob: unknown,
  settings: PlaybackSettings | null,
): Record<string, unknown> | null {
  if (!settings || !isRecord(blob) || !isRecord(blob.features)) return null;
  const player = blob.features.player_settings;
  if (!isRecord(player)) return null;

  const next = JSON.parse(JSON.stringify(blob)) as Record<string, unknown>;
  const features = next.features as Record<string, unknown>;
  const target = { ...(features.player_settings as Record<string, unknown>) };
  target[MODE_KEY] = { type: 'string', value: settings.mode };
  target[REGEX_KEY] = { type: 'string', value: settings.regex };
  target[NEXT_EPISODE_KEY] = { type: 'boolean', value: settings.nextEpisode };
  if (settings.onlyLeLibrary) {
    target[SOURCE_KEY] = { type: 'string', value: 'INSTALLED_ADDONS_ONLY' };
    target[SELECTED_ADDONS_KEY] = { type: 'string_set', value: [LELIBRARY_ADDON_NAME] };
  } else if (isOurScope(target)) {
    // Turned off: undo only LeLibrary's own scope, never an addon choice the
    // user made in Nuvio.
    target[SOURCE_KEY] = { type: 'string', value: 'ALL_SOURCES' };
    target[SELECTED_ADDONS_KEY] = { type: 'string_set', value: [] };
  }
  features.player_settings = target;
  return next;
}

export interface NuvioPlaybackSettingsApi {
  PLAYBACK_MODES: readonly PlaybackMode[];
  MAX_REGEX_LENGTH: number;
  LELIBRARY_ADDON_NAME: string;
  normalisePlaybackSettings: (input: unknown) => PlaybackSettings | null;
  applyPlaybackSettingsToBlob: (
    blob: unknown,
    settings: PlaybackSettings | null,
  ) => Record<string, unknown> | null;
}

module.exports = {
  PLAYBACK_MODES,
  MAX_REGEX_LENGTH,
  LELIBRARY_ADDON_NAME,
  normalisePlaybackSettings,
  applyPlaybackSettingsToBlob,
} satisfies NuvioPlaybackSettingsApi;
