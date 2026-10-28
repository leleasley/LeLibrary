import { useEffect, useMemo, useState } from 'react';
import { setupCopy } from '@/features/setup/shared/setup-copy';
import { saveNuvioSettings, type NuvioProfileDetail, type SettingId, type SettingValues } from '@/features/setup/nuvio/api';
import {
  LANGUAGES, SETTING_GROUPS, SKIP_SEGMENTS, changedSettings, fieldVisible, presentSettings,
  type SettingField,
} from '@/features/setup/nuvio/settings-model';
import { Switch, type NuvioCtx } from '@/features/setup/nuvio/nuvio-ui';

// The profile's own playback settings as Nuvio holds them. Only settings
// Nuvio already has are shown; saving sends only what changed, and the
// server writes TV and mobile in their own key names and types.

/** What the form starts from: the settings blob, plus Home's own unreleased flag. */
export function initialSettingValues(detail: NuvioProfileDetail): SettingValues {
  const values: SettingValues = { ...detail.settings.values };
  if (values.hideUnreleased === undefined && typeof detail.home.hideUnreleased === 'boolean') {
    values.hideUnreleased = detail.home.hideUnreleased;
  }
  return values;
}

function optionValue(raw: string, sample: unknown): unknown {
  return typeof sample === 'number' ? Number(raw) : raw;
}

function SettingInput({ field, value, onChange, disabled }: {
  field: SettingField;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled: boolean;
}) {
  const control = field.control;
  if (control.kind === 'switch') {
    return <Switch checked={value === true} disabled={disabled} label={field.label} hint={field.hint} onChange={onChange} />;
  }
  if (control.kind === 'segments') {
    const list = Array.isArray(value) ? value.map(String) : [];
    return (
      <fieldset className="nv-field nv-segments" disabled={disabled}>
        <legend>{field.label}</legend>
        {field.hint && <small>{field.hint}</small>}
        <div className="nv-parts">
          {SKIP_SEGMENTS.map((segment) => (
            <label key={segment.value} className="nv-check">
              <input
                type="checkbox" checked={list.includes(segment.value)}
                onChange={(event) => onChange(event.target.checked
                  ? SKIP_SEGMENTS.map((s) => s.value).filter((s) => s === segment.value || list.includes(s))
                  : list.filter((s) => s !== segment.value))}
              />
              <span>{segment.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (control.kind === 'text') {
    return (
      <label className="setup-field nv-field">
        <span>{field.label}</span>
        <input
          type="text" value={typeof value === 'string' ? value : ''} disabled={disabled}
          placeholder={control.placeholder} maxLength={control.maxLength}
          autoComplete="off" spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
        {field.hint && <small className="nv-hint">{field.hint}</small>}
      </label>
    );
  }
  if (control.kind === 'language') {
    const current = typeof value === 'string' ? value : '';
    const known = current === '' || LANGUAGES.some((lang) => lang.code === current);
    return (
      <label className="setup-field nv-field">
        <span>{field.label}</span>
        <select value={current} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
          <option value="">{setupCopy('None / device default', 'None / device default')}</option>
          {!known && <option value={current} data-i18n-preserve>{current}</option>}
          {LANGUAGES.map((lang) => <option key={lang.code} value={lang.code} data-i18n-preserve>{lang.name}</option>)}
        </select>
      </label>
    );
  }
  const options = control.options;
  const known = options.some((option) => option.value === value);
  return (
    <label className="setup-field nv-field">
      <span>{field.label}</span>
      <select
        value={String(value ?? '')} disabled={disabled}
        onChange={(event) => onChange(optionValue(event.target.value, options[0]?.value))}
      >
        {!known && <option value={String(value ?? '')} data-i18n-preserve>{String(value ?? '')}</option>}
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>{setupCopy(option.label, option.label)}</option>
        ))}
      </select>
      {field.hint && <small className="nv-hint">{field.hint}</small>}
    </label>
  );
}

export function SettingsTab({ ctx, detail }: { ctx: NuvioCtx; detail: NuvioProfileDetail }) {
  const original = useMemo(() => initialSettingValues(detail), [detail]);
  const [draft, setDraft] = useState<SettingValues>(original);
  useEffect(() => { setDraft(original); }, [original]);
  const present = presentSettings(original);
  const changes = changedSettings(original, draft);
  const changeCount = Object.keys(changes).length;
  const { run, busy, uuid, editToken } = ctx;
  const missing = SETTING_GROUPS.flatMap((group) => group.fields).filter((field) => !present.has(field.id));
  const noBlobs = !detail.settings.platforms.tv && !detail.settings.platforms.mobile;

  function set(id: SettingId, value: unknown) {
    setDraft((prev) => ({ ...prev, [id]: value }));
  }

  return (
    <div className="nv-tab">
      <div className="nv-tab-head">
        <div>
          <h2>Playback settings</h2>
          <p>What this profile's Nuvio apps use. Saving changes the TV and phone apps together.</p>
        </div>
      </div>
      {noBlobs && (
        <p className="lib-note">Nuvio has no settings saved for this profile yet: open Nuvio's settings once on a device, then reload this page.</p>
      )}
      {SETTING_GROUPS.map((group) => {
        const fields = group.fields.filter((field) => present.has(field.id) && fieldVisible(field, draft));
        if (fields.length === 0) return null;
        return (
          <section key={group.id} className="nv-group">
            <h3>{group.title}</h3>
            <div className="nv-group-body">
              {fields.map((field) => (
                <SettingInput key={field.id} field={field} value={draft[field.id]} disabled={busy} onChange={(next) => set(field.id, next)} />
              ))}
            </div>
          </section>
        );
      })}
      {!noBlobs && missing.length > 0 && (
        <div className="nv-missing">
          <strong>Not set on this profile yet: open Nuvio's settings once on a device</strong>
          <ul>
            {missing.map((field) => <li key={field.id}>{field.label}</li>)}
          </ul>
        </div>
      )}
      {present.size > 0 && (
        <div className="nv-savebar">
          <span>{changeCount === 0 ? setupCopy('No changes yet', 'No changes yet') : setupCopy('{{count}} changed', '{{count}} changed', { count: changeCount })}</span>
          <span className="nv-orderbar-actions">
            <button type="button" className="setup-secondary" disabled={busy || changeCount === 0} onClick={() => setDraft(original)}>Discard</button>
            <button
              type="button" className="setup-primary" disabled={busy || changeCount === 0}
              onClick={() => void run(() => saveNuvioSettings(uuid, editToken, detail.profile.index, changes), { undo: detail.profile.index })}
            >
              {busy ? 'Saving…' : 'Save to Nuvio'}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
