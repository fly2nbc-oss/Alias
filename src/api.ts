/**
 * App API: formerly Tauri `invoke` into the Rust backend, now a plain browser implementation.
 * Signatures stay mostly the same, so the UI did not have to change.
 * "Paths" are file names here; the file content is in memory.
 */
import { loadStoredJson, pickFile, saveFile, storeJson } from './core/browser-io';
import { detectAll } from './core/detector';
import { makeCopy, type MissedTerm } from './core/file-copy';
import { allExtensions } from './core/formats';
import { loadNer, NerAbortError, nerState, runNer } from './core/ner/client';
import { nerEnabled } from './core/ner/model-cache';
import { parseFile } from './core/parsers';
import { AliasStore, parseStoreExport, readStoreFile } from './core/store';
import { pairs, substitute } from './core/substitute';
import type {
  AliasEntry,
  BulkAddItem,
  Category,
  EntityCandidate,
  ParsedDocument,
  SaveResult,
  SubstitutionResult,
} from './types';

const store = new AliasStore();

/**
 * Opened files (for the copy in the original format): `encode` = the user's own file (step 1),
 * `decode` = the file the AI sent back (step 2).
 */
const sources: Record<'encode' | 'decode', { name: string; bytes: Uint8Array } | null> = { encode: null, decode: null };

function persist(): void {
  storeJson(JSON.stringify(store.toExport()));
}

/**
 * Load the stored table. The smart name finder is not started here: it loads only after the
 * user turned it on (see core/consent.ts), so a fresh start sends no network request.
 */
export function init(): void {
  const json = loadStoredJson();
  if (json) {
    try {
      store.importEntries(parseStoreExport(json));
    } catch (e) {
      console.error('Could not load store:', e);
    }
  }
}

/** Load the NER model (one-time download, then from the browser cache). */
export async function enableNer(): Promise<void> {
  await loadNer().catch(() => {
    /* The state is reported through onNer */
  });
}

// ---------------------------------------------------------------- Files

const ACCEPT = allExtensions()
  .map((e) => `.${e}`)
  .join(',');

/** File dialog (only pick, do not read yet: the caller may ask first). */
export async function pickSourceFile(): Promise<File | null> {
  return pickFile(ACCEPT);
}


/**
 * Read a file. `side` = 'encode': the user's own file (step 1; forgets the AI's file too);
 * 'decode': the file the AI sent back (step 2).
 */
export async function openFile(file: File, side: 'encode' | 'decode' = 'encode'): Promise<ParsedDocument> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = await parseFile(file.name, bytes);
  sources[side] = { name: file.name, bytes };
  if (side === 'encode') sources.decode = null;
  // Unify line endings: the editor works with \n only
  const content = parsed.content.replace(/\r\n?/g, '\n');
  return { content, source_path: file.name, format: parsed.format, writable: parsed.writable };
}

/** Forget the AI's file (the answer was pasted, changed or cleared). */
export function forgetAnswerFile(): void {
  sources.decode = null;
}


export interface SaveCopyResult extends SaveResult {
  /** Terms that were shown but not (fully) replaced in the file */
  missed: MissedTerm[];
  /** Removed or emptied parts (e.g. Office metadata), if reported by makeCopy */
  removed?: string[];
}

/**
 * Copy of an opened file in its original format: `encode` = the user's file with placeholders
 * (cleaned of metadata), `decode` = the AI's file with the real names (not cleaned).
 * `shownText` = shown text of the file; with it the copy reports terms that could not be
 * replaced there (`missed`).
 */
export async function saveFileCopy(
  sourcePath: string,
  mode: 'encode' | 'decode',
  shownText?: string,
): Promise<SaveCopyResult | null> {
  const source = sources[mode];
  if (!source || source.name !== sourcePath) throw new Error('The file is no longer available – open it again.');
  const copy = makeCopy(source.name, source.bytes, mode, pairs(store.entries.values(), mode), shownText);
  const name = await saveFile(copy.name, new Blob([copy.bytes as BlobPart], { type: 'application/octet-stream' }));
  if (!name) return null;
  const extra = copy as { missed?: MissedTerm[]; removed?: unknown };
  return {
    path: name,
    replacements: copy.replacements,
    missed: extra.missed ?? [],
    removed: Array.isArray(extra.removed) ? (extra.removed as string[]) : undefined,
  };
}

export async function saveTextAsDialog(content: string, defaultFileName?: string): Promise<string | null> {
  return saveFile(defaultFileName ?? 'result.txt', new Blob([content], { type: 'text/plain;charset=utf-8' }));
}

// ---------------------------------------------------------------- Detection

export interface NerStatus {
  state: 'idle' | 'loading' | 'ready' | 'error' | 'disabled';
  error?: string;
}

export async function nerStatus(): Promise<NerStatus> {
  // Switched off → rules only, even if the model is still in memory
  return nerEnabled() ? nerState() : { state: 'disabled' };
}

/** How were names found? `used` = with the AI, otherwise rules only (with a reason) */
export type NerUse = 'used' | 'loading' | 'unavailable' | 'disabled' | 'skipped' | 'cancelled';

export interface DetectOptions {
  /** false = rules only (e.g. on request for very large texts) */
  useNer?: boolean;
  /** Progress of the AI detection (chunks) */
  onProgress?: (done: number, total: number) => void;
  /** Cancels the AI detection; the result comes from the rules only */
  signal?: AbortSignal;
}

/** Last run found names with the rules only, because the model was still loading or not available */
let rulesOnlyWhileUnavailable = false;

/** Read and reset: hint "run Detect again" as soon as the model is ready. */
export function takeRulesOnlyFlag(): boolean {
  const v = rulesOnlyWhileUnavailable;
  rulesOnlyWhileUnavailable = false;
  return v;
}

/**
 * Rules + NER. If the model is not loaded yet, only the rules run.
 * Cancelling through `signal` returns the matches of the rules (`ner: 'cancelled'`).
 */
export async function detect(
  text: string,
  opts: DetectOptions = {},
): Promise<{ candidates: EntityCandidate[]; ner: NerUse }> {
  const status = await nerStatus();
  let ner: NerUse;
  let found: Awaited<ReturnType<typeof runNer>> = [];
  if (opts.useNer === false) ner = 'skipped';
  else if (status.state === 'disabled') ner = 'disabled';
  else if (status.state === 'error') ner = 'unavailable';
  else if (status.state !== 'ready') ner = 'loading';
  else {
    try {
      found = await runNer(text, { onProgress: opts.onProgress, signal: opts.signal });
      ner = 'used';
    } catch (e) {
      if (!(e instanceof NerAbortError)) throw e;
      ner = 'cancelled';
    }
  }
  if (ner === 'loading' || ner === 'unavailable') rulesOnlyWhileUnavailable = true;
  return { candidates: detectAll(text, found), ner };
}


// ---------------------------------------------------------------- Alias table

export async function getStore(): Promise<AliasEntry[]> {
  return store.list();
}

export async function addEntry(original: string, alias: string | null, category: Category): Promise<AliasEntry> {
  const e = store.add(original, alias, category);
  persist();
  return e;
}

export async function addEntriesBulk(items: BulkAddItem[]): Promise<AliasEntry[]> {
  const e = store.addBulk(items);
  persist();
  return e;
}

export async function updateEntry(id: string, alias?: string, category?: Category, confirmed?: boolean): Promise<AliasEntry> {
  const e = store.update(id, alias, category, confirmed);
  persist();
  return e;
}

export async function removeEntry(id: string): Promise<void> {
  store.remove(id);
  persist();
}

export async function clearStore(): Promise<void> {
  store.clear();
  persist();
}


export async function encodeText(text: string): Promise<SubstitutionResult> {
  return substitute(text, store.entries.values(), 'encode');
}

export async function decodeText(text: string): Promise<SubstitutionResult> {
  return substitute(text, store.entries.values(), 'decode');
}

/** Stores the table in the browser (localStorage). */
export async function saveStore(): Promise<string> {
  if (!storeJson(JSON.stringify(store.toExport()))) throw new Error('Browser storage is not available');
  return 'browser storage';
}

export async function exportStoreDialog(): Promise<string | null> {
  const json = JSON.stringify(store.toExport(), null, 2);
  return saveFile('alias_store.json', new Blob([json], { type: 'application/json' }));
}

export async function importStoreDialog(): Promise<AliasEntry[] | null> {
  const file = await pickFile('.json,application/json');
  if (!file) return null;
  store.importEntries(parseStoreExport(await readStoreFile(file)));
  persist();
  return store.list();
}
