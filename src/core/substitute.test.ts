/** Substitution: case, word boundaries, overlap; text codec */
import { describe, expect, it } from 'vitest';
import type { AliasEntry } from '../types';
import { applyMatches, changedPlaceholders, findMatches, pairs, substitute, type Pair } from './substitute';
import { decodeText, encodeText } from './text-codec';

const E = (original: string, alias: string, id = original): AliasEntry => ({ id, original, alias, category: 'person', confirmed: true });
const enc = (text: string, ...e: AliasEntry[]) => substitute(text, e, 'encode').text;
const dec = (text: string, ...e: AliasEntry[]) => substitute(text, e, 'decode').text;

describe('findMatches', () => {
  it('selbstüberlappende Originale: nach verworfenem Treffer an der nächsten Position weiter', () => {
    // "b-b" at 2 overlaps "a-b" → continue at 3, not only at 5 (else "b-b" would be left)
    expect(enc('a-b-b-b', E('a-b', 'P'), E('b-b', 'Q'))).toBe('P-Q');
    expect(findMatches('a-b-b-b', [['a-b', 'P'], ['b-b', 'Q']]).map(([s, e]) => [s, e])).toEqual([[0, 3], [4, 7]]);
    // no word boundary conflict (terms end in punctuation): "Xa."/"a.a." in "Xa.a.a."
    expect(enc('Xa.a.a.', E('Xa.', 'P'), E('a.a.', 'Q'))).toBe('PQ');
  });

  it('Groß-/Kleinschreibung wird ignoriert', () => {
    expect(enc('Herr Müller, HERR MÜLLER, herr müller', E('Müller', 'Person-1'))).toBe('Herr Person-1, HERR Person-1, herr Person-1');
    expect(enc('ÉCOLE école', E('école', 'X'))).toBe('X X');
  });

  it('exakte Schreibung gewinnt bei Einträgen, die sich nur darin unterscheiden', () => {
    const e = [E('Müller', 'A'), E('MÜLLER', 'B')];
    // third spelling: first entry in `pairs` order (same length → code point order, "MÜLLER" first)
    expect(substitute('Müller MÜLLER müller', e, 'encode').text).toBe('A B B');
  });

  it('Wortgrenzen: kein Treffer in längeren Wörtern', () => {
    expect(enc('Max, Maximilian und maximal MAX.', E('Max', 'P'))).toBe('P, Maximilian und maximal P.');
    expect(enc('AnnaMax', E('Max', 'P'))).toBe('AnnaMax');
    expect(enc('Max1 Max_ (Max)', E('Max', 'P'))).toBe('Max1 P_ (P)');
  });

  it('Decode: Person-1 trifft nicht Person-10', () => {
    const e = [E('A', 'Person-1'), E('B', 'Person-10')];
    expect(dec('Person-10 / Person-1 / person-1.', ...e)).toBe('B / A / A.');
    // even if only Person-1 is known
    expect(dec('Person-10 / Person-1', E('A', 'Person-1'))).toBe('Person-10 / A');
  });

  it('Begriffe mit Satzzeichen am Rand', () => {
    expect(enc('Verein e.V. tagt', E('e.V.', 'X'))).toBe('Verein X tagt');
    expect(enc('Die Müller & Söhne GmbH', E('Müller & Söhne', 'F'))).toBe('Die F GmbH');
    expect(enc('Prüfung TÜV-Rheinl. ok', E('TÜV-Rheinl.', 'F'))).toBe('Prüfung F ok');
    expect(enc('Summe: 1.234 €.', E('1.234 €', 'B'))).toBe('Summe: B.');
    expect(enc('Mail an max@firma.de!', E('max@firma.de', 'M'))).toBe('Mail an M!');
    expect(enc('Betrag 21.234 €', E('1.234 €', 'B'))).toBe('Betrag 21.234 €');
  });

  it('Grenzen auch bei Zeichen außerhalb der BMP und kombinierenden Zeichen', () => {
    expect(enc('𝐀Max Max𝐀 Max́ Max', E('Max', 'P'))).toBe('𝐀Max Max𝐀 Max́ P');
    expect(enc('😀Max😀', E('Max', 'P'))).toBe('😀P😀');
  });

  it('Begriffe, die mit Zeichen außerhalb der BMP beginnen, hängen nicht', () => {
    // two entries → prefilter active; "🔥Plan" in "🔥Plany" is rejected at the boundary
    expect(enc('🔥Plan 🔥Plany 🔥Plan', E('🔥Plan', 'A'), E('Y', 'B'))).toBe('A 🔥Plany A');
    // overlap: "x🔥🔥" taken, "🔥🔥" after it rejected and the search continues
    expect(enc('x🔥🔥🔥🔥', E('x🔥🔥', 'P'), E('🔥🔥', 'Q'))).toBe('PQ');
  });

  it('längste zuerst, keine Überlappung', () => {
    const ps: Pair[] = [['Max Mustermann', 'Person_1'], ['Max', 'Person_2']];
    expect(applyMatches('Max Mustermann und Max', findMatches('Max Mustermann und Max', ps))).toBe('Person_1 und Person_2');
  });

  it('Vorfilter: unsortierte Begriffe und Präfixe an derselben Stelle', () => {
    const t = 'Max Mustermann, Max Muster, MAX';
    // the order of ps decides precedence; the prefilter must not lose any term
    expect(applyMatches(t, findMatches(t, [['Max', 'A'], ['Max Muster', 'B'], ['Max Mustermann', 'C']]))).toBe('A Mustermann, A Muster, A');
    expect(applyMatches(t, findMatches(t, [['Max Mustermann', 'C'], ['Max Muster', 'B'], ['Max', 'A']]))).toBe('C, B, A');
    // "Max Mustermann" fails at the boundary ("Max Mustermannx") → shorter prefixes match
    expect(applyMatches('Max Mustermannx', findMatches('Max Mustermannx', [['Max Mustermann', 'C'], ['Max', 'A']]))).toBe('A Mustermannx');
    expect(enc('ſtraße STRASSE', E('Straße', 'S'))).toBe('S STRASSE');
  });

  it('Regex-Sonderzeichen im Begriff', () => {
    expect(enc('a (b) [c]* d', E('(b) [c]*', 'X'))).toBe('a X d');
  });

  it('Spans für die Hervorhebung', () => {
    const t = 'Herr MÜLLER und Müllerin';
    expect(findMatches(t, [['Müller', 'Müller']]).map(([s, e]) => t.slice(s, e))).toEqual(['MÜLLER']);
  });

  it('linear: 2 000 Begriffe über 1 MB Text', () => {
    const e = Array.from({ length: 2000 }, (_, i) => E(`Name${i} Nachname${i}`, `Person-${i}`));
    const words = ['lorem', 'ipsum', 'Name5', 'Nachname5', 'dolor', 'Name1999 Nachname1999', 'sit'];
    let text = '';
    for (let i = 0; text.length < 1_000_000; i++) text += words[i % words.length] + ' ';
    const ps = pairs(e, 'encode');
    const t0 = performance.now();
    const m = findMatches(text, ps);
    const ms = performance.now() - t0;
    expect(m.length).toBeGreaterThan(10_000);
    expect(ms).toBeLessThan(30_000);
  });
});

describe('text codec', () => {
  it('UTF-16: ein zweiter BOM gehört zum Inhalt', () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0xff, 0xfe, 0x41, 0x00]))).toEqual(['﻿A', 'utf16le']);
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0xfe, 0xff, 0x00, 0x41]))).toEqual(['﻿A', 'utf16be']);
    // (utf8 without BOM but with a leading U+FEFF cannot be told apart from utf8bom, as in Rust)
    for (const e of ['utf16le', 'utf16be', 'utf8bom'] as const) {
      expect(decodeText(encodeText('﻿A', e))).toEqual(['﻿A', e]);
    }
  });
});

describe('changedPlaceholders (written differently by the AI)', () => {
  const list = [E('Laura Hoffmann', 'Person-1', 'a'), E('Thomas Brenner', 'Person-2', 'b'), E('Nordwind GmbH', 'Company-1', 'c')];

  it('finds "Person 1", "Person_1", "Person1", "Person–2" but not the placeholder itself', () => {
    const text = 'Person-1 and PERSON-2 are fine. Person 1, Person_1, person1 and Person–2 are not.';
    expect(changedPlaceholders(text, list)).toEqual({ count: 4, sample: 'Person 1' });
    // A case change is brought back, so it does not count
    expect(dec('PERSON-2 met person-1.', ...list)).toBe('Thomas Brenner met Laura Hoffmann.');
  });

  it('ignores numbers that are no placeholder in the list and other words', () => {
    expect(changedPlaceholders('Person 7, Person-10, Personal 1, Company 12, 2 Person', list)).toEqual({ count: 0, sample: null });
    expect(changedPlaceholders('Person 1', [E('x', 'Kunde A', 'k')])).toEqual({ count: 0, sample: null });
    expect(changedPlaceholders('Person-01', list).count).toBe(1);
  });
});
