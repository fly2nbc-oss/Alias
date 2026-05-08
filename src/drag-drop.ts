import { getCurrentWindow } from '@tauri-apps/api/window';
import * as api from './api';
import { showToast } from './components/notification';
import { setState } from './store';

/** Same extensions as the file dialog (see file_commands / parser) */
const SUPPORTED = /\.(txt|md|docx|xlsx|xls|xlsm)$/i;

function firstSupportedPath(paths: string[]): string | undefined {
  return paths.find((p) => SUPPORTED.test(p));
}

/**
 * Native file drag-and-drop via the Tauri webview (real paths).
 * Visual feedback on #workspace while dragging.
 */
export async function initFileDragDrop(): Promise<void> {
  const workspace = document.getElementById('workspace');
  if (!workspace) return;

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
            'Unsupported format. Allowed: .txt, .md, .docx, .xlsx, .xls, .xlsm',
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
