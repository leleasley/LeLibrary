import { apiErrorCopy } from '@/api/error-copy';
import { useEffect, useState } from 'react';
import { toast } from '@/features/setup/shared/Toast';
import {
  browsePublicCollections,
  browsePublicCollectionsBySession,
  fetchPublicCollection,
  fetchPublicCollectionBySession,
} from '@/features/setup/resolver/api';
import { isPortraitShape, type CollectionDoc, type FolderDoc } from '@/features/setup/shared/collection-doc';

type JsonRecord = Record<string, unknown>;

function publicId(item: unknown): string {
  const record = (item || {}) as JsonRecord;
  return String(record['public_id'] || record['publicId'] || record['id'] || '');
}

// Walk Nuvio's response envelope keys to the item list, keeping genuine
// public ids only.
function publicItemsFrom(data: unknown): JsonRecord[] {
  const candidates: unknown[][] = [];
  function visit(value: unknown, depth: number): void {
    if (depth > 3 || value == null) return;
    if (Array.isArray(value)) { candidates.push(value); return; }
    if (typeof value !== 'object') return;
    for (const key of ['items', 'collections', 'results', 'communityCollections', 'data', 'payload']) {
      visit((value as JsonRecord)[key], depth + 1);
    }
  }
  visit(data, 0);
  for (const candidate of candidates) {
    const items = candidate.filter((item) => /^[a-z0-9][a-z0-9-]{0,127}$/i.test(publicId(item)));
    if (items.length > 0 || candidate.length === 0) return items as JsonRecord[];
  }
  return [];
}

function publicRequirements(item: JsonRecord): unknown[] {
  const envelope = (item['envelope'] || {}) as JsonRecord;
  const requirements = (envelope['requirements'] || item['requirements'] || {}) as unknown;
  if (Array.isArray(requirements)) return requirements;
  const addons = (requirements as JsonRecord)['addons'];
  return Array.isArray(addons) ? addons : [];
}

function requirementPills(requirements: unknown[]): { name: string; url: string }[] {
  return requirements.map((requirement) => {
    if (typeof requirement === 'string') return { name: requirement, url: '' };
    const record = (requirement || {}) as JsonRecord;
    return {
      name: String(record['addonName'] || record['addon_name'] || record['name'] || record['addonId'] || 'Required addon'),
      url: String(record['manifestUrl'] || record['manifest_url'] || record['url'] || record['setupUrl'] || record['setup_url'] || ''),
    };
  }).filter((pill) => pill.name !== '');
}

function publicImage(item: JsonRecord): string {
  const envelope = (item['envelope'] || {}) as JsonRecord;
  return String(
    item['image_url'] || item['imageUrl'] || item['coverImageUrl'] || item['cover_image_url'] ||
    item['image'] || item['artwork'] || envelope['coverImageUrl'] || '',
  );
}

function cleanDescription(value: unknown): string {
  return String(value || 'A community collection ready to review and import.')
    .replace(/!?(?:\[[^\]]*\])?\([^)]*\)/g, '')
    .replace(/[`*_>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260);
}

// Normalize a raw community collection into the studio document. Mirrors the
// old importedCollections() mapping: legacy folder shapes collapse into
// catalogSources, presentation falls back to the studio defaults.
function toFolderDoc(raw: unknown, index: number, folderIndex: number): FolderDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const folder = raw as JsonRecord;
  const listed = Array.isArray(folder['catalogSources']) ? (folder['catalogSources'] as JsonRecord[]) : [];
  const legacy: JsonRecord[] = typeof folder['catalogId'] === 'string' && folder['catalogId'] !== ''
    ? [{
        catalogId: folder['catalogId'],
        type: folder['type'],
        genre: folder['genre'],
        addonId: (folder['addonId'] ?? folder['addon_id'] ?? '') as string,
        addonUrl: (folder['addonUrl'] ?? folder['addon_url'] ?? '') as string,
      }]
    : [];
  const sources = [...listed, ...legacy]
    .map((source) => ({
      addonId: String(source['addonId'] || source['addon_id'] || ''),
      addonUrl: String(source['addonUrl'] || source['addon_url'] || ''),
      catalogId: String(source['catalogId'] || source['id'] || ''),
      type: source['type'] === 'series' ? 'series' : 'movie',
      genre: String(source['genre'] || ''),
      // Display only: the server derives the transport label from the id.
      ...(String(source['title'] || source['name'] || '').trim()
        ? { title: String(source['title'] || source['name']).trim() }
        : {}),
    } as FolderDoc['catalogSources'][number]))
    .filter((source) => source.catalogId !== '');
  return {
    id: String(folder['id'] || `imported-folder-${index}-${folderIndex}`),
    title: String(folder['title'] || folder['name'] || 'Folder').slice(0, 80),
    tileShape: isPortraitShape(folder['tileShape']) ? 'PORTRAIT' : 'LANDSCAPE',
    hideTitle: folder['hideTitle'] === true,
    coverImageUrl: String(folder['customCoverImageUrl'] || folder['coverImageUrl'] || folder['cover'] || ''),
    focusGifEnabled: folder['focusGifEnabled'] === true,
    focusGifUrl: String(folder['focusGifUrl'] || ''),
    heroBackdropUrl: String(folder['heroBackdropUrl'] || folder['backdropUrl'] || ''),
    catalogSources: sources,
  };
}

function toCollectionDoc(raw: unknown, index: number): CollectionDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const collection = raw as JsonRecord;
  const folders = Array.isArray(collection['folders']) ? collection['folders'] : [];
  return {
    id: String(collection['id'] || `imported-${Date.now()}-${index}`),
    title: String(collection['title'] || collection['name'] || 'Imported collection').slice(0, 80),
    tileShape: isPortraitShape(collection['tileShape']) ? 'PORTRAIT' : 'LANDSCAPE',
    pinToTop: collection['pinToTop'] === true,
    focusGlowEnabled: collection['focusGlowEnabled'] !== false,
    showAllTab: collection['showAllTab'] !== false,
    viewMode: collection['viewMode'] === 'FOLLOW_LAYOUT' ? 'FOLLOW_LAYOUT' : 'TABBED_GRID',
    backdropUrl: String(collection['backdropImageUrl'] || collection['heroBackdropUrl'] || collection['backdropUrl'] || ''),
    hideTitle: collection['hideTitle'] === true,
    folders: folders
      .map((folder, folderIndex) => toFolderDoc(folder, index, folderIndex))
      .filter((folder): folder is FolderDoc => folder !== null),
  };
}

function detailCollections(data: unknown, item: JsonRecord): { root: JsonRecord; envelope: JsonRecord; collections: JsonRecord[] } {
  const root = ((data as JsonRecord)?.['item'] || data || item || {}) as JsonRecord;
  const envelope = ((root['envelope'] || (item['envelope'] as JsonRecord) || root || {}) as JsonRecord);
  const raw = envelope['collections'];
  const collections = Array.isArray(raw) ? raw as JsonRecord[]
    : envelope['collection'] && typeof envelope['collection'] === 'object' ? [envelope['collection'] as JsonRecord] : [];
  return { root, envelope, collections };
}

// Nuvio Community browser. Folder content stays live from the addon after
// import; only the folder definitions are copied in. Two data modes share
// this modal: a saved setup row (uuid + edit token, used post-creation) or a
// draft Nuvio session token (used pre-creation in the collections studio,
// where no row exists yet). The session path goes through the narrow
// read-only website proxy and is never stored.
export function NuvioPublicModal({ open, onClose, uuid, editToken, nuvioToken, onImport }: {
  open: boolean;
  onClose: () => void;
  uuid: string;
  editToken: string;
  nuvioToken?: string | null;
  onImport: (collections: CollectionDoc[]) => void;
}) {
  const [items, setItems] = useState<JsonRecord[]>([]);
  const [sort, setSort] = useState('popular');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('Loading public collections…');
  const [detail, setDetail] = useState<{ item: JsonRecord; data: unknown } | null>(null);
  const [busy, setBusy] = useState(false);

  const sessionToken = (nuvioToken ?? '').trim();

  function browse(params: { sort?: string; search?: string; limit?: number }): Promise<unknown> {
    if (sessionToken) return browsePublicCollectionsBySession(sessionToken, params);
    return browsePublicCollections(uuid, params, editToken);
  }

  function fetchDetail(id: string): Promise<unknown> {
    if (sessionToken) return fetchPublicCollectionBySession(sessionToken, id);
    return fetchPublicCollection(uuid, id, editToken);
  }

  useEffect(() => {
    if (!open) return;
    setDetail(null);
    setQuery('');
    setSort('popular');
    setStatus('Loading public collections…');
    browse({ sort: 'popular', limit: 24 })
      .then((data) => {
        setItems(publicItemsFrom(data));
        setStatus('');
      })
      .catch((error) => {
        setItems([]);
        setStatus(apiErrorCopy(error, 'Could not load Nuvio public collections'));
      });
    // Bound to the open transition by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  async function reload(nextSort: string) {
    setSort(nextSort);
    setStatus('Loading public collections…');
    try {
      const data = await browse({ sort: nextSort, limit: 24 });
      setItems(publicItemsFrom(data));
      setStatus('');
    } catch (error) {
      setItems([]);
      setStatus(apiErrorCopy(error, 'Could not load Nuvio public collections'));
    }
  }

  async function preview(id: string) {
    const item = items.find((entry) => publicId(entry) === id);
    if (!item) return;
    setStatus('Loading collection preview…');
    try {
      const data = await fetchDetail(id);
      setDetail({ item, data });
      setStatus('');
    } catch (error) {
      toast(apiErrorCopy(error, 'Could not open public collection'), 'error');
      setStatus('');
    }
  }

  async function importCurrent() {
    if (!detail) return;
    const id = publicId(detail.item);
    setBusy(true);
    try {
      const data = await fetchDetail(id);
      const { collections } = detailCollections(data, detail.item);
      const normalized = collections
        .map((collection, index) => toCollectionDoc(collection, index))
        .filter((collection): collection is CollectionDoc => collection !== null);
      if (!normalized.length) throw new Error('Could not prepare this public collection');
      onImport(normalized);
      onClose();
      toast('Public collection imported. You can now edit every folder.');
    } catch (error) {
      toast(apiErrorCopy(error, 'Could not import public collection'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? items.filter((item) => {
      const envelope = (item['envelope'] || {}) as JsonRecord;
      return [item['title'], item['name'], item['description'], envelope['title']]
        .join(' ').toLowerCase().includes(needle);
    })
    : items;

  function card(item: JsonRecord) {
    const id = publicId(item);
    const requirements = publicRequirements(item);
    const art = publicImage(item);
    const stats = (item['stats'] || {}) as JsonRecord;
    const title = String(item['title'] || item['name'] || (item['envelope'] as JsonRecord)?.['title'] || 'Nuvio collection');
    return (
      <article className="nuvio-public-card" key={id || title}>
        <div className="nuvio-public-art">
          {art ? <img src={art} alt="" loading="lazy" /> : '▦'}
          <span className="nuvio-public-art-label">COMMUNITY PACK</span>
        </div>
        <div className="nuvio-public-copy">
          <div className="nuvio-public-title">
            <div><b className="nuvio-public-eyebrow">NUVIO COLLECTION</b><strong data-i18n-preserve>{title}</strong></div>
            {requirements.length > 0
              ? <span className="nuvio-public-state needs">Needs addon</span>
              : <span className="nuvio-public-state ready">Ready</span>}
          </div>
          <p>{cleanDescription(item['description'] || (item['envelope'] as JsonRecord)?.['description'])}</p>
          <div className="nuvio-public-meta">
            <span>{Number(stats['collectionCount'] || stats['collection_count'] || 1)} collections</span>
            <span>{Number(stats['folderCount'] || stats['folder_count'] || 0)} folders</span>
            <span>{Number(stats['sourceCount'] || stats['source_count'] || 0)} sources</span>
          </div>
          {requirements.length > 0 && (
            <div className="nuvio-public-addon-pills">
              {requirementPills(requirements).map((pill) => (
                <span className="nuvio-public-addon-pill" key={pill.name}>
                  {pill.name}
                  {pill.url && <a href={pill.url} target="_blank" rel="noopener">Open setup ↗</a>}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="nuvio-public-actions">
          <button type="button" className="setup-secondary" onClick={() => void preview(id)}>Preview</button>
        </div>
      </article>
    );
  }

  function detailView(detailData: unknown, item: JsonRecord) {
    const { root, envelope, collections } = detailCollections(detailData, item);
    const title = String(root['title'] || root['name'] || envelope['title'] || item['title'] || 'Nuvio collection');
    return (
      <>
        <button type="button" className="nuvio-public-back" onClick={() => setDetail(null)}>← Back to browse</button>
        <section className="nuvio-public-detail-hero">
          {publicImage(root) || publicImage(envelope) || publicImage(item)
            ? <img src={publicImage(root) || publicImage(envelope) || publicImage(item)} alt="" />
            : <div className="nuvio-public-detail-fallback">▦</div>}
          <div>
            <span className="setup-kicker">Nuvio community collection</span>
            <h3 data-i18n-preserve>{title}</h3>
            <p>{cleanDescription(root['description'] || envelope['description'] || item['description'])}</p>
          </div>
        </section>
        <div className="nuvio-public-detail-packs">
          {collections.map((collection, index) => {
            const folders = Array.isArray(collection['folders']) ? collection['folders'] as JsonRecord[] : [];
            return (
              <section className="nuvio-public-detail-pack" key={String(collection['id'] || index)}>
                <div className="nuvio-public-detail-pack-head">
                  <div>
                    <strong>{String(collection['title'] || collection['name'] || 'Collection')}</strong>
                    <small>{folders.length} folder{folders.length === 1 ? '' : 's'}</small>
                  </div>
                </div>
                <div className="nuvio-public-folder-grid">
                  {folders.map((folder, folderIndex) => {
                    const art = String(folder['coverImageUrl'] || folder['focusGifUrl'] || folder['heroBackdropUrl'] || '');
                    return (
                      <article className="nuvio-public-folder" key={String(folder['id'] || folderIndex)}>
                        <div className="nuvio-public-folder-art">
                          {art ? <img src={art} alt="" loading="lazy" /> : <span>▦</span>}
                        </div>
                        <div>
                          <strong>{String(folder['title'] || folder['name'] || 'Untitled folder')}</strong>
                          <small>{String(folder['tileShape'] || 'Landscape').toLowerCase()}</small>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {collections.length === 0 && (
            <p className="setup-note">Nuvio did not provide the folder preview for this item, but it can still be imported.</p>
          )}
        </div>
        <div className="nuvio-public-detail-actions">
          <button type="button" className="setup-secondary" onClick={() => setDetail(null)}>Back</button>
          <button type="button" className="setup-primary" disabled={busy} onClick={() => void importCurrent()}>
            {busy ? 'Importing…' : 'Import collection'}
          </button>
        </div>
      </>
    );
  }

  return (
    <div
      className="app-modal nuvio-public-modal" role="dialog" aria-modal="true"
      aria-label="Browse Public Collections"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="app-modal-box nuvio-public-dialog">
        <div className="app-modal-head">
          <div>
            <span className="setup-kicker">Nuvio Community</span>
            <h3>Browse Public Collections</h3>
            <p>Import a community collection directly into your LeLibrary Nuvio setup.</p>
          </div>
          <button type="button" className="eye-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="nuvio-public-toolbar">
          <form onSubmit={(event) => event.preventDefault()}>
            <input
              type="search" placeholder="Search collections…" aria-label="Search collections"
              value={query} onChange={(event) => setQuery(event.target.value)}
            />
          </form>
          <select value={sort} onChange={(event) => void reload(event.target.value)} aria-label="Sort collections">
            <option value="popular">Popular</option>
            <option value="recent">Recent</option>
          </select>
        </div>
        <div className="nuvio-public-note">
          <strong>Addon requirements are shown before import</strong>
          <span>Packs that use another addon keep that dependency. Install it in the same Nuvio profile so its folders can load.</span>
        </div>
        <div className="nuvio-public-body">
          {detail ? detailView(detail.data, detail.item) : (
            <>
              {status && <p className="setup-note" role="status">{status}</p>}
              {!status && <p className="setup-note" role="status">{visible.length} collection{visible.length === 1 ? '' : 's'} shown</p>}
              <div className="nuvio-public-list">{visible.map(card)}</div>
            </>
          )}
        </div>
        <div className="app-modal-actions">
          <span />
          <button type="button" className="setup-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
