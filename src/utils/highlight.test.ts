import { describe, expect, it } from 'vitest';
import { substitute } from '../core/substitute';
import type { AliasEntry } from '../types';
import { highlightHtml, highlightSpans } from './highlight';

const entries: AliasEntry[] = [
  { id: '1', original: 'Max', alias: 'Person-1', category: 'person', confirmed: true },
  { id: '2', original: 'Siemens AG', alias: 'Firma-1', category: 'firma', confirmed: true },
  { id: '3', original: 'Berlin', alias: 'Ort-1', category: 'ort', confirmed: false },
];

describe('highlightSpans', () => {
  it('marks exactly what encode replaces (word boundaries, confirmed only)', () => {
    const text = 'Max und Maximilian bei SIEMENS AG in Berlin.\n\nmax';
    const spans = highlightSpans(text, entries, 'encode');
    expect(spans.map(([s, e, c]) => [text.slice(s, e), c])).toEqual([
      ['Max', 'person'],
      ['SIEMENS AG', 'firma'],
      ['max', 'person'],
    ]);
    expect(substitute(text, entries, 'encode').replacements_made).toBe(spans.length);
  });

  it('marks aliases in decode direction with the category', () => {
    const text = 'Person-1 trifft Person-10 von Firma-1';
    const spans = highlightSpans(text, entries, 'decode');
    expect(spans.map(([s, e, c]) => [text.slice(s, e), c])).toEqual([
      ['Person-1', 'person'],
      ['Firma-1', 'firma'],
    ]);
  });

  it('keeps text and line breaks unchanged in the HTML layer', () => {
    const text = 'a <b>\n\nMax & Co';
    const html = highlightHtml(text, highlightSpans(text, entries, 'encode'));
    expect(html).toBe('a &lt;b&gt;\n\n<mark class="cat-person">Max</mark> &amp; Co');
  });
});
