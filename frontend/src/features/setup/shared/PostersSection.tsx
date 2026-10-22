import { useEffect, useMemo, useState } from 'react';
import {
  ARTWORK_KEY_FIELDS,
  POSTER_PROVIDERS,
  POSTER_PAIRS,
  VERIFY_ENDPOINTS,
  type PosterSample,
  type SetupKeysDraft,
} from '@/features/setup/shared/config-contract';
import { KeyInput } from '@/features/setup/shared/sections';
import { PosterStudio } from '@/features/setup/shared/poster-studio/PosterStudio';
import {
  loadPictoriumOptions,
  loadPosterTemplate,
  loadTokenMap,
  useLegacyLib,
  type PictoriumOptionsLib,
  type PosterTemplateLib,
  type TokenMapLib,
} from '@/features/setup/shared/legacy-libs';

export interface PostersDraft {
  provider: string;
  pictoriumUrl: string;
  pictoriumOptions: Record<string, boolean>;
  customTemplate: string;
}

export const EMPTY_POSTERS: PostersDraft = {
  provider: '',
  pictoriumUrl: '',
  pictoriumOptions: {},
  customTemplate: '',
};

// Poster extras are provider-specific and their inputs only render for the
// provider that owns them. When the provider changes, anything the new
// provider does not use is dropped: a leftover value would otherwise sit
// invisible (no control on screen clears it) and keep the setup flagged as
// having unsaved changes forever.
export function postersForProvider(draft: PostersDraft): PostersDraft {
  const pictorium = draft.provider === 'pictorium';
  return {
    provider: draft.provider,
    pictoriumUrl: pictorium ? draft.pictoriumUrl : '',
    pictoriumOptions: pictorium ? draft.pictoriumOptions : {},
    customTemplate: draft.provider === 'custom' ? draft.customTemplate : '',
  };
}

// Build the public preview URL for one sample under the chosen provider. The
// URL builders mirror the legacy Configure page exactly; providers whose
// artwork needs a round trip (Fanart.tv, plain TMDB) explain themselves
// instead of showing a broken image.
export function previewUrl(input: {
  provider: string;
  sample: PosterSample;
  keys: SetupKeysDraft;
  customTemplate: string;
  posterTemplate: PosterTemplateLib | null;
  tokenMap: TokenMapLib | null;
  pictoriumOptions: PictoriumOptionsLib | null;
  pictoriumOptionsDraft: Record<string, boolean>;
  pictoriumUrl: string;
}): { url: string | null; note: string | null; error: string | null } {
  const { provider, sample, keys } = input;
  switch (provider) {
    // TMDB is the default (stored as ''). The key is required for the setup,
    // so the preview waits for one too instead of showing art the setup cannot
    // actually load yet.
    case '':
    case 'tmdb': {
      if (!(keys.tmdbApiKey ?? '').trim()) {
        return { url: null, note: 'Add your TMDB key above to see TMDB posters.', error: null };
      }
      return { url: `https://image.tmdb.org/t/p/w342${sample.posterPath}`, note: null, error: null };
    }
    case 'erdb': {
      const token = (keys.erdbToken ?? '').trim();
      if (!token) return { url: null, note: 'Add your ERDB token to see ratings on posters.', error: null };
      return { url: `https://easyratingsdb.com/${encodeURIComponent(token)}/poster/${sample.imdb}.jpg`, note: null, error: null };
    }
    case 'rpdb': {
      const key = (keys.rpdbKey ?? '').trim();
      if (!key) return { url: null, note: 'Add your RPDB key to see rating posters.', error: null };
      return { url: `https://api.ratingposterdb.com/${encodeURIComponent(key)}/imdb/poster-default/${sample.imdb}.jpg?fallback=true`, note: null, error: null };
    }
    case 'betterposter':
      // btttr serves artwork per title, but LeLibrary can only ask for it once
      // it knows each title's IMDb id, which comes from TMDB's external_ids via
      // the user's own key. Without a key there is nothing to show, so the
      // preview says so rather than loading btttr for titles we cannot match.
      // (The provider stays selectable; only the preview is held back.)
      if (!(keys.tmdbApiKey ?? '').trim()) {
        return { url: null, note: 'Add your TMDB key above: BetterPosters needs it to render.', error: null };
      }
      return { url: `https://btttr.cc/poster/imdb/poster-default/${sample.imdb}.jpg`, note: null, error: null };
    case 'custom': {
      const template = input.customTemplate.trim();
      if (!template) return { url: null, note: 'Enter a URL template with {tmdbId} or {imdbId} to preview it.', error: null };
      const check = input.posterTemplate?.validate(template);
      if (!check || !check.ok) {
        return { url: null, note: null, error: check && !check.ok ? check.error : 'Could not check that template' };
      }
      const url = input.posterTemplate?.resolve(template, { imdbId: sample.imdb, tmdbId: sample.id, type: sample.type });
      return url
        ? { url, note: null, error: null }
        : { url: null, note: 'That template needs a field this title does not have.', error: null };
    }
    case 'pictorium': {
      if (!input.tokenMap || !input.pictoriumOptions) {
        return { url: null, note: 'Preparing the Pictorium preview…', error: null };
      }
      const tmdbKey = (keys.tmdbApiKey ?? '').trim();
      if (!tmdbKey) return { url: null, note: 'Add your TMDB key above: Pictorium needs it to render.', error: null };
      // The proxy resolves a self-contained config token; options go through
      // the shared sanitizer so a crafted draft cannot widen the contract.
      const sanitized = input.pictoriumOptions.sanitize({
        ...input.pictoriumOptionsDraft,
        lang: 'en',
      });
      const query = input.pictoriumOptions.toQuery(sanitized);
      const token = input.tokenMap.encodeConfig({
        tmdbApiKey: tmdbKey,
        posterProvider: 'pictorium',
        pictoriumOptions: input.pictoriumOptionsDraft,
        ...(input.pictoriumUrl.trim() ? { pictoriumUrl: input.pictoriumUrl.trim() } : {}),
      });
      const base = `/${encodeURIComponent(token)}/pictorium/${sample.type}/${sample.id}.jpg?preview=1&title=${encodeURIComponent(sample.title)}`;
      return { url: query ? `${base}&${query}` : base, note: null, error: null };
    }
    case 'fanart':
      return { url: null, note: 'Fanart.tv art is fetched per title when your library loads.', error: null };
    default:
      return {
        url: null,
        note: 'Select a poster service above to see a live preview.',
        error: null,
      };
  }
}

export function PosterPreview({ provider, keys, draft }: {
  provider: string;
  keys: SetupKeysDraft;
  draft: PostersDraft;
  onUrlResolved?: (url: string | null) => void;
}) {
  const [pairIndex, setPairIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const posterTemplate = useLegacyLib(loadPosterTemplate);
  const tokenMap = useLegacyLib(loadTokenMap);
  const pictoriumOptions = useLegacyLib(loadPictoriumOptions);
  const pair = POSTER_PAIRS[pairIndex] ?? POSTER_PAIRS[0];

  const resolved = useMemo(() => {
    const shared = { keys, customTemplate: draft.customTemplate, posterTemplate, tokenMap, pictoriumOptions, pictoriumOptionsDraft: draft.pictoriumOptions, pictoriumUrl: draft.pictoriumUrl };
    if (!pair) return [];
    return [pair.movie, pair.series].map((sample) => ({ sample, ...previewUrl({ provider, sample, ...shared }) }));
  }, [provider, pair, keys, draft.customTemplate, draft.pictoriumOptions, draft.pictoriumUrl, posterTemplate, tokenMap, pictoriumOptions]);

  // Smooth crossfade rotation: fade out, swap, fade in.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timer = 0;
    const advance = () => {
      setFading(true);
      timer = window.setTimeout(() => {
        setPairIndex((value) => (value + 1) % POSTER_PAIRS.length);
        timer = window.setTimeout(() => setFading(false), 50);
      }, 400);
    };
    const start = () => {
      window.clearTimeout(timer);
      timer = window.setInterval(advance, 7000);
    };
    const onVisibility = () => { if (document.hidden) window.clearTimeout(timer); else start(); };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  const label = POSTER_PROVIDERS.find((option) => option.id === provider)?.name ?? 'TMDB default';
  const note = resolved.find((entry) => entry.note)?.note ?? null;
  const error = resolved.find((entry) => entry.error)?.error ?? null;
  const showable = resolved.filter((entry) => entry.url);
  // The caption never sticks on "Loading…": once the option libs are in,
  // an empty stage means a missing key or choice, and says so instead.
  const libsLoading = !posterTemplate || !tokenMap || !pictoriumOptions;
  const caption = !pair || showable.length === 0
    ? (!pair || libsLoading ? 'Loading…' : (note ?? 'Select a poster service above.'))
    : `${pair.movie.title} & ${pair.series.title}`;

  return (
    <div className="poster-stage">
      <span className="poster-stage-kicker">{label} preview</span>
      <div className={`poster-stage-viewport${fading ? ' is-fading' : ''}`}>
        {showable.length > 0 ? (
          <div className="poster-pair">
            {showable.map((entry) => (
              <PosterFigure
                key={entry.sample.imdb}
                url={entry.url as string}
                title={entry.sample.title} data-i18n-preserve
                kind={entry.sample.type === 'movie' ? 'film' : 'series'}
              />
            ))}
          </div>
        ) : (
          <div className="poster-pair-empty">
            <div>
              <strong>{error ? 'Check that key' : 'Poster preview'}</strong>
              <small>{error ?? note ?? 'Select a poster service to see a live preview.'}</small>
            </div>
          </div>
        )}
      </div>
      {pair && (
        <div className="poster-stage-meta">
          <span className="poster-stage-caption">
            {caption}
          </span>
        </div>
      )}
    </div>
  );
}

// One poster: a shimmering skeleton while the artwork loads, then the image and
// its name together. Failures degrade to a quiet placeholder, never a broken icon.
function PosterFigure({ url, title, kind }: { url: string; title: string; kind: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => { setState('loading'); }, [url]);

  if (state === 'failed') {
    return (
      <figure>
        <div className="poster-pair-failed">
          <small>Preview unavailable for {title}</small>
        </div>
      </figure>
    );
  }

  return (
    <figure>
      {state === 'loading' && <div className="poster-skeleton" role="status" aria-label={`Loading ${title} poster`} />}
      <img
        src={url}
        alt={`${title} poster`}
        loading="lazy"
        className={state === 'ready' ? 'is-loaded' : 'is-loading'}
        onLoad={() => setState('ready')}
        onError={() => setState('failed')}
      />
      {state === 'ready' && (
        <figcaption>
          {title}<br />
          {kind}
        </figcaption>
      )}
    </figure>
  );
}

// Pictorium Poster Studio (React, shared/poster-studio). Options save into
// pictoriumOptions, the instance URL into pictoriumUrl; the live preview
// encodes a throwaway token from the in-memory TMDB key, exactly like the
// sidebar preview does. Shown on every tier that renders PostersSection with
// the pictorium provider picked.
function PictoriumStudioButton({ keys, draft, onDraft }: {
  keys: SetupKeysDraft;
  draft: PostersDraft;
  onDraft: (next: PostersDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const tokenMap = useLegacyLib(loadTokenMap);
  const pictoriumOptions = useLegacyLib(loadPictoriumOptions);

  // One-line summary of what is set, in plain words.
  const summary = useMemo(() => {
    if (!pictoriumOptions) return ['Defaults'];
    const o = pictoriumOptions.sanitize(draft.pictoriumOptions || {});
    const defaults = pictoriumOptions.DEFAULTS;
    const changes = Object.keys(defaults).filter((key) => String(o[key] ?? '') !== String(defaults[key] ?? '')).length;
    if (changes === 0) return ['Defaults'];
    const styles: Record<string, string> = { shadow: 'Shadow', pill: 'Pill', bar: 'Bar', colored: 'Colour', bordo: 'Outlined', vetro: 'Glass', minimal: 'Minimal' };
    const bits = [`${styles[String(o.bs)] ?? 'Shadow'} badges`];
    if (o.age === '1') bits.push('age ratings');
    if (o.sep === '1') bits.push('separate ratings');
    if (o.theme) bits.push(`${o.theme === 'christmas' ? 'Christmas' : 'Halloween'} frame`);
    bits.push(changes === 1 ? '1 change' : `${changes} changes`);
    // Separate nodes so each piece translates on its own.
    return bits;
  }, [pictoriumOptions, draft.pictoriumOptions]);

  const tmdbKey = (keys.tmdbApiKey ?? '').trim();
  const previewUrl = useMemo(() => {
    if (!tokenMap || !pictoriumOptions || !tmdbKey) return null;
    return (options: Record<string, string | number>, sample: { type: string; tmdbId: string; title: string }) => {
      const token = tokenMap.encodeConfig({
        tmdbApiKey: tmdbKey,
        posterProvider: 'pictorium',
        ...(draft.pictoriumUrl.trim() ? { pictoriumUrl: draft.pictoriumUrl.trim() } : {}),
      });
      const query = pictoriumOptions.toQuery(options);
      const base = `/${encodeURIComponent(token)}/pictorium/${sample.type}/${sample.tmdbId}.jpg?preview=1&title=${encodeURIComponent(sample.title)}`;
      return query ? `${base}&${query}` : base;
    };
  }, [tokenMap, pictoriumOptions, tmdbKey, draft.pictoriumUrl]);

  return (
    <>
      <div className="pictorium-studio-row">
        <button type="button" className="pictorium-open-btn" disabled={!pictoriumOptions} onClick={() => setOpen(true)}>
          {pictoriumOptions ? 'Open Poster Studio' : 'Loading studio…'}
        </button>
        <span className="setup-hint pictorium-summary">
          {summary.map((bit, index) => (
            <span key={bit}>{index > 0 && <span aria-hidden="true"> · </span>}<span>{bit}</span></span>
          ))}
        </span>
      </div>
      {open && pictoriumOptions && (
        <PosterStudio
          lib={pictoriumOptions}
          initial={draft.pictoriumOptions || {}}
          previewUrl={previewUrl}
          onClose={() => setOpen(false)}
          onSave={(options) => {
            onDraft({ ...draft, pictoriumOptions: options as unknown as Record<string, boolean> });
            setOpen(false);
          }}
        />
      )}
      <label className="setup-field">
        <span>Pictorium instance URL</span>
        <input
          type="url" autoComplete="off" spellCheck={false} inputMode="url"
          placeholder="Leave empty to use the built-in studio"
          value={draft.pictoriumUrl}
          onChange={(event) => onDraft({ ...draft, pictoriumUrl: event.target.value })}
        />
        <small className="setup-hint">Leave empty to use the built-in studio. Only enter a URL if you self-host your own Pictorium, and it must be a public HTTPS address.</small>
      </label>
      <p className="setup-note">
        Renders posters live with badges and artwork baked in.
      </p>
    </>
  );
}

// Posters: the seven real providers, their keys, the custom template and the
// Pictorium option set, always beside a live preview that rotates samples.
export function PostersSection({ draft, keys, onDraft, onKeys, hidePreview, hideSelect, savedServices }: {
  draft: PostersDraft;
  keys: SetupKeysDraft;
  onDraft: (next: PostersDraft) => void;
  onKeys: (next: SetupKeysDraft) => void;
  hidePreview?: boolean;
  // The page renders its own provider picker (Quick Look's poster cards) and
  // only wants the per-provider extras: key, template, Pictorium studio.
  hideSelect?: boolean;
  savedServices?: string[] | undefined;
}) {
  const provider = POSTER_PROVIDERS.find((option) => option.id === draft.provider) ?? POSTER_PROVIDERS[0];
  const keyForProvider = draft.provider === 'erdb' ? 'erdbToken'
    : draft.provider === 'rpdb' ? 'rpdbKey'
    : draft.provider === 'fanart' ? 'fanartKey'
    : null;
  const keyField = keyForProvider ? ARTWORK_KEY_FIELDS.find((field) => field.field === keyForProvider) : null;

  function togglePictoriumOption(field: string, enabled: boolean) {
    const next = { ...draft.pictoriumOptions };
    if (enabled) next[field] = true;
    else delete next[field];
    onDraft({ ...draft, pictoriumOptions: next });
  }

  return (
    <div className="posters-layout">
      <div className="posters-controls">
        {!hideSelect && <label className="setup-field">
          <span>Poster provider</span>
          <select value={draft.provider} onChange={(event) => onDraft(postersForProvider({ ...draft, provider: event.target.value }))}>
            {POSTER_PROVIDERS.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
          <small className="setup-hint">{provider?.blurb}</small>
        </label>}

        {keyField && (
          <KeyInput
            label={keyField.label}
            hint={keyField.hint}
            value={keys[keyField.field] ?? ''}
            {...(VERIFY_ENDPOINTS[keyField.field] ? { verifyEndpoint: VERIFY_ENDPOINTS[keyField.field] as string } : {})}
            onChange={(value) => onKeys({ ...keys, [keyField.field]: value })}
            {...(savedServices?.includes(keyField.field) ? { saved: true } : {})}
          />
        )}

        {draft.provider === 'custom' && (
          <label className="setup-field">
            <span>Custom poster template</span>
            <input
              type="text" autoComplete="off" spellCheck={false}
              placeholder="https://img.example.com/{tmdbId}.jpg"
              data-i18n-preserve
              value={draft.customTemplate}
              onChange={(event) => onDraft({ ...draft, customTemplate: event.target.value })}
            />
            <small className="setup-hint">
              HTTPS URL using <span data-i18n-preserve>{'{tmdbId}'}, {'{imdbId}'} or {'{type}'}</span>. The preview below validates it live.
            </small>
          </label>
        )}

        {draft.provider === 'pictorium' && (
          <PictoriumStudioButton draft={draft} keys={keys} onDraft={onDraft} />
        )}

        {draft.provider === 'betterposter' && (
          <p className="setup-note">
            Community artwork from btttr.cc for every title you own.
          </p>
        )}
      </div>
      {!hidePreview && <PosterPreview provider={draft.provider} keys={keys} draft={draft} />}
    </div>
  );
}
