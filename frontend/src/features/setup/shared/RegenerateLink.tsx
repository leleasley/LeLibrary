import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { rotateSetupSecret } from '@/features/setup/resolver/api';
import { toast } from '@/features/setup/shared/Toast';

export interface RegenerateLinkProps {
  uuid: string;
  editToken: string | null;
  // The new install token. The page swaps it in place: same setup, same edit
  // address, same password, only the install link changes.
  onRotated: (installToken: string) => void;
  // Offered once the link is new, when the setup can push: a Nuvio or Stremio
  // account still holds the old link until it is pushed again.
  repush?: { label: string; onClick: () => void } | null;
}

// "Revoke and regenerate" at the bottom of Manual setup. Rotates only the
// install secret: every device using the old link stops at once and needs the
// new one, nothing else about the setup changes.
export function RegenerateLink({ uuid, editToken, onRotated, repush }: RegenerateLinkProps) {
  const [stage, setStage] = useState<'closed' | 'confirm' | 'done'>('closed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (stage === 'closed' || busy) return;
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') setStage('closed'); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stage, busy]);

  async function regenerate() {
    if (!editToken || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await rotateSetupSecret(uuid, editToken);
      if (!result?.installToken) throw new Error('No new link came back');
      onRotated(result.installToken);
      setStage('done');
      toast('New install link ready');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not make a new link');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="regen-link">
      <div>
        <strong>Revoke and regenerate</strong>
        <small>Shared the link by mistake? Make a new one. The old one stops working straight away.</small>
      </div>
      <button type="button" className="btn-danger" disabled={!editToken} onClick={() => { setError(null); setStage('confirm'); }}>
        Regenerate link
      </button>

      {/* Portalled: the Ready page fades in with a transform, which would
          otherwise pin this fixed modal to the page instead of the screen. */}
      {stage !== 'closed' && typeof document !== 'undefined' && createPortal((
        <div className="app-modal" role="dialog" aria-modal="true" aria-label="Revoke and regenerate">
          <div className="app-modal-box regen-modal">
            {stage === 'confirm' ? (
              <>
                <h3>Make a new install link?</h3>
                <p>
                  Any device using this setup will stop straight away and will need the new link.
                  Your settings, keys, password and edit address stay exactly as they are.
                </p>
                {error && <p className="setup-error" role="alert">{error}</p>}
                <div className="app-modal-actions">
                  <button type="button" className="setup-secondary" disabled={busy} onClick={() => setStage('closed')}>Cancel</button>
                  <button type="button" className="btn-danger" disabled={busy} onClick={() => void regenerate()}>
                    {busy ? 'Regenerating…' : 'Revoke and regenerate'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3>Your new link is ready</h3>
                <p>
                  {repush
                    ? 'The old link no longer works. Add the new one wherever you watch, or push again and your player picks it up.'
                    : 'The old link no longer works. Add the new one wherever you watch.'}
                </p>
                <div className="app-modal-actions">
                  <button type="button" className="setup-secondary" onClick={() => setStage('closed')}>Done</button>
                  {repush && (
                    <button type="button" className="setup-primary" onClick={() => { setStage('closed'); repush.onClick(); }}>
                      {repush.label}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
