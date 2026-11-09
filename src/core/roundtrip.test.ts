/**
 * File round trip: hide the names in a file (copy with placeholders), let "the AI" edit that copy,
 * open it again and bring the names back (copy with the real names in the same format).
 */
import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { Category } from '../types';
import { detectAll } from './detector';
import { makeCopy } from './file-copy';
import { parseFile } from './parsers';
import { AliasStore } from './store';
import { pairs } from './substitute';

const EXAMPLE = new URL('../../docs/examples/Alias_Example_Document.docx', import.meta.url);

function storeOf(items: [string, Category][]): AliasStore {
  const st = new AliasStore();
  for (const [original, category] of items) st.add(original, null, category);
  return st;
}

const aliasOf = (st: AliasStore, original: string) => [...st.entries.values()].find((e) => e.original === original)!.alias;

/** Copy with placeholders, as "Save file for AI" writes it */
async function hide(name: string, bytes: Uint8Array, st: AliasStore) {
  const shown = (await parseFile(name, bytes)).content;
  const copy = makeCopy(name, bytes, 'encode', pairs(st.entries.values(), 'encode'), shown);
  return { shown, copy, text: (await parseFile(copy.name, copy.bytes)).content };
}

/** Copy with the real names, as "Save file" in step 2 writes it */
async function bringBack(name: string, bytes: Uint8Array, st: AliasStore) {
  const shown = (await parseFile(name, bytes)).content;
  const copy = makeCopy(name, bytes, 'decode', pairs(st.entries.values(), 'decode'), shown);
  return { shown, copy, text: (await parseFile(copy.name, copy.bytes)).content };
}

/** Change one ZIP part ("the AI edits the file") */
function editZip(bytes: Uint8Array, part: string, edit: (xml: string) => string): Uint8Array {
  const files = unzipSync(bytes);
  const before = strFromU8(files[part]);
  const after = edit(before);
  expect(after).not.toBe(before);
  files[part] = strToU8(after);
  return zipSync(files);
}

/** Replace the first occurrence only */
const once = (s: string, from: string, to: string) => {
  const i = s.indexOf(from);
  expect(i).toBeGreaterThanOrEqual(0);
  return s.slice(0, i) + to + s.slice(i + from.length);
};

/** Text without the document properties (the copy for the AI is cleaned of author, dates …) */
const body = (t: string) => t.split(/\n=== /)[0].trim();

describe('file round trip: hide, AI edits the file, bring the names back', () => {
  it('docs/examples/Alias_Example_Document.docx: unchanged copy comes back with its text', async () => {
    const bytes = new Uint8Array(readFileSync(EXAMPLE));
    const original = (await parseFile('Alias_Example_Document.docx', bytes)).content;
    // Matches over a line break cannot be replaced in a Word file (the app warns about them)
    const found = detectAll(original).filter((c) => !c.text.includes('\n'));
    expect(found.length).toBeGreaterThan(5);
    const st = storeOf(found.map((c) => [c.text, c.category]));

    const enc = await hide('Alias_Example_Document.docx', bytes, st);
    expect(enc.copy.name).toBe('Alias_Example_Document_anonym.docx');
    expect(enc.copy.missed).toEqual([]);
    for (const c of found) expect(body(enc.text)).not.toContain(c.text);

    const dec = await bringBack(enc.copy.name, enc.copy.bytes, st);
    expect(dec.copy.name).toBe('Alias_Example_Document_original.docx');
    expect(dec.copy.missed).toEqual([]);
    // No metadata cleanup when bringing the names back
    expect(dec.copy.removed).toEqual([]);
    expect(body(dec.text)).toBe(body(original));
  });

  it('docx: the AI fixes a word, writes a placeholder in small letters and splits one over two runs', async () => {
    const bytes = new Uint8Array(readFileSync(EXAMPLE));
    const original = (await parseFile('Alias_Example_Document.docx', bytes)).content;
    const st = storeOf([
      ['Laura Hoffmann', 'person'],
      ['Thomas Brenner', 'person'],
      ['Markus Fischer', 'person'],
    ]);
    const [laura, thomas, markus] = ['Laura Hoffmann', 'Thomas Brenner', 'Markus Fischer'].map((n) => aliasOf(st, n));
    const enc = await hide('Alias_Example_Document.docx', bytes, st);
    expect(enc.text).toContain(`Dr. ${laura} (Product Director)`);

    const ai = editZip(enc.copy.bytes, 'word/document.xml', (xml) => {
      let x = once(xml, 'met with representatives', 'met with the representatives');
      x = once(x, thomas, thomas.toLowerCase());
      x = once(x, laura, `${laura.slice(0, 4)}</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${laura.slice(4)}`);
      x = once(x, markus, markus.toUpperCase());
      return x;
    });
    const dec = await bringBack('Alias_Example_Document_anonym.docx', ai, st);
    expect(dec.copy.missed).toEqual([]);
    expect(dec.text).not.toMatch(/Person-\d/i);
    const expected = once(original, 'met with representatives', 'met with the representatives');
    expect(body(dec.text)).toBe(body(expected));
  });

  for (const bookSST of [true, false]) {
    it(`xlsx (${bookSST ? 'shared strings' : 'inline strings'}): the AI fixes a typo next to a placeholder`, async () => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          ['Name', 'Address', 'Note'],
          ['Laura Hoffmann', 'Hauptstraße 5, 68159 Mannheim', 'Laura Hoffmann wants the invoise by Friday.'],
          ['Thomas Brenner', 'Ringstraße 12, 10115 Berlin', 'Call Thomas Brenner first.'],
          ['Total', 1234, 'Nordwind GmbH'],
        ]),
        'Customers',
      );
      const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', bookSST }) as ArrayBuffer);
      const st = storeOf([
        ['Laura Hoffmann', 'person'],
        ['Thomas Brenner', 'person'],
        ['Hauptstraße 5, 68159 Mannheim', 'ort'],
        ['Nordwind GmbH', 'firma'],
      ]);
      const original = (await parseFile('customers.xlsx', bytes)).content;
      const enc = await hide('customers.xlsx', bytes, st);
      expect(enc.copy.name).toBe('customers_anonym.xlsx');
      expect(enc.copy.missed).toEqual([]);
      expect(enc.text).not.toMatch(/Laura|Hauptstraße 5|Nordwind/);

      const laura = aliasOf(st, 'Laura Hoffmann');
      const part = bookSST ? 'xl/sharedStrings.xml' : 'xl/worksheets/sheet1.xml';
      const ai = editZip(enc.copy.bytes, part, (xml) => once(xml, `${laura} wants the invoise`, `${laura.toLowerCase()} wants the invoice`));
      const dec = await bringBack('customers_anonym.xlsx', ai, st);
      expect(dec.copy.name).toBe('customers_original.xlsx');
      expect(dec.copy.missed).toEqual([]);
      expect(dec.text).toBe(original.replace('invoise', 'invoice'));
      expect(dec.text).toContain('1234');
    });
  }

  it('pptx and odt come back with their text', async () => {
    const st = storeOf([
      ['Laura Hoffmann', 'person'],
      ['Nordwind GmbH', 'firma'],
    ]);
    const pptx = zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
      'ppt/slides/slide1.xml': strToU8(
        '<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Laura </a:t></a:r><a:r><a:t>Hoffmann</a:t></a:r>' +
          '<a:r><a:t> joins Nordwind GmbH.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
      ),
    });
    const odt = zipSync({
      mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
      'content.xml': strToU8(
        '<office:document-content><office:body><office:text><text:p>Dear Laura Hoffmann,</text:p>' +
          '<text:p>Nordwind GmbH <text:span>thanks</text:span> you.</text:p></office:text></office:body></office:document-content>',
      ),
    });
    for (const [name, bytes] of [['deck.pptx', pptx], ['letter.odt', odt]] as const) {
      const original = (await parseFile(name, bytes)).content;
      const enc = await hide(name, bytes, st);
      expect(enc.text).not.toMatch(/Laura|Nordwind/);
      const dec = await bringBack(enc.copy.name, enc.copy.bytes, st);
      expect(dec.copy.name).toBe(name.replace('.', '_original.'));
      expect(body(dec.text)).toBe(body(original));
    }
  });
});
