import { useFeatures } from '@/features/site/site-hooks';
import { useState } from 'react';
// External stream provider priority. Owned streams always run first; enabled
// providers follow in the saved order. The ids are stored in saved configs
// and resolved by the backend: never rename them.
const STREAM_ADDONS: { id: string; name: string; logo: string; desc: string }[] = [
  { id: 'torrentio', name: 'Torrentio', logo: 'https://cdn.brandfetch.io/idmo5AU-sJ/w/204/h/185/theme/dark/logo.png?c=1dxbfHSJFAPEGdCLU4o5B', desc: 'Broad torrent and debrid coverage.' },
  { id: 'comet', name: 'Comet', logo: '/addon-logos/comet.png', desc: 'Fast curated debrid results.' },
  { id: 'meteor', name: 'Meteor', logo: '/addon-logos/meteor.png', desc: 'Torrent and debrid streams, plus Usenet with TorBox Pro.' },
  { id: 'mediafusion', name: 'MediaFusion', logo: '/addon-logos/mediafusion.png', desc: 'Movies, series and anime coverage.' },
  { id: 'jackettio', name: 'Jackettio', logo: '/addon-logos/jackettio.png', desc: 'Extra tracker results through debrid.' },
  { id: 'knaben', name: 'KNABEN', logo: '/addon-logos/knaben.png', desc: 'Searches public torrent indexes and resolves playback through your debrid account.' },
];

type AddonRow = { id: string; name: string; logo: string; desc: string; custom?: boolean };

export function StreamAddonsSection({ selected, onChange, custom = [], onAddCustom, onRemoveCustom }: {
  selected: string[];
  onChange: (next: string[]) => void;
  // The user's own addons (Settle In / Move In). Links stay server-side.
  custom?: { id: string; name: string }[];
  onAddCustom?: (url: string) => Promise<string | null>;
  onRemoveCustom?: (id: string) => void;
}) {
  const [customUrl, setCustomUrl] = useState('');
  const [customBusy, setCustomBusy] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  async function addCustom(event: React.FormEvent) {
    event.preventDefault();
    if (!onAddCustom || customBusy) return;
    setCustomBusy(true);
    setCustomError(null);
    const error = await onAddCustom(customUrl);
    setCustomBusy(false);
    if (error) setCustomError(error);
    else setCustomUrl('');
  }

  // Sources this server cannot reach: shown, but they cannot be switched on.
  const unavailable = new Set(useFeatures()?.unavailableStreamAddons ?? []);

  const allAddons: AddonRow[] = [
    ...STREAM_ADDONS,
    ...custom.map((row) => ({ id: row.id, name: row.name, logo: '', desc: 'Your own addon', custom: true })),
  ];

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((kept) => kept !== id) : [...selected, id]);
  }

  function move(id: string, direction: -1 | 1) {
    const index = selected.indexOf(id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= selected.length) return;
    const copy = selected.slice();
    copy.splice(index, 1);
    copy.splice(next, 0, id);
    onChange(copy);
  }

  const enabled = allAddons.filter((addon) => selected.includes(addon.id))
    .sort((a, b) => selected.indexOf(a.id) - selected.indexOf(b.id));
  const disabled = allAddons.filter((addon) => !selected.includes(addon.id));

  function row(addon: AddonRow) {
    const position = selected.indexOf(addon.id);
    const on = position > -1;
    return (
      <article className={`stream-addon-row${on ? ' enabled' : ''}`} key={addon.id}>
        <span className="addon-priority">{on ? position + 1 : '—'}</span>
        <span className="addon-logo">
          {addon.custom ? <span aria-hidden="true">⚡</span> : (
            <img
              src={addon.logo} alt="" className={addon.id === 'knaben' ? 'knaben-logo' : undefined}
              onError={(event) => {
                const parent = event.currentTarget.parentElement;
                if (parent) parent.textContent = addon.name.slice(0, 2).toUpperCase();
              }}
            />
          )}
        </span>
        {addon.custom
          ? <span className="stream-addon-copy"><strong data-i18n-preserve>{addon.name}</strong><small>Your own addon</small></span>
          : unavailable.has(addon.id)
            ? <span className="stream-addon-copy"><strong data-i18n-preserve>{addon.name}</strong><small>Blocks this server right now, so it is turned off here. It still works if you self-host LeLibrary.</small></span>
            : <span className="stream-addon-copy" data-i18n-preserve><strong>{addon.name}</strong><small>{addon.desc}</small></span>}
        <button
          type="button" className="stream-addon-toggle" aria-pressed={on}
          disabled={!on && unavailable.has(addon.id)}
          onClick={() => toggle(addon.id)}
        >
          {!on && unavailable.has(addon.id) ? 'Unavailable' : on ? 'On' : 'Off'}
        </button>
        {addon.custom && onRemoveCustom && (
          <button type="button" className="eye-btn" aria-label={`Remove ${addon.name}`} onClick={() => onRemoveCustom(addon.id)}>✕</button>
        )}
        {on && (
          <span className="addon-order">
            <button type="button" className="eye-btn" aria-label={`Move ${addon.name} earlier`} disabled={position === 0} onClick={() => move(addon.id, -1)}>↑</button>
            <button type="button" className="eye-btn" aria-label={`Move ${addon.name} later`} disabled={position === selected.length - 1} onClick={() => move(addon.id, 1)}>↓</button>
          </span>
        )}
      </article>
    );
  }

  return (
    <>
      <div className="section-heading">
        <div><h3>Provider priority</h3><p>Enabled providers run after your owned copy, in the order shown.</p></div>
        <span className="stream-config-summary-note">Owned copy first</span>
      </div>
      <div className="addon-grid">
        {enabled.map(row)}
        {disabled.map(row)}
      </div>
      {onAddCustom && (
        <form className="custom-addon-add" onSubmit={(event) => void addCustom(event)}>
          <div>
            <strong>Add your own addon</strong>
            <small>Paste the link to any Stremio stream addon you use, such as StreamNZB or your own AIOStreams. It joins the list above and follows your order. The link is stored sealed and never shown again.</small>
          </div>
          <span className="custom-addon-row">
            <input
              type="url" value={customUrl} onChange={(event) => setCustomUrl(event.target.value)}
              placeholder="https://…/manifest.json" aria-label="Addon link" autoComplete="off" spellCheck={false}
            />
            <button type="submit" className="setup-secondary" disabled={customBusy || !customUrl.trim() || custom.length >= 3}>
              {customBusy ? 'Checking…' : 'Add'}
            </button>
          </span>
          {customError && <p className="setup-error" role="alert">{customError}</p>}
          {custom.length >= 3 && <small className="setup-hint">You can add up to 3 of your own addons.</small>}
        </form>
      )}
    </>
  );
}
