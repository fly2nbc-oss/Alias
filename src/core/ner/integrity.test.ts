import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { integrityFetch, MODEL_FILES, MODEL_REVISION, Sha256 } from './integrity';

const MODEL = 'org/model';
const url = (file: string, rev = MODEL_REVISION) => `https://huggingface.co/${MODEL}/resolve/${rev}/${file}`;

describe('Sha256', () => {
  it('matches node:crypto for many sizes and chunkings', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 100_003]) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);
      const expected = createHash('sha256').update(data).digest('hex');
      expect(new Sha256().update(data).hex(), `n=${n}`).toBe(expected);
      const h = new Sha256();
      for (let i = 0; i < n; i += 37) h.update(data.subarray(i, i + 37));
      expect(h.hex(), `chunked n=${n}`).toBe(expected);
    }
  });
});

describe('integrityFetch', () => {
  const body = new TextEncoder().encode('{"a":1}');
  const good = createHash('sha256').update(body).digest('hex');
  const base = async () => new Response(body, { status: 200 });

  it('passes a file with the expected hash', async () => {
    MODEL_FILES['test.json'] = good;
    const res = await integrityFetch(MODEL, base)(url('test.json'));
    expect(await res.text()).toBe('{"a":1}');
  });

  it('fails a tampered file', async () => {
    MODEL_FILES['test.json'] = '0'.repeat(64);
    const res = await integrityFetch(MODEL, base)(url('test.json'));
    await expect(res.text()).rejects.toThrow(/integrity check/);
  });

  it('redirects main to the pinned revision', async () => {
    let seen = '';
    MODEL_FILES['test.json'] = good;
    const spy = async (u: string | URL) => ((seen = String(u)), new Response(body, { status: 200 }));
    const res = await integrityFetch(MODEL, spy)(url('test.json', 'main'));
    expect(seen).toBe(url('test.json'));
    expect(await res.text()).toBe('{"a":1}');
  });

  it('blocks other revisions and unknown files', async () => {
    await expect(integrityFetch(MODEL, base)(url('config.json', 'v0.0.1'))).rejects.toThrow(/pinned/);
    await expect(integrityFetch(MODEL, base)(url('evil.onnx'))).rejects.toThrow(/unexpected file/);
  });

  it('leaves range probes and foreign URLs alone', async () => {
    const res = await integrityFetch(MODEL, base)(url('evil.onnx'), { headers: { Range: 'bytes=0-0' } });
    expect(res.ok).toBe(true);
    expect((await integrityFetch(MODEL, base)('https://example.org/x')).ok).toBe(true);
  });
});
