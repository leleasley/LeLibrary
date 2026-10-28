import {
  MAX_REGEX_LENGTH,
  playbackValidation,
  type NuvioPlaybackDraft,
  type PlaybackMode,
} from '@/features/setup/shared/nuvio-playback';
import { setupCopy } from '@/features/setup/shared/setup-copy';
import { NuvioCurrentNote, playbackSummary } from '@/features/setup/nuvio/NuvioCurrentNote';
import type { NuvioSettingValues } from '@/features/setup/nuvio/prefill';

// Mirror of Nuvio's own playback choices (labels and descriptions match its
// settings screen) so a user can configure the player from the setup instead
// of hunting through the app. Opt-in: an untouched setup leaves Nuvio alone.
const MODES: { id: PlaybackMode; label: string; desc: string }[] = [
  {
    id: 'MANUAL',
    label: 'Manual (choose stream)',
    desc: 'Always show the source list and let me choose.',
  },
  {
    id: 'FIRST_STREAM',
    label: 'Auto-play first source',
    desc: 'Play the first available source automatically.',
  },
  {
    id: 'REGEX_MATCH',
    label: 'Auto-play regex match',
    desc: 'Play the first source whose text matches your pattern.',
  },
];

export function NuvioPlaybackSection({ value, onChange, current }: {
  value: NuvioPlaybackDraft;
  onChange: (next: NuvioPlaybackDraft) => void;
  // Edit page: what the Nuvio profile has now.
  current?: NuvioSettingValues | null | undefined;
}) {
  const error = playbackValidation(value);
  return (
    <div className="nuvio-playback">
      <NuvioCurrentNote summary={playbackSummary(current)} />
      <label className="nuvio-playback-enable">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
        />
        <span>Set these in Nuvio when I push</span>
      </label>

      {value.enabled && (
        <>
          <fieldset className="nuvio-playback-modes">
            <legend>Auto Stream Selection</legend>
            {MODES.map((mode) => (
              <label key={mode.id} className="nuvio-playback-mode">
                <input
                  type="radio"
                  name="nuvio-playback-mode"
                  value={mode.id}
                  checked={value.mode === mode.id}
                  onChange={() => onChange({ ...value, mode: mode.id })}
                />
                <span>
                  <strong>{mode.label}</strong>
                  <small>{mode.desc}</small>
                </span>
              </label>
            ))}
          </fieldset>

          {value.mode === 'REGEX_MATCH' && (
            <div className="nuvio-playback-regex">
              <label htmlFor="nuvio-playback-regex">Regex pattern</label>
              <input
                id="nuvio-playback-regex"
                type="text"
                value={value.regex}
                maxLength={MAX_REGEX_LENGTH}
                placeholder="(2160p|4k|remux)"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={error !== null}
                aria-describedby={error ? 'nuvio-playback-regex-error' : undefined}
                onChange={(event) => onChange({ ...value, regex: event.target.value })}
              />
              {error === 'regex-required' && (
                <p id="nuvio-playback-regex-error" className="setup-history-error" role="alert">
                  {setupCopy('Enter a pattern for regex match.', 'Enter a pattern for regex match.')}
                </p>
              )}
              {error === 'regex-too-long' && (
                <p id="nuvio-playback-regex-error" className="setup-history-error" role="alert">
                  {setupCopy('That pattern is too long (300 characters max).', 'That pattern is too long (300 characters max).')}
                </p>
              )}
            </div>
          )}

          <label className="nuvio-playback-next">
            <input
              type="checkbox"
              checked={value.nextEpisode}
              onChange={(event) => onChange({ ...value, nextEpisode: event.target.checked })}
            />
            <span>Auto-play next episode</span>
          </label>

          <p className="setup-hint">
            LeLibrary groups episodes from the same download. In Nuvio TV, enable Prefer Binge Group and auto-play next episode, then choose your English-dub batch. Reuse Binge Groups can also remember it when you return. Nuvio may fall back to another source if a match is unavailable or delayed, depending on its settings. Check the audio and choose manually if needed; settings may differ on other Nuvio clients.
          </p>

          <label className="nuvio-playback-next">
            <input
              type="checkbox"
              checked={value.onlyLeLibrary}
              onChange={(event) => onChange({ ...value, onlyLeLibrary: event.target.checked })}
            />
            <span>
              Only auto-play LeLibrary's streams
              <small>Auto-play never picks a source from your other addons. You can still choose one from the source list.</small>
            </span>
          </label>

          <p className="setup-hint">
            Applies to the Nuvio profile selected above the next time you push. Nuvio picks it up on its next sync.
          </p>
        </>
      )}
    </div>
  );
}
