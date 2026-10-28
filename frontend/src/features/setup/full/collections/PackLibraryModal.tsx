import { useMemo, useState } from 'react';
import { i18n } from '@/i18n';
import { HUB_COVER, type CollectionDoc } from '@/features/setup/shared/collection-doc';
import {
  HUB_SYSTEM_COVER,
  type CuratedFolder,
  type CuratedPack,
} from '@/features/setup/full/collections/curated-packs';
import {
  HOME_FOLDER_WARNING,
  PACK_FILTERS,
  addableFolders,
  folderLocked,
  folderPresence,
  hiddenByRegion,
  inSeason,
  nextSeasonStart,
  packCollectionsIn,
  packGroups,
  packKind,
  packLocked,
  presentSourceIds,
  sizeMeter,
  visibleFolders,
} from '@/features/setup/full/collections/pack-picker-model';
import { regionName } from '@/features/setup/full/collections/region';

const MDBLIST_NOTE = 'Add your MDBList key in Optional list sources to use this';

function uiLanguage(): string {
  return i18n.resolvedLanguage || i18n.language || 'en';
}

function shortDate(date: Date): string {
  try {
    return new Intl.DateTimeFormat(uiLanguage(), { day: 'numeric', month: 'short' }).format(date);
  } catch {
    return date.toDateString();
  }
}

function countLabel(count: number, one: string, many: string): string {
  return count === 1 ? one : many.replace('{{count}}', String(count));
}

// Pack picker for the Move In Collections step: bundled packs first, then
// themed packs, then single collections. Region-aware (from the setup
// language), MDBList-gated, season-aware, and it never adds a catalogue
// source twice. Folders can be unticked in "Peek inside" before adding.
export function PackLibraryModal({
  open, onClose, curated, failed, aliases = {}, collections, region, hasMdblistKey, platform,
  ownedOn, hubOn, onAddPack, onRemovePack, onToggleOwned, onToggleHub, today = new Date(),
}: {
  open: boolean;
  onClose: () => void;
  curated: CuratedPack[];
  failed: boolean;
  aliases?: Record<string, string>;
  collections: CollectionDoc[];
  region: string;
  hasMdblistKey: boolean;
  platform: 'nuvio' | 'stremio';
  ownedOn: boolean;
  hubOn: boolean;
  onAddPack: (pack: CuratedPack, excluded: ReadonlySet<string>) => void;
  onRemovePack: (packId: string) => void;
  onToggleOwned: (on: boolean) => void;
  onToggleHub: () => void;
  today?: Date;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [peek, setPeek] = useState<Record<string, boolean>>({});
  const [excluded, setExcluded] = useState<Record<string, string[]>>({});

  const present = useMemo(() => presentSourceIds(collections, aliases), [collections, aliases]);
  const meter = useMemo(() => sizeMeter(collections, aliases), [collections, aliases]);

  if (!open) return null;

  const context = { region, hasMdblistKey, aliases };
  const country = regionName(region, uiLanguage());
  const needle = query.trim().toLowerCase();
  const matches = (pack: CuratedPack) => {
    if (filter && !(pack.filters ?? []).includes(filter)) return false;
    if (!needle) return true;
    return [pack.title, pack.description, ...pack.sections.map((section) => section.title)]
      .concat(visibleFolders(pack, region).map((folder) => folder.title))
      .join(' ')
      .toLowerCase()
      .includes(needle);
  };
  const shown = curated.filter((pack) => visibleFolders(pack, region).length > 0 && matches(pack));
  const groups: { kind: 'bundle' | 'pack' | 'single'; kicker: string; title: string; note: string }[] = [
    { kind: 'bundle', kicker: 'Start here', title: 'Bundled packs', note: 'Several ready-made collections in one click' },
    { kind: 'pack', kicker: 'Go deeper', title: 'Themed packs', note: 'One theme, explored properly' },
    { kind: 'single', kicker: 'Just one shelf', title: 'Single collections', note: 'Small, focused additions' },
  ];

  // Services (and other regional folders) hidden in this region, counted once
  // per catalogue across every pack.
  const hiddenServices = new Set<string>();
  const hiddenOther = new Set<string>();
  for (const pack of curated) {
    for (const folder of hiddenByRegion(pack, region)) {
      const key = folder.sourceIds?.[0] ?? folder.id;
      if (folder.season) hiddenOther.add(key); else hiddenServices.add(key);
    }
  }

  const showSystemCards = platform !== 'stremio' && (!filter) &&
    (!needle || 'lelibrary movie collections hub your library franchises movies shows'.includes(needle));

  function excludedFor(packId: string): Set<string> {
    return new Set(excluded[packId] ?? []);
  }

  function toggleFolder(packId: string, folderId: string) {
    const current = excludedFor(packId);
    if (current.has(folderId)) current.delete(folderId); else current.add(folderId);
    setExcluded({ ...excluded, [packId]: [...current] });
  }

  function folderNote(pack: CuratedPack, folder: CuratedFolder): string {
    if (folderLocked(pack, folder, hasMdblistKey)) return 'Needs an MDBList key';
    const presence = folderPresence(folder, present, aliases);
    if (presence === 'added') return 'Added';
    if (folder.season) {
      return inSeason(folder.season, today)
        ? 'In season now'
        : `In season from ${shortDate(nextSeasonStart(folder.season, today))}`;
    }
    if (presence === 'partial') return 'Partly added';
    return '';
  }

  function packCard(pack: CuratedPack) {
    const visible = visibleFolders(pack, region);
    const groupsInPack = packGroups({ ...pack, folders: visible });
    const collectionCount = groupsInPack.length;
    const locked = packLocked(pack, hasMdblistKey);
    const skip = excludedFor(pack.id);
    const addable = addableFolders(pack, collections, { ...context, excluded: skip });
    const open = visible.filter((folder) => !folderLocked(pack, folder, hasMdblistKey));
    const allAdded = !locked && open.length > 0 && open.every((folder) => folderPresence(folder, present, aliases) === 'added');
    const removable = packCollectionsIn(collections, pack.id).length > 0;
    const cover = pack.generatedCoverUrl || pack.coverImageUrl
      || visible.find((folder) => folder.coverImageUrl)?.coverImageUrl || '';
    const peekOpen = peek[pack.id] === true;
    const seasonal = visible.some((folder) => folder.season);
    const hiddenHere = pack.folders.length - visible.length;
    return (
      <article className={`pp-card${allAdded && !locked ? ' is-added' : ''}${locked ? ' is-locked' : ''}`} key={pack.id} data-pack={pack.id}>
        <div className="pp-card-main">
          <div className="pp-card-cover">
            {cover ? (
              <img key={cover} src={cover} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} />
            ) : (
              <span className="pp-card-fallback" aria-hidden="true">{pack.icon || '✨'}</span>
            )}
          </div>
          <div className="pp-card-copy">
            <strong className="pp-card-title">{pack.title}</strong>
            <span className="pp-card-counts">
              <span>{countLabel(collectionCount, '1 collection', '{{count}} collections')}</span>
              <span aria-hidden="true"> · </span>
              <span>{countLabel(visible.length, '1 folder', '{{count}} folders')}</span>
            </span>
            <small className="pp-card-description">{pack.description}</small>
            <span className="pp-card-badges">
              {locked && <span className="pp-badge pp-badge-lock">🔒 MDBList key</span>}
              {seasonal && <span className="pp-badge">Seasonal</span>}
              {hiddenHere > 0 && <span className="pp-badge">{`${hiddenHere} not in ${country}`}</span>}
            </span>
          </div>
        </div>
        {locked && <p className="pp-lock-note">{MDBLIST_NOTE}</p>}
        <div className="pp-card-actions">
          <button
            type="button" className="pp-peek" aria-expanded={peekOpen}
            onClick={() => setPeek({ ...peek, [pack.id]: !peekOpen })}
          >
            {peekOpen ? 'Hide folders' : 'Peek inside'}
          </button>
          {removable && (
            <button type="button" className="pp-remove" onClick={() => onRemovePack(pack.id)}>Remove</button>
          )}
          <button
            type="button" className={`pp-add${allAdded ? ' is-added' : ''}`}
            disabled={locked || addable.length === 0}
            onClick={() => onAddPack(pack, skip)}
          >
            {locked ? 'Locked' : addable.length > 0
              ? countLabel(addable.length, 'Add 1 folder', 'Add {{count}} folders')
              : allAdded ? '✓ Added' : 'Nothing selected'}
          </button>
        </div>
        {peekOpen && (
          <div className="pp-peek-body">
            {groupsInPack.map((group) => (
              <section className="pp-peek-group" key={group.id}>
                {collectionCount > 1 || pack.sections.length > 0 ? <h4>{group.title}</h4> : null}
                <ul>
                  {group.folders.map((folder) => {
                    const lockedFolder = folderLocked(pack, folder, hasMdblistKey);
                    const added = folderPresence(folder, present, aliases) === 'added';
                    const note = folderNote(pack, folder);
                    const checked = !lockedFolder && !added && !skip.has(folder.id);
                    return (
                      <li key={folder.id} className={added ? 'is-added' : lockedFolder ? 'is-locked' : ''}>
                        <label>
                          <input
                            type="checkbox" checked={checked || added}
                            disabled={lockedFolder || added}
                            onChange={() => toggleFolder(pack.id, folder.id)}
                          />
                          <span className="pp-folder-title" data-i18n-preserve>{folder.title}</span>
                          {note && <span className="pp-folder-note">{note}</span>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </article>
    );
  }

  function systemCard(kind: 'owned' | 'hub') {
    const on = kind === 'owned' ? ownedOn : hubOn;
    const image = kind === 'owned' ? HUB_SYSTEM_COVER : HUB_COVER;
    const title = kind === 'owned' ? 'LeLibrary Movie Collections' : 'LeLibrary Hub';
    const description = kind === 'owned'
      ? 'Automatically groups your owned films into franchise folders.'
      : 'Keeps My Movies and My Shows together in two simple folders.';
    return (
      <article className={`pp-card pp-card-system${on ? ' is-added' : ''}`} key={kind}>
        <div className="pp-card-main">
          <div className="pp-card-cover pp-card-cover-wide"><img src={image} alt="" loading="lazy" /></div>
          <div className="pp-card-copy">
            <strong className="pp-card-title" data-i18n-preserve>{title}</strong>
            <small className="pp-card-description">{description}</small>
            {kind === 'owned' && <small className="pp-card-description pack-home-row-note">Also adds a Home row for your franchises.</small>}
          </div>
        </div>
        <div className="pp-card-actions">
          <button
            type="button" className={`pp-add${on ? ' is-added' : ''}`}
            onClick={() => { if (kind === 'owned') onToggleOwned(!on); else onToggleHub(); }}
            aria-pressed={on}
          >
            {on ? '✓ Added' : 'Add'}
          </button>
        </div>
      </article>
    );
  }

  const meterPercent = Math.min(100, Math.round((meter.folders / (HOME_FOLDER_WARNING * 1.5)) * 100));

  return (
    <div
      className="app-modal quick-pack-library-modal pack-picker-modal" role="dialog" aria-modal="true"
      aria-label="Find your next collection"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="app-modal-box quick-pack-library pack-picker">
        <div className="app-modal-head quick-pack-library-head">
          <div>
            <span className="setup-kicker">Collection library</span>
            <h3>Find your next collection</h3>
            <p>Untick any folder you do not want before adding. Folders you already have are never added twice.</p>
          </div>
          <button type="button" className="eye-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="pp-toolbar">
          <div className="search-control">
            <input
              type="search" placeholder="Search packs, services, franchises or moods"
              aria-label="Search packs"
              value={query} onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="pp-filters" role="group" aria-label="Filter packs">
            {[{ id: '', label: 'All' }, ...PACK_FILTERS].map((entry) => (
              <button
                key={entry.id || 'all'} type="button"
                className={`pp-filter${entry.id === filter ? ' active' : ''}`}
                aria-pressed={entry.id === filter}
                onClick={() => setFilter(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <p className="pp-region">
            <span>{`Showing what is available in ${country}, from your setup language.`}</span>
            {hiddenServices.size > 0 && (
              <span className="pp-region-hidden">{hiddenServices.size === 1
                ? `1 service isn't available in ${country} and is hidden.`
                : `${hiddenServices.size} services aren't available in ${country} and are hidden.`}</span>
            )}
            {hiddenOther.size > 0 && (
              <span className="pp-region-hidden">{hiddenOther.size === 1
                ? `1 regional folder isn't available in ${country} and is hidden.`
                : `${hiddenOther.size} regional folders aren't available in ${country} and are hidden.`}</span>
            )}
          </p>
        </div>
        {failed ? (
          <p className="setup-error">Could not load Quick Packs.</p>
        ) : (
          <div className="quick-pack-library-scroll pp-scroll">
            {groups.map((group) => {
              const packs = shown.filter((pack) => packKind(pack) === group.kind);
              if (!packs.length) return null;
              return (
                <section className="pp-section" key={group.kind} data-kind={group.kind}>
                  <div className="quick-pack-results-head">
                    <div><span className="setup-kicker">{group.kicker}</span><strong>{group.title}</strong></div>
                    <span>{group.note}</span>
                  </div>
                  <div className="pp-grid">{packs.map(packCard)}</div>
                </section>
              );
            })}
            {shown.length === 0 && (
              <div className="quick-pack-empty">
                <strong>No matching packs</strong>
                <span>Try another search or a different filter.</span>
              </div>
            )}
            {showSystemCards && (
              <section className="pp-section">
                <div className="quick-pack-results-head">
                  <div><span className="setup-kicker">Your library</span><strong>LeLibrary essentials</strong></div>
                  <span>Always kept together at the bottom of Nuvio Collections</span>
                </div>
                <div className="pp-grid">
                  {systemCard('owned')}
                  {systemCard('hub')}
                </div>
              </section>
            )}
          </div>
        )}
        <div className="app-modal-actions quick-pack-library-actions pp-footer">
          <div className={`pp-meter${meter.warn ? ' is-warn' : ''}`}>
            <span className="pp-meter-label">
              <b>{platform === 'stremio' ? 'Collections size' : 'Nuvio Home size'}</b>
              <span>{countLabel(meter.collections, '1 collection', '{{count}} collections')}</span>
              <span aria-hidden="true"> · </span>
              <span>{countLabel(meter.folders, '1 folder', '{{count}} folders')}</span>
            </span>
            <span className="pp-meter-bar" aria-hidden="true"><span style={{ width: `${meterPercent}%` }} /></span>
            {meter.warn && platform !== 'stremio' && (
              <small className="pp-meter-note">Nuvio Home gets crowded above about 60 folders. Untick a few you will not open.</small>
            )}
            {platform === 'stremio' && (
              <small className="pp-meter-note">{meter.catalogues === 1
                ? 'On Stremio each folder source becomes its own catalogue: 1 catalogue.'
                : `On Stremio each folder source becomes its own catalogue: ${meter.catalogues} catalogues.`}</small>
            )}
          </div>
          <button type="button" className="setup-primary" onClick={onClose}>Done choosing packs</button>
        </div>
      </div>
    </div>
  );
}
