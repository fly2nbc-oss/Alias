import { describe, expect, it } from 'vitest';
import { chunkText } from './bio';

const check = (text: string, max: number) => {
  const chunks = chunkText(text, max);
  // no gaps, no overlap, not too long
  expect(chunks[0][0]).toBe(0);
  expect(chunks[chunks.length - 1][1]).toBe(text.length);
  chunks.forEach(([s, e], i) => {
    expect(e - s).toBeLessThanOrEqual(max);
    expect(e).toBeGreaterThan(s);
    if (i > 0) expect(s).toBe(chunks[i - 1][1]);
  });
  return chunks.map(([s, e]) => text.slice(s, e));
};

describe('chunkText', () => {
  it('prefers sentence ends over spaces, so names stay together', () => {
    const sentence = 'Wir haben heute lange mit Max Mustermann gesprochen. ';
    const parts = check(sentence.repeat(30), 200);
    for (const p of parts) expect(p.endsWith('gesprochen. ') || p === parts[parts.length - 1]).toBe(true);
  });

  it('prefers line breaks', () => {
    const parts = check('Zeile mit Anna Weber und mehr Text\n'.repeat(40), 300);
    for (const p of parts.slice(0, -1)) expect(p.endsWith('\n')).toBe(true);
  });

  it('never splits a surrogate pair on a hard cut', () => {
    const text = '🙂'.repeat(500);
    for (const p of check(text, 101)) expect(/^(?:[\uD800-\uDBFF][\uDC00-\uDFFF])*$/.test(p)).toBe(true);
  });
});
