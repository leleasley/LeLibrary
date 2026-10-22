import type { NuvioHideUnreleased } from '@/features/setup/shared/nuvio-library';

// Nuvio's "Hide Unreleased Content" lives in its Home layout settings, but the
// value travels in the Home-catalog settings blob that LeLibrary already
// pushes. Three-way so "leave unchanged" never overrides a user's own choice.
const OPTIONS: { id: NuvioHideUnreleased; label: string; desc: string }[] = [
  {
    id: 'inherit',
    label: 'Leave unchanged',
    desc: "Keep whatever this Nuvio profile already has.",
  },
  {
    id: 'hide',
    label: 'Hide unreleased movies and shows',
    desc: 'Hide titles that have not been released yet on Home, search and recommendations.',
  },
  {
    id: 'show',
    label: 'Show unreleased titles',
    desc: 'Show upcoming titles as well.',
  },
];

export function NuvioUnreleasedSection({ value, onChange }: {
  value: NuvioHideUnreleased;
  onChange: (next: NuvioHideUnreleased) => void;
}) {
  return (
    <div className="nuvio-playback">
      <fieldset className="nuvio-playback-modes">
        <legend>Unreleased content</legend>
        {OPTIONS.map((option) => (
          <label key={option.id} className="nuvio-playback-mode">
            <input
              type="radio"
              name="nuvio-hide-unreleased"
              value={option.id}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
            />
            <span>
              <strong>{option.label}</strong>
              <small>{option.desc}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="setup-hint">
        Applies to the Nuvio profile selected above when you push. Nuvio picks it up on its next sync.
      </p>
    </div>
  );
}
