import { toast } from '@/features/setup/shared/Toast';

// Codec / HDR / audio include sets for the Playback filters. The value lists
// are what saved configs and the backend filter already use, so keep them
// exact. Toggling is a plain add/delete with no last-item guard.
// Empty means all included, matching the settled FilterSets vocabulary.
export const ALL_CODECS = ['AV1', 'HEVC', 'AVC', 'XviD'];
export const ALL_HDR = ['Dolby Vision', 'HDR10+', 'HDR10', 'HDR', 'SDR'];
export const ALL_AUDIO = [
  'TrueHD Atmos', 'TrueHD', 'DTS-HD MA', 'DTS-HD', 'DTS', 'Atmos',
  'DD+ 5.1', 'DD 5.1', 'AAC', 'FLAC',
];

export interface MediaSetsDraft {
  codecs: string[];
  hdr: string[];
  audio: string[];
}

export const EMPTY_MEDIA_SETS: MediaSetsDraft = { codecs: [], hdr: [], audio: [] };

export function toggleMediaItem(selected: string[], all: string[], value: string): string[] {
  const set = new Set(selected.length === 0 ? all : selected);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  const next = [...set];
  return next.length === all.length ? [] : next;
}

export function mediaSummary(selected: string[], total: number): string {
  return selected.length === 0 ? 'All included' : `${selected.length} of ${total} included`;
}

function chips(values: string[], selected: string[], onToggle: (value: string) => void) {
  return (
    <div className="stream-filter-chips">
      {values.map((value) => {
        const enabled = selected.length === 0 || selected.includes(value);
        return (
          <button
            key={value} type="button"
            className={`stream-filter-chip${enabled ? ' selected' : ''}`}
            aria-pressed={enabled} onClick={() => onToggle(value)}
          >
            {value}
          </button>
        );
      })}
    </div>
  );
}

export function FilterMediaSets({ draft, onChange, onToast }: {
  draft: MediaSetsDraft;
  onChange: (next: MediaSetsDraft) => void;
  onToast?: (message: string) => void;
}) {
  function toggle(kind: 'codecs' | 'hdr' | 'audio', value: string) {
    const all = kind === 'codecs' ? ALL_CODECS : kind === 'hdr' ? ALL_HDR : ALL_AUDIO;
    const next = toggleMediaItem(draft[kind], all, value);
    if (next.length === 0 && draft[kind].length > 0) {
      (onToast ?? ((message: string) => toast(message, 'error')))(`Keep at least one ${kind}`);
      return;
    }
    onChange({ ...draft, [kind]: next });
  }

  return (
    <>
      <details className="stream-config-section" open>
        <summary>
          <span><strong>Codecs</strong><small>Included video codecs</small></span>
          <span className="stream-config-summary-note">{mediaSummary(draft.codecs, ALL_CODECS.length)}</span>
        </summary>
        <div className="stream-config-body">{chips(ALL_CODECS, draft.codecs, (value) => toggle('codecs', value))}</div>
      </details>
      <details className="stream-config-section" open>
        <summary>
          <span><strong>HDR</strong><small>Included HDR tags</small></span>
          <span className="stream-config-summary-note">{mediaSummary(draft.hdr, ALL_HDR.length)}</span>
        </summary>
        <div className="stream-config-body">{chips(ALL_HDR, draft.hdr, (value) => toggle('hdr', value))}</div>
      </details>
      <details className="stream-config-section" open>
        <summary>
          <span><strong>Audio</strong><small>Included audio formats</small></span>
          <span className="stream-config-summary-note">{mediaSummary(draft.audio, ALL_AUDIO.length)}</span>
        </summary>
        <div className="stream-config-body">{chips(ALL_AUDIO, draft.audio, (value) => toggle('audio', value))}</div>
      </details>
    </>
  );
}
