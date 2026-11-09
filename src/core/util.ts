/**
 * Helpers for porting the Rust logic to TypeScript.
 *
 * Main difference between Rust `regex` and JS RegExp: in Rust, `\b`, `\w` and `\s` are
 * Unicode-aware; in JS (even with flag `u`) `\b`/`\w` are ASCII only, and `\s` differs slightly
 * (JS: with U+FEFF, without U+0085). `rx()` translates them into Unicode equivalents so that e.g.
 * `\bMüller\b` or `\bStraße\b` match correctly.
 */

/**
 * Rust `\w` (UTS #18 "word"): Alphabetic + Mark + Decimal_Number + Connector_Punctuation +
 * Join_Control. Also the basis for `\b`.
 */
const W_INNER = '\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\p{Join_Control}';
const W = `[${W_INNER}]`;
const BOUNDARY = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;
/** Rust `\s` or `char::is_whitespace`: Unicode property White_Space. */
const S_INNER = '\\p{White_Space}';
const NS_INNER = '\\P{White_Space}';

/** Escapes that mean the same in Rust and JS (`\d`: see `rx`). */
const PASS_ESCAPES = new Set(['t', 'n', 'r', 'f', 'v', 'd']);

/**
 * Translates a Rust regex pattern into a JS RegExp (flags `gud`, plus `i` if needed).
 * - leading inline flags `(?i)`/`(?u)` become JS flags
 * - `\b` → Unicode word boundary, `\w` → Unicode word character, `\s`/`\S` → White_Space
 * - `.` outside classes → `[^\n]` (Rust: anything but `\n`; JS also excludes `\r`
 *   and U+2028/2029)
 * - `\d` stays ASCII on purpose (Rust: `\p{Nd}`). Every digit match is then evaluated with
 *   ASCII logic (parseInt, IBAN checksum, postcode prefix, digit count); Rust failed there
 *   on non-ASCII digits with `parse::<u32>()` as well. Unicode `\d` would only add edge cases
 *   like `parseInt('１２') → NaN` (→ year 2000). Only difference: amounts/phone
 *   numbers in full-width or Arabic-Indic digits are not found.
 *
 * Unsupported constructs (`\B`, `\W`, `\D`, `\x{…}`, backreferences, `\b` in classes,
 * inline flags in the middle of the pattern, `(?P<…>)`, nested classes, set operations `&&`/`--`/`~~`,
 * flags other than `i`/`u`) are rejected with an error instead of being translated wrongly.
 */
export function rx(source: string): RegExp {
  const fail = (what: string): never => {
    throw new Error(`rx: ${what} nicht unterstützt: ${source}`);
  };
  let src = source;
  let flags = 'gud';
  for (;;) {
    const m = /^\(\?([a-zA-Z]+)\)/.exec(src);
    if (!m) break;
    for (const f of m[1]) {
      if (f === 'i') {
        if (!flags.includes('i')) flags += 'i';
      } else if (f !== 'u') fail(`Inline-Flag „${f}“`);
    }
    src = src.slice(m[0].length);
  }
  let out = '';
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      if (i + 1 >= src.length) fail('„\\“ am Ende');
      const n = src[++i];
      if (n === 'b') {
        if (inClass) fail('„\\b“ in Zeichenklasse');
        out += BOUNDARY;
      } else if (n === 'w') out += inClass ? W_INNER : W;
      else if (n === 's') out += inClass ? S_INNER : `[${S_INNER}]`;
      else if (n === 'S') out += inClass ? NS_INNER : `[${NS_INNER}]`;
      else if (n === 'p' || n === 'P') {
        const close = src.indexOf('}', i);
        if (src[i + 1] !== '{' || close < 0) fail(`„\\${n}“ ohne {…}`);
        out += '\\' + src.slice(i, close + 1);
        i = close;
      } else if (n === 'u') {
        const hex = /^u[0-9A-Fa-f]{4}/.exec(src.slice(i));
        if (!hex) fail('„\\u“ ohne vier Hex-Ziffern');
        out += '\\' + hex![0];
        i += 4;
      } else if (PASS_ESCAPES.has(n)) out += c + n;
      else if (/[A-Za-z0-9]/.test(n)) fail(`Escape „\\${n}“`);
      else out += c + n; // escaped punctuation
      continue;
    }
    if (inClass) {
      if (c === '[') fail('verschachtelte Zeichenklasse');
      if ((c === '&' || c === '-' || c === '~') && src[i + 1] === c) fail(`Mengenoperation „${c}${c}“`);
      if (c === ']') inClass = false;
      out += c;
      continue;
    }
    if (c === '[') {
      inClass = true;
      out += c;
      if (src[i + 1] === '^') out += src[++i];
      // In Rust a leading `]` is a literal; in JS it closes the (empty) class.
      if (src[i + 1] === ']') fail('führendes „]“ in Zeichenklasse');
      continue;
    }
    if (c === '(' && src[i + 1] === '?' && !/^(?::|=|!|<=|<!)/.test(src.slice(i + 2))) {
      fail(`Gruppe „(?${src.slice(i + 2, i + 5)}…“`);
    }
    out += c === '.' ? '[^\\n]' : c;
  }
  if (inClass) fail('offene Zeichenklasse');
  return new RegExp(out, flags);
}

/** Sticky variant of an `rx()` pattern (matches only exactly at `lastIndex`). */
export function sticky(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags.replace('g', '') + 'y');
}


/** Escape for literals in a `u` RegExp (there, e.g., `\-` outside classes is invalid). */
export function escapeRe(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}

/** All matches (always from a fresh lastIndex). */
export function findIter(re: RegExp, text: string): RegExpExecArray[] {
  re.lastIndex = 0;
  return Array.from(text.matchAll(re)) as RegExpExecArray[];
}

/**
 * Like `findIter`, but linear for patterns that scan from every start position within a long
 * run of characters to its end (otherwise O(n²), e.g. "A.A.A.…").
 *
 * - `start`: finds the next possible start position (a zero-length match or the start
 *   of the match counts); must return every position where `re` can match.
 * - `run`: sticky pattern for the run from a start position.
 *
 * Precondition (to be justified per pattern): if `re` fails at start position p, it also fails at
 * every further start position q with p < q < p + |run(p)|. Then this function returns exactly
 * the same matches as `findIter(re, text)`.
 */
export function findIterSkipping(re: RegExp, text: string, start: RegExp, run: RegExp): RegExpExecArray[] {
  const at = sticky(re);
  const out: RegExpExecArray[] = [];
  let pos = 0;
  while (pos <= text.length) {
    start.lastIndex = pos;
    const s = start.exec(text);
    if (!s) break;
    const p = s.index;
    at.lastIndex = p;
    const m = at.exec(text);
    if (m) {
      out.push(m);
      pos = m.index + m[0].length + (m[0].length === 0 ? 1 : 0);
      continue;
    }
    run.lastIndex = p;
    const r = run.exec(text);
    pos = p + Math.max(1, r ? r[0].length : 0);
  }
  return out;
}

/** Start/end of a group (needs flag `d`). */
export function groupSpan(m: RegExpExecArray, g: number): [number, number] | null {
  const idx = m.indices?.[g];
  return idx ? [idx[0], idx[1]] : null;
}

/** Length of a code point in UTF-8 bytes. */
function utf8Len(cp: number): number {
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/** Length in UTF-8 bytes (Rust `str::len()`), for identical sort orders. */
export function byteLen(s: string): number {
  let n = 0;
  for (const ch of s) n += utf8Len(ch.codePointAt(0)!);
  return n;
}

/**
 * Start (UTF-16 index) of a lookback of `bytes` UTF-8 bytes before `end`; same as Rust
 * `text.floor_char_boundary(end - bytes)`: a character that spans the boundary is included
 * in full.
 */
export function utf8LookbackStart(text: string, end: number, bytes: number): number {
  let i = end;
  let n = 0;
  while (i > 0 && n < bytes) {
    const lo = text.charCodeAt(i - 1);
    if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) {
      const hi = text.charCodeAt(i - 2);
      if (hi >= 0xd800 && hi <= 0xdbff) {
        n += 4;
        i -= 2;
        continue;
      }
    }
    n += utf8Len(lo);
    i -= 1;
  }
  return i;
}

const ALNUM = /[\p{Alphabetic}\p{N}]/u;
const WS = /\p{White_Space}/u;
const WS_RUN = /\p{White_Space}+/u;

/** Rust `char::is_alphanumeric` */
export function isAlphanumeric(ch: string): boolean {
  return ALNUM.test(ch);
}


/** Rust `char::is_whitespace` (Unicode White_Space) */
export function isWhitespace(ch: string): boolean {
  return WS.test(ch);
}

/** Rust `str::split_whitespace` */
export function splitWhitespace(s: string): string[] {
  return s.split(WS_RUN).filter((w) => w.length > 0);
}

/** Rust `trim_matches(|c| c == '.' || c == ',' || c == ';')` */
export function trimPunct(s: string): string {
  return s.replace(/^[.,;]+|[.,;]+$/g, '');
}

/** Get or create a map entry (Rust `entry().or_insert_with()`). */
export function getOrInsert<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  let v = map.get(key);
  if (v === undefined) {
    v = make();
    map.set(key, v);
  }
  return v;
}

/** Lines of a data file (without empty lines and `#` comments). */
export function dataLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

// ---------------------------------------------------------------- Span index

/**
 * Set of spans [s, e) with fast queries (Fenwick tree, prefix maximum of the ends over the
 * start position); replaces linear `spans.some(…)` searches (previously O(n²) on large texts):
 * - `overlaps(s, e)`: ∃ span [a, b) with a < e && b > s      (exactly the same condition as before)
 * - `contains(s, e)`: ∃ span [a, b) with a <= s && b >= e
 * Positions are non-negative integers; the capacity grows as needed.
 */
export class SpanIndex {
  private tree: Int32Array;
  /** Largest end per start position (for growing/rebuilding). */
  private best: Int32Array;

  constructor(capacity = 0) {
    const n = Math.max(16, capacity + 1);
    this.tree = new Int32Array(n + 1).fill(-1);
    this.best = new Int32Array(n).fill(-1);
  }

  private get size(): number {
    return this.best.length;
  }

  private grow(min: number): void {
    const old = this.best;
    let n = this.size;
    while (n <= min) n *= 2;
    this.tree = new Int32Array(n + 1).fill(-1);
    this.best = new Int32Array(n).fill(-1);
    for (let s = 0; s < old.length; s++) if (old[s] >= 0) this.add(s, old[s]);
  }

  add(start: number, end: number): void {
    const s = Math.max(0, start);
    if (s >= this.size) this.grow(s);
    if (this.best[s] >= end) return;
    this.best[s] = end;
    const t = this.tree;
    for (let i = s + 1; i < t.length; i += i & -i) if (t[i] < end) t[i] = end;
  }

  /** Largest end of all spans with start <= `limit` (-1 if none). */
  maxEnd(limit: number): number {
    if (limit < 0) return -1;
    const t = this.tree;
    let r = -1;
    for (let i = Math.min(limit + 1, t.length - 1); i > 0; i -= i & -i) if (t[i] > r) r = t[i];
    return r;
  }

  overlaps(start: number, end: number): boolean {
    return this.maxEnd(end - 1) > start;
  }

  contains(start: number, end: number): boolean {
    return this.maxEnd(start) >= end;
  }

  clone(): SpanIndex {
    const c = new SpanIndex(0);
    c.tree = this.tree.slice();
    c.best = this.best.slice();
    return c;
  }
}
