// Nuvio's Home-catalog settings carry hide_unreleased_content. The setup offers
// a three-way choice so "off" can mean "leave my Nuvio setting alone" rather
// than silently showing everything.
export type NuvioHideUnreleased = 'inherit' | 'hide' | 'show';

export const DEFAULT_NUVIO_HIDE_UNRELEASED: NuvioHideUnreleased = 'inherit';

export function cleanNuvioHideUnreleased(value: unknown): NuvioHideUnreleased {
  if (value === true) return 'hide';
  if (value === false) return 'show';
  return 'inherit';
}

// null means the config field is omitted, so the push preserves the user's
// existing Nuvio choice.
export function nuvioHideUnreleasedForConfig(choice: NuvioHideUnreleased): boolean | null {
  if (choice === 'hide') return true;
  if (choice === 'show') return false;
  return null;
}
