/** Substitution: port of substitutor/{encoder,decoder,spans}.rs */
import type { AliasEntry, SubstitutionResult } from '../types';
import { byteLen, escapeRe } from './util';

export type Mode = 'encode' | 'decode';
/** Match: start, end, replacement text */
export type Match = [number, number, string];
export type Pair = [string, string];

/** Replacement pairs (from → to), longest first. */
export function pairs(entries: Iterable<AliasEntry>, mode: Mode): Pair[] {
  const out: Pair[] = [];
  for (const e of entries) {
    if (!e.confirmed || !e.original || !e.alias) continue;
    out.push(mode === 'encode' ? [e.original, e.alias] : [e.alias, e.original]);
  }
  out.sort((a, b) => byteLen(b[0]) - byteLen(a[0]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return out;
}

/** Letter, digit or combining mark: must not directly touch a match */
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
const WORD_START = /^[\p{L}\p{N}]/u;
const WORD_END = /[\p{L}\p{N}]$/u;

/** Search terms that differ only in case share one search. */
interface Group {
  re: RegExp;
  /** Term starts/ends with a letter or digit → check the word boundary there */
  checkStart: boolean;
  checkEnd: boolean;
  /** exact spelling → replacement; `fallback` for all other spellings (first entry) */
  exact: Map<string, string>;
  fallback: string;
  /** Groups whose term is a proper prefix of this term (for the prefilter) */
  prefixes: number[];
  /** Spelling cannot be folded safely → always check */
  always: boolean;
}

interface Compiled {
  groups: Group[];
  /** All terms as one alternation (prefilter); `null` if too large for the RegExp engine */
  any: RegExp | null;
  /** folded term → group index */
  byKey: Map<string, number>;
}

const FOLD_EXTRA: Record<string, string> = { ſ: 's', ς: 'σ', ϐ: 'β', ϑ: 'θ', ϕ: 'φ', ϖ: 'π', ϰ: 'κ', ϱ: 'ρ', ϵ: 'ε', ẛ: 'ṡ', 'ι': 'ι' };
/** Approximation of the simple Unicode case folding used by RegExp `iu` (only for grouping/prefilter) */
const fold = (s: string) => s.toLowerCase().replace(/[ſςϐϑϕϖϰϱϵẛι]/gu, (c) => FOLD_EXTRA[c]);

const compiled = new WeakMap<readonly Pair[], Compiled>();

function compile(ps: readonly Pair[]): Compiled {
  const cached = compiled.get(ps);
  if (cached) return cached;
  const groups: Group[] = [];
  const terms: string[] = [];
  const byKey = new Map<string, number>();
  for (const [from, to] of ps) {
    if (!from) continue;
    const key = fold(from);
    const gi = byKey.get(key);
    if (gi !== undefined) {
      if (!groups[gi].exact.has(from)) groups[gi].exact.set(from, to);
      continue;
    }
    byKey.set(key, groups.length);
    terms.push(from);
    groups.push({
      re: new RegExp(escapeRe(from), 'giu'),
      checkStart: WORD_START.test(from),
      checkEnd: WORD_END.test(from),
      exact: new Map([[from, to]]),
      fallback: to,
      prefixes: [],
      always: key.length !== from.length,
    });
  }
  // Prefixes via the folded keys (linear in the total length)
  for (const [key, gi] of byKey) {
    for (let l = 1; l < key.length; l++) {
      const pj = byKey.get(key.slice(0, l));
      if (pj !== undefined) groups[gi].prefixes.push(pj);
    }
  }
  let any: RegExp | null = null;
  try {
    // Longest first, regardless of the order in `ps`: so the alternation reports the longest
    // matching term at each position; all shorter ones there are its prefixes
    const alt = [...terms].sort((a, b) => b.length - a.length).map(escapeRe);
    any = groups.length > 1 ? new RegExp(alt.join('|'), 'giu') : null;
  } catch {
    any = null; // too many/long terms for one RegExp → no prefilter
  }
  const c: Compiled = { groups, any, byKey };
  compiled.set(ps, c);
  return c;
}

/**
 * Which groups can occur in the text? At each position the alternation reports only the
 * first (longest) matching term; shorter terms at the same place are its prefixes
 * and are added via `prefixes`. Unknown match text → all groups, to be safe.
 */
function candidates(text: string, c: Compiled): Iterable<number> | null {
  if (!c.any) return null;
  const re = c.any;
  re.lastIndex = 0;
  const set = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const gi = c.byKey.get(fold(m[0]));
    if (gi === undefined) return null;
    if (!set.has(gi)) {
      set.add(gi);
      for (const pj of c.groups[gi].prefixes) set.add(pj);
    }
    re.lastIndex = nextPos(text, m.index);
  }
  if (set.size === 0 && !c.groups.some((g) => g.always)) return [];
  c.groups.forEach((g, i) => g.always && set.add(i));
  // Keep the group order (longest first)
  return [...set].sort((a, b) => a - b);
}

/**
 * Next search position after `i`. With flag `u`, a `lastIndex` in the middle of a surrogate pair
 * falls back to its start; `i + 1` would find the same place forever for terms that start
 * with an emoji or similar.
 */
const nextPos = (text: string, i: number) => i + (text.codePointAt(i)! > 0xffff ? 2 : 1);

/** Character (code point) directly before `i` or at `i` */
function charBefore(text: string, i: number): string {
  if (i <= 0) return '';
  const lo = text.charCodeAt(i - 1);
  return lo >= 0xdc00 && lo <= 0xdfff && i >= 2 ? text.slice(i - 2, i) : text[i - 1];
}
const charAt = (text: string, i: number): string => (i < text.length ? String.fromCodePoint(text.codePointAt(i)!) : '');

/**
 * Matches of the search terms in `text`: sorted, not overlapping; longer terms (order
 * of `ps`, see `pairs`) win. Shared search for encode, decode, file copy
 * and highlighting in the UI (for plain spans: `findMatches(text, terms.map(t => [t, t]))`).
 *
 * - Case is ignored (Unicode, RegExp flag `iu`; the match length comes from
 *   the RegExp, not from `toLowerCase`). For entries that differ only in case,
 *   the exact match wins, otherwise the first one.
 * - Word boundaries: if the term starts with a letter/digit, no letter or digit may come
 *   before it; if it ends that way, the same applies after it (also no combining mark). Terms like
 *   "e.V.", "Müller & Söhne" or "1.234 €" thus also work next to punctuation.
 *   So "Max" does not match "Maximilian", "Person-1" not "Person-10".
 * - If an occurrence is rejected (boundary or overlap), the search continues from the next
 *   position; so with self-overlapping terms no original is left behind
 *   ("a-b", "b-b" in "a-b-b-b" → "P-Q", like the sequential replacement of the Rust version).
 * - Taken positions are kept in a mask over the text length (linear instead of quadratic).
 * - Prefilter: one alternation of all terms finds which terms occur at all;
 *   only those are searched one by one (matters with many entries × many short paragraphs).
 */
export function findMatches(text: string, ps: readonly Pair[]): Match[] {
  const found: Match[] = [];
  // Create the mask only at the first match: findMatches runs per paragraph, mostly without matches
  let taken: Uint8Array | null = null;
  const c = compile(ps);
  const which = candidates(text, c) ?? c.groups.keys();
  for (const gi of which) {
    const g = c.groups[gi];
    const re = g.re;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const p = m.index;
      const end = p + m[0].length;
      let ok =
        (!g.checkStart || !WORD_CHAR.test(charBefore(text, p))) &&
        (!g.checkEnd || !WORD_CHAR.test(charAt(text, end)));
      if (ok) {
        taken ??= new Uint8Array(text.length);
        for (let i = p; i < end; i++) {
          if (taken[i]) {
            ok = false;
            break;
          }
        }
      }
      if (ok) {
        taken!.fill(1, p, end);
        found.push([p, end, g.exact.get(m[0]) ?? g.fallback]);
      } else {
        re.lastIndex = nextPos(text, p);
      }
    }
  }
  return found.sort((a, b) => a[0] - b[0]);
}

export function applyMatches(text: string, matches: Match[]): string {
  let out = '';
  let cursor = 0;
  for (const [s, e, rep] of matches) {
    out += text.slice(cursor, s) + rep;
    cursor = e;
  }
  return out + text.slice(cursor);
}

/**
 * Encode/decode text (confirmed entries only, case-insensitive, with word boundaries; see
 * `findMatches`).
 *
 * The Rust version wanted `(?i)(?:\b|(?<=\s)|(?<=^))ORIG(?:\b|(?=\s)|(?=$))` (encoder.rs); that
 * failed for lack of lookbehind in the `regex` crate, so `str::replace` was always used there
 * (exact, without boundaries). Here the intended semantics apply, in one pass: no
 * chained replacements (an inserted alias is not replaced again), with an exact match count.
 */
export function substitute(text: string, entries: Iterable<AliasEntry>, mode: Mode): SubstitutionResult {
  const matches = findMatches(text, pairs(entries, mode));
  return { text: applyMatches(text, matches), replacements_made: matches.length };
}

/** Placeholders written differently than in the list (see `changedPlaceholders`) */
export interface ChangedPlaceholders {
  count: number;
  /** First one as it is written in the text, e.g. "Person 1" */
  sample: string | null;
}

/**
 * Placeholders an AI wrote differently: "Person 1", "Person_1", "Person1" or "Person–1" for
 * "Person-1". Bring names back does not touch them, so their names would stay hidden. Only
 * placeholders of the form `Word-N` are checked, and a hit must belong to one in the list.
 * Spellings that differ only in case are not counted: they are brought back.
 */
export function changedPlaceholders(text: string, entries: Iterable<AliasEntry>): ChangedPlaceholders {
  const known = new Set<string>();
  const prefixes = new Set<string>();
  for (const e of entries) {
    if (!e.confirmed || !e.original || !e.alias) continue;
    const m = /^(\p{L}[\p{L}\p{M}]*)-(\d+)$/u.exec(e.alias);
    if (!m) continue;
    known.add(`${m[1].toLowerCase()}-${Number(m[2])}`);
    prefixes.add(escapeRe(m[1]));
  }
  const none = { count: 0, sample: null };
  if (!known.size || !text) return none;
  const re = new RegExp(
    String.raw`(?<![\p{L}\p{N}\p{M}])(${[...prefixes].join('|')})([\s_.\-\u2010-\u2015]{0,2})(\d+)(?![\p{L}\p{N}\p{M}])`,
    'giu',
  );
  let count = 0;
  let sample: string | null = null;
  for (const m of text.matchAll(re)) {
    if (m[2] === '-' && m[3] === String(Number(m[3]))) continue; // the placeholder itself
    if (!known.has(`${m[1].toLowerCase()}-${Number(m[3])}`)) continue;
    count++;
    sample ??= m[0];
  }
  return count ? { count, sample } : none;
}
