import { useMemo, useState } from 'react';
import { toast } from '@/features/setup/shared/Toast';
import {
  HUB_COLLECTION_ID,
  collectionDefault,
  folderDefault,
  hubCollection,
  orderCollections,
  type CollectionDoc,
} from '@/features/setup/shared/collection-doc';
import {
  addPackToCollections,
  focusGifLibrary,
  removePackFromCollections,
  useCuratedPacks,
} from '@/features/setup/full/collections/curated-packs';
import { CollectionCard, applyCollectionField } from '@/features/setup/full/collections/CollectionCard';
import { FolderEditorModal } from '@/features/setup/full/collections/FolderEditorModal';
import { PackLibraryModal } from '@/features/setup/full/collections/PackLibraryModal';
import { useCatalogSources } from '@/features/setup/full/collections/catalog-sources';
import { NuvioPublicModal } from '@/features/setup/full/NuvioPublicModal';

// Collections studio: the list of Nuvio collections, the Quick Pack launch
// block and its library, the public Nuvio directory browser, plus the
// LeLibrary Hub system toggle.
export function CollectionStudio({ collections, onChange, providerPrefix, platform, packs, onPacks, ownedOn, onToggleOwned, nuvioToken, savedSetup }: {
  collections: CollectionDoc[];
  onChange: (next: CollectionDoc[]) => void;
  providerPrefix: string | null;
  platform: 'nuvio' | 'stremio';
  packs: string[];
  onPacks: (next: string[]) => void;
  ownedOn: boolean;
  onToggleOwned: (on: boolean) => void;
  // Draft Nuvio session for the pre-creation public browser (no setup row
  // exists yet). Absent on Stremio setups and before Nuvio is connected.
  nuvioToken?: string | null;
  // Editing a saved setup whose Nuvio login is sealed on the server: browse
  // through the setup's own proxy (which also renews the session).
  savedSetup?: { uuid: string; editToken: string };
}) {
  const canBrowse = Boolean(nuvioToken) || Boolean(savedSetup);
  const [openId, setOpenId] = useState<string | null>(collections[0]?.id ?? null);
  // A new folder lives only in the editor (`draft`) until Save, so Cancel leaves
  // the collection untouched.
  const [editor, setEditor] = useState<{ ci: number; fi: number; draft?: CollectionDoc['folders'][number] } | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [publicOpen, setPublicOpen] = useState(false);
  const { packs: curated, failed: packsFailed } = useCuratedPacks();
  // Real catalogue names, so a folder source never shows its internal id.
  const { sources: catalogSources } = useCatalogSources(providerPrefix, platform);
  const sourceNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const source of catalogSources) if (source.name) map[source.catalogId] = source.name;
    return map;
  }, [catalogSources]);
  const gifLibrary = useMemo(() => focusGifLibrary(curated), [curated]);

  const hubOn = collections.some((collection) => collection.id === HUB_COLLECTION_ID);
  const regularCount = collections.filter((collection) => collection.id !== HUB_COLLECTION_ID).length;
  const packCount = curated.filter((pack) => (pack.folderCount || pack.folders.length) > 1).length;
  const starterCount = curated.length - packCount;
  const selectedCount = packs.length + (ownedOn ? 1 : 0) + (hubOn ? 1 : 0);

  function importPublic(cols: CollectionDoc[]) {
    const known = new Set(collections.map((collection) => collection.id));
    const fresh = cols.filter((collection) => !known.has(collection.id));
    if (fresh.length === 0) {
      toast('Those collections are already in this setup');
      return;
    }
    onChange(orderCollections([...collections, ...fresh]));
    const first = fresh[0];
    if (first) setOpenId(first.id);
  }

  function togglePackById(id: string) {
    const pack = curated.find((entry) => entry.id === id);
    if (!pack) return;
    if (packs.includes(id)) {
      const next = removePackFromCollections(collections, packs, id);
      onChange(orderCollections(next.collections));
      onPacks(next.packs);
      return;
    }
    const next = addPackToCollections(collections, packs, pack);
    onChange(orderCollections(next.collections));
    onPacks(next.packs);
    if (next.openedId) setOpenId(next.openedId);
  }

  function update(index: number, next: CollectionDoc) {
    const copy = collections.slice();
    copy[index] = next;
    onChange(orderCollections(copy));
  }

  function addCollection() {
    const doc = collectionDefault();
    onChange(orderCollections([...collections, doc]));
    setOpenId(doc.id);
  }

  function removeCollection(index: number) {
    if (collections.length <= 1) {
      toast('Keep at least one collection', 'error');
      return;
    }
    const removed = collections[index];
    if (!removed) return;
    const next = collections.filter((_, at) => at !== index);
    if (editor && collections[editor.ci]?.id === removed.id) setEditor(null);
    if (openId === removed.id) setOpenId(next[0]?.id ?? null);
    onChange(orderCollections(next));
  }

  function moveCollection(index: number, delta: -1 | 1) {
    const collection = collections[index];
    if (!collection || collection.id === HUB_COLLECTION_ID) return;
    const target = index + delta;
    if (target < 0 || target >= regularCount) return;
    const next = collections.slice();
    next.splice(index, 1);
    next.splice(target, 0, collection);
    onChange(orderCollections(next));
  }

  function toggleHub() {
    if (hubOn) {
      onChange(orderCollections(collections.filter((collection) => collection.id !== HUB_COLLECTION_ID)));
      return;
    }
    if (!providerPrefix) {
      toast('Connect a debrid provider to add My Movies and My Shows', 'error');
      return;
    }
    const hub = hubCollection(providerPrefix, window.location.origin);
    onChange(orderCollections([...collections, hub]));
    setOpenId(hub.id);
  }

  function addFolder(ci: number) {
    const collection = collections[ci];
    if (!collection) return;
    setOpenId(collection.id);
    setEditor({ ci, fi: collection.folders.length, draft: folderDefault() });
  }

  function saveFolder(next: CollectionDoc['folders'][number]) {
    if (!editor) return;
    const collection = collections[editor.ci];
    if (!collection) { setEditor(null); return; }
    const folders = collection.folders.slice();
    folders[editor.fi] = next;
    update(editor.ci, { ...collection, folders });
    setEditor(null);
  }

  function removeFolder(ci: number, fi: number) {
    const collection = collections[ci];
    if (!collection) return;
    update(ci, { ...collection, folders: collection.folders.filter((_, at) => at !== fi) });
  }

  function moveFolder(ci: number, from: number, to: number) {
    const collection = collections[ci];
    if (!collection || from === to) return;
    const folders = collection.folders.slice();
    const [moved] = folders.splice(from, 1);
    if (!moved) return;
    folders.splice(to, 0, moved);
    update(ci, { ...collection, folders });
  }

  const editorPos = editor;
  const editorCollection = editorPos ? collections[editorPos.ci] : undefined;
  const editorFolder = editorPos && editorCollection ? (editorPos.draft ?? editorCollection.folders[editorPos.fi]) : undefined;

  return (
    <div className="collections-studio">
      <div className="studio-toolbar">
        <button type="button" className="setup-secondary" onClick={addCollection}>New collection</button>
      </div>
      <div className="quick-pack-launch">
        <div className="quick-pack-launch-icon" aria-hidden="true">▦</div>
        <div className="quick-pack-launch-copy">
          <span className="quick-pack-kicker">{packCount} collection packs · {starterCount} focused starters</span>
          <strong>Find a collection that fits the moment</strong>
          <small>Browse complete multi-folder collections first, then open focused starters when you only need one shelf.</small>
          <div className="quick-pack-launch-tags"><span>One-click setup</span><span>Fully editable</span><span>Live sources</span></div>
        </div>
        <div className="quick-pack-launch-actions">
          <span><b>{selectedCount}</b> selected</span>
          <button type="button" className="setup-primary" onClick={() => setLibraryOpen(true)}>Explore Quick Packs →</button>
        </div>
      </div>
      {packsFailed && <p className="setup-note">Quick Packs could not be loaded.</p>}
      {platform === 'nuvio' && (
        <div className="quick-pack-launch">
          <div className="quick-pack-launch-icon" aria-hidden="true">🌐</div>
          <div className="quick-pack-launch-copy">
            <span className="quick-pack-kicker">Nuvio community directory</span>
            <strong>Browse public Nuvio collections</strong>
            <small>Preview community packs and import the folders you want. Everything stays editable afterwards.</small>
          </div>
          <div className="quick-pack-launch-actions">
            <button
              type="button" className="setup-primary"
              disabled={!canBrowse}
              title={canBrowse ? 'Browse the public directory' : 'Connect Nuvio in Step 1 first'}
              onClick={() => setPublicOpen(true)}
            >
              Browse public →
            </button>
          </div>
        </div>
      )}
      {platform === 'nuvio' && !canBrowse && (
        <p className="setup-note">Connect Nuvio in Step 1 to browse public collections.</p>
      )}
      {collections.length === 0 && (
        <p className="setup-note">No collections yet. Start one above, or add the Hub for My Movies and My Shows.</p>
      )}
      {collections.map((collection, index) => (
        <CollectionCard
          key={collection.id}
          collection={collection}
          open={openId === collection.id}
          system={collection.id === HUB_COLLECTION_ID}
          names={sourceNames}
          disableUp={index === 0}
          disableDown={index >= regularCount - 1}
          onToggle={() => setOpenId((current) => (current === collection.id ? null : collection.id))}
          onTitle={(title) => update(index, { ...collection, title })}
          onRemove={() => removeCollection(index)}
          onMove={(delta) => moveCollection(index, delta)}
          onField={(field, value) => update(index, applyCollectionField(collection, field, value))}
          onBool={(field) => {
            if (field === 'focusGlowEnabled' || field === 'showAllTab') {
              update(index, { ...collection, [field]: !(collection[field] !== false) });
            } else {
              update(index, { ...collection, [field]: !collection[field] });
            }
          }}
          onAddFolder={() => addFolder(index)}
          onEditFolder={(fi) => setEditor({ ci: index, fi })}
          onRemoveFolder={(fi) => removeFolder(index, fi)}
          onMoveFolder={(from, to) => moveFolder(index, from, to)}
        />
      ))}
      <PackLibraryModal
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        curated={curated}
        failed={packsFailed}
        selectedIds={packs}
        ownedOn={ownedOn}
        hubOn={hubOn}
        platform={platform}
        onTogglePack={togglePackById}
        onToggleOwned={onToggleOwned}
        onToggleHub={toggleHub}
      />
      {platform === 'nuvio' && (
        <NuvioPublicModal
          open={publicOpen}
          onClose={() => setPublicOpen(false)}
          uuid={savedSetup?.uuid ?? ''}
          editToken={savedSetup?.editToken ?? ''}
          nuvioToken={nuvioToken ?? null}
          onImport={importPublic}
        />
      )}
      {editorFolder && (
        <FolderEditorModal
          folder={editorFolder}
          gifLibrary={gifLibrary}
          names={sourceNames}
          onSave={saveFolder}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
