import { useEffect, useState } from 'react';
import { ReleaseCard } from '@/features/releases/ReleaseCard';
import { ReleaseListSkeleton } from '@/features/releases/ReleaseListSkeleton';
import { useTranslation } from 'react-i18next';
import { LocalizedCopy } from '@/i18n/LocalizedCopy';
import { useReleaseSearch } from '@/features/releases/use-release-search';
import type { RegionCode } from '@/features/releases/use-region';

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function SearchTab({ region }: { region: RegionCode }) {
  const { t } = useTranslation('site');
  const [input, setInput] = useState('');
  const trimmed = input.trim();
  const debounced = useDebounced(trimmed, 300);
  const { status, data } = useReleaseSearch(region, debounced);
  const showEmpty = status === 'success' && data !== null && data.results.length === 0;

  return (
    <LocalizedCopy><div className="rel-panel">
      <label className="rel-search-field">
        <span className="rel-visually-hidden">{t('releases.search')}</span>
        <input
          type="search"
          placeholder={t('releases.searchPlaceholder')}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          autoComplete="off"
          autoFocus
        />
      </label>

      {trimmed.length < 2 && <p className="rel-state">{t('releases.twoChars')}</p>}
      {status === 'loading' && (data
        ? <p className="rel-state">{t('releases.searching')}</p>
        : <ReleaseListSkeleton count={4} label={t('releases.searchLoading')} />)}
      {status === 'error' && (
        <p className="rel-state rel-state-error">{t('releases.searchUnavailable')}</p>
      )}
      {showEmpty && <p className="rel-state">{t('releases.noMatch', { query: data?.query })}</p>}

      {data && data.results.length > 0 && (
        <ul className="rel-list">
          {data.results.map((item) => <ReleaseCard key={`${item.type}:${item.id}`} item={item} from="search" />)}
        </ul>
      )}
    </div></LocalizedCopy>
  );
}
