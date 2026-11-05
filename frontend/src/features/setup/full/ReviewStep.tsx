import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from '@/features/setup/shared/Toast';
import { TierInstall } from '@/features/setup/shared/tier/TierInstall';
import { PublishPanel, type PublishCounts } from '@/features/setup/shared/PublishPanel';
import { DestinationStep, connectionUser } from '@/features/setup/full/DestinationStep';
import { usePlatformPush } from '@/features/setup/shared/usePlatformPush';
import { saveSetup } from '@/features/setup/resolver/api';
import { ReadyConnections } from '@/features/setup/shared/ApiKeysSection';
import { NuvioPublicModal } from '@/features/setup/full/NuvioPublicModal';
import type { CollectionDoc } from '@/features/setup/shared/collection-doc';
import type { PlatformConnection } from '@/features/setup/full/platform-login';

// Review: password gate + creation, then the Ready page (the shared publish
// panel Move In's edit flow and Settle In end on). The setup is created first
// because sealing and pushing need a row; the edit token comes from an
// immediate unlock with the just-typed password, which never touches storage.
export function ReviewStep({ password, confirmation, error, onPassword, onConfirmation, onSubmit, created, onRotated, name, platform, onPlatform, pushConn, onPushConn, counts, collections, onImportCollections }: {
  password: string;
  confirmation: string;
  error: string | null;
  onPassword: (value: string) => void;
  onConfirmation: (value: string) => void;
  onSubmit: () => void;
  created: { uuid: string; installToken: string } | null;
  // Revoke and regenerate: the new install token for the same setup.
  onRotated?: ((installToken: string) => void) | undefined;
  name: string;
  platform: 'nuvio' | 'stremio';
  onPlatform?: ((next: 'nuvio' | 'stremio') => void) | undefined;
  pushConn: PlatformConnection | null;
  // "Not you?" on the Ready page signs in again right there.
  onPushConn?: ((next: PlatformConnection | null) => void) | undefined;
  counts?: PublishCounts | undefined;
  collections: CollectionDoc[];
  onImportCollections: (cols: CollectionDoc[]) => void;
}) {
  const [publicOpen, setPublicOpen] = useState(false);
  // "Not you?": the sign-in form replaces the account line until a login lands.
  const [switching, setSwitching] = useState(false);

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
          password={password} confirmation={confirmation} error={error}
          onPassword={onPassword} onConfirmation={onConfirmation}
          onSubmit={onSubmit}
        >
          {activeConn && (
            <p className="setup-note">Push to {platformName} is armed - creating the setup pushes straight after.</p>
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
      toast('Imported locally, but the save failed - push again from a fresh open', 'error');
    }
  }

  // The Ready page fades in after the "Creating your setup..." loader.
  const signIn = (switching || !activeConn) && onPushConn ? (
    <DestinationStep
      profileName={name}
      platform={platform}
      onPlatform={onPlatform ?? (() => {})}
      connection={switching ? null : pushConn}
      onConnection={(next) => { onPushConn(next); if (next) setSwitching(false); }}
    />
  ) : undefined;
  return (
    <div className="review-step created-done">
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
        deskTitle={activeConn && !switching ? `Push to ${platformName}` : 'Choose where you watch'}
        deskBody={signIn}
        account={activeConn && !switching ? { user: connectionUser(activeConn), ...(onPushConn ? { onChange: () => setSwitching(true) } : {}) } : null}
        regenerate={onRotated ? {
          editToken: push.editToken,
          onRotated,
          repush: activeConn ? { label: `Push to ${platformName} again`, onClick: () => void push.push() } : null,
        } : null}
        footer={(
          <>
            <Link className="setup-secondary" to={`/${created.uuid}`}>Open your setup</Link>
            <Link className="setup-primary" to="/">Finish</Link>
          </>
        )}
        action={{
          // Everything was saved at creation; this only pushes.
          label: push.busy ?? (push.pushed ? `Push to ${platformName} again` : `Push to ${platformName}`),
          busy: push.busy !== null,
          disabled: !activeConn || switching || !push.editToken,
          onClick: () => void push.push(),
          ...(!activeConn
            ? { hint: 'Sign in above to push your Home rows and collections. Your install link below works either way.' }
            : push.libraryPending
              ? { hint: 'Pushed. Your library folders are still being prepared and will appear on their own - nothing else to do.' }
              : push.pushed ? { hint: 'Pushed. Your saved setup can be pushed again any time.' } : {}),
        }}
        profilePicker={platform === 'nuvio' && profiles.length > 0 ? {
          profiles, value: push.profileId, onChange: (value) => push.setProfileId(value),
        } : null}
        replaceOthers={activeConn ? { value: push.replaceOthers, onChange: push.setReplaceOthers } : null}
      >
        <div className="review-section-head"><h3>Connected accounts</h3><p>Sync your personal lists into library rows.</p></div>
        <ReadyConnections uuid={created.uuid} editToken={push.editToken} />

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
    </div>
  );
}
