import * as api from '../api';
import type { NerStatus } from '../api';
import {
  iconClipboard,
  iconFolderOpen,
  iconInfo,
  iconLock,
  iconSave,
  iconSearch,
  iconUnlock,
} from '../icons';
import { getState, setState } from '../store';
import { cycleTheme, syncThemeButton } from '../utils/theme';
import { showAboutDialog } from './about-dialog';
import { showToast } from './notification';

export function renderToolbar(container: HTMLElement): void {
  container.innerHTML = `
    <span class="toolbar-title">Alias</span>
    <div class="toolbar-sep"></div>

    <button type="button" id="btn-open" class="btn-with-icon" title="Open file (txt, md, docx, xlsx)">
      ${iconFolderOpen}
      <span>Open</span>
    </button>

    <button type="button" id="btn-detect" class="btn-with-icon" title="Detect entities in text">
      ${iconSearch}
      <span>Detect</span>
    </button>

    <div class="toolbar-sep"></div>

    <button type="button" id="btn-encode" class="btn-with-icon" title="Encode text (original → alias)">
      ${iconLock}
      <span>Encode</span>
    </button>

    <button type="button" id="btn-decode" class="btn-with-icon" title="Decode text (alias → original)">
      ${iconUnlock}
      <span>Decode</span>
    </button>

    <div class="toolbar-sep"></div>

    <button type="button" id="btn-copy" class="btn-with-icon" title="Copy result text to clipboard">
      ${iconClipboard}
      <span>Copy</span>
    </button>

    <button type="button" id="btn-save-result" class="btn-with-icon" title="Save file — creates a copy of the original file with replacements applied (or save dialog as .txt)">
      ${iconSave}
      <span>Save</span>
    </button>

    <div class="toolbar-spacer"></div>

    <button type="button" id="btn-theme" class="ghost" title="Appearance">
      ◐ System
    </button>

    <div id="ner-status-badge" class="ner-status-badge ner-status--checking" title="Checking NER model…">
      <span class="ner-dot"></span>
      <span class="ner-label">NER</span>
    </div>

    <button type="button" id="btn-about" class="btn-with-icon ghost" title="About Alias">
      ${iconInfo}
      <span>About</span>
    </button>
  `;

  bindEvents(container);
  void refreshNerStatus();
}

/** Refresh local NER model status badge (e.g. after download completes). */
export async function refreshNerStatus(): Promise<void> {
  const badge = document.getElementById('ner-status-badge');
  if (!badge) return;
  try {
    const status: NerStatus = await api.nerStatus();
    const lbl = badge.querySelector('.ner-label')!;
    badge.classList.remove('ner-status--checking', 'ner-status--ready', 'ner-status--error');
    if (status.ready) {
      badge.classList.add('ner-status--ready');
      badge.title = `NER model ready\nDirectory: ${status.models_dir ?? '\u2013'}`;
      lbl.textContent = 'NER \u2713';
    } else if (status.model_onnx && status.tokenizer_json && status.ner_labels_json && !status.engine_loaded) {
      badge.classList.add('ner-status--error');
      badge.title = `NER: model on disk but engine not loaded\nDirectory: ${status.models_dir ?? '\u2013'}`;
      lbl.textContent = 'NER \u26a0';
    } else {
      badge.classList.add('ner-status--error');
      const missing = [
        !status.model_onnx && 'model.onnx',
        !status.tokenizer_json && 'tokenizer.json',
        !status.ner_labels_json && 'ner_labels.json',
      ].filter(Boolean).join(', ');
      badge.title = `NER model not ready\nMissing files: ${missing || '\u2013'}`;
      lbl.textContent = 'NER \u2717';
    }
  } catch {
    const badge2 = document.getElementById('ner-status-badge');
    if (badge2) {
      badge2.classList.remove('ner-status--checking');
      badge2.classList.add('ner-status--error');
      badge2.title = 'NER: status check failed';
      const lbl = badge2.querySelector('.ner-label');
      if (lbl) lbl.textContent = 'NER ?';
    }
  }
}

function bindEvents(container: HTMLElement): void {
  container.querySelector('#btn-theme')!.addEventListener('click', () => {
    cycleTheme();
    syncThemeButton();
  });

  container.querySelector('#btn-about')!.addEventListener('click', () => {
    showAboutDialog();
  });

  container.querySelector('#btn-open')!.addEventListener('click', async () => {
    try {
      const doc = await api.openFileDialog();
      if (!doc) return;
      setState({
        originalText: doc.content,
        processedText: '',
        sourcePath: doc.source_path,
        sourceFormat: doc.format,
      });
      showToast(`File loaded: ${doc.source_path.split(/[\\/]/).pop()}`, 'success');
    } catch (e: any) {
      showToast(`Error opening file: ${e}`, 'error');
    }
  });

  container.querySelector('#btn-detect')!.addEventListener('click', async () => {
    const { originalText } = getState();
    if (!originalText.trim()) {
      showToast('Open a file or enter text first.', 'info');
      return;
    }
    setState({ isProcessing: true });
    try {
      const candidates = await api.detectEntities(originalText);
      if (candidates.length === 0) {
        showToast('No entities found.', 'info');
      } else {
        setState({ candidates, showCandidateReview: true });
      }
    } catch (e: any) {
      showToast(`Detection error: ${e}`, 'error');
    } finally {
      setState({ isProcessing: false });
    }
  });

  container.querySelector('#btn-encode')!.addEventListener('click', () => runProcess('encode'));
  container.querySelector('#btn-decode')!.addEventListener('click', () => runProcess('decode'));

  container.querySelector('#btn-copy')!.addEventListener('click', async () => {
    const { processedText, originalText } = getState();
    const text = processedText || originalText;
    if (!text) {
      showToast('No text to copy.', 'info');
      return;
    }
    await navigator.clipboard.writeText(text);
    showToast('Text copied to clipboard.', 'success');
  });

  container.querySelector('#btn-save-result')!.addEventListener('click', async () => {
    const { mode, sourcePath, processedText, originalText } = getState();
    if (sourcePath) {
      // Originaldatei bekannt → Kopie im Originalformat mit Ersetzungen erstellen
      try {
        const out = await api.saveFileCopy(sourcePath, mode);
        showToast(`Saved: ${out.split(/[\\/]/).pop()}`, 'success');
      } catch (e: any) {
        showToast(`Save failed: ${e}`, 'error');
      }
    } else {
      // No source file — save as .txt via dialog
      const text = processedText || originalText;
      if (!text?.trim()) {
        showToast('No text to save.', 'info');
        return;
      }
      try {
        const path = await api.saveTextAsDialog(text, 'result.txt');
        if (path) showToast(`Saved: ${path.split(/[\\/]/).pop()}`, 'success');
      } catch (e: any) {
        showToast(`Save failed: ${e}`, 'error');
      }
    }
  });
}

async function runProcess(mode: 'encode' | 'decode'): Promise<void> {
  setState({ mode, isProcessing: true });
  const { originalText, processedText } = getState();
  const inputText = mode === 'encode' ? originalText : processedText || originalText;
  if (!inputText.trim()) {
    showToast('No text available.', 'info');
    setState({ isProcessing: false });
    return;
  }
  try {
    const result = mode === 'encode'
      ? await api.encodeText(inputText)
      : await api.decodeText(inputText);
    setState({ processedText: result.text, replacementCount: result.replacements_made });
    showToast(`${result.replacements_made} replacement(s) applied.`, 'success');
    await api.saveStore();
  } catch (e: any) {
    showToast(`Error: ${e}`, 'error');
  } finally {
    setState({ isProcessing: false });
  }
}
