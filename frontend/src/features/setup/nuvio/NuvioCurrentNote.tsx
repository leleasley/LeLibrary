import { setupCopy } from '@/features/setup/shared/setup-copy';
import type { NuvioSettingValues } from '@/features/setup/nuvio/prefill';

// "What the Nuvio profile has right now", under the setup's Nuvio sections on
// the edit page, so a setup that leaves a setting alone still shows its value.

const MODE_LABEL: Record<string, [string, string]> = {
  MANUAL: ['Manual (choose stream)', 'Manual (choose stream)'],
  FIRST_STREAM: ['Auto-play first source', 'Auto-play first source'],
  REGEX_MATCH: ['Auto-play regex match', 'Auto-play regex match'],
};

export function playbackSummary(values: NuvioSettingValues | null | undefined): string | null {
  if (!values) return null;
  const parts: string[] = [];
  const mode = typeof values['autoPlayMode'] === 'string' ? MODE_LABEL[String(values['autoPlayMode'])] : undefined;
  if (mode) parts.push(setupCopy(mode[0], mode[1]));
  if (typeof values['nextEpisode'] === 'boolean') {
    parts.push(values['nextEpisode']
      ? setupCopy('Next episode plays automatically', 'Next episode plays automatically')
      : setupCopy('Next episode does not play automatically', 'Next episode does not play automatically'));
  }
  return parts.length ? parts.join(' · ') : null;
}

export function unreleasedSummary(values: NuvioSettingValues | null | undefined): string | null {
  const flag = values?.['hideUnreleased'];
  if (flag === true) return setupCopy('Unreleased titles are hidden', 'Unreleased titles are hidden');
  if (flag === false) return setupCopy('Unreleased titles are shown', 'Unreleased titles are shown');
  return null;
}

export function NuvioCurrentNote({ summary }: { summary: string | null }) {
  if (!summary) return null;
  return (
    <p className="nuvio-current-note">
      <span>{setupCopy('On your Nuvio profile now:', 'On your Nuvio profile now:')}</span> <strong>{summary}</strong>
    </p>
  );
}
