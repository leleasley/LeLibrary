import { cloneElement, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '@/i18n';

const TEXT_ATTRIBUTES = ['aria-label', 'aria-description', 'title', 'placeholder', 'alt'] as const;

/**
 * Translates exact, reviewed UI copy from the locale's staticText dictionary.
 * Dynamic values (API data, titles, ids, user input) pass through unchanged
 * unless they exactly match a known UI phrase.
 */
export function LocalizedCopy({ children }: { children: ReactNode }) {
  const { i18n: activeI18n } = useTranslation('site');
  const locale = activeI18n.resolvedLanguage ?? activeI18n.language;
  // i18next throws when asked for a resource before a language exists (the
  // prerender can render before init resolves). No language means no phrases,
  // the same guard copyMapFor uses for setup copy.
  const copy = (locale ? i18n.getResource(locale, 'site', 'staticText') ?? {} : {}) as Record<string, string>;

  const translateText = (source: string) => {
    const trimmed = source.trim();
    const translated = copy[trimmed];
    if (!translated) return source;
    const leading = source.match(/^\s*/)?.[0] ?? '';
    const trailing = source.match(/\s*$/)?.[0] ?? '';
    return `${leading}${translated}${trailing}`;
  };

  function localize(node: ReactNode): ReactNode {
    if (typeof node === 'string') return translateText(node);
    if (Array.isArray(node)) return node.map((child, index) => <Fragment key={index}>{localize(child)}</Fragment>);
    if (!isValidElement(node)) return node;

    const props = node.props as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const attribute of TEXT_ATTRIBUTES) {
      const value = props[attribute];
      if (typeof value === 'string' && copy[value]) next[attribute] = copy[value];
    }
    if ('children' in props) next['children'] = localize(props['children'] as ReactNode);
    return cloneElement(node as ReactElement<any>, next as any);
  }

  return <>{localize(children)}</>;
}
