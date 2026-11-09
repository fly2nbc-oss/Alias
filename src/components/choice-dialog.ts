/** Small modal question dialog (<dialog>, instead of window.confirm). */

export interface Choice<T extends string> {
  value: T;
  label: string;
  /** Highlighted default action */
  primary?: boolean;
}

/**
 * Shows title, text and buttons; returns the chosen value or `null` (Esc/Cancel).
 * The focus is on the primary button.
 */
export function askChoice<T extends string>(
  title: string,
  message: string,
  choices: Choice<T>[],
): Promise<T | null> {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'choice-dialog';
    dlg.setAttribute('aria-labelledby', 'choice-dialog-title');
    dlg.setAttribute('aria-describedby', 'choice-dialog-text');

    const h = document.createElement('h2');
    h.id = 'choice-dialog-title';
    h.textContent = title;
    const p = document.createElement('p');
    p.id = 'choice-dialog-text';
    p.textContent = message;
    const footer = document.createElement('div');
    footer.className = 'choice-dialog-actions';

    let result: T | null = null;
    let focusBtn: HTMLButtonElement | null = null;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.dataset.choice = 'cancel';
    cancel.addEventListener('click', () => dlg.close());
    footer.appendChild(cancel);
    for (const c of choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = c.label;
      b.dataset.choice = c.value;
      if (c.primary) {
        b.classList.add('primary');
        focusBtn = b;
      }
      b.addEventListener('click', () => {
        result = c.value;
        dlg.close();
      });
      footer.appendChild(b);
    }

    dlg.append(h, p, footer);
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    (focusBtn ?? cancel).focus();
  });
}
