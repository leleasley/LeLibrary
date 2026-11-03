import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FullDraft } from '@/features/setup/full/full-draft';
import type { PartialDraft } from '@/features/setup/partial/partial-draft';
import type { QuickDraft } from '@/features/setup/quick/quick-draft';
import type { SetupKeysDraft } from '@/features/setup/shared/config-contract';
import { EMPTY_METADATA_EXTRAS } from '@/features/setup/full/MetadataExtras';
import { EMPTY_FILTER_SETS } from '@/features/setup/full/FilterSets';
import { EMPTY_MEDIA_SETS } from '@/features/setup/partial/FilterMediaSets';
import { EMPTY_FORMATTING } from '@/features/setup/shared/FormattingSection';
import { isRecord } from '@/features/setup/shared/is-record';

// Audit S1: pre-creation drafts must never put a secret in Web Storage. Every
// value here is synthetic and unique, so a raw scan of storage finds any leak.
const KEYS: Required<SetupKeysDraft> = {
  torboxApiKey: 'SECRET-torbox-1111',
  rdApiKey: 'SECRET-rd-2222',
  adApiKey: 'SECRET-ad-3333',
  pmApiKey: 'SECRET-pm-4444',
  mdblistKey: 'SECRET-mdblist-5555',
  tmdbApiKey: 'SECRET-tmdb-6666',
  tvdbApiKey: 'SECRET-tvdb-7777',
  erdbToken: 'SECRET-erdb-8888',
  rpdbKey: 'SECRET-rpdb-9999',
  omdbKey: 'SECRET-omdb-aaaa',
  fanartKey: 'SECRET-fanart-bbbb',
  postersPlusUrl: 'https://postersplus.example/SECRET-postersplus-cccc/p/x',
  customAddon1: 'https://addon.example/SECRET-addon1-dddd/manifest.json',
  customAddon2: 'https://addon.example/SECRET-addon2-eeee/manifest.json',
  customAddon3: 'https://addon.example/SECRET-addon3-ffff/manifest.json',
  webdavUrl: 'https://dav.example/SECRET-davurl-gggg',
  webdavUser: 'SECRET-davuser-hhhh',
  webdavPassword: 'SECRET-davpass-iiii',
};

const WATCHLIST = {
  simkl: { access_token: 'SECRET-simkl-access', refresh_token: 'SECRET-simkl-refresh', client_id: 'pub' },
  trakt: { access_token: 'SECRET-trakt-access', refresh_token: 'SECRET-trakt-refresh', expires_at: 1 },
};

const NUVIO = {
  platform: 'nuvio' as const,
  nuvioToken: 'SECRET-nuvio-access',
  nuvioRefresh: 'SECRET-nuvio-refresh',
  nuvioUser: { email: 'someone@example.com' },
  nuvioSelectedProfile: 2,
};

const STREMIO = { platform: 'stremio' as const, stremioAuth: 'SECRET-stremio-auth', stremioUser: { email: 'x@example.com' } };

const ADDONS = [
  { id: 'custom-1', name: 'My AIOStreams' },
  { id: 'custom-2', name: 'StreamNZB' },
];

const PARTIAL: PartialDraft = {
  name: 'Living room',
  keys: KEYS,
  formatting: { ...EMPTY_FORMATTING, preset: 'cinema' },
  posters: { provider: 'pictorium', pictoriumUrl: 'https://pictorium.example/p', pictoriumOptions: { ratings: true }, customTemplate: '' },
  homeRows: [],
  filterSets: { ...EMPTY_FILTER_SETS, cachedOnly: true },
  mediaSets: EMPTY_MEDIA_SETS,
  meta: { ...EMPTY_METADATA_EXTRAS, lang: 'es-ES' },
  badgePack: 'nard-full',
  customBadgeUrl: 'https://badges.example/pack.json',
  watchlist: WATCHLIST,
  addons: ['torrentio', 'custom-1', 'custom-2'],
  customStreams: [{ name: 'Clip', url: 'https://cdn.example/clip.mp4' }],
  customAddons: ADDONS,
  platform: 'nuvio',
  pushConn: NUVIO,
};

const FULL: FullDraft = {
  ...PARTIAL,
  platform: 'stremio',
  rdCatalog: 'separate',
  collections: [],
  packs: ['hub'],
  addons: ['torrentio', 'custom-1', 'custom-2'],
  customStreams: [{ name: 'Clip', url: 'https://cdn.example/clip.mp4' }],
  pushConn: STREMIO,
};

const QUICK: QuickDraft = {
  name: 'Bedroom',
  keys: KEYS,
  formatting: { ...EMPTY_FORMATTING, preset: 'cinema' },
  posters: { provider: 'erdb', pictoriumUrl: '', pictoriumOptions: {}, customTemplate: '' },
  badgePack: { pack: 'nard-full', url: '' },
};

let local: Record<string, string>;
let session: Record<string, string>;

function fakeStorage(store: Record<string, string>) {
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
  };
}

function rawStorage(): string {
  return JSON.stringify({ local, session });
}

function expectNoSecrets(raw: string) {
  expect(raw).not.toContain('SECRET-');
  expect(raw).not.toContain('someone@example.com');
}

// A fresh module graph is what a page reload gives: module memory is gone,
// only Web Storage remains.
async function freshModules() {
  vi.resetModules();
  return {
    full: await import('@/features/setup/full/full-draft'),
    partial: await import('@/features/setup/partial/partial-draft'),
    quick: await import('@/features/setup/quick/quick-draft'),
  };
}

beforeEach(() => {
  local = {};
  session = {};
  (globalThis as any).localStorage = fakeStorage(local);
  (globalThis as any).sessionStorage = fakeStorage(session);
});

afterEach(() => {
  delete (globalThis as any).localStorage;
  delete (globalThis as any).sessionStorage;
});

describe('draft secrets stay out of Web Storage', () => {
  it('stores none of the secret values for any tier', async () => {
    const { full, partial, quick } = await freshModules();
    full.saveFullDraft(FULL);
    partial.savePartialDraft(PARTIAL);
    quick.saveQuickDraft(QUICK);
    expect(Object.keys(local).sort()).toEqual(['lelibrary_full_draft', 'lelibrary_partial_draft']);
    expect(Object.keys(session)).toEqual(['lelibrary_quick_draft']);
    expectNoSecrets(rawStorage());
  });

  it('keeps secrets in memory between page mounts', async () => {
    const { full, partial, quick } = await freshModules();
    full.saveFullDraft(FULL);
    partial.savePartialDraft(PARTIAL);
    quick.saveQuickDraft(QUICK);
    // A remount (navigating away and back inside the app) loads again.
    for (let mount = 0; mount < 2; mount += 1) {
      const f = full.loadFullDraft();
      const p = partial.loadPartialDraft();
      const q = quick.loadQuickDraft();
      expect(f?.keys).toEqual(KEYS);
      expect(f?.watchlist).toEqual(WATCHLIST);
      expect(f?.pushConn).toEqual(STREMIO);
      expect(f?.customAddons).toEqual(ADDONS);
      expect(p?.keys).toEqual(KEYS);
      expect(p?.watchlist).toEqual(WATCHLIST);
      expect(p?.pushConn).toEqual(NUVIO);
      expect(p?.addons).toEqual(['torrentio', 'custom-1', 'custom-2']);
      expect(q?.keys).toEqual(KEYS);
    }
    expectNoSecrets(rawStorage());
  });

  it('round-trips every non-secret field through a reload, secrets empty', async () => {
    const before = await freshModules();
    before.full.saveFullDraft(FULL);
    before.partial.savePartialDraft(PARTIAL);
    before.quick.saveQuickDraft(QUICK);

    const { full, partial, quick } = await freshModules();
    const f = full.loadFullDraft();
    expect(f).not.toBe(null);
    expect(f?.keys).toEqual({});
    expect(f?.watchlist).toEqual({});
    expect(f?.pushConn).toBe(null);
    expect(f?.platform).toBe('stremio');
    expect(f?.rdCatalog).toBe('separate');
    expect(f?.packs).toEqual(['hub']);
    expect(f?.name).toBe('Living room');
    expect(f?.formatting.preset).toBe('cinema');
    expect(f?.posters).toEqual(PARTIAL.posters);
    expect(f?.filterSets.cachedOnly).toBe(true);
    expect(f?.meta.lang).toBe('es-ES');
    expect(f?.customBadgeUrl).toBe('https://badges.example/pack.json');
    expect(f?.customStreams).toEqual(FULL.customStreams);
    // Your own addons lost their link: they go, the other sources stay.
    expect(f?.customAddons).toEqual([]);
    expect(f?.addons).toEqual(['torrentio']);

    const p = partial.loadPartialDraft();
    expect(p?.keys).toEqual({});
    expect(p?.watchlist).toEqual({});
    expect(p?.pushConn).toBe(null);
    expect(p?.platform).toBe('nuvio');
    expect(p?.name).toBe('Living room');
    expect(p?.posters).toEqual(PARTIAL.posters);
    expect(p?.addons).toEqual(['torrentio']);
    expect(p?.customAddons).toEqual([]);
    expect(p?.customStreams).toEqual(PARTIAL.customStreams);

    const q = quick.loadQuickDraft();
    expect(q?.keys).toEqual({});
    expect(q?.name).toBe('Bedroom');
    expect(q?.posters.provider).toBe('erdb');
    expect(q?.badgePack.pack).toBe('nard-full');
  });

  it('scrubs secrets from drafts stored before v6 on first load', async () => {
    const savedAt = Date.now() - 1000;
    local['lelibrary_full_draft'] = JSON.stringify({ ...FULL, savedAt });
    local['lelibrary_partial_draft'] = JSON.stringify({ ...PARTIAL, savedAt });
    session['lelibrary_quick_draft'] = JSON.stringify({ ...QUICK, savedAt });
    expect(rawStorage()).toContain('SECRET-');

    const { full, partial, quick } = await freshModules();
    const f = full.loadFullDraft();
    const p = partial.loadPartialDraft();
    const q = quick.loadQuickDraft();
    // Wiped from storage right away, and never restored either.
    expectNoSecrets(rawStorage());
    expect(f?.keys).toEqual({});
    expect(f?.pushConn).toBe(null);
    expect(f?.watchlist).toEqual({});
    expect(p?.keys).toEqual({});
    expect(p?.pushConn).toBe(null);
    expect(q?.keys).toEqual({});
    // The rest of the draft survives, with its original age.
    expect(f?.name).toBe('Living room');
    expect(p?.meta.lang).toBe('es-ES');
    expect(q?.name).toBe('Bedroom');
    const stored = JSON.parse(local['lelibrary_full_draft']!) as Record<string, unknown>;
    expect(stored['savedAt']).toBe(savedAt);
    expect(isRecord(stored['keys'])).toBe(true);
  });

  it('forgets held secrets on clear', async () => {
    const { full, partial, quick } = await freshModules();
    full.saveFullDraft(FULL);
    partial.savePartialDraft(PARTIAL);
    quick.saveQuickDraft(QUICK);
    full.clearFullDraft();
    partial.clearPartialDraft();
    quick.clearQuickDraft();
    // A later draft without keys must not pick the old ones back up.
    full.saveFullDraft({ ...FULL, keys: {}, watchlist: {}, pushConn: null });
    partial.savePartialDraft({ ...PARTIAL, keys: {}, watchlist: {}, pushConn: null });
    quick.saveQuickDraft({ ...QUICK, keys: {} });
    expect(full.loadFullDraft()?.keys).toEqual({});
    expect(full.loadFullDraft()?.pushConn).toBe(null);
    expect(partial.loadPartialDraft()?.watchlist).toEqual({});
    expect(quick.loadQuickDraft()?.keys).toEqual({});
  });

  it('works without storage', async () => {
    delete (globalThis as any).localStorage;
    const { full } = await freshModules();
    full.saveFullDraft(FULL);
    // No storage: no draft to resume, and nothing crashes.
    expect(full.loadFullDraft()).toBe(null);
  });
});
