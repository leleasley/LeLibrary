import { TierPicker } from '@/features/setup/shared/TierPicker';

// The /configure index stays the tier picker. Each tier owns its page under
// its own sub-headings at /configure/quick, /partial and /full.
export function SetupWizard() {
  return <TierPicker />;
}
