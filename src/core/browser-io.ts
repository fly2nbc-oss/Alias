/** Open and save files in the browser, and local storage of the alias table. */

/** File picker; returns `null` if cancelled. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    let settled = false;
    const done = (f: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(f);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}

interface SaveFilePickerWindow {
  showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<{ name: string; createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }> }>;
}

/**
 * Saves a file. With the File System Access API (Edge/Chrome) a save dialog appears,
 * else a normal download. Returns the file name, or `null` if cancelled.
 */
export async function saveFile(name: string, data: Blob): Promise<string | null> {
  const w = window as unknown as SaveFilePickerWindow;
  if (w.showSaveFilePicker) {
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: name,
        types: ext ? [{ accept: { [data.type || 'application/octet-stream']: [ext] } }] : undefined,
      });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
      return handle.name;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      // e.g. expired user activation or unknown MIME type -> download
      console.warn('showSaveFilePicker failed, falling back to download:', e);
    }
  }
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

const STORE_KEY = 'alias.store.v1';

export function loadStoredJson(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

/** true = saved; false = browser storage not available (e.g. private window). */
export function storeJson(json: string): boolean {
  try {
    localStorage.setItem(STORE_KEY, json);
    return true;
  } catch {
    return false;
  }
}
