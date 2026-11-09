import type { Candidate } from '../candidate';

export type WorkerRequest = { type: 'load'; id: number } | { type: 'infer'; id: number; text: string };

export type WorkerResponse =
  | { type: 'progress'; file: string; loaded: number; total: number; percent: number }
  /** Inference progress: `done` of `total` chunks finished */
  | { type: 'inferProgress'; id: number; done: number; total: number }
  | { type: 'ready'; id: number }
  | { type: 'result'; id: number; candidates: Candidate[] }
  | { type: 'error'; id: number; message: string };
