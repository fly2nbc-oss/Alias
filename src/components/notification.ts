export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
  label: string;
  onClick: () => void;
  /** Ghost button in accent colour (the main choice of the hint) */
  primary?: boolean;
}

export interface ToastOptions {
  /** Buttons in the hint (e.g. "Retry"); a click closes the hint */
  actions?: ToastAction[];
  /** Stays until closed (like errors) */
  sticky?: boolean;
  /** Element ID (one hint of this kind at a time) */
  id?: string;
}

/**
 * Display time after the design system (§6): 5 s, plus 60 ms per character for long texts,
 * at most 10 s. Errors and warnings stay until they are closed (R6).
 */
export function hintDuration(message: string): number {
  return Math.min(10_000, 5000 + Math.max(0, message.length - 40) * 60);
}

function container(): HTMLElement {
  const el = document.getElementById('toast-container')!;
  // The live region must exist before the first hint, otherwise it is not read out
  if (!el.hasAttribute('aria-live')) {
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-relevant', 'additions');
  }
  return el;
}

/** Create the live region at start (see container()). */
export function initToasts(): void {
  container();
}

function dismiss(toast: HTMLElement): void {
  if (toast.dataset.closing) return;
  toast.dataset.closing = '1';
  toast.classList.add('closing');
  setTimeout(() => toast.remove(), 400);
}

const ICON: Record<ToastType, string> = {
  success: '<path d="M20 6 9 17l-5-5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  error: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
};

/**
 * Hint at the top centre over the content (design system §8). Success and info fade out;
 * errors (`role="alert"`) and warnings stay until closed. The same message is not shown twice.
 */
export function showToast(message: string, type: ToastType = 'info', durationMs?: number, options: ToastOptions = {}): HTMLElement {
  const root = container();
  const sticky = options.sticky === true || type === 'error' || type === 'warning';
  const ms = durationMs ?? hintDuration(message);

  // Same message: keep it and restart the time
  const key = `${type}|${message}`;
  const existing = Array.from(root.querySelectorAll<HTMLElement>('.toast')).find((t) => t.dataset.key === key && !t.dataset.closing);
  if (existing) {
    restartTimer(existing, sticky, ms);
    return existing;
  }
  if (options.id) document.getElementById(options.id)?.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  if (options.id) toast.id = options.id;
  toast.dataset.key = key;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon toast-icon" aria-hidden="true">${ICON[type]}</svg>`;

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  toast.appendChild(text);

  if (options.actions?.length) {
    const actions = document.createElement('span');
    actions.className = 'toast-actions';
    for (const a of options.actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = a.primary ? 'ghost toast-action' : 'toast-action';
      b.textContent = a.label;
      b.addEventListener('click', () => {
        dismiss(toast);
        a.onClick();
      });
      actions.appendChild(b);
    }
    toast.appendChild(actions);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Close');
  close.title = 'Close';
  close.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  close.addEventListener('click', () => dismiss(toast));
  toast.appendChild(close);

  // A click on the hint closes it (R6); hovering keeps it
  toast.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('button')) dismiss(toast);
  });
  toast.addEventListener('mouseenter', () => clearTimer(toast));
  toast.addEventListener('mouseleave', () => restartTimer(toast, sticky, ms));

  root.appendChild(toast);
  restartTimer(toast, sticky, ms);
  return toast;
}

const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function clearTimer(toast: HTMLElement): void {
  const t = timers.get(toast);
  if (t) clearTimeout(t);
  timers.delete(toast);
}

function restartTimer(toast: HTMLElement, sticky: boolean, ms: number): void {
  clearTimer(toast);
  if (!sticky) timers.set(toast, setTimeout(() => dismiss(toast), ms));
}

/** Esc closes the newest hint that stays (errors), one per press (R7). */
export function closeNewestStickyHint(): boolean {
  const all = Array.from(document.querySelectorAll<HTMLElement>('#toast-container .toast:not(.closing)'));
  const last = all[all.length - 1];
  if (!last) return false;
  dismiss(last);
  return true;
}
