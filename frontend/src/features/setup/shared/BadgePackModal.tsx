import { useEffect, useState, type CSSProperties } from 'react';
import {
  BADGE_PACKS,
  LOCAL_BADGE_BASE,
  LOCAL_BADGE_SAMPLE,
  isValidBadgeUrl,
  useBadgePreview,
} from '@/features/setup/shared/BadgePackPicker';

// Live per-pack preview: the bundled PNGs for the local pack, remote matches
// through the JSON proxy for community packs - the same matching the stream
// preview already uses, so the card shows what Nuvio will actually render.
export function PackPreview({ pack, customUrl }: { pack: string; customUrl: string }) {
  const preset = BADGE_PACKS.find((entry) => entry.id === pack);
  const state = useBadgePreview(pack, pack === 'custom' ? customUrl : undefined);

  if (preset?.local) {
    return (
      <span className="badge-strip" aria-label={`${preset.name} preview`}>
        {LOCAL_BADGE_SAMPLE.map((id) => (
          <img key={id} src={`${LOCAL_BADGE_BASE}/${id}.png`} alt="" loading="lazy" />
        ))}
      </span>
    );
  }
  if (state.loading) return <span className="badge-empty">Loading badges…</span>;
  if (state.badges.length === 0) {
    return (
      <span className="badge-empty">
        {pack === 'custom' ? 'Paste a badge JSON URL below to preview it.' : 'Could not load this pack.'}
      </span>
    );
  }
  return (
    <>
      <span className="badge-strip" aria-label={`${preset?.name ?? pack} preview`}>
        {state.badges.map((badge) => (
          <i
            key={badge.imageURL}
            className={`badge-remote${badge.bordered ? ' is-bordered' : ''}`}
            style={{ '--badge-border': badge.borderColor, '--badge-fill': badge.tagColor } as CSSProperties}
            title={badge.name}
          >
            <img src={badge.imageURL} alt={badge.name} loading="lazy" />
          </i>
        ))}
      </span>
      {state.gallery.length > 0 && (
        <>
          <span className="pack-gallery-label">Full set</span>
          <span className="badge-strip pack-gallery" aria-label={`${preset?.name ?? pack} full set`}>
            {state.gallery.map((item) => (
              <img key={item.imageURL} src={item.imageURL} alt={item.name} loading="lazy" title={item.name} />
            ))}
          </span>
        </>
      )}
    </>
  );
}

// Badge packs behind one button: the modal shows every pack as a card with
// its live preview underneath. Ticking a card applies it immediately, so the
// stream preview updates while the modal is still open; Done just closes it.
export function BadgePackButton({ pack, customUrl, onChange }: {
  pack: string;
  customUrl: string;
  onChange: (next: { pack: string; url: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = BADGE_PACKS.find((entry) => entry.id === pack) ?? BADGE_PACKS[0];

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function pick(id: string) {
    const entry = BADGE_PACKS.find((candidate) => candidate.id === id);
    onChange({ pack: id, url: id === 'custom' ? customUrl : (entry?.url ?? '') });
  }

  return (
    <>
      <button type="button" className="badge-open-btn" onClick={() => setOpen(true)}>
        <span className="badge-open-copy">
          <strong>{selected?.name ?? 'Badge pack'}</strong>
          <small>Browse every pack with live previews</small>
        </span>
        <span className="badge-open-preview">
          <PackPreview pack={pack} customUrl={customUrl} />
        </span>
      </button>
      {open && (
        <div className="app-modal" role="dialog" aria-modal="true" aria-label="Choose a badge pack">
          <div className="app-modal-box app-modal-wide">
            <h3>Badge packs</h3>
            <p>Tick one to apply it - the stream preview updates straight away. Packs are independent of stream formatting; Nuvio imports the pack once per profile.</p>
            <div className="pack-grid">
              {BADGE_PACKS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`pack-card${entry.id === pack ? ' active' : ''}`}
                  aria-pressed={entry.id === pack}
                  onClick={() => pick(entry.id)}
                >
                  <span className="pack-check" aria-hidden="true">✓</span>
                  <strong>{entry.name}</strong>
                  <small>{entry.description}</small>
                  <PackPreview pack={entry.id} customUrl={customUrl} />
                </button>
              ))}
            </div>
            {pack === 'custom' && (
              <label className="setup-field">
                <span>Badge JSON URL</span>
                <input
                  type="url" autoComplete="off" spellCheck={false} inputMode="url"
                  placeholder="https://example.com/badges.json"
                  value={customUrl}
                  onChange={(event) => onChange({ pack: 'custom', url: event.target.value })}
                />
                <small className="setup-hint">
                  {isValidBadgeUrl(customUrl.trim()) ? 'Ready to install in Nuvio.' : 'Use a direct HTTP(S) JSON URL.'}
                </small>
              </label>
            )}
            <div className="app-modal-actions">
              <button type="button" className="setup-primary" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
