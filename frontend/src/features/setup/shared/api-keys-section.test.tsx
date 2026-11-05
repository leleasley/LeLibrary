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
  ApiKeysAccordion, ConnectedAccounts, IntegrationsAccordion, MetadataKeyCards, apiKeysSummary, integrationsSummary, resolveMdblistIdentity, useSetupConnections,
} = await import('@/features/setup/shared/ApiKeysSection');
const { KeyCard } = await import('@/features/setup/shared/sections');
const { pruneConfig } = await import('@/features/setup/shared/config-contract');
const { editSaveBody, snapshotFromSaved, emptySnapshot } = await import('@/features/setup/shared/edit-mode');
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
type IntegrationsProps = Parameters<typeof IntegrationsAccordion>[0];

function accordion(props: Partial<AccordionProps> = {}) {
  return render(<ApiKeysAccordion keys={{}} onKeys={() => {}} {...props} />);
}

// The page owns the connections (useSetupConnections); the harness does too.
function IntegrationsHarness(props: Partial<IntegrationsProps>) {
  const live = useSetupConnections(props.edit, {}, () => {});
  return (
    <IntegrationsAccordion
      {...props}
      connections={props.connections ?? live}
    />
  );
}

function integrations(props: Partial<IntegrationsProps> = {}) {
  return render(<IntegrationsHarness {...props} />);
}

function connections(options: {
  connected?: WatchlistProvider[];
  traktLegacy?: boolean;
  anilist?: boolean;
  precreation?: boolean;
  // Account names the hook knows (popup or stored at connect time).
  names?: Partial<Record<WatchlistProvider, string>>;
  // An older setup's saved public AniList name.
  publicUser?: string;
} = {}): WatchlistConnections {
  const connected = options.connected ?? [];
  const config = { simkl: true, trakt: true, anilist: options.anilist === true, traktLegacy: options.traktLegacy === true };
  const isConnected = (provider: WatchlistProvider) => connected.includes(provider);
  return {
    precreation: options.precreation ?? true,
    config,
    status: null,
    connected: isConnected,
    linked: (provider) => isConnected(provider) || (provider === 'anilist' && Boolean(options.publicUser)),
    identity: (provider, saved) => (isConnected(provider) ? options.names?.[provider] ?? saved ?? null : null),
    publicUser: () => options.publicUser ?? null,
    configured: (provider) => config[provider],
    canConnect: true,
    connect: async () => {},
    disconnect: async () => {},
  };
}

describe('API keys accordion', () => {
  it('holds the library providers and the metadata and list keys on the same card', () => {
    const html = accordion();
    expect(html).toContain('<strong>API keys</strong>');
    const groups = ['Library providers', 'Metadata and lists'];
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
    // Accounts live in their own Integrations section now.
    expect(html).not.toContain('Connected accounts');
    expect(html).not.toContain('data-provider="simkl"');
    // TMDB is a card like the rest: closed, with a switch, marked Required.
    expect(html).toContain('aria-label="Use TMDB"');
    expect(html).toContain('pc-pill is-warn');
    expect(html).not.toContain('is-open');
    for (const old of ['qs-key', 'qs-meta', 'key-card-list', 'meta-key', 'integration-card']) expect(html).not.toContain(old);
  });

  it('summarises providers, TMDB and MDBList', () => {
    expect(accordion()).toContain('<span>No library yet</span><span>TMDB key needed</span>');
    expect(apiKeysSummary({ keys: { torboxApiKey: 'a', rdApiKey: 'b', tmdbApiKey: 'c', mdblistKey: 'd' }, mdblistName: 'lewis' }))
      .toEqual(['TorBox + Real-Debrid', 'TMDB key added', 'MDBList · lewis']);
    expect(apiKeysSummary({ keys: {}, savedServices: ['tmdbApiKey', 'mdblistKey'] }))
      .toEqual(['No library yet', 'TMDB key added', 'MDBList key added']);
  });

  it('is on both Settle In and Move In, followed by Integrations', () => {
    for (const page of [<PartialSetupPage />, <FullSetupPage />]) {
      const html = render(page);
      const keys = html.indexOf('<strong>API keys</strong>');
      const integ = html.indexOf('<strong>Integrations</strong>');
      expect(keys).toBeGreaterThan(-1);
      expect(integ).toBeGreaterThan(keys);
    }
  });
});

describe('Integrations accordion', () => {
  it('holds Simkl and AniList and says what is connected', () => {
    const html = integrations({ connections: connections({ connected: ['simkl'], anilist: true }) });
    expect(html).toContain('<strong>Integrations</strong>');
    expect(html).toContain('data-provider="simkl"');
    expect(html).toContain('data-provider="anilist"');
    expect(html).toContain('<span>Simkl connected</span>');
    expect(integrationsSummary({ connected: [], anilistPublic: 'lewis_1' })).toEqual(['AniList · lewis_1']);
    expect(integrationsSummary({})).toEqual(['Nothing connected']);
  });

  it('names the accounts once known', () => {
    expect(integrationsSummary({ connected: ['simkl', 'anilist'], names: { simkl: 'lewis', anilist: null } }))
      .toEqual(['Simkl · lewis', 'AniList connected']);
    const html = integrations({ connections: connections({ connected: ['simkl'], names: { simkl: 'lewis' } }) });
    expect(html).toContain('<span>Simkl · lewis</span>');
    expect(html).toContain('Connected as lewis');
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
      <KeyCard spec={{ field: 'mdblistKey', name: 'MDBList', label: 'MDBList API key' }} value="" onChange={() => {}} onClear={() => {}} defaultOpen>
        <p className="pc-note" data-i18n-preserve>Scrobble note</p>
      </KeyCard>,
    );
    expect(html).toContain('MDBList API key');
    expect(html).toContain('Scrobble note');
  });
});

describe('connected accounts', () => {
  it('hides Trakt for new setups once the server marks it legacy', () => {
    const html = render(<ConnectedAccounts connections={connections({ traktLegacy: true })} />);
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

  it('shows the name the connect returned, with no save or reload (create and edit)', () => {
    // Create mode: the popup's name rides in the draft next to the token.
    const created = render(<ConnectedAccounts connections={connections({ connected: ['simkl', 'anilist'], names: { simkl: 'lewis', anilist: 'Neo_99' } })} />);
    expect(created).toContain('Connected as lewis');
    expect(created).toContain('Connected as Neo_99');
    // Edit mode: the stored name wins over the config read's older identity.
    const edited = render(<ConnectedAccounts connections={connections({ connected: ['simkl'], precreation: false, names: { simkl: 'fresh' } })} identities={{ simkl: 'old' }} />);
    expect(edited).toContain('Connected as fresh');
    expect(edited).not.toContain('Connected as old');
    // No name known: the plain pill.
    const plain = render(<ConnectedAccounts connections={connections({ connected: ['simkl'] })} />);
    expect(plain).toContain('pc-pill is-verified">Connected</span>');
  });

  it('AniList is Connect-only: no username field', () => {
    const html = render(<ConnectedAccounts connections={connections({ anilist: true })} defaultOpen="anilist" />);
    expect(html).toContain('data-provider="anilist"');
    expect(html).toContain('Connect AniList');
    expect(html).toContain('Not affiliated with AniList.');
    for (const gone of ['AniList username', 'Your public AniList name', '2 to 20 letters', 'Username added', 'Public lists only', '<input']) {
      expect(html, gone).not.toContain(gone);
    }
    // Without an AniList app on the server there is nothing to offer.
    expect(render(<ConnectedAccounts connections={connections({ anilist: false })} />)).not.toContain('data-provider="anilist"');
  });

  it('an older setup\'s saved AniList name shows as public lists, with Connect and Disconnect', () => {
    const html = render(<ConnectedAccounts connections={connections({ anilist: true, precreation: false, publicUser: 'lewis_99' })} defaultOpen="anilist" />);
    expect(html).toContain('Connected as lewis_99 (public lists)');
    expect(html).toContain('data-state="public"');
    expect(html).toContain('Connect AniList');
    expect(html).toContain('>Disconnect</button>');
    // Shown even where the server has no AniList app (Disconnect only).
    const noApp = render(<ConnectedAccounts connections={connections({ anilist: false, precreation: false, publicUser: 'lewis_99' })} defaultOpen="anilist" />);
    expect(noApp).toContain('Connected as lewis_99 (public lists)');
    expect(noApp).not.toContain('>Connect AniList</button>');
    expect(noApp).toContain('>Disconnect</button>');
  });
});

describe('anilistUser is no longer written by the pages', () => {
  it('create drops it, edit neither reads nor saves it (the server keeps a saved one)', () => {
    expect(pruneConfig({ anilistUser: 'lewis_99' } as Record<string, unknown>)).toEqual({});
    const saved = snapshotFromSaved({ anilistUser: 'lewis_99' }, {}, null);
    expect('anilistUser' in saved.meta).toBe(false);
    expect(editSaveBody({
      current: saved, saved, savedName: null, savedTier: 'partial', tier: 'partial', providerServices: [], clearKeys: [],
    })).toBe(null);
    expect(emptySnapshot().meta).not.toHaveProperty('anilistUser');
  });

  it('leaves no AniList username plumbing in the pages', () => {
    const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const file of ['partial/PartialSetupPage.tsx', 'full/FullSetupPage.tsx', 'shared/edit-save.ts', 'shared/edit-mode.ts', 'shared/saved-config.ts', 'full/MetadataExtras.tsx', 'shared/ApiKeysSection.tsx']) {
      expect(read(file), file).not.toMatch(/anilistUser/);
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
