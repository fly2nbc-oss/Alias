/** BIO decoding and token alignment (port of person_ner/engine.rs).
 *  Pure logic without model dependency (testable). */
import type { Category } from '../../types';
import { CATEGORY_LABEL, type Candidate, type Span } from '../candidate';

export const MODEL_ID = 'Xenova/bert-base-multilingual-cased-ner-hrl';
export const LABELS = ['O', 'B-DATE', 'I-DATE', 'B-PER', 'I-PER', 'B-ORG', 'I-ORG', 'B-LOC', 'I-LOC'];

export type BioRole =
  | { kind: 'outside' }
  | { kind: 'other' }
  | { kind: 'begin'; cat: Category }
  | { kind: 'inside'; cat: Category };

/** BIO label -> role with category (PER->person, ORG->firma, LOC->ort, MISC->sonstiges, DATE->datum). */
export function labelRole(raw: string): BioRole {
  const label = raw.trim();
  if (/^(o|outside)$/i.test(label)) return { kind: 'outside' };
  const dash = label.indexOf('-');
  const pos = (dash < 0 ? label : label.slice(0, dash)).toUpperCase();
  const typ = (dash < 0 ? '' : label.slice(dash + 1)).toUpperCase();
  let cat: Category;
  if (typ.includes('PER')) cat = 'person';
  else if (['ORG', 'ORGANIZATION', 'ORGANISATION'].includes(typ)) cat = 'firma';
  else if (['LOC', 'LOCATION', 'GPE', 'FAC'].includes(typ)) cat = 'ort';
  else if (['MISC', 'PRODUCT', 'WORK_OF_ART', 'EVENT'].includes(typ)) cat = 'sonstiges';
  else if (['DATE', 'TIME'].includes(typ)) cat = 'datum';
  else return pos === 'B' || pos === 'I' ? { kind: 'other' } : { kind: 'outside' };
  if (pos === 'B') return { kind: 'begin', cat };
  if (pos === 'I') return { kind: 'inside', cat };
  return { kind: 'outside' };
}

export interface TokenPrediction {
  role: BioRole;
  conf: number;
  /** Character range in the text; [0, 0] = unknown */
  off: Span;
}

/** BIO token sequence -> candidates. */
export function spansFromBio(tokens: TokenPrediction[], text: string): Candidate[] {
  const out: Candidate[] = [];
  let cur: { s: number; e: number; confs: number[]; cat: Category } | null = null;
  const valid = (o: Span) => o[0] < o[1] && o[1] <= text.length;
  const flush = () => {
    if (cur && cur.s < cur.e && cur.e <= text.length) pushSpan(out, text, cur.s, cur.e, cur.confs, cur.cat);
    cur = null;
  };
  for (const { role, conf, off } of tokens) {
    if (role.kind === 'outside' || role.kind === 'other') {
      flush();
    } else if (role.kind === 'begin') {
      flush();
      if (valid(off)) cur = { s: off[0], e: off[1], confs: [conf], cat: role.cat };
    } else if (cur && cur.cat === role.cat) {
      if (valid(off)) {
        cur.e = Math.max(cur.e, off[1]);
        cur.s = Math.min(cur.s, off[0]);
        cur.confs.push(conf);
      }
    } else {
      flush();
      if (valid(off)) cur = { s: off[0], e: off[1], confs: [conf], cat: role.cat };
    }
  }
  flush();
  return out;
}

function pushSpan(out: Candidate[], text: string, start: number, end: number, confs: number[], category: Category) {
  const slice = text.slice(start, end);
  if (!slice.trim()) return;
  const mean = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0.85;
  out.push({
    text: slice,
    category,
    confidence: Math.min(1, Math.max(0, mean)),
    occurrences: 1,
    offsets: [[start, end]],
    detection_source: 'ner',
    needs_review: false,
    features: { ner: 'onnx', model: 'local_token_classification', ner_cat: CATEGORY_LABEL[category] },
  });
}

/** Softmax + argmax over one row of logits. */
export function argmaxSoftmax(logits: ArrayLike<number>): [number, number] {
  if (logits.length === 0) return [0, 0];
  let m = -Infinity;
  for (let i = 0; i < logits.length; i++) m = Math.max(m, logits[i]);
  let sum = 0;
  let best = 0;
  let bestV = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    const v = Math.exp(logits[i] - m);
    sum += v;
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  }
  return [best, sum > 0 ? bestV / sum : bestV];
}

// ---------------------------------------------------------------- Alignment

const SKIPPABLE = /[\s\p{Cc}\p{Cf}]/u;
const WORD_BREAK = /[\s\p{P}\p{S}]/u;

/**
 * Maps WordPiece tokens (`##` = continuation) to character ranges in the text.
 * transformers.js returns no offsets, but the BERT tokenizer (cased) only changes the text by
 * removing whitespace and control characters, so a linear match is enough.
 */
export function alignTokens(text: string, tokens: string[]): Span[] {
  const out: Span[] = [];
  let cursor = 0;
  for (const tok of tokens) {
    const cont = tok.startsWith('##') && tok.length > 2;
    const piece = cont ? tok.slice(2) : tok;
    if (!cont) while (cursor < text.length && SKIPPABLE.test(text[cursor])) cursor++;
    if (tok === '[UNK]') {
      // An unknown word: up to the end of the next word or punctuation
      const start = cursor;
      while (cursor < text.length && !WORD_BREAK.test(text[cursor])) cursor++;
      if (cursor === start && cursor < text.length) cursor++;
      out.push([start, cursor]);
      continue;
    }
    if (text.startsWith(piece, cursor)) {
      out.push([cursor, cursor + piece.length]);
      cursor += piece.length;
      continue;
    }
    // Fallback: look ahead a little (e.g. after removed special characters)
    const idx = text.indexOf(piece, cursor);
    if (idx >= 0 && idx - cursor <= 16) {
      out.push([idx, idx + piece.length]);
      cursor = idx + piece.length;
    } else {
      out.push([0, 0]);
    }
  }
  return out;
}

/**
 * Split text into chunks of at most `maxChars` characters (at line or word boundaries).
 * The model handles at most 512 tokens; the Rust version cut longer texts off.
 */
export function chunkText(text: string, maxChars = 1200): Span[] {
  const chunks: Span[] = [];
  const minEnd = (start: number) => start + Math.floor(maxChars / 2);
  // Prefer cutting at line ends, then sentence ends: names almost never span them.
  // A cut at a space could split „Max | Mustermann“.
  const SENTENCE_END = /[.!?;:]["'»«”“)\]]?\s/g;
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end - 1);
      if (nl >= minEnd(start)) {
        end = nl + 1;
      } else {
        let cut = -1;
        SENTENCE_END.lastIndex = minEnd(start);
        for (let m = SENTENCE_END.exec(text); m && m.index + m[0].length <= end; m = SENTENCE_END.exec(text)) {
          cut = m.index + m[0].length;
        }
        if (cut > 0) end = cut;
        else {
          const sp = text.lastIndexOf(' ', end - 1);
          if (sp >= minEnd(start)) end = sp + 1;
          // Hard cut: never between the halves of a surrogate pair
          else if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
        }
      }
    }
    chunks.push([start, end]);
    start = end;
  }
  return chunks;
}
