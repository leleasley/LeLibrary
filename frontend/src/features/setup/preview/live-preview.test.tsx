import { describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The one live Preview: the setup shell opens it on every tier, its data source
// follows create / saved / unsaved edits, drafts never carry a key, and the
// details sheet lists sample streams in the page's current style. No
// network: every API call is a spy and the formatter is a stand-in that
// shows which templates it was given.
const api = vi.hoisted(() => ({
  get: vi.fn(() => new Promise(() => {})),
  post: vi.fn(() => new Promise(() => {})), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
}));
vi.mock('@/api/client', () => ({ apiClient: api }));
vi.mock('@/features/setup/shared/legacy-libs', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/features/setup/shared/legacy-libs')>();
  const formatter = {
    presets: { lelibrary: { name: 'LL {name}', description: 'LL desc' } },
    formatStream: (name: string, desc: string, filename: string) => ({ name: `${name} @ ${filename}`, description: `${desc} :: ${filename}` }),
  };
  return { ...real, useLegacyLib: (loader: unknown) => (loader === real.loadFormatter ? formatter : null) };
});

const { PreviewModal } = await import('@/features/setup/preview/PreviewModal');
const model = await import('@/features/setup/preview/preview-model');
const { tierPreviewSource } = await import('@/features/setup/shared/tier/TierPreview');
const { ShellSidebar } = await import('@/features/setup/shared/tier/TierShell');
const { QuickSetupPage } = await import('@/features/setup/quick/QuickSetupPage');
const { PartialSetupPage } = await import('@/features/setup/partial/PartialSetupPage');
const { FullSetupPage } = await import('@/features/setup/full/FullSetupPage');
const { editPreviewSource } = await import('@/features/setup/SetupEditPage');
const { emptySnapshot } = await import('@/features/setup/shared/edit-mode');
type EditMode = import('@/features/setup/shared/edit-mode').EditMode;
type TierId = import('@/features/setup/shared/edit-mode').TierId;

const UUID = '11111111-2222-3333-4444-555555555555';
const TOKEN = `${UUID}.synthetic-secret`;
const KEYS = { torboxApiKey: 'synthetic-torbox-key', tmdbApiKey: 'synthetic-tmdb-key' };

const PREVIEW: import('@/features/setup/preview/preview-model').SetupPreview = {
  platform: 'nuvio', addonName: 'LeLibrary', collections: [], franchisePending: true,
  hero: [{ key: 'a:movie:torbox-movies', type: 'movie', catalogId: 'torbox-movies', name: 'My Movies' }],
  home: [
    { kind: 'row', key: 'a:movie:torbox-movies', type: 'movie', catalogId: 'torbox-movies', name: 'My Movies' },
    { kind: 'row', key: 'a:movie:torbox-trending-movies', type: 'movie', catalogId: 'torbox-trending-movies', name: 'Trending' },
  ],
};

const sampleLoader: import('@/features/setup/preview/preview-model').CatalogLoader = {
  get: (ref) => (ref.catalogId === 'torbox-movies'
    ? { status: 'sample', reason: 'library' }
    : { status: 'ready', total: 1, metas: [{ id: 'tt1', type: 'movie', name: 'Film', poster: 'https://image.tmdb.org/t/p/w500/a.jpg', background: '', logo: '', year: '2024', genres: [], description: '' }] }),
  load: () => {}, retry: () => {}, subscribe: () => () => {},
};
const noMetas = { get: () => undefined, load: () => {}, subscribe: () => () => {} };

function renderPage(node: ReactNode) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
    </MemoryRouter>,
  );
}

function editStub(tier: TierId, onPreview: () => void): EditMode {
  return {
    uuid: UUID, tier, editToken: 'edit-token', locked: false, nuvioCurrent: null,
    initial: { ...emptySnapshot(), keys: { ...KEYS } }, dirty: true, savedServices: ['torboxApiKey', 'tmdbApiKey'],
    revealSaved: async () => null, onRemoveKey: () => {}, onSnapshot: () => {}, onSave: () => {}, saving: false,
    onSaveAndPush: null, pushTarget: 'Nuvio', pushing: false, onClearEdits: () => {}, savedAccount: null,
    onSavedProfile: () => {}, renderFinish: () => null, onPreview, previewSource: { current: null },
  };
}

// Finds elements in a rendered element tree (ShellSidebar has no hooks).
function findAll(node: ReactNode, match: (el: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>>[] {
  const out: ReactElement<Record<string, unknown>>[] = [];
  const walk = (child: ReactNode) => {
    if (Array.isArray(child)) { child.forEach(walk); return; }
    if (!isValidElement(child)) return;
    const el = child as ReactElement<Record<string, unknown>>;
    if (match(el)) out.push(el);
    walk(el.props['children'] as ReactNode);
  };
  walk(node);
  return out;
}

const PAGES = { quick: QuickSetupPage, partial: PartialSetupPage, full: FullSetupPage } as const;

describe('one Preview on every tier', () => {
  it('the sidebar Open preview button opens the Preview', () => {
    const onPreview = vi.fn();
    const side = ShellSidebar({ status: 'draft', onPreview, completion: { percent: 0, complete: false }, required: [], optional: [] });
    const buttons = findAll(side, (el) => el.type === 'button' && String(el.props['className']).includes('ts-live-btn'));
    expect(buttons).toHaveLength(1);
    (buttons[0]?.props['onClick'] as () => void)();
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  for (const tier of ['quick', 'partial', 'full'] as const) {
    it(`${tier}: creating, the shell opens the live Preview; the old panel and dock are gone`, () => {
      const Page = PAGES[tier];
      const closed = renderPage(<Page />);
      expect(closed).toContain('ts-live-btn');
      expect(closed).toContain('aria-label="Open preview"');
      expect(closed).not.toContain('qs-dock');
      expect(closed).not.toContain('<dialog');
      for (const gone of ['qs-aside', 'qs-panel', 'qs-sheet', 'YOUR LIBRARY PREVIEW']) expect(closed).not.toContain(gone);
      const open = renderPage(<Page previewOpen />);
      expect(open).toContain('class="npv-dialog');
      expect(open).toContain('Live preview of this setup');
    });

    it(`${tier}: editing, the shell asks the edit page, which reads the page's draft`, () => {
      const Page = PAGES[tier];
      const onPreview = vi.fn();
      const edit = editStub(tier, onPreview);
      const html = renderPage(<Page edit={edit} previewOpen />);
      expect(html).toContain('ts-live-btn');
      expect(html).not.toContain('<dialog');
      const source = edit.previewSource?.current?.();
      expect(source?.draft.tier).toBe(tier);
      expect(source?.draft.keyServices).toEqual(['tmdbApiKey', 'torboxApiKey']);
      expect(JSON.stringify(source)).not.toContain('synthetic');
    });
  }
});

describe('data source', () => {
  it('create = draft, edit with nothing unsaved = saved, edit with unsaved changes = edited', () => {
    expect(model.previewSourceMode({ saved: false, dirty: false, hasDraft: true })).toBe('draft');
    expect(model.previewSourceMode({ saved: false, dirty: true, hasDraft: true })).toBe('draft');
    expect(model.previewSourceMode({ saved: true, dirty: false, hasDraft: true })).toBe('saved');
    expect(model.previewSourceMode({ saved: true, dirty: true, hasDraft: true })).toBe('edited');
    expect(model.previewSourceMode({ saved: true, dirty: true, hasDraft: false })).toBe('saved');
  });

  const render = (props: Partial<Parameters<typeof PreviewModal>[0]>) => renderToStaticMarkup(
    <PreviewModal
      open onClose={() => {}} savedPlatform="nuvio" loader={sampleLoader} metaLoader={noMetas}
      initial={{ mode: 'mobile', previews: { nuvio: PREVIEW }, size: { width: 1280, height: 900 } }}
      {...props}
    />,
  );
  const draft = { tier: 'partial' as const, config: { lang: 'en-US' }, keyServices: ['tmdbApiKey'] };

  it('creating: the live draft, library rows as samples, a poster-style note', () => {
    const html = render({ draft, posterStyle: 'rpdb' });
    expect(html).toContain('Live preview of this setup');
    expect(html).toContain('Your library shows here once the setup is created.');
    expect(html).toContain('Posters show in your style once saved.');
    expect(html).toContain('Movie Collections appears here once the setup is created');
    expect(html).not.toContain('Posters need your install link.');
    expect(render({ draft, posterStyle: '' })).not.toContain('Posters show in your style once saved.');
  });

  it('editing: saved when clean, "unsaved changes" when dirty', () => {
    const saved = { uuid: UUID, editToken: 'edit-token', installToken: TOKEN };
    expect(render({ saved, draft, dirty: false })).toContain('Preview of your saved setup');
    const dirty = render({ saved, draft, dirty: true });
    expect(dirty).toContain('Showing your unsaved changes.');
    expect(dirty).not.toContain('Preview of your saved setup');
    expect(dirty).not.toContain('synthetic-secret');
  });

  it('the Nuvio wordmark image on Nuvio screens, plain text on Stremio', () => {
    expect(render({ draft })).toMatch(/<img class="npv-wordmark-img" src="\/preview\/nuvio-wordmark.png" alt="Nuvio"/);
    const stremio = render({ draft, initial: { mode: 'stremio', previews: { stremio: { ...PREVIEW, platform: 'stremio' } }, size: { width: 1280, height: 900 } } });
    expect(stremio).toContain('>Stremio</span>');
    expect(stremio).not.toContain('nuvio-wordmark.png');
  });

  it('draft rows: own catalogues through the draft endpoint, the library through the install link when editing', async () => {
    const post = vi.fn(async (body: unknown) => ((body as { catalogId: string }).catalogId === 'torbox-movies'
      ? { sample: true, reason: 'library' }
      : { metas: [{ id: 'tt9', type: 'movie', name: 'Nine', poster: 'https://image.tmdb.org/t/p/w500/9.jpg' }] }));
    const fetchJson = vi.fn(async () => ({ metas: [{ id: 'torbox:movie:1', type: 'movie', name: 'Mine', poster: 'https://image.tmdb.org/t/p/w500/m.jpg' }] }));
    const config = { lang: 'de-DE', hideAnime: true, nuvioCollectionPacks: ['p1'], tmdbApiKey: 'synthetic-tmdb-key', collections: [{ id: 'c' }] };

    const create = model.createDraftCatalogLoader(config, { post, fetchJson });
    create.load({ type: 'movie', catalogId: 'torbox-movies' });
    create.load({ type: 'movie', catalogId: 'torbox-trending-movies' });
    await vi.waitFor(() => expect(create.get({ type: 'movie', catalogId: 'torbox-trending-movies' })?.status).toBe('ready'));
    await vi.waitFor(() => expect(create.get({ type: 'movie', catalogId: 'torbox-movies' })).toEqual({ status: 'sample', reason: 'library' }));
    expect(fetchJson).not.toHaveBeenCalled();
    // Only what the endpoint needs, never a key.
    expect(post.mock.calls[0]?.[0]).toEqual({ config: { lang: 'de-DE', hideAnime: true, nuvioCollectionPacks: ['p1'] }, type: 'movie', catalogId: 'torbox-movies' });

    const edited = model.createDraftCatalogLoader(config, { post, fetchJson, installToken: TOKEN });
    edited.load({ type: 'movie', catalogId: 'torbox-movies' });
    await vi.waitFor(() => expect(edited.get({ type: 'movie', catalogId: 'torbox-movies' })?.status).toBe('ready'));
    expect(fetchJson).toHaveBeenCalledWith(model.catalogUrl(TOKEN, { type: 'movie', catalogId: 'torbox-movies' }));
  });

  it('personal list rows: a labelled sample in a draft, the real row through the install link when editing', async () => {
    const ref = { type: 'series' as const, catalogId: 'lelibrary-user-simkl-upnext-series' };
    const post = vi.fn(async () => ({ sample: true, reason: 'personal', service: 'simkl', label: 'Your Simkl rows show here once the setup is saved' }));
    const fetchJson = vi.fn(async () => ({ metas: [{ id: 'tt7', type: 'series', name: 'Seven', poster: 'https://image.tmdb.org/t/p/w500/7.jpg' }] }));
    const create = model.createDraftCatalogLoader({}, { post, fetchJson });
    create.load(ref);
    await vi.waitFor(() => expect(create.get(ref)).toEqual({ status: 'sample', reason: 'personal', label: 'Your Simkl rows show here once the setup is saved' }));
    expect(fetchJson).not.toHaveBeenCalled();
    const edited = model.createDraftCatalogLoader({}, { post, fetchJson, installToken: TOKEN });
    edited.load(ref);
    await vi.waitFor(() => expect(edited.get(ref)?.status).toBe('ready'));
    expect(fetchJson).toHaveBeenCalledWith(model.catalogUrl(TOKEN, ref));
  });
});

describe('drafts never carry a secret', () => {
  it('strips keys, logins, links and internals at any depth; keys only as allowlisted names', () => {
    const config = model.draftRequestConfig({
      lang: 'en-US', torboxApiKey: 'synthetic-1', __configScope: { uuid: UUID }, push: { nuvio: { nuvioToken: 'synthetic-2' } },
      pictoriumUrl: 'https://p.test/synthetic-3', customStreams: [{ url: 'synthetic-4' }], webdavPassword: 'synthetic-5',
      collections: [{ id: 'c', folders: [{ id: 'f', catalogSources: [{ addonId: 'x', addonUrl: 'https://x.test/synthetic-6/manifest.json', catalogId: 'top' }] }] }],
    });
    expect(JSON.stringify(config)).not.toMatch(/synthetic|configScope/);
    expect(config['lang']).toBe('en-US');
    expect(model.draftKeyServices({ torboxApiKey: 'k', rdApiKey: '  ', push: 'x', webdavPassword: 'y' }, ['tmdbApiKey', 'customAddon1'], ['tmdbApiKey']))
      .toEqual(['torboxApiKey']);
    const body = model.draftBody({ tier: 'full', config: { lang: 'en-US', tmdbApiKey: 'synthetic-7' }, keyServices: ['tmdbApiKey', 'evil'] }, 'nuvio');
    expect(body).toEqual({ tier: 'full', platform: 'nuvio', config: { lang: 'en-US' }, keyServices: ['tmdbApiKey'] });
  });

  it('a page draft is built from the create config and key names only', () => {
    const source = tierPreviewSource({
      tier: 'quick', platform: 'nuvio', keys: { ...KEYS, rdApiKey: '' },
      config: () => ({ provider: 'torbox', lang: 'en-US', tmdbApiKey: 'synthetic-leak' }),
      formatting: { preset: 'lelibrary', nameTemplate: '', descTemplate: '' }, badgePack: { pack: 'lelibrary-premium', url: '' }, posterStyle: '',
    });
    expect(source.draft).toEqual({ tier: 'quick', config: { provider: 'torbox', lang: 'en-US' }, keyServices: ['tmdbApiKey', 'torboxApiKey'] });
    // A key marked for removal on the edit page no longer counts.
    expect(editPreviewSource(source, ['torboxApiKey'])?.draft.keyServices).toEqual(['tmdbApiKey']);
    expect(editPreviewSource(null, [])).toBeNull();
  });
});

describe('details sheet streams', () => {
  it('lists sample streams in the page\'s current style, clearly samples, never playable', () => {
    const meta = { id: 'tt1', type: 'series', name: 'Show', poster: 'https://image.tmdb.org/t/p/w500/s.jpg', background: '', logo: '', year: '2024', genres: [], description: '' };
    const html = renderToStaticMarkup(
      <PreviewModal
        open onClose={() => {}} savedPlatform="nuvio" loader={sampleLoader} metaLoader={noMetas}
        draft={{ tier: 'quick', config: {}, keyServices: [] }}
        streams={{ formatting: { preset: 'custom', nameTemplate: 'MINE {res}', descTemplate: 'DESC {size}' }, badgePack: { pack: 'lelibrary-premium', url: '' } }}
        initial={{ mode: 'mobile', previews: { nuvio: PREVIEW }, stack: model.previewNav([{ at: 'home' }], { type: 'details', meta }), size: { width: 1280, height: 900 } }}
      />,
    );
    expect(html).toContain('aria-label="Sample streams"');
    expect(html).toContain('Shown in your stream style. Not real files: nothing here plays.');
    const names = [...html.matchAll(/class="npv-stream-name"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(names.length).toBe(3);
    expect(names.every((name) => name?.startsWith('MINE {res} @ '))).toBe(true);
    expect(names[0]).toMatch(/S\d{2}E\d{2}/); // a series opens on the episode file
    expect(html).toContain('DESC {size} :: ');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toMatch(/<a [^>]*href=[^>]*npv-stream/);
  });
});
