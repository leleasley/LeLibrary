import {
  ROW_LIMIT, rowHasMore, type PreviewRow, type PreviewScreen,
} from '@/features/setup/preview/preview-model';
import {
  EmptyNote, ErrorNote, ExternalNote, Layer, PosterCard, SampleRow, SkeletonCards, StackScreens, rowTitle, useCatalog, usePreview,
} from '@/features/setup/preview/PreviewScreens';

// Stremio's Board: its catalogue rows (Stremio shows no collections), each
// with "See All". Same row data as Nuvio, Stremio's own look.

const STREMIO_NAV = [
  { id: 'board', label: 'Board', icon: <path d="M4 5h7v6H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 13h7v6H4z" /> },
  { id: 'discover', label: 'Discover', icon: <><circle cx="12" cy="12" r="8.5" /><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z" /></> },
  { id: 'library', label: 'Library', icon: <><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M6.5 5h11" /></> },
  { id: 'settings', label: 'Settings', icon: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21" /></> },
] as const;

function BoardRow({ row }: { row: PreviewRow }) {
  const { go } = usePreview();
  const { near, state, retry } = useCatalog(row.external ? null : { type: row.type, catalogId: row.catalogId });
  let body;
  if (row.external) body = <ExternalNote />;
  else if (!state || state.status === 'loading') body = <div className="npv-strip"><SkeletonCards count={7} /></div>;
  else if (state.status === 'error') body = <ErrorNote onRetry={retry} />;
  else if (state.status === 'sample') body = <SampleRow reason={state.reason} count={7} />;
  else if (!state.metas.length) body = <EmptyNote />;
  else body = <div className="npv-strip">{state.metas.slice(0, ROW_LIMIT).map((meta) => <PosterCard key={meta.id} meta={meta} />)}</div>;
  return (
    <section className="npv-row" ref={near}>
      <header className="npv-row-head">
        <h3 data-i18n-preserve>{rowTitle(row)}</h3>
        {rowHasMore(state) && <button type="button" className="npv-seeall" onClick={() => go({ type: 'catalog', row })}>See All</button>}
      </header>
      {body}
    </section>
  );
}

export function StremioBoard({ stack }: { stack: PreviewScreen[] }) {
  const { preview } = usePreview();
  const rows = preview.home.filter((entry): entry is { kind: 'row' } & PreviewRow => entry.kind === 'row');
  return (
    <div className="npv-stremio">
      <nav className="npv-st-side" aria-label="Stremio">
        {STREMIO_NAV.map((item) => (
          <span key={item.id} className={`npv-st-item${item.id === 'board' ? ' is-active' : ''}`} aria-current={item.id === 'board' ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{item.icon}</svg>
            <span>{item.label}</span>
          </span>
        ))}
      </nav>
      <div className="npv-st-main">
        <Layer top={stack.length <= 1} className="is-home">
          <div className="npv-st-search" aria-hidden="true">Search or paste link</div>
          <div className="npv-rows">
            {rows.length === 0 && <EmptyNote>Nothing shows on the Board yet. Add catalogues, then save.</EmptyNote>}
            {rows.map((row) => <BoardRow key={row.key} row={row} />)}
          </div>
        </Layer>
        <StackScreens stack={stack} />
      </div>
    </div>
  );
}
