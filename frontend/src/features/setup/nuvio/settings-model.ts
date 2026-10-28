import type { SettingId, SettingValues } from '@/features/setup/nuvio/api';

// The Nuvio manager's playback settings form, declared once. Labels are the
// English copy (translated by the setup copy bridge); the server maps each
// SettingId to the TV and mobile keys and types.

export type SettingGroupId = 'autoplay' | 'next' | 'still' | 'skip' | 'languages' | 'home';

export type SettingControl =
  | { kind: 'switch' }
  | { kind: 'select'; options: { value: string | number; label: string }[] }
  | { kind: 'text'; placeholder?: string; maxLength?: number }
  | { kind: 'segments' }
  | { kind: 'language' };

export interface SettingField {
  id: SettingId;
  label: string;
  hint?: string;
  control: SettingControl;
  /** Only shown while another setting has one of these values. */
  when?: { id: SettingId; is: unknown[] };
}

export interface SettingGroup {
  id: SettingGroupId;
  title: string;
  fields: SettingField[];
}

const TIMEOUTS: { value: number; label: string }[] = [
  { value: 0, label: 'Instant' },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30].map((value) => ({ value, label: `${value} s` })),
  { value: -1, label: 'Wait for every source' },
];

const PERCENTS = [97, 97.5, 98, 98.5, 99, 99.5, 100].map((value) => ({ value, label: `${value}%` }));
const MINUTES = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((value) => ({ value, label: `${value} min` }));
const EPISODES = [2, 3, 4, 5, 6].map((value) => ({ value, label: String(value) }));

export const SKIP_SEGMENTS = [
  { value: 'intro', label: 'Intro' },
  { value: 'recap', label: 'Recap' },
  { value: 'outro', label: 'Outro' },
] as const;

export const SETTING_GROUPS: SettingGroup[] = [
  {
    id: 'autoplay',
    title: 'Auto-play',
    fields: [
      {
        id: 'autoPlayMode', label: 'Auto Stream Selection',
        control: { kind: 'select', options: [
          { value: 'MANUAL', label: 'Manual (choose stream)' },
          { value: 'FIRST_STREAM', label: 'Auto-play first source' },
          { value: 'REGEX_MATCH', label: 'Auto-play regex match' },
        ] },
      },
      {
        id: 'autoPlayRegex', label: 'Regex pattern', hint: 'Plays the first source whose text matches.',
        control: { kind: 'text', placeholder: '(2160p|4k|remux)', maxLength: 500 },
        when: { id: 'autoPlayMode', is: ['REGEX_MATCH'] },
      },
      {
        id: 'autoPlaySource', label: 'Sources to pick from',
        control: { kind: 'select', options: [
          { value: 'ALL_SOURCES', label: 'All sources' },
          { value: 'INSTALLED_ADDONS_ONLY', label: 'Installed addons only' },
        ] },
        when: { id: 'autoPlayMode', is: ['FIRST_STREAM', 'REGEX_MATCH'] },
      },
      {
        id: 'autoPlayTimeout', label: 'Wait for sources', hint: 'How long to wait for sources before auto-play picks one.',
        control: { kind: 'select', options: TIMEOUTS },
        when: { id: 'autoPlayMode', is: ['FIRST_STREAM', 'REGEX_MATCH'] },
      },
    ],
  },
  {
    id: 'next',
    title: 'Next episode',
    fields: [
      { id: 'nextEpisode', label: 'Auto-play next episode', control: { kind: 'switch' } },
      { id: 'preloadNextEpisode', label: 'Get the next episode ready early', control: { kind: 'switch' } },
      {
        id: 'nextEpisodeThresholdMode', label: 'Start the next episode',
        control: { kind: 'select', options: [
          { value: 'PERCENTAGE', label: 'At a percentage watched' },
          { value: 'MINUTES_BEFORE_END', label: 'Minutes before the end' },
        ] },
      },
      {
        id: 'nextEpisodeThresholdPercent', label: 'Percentage watched',
        control: { kind: 'select', options: PERCENTS },
        when: { id: 'nextEpisodeThresholdMode', is: ['PERCENTAGE'] },
      },
      {
        id: 'nextEpisodeThresholdMinutes', label: 'Minutes before the end',
        control: { kind: 'select', options: MINUTES },
        when: { id: 'nextEpisodeThresholdMode', is: ['MINUTES_BEFORE_END'] },
      },
    ],
  },
  {
    id: 'still',
    title: 'Still watching',
    fields: [
      { id: 'stillWatching', label: 'Ask if I am still watching', control: { kind: 'switch' } },
      {
        id: 'stillWatchingEpisodes', label: 'Ask after this many episodes in a row',
        control: { kind: 'select', options: EPISODES },
        when: { id: 'stillWatching', is: [true] },
      },
    ],
  },
  {
    id: 'skip',
    title: 'Skip',
    fields: [
      { id: 'skipSegments', label: 'Skip automatically', hint: 'Only where the episode has these parts marked.', control: { kind: 'segments' } },
    ],
  },
  {
    id: 'languages',
    title: 'Languages',
    fields: [
      { id: 'audioLanguage', label: 'Preferred audio language', control: { kind: 'language' } },
      { id: 'audioLanguage2', label: 'Second audio language', control: { kind: 'language' } },
      { id: 'subtitleLanguage', label: 'Preferred subtitle language', control: { kind: 'language' } },
      { id: 'subtitleLanguage2', label: 'Second subtitle language', control: { kind: 'language' } },
      { id: 'forcedSubtitles', label: 'Use forced subtitles', control: { kind: 'switch' } },
    ],
  },
  {
    id: 'home',
    title: 'Home',
    fields: [
      { id: 'hideUnreleased', label: 'Hide unreleased titles', hint: 'On Home, in search and in recommendations.', control: { kind: 'switch' } },
    ],
  },
];

export const ALL_SETTING_IDS: SettingId[] = SETTING_GROUPS.flatMap((group) => group.fields.map((field) => field.id));

// Language names stay in their own language, so they read the same to
// everyone and are never run through the copy bridge.
export const LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'ru', name: 'Русский' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'ar', name: 'العربية' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'zh', name: '中文' },
];

/** A setting is on the form only when Nuvio already has it on this profile. */
export function presentSettings(values: SettingValues): Set<SettingId> {
  return new Set(ALL_SETTING_IDS.filter((id) => Object.prototype.hasOwnProperty.call(values, id) && values[id] !== undefined));
}

export function fieldVisible(field: SettingField, draft: SettingValues): boolean {
  const when = field.when;
  if (!when) return true;
  // Nuvio lacks the controlling setting: nothing to depend on, so show it.
  if (draft[when.id] === undefined) return true;
  return when.is.some((value) => draft[when.id] === value);
}

function canonical(value: unknown): string {
  // Segment lists compare as sets: the order Nuvio stores them in is not a change.
  if (Array.isArray(value)) return JSON.stringify([...value].map(String).sort());
  return JSON.stringify(value ?? null);
}

/**
 * Only the settings the user actually changed, and only ones Nuvio already
 * has (the server never creates a missing setting).
 */
export function changedSettings(original: SettingValues, draft: SettingValues): SettingValues {
  const out: SettingValues = {};
  for (const id of ALL_SETTING_IDS) {
    if (!Object.prototype.hasOwnProperty.call(original, id) || original[id] === undefined) continue;
    if (!Object.prototype.hasOwnProperty.call(draft, id)) continue;
    if (canonical(original[id]) !== canonical(draft[id])) out[id] = draft[id];
  }
  return out;
}
