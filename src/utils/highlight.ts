import { findMatches, pairs, type Pair } from '../core/substitute';
import type { AliasEntry, Category } from '../types';

/** Highlighted span: start, end, category */
export type HighlightSpan = [number, number, Category];

/** Replacement pairs + category per replacement text, cached per table and direction */
interface Prepared {
  ps: Pair[];
  categoryOf: Map<string, Category>;
}
const prepared = new WeakMap<readonly AliasEntry[], Partial<Record<'encode' | 'decode', Prepared>>>();

function prepare(entries: readonly AliasEntry[], mode: 'encode' | 'decode'): Prepared {
  let byMode = prepared.get(entries);
  if (!byMode) prepared.set(entries, (byMode = {}));
  let p = byMode[mode];
  if (!p) {
    // Same array for findMatches, so its compiled search is reused
    const ps = pairs(entries, mode);
    const categoryOf = new Map<string, Category>();
    for (const e of entries) {
      if (!e.confirmed) continue;
      // Replacement text: the alias when encoding, the original when decoding
      const rep = mode === 'encode' ? e.alias : e.original;
      if (!categoryOf.has(rep)) categoryOf.set(rep, e.category);
    }
    p = byMode[mode] = { ps, categoryOf };
  }
  return p;
}

/**
 * Places that the replacement would actually hit: the same search as Encode/Decode
 * (`findMatches`), so the highlight shows exactly what gets replaced.
 * `mode`: 'encode' searches originals, 'decode' searches aliases.
 */
export function highlightSpans(
  text: string,
  entries: readonly AliasEntry[],
  mode: 'encode' | 'decode',
): HighlightSpan[] {
  if (!text || entries.length === 0) return [];
  const { ps, categoryOf } = prepare(entries, mode);
  if (ps.length === 0) return [];
  return findMatches(text, ps).map(([s, e, rep]) => [s, e, categoryOf.get(rep) ?? 'sonstiges']);
}

/** Last result of `highlightSpans` (the text panel and the status bar ask for the same text) */
let last: { text: string; entries: readonly AliasEntry[]; mode: 'encode' | 'decode'; spans: HighlightSpan[] } | null = null;

/** Like `highlightSpans`, but remembers the last call. */
export function spansCached(text: string, entries: readonly AliasEntry[], mode: 'encode' | 'decode'): HighlightSpan[] {
  if (last && last.text === text && last.entries === entries && last.mode === mode) return last.spans;
  const spans = highlightSpans(text, entries, mode);
  last = { text, entries, mode, spans };
  return spans;
}

/** Distinct table entries (names) and matches (places) in the text. */
export function matchStats(text: string, entries: readonly AliasEntry[], mode: 'encode' | 'decode'): { names: number; places: number } {
  const spans = spansCached(text, entries, mode);
  const names = new Set(spans.map(([s, e]) => text.slice(s, e).toLowerCase()));
  return { names: names.size, places: spans.length };
}

/** HTML for the highlight layer (text stays unchanged, only <mark> around matches). */
export function highlightHtml(text: string, spans: readonly HighlightSpan[]): string {
  let html = '';
  let pos = 0;
  for (const [s, e, cat] of spans) {
    if (s > pos) html += escapeHtml(text.slice(pos, s));
    html += `<mark class="cat-${cat}">${escapeHtml(text.slice(s, e))}</mark>`;
    pos = e;
  }
  if (pos < text.length) html += escapeHtml(text.slice(pos));
  return html;
}

/**
 * Fill the highlight layer behind the editor. A trailing character makes sure that
 * a last empty line is as high as in the <textarea> (same scroll height).
 */
export function applyHighlights(
  element: HTMLElement,
  text: string,
  entries: readonly AliasEntry[],
  mode: 'encode' | 'decode',
): number {
  const spans = spansCached(text, entries, mode);
  element.innerHTML = highlightHtml(text, spans) + '\n​';
  return spans.length;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
