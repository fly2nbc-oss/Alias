/** Detection pipeline: port of detector/mod.rs, spans.rs, deduplicator.rs, resolver.rs,
 *  scorer.rs, person_pipeline.rs */
import { mergePreferStronger, overlapPriority, type Candidate } from '../candidate';
import { byteLen, isAlphanumeric, SpanIndex } from '../util';
import { chooseDisplayText, detectPerson, identityKey } from './person';
import {
  detectAbbreviation,
  detectAddress,
  detectCompanyLegal,
  detectCompanySignals,
  detectLocation,
  detectProduct,
} from './rules';
import { detectDate, detectEmail, detectIban, detectMoney, detectPhone } from './simple';

// Run time: all overlap/containment checks use `SpanIndex` (O(log n)) instead of
// linear lists (`.some`); on 400 KB of text that used to take > 7 s in the UI thread.

// ---------------------------------------------------------------- Blocked ranges

/** Removes offsets that overlap blocked spans; adjusts `occurrences`. */
export function filterByBlocked(c: Candidate, blocked: SpanIndex): Candidate | null {
  const offsets = c.offsets.filter((o) => !blocked.overlaps(o[0], o[1]));
  if (offsets.length === 0) return null;
  return { ...c, offsets, occurrences: offsets.length };
}

/** Filters candidates and blocks their spans for the following passes. */
function applyPass(blocked: SpanIndex, candidates: Candidate[]): Candidate[] {
  const accepted: Candidate[] = [];
  for (const raw of candidates) {
    const c = filterByBlocked(raw, blocked);
    if (!c) continue;
    for (const o of c.offsets) blocked.add(o[0], o[1]);
    accepted.push(c);
  }
  return accepted;
}

// ---------------------------------------------------------------- Deduplication

const normalize = (s: string) =>
  [...s.toLowerCase()].filter(isAlphanumeric).join('');

/** Maximal alphanumeric runs (per code point, like `isAlphanumeric`). */
function alnumRuns(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of s) {
    if (isAlphanumeric(ch)) cur += ch;
    else if (cur) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Shorter text `cl` as a separate word in the longer `el` (first occurrence only, as in Rust). */
function containedAsWord(el: string, cl: string): boolean {
  const idx = el.indexOf(cl);
  if (idx < 0) return false;
  const before = [...el.slice(0, idx)].pop();
  const after = [...el.slice(idx + cl.length)][0];
  return (before === undefined || !isAlphanumeric(before)) && (after === undefined || !isAlphanumeric(after));
}

function insertSorted(list: number[], v: number): void {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  list.splice(lo, 0, v);
}

function removeSorted(list: number[] | undefined, v: number): void {
  if (!list) return;
  const i = list.indexOf(v);
  if (i >= 0) list.splice(i, 1);
}

function pushTo(map: Map<string, number[]>, key: string, v: number): void {
  const l = map.get(key);
  if (l) insertSorted(l, v);
  else map.set(key, [v]);
}

/**
 * Port of deduplicator.rs. As in the original, it looks for the *first* already merged
 * entry that one of the three rules matches (same normalized text, same person,
 * shorter text as a separate word in the longer one). Instead of checking all entries linearly,
 * indexes per rule return the candidates in ascending order; the minimum is the same entry.
 * For the word rule the index over the alphanumeric runs is enough: if `cl` fits as a word in `el`,
 * every alphanumeric run of `cl` is also a run of `el`.
 */
export function deduplicate(input: Candidate[]): Candidate[] {
  const candidates = [...input].sort((a, b) => byteLen(b.text) - byteLen(a.text));
  const merged: Candidate[] = [];
  const normOf: string[] = [];
  const identOf: string[] = [];
  const lowerOf: string[] = [];
  const byNorm = new Map<string, number[]>();
  const byIdent = new Map<string, number[]>();
  const byToken = new Map<string, number[]>();
  const tokenKey = (cat: string, tok: string) => `${cat}\u0000${tok}`;

  for (const cand of candidates) {
    const normCand = normalize(cand.text);
    let best = Infinity;
    const l1 = byNorm.get(normCand);
    if (l1?.length) best = l1[0];
    if (cand.category === 'person') {
      const k = identityKey(cand.text);
      const l2 = k ? byIdent.get(k) : undefined;
      if (l2?.length && l2[0] < best) best = l2[0];
    } else if (byteLen(cand.text) >= 3) {
      // Not for persons: a lone last name ("Frau Hoffmann") would otherwise be merged into
      // "Laura Hoffmann", get no entry of its own and stay in plain text when
      // encoding (Rust original). `samePerson` merges the same persons.
      const cl = cand.text.toLowerCase();
      const toks = alnumRuns(cl);
      if (toks.length === 0) {
        for (let i = 0; i < best && i < merged.length; i++) {
          if (merged[i].category === cand.category && containedAsWord(lowerOf[i], cl)) {
            best = i;
            break;
          }
        }
      } else {
        let posting: number[] | undefined;
        for (const t of toks) {
          const l = byToken.get(tokenKey(cand.category, t));
          if (!l) {
            posting = undefined;
            break;
          }
          if (!posting || l.length < posting.length) posting = l;
        }
        for (const i of posting ?? []) {
          if (i >= best) break;
          if (containedAsWord(lowerOf[i], cl)) {
            best = i;
            break;
          }
        }
      }
    }

    if (best !== Infinity) {
      const existing = merged[best];
      if (existing.category === 'person' && cand.category === 'person') {
        existing.text = chooseDisplayText(existing.text, cand.text);
        const norm = normalize(existing.text);
        if (norm !== normOf[best]) {
          removeSorted(byNorm.get(normOf[best]), best);
          pushTo(byNorm, norm, best);
          normOf[best] = norm;
        }
        const ident = identityKey(existing.text);
        if (ident !== identOf[best]) {
          if (identOf[best]) removeSorted(byIdent.get(identOf[best]), best);
          if (ident) pushTo(byIdent, ident, best);
          identOf[best] = ident;
        }
      }
      if (cand.confidence > existing.confidence) existing.confidence = cand.confidence;
      existing.detection_source = mergePreferStronger(existing.detection_source, cand.detection_source);
      existing.needs_review = existing.needs_review || cand.needs_review;
      for (const [k, v] of Object.entries(cand.features)) {
        if (!(k in existing.features)) existing.features[k] = v;
      }
      existing.occurrences += cand.occurrences;
      for (const o of cand.offsets) existing.offsets.push(o);
    } else {
      const idx = merged.length;
      merged.push({ ...cand, offsets: [...cand.offsets], features: { ...cand.features } });
      normOf.push(normCand);
      pushTo(byNorm, normCand, idx);
      const ident = cand.category === 'person' ? identityKey(cand.text) : '';
      identOf.push(ident);
      if (ident) pushTo(byIdent, ident, idx);
      const lower = cand.text.toLowerCase();
      lowerOf.push(lower);
      // The text of non-person entries never changes → the word index stays valid.
      if (cand.category !== 'person') {
        for (const t of new Set(alnumRuns(lower))) pushTo(byToken, tokenKey(cand.category, t), idx);
      }
    }
  }

  // Remove offsets inside longer spans already taken
  let maxEnd = 0;
  for (const c of merged) for (const o of c.offsets) maxEnd = Math.max(maxEnd, o[0], o[1]);
  const used = new SpanIndex(maxEnd);
  const result: Candidate[] = [];
  for (const c of merged) {
    c.offsets = c.offsets.filter((o) => !used.contains(o[0], o[1]));
    if (c.offsets.length === 0) continue;
    for (const o of c.offsets) used.add(o[0], o[1]);
    result.push(c);
  }
  result.sort((a, b) => b.occurrences - a.occurrences);
  return result;
}

// ---------------------------------------------------------------- Conflict resolution

/**
 * Remove overlapping offsets from weaker candidates (category → length → confidence).
 * Length in UTF-8 bytes of the text slice as in the Rust original (`off[1] - off[0]` on
 * byte offsets), so that ties with umlauts are resolved the same way.
 */
export function resolveSpanConflicts(candidates: Candidate[], text: string): Candidate[] {
  const picks: { s: number; e: number; pri: number; len: number; conf: number; ci: number; oi: number }[] = [];
  let maxEnd = 0;
  candidates.forEach((c, ci) =>
    c.offsets.forEach((off, oi) => {
      maxEnd = Math.max(maxEnd, off[0], off[1]);
      picks.push({
        s: off[0],
        e: off[1],
        pri: overlapPriority(c.category),
        len: off[1] > off[0] ? byteLen(text.slice(off[0], off[1])) : 0,
        conf: c.confidence,
        ci,
        oi,
      });
    }),
  );
  picks.sort((a, b) => b.pri - a.pri || b.len - a.len || b.conf - a.conf);
  const kept = new SpanIndex(maxEnd);
  const keep = candidates.map((c) => new Uint8Array(c.offsets.length));
  for (const p of picks) {
    if (kept.overlaps(p.s, p.e)) continue;
    kept.add(p.s, p.e);
    keep[p.ci][p.oi] = 1;
  }
  return candidates
    .map((c, ci) => {
      const offsets = c.offsets.filter((_, oi) => keep[ci][oi] === 1);
      return { ...c, offsets, occurrences: offsets.length };
    })
    .filter((c) => c.offsets.length > 0);
}

// ---------------------------------------------------------------- Scoring

const THRESHOLD_HIGH = 0.9;
const THRESHOLD_REVIEW = 0.85;

export function applyPipelineScores(candidates: Candidate[]): Candidate[] {
  for (const c of candidates) {
    const flag = (reason: string) => {
      c.needs_review = true;
      if (!('review_reason' in c.features)) c.features.review_reason = reason;
    };
    if (['email', 'iban', 'telefon'].includes(c.category) && c.confidence >= 0.75) {
      c.needs_review = false;
      continue;
    }
    if (c.detection_source === 'ner' && c.category === 'person') {
      if (c.confidence >= 0.88) {
        c.needs_review = false;
        continue;
      }
      if (c.confidence < 0.72) {
        flag('ner_low_confidence');
        continue;
      }
    }
    if (c.confidence >= THRESHOLD_HIGH) {
      c.needs_review = false;
      continue;
    }
    if (c.category === 'person' && c.confidence < THRESHOLD_REVIEW) {
      flag('person_mid_confidence');
      continue;
    }
    if (c.confidence < THRESHOLD_REVIEW) flag('below_threshold');
  }
  return candidates;
}

// ---------------------------------------------------------------- Pipeline

/** NER persons first, then rule-based persons on the remaining spans. */
function personsWithNer(text: string, blocked: SpanIndex, nerPersons: Candidate[]): Candidate[] {
  const ner = nerPersons.map((c) => filterByBlocked(c, blocked)).filter((c): c is Candidate => !!c);
  const extended = blocked.clone();
  for (const c of ner) for (const o of c.offsets) extended.add(o[0], o[1]);
  const rules = detectPerson(text)
    .map((c) => filterByBlocked(c, extended))
    .filter((c): c is Candidate => !!c);
  return [...ner, ...rules];
}

/**
 * Order: email → IBAN → amount → date → phone → address → company with legal form → location →
 * other company patterns → NER (ORG/LOC/MISC) → person → product → abbreviations. Found ranges
 * are blocked. `ner` are the results of the NER model (empty if not available).
 *
 * Differs from the Rust original (location before company): a full company name with legal form
 * ("Microsoft Deutschland GmbH") ran into the location gazetteer ("Deutschland") there, was
 * rejected completely and later fell apart into product + location.
 */
export function detectAll(text: string, ner: Candidate[] = []): Candidate[] {
  const blocked = new SpanIndex(text.length);
  const all: Candidate[] = [];
  const push = (cs: Candidate[]) => {
    for (const c of cs) all.push(c);
  };
  for (const detect of [
    detectEmail,
    detectIban,
    detectMoney,
    detectDate,
    detectPhone,
    detectAddress,
    detectCompanyLegal,
    detectLocation,
    detectCompanySignals,
  ]) {
    push(applyPass(blocked, detect(text)));
  }
  const nerPersons = ner.filter((c) => c.category === 'person');
  const nerOthers = ner
    .filter((c) => c.category !== 'person')
    .map((c) => filterByBlocked(c, blocked))
    .filter((c): c is Candidate => !!c);
  push(applyPass(blocked, nerOthers));
  push(applyPass(blocked, personsWithNer(text, blocked.clone(), nerPersons)));
  push(applyPass(blocked, detectProduct(text)));
  push(applyPass(blocked, detectAbbreviation(text)));
  return applyPipelineScores(resolveSpanConflicts(deduplicate(all), text));
}

export { detectPerson };
