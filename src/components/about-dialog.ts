// 224 px (2× display size), embedded as a data: URI at build time
import aboutIconUrl from '../assets/app-icon-224.png?url';
// License notices are built into alias.html (repo standard §6.3: a single file carries its notices)
import noticeText from '../../NOTICE?raw';
import thirdPartyText from '../../THIRD_PARTY.md?raw';

import { iconX } from '../icons';
import { escHtml, openModal } from './dialog';

const REPO_URL = 'https://github.com/fly2nbc-oss/Alias';
const LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0';

/** The MIT license block at the end of THIRD_PARTY.md (inside its ```text fence). */
export function mitLicenseText(md: string): string {
  const start = md.indexOf('### MIT License');
  if (start < 0) return '';
  const fence = md.indexOf('```text', start);
  const end = fence < 0 ? -1 : md.indexOf('```', fence + 7);
  return fence < 0 || end < 0 ? '' : md.slice(fence + 7, end).trim();
}

/** Version, license, source, privacy, and the license notices of the built-in libraries. */
export function showAboutDialog(): void {
  if (document.getElementById('about-overlay')) return;

  const version = import.meta.env.VITE_APP_VERSION;
  const licenses = `${noticeText.trim()}\n\n\nMIT License (@huggingface/jinja, ONNX Runtime Web, fflate)\n\n${mitLicenseText(thirdPartyText)}`;

  const { dialog, close } = openModal({
    id: 'about-overlay',
    className: 'about-modal',
    titleId: 'about-title',
    describedBy: 'about-tagline',
    html: `
      <div class="modal-header">
        <h2 class="modal-title" id="about-title">About Alias</h2>
        <button type="button" class="modal-close" id="about-close" aria-label="Close" title="Close (Esc)">${iconX}</button>
      </div>
      <div class="modal-body about-body">
        <div class="about-head">
          <img class="about-logo" id="about-app-icon" src="" width="64" height="64" alt="" />
          <div>
            <p class="about-product-name">Alias <span id="about-version-text" class="about-version"></span></p>
            <p class="about-tagline" id="about-tagline">
              Hides names in your texts before you ask an AI, and brings them back in the AI's answer.
            </p>
          </div>
        </div>
        <div class="about-privacy">
          <strong>Your text stays on this computer.</strong>
          Texts, files and the list of names never leave the browser. Alias uses the internet only for what
          you turned on: the one-time download of the smart name finder from Hugging Face, and the weekly
          update check on GitHub.
        </div>
        <dl class="about-meta">
          <dt>License</dt>
          <dd><a href="${LICENSE_URL}" target="_blank" rel="noopener">Apache-2.0</a></dd>
          <dt>Source</dt>
          <dd><a href="${REPO_URL}" target="_blank" rel="noopener">${REPO_URL.replace('https://', '')}</a></dd>
        </dl>
        <details class="about-licenses">
          <summary>Licenses of the built-in libraries</summary>
          <pre tabindex="0">${escHtml(licenses)}</pre>
        </details>
      </div>
      <div class="modal-footer">
        <button type="button" class="primary" id="about-ok">OK</button>
      </div>`,
    initialFocus: (d) => d.querySelector<HTMLElement>('#about-ok'),
  });

  (dialog.querySelector('#about-app-icon') as HTMLImageElement).src = aboutIconUrl;
  dialog.querySelector('#about-version-text')!.textContent = version;
  dialog.querySelector('#about-close')!.addEventListener('click', close);
  dialog.querySelector('#about-ok')!.addEventListener('click', close);
}
