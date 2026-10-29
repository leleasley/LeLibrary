import { useState } from 'react';
import {
  importOldSetup,
  lookupAccount,
  type AccountLookup,
  type OldSetupData,
} from '@/features/setup/resolver/api';
import {
  cleanImportedDocs,
  importedKeys,
  importPushConn,
  mergeImportPreview,
} from '@/features/setup/full/import-merge';
import type { StagedImport } from '@/features/setup/full/full-draft';
import type { CollectionDoc, HomeRowDoc } from '@/features/setup/shared/collection-doc';
import type { SetupKeysDraft } from '@/features/setup/shared/config-contract';
import type { PlatformConnection } from '@/features/setup/full/platform-login';

function formatDate(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Everything one Import click folds into the page: settings merge, key
// values fill their inputs, collection/home-row documents merge, and a saved
// platform login reconnects. Creation afterwards is an ordinary create.
export interface ImportedPayload {
  merge: ReturnType<typeof mergeImportPreview>;
  keys: SetupKeysDraft;
  collections: CollectionDoc[];
  homeRows: HomeRowDoc[];
  pushConn: PlatformConnection | null;
  // Raw old config for tier-specific extras (media sets live outside the
  // shared merge).
  config: Record<string, unknown>;
}

// Move In's import entry: a launch button at the top of the flow that opens
// the old-setup browser. Picking a setup imports everything at once - keys,
// logins, settings, collections - straight into the draft, no password at
// any point before creation.
export function ImportSection({ staged, platform, keepsCollections = true, onStage }: {
  staged: StagedImport | null;
  platform: 'nuvio' | 'stremio';
  // Settle In does not build collections, so it does not bring an old setup's
  // collections across (Move In does). They go when the old account is removed.
  keepsCollections?: boolean;
  onStage: (next: StagedImport | null, payload?: ImportedPayload) => void;
}) {
  const [open, setOpen] = useState(false);
  // What an import carries, shown as ticks before and chips after staging.
  const carries = ['Keys', 'Logins', 'Settings', 'Home rows', ...(keepsCollections ? ['Collections'] : [])];
  const found = staged
    ? [
      staged.keyCount === 1 ? '1 key' : `${staged.keyCount} keys`,
      staged.hasLogin ? 'Your login' : '',
      keepsCollections && staged.collectionCount > 0 ? (staged.collectionCount === 1 ? '1 collection' : `${staged.collectionCount} collections`) : '',
      staged.homeRowCount > 0 ? (staged.homeRowCount === 1 ? '1 home row' : `${staged.homeRowCount} home rows`) : '',
    ].filter(Boolean)
    : [];
  const droppedNote = staged && !keepsCollections && staged.collectionCount > 0
    ? (staged.collectionCount === 1
      ? `Its ${staged.collectionCount} collection is not brought across: Settle In does not build collections, and it is removed with your old account. Use Move In to keep it.`
      : `Its ${staged.collectionCount} collections are not brought across: Settle In does not build collections, and they are removed with your old account. Use Move In to keep them.`)
    : '';

  return (
    <>
      {!staged ? (
        <section className="imp-card" aria-labelledby="imp-title">
          <div className="imp-glyph" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none">
              <rect x="5" y="15" width="17" height="17" rx="4" stroke="currentColor" strokeWidth="2.2" opacity="0.45" />
              <path d="M24 23.5h9m0 0-3.5-3.5M33 23.5 29.5 27" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="34.5" y="13" width="9" height="21" rx="3" fill="currentColor" opacity="0.18" stroke="currentColor" strokeWidth="2.2" />
            </svg>
          </div>
          <div className="imp-main">
            <span className="imp-kicker">Coming from the old setup</span>
            <h3 id="imp-title">Bring your old setup across</h3>
            <p>Find it with your email and everything comes with it. No retyping.</p>
            <ul className="imp-carries" aria-label="What comes with it">
              {carries.map((item) => <li key={item}><span aria-hidden="true">✓</span>{item}</li>)}
            </ul>
          </div>
          <div className="imp-side">
            <button type="button" className="setup-primary imp-go" onClick={() => setOpen(true)}>
              Import old setup <span aria-hidden="true">→</span>
            </button>
            <ol className="imp-steps">
              <li>Enter your email</li>
              <li>Pick a setup</li>
              <li>Review and create</li>
            </ol>
          </div>
        </section>
      ) : (
        <section className="imp-card is-staged" aria-labelledby="imp-title">
          <div className="imp-glyph is-ready" aria-hidden="true">✓</div>
          <div className="imp-main">
            <span className="imp-kicker">Ready to bring across · not saved yet</span>
            <h3 id="imp-title">{staged.label ? <span data-i18n-preserve>{staged.label}</span> : <span>Old setup</span>} <small data-i18n-preserve>{staged.idMasked}</small></h3>
            <ul className="imp-found" aria-label="Imported">
              {found.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <p>Review each step, then create to finish. Your old data is removed afterwards.</p>
            {droppedNote && <p className="imp-note">{droppedNote}</p>}
          </div>
          <div className="imp-side is-row">
            <button type="button" className="setup-secondary" onClick={() => setOpen(true)}>Change</button>
            <button type="button" className="setup-secondary imp-remove" onClick={() => onStage(null)}>Remove</button>
          </div>
        </section>
      )}
      <ImportModal
        open={open} onClose={() => setOpen(false)} platform={platform}
        onStage={(next, payload) => { onStage(next, payload); setOpen(false); }}
      />
    </>
  );
}

// Only setups built with the old Collections Wizard can be brought across: a
// plain token carries no collections context, so importing one produces a setup
// that looks broken rather than useful.
export function importableSetups<T extends { kind: string }>(setups: T[]): T[] {
  return setups.filter((setup) => setup.kind === 'collection');
}

export function ImportModal({ open, onClose, platform, onStage }: {  open: boolean;
  onClose: () => void;
  platform: 'nuvio' | 'stremio';
  onStage: (next: StagedImport, payload: ImportedPayload) => void;
}) {
  const [email, setEmail] = useState('');
  const [lookup, setLookup] = useState<AccountLookup | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);

  if (!open) return null;

  // Only setups built with the old Collections Wizard can be brought across.
  const importable = importableSetups(lookup?.setups ?? []);
  const skipped = (lookup?.setups.length ?? 0) - importable.length;

  async function find() {
    const address = email.trim();
    if (!address || !address.includes('@')) { setError('Enter the email address of the old account'); return; }
    setBusy(true);
    setError(null);
    try {
      setLookup(await lookupAccount(address));
      setSelected(null);
    } catch (caught) {
      setLookup(null);
      setSelected(null);
      setError(caught instanceof Error ? caught.message : 'No saved setup matches that email');
    } finally {
      setBusy(false);
    }
  }

  const selectedSetup = lookup?.setups.find((setup) => setup.idMasked === selected) ?? null;
  // One click imports everything: settings merge, key values fill their
  // inputs (eye-masked like typed input), collection/home-row documents
  // merge, and a saved platform login reconnects.
  async function importSelected() {
    if (!selectedSetup) { setError('Pick one of your setups above first'); return; }
    setImporting(true);
    setError(null);
    try {
      const data: OldSetupData = await importOldSetup({ email: email.trim(), idMasked: selectedSetup.idMasked });
      const keys = importedKeys(data);
      const { collections, homeRows } = cleanImportedDocs(data);
      onStage(
        {
          email: email.trim(),
          idMasked: selectedSetup.idMasked,
          label: data.sourceLabel ?? selectedSetup.label,
          kind: data.kind,
          keyCount: Object.keys(keys).length,
          collectionCount: collections.length,
          homeRowCount: homeRows.length,
          hasLogin: importPushConn(data, platform) !== null,
          services: Object.keys(keys),
        },
        {
          merge: mergeImportPreview({ config: data.config, sourceLabel: data.sourceLabel }),
          keys,
          collections,
          homeRows,
          pushConn: importPushConn(data, platform),
          config: data.config,
        },
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not import that setup');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div
      className="app-modal" role="dialog" aria-modal="true"
      aria-label="Import an old setup"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="app-modal-box setup-import-dialog">
        <div className="app-modal-head">
          <div>
            <span className="setup-kicker">Coming from the old setup</span>
            <h3>Find your old setup</h3>
            <p>Enter your old account email, pick the setup you recognise, and everything lands on this page - keys, logins, settings and collections.</p>
          </div>
          <button type="button" className="eye-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="setup-import-modal-body">
          <div className="setup-import-lookup">
            <label className="setup-field">
              <span>Old account email</span>
              <input
                type="email" autoComplete="email" placeholder="you@example.com"
                value={email} onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <button type="button" className="setup-secondary" disabled={busy} onClick={() => void find()}>
              {busy ? 'Looking…' : 'Find my setups'}
            </button>
          </div>
          {lookup && (
            <>
              <div className="setup-import-summary" role="status">
                <span className="import-pill">
                  <b>{importable.length}</b> importable
                </span>
                <span className="import-pill">
                  <b>{lookup.collections.collections}</b> collection{lookup.collections.collections === 1 ? '' : 's'}
                </span>
                <span className="import-pill">
                  <b>{lookup.collections.contexts}</b> context{lookup.collections.contexts === 1 ? '' : 's'}
                </span>
              </div>
              {lookup.keyServices.length > 0 && (
                <p className="setup-import-keys">
                  <span>Saved keys on this account:</span>
                  {lookup.keyServices.map((service) => (
                    <span className="import-pill import-pill-key" key={service}>{service}</span>
                  ))}
                </p>
              )}
              {importable.length === 0 ? (
                <p className="setup-note">
                  No collection setups on that account to bring across.
                  {skipped > 0 && ` ${skipped} plain token setup${skipped === 1 ? '' : 's'} ${skipped === 1 ? 'was' : 'were'} skipped: only setups built with the old Collections Wizard can be imported.`}
                </p>
              ) : (
                <>
                  {skipped > 0 && (
                    <p className="setup-note">
                      {skipped} plain token setup{skipped === 1 ? '' : 's'} skipped: only setups built with the old Collections Wizard can be imported.
                    </p>
                  )}
                  <ul className="setup-import-list">
                    {importable.map((setup) => {
                      const isSelected = selected === setup.idMasked;
                      const lastUsed = formatDate(setup.lastUsedAt);
                      return (
                        <li key={setup.idMasked}>
                          <button
                            type="button"
                            className={`setup-import-card${isSelected ? ' is-selected' : ''}`}
                            aria-pressed={isSelected}
                            onClick={() => setSelected(isSelected ? null : setup.idMasked)}
                          >
                            <span className="setup-import-radio" aria-hidden="true" />
                            <span className="setup-import-card-main">
                              <span className="setup-import-card-head">
                                <strong>{setup.label ?? 'Unnamed setup'}</strong>
                                <span className="import-pill import-pill-kind is-collection">Collection</span>
                              </span>
                              <small>
                                {setup.idMasked}
                                {lastUsed ? ` · last used ${lastUsed}` : ''}
                                {setup.enabledKeyServices?.length ? ` · ${setup.enabledKeyServices.join(', ')}` : ''}
                              </small>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </>
          )}
          {error && <p className="setup-error" role="alert">{error}</p>}
        </div>
        <div className="app-modal-actions">
          <button type="button" className="setup-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="setup-primary" disabled={busy || importing || !selectedSetup} onClick={() => void importSelected()}>
            {importing ? 'Importing…' : selectedSetup ? `Import “${selectedSetup.label ?? 'setup'}”` : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
