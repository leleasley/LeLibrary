// Pure rules for the setup form, kept out of components so they are testable.
export const MIN_PASSWORD_LENGTH = 8;

export interface PasswordCheck {
  ok: boolean;
  error?: string;
}

export function checkPassword(password: string, confirmation: string): PasswordCheck {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Use at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  if (confirmation !== undefined && password !== confirmation) {
    return { ok: false, error: 'Both passwords must match' };
  }
  return { ok: true };
}

export function tierRequired(tier: string | null): boolean {
  return tier === 'quick' || tier === 'partial' || tier === 'full';
}

// The install URL is the capability, so it is built from the token the server
// returned rather than assembled in the browser.
export function installUrl(origin: string, installToken: string): string {
  return `${origin.replace(/\/+$/, '')}/${installToken}/manifest.json`;
}
