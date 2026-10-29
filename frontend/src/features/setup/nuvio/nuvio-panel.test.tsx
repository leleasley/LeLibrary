import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  NuvioAddon, NuvioOverview, NuvioProfile, NuvioProfileDetail,
} from '@/features/setup/nuvio/api';

// No network in tests: every API call is a spy that never resolves to real data.
vi.mock('@/features/setup/nuvio/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/setup/nuvio/api')>();
  const stub = () => vi.fn(() => new Promise(() => {}));
  return {
    ...actual,
    fetchNuvioOverview: stub(), fetchNuvioProfile: stub(), createNuvioProfile: stub(),
    updateNuvioProfile: stub(), deleteNuvioProfile: stub(), copyNuvioProfile: stub(),
    saveNuvioSettings: stub(), addNuvioAddon: stub(), updateNuvioAddon: stub(),
    orderNuvioAddons: stub(), removeNuvioAddon: stub(), setNuvioCollectionHidden: stub(),
    orderNuvioCollections: stub(), deleteNuvioCollection: stub(), saveNuvioHome: stub(),
    fetchNuvioBackups: stub(), createNuvioBackup: stub(), restoreNuvioBackup: stub(),
    undoNuvioChange: stub(),
  };
});

const { NuvioPanel } = await import('@/features/setup/nuvio/NuvioPanel');
const { DeleteProfileModal, deleteNameMatches } = await import('@/features/setup/nuvio/NuvioProfilesTab');
const { normaliseManifestLink } = await import('@/features/setup/nuvio/NuvioContentTabs');
const { changedSettings, presentSettings } = await import('@/features/setup/nuvio/settings-model');
const { moveItem } = await import('@/features/setup/nuvio/nuvio-ui');

const PROFILES: NuvioProfile[] = [
  { index: 1, name: 'Lewis', color: '#1E88E5', avatarUrl: null, usesPrimaryAddons: false, pinEnabled: false, isPrimary: true },
  { index: 2, name: 'Kids Room', color: '#E53935', avatarUrl: null, usesPrimaryAddons: true, pinEnabled: true, isPrimary: false },
  { index: 3, name: 'Guest', color: '#43A047', avatarUrl: null, usesPrimaryAddons: false, pinEnabled: false, isPrimary: false },
];

const OVERVIEW: NuvioOverview = { user: 'viewer@example.com', profiles: PROFILES, selected: 1, maxProfiles: 6 };

const ADDONS: NuvioAddon[] = [
  { id: 'row-b', name: 'Torrentio', host: 'torrentio.strem.fun', enabled: true, order: 1, isLeLibrary: false },
  { id: 'row-a', name: 'LeLibrary', host: 'lelibrary.uk', enabled: true, order: 0, isLeLibrary: true },
  { id: 'row-c', name: 'Cinemeta', host: 'v3-cinemeta.strem.io', enabled: false, order: 2, isLeLibrary: false },
];

function detailFor(profile: NuvioProfile, extra: Partial<NuvioProfileDetail> = {}): NuvioProfileDetail {
  return {
    profile,
    addons: ADDONS,
    addonsFrom: profile.usesPrimaryAddons ? 1 : profile.index,
    collections: [
      { id: 'collection-lelibrary', title: 'LeLibrary', folders: 4, isLeLibrary: true, hidden: false },
      { id: 'collection-other', title: 'Marvel', folders: 2, isLeLibrary: false, hidden: true },
    ],
    home: {
      items: [
        { key: 'a:movie:top', title: 'Top Movies', type: 'movie', catalogId: 'top', addonId: 'a', isCollection: false, enabled: true, order: 0 },
      ],
      hideUnreleased: null,
    },
    settings: {
      values: { autoPlayMode: 'FIRST_STREAM', nextEpisode: true, skipSegments: ['intro'], audioLanguage: 'en' },
      platforms: { tv: true, mobile: true },
    },
    readAt: '2026-10-28T10:00:00Z',
    ...extra,
  };
}

function render(initial: Parameters<typeof NuvioPanel>[0]['initial']): string {
  return renderToStaticMarkup(<NuvioPanel uuid="11111111-2222-3333-4444-555555555555" editToken="edit-token" initial={initial} />);
}

describe('NuvioPanel', () => {
  it('renders the profiles, the signed-in user and every tab', () => {
    const html = render({ overview: OVERVIEW, detail: detailFor(PROFILES[0]!) });
    expect(html).toContain('YOUR NUVIO');
    expect(html).toContain('viewer@example.com');
    for (const name of ['Lewis', 'Kids Room', 'Guest']) expect(html).toContain(name);
    for (const tab of ['Addons', 'Home and collections', 'Playback settings', 'Profiles', 'Backups']) expect(html).toContain(tab);
    // Main badge on profile 1, PIN lock and the shared-addons note on profile 2.
    expect(html).toContain('>Main<');
    expect(html).toContain('nv-lock');
    expect(html).toContain('Uses Main&#x27;s addons');
  });

  it('shows a skeleton while the account loads', () => {
    const html = renderToStaticMarkup(<NuvioPanel uuid="11111111-2222-3333-4444-555555555555" editToken="edit-token" />);
    expect(html).toContain('nv-skeleton');
  });

  it('lists addons in Nuvio order without ever rendering a link', () => {
    const html = render({ overview: OVERVIEW, detail: detailFor(PROFILES[0]!) });
    expect(html.indexOf('LeLibrary')).toBeLessThan(html.indexOf('Torrentio'));
    expect(html.indexOf('Torrentio')).toBeLessThan(html.indexOf('Cinemeta'));
    expect(html).not.toMatch(/https?:\/\/[a-z0-9]/i);
    expect(html).toContain('Add an addon');
  });

  it('shows each addon\'s manifest facts, a settings button and an edit jump for this setup', () => {
    const addons: NuvioAddon[] = [
      { id: 'row-a', name: 'LeLibrary', host: 'lelibrary.uk', enabled: true, order: 0, isLeLibrary: true, kind: 'this-setup', configurable: true },
      { id: 'row-b', name: 'Torrentio', host: 'torrentio.strem.fun', enabled: true, order: 1, isLeLibrary: false, kind: 'other', configurable: true,
        version: '0.0.15', description: 'Provides torrent streams', types: ['movie', 'series'], catalogs: 0, logo: 'https://torrentio.strem.fun/logo.png' },
      { id: 'row-c', name: 'Old LeLibrary', host: 'lelibrary.uk', enabled: true, order: 2, isLeLibrary: false, kind: 'lelibrary', configurable: true, catalogs: 140 },
      { id: 'row-d', name: 'Subs', host: 'subs.example', enabled: true, order: 3, isLeLibrary: false, kind: 'other', configurable: false },
    ];
    const html = renderToStaticMarkup(
      <NuvioPanel uuid="11111111-2222-3333-4444-555555555555" editToken="edit-token" onEditSetup={() => {}}
        initial={{ overview: OVERVIEW, detail: detailFor(PROFILES[0]!, { addons }) }} />,
    );
    const rows = html.split('<li ').slice(1);
    const row = (name: string) => rows.find((r) => r.includes(`>${name}<`))!;
    expect(row('LeLibrary')).toContain('Edit this setup');
    expect(row('LeLibrary')).not.toContain('>Configure');
    expect(row('Torrentio')).toContain('>Configure');
    expect(row('Torrentio')).toContain('v0.0.15');
    expect(row('Torrentio')).toContain('Provides torrent streams');
    expect(row('Torrentio')).toContain('Movies');
    expect(row('Old LeLibrary')).toContain('LeLibrary setup');
    expect(row('Old LeLibrary')).toContain('140 catalogues');
    expect(row('Subs')).not.toContain('>Configure');
    // The at-a-glance strip.
    expect(html).toContain('addons on');
  });

  it('gives LeLibrary\'s own addon no remove button', () => {
    const html = render({ overview: OVERVIEW, detail: detailFor(PROFILES[0]!) });
    const rows = html.split('<li ').slice(1);
    const own = rows.find((row) => row.includes('>LeLibrary<'))!;
    const other = rows.find((row) => row.includes('>Torrentio<'))!;
    expect(own).toBeTruthy();
    expect(own).not.toContain('>Remove<');
    expect(own).toContain('This setup');
    expect(other).toContain('>Remove<');
  });

  it('shows a read-only list for a profile on the main profile\'s addons', () => {
    const html = render({ overview: { ...OVERVIEW, selected: 2 }, detail: detailFor(PROFILES[1]!) });
    expect(html).toContain('Managed on');
    expect(html).toContain('Give this profile its own addons');
    expect(html).not.toContain('>Remove<');
    expect(html).not.toContain('Add an addon');
  });

  it('never offers to delete the main profile', () => {
    const html = render({ overview: OVERVIEW, detail: detailFor(PROFILES[0]!), tab: 'profiles' });
    const cards = html.split('class="nv-profile-card"').slice(1);
    expect(cards).toHaveLength(3);
    const main = cards.find((card) => card.includes('>Lewis<'))!;
    const guest = cards.find((card) => card.includes('>Guest<'))!;
    expect(main).not.toContain('>Delete<');
    expect(guest).toContain('>Delete<');
  });

  it('shows only settings Nuvio has, and names the missing ones', () => {
    const html = render({ overview: OVERVIEW, detail: detailFor(PROFILES[0]!), tab: 'settings' });
    expect(html).toContain('Auto Stream Selection');
    expect(html).toContain('Auto-play next episode');
    expect(html).toContain('Skip automatically');
    expect(html).toContain('Not set on this profile yet');
    // Missing settings are only listed, never given a control.
    const [form, missing] = html.split('nv-missing');
    expect(missing).toContain('Use forced subtitles');
    expect(form).not.toContain('Use forced subtitles');
    expect(form).not.toContain('Hide unreleased titles');
  });

  it('caps the switcher at six profiles', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...PROFILES[2]!, index: i + 1, name: `P${i + 1}`, isPrimary: i === 0 }));
    const html = render({ overview: { ...OVERVIEW, profiles: many }, detail: null });
    expect(html).toContain('>P6<');
    expect(html).not.toContain('>P7<');
  });
});

describe('DeleteProfileModal', () => {
  const guest = PROFILES[2]!;
  const button = (html: string) => /<button type="submit"[^>]*>/.exec(html)?.[0] ?? '';

  it('keeps the delete button disabled until the exact name is typed', () => {
    const empty = renderToStaticMarkup(<DeleteProfileModal profile={guest} busy={false} onConfirm={() => {}} onCancel={() => {}} />);
    expect(button(empty)).toContain('disabled');
    expect(empty).toContain('watch history');
    const wrong = renderToStaticMarkup(<DeleteProfileModal profile={guest} busy={false} onConfirm={() => {}} onCancel={() => {}} initialTyped="guest" />);
    expect(button(wrong)).toContain('disabled');
    const right = renderToStaticMarkup(<DeleteProfileModal profile={guest} busy={false} onConfirm={() => {}} onCancel={() => {}} initialTyped="Guest" />);
    expect(button(right)).not.toContain('disabled');
  });

  it('never enables delete for the main profile', () => {
    const html = renderToStaticMarkup(<DeleteProfileModal profile={PROFILES[0]!} busy={false} onConfirm={() => {}} onCancel={() => {}} initialTyped="Lewis" />);
    expect(button(html)).toContain('disabled');
  });

  it('matches names exactly', () => {
    expect(deleteNameMatches(guest, 'Guest')).toBe(true);
    expect(deleteNameMatches(guest, 'Guest ')).toBe(false);
    expect(deleteNameMatches(guest, '')).toBe(false);
  });
});

describe('changedSettings', () => {
  const original = { autoPlayMode: 'MANUAL', nextEpisode: true, skipSegments: ['intro', 'outro'], audioLanguage: 'en' };

  it('sends only the values that changed', () => {
    const draft = { ...original, autoPlayMode: 'FIRST_STREAM', audioLanguage: 'en' };
    expect(changedSettings(original, draft)).toEqual({ autoPlayMode: 'FIRST_STREAM' });
  });

  it('sends nothing when nothing changed, and ignores segment order', () => {
    expect(changedSettings(original, { ...original, skipSegments: ['outro', 'intro'] })).toEqual({});
  });

  it('never sends a setting Nuvio does not have', () => {
    expect(changedSettings(original, { ...original, forcedSubtitles: true })).toEqual({});
  });

  it('lists only present settings', () => {
    expect([...presentSettings(original)].sort()).toEqual(['audioLanguage', 'autoPlayMode', 'nextEpisode', 'skipSegments']);
  });
});

describe('helpers', () => {
  it('moves items for reordering', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });

  it('accepts only https (or stremio) addon links', () => {
    expect(normaliseManifestLink('stremio://example.com/manifest.json')).toBe('https://example.com/manifest.json');
    expect(normaliseManifestLink(' https://example.com/x/manifest.json ')).toBe('https://example.com/x/manifest.json');
    expect(normaliseManifestLink('http://example.com/manifest.json')).toBeNull();
    expect(normaliseManifestLink('not a link')).toBeNull();
  });
});
