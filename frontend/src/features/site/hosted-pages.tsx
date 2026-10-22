import type { ComponentType } from 'react';
import { Navigate } from 'react-router-dom';

type SitePageModule = Record<string, ComponentType | undefined>;

// The landing, privacy and status pages carry hosted-only copy and are
// deliberately gitignored, so a public checkout (and therefore the GHCR release
// build) does not contain them. `import.meta.glob` only resolves files that
// exist in the build, which lets the same router work in both trees: with the
// private pages present it renders them, and without them it redirects to the
// setup picker, matching the legacy server behaviour when no landing page was
// deployed.
const loaders = import.meta.glob<SitePageModule>([
  './HomePage.tsx',
  './PrivacyPage.tsx',
  './StatusPage.tsx',
]);

function configureRedirect(): ComponentType {
  return function ConfigureRedirect() {
    return <Navigate to="/configure" replace />;
  };
}

export function hostedPageLazy(
  file: string,
  exportName: string,
): () => Promise<{ Component: ComponentType }> {
  const loader = loaders[`./${file}.tsx`];
  if (!loader) return async () => ({ Component: configureRedirect() });
  return async () => {
    const module = await loader();
    return { Component: module[exportName] ?? configureRedirect() };
  };
}
