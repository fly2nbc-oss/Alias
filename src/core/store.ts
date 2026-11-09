/** Alias table (port of store/alias_store.rs) */
import type { AliasEntry, BulkAddItem, Category } from '../types';
import { CATEGORY_LABEL } from './candidate';

export interface StoreExport {
  version: number;
  created_at: string;
  entries: AliasEntry[];
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export class AliasStore {
  entries = new Map<string, AliasEntry>();
  /** lowercase original -> ID */
  private originalsIndex = new Map<string, string>();
  /** Counter per category label for automatic numbering */
  private counters = new Map<string, number>();

  /** Is the alias already taken? Case-insensitive, like the replacement. */
  private aliasUsed(candidate: string): boolean {
    const c = candidate.toLowerCase();
    for (const e of this.entries.values()) if (e.alias.toLowerCase() === c) return true;
    return false;
  }

  /** Next free alias of a category (e.g. "Person-1"); increments the counter. */
  nextAlias(category: Category): string {
    const key = CATEGORY_LABEL[isCategory(category) ? category : 'sonstiges'];
    let n = (this.counters.get(key) ?? 0) + 1;
    while (this.aliasUsed(`${key}-${n}`)) n++;
    this.counters.set(key, n);
    return `${key}-${n}`;
  }

  /** Next alias without taking it (UI preview). */
  previewAlias(category: Category): string {
    const key = CATEGORY_LABEL[isCategory(category) ? category : 'sonstiges'];
    let n = (this.counters.get(key) ?? 0) + 1;
    while (this.aliasUsed(`${key}-${n}`)) n++;
    return `${key}-${n}`;
  }

  add(original: string, aliasInput: string | null | undefined, category: Category): AliasEntry {
    const key = original.toLowerCase();
    const existingId = this.originalsIndex.get(key);
    if (existingId) return { ...this.entries.get(existingId)! };
    if (!isCategory(category)) category = 'sonstiges';
    const alias = aliasInput && aliasInput.trim() ? aliasInput.trim() : this.nextAlias(category);
    const entry: AliasEntry = { id: uuid(), original, alias, category, confirmed: true };
    this.originalsIndex.set(key, entry.id);
    this.entries.set(entry.id, entry);
    return { ...entry };
  }

  addBulk(items: BulkAddItem[]): AliasEntry[] {
    return items.map((i) => this.add(i.original, i.alias, i.category));
  }

  update(id: string, alias?: string, category?: Category, confirmed?: boolean): AliasEntry {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Entry not found: ${id}`);
    if (alias !== undefined) e.alias = alias;
    if (category !== undefined) e.category = category;
    if (confirmed !== undefined) e.confirmed = confirmed;
    return { ...e };
  }

  remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Entry not found: ${id}`);
    this.entries.delete(id);
    this.originalsIndex.delete(e.original.toLowerCase());
  }

  clear(): void {
    this.entries.clear();
    this.originalsIndex.clear();
    this.counters.clear();
  }

  list(): AliasEntry[] {
    return [...this.entries.values()]
      .map((e) => ({ ...e }))
      .sort((a, b) => {
        const x = a.original.toLowerCase();
        const y = b.original.toLowerCase();
        return x < y ? -1 : x > y ? 1 : 0;
      });
  }

  /**
   * Import: existing originals are skipped (no overwrite). Invalid entries (see
   * `sanitizeEntry`) are dropped; an ID that is already taken (in the store or earlier in the
   * import) gets a new one, so no entry is overwritten. An alias that equals the original or is
   * already taken (case-insensitive) gets a new automatic alias; otherwise the original would
   * stay in the text when encoding, or decoding would be ambiguous.
   */
  importEntries(entries: readonly unknown[]): void {
    const aliases = new Set([...this.entries.values()].map((e) => e.alias.toLowerCase()));
    const pending: AliasEntry[] = [];
    for (const raw of entries.slice(0, MAX_STORE_ENTRIES)) {
      const entry = sanitizeEntry(raw);
      if (!entry) continue;
      const key = entry.original.toLowerCase();
      if (this.originalsIndex.has(key)) continue;
      if (this.entries.has(entry.id)) entry.id = uuid();
      const a = entry.alias.toLowerCase();
      if (a === key || aliases.has(a)) {
        // New alias only after the import, so the counters know all imported numbers
        pending.push(entry);
      } else {
        aliases.add(a);
      }
      this.originalsIndex.set(key, entry.id);
      const label = CATEGORY_LABEL[entry.category];
      const suffix = entry.alias.startsWith(`${label}-`) ? entry.alias.slice(label.length + 1) : null;
      if (suffix !== null && /^[0-9]+$/.test(suffix)) {
        const n = parseInt(suffix, 10);
        if (n > (this.counters.get(label) ?? 0)) this.counters.set(label, n);
      }
      this.entries.set(entry.id, entry);
    }
    // Like nextAlias, but with the set instead of a linear search (else quadratic for large imports)
    for (const e of pending) {
      const label = CATEGORY_LABEL[e.category];
      let n = (this.counters.get(label) ?? 0) + 1;
      while (aliases.has(`${label}-${n}`.toLowerCase())) n++;
      this.counters.set(label, n);
      e.alias = `${label}-${n}`;
      aliases.add(e.alias.toLowerCase());
    }
  }

  toExport(): StoreExport {
    return { version: 1, created_at: new Date().toISOString(), entries: this.list() };
  }
}

/** Maximum size of a table file (characters or bytes) */
export const MAX_STORE_FILE_SIZE = 20 * 1024 * 1024;
/** Maximum number of entries per import */
export const MAX_STORE_ENTRIES = 100_000;
/** Maximum length of original and alias (characters) */
export const MAX_FIELD_LENGTH = 10_000;

const isCategory = (c: unknown): c is Category => typeof c === 'string' && Object.hasOwn(CATEGORY_LABEL, c);

/**
 * Check an imported entry strictly. `null` = drop it.
 * - original/alias: strings, not empty (ignoring whitespace), at most `MAX_FIELD_LENGTH` characters
 * - category: only known categories (own keys, no `constructor`/`__proto__`), else `sonstiges`
 * - id: non-empty string up to 200 characters, else a new UUID
 * - confirmed: only `false` removes the confirmation
 */
export function sanitizeEntry(raw: unknown): AliasEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_FIELD_LENGTH;
  if (!text(r.original) || !text(r.alias)) return null;
  return {
    id: typeof r.id === 'string' && r.id.trim() && r.id.length <= 200 ? r.id : uuid(),
    original: r.original,
    alias: r.alias,
    category: isCategory(r.category) ? r.category : 'sonstiges',
    confirmed: r.confirmed !== false,
  };
}

/** Read a file for `parseStoreExport`; rejects files that are too large before loading them. */
export async function readStoreFile(file: Blob): Promise<string> {
  if (file.size > MAX_STORE_FILE_SIZE) throw new Error(tooLarge());
  return file.text();
}

const tooLarge = () => `Alias store file is too large (limit ${MAX_STORE_FILE_SIZE / 1024 / 1024} MB)`;

/**
 * Check the JSON of an export and return the valid entries (invalid ones are dropped).
 * Accepts `{ entries: [...] }` and a bare array. Throws on input that is too large,
 * invalid JSON, a wrong structure or more than `MAX_STORE_ENTRIES` entries.
 */
export function parseStoreExport(json: string): AliasEntry[] {
  if (typeof json !== 'string') throw new Error('Invalid alias store file');
  if (json.length > MAX_STORE_FILE_SIZE) throw new Error(tooLarge());
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new Error(`Invalid alias store file: ${e instanceof Error ? e.message : String(e)}`);
  }
  const entries: unknown = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? (data as { entries?: unknown }).entries
      : undefined;
  if (!Array.isArray(entries)) throw new Error('Invalid alias store file: "entries" missing');
  if (entries.length > MAX_STORE_ENTRIES) {
    throw new Error(`Alias store file has too many entries (${entries.length}, limit ${MAX_STORE_ENTRIES})`);
  }
  const out: AliasEntry[] = [];
  for (const raw of entries) {
    const e = sanitizeEntry(raw);
    if (e) out.push(e);
  }
  return out;
}
