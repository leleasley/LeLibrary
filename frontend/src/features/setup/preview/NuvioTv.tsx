import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { setupCopy } from '@/features/setup/shared/setup-copy';
import {
  ROW_LIMIT, enrich, moveFocus, rowHasMore, tmdbSized,
  type FocusPos, type PreviewCollection, type PreviewFolder, type PreviewHomeEntry, type PreviewMeta, type PreviewRow,
  type PreviewScreen, type SetupPreview,
} from '@/features/setup/preview/preview-model';
import {
  Art, Chevron, EmptyNote, ErrorNote, ExternalNote, FolderTile, FranchiseNote, Layer, PosterCard, SampleHero, SampleRow,
  SkeletonCards, StackScreens, typeName, useCatalog, usePreview, type CardFocus,
} from '@/features/setup/preview/PreviewScreens';

// Nuvio TV's Home ("Modern" layout): an icon sidebar, a hero that shows the
// focused card (not a carousel), and rows below it. Arrow keys move the focus
// within and between rows (one focusable card at a time), hovering focuses
// too, Enter opens. Drawn at 1280x720 and scaled to fit by the modal.

export const TV_WIDTH = 1280;
export const TV_HEIGHT = 720;
const HERO_DEBOUNCE_MS = 450;

type Focused = { kind: 'meta'; meta: PreviewMeta } | { kind: 'folder'; folder: PreviewFolder; collection: PreviewCollection } | null;

export function visibleEntries(preview: SetupPreview): PreviewHomeEntry[] {
  const byId = new Map(preview.collections.map((item) => [item.id, item]));
  return preview.home.filter((entry) => entry.kind === 'row' || (byId.get(entry.id)?.folders.length ?? 0) > 0);
}

const SIDEBAR = [
  { id: 'home', label: 'Home', icon: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" /> },
  { id: 'discover', label: 'Discover', icon: <><circle cx="12" cy="12" r="8.5" /><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z" /></> },
  { id: 'search', label: 'Search', icon: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></> },
  { id: 'library', label: 'Library', icon: <><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M6.5 5h11" /></> },
  { id: 'settings', label: 'Settings', icon: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></> },
] as const;

function Sidebar() {
  return (
    <nav className="npv-tv-side" aria-label="Nuvio">
      {SIDEBAR.map((item) => (
        <span key={item.id} className={`npv-tv-side-item${item.id === 'home' ? ' is-active' : ''}`} title={item.label} aria-current={item.id === 'home' ? 'page' : undefined}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{item.icon}</svg>
        </span>
      ))}
    </nav>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return out;
}

function TvHero({ shown, sample }: { shown: Focused; sample: boolean }) {
  if (!shown && sample) return <SampleHero className="npv-tv-hero" />;
  if (!shown) return <div className="npv-tv-hero is-loading"><span className="npv-art is-loading npv-tv-backdrop" aria-hidden="true" /></div>;
  if (shown.kind === 'folder') {
    const art = shown.collection.backdrop || shown.folder.cover;
    // A folder with no art of its own would leave the hero empty: show the
    // first title of the first hero row behind it instead.
    if (!art) return <FolderFallbackHero />;
    return (
      <div className="npv-tv-hero">
        <Art src={tmdbSized(art, 'w1280')} className="npv-tv-backdrop" eager />
        <span className="npv-tv-scrim" aria-hidden="true" />
        <div className="npv-tv-hero-text">
          <h2 className="npv-tv-title" data-i18n-preserve>{shown.folder.title}</h2>
          <p className="npv-meta-line" data-i18n-preserve><span>{shown.collection.title}</span></p>
        </div>
      </div>
    );
  }
  return <MetaHero meta={shown.meta} />;
}

function FolderFallbackHero() {
  const { preview } = usePreview();
  const source = preview.hero[0];
  const { state } = useCatalog(source ? { type: source.type, catalogId: source.catalogId } : null, true);
  const first = state?.status === 'ready' ? state.metas[0] : undefined;
  if (state?.status === 'sample') return <SampleHero className="npv-tv-hero" />;
  if (!first) return <div className="npv-tv-hero is-loading"><span className="npv-art is-loading npv-tv-backdrop" aria-hidden="true" /></div>;
  return <MetaHero meta={first} />;
}

function MetaHero({ meta }: { meta: PreviewMeta }) {
  const { metas } = usePreview();
  useEffect(() => { metas?.load(meta); }, [metas, meta]);
  const full = enrich(meta, metas?.get(meta));
  const facts = [typeName(full.type), full.genres[0] ?? '', full.year].filter(Boolean);
  return (
    <div className="npv-tv-hero">
      <Art src={tmdbSized(full.background || full.poster, 'w1280')} className="npv-tv-backdrop" eager />
      <span className="npv-tv-scrim" aria-hidden="true" />
      <div className="npv-tv-hero-text">
        {full.logo
          ? <img className="npv-tv-logo" src={tmdbSized(full.logo, 'w500')} alt={full.name} data-i18n-preserve />
          : <h2 className="npv-tv-title" data-i18n-preserve>{full.name}</h2>}
        {facts.length > 0 && <p className="npv-meta-line" data-i18n-preserve>{facts.map((fact, n) => <span key={`${fact}-${n}`}>{fact}</span>)}</p>}
        {full.description && <p className="npv-tv-desc" data-i18n-preserve>{full.description}</p>}
      </div>
    </div>
  );
}

interface RowFocusProps {
  index: number;
  focus: FocusPos;
  onFocusCard: (pos: FocusPos) => void;
}

function cardFocus(index: number, col: number, focus: FocusPos, onFocusCard: (pos: FocusPos) => void): CardFocus {
  const on = focus.row === index && focus.col === col;
  return {
    tabIndex: on ? 0 : -1,
    'data-pos': `${index}-${col}`,
    className: on ? 'is-focused' : '',
    onFocus: () => onFocusCard({ row: index, col }),
    onMouseEnter: () => onFocusCard({ row: index, col }),
  };
}

function TvCatalogRow({ row, index, focus, onFocusCard, onCount }: RowFocusProps & { row: PreviewRow; onCount: (index: number, count: number, metas: PreviewMeta[]) => void }) {
  const { preview, go } = usePreview();
  const { near, state, retry } = useCatalog(row.external ? null : { type: row.type, catalogId: row.catalogId });
  const metas = state?.status === 'ready' ? state.metas.slice(0, ROW_LIMIT) : [];
  const ids = metas.map((meta) => meta.id).join(',');
  useEffect(() => { onCount(index, metas.length, metas); /* `ids` stands for `metas` */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, ids, onCount]);
  let body;
  if (row.external) body = <ExternalNote />;
  else if (!state || state.status === 'loading') body = <div className="npv-strip"><SkeletonCards count={8} /></div>;
  else if (state.status === 'error') body = <ErrorNote onRetry={retry} />;
  else if (state.status === 'sample') body = <SampleRow reason={state.reason} label={state.label} count={8} />;
  else if (!metas.length) body = <EmptyNote />;
  else body = <div className="npv-strip">{metas.map((meta, col) => <PosterCard key={meta.id} meta={meta} focus={cardFocus(index, col, focus, onFocusCard)} />)}</div>;
  const more = rowHasMore(state);
  return (
    <section className="npv-row" ref={near} data-row={index}>
      <header className="npv-row-head">
        <div>
          <h3 data-i18n-preserve>{row.name}</h3>
          {!row.external && preview.addonName && <p className="npv-row-sub" data-i18n-preserve>{setupCopy('from {{name}}', 'from {{name}}', { name: preview.addonName })}</p>}
        </div>
        {more && (
          <button type="button" className="npv-viewall" tabIndex={-1} onClick={() => go({ type: 'catalog', row })}>
            <span>View all</span><Chevron />
          </button>
        )}
      </header>
      {body}
    </section>
  );
}

function TvCollectionRow({ collection, index, focus, onFocusCard }: RowFocusProps & { collection: PreviewCollection }) {
  return (
    <section className="npv-row" data-row={index}>
      <header className="npv-row-head"><div><h3 data-i18n-preserve>{collection.title}</h3></div></header>
      <div className="npv-strip is-tiles">
        {collection.folders.map((folder, col) => (
          <FolderTile key={folder.id} collectionId={collection.id} folder={folder} animate={false} focus={cardFocus(index, col, focus, onFocusCard)} />
        ))}
      </div>
    </section>
  );
}

// Scrolls `container` (the rows list or one row's strip) just enough to show
// `el`. Layout offsets, so the modal's scale does not matter.
function reveal(container: HTMLElement, el: HTMLElement, axis: 'x' | 'y', pad: number) {
  if (axis === 'x') {
    const left = el.offsetLeft - pad;
    const right = el.offsetLeft + el.offsetWidth + pad;
    if (left < container.scrollLeft) container.scrollLeft = left;
    else if (right > container.scrollLeft + container.clientWidth) container.scrollLeft = right - container.clientWidth;
    return;
  }
  const top = el.offsetTop - pad;
  if (top < container.scrollTop || el.offsetTop + el.offsetHeight > container.scrollTop + container.clientHeight) container.scrollTop = Math.max(0, top);
}

export function NuvioTv({ stack }: { stack: PreviewScreen[] }) {
  const { preview, loader } = usePreview();
  const entries = visibleEntries(preview);
  const byId = new Map(preview.collections.map((item) => [item.id, item]));
  const [counts, setCounts] = useState<Record<number, { count: number; metas: PreviewMeta[] }>>({});
  const [focus, setFocus] = useState<FocusPos>({ row: 0, col: 0 });
  const rowsRef = useRef<HTMLDivElement>(null);
  const keyboard = useRef(false);
  const atHome = stack.length <= 1;

  const lengths = entries.map((entry, n) => (entry.kind === 'collection' ? byId.get(entry.id)?.folders.length ?? 0 : counts[n]?.count ?? 0));
  const onCount = useRef((index: number, count: number, metas: PreviewMeta[]) => {
    setCounts((prev) => (prev[index]?.count === count && prev[index]?.metas === metas ? prev : { ...prev, [index]: { count, metas } }));
  }).current;

  // Start on the first row that has cards.
  const firstRow = lengths.findIndex((length) => length > 0);
  const pos: FocusPos = (lengths[focus.row] ?? 0) > 0 ? { row: focus.row, col: Math.min(focus.col, (lengths[focus.row] ?? 1) - 1) } : { row: Math.max(0, firstRow), col: 0 };

  // The hero follows the focus after a short pause, like the player.
  const shownKey = useDebounced(`${pos.row}:${pos.col}`, HERO_DEBOUNCE_MS);
  const [shownRow, shownCol] = shownKey.split(':').map(Number) as [number, number];
  const entry = entries[shownRow];
  let shown: Focused = null;
  if (entry?.kind === 'collection') {
    const collection = byId.get(entry.id);
    const folder = collection?.folders[shownCol];
    if (collection && folder) shown = { kind: 'folder', folder, collection };
  } else if (entry) {
    const meta = counts[shownRow]?.metas[shownCol];
    if (meta) shown = { kind: 'meta', meta: meta.type ? meta : { ...meta, type: entry.type } };
  }

  useEffect(() => {
    const rows = rowsRef.current;
    if (!rows) return;
    const card = rows.querySelector<HTMLElement>(`[data-pos="${pos.row}-${pos.col}"]`);
    const rowEl = rows.querySelector<HTMLElement>(`[data-row="${pos.row}"]`);
    if (!card) return;
    // Keys (and Tab) bring the card into view; a hovered card already is.
    const byKeys = keyboard.current;
    keyboard.current = false;
    if (byKeys) card.focus({ preventScroll: true });
    if (!byKeys && card !== document.activeElement) return;
    const strip = card.parentElement;
    if (strip) reveal(strip, card, 'x', 52);
    if (rowEl) reveal(rows, rowEl, 'y', 8);
  }, [pos.row, pos.col]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    keyboard.current = true;
    setFocus(moveFocus(lengths, pos, event.key));
  };

  return (
    <div className="npv-tv-home">
      <Layer top={atHome} className="is-home is-tv">
        <Sidebar />
        {entries.length > 0 && <TvHero shown={shown} sample={entry?.kind === 'row' && loader?.get({ type: entry.type, catalogId: entry.catalogId })?.status === 'sample'} />}
        <div className="npv-tv-rows" ref={rowsRef} onKeyDown={onKeyDown}>
          {entries.length === 0 && <EmptyNote>Nothing shows on Home yet. Add Home rows or collections to see them here.</EmptyNote>}
          {entries.map((item, index) => {
            if (item.kind === 'collection') {
              const collection = byId.get(item.id);
              return collection ? <TvCollectionRow key={`c-${collection.id}`} collection={collection} index={index} focus={pos} onFocusCard={setFocus} /> : null;
            }
            return <TvCatalogRow key={`r-${item.key}`} row={item} index={index} focus={pos} onFocusCard={setFocus} onCount={onCount} />;
          })}
          {preview.franchisePending && <FranchiseNote />}
        </div>
      </Layer>
      <StackScreens stack={stack} />
    </div>
  );
}
