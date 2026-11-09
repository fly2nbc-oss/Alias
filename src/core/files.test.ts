/** Port of the Rust tests from office_xml.rs, substitutor/*.rs, text_codec.rs, person_ner/engine.rs */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { AliasEntry } from '../types';
import { replaceInText, replaceInZip } from './file-copy';
import { outputName } from './formats';
import { alignTokens, labelRole, spansFromBio } from './ner/bio';
import { DOCX, extractText, ODF, replaceText } from './office-xml';
import { AliasStore } from './store';
import { applyMatches, findMatches, pairs, substitute, type Match } from './substitute';
import { decodeText, encodeText, type TextEncoding } from './text-codec';

const entries = (): AliasEntry[] => [
  { id: '1', original: 'Max Mustermann', alias: 'Person_1', category: 'person', confirmed: true },
  { id: '2', original: 'Müller & Söhne', alias: 'Firma_1', category: 'person', confirmed: true },
];

const literal = (ps: [string, string][]) => (text: string): Match[] => {
  const m: Match[] = [];
  for (const [from, to] of ps) {
    for (let p = text.indexOf(from); p >= 0; p = text.indexOf(from, p + 1)) m.push([p, p + from.length, to]);
  }
  return m.sort((a, b) => a[0] - b[0]);
};

const buildZip = (files: [string, string][]) => zipSync(Object.fromEntries(files.map(([n, c]) => [n, strToU8(c)])));
const readZip = (bytes: Uint8Array, name: string) => strFromU8(unzipSync(bytes)[name]);

describe('office-xml', () => {
  it('replaces across runs', () => {
    const xml = '<w:p><w:r><w:t xml:space="preserve">Hallo Max </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Mustermann GmbH</w:t></w:r></w:p>';
    const [out, n] = replaceText(xml, DOCX, literal([['Max Mustermann', 'Person_1']]));
    expect(n).toBe(1);
    expect(out).toBe(
      '<w:p><w:r><w:t xml:space="preserve">Hallo Person_1</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> GmbH</w:t></w:r></w:p>',
    );
    const [orig] = replaceText(out, DOCX, literal([['Person_1', 'Max Mustermann']]));
    expect(extractText(orig, DOCX)).toBe('Hallo Max Mustermann GmbH\n');
  });

  it('handles entities and ignores markup', () => {
    const xml = '<w:p w:rsidR="Müller"><w:r><w:t>Müller &amp; Söhne</w:t></w:r></w:p>';
    const [out] = replaceText(xml, DOCX, literal([['Müller & Söhne', 'Firma_1'], ['Müller', 'X']]));
    expect(out.startsWith('<w:p w:rsidR="Müller">')).toBe(true);
  });

  it('odf text and breaks', () => {
    const xml = '<text:p text:style-name="P1">Anna<text:tab/>Berlin <text:span>Schmidt</text:span></text:p>';
    expect(extractText(xml, ODF)).toBe('Anna\tBerlin Schmidt\n');
    const [out, n] = replaceText(xml, ODF, literal([['Berlin Schmidt', 'Person_2 & Co']]));
    expect(n).toBe(1);
    expect(out).toBe('<text:p text:style-name="P1">Anna<text:tab/>Person_2 &amp; Co<text:span></text:span></text:p>');
  });
});

describe('file copy', () => {
  it('docx roundtrip all parts', () => {
    const body = '<w:document><w:body><w:p><w:r><w:t xml:space="preserve">Max </w:t></w:r><w:r><w:t>Mustermann</w:t></w:r></w:p></w:body></w:document>';
    const header = '<w:hdr><w:p><w:r><w:t>Müller &amp; Söhne</w:t></w:r></w:p></w:hdr>';
    const core = '<cp:coreProperties><dc:creator>Max Mustermann</dc:creator></cp:coreProperties>';
    const src = buildZip([
      ['word/document.xml', body],
      ['word/header2.xml', header],
      ['docProps/core.xml', core],
      ['word/media/image1.png', 'Max Mustermann'],
    ]);
    const [enc, n] = replaceInZip(src, pairs(entries(), 'encode'), 'docx');
    expect(n).toBe(3);
    expect(readZip(enc, 'word/document.xml')).toContain('Person_1');
    expect(readZip(enc, 'word/document.xml')).not.toContain('Mustermann');
    expect(readZip(enc, 'word/header2.xml')).toContain('Firma_1');
    expect(readZip(enc, 'docProps/core.xml')).toContain('Person_1');
    expect(readZip(enc, 'word/media/image1.png')).toBe('Max Mustermann');
    const [dec] = replaceInZip(enc, pairs(entries(), 'decode'), 'docx');
    expect(readZip(dec, 'word/header2.xml')).toBe(header);
    expect(readZip(dec, 'docProps/core.xml')).toBe(core);
    expect(extractText(readZip(dec, 'word/document.xml'), DOCX)).toBe('Max Mustermann\n');
  });

  it('pptx master and slides', () => {
    const slide = '<p:sld><a:p><a:r><a:t>Kontakt: Max Mustermann</a:t></a:r></a:p></p:sld>';
    const master = '<p:sldMaster><a:p><a:r><a:t>© Müller &amp; Söhne</a:t></a:r></a:p></p:sldMaster>';
    const src = buildZip([['ppt/slides/slide1.xml', slide], ['ppt/slideMasters/slideMaster1.xml', master]]);
    const [enc, n] = replaceInZip(src, pairs(entries(), 'encode'), 'pptx');
    expect(n).toBe(2);
    const [dec] = replaceInZip(enc, pairs(entries(), 'decode'), 'pptx');
    expect(readZip(dec, 'ppt/slides/slide1.xml')).toBe(slide);
    expect(readZip(dec, 'ppt/slideMasters/slideMaster1.xml')).toBe(master);
  });

  it('text roundtrip keeps encoding', () => {
    const original = encodeText('Sehr geehrter Max Mustermann,\r\nGrüße, Ihre Müller & Söhne\r\n', 'windows1252');
    const [enc, n] = replaceInText(original, pairs(entries(), 'encode'));
    expect(n).toBe(2);
    const [dec] = replaceInText(enc, pairs(entries(), 'decode'));
    expect(dec).toEqual(original);
  });

  it('xlsx numeric entry does not touch values', () => {
    const e = [...entries(), { id: '3', original: '1234', alias: 'Betrag_1', category: 'betrag', confirmed: true } as AliasEntry];
    const sheet = '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1234</v></c><c r="C1" t="str"><f>A1&amp;" x"</f><v>Max Mustermann x</v></c></row></sheetData></worksheet>';
    const shared = '<sst><si><t>Rechnung 1234</t></si></sst>';
    const src = buildZip([['xl/worksheets/sheet1.xml', sheet], ['xl/sharedStrings.xml', shared]]);
    const [enc] = replaceInZip(src, pairs(e, 'encode'), 'xlsx');
    const out = readZip(enc, 'xl/worksheets/sheet1.xml');
    expect(out).toContain('<c r="B1"><v>1234</v></c>');
    expect(out).toContain('<v>Person_1 x</v>');
    expect(out).toContain('<f>A1&amp;" x"</f>');
    expect(readZip(enc, 'xl/sharedStrings.xml')).toContain('Rechnung Betrag_1');
  });

  it('ODF mimetype stays first and uncompressed', () => {
    const src = zipSync({
      mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
      'content.xml': strToU8('<text:p>Max Mustermann</text:p>'),
    });
    const [enc] = replaceInZip(src, pairs(entries(), 'encode'), 'odf');
    // Local header of the first entry: name at offset 30, method (2 bytes) at offset 8
    expect(strFromU8(enc.subarray(30, 38))).toBe('mimetype');
    expect(enc[8] | (enc[9] << 8)).toBe(0);
    expect(readZip(enc, 'content.xml')).toContain('Person_1');
  });

  it('output names', () => {
    expect(outputName('bericht.docx', 'encode')).toBe('bericht_anonym.docx');
    expect(outputName('bericht_anonym.docx', 'decode')).toBe('bericht_original.docx');
  });
});

describe('substitute', () => {
  it('longest wins, no overlap', () => {
    const ps: [string, string][] = [['Max Mustermann', 'Person_1'], ['Max', 'Person_2']];
    expect(applyMatches('Max Mustermann und Max', findMatches('Max Mustermann und Max', ps))).toBe('Person_1 und Person_2');
  });

  it('encode/decode roundtrip; unconfirmed entries ignored', () => {
    const e = [...entries(), { id: '9', original: 'Anna', alias: 'Person_9', category: 'person', confirmed: false } as AliasEntry];
    const enc = substitute('Max Mustermann und Anna, Müller & Söhne', e, 'encode');
    expect(enc).toEqual({ text: 'Person_1 und Anna, Firma_1', replacements_made: 2 });
    expect(substitute(enc.text, e, 'decode').text).toBe('Max Mustermann und Anna, Müller & Söhne');
  });

  it('Person-1 vs Person-10 decode', () => {
    const e: AliasEntry[] = [
      { id: 'a', original: 'A', alias: 'Person-1', category: 'person', confirmed: true },
      { id: 'b', original: 'B', alias: 'Person-10', category: 'person', confirmed: true },
    ];
    expect(substitute('Person-10 / Person-1', e, 'decode').text).toBe('B / A');
  });
});

describe('store', () => {
  it('auto alias numbering and duplicate originals', () => {
    const s = new AliasStore();
    expect(s.add('Max', null, 'person').alias).toBe('Person-1');
    expect(s.add('max', null, 'person').alias).toBe('Person-1');
    expect(s.add('Anna', null, 'person').alias).toBe('Person-2');
    expect(s.previewAlias('person')).toBe('Person-3');
  });

  it('import updates counters and skips existing', () => {
    const s = new AliasStore();
    s.importEntries([{ id: 'x', original: 'Acme', alias: 'Company-7', category: 'firma', confirmed: true }]);
    expect(s.add('Foo AG', null, 'firma').alias).toBe('Company-8');
    s.importEntries([{ id: 'y', original: 'ACME', alias: 'Other', category: 'firma', confirmed: true }]);
    expect(s.list()).toHaveLength(2);
  });
});

describe('text codec', () => {
  it('roundtrip all encodings', () => {
    const s = 'Grüße, Jürgen Müller\r\n';
    for (const enc of ['utf8', 'utf8bom', 'utf16le', 'utf16be', 'windows1252'] as TextEncoding[]) {
      expect(decodeText(encodeText(s, enc))).toEqual([s, enc]);
    }
  });

  it('windows-1252 unmappable chars become numeric entities', () => {
    expect(new TextDecoder('windows-1252').decode(encodeText('a€→', 'windows1252'))).toBe('a€&#8594;');
  });
});

describe('ner bio', () => {
  it('merges adjacent person inside', () => {
    const s = spansFromBio(
      [
        { role: { kind: 'begin', cat: 'person' }, conf: 0.9, off: [0, 1] },
        { role: { kind: 'inside', cat: 'person' }, conf: 0.8, off: [1, 2] },
      ],
      'ab',
    );
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ text: 'ab', category: 'person' });
  });

  it('detects org separately', () => {
    const s = spansFromBio(
      [
        { role: { kind: 'begin', cat: 'firma' }, conf: 0.9, off: [0, 4] },
        { role: { kind: 'inside', cat: 'firma' }, conf: 0.85, off: [5, 9] },
      ],
      'ACME Corp',
    );
    expect(s).toHaveLength(1);
    expect(s[0].category).toBe('firma');
  });

  it('label role parses all BIO types', () => {
    expect(labelRole('B-PER')).toEqual({ kind: 'begin', cat: 'person' });
    expect(labelRole('I-PER')).toEqual({ kind: 'inside', cat: 'person' });
    expect(labelRole('B-ORG')).toEqual({ kind: 'begin', cat: 'firma' });
    expect(labelRole('B-LOC')).toEqual({ kind: 'begin', cat: 'ort' });
    expect(labelRole('B-MISC')).toEqual({ kind: 'begin', cat: 'sonstiges' });
    expect(labelRole('O')).toEqual({ kind: 'outside' });
  });

  it('flush on category change', () => {
    const s = spansFromBio(
      [
        { role: { kind: 'begin', cat: 'person' }, conf: 0.9, off: [0, 4] },
        { role: { kind: 'begin', cat: 'firma' }, conf: 0.9, off: [5, 9] },
      ],
      'Anna GmbH',
    );
    expect(s.map((x) => x.category)).toEqual(['person', 'firma']);
  });

  it('aligns WordPiece tokens to character offsets', () => {
    const text = 'Herr Jürgen  Müller-Lüdenscheidt\nwohnt in Köln.';
    const tokens = ['Herr', 'Jürgen', 'Müller', '-', 'L', '##üden', '##scheid', '##t', 'wohnt', 'in', 'Köln', '.'];
    const offs = alignTokens(text, tokens);
    expect(offs.map(([s, e]) => text.slice(s, e))).toEqual(tokens.map((t) => t.replace(/^##/, '')));
  });

  it('aligns [UNK] to the unknown word', () => {
    const text = 'Hallo 🦜🦜 Anna';
    const offs = alignTokens(text, ['Hallo', '[UNK]', 'Anna']);
    expect(text.slice(...offs[2])).toBe('Anna');
  });
});
