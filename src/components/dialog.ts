/**
 * Shared helpers for modal dialogs: ARIA attributes, focus moves in on open,
 * focus trap (Tab stays in the dialog), Escape = cancel, focus returns on close.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface DialogOptions {
  /** ID of the title element (aria-labelledby) */
  labelledBy: string;
  /** ID of a describing element (aria-describedby), optional */
  describedBy?: string;
  /** Element that gets the focus on open (else the first focusable one) */
  initialFocus?: HTMLElement | null;
  /** Escape or click on the backdrop */
  onCancel: () => void;
  /** Extra key handling (e.g. Enter = confirm); `true` = handled */
  onKeydown?: (e: KeyboardEvent) => boolean | void;
  /** A click on the dimmed backdrop closes (default: yes) */
  closeOnBackdrop?: boolean;
}

export interface DialogHandle {
  /** Remove the listeners and return the focus (the caller removes the DOM) */
  release: () => void;
}

/** All visible, focusable elements in the dialog in DOM order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Makes `dialog` (the element with the white surface) a modal dialog.
 * `overlay` is the dimmed backdrop that contains the dialog.
 */
export function setupDialog(overlay: HTMLElement, dialog: HTMLElement, opts: DialogOptions): DialogHandle {
  const previous = document.activeElement as HTMLElement | null;

  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', opts.labelledBy);
  if (opts.describedBy) dialog.setAttribute('aria-describedby', opts.describedBy);
  if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;

  const onKey = (e: KeyboardEvent): void => {
    // Only the topmost dialog reacts (e.g. a confirm dialog over the Detect dialog)
    if (!isTopmost(overlay)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      opts.onCancel();
      return;
    }
    if (e.key === 'Tab') {
      const items = focusableIn(dialog);
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = active !== null && dialog.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (opts.onKeydown?.(e)) e.preventDefault();
  };

  // Focus that leaves the dialog (click outside, script): bring it back in
  const onFocusIn = (e: FocusEvent): void => {
    if (!isTopmost(overlay)) return;
    const t = e.target as Node | null;
    if (t && !dialog.contains(t)) (focusableIn(dialog)[0] ?? dialog).focus();
  };

  const onBackdrop = (e: MouseEvent): void => {
    if (e.target === overlay) opts.onCancel();
  };

  document.addEventListener('keydown', onKey, true);
  document.addEventListener('focusin', onFocusIn);
  if (opts.closeOnBackdrop !== false) overlay.addEventListener('click', onBackdrop);
  overlay.dataset.dialogOpen = String(Date.now());
  openStack.push(overlay);

  const target = opts.initialFocus ?? focusableIn(dialog)[0] ?? dialog;
  // Focus after it is attached to the DOM
  requestAnimationFrame(() => target.focus());

  let released = false;
  return {
    release(): void {
      if (released) return;
      released = true;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn);
      overlay.removeEventListener('click', onBackdrop);
      const i = openStack.lastIndexOf(overlay);
      if (i >= 0) openStack.splice(i, 1);
      if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
    },
  };
}

const openStack: HTMLElement[] = [];

function isTopmost(overlay: HTMLElement): boolean {
  return openStack[openStack.length - 1] === overlay;
}

export interface ModalParts {
  overlay: HTMLElement;
  dialog: HTMLElement;
  close: () => void;
}

/**
 * Standalone dialog: creates overlay + dialog, attaches it to `body` and sets everything up.
 * `html` is the inner structure (header/body/footer); the title needs the ID `titleId`.
 */
export function openModal(opts: {
  id: string;
  className?: string;
  titleId: string;
  describedBy?: string;
  html: string;
  initialFocus?: (dialog: HTMLElement) => HTMLElement | null;
  onKeydown?: (e: KeyboardEvent) => boolean | void;
  onClose?: () => void;
}): ModalParts {
  const overlay = document.createElement('div');
  overlay.id = opts.id;
  overlay.className = 'modal-overlay';
  const dialog = document.createElement('div');
  dialog.className = `modal ${opts.className ?? ''}`.trim();
  dialog.innerHTML = opts.html;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  let handle: DialogHandle | null = null;
  const close = (): void => {
    if (!overlay.isConnected) return;
    overlay.remove();
    handle?.release();
    opts.onClose?.();
  };
  handle = setupDialog(overlay, dialog, {
    labelledBy: opts.titleId,
    describedBy: opts.describedBy,
    initialFocus: opts.initialFocus?.(dialog) ?? null,
    onCancel: close,
    onKeydown: opts.onKeydown,
  });
  return { overlay, dialog, close };
}

export interface ConfirmAction {
  /** Return value when this button is chosen */
  value: string;
  label: string;
  kind?: 'primary' | 'danger' | 'default';
  /** true = the dialog stays open and `run` is called (e.g. "Export first") */
  keepOpen?: boolean;
  run?: () => void | Promise<void>;
}

/**
 * Small confirm dialog instead of `confirm()`. Resolves with the `value` of the chosen
 * button or with `null` (Cancel/Escape). Focus starts on "Cancel",
 * so Enter does nothing destructive.
 */
export function confirmDialog(opts: {
  title: string;
  message: string;
  actions: ConfirmAction[];
  cancelLabel?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const buttons = opts.actions
      .map(
        (a, i) =>
          `<button type="button" data-i="${i}" class="${a.kind && a.kind !== 'default' ? a.kind : ''}">${escHtml(a.label)}</button>`,
      )
      .join('');
    const { dialog, close } = openModal({
      id: `confirm-overlay-${Date.now()}`,
      className: 'modal-compact confirm-modal',
      titleId: 'confirm-title',
      describedBy: 'confirm-message',
      html: `
        <div class="modal-header">
          <h2 class="modal-title" id="confirm-title">${escHtml(opts.title)}</h2>
        </div>
        <div class="modal-body confirm-body">
          <p id="confirm-message">${escHtml(opts.message)}</p>
          <p class="confirm-status" role="status"></p>
        </div>
        <div class="modal-footer">
          <button type="button" data-cancel>${escHtml(opts.cancelLabel ?? 'Cancel')}</button>
          ${buttons}
        </div>`,
      initialFocus: (d) => d.querySelector<HTMLElement>('[data-cancel]'),
      onClose: () => resolve(result),
    });
    dialog.querySelector('[data-cancel]')!.addEventListener('click', close);
    dialog.querySelectorAll<HTMLButtonElement>('button[data-i]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const a = opts.actions[Number(btn.dataset.i)];
        if (a.keepOpen) {
          btn.disabled = true;
          try {
            await a.run?.();
          } finally {
            btn.disabled = false;
          }
          return;
        }
        result = a.value;
        close();
      });
    });
  });
}

export function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
