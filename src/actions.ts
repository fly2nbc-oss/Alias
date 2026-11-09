/**
 * What the buttons and keys do: open, find names, hide names, paste the AI's answer,
 * bring the names back, copy and save. The rules (allowed or not, and why) are in workflow.ts.
 */
import * as api from './api';
import { askChoice } from './components/choice-dialog';
import { closeNewestStickyHint, showToast } from './components/notification';
import { emptyDoc, getState, hasAnyText, normalizeText, setDoc, setState, showingResult, visibleText } from './store';
import type { AppMode } from './types';
import { actionStates, primary, statsOf, type ActionId, type ActionState, type PrimaryId } from './workflow';

/** Ask before running the AI on texts from this length (measured: about 1.1 s per KB) */
const LARGE_TEXT_CHARS = 30_000;
const NER_SECONDS_PER_KB = 1.1;

/** Running search (for Stop / Esc) */
let detectAbort: AbortController | null = null;

export const isFinding = (): boolean => detectAbort !== null;

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function states(): Record<ActionId, ActionState> {
  const s = getState();
  return actionStates(s, statsOf(s));
}

/** Not allowed right now? Then say why (for clicks on greyed-out buttons and for keys). */
function blocked(id: ActionId): boolean {
  const st = states()[id];
  if (!st.enabled) showToast(st.title, 'info');
  return !st.enabled;
}

function focusEditor(): void {
  document.getElementById('text-editor')?.focus();
}

// ---------------------------------------------------------------- Open

/** Load a file: ask first if there is text; afterwards its text is in step 1, results are reset. */
export async function openDocumentFile(file: File, note = ''): Promise<void> {
  if (blocked('open')) return;
  if (hasAnyText()) {
    const ok = await askChoice('Replace text?', `Replace the current text with "${file.name}"?`, [
      { value: 'replace', label: 'Replace', primary: true },
    ]);
    if (ok !== 'replace') return;
  }
  try {
    const doc = await api.openFile(file);
    setState({
      mode: 'encode',
      docs: { encode: emptyDoc(doc.content), decode: emptyDoc() },
      sourcePath: doc.source_path,
      sourceFormat: doc.format,
      sourceWritable: doc.writable,
      sourceText: doc.content,
      answerFile: null,
      dirty: false,
    });
    if (!doc.content.trim()) showToast(`${file.name} contains no readable text (a scanned PDF or an image?).`, 'info');
    else if (note) showToast(`Opened ${file.name}${note}`, 'info');
    focusEditor();
  } catch (e: unknown) {
    showToast(`Could not open ${file.name}: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

/**
 * Load the file the AI sent back as the answer in step 2: its text is shown with the placeholders
 * marked; its bytes stay in memory for the copy with the real names.
 */
export async function openAnswerFile(file: File, note = ''): Promise<void> {
  if (blocked('openAnswer')) return;
  const d = getState().docs.decode;
  if (d.input.trim() || d.result?.trim()) {
    const ok = await askChoice("Replace the AI's answer?", `Replace the AI's answer in step 2 with "${file.name}"?`, [
      { value: 'replace', label: 'Replace', primary: true },
    ]);
    if (ok !== 'replace') return;
  }
  try {
    const doc = await api.openFile(file, 'decode');
    const s = getState();
    setState({
      mode: 'decode',
      docs: { ...s.docs, decode: emptyDoc(doc.content) },
      answerFile: { path: doc.source_path, format: doc.format, writable: doc.writable, text: doc.content },
      dirty: true,
    });
    if (!doc.content.trim()) showToast(`${file.name} contains no readable text (a scanned PDF or an image?).`, 'info');
    else if (note) showToast(`Opened ${file.name}${note}`, 'info');
    focusEditor();
  } catch (e: unknown) {
    showToast(`Could not open ${file.name}: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

/** A file dropped onto the window: in step 2 it is the AI's file, in step 1 the user's own. */
export async function openDroppedFile(file: File, note = ''): Promise<void> {
  if (getState().mode === 'decode') await openAnswerFile(file, note);
  else await openDocumentFile(file, note);
}

/** Open (button, Ctrl+O): in step 2 the AI's file, in step 1 the user's own file. */
export async function openViaDialog(): Promise<void> {
  if (getState().mode === 'decode') {
    await openAnswerViaDialog();
    return;
  }
  if (blocked('open')) return;
  try {
    const file = await api.pickSourceFile();
    if (file) await openDocumentFile(file);
  } catch (e: unknown) {
    showToast(`Could not open the file: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

/** Open AI's file: pick the file the AI sent back and show it in step 2 (any supported format). */
export async function openAnswerViaDialog(): Promise<void> {
  if (getState().isProcessing || blocked('openAnswer')) return;
  try {
    const file = await api.pickSourceFile();
    if (file) await openAnswerFile(file);
  } catch (e: unknown) {
    showToast(`Could not open the file: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

// ---------------------------------------------------------------- Find names

export async function runFind(): Promise<void> {
  if (getState().isProcessing || blocked('find')) return;
  const text = visibleText();
  let useNer = true;
  const ner = await api.nerStatus();
  if (text.length >= LARGE_TEXT_CHARS && (ner.state === 'ready' || ner.state === 'loading')) {
    const kb = Math.round(text.length / 1000);
    const minutes = Math.max(1, Math.round((kb * NER_SECONDS_PER_KB) / 60));
    const choice = await askChoice(
      'Long text',
      `This text is long (${kb} KB). The smart name finder may need ${minutes < 2 ? 'about a minute' : `about ${minutes} minutes`}. ` +
        'The simple rules (emails, phone numbers, IBANs, dates, known names …) are done at once. You can stop the smart finder while it runs.',
      [
        { value: 'rules', label: 'Simple rules only' },
        { value: 'continue', label: 'Use the smart finder', primary: true },
      ],
    );
    if (!choice) return;
    useNer = choice === 'continue';
  }

  const ctrl = new AbortController();
  detectAbort = ctrl;
  setState({ isProcessing: true, detectProgress: null });
  try {
    const { candidates, ner: used } = await api.detect(text, {
      useNer,
      signal: ctrl.signal,
      onProgress: (done, total) => setState({ detectProgress: { done, total } }),
    });
    if (used === 'cancelled') showToast('Stopped. Alias shows what the simple rules found.', 'info');
    else if (used === 'loading') showToast('The smart name finder is still loading – this time Alias used simple rules.', 'info', 6000);
    else if (used === 'unavailable') showToast('The smart name finder is not available – Alias used simple rules.', 'info', 6000);
    if (candidates.length === 0) showToast('No names found in this text. You can add names by hand with Add name.', 'info');
    else setState({ originalText: text, candidates, showCandidateReview: true });
  } catch (e: unknown) {
    showToast(`Could not look for names: ${e instanceof Error ? e.message : String(e)}`, 'error');
  } finally {
    detectAbort = null;
    setState({ isProcessing: false, detectProgress: null });
  }
}

export function cancelFind(): void {
  detectAbort?.abort();
}

// ---------------------------------------------------------------- Steps

/** Switch between 1 · My text and 2 · AI's answer (step 2 stays locked until the names are hidden). */
export function goStep(mode: AppMode): void {
  if (getState().mode === mode) return;
  if (blocked(mode === 'encode' ? 'step1' : 'step2')) return;
  setState({ mode });
  focusEditor();
}

/**
 * Hide names (encode) or bring them back (decode) in the visible text.
 * From the other step, the key switches there first.
 */
export async function runTransform(kind: AppMode): Promise<void> {
  const s = getState();
  if (s.isProcessing) return;
  if (s.mode !== kind) {
    goStep(kind);
    return;
  }
  if (blocked(kind === 'encode' ? 'hide' : 'bringBack')) return;
  try {
    const text = visibleText();
    const r = kind === 'encode' ? await api.encodeText(text) : await api.decodeText(text);
    if (r.replacements_made === 0) {
      showToast(kind === 'encode' ? 'Nothing to hide – none of the names in the list are in this text.' : 'No placeholders from the list in this text.', 'info');
      return;
    }
    setDoc({ result: r.text, replacements: r.replacements_made, copied: false, saved: false, missed: 0 }, kind, { dirty: true });
    await api.saveStore();
  } catch (e: unknown) {
    showToast(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

/**
 * Change text / Change answer: back to the editable input (the result is dropped, the input stays).
 * Change answer also forgets the AI's file: the answer is plain text from now on.
 */
export function editInput(): void {
  const decode = getState().mode === 'decode';
  if (decode) api.forgetAnswerFile();
  setDoc({ result: null, replacements: 0, copied: false, saved: false, missed: 0 }, undefined, decode ? { answerFile: null } : {});
  focusEditor();
}

/** Take a text as the AI's answer in step 2 (an AI's file opened before is forgotten). */
export function pasteAsAnswer(text: string): void {
  if (blocked('pasteAnswer')) return;
  api.forgetAnswerFile();
  setDoc({ ...emptyDoc(normalizeText(text)) }, 'decode', { mode: 'decode', answerFile: null, dirty: true });
  focusEditor();
}

/**
 * Paste AI's answer: go to step 2 and paste from the clipboard. If the browser does not allow
 * reading the clipboard, go to step 2 and ask for Ctrl+V.
 */
export async function pasteAnswerFromClipboard(): Promise<void> {
  if (getState().isProcessing || blocked('pasteAnswer')) return;
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch {
    text = '';
  }
  if (text.trim()) {
    pasteAsAnswer(text);
    return;
  }
  setState({ mode: 'decode' });
  focusEditor();
  showToast("Press Ctrl+V to paste the AI's answer here.", 'info');
}

// ---------------------------------------------------------------- Copy and save

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback (e.g. without clipboard permission): through a hidden text field
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('Clipboard not available');
  }
}

export async function copyVisible(): Promise<void> {
  if (getState().isProcessing || blocked('copy')) return;
  const s = getState();
  try {
    await writeClipboard(visibleText(s));
    // The status bar says "Copied"; only a copy of an unfinished text gets a hint
    if (showingResult(s)) setDoc({ copied: true, saved: false, missed: 0 }, s.mode, { dirty: false });
    else showToast('Copied.', 'success');
  } catch (e: unknown) {
    showToast(`Could not copy: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

/** Places shown here but not replaced in the copy */
const missedPlaces = (missed: api.SaveCopyResult['missed']) => missed.reduce((n, m) => n + Math.max(0, m.shown - m.replaced), 0);

/**
 * Copy in the original format: step 1 (`encode`) = the user's file with placeholders, for the AI;
 * step 2 (`decode`) = the AI's file with the real names. Counts as handed over (`copied`).
 */
export async function saveFileCopy(mode: AppMode = getState().mode): Promise<void> {
  if (getState().mode !== mode) {
    goStep(mode);
    return;
  }
  if (blocked('saveCopy')) return;
  const s = getState();
  const enc = mode === 'encode';
  const path = enc ? s.sourcePath! : s.answerFile!.path;
  const opened = enc ? s.sourceText : s.answerFile!.text;
  const name = fileName(path);
  if (opened !== null && s.docs[mode].input !== opened) {
    const ok = await askChoice(
      'The text was changed',
      `You changed the text after opening it. The copy is made from the file "${name}" itself – your changes in Alias are not in it.`,
      [{ value: 'save', label: 'Save copy', primary: true }],
    );
    if (ok !== 'save') return;
  }
  try {
    const out = await api.saveFileCopy(path, mode, opened ?? undefined);
    if (!out) return;
    const saved = fileName(out.path);
    const missed = missedPlaces(out.missed);
    setDoc({ copied: true, saved: true, missed }, mode, { dirty: false });
    if (out.missed.length > 0) {
      const sample = out.missed
        .slice(0, 3)
        .map((m) => `"${m.original.replace(/\s+/g, ' ')}"`)
        .join(', ');
      const more = out.missed.length > 3 ? ', …' : '';
      showToast(
        enc
          ? `Saved ${saved}, but ${missed} place${missed === 1 ? ' was' : 's were'} shown here and not hidden in the file (e.g. date cells in Excel): ` +
              `${sample}${more}. Check the copy before you share it.`
          : `Saved ${saved}, but ${missed} placeholder${missed === 1 ? ' was' : 's were'} not replaced in the file: ${sample}${more}. ` +
              'Check the file – the AI may have changed them.',
        'warning',
      );
    } else if (out.replacements === 0) {
      showToast(
        enc
          ? `Saved ${saved}, but nothing was hidden – none of the names in the list are in the file.`
          : `Saved ${saved}, but no names came back – there are no placeholders from the list in the file.`,
        'warning',
      );
    } else {
      showToast(`Saved ${saved} – ${enc ? 'names hidden' : 'names back'} in ${out.replacements} place${out.replacements === 1 ? '' : 's'}.`, 'success');
    }
    if (out.removed?.length) showToast(`Also removed from the copy: ${out.removed.join(', ')}`, 'info', 7000);
  } catch (e: unknown) {
    showToast(`Could not save: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

export async function saveText(): Promise<void> {
  if (blocked('saveText')) return;
  const s = getState();
  const result = showingResult(s);
  const from = s.mode === 'decode' && s.answerFile ? s.answerFile.path : s.sourcePath;
  const stem = from ? fileName(from).replace(/\.[^.]+$/, '') : 'alias-text';
  // File suffixes stay as in earlier versions (_encoded / _decoded)
  const suffix = result ? (s.mode === 'encode' ? '_encoded' : '_decoded') : '';
  try {
    const path = await api.saveTextAsDialog(visibleText(s), `${stem}${suffix}.txt`);
    if (!path) return;
    if (result) setDoc({ copied: true, saved: true, missed: 0 }, s.mode, { dirty: false });
    else setState({ dirty: false });
    showToast(`Saved ${fileName(path)}.`, 'success');
  } catch (e: unknown) {
    showToast(`Could not save: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

// ---------------------------------------------------------------- The one main button

const RUN: Record<PrimaryId, () => unknown> = {
  open: openViaDialog,
  find: runFind,
  hide: () => runTransform('encode'),
  copyForAi: copyVisible,
  saveForAi: () => saveFileCopy('encode'),
  pasteAnswer: pasteAnswerFromClipboard,
  openAnswer: openAnswerViaDialog,
  bringBack: () => runTransform('decode'),
  copy: copyVisible,
  saveFile: () => saveFileCopy('decode'),
};

export function runPrimary(): void {
  const s = getState();
  if (s.isProcessing) return;
  const p = primary(s, statsOf(s));
  if (!p.enabled) {
    showToast(p.title, 'info');
    return;
  }
  void RUN[p.id]();
}

// ---------------------------------------------------------------- Keys

const dialogOpen = () =>
  !!document.querySelector('dialog[open], .modal-overlay') || !document.getElementById('modal-overlay')?.classList.contains('hidden');

export function initShortcuts(): void {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && detectAbort) {
      cancelFind();
      return;
    }
    if (dialogOpen() || e.defaultPrevented) return;
    if (e.key === 'Escape' && !document.querySelector('#save-menu:not(.hidden)')) {
      if (closeNewestStickyHint()) e.preventDefault();
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    let act: (() => unknown) | null = null;
    if (ctrl && !e.shiftKey && !e.altKey && e.key === 'Enter') act = runPrimary;
    else if (ctrl && !e.shiftKey && !e.altKey && e.code === 'KeyO') act = openViaDialog;
    else if (ctrl && e.shiftKey && !e.altKey) {
      act = { KeyD: runFind, KeyE: () => runTransform('encode'), KeyU: () => runTransform('decode') }[e.code] ?? null;
    } else if (e.altKey && !ctrl && !e.shiftKey) {
      act = { Digit1: () => goStep('encode'), Digit2: () => goStep('decode') }[e.code] ?? null;
    }
    if (!act) return;
    e.preventDefault();
    void act();
  });
}
