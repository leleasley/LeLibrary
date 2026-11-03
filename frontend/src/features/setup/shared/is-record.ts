// A plain object (not null, not an array). Shared by the draft loaders and the
// saved-config readers so every guard agrees on what a record is.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
