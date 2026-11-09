import * as api from '../api';
import { icon, iconAlert, iconCheck, iconX, P } from '../icons';
import { getState, setState, subscribe } from '../store';
import type { BulkAddItem, Category, DetectionSource, EntityCandidate } from '../types';
import { CATEGORIES } from '../types';
import { checkAlias, type AliasLike } from './alias-validation';
import { escHtml, setupDialog, type DialogHandle } from './dialog';
import { showToast } from './notification';

interface CandidateUI extends EntityCandidate {
  uid: number;
  checked: boolean;
  aliasOverride: string;
  categoryOverride: Category;
  textOverride: string;
  /** Input fields of the row (for updates without rebuilding) */
  row?: {
    tr: HTMLTableRowElement;
    cb: HTMLInputElement;
    text: HTMLInputElement | HTMLTextAreaElement;
    alias: HTMLInputElement;
  };
}

/** Plain-language label and explanation of who found the name */
const SOURCE_INFO: Record<DetectionSource, { label: string; hint: string }> = {
  rule:    { label: 'rule',        hint: 'Found by a simple rule (e.g. email address, IBAN, phone number, date)' },
  lexicon: { label: 'list',        hint: 'Found in a built-in list (e.g. first names, brands)' },
  ner:     { label: 'name finder', hint: 'Found by the smart name finder (AI)' },
  hybrid:  { label: 'both',        hint: 'Found by the smart name finder and by a rule or list' },
  parser:  { label: 'address',     hint: 'Found as a postal address (street line followed by postcode and town)' },
};

const CATEGORY_ORDER = new Map(CATEGORIES.map((c, i) => [c.value, i]));
const categoryLabel = (c: Category): string => CATEGORIES.find((x) => x.value === c)?.label ?? c;

let uiCandidates: CandidateUI[] = [];
let isOpen = false;
let dialogHandle: DialogHandle | null = null;
let busy = false;

export function initCandidateReview(): void {
  subscribe(() => {
    const { showCandidateReview, candidates } = getState();
    const shouldOpen = showCandidateReview && candidates.length > 0;
    // Build/tear down only on the transition, else focus and input would be lost on every state update
    if (shouldOpen && !isOpen) open(candidates);
    else if (!shouldOpen && isOpen) teardown();
  });
}

function open(candidates: readonly EntityCandidate[]): void {
  isOpen = true;
  let uid = 0;
  uiCandidates = candidates
    .map((c) => ({
      ...c,
      uid: uid++,
      checked: c.confidence >= 0.75,
      aliasOverride: '',
      categoryOverride: c.category,
      textOverride: c.text,
    }))
    // Grouped by category (order as in the select list), most frequent first within each
    .sort(
      (a, b) =>
        (CATEGORY_ORDER.get(a.category) ?? 99) - (CATEGORY_ORDER.get(b.category) ?? 99) ||
        b.occurrences - a.occurrences ||
        a.text.localeCompare(b.text),
    );

  const overlay = document.getElementById('modal-overlay')!;
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');
  const modal = buildModal();
  overlay.appendChild(modal);

  const firstCb = modal.querySelector<HTMLElement>('.cand-table tbody input[type=checkbox]');
  dialogHandle = setupDialog(overlay, modal, {
    labelledBy: 'cand-title',
    describedBy: 'cand-desc',
    initialFocus: firstCb,
    onCancel: close,
    closeOnBackdrop: false,
    onKeydown: (e) => {
      if (e.key !== 'Enter') return false;
      const t = e.target as HTMLElement;
      const ctrl = e.ctrlKey || e.metaKey;
      // Enter confirms when the focus is on a checkbox or the dialog; in text fields and selects only with Ctrl
      const plainOk = t === modal || (t instanceof HTMLInputElement && t.type === 'checkbox');
      if (ctrl || plainOk) {
        void confirmSelected();
        return true;
      }
      return false;
    },
  });
}

function teardown(): void {
  isOpen = false;
  const overlay = document.getElementById('modal-overlay')!;
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
  uiCandidates = [];
  dialogHandle?.release();
  dialogHandle = null;
}

function buildModal(): HTMLElement {
  const modal = document.createElement('div');
  modal.className = 'modal cand-modal';
  const anyReview = uiCandidates.some((c) => c.needs_review === true);

  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title-icon">${icon(P.search, 20)}</span>
      <h2 class="modal-title" id="cand-title">${uiCandidates.length} name${uiCandidates.length === 1 ? '' : 's'} found</h2>
      <button type="button" class="modal-close" id="modal-close-btn" aria-label="Close" title="Close (Esc)">${iconX}</button>
    </div>
    <div class="cand-toolbar">
      <p class="cand-desc" id="cand-desc">
        Tick the names to hide. Click a kind to tick or untick all of it.
        ${anyReview ? `<span class="cand-review-legend">${iconAlert} = not sure, please check</span>` : ''}
      </p>
      <div class="cand-chips" role="group" aria-label="Tick by kind"></div>
    </div>
    <div class="modal-body">
      <table class="cand-table">
        <thead>
          <tr>
            <th scope="col" class="col-use">Hide</th>
            <th scope="col" class="col-src">Found by</th>
            <th scope="col" class="col-text">Name</th>
            <th scope="col" class="col-cat">Kind</th>
            <th scope="col" class="col-alias">Placeholder (optional)</th>
            <th scope="col" class="col-count" title="How often it is in the text">Times</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
    <div class="modal-footer">
      <button type="button" id="btn-select-all">Tick all</button>
      <button type="button" id="btn-select-none">Untick all</button>
      <span class="cand-summary" id="cand-summary" aria-live="polite"></span>
      <div class="footer-spacer"></div>
      <p class="cand-error hidden" id="cand-error" role="alert"></p>
      <button type="button" id="btn-cancel-review">Cancel</button>
      <button type="button" id="btn-confirm-review" class="primary" title="Put the ticked names in the list (Ctrl+Enter). Then click Hide names.">Use these names</button>
    </div>
  `;

  renderRows(modal);
  renderChips(modal);
  updateSummary(modal);

  modal.querySelector('#modal-close-btn')!.addEventListener('click', close);
  modal.querySelector('#btn-cancel-review')!.addEventListener('click', close);
  modal.querySelector('#btn-select-all')!.addEventListener('click', () => setChecked(modal, uiCandidates, true));
  modal.querySelector('#btn-select-none')!.addEventListener('click', () => setChecked(modal, uiCandidates, false));
  modal.querySelector('#btn-confirm-review')!.addEventListener('click', () => void confirmSelected());

  return modal;
}

function setChecked(modal: HTMLElement, list: CandidateUI[], value: boolean): void {
  for (const c of list) {
    c.checked = value;
    if (c.row) c.row.cb.checked = value;
  }
  renderChips(modal);
  updateSummary(modal);
}

function renderChips(modal: HTMLElement): void {
  const box = modal.querySelector('.cand-chips')!;
  const focusedCat = (document.activeElement as HTMLElement | null)?.dataset?.cat;
  box.innerHTML = '';
  for (const cat of groupOrder()) {
    const list = uiCandidates.filter((c) => c.category === cat);
    const on = list.filter((c) => c.checked).length;
    const state = on === 0 ? 'false' : on === list.length ? 'true' : 'mixed';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cat-chip cat-chip--${state}`;
    btn.dataset.cat = cat;
    btn.setAttribute('aria-pressed', state);
    btn.title = state === 'true' ? `Untick all of kind ${categoryLabel(cat)}` : `Tick all of kind ${categoryLabel(cat)}`;
    btn.innerHTML = `<span class="cat-chip-box" aria-hidden="true">${state === 'true' ? iconCheck : state === 'mixed' ? '–' : ''}</span>${escHtml(categoryLabel(cat))} <span class="cat-chip-count">${on}/${list.length}</span>`;
    btn.addEventListener('click', () => setChecked(modal, list, state !== 'true'));
    box.appendChild(btn);
    if (focusedCat === cat) btn.focus();
  }
}

function groupOrder(): Category[] {
  const seen: Category[] = [];
  for (const c of uiCandidates) if (!seen.includes(c.category)) seen.push(c.category);
  return seen;
}

function updateSummary(modal: HTMLElement): void {
  const n = uiCandidates.filter((c) => c.checked).length;
  modal.querySelector('#cand-summary')!.textContent = `${n} of ${uiCandidates.length} ticked`;
}

/** Excerpt around the first match; offsets are UTF-16 indices into the source text. */
function contextHtml(c: CandidateUI): string {
  const text = getState().originalText;
  const first = c.offsets?.[0];
  if (!first || !text) return '';
  const [s, e] = first;
  if (s < 0 || e > text.length || s >= e) return '';
  const R = 36;
  const flat = (t: string) => escHtml(t.replace(/\s*\n\s*/g, ' ⏎ ').replace(/\s+/g, ' '));
  const before = text.slice(Math.max(0, s - R), s);
  const after = text.slice(e, e + R);
  return `${s > R ? '…' : ''}${flat(before)}<mark>${flat(text.slice(s, e))}</mark>${flat(after)}${e + R < text.length ? '…' : ''}`;
}

function renderRows(modal: HTMLElement): void {
  const tbody = modal.querySelector('.cand-table tbody')!;
  tbody.innerHTML = '';
  let currentCat: Category | null = null;

  for (const c of uiCandidates) {
    if (c.category !== currentCat) {
      currentCat = c.category;
      const count = uiCandidates.filter((x) => x.category === currentCat).length;
      const g = document.createElement('tr');
      g.className = 'cand-group';
      g.innerHTML = `<th colspan="6" scope="colgroup">${escHtml(categoryLabel(currentCat))} <span class="cand-group-count">(${count})</span></th>`;
      tbody.appendChild(g);
    }

    const tr = document.createElement('tr');
    tr.className = 'cand-row';
    const review = c.needs_review === true;
    if (review) tr.classList.add('cand-needs-review');
    const name = c.text.replace(/\s*\n\s*/g, ', ');
    const multiline = c.text.includes('\n');
    const lines = Math.min(4, c.text.split('\n').length);

    const catOptions = CATEGORIES.map(
      (cat) => `<option value="${cat.value}" ${cat.value === c.categoryOverride ? 'selected' : ''}>${cat.label}</option>`,
    ).join('');
    const src = c.detection_source ? SOURCE_INFO[c.detection_source] : null;
    const srcHtml = src
      ? `<span class="method-badge method-badge--${c.detection_source}" title="${escHtml(src.hint)}">${src.label}<span class="visually-hidden">: ${escHtml(src.hint)}</span></span>`
      : '';
    const reviewHtml = review
      ? `<span class="cand-review-icon" title="Not sure – please check">${iconAlert}<span class="visually-hidden">Not sure, please check.</span></span>`
      : '';
    const textField = multiline
      ? `<textarea class="cand-text-input" rows="${lines}" aria-label="Name ${escHtml(name)}" spellcheck="false">${escHtml(c.textOverride)}</textarea>`
      : `<input type="text" class="cand-text-input" value="${escHtml(c.textOverride)}" aria-label="Name ${escHtml(name)}" spellcheck="false">`;
    const ctx = contextHtml(c);

    tr.innerHTML = `
      <td class="col-use"><input type="checkbox" ${c.checked ? 'checked' : ''} aria-label="Hide ${escHtml(name)}"></td>
      <td class="col-src">${srcHtml}</td>
      <td class="col-text">
        <div class="cand-text-wrap">${reviewHtml}${textField}</div>
        ${ctx ? `<div class="cand-context" title="Where it is in the text">${ctx}</div>` : ''}
      </td>
      <td class="col-cat"><select class="category-select" aria-label="Kind of ${escHtml(name)}">${catOptions}</select></td>
      <td class="col-alias"><input type="text" class="cand-alias-input" placeholder="automatic" value="${escHtml(c.aliasOverride)}" aria-label="Placeholder for ${escHtml(name)}" title="Leave empty for an automatic placeholder (e.g. Person-1)"></td>
      <td class="col-count">${c.occurrences}×</td>
    `;

    const cb = tr.querySelector('input[type=checkbox]') as HTMLInputElement;
    const textIn = tr.querySelector('.cand-text-input') as HTMLInputElement | HTMLTextAreaElement;
    const aliasIn = tr.querySelector('.cand-alias-input') as HTMLInputElement;
    c.row = { tr, cb, text: textIn, alias: aliasIn };

    cb.addEventListener('change', () => {
      c.checked = cb.checked;
      renderChips(modal);
      updateSummary(modal);
    });
    // Take the value as is (line breaks too); trimming happens only on confirm
    textIn.addEventListener('input', () => {
      c.textOverride = textIn.value;
      clearInvalid(textIn);
    });
    const catSel = tr.querySelector('select') as HTMLSelectElement;
    catSel.addEventListener('change', () => {
      c.categoryOverride = catSel.value as Category;
    });
    aliasIn.addEventListener('input', () => {
      c.aliasOverride = aliasIn.value;
      clearInvalid(aliasIn);
    });

    tbody.appendChild(tr);
  }
}

function clearInvalid(el: HTMLElement): void {
  if (el.getAttribute('aria-invalid') !== 'true') return;
  el.removeAttribute('aria-invalid');
  const err = document.getElementById('cand-error');
  if (err) {
    err.textContent = '';
    err.classList.add('hidden');
  }
}

function showError(field: HTMLElement, message: string): void {
  field.setAttribute('aria-invalid', 'true');
  const err = document.getElementById('cand-error');
  if (err) {
    err.textContent = message;
    err.classList.remove('hidden');
  }
  field.scrollIntoView({ block: 'nearest' });
  field.focus();
}

/** Checks the selection; returns false and marks the first invalid field. */
function validate(selected: CandidateUI[]): boolean {
  const table = getState().aliasEntries;
  for (const c of selected) {
    const original = c.textOverride.trim();
    if (!original) {
      showError(c.row!.text, 'A ticked name must not be empty.');
      return false;
    }
    const alias = c.aliasOverride.trim();
    if (!alias) continue;
    // Against the table and the other selected entries (their originals and own aliases)
    const planned: AliasLike[] = selected
      .filter((o) => o !== c)
      .map((o) => ({ id: `cand-${o.uid}`, original: o.textOverride.trim(), alias: o.aliasOverride.trim() }));
    const res = checkAlias(alias, original, [...table, ...planned]);
    if (!res.ok) {
      showError(c.row!.alias, res.message);
      return false;
    }
  }
  return true;
}

async function confirmSelected(): Promise<void> {
  if (busy) return;
  const selected = uiCandidates.filter((c) => c.checked);
  if (selected.length === 0) {
    showToast('No names ticked.', 'info');
    return;
  }
  if (!validate(selected)) return;

  const items: BulkAddItem[] = selected.map((c) => ({
    original: c.textOverride.trim() || c.text,
    category: c.categoryOverride,
    alias: c.aliasOverride.trim() || undefined,
  }));

  busy = true;
  try {
    const before = getState().aliasEntries;
    const beforeIds = new Set(before.map((e) => e.id));
    const entries = await api.addEntriesBulk(items);
    // New = IDs that were not in the table before; the store returns existing ones unchanged
    const newIds = new Set(entries.filter((e) => !beforeIds.has(e.id)).map((e) => e.id));
    const existingIds = new Set(entries.filter((e) => beforeIds.has(e.id)).map((e) => e.id));
    const seen = new Set<string>();
    const fresh = entries.filter((e) => newIds.has(e.id) && !seen.has(e.id) && seen.add(e.id));
    setState({ aliasEntries: [...before, ...fresh], showCandidateReview: false, candidates: [] });
    // The status bar says how many names were found; only names already in the list get a hint
    if (existingIds.size > 0) {
      showToast(`${newIds.size} added, ${existingIds.size} already in the list.`, newIds.size > 0 ? 'success' : 'info');
    }
    await api.saveStore();
  } catch (e: unknown) {
    showToast(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`, 'error');
  } finally {
    busy = false;
  }
}

function close(): void {
  setState({ showCandidateReview: false, candidates: [] });
}
