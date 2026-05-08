import { getState, setState, subscribe } from '../store';
import { applyHighlights } from '../utils/highlight';

export function renderTextPanel(container: HTMLElement): void {
  container.innerHTML = `
    <div class="panel-header">
      <span id="text-panel-label">Original text</span>
      <span class="panel-badge hidden" id="text-panel-badge">0</span>
    </div>
    <div
      id="text-editor"
      contenteditable="true"
      spellcheck="false"
      placeholder="Open a file, drop here, or paste text…"
    ></div>
  `;

  const editor = container.querySelector('#text-editor') as HTMLElement;
  const label = container.querySelector('#text-panel-label') as HTMLElement;
  const badge = container.querySelector('#text-panel-badge') as HTMLElement;

  // Verhindert, dass der subscribe-Callback den Editor überschreibt während
  // der Nutzer tippt/einfügt. notify() ist synchron → suppressUpdate wirkt sofort.
  let suppressUpdate = false;

  // Editor input → state
  editor.addEventListener('input', () => {
    const { mode, processedText } = getState();
    const text = editor.innerText;
    suppressUpdate = true;
    if (mode === 'encode') {
      if (processedText) {
        // Nutzer tippt/klebt während kodiertes Ergebnis angezeigt wird → neu starten
        setState({ originalText: text, processedText: '', replacementCount: 0 });
      } else {
        setState({ originalText: text });
      }
    } else {
      setState({ processedText: text });
    }
    suppressUpdate = false;
  });

  // State → UI
  subscribe(() => {
    if (suppressUpdate) return;
    const { mode, originalText, processedText, aliasEntries, replacementCount } = getState();

    const labelText = mode === 'encode'
      ? (processedText ? 'Encoded text' : 'Original text / Preview')
      : (processedText ? 'Decoded text' : 'Paste LLM output');

    label.textContent = labelText;

    if (replacementCount > 0) {
      badge.textContent = `${replacementCount} replacements`;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    const showingProcessed = !!processedText;
    const textToShow = mode === 'encode'
      ? (processedText || originalText)
      : (processedText || '');

    // After encode: processedText contains aliases → highlight aliases (decode-search)
    // After decode: processedText contains originals → highlight originals (encode-search)
    // Before encode: originalText → highlight originals (encode-search)
    const highlightMode: 'encode' | 'decode' = showingProcessed
      ? (mode === 'encode' ? 'decode' : 'encode')
      : 'encode';

    if (aliasEntries.length > 0 && textToShow) {
      applyHighlights(editor, textToShow, aliasEntries, highlightMode);
    } else {
      if (editor.innerText !== textToShow) {
        editor.textContent = textToShow;
      }
    }
  });
}
