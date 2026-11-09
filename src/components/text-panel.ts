import { pasteAsAnswer } from '../actions';
import { icon, P } from '../icons';
import { getState, setInputQuiet, showingResult, subscribe, visibleText } from '../store';
import { applyHighlights } from '../utils/highlight';
import { searchMode } from '../workflow';
import { flashLock } from './status-bar';

/**
 * Editor: a <textarea> (exact text, no doubled blank lines as with contenteditable) over a layer
 * of the same size that marks the names or placeholders in colour. It always shows the text of
 * the active step: the editable input or the locked result. No header bar: the step switch and
 * the next action are in the toolbar, the state is in the status bar.
 */
export function renderTextPanel(container: HTMLElement): void {
  container.innerHTML = `
    <div class="editor-wrap" id="editor-wrap">
      <div id="text-highlights" aria-hidden="true"></div>
      <textarea id="text-editor" spellcheck="false" autocomplete="off" aria-label="My text" aria-describedby="editor-empty"></textarea>
      <div id="editor-empty" class="editor-empty"></div>
    </div>
  `;

  const editor = container.querySelector('#text-editor') as HTMLTextAreaElement;
  const layer = container.querySelector('#text-highlights') as HTMLElement;
  const wrap = container.querySelector('#editor-wrap') as HTMLElement;
  const empty = container.querySelector('#editor-empty') as HTMLElement;
  let emptyKey = '';

  // ------------------------------------------------------------ Highlights (batched)
  let hlTimer: ReturnType<typeof setTimeout> | null = null;
  let hlKey = '';
  const renderHighlights = () => {
    hlTimer = null;
    const s = getState();
    const text = editor.value;
    const mode = searchMode(s);
    if (s.aliasEntries.length === 0) layer.textContent = '';
    else applyHighlights(layer, text, s.aliasEntries, mode);
    hlKey = `${mode}|${text.length}`;
    layer.scrollTop = editor.scrollTop;
  };
  const scheduleHighlights = (now = false) => {
    if (hlTimer) clearTimeout(hlTimer);
    if (now) renderHighlights();
    // Large texts: mark less often so typing stays smooth
    else hlTimer = setTimeout(renderHighlights, editor.value.length > 50_000 ? 400 : 120);
  };

  // ------------------------------------------------------------ Input
  editor.addEventListener('input', () => {
    if (editor.readOnly) return;
    setInputQuiet(editor.value, editor.value.length > 50_000 ? 300 : 120);
    empty.classList.toggle('hidden', editor.value.length > 0);
    scheduleHighlights();
  });
  editor.addEventListener('scroll', () => {
    layer.scrollTop = editor.scrollTop;
    layer.scrollLeft = editor.scrollLeft;
  });

  // A locked result: Ctrl+V does what "Paste AI's answer" does (new answer in step 2),
  // typing points to "Change text" in the status bar
  editor.addEventListener('paste', (e) => {
    const s = getState();
    if (!showingResult(s) || s.isProcessing) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    e.preventDefault();
    if (text.trim()) pasteAsAnswer(text);
  });
  editor.addEventListener('keydown', (e) => {
    if (!editor.readOnly || getState().isProcessing) return;
    const typing = (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter';
    if (typing && !(e.key === 'Enter' && (e.ctrlKey || e.metaKey))) flashLock();
  });

  // ------------------------------------------------------------ State → view
  const update = () => {
    const s = getState();
    const text = visibleText(s);
    const result = showingResult(s);

    const key = `${s.mode}|${s.firstRun}`;
    if (key !== emptyKey) {
      emptyKey = key;
      empty.innerHTML = s.mode === 'encode' ? EMPTY_ENCODE : EMPTY_DECODE;
    }
    empty.classList.toggle('hidden', text.length > 0 || s.firstRun);

    editor.readOnly = result || s.isProcessing || s.firstRun;
    wrap.classList.toggle('is-result', result);
    wrap.setAttribute('aria-busy', String(s.isProcessing));
    const name = s.mode === 'encode' ? (result ? 'My text with placeholders' : 'My text') : result ? "AI's answer with the real names" : "AI's answer";
    editor.setAttribute('aria-label', result ? `${name} (locked)` : name);

    // Only set the text when it changed (keeps the cursor while typing)
    const changed = editor.value !== text;
    if (changed) {
      editor.value = text;
      editor.scrollTop = 0;
    }
    const mode = searchMode(s);
    if (changed || entriesRef !== s.aliasEntries || `${mode}|${text.length}` !== hlKey) {
      entriesRef = s.aliasEntries;
      scheduleHighlights(changed || text.length < 50_000);
    }
  };
  let entriesRef: unknown = null;
  subscribe(update);
  update();
}

const STORY: [string, string][] = [
  [P.fileText, 'Your text'],
  [P.search, 'Find names'],
  [P.eyeOff, 'Hide names'],
  [P.bot, 'Ask the AI'],
  [P.eye, 'Bring names back'],
];

const kbd = (...keys: string[]) => keys.map((k) => `<kbd>${k}</kbd>`).join(' ');

/** Start: a picture story of the five steps, one sentence, the first keys (no explanation text) */
const EMPTY_ENCODE = `
  <ol class="story" aria-label="How Alias works">
    ${STORY.map(([p, t], i) => `${i ? `<li class="story-arrow" aria-hidden="true">${icon(P.chevronRight, 20)}</li>` : ''}<li class="story-tile${i === 0 ? ' on' : ''}"><span class="story-pic"><span class="story-no">${i + 1}</span>${icon(p, 32)}</span><span>${t}</span></li>`).join('')}
  </ol>
  <p class="empty-say">Start with a text: open a file or paste it here.</p>
  <p class="empty-keys">${kbd('Ctrl', 'O')} open · ${kbd('Ctrl', 'V')} paste · or drop a file here</p>`;

const EMPTY_DECODE = `
  <div class="empty-icon">${icon(P.paste, 32)}</div>
  <p class="empty-say">Paste the AI's answer here.</p>
  <p class="empty-keys">${kbd('Ctrl', 'V')} paste · ${kbd('Ctrl', 'Enter')} next step</p>`;
