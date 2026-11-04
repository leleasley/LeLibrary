import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ROW_LIMIT, enrich, heroHeight, heroPicks, rowHasMore, shouldAutoAdvance, startAutoAdvance, tmdbSized, wrapIndex,
  type PreviewCollection, type PreviewRow, type PreviewScreen,
} from '@/features/setup/preview/preview-model';
import {
  Art, Chevron, EmptyNote, ErrorNote, ExternalNote, FolderTile, Layer, PosterCard, SampleHero, SampleRow, SkeletonCards,
  FranchiseNote, StackScreens, rowTitle, typeName, useCatalog, usePreview,
} from '@/features/setup/preview/PreviewScreens';

// Nuvio Mobile's Home: the hero carousel under the status bar, then the
// setup's collections and catalogue rows in Home order, and the floating
// bottom navigation. Folder, "See all" and details screens open on top.

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  useEffect(() => {
    const query = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined;
    if (!query) return undefined;
    const update = () => setReduced(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const update = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return hidden;
}

function HeroSource({ row }: { row: PreviewRow }) {
  useCatalog({ type: row.type, catalogId: row.catalogId }, true);
  return null;
}

export function MobileHero({ width, height }: { width: number; height: number }) {
  const { preview, loader, metas, go } = usePreview();
  const sources = preview.hero.slice(0, 2);
  const states = sources.map((row) => loader?.get({ type: row.type, catalogId: row.catalogId }));
  const picks = heroPicks(sources.map((row, n) => {
    const state = states[n];
    return { type: row.type, metas: state?.status === 'ready' ? state.metas : [] };
  }));
  const pickKey = picks.map((meta) => meta.id).join(',');
  useEffect(() => {
    for (const meta of picks) metas?.load(meta);
    // `pickKey` stands for `picks`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metas, pickKey]);

  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [drag, setDrag] = useState(0);
  const dragStart = useRef<{ x: number; id: number } | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const hidden = useDocumentHidden();
  const count = picks.length;
  const current = wrapIndex(index, count);
  const canRun = useRef<() => boolean>(() => false);
  canRun.current = () => shouldAutoAdvance({ count, reducedMotion, hidden, hovered: hovered || dragStart.current !== null });
  useEffect(() => {
    if (count < 2 || reducedMotion) return undefined;
    return startAutoAdvance(() => canRun.current(), () => setIndex((n) => wrapIndex(n + 1, count)));
  }, [count, reducedMotion]);

  const height_ = heroHeight(width, height);
  const loading = sources.length > 0 && states.some((state) => !state || state.status === 'loading') && count === 0;
  // Library hero sources in a draft: the hero's shape, saying what comes.
  if (sources.length > 0 && states.every((state) => state?.status === 'sample')) {
    return <>{sources.map((row) => <HeroSource key={row.key} row={row} />)}<SampleHero height={height_} /></>;
  }
  if (!sources.length || (!loading && count === 0)) return <>{sources.map((row) => <HeroSource key={row.key} row={row} />)}</>;

  const onDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || count < 2) return;
    dragStart.current = { x: event.clientX, id: event.pointerId };
  };
  const onMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!dragStart.current || dragStart.current.id !== event.pointerId) return;
    setDrag(event.clientX - dragStart.current.x);
  };
  const onUp = () => {
    if (!dragStart.current) return;
    dragStart.current = null;
    const threshold = Math.min(80, width * 0.18);
    if (drag <= -threshold) setIndex((n) => wrapIndex(n + 1, count));
    else if (drag >= threshold) setIndex((n) => wrapIndex(n - 1, count));
    setDrag(0);
  };

  const active = picks[current];
  return (
    <section
      className={`npv-hero${loading ? ' is-loading' : ''}${drag ? ' is-dragging' : ''}`} style={{ height: height_ }}
      aria-label="Featured"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => { setHovered(false); onUp(); }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
    >
      {sources.map((row) => <HeroSource key={row.key} row={row} />)}
      {loading ? (
        <div className="npv-hero-slide">
          <span className="npv-art is-loading" aria-hidden="true" />
          <div className="npv-hero-content"><span className="npv-skel-line is-hero" /><span className="npv-skel-line is-short" /></div>
        </div>
      ) : (
        <div className="npv-hero-track" style={{ transform: `translate3d(calc(${-current * 100}% + ${drag}px), 0, 0)` }}>
          {picks.map((pick, n) => {
            const meta = enrich(pick, metas?.get(pick));
            const facts = [typeName(meta.type), meta.genres[0] ?? '', meta.year].filter(Boolean);
            return (
              <div key={meta.id} className="npv-hero-slide" aria-hidden={n === current ? undefined : true}>
                <Art src={tmdbSized(meta.background || meta.poster, 'w1280')} className="npv-hero-art" eager={n === current} />
                <span className="npv-hero-scrim" aria-hidden="true" />
                <div className="npv-hero-content">
                  {meta.logo
                    ? <img className="npv-hero-logo" src={tmdbSized(meta.logo, 'w500')} alt={meta.name} draggable={false} data-i18n-preserve />
                    : <h2 className="npv-hero-title" data-i18n-preserve>{meta.name}</h2>}
                  {facts.length > 0 && (
                    <p className="npv-meta-line" data-i18n-preserve>{facts.map((fact, i) => <span key={`${fact}-${i}`}>{fact}</span>)}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="npv-hero-ui">
        <button type="button" className="npv-pill is-details" disabled={!active} onClick={() => { if (active) go({ type: 'details', meta: enrich(active, metas?.get(active)) }); }}>
          View Details
        </button>
        {count > 1 && (
          <div className="npv-dots" role="tablist" aria-label="Featured">
            {picks.map((meta, n) => (
              <button
                key={meta.id} type="button" role="tab" aria-selected={n === current} aria-label={meta.name}
                className={n === current ? 'is-active' : ''} onClick={() => setIndex(n)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function RowHead({ title, more, onMore }: { title: string; more: boolean; onMore?: () => void }) {
  return (
    <header className="npv-row-head">
      <h3 data-i18n-preserve>{title}</h3>
      <button
        type="button" className={`npv-more${more ? '' : ' is-hidden'}`} aria-label="See all"
        tabIndex={more ? 0 : -1} aria-hidden={more ? undefined : true} onClick={more ? onMore : undefined}
      >
        <Chevron />
      </button>
    </header>
  );
}

function MobileCatalogRow({ row }: { row: PreviewRow }) {
  const { go } = usePreview();
  const { near, state, retry } = useCatalog(row.external ? null : { type: row.type, catalogId: row.catalogId });
  let body;
  if (row.external) body = <ExternalNote />;
  else if (!state || state.status === 'loading') body = <div className="npv-strip"><SkeletonCards count={4} /></div>;
  else if (state.status === 'error') body = <ErrorNote onRetry={retry} />;
  else if (state.status === 'sample') body = <SampleRow reason={state.reason} count={4} />;
  else if (!state.metas.length) body = <EmptyNote />;
  else body = <div className="npv-strip">{state.metas.slice(0, ROW_LIMIT).map((meta) => <PosterCard key={meta.id} meta={meta} />)}</div>;
  return (
    <section className="npv-row" ref={near}>
      <RowHead title={rowTitle(row)} more={rowHasMore(state)} onMore={() => go({ type: 'catalog', row })} />
      {body}
    </section>
  );
}

function MobileCollectionRow({ collection }: { collection: PreviewCollection }) {
  return (
    <section className="npv-row">
      <RowHead title={collection.title} more={false} />
      <div className="npv-strip is-tiles">
        {collection.folders.map((folder) => <FolderTile key={folder.id} collectionId={collection.id} folder={folder} animate />)}
      </div>
    </section>
  );
}

const NAV_ICONS = {
  home: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  library: <><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M6.5 5h11" /></>,
};

function BottomNav({ compact }: { compact: boolean }) {
  const { go } = usePreview();
  const items = [
    { id: 'home', label: 'Home', icon: NAV_ICONS.home },
    { id: 'search', label: 'Search', icon: NAV_ICONS.search },
    { id: 'library', label: 'Library', icon: NAV_ICONS.library },
  ] as const;
  return (
    <nav className={`npv-tabbar${compact ? ' is-compact' : ''}`} aria-label="Nuvio">
      {items.map((item) => (
        <button
          key={item.id} type="button" className={`npv-tab${item.id === 'home' ? ' is-active' : ''}`}
          aria-current={item.id === 'home' ? 'page' : undefined} aria-disabled={item.id === 'home' ? undefined : true}
          onClick={item.id === 'home' ? () => go({ type: 'home' }) : undefined}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">{item.icon}</svg>
          <span>{item.label}</span>
        </button>
      ))}
      <button type="button" className="npv-tab" aria-disabled="true">
        <span className="npv-avatar" aria-hidden="true" />
        <span>Profile</span>
      </button>
    </nav>
  );
}

export function NuvioMobile({ stack, width, height }: { stack: PreviewScreen[]; width: number; height: number }) {
  const { preview } = usePreview();
  const [compact, setCompact] = useState(false);
  const byId = new Map(preview.collections.map((item) => [item.id, item]));
  const atHome = stack.length <= 1;
  return (
    <div className="npv-mobile">
      <Layer top={atHome} className="is-home" onScroll={(top) => setCompact(top > 60)}>
        <MobileHero width={width} height={height} />
        <div className="npv-rows">
          {preview.home.length === 0 && <EmptyNote>Nothing shows on Home yet. Add Home rows or collections to see them here.</EmptyNote>}
          {preview.home.map((entry) => {
            if (entry.kind === 'collection') {
              const collection = byId.get(entry.id);
              return collection && collection.folders.length ? <MobileCollectionRow key={`c-${collection.id}`} collection={collection} /> : null;
            }
            return <MobileCatalogRow key={`r-${entry.key}`} row={entry} />;
          })}
          {preview.franchisePending && <FranchiseNote />}
        </div>
      </Layer>
      <StackScreens stack={stack} />
      {atHome && <BottomNav compact={compact} />}
    </div>
  );
}
