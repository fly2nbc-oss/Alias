import * as api from '../api';
import { getState, setState, subscribe } from '../store';
import type { BulkAddItem, Category, DetectionSource, EntityCandidate } from '../types';
import { CATEGORIES } from '../types';
import { showToast } from './notification';

interface CandidateUI extends EntityCandidate {
  checked: boolean;
  aliasOverride: string;
  categoryOverride: Category;
  textOverride: string;
}

let uiCandidates: CandidateUI[] = [];

const SOURCE_BADGE: Record<DetectionSource, string> = {
  rule:    'RULE',
  lexicon: 'DICT',
  ner:     'NER',
  hybrid:  'MIX',
  parser:  'PAR',
};

function sourceBadge(src?: DetectionSource): string {
  if (!src) return '';
  return SOURCE_BADGE[src] ?? src.toUpperCase().slice(0, 3);
}

export function initCandidateReview(): void {
  subscribe(() => {
    const { showCandidateReview, candidates } = getState();
    const overlay = document.getElementById('modal-overlay')!;

    if (showCandidateReview && candidates.length > 0) {
      uiCandidates = candidates.map(c => ({
        ...c,
        checked: c.confidence >= 0.75,
        aliasOverride: '',
        categoryOverride: c.category,
        textOverride: '',
      }));
      overlay.classList.remove('hidden');
      overlay.innerHTML = '';
      overlay.appendChild(buildModal());
    } else {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
    }
  });
}

function buildModal(): HTMLElement {
  const modal = document.createElement('div');
  modal.className = 'modal';

  modal.innerHTML = `
    <div class="modal-header">
      <span>🔍 Detected entities (${uiCandidates.length})</span>
      <button class="modal-close" id="modal-close-btn" title="Close">✕</button>
    </div>
    <div class="modal-body">
      <div class="candidate-list" id="candidate-list"></div>
    </div>
    <div class="modal-footer">
      <button id="btn-select-all">Select all</button>
      <button id="btn-select-none">Select none</button>
      <div style="flex:1"></div>
      <button id="btn-cancel-review">Cancel</button>
      <button id="btn-confirm-review" class="primary">Confirm & add</button>
    </div>
  `;

  renderCandidateList(modal);

  modal.querySelector('#modal-close-btn')!.addEventListener('click', close);
  modal.querySelector('#btn-cancel-review')!.addEventListener('click', close);

  modal.querySelector('#btn-select-all')!.addEventListener('click', () => {
    uiCandidates.forEach(c => c.checked = true);
    renderCandidateList(modal);
  });

  modal.querySelector('#btn-select-none')!.addEventListener('click', () => {
    uiCandidates.forEach(c => c.checked = false);
    renderCandidateList(modal);
  });

  modal.querySelector('#btn-confirm-review')!.addEventListener('click', confirmSelected);

  return modal;
}

function renderCandidateList(modal: HTMLElement): void {
  const list = modal.querySelector('#candidate-list')!;
  list.innerHTML = '';

  for (let i = 0; i < uiCandidates.length; i++) {
    const c = uiCandidates[i];
    const item = document.createElement('div');
    item.className = 'candidate-item';

    const catOptions = CATEGORIES.map(cat =>
      `<option value="${cat.value}" ${cat.value === c.categoryOverride ? 'selected' : ''}>${cat.label}</option>`
    ).join('');

    const badge = sourceBadge(c.detection_source);
    const badgeHtml = badge
      ? `<span class="method-badge method-badge--${(c.detection_source ?? 'rule')}" title="${escHtml(c.detection_source ?? '')}">${badge}</span>`
      : '<span class="method-badge method-badge--none"></span>';

    const needsReviewClass = c.needs_review === true ? 'cand-needs-review' : '';
    const reviewPrefix = c.needs_review === true ? '⚠ ' : '';
    const displayText = c.textOverride || c.text;

    item.innerHTML = `
      <input type="checkbox" ${c.checked ? 'checked' : ''} title="Select">
      ${badgeHtml}
      <input type="text" class="cand-text-input ${needsReviewClass}" value="${escHtml(displayText)}" title="${reviewPrefix}${escHtml(c.text)} — adjust text manually">
      <select class="category-select" style="width:100%">${catOptions}</select>
      <input type="text" class="cand-alias-input" placeholder="Auto" value="${escHtml(c.aliasOverride)}" title="Override alias (empty = automatic)">
      <span class="cand-count" style="text-align:right">${c.occurrences}×</span>
    `;

    const cb = item.querySelector('input[type=checkbox]') as HTMLInputElement;
    cb.addEventListener('change', () => {
      uiCandidates[i].checked = cb.checked;
    });

    const textIn = item.querySelector('.cand-text-input') as HTMLInputElement;
    textIn.addEventListener('input', () => {
      uiCandidates[i].textOverride = textIn.value;
    });

    const catSel = item.querySelector('select') as HTMLSelectElement;
    catSel.addEventListener('change', () => {
      uiCandidates[i].categoryOverride = catSel.value as Category;
    });

    const aliasIn = item.querySelector('.cand-alias-input') as HTMLInputElement;
    aliasIn.addEventListener('input', () => {
      uiCandidates[i].aliasOverride = aliasIn.value;
    });

    list.appendChild(item);
  }
}

async function confirmSelected(): Promise<void> {
  const selected = uiCandidates.filter(c => c.checked);
  if (selected.length === 0) {
    showToast('No entries selected.', 'info');
    return;
  }

  const items: BulkAddItem[] = selected.map(c => ({
    original: c.textOverride.trim() || c.text,
    category: c.categoryOverride,
    alias: c.aliasOverride || undefined,
  }));

  try {
    const entries = await api.addEntriesBulk(items);
    const { aliasEntries } = getState();
    const existingIds = new Set(aliasEntries.map(e => e.id));
    const merged = [...aliasEntries, ...entries.filter(e => !existingIds.has(e.id))];
    setState({ aliasEntries: merged, showCandidateReview: false, candidates: [] });
    showToast(`${entries.length} entries added.`, 'success');
    await api.saveStore();
  } catch (e: any) {
    showToast(`Error: ${e}`, 'error');
  }
}

function close(): void {
  setState({ showCandidateReview: false, candidates: [] });
}

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
