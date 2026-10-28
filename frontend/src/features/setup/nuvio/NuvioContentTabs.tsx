import { useEffect, useState, type FormEvent } from 'react';
import { ConfirmModal } from '@/features/setup/shared/Modal';
import { setupCopy, setupCount } from '@/features/setup/shared/setup-copy';
import {
  addNuvioAddon, deleteNuvioCollection, orderNuvioAddons, orderNuvioCollections, removeNuvioAddon,
  saveNuvioHome, setNuvioCollectionHidden, updateNuvioAddon, updateNuvioProfile,
  type NuvioAddon, type NuvioCollection, type NuvioHomeItem, type NuvioProfileDetail,
} from '@/features/setup/nuvio/api';
import {
  OrderBar, ReorderList, Switch, moveItem, sameOrder, sortByOrder, type NuvioCtx,
} from '@/features/setup/nuvio/nuvio-ui';

// Addons, Home rows and collections of one Nuvio profile. Other addons' links
// never reach the browser: a row is a name, a host, on/off and an opaque id.

/** A pasted link, normalised: stremio:// installs become https. */
export function normaliseManifestLink(raw: string): string | null {
  const value = raw.trim().replace(/^stremio:\/\//i, 'https://');
  if (!/^https:\/\/[^\s/]+\.[^\s/]+/i.test(value)) return null;
  return value;
}

export function AddonsTab({ ctx, detail, primaryName }: {
  ctx: NuvioCtx;
  detail: NuvioProfileDetail;
  primaryName: string;
}) {
  const profile = detail.profile;
  const managed = !profile.isPrimary && (profile.usesPrimaryAddons || detail.addonsFrom !== profile.index);
  const saved = sortByOrder(detail.addons);
  const [order, setOrder] = useState<NuvioAddon[]>(saved);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [removing, setRemoving] = useState<NuvioAddon | null>(null);
  const [ownConfirm, setOwnConfirm] = useState(false);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  useEffect(() => { setOrder(sortByOrder(detail.addons)); setRenaming(null); }, [detail.addons]);
  const dirty = !sameOrder(order, saved);
  const { uuid, editToken, run, busy } = ctx;

  function startRename(addon: NuvioAddon) {
    setRenaming(addon.id);
    setRenameValue(addon.name);
  }

  async function saveRename(addon: NuvioAddon) {
    const name = renameValue.trim();
    if (!name || name === addon.name) { setRenaming(null); return; }
    const out = await run(() => updateNuvioAddon(uuid, editToken, profile.index, addon.id, { name }), { undo: profile.index });
    if (out) setRenaming(null);
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const url = normaliseManifestLink(link);
    if (!url) {
      setLinkError(setupCopy('Paste the addon\'s https link (it usually ends in manifest.json).', 'Paste the addon\'s https link (it usually ends in manifest.json).'));
      return;
    }
    setLinkError(null);
    const out = await run(() => addNuvioAddon(uuid, editToken, profile.index, url), {
      undo: profile.index,
      done: setupCopy('Addon added to Nuvio', 'Addon added to Nuvio'),
    });
    // The link is gone from the page either way once it was sent.
    if (out) setLink('');
  }

  if (managed) {
    return (
      <div className="nv-tab">
        <div className="nv-managed">
          <div>
            <strong>Managed on <span data-i18n-preserve>{primaryName}</span></strong>
            <p>This profile uses the main profile's addons, so they are changed there. Switch to that profile to edit them.</p>
          </div>
          <button type="button" className="setup-secondary" disabled={busy} onClick={() => setOwnConfirm(true)}>Give this profile its own addons</button>
        </div>
        {saved.length === 0 ? (
          <p className="nv-empty">The main profile has no addons yet.</p>
        ) : (
          <ol className="nv-list is-readonly">
            {saved.map((addon) => (
              <li key={addon.id} className={`nv-row${addon.enabled ? '' : ' is-off'}`}>
                <div className="nv-row-main"><AddonLabel addon={addon} /></div>
                <span className="nv-state">{addon.enabled ? 'On' : 'Off'}</span>
              </li>
            ))}
          </ol>
        )}
        <ConfirmModal
          open={ownConfirm}
          title="Give this profile its own addons?"
          body={setupCopy(
            'This profile stops using the main profile\'s addons and starts with no addons except the ones you add here. The main profile keeps its own.',
            'This profile stops using the main profile\'s addons and starts with no addons except the ones you add here. The main profile keeps its own.',
          )}
          confirmLabel={setupCopy('Use its own addons', 'Use its own addons')}
          onCancel={() => setOwnConfirm(false)}
          onConfirm={() => {
            setOwnConfirm(false);
            void run(() => updateNuvioProfile(uuid, editToken, profile.index, { usesPrimaryAddons: false }), { reload: 'all', undo: null });
          }}
        />
      </div>
    );
  }

  return (
    <div className="nv-tab">
      <div className="nv-tab-head">
        <div>
          <h2>Addons</h2>
          <p>Drag to reorder, or use the arrows. Nuvio shows sources in this order.</p>
        </div>
        <span className="nv-count">{setupCount(saved.length, 'addon', 'addons')}</span>
      </div>

      {order.length === 0 ? (
        <p className="nv-empty">This profile has no addons yet. Add one below.</p>
      ) : (
        <ReorderList
          items={order}
          keyOf={(addon) => addon.id}
          nameOf={(addon) => addon.name}
          disabled={busy}
          onMove={(from, to) => setOrder((prev) => moveItem(prev, from, to))}
          render={(addon) => (
            <div className={`nv-addon${addon.enabled ? '' : ' is-off'}`}>
              {renaming === addon.id ? (
                <form className="nv-rename" onSubmit={(event) => { event.preventDefault(); void saveRename(addon); }}>
                  <input
                    type="text" value={renameValue} maxLength={80} autoFocus
                    aria-label="New name" onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null); }}
                  />
                  <button type="submit" className="setup-primary" disabled={busy || !renameValue.trim()}>Save</button>
                  <button type="button" className="setup-secondary" onClick={() => setRenaming(null)}>Cancel</button>
                </form>
              ) : (
                <AddonLabel addon={addon} />
              )}
              <div className="nv-row-actions">
                <Switch
                  checked={addon.enabled} disabled={busy}
                  ariaLabel={setupCopy('Use {{name}}', 'Use {{name}}', { name: addon.name })}
                  onChange={(enabled) => void run(() => updateNuvioAddon(uuid, editToken, profile.index, addon.id, { enabled }), { undo: profile.index })}
                />
                {renaming !== addon.id && (
                  <button type="button" className="nv-text-btn" disabled={busy} onClick={() => startRename(addon)}>Rename</button>
                )}
                {!addon.isLeLibrary && (
                  <button type="button" className="nv-text-btn is-danger" disabled={busy} onClick={() => setRemoving(addon)}>Remove</button>
                )}
              </div>
            </div>
          )}
        />
      )}
      <OrderBar
        dirty={dirty} busy={busy} label={setupCopy('Save order', 'Save order')}
        onReset={() => setOrder(saved)}
        onSave={() => void run(() => orderNuvioAddons(uuid, editToken, profile.index, order.map((addon) => addon.id)), { undo: profile.index })}
      />

      <form className="nv-add" onSubmit={(event) => void add(event)}>
        <strong>Add an addon</strong>
        <small>Paste the addon's install link. Links often contain private keys: LeLibrary sends it to Nuvio once and never shows it again.</small>
        <div className="nv-add-row">
          <input
            type="url" inputMode="url" autoComplete="off" spellCheck={false}
            value={link} onChange={(event) => { setLink(event.target.value); setLinkError(null); }}
            placeholder="https://…/manifest.json" aria-label="Addon link"
          />
          <button type="submit" className="setup-primary" disabled={busy || !link.trim()}>{busy ? 'Adding…' : 'Add'}</button>
        </div>
        {linkError && <p className="setup-error" role="alert">{linkError}</p>}
      </form>

      <ConfirmModal
        open={removing !== null}
        title="Remove this addon?"
        body={setupCopy(
          'It is removed from this profile on every device. To get it back you need its install link again.',
          'It is removed from this profile on every device. To get it back you need its install link again.',
        )}
        confirmLabel={setupCopy('Remove', 'Remove')}
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const addon = removing;
          setRemoving(null);
          if (addon && !addon.isLeLibrary) {
            void run(() => removeNuvioAddon(uuid, editToken, profile.index, addon.id), {
              undo: profile.index,
              done: setupCopy('Addon removed from Nuvio', 'Addon removed from Nuvio'),
            });
          }
        }}
      />
    </div>
  );
}

function AddonLabel({ addon }: { addon: NuvioAddon }) {
  return (
    <div className="nv-addon-label">
      <strong data-i18n-preserve>{addon.name}</strong>
      <span className="nv-addon-meta">
        {addon.isLeLibrary && <em className="nv-badge">This setup</em>}
        {!addon.enabled && <em className="nv-badge is-muted">Off</em>}
        {addon.host && <small data-i18n-preserve>{addon.host}</small>}
      </span>
    </div>
  );
}

export function HomeTab({ ctx, detail }: { ctx: NuvioCtx; detail: NuvioProfileDetail }) {
  const profile = detail.profile;
  const { uuid, editToken, run, busy } = ctx;
  const savedItems = sortByOrder(detail.home.items);
  const savedCollections = detail.collections;
  const [items, setItems] = useState<NuvioHomeItem[]>(savedItems);
  const [collections, setCollections] = useState<NuvioCollection[]>(savedCollections);
  const [deleting, setDeleting] = useState<NuvioCollection | null>(null);
  useEffect(() => { setItems(sortByOrder(detail.home.items)); }, [detail.home.items]);
  useEffect(() => { setCollections(detail.collections); }, [detail.collections]);

  const homeDirty = !sameOrder(items, savedItems) || items.some((item, i) => item.enabled !== savedItems[i]?.enabled);
  const collectionsDirty = !sameOrder(collections, savedCollections);

  return (
    <div className="nv-tab">
      <section className="nv-section">
        <div className="nv-tab-head">
          <div>
            <h2>Home</h2>
            <p>The rows on Nuvio's Home screen, top to bottom. Hidden rows stay installed.</p>
          </div>
          <span className="nv-count">{setupCount(items.filter((item) => item.enabled).length, 'row shown', 'rows shown')}</span>
        </div>
        {items.length === 0 ? (
          <p className="nv-empty">Nuvio has no Home layout saved for this profile yet. Open Home on a device once and it appears here.</p>
        ) : (
          <ReorderList
            items={items}
            keyOf={(item) => item.key}
            nameOf={(item) => item.title}
            disabled={busy}
            onMove={(from, to) => setItems((prev) => moveItem(prev, from, to))}
            render={(item) => (
              <div className={`nv-addon${item.enabled ? '' : ' is-off'}`}>
                <div className="nv-addon-label">
                  <strong data-i18n-preserve>{item.title}</strong>
                  <span className="nv-addon-meta">
                    {item.isCollection && <em className="nv-badge">Collection</em>}
                    {!item.isCollection && <small data-i18n-preserve>{item.type}</small>}
                  </span>
                </div>
                <div className="nv-row-actions">
                  <Switch
                    checked={item.enabled} disabled={busy}
                    ariaLabel={setupCopy('Show {{name}} on Home', 'Show {{name}} on Home', { name: item.title })}
                    onChange={(enabled) => setItems((prev) => prev.map((row) => (row.key === item.key ? { ...row, enabled } : row)))}
                  />
                </div>
              </div>
            )}
          />
        )}
        <OrderBar
          dirty={homeDirty} busy={busy} label={setupCopy('Save Home', 'Save Home')}
          onReset={() => setItems(savedItems)}
          onSave={() => void run(() => saveNuvioHome(uuid, editToken, profile.index, items.map((item) => ({ key: item.key, enabled: item.enabled }))), { undo: profile.index })}
        />
      </section>

      <section className="nv-section">
        <div className="nv-tab-head">
          <div>
            <h2>Collections</h2>
            <p>Hide a collection to keep it off Home. Only LeLibrary's own collections can be deleted here.</p>
          </div>
          <span className="nv-count">{setupCount(collections.length, 'collection', 'collections')}</span>
        </div>
        {collections.length === 0 ? (
          <p className="nv-empty">This profile has no collections.</p>
        ) : (
          <ReorderList
            items={collections}
            keyOf={(collection) => collection.id}
            nameOf={(collection) => collection.title}
            disabled={busy}
            onMove={(from, to) => setCollections((prev) => moveItem(prev, from, to))}
            render={(collection) => (
              <div className={`nv-addon${collection.hidden ? ' is-off' : ''}`}>
                <div className="nv-addon-label">
                  <strong data-i18n-preserve>{collection.title}</strong>
                  <span className="nv-addon-meta">
                    {collection.isLeLibrary && <em className="nv-badge">LeLibrary</em>}
                    <small>{setupCount(collection.folders, 'folder', 'folders')}</small>
                  </span>
                </div>
                <div className="nv-row-actions">
                  <Switch
                    checked={!collection.hidden} disabled={busy || collectionsDirty}
                    ariaLabel={setupCopy('Show {{name}} on Home', 'Show {{name}} on Home', { name: collection.title })}
                    onChange={(shown) => void run(() => setNuvioCollectionHidden(uuid, editToken, profile.index, collection.id, !shown), { undo: profile.index })}
                  />
                  {collection.isLeLibrary && (
                    <button type="button" className="nv-text-btn is-danger" disabled={busy} onClick={() => setDeleting(collection)}>Delete</button>
                  )}
                </div>
              </div>
            )}
          />
        )}
        <OrderBar
          dirty={collectionsDirty} busy={busy} label={setupCopy('Save order', 'Save order')}
          onReset={() => setCollections(savedCollections)}
          onSave={() => void run(() => orderNuvioCollections(uuid, editToken, profile.index, collections.map((collection) => collection.id)), { undo: profile.index })}
        />
      </section>

      <ConfirmModal
        open={deleting !== null}
        title="Delete this collection?"
        body={setupCopy(
          'It is removed from this Nuvio profile. Pushing this setup again brings LeLibrary\'s collections back.',
          'It is removed from this Nuvio profile. Pushing this setup again brings LeLibrary\'s collections back.',
        )}
        confirmLabel={setupCopy('Delete', 'Delete')}
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const collection = deleting;
          setDeleting(null);
          if (collection?.isLeLibrary) void run(() => deleteNuvioCollection(uuid, editToken, profile.index, collection.id), { undo: profile.index });
        }}
      />
    </div>
  );
}
