import type { MdblistListsState } from '@/features/setup/shared/user-lists';

// One line above the "Your MDBList lists" shelf: loading, failed or empty,
// plus a refresh button (it also skips the server's ten-minute copy).
export function MdblistListsStatus({ state, count, onReload }: { state: MdblistListsState; count: number; onReload: () => void }) {
  let text = '';
  if (state === 'loading') text = 'Loading your MDBList lists…';
  else if (state === 'error') text = 'Could not load your MDBList lists.';
  else if (state === 'ready' && count === 0) text = 'No own or liked lists on MDBList yet.';
  else if (state === 'ready') text = 'Your own and liked lists from MDBList.';
  return (
    <div className={`mdblist-lists-status${state === 'error' ? ' is-error' : ''}`} role="status">
      <small>{text}</small>
      <button type="button" className="setup-secondary mdblist-lists-refresh" disabled={state === 'loading'} onClick={onReload}>
        Refresh lists
      </button>
    </div>
  );
}
