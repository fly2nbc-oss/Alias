/**
 * Integrity check of the NER model during download.
 *
 * The model is pinned to a fixed commit of the Hugging Face repository; every loaded file must
 * have the SHA-256 listed here. The check runs while streaming (the progress display keeps
 * going): if the hash does not match at the end, the stream fails with an error and
 * transformers.js does not put the file into the cache.
 *
 * Updating the model: enter the new commit and compute the hashes again, e.g.
 *   curl -sL https://huggingface.co/<MODEL>/resolve/<REV>/<file> | sha256sum
 * (for onnx/*.onnx the SHA-256 is also the LFS OID in the Hub API).
 */

export const MODEL_REVISION = '263e82c06569c8c2ac46238a7ae5107598934234';

/** expected SHA-256 per file in the model repository (path relative to the repository) */
export const MODEL_FILES: Record<string, string> = {
  'config.json': '7aa891abae067f95a40f5e2005b3de44824a083f256802934a993d301ec25076',
  'tokenizer.json': 'bf1b59b7b11c95f194f51708d918eea378e09d05f84c0e1656dc5180e8117088',
  'tokenizer_config.json': 'e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a',
  'special_tokens_map.json': 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3',
  'onnx/model_quantized.onnx': '5b65139844be260b624a2a13782b01d122e613d64ce16ed0ba4d82e0b816f1a9',
};

// ---------------------------------------------------------------- SHA-256 (incremental)

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Small incremental SHA-256 (FIPS 180-4) for large downloads. */
export class Sha256 {
  private h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private w = new Uint32Array(64);
  private buf = new Uint8Array(64);
  private bufLen = 0;
  private total = 0;

  update(data: Uint8Array): this {
    let i = 0;
    this.total += data.length;
    if (this.bufLen) {
      const n = Math.min(64 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, n), this.bufLen);
      this.bufLen += n;
      i = n;
      if (this.bufLen < 64) return this;
      this.block(this.buf, 0);
      this.bufLen = 0;
    }
    for (; i + 64 <= data.length; i += 64) this.block(data, i);
    if (i < data.length) {
      this.buf.set(data.subarray(i));
      this.bufLen = data.length - i;
    }
    return this;
  }

  hex(): string {
    const bits = this.total * 8;
    const pad = new Uint8Array((this.bufLen < 56 ? 56 : 120) - this.bufLen + 8);
    pad[0] = 0x80;
    const dv = new DataView(pad.buffer);
    dv.setUint32(pad.length - 8, Math.floor(bits / 0x100000000));
    dv.setUint32(pad.length - 4, bits >>> 0);
    const total = this.total;
    this.update(pad);
    this.total = total;
    return Array.from(this.h, (x) => x.toString(16).padStart(8, '0')).join('');
  }

  private block(d: Uint8Array, o: number): void {
    const w = this.w;
    for (let t = 0; t < 16; t++) w[t] = (d[o + 4 * t] << 24) | (d[o + 4 * t + 1] << 16) | (d[o + 4 * t + 2] << 8) | d[o + 4 * t + 3];
    for (let t = 16; t < 64; t++) {
      const a = w[t - 15];
      const b = w[t - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let [a, b, c, e0, e, f, g, h] = this.h;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (e0 + t1) | 0;
      e0 = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    const H = this.h;
    H[0] += a; H[1] += b; H[2] += c; H[3] += e0; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
}

// ---------------------------------------------------------------- fetch wrapper

type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** File of the pinned model from a Hub URL (`.../<model>/resolve/<rev>/<path>`), else `null` */
export function pinnedFile(url: string, modelId: string): string | null {
  const prefix = `https://huggingface.co/${modelId}/resolve/${MODEL_REVISION}/`;
  if (!url.startsWith(prefix)) return null;
  return decodeURIComponent(url.slice(prefix.length).split(/[?#]/)[0]);
}

/**
 * fetch for transformers.js (`env.fetch`): downloads of the pinned model are checked against
 * `MODEL_FILES`. Other addresses of the model (another commit) are rejected.
 */
export function integrityFetch(modelId: string, base: FetchFn = fetch): FetchFn {
  return async (input, init) => {
    let url = typeof input === 'string' ? input : input.toString();
    // transformers.js requests some metadata (e.g. tokenizer_config.json) without `revision`,
    // i.e. via `main` -> redirect to the pinned commit instead of blocking
    const mainPrefix = `https://huggingface.co/${modelId}/resolve/main/`;
    if (url.startsWith(mainPrefix)) {
      url = `https://huggingface.co/${modelId}/resolve/${MODEL_REVISION}/${url.slice(mainPrefix.length)}`;
      input = url;
    }
    if (url.startsWith(`https://huggingface.co/${modelId}/`) && pinnedFile(url, modelId) === null) {
      throw new Error(`Model download blocked: ${url} is not the pinned model revision`);
    }
    const file = pinnedFile(url, modelId);
    const res = await base(input, init);
    if (file === null || !res.ok) return res;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    // Do not hash HEAD or range requests (transformers.js uses them e.g. to check the size)
    if (method !== 'GET' || headers.has('Range') || res.status === 206 || !res.body) return res;
    const expected = MODEL_FILES[file];
    if (!expected) throw new Error(`Model download blocked: unexpected file ${file}`);

    const hash = new Sha256();
    const reader = res.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          const got = hash.hex();
          if (got !== expected) {
            controller.error(new Error(`Model file ${file} failed the integrity check (SHA-256 ${got})`));
          } else {
            controller.close();
          }
          return;
        }
        hash.update(value);
        controller.enqueue(value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}
