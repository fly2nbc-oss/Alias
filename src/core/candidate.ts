import type { Category, DetectionSource, EntityCandidate } from '../types';

/** Internal candidate: `features` always present, source always set. */
export interface Candidate extends EntityCandidate {
  detection_source: DetectionSource;
  needs_review: boolean;
  features: Record<string, string>;
}

export type Span = [number, number];

export const CATEGORY_LABEL: Record<Category, string> = {
  email: 'Email',
  iban: 'IBAN',
  telefon: 'Phone',
  datum: 'Date',
  person: 'Person',
  firma: 'Company',
  produkt: 'Product',
  ort: 'Location',
  betrag: 'Amount',
  sonstiges: 'Other',
};

/** Conflict resolution for overlapping spans (higher wins). */
export function overlapPriority(c: Category): number {
  switch (c) {
    case 'email':
    case 'iban':
      return 9;
    case 'telefon':
      return 8;
    case 'datum':
      return 7;
    case 'betrag':
      return 6;
    case 'firma':
      return 5;
    case 'person':
      return 4;
    case 'produkt':
    case 'ort':
      return 3;
    case 'sonstiges':
      return 2;
  }
}

function sourceRank(s: DetectionSource): number {
  switch (s) {
    case 'ner':
      return 5;
    case 'parser':
      return 4;
    case 'lexicon':
      return 3;
    case 'hybrid':
      return 2;
    case 'rule':
      return 1;
  }
}

export function mergePreferStronger(a: DetectionSource, b: DetectionSource): DetectionSource {
  return sourceRank(a) >= sourceRank(b) ? a : b;
}

export function ruleBase(text: string, category: Category, confidence: number): Candidate {
  return {
    text,
    category,
    confidence,
    occurrences: 0,
    offsets: [],
    detection_source: 'rule',
    needs_review: false,
    features: {},
  };
}

/** Add a match to a candidate. */
export function addHit(c: Candidate, start: number, end: number): void {
  c.occurrences += 1;
  c.offsets.push([start, end]);
}
