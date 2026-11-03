// Structural equality for plain setup drafts (JSON data only: no functions,
// dates or undefined-vs-missing distinctions that matter). Key order counts,
// which is fine because every draft is built by the same code each time.
// The one comparison every dirty check and edit save diff uses.
export function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
