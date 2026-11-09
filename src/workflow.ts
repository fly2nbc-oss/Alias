/**
 * Workflow rules without DOM: which step comes next, which actions are allowed (and why not),
 * and what the status bar says. Toolbar, text panel and status bar only render these results.
 */
import { extensionOf } from './core/formats';
import type { AppState } from './store';
import { matchStats } from './utils/highlight';

/** Names (distinct entries) and places (matches) of the alias table in the visible text */
export interface MatchStats {
  names: number;
  places: number;
}

export const SHORTCUT = {
  primary: 'Ctrl+Enter',
  open: 'Ctrl+O',
  find: 'Ctrl+Shift+D',
  hide: 'Ctrl+Shift+E',
  bringBack: 'Ctrl+Shift+U',
  paste: 'Ctrl+V',
  step1: 'Alt+1',
  step2: 'Alt+2',
} as const;

export type PrimaryId = 'open' | 'find' | 'hide' | 'copyForAi' | 'pasteAnswer' | 'bringBack' | 'copy';

export interface ActionState {
  enabled: boolean;
  /** Tooltip: what the action does, or why it is not possible right now */
  title: string;
}

export interface Primary extends ActionState {
  id: PrimaryId;
  label: string;
}

export type ActionId =
  | 'open'
  | 'find'
  | 'hide'
  | 'bringBack'
  | 'copy'
  | 'save'
  | 'saveCopy'
  | 'saveText'
  | 'step1'
  | 'step2'
  | 'pasteAnswer';

export const PRIMARY_LABEL: Record<PrimaryId, string> = {
  open: 'Open file',
  find: 'Find names',
  hide: 'Hide names',
  copyForAi: 'Copy for AI',
  pasteAnswer: "Paste AI's answer",
  bringBack: 'Bring names back',
  copy: 'Copy',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

const has = (t: string | null | undefined) => !!t && t.trim().length > 0;

/** Text of the active step that is shown in the editor */
function visible(s: Readonly<AppState>): string {
  const d = s.docs[s.mode];
  return d.result ?? d.input;
}

function confirmedCount(s: Readonly<AppState>): number {
  return s.aliasEntries.filter((e) => e.confirmed && e.original && e.alias).length;
}

/**
 * Direction of the search in the visible text: own text and restored answer hold names,
 * hidden text and the AI's answer hold placeholders.
 */
export function searchMode(s: Readonly<AppState>): 'encode' | 'decode' {
  const result = s.docs[s.mode].result !== null;
  return (s.mode === 'encode') !== result ? 'encode' : 'decode';
}

/** Names and places of the table in the visible text */
export function statsOf(s: Readonly<AppState>): MatchStats {
  return matchStats(visible(s), s.aliasEntries, searchMode(s));
}

const WAIT = 'Please wait – Alias is looking for names.';
const FIRST_RUN = 'Choose what Alias may download first, then click Start.';

/**
 * Step 2 is open once the names in step 1 are hidden. A returning user without own text but with
 * names in the list may go there directly (to bring the names back into an answer from earlier).
 */
export function step2State(s: Readonly<AppState>): ActionState {
  if (s.firstRun) return { enabled: false, title: FIRST_RUN };
  if (s.isProcessing) return { enabled: false, title: WAIT };
  const enc = s.docs.encode;
  const open = s.mode === 'decode' || enc.result !== null || (!has(enc.input) && confirmedCount(s) > 0);
  if (open) return { enabled: true, title: `2 · AI's answer: paste the AI's answer here and bring the names back (${SHORTCUT.step2})` };
  return {
    enabled: false,
    title: !has(enc.input)
      ? 'First open or paste a text and hide the names in it.'
      : confirmedCount(s) === 0
        ? 'First find and hide the names in your text.'
        : 'First hide the names in your text.',
  };
}

export function actionStates(s: Readonly<AppState>, m: MatchStats): Record<ActionId, ActionState> {
  const busy = s.isProcessing;
  const d = s.docs[s.mode];
  const text = visible(s);
  const empty = !has(text);
  const result = d.result !== null;
  const enc = s.mode === 'encode';
  const wait: ActionState = { enabled: false, title: WAIT };
  const first: ActionState = { enabled: false, title: FIRST_RUN };
  const gate = (st: ActionState): ActionState => (s.firstRun ? first : busy ? wait : st);

  const open = gate({ enabled: true, title: `Open a Word, Excel, PowerPoint, PDF or text file – or drop it onto the window (${SHORTCUT.open})` });

  const find = gate(
    !enc
      ? { enabled: false, title: "Not needed for the AI's answer – Alias brings back the names from the list." }
      : empty
        ? { enabled: false, title: 'Open a file or paste a text first.' }
        : result
          ? { enabled: false, title: 'The names are hidden. Click Change text in the status bar to edit the text again.' }
          : { enabled: true, title: `Look for names, companies, addresses, emails … in your text (${SHORTCUT.find})` },
  );

  const noNames = confirmedCount(s) === 0
    ? 'No names in the list yet. Click Find names first.'
    : 'None of the names in the list are in this text. Click Find names.';
  let hide: ActionState;
  if (!enc) hide = { enabled: true, title: `Go to 1 · My text (${SHORTCUT.hide})` };
  else if (empty) hide = { enabled: false, title: 'Open a file or paste a text first.' };
  else if (result) hide = { enabled: false, title: 'The names are already hidden.' };
  else if (m.places === 0) hide = { enabled: false, title: noNames };
  else hide = { enabled: true, title: `Swap the names for placeholders like Person-1 (${SHORTCUT.hide})` };
  hide = gate(hide);

  const step2 = step2State(s);
  let bringBack: ActionState;
  if (enc) bringBack = step2.enabled ? { enabled: true, title: `Go to 2 · AI's answer (${SHORTCUT.bringBack})` } : step2;
  else if (empty) bringBack = { enabled: false, title: "Paste the AI's answer first." };
  else if (result) bringBack = { enabled: false, title: 'The names are already back.' };
  else if (m.places === 0) bringBack = { enabled: false, title: "No placeholders like Person-1 in this answer – check that you pasted the AI's answer." };
  else bringBack = { enabled: true, title: `Swap the placeholders for the real names (${SHORTCUT.bringBack})` };
  bringBack = gate(bringBack);

  const copy = gate(
    empty
      ? { enabled: false, title: 'Nothing to copy yet.' }
      : {
          enabled: true,
          title: result
            ? enc
              ? 'Copy the text with placeholders for your AI'
              : 'Copy the answer with the real names'
            : 'Copy the text shown',
        },
  );

  const ext = s.sourcePath ? extensionOf(s.sourcePath) : '';
  let saveCopy: ActionState;
  if (!s.sourcePath) saveCopy = { enabled: false, title: 'Open a file first (Word, Excel, PowerPoint, OpenDocument or text).' };
  else if (!s.sourceWritable) saveCopy = { enabled: false, title: `.${ext} files can't be written back – save the text instead.` };
  else if (s.docs.encode.result === null) saveCopy = { enabled: false, title: `Hide the names first – then save a copy of ${fileName(s.sourcePath)}.` };
  else saveCopy = { enabled: true, title: `Copy of ${fileName(s.sourcePath)} in its original format, with placeholders instead of the names` };
  saveCopy = gate(saveCopy);

  const saveText = gate(empty ? { enabled: false, title: 'Nothing to save yet.' } : { enabled: true, title: 'Save the text shown as a .txt file' });
  const save = saveCopy.enabled || saveText.enabled
    ? { enabled: true, title: 'Save a copy of the opened file or the text shown' }
    : gate({ enabled: false, title: 'Nothing to save yet.' });

  const step1 = gate({ enabled: true, title: `1 · My text: your own text with the real names (${SHORTCUT.step1})` });

  const pasteAnswer = s.firstRun ? first : busy ? wait : step2.enabled
    ? { enabled: true, title: `Go to step 2 and paste the AI's answer from the clipboard (${SHORTCUT.primary} or ${SHORTCUT.paste})` }
    : step2;

  return { open, find, hide, bringBack, copy, save, saveCopy, saveText, step1, step2, pasteAnswer };
}

/** The one highlighted button: it always names the next step. */
export function nextStep(s: Readonly<AppState>, m: MatchStats): PrimaryId {
  const d = s.docs[s.mode];
  const empty = !has(visible(s));
  if (s.mode === 'encode') {
    if (s.firstRun || empty) return 'open';
    if (d.result === null) return m.places > 0 ? 'hide' : 'find';
    return d.copied ? 'pasteAnswer' : 'copyForAi';
  }
  if (empty) return 'pasteAnswer';
  if (d.result === null) return 'bringBack';
  return 'copy';
}

export function primary(s: Readonly<AppState>, m: MatchStats): Primary {
  const id = nextStep(s, m);
  const a = actionStates(s, m);
  const st: ActionState = {
    open: a.open,
    find: a.find,
    hide: a.hide,
    copyForAi: { ...a.copy, title: `${a.copy.title} (${SHORTCUT.primary})` },
    pasteAnswer: a.pasteAnswer,
    bringBack: a.bringBack,
    copy: { ...a.copy, title: `${a.copy.title} (${SHORTCUT.primary})` },
  }[id];
  return { id, label: PRIMARY_LABEL[id], ...st };
}

// ---------------------------------------------------------------- Status bar

export type TagKind = 'ok' | 'info' | 'warn';
export type TagIcon = 'search' | 'eyeOff' | 'eye' | 'check' | 'paste' | 'alert';

export interface Status {
  tag: { kind: TagKind; icon: TagIcon; text: string } | null;
  /** One sentence in plain words: what happened and what to do next */
  say: string;
  /** Name of the opened file */
  file: string | null;
  /** Text is locked (result shown); the link label goes back to editing */
  lock: { link: string } | null;
}

export function statusOf(s: Readonly<AppState>, m: MatchStats): Status {
  const d = s.docs[s.mode];
  const file = s.sourcePath ? fileName(s.sourcePath) : null;
  const base = { file, lock: null, tag: null };
  if (s.firstRun) return { ...base, file: null, say: 'Hi! Choose what Alias may download, then start.' };
  if (s.isProcessing) {
    const p = s.detectProgress;
    return {
      ...base,
      tag: { kind: 'info', icon: 'search', text: 'Looking for names…' },
      say: p && p.total > 1 ? `Part ${p.done} of ${p.total}. Press Esc to stop.` : 'Press Esc to stop.',
    };
  }
  if (s.showCandidateReview) return { ...base, say: 'Done looking. Check the names.' };
  const empty = !has(visible(s));
  if (s.mode === 'encode') {
    if (empty) return { ...base, say: 'Hi! Open a file or paste a text to start.' };
    if (d.result === null) {
      if (m.places === 0) return { ...base, say: 'Now let Alias find the names in your text.' };
      return {
        ...base,
        tag: { kind: 'info', icon: 'search', text: `${plural(m.names, 'name')} found` },
        say: 'Check them on the right. Then hide them.',
      };
    }
    const lock = { link: 'Change text' };
    if (d.copied) return { ...base, lock, tag: { kind: 'ok', icon: 'check', text: 'Copied' }, say: "Paste it into the AI. Then copy the AI's answer." };
    return {
      ...base,
      lock,
      tag: { kind: 'ok', icon: 'eyeOff', text: `${plural(m.names, 'name')} hidden in ${plural(d.replacements, 'place')}` },
      say: 'Now copy the text and give it to the AI.',
    };
  }
  if (empty) return { ...base, say: "Copy the AI's answer, then click Paste AI's answer." };
  if (d.result === null) {
    if (m.places === 0) {
      return { ...base, tag: { kind: 'warn', icon: 'alert', text: 'No placeholders' }, say: "This text has no placeholders like Person-1. Is it the AI's answer?" };
    }
    return {
      ...base,
      tag: { kind: 'info', icon: 'paste', text: 'Answer pasted' },
      say: `${plural(m.places, 'placeholder')} found. Now bring the names back.`,
    };
  }
  const lock = { link: 'Change answer' };
  if (d.copied) return { ...base, lock, tag: { kind: 'ok', icon: 'check', text: 'Copied' }, say: 'The answer with the real names is ready to paste.' };
  return {
    ...base,
    lock,
    tag: { kind: 'ok', icon: 'eye', text: `Done! The names are back in ${plural(d.replacements, 'place')}` },
    say: 'Copy the answer or save it.',
  };
}

export interface FinderStatus {
  text: string;
  title: string;
  kind: 'off' | 'loading' | 'ready' | 'error';
  /** Link after the text (opens Settings or retries) */
  link: string | null;
}

export function finderStatus(s: Readonly<AppState>): FinderStatus {
  switch (s.finder) {
    case 'ready':
      return {
        kind: 'ready',
        text: 'Smart name finder on · offline',
        title: 'Finds names with a small AI model that runs only on this computer. Your text never leaves it.',
        link: null,
      };
    case 'loading': {
      const dl = s.finderDownload;
      const mb = (n: number) => Math.round(n / 1_000_000);
      return {
        kind: 'loading',
        text: dl && dl.total > 0 ? `Downloading name finder · ${mb(dl.loaded)} of ${mb(dl.total)} MB` : 'Smart name finder: starting…',
        title: 'Until it is ready, Find names uses simple rules.',
        link: null,
      };
    }
    case 'error':
      return {
        kind: 'error',
        text: 'Smart name finder not available · rules only',
        title: `The smart name finder could not be loaded. Find names uses simple rules.\n\nDetails: ${s.finderError ?? 'unknown error'}`,
        link: 'Retry',
      };
    default:
      return {
        kind: 'off',
        text: 'Name finder: simple · AI off',
        title: 'Finds names with simple rules. The smart name finder (AI) is off – turn it on in Settings.',
        // On the first-run card the same choice is right there
        link: s.firstRun ? null : 'Turn on',
      };
  }
}
