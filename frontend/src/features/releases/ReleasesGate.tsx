import { Outlet } from 'react-router-dom';
import { useFeatures } from '@/features/site/site-hooks';
import { NotFoundPage } from '@/features/site/NotFoundPage';
import '@/features/releases/releases.css';
import { RouteSkeleton } from '@/app/RouteSkeleton';

// Client-side twin of the server gate: the Releases routes render only when the
// server advertises the hosted-only feature. A self-hosted bundle that somehow
// loads /releases client-side still gets the not-found page.
export function ReleasesGate() {
  const features = useFeatures();
  if (features === null) return <RouteSkeleton variant="releases" />;
  if (!features.releases) return <NotFoundPage />;
  return <Outlet />;
}
