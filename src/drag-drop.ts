import { showToast } from './components/notification';
import { openDocumentFile } from './actions';
import { allExtensions, extensionOf } from './core/formats';

const supported = new Set(allExtensions());

/**
 * HTML5 drag-and-drop of files onto the workspace.
 * Visual feedback on #workspace while dragging. Text drops still go to the editor.
 */
export function initFileDragDrop(): void {
  const workspace = document.getElementById('workspace');
  if (!workspace) return;

  const setActive = (on: boolean) => workspace.classList.toggle('file-drop-active', on);
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  let depth = 0;

  workspace.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    setActive(true);
  });
  workspace.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  workspace.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) setActive(false);
  });
  workspace.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    setActive(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;

    const file = files.find((f) => supported.has(extensionOf(f.name)));
    if (!file) {
      showToast(
        'Alias cannot open this file. It opens Word, Excel, PowerPoint, OpenDocument, PDF and text files (txt, csv, json, xml, …).',
        'info',
      );
      return;
    }

    const extra = files.length > 1 ? ` (you dropped ${files.length} files; Alias opens one at a time)` : '';
    await openDocumentFile(file, extra);
  });

  // Do not let the browser open files that are dropped next to the workspace
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}
