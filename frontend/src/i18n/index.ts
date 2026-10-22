import i18n, { type BackendModule } from 'i18next';
import { initReactI18next } from 'react-i18next';

type Locale = 'en' | 'es';
type Namespace = 'common' | 'site' | 'setup';
type LocaleBundle = { default: Record<string, unknown> };
type BundleLoader = () => Promise<LocaleBundle>;

const bundles: Record<Locale, Record<Namespace, BundleLoader>> = {
  en: {
    common: () => import('./locales/en/common.json'),
    site: () => import('./locales/en/site.json'),
    setup: () => import('./locales/en/setup.json'),
  },
  es: {
    common: () => import('./locales/es/common.json'),
    site: () => import('./locales/es/site.json'),
    setup: () => import('./locales/es/setup.json'),
  },
};

function preferredLanguage(): Locale {
  const browserLanguages = typeof navigator !== 'undefined'
    ? (navigator.languages?.length ? navigator.languages : [navigator.language])
    : [];
  for (const language of browserLanguages) {
    const base = language?.toLowerCase().split(/[-_]/)[0];
    if (base === 'es') return 'es';
    if (base === 'en') return 'en';
  }
  return 'en';
}

const localeBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(language, namespace, callback) {
    const locale = language.toLowerCase().split(/[-_]/)[0] as Locale;
    const loader = bundles[locale]?.[namespace as Namespace];
    if (!loader) {
      callback(new Error(`Unsupported locale resource: ${language}/${namespace}`), null);
      return;
    }
    void loader().then(
      (module) => callback(null, module.default),
      (error: unknown) => callback(error instanceof Error ? error : String(error), null),
    );
  },
};

// Resolves once the language is picked and the `common` bundle is in. The app
// renders after this, so the nav never flashes raw keys.
export const i18nReady: Promise<unknown> = i18n.use(localeBackend).use(initReactI18next).init({
  lng: preferredLanguage(),
  fallbackLng: 'en',
  supportedLngs: ['en', 'es'],
  load: 'languageOnly',
  defaultNS: 'common',
  ns: ['common'],
  partialBundledLanguages: true,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  returnNull: false,
}).then(() => {
  if (typeof document !== 'undefined') document.documentElement.lang = i18n.resolvedLanguage ?? i18n.language;
}).catch(() => undefined);

// Route `lazy` wrapper: the page chunk and its locale bundles load together, so
// a page is never drawn before its copy exists (no `guide.title` flash, no
// English-then-Spanish swap on the setup bridge).
export function withLocale<T>(namespaces: Namespace[], lazy: () => Promise<T>): () => Promise<T> {
  return async () => {
    const [route] = await Promise.all([
      lazy(),
      i18nReady.then(() => i18n.loadNamespaces(namespaces)).catch(() => undefined),
    ]);
    return route;
  };
}

i18n.on('languageChanged', (language) => {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
});

export { i18n };
