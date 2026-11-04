import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { setupCopy } from '@/features/setup/shared/setup-copy';
import { FORMAT_SAMPLES } from '@/features/setup/shared/config-contract';
import { BadgeStrip, formatSample, type FormattingDraft } from '@/features/setup/shared/FormattingSection';
import { useBadgePreview } from '@/features/setup/shared/BadgePackPicker';
import { loadFormatter, useLegacyLib } from '@/features/setup/shared/legacy-libs';
import {
  GRID_LIMIT, enrich, findCollection, findFolder, folderTabs, initials, mergeSources, tmdbSized, typeLabel,
  type CatalogLoader, type CatalogRef, type MetaLoader, type PreviewAction, type PreviewFolder, type PreviewMeta,
  type PreviewMode, type PreviewRow, type PreviewScreen, type PreviewSourceMode, type RowState, type SampleReason,
  type SetupPreview,
} from '@/features/setup/preview/preview-model';

// Pieces every replica screen shares: poster cards, folder tiles, row
// states, and the screens a tap opens (a folder, a catalogue's "See all", an
// item's details). Read-only: nothing here pushes or saves.

// The page's current stream style, for the sample streams in details.
export interface PreviewStreamStyle {
  formatting: FormattingDraft;
  badgePack: { pack: string; url: string };
}

export interface PreviewContextValue {
  preview: SetupPreview;
  loader: CatalogLoader | null;
  metas: MetaLoader | null;
  go: (action: PreviewAction) => void;
  mode: PreviewMode;
  // Grid columns for folder and "See all" screens (by the stage's width).
  columns: number;
  // Where the data comes from (a draft shows samples for the library).
  source?: PreviewSourceMode | undefined;
  streams?: PreviewStreamStyle | null | undefined;
}

export const PreviewContext = createContext<PreviewContextValue | null>(null);

export function usePreview(): PreviewContextValue {
  const value = useContext(PreviewContext);
  if (!value) throw new Error('usePreview outside the preview');
  return value;
}

// The scroll container a screen scrolls in: lazy rows watch it, not the page.
export const ScrollRoot = createContext<HTMLElement | null>(null);

// Calls `onVisible` once the element nears its scroll container's view;
// without IntersectionObserver it calls it straight away.
export function useNearView<T extends HTMLElement>(onVisible: () => void, enabled: boolean) {
  const ref = useRef<T>(null);
  const root = useContext(ScrollRoot);
  const callback = useRef(onVisible);
  callback.current = onVisible;
  useEffect(() => {
    if (!enabled) return undefined;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') { callback.current(); return undefined; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); callback.current(); }
    }, { root, rootMargin: '320px 320px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, root]);
  return ref;
}

export function typeName(type: string): string {
  const label = typeLabel(type);
  return setupCopy(label, label);
}

// Nuvio's row title: "{catalogue} - {Type}"; a title the user typed stays as is.
export function rowTitle(row: Pick<PreviewRow, 'name' | 'type' | 'custom'>): string {
  return row.custom ? row.name : `${row.name} - ${typeName(row.type)}`;
}

// The "{catalogue} ({Type}) · {genre}" label of one folder source tab.
export function sourceLabel(source: { catalogName: string; type: string; genre: string }): string {
  const base = `${source.catalogName} (${typeName(source.type)})`;
  return source.genre ? `${base} · ${source.genre}` : base;
}

// A folder source as its own row: "{catalogue} - {Type}" (and its genre).
export function sourceRowTitle(source: { catalogName: string; type: string; genre: string }): string {
  const base = `${source.catalogName} - ${typeName(source.type)}`;
  return source.genre ? `${base} · ${source.genre}` : base;
}

// An image in a fixed box: the box holds its shape (and a shimmer) until the
// picture arrives, so nothing on the screen jumps.
export function Art({ src, className = '', eager = false }: { src: string; className?: string; eager?: boolean }) {
  // Keyed by link: a cached picture can finish before any effect runs.
  const [loaded, setLoaded] = useState('');
  const [broken, setBroken] = useState('');
  if (!src || broken === src) return <span className={`npv-art is-empty ${className}`} aria-hidden="true" />;
  return (
    <span className={`npv-art ${loaded === src ? 'is-ready' : 'is-loading'} ${className}`} aria-hidden="true">
      <img
        src={src} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" draggable={false}
        ref={(img) => { if (img?.complete && img.naturalWidth > 0 && loaded !== src) setLoaded(src); }}
        onLoad={() => setLoaded(src)} onError={() => setBroken(src)}
      />
    </span>
  );
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="npv-back" onClick={onClick} aria-label="Back">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
  );
}

export function Chevron() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>;
}

export interface CardFocus {
  tabIndex: number;
  'data-pos': string;
  className?: string;
  onFocus?: () => void;
  onMouseEnter?: () => void;
}

export function PosterCard({ meta, variant = 'row', focus }: { meta: PreviewMeta; variant?: 'row' | 'grid'; focus?: CardFocus }) {
  const { go } = usePreview();
  const { className: focusClass = '', ...focusProps } = focus ?? {};
  return (
    <button
      type="button" className={`npv-card is-${variant} ${focusClass}`.trim()} title={meta.name}
      onClick={() => go({ type: 'details', meta })} {...focusProps}
    >
      <Art src={tmdbSized(meta.poster, 'w342')} className="npv-poster" />
      <span className="npv-card-title" data-i18n-preserve>{meta.name}</span>
      {meta.year && <span className="npv-card-year" data-i18n-preserve>{meta.year}</span>}
    </button>
  );
}

export function FolderTile({ collectionId, folder, focus, animate }: { collectionId: string; folder: PreviewFolder; focus?: CardFocus; animate: boolean }) {
  const { go } = usePreview();
  const { className: focusClass = '', ...focusProps } = focus ?? {};
  const art = (animate && folder.focusGif) || folder.cover;
  return (
    <button
      type="button" className={`npv-tile is-${folder.shape.toLowerCase()} ${focusClass}`.trim()} title={folder.title}
      onClick={() => go({ type: 'folder', collectionId, folderId: folder.id })} {...focusProps}
    >
      <span className="npv-tile-art">
        {art ? <Art src={art} className="npv-tile-img" /> : <span className="npv-tile-letters" data-i18n-preserve>{initials(folder.title)}</span>}
        {!animate && folder.focusGif && <Art src={folder.focusGif} className="npv-tile-gif" />}
      </span>
      {!folder.hideTitle && <span className="npv-card-title" data-i18n-preserve>{folder.title}</span>}
    </button>
  );
}

export function SkeletonCards({ count = 6, shape = 'poster' }: { count?: number; shape?: 'poster' | 'landscape' | 'square' }) {
  return (
    <>
      {Array.from({ length: count }, (_, n) => (
        <span key={n} className={`npv-card is-skeleton is-${shape}`} aria-hidden="true">
          <span className="npv-art is-loading npv-poster" />
          <span className="npv-skel-line" />
          <span className="npv-skel-line is-short" />
        </span>
      ))}
    </>
  );
}

export function EmptyNote({ children }: { children?: ReactNode }) {
  return <p className="npv-note">{children ?? 'Nothing here yet'}</p>;
}

export function ErrorNote({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="npv-note is-error">
      <span>This row did not load.</span>
      <button type="button" className="npv-chip-btn" onClick={onRetry}>Try again</button>
    </div>
  );
}

export function ExternalNote() {
  return <p className="npv-note">From another addon: your player loads it, the preview cannot.</p>;
}

function sampleText(reason: SampleReason): string {
  if (reason === 'key') return 'This list needs your MDBList key. It shows here once the setup is created.';
  if (reason === 'unavailable') return 'This row shows here once the setup is created.';
  return 'Your library shows here once the setup is created.';
}

// The hero of a draft whose hero rows are the library.
export function SampleHero({ height, className = 'npv-hero' }: { height?: number; className?: string }) {
  return (
    <section className={`${className} is-sample`} style={height ? { height } : undefined} aria-label="Featured">
      <span className="npv-art is-sample npv-sample-hero-art" aria-hidden="true" />
      <div className="npv-hero-content npv-sample-hero-text">
        <p className="npv-sample-note">Your library shows here once the setup is created.</p>
      </div>
    </section>
  );
}

export function FranchiseNote() {
  const { source } = usePreview();
  return (
    <EmptyNote>
      {source === 'draft'
        ? 'Movie Collections appears here once the setup is created and your library is built.'
        : 'Movie Collections appears here once your library has finished building.'}
    </EmptyNote>
  );
}

// A row the draft cannot fill yet: quiet placeholder tiles in the row's
// shape with one line saying when the real titles appear.
export function SampleRow({ reason, count = 6, shape = 'poster' }: { reason: SampleReason; count?: number; shape?: 'poster' | 'landscape' | 'square' }) {
  return (
    <div className="npv-sample">
      <div className="npv-strip" aria-hidden="true">
        {Array.from({ length: count }, (_, n) => (
          <span key={n} className={`npv-card is-sample is-${shape}`}>
            <span className="npv-art npv-poster is-sample" />
            <span className="npv-skel-line" />
          </span>
        ))}
      </div>
      <p className="npv-sample-note">{sampleText(reason)}</p>
    </div>
  );
}

// Loads a catalogue when its row nears the view and returns its state.
export function useCatalog(ref: CatalogRef | null, eager = false) {
  const { loader } = usePreview();
  const near = useNearView<HTMLDivElement>(() => { if (ref) loader?.load(ref); }, Boolean(loader && ref) && !eager);
  const key = ref ? `${ref.type}|${ref.catalogId}|${ref.genre ?? ''}` : '';
  useEffect(() => {
    if (eager && ref) loader?.load(ref);
    // `key` stands for `ref` (a new object every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eager, loader, key]);
  const state: RowState | undefined = ref && loader ? loader.get(ref) : undefined;
  return { near, state, retry: () => { if (ref) loader?.retry(ref); } };
}

function Grid({ metas, loading }: { metas: PreviewMeta[]; loading: boolean }) {
  const { columns } = usePreview();
  return (
    <div className="npv-grid" style={{ ['--npv-cols' as string]: String(columns) }}>
      {loading ? <SkeletonCards count={columns * 3} /> : metas.map((meta) => <PosterCard key={meta.id} meta={meta} variant="grid" />)}
    </div>
  );
}

export function GridState({ state, retry }: { state: RowState | undefined; retry: () => void }) {
  if (!state || state.status === 'loading') return <Grid metas={[]} loading />;
  if (state.status === 'error') return <ErrorNote onRetry={retry} />;
  if (state.status === 'sample') return <SampleRow reason={state.reason} />;
  if (!state.metas.length) return <EmptyNote />;
  return <Grid metas={state.metas} loading={false} />;
}

// The "All" tab: every source of the folder, merged.
function AllSources({ folder }: { folder: PreviewFolder }) {
  const { loader } = usePreview();
  const own = folder.sources.filter((source) => !source.external);
  const refs = own.map((source) => ({ type: source.type, catalogId: source.catalogId, genre: source.genre }));
  const key = refs.map((ref) => `${ref.type}|${ref.catalogId}|${ref.genre}`).join(',');
  useEffect(() => {
    for (const ref of refs) loader?.load(ref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader, key]);
  if (!own.length) return <ExternalNote />;
  const states = refs.map((ref) => loader?.get(ref));
  const ready = states.filter((state): state is Extract<RowState, { status: 'ready' }> => state?.status === 'ready');
  if (!ready.length && states.some((state) => !state || state.status === 'loading')) return <Grid metas={[]} loading />;
  const sample = states.find((state): state is Extract<RowState, { status: 'sample' }> => state?.status === 'sample');
  if (!ready.length && sample) return <SampleRow reason={sample.reason} />;
  if (!ready.length) return <ErrorNote onRetry={() => { for (const ref of refs) loader?.retry(ref); }} />;
  const metas = mergeSources(ready.map((state) => state.metas), GRID_LIMIT);
  return metas.length ? <Grid metas={metas} loading={false} /> : <EmptyNote />;
}

function SourceGrid({ source }: { source: PreviewFolder['sources'][number] }) {
  const { state, retry } = useCatalog({ type: source.type, catalogId: source.catalogId, genre: source.genre }, true);
  if (source.external) return <ExternalNote />;
  return <GridState state={state} retry={retry} />;
}

export function FolderScreen({ screen }: { screen: Extract<PreviewScreen, { at: 'folder' }> }) {
  const { preview, go } = usePreview();
  const collection = findCollection(preview, screen.collectionId);
  const folder = findFolder(preview, screen.collectionId, screen.folderId);
  if (!folder) return <EmptyNote />;
  const tabs = folderTabs(folder);
  const tab = Math.min(screen.tab, tabs.sources.length - (tabs.all ? 0 : 1));
  const source = tabs.all ? (tab === 0 ? null : tabs.sources[tab - 1]) : tabs.sources[0];
  const cover = folder.cover || collection?.backdrop || '';
  return (
    <div className="npv-folder">
      <div className="npv-folder-cover">
        {cover ? <Art src={tmdbSized(cover, 'w1280')} eager /> : <span className="npv-art is-empty" aria-hidden="true" />}
      </div>
      <header className="npv-screen-head">
        <BackButton onClick={() => go({ type: 'back' })} />
        <h2 data-i18n-preserve>{folder.title}</h2>
      </header>
      {tabs.all && (
        <div className="npv-tabs" role="tablist" aria-label="Folder sources">
          <button type="button" role="tab" aria-selected={tab === 0} className={tab === 0 ? 'is-active' : ''} onClick={() => go({ type: 'tab', tab: 0 })}>
            All
          </button>
          {tabs.sources.map((item, n) => (
            <button
              key={`${item.catalogId}-${item.genre}-${n}`} type="button" role="tab" aria-selected={tab === n + 1}
              className={tab === n + 1 ? 'is-active' : ''} onClick={() => go({ type: 'tab', tab: n + 1 })}
            >
              <span data-i18n-preserve>{sourceLabel(item)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="npv-folder-body">
        {!tabs.sources.length ? <EmptyNote /> : source ? <SourceGrid key={`${source.catalogId}|${source.genre}`} source={source} /> : <AllSources folder={folder} />}
      </div>
    </div>
  );
}

export function CatalogScreen({ screen }: { screen: Extract<PreviewScreen, { at: 'catalog' }> }) {
  const { preview, go } = usePreview();
  const { state, retry } = useCatalog({ type: screen.row.type, catalogId: screen.row.catalogId, genre: screen.row.genre }, true);
  return (
    <div className="npv-catalog">
      <header className="npv-catalog-head">
        <BackButton onClick={() => go({ type: 'back' })} />
        <h2 data-i18n-preserve>{screen.row.name}</h2>
        <p data-i18n-preserve>{preview.addonName ? `${typeName(screen.row.type)} · ${preview.addonName}` : typeName(screen.row.type)}</p>
      </header>
      <div className="npv-catalog-body">
        <GridState state={state} retry={retry} />
      </div>
    </div>
  );
}

// An item's details, as a sheet over the screen it was opened from. Play is
// shown but switched off: the preview never plays or saves anything.
export function DetailsSheet({ screen }: { screen: Extract<PreviewScreen, { at: 'details' }> }) {
  const { metas, go } = usePreview();
  const base = screen.meta;
  useEffect(() => { metas?.load(base); }, [metas, base]);
  const meta = enrich(base, metas?.get(base));
  const art = meta.background ? tmdbSized(meta.background, 'w1280') : tmdbSized(meta.poster, 'w780');
  const facts = [typeName(meta.type), meta.genres[0] ?? '', meta.year].filter(Boolean);
  return (
    <div className="npv-details">
      <div className="npv-details-art">
        <Art src={art} eager />
        <span className="npv-details-scrim" aria-hidden="true" />
      </div>
      <header className="npv-details-top">
        <BackButton onClick={() => go({ type: 'back' })} />
      </header>
      <div className="npv-details-body">
        {meta.logo
          ? <img className="npv-details-logo" src={tmdbSized(meta.logo, 'w500')} alt={meta.name} data-i18n-preserve />
          : <h2 className="npv-details-title" data-i18n-preserve>{meta.name}</h2>}
        {facts.length > 0 && (
          <p className="npv-meta-line" data-i18n-preserve>
            {facts.map((fact, n) => <span key={`${fact}-${n}`}>{fact}</span>)}
          </p>
        )}
        <div className="npv-details-actions">
          <button type="button" className="npv-pill is-play" disabled aria-disabled="true">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            <span>Play</span>
          </button>
          <span className="npv-details-hint">Playback is not available in the preview.</span>
        </div>
        {meta.description && <p className="npv-details-desc" data-i18n-preserve>{meta.description}</p>}
        <SampleStreams type={meta.type} />
      </div>
    </div>
  );
}

// The samples a details sheet lists: a series opens on the episode file.
export function streamSamples(type: string, count = 3) {
  const series = FORMAT_SAMPLES.filter((sample) => /S\d{2}E\d{2}/i.test(sample.filename));
  const films = FORMAT_SAMPLES.filter((sample) => !series.includes(sample));
  return (type === 'series' ? [...series, ...films] : [...films, ...series]).slice(0, count);
}

// Nuvio's stream list under the details, drawn with the page's CURRENT
// stream style and badge pack through the same formatter the server uses.
// Clearly samples: never fetched, never playable.
export function SampleStreams({ type }: { type: string }) {
  const { streams } = usePreview();
  const formatter = useLegacyLib(loadFormatter);
  const formatting = streams?.formatting;
  // One pack lookup for the whole list.
  const badges = useBadgePreview(streams?.badgePack.pack ?? '', streams?.badgePack.url ?? '');
  const rendered = useMemo(() => {
    if (!formatter || !formatting) return [];
    return streamSamples(type).map((sample) => formatSample(formatter, formatting, sample)).filter((row): row is { name: string; description: string } => row !== null);
  }, [formatter, formatting, type]);
  if (!streams) return null;
  return (
    <section className="npv-streams" aria-label="Sample streams">
      <header className="npv-streams-head">
        <h3>Streams</h3>
        <span className="npv-streams-tag">Sample streams</span>
      </header>
      <p className="npv-streams-note">Shown in your stream style. Not real files: nothing here plays.</p>
      {!formatter ? (
        <div className="npv-stream is-loading" aria-hidden="true"><span className="npv-skel-line is-title" /><span className="npv-skel-line" /></div>
      ) : rendered.length === 0 ? (
        <p className="npv-note">Choose a stream style to see your streams here.</p>
      ) : (
        <ul className="npv-stream-list">
          {rendered.map((row, n) => (
            <li key={n} className="npv-stream" aria-disabled="true">
              <span className="npv-stream-name" data-i18n-preserve>{row.name}</span>
              <span className="npv-stream-desc" data-i18n-preserve>{row.description}</span>
              <BadgeStrip state={badges} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// One screen of the stack, in its own scroll container.
export function Layer({ children, className = '', top, onScroll }: { children: ReactNode; className?: string; top: boolean; onScroll?: (scrollTop: number) => void }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  return (
    <div
      ref={setRoot} className={`npv-layer ${className}`.trim()} aria-hidden={top ? undefined : true} inert={!top}
      onScroll={onScroll ? (event) => onScroll(event.currentTarget.scrollTop) : undefined}
    >
      <ScrollRoot.Provider value={root}>{children}</ScrollRoot.Provider>
    </div>
  );
}

// The screens above Home (folder, See all, details), each over the last.
export function StackScreens({ stack }: { stack: PreviewScreen[] }) {
  return (
    <>
      {stack.slice(1).map((screen, n) => {
        const top = n === stack.length - 2;
        const key = `${n}-${screen.at}`;
        if (screen.at === 'folder') return <Layer key={key} top={top} className="is-screen"><FolderScreen screen={screen} /></Layer>;
        if (screen.at === 'catalog') return <Layer key={key} top={top} className="is-screen"><CatalogScreen screen={screen} /></Layer>;
        if (screen.at === 'details') return <Layer key={key} top={top} className="is-sheet"><DetailsSheet screen={screen} /></Layer>;
        return null;
      })}
    </>
  );
}
