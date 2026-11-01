// Shown while a new setup is being saved. It fades out on its own once the
// row exists, and the Ready page fades in where it stood.
export function CreatingSetup({ leaving, name }: { leaving: boolean; name?: string | null }) {
  return (
    <div className={`creating-setup${leaving ? ' is-leaving' : ''}`} role="status" aria-live="polite">
      <span className="creating-spinner" aria-hidden="true" />
      <h2>Creating your setup…</h2>
      <p>{name?.trim() ? `Saving ${name.trim()} and sealing your keys.` : 'Saving your settings and sealing your keys.'}</p>
    </div>
  );
}
