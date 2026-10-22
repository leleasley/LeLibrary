import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_STREAM_PRESET,
  FORMAT_SAMPLES,
  STREAM_PRESETS,
  type StreamPresetId,
} from '@/features/setup/shared/config-contract';
import { loadFormatter, useLegacyLib } from '@/features/setup/shared/legacy-libs';
import { LOCAL_BADGE_BASE, LOCAL_BADGE_SAMPLE, useBadgePreview } from '@/features/setup/shared/BadgePackPicker';

export interface FormattingDraft {
  preset: StreamPresetId;
  nameTemplate: string;
  descTemplate: string;
}

export const EMPTY_FORMATTING: FormattingDraft = {
  preset: DEFAULT_STREAM_PRESET,
  nameTemplate: '',
  descTemplate: '',
};

// Live stream preview: runs the SAME formatter engine the server uses against
// a real filename, so what you see here is exactly what Stremio/Nuvio get.
export function FormattingPreview({ draft, sampleIndex = 0, badgePack = 'lelibrary-premium', badgeUrl = '' }: {
  draft: FormattingDraft;
  sampleIndex?: number;
  badgePack?: string;
  badgeUrl?: string;
}) {
  const formatter = useLegacyLib(loadFormatter);
  const preset = formatter?.presets[draft.preset];
  const badgeState = useBadgePreview(badgePack, badgeUrl);

  const rendered = useMemo(() => {
    if (!formatter) return null;
    const sample = FORMAT_SAMPLES[sampleIndex] ?? FORMAT_SAMPLES[0];
    if (!sample) return null;
    const nameTemplate = draft.preset === 'custom' ? draft.nameTemplate : (preset?.name ?? '');
    const descTemplate = draft.preset === 'custom' ? draft.descTemplate : (preset?.description ?? '');
    if (!nameTemplate && !descTemplate) return null;
    try {
      return formatter.formatStream(
        nameTemplate || '{addon.name}',
        descTemplate || '',
        sample.filename,
        sample.source,
        sample.size,
        {},
      );
    } catch {
      return null;
    }
  }, [formatter, draft.preset, draft.nameTemplate, draft.descTemplate, preset, sampleIndex]);

  if (!formatter) return <div className="fmt-preview is-loading">Loading the formatter…</div>;
  if (!rendered) return <div className="fmt-preview is-loading">Choose a preset to see the preview.</div>;

  return (
    <div className="fmt-preview">
      <span className="fmt-preview-kicker">Live preview · {(FORMAT_SAMPLES[sampleIndex] ?? FORMAT_SAMPLES[0])?.filename}</span>
      <div className="fmt-row">
        <div className="fmt-text">
          <strong data-i18n-preserve>{rendered.name}</strong>
          <div className="fmt-desc">{rendered.description}</div>
        </div>
      </div>
      {(badgeState.mode === 'local' || badgeState.mode === 'remote') && (
        <div className="fmt-badges" aria-label="Badge preview">
          {badgeState.mode === 'local'
            ? LOCAL_BADGE_SAMPLE.map((id) => (
                <img key={id} src={`${LOCAL_BADGE_BASE}/${id}.png`} alt="" loading="lazy" />
              ))
            : badgeState.badges.map((badge) => (
                <i
                  key={badge.imageURL}
                  className={`badge-remote${badge.bordered ? ' is-bordered' : ''}`}
                  style={{ '--badge-border': badge.borderColor, '--badge-fill': badge.tagColor } as React.CSSProperties}
                  data-i18n-preserve title={badge.name}
                >
                  <img src={badge.imageURL} alt={badge.name} data-i18n-preserve loading="lazy" />
                </i>
              ))}
        </div>
      )}
    </div>
  );
}

// Formatting: preset picker, optional hand-written templates, live preview.
export function FormattingSection({ draft, onChange, badgePack, badgeUrl, onFormatterReady, templatesOnly }: {
  draft: FormattingDraft;
  onChange: (next: FormattingDraft) => void;
  badgePack?: string;
  badgeUrl?: string;
  onFormatterReady?: (presets: Record<string, { name: string; description: string }> | null) => void;
  // The page renders its own preset picker and preview (Quick Look's stream
  // cards) and only wants the custom template boxes from here.
  templatesOnly?: boolean;
}) {
  const [sampleIndex, setSampleIndex] = useState(0);
  const formatter = useLegacyLib(loadFormatter);
  const isCustom = draft.preset === 'custom';
  const preset = formatter?.presets[draft.preset];

  useEffect(() => { onFormatterReady?.(formatter?.presets ?? null); }, [formatter, onFormatterReady]);

  // Switching preset seeds the template boxes with that preset's real
  // templates, exactly like the legacy page did; `custom` starts empty.
  function pickPreset(next: StreamPresetId) {
    if (next === 'custom') {
      onChange({ ...draft, preset: next, nameTemplate: '', descTemplate: '' });
      return;
    }
    const chosen = formatter?.presets[next];
    onChange({
      ...draft,
      preset: next,
      nameTemplate: chosen?.name ?? '',
      descTemplate: chosen?.description ?? '',
    });
  }

  if (templatesOnly && !isCustom) return null;

  return (
    <>
      {!templatesOnly && <label className="setup-field">
        <span>Stream display style</span>
        <select value={draft.preset} onChange={(event) => pickPreset(event.target.value as StreamPresetId)}>
          {STREAM_PRESETS.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
      </label>}

      {isCustom && (
        <>
          <label className="setup-field">
            <span>Name template</span>
            <textarea
              rows={2} spellCheck={false} className="setup-textarea"
              placeholder="{addon.name} {stream.resolution}"
              data-i18n-preserve
              value={draft.nameTemplate}
              onChange={(event) => onChange({ ...draft, nameTemplate: event.target.value })}
            />
          </label>
          <label className="setup-field">
            <span>Description template</span>
            <textarea
              rows={4} spellCheck={false} className="setup-textarea"
              placeholder={'{stream.quality}\n{stream.filename}\n{stream.size::bytes}'}
              data-i18n-preserve
              value={draft.descTemplate}
              onChange={(event) => onChange({ ...draft, descTemplate: event.target.value })}
            />
            <small className="setup-hint">
              <span data-i18n-preserve>Variables like {'{stream.filename}'}, {'{stream.size::bytes}'} and {'{service.shortName}'}</span> are filled per stream.
            </small>
          </label>
        </>
      )}

      {!templatesOnly && !isCustom && preset && (
        <p className="setup-note">
          Using <strong>{STREAM_PRESETS.find((p) => p.id === draft.preset)?.name}</strong>. Pick "Custom templates" to write your own.
        </p>
      )}

      {!templatesOnly && (
        <>
          <FormattingPreview
            draft={draft}
            sampleIndex={sampleIndex}
            {...(badgePack ? { badgePack } : {})}
            {...(badgeUrl ? { badgeUrl } : {})}
          />
          <div className="setup-actions" style={{ justifyContent: 'flex-start', marginTop: '10px' }}>
            <button
              type="button"
              className="setup-secondary"
              onClick={() => setSampleIndex((value) => (value + 1) % FORMAT_SAMPLES.length)}
            >
              Another sample ↻
            </button>
          </div>
        </>
      )}
    </>
  );
}

// Presets the reference calls out by name, surfaced ahead of the long list.
export const FEATURED_PRESETS = ['cinema', 'remux', 'compact', 'technical'] as const;
