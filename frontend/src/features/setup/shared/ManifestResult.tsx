import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { installUrl } from '@/features/setup/resolver/validation';
import { ConfirmModal } from '@/features/setup/shared/Modal';
import { CLIENT_LOGOS, useClientIntegrations } from '@/features/setup/shared/PublishPanel';
import { toast } from '@/features/setup/shared/Toast';
import { samplePoster } from '@/features/setup/shared/tier/TierPickers';

// One-time result view shown immediately after a setup is created. It is never
// reachable again without the password: a reload lands back on the setup flow,
// and the install link itself is only re-shown by unlocking the setup.
export interface ResultRow { label: string; value: string }

export function ManifestResult({ installToken, uuid, name, rows = [] }: {
  installToken: string;
  uuid: string;
  name?: string;
  rows?: ResultRow[];
}) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const manifest = installUrl(window.location.origin, installToken);
  const stremioLink = manifest.replace(/^https?:\/\//, 'stremio://');
  const editLink = `${window.location.origin}/${uuid}`;
  const clients = useClientIntegrations(installToken);

  // Create sits at the bottom of a long page; start the result at the top.
  useEffect(() => { window.scrollTo({ top: 0 }); }, []);

  async function copy(value: string, key: string, message = 'Copied') {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1800);
      toast(message);
    } catch {
      toast('Could not copy', 'error');
    }
  }

  return (
    <div className="mr">
      <header className="mr-head">
        <span className="mr-check" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 10 17.5 19 7" /></svg>
        </span>
        <span className="setup-eyebrow">Quick Look · Ready</span>
        <h1>Meet your new <em>library.</em></h1>
        <p>
          Add this link to Stremio or Nuvio as an addon. It is the only thing
          your player needs: it carries your configuration, not your password.
        </p>
      </header>

      <div className="mr-grid">
        <div className="mr-main">
          <section className="mr-card mr-install" aria-labelledby="mr-install-title">
            <h2 id="mr-install-title">Add it to your player</h2>
            <div className="mr-players">
              <a className="mr-player is-stremio" href={stremioLink}>
                <span className="mr-player-icon"><img src="/stremio.svg" alt="" /></span>
                <span className="mr-player-text"><strong>Open in Stremio</strong><small>Installs in one click</small></span>
                <b aria-hidden="true">›</b>
              </a>
              <button type="button" className="mr-player is-nuvio" onClick={() => void copy(manifest, 'nuvio', 'Install link copied')}>
                <span className="mr-player-icon"><img src="/nuvio.png" alt="" /></span>
                <span className="mr-player-text"><strong>Copy for Nuvio</strong><small>Paste it into Nuvio's addons</small></span>
                <b aria-hidden="true">{copied === 'nuvio' ? '✓' : '›'}</b>
              </button>
            </div>

            <div className="mr-field">
              <span className="mr-label">Install link</span>
              <div className="mr-copy">
                <input readOnly value={manifest} aria-label="Install link" onFocus={(event) => event.target.select()} />
                <button type="button" className={copied === 'url' ? 'is-done' : ''} onClick={() => void copy(manifest, 'url', 'Install link copied')}>
                  {copied === 'url' ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            </div>

            {clients.length > 0 && (
              <details className="mr-more">
                <summary>More apps <span aria-hidden="true">›</span></summary>
                <div className="mr-apps">
                  {clients.map((client) => (
                    <button
                      key={client.id} type="button" className="mr-app"
                      aria-label={`Copy ${client.label} manifest`}
                      onClick={() => void copy(client.manifest, `client-${client.id}`, `${client.label} manifest copied`)}
                    >
                      <img src={CLIENT_LOGOS[client.id]} alt="" />
                      <strong data-i18n-preserve>{client.label}</strong>
                      <b aria-hidden="true">{copied === `client-${client.id}` ? '✓' : '⧉'}</b>
                    </button>
                  ))}
                </div>
              </details>
            )}
          </section>

          <ol className="mr-steps">
            <li><b>01</b><strong>Open your player</strong><span>Find the addon installer in Stremio or Nuvio.</span></li>
            <li><b>02</b><strong>Add the link</strong><span>Paste the install link above and confirm.</span></li>
            <li><b>03</b><strong>Press play</strong><span>Your library, posters and formatting appear straight away.</span></li>
          </ol>
        </div>

        <aside className="mr-side">
          <section className="mr-card mr-receipt">
            <div className="mr-fan" aria-hidden="true">
              {[0, 1, 2].map((index) => <img key={index} src={samplePoster(index + 1, 'w185')} alt="" />)}
            </div>
            <span className="setup-eyebrow">Your setup</span>
            {name?.trim()
              ? <strong className="mr-name" data-i18n-preserve>{name.trim()}</strong>
              : <strong className="mr-name">Quick Look setup</strong>}
            {rows.length > 0 && (
              <dl>
                {rows.map((row) => (
                  <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
                ))}
              </dl>
            )}
          </section>

          <section className="mr-card mr-keep">
            <h2><span aria-hidden="true">🔒</span> Keep these safe</h2>
            <p>This screen only appears once. We cannot recover your link or password for you.</p>
            <div className="mr-field">
              <span className="mr-label">Setup id</span>
              <div className="mr-copy is-small">
                <input readOnly value={uuid} aria-label="Setup id" onFocus={(event) => event.target.select()} />
                <button type="button" className={copied === 'uuid' ? 'is-done' : ''} onClick={() => void copy(uuid, 'uuid', 'Setup id copied')}>
                  {copied === 'uuid' ? '✓' : 'Copy'}
                </button>
              </div>
            </div>
            <div className="mr-field">
              <span className="mr-label">Edit it later at</span>
              <div className="mr-copy is-small">
                <input readOnly value={editLink} aria-label="Edit link" onFocus={(event) => event.target.select()} />
                <button type="button" className={copied === 'edit' ? 'is-done' : ''} onClick={() => void copy(editLink, 'edit', 'Edit link copied')}>
                  {copied === 'edit' ? '✓' : 'Copy'}
                </button>
              </div>
            </div>
          </section>

          <button type="button" className="mr-back" onClick={() => setConfirmLeave(true)}>
            ← Back to setup
          </button>
        </aside>
      </div>

      <ConfirmModal
        open={confirmLeave}
        title="Leave this screen?"
        body="Your manifest link is only shown once. Make sure you saved it and your password before going back."
        confirmLabel="Leave"
        onConfirm={() => navigate('/configure')}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
}
