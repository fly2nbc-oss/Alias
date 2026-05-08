import * as api from './api';
import { initCandidateReview } from './components/candidate-review';
import { initDownloadProgress } from './components/download-progress';
import { renderMappingTable } from './components/mapping-table';
import { renderTextPanel } from './components/text-panel';
import { renderToolbar } from './components/toolbar';
import { initFileDragDrop } from './drag-drop';
import { setState } from './store';
import { applyTheme, getStoredTheme, syncThemeButton } from './utils/theme';

// Resize handle between text and mapping panels
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
    const delta = e.clientX - startX;
    const newWidth = Math.max(200, startWidth + delta);
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

window.addEventListener('DOMContentLoaded', async () => {
  applyTheme(getStoredTheme());

  // Render UI
  renderToolbar(document.getElementById('toolbar')!);
  syncThemeButton();
  renderTextPanel(document.getElementById('text-panel-container')!);
  renderMappingTable(document.getElementById('mapping-panel-container')!);
  initCandidateReview();
  initDownloadProgress();
  initResizeHandle();
  void initFileDragDrop();

  // Load persisted store on startup
  try {
    const entries = await api.getStore();
    if (entries.length > 0) {
      setState({ aliasEntries: entries });
    }
  } catch (e) {
    console.error('Could not load store:', e);
  }
});
