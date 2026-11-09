/**
 * Test with the real NER model (downloads ~170 MB from Hugging Face).
 * Only active with `ALIAS_LIVE_NER=1 npm test`.
 */
import { AutoModelForTokenClassification, AutoTokenizer } from '@huggingface/transformers';
import { describe, expect, it } from 'vitest';
import { detectAll } from '../detector';
import { alignTokens, MODEL_ID } from './bio';
import { inferEntities } from './infer';
import { integrityFetch, MODEL_REVISION } from './integrity';
import { env } from '@huggingface/transformers';

env.fetch = integrityFetch(MODEL_ID) as typeof env.fetch;

const live = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.ALIAS_LIVE_NER === '1';

describe.skipIf(!live)('NER live', () => {
  it('aligns real WordPiece tokens to the text', async () => {
    const tok = await AutoTokenizer.from_pretrained(MODEL_ID, { revision: MODEL_REVISION });
    const text = 'Herr Jürgen Müller-Lüdenscheidt (Nordwind Logistik GmbH) wohnt in Hamburg 🙂 – Tel. 040/123.';
    const tokens = tok.tokenize(text);
    const offs = alignTokens(text, tokens);
    tokens.forEach((t, i) => {
      if (t === '[UNK]') return;
      expect(text.slice(...offs[i]), `token ${i} ${t}`).toBe(t.replace(/^##/, ''));
    });
  }, 120_000);

  it('detects persons, orgs and locations with correct offsets', async () => {
    const tok = await AutoTokenizer.from_pretrained(MODEL_ID, { revision: MODEL_REVISION });
    const model = await AutoModelForTokenClassification.from_pretrained(MODEL_ID, { dtype: 'q8', revision: MODEL_REVISION });
    const text = 'Gestern traf sich Angela Merkel mit Vertretern von Siemens in München.\n'.repeat(40);
    const ner = await inferEntities(tok, model, text);
    for (const c of ner) expect(text.slice(...c.offsets[0])).toBe(c.text);
    const kinds = new Set(ner.map((c) => `${c.category}:${c.text}`));
    expect(kinds).toContain('person:Angela Merkel');
    expect(kinds).toContain('firma:Siemens');
    expect(kinds).toContain('ort:München');
    // Whole text processed across the 512-token limit
    expect(ner.filter((c) => c.text === 'Angela Merkel').length).toBe(40);
    const all = detectAll(text, ner);
    expect(all.find((c) => c.text === 'Angela Merkel')?.occurrences).toBe(40);
  }, 600_000);
});
