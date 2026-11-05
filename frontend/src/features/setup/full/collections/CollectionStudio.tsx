import { useMemo, useState } from 'react';
import { toast } from '@/features/setup/shared/Toast';
import { nativeLibraryRows, DISCOVERY_ROWS,
  HUB_COLLECTION_ID,
  collectionDefault,
  collectionEntries,
  folderDefault,
  moveCollectionEntry,
  slotAfterRemoving,
  hubCollection,
  orderCollections,
  type CollectionDoc,
} from '@/features/setup/shared/collection-doc';
import {
  focusGifLibrary,
  removePackFromCollections,
  useCuratedPacks,
  type CuratedPack,
} from '@/features/setup/full/collections/curated-packs';
import { addPackFolders, packKind, sizeMeter, specialExtras, SPECIAL_PACK_ID } from '@/features/setup/full/collections/pack-picker-model';
import { regionForLang } from '@/features/setup/full/collections/region';
import { CollectionCard, MovieCollectionsCard, applyCollectionField } from '@/features/setup/full/collections/CollectionCard';
import { FolderEditorModal } from '@/features/setup/full/collections/FolderEditorModal';
import { PackLibraryModal } from '@/features/setup/full/collections/PackLibraryModal';
import { useCatalogSources } from '@/features/setup/full/collections/catalog-sources';
import { NuvioPublicModal } from '@/features/setup/full/NuvioPublicModal';
import { NO_USER_LISTS, useMdblistLists, userListPickerRows, type UserListsContext } from '@/features/setup/shared/user-lists';
import { MdblistListsStatus } from '@/features/setup/shared/MdblistListsStatus';

// Collections studio: the list of Nuvio collections, the Quick Pack launch
// block and its library, the public Nuvio directory browser, plus the
// LeLibrary Hub system toggle.
export function CollectionStudio({ collections, onChange, providerPrefix, platform, packs, onPacks, ownedOn, onToggleOwned, owned = null, onOwned, nuvioToken, savedSetup, lang, hasMdblistKey = false, hideAnime = false, defaultOpenId = null, userLists = NO_USER_LISTS }: {
  collections: CollectionDoc[];
  onChange: (next: CollectionDoc[]) => void;
  providerPrefix: string | null;
  platform: 'nuvio' | 'stremio';
  packs: string[];
  onPacks: (next: string[]) => void;
  ownedOn: boolean;
  // `slot`: where a newly turned-on Movie Collections goes (default: last).
  onToggleOwned: (on: boolean, slot?: number) => void;
  // Nuvio: Movie Collections as a card in the list (on), with its slot among
  // the collections (null = first) and its typed name ('' = Nuvio's own).
  owned?: { slot: number | null; title: string } | null;
  onOwned?: (patch: { slot?: number | null; title?: string }) => void;
  // Draft Nuvio session for the pre-creation public browser (no setup row
  // exists yet). Absent on Stremio setups and before Nuvio is connected.
  nuvioToken?: string | null;
  // Editing a saved setup whose Nuvio login is sealed on the server: browse
  // through the setup's own proxy (which also renews the session).
  savedSetup?: { uuid: string; editToken: string };
  // Setup language (meta.lang): the pack picker's watch region comes from it.
  lang?: string;
  // Hide anime: packs come without anime sources and anime-only folders.
  hideAnime?: boolean;
  // An MDBList key is typed in or already saved ("Optional list sources").
  hasMdblistKey?: boolean;
  // Every collection starts closed; tests open one to inspect its tiles.
  defaultOpenId?: string | null;
  // "Your lists" (v6): personal rows a folder can use (shared/user-lists.ts).
  userLists?: UserListsContext;
}) {
  const canBrowse = Boolean(nuvioToken) || Boolean(savedSetup);
  const [openId, setOpenId] = useState<string | null>(defaultOpenId);
  // A new folder lives only in the editor (`draft`) until Save, so Cancel leaves
  // the collection untouched.
  const [editor, setEditor] = useState<{ ci: number; fi: number; draft?: CollectionDoc['folders'][number] } | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [publicOpen, setPublicOpen] = useState(false);
  const { packs: curated, failed: packsFailed, aliases } = useCuratedPacks({ hideAnime });
  const region = regionForLang(lang);
  // Real catalogue names, so a folder source never shows its internal id.
  const { sources: catalogSources } = useCatalogSources(providerPrefix, platform);
  const sourceNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const source of catalogSources) if (source.name) map[source.catalogId] = source.name;
    return map;
  }, [catalogSources]);
  const gifLibrary = useMemo(() => focusGifLibrary(curated), [curated]);

  const hubOn = collections.some((collection) => collection.id === HUB_COLLECTION_ID);
  // LeLibrary's own rows lead the folder source picker. The Stremio-only
  // "LeLibrary Collections" row is a collection, not a folder source.
  // Then the setup's own lists; the MDBList lists load once a folder editor
  // opens.
  const mdblistLists = useMdblistLists(userLists.mdblistSource, editor !== null);
  const folderLeadingSources = useMemo(() => [
    ...nativeLibraryRows(providerPrefix, platform).filter((row) => !row.nativeCollection),
    ...DISCOVERY_ROWS,
    ...userListPickerRows(userLists.services, mdblistLists.lists),
  ], [providerPrefix, platform, userLists.services, mdblistLists.lists]);
  // Every card moves, the Hub and Movie Collections included (its place is its
  // Nuvio place).
  const entries = collectionEntries(collections.length, owned ? owned.slot ?? 0 : null);
  const bundleCount = curated.filter((pack) => packKind(pack) === 'bundle').length;
  const packCount = curated.filter((pack) => packKind(pack) !== 'bundle').length;
  const meter = sizeMeter(collections, aliases);

  function importPublic(cols: CollectionDoc[]) {
    const known = new Set(collections.map((collection) => collection.id));
    const fresh = cols.filter((collection) => !known.has(collection.id));
    if (fresh.length === 0) {
      toast('Those collections are already in this setup');
      return;
    }
    onChange(orderCollections([...collections, ...fresh]));
  }

  // Adding materialises only the chosen, new folders as editable copies. The
  // pack id is not recorded: the manifest and the push follow the folders
  // themselves, so an unticked folder never comes back through the pack.
  function addPack(pack: CuratedPack, excluded: ReadonlySet<string>) {
    const next = addPackFolders(collections, pack, { region, hasMdblistKey, excluded, aliases });
    // LeLibrary Special is the whole LeLibrary set: it brings the Hub (My
    // Movies, My Shows, 4K, HDR, Genres) and the Movie Collections with it.
    // Removing Special leaves them: they stay their own cards.
    if (pack.id === SPECIAL_PACK_ID) {
      const extra = specialExtras({
        packId: pack.id, collections: next.collections, hubOn, ownedOn,
        makeHub: providerPrefix ? () => hubCollection(providerPrefix, window.location.origin) : null,
      });
      if (next.added === 0 && !extra.addedHub && !extra.turnOnOwned) {
        toast('Those folders are already in this setup');
        return;
      }
      onChange(orderCollections(extra.collections));
      if (extra.turnOnOwned) onToggleOwned(true, extra.ownedSlot);
      if (extra.addedHub) toast('LeLibrary Special added, with the LeLibrary Hub and Movie Collections');
      else if (extra.turnOnOwned) toast('LeLibrary Special added, with your Movie Collections');
      else if (!providerPrefix) toast('LeLibrary Special added. Connect a debrid provider to add the LeLibrary Hub and Movie Collections too.');
      return;
    }
    if (next.added === 0) {
      toast('Those folders are already in this setup');
      return;
    }
    onChange(orderCollections(next.collections));
  }

  function removePack(packId: string) {
    const next = removePackFromCollections(collections, packs, packId);
    onChange(orderCollections(next.collections));
    if (next.packs.length !== packs.length) onPacks(next.packs);
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
    if (owned && onOwned) onOwned({ slot: slotAfterRemoving(owned.slot ?? 0, index, collections.length) });
    if (editor && collections[editor.ci]?.id === removed.id) setEditor(null);
    if (openId === removed.id) setOpenId(next[0]?.id ?? null);
    onChange(orderCollections(next));
  }

  // Moves a card in the shown list, where Movie Collections (when on) sits
  // among the collections and swaps places like any other card.
  function moveEntry(at: number, delta: -1 | 1) {
    const moved = moveCollectionEntry(collections, owned ? owned.slot ?? 0 : null, at, delta);
    if (moved.collections !== collections) onChange(orderCollections(moved.collections));
    if (owned && onOwned && moved.slot !== (owned.slot ?? 0)) onOwned({ slot: moved.slot });
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
          <span className="quick-pack-kicker">{`${bundleCount} bundles · ${packCount} packs`}</span>
          <strong>Find a collection that fits the moment</strong>
          <small>Start with a bundle, or pick themed packs and single collections. Peek inside and untick anything you do not want.</small>
          <div className="quick-pack-launch-tags"><span>One-click setup</span><span>Fully editable</span><span>Live sources</span></div>
        </div>
        <div className="quick-pack-launch-actions">
          <span>{meter.folders === 1 ? '1 folder' : `${meter.folders} folders`}</span>
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
      {collections.length === 0 && !owned && (
        <p className="setup-note">No collections yet. Start one above, or add the Hub for My Movies and My Shows.</p>
      )}
      {platform === 'nuvio' && !owned && (
        <label className="switch-row hr-owned">
          <span><strong>LeLibrary Movie Collections</strong><small>Your owned films, automatically grouped into franchise folders.</small></span>
          <input type="checkbox" checked={false} onChange={() => onToggleOwned(true)} />
          <i aria-hidden="true" />
        </label>
      )}
      {entries.map((entry, at) => {
        if (entry.kind === 'owned') {
          return (
            <MovieCollectionsCard
              key="movie-collections"
              title={owned?.title ?? ''}
              disableUp={at === 0}
              disableDown={at === entries.length - 1}
              onTitle={(title) => onOwned?.({ title })}
              onMove={(delta) => moveEntry(at, delta)}
              onRemove={() => onToggleOwned(false)}
            />
          );
        }
        const index = entry.index;
        const collection = collections[index];
        if (!collection) return null;
        return (
        <CollectionCard
          key={collection.id}
          collection={collection}
          open={openId === collection.id}
          system={collection.id === HUB_COLLECTION_ID}
          names={sourceNames}
          disableUp={at === 0}
          disableDown={at === entries.length - 1}
          onToggle={() => setOpenId((current) => (current === collection.id ? null : collection.id))}
          onTitle={(title) => update(index, { ...collection, title })}
          onRemove={() => removeCollection(index)}
          onMove={(delta) => moveEntry(at, delta)}
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
        );
      })}
      <PackLibraryModal
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        curated={curated}
        failed={packsFailed}
        aliases={aliases}
        collections={collections}
        region={region}
        hasMdblistKey={hasMdblistKey}
        ownedOn={ownedOn}
        hubOn={hubOn}
        platform={platform}
        onAddPack={addPack}
        onRemovePack={removePack}
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
          leadingSources={folderLeadingSources}
          sourceNotice={userLists.mdblistSource
            ? <MdblistListsStatus state={mdblistLists.state} count={mdblistLists.lists.length} onReload={mdblistLists.reload} />
            : null}
          onSave={saveFolder}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
