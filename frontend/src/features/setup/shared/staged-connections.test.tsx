import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Edit-page connects and disconnects are staged like every other edit (v6):
// the page holds a pending id + name (never a token), turns dirty, says
// "not saved yet", and the save body carries them. No network: every API
// call is a spy; ids and names are synthetic.
const api = vi.hoisted(() => ({
  get: vi.fn(() => new Promise(() => {})),
  post: vi.fn(() => new Promise(() => {})), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
}));
vi.mock('@/api/client', () => ({ apiClient: api }));

const { ConnectedAccounts, IntegrationsAccordion, integrationsSummary, useSetupConnections } = await import('@/features/setup/shared/ApiKeysSection');
const { editSaveBody, snapshotFromSaved, emptySnapshot, stageConnectionChange, stagedPendingIds } = await import('@/features/setup/shared/edit-mode');
const { effectiveWatchlistStatus, pendingFromPopup, visibleConnectCards } = await import('@/features/setup/shared/connected-accounts');
const { userListServicesFrom } = await import('@/features/setup/shared/user-lists');
type EditMode = import('@/features/setup/shared/edit-mode').EditMode;
type StagedConnections = import('@/features/setup/resolver/api').StagedConnections;
type WatchlistState = import('@/features/setup/resolver/api').WatchlistState;

const PENDING = 'synthetic-pending-id-0001';

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
    onStageConnection: () => {},
    ...overrides,
  };
}

function Harness({ edit }: { edit: EditMode }) {
  const connections = useSetupConnections(edit, {}, () => {});
  return (
    <>
      <IntegrationsAccordion edit={edit} connections={connections} />
      <ConnectedAccounts connections={connections} defaultOpen="simkl" />
    </>
  );
}

function bodyFor(connections: StagedConnections) {
  const saved = snapshotFromSaved({}, { tmdbApiKey: 'synthetic-tmdb' }, null);
  return editSaveBody({ current: saved, saved, savedName: null, savedTier: 'partial', tier: 'partial', providerServices: [], clearKeys: [], connections });
}

describe('staged connects make the page dirty and ride in the save', () => {
  it('nothing staged: nothing to save', () => {
    expect(bodyFor({})).toBeNull();
  });

  it('a connect sends its pending id only, a disconnect sends remove', () => {
    const body = bodyFor({ simkl: { pendingId: PENDING, username: 'lewis' }, trakt: { remove: true } });
    expect(body).toEqual({ connections: { simkl: { pendingId: PENDING }, trakt: { remove: true } } });
    expect(JSON.stringify(body)).not.toContain('lewis');
  });

  it('a newer connect replaces the earlier sign-in; undo and Clear my edits drop them', () => {
    const first = stageConnectionChange({}, 'simkl', { pendingId: PENDING, username: 'a' });
    expect(first.discard).toEqual([]);
    const second = stageConnectionChange(first.next, 'simkl', { pendingId: 'synthetic-pending-id-0002', username: 'b' });
    expect(second.discard).toEqual([PENDING]);
    const undone = stageConnectionChange(second.next, 'simkl', null);
    expect(undone.next).toEqual({});
    expect(undone.discard).toEqual(['synthetic-pending-id-0002']);
    expect(stagedPendingIds({ simkl: { pendingId: PENDING, username: null }, anilist: { remove: true } })).toEqual([PENDING]);
  });

  it('the edit page wires staging, Clear my edits and Save', () => {
    const page = readFileSync('src/features/setup/SetupEditPage.tsx', 'utf8');
    expect(page).toMatch(/connections: stagedConnections/);
    expect(page).toMatch(/function clearEdits\(\)[\s\S]*?discardStaged\(stagedPendingIds\(stagedConnections\)\)[\s\S]*?setStagedConnections\(\{\}\)/);
    expect(page).toMatch(/onStageConnection: stageConnection/);
  });
});

describe('the popup message', () => {
  it('reads a pending id and a name, never a token', () => {
    expect(pendingFromPopup({ lelibraryWatchlistPending: { provider: 'simkl', pendingId: PENDING, username: ' lewis ' } }))
      .toEqual({ provider: 'simkl', pendingId: PENDING, username: 'lewis' });
    expect(pendingFromPopup({ lelibraryWatchlistPending: { provider: 'mdblist', pendingId: PENDING } })).toBeNull();
    expect(pendingFromPopup({ lelibraryWatchlistPending: { provider: 'simkl', pendingId: 'x y' } })).toBeNull();
    expect(pendingFromPopup({ lelibraryWatchlistTokens: { provider: 'simkl' } })).toBeNull();
  });
});

describe('the staged state is what every reader sees', () => {
  const saved: WatchlistState = {
    simkl: { connected: false, configured: true },
    trakt: { connected: true, configured: true, legacy: true },
    anilist: { connected: false, configured: true },
  };

  it('connects show as connected with the name, disconnects as gone', () => {
    const next = effectiveWatchlistStatus(saved, { simkl: { pendingId: PENDING, username: 'lewis' }, trakt: { remove: true }, anilist: { remove: true } });
    expect(next?.simkl).toEqual({ connected: true, configured: true, username: 'lewis' });
    expect(next?.trakt.connected).toBe(false);
    expect(effectiveWatchlistStatus(saved, {})).toBe(saved);
    // The "Your lists" shelves (and the Preview's connected list) follow.
    expect(userListServicesFrom({}, next)).toMatchObject({ simkl: true, trakt: false, anilist: false });
  });

  it('a staged Trakt disconnect keeps its card (to undo it)', () => {
    const visible = visibleConnectCards({
      precreation: false, config: { simkl: true, trakt: true, anilist: true, traktLegacy: true }, status: saved,
      connected: () => false, staged: (provider) => (provider === 'trakt' ? 'remove' : null),
    });
    expect(visible).toContain('trakt');
  });

  it('cards and the summary say "not saved yet"', () => {
    const connect = render(<Harness edit={editMode({ stagedConnections: { simkl: { pendingId: PENDING, username: 'lewis' } } })} />);
    expect(connect).toContain('Connected as lewis · not saved yet');
    expect(connect).toContain('<span>Simkl · lewis · not saved yet</span>');
    expect(connect).toContain('Connected - saved when you save your changes.');
    expect(connect).toContain('data-staged="connect"');
    expect(connect).not.toContain(PENDING);

    const nameless = render(<Harness edit={editMode({ stagedConnections: { simkl: { pendingId: PENDING, username: null } } })} />);
    expect(nameless).toContain('Connected · not saved yet');
    expect(nameless).toContain('<span>Simkl connected · not saved yet</span>');

    const removed = render(<Harness edit={editMode({ stagedConnections: { simkl: { remove: true } } })} />);
    expect(removed).toContain('Disconnected · not saved yet');
    expect(removed).toContain('Disconnected - removed when you save your changes.');
    expect(removed).toContain('>Undo</button>');
    expect(removed).toContain('<span>Simkl · disconnected, not saved yet</span>');

    expect(integrationsSummary({ connected: [], staged: { anilist: 'remove' } })).toEqual(['AniList · disconnected, not saved yet']);
  });

  it('create mode and the Ready page are unchanged (no staging)', () => {
    const create = render(<Harness edit={undefined as unknown as EditMode} />);
    expect(create).not.toContain('not saved yet');
    const source = readFileSync('src/features/setup/shared/ApiKeysSection.tsx', 'utf8');
    expect(source).toMatch(/export function ReadyConnections[\s\S]*?useWatchlistConnections\(\{ uuid, editToken \}\)/);
  });
});
