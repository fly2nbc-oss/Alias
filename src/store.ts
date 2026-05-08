import type { AliasEntry, AppMode, EntityCandidate } from './types';

export interface AppState {
  mode: AppMode;
  originalText: string;
  processedText: string;
  sourcePath: string | null;
  sourceFormat: string | null;
  aliasEntries: AliasEntry[];
  candidates: EntityCandidate[];
  showCandidateReview: boolean;
  isProcessing: boolean;
  replacementCount: number;
}

type Listener = () => void;

const state: AppState = {
  mode: 'encode',
  originalText: '',
  processedText: '',
  sourcePath: null,
  sourceFormat: null,
  aliasEntries: [],
  candidates: [],
  showCandidateReview: false,
  isProcessing: false,
  replacementCount: 0,
};

const listeners: Set<Listener> = new Set();

export function getState(): Readonly<AppState> {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  Object.assign(state, patch);
  notify();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  listeners.forEach(fn => fn());
}
