import { describe, expect, it } from 'vitest';
import { editSaveBody, emptySnapshot, snapshotFromSaved, type TierSnapshot } from '@/features/setup/shared/edit-mode';
import { collectionDefault, homeRowFromSource, nativeLibraryRows } from '@/features/setup/shared/collection-doc';

// Every field a setup can change, edited on the edit page, saved the way the
// server saves it (merge, then drop clearConfig), reopened: the change must
// be flagged, must survive the reload, and must leave nothing unsaved. Both
// directions: from the defaults to a value, and from a value back to the
// default (the merge used to keep the old value when a field went back to
// its default: "I changed my posters and nothing happened").

type Field = keyof TierSnapshot;

const VALUES: Partial<Record<Field, unknown[]>> = {
  name: ['Living room'],
  platform: ['stremio'],
  rdCatalog: ['separate'],
  posters: [
    { provider: 'betterposter', pictoriumUrl: '', pictoriumOptions: {}, customTemplate: '' },
    { provider: 'pictorium', pictoriumUrl: 'https://pictorium.example.com', pictoriumOptions: {}, customTemplate: '' },
    { provider: 'custom', pictoriumUrl: '', pictoriumOptions: {}, customTemplate: 'https://img.example.com/{imdb}.jpg' },
    { provider: 'postersplus', pictoriumUrl: '', pictoriumOptions: {}, customTemplate: '' },
  ],
  formatting: [{ preset: 'custom', nameTemplate: '{stream.resolution}', descTemplate: '{stream.size}' }],
  badgePack: [{ pack: 'custom', url: 'https://badges.example.com/pack.json' }, { pack: 'nard-full', url: '' }],
  meta: [{ lang: 'es-ES', sortBy: 'titulo', mainMetadata: true, hideAnime: true, torboxSources: ['torrent'], searchScope: 'library', notices: false, noticeTypes: ['none'] }],
  filterSets: [{ resolutions: ['4K', '1080p'], resolutionOrder: ['1080p', '4K', '2K', '720p', '480p', '360p', '240p'], qualities: ['BluRay'], sources: [], minSizeGb: '1', maxSizeGb: '20', cachedOnly: true }],
  mediaSets: [{ codecs: ['HEVC'], hdr: ['Dolby Vision', 'HDR10'], audio: ['Atmos'] }],
  homeRows: [nativeLibraryRows('torbox', 'nuvio').slice(0, 2).map((source, index) => homeRowFromSource(source, index))],
  collections: [[{ ...collectionDefault('Mine'), id: 'collection-test' }]],
  packs: [['genres']],
  addons: [['torrentio', 'comet']],
  customStreams: [[{ name: 'Clip', url: 'https://example.com/a.mp4', type: 'movie', ids: ['tt0111161'] }]],
  nuvioPlayback: [{ enabled: true, mode: 'FIRST_STREAM', regex: '', nextEpisode: true, onlyLeLibrary: true }],
  nuvioHideUnreleased: ['hide', 'show'],
  libraryRows: [{ movies: { name: 'Films', show: false }, series: { name: 'TV', show: true }, anime: { name: '', show: false } }],
  customAddons: [[{ id: 'custom-1', name: 'My addon' }]],
};

const KEYS = { torboxApiKey: 'tb-test', tmdbApiKey: 'tmdb-test' };

// What PUT /api/setup/:uuid does with the body (config-store.ts save).
function serverSave(config: Record<string, unknown>, name: string | null, body: Record<string, unknown> | null) {
  const next = { ...config, ...((body?.config as Record<string, unknown>) ?? {}) };
  for (const field of (body?.clearConfig as string[] | undefined) ?? []) delete next[field];
  const nextName = typeof body?.name === 'string' ? (body.name || null) : name;
  return { config: next, name: nextName };
}

function saveFrom(savedConfig: Record<string, unknown>, savedName: string | null, edit: (s: TierSnapshot) => TierSnapshot) {
  const saved = snapshotFromSaved(savedConfig, KEYS, savedName);
  const current = edit(structuredClone(saved));
  const body = editSaveBody({ current, saved, savedName, savedTier: 'full', tier: 'full', providerServices: ['torboxApiKey'], clearKeys: [] });
  const stored = serverSave(savedConfig, savedName, body);
  const reopened = snapshotFromSaved(stored.config, KEYS, stored.name);
  const leftover = editSaveBody({ current: reopened, saved: reopened, savedName: stored.name, savedTier: 'full', tier: 'full', providerServices: ['torboxApiKey'], clearKeys: [] });
  const stillDirty = editSaveBody({ current, saved: reopened, savedName: stored.name, savedTier: 'full', tier: 'full', providerServices: ['torboxApiKey'], clearKeys: [] });
  return { body, current, reopened, stored, leftover, stillDirty };
}

// A config holding every non-default value at once, built through the same save.
function richConfig(): { config: Record<string, unknown>; name: string | null } {
  return saveFrom({}, null, (snapshot) => {
    const next = snapshot as unknown as Record<string, unknown>;
    for (const [field, values] of Object.entries(VALUES)) next[field] = structuredClone(values![0]);
    return snapshot;
  }).stored;
}

describe('every edit is saved and survives a reload', () => {
  for (const [field, values] of Object.entries(VALUES) as [Field, unknown[]][]) {
    values.forEach((value, index) => {
      it(`${field} #${index + 1}: default -> value`, () => {
        const out = saveFrom({}, null, (s) => ({ ...s, [field]: structuredClone(value) }));
        expect(out.body, 'flagged as a change').not.toBeNull();
        expect(out.reopened[field]).toEqual(out.current[field]);
        expect(out.stillDirty, 'nothing left unsaved after saving').toBeNull();
      });
    });
    it(`${field}: value -> default`, () => {
      const rich = richConfig();
      const defaults = emptySnapshot();
      const out = saveFrom(rich.config, rich.name, (s) => ({ ...s, [field]: structuredClone(defaults[field]) }));
      expect(out.body, 'flagged as a change').not.toBeNull();
      expect(out.reopened[field]).toEqual(out.current[field]);
      expect(out.stillDirty, 'nothing left unsaved after saving').toBeNull();
    });
  }

  it('an untouched setup has nothing to save', () => {
    const rich = richConfig();
    expect(saveFrom(rich.config, rich.name, (s) => s).body).toBeNull();
    expect(saveFrom({}, null, (s) => s).body).toBeNull();
  });

  it('only the edited area is sent', () => {
    const rich = richConfig();
    const out = saveFrom(rich.config, rich.name, (s) => ({ ...s, posters: { ...s.posters, provider: 'erdb', pictoriumUrl: '' } }));
    const sent = Object.keys((out.body?.config as Record<string, unknown>) ?? {});
    expect(sent.every((key) => ['posterProvider', 'pictoriumUrl', 'pictoriumOptions', 'customPosterTemplate'].includes(key))).toBe(true);
  });
});
