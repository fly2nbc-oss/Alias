/**
 * The one bar at the top: Open and Find names (quiet), the step switch, Save ▾, exactly one
 * primary button on the far right that always names the next step, and Theme/Settings/About.
 */
import {
  cancelFind,
  copyVisible,
  goStep,
  isFinding,
  openViaDialog,
  runFind,
  runPrimary,
  saveFileCopy,
  saveText,
  states,
} from '../actions';
import {
  icon,
  iconChevronDown,
  iconFolderOpen,
  iconInfo,
  iconSave,
  iconSearch,
  iconSettings,
  iconSquare,
  P,
} from '../icons';
import { getState, subscribe } from '../store';
import type { AppMode } from '../types';
import { cycleTheme, syncThemeButton } from '../utils/theme';
import { PRIMARY_LABEL, primary, statsOf, type ActionState, type PrimaryId } from '../workflow';
import { showAboutDialog } from './about-dialog';
import { showSettingsDialog } from './settings-dialog';

const PRIMARY_ICON: Record<PrimaryId, string> = {
  open: P.folderOpen,
  find: P.search,
  hide: P.eyeOff,
  copyForAi: P.copy,
  saveForAi: P.save,
  pasteAnswer: P.paste,
  openAnswer: P.folderOpen,
  bringBack: P.eye,
  copy: P.copy,
  saveFile: P.save,
};

export function renderToolbar(container: HTMLElement): void {
  // All labels of the primary button are stacked in one grid cell: the button is always as wide
  // as its longest label, so nothing next to it moves when the label changes (R1).
  const labels = (Object.keys(PRIMARY_LABEL) as PrimaryId[])
    .map((id) => `<span class="primary-label" data-id="${id}">${icon(PRIMARY_ICON[id])}<span>${PRIMARY_LABEL[id]}</span></span>`)
    .join('');
  container.innerHTML = `
    <span class="toolbar-title">Alias</span>
    <span class="toolbar-sep" aria-hidden="true"></span>
    <button type="button" id="btn-open" class="btn-secondary">${iconFolderOpen}<span class="btn-label">Open</span></button>
    <button type="button" id="btn-detect" class="btn-secondary">
      ${iconSearch}<span class="spinner" aria-hidden="true"></span><span class="btn-label">Find names</span>
    </button>
    <button type="button" id="btn-cancel-detect" class="btn-secondary hidden" title="Stop looking (Esc) – Alias shows what the simple rules found">
      ${iconSquare}<span>Stop</span>
    </button>
    <span class="toolbar-sep" aria-hidden="true"></span>
    <div class="seg" role="group" aria-label="Which text">
      <button type="button" id="mode-encode" data-mode="encode" aria-pressed="true">1 · My text</button>
      <button type="button" id="mode-decode" data-mode="decode" aria-pressed="false">2 · AI's answer</button>
    </div>
    <span class="toolbar-spacer"></span>
    <div class="save-menu-wrap">
      <button type="button" id="btn-save-result" class="btn-secondary" aria-haspopup="menu" aria-expanded="false" aria-controls="save-menu">
        ${iconSave}<span class="btn-label">Save</span>${iconChevronDown}
      </button>
      <div id="save-menu" class="menu hidden" role="menu" aria-label="Save">
        <button type="button" id="btn-save-copy" role="menuitem">
          <span class="menu-title">Copy in the original format</span>
          <span class="menu-hint"></span>
        </button>
        <button type="button" id="btn-save-text" role="menuitem">
          <span class="menu-title">Text (.txt)</span>
          <span class="menu-hint"></span>
        </button>
        <button type="button" id="btn-copy-text" role="menuitem">
          <span class="menu-title">Copy the text</span>
          <span class="menu-hint"></span>
        </button>
      </div>
    </div>
    <button type="button" id="btn-primary" class="primary">${labels}</button>
    <span class="toolbar-sep" aria-hidden="true"></span>
    <button type="button" id="btn-theme" class="btn-icon" aria-label="Appearance"></button>
    <button type="button" id="btn-settings" class="btn-icon" title="Settings" aria-label="Settings">${iconSettings}</button>
    <button type="button" id="btn-about" class="btn-icon" title="About Alias and licenses" aria-label="About">${iconInfo}</button>
  `;

  bindEvents(container);
  subscribe(() => updateToolbar(container));
  updateToolbar(container);
  syncThemeButton();
}

export function applyAction(btn: HTMLElement, st: ActionState): void {
  // aria-disabled instead of disabled: the tooltip with the reason stays (R2)
  btn.setAttribute('aria-disabled', String(!st.enabled));
  btn.classList.toggle('is-disabled', !st.enabled);
  btn.title = st.title;
}

function updateToolbar(container: HTMLElement): void {
  const s = getState();
  const st = states();
  const p = primary(s, statsOf(s));
  const q = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel)!;

  // The primary button: one label visible, the others keep the width
  const main = q('#btn-primary');
  main.dataset.action = p.id;
  main.querySelectorAll<HTMLElement>('.primary-label').forEach((l) => l.classList.toggle('on', l.dataset.id === p.id));
  applyAction(main, { enabled: p.enabled && !s.isProcessing, title: s.isProcessing ? 'Please wait – Alias is looking for names.' : p.title });
  main.setAttribute('aria-label', p.label);

  // Open / Find names stay quiet; the one that is the next step moves to the primary button
  const open = q('#btn-open');
  applyAction(open, st.open);
  // In step 2 Open opens the AI's file: the same as "Open AI's file". In step 1 Open stays for the
  // user's own file, even when the primary already offers the AI's file.
  open.classList.toggle('hidden', p.id === 'open' || (p.id === 'openAnswer' && s.mode === 'decode'));
  const find = q('#btn-detect');
  applyAction(find, st.find);
  const busy = s.isProcessing && isFinding();
  find.classList.toggle('hidden', p.id === 'find' && !busy);
  find.classList.toggle('is-busy', busy);
  find.setAttribute('aria-busy', String(busy));
  const pr = s.detectProgress;
  q('#btn-detect .btn-label').textContent = busy ? (pr && pr.total > 1 ? `Finding… ${pr.done}/${pr.total}` : 'Finding…') : 'Find names';
  if (busy) find.title = 'Alias is looking for names. Press Esc or Stop to stop.';
  q('#btn-cancel-detect').classList.toggle('hidden', !busy);

  // Step switch: step 2 greyed out (with the reason) until the names are hidden
  container.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) => {
    const mode = b.dataset.mode as AppMode;
    const on = mode === s.mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    applyAction(b, mode === 'encode' ? st.step1 : st.step2);
  });

  applyAction(q('#btn-save-result'), st.save);
  applyAction(q('#btn-save-copy'), st.saveCopy);
  applyAction(q('#btn-save-text'), st.saveText);
  applyAction(q('#btn-copy-text'), st.copy);
  // Step 1: own file with placeholders; step 2: the AI's file with the real names
  const enc = s.mode === 'encode';
  const path = enc ? s.sourcePath : (s.answerFile?.path ?? null);
  const name = path ? (path.split(/[\\/]/).pop() ?? '') : '';
  q('#btn-save-copy .menu-title').textContent = name
    ? `Copy of ${name} ${enc ? 'with placeholders' : 'with the real names'}`
    : 'Copy in the original format';
  q('#btn-save-copy .menu-hint').textContent = st.saveCopy.enabled
    ? `Same format as the file, ${enc ? 'names hidden' : 'names back'}`
    : st.saveCopy.title;
  q('#btn-save-text .menu-hint').textContent = st.saveText.enabled ? 'The text shown, as .txt' : st.saveText.title;
  q('#btn-copy-text .menu-hint').textContent = st.copy.enabled ? 'The text shown, to paste somewhere else' : st.copy.title;

  container.setAttribute('aria-busy', String(s.isProcessing));
}

// ---------------------------------------------------------------- Save menu

function setMenu(container: HTMLElement, open: boolean): void {
  const menu = container.querySelector<HTMLElement>('#save-menu')!;
  const btn = container.querySelector<HTMLElement>('#btn-save-result')!;
  menu.classList.toggle('hidden', !open);
  btn.setAttribute('aria-expanded', String(open));
  if (open) {
    const first = menu.querySelector<HTMLElement>('[role=menuitem][aria-disabled=false]') ?? menu.querySelector<HTMLElement>('[role=menuitem]');
    first?.focus();
  }
}

function bindEvents(container: HTMLElement): void {
  const on = (id: string, fn: () => unknown) => container.querySelector(`#${id}`)!.addEventListener('click', () => void fn());

  on('btn-theme', cycleTheme);
  on('btn-about', showAboutDialog);
  on('btn-settings', () => showSettingsDialog());
  on('btn-open', openViaDialog);
  on('btn-detect', () => (isFinding() ? undefined : runFind()));
  on('btn-cancel-detect', cancelFind);
  on('btn-primary', runPrimary);
  container.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) => b.addEventListener('click', () => goStep(b.dataset.mode as AppMode)));

  const menu = container.querySelector<HTMLElement>('#save-menu')!;
  container.querySelector('#btn-save-result')!.addEventListener('click', () => {
    if (!states().save.enabled) return;
    setMenu(container, menu.classList.contains('hidden'));
  });
  container.querySelector('#btn-save-copy')!.addEventListener('click', () => {
    setMenu(container, false);
    void saveFileCopy();
  });
  container.querySelector('#btn-save-text')!.addEventListener('click', () => {
    setMenu(container, false);
    void saveText();
  });
  container.querySelector('#btn-copy-text')!.addEventListener('click', () => {
    setMenu(container, false);
    void copyVisible();
  });
  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('hidden') && !(e.target as Element).closest('.save-menu-wrap')) setMenu(container, false);
  });
  menu.addEventListener('keydown', (e) => {
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role=menuitem]'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      setMenu(container, false);
      container.querySelector<HTMLElement>('#btn-save-result')!.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    }
  });
}
