/** NER inference via transformers.js (shared by worker and tests). */
import { Tensor, type PreTrainedModel, type PreTrainedTokenizer } from '@huggingface/transformers';
import type { Candidate } from '../candidate';
import { alignTokens, argmaxSoftmax, chunkText, labelRole, LABELS, spansFromBio, type TokenPrediction } from './bio';

const MAX_TOKENS = 510; // 512 minus [CLS]/[SEP]

async function inferChunk(
  tokenizer: PreTrainedTokenizer,
  model: PreTrainedModel,
  fullText: string,
  base: number,
  end: number,
): Promise<TokenPrediction[]> {
  const text = fullText.slice(base, end);
  if (!text.trim()) return [];
  const tokens = tokenizer.tokenize(text);
  if (tokens.length === 0) return [];
  if (tokens.length > MAX_TOKENS) {
    // Too many tokens (e.g. many digits or special characters): split the chunk
    const out: TokenPrediction[] = [];
    for (const [s, e] of chunkText(text, Math.max(50, Math.floor(text.length / 2)))) {
      out.push(...(await inferChunk(tokenizer, model, fullText, base + s, base + e)));
    }
    return out;
  }
  const ids = [
    tokenizer.convert_tokens_to_ids('[CLS]'),
    ...tokenizer.convert_tokens_to_ids(tokens),
    tokenizer.convert_tokens_to_ids('[SEP]'),
  ];
  const n = ids.length;
  const mk = (values: number[]) => new Tensor('int64', BigInt64Array.from(values.map(BigInt)), [1, n]);
  const output = await model({
    input_ids: mk(ids),
    attention_mask: mk(ids.map(() => 1)),
    token_type_ids: mk(ids.map(() => 0)),
  });
  const logits = output.logits as Tensor;
  const [, seq, numLabels] = logits.dims;
  const data = logits.data as Float32Array;
  const offsets = alignTokens(text, tokens);
  const preds: TokenPrediction[] = [];
  // Position 0 = [CLS], seq-1 = [SEP]
  for (let i = 1; i < seq - 1; i++) {
    const [idx, conf] = argmaxSoftmax(data.subarray(i * numLabels, (i + 1) * numLabels));
    const role = labelRole(LABELS[idx] ?? 'O');
    const off = offsets[i - 1];
    const known = off[0] < off[1];
    if (known || role.kind === 'begin' || role.kind === 'inside') {
      preds.push({ role, conf, off: known ? [off[0] + base, off[1] + base] : [0, 0] });
    }
  }
  return preds;
}

/** Progress: `done` of `total` chunks processed */
export type InferProgress = (done: number, total: number) => void;

/**
 * Process the whole text chunk by chunk (the model handles at most 512 tokens at once).
 * `onProgress` is called before the first and after each chunk.
 */
export async function inferEntities(
  tokenizer: PreTrainedTokenizer,
  model: PreTrainedModel,
  text: string,
  onProgress?: InferProgress,
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const chunks = chunkText(text);
  onProgress?.(0, chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    const [s, e] = chunks[i];
    out.push(...spansFromBio(await inferChunk(tokenizer, model, text, s, e), text));
    onProgress?.(i + 1, chunks.length);
  }
  return out;
}
