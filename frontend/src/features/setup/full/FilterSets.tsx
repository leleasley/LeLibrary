import { useState, type ReactNode } from 'react';
import { toast } from '@/features/setup/shared/Toast';

// Stream filters: include/exclude sets plus preferred resolution order, file
// sizes and cached-only. Semantics mirror the old renderFilterChips() family
// exactly: an empty set means "all included"; toggling from all materializes
// the full set first; the last included item cannot go; a full set clears
// back to all.
export const ALL_RES = ['4K', '2K', '1080p', '720p', '480p', '360p', '240p'];
export const ALL_QUAL = ['BluRay REMUX', 'BluRay', 'WEB-DL', 'WEBRip', 'HDRip', 'DVDRip', 'HDTV', 'CAM', 'TS', 'TC'];
export const ALL_SRC = ['BluRay', 'WEB-DL', 'WEBRip', 'HDRip', 'DVDRip', 'HDTV', 'CAM', 'TS'];

export type FilterKind = 'resolution' | 'quality' | 'source';

export interface FilterSetsDraft {
  resolutions: string[];
  resolutionOrder: string[];
  qualities: string[];
  sources: string[];
  minSizeGb: string;
  maxSizeGb: string;
  cachedOnly: boolean;
}

export const EMPTY_FILTER_SETS: FilterSetsDraft = {
  resolutions: [],
  resolutionOrder: [...ALL_RES],
  qualities: [],
  sources: [],
  minSizeGb: '',
  maxSizeGb: '',
  cachedOnly: false,
};

function kindValues(kind: FilterKind): string[] {
  return kind === 'resolution' ? ALL_RES : kind === 'source' ? ALL_SRC : ALL_QUAL;
}

function kindSelected(draft: FilterSetsDraft, kind: FilterKind): string[] {
  return kind === 'resolution' ? draft.resolutions : kind === 'source' ? draft.sources : draft.qualities;
}

function withSelected(draft: FilterSetsDraft, kind: FilterKind, selected: string[]): FilterSetsDraft {
  return kind === 'resolution'
    ? { ...draft, resolutions: selected }
    : kind === 'source' ? { ...draft, sources: selected } : { ...draft, qualities: selected };
}

function isIncluded(selected: string[], value: string): boolean {
  return selected.length === 0 || selected.includes(value);
}

function summary(selected: string[], total: number): string {
  return selected.length === 0 ? 'All included' : `${selected.length} of ${total} included`;
}

// Presets cover what most people want; anything else shows as "Custom".
// Each one only sets resolutions, their order, quality tags and sizes; the
// cached-only switch and the advanced codec/HDR/audio sets stay as they are.
export interface FilterPreset { id: string; name: string; hint: string; values: Pick<FilterSetsDraft, 'resolutions' | 'resolutionOrder' | 'qualities' | 'sources' | 'minSizeGb' | 'maxSizeGb'> }
const NO_CAM = ['BluRay REMUX', 'BluRay', 'WEB-DL', 'WEBRip', 'HDRip', 'DVDRip', 'HDTV'];
export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'everything', name: 'Everything', hint: 'Every file, best first', values: { resolutions: [], resolutionOrder: [...ALL_RES], qualities: [], sources: [], minSizeGb: '', maxSizeGb: '' } },
  { id: 'best', name: 'Best quality', hint: '4K and 1080p, no cam copies', values: { resolutions: ['4K', '2K', '1080p'], resolutionOrder: [...ALL_RES], qualities: ['BluRay REMUX', 'BluRay', 'WEB-DL', 'WEBRip'], sources: [], minSizeGb: '', maxSizeGb: '' } },
  { id: 'balanced', name: 'Save space', hint: '1080p first, up to 15 GB', values: { resolutions: ['1080p', '720p'], resolutionOrder: ['1080p', '720p', '4K', '2K', '480p', '360p', '240p'], qualities: NO_CAM, sources: [], minSizeGb: '', maxSizeGb: '15' } },
  { id: 'small', name: 'Smallest files', hint: '720p first, up to 4 GB', values: { resolutions: ['1080p', '720p', '480p'], resolutionOrder: ['720p', '1080p', '480p', '4K', '2K', '360p', '240p'], qualities: NO_CAM, sources: [], minSizeGb: '', maxSizeGb: '4' } },
];

export function presetOf(draft: FilterSetsDraft): string {
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index]);
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((value) => b.includes(value));
  const match = FILTER_PRESETS.find(({ values }) => sameSet(draft.resolutions, values.resolutions)
    && same(draft.resolutionOrder, values.resolutionOrder) && sameSet(draft.qualities, values.qualities)
    && sameSet(draft.sources, values.sources) && draft.minSizeGb.trim() === values.minSizeGb && draft.maxSizeGb.trim() === values.maxSizeGb);
  return match ? match.id : 'custom';
}

// One line that says what the filters do, for the folded sections.
export function filterSummaryParts(draft: FilterSetsDraft): string[] {
  const included = draft.resolutionOrder.filter((value) => isIncluded(draft.resolutions, value));
  const parts = [draft.resolutions.length === 0 ? 'Any resolution' : included.join(', ')];
  parts.push(draft.qualities.length === 0 && draft.sources.length === 0 ? 'Any quality' : `${draft.qualities.length || ALL_QUAL.length} of ${ALL_QUAL.length} qualities`);
  const min = draft.minSizeGb.trim(); const max = draft.maxSizeGb.trim();
  parts.push(min || max ? `${min || '0'}-${max || '∞'} GB` : 'Any size');
  if (draft.cachedOnly) parts.push('Cached only');
  return parts;
}

export function FilterSets({ draft, onChange, advanced }: {
  draft: FilterSetsDraft;
  onChange: (next: FilterSetsDraft) => void;
  // Settle In's codec / HDR / audio sets, shown in the Advanced fold.
  advanced?: ReactNode;
}) {
  const [dragging, setDragging] = useState<string | null>(null);

  function toggleFilter(kind: FilterKind, value: string) {
    const values = kindValues(kind);
    const selected = new Set(kindSelected(draft, kind));
    if (selected.size === 0) values.forEach((item) => selected.add(item));
    if (selected.has(value) && selected.size === 1) {
      toast(`Keep at least one ${kind === 'resolution' ? 'resolution' : kind}`, 'error');
      return;
    }
    if (selected.has(value)) selected.delete(value);
    else selected.add(value);
    const next = [...selected];
    onChange(withSelected(draft, kind, next.length === values.length ? [] : next));
  }

  function clearFilter(kind: FilterKind) {
    onChange(withSelected(draft, kind, []));
  }

  // Moves a resolution one place in the preference order (skipping
  // excluded ones, which keep their slot).
  function moveResolution(value: string, direction: -1 | 1) {
    const order = draft.resolutionOrder.slice();
    const index = order.indexOf(value);
    let next = index + direction;
    while (next >= 0 && next < order.length && !isIncluded(draft.resolutions, order[next] ?? '')) next += direction;
    if (index < 0 || next < 0 || next >= order.length) return;
    const swap = order[next];
    const current = order[index];
    if (swap === undefined || current === undefined) return;
    order[next] = current;
    order[index] = swap;
    onChange({ ...draft, resolutionOrder: order });
  }

  function dropResolution(value: string, onto: string) {
    if (value === onto) return;
    const order = draft.resolutionOrder.filter((item) => item !== value);
    order.splice(order.indexOf(onto), 0, value);
    onChange({ ...draft, resolutionOrder: order });
  }

  function applyPreset(preset: FilterPreset) {
    onChange({ ...draft, ...preset.values, resolutions: [...preset.values.resolutions], resolutionOrder: [...preset.values.resolutionOrder], qualities: [...preset.values.qualities], sources: [...preset.values.sources] });
  }

  function chips(kind: FilterKind, values: string[], selected: string[]) {
    return (
      <div className="stream-filter-chips">
        {values.map((value) => {
          const enabled = isIncluded(selected, value);
          return (
            <button
              key={value} type="button"
              className={`stream-filter-chip${enabled ? ' selected' : ''}`}
              aria-pressed={enabled} onClick={() => toggleFilter(kind, value)}
            >
              {value}
            </button>
          );
        })}
      </div>
    );
  }

  const included = draft.resolutionOrder.filter((value) => isIncluded(draft.resolutions, value));
  const active = presetOf(draft);
  const qualityParts = [summary(draft.qualities, ALL_QUAL.length), summary(draft.sources, ALL_SRC.length)];

  return (
    <div className="pf">
      <div className="pf-presets" role="radiogroup" aria-label="Filter presets">
        {FILTER_PRESETS.map((preset) => (
          <button
            key={preset.id} type="button" role="radio" aria-checked={active === preset.id}
            className={`pf-preset${active === preset.id ? ' is-on' : ''}`} onClick={() => applyPreset(preset)}
          >
            <strong>{preset.name}</strong><small>{preset.hint}</small>
          </button>
        ))}
        {active === 'custom' && <span className="pf-custom" role="status"><strong>Custom</strong><small>Your own mix</small></span>}
      </div>

      <div className="pf-block">
        <div className="pf-head">
          <div><strong>Resolutions</strong><small>Tap to include or skip. Drag, or use the arrow, to set which comes first.</small></div>
          {draft.resolutions.length > 0 && <button type="button" className="filter-clear" onClick={() => clearFilter('resolution')}>Include all</button>}
        </div>
        <div className="pf-res" role="list">
          {draft.resolutionOrder.map((value) => {
            const on = isIncluded(draft.resolutions, value);
            const rank = included.indexOf(value);
            return (
              <span
                key={value} role="listitem"
                className={`pf-res-chip${on ? ' is-on' : ''}${dragging === value ? ' is-drag' : ''}`}
                draggable={on}
                onDragStart={(event) => { setDragging(value); event.dataTransfer.setData('text/plain', value); }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(event) => { if (on) event.preventDefault(); }}
                onDrop={(event) => { event.preventDefault(); setDragging(null); dropResolution(event.dataTransfer.getData('text/plain'), value); }}
              >
                <button type="button" className="pf-res-toggle" aria-pressed={on} onClick={() => toggleFilter('resolution', value)}>
                  {on && <em aria-hidden="true">{rank + 1}</em>}{value}
                </button>
                {on && rank > 0 && (
                  <button type="button" className="pf-res-move" aria-label={`Move ${value} earlier`} onClick={() => moveResolution(value, -1)}>‹</button>
                )}
              </span>
            );
          })}
        </div>
      </div>

      <div className="pf-inline">
        <label className="setup-field pf-size">
          <span>Min size (GB)</span>
          <input type="number" min={0} step={0.5} placeholder="0" value={draft.minSizeGb} onChange={(event) => onChange({ ...draft, minSizeGb: event.target.value })} />
        </label>
        <label className="setup-field pf-size">
          <span>Max size (GB)</span>
          <input type="number" min={0} step={0.5} placeholder="No limit" value={draft.maxSizeGb} onChange={(event) => onChange({ ...draft, maxSizeGb: event.target.value })} />
        </label>
        <label className="switch-row pf-cached">
          <span><strong>Cached only</strong><small>Ready to play instantly</small></span>
          <input type="checkbox" checked={draft.cachedOnly} onChange={(event) => onChange({ ...draft, cachedOnly: event.target.checked })} />
          <i aria-hidden="true" />
        </label>
      </div>

      <details className="pf-fold">
        <summary><strong>Quality &amp; source</strong><small className="cg-accordion-summary">{qualityParts.map((part, index) => <span key={index}>{part}</span>)}</small></summary>
        <div className="pf-fold-body">
          <div className="pf-head">
            <div><strong>Quality tags</strong><small>Only these release qualities are returned.</small></div>
            <button type="button" className="filter-clear" onClick={() => clearFilter('quality')}>Include all</button>
          </div>
          {chips('quality', ALL_QUAL, draft.qualities)}
          <div className="pf-head">
            <div><strong>Sources</strong><small>Filter streams by their original source.</small></div>
            <button type="button" className="filter-clear" onClick={() => clearFilter('source')}>Include all</button>
          </div>
          {chips('source', ALL_SRC, draft.sources)}
        </div>
      </details>
      {advanced && (
        <details className="pf-fold">
          <summary><strong>Advanced</strong><small>Codecs, HDR and audio</small></summary>
          <div className="pf-fold-body">{advanced}</div>
        </details>
      )}
    </div>
  );
}
