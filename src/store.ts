import type { AliasEntry, AppMode, EntityCandidate } from './types';

/**
 * Content of a work step (encode or decode).
 * Visible is always `result` if there is one (read-only), else `input` (editable).
 */
export interface DocState {
  /** Input: original text (encode) or the AI's answer with placeholders (decode) */
  input: string;
  /** Result of the last run; `null` = the input is shown */
  result: string | null;
  /** Replacements in the current result */
  replacements: number;
  /** Result was copied or saved */
  copied: boolean;
}

export interface AppState {
  /** Active step (tabs "1 · My text | 2 · AI's answer") */
  mode: AppMode;
  docs: Record<AppMode, DocState>;
  /** Opened file (name) */
  sourcePath: string | null;
  sourceFormat: string | null;
  sourceWritable: boolean;
  /** Shown text of the opened file (basis for the copy in the original format) */
  sourceText: string | null;
  aliasEntries: AliasEntry[];
  /**
   * Text that `candidates` (offsets) refer to: the visible text at the last Detect.
   * Not the editor content: use `visibleText()` for that.
   */
  originalText: string;
  candidates: EntityCandidate[];
  showCandidateReview: boolean;
  /** Processing is running (buttons locked) */
  isProcessing: boolean;
  /** Progress of the AI detection (chunks) during Detect */
  detectProgress: { done: number; total: number } | null;
  /** Unsaved changes (warning when leaving the page) */
  dirty: boolean;
  /** First start: the choice card (smart name finder, update check) is shown and nothing loads */
  firstRun: boolean;
  /** Smart name finder (AI model): off until the user turns it on */
  finder: FinderState;
  /** Error text when the finder could not be loaded */
  finderError: string | null;
  /** Download progress of the finder in bytes while it comes from the network */
  finderDownload: { loaded: number; total: number } | null;
}

export type FinderState = 'off' | 'loading' | 'ready' | 'error';

type Listener = () => void;

export const emptyDoc = (input = ''): DocState => ({ input, result: null, replacements: 0, copied: false });

const state: AppState = {
  mode: 'encode',
  docs: { encode: emptyDoc(), decode: emptyDoc() },
  sourcePath: null,
  sourceFormat: null,
  sourceWritable: false,
  sourceText: null,
  aliasEntries: [],
  originalText: '',
  candidates: [],
  showCandidateReview: false,
  isProcessing: false,
  detectProgress: null,
  dirty: false,
  firstRun: false,
  finder: 'off',
  finderError: null,
  finderDownload: null,
};

const listeners: Set<Listener> = new Set();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

export function getState(): Readonly<AppState> {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  Object.assign(state, patch);
  notify();
}

/** Change the current (or given) step. */
export function setDoc(patch: Partial<DocState>, mode: AppMode = state.mode, extra: Partial<AppState> = {}): void {
  setState({ ...extra, docs: { ...state.docs, [mode]: { ...state.docs[mode], ...patch } } });
}

/**
 * Take over the input while typing without redrawing all components at once
 * (the notification follows batched, so large texts do not stutter).
 */
export function setInputQuiet(text: string, delayMs = 150): void {
  const d = state.docs[state.mode];
  state.docs = { ...state.docs, [state.mode]: { ...d, input: text } };
  state.dirty = true;
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(notify, delayMs);
}

/** Current step */
export function currentDoc(s: Readonly<AppState> = state): DocState {
  return s.docs[s.mode];
}

/** The text visible in the editor: basis for Detect, Encode, Decode, Copy and Save text. */
export function visibleText(s: Readonly<AppState> = state): string {
  const d = currentDoc(s);
  return d.result ?? d.input;
}

/** Is a (read-only) result shown right now? */
export function showingResult(s: Readonly<AppState> = state): boolean {
  return currentDoc(s).result !== null;
}

/** Is there text anywhere (input or result)? */
export function hasAnyText(s: Readonly<AppState> = state): boolean {
  return (['encode', 'decode'] as const).some((m) => !!s.docs[m].input.trim() || !!s.docs[m].result?.trim());
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  if (notifyTimer) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  listeners.forEach(fn => fn());
}

/** Unify line endings (Windows/Mac to \n) */
export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}
