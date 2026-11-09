import * as api from '../api';
import { checkForUpdate, setUpdateCheckEnabled, updateCheckEnabled } from '../core/update-check';
import { deleteModelCache, formatBytes, modelCacheSize, nerEnabled, setNerEnabled } from '../core/ner/model-cache';
import { iconX } from '../icons';
import { setState } from '../store';
import { applyTheme, getStoredTheme, type ThemeMode } from '../utils/theme';
import { confirmDialog, openModal } from './dialog';
import { syncFinder } from './download-progress';
import { showToast } from './notification';
import { initUpdateCheck, showUpdateBanner } from './update-banner';

/** Settings: appearance, smart name finder, update check. `focus` opens with that section focused. */
export function showSettingsDialog(focus?: 'finder'): void {
  if (document.getElementById('settings-overlay')) return;

  const theme = getStoredTheme();
  const themeOption = (value: ThemeMode, label: string): string => `
    <label class="seg-option">
      <input type="radio" name="settings-theme" value="${value}" ${theme === value ? 'checked' : ''}>
      <span>${label}</span>
    </label>`;

  const { dialog, close } = openModal({
    id: 'settings-overlay',
    className: 'settings-modal',
    titleId: 'settings-title',
    html: `
      <div class="modal-header">
        <h2 class="modal-title" id="settings-title">Settings</h2>
        <button type="button" class="modal-close" id="settings-close" aria-label="Close" title="Close (Esc)">${iconX}</button>
      </div>
      <div class="modal-body settings-body">
        <section class="settings-section" aria-labelledby="settings-theme-title">
          <h3 class="overline" id="settings-theme-title">Appearance</h3>
          <div class="seg" role="radiogroup" aria-labelledby="settings-theme-title">
            ${themeOption('system', 'System')}
            ${themeOption('light', 'Light')}
            ${themeOption('dark', 'Dark')}
          </div>
          <p class="settings-hint">“System” follows the light or dark setting of your computer.</p>
        </section>
        <section class="settings-section" aria-labelledby="settings-ner-title">
          <h3 class="overline" id="settings-ner-title">Smart name finder</h3>
          <label class="settings-check">
            <input type="checkbox" id="settings-ner-enabled">
            <span>Use the smart name finder. It finds more names with a small AI that runs on this computer.
            It downloads about 180 MB once from Hugging Face; your text never leaves this computer.
            When it is off, Alias finds names with simple rules.</span>
          </label>
          <div class="settings-row">
            <button type="button" id="settings-ner-delete">Delete download</button>
            <span id="settings-ner-size" class="settings-hint" role="status">Checking…</span>
          </div>
        </section>
        <section class="settings-section" aria-labelledby="settings-updates-title">
          <h3 class="overline" id="settings-updates-title">Updates</h3>
          <label class="settings-check">
            <input type="checkbox" id="settings-update-auto">
            <span>Check for updates: look on GitHub once a week for a new version of Alias.</span>
          </label>
          <div class="settings-row">
            <button type="button" id="settings-update-now">Check now</button>
            <span id="settings-update-result" class="settings-hint" role="status"></span>
          </div>
        </section>
      </div>
      <div class="modal-footer">
        <button type="button" class="primary" id="settings-ok">Done</button>
      </div>`,
    initialFocus: (d) =>
      focus === 'finder'
        ? d.querySelector<HTMLElement>('#settings-ner-enabled')
        : d.querySelector<HTMLElement>('input[name="settings-theme"]:checked'),
  });

  dialog.querySelector('#settings-close')!.addEventListener('click', close);
  dialog.querySelector('#settings-ok')!.addEventListener('click', close);

  dialog.querySelectorAll<HTMLInputElement>('input[name="settings-theme"]').forEach((r) => {
    r.addEventListener('change', () => {
      if (r.checked) applyTheme(r.value as ThemeMode);
    });
  });

  bindUpdateSection(dialog);
  bindNerSection(dialog);
}

function bindUpdateSection(root: HTMLElement): void {
  const auto = root.querySelector('#settings-update-auto') as HTMLInputElement;
  const btn = root.querySelector('#settings-update-now') as HTMLButtonElement;
  const result = root.querySelector('#settings-update-result') as HTMLElement;
  auto.checked = updateCheckEnabled();
  auto.addEventListener('change', () => {
    setUpdateCheckEnabled(auto.checked);
    // Turned on: check now (at most once a week); the click is the consent
    if (auto.checked) initUpdateCheck(0);
  });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    result.textContent = 'Checking…';
    try {
      const info = await checkForUpdate(import.meta.env.VITE_APP_VERSION, true);
      if (info?.newer) {
        result.textContent = `Version ${info.latest} is available.`;
        showUpdateBanner(info);
      } else {
        result.textContent = 'You have the latest version.';
      }
    } catch (e) {
      result.textContent = `Could not check: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      btn.disabled = false;
    }
  });
}

function bindNerSection(root: HTMLElement): void {
  const enabled = root.querySelector('#settings-ner-enabled') as HTMLInputElement;
  const del = root.querySelector('#settings-ner-delete') as HTMLButtonElement;
  const size = root.querySelector('#settings-ner-size') as HTMLElement;
  enabled.checked = nerEnabled();

  const refresh = async () => {
    const n = await modelCacheSize();
    size.textContent = n === null ? 'Size unknown' : n === 0 ? 'Not downloaded' : `On this computer: ${formatBytes(n)}`;
    del.disabled = n === 0;
  };
  void refresh();

  enabled.addEventListener('change', () => {
    setNerEnabled(enabled.checked);
    if (enabled.checked) {
      // The click is the consent: load now (one-time download if it is not in the browser yet)
      setState({ finder: 'loading', finderError: null });
      void api.enableNer().finally(() => {
        void syncFinder();
        void refresh();
      });
    } else {
      setState({ finder: 'off', finderDownload: null });
    }
  });

  del.addEventListener('click', async () => {
    const choice = await confirmDialog({
      title: 'Delete the smart name finder?',
      message: 'The download (about 180 MB) is removed from this browser and the smart name finder is turned off. Your names and placeholders stay.',
      actions: [{ value: 'delete', label: 'Delete', kind: 'danger' }],
    });
    if (choice !== 'delete') return;
    del.disabled = true;
    const ok = await deleteModelCache();
    setNerEnabled(false);
    enabled.checked = false;
    setState({ finder: 'off', finderDownload: null });
    await refresh();
    showToast(ok ? 'Smart name finder deleted.' : 'Nothing to delete.', ok ? 'success' : 'info');
  });
}
