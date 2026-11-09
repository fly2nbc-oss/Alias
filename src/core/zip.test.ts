/** ZIP reader/writer: raw copy, order, metadata, special cases */
import { readFileSync } from 'node:fs';
import { deflateSync, strFromU8, strToU8, unzipSync, Zip, ZipDeflate, ZipPassThrough, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { makeCopy, replaceInZip } from './file-copy';
import { readDocx } from './parsers';
import { pairs } from './substitute';
import { crc32, readZip, withData, writeZip } from './zip';

// ---------------------------------------------------------------- Helpers

interface RawEntry {
  name: string;
  flags: number;
  method: number;
  time: number;
  date: number;
  crc: number;
  externalAttr: number;
  /** Local header + compressed data + data descriptor (up to the next entry or the CD) */
  local: Uint8Array;
  /** only the compressed data */
  comp: Uint8Array;
  localExtraLen: number;
}

/** Independent mini parser for the checks (not the code under test). */
function rawEntries(b: Uint8Array): RawEntry[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = b.length - 22;
  while (dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const count = dv.getUint16(eocd + 10, true);
  const cdOff = dv.getUint32(eocd + 16, true);
  const out: RawEntry[] = [];
  const offsets: number[] = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const csize = dv.getUint32(p + 20, true);
    const lnlen = dv.getUint16(off + 26, true);
    const lelen = dv.getUint16(off + 28, true);
    const ds = off + 30 + lnlen + lelen;
    offsets.push(off);
    out.push({
      name: strFromU8(b.subarray(p + 46, p + 46 + nlen)),
      flags: dv.getUint16(p + 8, true),
      method: dv.getUint16(p + 10, true),
      time: dv.getUint16(p + 12, true),
      date: dv.getUint16(p + 14, true),
      crc: dv.getUint32(p + 16, true),
      externalAttr: dv.getUint32(p + 38, true),
      local: b.subarray(off, off), // set below
      comp: b.subarray(ds, ds + csize),
      localExtraLen: lelen,
    });
    p += 46 + nlen + elen + clen;
  }
  const sorted = [...offsets].sort((a, b) => a - b);
  out.forEach((e, i) => {
    const next = sorted.find((o) => o > offsets[i]) ?? cdOff;
    e.local = b.subarray(offsets[i], next);
  });
  return out;
}

/** Build an archive with fflate's streaming writer (fixed order, data descriptors for deflate). */
function streamZip(files: [string, Uint8Array, 'store' | 'deflate', Date?][]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const z = new Zip((err, chunk) => {
    if (err) throw err;
    chunks.push(chunk);
  });
  for (const [name, data, how, mtime] of files) {
    const f = how === 'store' ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
    if (mtime) f.mtime = mtime;
    z.add(f);
    f.push(data, true);
  }
  z.end();
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Overwrite method/flags of an entry in the local and central header */
function patchEntry(src: Uint8Array, name: string, patch: { method?: number; flags?: number; crc?: number }): Uint8Array {
  const u = src.slice();
  const dv = new DataView(u.buffer);
  for (let i = 0; i < u.length - 4; i++) {
    const sig = dv.getUint32(i, true);
    if (sig !== 0x04034b50 && sig !== 0x02014b50) continue;
    const central = sig === 0x02014b50;
    const nl = dv.getUint16(i + (central ? 28 : 26), true);
    const ns = i + (central ? 46 : 30);
    if (strFromU8(u.subarray(ns, ns + nl)) !== name) continue;
    const base = central ? i + 2 : i;
    if (patch.flags !== undefined) dv.setUint16(base + 6, patch.flags, true);
    if (patch.method !== undefined) dv.setUint16(base + 8, patch.method, true);
    if (patch.crc !== undefined) dv.setUint32(base + 14, patch.crc, true);
  }
  return u;
}

const ENTRIES = [
  { id: '1', original: 'Laura Hoffmann', alias: 'Person-1', category: 'person' as const, confirmed: true },
  { id: '2', original: 'Max Mustermann', alias: 'Person-2', category: 'person' as const, confirmed: true },
];
const DOC = (t: string) => `<w:document><w:body><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:body></w:document>`;
const MTIME = new Date(2001, 1, 3, 4, 5, 6);

// ---------------------------------------------------------------- Tests

describe('zip', () => {
  it('docx roundtrip: unveränderte Einträge byte-identisch, Metadaten erhalten', () => {
    const src = new Uint8Array(readFileSync(new URL('../../docs/examples/Alias_Example_Document.docx', import.meta.url)));
    const [enc, n] = replaceInZip(src, pairs(ENTRIES, 'encode'), 'docx');
    expect(n).toBeGreaterThanOrEqual(2);
    const a = rawEntries(src);
    const b = rawEntries(enc);
    expect(b.map((e) => e.name)).toEqual(a.map((e) => e.name));
    for (let i = 0; i < a.length; i++) {
      expect([b[i].time, b[i].date, b[i].externalAttr, b[i].method]).toEqual([a[i].time, a[i].date, a[i].externalAttr, a[i].method]);
      const changed = a[i].name === 'word/document.xml' || a[i].name === 'word/header1.xml';
      if (!changed) expect(b[i].local).toEqual(a[i].local);
      else expect(b[i].comp).not.toEqual(a[i].comp);
    }
    const text = readDocx(readZip(enc));
    expect(text).toContain('Person-1');
    expect(text).not.toMatch(/Laura Hoffmann/i);
    // The way back restores the text
    const [dec] = replaceInZip(enc, pairs(ENTRIES, 'decode'), 'docx');
    expect(readDocx(readZip(dec))).toBe(readDocx(readZip(src)));
    // fflate can read the result too
    expect(Object.keys(unzipSync(enc))).toHaveLength(a.length);
  });

  it('ODF: mimetype zuerst, Methode 0, ohne Extra-Feld; Zeitstempel und Kommentar erhalten', () => {
    const plain = zipSync({
      mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0, mtime: MTIME }],
      'content.xml': [strToU8('<office:text><text:p>Max Mustermann</text:p></office:text>'), { level: 6, mtime: MTIME }],
      'Pictures/a.png': [strToU8('PNGDATA'.repeat(50)), { level: 6, mtime: MTIME }],
    });
    // Append an archive comment (fflate writes none)
    const src = new Uint8Array(plain.length + 10);
    src.set(plain);
    src.set(strToU8('zipcomment'), plain.length);
    src[plain.length - 2] = 10;
    const [out, n] = replaceInZip(src, pairs(ENTRIES, 'encode'), 'odf');
    expect(n).toBe(1);
    const r = rawEntries(out);
    expect(r.map((e) => e.name)).toEqual(['mimetype', 'content.xml', 'Pictures/a.png']);
    expect(strFromU8(out.subarray(30, 38))).toBe('mimetype');
    expect(r[0].method).toBe(0);
    expect(r[0].localExtraLen).toBe(0);
    const s = rawEntries(src);
    expect(r.map((e) => [e.time, e.date])).toEqual(s.map((e) => [e.time, e.date]));
    expect(strFromU8(out.subarray(out.length - 10))).toBe('zipcomment');
    expect(strFromU8(unzipSync(out)['content.xml'])).toContain('Person-2');
  });

  it('Reihenfolge bleibt: Eintrag „1“ wird nicht vor mimetype sortiert', () => {
    const src = streamZip([
      ['mimetype', strToU8('application/vnd.oasis.opendocument.text'), 'store'],
      ['1', strToU8('eins'), 'deflate'],
      ['content.xml', strToU8('<text:p>Max Mustermann</text:p>'), 'deflate'],
    ]);
    expect(readZip(src).map((e) => e.name)).toEqual(['mimetype', '1', 'content.xml']);
    const [out] = replaceInZip(src, pairs(ENTRIES, 'encode'), 'odf');
    expect(readZip(out).map((e) => e.name)).toEqual(['mimetype', '1', 'content.xml']);
    expect(strFromU8(out.subarray(30, 38))).toBe('mimetype');
  });

  it('Data Descriptors: roh übernommen, geänderte Einträge ohne Descriptor neu geschrieben', () => {
    const img = new Uint8Array(5000).map((_, i) => (i * 7) & 0xff);
    const src = streamZip([
      ['word/document.xml', strToU8(DOC('Hallo Max Mustermann')), 'deflate', MTIME],
      ['word/media/image1.png', img, 'deflate', MTIME],
    ]);
    const s = rawEntries(src);
    expect(s[0].flags & 8).toBe(8);
    const [out, n] = replaceInZip(src, pairs(ENTRIES, 'encode'), 'docx');
    expect(n).toBe(1);
    const r = rawEntries(out);
    expect(r[1].local).toEqual(s[1].local);
    expect(r[0].flags & 8).toBe(0);
    expect([r[0].time, r[0].date]).toEqual([s[0].time, s[0].date]);
    const files = unzipSync(out);
    expect(files['word/media/image1.png']).toEqual(img);
    expect(strFromU8(files['word/document.xml'])).toContain('Hallo Person-2');
  });

  it('unbekannte Kompressionsmethode (9): Öffnen und Speichern klappen, Eintrag roh übernommen', () => {
    const base = zipSync({
      'word/document.xml': strToU8(DOC('Max Mustermann')),
      'word/media/x.bin': [strToU8('abc'.repeat(100)), { level: 6 }],
    });
    const src = patchEntry(base, 'word/media/x.bin', { method: 9 });
    const zip = readZip(src);
    expect(readDocx(zip)).toBe('Max Mustermann');
    expect(() => zip[1].data).toThrow(/unsupported compression method \(9\)/);
    const [out, n] = replaceInZip(src, pairs(ENTRIES, 'encode'), 'docx');
    expect(n).toBe(1);
    const r = rawEntries(out);
    expect(r[1].method).toBe(9);
    expect(r[1].local).toEqual(rawEntries(src)[1].local);
  });

  it('verschlüsselte Einträge: Fehler nur, wenn Text betroffen ist', () => {
    const base = zipSync({
      'word/document.xml': strToU8(DOC('Max Mustermann')),
      'word/media/x.bin': strToU8('secret'),
    });
    const media = patchEntry(base, 'word/media/x.bin', { flags: 1 });
    expect(replaceInZip(media, pairs(ENTRIES, 'encode'), 'docx')[1]).toBe(1);
    const doc = patchEntry(base, 'word/document.xml', { flags: 1 });
    expect(() => readDocx(readZip(doc))).toThrow(/encrypted/);
  });

  it('OLE-Datei (passwortgeschützt/alt) wird mit klarer Meldung abgelehnt', () => {
    const ole = new Uint8Array(512);
    ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(() => readZip(ole)).toThrow(/password-protected or in a legacy/);
    expect(() => readZip(strToU8('kein zip'))).toThrow(/Not a valid Office file/);
  });

  it('beschädigte Daten (CRC) werden erkannt', () => {
    const base = zipSync({ 'word/document.xml': strToU8(DOC('Max')) });
    const bad = patchEntry(base, 'word/document.xml', { crc: 1234 });
    expect(() => readZip(bad)[0].data).toThrow(/CRC mismatch/);
  });

  it('Zip-Bomb-Schutz: pro Eintrag und gesamt', () => {
    const big = new Uint8Array(51 * 1024 * 1024); // zeros, about 50 KB compressed
    const src = zipSync({ 'word/document.xml': [big, { level: 1 }], 'a.xml': strToU8('x'.repeat(1000)) });
    expect(src.length).toBeLessThan(1024 * 1024);
    expect(() => readZip(src)[0].data).toThrow(/more than 50 MB.*zip bomb/);
    const zip = readZip(src, { maxUnpackedBytes: 1500, maxEntryBytes: 1e9 });
    expect(zip[1].data.length).toBe(1000);
    expect(() => readZip(src, { maxUnpackedBytes: 1500, maxEntryBytes: 1e9 })[0].data).toThrow(/zip bomb/);
  });

  it('ZIP64-Felder im Central Directory und ZIP64-EOCD werden gelesen', () => {
    const data = strToU8(DOC('Max Mustermann'));
    const name = strToU8('word/document.xml');
    const crc = crc32(data);
    const le = (n: number, bytes: number) => Array.from({ length: bytes }, (_, i) => Math.floor(n / 2 ** (8 * i)) & 0xff);
    const local = [...le(0x04034b50, 4), ...le(45, 2), 0, 0, 0, 0, 0, 0, 0, 0, ...le(crc, 4), ...le(data.length, 4), ...le(data.length, 4), ...le(name.length, 2), 0, 0, ...name, ...data];
    const zip64 = [...le(1, 2), ...le(24, 2), ...le(data.length, 8), ...le(data.length, 8), ...le(0, 8)];
    const cd = [...le(0x02014b50, 4), ...le(45, 2), ...le(45, 2), 0, 0, 0, 0, 0, 0, 0, 0, ...le(crc, 4), ...le(0xffffffff, 4), ...le(0xffffffff, 4), ...le(name.length, 2), ...le(zip64.length, 2), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le(0xffffffff, 4), ...name, ...zip64];
    const cdOff = local.length;
    const eocd64Off = cdOff + cd.length;
    const eocd64 = [...le(0x06064b50, 4), ...le(44, 8), ...le(45, 2), ...le(45, 2), ...le(0, 4), ...le(0, 4), ...le(1, 8), ...le(1, 8), ...le(cd.length, 8), ...le(cdOff, 8)];
    const locator = [...le(0x07064b50, 4), ...le(0, 4), ...le(eocd64Off, 8), ...le(1, 4)];
    const eocd = [...le(0x06054b50, 4), 0, 0, 0, 0, ...le(0xffff, 2), ...le(0xffff, 2), ...le(0xffffffff, 4), ...le(0xffffffff, 4), 0, 0];
    const src = Uint8Array.from([...local, ...cd, ...eocd64, ...locator, ...eocd]);
    expect(readDocx(readZip(src))).toBe('Max Mustermann');
    const [out] = replaceInZip(src, pairs(ENTRIES, 'encode'), 'docx');
    expect(strFromU8(unzipSync(out)['word/document.xml'])).toContain('Person-2');
  });

  it('xlsx mit Methode 0: geänderte Einträge bleiben unkomprimiert', () => {
    const sheet = '<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Max Mustermann</t></is></c></row></sheetData></worksheet>';
    const src = zipSync({ 'xl/worksheets/sheet1.xml': [strToU8(sheet), { level: 0 }], 'xl/styles.xml': [strToU8('<styleSheet/>'), { level: 0 }] });
    const [out, n] = replaceInZip(src, pairs(ENTRIES, 'encode'), 'xlsx');
    expect(n).toBe(1);
    expect(rawEntries(out).map((e) => e.method)).toEqual([0, 0]);
    expect(strFromU8(unzipSync(out)['xl/worksheets/sheet1.xml'])).toContain('Person-2');
  });

  it('writeZip: neue Einträge und withData auf neuen Einträgen', () => {
    const out = writeZip([
      { name: 'mimetype', data: strToU8('x'), compression: 0 },
      withData({ name: 'ä.xml', data: strToU8('alt'), compression: 8 }, strToU8('neu')),
    ]);
    const r = rawEntries(out);
    expect(r[0].method).toBe(0);
    expect(r[1].flags & 0x800).toBe(0x800);
    expect(strFromU8(unzipSync(out)['ä.xml'])).toBe('neu');
    expect(readZip(out).map((e) => e.name)).toEqual(['mimetype', 'ä.xml']);
  });

  it('crc32', () => {
    expect(crc32(strToU8('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('makeCopy meldet nicht ersetzte Begriffe (xlsx-Datum als Seriennummer)', () => {
    const sheet = '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"><v>45366</v></c></row></sheetData></worksheet>';
    const src = zipSync({
      'xl/worksheets/sheet1.xml': strToU8(sheet),
      'xl/sharedStrings.xml': strToU8('<sst><si><t>Max Mustermann</t></si></sst>'),
    });
    const e = [...ENTRIES, { id: '3', original: '2024-03-15', alias: 'Date-1', category: 'datum' as const, confirmed: true }];
    const shown = 'Max Mustermann\t2024-03-15\n';
    const copy = makeCopy('kunden.xlsx', src, 'encode', pairs(e, 'encode'), shown);
    expect(copy.replacements).toBe(1);
    expect(copy.missed).toEqual([{ original: '2024-03-15', shown: 1, replaced: 0 }]);
    expect(makeCopy('kunden.xlsx', src, 'encode', pairs(e, 'encode')).missed).toEqual([]);
  });

  it('deflateSync-Hilfe: gelesene Einträge liefern exakt die Originaldaten', () => {
    const payload = strToU8('Ä'.repeat(10000));
    const src = zipSync({ 'a.xml': [payload, { level: 9 }] });
    expect(readZip(src)[0].data).toEqual(payload);
    expect(deflateSync(payload).length).toBeLessThan(payload.length);
  });
});
