import { useQuery } from '@tanstack/react-query';
import { fetchReleasesConfig } from '@/api/releases';
import { queryKeys } from '@/api/query-keys';
import { addDaysIso, todayIso } from '@/features/releases/release-format';

// The window the background sync actually caches, so date pickers never offer
// ranges that will come back empty.
export function useReleasesWindow() {
  const configQuery = useQuery({
    queryKey: queryKeys.releasesConfig,
    queryFn: ({ signal }) => fetchReleasesConfig(signal),
    staleTime: 60 * 60 * 1000,
  });
  const windowPastDays = configQuery.data?.windowPastDays ?? 7;
  const windowFutureDays = configQuery.data?.windowFutureDays ?? 14;
  return {
    loaded: configQuery.data !== undefined,
    windowPastDays,
    windowFutureDays,
    minDate: addDaysIso(todayIso(), -windowPastDays),
    maxDate: addDaysIso(todayIso(), windowFutureDays),
  };
}
