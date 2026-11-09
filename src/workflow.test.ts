/** Next step, step-2 lock and status sentences (no DOM). */
import { describe, expect, it } from 'vitest';
import { emptyDoc, type AppState } from './store';
import type { AliasEntry } from './types';
import { actionStates, byFile, finderStatus, nextStep, primary, statsOf, statusOf, step2State } from './workflow';

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
    answerFile: null,
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

  it('a file walks: Open → Find → Hide → Save file for AI → Open AI\'s file → Bring back → Save file', () => {
    const file = { sourcePath: 'letter.docx', sourceFormat: 'docx', sourceWritable: true, sourceText: TEXT };
    let s = state({ ...file, docs: { encode: emptyDoc(TEXT), decode: emptyDoc() } });
    expect(step(s)).toBe('find');

    s = { ...s, aliasEntries: entries };
    expect(step(s)).toBe('hide');

    s = { ...s, docs: { encode: { ...emptyDoc(TEXT), result: HIDDEN, replacements: 3 }, decode: emptyDoc() } };
    expect(step(s)).toBe('saveForAi');
    let p = primary(s, statsOf(s));
    expect(p).toMatchObject({ label: 'Save file for AI', enabled: true });
    expect(p.title).toMatch(/letter\.docx.*placeholders.*Ctrl\+Enter/);
    expect(say(s).say).toBe('Now save the file and give it to the AI.');

    // Saved the copy with placeholders: counts as handed over
    s = { ...s, docs: { ...s.docs, encode: { ...s.docs.encode, copied: true, saved: true } } };
    expect(step(s)).toBe('openAnswer');
    expect(primary(s, statsOf(s))).toMatchObject({ label: "Open AI's file", enabled: true });
    expect(say(s)).toMatchObject({ tag: { text: 'Saved' }, say: 'Give the file to the AI. Then open the file it sends back.' });

    s = { ...s, mode: 'decode' };
    expect(step(s)).toBe('openAnswer');
    expect(say(s).say).toBe('Open the file the AI sent back. Or paste its answer with Ctrl+V.');
    expect(say(s).file).toBe('letter.docx');

    // The AI's file is open: its text with placeholders, its own name in the status bar
    const AI = 'Person-1 works at Company-1. Ask Person-1 again.';
    s = {
      ...s,
      answerFile: { path: 'letter_anonym.docx', format: 'docx', writable: true, text: AI },
      docs: { ...s.docs, decode: emptyDoc(AI) },
    };
    expect(step(s)).toBe('bringBack');
    expect(say(s)).toMatchObject({ tag: { icon: 'file', text: 'File opened' }, say: '3 placeholders found. Now bring the names back.', file: 'letter_anonym.docx' });

    s = { ...s, docs: { ...s.docs, decode: { ...s.docs.decode, result: TEXT, replacements: 3 } } };
    expect(step(s)).toBe('saveFile');
    p = primary(s, statsOf(s));
    expect(p).toMatchObject({ label: 'Save file', enabled: true });
    expect(p.title).toMatch(/letter_anonym\.docx.*real names/);
    expect(say(s).say).toBe('Now save the file.');

    s = { ...s, docs: { ...s.docs, decode: { ...s.docs.decode, copied: true, saved: true, missed: 0 } } };
    expect(step(s)).toBe('saveFile');
    expect(say(s)).toMatchObject({ tag: { kind: 'ok', text: 'Saved' }, say: 'The file with the real names is saved.' });

    // Placeholders the AI changed so that they were not replaced in the file
    s = { ...s, docs: { ...s.docs, decode: { ...s.docs.decode, missed: 2 } } };
    expect(say(s)).toMatchObject({ tag: { kind: 'warn', text: '2 placeholders not replaced' } });
  });

  it('copying the text instead of saving the file leads to Paste AI\'s answer', () => {
    const s = state({
      sourcePath: 'letter.docx',
      sourceWritable: true,
      aliasEntries: entries,
      docs: { encode: { ...emptyDoc(TEXT), result: HIDDEN, replacements: 3, copied: true, saved: false }, decode: emptyDoc() },
    });
    expect(byFile(s)).toBe(false);
    expect(step(s)).toBe('pasteAnswer');
    expect(step({ ...s, mode: 'decode' })).toBe('pasteAnswer');
  });

  it('a file that cannot be written back (PDF) keeps the text way', () => {
    const s = state({
      sourcePath: 'scan.pdf',
      sourceWritable: false,
      aliasEntries: entries,
      docs: { encode: { ...emptyDoc(TEXT), result: HIDDEN, replacements: 3 }, decode: emptyDoc() },
    });
    expect(step(s)).toBe('copyForAi');
    expect(step({ ...s, mode: 'decode' })).toBe('pasteAnswer');
  });

  it('step 2 empty: Open AI\'s file only after a file, Paste AI\'s answer otherwise; both name the other way', () => {
    const empty2 = (p: Partial<AppState>) => state({ mode: 'decode', aliasEntries: entries, ...p });
    const fromFile = empty2({
      sourcePath: 'a.xlsx',
      sourceWritable: true,
      docs: { encode: { ...emptyDoc(TEXT), result: HIDDEN, replacements: 3 }, decode: emptyDoc() },
    });
    expect(step(fromFile)).toBe('openAnswer');
    expect(say(fromFile).say).toMatch(/Ctrl\+V/);

    const fromText = empty2({ docs: { encode: { ...emptyDoc(TEXT), result: HIDDEN, replacements: 3, copied: true }, decode: emptyDoc() } });
    expect(step(fromText)).toBe('pasteAnswer');
    expect(say(fromText).say).toMatch(/Ctrl\+O/);

    // Returning user without text in step 1
    expect(step(empty2({}))).toBe('pasteAnswer');
  });

  it('an AI file that cannot be written back ends with Copy; Save ▾ says why', () => {
    const s = state({
      mode: 'decode',
      aliasEntries: entries,
      answerFile: { path: 'answer.pdf', format: 'pdf', writable: false, text: 'Hi Person-1' },
      docs: { encode: emptyDoc(), decode: { ...emptyDoc('Hi Person-1'), result: 'Hi Laura Hoffmann', replacements: 1 } },
    });
    expect(step(s)).toBe('copy');
    expect(actionStates(s, statsOf(s)).saveCopy).toMatchObject({ enabled: false, title: ".pdf files can't be written back – save the text instead." });
  });

  it('placeholders the AI wrote differently are counted before and after bringing the names back', () => {
    const AI = 'Dear Person 1, Company-1 thanks Person-1.';
    let s = state({ mode: 'decode', aliasEntries: entries, docs: { encode: emptyDoc(), decode: emptyDoc(AI) } });
    expect(say(s)).toMatchObject({ tag: { kind: 'warn', text: '1 placeholder changed' } });
    expect(say(s).say).toContain('"Person 1"');
    s = { ...s, docs: { ...s.docs, decode: { ...s.docs.decode, result: 'Dear Person 1, Nordwind GmbH thanks Laura Hoffmann.', replacements: 2 } } };
    expect(say(s)).toMatchObject({ tag: { kind: 'warn', text: '1 placeholder not replaced' }, lock: { link: 'Change answer' } });
  });

  it('an AI file without placeholders gets its own warning', () => {
    const s = state({
      mode: 'decode',
      aliasEntries: entries,
      answerFile: { path: 'x.docx', format: 'docx', writable: true, text: 'Nothing here.' },
      docs: { encode: emptyDoc(), decode: emptyDoc('Nothing here.') },
    });
    expect(say(s).say).toBe("This file has no placeholders like Person-1. Is it the AI's file?");
    expect(primary(s, statsOf(s))).toMatchObject({ id: 'bringBack', enabled: false });
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
