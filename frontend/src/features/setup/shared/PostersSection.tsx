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
import {
  loadPosterTemplate,
  useLegacyLib,
  type PosterTemplateLib,
} from '@/features/setup/shared/legacy-libs';

export interface PostersDraft {
  provider: string;
  customTemplate: string;
}

export const EMPTY_POSTERS: PostersDraft = {
  provider: '',
  customTemplate: '',
};

// Poster extras are provider-specific and their inputs only render for the
// provider that owns them. When the provider changes, anything the new
// provider does not use is dropped: a leftover value would otherwise sit
// invisible (no control on screen clears it) and keep the setup flagged as
// having unsaved changes forever.
export function postersForProvider(draft: PostersDraft): PostersDraft {
  return {
    provider: draft.provider,
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
    case 'postersplus': {
      const link = (keys.postersPlusUrl ?? '').trim();
      if (!link) return { url: null, note: 'Paste your Posters+ link to see your style.', error: null };
      if (!input.posterTemplate?.fromPostersPlus) return { url: null, note: 'Preparing the Posters+ preview…', error: null };
      const checked = input.posterTemplate.fromPostersPlus(link);
      if (!checked.ok) return { url: null, note: null, error: checked.error };
      const url = input.posterTemplate.resolve(checked.value, { imdbId: sample.imdb, tmdbId: sample.id, type: sample.type });
      return url ? { url, note: null, error: null } : { url: null, note: 'That link needs a field this title does not have.', error: null };
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
  const pair = POSTER_PAIRS[pairIndex] ?? POSTER_PAIRS[0];

  const resolved = useMemo(() => {
    const shared = { keys, customTemplate: draft.customTemplate, posterTemplate };
    if (!pair) return [];
    return [pair.movie, pair.series].map((sample) => ({ sample, ...previewUrl({ provider, sample, ...shared }) }));
  }, [provider, pair, keys, draft.customTemplate, posterTemplate]);

  // Smooth crossfade rotation: fade out, swap, fade in.
  const rotate = true;
  useEffect(() => {
    if (typeof window === 'undefined' || !rotate) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // The interval and the fade timeouts need their own handles: sharing one
    // lost the interval, and every return to the tab stacked another one, so
    // the preview rotated faster and faster.
    let interval = 0;
    let fade = 0;
    const advance = () => {
      setFading(true);
      fade = window.setTimeout(() => {
        setPairIndex((value) => (value + 1) % POSTER_PAIRS.length);
        fade = window.setTimeout(() => setFading(false), 50);
      }, 400);
    };
    const stop = () => { window.clearInterval(interval); window.clearTimeout(fade); };
    const start = () => { stop(); interval = window.setInterval(advance, 7000); };
    const onVisibility = () => { if (document.hidden) stop(); else start(); };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); setFading(false); document.removeEventListener('visibilitychange', onVisibility); };
  }, [rotate]);

  const label = POSTER_PROVIDERS.find((option) => option.id === provider)?.name ?? 'TMDB default';
  const note = resolved.find((entry) => entry.note)?.note ?? null;
  const error = resolved.find((entry) => entry.error)?.error ?? null;
  const showable = resolved.filter((entry) => entry.url);
  // The caption never sticks on "Loading…": once the option libs are in,
  // an empty stage means a missing key or choice, and says so instead.
  const libsLoading = !posterTemplate;
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

// Posters: the seven real providers, their keys, the custom template and a
// live preview that rotates samples.
export function PostersSection({ draft, keys, onDraft, onKeys, hidePreview, hideSelect, savedServices }: {
  draft: PostersDraft;
  keys: SetupKeysDraft;
  onDraft: (next: PostersDraft) => void;
  onKeys: (next: SetupKeysDraft) => void;
  hidePreview?: boolean;
  // The page renders its own provider picker (Quick Look's poster cards) and
  // only wants the per-provider extras: key, template.
  hideSelect?: boolean;
  savedServices?: string[] | undefined;
}) {
  const provider = POSTER_PROVIDERS.find((option) => option.id === draft.provider) ?? POSTER_PROVIDERS[0];
  const keyForProvider = draft.provider === 'erdb' ? 'erdbToken'
    : draft.provider === 'rpdb' ? 'rpdbKey'
    : draft.provider === 'fanart' ? 'fanartKey'
    : draft.provider === 'postersplus' ? 'postersPlusUrl'
    : null;
  const keyField = keyForProvider ? ARTWORK_KEY_FIELDS.find((field) => field.field === keyForProvider) : null;

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
