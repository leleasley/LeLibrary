import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  FORMAT_SAMPLES,
  METADATA_KEY_FIELDS,
  POSTER_PAIRS,
  STREAM_PRESETS,
  VERIFY_ENDPOINTS,
  type SetupKeysDraft,
  type StreamPresetId,
} from '@/features/setup/shared/config-contract';
import { KeyInput, type RevealProps } from '@/features/setup/shared/sections';
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

// ── Metadata keys: TMDB is the one that matters, the other two are extras ──

const METADATA_LOGOS: Partial<Record<keyof SetupKeysDraft, string>> = {
  tmdbApiKey: '/logos/TMDB.svg',
  tvdbApiKey: '/tvdb.png',
};

export function TierMetadata({ values, onChange, savedServices, savedScope, revealSaved }: {
  values: SetupKeysDraft;
  onChange: (next: SetupKeysDraft) => void;
} & RevealProps) {
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [tmdb, ...optional] = METADATA_KEY_FIELDS;
  if (!tmdb) return null;

  function field(entry: (typeof METADATA_KEY_FIELDS)[number], compact: boolean) {
    const logo = METADATA_LOGOS[entry.field];
    return (
      <div
        key={entry.field}
        className={`qs-key${compact ? ' is-compact' : ' is-primary'}${verified[entry.field] ? ' is-verified' : ''}${(values[entry.field] ?? '').trim() ? ' is-filled' : ''}`}
      >
        <div className="qs-key-brand">
          {logo
            ? <img src={logo} alt="" />
            : <span className="qs-key-mono" aria-hidden="true">{entry.label.slice(0, 4)}</span>}
        </div>
        <KeyInput
          label={entry.label}
          hint={compact ? '' : entry.hint}
          {...(entry.required ? { required: true } : {})}
          {...(entry.placeholder ? { placeholder: entry.placeholder } : {})}
          {...(entry.docsUrl ? { docsUrl: entry.docsUrl } : {})}
          value={values[entry.field] ?? ''}
          {...(VERIFY_ENDPOINTS[entry.field] ? { verifyEndpoint: VERIFY_ENDPOINTS[entry.field] as string } : {})}
          onVerifyResult={(ok) => setVerified((prev) => ({ ...prev, [entry.field]: ok }))}
          onChange={(value) => onChange({ ...values, [entry.field]: value })}
          {...(savedServices?.includes(entry.field) ? { saved: true } : {})}
          {...(savedScope ? { savedScope } : {})}
          {...(savedServices?.includes(entry.field) && revealSaved ? { onReveal: () => revealSaved(entry.field) } : {})}
        />
      </div>
    );
  }

  return (
    <div className="qs-meta">
      <div className="qs-sub">
        <strong>Match titles and artwork</strong>
        <span>TMDB required · TVDB and OMDb optional</span>
      </div>
      {field(tmdb, false)}
      <div className="qs-meta-optional">{optional.map((entry) => field(entry, true))}</div>
    </div>
  );
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
