/** Port of the Rust tests from detector/mod.rs and detector/eval.rs, plus Unicode regressions. */
import { describe, expect, it } from 'vitest';
import type { Category } from '../../types';
import { AliasStore } from '../store';
import { substitute } from '../substitute';
import { rx, utf8LookbackStart } from '../util';
import { detectAll, detectPerson, resolveSpanConflicts } from './index';
import { detectPhone } from './simple';

const has = (text: string, needle: string, cat: Category) => {
  const c = detectAll(text);
  expect(
    c.some((x) => x.text === needle && x.category === cat),
    `expected ${cat} "${needle}", got ${JSON.stringify(c.map((x) => [x.text, x.category]))}`,
  ).toBe(true);
};

describe('person (rules)', () => {
  it('detects person with title signal', () => {
    const c = detectPerson('Besprechung mit Dr. Schmidt und Frau Müller.');
    expect(c.find((x) => x.text === 'Schmidt')?.category).toBe('person');
    expect(c.find((x) => x.text === 'Müller')).toBeDefined();
  });

  it('detects person via gazetteer first name', () => {
    const c = detectPerson('Anna Weber hat zugesagt.');
    expect(c.find((x) => x.text === 'Anna Weber')?.category).toBe('person');
  });

  it('no person for two common words without gazetteer or title', () => {
    expect(detectPerson('Neue Technologie wurde freigegeben.')).toEqual([]);
  });

  it('layer C: Dietmar Unterstützung keeps first name only', () => {
    const p = detectPerson('Bitte wenden Sie sich an Dietmar Unterstützung.').find((x) => x.text.includes('Dietmar'));
    expect(p?.text).toBe('Dietmar');
  });

  it('layer C: Christian Adolph Director trims role', () => {
    const p = detectPerson('Christian Adolph Director wird benachrichtigt.').find((x) => x.text.includes('Christian'));
    expect(p?.text).toBe('Christian Adolph');
  });

  it('layer C: Thomas Project Lead trims suffix chain', () => {
    const p = detectPerson('Kontakt: Thomas Project Lead.').find((x) => x.text.includes('Thomas'));
    expect(p?.text).toBe('Thomas');
  });
});

describe('detectAll', () => {
  it('firma via signal word', () => has('Vertrag mit Partner Acme besprochen.', 'Acme', 'firma'));
  it('TÜV-Rheinl.', () => has('Text mit TÜV-Rheinl. Zertifikat', 'TÜV-Rheinl.', 'firma'));
  it('KMD Consulting', () => has('Auftrag mit KMD Consulting besprochen.', 'KMD Consulting', 'firma'));

  it('email and iban', () => {
    const text = 'Kontakt: mail@beispiel.de IBAN DE89370400440532013000';
    has(text, 'mail@beispiel.de', 'email');
    expect(detectAll(text).some((c) => c.category === 'iban')).toBe(true);
  });

  it('layer C trims calendar suffixes to one entry', () => {
    const persons = detectAll('Martin Gieswein Onboarding Day und Martin Gieswein Direct.').filter((x) => x.category === 'person');
    expect(persons).toHaveLength(1);
    expect(persons[0].text).toBe('Martin Gieswein');
    expect(persons[0].occurrences).toBeGreaterThanOrEqual(2);
  });

  it('merges Herr and plain same identity', () => {
    const persons = detectAll('Herr Martin Gieswein traf Martin Gieswein wieder.').filter((x) => x.category === 'person');
    expect(persons).toHaveLength(1);
    expect(persons[0].text).toBe('Martin Gieswein');
  });

  it('does not merge different people', () => {
    expect(detectAll('Martin Gieswein und Anna Weber treffen sich.').filter((x) => x.category === 'person')).toHaveLength(2);
  });

  it('no crash with multibyte text before phone number', () => {
    expect(() => detectAll('ü'.repeat(25) + 'x'.repeat(98) + ' 0170123456789')).not.toThrow();
  });

  it('gold: geburtsdatum feature', () => {
    const d = detectAll('Kunde geboren am 15. März 1980 in Berlin').find((x) => x.text.includes('März') && x.category === 'datum');
    expect(d?.features?.date_kind).toBe('geburtsdatum');
  });

  it('gold: person title', () => has('Treffen mit Dr. Weber', 'Weber', 'person'));
  it('gold: no false person', () => {
    expect(detectAll('Neue Technologie wurde freigegeben.').some((x) => x.category === 'person')).toBe(false);
  });
  it('gold: pipeline without NER', () => has('Besuch bei Anna Meyer', 'Anna Meyer', 'person'));
});

describe('surnames standing alone', () => {
  it('get their own entry and are replaced on encode', () => {
    const text = 'Laura Hoffmann hat zugesagt. Später rief Frau Hoffmann an, Herrn Brenner und Thomas Brenner ebenso.';
    const persons = detectAll(text).filter((c) => c.category === 'person');
    const names = persons.map((p) => p.text).sort();
    expect(names).toEqual(['Brenner', 'Hoffmann', 'Laura Hoffmann', 'Thomas Brenner']);
    const store = new AliasStore();
    store.addBulk(persons.map((p) => ({ original: p.text, category: p.category })));
    const enc = substitute(text, store.entries.values(), 'encode').text;
    expect(enc).not.toMatch(/Hoffmann|Brenner/);
    expect(substitute(enc, store.entries.values(), 'decode').text).toBe(text);
  });

  it('title and plain form of the same full name are still merged', () => {
    const persons = detectAll('Herr Martin Gieswein traf Martin Gieswein.').filter((c) => c.category === 'person');
    expect(persons.map((p) => p.text)).toEqual(['Martin Gieswein']);
  });
});

describe('phone numbers', () => {
  it('do not run across line or cell breaks', () => {
    const tel = (t: string) => detectAll(t).filter((c) => c.category === 'telefon').map((c) => c.text);
    expect(tel('Tel. +49 30 700 118 0\n2 Exemplare')).toEqual(['+49 30 700 118 0']);
    expect(tel('Tel.\t+49 30 700118-0\t12')).toEqual(['+49 30 700118-0']);
    expect(tel('Mobil: 0170 123 45 67')).toEqual(['0170 123 45 67']);
  });
});

describe('tabular text (Excel/CSV)', () => {
  it('names and companies do not span cells or rows', () => {
    const text = '=== Sheet: Kunden ===\nName\tFirma\tBetrag\nAnna Weber\tAcme GmbH\t1234\nMax Mustermann\tSiemens AG\t99.5\n';
    has(text, 'Acme GmbH', 'firma');
    has(text, 'Siemens AG', 'firma');
    has(text, 'Anna Weber', 'person');
    for (const c of detectAll(text)) expect(c.text, c.text).not.toMatch(/[\t\n]/);
  });

  it('an address in each row is found; a word ending in -tal next to a number cell is no street', () => {
    const text =
      'Name\tAddress\nLaura Hoffmann\tHauptstraße 5, 68159 Mannheim\tCall her.\n' +
      'Thomas Brenner\tRingstraße 12, 10115 Berlin\tCall him.\nTotal\t1234\n';
    for (const a of ['Hauptstraße 5', '68159 Mannheim', 'Ringstraße 12', '10115 Berlin']) has(text, a, 'ort');
    for (const c of detectAll(text)) expect(c.text, c.text).not.toMatch(/[\t\n]|Total/);
    // A real two-line address stays one block
    has('Laura Hoffmann\nHauptstraße 5\n68159 Mannheim\n', 'Hauptstraße 5\n68159 Mannheim', 'ort');
  });
});

describe('Unicode word boundaries (JS \\b is ASCII-only)', () => {
  it('name ending in umlaut/ß is matched fully', () => {
    has('Gespräch mit Herr Strauß heute.', 'Strauß', 'person');
    has('Termin mit Frau Jäger.', 'Jäger', 'person');
  });

  it('street names with ß and umlauts', () => {
    has('Wir wohnen in der Hauptstraße 5 seit Jahren.', 'Hauptstraße 5', 'ort');
  });

  it('no match inside a word that continues with umlaut', () => {
    // "Zürichsee" must not be found as "Zürich"
    expect(detectAll('Am Zürichsee').some((x) => x.text === 'Zürich')).toBe(false);
  });

  it('offsets point into the original string', () => {
    const text = 'Grüße an Frau Müller, Tel. 0170 1234567';
    for (const c of detectAll(text)) {
      for (const [s, e] of c.offsets) expect(text.slice(s, e).length).toBe(e - s);
    }
    const tel = detectAll(text).find((c) => c.category === 'telefon')!;
    expect(text.slice(...tel.offsets[0])).toBe('0170 1234567');
  });
});

describe('Anrede/Signalwort und Name über Zeilenumbruch (DIN-5008-Anschrift)', () => {
  it('Frau + Zeilenumbruch + Name', () => {
    has('Frau\nKsenia Nowak\nbitte melden', 'Ksenia Nowak', 'person');
    has('Herrn\r\nMax Mustermann\r\nMusterweg 1', 'Max Mustermann', 'person');
  });
  it('Titelkette: Herrn Dr. … und Frau Prof. Dr. …', () => {
    has('Herrn\nDr. Jan Kowalski\nper Mail', 'Jan Kowalski', 'person');
    has('Frau Prof. Dr. Weber kommt.', 'Weber', 'person');
  });
  it('Firma + Zeilenumbruch + Name', () => has('Firma\nNordwind Technik\nHauptstraße 5', 'Nordwind Technik', 'firma'));
  it('Tab zwischen Anrede und Name verbindet nicht (Tabellenzellen)', () => {
    expect(detectPerson('Anrede\tName\nHerr\tMüller\n').some((c) => c.text.includes('Müller'))).toBe(false);
  });
  it('innerhalb des Namens kein Zeilenumbruch', () => {
    expect(detectPerson('Frau Ksenia\nNowak').map((c) => c.text)).toEqual(['Ksenia']);
  });
});

describe('Wortzwischenraum innerhalb von Namen (nur horizontale Leerzeichen)', () => {
  it('NBSP/U+202F verbinden, \\v/\\f/U+2028/U+2029/U+0085 nicht', () => {
    for (const sep of [' ', ' ']) {
      expect(detectPerson(`mit Anna${sep}Weber gesprochen`).map((c) => c.text), JSON.stringify(sep)).toEqual([`Anna${sep}Weber`]);
    }
    for (const sep of ['\v', '\f', ' ', ' ', '\u0085']) {
      expect(detectPerson(`mit Anna${sep}Weber gesprochen`).some((c) => c.text.includes('Weber')), JSON.stringify(sep)).toBe(false);
    }
  });
});

describe('Firmennamen', () => {
  it('führender Artikel gehört nicht zum Namen', () => {
    has('Die Siemens AG liefert.', 'Siemens AG', 'firma');
    has('Mit der Acme GmbH sprechen.', 'Acme GmbH', 'firma');
  });
  it('vollständiger Name mit Rechtsform schlägt Orts-Gazetteer und Marke', () => {
    const c = detectAll('Vertrag mit Microsoft Deutschland GmbH unterzeichnet.');
    expect(c.map((x) => `${x.category}:${x.text}`)).toEqual(['firma:Microsoft Deutschland GmbH']);
  });
  it('Aufzählung mehrerer Firmen wird getrennt, GmbH & Co. KG bleibt zusammen', () => {
    const t = 'Die Siemens AG und Microsoft Deutschland GmbH sowie Müller GmbH & Co. KG.';
    const firms = detectAll(t).filter((c) => c.category === 'firma').map((c) => c.text).sort();
    expect(firms).toEqual(['Microsoft Deutschland GmbH', 'Müller GmbH & Co. KG', 'Siemens AG']);
  });
  it('LLC als Rechtsform', () => has('Vertrag mit Acme LLC.', 'Acme LLC', 'firma'));
});

describe('Feldbezeichner sind keine Abkürzungs-Kandidaten', () => {
  it('IBAN, BIC, LLC, USt-IdNr., Tel., E-Mail, CEO', () => {
    const t = 'IBAN: DE89370400440532013000\nBIC: COBADEFFXXX\nUSt-IdNr.: DE123456789\nTel.: 089 1234567\nE-Mail: info@acme.de\nCEO, CFO, PLZ, FAX, LLC';
    const c = detectAll(t);
    for (const label of ['IBAN', 'BIC', 'LLC', 'USt', 'IdNr', 'Tel', 'E-Mail', 'CEO', 'CFO', 'PLZ', 'FAX']) {
      expect(c.some((x) => x.text === label || x.text.startsWith(label + '-')), label).toBe(false);
    }
    expect(c.find((x) => x.category === 'iban')?.text).toBe('DE89370400440532013000');
  });
  it('echte Kürzel werden weiter vorgeschlagen', () => has('Projekt mit KMD abgestimmt.', 'KMD', 'sonstiges'));
});

describe('Rust-Parität', () => {
  it('Konfliktauflösung vergleicht Längen in UTF-8-Bytes', () => {
    const text = 'ÖÖÖÖxx';
    const base = { occurrences: 1, detection_source: 'rule' as const, needs_review: false, features: {} };
    const out = resolveSpanConflicts(
      [
        { ...base, text: 'ÖÖÖÖ', category: 'ort', confidence: 0.8, offsets: [[0, 4]] },
        { ...base, text: 'ÖÖxx', category: 'produkt', confidence: 0.9, offsets: [[2, 6]] },
      ],
      text,
    );
    // 8 bytes vs. 6 bytes; by UTF-16 length (4 = 4) the higher confidence would have won
    expect(out.map((c) => c.text)).toEqual(['ÖÖÖÖ']);
  });

  it('Telefon-Kontext: 100 Bytes Rückblick, nicht 100 Zeichen', () => {
    const near = detectPhone('Tel. ' + 'x'.repeat(60) + ' 0170 1234567')[0];
    const far = detectPhone('Tel. ' + 'ü'.repeat(60) + ' 0170 1234567')[0];
    expect(near.confidence).toBe(0.92);
    expect(far.confidence).toBe(0.84); // 66 characters, but 126 bytes back
  });

  it('utf8LookbackStart entspricht floor_char_boundary', () => {
    expect(utf8LookbackStart('üüüx', 4, 3)).toBe(2);
    expect(utf8LookbackStart('üüüx', 4, 2)).toBe(2);
    expect(utf8LookbackStart('a😀b', 4, 2)).toBe(1);
    expect(utf8LookbackStart('abc', 3, 100)).toBe(0);
  });
});

describe('rx(): Übersetzung Rust → JS', () => {
  it('\\w/\\b wie Rust (Alphabetic + Join_Control), \\s = White_Space, . ohne \\n', () => {
    expect(rx(String.raw`^\w$`).test('Ⅻ')).toBe(true); // Ⅻ: Nl/Alphabetic, not \p{L}
    expect(rx(String.raw`^\w$`).test('‍')).toBe(true); // Join_Control
    expect(rx(String.raw`^\s$`).test('\u0085')).toBe(true);
    expect(rx(String.raw`^\s$`).test('﻿')).toBe(false);
    expect(rx('^a.b$').test('a\rb')).toBe(true);
    expect(rx('^a.b$').test('a\nb')).toBe(false);
    expect(rx(String.raw`^\d$`).test('１')).toBe(false); // ASCII on purpose
  });
  it('lehnt nicht unterstützte Konstrukte ab', () => {
    const bad = [
      String.raw`\B`, String.raw`\W`, String.raw`\D`, 'a(?i)b', 'a(?i:b)', '(?m)^a', '(?P<x>a)',
      String.raw`\x{41}`, String.raw`(a)\1`, '[a&&b]', '[[a]]', String.raw`[\b]`, String.raw`\pL`, '[]a]',
    ];
    for (const p of bad) expect(() => rx(p), p).toThrow(/rx:/);
    expect(() => rx(String.raw`(?i)(?:a|b)(?=c)(?<!d)[\w\-.]\p{Lu}\.`)).not.toThrow();
  });
});
