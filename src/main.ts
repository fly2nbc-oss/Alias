import * as api from './api';
import { initShortcuts } from './actions';
import { initCandidateReview } from './components/candidate-review';
import { initFinderProgress, syncFinder } from './components/download-progress';
import { showFirstRunCard } from './components/first-run';
import { renderMappingTable } from './components/mapping-table';
import { initToasts } from './components/notification';
import { showSettingsDialog } from './components/settings-dialog';
import { renderStatusBar, setFinderLinkHandler } from './components/status-bar';
import { renderTextPanel } from './components/text-panel';
import { renderToolbar } from './components/toolbar';
import { initUpdateCheck } from './components/update-banner';
import { consentAsked, startNetworkFeatures } from './core/consent';
import { initFileDragDrop } from './drag-drop';
import { getState, hasAnyText, setState } from './store';
import { applyTheme, getStoredTheme } from './utils/theme';

// Resize handle between the text and the table of names
function initResizeHandle(): void {
  const handle = document.getElementById('resize-handle')!;
  const textPanel = document.getElementById('text-panel-container')!;
  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    dragging = true;
    startX = e.clientX;
    startWidth = textPanel.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!dragging) return;
    const newWidth = Math.max(320, startWidth + e.clientX - startX);
    textPanel.style.flex = `0 0 ${newWidth}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

/** Start what the user agreed to (smart name finder, update check) – nothing without consent. */
function startOptIns(): void {
  startNetworkFeatures({
    loadFinder: () => {
      setState({ finder: 'loading' });
      void api.enableNer().finally(syncFinder);
    },
    checkUpdates: initUpdateCheck,
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  applyTheme(getStoredTheme());
  initToasts();

  renderToolbar(document.getElementById('toolbar')!);
  renderTextPanel(document.getElementById('text-panel-container')!);
  renderMappingTable(document.getElementById('mapping-panel-container')!);
  renderStatusBar(document.getElementById('statusbar')!);
  initCandidateReview();
  const loadFinder = () => void api.enableNer().finally(syncFinder);
  initFinderProgress(loadFinder);
  initResizeHandle();
  initFileDragDrop();
  initShortcuts();
  setFinderLinkHandler((link) => {
    if (link === 'Retry') loadFinder();
    else showSettingsDialog('finder');
  });

  // Warn before closing or reloading while a text or result has not been copied or saved
  window.addEventListener('beforeunload', (e) => {
    const s = getState();
    if (!(s.dirty && hasAnyText(s)) && !s.isProcessing) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // Table of names from the browser storage; the network only after consent
  api.init();
  if (consentAsked()) startOptIns();
  else showFirstRunCard(document.getElementById('editor-wrap')!, startOptIns);

  try {
    const entries = await api.getStore();
    if (entries.length > 0) setState({ aliasEntries: entries });
  } catch (e) {
    console.error('Could not load the table of names:', e);
  }
});
