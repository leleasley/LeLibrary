import { i18n } from '@/i18n';

// The setup copy bridge deliberately skips `role="alert"` nodes so it can never
// rewrite server-provided error text. Those few phrases must be translated at
// the source instead, using the reviewed key in the setup bundle.
export function setupCopy(key: string, fallback: string, values: Record<string, unknown> = {}): string {
  const translated = i18n.t(`copy.${key}`, { ns: 'setup', defaultValue: fallback, ...values });
  return typeof translated === 'string' && translated ? translated : fallback;
}

export function setupCount(count: number, one: string, other: string): string {
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const category = new Intl.PluralRules(language).select(count);
  const label = category === 'one' ? one : other;
  const amount = new Intl.NumberFormat(language).format(count);
  return `${amount} ${setupCopy(label, label)}`;
}
