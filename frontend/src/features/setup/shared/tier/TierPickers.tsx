import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  FORMAT_SAMPLES,
  POSTER_PAIRS,
  STREAM_PRESETS,
  type StreamPresetId,
} from '@/features/setup/shared/config-contract';
import { BADGE_PACKS, isValidBadgeUrl } from '@/features/setup/shared/BadgePackPicker';
import { BadgePackButton, PackPreview } from '@/features/setup/shared/BadgePackModal';
import { FEATURED_PRESETS, type FormattingDraft } from '@/features/setup/shared/FormattingSection';
import { loadFormatter, useLegacyLib } from '@/features/setup/shared/legacy-libs';

// Public TMDB poster art for the sample titles (no key needed): the same paths
// the sidebar preview uses, so the cards and the preview agree.
export function samplePoster(index: number, size = 'w342'): string {
  const pair = POSTER_PAIRS[index % POSTER_PAIRS.length] ?? POSTER_PAIRS[0];
  const sample = index % 2 === 0 ? pair?.movie : pair?.series;
  return `https://image.tmdb.org/t/p/${size}${sample?.posterPath ?? ''}`;
}

// ── Nuvio badge packs: chips you tap, live strip of the chosen pack ──

export function BadgePackStrip({ pack, customUrl, onChange }: {
  pack: string;
  customUrl: string;
  onChange: (next: { pack: string; url: string }) => void;
}) {
  const selected = BADGE_PACKS.find((entry) => entry.id === pack) ?? BADGE_PACKS[0];
  return (
    <div className="qs-packs">
      <div className="qs-pack-live">
        <div className="qs-pack-live-copy">
          <strong>{selected?.name}</strong>
          <small>{selected?.description}</small>
        </div>
        <PackPreview pack={pack} customUrl={customUrl} />
      </div>
      <div className="qs-chips" role="radiogroup" aria-label="Badge pack">
        {BADGE_PACKS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="radio"
            aria-checked={entry.id === pack}
            className={`qs-chip${entry.id === pack ? ' is-selected' : ''}`}
            onClick={() => onChange({ pack: entry.id, url: entry.id === 'custom' ? customUrl : (entry.url ?? '') })}
          >
            {entry.name}
          </button>
        ))}
      </div>
      {pack === 'custom' && (
        <label className="setup-field qs-pack-url">
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
      <div className="qs-pack-foot">
        <p className="setup-note-pill">Nuvio only · badge packs don&apos;t change Stremio</p>
        <BadgePackButton pack={pack} customUrl={customUrl} onChange={onChange} />
      </div>
    </div>
  );
}

// ── Stream styles: each preset rendered by the real formatter ──

function useRenderedPresets(sampleIndex: number) {
  const formatter = useLegacyLib(loadFormatter);
  return useMemo(() => {
    const out: Record<string, { name: string; description: string } | null> = {};
    if (!formatter) return out;
    const sample = FORMAT_SAMPLES[sampleIndex] ?? FORMAT_SAMPLES[0];
    if (!sample) return out;
    for (const option of STREAM_PRESETS) {
      const preset = formatter.presets[option.id];
      if (!preset) { out[option.id] = null; continue; }
      try {
        out[option.id] = formatter.formatStream(preset.name || '{addon.name}', preset.description || '', sample.filename, sample.source, sample.size, {});
      } catch {
        out[option.id] = null;
      }
    }
    return out;
  }, [formatter, sampleIndex]);
}

const LEAD_PRESETS: readonly string[] = ['lelibrary', ...FEATURED_PRESETS];

export function StreamStylePicker({ draft, onPick, children }: {
  draft: FormattingDraft;
  onPick: (preset: StreamPresetId) => void;
  children?: ReactNode;
}) {
  const [sampleIndex, setSampleIndex] = useState(0);
  const [showAll, setShowAll] = useState(() => !LEAD_PRESETS.includes(draft.preset));
  const rendered = useRenderedPresets(sampleIndex);
  const visible = STREAM_PRESETS.filter((option) => showAll || LEAD_PRESETS.includes(option.id));
  const hiddenCount = STREAM_PRESETS.length - visible.length;

  return (
    <div className="qs-streams">
      <div className="qs-streams-head">
        <span className="qs-sample" data-i18n-preserve>{(FORMAT_SAMPLES[sampleIndex] ?? FORMAT_SAMPLES[0])?.filename}</span>
        <button type="button" className="qs-link" onClick={() => setSampleIndex((value) => (value + 1) % FORMAT_SAMPLES.length)}>
          Another sample ↻
        </button>
      </div>
      <div className="qs-stream-list" role="radiogroup" aria-label="Stream display style">
        {visible.map((option, index) => {
          const output = rendered[option.id];
          const selected = draft.preset === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`qs-stream${selected ? ' is-selected' : ''}`}
              style={{ '--qs-i': index } as CSSProperties}
              onClick={() => onPick(option.id)}
            >
              <span className="qs-stream-name">
                <strong>{option.name}</strong>
                <span className="qs-check" aria-hidden="true">✓</span>
              </span>
              {option.id === 'custom' ? (
                <span className="qs-stream-out is-custom">
                  <span data-i18n-preserve>{'{stream.resolution} {stream.quality}'}</span>
                  <small>Write your own name and description templates.</small>
                </span>
              ) : output ? (
                <span className="qs-stream-out">
                  <span className="qs-stream-title" data-i18n-preserve>{output.name}</span>
                  <span className="qs-stream-desc" data-i18n-preserve>{output.description}</span>
                </span>
              ) : (
                <span className="qs-stream-out is-loading" aria-hidden="true"><i /><i /><i /></span>
              )}
            </button>
          );
        })}
      </div>
      {!showAll && hiddenCount > 0 && (
        <button type="button" className="qs-more" onClick={() => setShowAll(true)}>
          {`Show ${hiddenCount} more styles`}
        </button>
      )}
      {children}
    </div>
  );
}

// Picking a preset seeds the template boxes with that preset's real templates
// (the same rule FormattingSection uses); `custom` starts empty.
export function usePresetPicker(draft: FormattingDraft, onChange: (next: FormattingDraft) => void) {
  const formatter = useLegacyLib(loadFormatter);
  return (next: StreamPresetId) => {
    if (next === 'custom') {
      onChange({ ...draft, preset: next, nameTemplate: '', descTemplate: '' });
      return;
    }
    const chosen = formatter?.presets[next];
    onChange({ ...draft, preset: next, nameTemplate: chosen?.name ?? '', descTemplate: chosen?.description ?? '' });
  };
}
