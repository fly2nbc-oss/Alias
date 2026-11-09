/**
 * Status bar (28 px) at the bottom: what happened and what to do next in one plain sentence,
 * the opened file, "Locked · Change text" and the state of the name finder.
 */
import { editInput } from '../actions';
import { icon, P } from '../icons';
import { getState, subscribe } from '../store';
import { finderStatus, statsOf, statusOf, type TagIcon } from '../workflow';
import { escHtml } from './dialog';

const TAG_ICON: Record<TagIcon, string> = {
  search: P.search,
  eyeOff: P.eyeOff,
  eye: P.eye,
  check: P.check,
  paste: P.paste,
  file: P.fileText,
  alert: P.circleAlert,
};

let onFinderLink: (link: string) => void = () => {};

/** What "Turn on" / "Retry" next to the finder state do (set by main.ts). */
export function setFinderLinkHandler(fn: (link: string) => void): void {
  onFinderLink = fn;
}

export function renderStatusBar(container: HTMLElement): void {
  container.innerHTML = `
    <span class="sb-main" role="status" aria-live="polite">
      <span class="sb-tag hidden" id="sb-tag"></span>
      <span class="sb-say" id="sb-say"></span>
    </span>
    <span class="sb-group sb-file hidden" id="sb-file"></span>
    <span class="sb-group sb-lock hidden" id="sb-lock">
      ${icon(P.lock, 14)}<span>Locked</span>
      <button type="button" class="link" id="sb-change"></button>
    </span>
    <span class="sb-spacer"></span>
    <span class="sb-group sb-finder" id="sb-finder">
      <span class="dot" aria-hidden="true"></span><span id="sb-finder-text"></span>
      <button type="button" class="link hidden" id="sb-finder-link"></button>
    </span>
  `;
  const q = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
  q('sb-change').addEventListener('click', () => editInput());
  q('sb-finder-link').addEventListener('click', () => onFinderLink(q('sb-finder-link').textContent ?? ''));

  let last = '';
  const update = () => {
    const s = getState();
    const st = statusOf(s, statsOf(s));
    const f = finderStatus(s);
    const key = JSON.stringify([st, f]);
    if (key === last) return;
    last = key;

    const tag = q('sb-tag');
    tag.classList.toggle('hidden', !st.tag);
    if (st.tag) {
      tag.className = `sb-tag tag-${st.tag.kind}`;
      tag.innerHTML = `${icon(TAG_ICON[st.tag.icon], 14)}<span>${escHtml(st.tag.text)}</span>`;
    }
    q('sb-say').textContent = st.say;

    const file = q('sb-file');
    file.classList.toggle('hidden', !st.file);
    if (st.file) {
      file.innerHTML = `${icon(P.fileText, 14)}<span class="sb-file-name">${escHtml(st.file)}</span>`;
      file.title = `Opened file: ${st.file}`;
    }

    q('sb-lock').classList.toggle('hidden', !st.lock);
    if (st.lock) {
      const btn = q('sb-change');
      btn.textContent = st.lock.link;
      btn.title = st.lock.link === 'Change text' ? 'Edit your text again (the placeholders are dropped)' : "Edit the AI's answer again (as text: the AI's file is let go)";
      q('sb-lock').title = 'This text is locked so that it matches what you give the AI.';
    }

    const finder = q('sb-finder');
    finder.dataset.kind = f.kind;
    finder.title = f.title;
    q('sb-finder-text').textContent = f.text;
    const link = q('sb-finder-link');
    link.classList.toggle('hidden', !f.link);
    link.textContent = f.link ?? '';
  };
  subscribe(update);
  update();
}

/** Typing into a locked text: point to "Change text" (short highlight, nothing moves). */
export function flashLock(): void {
  const el = document.getElementById('sb-lock');
  if (!el || el.classList.contains('hidden')) return;
  el.classList.remove('attention');
  void el.offsetWidth;
  el.classList.add('attention');
}
