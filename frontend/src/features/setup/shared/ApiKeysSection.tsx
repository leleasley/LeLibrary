import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Accordion } from '@/features/setup/shared/Accordion';
import {
  KeyCardGrid,
  KeyCardTile,
  ProviderKeys,
  type KeyCardSpec,
  type RevealProps,
} from '@/features/setup/shared/sections';
import {
  METADATA_KEY_FIELDS,
  PROVIDER_KEY_FIELDS,
  type SetupKeysDraft,
} from '@/features/setup/shared/config-contract';
import {
  WATCHLIST_PROVIDER_NAMES,
  useWatchlistConnections,
  visibleConnectCards,
  type WatchlistConnections,
} from '@/features/setup/shared/connected-accounts';
import type { SetupIdentities, WatchlistDraftMap, WatchlistProvider } from '@/features/setup/resolver/api';
import type { EditMode } from '@/features/setup/shared/edit-mode';

// ── Metadata and list keys: the same cards as the library providers ──

const METADATA_CARDS: Partial<Record<keyof SetupKeysDraft, Pick<KeyCardSpec, 'name' | 'blurb' | 'logo' | 'monogram' | 'brand'>>> = {
  tmdbApiKey: { name: 'TMDB', blurb: 'Titles, posters, search and episode matching.', logo: '/logos/TMDB.svg', brand: '1, 180, 228' },
  tvdbApiKey: { name: 'TVDB', blurb: 'Optional. Sharper series matching.', logo: '/tvdb.png', brand: '108, 212, 145' },
  omdbKey: { name: 'OMDb', blurb: 'Optional. Extra ratings metadata.', monogram: 'OMDb', brand: '245, 197, 24' },
};

export const METADATA_CARD_SPECS: KeyCardSpec[] = METADATA_KEY_FIELDS.map(({ field, label, hint, required, placeholder, docsUrl }) => ({
  field,
  label,
  ...(METADATA_CARDS[field] ?? { name: label }),
  // Only the required key keeps its longer how-to line.
  ...(required ? { required: true, hint } : {}),
  ...(placeholder ? { placeholder } : {}),
  ...(docsUrl ? { docsUrl } : {}),
}));

export const MDBLIST_CARD_SPEC: KeyCardSpec = {
  field: 'mdblistKey',
  name: 'MDBList',
  label: 'MDBList API key',
  blurb: 'Ratings and your MDBList lists and watchlist.',
  logo: '/logos/mdblist.svg',
  brand: '66, 132, 202',
  docsUrl: 'https://mdblist.com/preferences/',
};

// The MDBList account name to show: what a verify in this session returned
// (null once the key changed, failed or was removed), else the name the
// saved setup reports. Pure for unit tests.
export function resolveMdblistIdentity(sessionName: string | null | undefined, savedName: string | null | undefined): string | null {
  if (sessionName !== undefined) return sessionName;
  return savedName ?? null;
}

// TMDB, TVDB, OMDb and (on Settle In / Move In) MDBList as key cards. Quick
// Look shows the first three.
export function MetadataKeyCards({ values, onChange, onRemove, savedServices, revealSaved, mdblist }: {
  values: SetupKeysDraft;
  onChange: (next: SetupKeysDraft) => void;
  onRemove?: ((field: keyof SetupKeysDraft) => void) | undefined;
  // Adds the MDBList card, with the account name to show and the setter a
  // verify reports to.
  mdblist?: { identity: string | null; onIdentity: (name: string | null) => void } | undefined;
} & RevealProps) {
  const specs = mdblist ? [...METADATA_CARD_SPECS, MDBLIST_CARD_SPEC] : METADATA_CARD_SPECS;
  return (
    <KeyCardGrid
      specs={specs} values={values} onChange={onChange} onRemove={onRemove}
      savedServices={savedServices} revealSaved={revealSaved}
      extras={mdblist ? {
        mdblistKey: {
          identity: mdblist.identity,
          onIdentity: mdblist.onIdentity,
          children: (
            <p className="setup-hint pc-note">Want what you watch on MDBList? In Nuvio open Settings, then MDBList, then Connect, and approve the code on mdblist.com. Nuvio then scrobbles for you. The key here only powers lists and ratings in LeLibrary.</p>
          ),
        },
      } : undefined}
    />
  );
}

// ── Connected accounts: connect cards in the same card frame ──

const CONNECT_CARDS: Record<WatchlistProvider, { blurb: string; logo?: string; monogram?: string; invert?: boolean; brand: string }> = {
  simkl: { blurb: 'Unlocks Up Next, Airing Next, Plan to Watch, Watching and Completed rows.', logo: '/logos/simkl.svg', invert: true, brand: '200, 200, 210' },
  anilist: { blurb: 'Optional. Adds your AniList anime lists (Watching, Plan to Watch, Completed) as rows.', logo: '/logos/anilist.svg', brand: '2, 169, 255' },
  trakt: { blurb: 'Sync your personal lists and watch history', logo: '/logos/trakt.svg', brand: '237, 34, 36' },
};

function ConnectCard({ provider, connected, identity, staged, defaultOpen, children }: {
  provider: WatchlistProvider;
  connected: boolean;
  identity?: string | null | undefined;
  // Edit page: a connect or disconnect waiting for Save.
  staged?: 'connect' | 'remove' | null | undefined;
  // An older setup's saved public AniList name (no login): `identity` is
  // that name and the line says so.
  // Tests only: every card starts closed for people.
  defaultOpen?: boolean | undefined;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen === true);
  const card = CONNECT_CARDS[provider];
  const name = WATCHLIST_PROVIDER_NAMES[provider];
  const toggle = () => setOpen((value) => !value);
  return (
    <div
      className={`provider-card connect-card${open ? ' is-open' : ''}${connected ? ' filled is-verified' : ''}`}
      style={{ '--pc-brand-rgb': card.brand } as CSSProperties}
      data-state={connected ? 'connected' : 'idle'}
      data-provider={provider}
      {...(staged ? { 'data-staged': staged } : {})}
    >
      <div
        className="pc-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
        }}
      >
        <KeyCardTile logo={card.logo} monogram={card.monogram} invert={card.invert} />
        <div className="pc-title">
          <strong data-i18n-preserve>{name}</strong>
          <small>{card.blurb}</small>
          {staged === 'remove'
            ? <small className="pc-identity">Disconnected · not saved yet</small>
            : staged === 'connect'
              ? <small className="pc-identity">{identity ? `Connected as ${identity} · not saved yet` : 'Connected · not saved yet'}</small>
              : identity && <small className="pc-identity">{`Connected as ${identity}`}</small>}
        </div>
        {connected && !identity && !staged && <span className="pc-pill is-verified">Connected</span>}
        <span className="pc-chevron" aria-hidden="true">▸</span>
      </div>
      {open && <div className="pc-body">{children}</div>}
    </div>
  );
}

// Connect / Disconnect with the state line above it.
function ConnectAction({ provider, connections, connected, unavailable, label }: {
  provider: WatchlistProvider;
  connections: WatchlistConnections;
  connected: boolean;
  unavailable: boolean;
  label?: string;
}) {
  const staged = connections.staged?.(provider) ?? null;
  if (staged === 'remove') {
    // Undo puts the saved connection back; Connect (where offered) signs in
    // again instead.
    return (
      <div className="pc-connect">
        <p className="setup-hint">Disconnected - removed when you save your changes.</p>
        <button type="button" className="setup-secondary" disabled={!connections.canConnect} onClick={() => connections.undo?.(provider)}>Undo</button>
        {!unavailable && provider !== 'trakt' && (
          <button type="button" className="setup-secondary" disabled={!connections.canConnect} onClick={() => void connections.connect(provider)}>{label ?? 'Connect'}</button>
        )}
      </div>
    );
  }
  return (
    <div className="pc-connect">
      <p className="setup-hint">
        {staged === 'connect'
          ? 'Connected - saved when you save your changes.'
          : unavailable
          ? 'Not configured on this server'
          : connections.precreation && connected
            ? 'Connected - seals into the setup when you create it.'
            : !connections.canConnect
              ? 'Unlock this setup to connect.'
              : connected ? 'Connected. Disconnect to stop the rows.' : 'Sign-in opens in a popup.'}
      </p>
      {connected ? (
        <button type="button" className="setup-secondary" disabled={!connections.canConnect} onClick={() => void connections.disconnect(provider)}>Disconnect</button>
      ) : (
        <button type="button" className="setup-secondary" disabled={unavailable || !connections.canConnect} onClick={() => void connections.connect(provider)}>{label ?? 'Connect'}</button>
      )}
    </div>
  );
}

export function ConnectedAccounts({ connections, identities, defaultOpen }: {
  connections: WatchlistConnections;
  // The config read's names (edit mode): the fallback for connections made
  // before names were stored with them.
  identities?: SetupIdentities | undefined;
  // Tests only: the one card rendered open.
  defaultOpen?: WatchlistProvider | undefined;
}) {
  const visible = visibleConnectCards(connections);
  return (
    <div className="provider-grid connect-grid">
      {visible.map((provider) => {
        const connected = connections.connected(provider);
        const identity = provider === 'trakt' ? null : connections.identity(provider, identities?.[provider]);
        const unavailable = !connected && connections.configured(provider) === false;
        const staged = connections.staged?.(provider) ?? null;
        return (
          <ConnectCard key={provider} provider={provider} connected={connected} staged={staged} identity={identity} defaultOpen={defaultOpen === provider}>
            {provider === 'trakt' && connections.config?.traktLegacy && (
              <p className="setup-hint">Kept for setups already connected. New setups cannot connect Trakt.</p>
            )}
            <ConnectAction
              provider={provider} connections={connections} connected={connected} unavailable={unavailable}
              {...(provider === 'anilist' ? { label: 'Connect AniList' } : {})}
            />
            {provider === 'anilist' && <p className="setup-hint pc-note">Not affiliated with AniList.</p>}
          </ConnectCard>
        );
      })}
    </div>
  );
}

// ── The accordion: library providers, metadata and lists, connected accounts ──

// The accordion's one-line state. Pure for unit tests.
export function apiKeysSummary(options: {
  keys: SetupKeysDraft;
  savedServices?: readonly string[] | undefined;
  mdblistName?: string | null | undefined;
}): string[] {
  const { keys, savedServices = [] } = options;
  const has = (field: keyof SetupKeysDraft) => Boolean((keys[field] ?? '').trim()) || savedServices.includes(field);
  const providers = PROVIDER_KEY_FIELDS.filter(({ field }) => (keys[field] ?? '').trim()).map(({ label }) => label.replace(/ API key$/, ''));
  const parts = [
    providers.length ? providers.join(' + ') : 'No library yet',
    has('tmdbApiKey') ? 'TMDB key added' : 'TMDB key needed',
  ];
  if (options.mdblistName && has('mdblistKey')) parts.push(`MDBList · ${options.mdblistName}`);
  else if (has('mdblistKey')) parts.push('MDBList key added');
  return parts;
}

// The Integrations accordion's one-line state: what is connected, with the
// account name when known ("Simkl · name"). Pure for unit tests.
export function integrationsSummary(options: {
  connected?: readonly WatchlistProvider[] | undefined;
  names?: Partial<Record<WatchlistProvider, string | null | undefined>> | undefined;
  // Edit page: connects and disconnects waiting for Save.
  staged?: Partial<Record<WatchlistProvider, 'connect' | 'remove' | null>> | undefined;
}): string[] {
  const parts: string[] = [];
  const connected = options.connected ?? [];
  for (const provider of ['simkl', 'anilist', 'trakt'] as const) {
    const name = (options.names?.[provider] ?? '').trim();
    const staged = options.staged?.[provider] ?? null;
    const label = WATCHLIST_PROVIDER_NAMES[provider];
    if (staged === 'remove') { parts.push(`${label} · disconnected, not saved yet`); continue; }
    if (!connected.includes(provider)) continue;
    if (staged === 'connect') parts.push(name ? `${label} · ${name} · not saved yet` : `${label} connected · not saved yet`);
    else parts.push(name ? `${label} · ${name}` : `${label} connected`);
  }
  return parts.length ? parts : ['Nothing connected'];
}

// The page's Simkl / AniList / Trakt connections: edit mode stages connects
// and disconnects for Save (the container holds them), create mode keeps
// the popup's tokens in the page's draft (memory only). One per page: the
// API keys cards and the "Your lists" shelves read the same state, so a
// connect shows its rows at once.
export function useSetupConnections(edit: EditMode | undefined, watchlist: WatchlistDraftMap, onWatchlist: (next: WatchlistDraftMap) => void): WatchlistConnections {
  return useWatchlistConnections(edit
    ? {
      uuid: edit.uuid, editToken: edit.editToken,
      ...(edit.onStageConnection ? { staged: edit.stagedConnections ?? {}, onStage: edit.onStageConnection, revision: edit.connectionsRevision ?? 0 } : {}),
    }
    : { uuid: null, editToken: null, draft: watchlist, onDraft: onWatchlist });
}

// Settle In and Move In's "API keys" accordion. `children` sits under the
// provider cards (Move In's catalogue organization).
export function ApiKeysAccordion({ keys, onKeys, edit, revealSaved, children }: {
  keys: SetupKeysDraft;
  onKeys: (next: SetupKeysDraft) => void;
  edit?: EditMode | undefined;
  revealSaved?: ((field: keyof SetupKeysDraft) => Promise<string | null>) | undefined;
  children?: ReactNode;
}) {
  // The MDBList name a verify returned this session (undefined: none yet).
  const [mdblistSession, setMdblistSession] = useState<string | null | undefined>(undefined);
  const mdblistName = resolveMdblistIdentity(mdblistSession, edit?.identities?.mdblist);
  const reveal = edit ? { savedServices: edit.savedServices, revealSaved, onRemove: edit.onRemoveKey } : {};
  const summary = apiKeysSummary({ keys, savedServices: edit?.savedServices, mdblistName });
  return (
    <Accordion title="API keys" icon="🔑" summary={summary}>
      <h3 className="qs-sub"><strong>Library providers</strong><span>Debrid</span></h3>
      <ProviderKeys values={keys} onChange={onKeys} {...reveal} />
      {children}
      <h3 className="qs-sub"><strong>Metadata and lists</strong><span>TMDB required</span></h3>
      <MetadataKeyCards
        values={keys} onChange={onKeys} {...reveal}
        mdblist={{ identity: mdblistName, onIdentity: setMdblistSession }}
      />
    </Accordion>
  );
}

// Settle In and Move In's "Integrations" accordion: the accounts that add
// personal rows (Simkl, AniList; Trakt only where it is already connected).
export function IntegrationsAccordion({ edit, connections }: {
  edit?: EditMode | undefined;
  // From useSetupConnections on the page.
  connections: WatchlistConnections;
}) {
  const providers = ['simkl', 'anilist', 'trakt'] as const;
  const summary = integrationsSummary({
    connected: providers.filter((provider) => connections.connected(provider)),
    names: {
      simkl: connections.identity('simkl', edit?.identities?.simkl),
      anilist: connections.identity('anilist', edit?.identities?.anilist),
    },
    staged: Object.fromEntries(providers.map((provider) => [provider, connections.staged?.(provider) ?? null])),
  });
  return (
    <Accordion title="Integrations" icon="🔗" summary={summary}>
      <p className="setup-hint qs-note">Optional. Connect an account to add its personal rows (Up Next, Watching, Plan to Watch and more) to Home rows and folders.</p>
      <ConnectedAccounts connections={connections} identities={edit?.identities} />
    </Accordion>
  );
}

// The Move In Ready page: connects for the setup just created.
export function ReadyConnections({ uuid, editToken }: { uuid: string; editToken: string | null }) {
  const connections = useWatchlistConnections({ uuid, editToken });
  return <ConnectedAccounts connections={connections} />;
}
