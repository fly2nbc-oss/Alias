/**
 * NER in a Web Worker (does not block the UI).
 * Model: Xenova/bert-base-multilingual-cased-ner-hrl (quantized, as in the Rust version).
 * Downloaded once from Hugging Face, then taken from the browser cache.
 */
import {
  AutoModelForTokenClassification,
  AutoTokenizer,
  env,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from '@huggingface/transformers';
// ONNX Runtime WASM inlined instead of loaded from the CDN (the app is one HTML file, also under file://).
// CPU-only variant (no WebGPU/JSEP/Asyncify): 14 MB raw, gzip+Base64 ~5 MB.
import ortWasmGz from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?gzb64';
import ortMjsCode from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?raw';
import { MODEL_ID } from './bio';
import { inferEntities } from './infer';
import { integrityFetch, MODEL_REVISION } from './integrity';
import type { WorkerRequest, WorkerResponse } from './protocol';

env.allowLocalModels = false;
env.useBrowserCache = true;
// Pin the model to one commit and check every file by SHA-256 during download
env.fetch = integrityFetch(MODEL_ID);
// transformers.js must not fetch or cache the WASM itself; it is already inlined
env.useWasmCache = false;

/** Provide the inlined ONNX Runtime: unpack the WASM, glue code as Blob URL. */
async function setupOrt(): Promise<void> {
  const wasmEnv = env.backends.onnx.wasm;
  if (!wasmEnv) return;
  const gz = Uint8Array.from(atob(ortWasmGz), (c) => c.charCodeAt(0));
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
  wasmEnv.wasmBinary = await new Response(stream).arrayBuffer();
  // With wasmBinary set, ORT uses locateFile = identity; import.meta.url in the Blob does no harm
  wasmEnv.wasmPaths = {
    mjs: URL.createObjectURL(new Blob([ortMjsCode], { type: 'text/javascript' })),
  };
  // Without crossOriginIsolated (file://, normal web server) there is no SharedArrayBuffer
  if (!self.crossOriginIsolated) wasmEnv.numThreads = 1;
}

let loading: Promise<{ tokenizer: PreTrainedTokenizer; model: PreTrainedModel }> | null = null;

function post(msg: WorkerResponse): void {
  (self as unknown as { postMessage(m: WorkerResponse): void }).postMessage(msg);
}

function load() {
  if (!loading) {
    loading = (async () => {
      await setupOrt();
      const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number; progress?: number }) => {
        if (p.status === 'progress' && p.file) {
          post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0, percent: p.progress ?? 0 });
        }
      };
      const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, { revision: MODEL_REVISION, progress_callback });
      const model = await AutoModelForTokenClassification.from_pretrained(MODEL_ID, {
        revision: MODEL_REVISION,
        dtype: 'q8',
        device: 'wasm',
        progress_callback,
      });
      return { tokenizer, model };
    })();
    loading.catch(() => {
      loading = null; // allow another attempt
    });
  }
  return loading;
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    const { tokenizer, model } = await load();
    if (req.type === 'load') {
      post({ type: 'ready', id: req.id });
      return;
    }
    const onProgress = (done: number, total: number) => post({ type: 'inferProgress', id: req.id, done, total });
    post({ type: 'result', id: req.id, candidates: await inferEntities(tokenizer, model, req.text, onProgress) });
  } catch (e) {
    post({ type: 'error', id: req.id, message: e instanceof Error ? e.message : String(e) });
  }
};
