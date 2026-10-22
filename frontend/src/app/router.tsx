import { createBrowserRouter, matchRoutes, Navigate, RouterProvider, type RouteObject } from 'react-router-dom';
import { RouteShell } from '@/app/route-shell';
import { NotFoundPage } from '@/features/site/NotFoundPage';
import { RouteErrorPage } from '@/features/site/ErrorPage';
import { hostedPageLazy } from '@/features/site/hosted-pages';
import { ReleasesGate } from '@/features/releases/ReleasesGate';
import { withLocale } from '@/i18n';
import { RouteSkeleton } from '@/app/RouteSkeleton';

const routeHydrateFallback = <RouteSkeleton variant="doc" />;
const setupFallback = <RouteSkeleton variant="setup" />;
const pickerFallback = <RouteSkeleton variant="picker" />;
const releasesFallback = <RouteSkeleton variant="releases" />;

// v5.5 information architecture (served at the root):
// / ......................... landing
// /guide .................... setup, install and troubleshooting guide
// /privacy .................. privacy policy
// /status ................... provider status
// /configure ................ setup picker (Quick / Settle In / Move In)
// /configure/quick|partial|full  tier setup flows
// /{uuid} ................... edit an existing setup (password gate)
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <RouteShell />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        index: true,
        hydrateFallbackElement: routeHydrateFallback,
        lazy: withLocale(['site'], hostedPageLazy('HomePage', 'HomePage')),
      },
      {
        path: 'guide',
        hydrateFallbackElement: routeHydrateFallback,
        lazy: withLocale(['site'], async () => ({ Component: (await import('@/features/site/GuidePage')).GuidePage })),
      },
      {
        path: 'privacy',
        hydrateFallbackElement: routeHydrateFallback,
        lazy: withLocale(['site'], hostedPageLazy('PrivacyPage', 'PrivacyPage')),
      },
      {
        path: 'status',
        hydrateFallbackElement: routeHydrateFallback,
        lazy: withLocale(['site'], hostedPageLazy('StatusPage', 'StatusPage')),
      },
      {
        path: 'supporters',
        hydrateFallbackElement: routeHydrateFallback,
        lazy: withLocale(['site'], async () => ({ Component: (await import('@/features/site/SupportersPage')).SupportersPage })),
      },
      {
        // The page was /about before v5.5; old links land on Supporters.
        path: 'about',
        element: <Navigate to="/supporters" replace />,
      },
      {
        // Hosted-only. The gate renders not-found when /api/features says the
        // feature is off, matching the server's 404 for /releases.
        path: 'releases',
        element: <ReleasesGate />,
        children: [
          {
            index: true,
            hydrateFallbackElement: releasesFallback,
            lazy: withLocale(['site'], async () => ({ Component: (await import('@/features/releases/ReleasesPage')).ReleasesPage })),
          },
          {
            path: ':type/:id',
            hydrateFallbackElement: releasesFallback,
            lazy: withLocale(['site'], async () => ({ Component: (await import('@/features/releases/ReleaseDetailPage')).ReleaseDetailPage })),
          },
        ],
      },
      {
        path: 'configure',
        hydrateFallbackElement: pickerFallback,
        lazy: withLocale(['setup'], async () => ({ Component: (await import('@/features/setup/SetupWizard')).SetupWizard })),
      },
      {
        path: 'configure/quick',
        hydrateFallbackElement: setupFallback,
        lazy: withLocale(['setup'], async () => ({ Component: (await import('@/features/setup/quick/QuickSetupPage')).QuickSetupPage })),
      },
      {
        path: 'configure/partial',
        hydrateFallbackElement: setupFallback,
        lazy: withLocale(['setup'], async () => ({ Component: (await import('@/features/setup/partial/PartialSetupPage')).PartialSetupPage })),
      },
      {
        path: 'configure/full',
        hydrateFallbackElement: setupFallback,
        lazy: withLocale(['setup'], async () => ({ Component: (await import('@/features/setup/full/FullSetupPage')).FullSetupPage })),
      },
      {
        path: ':uuid',
        hydrateFallbackElement: setupFallback,
        lazy: withLocale(['setup'], async () => ({ Component: (await import('@/features/setup/SetupEditPage')).SetupEditPage })),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

// Resolve the lazy page modules for the URL being opened before the router is
// created, so the router starts initialised and its first render is the real
// page, not the loading skeleton. That is what lets the browser hydrate the
// prerendered home page without a flash. Navigations after that stay lazy.
export async function preloadRoutes(pathname: string): Promise<void> {
  const matches = matchRoutes(routes, pathname) ?? [];
  await Promise.all(matches.map(async ({ route }) => {
    if (typeof route.lazy !== 'function') return;
    const loaded = await route.lazy();
    delete route.lazy;
    Object.assign(route, loaded);
  }));
}

let browserRouter: ReturnType<typeof createBrowserRouter> | null = null;

export function AppRouter() {
  browserRouter ??= createBrowserRouter(routes);
  return <RouterProvider router={browserRouter} />;
}
