import { i18n } from '@/i18n';

const TEXT_ATTRIBUTES = ['aria-label', 'aria-description', 'title', 'placeholder', 'alt'] as const;
type PhraseTemplate = { names: string[]; expression: RegExp; translation: string };
const compiledTemplates = new WeakMap<Record<string, string>, PhraseTemplate[]>();

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function translatePhrase(source: string, phrases: Record<string, string>): string | undefined {
  const normalized = normalize(source);
  if (phrases[normalized]) return phrases[normalized];

  let templates = compiledTemplates.get(phrases);
  if (!templates) {
    templates = [];
    for (const [pattern, translation] of Object.entries(phrases)) {
      const names: string[] = [];
      const expression = pattern.split(/(\{\{[a-zA-Z][a-zA-Z0-9]*\}\})/g).map((part) => {
        if (/^\{\{[a-zA-Z][a-zA-Z0-9]*\}\}$/.test(part)) {
          names.push(part.slice(2, -2));
          return '(.+?)';
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('');
      if (names.length) templates.push({ names, expression: new RegExp(`^${expression}$`), translation });
    }
    compiledTemplates.set(phrases, templates);
  }
  for (const { names, expression, translation } of templates) {
    const match = expression.exec(normalized);
    if (!match) continue;
    return translation.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (_placeholder, name: string) => {
      const position = names.indexOf(name);
      return match[position + 1] ?? '';
    });
  }
  return undefined;
}

/**
 * Setup is a large, literal-heavy wizard with many small leaf components.
 * Localize its reviewed static phrases at the rendered text-node boundary so
 * copy stays in the locale JSON without ever rewriting input values or URLs.
 * Reviewed exact phrases and named templates leave unmatched server text and user-entered values untouched.
 */
// Pure so the guard is testable: no language means no phrases, never a throw.
export function copyMapFor(language: string | undefined): Record<string, string> {
  if (!language) return {};
  try {
    return (i18n.getResource(language, 'setup', 'copy') ?? {}) as Record<string, string>;
  } catch {
    return {};
  }
}

export function installSetupDomCopy(root: HTMLElement): () => void {
  const textSources = new WeakMap<Text, string>();
  const attrSources = new WeakMap<Element, Map<string, string>>();
  let setupLoading = false;

  const isSetupPath = () => /^\/configure(?:\/|$)|^\/[0-9a-f-]{20,}(?:\/|$)/i.test(window.location.pathname);
  const phraseMap = (): Record<string, string> => copyMapFor(i18n.resolvedLanguage ?? i18n.language);

  function translateText(node: Text, phrases: Record<string, string>) {
    const current = node.nodeValue ?? '';
    const remembered = textSources.get(node);
    const currentKey = normalize(current);
    const isPreviousTranslation = remembered && normalize(translatePhrase(remembered, phrases) ?? '') === currentKey;
    const source = isPreviousTranslation ? remembered : current;
    if (!isPreviousTranslation) textSources.set(node, source);

    const key = normalize(source);
    const translated = translatePhrase(key, phrases);
    if (!translated) {
      if (current !== source) node.nodeValue = source;
      return;
    }
    const leading = source.match(/^\s*/)?.[0] ?? '';
    const trailing = source.match(/\s*$/)?.[0] ?? '';
    const next = `${leading}${translated}${trailing}`;
    if (current !== next) node.nodeValue = next;
  }

  function translateElement(element: Element, phrases: Record<string, string>) {
    if (element.closest('[data-i18n-preserve],[role=alert]')) return;
    // Translate UI attributes such as placeholders, but never input values.
    // Mark user/API rendered containers with data-i18n-preserve in JSX so names
    // and upstream text cannot collide with a matching interface phrase.
    const remembered = attrSources.get(element) ?? new Map<string, string>();
    for (const attribute of TEXT_ATTRIBUTES) {
      const current = element.getAttribute(attribute);
      if (current === null) continue;
      const prior = remembered.get(attribute);
      const source = prior && normalize(translatePhrase(prior, phrases) ?? '') === normalize(current) ? prior : current;
      remembered.set(attribute, source);
      const translated = translatePhrase(source, phrases);
      if (translated && translated !== current) element.setAttribute(attribute, translated);
      else if (!translated && source !== current) element.setAttribute(attribute, source);
    }
    if (remembered.size) attrSources.set(element, remembered);
  }

  function visit(node: Node, phrases: Record<string, string>) {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (parent && !parent.closest('[data-i18n-preserve],[role=alert],script,style,textarea,input,select,option')) {
        translateText(node as Text, phrases);
      }
      return;
    }
    if (node instanceof Element) translateElement(node, phrases);
    node.childNodes.forEach((child) => visit(child, phrases));
  }

  function update() {
    if (!isSetupPath()) return;
    // main.tsx installs this observer before i18n has resolved a language.
    // hasResourceBundle/getResource with an undefined language throw inside
    // i18next ("can't access property includes"), so wait for init.
    const language = i18n.resolvedLanguage ?? i18n.language;
    if (!language) return;
    if (!i18n.hasResourceBundle(language, 'setup')) {
      if (!setupLoading) {
        setupLoading = true;
        void i18n.loadNamespaces('setup').catch(() => undefined).finally(() => {
          setupLoading = false;
          update();
        });
      }
      return;
    }
    visit(root, phraseMap());
    document.title = phraseMap()[normalize(document.title)] ?? document.title;
    document.documentElement.lang = language;
  }

  const observer = new MutationObserver((records) => {
    if (!isSetupPath()) return;
    const phrases = phraseMap();
    for (const record of records) {
      if (record.type === 'characterData' && record.target instanceof Text) {
        const parent = record.target.parentElement;
        if (parent && !parent.closest('[data-i18n-preserve],[role=alert],script,style,textarea,input,select,option')) translateText(record.target, phrases);
      } else if (record.type === 'attributes' && record.target instanceof Element) {
        translateElement(record.target, phrases);
      } else {
        record.addedNodes.forEach((node) => visit(node, phrases));
      }
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...TEXT_ATTRIBUTES] });
  update();
  i18n.on('languageChanged', update);
  window.addEventListener('popstate', update);
  return () => {
    observer.disconnect();
    i18n.off('languageChanged', update);
    window.removeEventListener('popstate', update);
  };
}
