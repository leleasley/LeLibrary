import { afterEach, expect, it, vi } from 'vitest';
import { listSetups } from '@/features/setup/resolver/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('sends the self-host access cookie with the setup list request', async () => {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ setups: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await listSetups();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  // Ask for exactly what the picker renders; fetching 50 and showing 10 buried
  // rows and wasted work.
  expect(path).toBe('/api/setup?limit=10');
  // The gate is the HttpOnly access cookie; omitting credentials would always
  // 401 and the picker would silently show the error state.
  expect(init.credentials).toBe('same-origin');
});
