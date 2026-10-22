import { useEffect, useMemo, useRef, useState } from 'react';
import type { PictoriumOptionsLib } from '@/features/setup/shared/legacy-libs';
import {
  buildSections, guessAgeCountry, LOOKS, STYLE_KEYS, shownOffset, storedOffset,
  type Field, type Options, type Section,
} from '@/features/setup/shared/poster-studio/studio-spec';
import '@/features/setup/shared/poster-studio/poster-studio.css';

// Pictorium Poster Studio. Edits the Pictorium option set with a live preview
// rendered through LeLibrary's own poster proxy. Every value goes through the
// shared pictorium-options sanitizer, so the studio can never produce an
// option the server would not forward. Pictorium is a separate AGPL-3.0
// service; this only builds the option set.

const SAMPLES = [
  { id: 'movie', label: 'Film', type: 'movie', tmdbId: '550', title: 'Fight Club' },
  { id: 'series', label: 'Series', type: 'series', tmdbId: '1396', title: 'Breaking Bad' },
] as const;

export function PosterStudio({ lib, initial, previewUrl, onSave, onClose }: {
  lib: PictoriumOptionsLib;
  initial: Record<string, unknown>;
  // Builds the proxy preview URL for the current options, or null without a
  // TMDB key (the preview needs one).
  previewUrl: ((options: Options, sample: { type: string; tmdbId: string; title: string }) => string) | null;
  onSave: (options: Options) => void;
  onClose: () => void;
}) {
  const defaults = lib.DEFAULTS as Options;
  const [options, setOptions] = useState<Options>(() => lib.sanitize(initial) as Options);
  const [sample, setSample] = useState<(typeof SAMPLES)[number]>(SAMPLES[0]);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(['badges']));
  const box = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => buildSections({
    ratingSources: lib.RATING_SOURCES ?? [],
    languages: lib.LANGUAGES ?? [],
    regions: lib.REGIONS ?? [],
    videoFormats: lib.VIDEO_FORMATS ?? [],
  }), [lib]);

  function set(patch: Options) {
    setOptions((prev) => {
      const next = { ...prev, ...patch };
      if (patch.age === '1' && !prev.agecountry) {
        const languages = typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language]);
        next.agecountry = guessAgeCountry(String(prev.region || ''), languages, (lib.REGIONS ?? []) as [string, string][]);
      }
      return lib.sanitize(next) as Options;
    });
  }

  const changed = (key: string) => String(options[key] ?? '') !== String(defaults[key] ?? '');
  const totalChanged = Object.keys(defaults).filter(changed).length;

  // Debounced preview: wait until the controls settle before reloading.
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!previewUrl) return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setSrc(previewUrl(options, sample));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [options, sample, previewUrl]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    box.current?.querySelector<HTMLElement>('button, select, input')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function applyLook(patch: Options) {
    const reset: Options = {};
    for (const key of STYLE_KEYS) reset[key] = defaults[key] ?? '';
    set({ ...reset, ...patch });
  }
  const activeLook = LOOKS.find((look) => STYLE_KEYS.every((key) =>
    String(options[key] ?? '') === String(look.patch[key] ?? defaults[key] ?? '')))?.id ?? null;

  function toggleSection(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function save() {
    // Keep only what differs from the defaults: smaller configs, same posters.
    const out: Options = {};
    for (const key of Object.keys(defaults)) if (changed(key)) out[key] = options[key] as string | number;
    onSave(out);
  }

  return (
    <div className="app-modal ps-modal" role="dialog" aria-modal="true" aria-label="Poster Studio"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="app-modal-box ps" ref={box}>
        <header className="ps-head">
          <div>
            <span className="setup-kicker">Pictorium</span>
            <h3>Poster Studio</h3>
          </div>
          <span className={`ps-count${totalChanged ? ' is-on' : ''}`}>
            {totalChanged === 0 ? 'Defaults' : totalChanged === 1 ? '1 change' : `${totalChanged} changes`}
          </span>
          <button type="button" className="eye-btn" aria-label="Close" onClick={onClose}>✕</button>
        </header>

        <div className="ps-body">
          <aside className="ps-preview">
            <div className="ps-samples" role="group" aria-label="Preview">
              {SAMPLES.map((item) => (
                <button key={item.id} type="button" className={item.id === sample.id ? 'is-on' : ''} aria-pressed={item.id === sample.id} onClick={() => setSample(item)}>
                  {item.label}
                </button>
              ))}
            </div>
            <figure className={`ps-poster${loading && src ? ' is-loading' : ''}`}>
              {previewUrl && src
                ? <img src={src} alt="Poster preview" onLoad={() => setLoading(false)} onError={() => setLoading(false)} />
                : <figcaption>Add your TMDB key to see a live preview.</figcaption>}
            </figure>
            <p className="ps-note" data-i18n-preserve>{sample.title}</p>
          </aside>

          <div className="ps-controls">
            <section className="ps-looks" aria-labelledby="ps-looks">
              <h4 id="ps-looks">Start from a look</h4>
              <div className="ps-look-grid">
                {LOOKS.map((look) => (
                  <button key={look.id} type="button" className={`ps-look${activeLook === look.id ? ' is-on' : ''}`} aria-pressed={activeLook === look.id} onClick={() => applyLook(look.patch)}>
                    <strong>{look.label}</strong>
                    <span>{look.note}</span>
                  </button>
                ))}
              </div>
            </section>

            {sections.map((section) => (
              <StudioSection
                key={section.id} section={section} open={openIds.has(section.id)} onToggle={() => toggleSection(section.id)}
                options={options} defaults={defaults} changed={changed} set={set}
              />
            ))}
          </div>
        </div>

        <footer className="ps-foot">
          <button type="button" className="ps-reset" disabled={totalChanged === 0} onClick={() => setOptions(lib.sanitize({}) as Options)}>Reset to defaults</button>
          <div className="ps-foot-actions">
            <button type="button" className="setup-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="setup-primary" onClick={save}>Save posters</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// Pixel nudge readout: +5, 0, -5.
function signed(value: number): string {
  return value > 0 ? '+' + String(value) : String(value);
}

function fieldKeys(field: Field): string[] {
  switch (field.kind) {
    case 'chips': return field.items.map((item) => item.key);
    case 'nudge': return [field.scale, field.x, field.y, ...(field.extra && 'key' in field.extra ? [field.extra.key] : [])];
    default: return [field.key];
  }
}

function StudioSection({ section, open, onToggle, options, defaults, changed, set }: {
  section: Section;
  open: boolean;
  onToggle: () => void;
  options: Options;
  defaults: Options;
  changed: (key: string) => boolean;
  set: (patch: Options) => void;
}) {
  const count = section.fields.flatMap(fieldKeys).filter(changed).length;
  return (
    <section className={`ps-section${open ? ' is-open' : ''}${section.advanced ? ' is-advanced' : ''}`}>
      <button type="button" className="ps-section-head" aria-expanded={open} onClick={onToggle}>
        <span>
          <strong>{section.title}</strong>
          <small>{section.summary}</small>
        </span>
        {count > 0 && <em>{count}</em>}
        <i aria-hidden="true">{open ? '−' : '+'}</i>
      </button>
      {open && (
        <div className="ps-section-body">
          {section.fields.map((field, index) => (
            ('when' in field && field.when && !field.when(options)) ? null
              : <StudioField key={index} field={field} options={options} defaults={defaults} set={set} />
          ))}
        </div>
      )}
    </section>
  );
}

function StudioField({ field, options, defaults, set }: {
  field: Field;
  options: Options;
  defaults: Options;
  set: (patch: Options) => void;
}) {
  switch (field.kind) {
    case 'seg':
      return (
        <div className="ps-field">
          <span className="ps-label">{field.label}</span>
          <div className="ps-seg" role="group" aria-label={field.label}>
            {field.options.map(([value, label]) => (
              <button key={value} type="button" className={String(options[field.key] ?? '') === value ? 'is-on' : ''} aria-pressed={String(options[field.key] ?? '') === value} onClick={() => set({ [field.key]: value })}>
                {label}
              </button>
            ))}
          </div>
          {field.hint && <small className="ps-hint">{field.hint}</small>}
        </div>
      );
    case 'toggle': {
      const onValue = field.on ?? '1';
      const offValue = field.off ?? '0';
      const checked = String(options[field.key] ?? '') === onValue;
      return (
        <label className="ps-toggle">
          <span>
            <strong>{field.label}</strong>
            {field.hint && <small>{field.hint}</small>}
          </span>
          <input type="checkbox" checked={checked} onChange={(event) => set({ [field.key]: event.target.checked ? onValue : offValue })} />
          <i aria-hidden="true" />
        </label>
      );
    }
    case 'select':
      return (
        <label className="ps-field">
          <span className="ps-label">{field.label}</span>
          <select value={String(options[field.key] ?? '')} onChange={(event) => set({ [field.key]: event.target.value })}>
            {field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {field.hint && <small className="ps-hint">{field.hint}</small>}
        </label>
      );
    case 'slider': {
      const value = Number(options[field.key] ?? defaults[field.key] ?? field.min);
      return (
        <label className="ps-field ps-slider">
          <span className="ps-label">{field.label}<output>{value}{field.unit ?? ''}</output></span>
          <input type="range" min={field.min} max={field.max} step={field.step} value={value} onChange={(event) => set({ [field.key]: Number(event.target.value) })} />
          {field.hint && <small className="ps-hint">{field.hint}</small>}
        </label>
      );
    }
    case 'chips':
      return (
        <div className="ps-field">
          <span className="ps-label">{field.label}</span>
          <div className="ps-seg ps-multi" role="group" aria-label={field.label}>
            {field.items.map((item) => {
              const on = String(options[item.key] ?? '1') !== '0';
              return (
                <button key={item.key} type="button" className={on ? 'is-on' : ''} aria-pressed={on} onClick={() => set({ [item.key]: on ? '0' : '1' })}>
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      );
    case 'order': {
      const raw = String(options[field.key] ?? '');
      const none = raw === 'none';
      const list = none ? [] : (raw ? raw.split(',') : (field.defaultOrder ?? []));
      const toggle = (id: string) => {
        const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
        set({ [field.key]: next.length ? next.join(',') : (field.noneLabel ? 'none' : '') });
      };
      return (
        <div className="ps-field">
          <span className="ps-label">{field.label}</span>
          <div className="ps-seg ps-multi ps-order" role="group" aria-label={field.label}>
            {field.options.map(([id, label]) => {
              const position = list.indexOf(id);
              return (
                <button key={id} type="button" className={position !== -1 ? 'is-on' : ''} aria-pressed={position !== -1} onClick={() => toggle(id)}>
                  {position !== -1 && <b aria-hidden="true">{position + 1}</b>}{label}
                </button>
              );
            })}
            {field.noneLabel && (
              <button type="button" className={`ps-none${none ? ' is-on' : ''}`} aria-pressed={none} onClick={() => set({ [field.key]: none ? '' : 'none' })}>{field.noneLabel}</button>
            )}
          </div>
          {field.hint && <small className="ps-hint">{field.hint}</small>}
        </div>
      );
    }
    case 'formats': {
      const raw = String(options[field.key] ?? '');
      const all = field.options.map(([id]) => id);
      const list = raw === 'none' ? [] : (raw ? raw.split(',') : all);
      const toggle = (id: string) => {
        const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
        set({ [field.key]: next.length ? next.join(',') : 'none' });
      };
      return (
        <div className="ps-field">
          <span className="ps-label">{field.label}</span>
          <div className="ps-seg ps-multi" role="group" aria-label={field.label}>
            {field.options.map(([id, label]) => (
              <button key={id} type="button" className={list.includes(id) ? 'is-on' : ''} aria-pressed={list.includes(id)} onClick={() => toggle(id)}>{label}</button>
            ))}
          </div>
          {field.hint && <small className="ps-hint">{field.hint}</small>}
        </div>
      );
    }
    case 'color': {
      const value = String(options[field.key] ?? '');
      return (
        <div className="ps-field">
          <span className="ps-label">{field.label}</span>
          <div className="ps-color">
            <button type="button" className={!value ? 'is-on' : ''} aria-pressed={!value} onClick={() => set({ [field.key]: '' })}>Automatic</button>
            <label className={value ? 'is-on' : ''}>
              <input type="color" value={value || '#f59e0b'} aria-label={field.label} onChange={(event) => set({ [field.key]: event.target.value })} />
              <span data-i18n-preserve>{value || '#f59e0b'}</span>
            </label>
          </div>
          {field.hint && <small className="ps-hint">{field.hint}</small>}
        </div>
      );
    }
    case 'nudge': {
      const [bx, by] = field.base ?? [0, 0];
      const scaleRaw = options[field.scale];
      const scale = scaleRaw === '' || scaleRaw == null ? field.scaleDefault : Number(scaleRaw);
      const x = shownOffset(Number(options[field.x] ?? 0), bx);
      const y = shownOffset(Number(options[field.y] ?? 0), by);
      const touched = (field.nullableScale ? scaleRaw !== '' && scaleRaw != null : scale !== field.scaleDefault) || x !== 0 || y !== 0;
      const reset = () => set({ [field.scale]: field.nullableScale ? '' : field.scaleDefault, [field.x]: 0, [field.y]: 0 });
      return (
        <div className="ps-nudge">
          <div className="ps-nudge-head">
            <strong>{field.label}</strong>
            {touched && <button type="button" onClick={reset}>Reset</button>}
          </div>
          <label className="ps-slider"><span className="ps-label">Size<output>{scale}%</output></span>
            <input type="range" min={10} max={200} step={10} value={scale} onChange={(event) => set({ [field.scale]: Number(event.target.value) })} />
          </label>
          <label className="ps-slider"><span className="ps-label">Left and right<output>{signed(x)}</output></span>
            <input type="range" min={-200} max={200} step={5} value={x} onChange={(event) => set({ [field.x]: storedOffset(Number(event.target.value), bx) })} />
          </label>
          <label className="ps-slider"><span className="ps-label">Up and down<output>{signed(y)}</output></span>
            <input type="range" min={-200} max={200} step={5} value={y} onChange={(event) => set({ [field.y]: storedOffset(Number(event.target.value), by) })} />
          </label>
          {field.extra && <StudioField field={field.extra} options={options} defaults={defaults} set={set} />}
        </div>
      );
    }
    default:
      return null;
  }
}
