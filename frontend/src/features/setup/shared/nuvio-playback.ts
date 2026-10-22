// Frontend shape of the optional Nuvio playback block. Stored in the setup
// config only when the user opts in, so an untouched setup leaves whatever they
// already have in Nuvio alone.
export type PlaybackMode = 'MANUAL' | 'FIRST_STREAM' | 'REGEX_MATCH';

export interface NuvioPlaybackDraft {
  enabled: boolean;
  mode: PlaybackMode;
  regex: string;
  nextEpisode: boolean;
}

export interface NuvioPlaybackConfig {
  mode: PlaybackMode;
  regex: string;
  nextEpisode: boolean;
}

export const MAX_REGEX_LENGTH = 300;

export const PLAYBACK_MODE_IDS: PlaybackMode[] = ['MANUAL', 'FIRST_STREAM', 'REGEX_MATCH'];

export const EMPTY_NUVIO_PLAYBACK: NuvioPlaybackDraft = {
  enabled: false,
  mode: 'MANUAL',
  regex: '',
  nextEpisode: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMode(value: unknown): value is PlaybackMode {
  return typeof value === 'string' && (PLAYBACK_MODE_IDS as string[]).includes(value);
}

// Accepts both shapes it can meet:
//   - a saved config value (no `enabled`: presence means enabled)
//   - a persisted draft (has `enabled`)
// Anything unrecognised falls back to "off", never to a guessed mode.
export function cleanNuvioPlayback(input: unknown): NuvioPlaybackDraft {
  if (!isRecord(input)) return { ...EMPTY_NUVIO_PLAYBACK };
  const mode = input['mode'];
  if (!isMode(mode)) return { ...EMPTY_NUVIO_PLAYBACK };
  return {
    enabled: input['enabled'] === false ? false : true,
    mode,
    regex: typeof input['regex'] === 'string' ? input['regex'].trim() : '',
    nextEpisode: input['nextEpisode'] === true,
  };
}

export function playbackValidation(draft: NuvioPlaybackDraft): 'regex-required' | 'regex-too-long' | null {
  const regex = draft.regex.trim();
  if (regex.length > MAX_REGEX_LENGTH) return 'regex-too-long';
  if (draft.enabled && draft.mode === 'REGEX_MATCH' && !regex) return 'regex-required';
  return null;
}

// What goes into the setup config. Null means the field is omitted, which the
// backend reads as "leave Nuvio's playback settings untouched".
export function nuvioPlaybackForConfig(draft: NuvioPlaybackDraft): NuvioPlaybackConfig | null {
  if (!draft.enabled) return null;
  if (playbackValidation(draft) !== null) return null;
  return {
    mode: draft.mode,
    regex: draft.regex.trim(),
    nextEpisode: draft.nextEpisode,
  };
}
