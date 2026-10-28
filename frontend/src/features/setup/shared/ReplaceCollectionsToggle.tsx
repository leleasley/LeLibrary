// Opt-in for one push: remove every collection on the Nuvio profile that is
// not this setup's (other addons' collections and ones made by hand). Never
// saved with the setup; background updates always keep other collections.
export function ReplaceCollectionsToggle({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="replace-collections">
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <strong>Remove all other collections from this profile</strong>
        <small>Only for this push. Collections from other addons, and ones made in Nuvio, are deleted from the selected profile so only this setup's collections are left.</small>
      </span>
    </label>
  );
}
