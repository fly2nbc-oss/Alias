import * as api from '../api';
import { parseStoreExport } from '../core/store';
import { iconArrowDown, iconArrowUp, iconPencil, iconPlus, iconSortAsc, iconSortDesc, iconTag, iconTrash, iconX } from '../icons';
import { getState, setState, subscribe } from '../store';
import type { AliasEntry, Category } from '../types';
import { CATEGORIES } from '../types';
import { checkAlias, naturalCompare } from './alias-validation';
import { confirmDialog, escHtml, openModal } from './dialog';
import { showToast } from './notification';

/** Rows per page; above that the list is paged, so the DOM stays small */
const PAGE_SIZE = 200;
const UNDO_MS = 10_000;

type SortKey = 'original' | 'alias' | 'category' | 'confirmed';

const view = {
  query: '',
  sortKey: 'original' as SortKey,
  sortDir: 1 as 1 | -1,
  page: 0,
};

const categoryLabel = (c: Category): string => CATEGORIES.find((x) => x.value === c)?.label ?? c;

let root: HTMLElement;
/** Last rendered list (reference check: redraw only on change) */
let lastEntries: readonly AliasEntry[] | null = null;
/** Sorted/filtered list of the current view */
let visible: AliasEntry[] = [];

export function renderMappingTable(container: HTMLElement): void {
  root = container;
  container.innerHTML = `
    <div class="panel-header">
      <span class="panel-title" id="names-title">Names and placeholders</span>
      <span class="badge hidden" id="entry-count" title="Number of names in the list"></span>
      <div class="panel-header-actions">
        <button type="button" id="btn-add-manual" class="btn-quiet" title="Add a name or any other text to hide">
          ${iconPlus}
          <span class="btn-label">Add name</span>
        </button>
        <button type="button" id="btn-store-export" class="btn-quiet" title="Save the names and placeholders as a JSON file (backup)">
          ${iconArrowUp}
          <span class="btn-label">Export</span>
        </button>
        <button type="button" id="btn-store-import" class="btn-quiet" title="Load names and placeholders from a JSON file">
          ${iconArrowDown}
          <span class="btn-label">Import</span>
        </button>
        <button type="button" id="btn-store-clear" class="btn-quiet btn-clear" title="Delete all names and placeholders">
          ${iconTrash}
          <span class="btn-label">Clear</span>
        </button>
      </div>
    </div>
    <div class="alias-search-bar hidden" id="alias-search-bar">
      <input type="search" id="alias-search" placeholder="Search names or placeholders" aria-label="Search names or placeholders" autocomplete="off">
      <span class="alias-search-info" id="alias-search-info" aria-live="polite"></span>
    </div>
    <div class="alias-table-wrapper" id="alias-table-wrapper">
      <table class="alias-table" id="alias-table">
        <colgroup>
          <col class="col-use"><col class="col-original"><col class="col-alias"><col class="col-category"><col class="col-del">
        </colgroup>
        <thead>
          <tr>
            <th scope="col" class="th-use" title="Only ticked names are hidden and brought back">
              <button type="button" class="th-sort" data-key="confirmed">Hide<span class="sort-icon"></span></button>
            </th>
            <th scope="col"><button type="button" class="th-sort" data-key="original">Name<span class="sort-icon"></span></button></th>
            <th scope="col"><button type="button" class="th-sort" data-key="alias">Placeholder<span class="sort-icon"></span></button></th>
            <th scope="col"><button type="button" class="th-sort" data-key="category">Kind<span class="sort-icon"></span></button></th>
            <th scope="col"><span class="visually-hidden">Delete</span></th>
          </tr>
        </thead>
        <tbody id="alias-tbody"></tbody>
      </table>
      <div class="alias-pager hidden" id="alias-pager">
        <button type="button" id="alias-prev">Previous</button>
        <span id="alias-page-info"></span>
        <button type="button" id="alias-next">Next</button>
      </div>
      <div id="alias-no-match" class="alias-no-match hidden"></div>
      <div id="alias-empty" class="empty-state">
        <div class="empty-icon">${iconTag}</div>
        <div class="empty-title">No names yet</div>
        <div class="empty-hint"><strong>Find names</strong> looks for them in your text.</div>
      </div>
    </div>
    <div class="undo-bar hidden" id="undo-bar" role="status">
      <span id="undo-text"></span>
      <button type="button" id="undo-btn" class="undo-btn">Undo</button>
      <button type="button" id="undo-dismiss" class="btn-icon undo-dismiss" aria-label="Close" title="Close">${iconX}</button>
    </div>
  `;

  container.querySelector('#btn-add-manual')!.addEventListener('click', () => openManualAliasDialog());
  container.querySelector('#btn-store-export')!.addEventListener('click', () => void exportStore());
  container.querySelector('#btn-store-import')!.addEventListener('click', () => void importStore());
  container.querySelector('#btn-store-clear')!.addEventListener('click', () => void clearAll());

  const search = container.querySelector('#alias-search') as HTMLInputElement;
  search.addEventListener('input', () => {
    view.query = search.value;
    view.page = 0;
    refresh();
  });

  container.querySelectorAll<HTMLButtonElement>('.th-sort').forEach((b) => {
    b.addEventListener('click', () => {
      const key = b.dataset.key as SortKey;
      if (view.sortKey === key) view.sortDir = view.sortDir === 1 ? -1 : 1;
      else {
        view.sortKey = key;
        view.sortDir = 1;
      }
      view.page = 0;
      refresh();
    });
  });

  container.querySelector('#alias-prev')!.addEventListener('click', () => {
    view.page = Math.max(0, view.page - 1);
    refresh();
    scrollTop();
  });
  container.querySelector('#alias-next')!.addEventListener('click', () => {
    view.page += 1;
    refresh();
    scrollTop();
  });

  bindRowEvents(container.querySelector('#alias-tbody') as HTMLTableSectionElement);
  container.querySelector('#undo-dismiss')!.addEventListener('click', hideUndo);

  // Redraw only when the list really changed (not on every key press in the editor)
  subscribe(() => {
    const { aliasEntries } = getState();
    if (aliasEntries === lastEntries) return;
    refresh();
  });
  refresh();
}

function scrollTop(): void {
  (root.querySelector('#alias-table-wrapper') as HTMLElement).scrollTop = 0;
}

// ---------------------------------------------------------------- Rendering

function compare(a: AliasEntry, b: AliasEntry): number {
  switch (view.sortKey) {
    case 'alias':
      return naturalCompare(a.alias, b.alias);
    case 'category':
      return naturalCompare(categoryLabel(a.category), categoryLabel(b.category)) || naturalCompare(a.alias, b.alias);
    case 'confirmed':
      return Number(b.confirmed) - Number(a.confirmed) || naturalCompare(a.original, b.original);
    default:
      return naturalCompare(a.original, b.original);
  }
}

function refresh(): void {
  const { aliasEntries } = getState();
  lastEntries = aliasEntries;
  const total = aliasEntries.length;

  const q = view.query.trim().toLowerCase();
  visible = (q
    ? aliasEntries.filter((e) => e.original.toLowerCase().includes(q) || e.alias.toLowerCase().includes(q))
    : [...aliasEntries]
  ).sort((a, b) => compare(a, b) * view.sortDir);

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  view.page = Math.min(view.page, pages - 1);
  const start = view.page * PAGE_SIZE;
  const slice = visible.slice(start, start + PAGE_SIZE);

  const tbody = root.querySelector('#alias-tbody') as HTMLTableSectionElement;
  const empty = root.querySelector('#alias-empty') as HTMLElement;
  const table = root.querySelector('#alias-table') as HTMLElement;
  const badge = root.querySelector('#entry-count') as HTMLElement;
  const searchBar = root.querySelector('#alias-search-bar') as HTMLElement;
  const info = root.querySelector('#alias-search-info') as HTMLElement;
  const noMatch = root.querySelector('#alias-no-match') as HTMLElement;
  const pager = root.querySelector('#alias-pager') as HTMLElement;

  (root.querySelector('#btn-store-clear') as HTMLButtonElement).disabled = total === 0;
  (root.querySelector('#btn-store-export') as HTMLButtonElement).disabled = total === 0;

  empty.classList.toggle('hidden', total > 0);
  table.classList.toggle('hidden', total === 0);
  badge.classList.toggle('hidden', total === 0);
  badge.textContent = String(total);
  searchBar.classList.toggle('hidden', total === 0 && !q);
  info.textContent = q ? `${visible.length} of ${total}` : '';
  noMatch.classList.toggle('hidden', !(total > 0 && visible.length === 0));
  noMatch.textContent = `No name or placeholder matches “${view.query.trim()}”.`;

  pager.classList.toggle('hidden', visible.length <= PAGE_SIZE);
  if (visible.length > PAGE_SIZE) {
    root.querySelector('#alias-page-info')!.textContent = `${start + 1}–${start + slice.length} of ${visible.length}`;
    (root.querySelector('#alias-prev') as HTMLButtonElement).disabled = view.page === 0;
    (root.querySelector('#alias-next') as HTMLButtonElement).disabled = view.page >= pages - 1;
  }

  root.querySelectorAll<HTMLButtonElement>('.th-sort').forEach((b) => {
    const active = b.dataset.key === view.sortKey;
    const th = b.parentElement!;
    if (active) th.setAttribute('aria-sort', view.sortDir === 1 ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
    b.querySelector('.sort-icon')!.innerHTML = active ? (view.sortDir === 1 ? iconSortAsc : iconSortDesc) : '';
  });

  // Keep the focus (and any input not yet taken over) across the rebuild
  const active = document.activeElement as HTMLElement | null;
  let keep: { id: string; cls: string; value: string | null; pos: number | null } | null = null;
  if (active && tbody.contains(active)) {
    const id = (active.closest('tr') as HTMLElement | null)?.dataset.id;
    const cls = ['confirmed-cb', 'alias-input', 'category-select', 'btn-delete'].find((c) => active.classList.contains(c));
    if (id && cls) {
      const isText = active instanceof HTMLInputElement && active.type === 'text';
      keep = { id, cls, value: isText ? active.value : null, pos: isText ? active.selectionStart : null };
    }
  }

  // One single innerHTML build per page, events by delegation
  tbody.innerHTML = slice.map(rowHtml).join('');

  if (keep) {
    const el = tbody.querySelector<HTMLElement>(`tr[data-id="${CSS.escape(keep.id)}"] .${keep.cls}`);
    if (el) {
      if (keep.value !== null && el instanceof HTMLInputElement) {
        el.value = keep.value;
        if (keep.pos !== null) el.setSelectionRange(keep.pos, keep.pos);
      }
      el.focus();
    }
  }
}

const CAT_OPTIONS = (selected: Category): string =>
  CATEGORIES.map((c) => `<option value="${c.value}"${c.value === selected ? ' selected' : ''}>${c.label}</option>`).join('');

function rowHtml(e: AliasEntry): string {
  const o = escHtml(e.original);
  const label = escHtml(e.original.replace(/\s*\n\s*/g, ', '));
  const a = escHtml(e.alias);
  return `<tr data-id="${escHtml(e.id)}"${e.confirmed ? '' : ' class="unconfirmed"'}>
    <td class="cell-use"><input type="checkbox" class="confirmed-cb"${e.confirmed ? ' checked' : ''} aria-label="Hide ${label}" title="${e.confirmed ? 'Hidden and brought back' : 'Not hidden – tick to hide this text'}"></td>
    <td class="original-cell" title="${o}">${o.replace(/\n/g, '<span class="nl" aria-hidden="true">⏎</span>')}</td>
    <td class="alias-cell"><span class="alias-edit"><input type="text" class="alias-input" value="${a}" aria-label="Placeholder for ${label}" title="Click to change the placeholder" spellcheck="false">${iconPencil}</span></td>
    <td><select class="category-select" aria-label="Kind of ${label}">${CAT_OPTIONS(e.category)}</select></td>
    <td class="cell-del"><button type="button" class="btn-icon btn-delete" aria-label="Delete ${label}" title="Delete this name">${iconTrash}</button></td>
  </tr>`;
}

// ---------------------------------------------------------------- Row actions

function entryOf(el: Element): AliasEntry | undefined {
  const id = (el.closest('tr') as HTMLElement | null)?.dataset.id;
  return id ? getState().aliasEntries.find((e) => e.id === id) : undefined;
}

function bindRowEvents(tbody: HTMLTableSectionElement): void {
  tbody.addEventListener('change', async (ev) => {
    const t = ev.target as HTMLElement;
    const entry = entryOf(t);
    if (!entry) return;
    try {
      if (t.classList.contains('confirmed-cb')) {
        updateStateEntry(await api.updateEntry(entry.id, undefined, undefined, (t as HTMLInputElement).checked));
      } else if (t.classList.contains('category-select')) {
        updateStateEntry(await api.updateEntry(entry.id, undefined, (t as HTMLSelectElement).value as Category));
      }
    } catch (err: unknown) {
      showToast(`Something went wrong: ${errText(err)}`, 'error');
    }
  });

  tbody.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest('.btn-delete');
    if (!btn) return;
    const entry = entryOf(btn);
    if (entry) void deleteEntry(entry, btn.closest('tr')!);
  });

  tbody.addEventListener('keydown', (ev) => {
    const t = ev.target as HTMLElement;
    if (!t.classList.contains('alias-input')) return;
    const input = t as HTMLInputElement;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      input.blur();
    } else if (ev.key === 'Escape') {
      const entry = entryOf(input);
      if (entry) input.value = entry.alias;
      input.blur();
    }
  });

  // focusout instead of blur, because blur does not bubble
  tbody.addEventListener('focusout', (ev) => {
    const t = ev.target as HTMLElement;
    if (t.classList.contains('alias-input')) void commitAlias(t as HTMLInputElement);
  });
}

async function commitAlias(input: HTMLInputElement): Promise<void> {
  const entry = entryOf(input);
  if (!entry) return;
  const newAlias = input.value.trim();
  if (newAlias === entry.alias) {
    input.value = entry.alias;
    return;
  }
  const res = checkAlias(newAlias, entry.original, getState().aliasEntries, entry.id);
  if (!res.ok) {
    input.value = entry.alias;
    if (res.reason === 'empty') showToast(`The placeholder must not be empty – "${entry.alias}" was kept.`, 'info');
    else showToast(res.message, 'error', 6000);
    return;
  }
  try {
    updateStateEntry(await api.updateEntry(entry.id, newAlias));
    showToast('Placeholder changed.', 'success');
  } catch (err: unknown) {
    input.value = entry.alias;
    showToast(`Something went wrong: ${errText(err)}`, 'error');
  }
}

async function deleteEntry(entry: AliasEntry, tr: HTMLElement): Promise<void> {
  // After the rebuild, set the focus on the next row so it is not lost
  const rows = [...(tr.parentElement?.children ?? [])];
  const index = rows.indexOf(tr);
  try {
    await api.removeEntry(entry.id);
    const { aliasEntries } = getState();
    setState({ aliasEntries: aliasEntries.filter((e) => e.id !== entry.id) });
    const label = entry.original.replace(/\s*\n\s*/g, ', ');
    showUndo(`“${shorten(label)}” deleted.`, () => restoreEntries([entry]));
    const next = root.querySelectorAll<HTMLElement>('#alias-tbody .btn-delete');
    (next[Math.min(index, next.length - 1)] ?? (root.querySelector('#alias-search') as HTMLElement))?.focus();
  } catch (err: unknown) {
    showToast(`Something went wrong: ${errText(err)}`, 'error');
  }
}

/** Recreate deleted entries (alias, category and "Use" as before). */
async function restoreEntries(entries: AliasEntry[]): Promise<void> {
  try {
    const current = getState().aliasEntries;
    // Alias taken elsewhere in the meantime (or equal to an original)? Then assign a new one automatically.
    // Once as sets instead of per entry over the whole list: undo after "Clear" can affect thousands.
    const usedAliases = new Set(current.map((x) => x.alias.toLowerCase()));
    const originals = new Set(current.map((x) => x.original.toLowerCase()));
    let conflicts = 0;
    const items = entries.map((e) => {
      const a = e.alias.toLowerCase();
      const ok = !usedAliases.has(a) && !originals.has(a) && a !== e.original.toLowerCase();
      if (!ok) conflicts++;
      usedAliases.add(a);
      return { original: e.original, category: e.category, alias: ok ? e.alias : undefined };
    });
    // One single bulk call (one save); set "Use" again only for the unticked ones
    const restored = await api.addEntriesBulk(items);
    for (let i = 0; i < restored.length; i++) {
      if (restored[i].confirmed !== entries[i].confirmed) {
        restored[i] = await api.updateEntry(restored[i].id, undefined, undefined, entries[i].confirmed);
      }
    }
    const ids = new Set(current.map((x) => x.id));
    setState({ aliasEntries: [...current, ...restored.filter((x) => !ids.has(x.id) && ids.add(x.id))] });
    await api.saveStore();
    showToast(
      conflicts > 0
        ? `Restored. ${conflicts} placeholder${conflicts === 1 ? ' was' : 's were'} taken in the meantime and got a new one.`
        : entries.length === 1
          ? 'Name restored.'
          : `${entries.length} names restored.`,
      'success',
    );
  } catch (err: unknown) {
    showToast(`Something went wrong: ${errText(err)}`, 'error');
  }
}

function updateStateEntry(updated: AliasEntry): void {
  const { aliasEntries } = getState();
  setState({ aliasEntries: aliasEntries.map((e) => (e.id === updated.id ? updated : e)) });
}

// ---------------------------------------------------------------- Undo hint

let undoTimer: ReturnType<typeof setTimeout> | null = null;
let undoAction: (() => Promise<void>) | null = null;

function showUndo(text: string, action: () => Promise<void>): void {
  const bar = root.querySelector('#undo-bar') as HTMLElement;
  const btn = root.querySelector('#undo-btn') as HTMLButtonElement;
  root.querySelector('#undo-text')!.textContent = text;
  undoAction = action;
  btn.onclick = async () => {
    const a = undoAction;
    hideUndo();
    await a?.();
  };
  bar.classList.remove('hidden');
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, UNDO_MS);
}

function hideUndo(): void {
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = null;
  undoAction = null;
  root.querySelector('#undo-bar')?.classList.add('hidden');
}

// ---------------------------------------------------------------- Header bar

async function exportStore(): Promise<void> {
  try {
    const path = await api.exportStoreDialog();
    if (path) showToast(`Names and placeholders saved: ${path.split(/[\\/]/).pop()}`, 'success');
  } catch (e: unknown) {
    showToast(`Could not export: ${errText(e)}`, 'error');
  }
}

async function importStore(): Promise<void> {
  const before = getState().aliasEntries.length;
  // Read the chosen file as well to count skipped entries (api returns only the full list)
  let picked: File | null = null;
  const grab = (e: Event): void => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type === 'file') picked = t.files?.[0] ?? null;
  };
  document.addEventListener('change', grab, true);
  try {
    const entries = await api.importStoreDialog();
    if (!entries) return;
    setState({ aliasEntries: entries });
    const imported = Math.max(0, entries.length - before);
    let inFile: number | null = null;
    const file = picked as File | null;
    if (file) {
      try {
        inFile = parseStoreExport(await file.text()).length;
      } catch {
        inFile = null;
      }
    }
    const skipped = inFile === null ? 0 : Math.max(0, inFile - imported);
    showToast(
      `${imported} imported${skipped > 0 ? `, ${skipped} skipped (already in the list)` : ''}.`,
      imported > 0 ? 'success' : 'info',
    );
  } catch (e: unknown) {
    showToast(`Could not import: ${errText(e)}`, 'error');
  } finally {
    document.removeEventListener('change', grab, true);
  }
}

async function clearAll(): Promise<void> {
  const entries = [...getState().aliasEntries];
  const n = entries.length;
  if (n === 0) return;
  const choice = await confirmDialog({
    title: 'Delete all names and placeholders?',
    message: `Delete all ${n} name${n === 1 ? '' : 's'} and their placeholders? Answers to texts you already hid can then no longer get their names back.`,
    actions: [
      { value: 'export', label: 'Export first', keepOpen: true, run: exportStore },
      { value: 'delete', label: 'Delete all', kind: 'danger' },
    ],
  });
  if (choice !== 'delete') return;
  try {
    await api.clearStore();
    setState({ aliasEntries: [] });
    showUndo(`All ${n} names deleted.`, () => restoreEntries(entries));
  } catch (e: unknown) {
    showToast(`Something went wrong: ${errText(e)}`, 'error');
  }
}

// ---------------------------------------------------------------- Manual alias

function openManualAliasDialog(): void {
  if (document.getElementById('manual-alias-overlay')) return;

  const catOptions = CATEGORIES.map(
    (c) => `<option value="${c.value}"${c.value === 'person' ? ' selected' : ''}>${c.label}</option>`,
  ).join('');

  const { dialog, close } = openModal({
    id: 'manual-alias-overlay',
    className: 'modal-compact',
    titleId: 'manual-alias-title',
    html: `
      <div class="modal-header">
        <h2 class="modal-title" id="manual-alias-title">Add name</h2>
        <button type="button" class="modal-close" id="manual-alias-close" aria-label="Close" title="Close (Esc)">${iconX}</button>
      </div>
      <div class="modal-body">
        <form class="manual-alias-form" id="manual-alias-form" novalidate>
          <div class="form-field">
            <label for="manual-original">Name or text to hide</label>
            <input type="text" id="manual-original" name="original" autocomplete="off" placeholder="e.g. a name, company or term in your text" aria-describedby="manual-original-error" />
            <p class="field-error hidden" id="manual-original-error"></p>
          </div>
          <div class="form-field">
            <label for="manual-category">Kind</label>
            <select id="manual-category" name="category">${catOptions}</select>
          </div>
          <div class="form-field">
            <label for="manual-alias">Placeholder (optional)</label>
            <input type="text" id="manual-alias" name="alias" autocomplete="off" placeholder="Leave empty for an automatic one (e.g. Person-1)" aria-describedby="manual-alias-error" />
            <p class="field-error hidden" id="manual-alias-error"></p>
          </div>
          <p class="form-hint">Find names does not need to find it first. When you hide names, exactly this text is swapped for the placeholder.</p>
        </form>
      </div>
      <div class="modal-footer">
        <button type="button" id="manual-alias-cancel">Cancel</button>
        <button type="submit" form="manual-alias-form" class="primary" id="manual-alias-submit">Add</button>
      </div>`,
    initialFocus: (d) => d.querySelector<HTMLElement>('#manual-original'),
  });

  const form = dialog.querySelector('#manual-alias-form') as HTMLFormElement;
  const origIn = dialog.querySelector('#manual-original') as HTMLInputElement;
  const aliasIn = dialog.querySelector('#manual-alias') as HTMLInputElement;
  const setError = (input: HTMLInputElement, msg: string): void => {
    const p = dialog.querySelector(`#${input.id}-error`) as HTMLElement;
    p.textContent = msg;
    p.classList.toggle('hidden', !msg);
    if (msg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };
  origIn.addEventListener('input', () => setError(origIn, ''));
  aliasIn.addEventListener('input', () => setError(aliasIn, ''));

  dialog.querySelector('#manual-alias-close')!.addEventListener('click', close);
  dialog.querySelector('#manual-alias-cancel')!.addEventListener('click', close);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const original = origIn.value.trim();
    if (!original) {
      setError(origIn, 'Please enter the text to hide.');
      origIn.focus();
      return;
    }
    const aliasRaw = aliasIn.value.trim();
    const category = (dialog.querySelector('#manual-category') as HTMLSelectElement).value as Category;
    const existing = getState().aliasEntries;
    const already = existing.find((x) => x.original.toLowerCase() === original.toLowerCase());
    if (already) {
      setError(origIn, `This text is already in the list (placeholder "${already.alias}").`);
      origIn.focus();
      return;
    }
    if (aliasRaw) {
      const res = checkAlias(aliasRaw, original, existing);
      if (!res.ok) {
        setError(aliasIn, res.message);
        aliasIn.focus();
        return;
      }
    }

    try {
      const entry = await api.addEntry(original, aliasRaw || null, category);
      const { aliasEntries } = getState();
      const merged = aliasEntries.some((x) => x.id === entry.id)
        ? aliasEntries.map((x) => (x.id === entry.id ? entry : x))
        : [...aliasEntries, entry];
      setState({ aliasEntries: merged });
      await api.saveStore();
      showToast(`Added – placeholder “${entry.alias}”.`, 'success');
      close();
    } catch (err: unknown) {
      showToast(`Something went wrong: ${errText(err)}`, 'error');
    }
  });
}

function shorten(s: string, n = 40): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
