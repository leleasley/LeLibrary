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

export function FilterSets({ draft, onChange }: {
  draft: FilterSetsDraft;
  onChange: (next: FilterSetsDraft) => void;
}) {
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

  function dropResolution(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    const order = draft.resolutionOrder.slice();
    const [moved] = order.splice(from, 1);
    if (moved === undefined) return;
    order.splice(to, 0, moved);
    onChange({ ...draft, resolutionOrder: order });
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

  const includedOrder = draft.resolutionOrder.filter((value) => isIncluded(draft.resolutions, value));

  return (
    <>
      <details className="stream-config-section" open>
        <summary>
          <span><strong>Resolution</strong><small>Include, exclude and set preference order</small></span>
          <span className="stream-config-summary-note">{summary(draft.resolutions, ALL_RES.length)}</span>
        </summary>
        <div className="stream-config-body">
          <div className="stream-filter-heading">
            <div><h3>Included resolutions</h3><p>Untick resolutions you never want returned.</p></div>
            <button type="button" className="filter-clear" onClick={() => clearFilter('resolution')}>Include all</button>
          </div>
          {chips('resolution', ALL_RES, draft.resolutions)}
          <div className="resolution-order-head">
            <div><strong>Preferred resolution order</strong><small>Drag to reorder. Streams nearer the start are preferred.</small></div>
          </div>
          <div className="resolution-order">
            {includedOrder.map((value, index) => (
              <article
                key={value} className="resolution-order-item" draggable
                onDragStart={(event) => { event.dataTransfer.setData('text/plain', String(index)); }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  dropResolution(Number(event.dataTransfer.getData('text/plain')), index);
                }}
              >
                <span className="resolution-drag" aria-hidden="true">⋮⋮</span>
                <strong>{value}</strong>
                <span>#{index + 1}</span>
                <span className="resolution-order-buttons">
                  <button type="button" className="eye-btn" aria-label={`Move ${value} earlier`} disabled={index === 0} onClick={() => moveResolution(value, -1)}>↑</button>
                  <button type="button" className="eye-btn" aria-label={`Move ${value} later`} disabled={index === includedOrder.length - 1} onClick={() => moveResolution(value, 1)}>↓</button>
                </span>
              </article>
            ))}
          </div>
        </div>
      </details>
      <details className="stream-config-section" open>
        <summary>
          <span><strong>Quality &amp; source</strong><small>BluRay, WEB-DL, HDTV, CAM and more</small></span>
        </summary>
        <div className="stream-config-body quality-source-body">
          <section>
            <div className="stream-filter-heading">
              <div><h3>Included quality tags</h3><p>Only the selected release qualities are returned.</p></div>
              <button type="button" className="filter-clear" onClick={() => clearFilter('quality')}>Include all</button>
            </div>
            {chips('quality', ALL_QUAL, draft.qualities)}
          </section>
          <section>
            <div className="stream-filter-heading">
              <div><h3>Included sources</h3><p>Filter streams by their original source.</p></div>
              <button type="button" className="filter-clear" onClick={() => clearFilter('source')}>Include all</button>
            </div>
            {chips('source', ALL_SRC, draft.sources)}
          </section>
        </div>
      </details>
      <section className="stream-config-block">
        <div className="section-heading"><div><h3>File size limits</h3><p>Skip files outside your preferred range.</p></div></div>
        <div className="setup-row">
          <label className="setup-field">
            <span>Minimum size (GB)</span>
            <input
              type="number" min={0} step={0.5} placeholder="0"
              value={draft.minSizeGb} onChange={(event) => onChange({ ...draft, minSizeGb: event.target.value })}
            />
          </label>
          <label className="setup-field">
            <span>Maximum size (GB)</span>
            <input
              type="number" min={0} step={0.5} placeholder="No limit"
              value={draft.maxSizeGb} onChange={(event) => onChange({ ...draft, maxSizeGb: event.target.value })}
            />
          </label>
        </div>
      </section>
      <section className="stream-config-block behavior-settings">
        <div className="section-heading"><div><h3>Playback behaviour</h3><p>Control availability and playback filtering.</p></div></div>
        <label className="switch-row">
          <span><strong>Cached streams only</strong><small>Only return files ready to play instantly.</small></span>
          <input type="checkbox" checked={draft.cachedOnly} onChange={(event) => onChange({ ...draft, cachedOnly: event.target.checked })} />
          <i aria-hidden="true" />
        </label>
      </section>
    </>
  );
}
