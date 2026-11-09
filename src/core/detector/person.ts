/** Persons: port of person.rs, person_identity.rs */
import { mergePreferStronger, type Candidate } from '../candidate';
import type { DetectionSource } from '../../types';
import { byteLen, findIter, groupSpan, isWhitespace, splitWhitespace, trimPunct } from '../util';
import {
  isExclusionFirstName,
  looksLikeKnownFirstName,
  PERSON_CONTEXT_REGEX,
  PERSON_GREETING_REGEX,
  PERSON_LIEBE_REGEX,
  PERSON_NON_NAME_TAIL_WORDS,
  PERSON_REGEX,
  PERSON_STOPWORDS,
  PERSON_SUFFIX_STOPWORDS,
  PERSON_TITLE_REGEX,
} from './patterns';

// ---------------------------------------------------------------- Identity

const TITLE_TOKENS = new Set(['herr', 'frau', 'herrn', 'dr', 'prof', 'ing', 'mag', 'mr', 'mrs', 'ms', 'hr', 'fr', 'med']);

function isTitleToken(word: string): boolean {
  const wl = trimPunct(word).toLowerCase();
  return (
    TITLE_TOKENS.has(wl) ||
    wl.startsWith('dr.') ||
    wl.startsWith('prof.') ||
    wl === 'dipl.-ing' ||
    wl.startsWith('dipl.-ing.')
  );
}

/** Remove leading salutations/titles; lowercased, one token per word. */
export function identityKey(full: string): string {
  const tokens = splitWhitespace(full);
  let i = 0;
  while (i < tokens.length && isTitleToken(trimPunct(tokens[i]))) i++;
  return tokens
    .slice(i)
    .map((t) => trimPunct(t).toLowerCase())
    .join(' ');
}

function hasLeadingTitle(full: string): boolean {
  const first = splitWhitespace(full)[0];
  return first !== undefined && isTitleToken(first);
}

/** Longest possible name core without title; on a tie, the variant without salutation. */
export function chooseDisplayText(current: string, incoming: string): string {
  const kc = byteLen(identityKey(current));
  const ki = byteLen(identityKey(incoming));
  if (kc > ki) return current;
  if (ki > kc) return incoming;
  const tc = hasLeadingTitle(current);
  const ti = hasLeadingTitle(incoming);
  if (tc && !ti) return incoming;
  if (!tc && ti) return current;
  return byteLen(incoming) > byteLen(current) ? incoming : current;
}

export function samePerson(a: Candidate, b: Candidate): boolean {
  if (a.category !== 'person' || b.category !== 'person') return false;
  const ka = identityKey(a.text);
  return ka !== '' && ka === identityKey(b.text);
}

// ---------------------------------------------------------------- Detection

const PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'zum', 'zur']);

function firstSubstantiveToken(words: string[]): string | undefined {
  for (const w of words) {
    const t = trimPunct(w);
    if (!PARTICLES.has(t.toLowerCase())) return t;
  }
  return undefined;
}

const hasStopword = (words: string[]) => words.some((w) => PERSON_STOPWORDS.has(w));

/** Remove role/calendar words from the end (cutting down to a first name is allowed). */
function trimTrailingNonPersonWords(words: string[]): string[] {
  const w = [...words];
  while (w.length > 1) {
    const last = trimPunct(w[w.length - 1]);
    if (PERSON_SUFFIX_STOPWORDS.has(last) || PERSON_NON_NAME_TAIL_WORDS.has(last)) w.pop();
    else break;
  }
  return w;
}

/** End (index) in the string after `n` words; whitespace is kept. */
function endAfterNWords(s: string, n: number): number {
  if (n === 0 || s === '') return 0;
  let seen = 0;
  let i = 0;
  const chars = [...s];
  let pos = 0;
  while (i < chars.length) {
    if (isWhitespace(chars[i])) {
      pos += chars[i].length;
      i++;
      continue;
    }
    seen++;
    while (i < chars.length && !isWhitespace(chars[i])) {
      pos += chars[i].length;
      i++;
    }
    if (seen === n) return pos;
  }
  return s.length;
}

function insertName(
  results: Map<string, Candidate>,
  text: string,
  start: number,
  end: number,
  confidence: number,
  source: DetectionSource,
): void {
  const matched = text.slice(start, end);
  const words = splitWhitespace(matched);
  if (hasStopword(words) || words.length === 0) return;
  const key = identityKey(matched);
  if (!key) return;
  const e = results.get(key);
  if (!e) {
    results.set(key, {
      text: matched,
      category: 'person',
      confidence,
      occurrences: 1,
      offsets: [[start, end]],
      detection_source: source,
      needs_review: false,
      features: {},
    });
    return;
  }
  e.occurrences += 1;
  e.offsets.push([start, end]);
  e.text = chooseDisplayText(e.text, matched);
  if (confidence > e.confidence) e.confidence = confidence;
  e.detection_source = mergePreferStronger(e.detection_source, source);
}

export function detectPerson(text: string): Candidate[] {
  const results = new Map<string, Candidate>();
  const layers: [RegExp, number][] = [
    [PERSON_TITLE_REGEX, 0.9],
    [PERSON_CONTEXT_REGEX, 0.84],
    [PERSON_GREETING_REGEX, 0.82],
    [PERSON_LIEBE_REGEX, 0.83],
  ];
  for (const [re, conf] of layers) {
    for (const m of findIter(re, text)) {
      const [s, e] = groupSpan(m, 1)!;
      insertName(results, text, s, e, conf, 'rule');
    }
  }
  // Layer C: gazetteer + last name
  for (const m of findIter(PERSON_REGEX, text)) {
    const full = m[0];
    let words = splitWhitespace(full);
    if (hasStopword(words) || words.length < 2) continue;
    const token = firstSubstantiveToken(words);
    if (!token || !looksLikeKnownFirstName(token) || isExclusionFirstName(token)) continue;
    words = trimTrailingNonPersonWords(words);
    if (words.length === 0) continue;
    const conf = words.length >= 2 ? 0.78 : 0.72;
    const start = m.index;
    insertName(results, text, start, start + endAfterNWords(full, words.length), conf, 'lexicon');
  }
  return [...results.values()];
}
