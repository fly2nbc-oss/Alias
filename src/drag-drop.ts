import { getCurrentWindow } from '@tauri-apps/api/window';
import * as api from './api';
import { showToast } from './components/notification';
import { setState } from './store';

/** Extensions come from the backend (src-tauri/src/formats.rs) */
let supported = new Set<string>();

function extOf(path: string): string {
  const m = /\.([^.\\/]+)$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}

function firstSupportedPath(paths: string[]): string | undefined {
  return paths.find((p) => supported.has(extOf(p)));
}

/**
 * Native file drag-and-drop via the Tauri webview (real paths).
 * Visual feedback on #workspace while dragging.
 */
export async function initFileDragDrop(): Promise<void> {
  const workspace = document.getElementById('workspace');
  if (!workspace) return;
  try {
    supported = new Set(await api.supportedExtensions());
  } catch {
    supported = new Set(['txt', 'md', 'docx', 'xlsx', 'xlsm', 'pptx', 'pdf']);
  }

  const setActive = (on: boolean) => {
    workspace.classList.toggle('file-drop-active', on);
  };

  const win = getCurrentWindow();
  await win.onDragDropEvent(async (event) => {
    const p = event.payload;
    switch (p.type) {
      case 'enter':
      case 'over':
        setActive(true);
        break;
      case 'leave':
        setActive(false);
        break;
      case 'drop': {
        setActive(false);
        const paths = p.paths;
        if (paths.length === 0) return;

        const path = firstSupportedPath(paths);
        if (!path) {
          showToast(
            'Unsupported format. Allowed: Office (docx, xlsx, pptx, odt, …), PDF and text files (txt, csv, json, xml, …)',
            'info',
          );
          return;
        }

        try {
          const doc = await api.openFile(path);
          setState({
            originalText: doc.content,
            processedText: '',
            sourcePath: doc.source_path,
            sourceFormat: doc.format,
            sourceWritable: doc.writable,
          });
          const name = path.split(/[/\\]/).pop() ?? path;
          const extra =
            paths.length > 1 ? ` (${paths.length} files, first supported)` : '';
          showToast(`File loaded: ${name}${extra}`, 'success');
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          showToast(`Could not open file: ${msg}`, 'error');
        }
        break;
      }
      default:
        break;
    }
  });
}
