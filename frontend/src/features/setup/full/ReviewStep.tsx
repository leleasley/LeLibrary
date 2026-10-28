import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from '@/features/setup/shared/Toast';
import { TierInstall } from '@/features/setup/shared/tier/TierInstall';
import { PublishPanel, type PublishCounts } from '@/features/setup/shared/PublishPanel';
import { SetupCreatedModal } from '@/features/setup/shared/SetupCreatedModal';
import { usePlatformPush } from '@/features/setup/shared/usePlatformPush';
import { saveSetup } from '@/features/setup/resolver/api';
import { WatchlistSection } from '@/features/setup/full/WatchlistSection';
import { NuvioPublicModal } from '@/features/setup/full/NuvioPublicModal';
import type { CollectionDoc } from '@/features/setup/shared/collection-doc';
import type { PlatformConnection } from '@/features/setup/full/platform-login';

// Review: password gate + creation, then the shared publish panel (the same
// surface Move In's edit flow and Settle In end on). The setup is created first
// because sealing and pushing need a row; the edit token comes from an
// immediate unlock with the just-typed password, which never touches storage.
export function ReviewStep({ password, confirmation, busy, error, backTo, onPassword, onConfirmation, onSubmit, created, name, platform, pushConn, counts, collections, onImportCollections, submitLabel }: {
  password: string;
  confirmation: string;
  busy: boolean;
  error: string | null;
  backTo: string;
  onPassword: (value: string) => void;
  onConfirmation: (value: string) => void;
  onSubmit: () => void;
  created: { uuid: string; installToken: string } | null;
  name: string;
  platform: 'nuvio' | 'stremio';
  pushConn: PlatformConnection | null;
  counts?: PublishCounts | undefined;
  collections: CollectionDoc[];
  onImportCollections: (cols: CollectionDoc[]) => void;
  submitLabel?: string | undefined;
}) {
  const [publicOpen, setPublicOpen] = useState(false);
  // The post-creation modal is the "you are done" moment; it opens once the row
  // exists and can be dismissed back to this page.
  const [createdOpen, setCreatedOpen] = useState(true);

  const platformName = platform === 'nuvio' ? 'Nuvio' : 'Stremio';
  const push = usePlatformPush({
    uuid: created?.uuid ?? null,
    password,
    platform,
    connection: pushConn,
    onPushed: () => toast(`Pushed to ${platformName}`),
    onError: (message) => toast(message, 'error'),
  });
  const profiles = push.profiles;
  const activeConn = pushConn && pushConn.platform === platform ? pushConn : null;

  if (!created) {
    return (
      <>
        <TierInstall
          password={password} confirmation={confirmation}
          busy={busy} error={error}
          onPassword={onPassword} onConfirmation={onConfirmation}
          onSubmit={onSubmit} submitLabel={submitLabel ?? 'Create my setup'}
        >
          {activeConn && (
            <p className="setup-note">Push to {platformName} is armed — creating the setup pushes straight after.</p>
          )}
        </TierInstall>
      </>
    );
  }

  async function importPublic(cols: CollectionDoc[]) {
    const session = created;
    if (!session) return;
    const known = new Set(collections.map((collection) => collection.id));
    const fresh = cols.filter((collection) => !known.has(collection.id));
    if (!fresh.length) { toast('Those collections are already in this setup'); return; }
    const merged = [...collections, ...fresh];
    onImportCollections(merged);
    try {
      await saveSetup(session.uuid, { config: { collections: merged } }, push.editToken ?? '');
    } catch {
      toast('Imported locally, but the save failed — push again from a fresh open', 'error');
    }
  }

  // The finished page waits behind the "your setup is live" modal and fades
  // in once it closes, so the two never offer the same push side by side.
  return (
    <div className={`review-step created-done${createdOpen ? ' is-waiting' : ''}`}>
      {push.unlockError && <p className="setup-error">{push.unlockError}</p>}
      <PublishPanel
        installToken={created.installToken}
        uuid={created.uuid}
        tierLabel="Move In"
        name={name}
        platform={platform}
        counts={counts}
        hasCollections
        connected={Boolean(activeConn)}
        action={{
          // Everything was saved at creation; this only pushes.
          label: push.busy ?? (push.pushed ? `Push to ${platformName} again` : `Push to ${platformName}`),
          busy: push.busy !== null,
          disabled: !activeConn || !push.editToken,
          onClick: () => void push.push(),
          ...(!activeConn
            ? { hint: `Open your setup and sign in to ${platformName} on the Destination step to push. Your install link below works either way.` }
            : push.libraryPending
              ? { hint: 'Pushed. Your library folders are still being prepared and will appear on their own — nothing else to do.' }
              : push.pushed ? { hint: 'Pushed. Your saved setup can be pushed again any time.' } : {}),
        }}
        profilePicker={platform === 'nuvio' && profiles.length > 0 ? {
          profiles, value: push.profileId, onChange: (value) => push.setProfileId(value),
        } : null}
        actionsExtra={<Link className="setup-secondary" to={`/${created.uuid}`}>Open your setup</Link>}
      >
        <div className="review-section-head"><h3>Watchlists</h3><p>Sync your personal lists into library rows.</p></div>
        <WatchlistSection uuid={created.uuid} editToken={push.editToken} />

        {platform === 'nuvio' && (
          <>
            <div className="review-section-head"><h3>Nuvio Public Collections</h3><p>Browse community packs and import them into this setup.</p></div>
            <button type="button" className="setup-secondary" disabled={!push.editToken} onClick={() => setPublicOpen(true)}>
              Browse Nuvio Public
            </button>
            <NuvioPublicModal
              open={publicOpen} onClose={() => setPublicOpen(false)}
              uuid={created.uuid} editToken={push.editToken ?? ''}
              onImport={(cols) => void importPublic(cols)}
            />
          </>
        )}
      </PublishPanel>

      <SetupCreatedModal
        open={createdOpen}
        uuid={created.uuid}
        installToken={created.installToken}
        name={name.trim() || null}
        password={password}
        platform={platform}
        pushConn={pushConn}
        onClose={() => setCreatedOpen(false)}
      />
    </div>
  );
}
