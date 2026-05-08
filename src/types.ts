export type Category =
  | 'email'
  | 'iban'
  | 'telefon'
  | 'datum'
  | 'person'
  | 'firma'
  | 'produkt'
  | 'ort'
  | 'betrag'
  | 'sonstiges';

export const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'email',     label: 'Email' },
  { value: 'iban',      label: 'IBAN' },
  { value: 'telefon',   label: 'Phone' },
  { value: 'datum',     label: 'Date' },
  { value: 'person',    label: 'Person' },
  { value: 'firma',     label: 'Company' },
  { value: 'produkt',   label: 'Product' },
  { value: 'ort',       label: 'Location' },
  { value: 'betrag',    label: 'Amount' },
  { value: 'sonstiges', label: 'Other' },
];

export interface AliasEntry {
  id: string;
  original: string;
  alias: string;
  category: Category;
  confirmed: boolean;
}

export type DetectionSource = 'rule' | 'lexicon' | 'ner' | 'hybrid' | 'parser';

export interface EntityCandidate {
  text: string;
  category: Category;
  confidence: number;
  occurrences: number;
  offsets: [number, number][];
  /** Detection source (hybrid pipeline) */
  detection_source?: DetectionSource;
  /** Medium uncertainty — flag for manual review */
  needs_review?: boolean;
  /** Optional feature hints (e.g. date_kind) */
  features?: Record<string, string>;
}

export interface ParsedDocument {
  content: string;
  source_path: string;
  format: string;
}

export interface SubstitutionResult {
  text: string;
  replacements_made: number;
}

export interface BulkAddItem {
  original: string;
  category: Category;
  alias?: string;
}

export type AppMode = 'encode' | 'decode';
