import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// The seams between the API keys cards and the personal list rows (v6): one
// AniList is Connect-only, identities from the authenticated config read,
// the real Trakt legacy fields, the AniList connect before creation, and the
// "Your lists" shelves following the cards. No network: the client is a spy.
const api = vi.hoisted(() => ({
  get: vi.fn((..._args: unknown[]): Promise<unknown> => new Promise(() => {})),
  post: vi.fn(() => new Promise(() => {})), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
}));
vi.mock('@/api/client', () => ({ apiClient: api }));

const { fetchSetupConfig, parseWatchlistConfig, cleanWatchlistDraft } = await import('@/features/setup/resolver/api');
const { accountIdentity, draftFromPopupTokens, visibleConnectCards } = await import('@/features/setup/shared/connected-accounts');
const { ConnectedAccounts } = await import('@/features/setup/shared/ApiKeysSection');
const { pruneConfig } = await import('@/features/setup/shared/config-contract');
const { snapshotFromSaved, editSaveBody } = await import('@/features/setup/shared/edit-mode');
const { userListServicesFrom } = await import('@/features/setup/shared/user-lists');
const { tierPreviewSource } = await import('@/features/setup/shared/tier/TierPreview');
const { withoutSecrets } = await import('@/features/setup/shared/draft-secrets');
type WatchlistConnections = import('@/features/setup/shared/connected-accounts').WatchlistConnections;
type WatchlistProvider = import('@/features/setup/resolver/api').WatchlistProvider;

const ANILIST_CONN = { access_token: 'synthetic-anilist-token', refresh_token: null, expires_at: 1_900_000_000_000, client_id: 'synthetic-client' };

describe('AniList is Connect-only (v6): the pages never write anilistUser', () => {
  it('create drops it, edit does not read it, the shelf needs a connection or a saved public name', () => {
    expect(pruneConfig({ anilistUser: ' Neo_99 ' } as Record<string, unknown>)).toEqual({});
    const snapshot = snapshotFromSaved({ anilistUser: 'Neo_99' }, {}, null);
    expect(snapshot.meta).not.toHaveProperty('anilistUser');
    expect(editSaveBody({
      current: snapshot, saved: snapshot, savedName: null, savedTier: 'partial', tier: 'partial', providerServices: [], clearKeys: [],
    })).toBe(null);
    expect(userListServicesFrom({}, null).anilist).toBe(false);
  });
});

describe('identities come from GET /:uuid/config', () => {
  it('reads and cleans them from the config response', async () => {
    api.get.mockResolvedValueOnce({ config: { lang: 'en-US' }, identities: { mdblist: ' lewis ', simkl: 'neo', anilist: 'Neo_99', evil: 'x', trakt: 'y' } });
    const out = await fetchSetupConfig('11111111-2222-3333-4444-555555555555', 'synthetic-edit');
    expect(api.get).toHaveBeenLastCalledWith('/api/setup/11111111-2222-3333-4444-555555555555/config', { headers: { Authorization: 'Bearer synthetic-edit' } });
    expect(out).toEqual({ config: { lang: 'en-US' }, identities: { mdblist: 'lewis', simkl: 'neo', anilist: 'Neo_99' } });
  });

  it('an older server without identities reads as none', async () => {
    api.get.mockResolvedValueOnce({ config: {} });
    expect((await fetchSetupConfig('11111111-2222-3333-4444-555555555555', 'synthetic-edit')).identities).toEqual({});
  });

  it('shows the Simkl and AniList names on their connected cards', () => {
    const html = renderToStaticMarkup(
      <ConnectedAccounts connections={connections({ connected: ['simkl', 'anilist'], anilist: true })} identities={{ simkl: 'neo', anilist: 'Neo_99' }} />,
    );
    expect(html).toContain('Connected as neo');
    expect(html).toContain('Connected as Neo_99');
  });
});

describe('Trakt legacy: the fields the server sends', () => {
  it('watchlist-config traktLegacy hides Trakt for a setup that never connected it', () => {
    const config = parseWatchlistConfig({ simkl: true, trakt: true, anilist: false, traktLegacy: true });
    const none = () => false;
    expect(visibleConnectCards({ precreation: true, config, status: null, connected: none })).not.toContain('trakt');
    expect(visibleConnectCards({ precreation: false, config, status: null, connected: (p) => p === 'trakt' })).toContain('trakt');
  });

  it('the setup status trakt.legacy hides it too (config not loaded)', () => {
    const status = { simkl: { connected: false, configured: true }, trakt: { connected: false, configured: true, legacy: true } };
    expect(visibleConnectCards({ precreation: false, config: null, status, connected: () => false })).not.toContain('trakt');
  });

  it('reads AniList availability from anilist', () => {
    expect(parseWatchlistConfig({ simkl: true, trakt: true, anilist: true, traktLegacy: true }).anilist).toBe(true);
  });
});

describe('AniList connect before creation', () => {
  it('takes the popup tokens into the draft, only the sealable fields', () => {
    const out = draftFromPopupTokens({ lelibraryWatchlistTokens: { provider: 'anilist', connection: { ...ANILIST_CONN, extra: 'dropped' } } }, { simkl: { access_token: 'synthetic-simkl' } });
    expect(out).not.toBeNull();
    expect(out).not.toBe('no-tokens');
    const accepted = out as Exclude<typeof out, null | 'no-tokens'>;
    expect(accepted.provider).toBe('anilist');
    expect(accepted.next).toEqual({ simkl: { access_token: 'synthetic-simkl' }, anilist: { access_token: 'synthetic-anilist-token', expires_at: 1_900_000_000_000, client_id: 'synthetic-client' } });
    expect(draftFromPopupTokens({ lelibraryWatchlistTokens: { provider: 'anilist', connection: {} } }, {})).toBe('no-tokens');
    expect(draftFromPopupTokens({ lelibraryWatchlistTokens: { provider: 'evil', connection: ANILIST_CONN } }, {})).toBeNull();
    expect(draftFromPopupTokens({ lelibraryWatchlist: 'anilist' }, {})).toBeNull();
  });

  it('keeps the account name the popup sent next to the tokens', () => {
    const top = draftFromPopupTokens({ lelibraryWatchlistTokens: { provider: 'simkl', connection: { access_token: 'synthetic-simkl' }, username: ' neo ' } }, {});
    expect((top as Exclude<typeof top, null | 'no-tokens'>).next.simkl).toEqual({ access_token: 'synthetic-simkl', username: 'neo' });
    const inside = draftFromPopupTokens({ lelibraryWatchlistTokens: { provider: 'anilist', connection: { ...ANILIST_CONN, username: 'Neo_99' }, username: null } }, {});
    expect((inside as Exclude<typeof inside, null | 'no-tokens'>).next.anilist?.username).toBe('Neo_99');
    // Creation stores it with the connection.
    expect(cleanWatchlistDraft((inside as Exclude<typeof inside, null | 'no-tokens'>).next).anilist?.username).toBe('Neo_99');
    // Junk is not a name.
    const junk = draftFromPopupTokens({ lelibraryWatchlistTokens: { provider: 'simkl', connection: { access_token: 'synthetic-simkl', username: 42 }, username: 'x'.repeat(200) } }, {});
    expect((junk as Exclude<typeof junk, null | 'no-tokens'>).next.simkl).toEqual({ access_token: 'synthetic-simkl' });
  });

  it('keeps it in memory only and sends it on create as keys.watchlist.anilist', async () => {
    const accepted = draftFromPopupTokens({ lelibraryWatchlistTokens: { provider: 'anilist', connection: ANILIST_CONN } }, {});
    const watchlist = (accepted as Exclude<typeof accepted, null | 'no-tokens'>).next;
    // Web Storage gets the draft without it ...
    expect(JSON.stringify(withoutSecrets({ meta: {}, keys: {}, watchlist }))).not.toContain('synthetic-anilist-token');
    // ... the page's memory keeps it across in-app navigation ...
    const store: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    };
    try {
      const { savePartialDraft, loadPartialDraft, clearPartialDraft } = await import('@/features/setup/partial/partial-draft');
      const { snapshotToPartialDraft, emptySnapshot } = await import('@/features/setup/shared/edit-mode');
      savePartialDraft({ ...snapshotToPartialDraft(emptySnapshot()), watchlist });
      expect(Object.values(store).join('')).not.toContain('synthetic-anilist-token');
      expect(loadPartialDraft()?.watchlist.anilist?.access_token).toBe('synthetic-anilist-token');
      clearPartialDraft();
    } finally {
      delete (globalThis as any).localStorage;
    }
    // ... and creation seals what cleanWatchlistDraft keeps (buildDraft's keys.watchlist).
    expect(cleanWatchlistDraft(watchlist)).toEqual({ anilist: { access_token: 'synthetic-anilist-token', expires_at: 1_900_000_000_000, client_id: 'synthetic-client' } });
    // The shelf shows at once, and the draft Preview declares the rows.
    expect(userListServicesFrom({ watchlistDraft: watchlist }, null).anilist).toBe(true);
  });
});

describe('"Connected as" right after a connect', () => {
  const status = (simkl: { connected: boolean; username?: string }) => ({ simkl: { configured: true, ...simkl }, trakt: { connected: false, configured: true } });

  it('create mode: the popup\'s name from the draft, no save needed', () => {
    const draft = { simkl: { access_token: 'synthetic-simkl', username: 'neo' } };
    expect(accountIdentity('simkl', { precreation: true, draft, status: null, connected: true, changed: false })).toBe('neo');
    expect(accountIdentity('simkl', { precreation: true, draft: { simkl: { access_token: 'synthetic-simkl' } }, status: null, connected: true, changed: false, saved: 'x' })).toBe(null);
  });

  it('edit mode: the refreshed status carries the stored name, which wins over the config read', () => {
    expect(accountIdentity('simkl', { precreation: false, draft: null, status: status({ connected: true, username: 'fresh' }), connected: true, changed: true, saved: 'old' })).toBe('fresh');
    // Older connection, untouched on this page: the config read's name.
    expect(accountIdentity('simkl', { precreation: false, draft: null, status: status({ connected: true }), connected: true, changed: false, saved: 'old' })).toBe('old');
    // Reconnected here but no name came back: never another account's name.
    expect(accountIdentity('simkl', { precreation: false, draft: null, status: status({ connected: true }), connected: true, changed: true, saved: 'old' })).toBe(null);
    // Disconnected: no name.
    expect(accountIdentity('simkl', { precreation: false, draft: null, status: status({ connected: false, username: 'fresh' }), connected: false, changed: true, saved: 'old' })).toBe(null);
  });
});

describe('draft Preview declares connected list services', () => {
  it('adds simkl / anilist by name to the key services, never a token', () => {
    const source = tierPreviewSource({
      tier: 'partial', platform: 'nuvio', keys: { tmdbApiKey: 'synthetic-tmdb' },
      config: () => ({ lang: 'en-US' }),
      formatting: { preset: 'lelibrary', nameTemplate: '', descTemplate: '' }, badgePack: { pack: 'lelibrary-premium', url: '' }, posterStyle: '',
      connected: ['simkl', 'anilist'],
    });
    expect(source.draft.keyServices).toEqual(['anilist', 'simkl', 'tmdbApiKey']);
    expect(source.draft.config).toEqual({ lang: 'en-US' });
    expect(JSON.stringify(source)).not.toContain('synthetic-tmdb');
  });
});

describe('"Your lists" shelves follow the cards', () => {
  it('only for services the draft or saved setup has', () => {
    expect(userListServicesFrom({}, null)).toEqual({ simkl: false, mdblist: false, anilist: false, trakt: false });
    expect(userListServicesFrom({ mdblistKey: 'synthetic-mdb' }, null).mdblist).toBe(true);
    expect(userListServicesFrom({ savedServices: ['mdblistKey'] }, null).mdblist).toBe(true);
    // Edit mode: the page's one connections status (a connect on the card shows its shelf).
    const status = { simkl: { connected: true, configured: true }, trakt: { connected: false, configured: true, legacy: true } };
    expect(userListServicesFrom({}, status)).toMatchObject({ simkl: true, trakt: false });
  });
});

function connections(options: { connected?: WatchlistProvider[]; anilist?: boolean } = {}): WatchlistConnections {
  const connected = options.connected ?? [];
  const config = { simkl: true, trakt: true, anilist: options.anilist === true, traktLegacy: true };
  return {
    precreation: false,
    config,
    status: null,
    connected: (provider) => connected.includes(provider),
    linked: (provider) => connected.includes(provider),
    identity: (provider, saved) => (connected.includes(provider) ? saved ?? null : null),
    configured: (provider) => config[provider],
    canConnect: true,
    connect: async () => {},
    disconnect: async () => {},
  };
}
