import { useEffect } from 'react';
import { setupCount } from '@/features/setup/shared/setup-copy';
import {
  ROW_LIMIT, enrich, findCollection, findFolder, rowHasMore, tmdbSized,
  type PreviewCollection, type PreviewFolder, type PreviewRow, type PreviewScreen, type PreviewSource, type SetupPreview,
} from '@/features/setup/preview/preview-model';
import {
  Art, Chevron, DetailsSheet, EmptyNote, ErrorNote, ExternalNote, FranchiseNote, GridState, Layer, PosterCard, SampleRow,
  SkeletonCards, rowTitle, sourceRowTitle, useCatalog, usePreview,
} from '@/features/setup/preview/PreviewScreens';
import { visibleEntries } from '@/features/setup/preview/NuvioTv';

// Nuvio TV's Home laid out at phone width: what the TV home holds (the
// setup's collections and rows in Home order, big landscape folder cards),
// without the sidebar and the focus-following hero, so it reads on a phone.
// Touch first: a tap opens, every card is a plain button for keyboards.
// Folder and "See all" screens have no header of their own: the modal's top
// bar shows Back and the screen's title (`phoneTvTitle`).

// The title the top bar shows over a folder or "See all" screen (the
// screen under an open details sheet), or null on Home.
export function phoneTvTitle(preview: SetupPreview | null, stack: PreviewScreen[]): string | null {
  const screens = stack.slice(1).filter((screen) => screen.at !== 'details');
  const screen = screens[screens.length - 1];
  if (screen?.at === 'folder') return findFolder(preview, screen.collectionId, screen.folderId)?.title ?? '';
  if (screen?.at === 'catalog') return screen.row.name;
  return null;
}

function HeroBand() {
  const { preview, metas } = usePreview();
  const source = preview.hero[0];
  const { state } = useCatalog(source ? { type: source.type, catalogId: source.catalogId } : null, true);
  const ready = state?.status === 'ready' ? state.metas[0] : undefined;
  const first = ready && !ready.type && source ? { ...ready, type: source.type } : ready;
  const firstKey = first ? `${first.type}|${first.id}` : '';
  useEffect(() => { if (first) metas?.load(first); // `firstKey` stands for `first`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metas, firstKey]);
  const full = first ? enrich(first, metas?.get(first)) : null;
  const art = full ? full.background || full.poster : '';
  return (
    <section className="npv-ptv-hero">
      {art && <Art src={tmdbSized(art, 'w1280')} className="npv-ptv-hero-art" eager />}
      <span className="npv-ptv-hero-scrim" aria-hidden="true" />
      <div className="npv-ptv-hero-text">
        {preview.addonName
          ? <h2 data-i18n-preserve>{preview.addonName}</h2>
          : <h2>Your Nuvio home</h2>}
        <p>Live preview of your Nuvio home with this setup.</p>
      </div>
    </section>
  );
}

// A large landscape folder card: the cover carries the folder's name; a
// folder without a cover shows its title on the card instead.
function FolderCard({ collectionId, folder }: { collectionId: string; folder: PreviewFolder }) {
  const { go } = usePreview();
  return (
    <button
      type="button" className="npv-ptv-tile" title={folder.title} aria-label={folder.title}
      onClick={() => go({ type: 'folder', collectionId, folderId: folder.id })}
    >
      {folder.cover
        ? <Art src={folder.cover} className="npv-ptv-tile-img" />
        : <span className="npv-ptv-tile-name" data-i18n-preserve>{folder.title}</span>}
    </button>
  );
}

function CollectionRow({ collection }: { collection: PreviewCollection }) {
  return (
    <section className="npv-row">
      <header className="npv-row-head">
        <h3 data-i18n-preserve>{collection.title}</h3>
        <span className="npv-ptv-count">{setupCount(collection.folders.length, 'folder', 'folders')}</span>
      </header>
      <div className="npv-strip is-snap">
        {collection.folders.map((folder) => <FolderCard key={folder.id} collectionId={collection.id} folder={folder} />)}
      </div>
    </section>
  );
}

function ViewAll({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="npv-viewall" onClick={onClick}>
      <span>View all</span><Chevron />
    </button>
  );
}

// A poster row: a Home catalogue or one source of a folder.
function PosterRow({ row, title }: { row: PreviewRow; title: string }) {
  // "See all" keeps the row's own name; a folder source row is named by its title.
  const { go } = usePreview();
  const { near, state, retry } = useCatalog(row.external ? null : { type: row.type, catalogId: row.catalogId, genre: row.genre });
  let body;
  if (row.external) body = <ExternalNote />;
  else if (!state || state.status === 'loading') body = <div className="npv-strip"><SkeletonCards count={4} /></div>;
  else if (state.status === 'error') body = <ErrorNote onRetry={retry} />;
  else if (state.status === 'sample') body = <SampleRow reason={state.reason} count={4} />;
  else if (!state.metas.length) body = <EmptyNote />;
  else body = <div className="npv-strip is-snap">{state.metas.slice(0, ROW_LIMIT).map((meta) => <PosterCard key={meta.id} meta={meta.type ? meta : { ...meta, type: row.type }} />)}</div>;
  return (
    <section className="npv-row" ref={near}>
      <header className="npv-row-head">
        <h3 data-i18n-preserve>{title}</h3>
        {rowHasMore(state) && <ViewAll onClick={() => go({ type: 'catalog', row })} />}
      </header>
      {body}
    </section>
  );
}

function sourceRow(source: PreviewSource, n: number): PreviewRow {
  return {
    key: `src-${n}-${source.type}-${source.catalogId}-${source.genre}`, type: source.type, catalogId: source.catalogId,
    name: sourceRowTitle(source), custom: true, genre: source.genre || undefined, ...(source.external ? { external: true } : {}),
  };
}

export function PhoneTvFolder({ screen }: { screen: Extract<PreviewScreen, { at: 'folder' }> }) {
  const { preview } = usePreview();
  const collection = findCollection(preview, screen.collectionId);
  const folder = findFolder(preview, screen.collectionId, screen.folderId);
  if (!folder) return <EmptyNote />;
  const cover = folder.cover || collection?.backdrop || '';
  return (
    <div className="npv-ptv-folder">
      {cover && <Art src={tmdbSized(cover, 'w780')} className="npv-ptv-tint" />}
      <header className="npv-ptv-folder-head">
        <span className="npv-ptv-folder-cover">
          {folder.cover
            ? <Art src={folder.cover} className="npv-ptv-tile-img" eager />
            : <span className="npv-ptv-tile-name is-small" data-i18n-preserve>{folder.title}</span>}
        </span>
        <div className="npv-ptv-folder-text">
          {collection && <p className="npv-ptv-kicker" data-i18n-preserve>{collection.title}</p>}
          <h2 data-i18n-preserve>{folder.title}</h2>
          <p className="npv-ptv-sources">{setupCount(folder.sources.length, 'source', 'sources')}</p>
        </div>
      </header>
      <div className="npv-ptv-rows">
        {folder.sources.length === 0 && <EmptyNote />}
        {folder.sources.map((source, n) => {
          const row = sourceRow(source, n);
          return <PosterRow key={row.key} row={row} title={row.name} />;
        })}
      </div>
    </div>
  );
}

export function PhoneTvCatalog({ screen }: { screen: Extract<PreviewScreen, { at: 'catalog' }> }) {
  const { state, retry } = useCatalog({ type: screen.row.type, catalogId: screen.row.catalogId, genre: screen.row.genre }, true);
  return (
    <div className="npv-ptv-catalog">
      <GridState state={state} retry={retry} />
    </div>
  );
}

function Screens({ stack }: { stack: PreviewScreen[] }) {
  return (
    <>
      {stack.slice(1).map((screen, n) => {
        const top = n === stack.length - 2;
        const key = `${n}-${screen.at}`;
        if (screen.at === 'folder') return <Layer key={key} top={top} className="is-screen"><PhoneTvFolder screen={screen} /></Layer>;
        if (screen.at === 'catalog') return <Layer key={key} top={top} className="is-screen"><PhoneTvCatalog screen={screen} /></Layer>;
        if (screen.at === 'details') return <Layer key={key} top={top} className="is-sheet"><DetailsSheet screen={screen} /></Layer>;
        return null;
      })}
    </>
  );
}

export function NuvioPhoneTv({ stack }: { stack: PreviewScreen[] }) {
  const { preview } = usePreview();
  const entries = visibleEntries(preview);
  const byId = new Map(preview.collections.map((item) => [item.id, item]));
  return (
    <div className="npv-ptv-home">
      <Layer top={stack.length <= 1} className="is-home">
        <HeroBand />
        <div className="npv-ptv-rows">
          {entries.length === 0 && <EmptyNote>Nothing shows on Home yet. Add Home rows or collections to see them here.</EmptyNote>}
          {entries.map((entry) => {
            if (entry.kind === 'collection') {
              const collection = byId.get(entry.id);
              return collection ? <CollectionRow key={`c-${collection.id}`} collection={collection} /> : null;
            }
            return <PosterRow key={`r-${entry.key}`} row={entry} title={rowTitle(entry)} />;
          })}
          {preview.franchisePending && <FranchiseNote />}
        </div>
      </Layer>
      <Screens stack={stack} />
    </div>
  );
}
