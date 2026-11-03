import { useState } from 'react';

// One-page-at-a-time state shared by the stepped flows. Changing step resets
// the viewport to the top so each page starts at its heading.
export function useWizardStep(total: number) {
  const [step, setStep] = useState(0);

  function go(next: number) {
    setStep(Math.max(0, Math.min(total - 1, next)));
    window.scrollTo(0, 0);
  }

  return { step, go, back: () => go(step - 1), next: () => go(step + 1) };
}
