import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The setup shell (top bar, step tabs, sidebar, footer) on every tier,
// create and edit, its checklist and finish gate, and the Home layout sheet.
// No network: every API call is a spy that never resolves.
const api = vi.hoisted(() => ({
  get: vi.fn(() => new Promise(() => {})),
  post: vi.fn(() => new Promise(() => {})), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
}));
vi.mock('@/api/client', () => ({ apiClient: api }));

const { TierShell, ShellSidebar } = await import('@/features/setup/shared/tier/TierShell');
const { HomeLayoutBox, layoutGroupsInOrder } = await import('@/features/setup/shared/tier/HomeLayoutSheet');
const model = await import('@/features/setup/shared/tier/shell-model');
const layout = await import('@/features/setup/shared/home-layout');
const { QuickSetupPage } = await import('@/features/setup/quick/QuickSetupPage');
const { PartialSetupPage, PARTIAL_SECTIONS } = await import('@/features/setup/partial/PartialSetupPage');
const { FullSetupPage, FULL_SECTIONS } = await import('@/features/setup/full/FullSetupPage');
const { emptySnapshot } = await import('@/features/setup/shared/edit-mode');
const { ownedFranchiseMarker } = await import('@/features/setup/shared/collection-doc');
type EditMode = import('@/features/setup/shared/edit-mode').EditMode;
type TierId = import('@/features/setup/shared/edit-mode').TierId;
type HomeRowDoc = import('@/features/setup/shared/collection-doc').HomeRowDoc;
type CollectionDoc = import('@/features/setup/shared/collection-doc').CollectionDoc;

function renderPage(node: ReactNode) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
    </MemoryRouter>,
  );
}

function editStub(tier: TierId, dirty: boolean): EditMode {
  return {
    uuid: '11111111-2222-3333-4444-555555555555', tier, editToken: 'edit-token', locked: false, nuvioCurrent: null,
    initial: { ...emptySnapshot(), name: 'Living room', keys: { torboxApiKey: 'synthetic-torbox', tmdbApiKey: 'synthetic-tmdb' } },
    dirty, savedServices: ['torboxApiKey', 'tmdbApiKey'],
    revealSaved: async () => null, onRemoveKey: () => {}, onSnapshot: () => {}, onSave: () => {}, saving: false,
    onSaveAndPush: null, pushTarget: 'Nuvio', pushing: false, onClearEdits: () => {}, savedAccount: null,
    onSavedProfile: () => {}, renderFinish: () => null, onPreview: () => {}, previewSource: { current: null },
  };
}

const row = (id: string, title: string, catalogId: string): HomeRowDoc => ({
  id, title, source: { kind: 'catalog', id: catalogId, catalogId, type: 'movie', addonId: '', addonUrl: '' },
  enabled: true, limit: 20, order: 0, customTitle: false,
});
const collection = (id: string, title: string): CollectionDoc => ({ id, title, folders: [] } as unknown as CollectionDoc);

const PAGES = { quick: QuickSetupPage, partial: PartialSetupPage, full: FullSetupPage } as const;

describe('the shell on every tier', () => {
  for (const tier of ['quick', 'partial', 'full'] as const) {
    it(`${tier}: creating renders the top bar, step tabs, sidebar and footer`, () => {
      const Page = PAGES[tier];
      const html = renderPage(<Page />);
      expect(html).toContain('class="ts-top"');
      expect(html).toContain('New setup');
      expect(html).toContain('class="ts-tabs"');
      expect(html).toContain('class="ts-foot"');
      expect(html).toContain('class="ts-side"');
      expect(html).toContain('>Draft<');
      const count = tier === 'quick' ? 4 : tier === 'partial' ? PARTIAL_SECTIONS.length : FULL_SECTIONS.length;
      expect(html.match(/class="qs-rail-step( |")/g)?.length ?? 0).toBe(count);
      expect(html).toContain(` · Step 1 of ${count}`);
      // The old chrome is gone: no dock, no inline wizard nav, no hero.
      for (const gone of ['qs-dock', 'qs-wizard-nav', 'qs-nav-next', 'qs-hero', 'qs-unsaved-save']) expect(html).not.toContain(gone);
      // Phone top bar: Preview always, Arrange home only where Home rows exist.
      expect(html).toContain('aria-label="Open preview"');
      if (tier === 'quick') expect(html).not.toContain('aria-label="Arrange home"');
      else expect(html).toContain('aria-label="Arrange home"');
    });

    it(`${tier}: editing shows Saved / Unsaved changes and Save in the footer`, () => {
      const Page = PAGES[tier];
      const clean = renderPage(<Page edit={editStub(tier, false)} />);
      expect(clean).toContain('>Saved<');
      expect(clean).toContain('Living room');
      expect(clean).not.toContain('class="ts-foot-ghost ts-save"');
      const dirty = renderPage(<Page edit={editStub(tier, true)} />);
      expect(dirty).toContain('Unsaved changes');
      expect(dirty).toContain('qs-unsaved');
      expect(dirty).toMatch(/class="ts-foot-ghost ts-save"[^>]*>Save<\/button>/);
      expect(dirty).toContain('Clear my edits');
    });
  }
});

describe('footer', () => {
  const steps = [{ id: 'a', label: 'Setup' }, { id: 'b', label: 'Home rows' }, { id: 'c', label: 'Protect' }];
  const shell = (active: number, extra: Partial<Parameters<typeof TierShell>[0]['footer']> = {}) => renderPage(
    <TierShell
      tierLabel="Settle In" name="" editing={false} steps={steps} active={active} onStep={() => {}}
      onPreview={() => {}} sidebar={null}
      footer={{ reset: { label: 'Start over', onClick: () => {} }, finish: { label: 'Create my setup', form: 'tier-install-form' }, ...extra }}
    >
      <p data-i18n-preserve>step body</p>
    </TierShell>,
  );

  it('names the next step next to Continue', () => {
    const html = shell(0);
    expect(html).toContain('Step 2: Home rows');
    expect(html).toContain('<span>Continue</span>');
    expect(html).not.toContain('Create my setup');
    // Phones: "Step 1 of 3: Setup" on the left, the next step on the right.
    expect(html).toContain('Step 1 of 3: Setup');
  });

  it('turns into the finish action on the last step, submitting the password form', () => {
    const html = shell(2);
    expect(html).not.toContain('<span>Continue</span>');
    expect(html).toMatch(/<button type="submit" form="tier-install-form" class="ts-foot-next ts-finish is-ready">/);
    expect(html).toContain('Create my setup');
    expect(html).toContain('aria-label="Previous step"');
  });

  it('shows why the finish is blocked and disables it', () => {
    const html = shell(2, { blocked: 'Add your TMDB key first' });
    expect(html).toContain('Add your TMDB key first');
    expect(html).toMatch(/class="ts-foot-next ts-finish" disabled=""/);
  });
});

describe('sidebar checklist', () => {
  it('TMDB missing: not complete, and the finish says why', () => {
    const state = { keys: { torboxApiKey: 'synthetic' } };
    const required = model.requiredChecks(state);
    expect(required.find((item) => item.id === 'provider')?.done).toBe(true);
    expect(required.find((item) => item.id === 'tmdb')?.done).toBe(false);
    expect(model.setupCompletion(required, model.optionalChecks('partial', state)).complete).toBe(false);
    expect(model.createBlocker(state, null)).toBe('Add your TMDB key first');
    expect(model.createBlocker({ keys: {} }, null)).toBe('Add a library provider first');
  });

  it('counts saved keys in edit mode and gates on the password last', () => {
    const state = { keys: {}, savedServices: ['rdApiKey', 'tmdbApiKey'] };
    const required = model.requiredChecks(state);
    expect(required.every((item) => item.done)).toBe(true);
    const completion = model.setupCompletion(required, model.optionalChecks('full', state));
    expect(completion.complete).toBe(true);
    expect(completion.percent).toBe(80);
    expect(model.createBlocker(state, { value: 'short', confirmation: 'short' })).toBe('Choose a password of 8 or more characters');
    expect(model.createBlocker(state, { value: 'long-enough', confirmation: 'different' })).toBe('Both passwords must match');
    expect(model.createBlocker(state, { value: 'long-enough', confirmation: 'long-enough' })).toBeNull();
  });

  it('lists the optional extras each tier offers, from the real state', () => {
    expect(model.optionalChecks('quick', { keys: {} }).map((item) => item.id)).toEqual(['tvdb', 'omdb']);
    const full = model.optionalChecks('full', { keys: { mdblistKey: 'synthetic' } }, ['simkl']);
    expect(full.map((item) => [item.id, item.done])).toEqual([['mdblist', true], ['tvdb', false], ['omdb', false], ['simkl', true], ['anilist', false]]);
    // Trakt only for setups that already have it.
    expect(model.optionalChecks('partial', { keys: {} }, ['trakt']).some((item) => item.id === 'trakt')).toBe(true);
  });

  it('renders checks, completion and the Arrange home row', () => {
    const state = { keys: { torboxApiKey: 'synthetic' } };
    const required = model.requiredChecks(state);
    const html = renderToStaticMarkup(
      <ShellSidebar
        status="draft" onPreview={() => {}} completion={model.setupCompletion(required, [])}
        required={required} optional={[]} arrange={{ count: 3, onOpen: () => {} }}
        catalog={[{ label: 'Home rows', value: '3' }]} preferences={model.preferenceFacts({ lang: 'es-ES', hideAnime: true, hideAdult: false })}
      />,
    );
    expect(html).toContain('Setup completion');
    // One of two required items, no optional ones: half way.
    expect(html).toContain('aria-valuenow="50"');
    expect(html).not.toContain('<h4>Optional</h4>');
    expect(html).toMatch(/<li class="is-done">.*Library provider/);
    expect(html).toContain('Arrange home');
    expect(html).toContain('3 items');
    expect(html).toContain('Español');
    expect(html).toContain('Hidden');
  });
});

describe('Home layout sheet', () => {
  const marker = { ...ownedFranchiseMarker(0, 1) };
  const rows: HomeRowDoc[] = [row('r1', 'My Movies', 'torbox-movies'), row('r2', 'Trending', 'torbox-trending-movies'), row('r3', 'Popular', 'torbox-popular-series'), marker];
  const cols = [collection('c1', 'Streaming'), collection('c2', 'Studios')];

  it('reorders Home rows in the shared list, keeping the marker last on Nuvio', () => {
    const next = layout.moveHomeLayoutRow(rows, 'nuvio', 0, 2);
    expect(next.map((item) => item.id)).toEqual(['r2', 'r3', 'r1', 'native-franchise-collection']);
    expect(next.map((item) => item.order)).toEqual([0, 1, 2, 3]);
    // The Home rows page shows the same order (same helper).
    expect(layout.homeLayoutRows(next, 'nuvio').map((item) => item.title)).toEqual(['Trending', 'Popular', 'My Movies']);
    expect(layout.moveHomeLayoutRow(rows, 'nuvio', 0, 9)).toBe(rows);
  });

  it('reorders collections with Movie Collections at its slot', () => {
    expect(layout.homeLayoutCollections(cols, rows, 'nuvio').map((item) => item.title)).toEqual(['Streaming', 'LeLibrary Movie Collections', 'Studios']);
    const moved = layout.moveHomeLayoutCollection(cols, rows, 'nuvio', 1, 0);
    expect(moved.collections.map((item) => item.id)).toEqual(['c1', 'c2']);
    expect(moved.rows.find((item) => item._nativeFranchiseCollection)?.collectionSlot).toBe(0);
    const swapped = layout.moveHomeLayoutCollection(cols, rows, 'nuvio', 2, 0);
    expect(swapped.collections.map((item) => item.id)).toEqual(['c2', 'c1']);
    expect(swapped.rows.find((item) => item._nativeFranchiseCollection)?.collectionSlot).toBe(2);
    expect(layout.homeLayoutCount(cols, rows, 'nuvio')).toBe(6);
  });

  it('keeps collections above rows, with type chips and up/down buttons', () => {
    const groups = layoutGroupsInOrder([
      { id: 'rows', items: layout.homeLayoutRowItems(rows, 'nuvio'), onMove: () => {} },
      { id: 'collections', items: layout.homeLayoutCollections(cols, rows, 'nuvio'), onMove: () => {} },
    ]);
    expect(groups.map((group) => group.id)).toEqual(['collections', 'rows']);
    const html = renderToStaticMarkup(<HomeLayoutBox groups={groups} onClose={() => {}} />);
    expect(html).toContain('Home layout');
    expect(html).toContain('Drag catalog rows and collections to set the order they appear on your Nuvio home screen.');
    expect(html.indexOf('Streaming')).toBeLessThan(html.indexOf('My Movies'));
    expect(html).toContain('hl-chip is-collection');
    expect(html).toContain('hl-chip is-library');
    expect(html).toContain('hl-chip is-row');
    expect(html).toContain('aria-label="Move Trending up"');
    expect(html).toContain('aria-label="Move Trending down"');
    expect(html).toContain('>Done</button>');
  });
});
