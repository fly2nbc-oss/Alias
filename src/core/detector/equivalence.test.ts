/**
 * Equivalence of the run-time optimizations: the former (quadratic) implementation is kept here
 * verbatim as a reference and compared with the new one on random input.
 */
import { describe, expect, it } from 'vitest';
import { mergePreferStronger, overlapPriority, type Candidate, type Span } from '../candidate';
import type { Category } from '../../types';
import { byteLen, findIter, findIterSkipping, isAlphanumeric, rx, SpanIndex, sticky } from '../util';
import { deduplicate, filterByBlocked, resolveSpanConflicts } from './index';
import { chooseDisplayText, samePerson } from './person';
import { COMPANY_REGEX } from './patterns';
import { EMAIL_PATTERN, detectEmail, detectMoney } from './simple';

// ---------------------------------------------------------------- Reference (old)

function oldFilterByBlocked(c: Candidate, blocked: Span[]): Candidate | null {
  const offsets = c.offsets.filter((o) => !blocked.some(([b0, b1]) => o[0] < b1 && o[1] > b0));
  if (offsets.length === 0) return null;
  return { ...c, offsets, occurrences: offsets.length };
}

const normalize = (s: string) => [...s.toLowerCase()].filter(isAlphanumeric).join('');

function oldDeduplicate(input: Candidate[]): Candidate[] {
  const candidates = [...input].sort((a, b) => byteLen(b.text) - byteLen(a.text));
  const merged: Candidate[] = [];
  for (const cand of candidates) {
    const normCand = normalize(cand.text);
    const existing = merged.find((e) => {
      if (normalize(e.text) === normCand) return true;
      if (samePerson(e, cand)) return true;
      if (e.category === cand.category && cand.category !== 'person' && byteLen(cand.text) >= 3) {
        const el = e.text.toLowerCase();
        const cl = cand.text.toLowerCase();
        const idx = el.indexOf(cl);
        if (idx >= 0) {
          const before = [...el.slice(0, idx)].pop();
          const after = [...el.slice(idx + cl.length)][0];
          const startOk = before === undefined || !isAlphanumeric(before);
          const endOk = after === undefined || !isAlphanumeric(after);
          if (startOk && endOk) return true;
        }
      }
      return false;
    });
    if (existing) {
      if (existing.category === 'person' && cand.category === 'person') {
        existing.text = chooseDisplayText(existing.text, cand.text);
      }
      if (cand.confidence > existing.confidence) existing.confidence = cand.confidence;
      existing.detection_source = mergePreferStronger(existing.detection_source, cand.detection_source);
      existing.needs_review = existing.needs_review || cand.needs_review;
      for (const [k, v] of Object.entries(cand.features)) {
        if (!(k in existing.features)) existing.features[k] = v;
      }
      existing.occurrences += cand.occurrences;
      existing.offsets = [...existing.offsets, ...cand.offsets];
    } else {
      merged.push({ ...cand, offsets: [...cand.offsets], features: { ...cand.features } });
    }
  }
  const used: Span[] = [];
  const result: Candidate[] = [];
  for (const c of merged) {
    c.offsets = c.offsets.filter((o) => !used.some((u) => o[0] >= u[0] && o[1] <= u[1]));
    if (c.offsets.length === 0) continue;
    used.push(...c.offsets);
    result.push(c);
  }
  result.sort((a, b) => b.occurrences - a.occurrences);
  return result;
}

/** Old conflict resolution, but with length already in bytes (the intended change). */
function oldResolve(candidates: Candidate[], text: string): Candidate[] {
  const picks: { span: Span; pri: number; len: number; conf: number; ci: number; oi: number }[] = [];
  candidates.forEach((c, ci) =>
    c.offsets.forEach((off, oi) =>
      picks.push({
        span: off,
        pri: overlapPriority(c.category),
        len: off[1] > off[0] ? byteLen(text.slice(off[0], off[1])) : 0,
        conf: c.confidence,
        ci,
        oi,
      }),
    ),
  );
  picks.sort((a, b) => b.pri - a.pri || b.len - a.len || b.conf - a.conf);
  const kept: Span[] = [];
  const keep = new Set<string>();
  for (const p of picks) {
    if (kept.some((s) => p.span[0] < s[1] && p.span[1] > s[0])) continue;
    kept.push(p.span);
    keep.add(`${p.ci}:${p.oi}`);
  }
  return candidates
    .map((c, ci) => {
      const offsets = c.offsets.filter((_, oi) => keep.has(`${ci}:${oi}`));
      return { ...c, offsets, occurrences: offsets.length };
    })
    .filter((c) => c.offsets.length > 0);
}

// ---------------------------------------------------------------- Random data

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const CATS: Category[] = ['email', 'iban', 'telefon', 'datum', 'person', 'firma', 'produkt', 'ort', 'betrag', 'sonstiges'];
const WORDS = ['ÜWN', 'Prüfst.', 'Acme', 'GmbH', 'Anna', 'Weber', 'Herr', 'Frau', 'Dr.', 'Müller', 'ß', 'x', '---', 'XKT', 'Consulting', 'Straße', '5', 'ÖÖ'];

function randomCandidates(r: () => number, n: number, textLen: number): Candidate[] {
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const out: Candidate[] = [];
  for (let i = 0; i < n; i++) {
    const words = Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(WORDS));
    const offsets: Span[] = Array.from({ length: 1 + Math.floor(r() * 4) }, () => {
      const s = Math.floor(r() * textLen);
      const len = r() < 0.05 ? 0 : 1 + Math.floor(r() * 12);
      return [s, Math.min(textLen, s + len)];
    });
    out.push({
      text: words.join(r() < 0.2 ? '-' : ' '),
      category: r() < 0.35 ? 'person' : pick(CATS),
      confidence: Math.round(r() * 20) / 20,
      occurrences: offsets.length,
      offsets,
      detection_source: pick(['rule', 'lexicon', 'ner', 'parser', 'hybrid'] as const),
      needs_review: r() < 0.3,
      features: r() < 0.3 ? { k: String(i) } : {},
    });
  }
  return out;
}

const clone = (cs: Candidate[]) => cs.map((c) => ({ ...c, offsets: c.offsets.map((o) => [o[0], o[1]] as Span), features: { ...c.features } }));

describe('Pipeline-Kombinatoren: neu ≡ alt', () => {
  it('filterByBlocked mit wachsender Sperrliste', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const cands = randomCandidates(r, 30, 120);
      const blockedOld: Span[] = [];
      const blockedNew = new SpanIndex(10); // grows as needed
      for (const c of cands) {
        const a = oldFilterByBlocked(c, blockedOld);
        const b = filterByBlocked(c, blockedNew);
        expect(b).toEqual(a);
        if (a) for (const o of a.offsets) {
          blockedOld.push(o);
          blockedNew.add(o[0], o[1]);
        }
      }
    }
  });

  it('deduplicate', () => {
    let merges = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const cands = randomCandidates(r, 40, 150);
      const want = oldDeduplicate(clone(cands));
      expect(deduplicate(clone(cands))).toEqual(want);
      merges += cands.length - want.length;
    }
    expect(merges).toBeGreaterThan(1000);
  });

  it('resolveSpanConflicts', () => {
    const text = 'ÖÖÖÖxx Müller Straße ß '.repeat(10);
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const cands = randomCandidates(r, 40, text.length);
      expect(resolveSpanConflicts(clone(cands), text)).toEqual(oldResolve(clone(cands), text));
    }
  });
});

// ---------------------------------------------------------------- Regex

function randomText(r: () => number, alphabet: string[], len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(r() * alphabet.length)];
  return s;
}

const spans = (ms: RegExpExecArray[]) => ms.map((m) => [m.index, m.index + m[0].length, m[0]]);

describe('Regex-Umbauten: gleiche Treffer wie das Originalmuster', () => {
  it('E-Mail (manueller Scan)', () => {
    const ref = rx(EMAIL_PATTERN);
    let hits = 0;
    const alpha = ['a', 'Z', '1', '.', '_', '%', '+', '-', '@', '@', 'ü', ' ', 'ß', 'ſ', 'de', 'x.de', '\n', '#'];
    for (let seed = 1; seed <= 3000; seed++) {
      const t = randomText(rng(seed), alpha, 30);
      const want = findIter(ref, t).map((m) => m[0]);
      const got = detectEmail(t).flatMap((c) => c.offsets.map((o) => [o[0], t.slice(o[0], o[1])] as const));
      const gotSorted = got.sort((a, b) => a[0] - b[0]).map((g) => g[1]);
      expect(gotSorted, JSON.stringify(t)).toEqual(want);
      hits += want.length;
    }
    expect(hits).toBeGreaterThan(150);
  });

  it('Betrag (Anker am Laufanfang)', () => {
    const NUM = String.raw`\d[\d.,]*`;
    let hits = 0;
    const refs = [
      rx(String.raw`[$€£¥]\s?${NUM}`),
      rx(String.raw`${NUM}\s?[$€£¥]`),
      rx(String.raw`(?i)${NUM}\s+(?:Euro|EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|CZK|HUF|Franken?|Pfund|Dollar|Pounds?)\b`),
      rx(String.raw`(?i)\b(?:EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|CZK|HUF)\s+${NUM}\b`),
    ];
    const alpha = ['1', '2', '.', ',', ' ', '€', '$', 'EUR', ' euro', 'x', '\n'];
    for (let seed = 1; seed <= 3000; seed++) {
      const t = randomText(rng(seed), alpha, 20);
      const want = new Map<string, Span[]>();
      for (const re of refs) {
        for (const m of findIter(re, t)) {
          const raw = m[0].trim();
          if (!/[0-9]/.test(raw)) continue;
          const l = want.get(raw) ?? [];
          l.push([m.index, m.index + m[0].length]);
          want.set(raw, l);
        }
      }
      const got = new Map(detectMoney(t).map((c) => [c.text, c.offsets]));
      expect(got, JSON.stringify(t)).toEqual(want);
      hits += want.size;
    }
    expect(hits).toBeGreaterThan(1000);
  });

  it('Firma (Lauf-Überspringen)', () => {
    const start = rx(String.raw`\b[A-ZÜÄÖ]`);
    const run = sticky(rx(String.raw`[A-Za-züäöÜÄÖß\-\.]*`));
    const alpha = ['A', 'Ü', 'a', 'x', 'ü', '-', '.', ' ', ' ', '&', 'und ', 'GmbH', 'AG', 'e.V.', '\t', '1', 'é'];
    let hits = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const t = randomText(rng(seed), alpha, 25);
      const want = spans(findIter(COMPANY_REGEX, t));
      expect(spans(findIterSkipping(COMPANY_REGEX, t, start, run)), JSON.stringify(t)).toEqual(want);
      hits += want.length;
    }
    expect(hits).toBeGreaterThan(300);
  });

  it('Personen-Partikel und Kontext (doppelte Quantoren entfernt)', () => {
    const SP = String.raw`\p{Zs}`;
    const pairs: [string, string][] = [
      [
        String.raw`(?u)\b([A-ZÜÄÖ][a-züäöß]{1,30})(?:${SP}+(?:van|von|de)${SP}+)?(?:${SP}+[A-ZÜÄÖ][a-züäöß]{1,30}){1,2}\b`,
        String.raw`(?u)\b([A-ZÜÄÖ][a-züäöß]{1,30})(?:${SP}+(?:van|von|de)${SP}(?=${SP}))?(?:${SP}+[A-ZÜÄÖ][a-züäöß]{1,30}){1,2}\b`,
      ],
      [
        String.raw`(?u)\b(?:Ansprechpartner:\s*|gez\.)\s*([A-ZÄÖÜ][a-zäöüß]+)\b`,
        String.raw`(?u)\b(?:Ansprechpartner:|gez\.)\s*([A-ZÄÖÜ][a-zäöüß]+)\b`,
      ],
      [
        String.raw`(?i)\b(?:Modell|Typ)\s+[:.]?\s*([A-ZÄÖÜ0-9][^,;.\n]{1,48})`,
        String.raw`(?i)\b(?:Modell|Typ)\s+(?:[:.]\s*)?([A-ZÄÖÜ0-9][^,;.\n]{1,48})`,
      ],
    ];
    const alpha = ['Anna', 'Weber', ' ', ' ', ' ', 'von', 'de', 'x', 'Ansprechpartner:', 'gez.', 'Modell', 'Typ', ':', '.', '\n', ','];
    for (const [a, b] of pairs) {
      const ra = rx(a);
      const rb = rx(b);
      let hits = 0;
      for (let seed = 1; seed <= 2000; seed++) {
        const t = randomText(rng(seed), alpha, 12);
        const g = (re: RegExp) => findIter(re, t).map((m) => [m.index, m[0], m.indices?.[1]?.join(',')]);
        expect(g(rb), JSON.stringify(t)).toEqual(g(ra));
        hits += g(ra).length;
      }
      expect(hits, a).toBeGreaterThan(50);
    }
  });
});
