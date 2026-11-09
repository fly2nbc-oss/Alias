/** Email, IBAN, amount of money, date, phone: port of email.rs, iban.rs, money.rs, date.rs, phone.rs */
import { addHit, ruleBase, type Candidate } from '../candidate';
import { findIter, getOrInsert, rx, SpanIndex, sticky, utf8LookbackStart } from '../util';

// ---------------------------------------------------------------- Email

/** Rust pattern (reference):`(?i)\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b` */
export const EMAIL_PATTERN = String.raw`(?i)\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b`;
const EMAIL_LOCAL_CHAR = rx(String.raw`(?i)[A-Za-z0-9._%+-]`);
const EMAIL_DOMAIN = sticky(rx(String.raw`(?i)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b`));
const BOUNDARY_AT = sticky(rx(String.raw`\b`));

/**
 * Matches of `EMAIL_PATTERN`, but linear. The regex would scan from every word boundary in a long
 * run like "a.a.a.…" to its end (O(n²)). Equivalent: every match ends its
 * local part directly before an "@" (which is not in the local-part class); the local part starts
 * at the first word boundary in the run before this "@" (from the search position), because all
 * starts in the same run lead to the same rest. So: find "@", walk the run backwards, first word
 * boundary, check the domain.
 */
function findEmails(text: string): [number, number][] {
  const out: [number, number][] = [];
  let pos = 0;
  for (;;) {
    const at = text.indexOf('@', pos);
    if (at < 0) break;
    let r = at;
    while (r > pos) {
      EMAIL_LOCAL_CHAR.lastIndex = 0;
      if (!EMAIL_LOCAL_CHAR.test(text[r - 1])) break;
      r--;
    }
    let start = -1;
    for (let p = r; p < at; p++) {
      BOUNDARY_AT.lastIndex = p;
      if (BOUNDARY_AT.test(text)) {
        start = p;
        break;
      }
    }
    if (start >= 0) {
      EMAIL_DOMAIN.lastIndex = at + 1;
      const d = EMAIL_DOMAIN.exec(text);
      if (d) {
        const end = at + 1 + d[0].length;
        out.push([start, end]);
        pos = end;
        continue;
      }
    }
    pos = at + 1;
  }
  return out;
}

export function detectEmail(text: string): Candidate[] {
  const results = new Map<string, Candidate>();
  for (const [s, e] of findEmails(text)) {
    const t = text.slice(s, e);
    addHit(getOrInsert(results, t, () => ruleBase(t, 'email', 0.98)), s, e);
  }
  return [...results.values()];
}

// ---------------------------------------------------------------- IBAN

/** `[ \t]?` instead of `\s?`: does not run across line breaks. */
const IBAN_REGEX = rx(String.raw`(?i)\b[A-Z]{2}\d{2}(?:[ \t]?[A-Z0-9]){11,30}\b`);

/** Modulo-97 check (ISO 13616); spaces allowed. */
export function ibanChecksumValid(iban: string): boolean {
  const compact = iban.replace(/[^A-Za-z0-9]/g, '');
  if (compact.length < 15 || compact.length > 34) return false;
  const upper = compact.toUpperCase();
  if (!/^[A-Z]{2}/.test(upper)) return false;
  const rearranged = upper.slice(4) + upper.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    if (ch >= '0' && ch <= '9') rem = (rem * 10 + (ch.charCodeAt(0) - 48)) % 97;
    else if (ch >= 'A' && ch <= 'Z') rem = (rem * 100 + (ch.charCodeAt(0) - 65 + 10)) % 97;
    else return false;
  }
  return rem === 1;
}

export function detectIban(text: string): Candidate[] {
  const results = new Map<string, Candidate>();
  for (const m of findIter(IBAN_REGEX, text)) {
    const raw = m[0];
    const compactLen = raw.replace(/[^A-Za-z0-9]/g, '').length;
    if (compactLen < 15 || compactLen > 34) continue;
    if (!ibanChecksumValid(raw)) continue;
    const e = getOrInsert(results, raw, () => ruleBase(raw, 'iban', 0.97));
    addHit(e, m.index, m.index + raw.length);
  }
  return [...results.values()];
}

// ---------------------------------------------------------------- Amount of money

const NUM = String.raw`\d[\d.,]*`;
/**
 * NUM as the *start* of a match: only at the first digit of a `[\d.,]` run. Without this anchor
 * the regex scans from every digit to the end of the run (CSV/JSON number rows: O(n²); Rust regex
 * is linear). Exact: NUM reaches from every digit to the end of the run (then whitespace or a
 * currency sign must follow), so a match from a later digit would have the same rest as from
 * the first; the previous match never ends in the middle of the run. `(?=\d)` first, so that the
 * lookbehind runs only at digits.
 */
const NUM_START = String.raw`(?=\d)(?<!\d[.,]*)${NUM}`;
const MONEY_REGEXES = [
  rx(String.raw`[$€£¥]\s?${NUM}`),
  rx(String.raw`${NUM_START}\s?[$€£¥]`),
  rx(
    String.raw`(?i)${NUM_START}\s+(?:Euro|EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|CZK|HUF|Franken?|Pfund|Dollar|Pounds?)\b`,
  ),
  rx(String.raw`(?i)\b(?:EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|CZK|HUF)\s+${NUM}\b`),
];

export function detectMoney(text: string): Candidate[] {
  const results = new Map<string, Candidate>();
  for (const re of MONEY_REGEXES) {
    for (const m of findIter(re, text)) {
      const raw = m[0].trim();
      if (!/[0-9]/.test(raw)) continue;
      const e = getOrInsert(results, raw, () => ruleBase(raw, 'betrag', 0.92));
      addHit(e, m.index, m.index + m[0].length);
    }
  }
  return [...results.values()];
}

// ---------------------------------------------------------------- Date

const RE_DMY_DOT = rx(String.raw`\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b`);
const RE_DMY_MONTH = rx(
  String.raw`(?i)\b(\d{1,2})\.\s?(January|February|March|April|May|June|July|August|September|October|November|December|Januar|Februar|März|Mai|Juni|Juli|Oktober|Dezember)\s*(\d{2,4})\b`,
);
const RE_MONTH_YEAR = rx(
  String.raw`(?i)\b(January|February|March|April|May|June|July|August|September|October|November|December|Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+(\d{4})\b`,
);
const RE_ISO = rx(String.raw`\b(\d{4})-(\d{2})-(\d{2})\b`);
const RE_DMY_SLASH = rx(String.raw`\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b`);

function expandYear(y: number): number | null {
  if (y <= 30) return 2000 + y;
  if (y <= 99) return 1900 + y;
  if (y >= 1900 && y <= 2030) return y;
  return null;
}

function yearOf(raw: string): number | null {
  const y = parseInt(raw, 10) || 0;
  return raw.length === 2 ? expandYear(y) : y;
}

function daysInMonth(month: number, year: number): number {
  if ([1, 3, 5, 7, 8, 10, 12].includes(month)) return 31;
  if ([4, 6, 9, 11].includes(month)) return 30;
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return 0;
}

function validYmd(day: number, month: number, year: number): boolean {
  if (year < 1900 || year > 2030 || month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(month, year);
}

const MONTHS: Record<string, number> = {
  januar: 1, january: 1, februar: 2, february: 2, 'märz': 3, maerz: 3, march: 3, april: 4,
  mai: 5, may: 5, juni: 6, june: 6, juli: 7, july: 7, august: 8, september: 9,
  oktober: 10, october: 10, november: 11, dezember: 12, december: 12,
};

/** Lookback for the date-of-birth context (UTF-16 characters). */
const BIRTH_LOOKBACK = 200;

/**
 * Keywords in the last (at most 8) words before the date. Differs from the Rust original:
 * only the last 200 characters are split (Rust split the whole text before it for every date
 * match → O(n²) with many dates). Differs only if the 8 words together are longer.
 */
function isBirthContext(text: string, start: number): boolean {
  const words = text.slice(Math.max(0, start - BIRTH_LOOKBACK), start).split(/\p{White_Space}+/u).filter(Boolean);
  const lower = words.slice(Math.max(0, words.length - 8)).join(' ').toLowerCase();
  return (
    lower.includes('geboren am') ||
    lower.includes('geboren ') ||
    lower.includes('geb.') ||
    lower.includes('geburtsdatum') ||
    lower.includes('geburtstag') ||
    lower.includes('date of birth') ||
    lower.includes(' dob') ||
    lower.includes('dob ') ||
    lower.startsWith('dob')
  );
}

export function detectDate(text: string): Candidate[] {
  const raw: Span[] = [];
  for (const m of findIter(RE_DMY_DOT, text)) {
    const y = yearOf(m[3]);
    if (y !== null && validYmd(+m[1], +m[2], y)) raw.push([m.index, m.index + m[0].length]);
  }
  for (const m of findIter(RE_DMY_MONTH, text)) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (!mo) continue;
    const y = yearOf(m[3]);
    if (y !== null && validYmd(+m[1], mo, y)) raw.push([m.index, m.index + m[0].length]);
  }
  for (const m of findIter(RE_MONTH_YEAR, text)) {
    const y = parseInt(m[2], 10);
    if (y >= 1900 && y <= 2030) raw.push([m.index, m.index + m[0].length]);
  }
  for (const m of findIter(RE_ISO, text)) {
    if (validYmd(+m[3], +m[2], +m[1])) raw.push([m.index, m.index + m[0].length]);
  }
  for (const m of findIter(RE_DMY_SLASH, text)) {
    const y = yearOf(m[3]);
    if (y !== null && validYmd(+m[1], +m[2], y)) raw.push([m.index, m.index + m[0].length]);
  }

  // Overlaps: longer spans first
  raw.sort((a, b) => b[1] - b[0] - (a[1] - a[0]) || a[0] - b[0]);
  const kept: Span[] = [];
  const keptIndex = new SpanIndex(text.length);
  for (const s of raw) {
    if (keptIndex.overlaps(s[0], s[1])) continue;
    keptIndex.add(s[0], s[1]);
    kept.push(s);
  }
  kept.sort((a, b) => a[0] - b[0]);

  const results = new Map<string, Candidate>();
  for (const [s, e] of kept) {
    const slice = text.slice(s, e);
    const birth = isBirthContext(text, s);
    const entry = getOrInsert(results, slice, () => {
      const c = ruleBase(slice, 'datum', birth ? 0.93 : 0.91);
      c.features.date_kind = birth ? 'geburtsdatum' : 'datum';
      return c;
    });
    addHit(entry, s, e);
    if (birth) {
      entry.confidence = Math.max(entry.confidence, 0.93);
      entry.features.date_kind = 'geburtsdatum';
    }
  }
  return [...results.values()];
}

type Span = [number, number];

// ---------------------------------------------------------------- Phone

// Separators only horizontal spaces (`\p{Zs}`) instead of `\s` as in the Rust original: otherwise a
// number is extended across line or cell boundaries ("+49 30 700 118 0⏎2" in Word tables).
const PHONE_MAIN = rx(
  String.raw`(?:\+\d{1,3}[\p{Zs}./-]?|\b\d{1,3}[\p{Zs}./-]?)(?:\(\d{2,5}\)|\d{2,5})(?:[\p{Zs}./-]\d+)+\b`,
);
const PHONE_COMPACT_DE = rx(String.raw`(?i)\b0\d{9,14}\b`);
const DATE_LIKE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/;

function plausiblePhone(raw: string): boolean {
  if (DATE_LIKE.test(raw.trim())) return false;
  const compact = raw.replace(/[^0-9]/g, '');
  const d = compact.length;
  if (d < 6 || d > 15) return false;
  const onlyDigits = /^[0-9\s]*$/u.test(raw);
  if (onlyDigits && compact.length < 10) {
    return ['015', '016', '017', '0157', '0137'].some((p) => compact.startsWith(p));
  }
  return true;
}

const PHONE_KEYS = ['tel.', 'telefon', ' fon', 'mobil', 'handy', 'fax', 'rufnummer', 'erreichbar unter', ' ruf ', 'tel '];

/** Keywords in the 100 UTF-8 bytes before the number (as in Rust, incl. `floor_char_boundary`). */
function phoneConfidence(text: string, start: number): number {
  const prefix = text.slice(utf8LookbackStart(text, start, 100), start).toLowerCase();
  return PHONE_KEYS.some((k) => prefix.includes(k)) ? 0.92 : 0.84;
}

export function detectPhone(text: string): Candidate[] {
  const results = new Map<string, Candidate>();
  for (const re of [PHONE_MAIN, PHONE_COMPACT_DE]) {
    for (const m of findIter(re, text)) {
      const raw = m[0];
      if (!plausiblePhone(raw)) continue;
      const conf = phoneConfidence(text, m.index);
      const e = getOrInsert(results, raw, () => ruleBase(raw, 'telefon', conf));
      addHit(e, m.index, m.index + raw.length);
      if (conf > e.confidence) e.confidence = conf;
    }
  }
  const out = [...results.values()];
  for (const e of out) {
    e.offsets.sort((a, b) => a[0] - b[0]);
    e.offsets = e.offsets.filter((o, i, arr) => i === 0 || o[0] !== arr[i - 1][0] || o[1] !== arr[i - 1][1]);
    e.occurrences = e.offsets.length;
  }
  return out;
}
