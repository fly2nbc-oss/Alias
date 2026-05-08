import * as api from '../api';
import { iconArrowDown, iconArrowUp, iconPlus, iconTrash } from '../icons';
import { getState, setState, subscribe } from '../store';
import type { AliasEntry, Category } from '../types';
import { CATEGORIES } from '../types';
import { showToast } from './notification';

export function renderMappingTable(container: HTMLElement): void {
  container.innerHTML = `
    <div class="panel-header">
      <span>Alias table</span>
      <div class="panel-header-actions">
        <span class="panel-badge hidden" id="entry-count">0</span>
        <button type="button" id="btn-add-manual" class="ghost btn-with-icon" title="Add a free-text alias">
          ${iconPlus}
          <span>Add alias</span>
        </button>
        <button type="button" id="btn-store-export" class="ghost btn-with-icon" title="Export alias store as JSON">
          ${iconArrowUp}
          <span>Export</span>
        </button>
        <button type="button" id="btn-store-import" class="ghost btn-with-icon" title="Import alias store from JSON">
          ${iconArrowDown}
          <span>Import</span>
        </button>
        <button type="button" id="btn-store-clear" class="danger btn-with-icon" title="Clear alias store">
          ${iconTrash}
          <span>Clear</span>
        </button>
      </div>
    </div>
    <div class="alias-table-wrapper">
      <table class="alias-table">
        <thead>
          <tr>
            <th style="width:36px">✓</th>
            <th>Original</th>
            <th>Alias</th>
            <th>Category</th>
            <th style="width:36px"></th>
          </tr>
        </thead>
        <tbody id="alias-tbody"></tbody>
      </table>
      <div id="alias-empty" class="empty-state">
        <div class="empty-icon">🏷</div>
        <div class="empty-title">No entries yet</div>
        <div class="empty-hint">Use Detect, open a file, or Manual for free text.</div>
      </div>
    </div>
  `;

  container.querySelector('#btn-add-manual')!.addEventListener('click', () => {
    openManualAliasDialog();
  });

  container.querySelector('#btn-store-export')!.addEventListener('click', async () => {
    try {
      const path = await api.exportStoreDialog();
      if (path) showToast(`Store exported: ${path.split(/[\\/]/).pop()}`, 'success');
    } catch (e: any) {
      showToast(`Export error: ${e}`, 'error');
    }
  });

  container.querySelector('#btn-store-import')!.addEventListener('click', async () => {
    try {
      const entries = await api.importStoreDialog();
      if (entries) {
        setState({ aliasEntries: entries });
        showToast(`${entries.length} entries imported.`, 'success');
      }
    } catch (e: any) {
      showToast(`Import error: ${e}`, 'error');
    }
  });

  container.querySelector('#btn-store-clear')!.addEventListener('click', async () => {
    if (!confirm('Clear the alias store? This cannot be undone.')) return;
    try {
      await api.clearStore();
      setState({ aliasEntries: [] });
      showToast('Store cleared.', 'info');
    } catch (e: any) {
      showToast(`Error: ${e}`, 'error');
    }
  });

  subscribe(() => {
    const { aliasEntries } = getState();
    renderRows(aliasEntries, container);
  });
}

let manualEscapeHandler: ((e: KeyboardEvent) => void) | null = null;

function openManualAliasDialog(): void {
  if (document.getElementById('manual-alias-overlay')) return;

  const catOptions = CATEGORIES.map(
    c => `<option value="${c.value}">${c.label}</option>`,
  ).join('');

  const overlay = document.createElement('div');
  overlay.id = 'manual-alias-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-compact" role="dialog" aria-modal="true" aria-labelledby="manual-alias-title">
      <div class="modal-header">
        <span id="manual-alias-title">Add alias manually</span>
        <button type="button" class="modal-close" id="manual-alias-close" title="Close">✕</button>
      </div>
      <div class="modal-body">
        <form class="manual-alias-form" id="manual-alias-form">
          <div class="form-field">
            <label for="manual-original">Original text</label>
            <input type="text" id="manual-original" name="original" autocomplete="off" placeholder="e.g. company name, term in document" />
          </div>
          <div class="form-field">
            <label for="manual-alias">Alias (optional)</label>
            <input type="text" id="manual-alias" name="alias" autocomplete="off" placeholder="Leave empty for auto-assignment (e.g. Person-1)" />
          </div>
          <div class="form-field">
            <label for="manual-category">Category</label>
            <select id="manual-category" name="category">${catOptions}</select>
          </div>
          <p class="form-hint">The text does not need to be found by Detect first. When encoding, this alias applies to exactly this original text.</p>
        </form>
      </div>
      <div class="modal-footer">
        <button type="button" id="manual-alias-cancel">Cancel</button>
        <button type="submit" form="manual-alias-form" class="primary" id="manual-alias-submit">Add</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const form = overlay.querySelector('#manual-alias-form') as HTMLFormElement;
  const origIn = overlay.querySelector('#manual-original') as HTMLInputElement;
  const close = () => {
    if (manualEscapeHandler) {
      document.removeEventListener('keydown', manualEscapeHandler);
      manualEscapeHandler = null;
    }
    overlay.remove();
  };

  manualEscapeHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', manualEscapeHandler);

  overlay.querySelector('#manual-alias-close')!.addEventListener('click', close);
  overlay.querySelector('#manual-alias-cancel')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const original = origIn.value.trim();
    if (!original) {
      showToast('Please enter an original text.', 'info');
      origIn.focus();
      return;
    }
    const aliasRaw = (overlay.querySelector('#manual-alias') as HTMLInputElement).value.trim();
    const category = (overlay.querySelector('#manual-category') as HTMLSelectElement)
      .value as Category;

    const beforeIds = new Set(getState().aliasEntries.map(x => x.id));

    try {
      const entry = await api.addEntry(original, aliasRaw || null, category);
      const { aliasEntries } = getState();
      const isNew = !beforeIds.has(entry.id);
      const idx = aliasEntries.findIndex(x => x.id === entry.id);
      let merged: AliasEntry[];
      if (idx >= 0) {
        merged = aliasEntries.map(x => (x.id === entry.id ? entry : x));
      } else {
        merged = [...aliasEntries, entry];
      }
      setState({ aliasEntries: merged });
      await api.saveStore();
      showToast(
        isNew ? 'Entry added.' : 'This original text is already in the table.',
        isNew ? 'success' : 'info',
      );
      close();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Error: ${msg}`, 'error');
    }
  });

  setTimeout(() => origIn.focus(), 0);
}

function renderRows(entries: AliasEntry[], container: HTMLElement): void {
  const tbody = container.querySelector('#alias-tbody') as HTMLTableSectionElement;
  const empty = container.querySelector('#alias-empty') as HTMLElement;
  const badge = container.querySelector('#entry-count') as HTMLElement;

  tbody.innerHTML = '';

  if (entries.length === 0) {
    empty.classList.remove('hidden');
    badge.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  badge.textContent = String(entries.length);
  badge.classList.remove('hidden');

  for (const entry of entries) {
    const tr = document.createElement('tr');
    tr.dataset.id = entry.id;
    if (!entry.confirmed) tr.classList.add('unconfirmed');

    const catOptions = CATEGORIES.map(c =>
      `<option value="${c.value}" ${c.value === entry.category ? 'selected' : ''}>${c.label}</option>`,
    ).join('');

    tr.innerHTML = `
      <td>
        <input type="checkbox" class="confirmed-cb" ${entry.confirmed ? 'checked' : ''} title="Confirmed">
      </td>
      <td class="original-cell" title="${escHtml(entry.original)}">${escHtml(entry.original)}</td>
      <td>
        <input type="text" class="alias-input" value="${escHtml(entry.alias)}" title="${escHtml(entry.alias)}">
      </td>
      <td>
        <select class="category-select">${catOptions}</select>
      </td>
      <td>
        <button class="ghost btn-delete" title="Delete entry" style="padding:2px 6px;font-size:14px">🗑</button>
      </td>
    `;

    tr.querySelector('.confirmed-cb')!.addEventListener('change', async (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      try {
        const updated = await api.updateEntry(entry.id, undefined, undefined, checked);
        updateStateEntry(updated);
      } catch (err: unknown) {
        showToast(`Error: ${err}`, 'error');
      }
    });

    const aliasInput = tr.querySelector('.alias-input') as HTMLInputElement;
    aliasInput.addEventListener('blur', async () => {
      const newAlias = aliasInput.value.trim();
      if (!newAlias || newAlias === entry.alias) return;
      try {
        const updated = await api.updateEntry(entry.id, newAlias);
        updateStateEntry(updated);
        showToast('Alias updated.', 'success');
      } catch (err: unknown) {
        showToast(`Error: ${err}`, 'error');
        aliasInput.value = entry.alias;
      }
    });
    aliasInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') aliasInput.blur();
      if (e.key === 'Escape') {
        aliasInput.value = entry.alias;
        aliasInput.blur();
      }
    });

    tr.querySelector('.category-select')!.addEventListener('change', async (e) => {
      const cat = (e.target as HTMLSelectElement).value as Category;
      try {
        const updated = await api.updateEntry(entry.id, undefined, cat);
        updateStateEntry(updated);
      } catch (err: unknown) {
        showToast(`Error: ${err}`, 'error');
      }
    });

    tr.querySelector('.btn-delete')!.addEventListener('click', async () => {
      try {
        await api.removeEntry(entry.id);
        const { aliasEntries } = getState();
        setState({ aliasEntries: aliasEntries.filter(e => e.id !== entry.id) });
      } catch (err: unknown) {
        showToast(`Error: ${err}`, 'error');
      }
    });

    tbody.appendChild(tr);
  }
}

function updateStateEntry(updated: AliasEntry): void {
  const { aliasEntries } = getState();
  setState({
    aliasEntries: aliasEntries.map(e => (e.id === updated.id ? updated : e)),
  });
}

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
