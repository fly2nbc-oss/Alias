import type { AliasEntry } from '../types';

/**
 * Sets a contenteditable element's text with colored <mark> spans
 * for all matching alias entries.
 */
export function applyHighlights(
  element: HTMLElement,
  text: string,
  entries: AliasEntry[],
  mode: 'encode' | 'decode'
): void {
  // Search terms: originals in encode mode, aliases in decode mode
  const terms = entries
    .filter(e => e.confirmed)
    .map(e => ({ term: mode === 'encode' ? e.original : e.alias, category: e.category }))
    .filter(t => t.term.length > 0);

  if (terms.length === 0) {
    element.textContent = text;
    return;
  }

  // Longest matches first
  terms.sort((a, b) => b.term.length - a.term.length);

  // Collect all matches and positions
  interface Match { start: number; end: number; category: string }
  const matches: Match[] = [];

  for (const { term, category } of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // Skip overlaps
      const overlaps = matches.some(
        existing => m!.index < existing.end && m!.index + m![0].length > existing.start
      );
      if (!overlaps) {
        matches.push({ start: m.index, end: m.index + m[0].length, category });
      }
    }
  }

  matches.sort((a, b) => a.start - b.start);

  // HTML aufbauen
  let html = '';
  let pos = 0;
  for (const match of matches) {
    if (match.start > pos) {
      html += escapeHtml(text.slice(pos, match.start));
    }
    html += `<mark class="cat-${match.category}">${escapeHtml(text.slice(match.start, match.end))}</mark>`;
    pos = match.end;
  }
  if (pos < text.length) {
    html += escapeHtml(text.slice(pos));
  }

  element.innerHTML = html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}
