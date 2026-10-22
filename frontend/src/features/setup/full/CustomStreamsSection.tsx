import { useEffect, useRef, useState } from 'react';
import { toast } from '@/features/setup/shared/Toast';
import {
  loadCustomStreamsEditor,
  loadTokenMap,
  useLegacyLib,
  type CustomStreamsEditor,
} from '@/features/setup/shared/legacy-libs';
import type { CustomStreamRow } from '@/features/setup/shared/config-contract';

// Custom Streams: the shared browser editor (frontend/public/custom-streams-editor.js)
// drives fixed cs* DOM ids, so this section renders that exact shell and
// bridges the editor's inline-handler globals to the mounted instance.
// Title search and season loading encode a throwaway token from the
// in-memory TMDB key, so nothing is saved just to search.
function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function CustomStreamsSection({ rows, onChange, tmdbKey }: {
  rows: CustomStreamRow[];
  onChange: (next: CustomStreamRow[]) => void;
  tmdbKey: string;
}) {
  const tokenMap = useLegacyLib(loadTokenMap);
  const editorRef = useRef<CustomStreamsEditor | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [editorFailed, setEditorFailed] = useState(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const keyRef = useRef(tmdbKey);
  keyRef.current = tmdbKey;
  const tokenMapRef = useRef(tokenMap);
  tokenMapRef.current = tokenMap;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    loadCustomStreamsEditor()
      .then((lib) => {
        if (cancelled) return;
        const editor = new lib.Editor({
          getRows: () => rowsRef.current,
          setRows: (next) => onChangeRef.current([...(next as CustomStreamRow[])]),
          toast: (message, kind) => toast(message, kind === 'error' ? 'error' : 'ok'),
          changed: () => {},
          escape: esc,
          accountSearch: false,
          getSearchToken: () => {
            const key = (keyRef.current || '').trim();
            const map = tokenMapRef.current;
            return key && map ? map.encodeConfig({ provider: 'none', tmdbApiKey: key, searchScope: 'tmdb' }) : '';
          },
        });
        editorRef.current = editor;
        const w = window as unknown as Record<string, unknown>;
        const prev = {
          edit: w['editCustomStream'],
          remove: w['removeCustomStream'],
          select: w['selectCustomStreamTitle'],
          clear: w['clearCustomStreamSelection'],
        };
        w['editCustomStream'] = (index: number) => editor.edit(index);
        w['removeCustomStream'] = (index: number) => editor.remove(index);
        w['selectCustomStreamTitle'] = (index: number) => editor.selectSearch(index);
        w['clearCustomStreamSelection'] = () => editor.clearSelection();
        editor.render();
        editor.modeChanged();
        return () => {
          w['editCustomStream'] = prev.edit;
          w['removeCustomStream'] = prev.remove;
          w['selectCustomStreamTitle'] = prev.select;
          w['clearCustomStreamSelection'] = prev.clear;
        };
      })
      .catch(() => { if (!cancelled) setEditorFailed(true); });
    return () => { cancelled = true; };
    // Boot the frozen editor once; it is not re-created when props change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCount = rows.filter((row) => {
    const expires = row['expiresAt'];
    return expires == null || Number(expires) > Date.now();
  }).length;

  return (
    <>
      <div className="section-heading"><div><h3>Your stream mappings</h3><p>Search for a title, choose an exact episode when needed, then paste the direct media URL.</p></div></div>
      <div className={`cs-requirement${activeCount > 0 ? ' ready' : ''}`}>
        {activeCount > 0
          ? 'Custom Streams is active. Your TMDB key remains required; debrid providers are optional unless you want My Movies or My Shows.'
          : 'A TMDB key is required. Add a Custom Stream if you want to continue without a debrid provider.'}
      </div>
      {editorFailed && <p className="setup-error">The Custom Streams editor could not be loaded.</p>}
      <div id="customStreamsList"></div>
      <div className="cs-editor">
        <div className="cs-editor-grid">
          <div className="cs-wide cs-target-fields" id="csTargetFields">
            <label className="setup-field">
              <span>Movie or series</span>
              <span className="cs-search-line">
                <input
                  type="search" id="csTitleSearch" placeholder="Search a movie or series…" autoComplete="off"
                  onInput={() => editorRef.current?.searchChanged()}
                />
              </span>
            </label>
            <div id="csSearchResults" className="cs-search-results" hidden></div>
          </div>
          <div className="cs-selected cs-wide" id="csSelected" hidden></div>
          <div className="cs-wide cs-episode-fields" id="csEpisodeFields" hidden>
            <div className="setup-row">
              <label className="setup-field">
                <span>Season</span>
                <select id="csSeason" disabled onChange={() => editorRef.current?.seasonChanged()}>
                  <option value="">Choose a season</option>
                </select>
              </label>
              <label className="setup-field">
                <span>Episode</span>
                <select id="csEpisode" disabled>
                  <option value="">Choose an episode</option>
                </select>
              </label>
            </div>
            <p className="setup-note cs-episode-status" id="csEpisodeStatus">Select a series to load its episodes.</p>
          </div>
          <label className="setup-field cs-wide">
            <span>Direct media URL</span>
            <input type="url" id="csUrl" maxLength={4096} placeholder="https://… direct stream URL" />
          </label>
          <label className="setup-field cs-wide">
            <span>Automatic expiry</span>
            <select id="csExpiry" defaultValue="10800">
              <option value="1800">Expires in 30 minutes</option>
              <option value="3600">Expires in 1 hour</option>
              <option value="10800">Expires in 3 hours</option>
              <option value="21600">Expires in 6 hours</option>
              <option value="43200">Expires in 12 hours</option>
              <option value="86400">Expires in 24 hours</option>
            </select>
          </label>
        </div>
        <div className="cs-editor-actions">
          <button type="button" className="setup-primary" id="csSaveButton" onClick={() => editorRef.current?.save()}>Add stream</button>
          <button type="button" className="setup-secondary" id="csCancelEdit" hidden onClick={() => editorRef.current?.reset()}>Cancel edit</button>
          <button type="button" className="setup-secondary" onClick={() => editorRef.current?.verify()}>Verify URL</button>
          <button type="button" className="setup-secondary" onClick={() => fileRef.current?.click()}>Import file</button>
          <button type="button" className="setup-secondary" onClick={() => editorRef.current?.exportRows()}>Export</button>
          <input
            ref={fileRef} type="file" accept=".json,application/json" hidden
            onChange={(event) => { if (event.target) editorRef.current?.importFile(event.target); }}
          />
        </div>
      </div>
      <div id="csEmpty" hidden>No custom streams active.</div>
    </>
  );
}
