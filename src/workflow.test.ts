/** Next step, step-2 lock and status sentences (no DOM). */
import { describe, expect, it } from 'vitest';
import { emptyDoc, type AppState } from './store';
import type { AliasEntry } from './types';
import { actionStates, finderStatus, nextStep, primary, statsOf, statusOf, step2State } from './workflow';

const entries: AliasEntry[] = [
  { id: '1', original: 'Laura Hoffmann', alias: 'Person-1', category: 'person', confirmed: true },
  { id: '2', original: 'Nordwind GmbH', alias: 'Company-1', category: 'firma', confirmed: true },
];

const TEXT = 'Laura Hoffmann works at Nordwind GmbH. Ask Laura Hoffmann.';
const HIDDEN = 'Person-1 works at Company-1. Ask Person-1.';

function state(p: Partial<AppState> = {}): AppState {
  return {
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
    ...p,
  };
}

const step = (s: AppState) => nextStep(s, statsOf(s));
const say = (s: AppState) => statusOf(s, statsOf(s));

describe('next step (the one primary button)', () => {
  it('walks the whole way: Open → Find → Hide → Copy for AI → Paste → Bring back → Copy', () => {
    let s = state();
    expect(step(s)).toBe('open');

    s = state({ docs: { encode: emptyDoc(TEXT), decode: emptyDoc() } });
    expect(step(s)).toBe('find');

    s = { ...s, aliasEntries: entries };
    expect(step(s)).toBe('hide');

    s = { ...s, docs: { encode: { input: TEXT, result: HIDDEN, replacements: 3, copied: false }, decode: emptyDoc() } };
    expect(step(s)).toBe('copyForAi');

    s = { ...s, docs: { ...s.docs, encode: { ...s.docs.encode, copied: true } } };
    expect(step(s)).toBe('pasteAnswer');

    s = { ...s, mode: 'decode' };
    expect(step(s)).toBe('pasteAnswer');

    s = { ...s, docs: { ...s.docs, decode: emptyDoc('Dear Person-1, thanks to Company-1.') } };
    expect(step(s)).toBe('bringBack');

    s = { ...s, docs: { ...s.docs, decode: { input: 'x', result: 'Dear Laura Hoffmann', replacements: 2, copied: false } } };
    expect(step(s)).toBe('copy');
    expect(primary(s, statsOf(s)).label).toBe('Copy');
  });

  it('asks to find names when the list has none of the names in this text', () => {
    const s = state({ docs: { encode: emptyDoc('Nobody here.'), decode: emptyDoc() }, aliasEntries: entries });
    expect(step(s)).toBe('find');
    expect(actionStates(s, statsOf(s)).hide.enabled).toBe(false);
  });

  it('the first-run card blocks everything; the primary is a greyed-out Open file', () => {
    const s = state({ firstRun: true });
    const p = primary(s, statsOf(s));
    expect(p).toMatchObject({ id: 'open', label: 'Open file', enabled: false });
    expect(p.title).toMatch(/Start/);
    expect(say(s).say).toBe('Hi! Choose what Alias may download, then start.');
  });

  it('bring names back is greyed out without placeholders in the answer', () => {
    const s = state({ mode: 'decode', aliasEntries: entries, docs: { encode: emptyDoc(), decode: emptyDoc('No placeholder here.') } });
    const p = primary(s, statsOf(s));
    expect(p.id).toBe('bringBack');
    expect(p.enabled).toBe(false);
    expect(p.title).toMatch(/No placeholders/);
  });
});

describe('step 2 lock', () => {
  it('is locked with a reason until the names are hidden', () => {
    const s = state({ docs: { encode: emptyDoc(TEXT), decode: emptyDoc() }, aliasEntries: entries });
    expect(step2State(s)).toEqual({ enabled: false, title: 'First hide the names in your text.' });
    const hidden = { ...s, docs: { ...s.docs, encode: { input: TEXT, result: HIDDEN, replacements: 3, copied: false } } };
    expect(step2State(hidden).enabled).toBe(true);
  });

  it('is locked for a fresh start, open for a returning user with names but no text', () => {
    expect(step2State(state()).enabled).toBe(false);
    expect(step2State(state({ aliasEntries: entries })).enabled).toBe(true);
  });

  it('pasting the answer is blocked while step 2 is locked', () => {
    const s = state({ docs: { encode: emptyDoc(TEXT), decode: emptyDoc() }, aliasEntries: entries });
    expect(actionStates(s, statsOf(s)).pasteAnswer.enabled).toBe(false);
  });
});

describe('status bar in plain words', () => {
  it('counts names and places', () => {
    let s = state({ docs: { encode: emptyDoc(TEXT), decode: emptyDoc() }, aliasEntries: entries });
    expect(say(s)).toMatchObject({ tag: { kind: 'info', text: '2 names found' }, say: 'Check them on the right. Then hide them.', lock: null });

    s = { ...s, docs: { ...s.docs, encode: { input: TEXT, result: HIDDEN, replacements: 3, copied: false } } };
    expect(say(s)).toMatchObject({
      tag: { kind: 'ok', text: '2 names hidden in 3 places' },
      say: 'Now copy the text and give it to the AI.',
      lock: { link: 'Change text' },
    });

    s = { ...s, docs: { ...s.docs, encode: { ...s.docs.encode, copied: true } } };
    expect(say(s).tag?.text).toBe('Copied');

    s = { ...s, mode: 'decode', docs: { ...s.docs, decode: emptyDoc('Hello Person-1 and Person-1.') } };
    expect(say(s).say).toBe('2 placeholders found. Now bring the names back.');

    s = { ...s, docs: { ...s.docs, decode: { input: 'x', result: 'y', replacements: 1, copied: false } } };
    expect(say(s)).toMatchObject({ tag: { text: 'Done! The names are back in 1 place' }, lock: { link: 'Change answer' } });
  });

  it('says what to do while the found names are checked', () => {
    expect(say(state({ showCandidateReview: true, docs: { encode: emptyDoc(TEXT), decode: emptyDoc() } })).say).toBe('Done looking. Check the names.');
  });

  it('starts friendly and names the file', () => {
    expect(say(state()).say).toBe('Hi! Open a file or paste a text to start.');
    expect(say(state({ sourcePath: 'C:\\docs\\letter.docx', docs: { encode: emptyDoc('a'), decode: emptyDoc() } })).file).toBe('letter.docx');
  });

  it('shows the name finder state and offers to turn it on', () => {
    expect(finderStatus(state())).toMatchObject({ kind: 'off', text: 'Name finder: simple · AI off', link: 'Turn on' });
    expect(finderStatus(state({ finder: 'ready' })).text).toBe('Smart name finder on · offline');
    expect(finderStatus(state({ finder: 'loading', finderDownload: { loaded: 64e6, total: 180e6 } })).text).toBe('Downloading name finder · 64 of 180 MB');
  });
});
