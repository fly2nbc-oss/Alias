/** Address, location, company, abbreviation, product: port of address.rs, location.rs, company.rs,
 *  abbreviation.rs, product.rs */
import brandsRaw from '../data/brands.txt?raw';
import plzRaw from '../data/plz_prefixes.txt?raw';
import { addHit, ruleBase, type Candidate, type Span } from '../candidate';
import {
  byteLen,
  dataLines,
  escapeRe,
  findIter,
  findIterSkipping,
  getOrInsert,
  groupSpan,
  rx,
  SpanIndex,
  splitWhitespace,
  sticky,
} from '../util';
import {
  ABBREV_REGEX,
  ABBREV_STOPWORDS,
  ACRONYM_SPACE_FIRMA_REGEX,
  COMPANY_LEADING_STOPWORDS,
  COMPANY_REGEX,
  COMPANY_SIGNAL_REGEX,
  HYPHENATED_FIRMA_REGEX,
  QUOTED_REGEX,
  TRADEMARK_REGEX,
} from './patterns';

// ---------------------------------------------------------------- Address

const PLZ_PREFIXES = new Set(dataLines(plzRaw));

// House number with optional letter. The Rust original `\d+\s?[a-zA-Z]?\b` took the following
// space along ("Hauptstraße 5 "), because `\b` then matches before the next word.
// Between street and number, and PLZ and town, only spaces: a tab is a cell border (Excel, CSV),
// so "Total⇥1234" in two cells is no street.
const STREET_REGEX = rx(
  String.raw`(?u)\b[A-ZÄÖÜ][a-zäöüß]+(?:straße|str\.|weg|gasse|platz|allee|ring|damm|ufer|steig|pfad|chaussee|promenade|brücke|berg|tal|feld|hof|markt|graben)[ \u00a0]*\d+(?:[ \u00a0]?[a-zA-Z])?\b`,
);
const STREET_PREFIX_REGEX = rx(
  String.raw`(?u)\b(?:Am|An\sder|An\sdem|Auf\sder|Auf\sdem|Im|In\sder|In\sdem|Zum|Zur|Bei\sder|Bei\sdem)\s+[A-ZÄÖÜ][a-zäöüß]+[ \u00a0]*\d+(?:[ \u00a0]?[a-zA-Z])?\b`,
);
const PLZ_ORT_REGEX = rx(String.raw`(?u)\b(\d{5})[ \u00a0]+([A-ZÄÖÜ][a-zäöüß]+(?:-[a-zäöüß]+)?)\b`);

function validPlz(plz: string): boolean {
  if (!/^[0-9]{5}$/.test(plz) || plz.startsWith('00')) return false;
  return PLZ_PREFIXES.has(plz.slice(0, 2));
}

/** Street in line i + postcode/town in line i+1 → one address block. */
export function detectAddress(text: string): Candidate[] {
  const lines: Span[] = [];
  let o = 0;
  for (const line of text.split('\n')) {
    lines.push([o, o + line.length]);
    o += line.length + 1;
  }
  const streets: Span[][] = lines.map(() => []);
  const plzs: Span[][] = lines.map(() => []);
  lines.forEach(([ls, le], i) => {
    const slice = text.slice(ls, le);
    for (const re of [STREET_REGEX, STREET_PREFIX_REGEX]) {
      for (const m of findIter(re, slice)) streets[i].push([ls + m.index, ls + m.index + m[0].length]);
    }
    for (const m of findIter(PLZ_ORT_REGEX, slice)) {
      if (!validPlz(m[1])) continue;
      plzs[i].push([ls + m.index, ls + m.index + m[0].length]);
    }
  });

  // Address over two lines: the street ends its line and the PLZ starts the next one. Otherwise
  // (e.g. Excel rows with an address in each) the block would run across cells and rows.
  const blocks: Span[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    for (const s of streets[i]) {
      if (!/^[ \u00a0,]*$/.test(text.slice(s[1], lines[i][1]))) continue;
      for (const p of plzs[i + 1]) if (/^[ \u00a0]*$/.test(text.slice(lines[i + 1][0], p[0]))) blocks.push([s[0], p[1]]);
    }
  }
  const blockIndex = new SpanIndex(text.length);
  for (const b of blocks) blockIndex.add(b[0], b[1]);
  const inBlock = (s: Span) => blockIndex.contains(s[0], s[1]);

  const results = new Map<string, Candidate>();
  for (const b of blocks) {
    const slice = text.slice(b[0], b[1]);
    const e = getOrInsert(results, `ADRESSE:${slice}`, () => {
      const c = ruleBase(slice, 'ort', 0.88);
      c.detection_source = 'parser';
      return c;
    });
    addHit(e, b[0], b[1]);
  }
  const addLoose = (spans: Span[][], prefix: string, conf: number) => {
    for (const list of spans) {
      for (const s of list) {
        if (inBlock(s)) continue;
        const slice = text.slice(s[0], s[1]);
        const e = getOrInsert(results, `${prefix}:${slice}`, () => ruleBase(slice, 'ort', conf));
        addHit(e, s[0], s[1]);
      }
    }
  };
  addLoose(streets, 'STRASSE', 0.82);
  addLoose(plzs, 'PLZ', 0.85);
  return [...results.values()];
}

// ---------------------------------------------------------------- Locations (gazetteer)

const LOCATIONS = [
  'Sweden', 'Switzerland', 'Austria', 'Germany', 'France', 'Netherlands', 'Belgium', 'Denmark',
  'Norway', 'Finland', 'Poland', 'Czech Republic', 'United Kingdom', 'United States', 'Canada',
  'Australia', 'Japan', 'China', 'Schweden', 'Schweiz', 'Österreich', 'Deutschland', 'Frankreich',
  'Niederlande', 'Dänemark', 'Norwegen', 'Finnland', 'Gothenburg', 'Göteborg',
  'Malmö', 'Uppsala', 'Zurich', 'Zürich', 'Bern', 'Basel', 'Geneva', 'Genf', 'Antwerp',
  'Antwerpen', 'Ghent', 'Gent', 'Eindhoven', 'Utrecht', 'Rotterdam', 'Gdansk', 'Krakow', 'Kraków',
  'Wroclaw', 'Bratislava', 'Ljubljana', 'Zagreb', 'Tallinn', 'Riga', 'Vilnius', 'Reykjavik',
];

const LOCATION_REGEX = rx(
  `(?i)\\b(?:${[...LOCATIONS].sort((a, b) => byteLen(b) - byteLen(a)).map(escapeRe).join('|')})\\b`,
);

export function detectLocation(text: string): Candidate[] {
  const results = new Map<string, Candidate>();
  for (const m of findIter(LOCATION_REGEX, text)) {
    const e = getOrInsert(results, m[0].toLowerCase(), () => ruleBase(m[0], 'ort', 0.8));
    addHit(e, m.index, m.index + m[0].length);
  }
  return [...results.values()];
}

// ---------------------------------------------------------------- Company

/*
 * COMPANY_REGEX scans the first word `[A-ZÜÄÖ][A-Za-züäöÜÄÖß\-\.]*` from every word start with a
 * capital letter to the end of the run; with "A.A.A.…" / "A-A-A-…" again from every
 * position (O(n²), Rust regex is linear). After a failure at p, `findIterSkipping` skips
 * all further start positions in the same run. Exact, because the first word always
 * reaches the end of the run (it must be followed by `SP`, which is not in the class): if the pattern
 * matches from q in the run, it also matches with the same rest from the earlier start p.
 */
const COMPANY_START = rx(String.raw`\b[A-ZÜÄÖ]`);
const COMPANY_FIRST_WORD = sticky(rx(String.raw`[A-Za-züäöÜÄÖß\-\.]*`));
const LEADING_WORD = /^(\S+)\p{Zs}+/u;

/** Cut off function words at the start ("Die Siemens AG"); returns the new start. */
function stripLeadingStopwords(text: string, start: number, nameEnd: number): number {
  let s = start;
  for (;;) {
    const m = LEADING_WORD.exec(text.slice(s, nameEnd));
    if (!m || !COMPANY_LEADING_STOPWORDS.has(m[1]) || s + m[0].length >= nameEnd) return s;
    s += m[0].length;
  }
}

const LEGAL_FORMS = new Set(['GmbH', 'AG', 'SE', 'KG', 'OHG', 'UG', 'eG', 'mbH', 'GbR', 'e.V.', 'e.K.', 'Ltd.', 'Inc.', 'Corp.', 'LLC']);
const LIST_JOINERS = new Set(['und', '&', 'sowie', 'bzw.', 'oder']);
const WORD_SPAN = /[^\p{Zs}]+/gu;

/**
 * Splits a match at legal forms *inside* the name: the pattern allows up to 8 words
 * with "und"/"&" in between and so merges "Siemens AG und Microsoft Deutschland GmbH" into one company
 * (hidden in the Rust original, because the location pass blocked "Deutschland" before). "GmbH &
 * Co. KG" stays together. Returns the spans of the single companies.
 */
function splitAtInnerLegalForms(text: string, start: number, nameEnd: number, end: number): [number, number][] {
  const words: [number, number][] = [];
  WORD_SPAN.lastIndex = 0;
  for (const w of text.slice(start, nameEnd).matchAll(WORD_SPAN)) words.push([start + w.index, start + w.index + w[0].length]);
  const word = (i: number) => (i < words.length ? text.slice(words[i][0], words[i][1]) : '');
  const out: [number, number][] = [];
  let from = 0;
  for (let i = 1; i < words.length; i++) {
    if (!LEGAL_FORMS.has(word(i)) || LEGAL_FORMS.has(word(i - 1))) continue;
    if (word(i + 1) === '&' || /^Co\.?$/.test(word(i + 1))) continue;
    let next = i + 1;
    while (next < words.length && LIST_JOINERS.has(word(next))) next++;
    if (next >= words.length) break;
    out.push([words[from][0], words[i][1]]);
    from = next;
    i = next;
  }
  out.push([words[from][0], end]);
  return out;
}

/** Company names with legal form (runs before the location gazetteer in the pipeline). */
export function detectCompanyLegal(text: string): Candidate[] {
  const results = new Map<string, Candidate>();
  for (const m of findIterSkipping(COMPANY_REGEX, text, COMPANY_START, COMPANY_FIRST_WORD)) {
    const nameEnd = groupSpan(m, 1)![1];
    for (const [ps, e] of splitAtInnerLegalForms(text, m.index, nameEnd, m.index + m[0].length)) {
      const s = stripLeadingStopwords(text, ps, Math.min(nameEnd, e));
      const t = text.slice(s, e);
      addHit(getOrInsert(results, t, () => ruleBase(t, 'firma', 0.95)), s, e);
    }
  }
  return [...results.values()];
}


/** Company patterns without legal form (run after the location gazetteer). */
export function detectCompanySignals(text: string): Candidate[] {
  const results = new Map<string, Candidate>();
  const add = (s: number, e: number, conf: number) => {
    const t = text.slice(s, e);
    addHit(getOrInsert(results, t, () => ruleBase(t, 'firma', conf)), s, e);
  };
  for (const m of findIter(COMPANY_SIGNAL_REGEX, text)) add(...groupSpan(m, 1)!, 0.82);
  for (const m of findIter(HYPHENATED_FIRMA_REGEX, text)) add(...groupSpan(m, 1)!, 0.88);
  for (const m of findIter(ACRONYM_SPACE_FIRMA_REGEX, text)) {
    const first = splitWhitespace(m[1])[0];
    if (first && ABBREV_STOPWORDS.has(first)) continue;
    add(...groupSpan(m, 1)!, 0.86);
  }
  return [...results.values()];
}

// ---------------------------------------------------------------- Abbreviations

export function detectAbbreviation(text: string): Candidate[] {
  const results = new Map<string, Candidate>();
  for (const m of findIter(ABBREV_REGEX, text)) {
    if (ABBREV_STOPWORDS.has(m[0])) continue;
    const e = getOrInsert(results, m[0], () => ruleBase(m[0], 'sonstiges', 0.65));
    addHit(e, m.index, m.index + m[0].length);
  }
  return [...results.values()];
}

// ---------------------------------------------------------------- Product

const BRANDS = dataLines(brandsRaw);
const BRAND_REGEX = BRANDS.length
  ? rx(`(?i)\\b(?:${BRANDS.map(escapeRe).join('|')})\\b`)
  : null;
// Only a space between name and number: a tab is a cell border ("Total⇥1234" is two cells)
const PRODUCT_CODE_REGEX = rx(String.raw`(?u)\b[A-Z][A-Za-z]*[ \u00a0]?[A-Z]?\d{1,4}[a-zA-Z]?\b`);
const PRODUCT_CODE_EXCLUDE = new Set(['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6']);
// Rust: `\s+[:.]?\s*`; without a colon, two whitespace quantifiers follow each other directly and
// backtrack quadratically in JS; `\s+(?:[:.]\s*)?` describes the same strings, and the
// start of group 1 is uniquely determined in both cases (identical matches).
const PRODUCT_CONTEXT_REGEX = rx(
  String.raw`(?i)\b(?:Modell|Produkt|Typ|Gerät|Marke|Software|Version|Fahrzeug)\s+(?:[:.]\s*)?([A-ZÄÖÜ0-9][^,;.\n]{1,48})`,
);

function plausibleProductCode(m: string): boolean {
  const t = m.trim();
  const len = byteLen(t);
  return len >= 2 && len <= 24 && !PRODUCT_CODE_EXCLUDE.has(t);
}

export function detectProduct(text: string): Candidate[] {
  const results = new Map<string, Candidate>();
  const add = (key: string, conf: number, s: number, e: number, lexicon = false) => {
    const c = getOrInsert(results, key, () => {
      const n = ruleBase(key, 'produkt', conf);
      if (lexicon) n.detection_source = 'lexicon';
      return n;
    });
    addHit(c, s, e);
  };
  if (BRAND_REGEX) {
    for (const m of findIter(BRAND_REGEX, text)) add(m[0], 0.9, m.index, m.index + m[0].length, true);
  }
  for (const m of findIter(PRODUCT_CODE_REGEX, text)) {
    if (plausibleProductCode(m[0])) add(m[0], 0.72, m.index, m.index + m[0].length);
  }
  for (const m of findIter(PRODUCT_CONTEXT_REGEX, text)) {
    const inner = m[1].trim();
    if (byteLen(inner) < 2) continue;
    add(inner, 0.76, m.index, m.index + m[0].length);
  }
  for (const m of findIter(QUOTED_REGEX, text)) {
    const inner = m[1].trim();
    if (inner) add(inner, 0.8, m.index, m.index + m[0].length);
  }
  for (const m of findIter(TRADEMARK_REGEX, text)) {
    const inner = m[1].trim();
    if (inner) add(inner, 0.85, m.index, m.index + m[0].length);
  }
  return [...results.values()];
}
