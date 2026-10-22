import { Outlet, useNavigation } from 'react-router-dom';
import { SiteBanner } from '@/features/site/SiteBanner';
import { ToastHost } from '@/features/setup/shared/Toast';

export function RouteShell() {
  const navigation = useNavigation();
  return (
    <div className="shell">
      {navigation.state === 'loading' && <div className="route-progress" aria-hidden="true" />}
      <a className="skip-link" href="#main-content">Skip to content</a>
      <SiteBanner />
      <main className="shell-main" id="main-content">
        <Outlet />
      </main>
      <ToastHost />
    </div>
  );
}
