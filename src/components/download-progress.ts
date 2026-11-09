import { nerStatus, takeRulesOnlyFlag } from '../api';
import { onNer } from '../core/ner/client';
import { nerEnabled } from '../core/ner/model-cache';
import { setState } from '../store';
import { showToast } from './notification';

/**
 * Follows the smart name finder: its state goes to the store (status bar), and a progress pill
 * (design system §8) shows the one-time download. Loading from the browser cache shows no pill.
 */
export function initFinderProgress(onRetry: () => void): void {
  const pill = createPill();
  document.body.appendChild(pill);

  // Progress per file; total over all known files
  const files = new Map<string, { loaded: number; total: number }>();
  let downloading = false;

  onNer({
    progress: ({ file, loaded, total, fromNetwork }) => {
      if (!fromNetwork) return;
      files.set(file, { loaded, total });
      let l = 0;
      let t = 0;
      files.forEach((f) => {
        l += f.loaded;
        t += f.total;
      });
      // Small files (tokenizer, configuration) are not a download worth showing
      if (!downloading && t < 2_000_000) return;
      downloading = true;
      const mb = (n: number) => Math.round(n / 1_000_000);
      const pct = t > 0 ? Math.min(100, Math.round((l / t) * 100)) : 0;
      pill.querySelector('.pill-text')!.textContent = `Downloading the smart name finder · ${mb(l)} of ${mb(t)} MB`;
      (pill.querySelector('.pill-bar') as HTMLElement).style.width = `${pct}%`;
      pill.classList.remove('hidden');
      setState({ finderDownload: { loaded: l, total: t } });
    },
    state: (s, error) => {
      if (s === 'loading') {
        setState({ finder: 'loading', finderError: null });
        return;
      }
      downloading = false;
      files.clear();
      pill.classList.add('hidden');
      if (s === 'ready') {
        setState({ finder: nerEnabled() ? 'ready' : 'off', finderDownload: null });
        // Found names with the rules only while the finder was loading → say that it is ready now
        if (takeRulesOnlyFlag()) showToast('The smart name finder is ready – click Find names again for better results.', 'info', 8000);
      } else if (s === 'error') {
        setState({ finder: 'error', finderError: error ?? null, finderDownload: null });
        showToast('The smart name finder could not be downloaded. Find names uses simple rules.', 'error', undefined, {
          actions: [{ label: 'Retry', onClick: onRetry }],
        });
      } else {
        setState({ finder: 'off', finderDownload: null });
      }
    },
  });
}

function createPill(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'finder-progress';
  el.className = 'progress-pill hidden';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="pill-text"></span><span class="pill-track" aria-hidden="true"><span class="pill-bar"></span></span>`;
  return el;
}

/** Copy the finder state into the store (after turning it on again while it is still in memory). */
export async function syncFinder(): Promise<void> {
  const s = await nerStatus();
  const finder = s.state === 'ready' ? 'ready' : s.state === 'error' ? 'error' : s.state === 'loading' ? 'loading' : 'off';
  setState({ finder, finderError: s.error ?? null, ...(finder === 'loading' ? {} : { finderDownload: null }) });
}
