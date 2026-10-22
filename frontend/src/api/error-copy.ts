import { ApiError } from '@/api/client';
import { i18n } from '@/i18n';

const HTTP_ERROR_KEYS: Record<number, string> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'notFound',
  408: 'requestFailed',
  429: 'rateLimited',
};

/** Translate only stable transport/status codes; preserve server error text verbatim. */
export function apiErrorCopy(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.code) {
    const key = error.code === 'NETWORK_TIMEOUT'
      ? 'timeout'
      : error.code === 'NETWORK_UNAVAILABLE'
        ? 'unavailable'
        : error.code.startsWith('HTTP_')
          ? HTTP_ERROR_KEYS[error.status] ?? (error.status >= 500 ? 'server' : 'requestFailed')
          : undefined;
    if (key) {
      const value = i18n.t(`apiErrors.${key}`, {
        ns: 'common',
        status: error.status,
        defaultValue: '',
      });
      if (value) return value;
    }
  }
  if (error instanceof Error && error.message) return error.message;
  const language = i18n.resolvedLanguage ?? i18n.language;
  const resource = i18n.getResource(language, 'setup', 'copy') as Record<string, string> | undefined;
  return resource?.[fallback] ?? fallback;
}
