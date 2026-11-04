import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { setupCopy } from '@/features/setup/shared/setup-copy';
import {
  GRID_LIMIT, ROW_LIMIT, createCatalogLoader, fetchSetupPreview, findCollection, findFolder, previewPlace, typeLabel,
  type CatalogLoader, type CatalogRef, type PreviewCollection, type PreviewFolder, type PreviewPlace,
  type PreviewPlatform, type PreviewRow, type RowState, type SetupPreview,
} from '@/features/setup/preview/preview-model';
import '@/features/setup/library/library.css';
import './preview.css';

// The Preview tab of the setup edit page: what Nuvio or Stremio will show for
// the saved setup. Nuvio: the hero, the collections (each a row of folder
// covers) and the Home rows, in the order a push sends; a collection opens its
// folders, a folder its posters with one tab per source. Stremio: the board.
// Read-only: it never pushes or saves anything.

export interface PreviewPanelInitial {
  platform?: PreviewPlatform | undefined;
  previews?: Partial<Record<PreviewPlatform, SetupPreview>> | undefined;
  place?: PreviewPlace | undefined;
  failed?: boolean | undefined;
}

export interface PreviewPanelProps {
  uuid: string;
  editToken: string | null;
  installToken: string | null;
  defaultPlatform: PreviewPlatform;
  dirty?: boolean | undefined;
  // Tests only: start from fixed data and a fixed row loader.
  initial?: PreviewPanelInitial;
  loader?: CatalogLoader;
}

// Calls `onVisible` once the element nears the viewport; without
// IntersectionObserver (old browsers) it calls it straight away.
function useNearView(onVisible: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onVisible);
  callback.current = onVisible;
  useEffect(() => {
    if (!enabled) return undefined;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') { callback.current(); return undefined; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); callback.current(); }
    }, { rootMargin: '240px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);
  return ref;
}

function useLoaderTick(loader: CatalogLoader | null) {
  const [, setTick] = useState(0);
  useEffect(() => (loader ? loader.subscribe(() => setTick((n) => n + 1)) : undefined), [loader]);
}

function PosterSkeleton({ count = 6 }: { count?: number }) {
  return <>{Array.from({ length: count }, (_, n) => <div key={n} className="pv-poster is-blank" aria-hidden="true" />)}</>;
}

function RowBody({ state, onRetry, limit, grid }: { state: RowState | undefined; onRetry: () => void; limit: number; grid?: boolean }) {
  if (!state || state.status === 'loading') {
    return <div className={grid ? 'pv-grid is-loading' : 'pv-strip is-loading'}><PosterSkeleton count={grid ? 8 : 6} /></div>;
  }
  if (state.status === 'error') {
    return (
      <div className="pv-row-note is-error">
        <span>This row did not load.</span>
        <button type="button" className="setup-secondary pv-retry" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (!state.metas.length) return <p className="pv-row-note">This row is empty.</p>;
  return (
    <div className={grid ? 'pv-grid' : 'pv-strip'}>
      {state.metas.slice(0, limit).map((meta) => (
        <figure className="pv-poster" key={meta.id} title={meta.name}>
          <img src={meta.poster} alt={meta.name} loading="lazy" decoding="async" />
        </figure>
      ))}
    </div>
  );
}

function CatalogRow({ row, loader, platform }: { row: PreviewRow; loader: CatalogLoader | null; platform: PreviewPlatform }) {
  const ref: CatalogRef = { type: row.type, catalogId: row.catalogId };
  const canLoad = Boolean(loader) && !row.external;
  const near = useNearView(() => loader?.load(ref), canLoad);
  return (
    <section className="pv-row" ref={near}>
      <header className="pv-row-head">
        <h3 data-i18n-preserve>{row.name}</h3>
        {platform === 'stremio' && <span className="pv-chip">{setupCopy(typeLabel(row.type), typeLabel(row.type))}</span>}
      </header>
      {row.external ? (
        <p className="pv-row-note">From another addon: your player loads it, the preview cannot.</p>
      ) : !loader ? (
        <div className="pv-strip is-loading"><PosterSkeleton /></div>
      ) : (
        <RowBody state={loader.get(ref)} onRetry={() => loader.retry(ref)} limit={ROW_LIMIT} />
      )}
    </section>
  );
}

function FolderTile({ folder, onOpen }: { folder: PreviewFolder; onOpen: () => void }) {
  return (
    <button type="button" className={`pv-tile is-${folder.shape.toLowerCase()}`} onClick={onOpen} title={folder.title}>
      {folder.cover ? <img src={folder.cover} alt="" loading="lazy" decoding="async" /> : <span className="pv-tile-blank" aria-hidden="true" />}
      {(!folder.hideTitle || !folder.cover) && <span className="pv-tile-title" data-i18n-preserve>{folder.title}</span>}
    </button>
  );
}

function CollectionRow({ collection, onOpen, onFolder }: { collection: PreviewCollection; onOpen: () => void; onFolder: (folderId: string) => void }) {
  return (
    <section className="pv-row">
      <header className="pv-row-head">
        <h3 data-i18n-preserve>{collection.title}</h3>
        <button type="button" className="pv-link" onClick={onOpen}>See all</button>
      </header>
      <div className="pv-strip is-tiles">
        {collection.folders.map((folder) => <FolderTile key={folder.id} folder={folder} onOpen={() => onFolder(folder.id)} />)}
      </div>
    </section>
  );
}

function Hero({ row, loader }: { row: PreviewRow; loader: CatalogLoader | null }) {
  const ref: CatalogRef = { type: row.type, catalogId: row.catalogId };
  const near = useNearView(() => loader?.load(ref), Boolean(loader));
  const state = loader?.get(ref);
  const first = state?.status === 'ready' ? state.metas[0] : undefined;
  const art = first ? (first.background || first.poster) : '';
  return (
    <div className={`pv-hero${first ? '' : ' is-blank'}`} ref={near}>
      {art && <img src={art} alt="" decoding="async" />}
      <div className="pv-hero-text">
        <span className="pv-chip" data-i18n-preserve>{row.name}</span>
        {first && <strong data-i18n-preserve>{first.name}</strong>}
      </div>
    </div>
  );
}

function BackButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="edit-back pv-back" onClick={onClick}>
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg>
      <span>{children}</span>
    </button>
  );
}

function CollectionView({ collection, onBack, onFolder }: { collection: PreviewCollection; onBack: () => void; onFolder: (folderId: string) => void }) {
  return (
    <div className="pv-screen-body">
      <BackButton onClick={onBack}>Home</BackButton>
      {collection.backdrop && <div className="pv-backdrop"><img src={collection.backdrop} alt="" decoding="async" /></div>}
      <h3 className="pv-title" data-i18n-preserve>{collection.title}</h3>
      <div className="pv-folders">
        {collection.folders.map((folder) => <FolderTile key={folder.id} folder={folder} onOpen={() => onFolder(folder.id)} />)}
      </div>
    </div>
  );
}

function FolderView({ folder, tab, loader, onBack, onTab }: {
  folder: PreviewFolder; tab: number; loader: CatalogLoader | null; onBack: () => void; onTab: (tab: number) => void;
}) {
  const index = Math.min(tab, Math.max(0, folder.sources.length - 1));
  const source = folder.sources[index];
  const ref: CatalogRef | null = source ? { type: source.type, catalogId: source.catalogId, genre: source.genre } : null;
  const wanted = ref && !source?.external ? ref : null;
  const wantedKey = wanted ? `${wanted.type}|${wanted.catalogId}|${wanted.genre}` : '';
  // A folder's grid is on screen as soon as it opens: load its tab now.
  // `wantedKey` stands for `wanted` (a new object every render).
  useEffect(() => {
    if (wanted) loader?.load(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader, wantedKey]);
  return (
    <div className="pv-screen-body">
      <BackButton onClick={onBack}>Back</BackButton>
      <h3 className="pv-title" data-i18n-preserve>{folder.title}</h3>
      {folder.sources.length > 1 && (
        <div className="pv-tabs" role="tablist" aria-label="Folder sources">
          {folder.sources.map((item, n) => (
            <button
              key={`${item.catalogId}-${item.genre}-${n}`} type="button" role="tab" aria-selected={n === index}
              className={n === index ? 'is-active' : ''} onClick={() => onTab(n)}
            >
              <span data-i18n-preserve>{item.name}</span>
            </button>
          ))}
        </div>
      )}
      {!source ? (
        <p className="pv-row-note">This row is empty.</p>
      ) : source.external ? (
        <p className="pv-row-note">From another addon: your player loads it, the preview cannot.</p>
      ) : !loader || !ref ? (
        <div className="pv-grid is-loading"><PosterSkeleton count={8} /></div>
      ) : (
        <RowBody state={loader.get(ref)} onRetry={() => loader.retry(ref)} limit={GRID_LIMIT} grid />
      )}
    </div>
  );
}

export function PreviewPanel({ uuid, editToken, installToken, defaultPlatform, dirty, initial, loader: givenLoader }: PreviewPanelProps) {
  const [platform, setPlatform] = useState<PreviewPlatform>(initial?.platform ?? defaultPlatform);
  const [previews, setPreviews] = useState<Partial<Record<PreviewPlatform, SetupPreview>>>(initial?.previews ?? {});
  const [failed, setFailed] = useState<Partial<Record<PreviewPlatform, boolean>>>(initial?.failed ? { [initial?.platform ?? defaultPlatform]: true } : {});
  const [attempt, setAttempt] = useState(0);
  const [place, dispatch] = useReducer(previewPlace, initial?.place ?? { at: 'home' });
  const loader = useMemo(
    () => givenLoader ?? (installToken ? createCatalogLoader(installToken) : null),
    [givenLoader, installToken],
  );
  useLoaderTick(loader);

  const preview = previews[platform] ?? null;
  useEffect(() => {
    if (preview || !editToken || initial?.previews) return undefined;
    let cancelled = false;
    setFailed((prev) => ({ ...prev, [platform]: false }));
    fetchSetupPreview(uuid, platform, editToken)
      .then((data) => { if (!cancelled) setPreviews((prev) => ({ ...prev, [platform]: data })); })
      .catch(() => { if (!cancelled) setFailed((prev) => ({ ...prev, [platform]: true })); });
    return () => { cancelled = true; };
    // `attempt` re-runs the load after an error.
  }, [uuid, platform, editToken, preview, attempt, initial?.previews]);

  const switchTo = useCallback((next: PreviewPlatform) => {
    setPlatform(next);
    dispatch({ type: 'home' });
  }, []);

  const collection = place.at !== 'home' ? findCollection(preview, place.collectionId) : null;
  const folder = place.at === 'folder' ? findFolder(preview, place.collectionId, place.folderId) : null;
  const openFolder = (collectionId: string) => (folderId: string) => dispatch({ type: 'folder', collectionId, folderId });

  let body: ReactNode;
  if (!preview) {
    body = failed[platform] ? (
      <div className="pv-row-note is-error">
        <span>The preview could not be loaded.</span>
        <button type="button" className="setup-secondary pv-retry" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    ) : (
      <div className="pv-loading" aria-busy="true">
        {[0, 1, 2].map((n) => <div key={n} className="pv-row"><div className="pv-row-head is-blank" /><div className="pv-strip is-loading"><PosterSkeleton /></div></div>)}
      </div>
    );
  } else if (place.at === 'folder' && folder) {
    body = <FolderView folder={folder} tab={place.tab} loader={loader} onBack={() => dispatch({ type: 'back' })} onTab={(tab) => dispatch({ type: 'tab', tab })} />;
  } else if (place.at !== 'home' && collection) {
    body = <CollectionView collection={collection} onBack={() => dispatch({ type: 'home' })} onFolder={openFolder(collection.id)} />;
  } else {
    const byId = new Map(preview.collections.map((item) => [item.id, item]));
    body = (
      <div className="pv-screen-body">
        {platform === 'nuvio' && preview.hero[0] && <Hero row={preview.hero[0]} loader={loader} />}
        {preview.home.length === 0 && <p className="pv-row-note">Nothing shows on Home yet. Add Home rows or collections, then save.</p>}
        {preview.home.map((entry) => {
          if (entry.kind === 'collection') {
            const item = byId.get(entry.id);
            return item ? (
              <CollectionRow
                key={`c-${item.id}`} collection={item}
                onOpen={() => dispatch({ type: 'collection', collectionId: item.id })}
                onFolder={openFolder(item.id)}
              />
            ) : null;
          }
          return <CatalogRow key={`r-${entry.key}`} row={entry} loader={loader} platform={platform} />;
        })}
        {preview.franchisePending && <p className="pv-row-note">Movie Collections appears here once your library has finished building.</p>}
      </div>
    );
  }

  return (
    <section className="pv" aria-label="Preview">
      <header className="lib-hero pv-hero-head">
        <span className="setup-eyebrow">PREVIEW</span>
        <h1>What your player will show</h1>
        <p className="setup-lede">Your saved setup as it looks in the player, in the same order. Looking here never pushes or changes anything.</p>
      </header>
      {dirty && <p className="lib-note">This shows your saved settings. Save to see your latest changes here.</p>}
      {!installToken && <p className="lib-note">Posters need your install link. Unlock this setup again to load them.</p>}
      <div className="lib-tabs pv-switch" role="tablist" aria-label="Player">
        {(['nuvio', 'stremio'] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={platform === id} className={platform === id ? 'is-active' : ''} onClick={() => switchTo(id)}>
            {id === 'nuvio' ? 'Nuvio' : 'Stremio'}
          </button>
        ))}
      </div>
      <div className={`pv-screen is-${platform}`}>{body}</div>
    </section>
  );
}
