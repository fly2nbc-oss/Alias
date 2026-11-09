/** Main-thread side of the NER worker: loading, status, progress, cancel. */
import type { Candidate } from '../candidate';
import { MODEL_REVISION } from './integrity';
// Worker as inlined code (Blob URL): under file:// no separate file may be loaded
import NerWorker from './worker?worker&inline';
import type { WorkerRequest, WorkerResponse } from './protocol';

export type NerState = 'idle' | 'loading' | 'ready' | 'error';

export interface NerProgress {
  file: string;
  loaded: number;
  total: number;
  percent: number;
  /** true = the model is really loaded from the network (not from the browser cache) */
  fromNetwork: boolean;
}

type Listener = {
  progress?: (p: NerProgress) => void;
  state?: (s: NerState, error?: string) => void;
};

/** Error when a running detection is cancelled (`name === 'AbortError'`) */
export class NerAbortError extends Error {
  constructor() {
    super('NER cancelled');
    this.name = 'AbortError';
  }
}

interface Pending {
  resolve: (v: Candidate[]) => void;
  reject: (e: Error) => void;
  onProgress?: (done: number, total: number) => void;
}

let worker: Worker | null = null;
let state: NerState = 'idle';
let lastError: string | undefined;
let nextId = 1;
let loadPromise: Promise<void> | null = null;
/** Counter per worker instance: answers and errors of a terminated worker are ignored */
let generation = 0;
/** Is the model fetched from the network in the current load? (checked beforehand via Cache API) */
let fromNetwork = false;
const pending = new Map<number, Pending>();
const listeners = new Set<Listener>();

/** Cache name of transformers.js (`env.cacheKey`, default; as in model-cache.ts) */
const CACHE_NAME = 'transformers-cache';

function setNerState(s: NerState, err?: string): void {
  state = s;
  lastError = err;
  listeners.forEach((l) => l.state?.(s, err));
}

/** Is the ONNX model already in the browser cache? (unknown -> treat as download) */
async function modelCached(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    if (!(await caches.has(CACHE_NAME))) return false;
    const keys = await (await caches.open(CACHE_NAME)).keys();
    // Only the pinned revision counts (old `resolve/main` entries are not used)
    return keys.some((r) => r.url.includes(MODEL_REVISION) && /\.onnx(?:$|\?)/.test(r.url));
  } catch {
    return false;
  }
}

function getWorker(): Worker {
  if (!worker) {
    const gen = ++generation;
    const w = new NerWorker();
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      if (gen !== generation) return;
      const msg = ev.data;
      if (msg.type === 'progress') {
        const p: NerProgress = { ...msg, fromNetwork };
        listeners.forEach((l) => l.progress?.(p));
        return;
      }
      if (msg.type === 'inferProgress') {
        pending.get(msg.id)?.onProgress?.(msg.done, msg.total);
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg.type === 'result' ? msg.candidates : []);
    };
    w.onerror = (ev) => {
      if (gen !== generation) return;
      const err = new Error(ev.message || 'NER worker failed');
      pending.forEach((p) => p.reject(err));
      pending.clear();
      worker = null;
      loadPromise = null;
      setNerState('error', err.message);
    };
    worker = w;
  }
  return worker;
}

type RequestBody = { type: 'load' } | { type: 'infer'; text: string };

function request(req: RequestBody, onProgress?: Pending['onProgress']): Promise<Candidate[]> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ ...req, id } as WorkerRequest);
  });
}

export function onNer(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function nerState(): { state: NerState; error?: string } {
  return { state, error: lastError };
}

/** Load the model (download the first time). Repeated calls share one load. */
export function loadNer(): Promise<void> {
  if (!loadPromise) {
    setNerState('loading');
    loadPromise = (async () => {
      fromNetwork = !(await modelCached());
      await request({ type: 'load' });
    })().then(
      () => setNerState('ready'),
      (e: Error) => {
        // Cancel (worker terminated) is not a load error; the restart sets the status itself
        if (e instanceof NerAbortError) throw e;
        loadPromise = null;
        setNerState('error', e.message);
        throw e;
      },
    );
  }
  return loadPromise;
}


/**
 * Cancel a running inference: terminate and restart the worker (the model then comes from the
 * browser cache, ~2 s). Open requests end with `NerAbortError`.
 */
export function cancelNer(): void {
  if (!worker) return;
  generation++; // ignore messages of the old worker
  worker.terminate();
  worker = null;
  loadPromise = null;
  const err = new NerAbortError();
  pending.forEach((p) => p.reject(err));
  pending.clear();
  void loadNer().catch(() => {
    /* status is reported via onNer */
  });
}

export interface RunNerOptions {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Run NER on the text. Returns empty if the model is not available;
 * throws `NerAbortError` if cancelled via `signal`.
 */
export async function runNer(text: string, opts: RunNerOptions = {}): Promise<Candidate[]> {
  const { signal, onProgress } = opts;
  if (signal?.aborted) throw new NerAbortError();
  try {
    await loadNer();
    if (signal?.aborted) throw new NerAbortError();
    const job = request({ type: 'infer', text }, onProgress);
    const onAbort = () => cancelNer();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await job;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  } catch (e) {
    if (e instanceof NerAbortError) throw e;
    console.warn('[ner] not available:', e);
    return [];
  }
}
