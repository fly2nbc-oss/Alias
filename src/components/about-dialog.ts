import { openUrl } from '@tauri-apps/plugin-opener';
import aboutIconUrl from '../../src-tauri/app-icon-source.png?url';

const REPO_URL = 'https://github.com/fly2nbc-oss/Alias';

export function showAboutDialog(): void {
  if (document.getElementById('about-overlay')) return;

  const version = import.meta.env.VITE_APP_VERSION;

  const overlay = document.createElement('div');
  overlay.id = 'about-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title">
      <div class="modal-header about-modal-header">
        <span id="about-title">About</span>
        <button type="button" class="modal-close" id="about-close" title="Close">✕</button>
      </div>
      <div class="modal-body about-modal-body">
        <div class="about-modal-inner">
          <div class="about-modal-brand">
            <img
              class="about-logo"
              id="about-app-icon"
              src=""
              width="112"
              height="112"
              alt=""
            />
          </div>
          <h2 class="about-product-name">Alias</h2>
          <p class="about-subtitle">Anonymization Tool</p>
          <p class="about-tagline">
            Pseudonymize text and spreadsheets with local NER, a persistent alias mapping table, and encode/decode workflows.
          </p>
          <div class="about-meta">
            <p class="about-version-row">
              <span class="about-version-label">Version</span>
              <span id="about-version-text" class="about-version-value"></span>
            </p>
            <p class="about-license">
              Licensed under <a href="#" id="about-license-link">Apache-2.0</a>
            </p>
            <p class="about-source">
              <a href="#" id="about-repo-link">${REPO_URL}</a>
            </p>
          </div>
        </div>
      </div>
      <div class="modal-footer about-modal-footer">
        <button type="button" class="primary" id="about-ok">OK</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  const iconEl = overlay.querySelector('#about-app-icon') as HTMLImageElement;
  iconEl.src = aboutIconUrl;
  iconEl.alt = 'Alias';

  const verEl = overlay.querySelector('#about-version-text')!;
  verEl.textContent = version;

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };

  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };

  overlay.querySelector('#about-close')!.addEventListener('click', close);
  overlay.querySelector('#about-ok')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  overlay.querySelector('#about-repo-link')!.addEventListener('click', (e) => {
    e.preventDefault();
    void openUrl(REPO_URL);
  });

  overlay.querySelector('#about-license-link')!.addEventListener('click', (e) => {
    e.preventDefault();
    void openUrl('https://www.apache.org/licenses/LICENSE-2.0');
  });

  document.addEventListener('keydown', onKey);
}
