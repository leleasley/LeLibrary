import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The "API keys" section: library providers, metadata and lists, connected
// accounts, all on the one key card. No network: every API call is a spy.
const api = vi.hoisted(() => ({
  get: vi.fn(() => new Promise(() => {})),
  post: vi.fn(() => new Promise(() => {})), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
}));
vi.mock('@/api/client', () => ({ apiClient: api }));

const {
  ApiKeysAccordion, ConnectedAccounts, MetadataKeyCards, apiKeysSummary, resolveMdblistIdentity, useSetupConnections,
} = await import('@/features/setup/shared/ApiKeysSection');
const { KeyCard } = await import('@/features/setup/shared/sections');
const { anilistUserForConfig, isValidAnilistUser, pruneConfig } = await import('@/features/setup/shared/config-contract');
const { editSaveBody, emptySnapshot, snapshotFromSaved } = await import('@/features/setup/shared/edit-mode');
const { EMPTY_METADATA_EXTRAS } = await import('@/features/setup/full/MetadataExtras');
const { PartialSetupPage } = await import('@/features/setup/partial/PartialSetupPage');
const { FullSetupPage } = await import('@/features/setup/full/FullSetupPage');
type EditMode = import('@/features/setup/shared/edit-mode').EditMode;
type WatchlistConnections = import('@/features/setup/shared/connected-accounts').WatchlistConnections;
type WatchlistProvider = import('@/features/setup/resolver/api').WatchlistProvider;

function render(node: ReactNode) {
  return renderToStaticMarkup(
    <MemoryRouter><QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider></MemoryRouter>,
  );
}

function editMode(overrides: Partial<EditMode> = {}): EditMode {
  return {
    uuid: '11111111-2222-3333-4444-555555555555', tier: 'partial', editToken: 'synthetic-edit', locked: false,
    initial: emptySnapshot(), dirty: false, savedServices: [],
    revealSaved: async () => null, onRemoveKey: () => {}, onSnapshot: () => {}, onSave: () => {}, saving: false,
    onSaveAndPush: null, pushTarget: 'Nuvio', pushing: false, onClearEdits: () => {},
    savedAccount: null, onSavedProfile: () => {}, renderFinish: () => null,
    ...overrides,
  };
}

type AccordionProps = Parameters<typeof ApiKeysAccordion>[0];

// The page owns the connections (useSetupConnections); the harness does too.
function AccordionHarness(props: Partial<AccordionProps>) {
  const live = useSetupConnections(props.edit, {}, () => {});
  return (
    <ApiKeysAccordion
      keys={{}} onKeys={() => {}} anilistUser="" onAnilistUser={() => {}}
      {...props}
      connections={props.connections ?? live}
    />
  );
}

function accordion(props: Partial<AccordionProps> = {}) {
  return render(<AccordionHarness {...props} />);
}

function connections(options: {
  connected?: WatchlistProvider[];
  traktLegacy?: boolean;
  anilist?: boolean;
  precreation?: boolean;
} = {}): WatchlistConnections {
  const connected = options.connected ?? [];
  const config = { simkl: true, trakt: true, anilist: options.anilist === true, traktLegacy: options.traktLegacy === true };
  return {
    precreation: options.precreation ?? true,
    config,
    status: null,
    connected: (provider) => connected.includes(provider),
    configured: (provider) => config[provider],
    canConnect: true,
    connect: async () => {},
    disconnect: async () => {},
  };
}

describe('API keys accordion', () => {
  it('replaces Integrations with three groups of the same card', () => {
    const html = accordion();
    expect(html).toContain('<strong>API keys</strong>');
    expect(html).not.toContain('Integrations');
    const groups = ['Library providers', 'Metadata and lists', 'Connected accounts'];
    let cursor = -1;
    for (const group of groups) {
      const at = html.indexOf(`<strong>${group}</strong>`);
      expect(at, group).toBeGreaterThan(cursor);
      cursor = at;
    }
    // Every service sits on the provider card frame, library and metadata alike.
    for (const field of ['torboxApiKey', 'tmdbApiKey', 'tvdbApiKey', 'omdbKey', 'mdblistKey']) {
      expect(html).toContain(`data-field="${field}"`);
    }
    expect(html).toContain('data-provider="simkl"');
    expect(html).toContain('data-provider="anilist"');
    // Old layouts are gone.
    for (const old of ['qs-key', 'qs-meta', 'key-card-list', 'meta-key', 'integration-card']) expect(html).not.toContain(old);
  });

  it('summarises providers, TMDB, MDBList and connected accounts', () => {
    expect(accordion()).toContain('<span>No library yet</span><span>TMDB key needed</span>');
    expect(apiKeysSummary({ keys: { torboxApiKey: 'a', rdApiKey: 'b', tmdbApiKey: 'c', mdblistKey: 'd' }, mdblistName: 'lewis', connected: ['simkl'] }))
      .toEqual(['TorBox + Real-Debrid', 'TMDB key added', 'MDBList · lewis', 'Simkl connected']);
    expect(apiKeysSummary({ keys: {}, savedServices: ['tmdbApiKey', 'mdblistKey'], anilistUser: 'lewis_1' }))
      .toEqual(['No library yet', 'TMDB key added', 'MDBList key added', 'AniList · lewis_1']);
  });

  it('is on both Settle In and Move In, and nothing else says Integrations', () => {
    for (const page of [<PartialSetupPage />, <FullSetupPage />]) {
      const html = render(page);
      expect(html).toContain('<strong>API keys</strong>');
      expect(html).not.toContain('<strong>Integrations</strong>');
    }
  });
});

describe('MDBList card', () => {
  it('reads "Connected as" from a verify, else from the saved setup', () => {
    // A verify this session wins; a changed or failed key (null) forgets it.
    expect(resolveMdblistIdentity('lewis', 'saved-name')).toBe('lewis');
    expect(resolveMdblistIdentity(null, 'saved-name')).toBe(null);
    expect(resolveMdblistIdentity(undefined, 'saved-name')).toBe('saved-name');
    expect(resolveMdblistIdentity(undefined, undefined)).toBe(null);
  });

  it('shows the account name on the card once known', () => {
    const html = render(
      <MetadataKeyCards values={{ mdblistKey: 'synthetic' }} onChange={() => {}} mdblist={{ identity: 'lewis', onIdentity: () => {} }} />,
    );
    expect(html).toContain('Connected as lewis');
    expect(html).toContain('Ratings and your MDBList lists and watchlist.');
  });

  it('takes the name from the edit summary identities', () => {
    const html = accordion({ edit: editMode({ savedServices: ['mdblistKey'], identities: { mdblist: 'lewis' } }) });
    expect(html).toContain('Connected as lewis');
    expect(html).toContain('<span>MDBList · lewis</span>');
  });

  it('keeps the Nuvio scrobbling hint inside the open card', () => {
    // Static render: cards start closed, so open the one card directly.
    const html = render(
      <KeyCard spec={{ field: 'mdblistKey', name: 'MDBList', label: 'MDBList API key', required: true }} value="" onChange={() => {}} onClear={() => {}}>
        <p className="pc-note" data-i18n-preserve>Scrobble note</p>
      </KeyCard>,
    );
    expect(html).toContain('MDBList API key');
    expect(html).toContain('Scrobble note');
  });
});

describe('connected accounts', () => {
  it('hides Trakt for new setups once the server marks it legacy', () => {
    const html = render(<ConnectedAccounts connections={connections({ traktLegacy: true })} anilistUser={{ value: '', onChange: () => {} }} />);
    expect(html).not.toContain('data-provider="trakt"');
    expect(html).toContain('data-provider="simkl"');
  });

  it('keeps Trakt for a setup that is already connected', () => {
    const html = render(<ConnectedAccounts connections={connections({ traktLegacy: true, connected: ['trakt'], precreation: false })} />);
    expect(html).toContain('data-provider="trakt"');
  });

  it('shows Simkl as "Connected as" from the edit summary', () => {
    const html = render(<ConnectedAccounts connections={connections({ connected: ['simkl'], precreation: false })} identities={{ simkl: 'lewis' }} />);
    expect(html).toContain('Connected as lewis');
    expect(html).toContain('Unlocks Up Next, Airing Next, Plan to Watch, Watching and Completed rows.');
  });

  it('validates the AniList username inline', () => {
    const open = (value: string, anilist = false) => render(
      <ConnectedAccounts connections={connections({ anilist })} anilistUser={{ value, onChange: () => {} }} defaultOpen="anilist" />,
    );
    expect(open('x')).toContain('2 to 20 letters, numbers or underscores.');
    expect(open('bad name!')).toContain('aria-invalid="true"');
    const ok = open('lewis_99');
    expect(ok).not.toContain('2 to 20 letters');
    expect(ok).toContain('Username added');
    expect(ok).toContain('Not affiliated with AniList.');
    // The private-list connect only where the server has an AniList app.
    expect(ok).not.toContain('Connect AniList');
    expect(open('lewis_99', true)).toContain('Connect AniList');
  });

  it('accepts only real AniList usernames', () => {
    for (const name of ['ab', 'Lewis_99', 'a'.repeat(20)]) expect(isValidAnilistUser(name), name).toBe(true);
    for (const name of ['', 'a', 'a'.repeat(21), 'bad name', 'lewis!', 'é_name']) expect(isValidAnilistUser(name), name).toBe(false);
    expect(anilistUserForConfig('  lewis  ')).toBe('lewis');
    expect(anilistUserForConfig('no way')).toBe('');
  });
});

describe('anilistUser round-trips', () => {
  it('is written by create and read back by edit', () => {
    expect(pruneConfig({ anilistUser: 'lewis_99' })).toEqual({ anilistUser: 'lewis_99' });
    expect(pruneConfig({ anilistUser: 'not valid' })).toEqual({});
    expect(snapshotFromSaved({ anilistUser: 'lewis_99' }, {}, null).meta.anilistUser).toBe('lewis_99');
  });

  it('saves only the username when only it changed', () => {
    const saved = snapshotFromSaved({}, {}, null);
    const body = (anilistUser: string, from = saved) => editSaveBody({
      current: { ...from, meta: { ...from.meta, anilistUser } }, saved: from,
      savedName: null, savedTier: 'partial', tier: 'partial', providerServices: [], clearKeys: [],
    });
    expect(body('lewis_99')).toEqual({ config: { anilistUser: 'lewis_99' } });
    // Half-typed: nothing to save yet, the saved name stays.
    expect(body('le wis')).toBe(null);
    const withName = snapshotFromSaved({ anilistUser: 'lewis_99' }, {}, null);
    expect(body('', withName)).toEqual({ clearConfig: ['anilistUser'] });
  });

  it('persists in the Settle In draft (not a secret)', async () => {
    const store: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    };
    try {
      const { savePartialDraft, loadPartialDraft, clearPartialDraft } = await import('@/features/setup/partial/partial-draft');
      const { snapshotToPartialDraft } = await import('@/features/setup/shared/edit-mode');
      const draft = snapshotToPartialDraft(emptySnapshot());
      savePartialDraft({ ...draft, meta: { ...EMPTY_METADATA_EXTRAS, anilistUser: 'lewis_99' } });
      expect(Object.values(store).join('')).toContain('"anilistUser":"lewis_99"');
      expect(loadPartialDraft()?.meta.anilistUser).toBe('lewis_99');
      clearPartialDraft();
    } finally {
      delete (globalThis as any).localStorage;
    }
  });
});

describe('old key layouts are gone', () => {
  const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  it('leaves no TierMetadata, ListKey or integration-card behind', () => {
    for (const file of ['shared/sections.tsx', 'shared/tier/TierPickers.tsx', 'partial/PartialSetupPage.tsx', 'full/FullSetupPage.tsx', 'quick/QuickSetupPage.tsx', 'full/ReviewStep.tsx']) {
      const source = read(file);
      expect(source, file).not.toMatch(/TierMetadata|ListKey|integration-card|MetadataWatchlists|WatchlistSection/);
    }
    expect(read('setup.css')).not.toMatch(/\.integration-card|\.meta-key|\.key-card-list/);
    expect(read('shared/tier/tier.css')).not.toMatch(/\.qs-key|\.qs-meta/);
  });

  it('gives Quick Look the shared cards for TMDB, TVDB and OMDb (no MDBList)', () => {
    expect(read('quick/QuickSetupPage.tsx')).toContain('<MetadataKeyCards');
    expect(read('quick/QuickSetupPage.tsx')).not.toContain('mdblist=');
  });
});
