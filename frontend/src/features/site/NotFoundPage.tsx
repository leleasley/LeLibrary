import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/features/site/ErrorPage';

// Same visual treatment as the server-rendered 404, used by the client router.
export function NotFoundPage() {
  const { t } = useTranslation('common');
  return (
    <ErrorState
      code={404}
      title={t('errors.notFound')}
      desc={t('errors.notFoundDesc')}
    />
  );
}
