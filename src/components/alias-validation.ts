/**
 * Checks an alias in the UI (table, Detect and Manual dialog).
 * Case does not matter; the replacement ignores it as well.
 */

export interface AliasLike {
  id?: string;
  original: string;
  alias: string;
}

export type AliasCheck =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'duplicate' | 'original'; message: string };

/**
 * @param alias      the new alias (already trimmed)
 * @param original   original the alias belongs to
 * @param entries    current list (table plus further planned entries, if any)
 * @param selfId     ID of the edited entry (skipped in the duplicate check)
 */
export function checkAlias(alias: string, original: string, entries: readonly AliasLike[], selfId?: string): AliasCheck {
  const a = alias.trim();
  if (!a) return { ok: false, reason: 'empty', message: 'The placeholder must not be empty.' };
  const low = a.toLowerCase();
  if (low === original.trim().toLowerCase()) {
    return {
      ok: false,
      reason: 'original',
      message: `Placeholder "${a}" is the same as the name, so the name would not be hidden.`,
    };
  }
  for (const e of entries) {
    if (selfId !== undefined && e.id === selfId) continue;
    if (e.alias.toLowerCase() === low && e.original.toLowerCase() !== original.toLowerCase()) {
      return {
        ok: false,
        reason: 'duplicate',
        message: `Placeholder "${a}" is already used for "${e.original}". Each placeholder must be different.`,
      };
    }
  }
  for (const e of entries) {
    if (selfId !== undefined && e.id === selfId) continue;
    if (e.original.toLowerCase() === low) {
      return {
        ok: false,
        reason: 'original',
        message: `Placeholder "${a}" is itself a name in the list. Choose a different placeholder.`,
      };
    }
  }
  return { ok: true };
}

/** Natural sort: "Person-2" before "Person-10". */
export const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;
