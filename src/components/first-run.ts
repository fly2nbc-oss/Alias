/**
 * First start: a card in the start view (no dialog, R12) with the two features that use the
 * network. Both are unticked; nothing is downloaded or checked until the user ticks one and
 * clicks Start. The answer is stored; later both can be changed in Settings.
 */
import { saveConsent, type Choices } from '../core/consent';
import { modelCacheSize } from '../core/ner/model-cache';
import { iconBot, iconRefresh } from '../icons';
import { setState } from '../store';

export function showFirstRunCard(host: HTMLElement, onStart: (c: Choices) => void): void {
  setState({ firstRun: true });
  const el = document.createElement('div');
  el.id = 'first-run';
  el.className = 'first-run';
  el.innerHTML = `
    <section class="card first-run-card" role="group" aria-labelledby="fr-title" aria-describedby="fr-text">
      <h2 id="fr-title">Two choices before you start</h2>
      <p id="fr-text">Alias works without the internet. These two use it – both stay off unless you tick them. You can change them later in Settings.</p>
      <label class="fr-option">
        <input type="checkbox" id="fr-finder">
        ${iconBot}
        <span><b>Smart name finder</b><span id="fr-finder-text">Finds more names with a small AI. Downloads 180 MB once from Hugging Face. Your text never leaves this computer.</span></span>
      </label>
      <label class="fr-option">
        <input type="checkbox" id="fr-updates">
        ${iconRefresh}
        <span><b>Check for updates</b><span>Looks on GitHub once a week for a new version of Alias.</span></span>
      </label>
      <div class="fr-foot">
        <span class="fr-note">Without the smart finder, Alias finds names with simple rules.</span>
        <button type="button" class="primary" id="fr-start">Start</button>
      </div>
    </section>`;
  host.appendChild(el);

  // Model from an earlier version already in the browser: say that ticking downloads nothing
  void modelCacheSize().then((n) => {
    if (n && n > 1_000_000) {
      el.querySelector('#fr-finder-text')!.textContent =
        'Finds more names with a small AI. It is already on this computer, so nothing is downloaded. Your text never leaves this computer.';
    }
  });

  const start = el.querySelector<HTMLButtonElement>('#fr-start')!;
  start.addEventListener('click', () => {
    const c: Choices = {
      finder: el.querySelector<HTMLInputElement>('#fr-finder')!.checked,
      updates: el.querySelector<HTMLInputElement>('#fr-updates')!.checked,
    };
    saveConsent(c);
    el.remove();
    setState({ firstRun: false });
    onStart(c);
    document.getElementById('text-editor')?.focus();
  });
  requestAnimationFrame(() => start.focus());
}
