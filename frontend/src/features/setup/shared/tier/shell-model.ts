import { providerSelectionWithSaved, type SetupKeysDraft } from '@/features/setup/shared/config-contract';
import type { TierId } from '@/features/setup/shared/edit-mode';
import { MIN_PASSWORD_LENGTH } from '@/features/setup/resolver/validation';
import { LANGS } from '@/features/setup/full/MetadataExtras';

// What the setup shell's sidebar and footer say about a page, derived only
// from the page's own state (typed keys, saved key names, connected
// accounts). Pure, so the checklist and the finish gate are unit-tested.

export interface ShellCheck {
  id: string;
  label: string;
  done: boolean;
}

// One line of a sidebar group ("Language · English").
export interface ShellFact {
  label: string;
  value: string;
  // Names and numbers shown as they are (never run through the copy map).
  verbatim?: boolean | undefined;
}

export interface ShellKeyState {
  keys: SetupKeysDraft;
  // Key names the server already holds (edit mode); never values.
  savedServices?: readonly string[] | undefined;
}

function hasKey(state: ShellKeyState, field: keyof SetupKeysDraft): boolean {
  return Boolean((state.keys[field] ?? '').trim()) || (state.savedServices ?? []).includes(field);
}

export function hasLibraryProvider(state: ShellKeyState): boolean {
  return providerSelectionWithSaved(state.keys, state.savedServices ?? []) !== '';
}

// Required on every tier: one library provider and the TMDB key.
export function requiredChecks(state: ShellKeyState): ShellCheck[] {
  return [
    { id: 'provider', label: 'Library provider', done: hasLibraryProvider(state) },
    { id: 'tmdb', label: 'TMDB', done: hasKey(state, 'tmdbApiKey') },
  ];
}

// Optional extras the page offers. Quick Look only has TVDB and OMDb; Settle
// In and Move In add MDBList and the connected accounts (Trakt only once a
// setup has it: new setups cannot connect Trakt).
export function optionalChecks(tier: TierId, state: ShellKeyState, linked: readonly string[] = []): ShellCheck[] {
  const keyed: ShellCheck[] = [
    { id: 'tvdb', label: 'TVDB', done: hasKey(state, 'tvdbApiKey') },
    { id: 'omdb', label: 'OMDb', done: hasKey(state, 'omdbKey') },
  ];
  if (tier === 'quick') return keyed;
  return [
    { id: 'mdblist', label: 'MDBList', done: hasKey(state, 'mdblistKey') },
    ...keyed,
    { id: 'simkl', label: 'Simkl', done: linked.includes('simkl') },
    { id: 'anilist', label: 'AniList', done: linked.includes('anilist') },
    ...(linked.includes('trakt') ? [{ id: 'trakt', label: 'Trakt', done: true }] : []),
  ];
}

// Required items carry most of the bar (80%); optional ones fill the rest.
// `complete` is the gate: every required item done.
export function setupCompletion(required: readonly ShellCheck[], optional: readonly ShellCheck[]): { percent: number; complete: boolean } {
  const share = (list: readonly ShellCheck[]) => (list.length ? list.filter((item) => item.done).length / list.length : 1);
  const complete = required.every((item) => item.done);
  const percent = Math.round(80 * share(required) + (optional.length ? 20 * share(optional) : 20 * share(required)));
  return { percent: Math.max(0, Math.min(100, percent)), complete };
}

// Why the finish action (Create my setup) cannot run yet, in the order a
// person fixes them; null = ready. Mirrors the server's rules (a library
// provider, the TMDB key, a matching password of 8+ characters).
export function createBlocker(state: ShellKeyState, password: { value: string; confirmation: string } | null): string | null {
  if (!hasLibraryProvider(state)) return 'Add a library provider first';
  if (!hasKey(state, 'tmdbApiKey')) return 'Add your TMDB key first';
  if (password) {
    if (password.value.length < MIN_PASSWORD_LENGTH) return 'Choose a password of 8 or more characters';
    if (password.value !== password.confirmation) return 'Both passwords must match';
  }
  return null;
}

// The sidebar's Posters group: the poster provider, stream style and badges.
export function posterFacts(provider: string, streamStyle: string, badgePack: string): ShellFact[] {
  return [
    { label: 'Provider', value: provider, verbatim: true },
    { label: 'Stream style', value: streamStyle, verbatim: true },
    { label: 'Badge pack', value: badgePack, verbatim: true },
  ];
}

// The sidebar's Preferences group. Quick Look has no adult or category
// filters, so those lines only show when the page has them.
export function preferenceFacts(meta: { lang: string; hideAnime: boolean; hideAdult?: boolean | undefined; excludeCategories?: readonly string[] | undefined }): ShellFact[] {
  const facts: ShellFact[] = [
    { label: 'Language', value: LANGS.find((option) => option.id === meta.lang)?.name ?? meta.lang, verbatim: true },
    { label: 'Anime', value: meta.hideAnime ? 'Hidden' : 'Shown' },
  ];
  if (meta.hideAdult !== undefined) facts.push({ label: 'Adult content', value: meta.hideAdult ? 'Hidden' : 'Shown' });
  if (meta.excludeCategories !== undefined) facts.push({ label: 'Hidden categories', value: String(meta.excludeCategories.length) });
  return facts;
}
