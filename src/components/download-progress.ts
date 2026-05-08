import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import * as api from '../api';
import { setState } from '../store';
import { refreshNerStatus } from './toolbar';
import { showToast } from './notification';

interface DownloadProgress {
  phase: string;
  downloaded: number;
  total: number;
  percent: number;
}

interface DownloadError {
  message: string;
}

export function initDownloadProgress(): void {
  const container = createBanner();
  document.body.appendChild(container);
  hide(container);

  listen<DownloadProgress>('ner-download-progress', (e) => {
    const { phase, percent, downloaded, total } = e.payload;
    show(container);
    const mb = (n: number) => (n / 1_000_000).toFixed(0);
    const pct = Math.min(100, Math.max(0, Math.round(Number(percent))));
    setText(
      container,
      `Downloading ${phase}: ${pct}% (${mb(downloaded)} / ${mb(total)} MB)`,
    );
    setProgress(container, pct);
    clearError(container);
  });

  listen('ner-download-complete', async () => {
    setText(container, 'NER model ready — refreshing…');
    setProgress(container, 100);
    clearError(container);
    try {
      await refreshNerStatus();
      const entries = await api.getStore();
      setState({ aliasEntries: entries });
      showToast('NER model installed and ready.', 'success');
    } catch (e) {
      console.error('Re-init after model download:', e);
      await refreshNerStatus();
    }
    setTimeout(() => hide(container), 3200);
  });

  listen<DownloadError>('ner-download-error', (e) => {
    show(container);
    setText(container, `Download failed: ${e.payload.message}`);
    setProgress(container, 0);
    showRetry(container);
  });
}

function createBanner(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'ner-download-banner';
  el.innerHTML = `
    <span id="ner-dl-text"></span>
    <div class="ner-dl-bar-wrap">
      <div class="ner-dl-bar" id="ner-dl-bar"></div>
    </div>
    <button id="ner-dl-retry" class="ner-dl-retry hidden" title="Retry">Retry</button>
    <button id="ner-dl-close" class="ner-dl-close" title="Close">✕</button>
  `;
  el.querySelector('#ner-dl-close')!.addEventListener('click', () => hide(el));
  el.querySelector('#ner-dl-retry')!.addEventListener('click', async () => {
    clearError(el);
    setText(el, 'Starting download…');
    el.querySelector('#ner-dl-retry')!.classList.add('hidden');
    await invoke('download_ner_model');
  });
  return el;
}

function show(el: HTMLElement): void { el.classList.remove('hidden'); }
function hide(el: HTMLElement): void { el.classList.add('hidden'); }
function setText(el: HTMLElement, t: string): void {
  el.querySelector('#ner-dl-text')!.textContent = t;
}
function setProgress(el: HTMLElement, pct: number): void {
  (el.querySelector('#ner-dl-bar') as HTMLElement).style.width = `${pct}%`;
}
function clearError(el: HTMLElement): void {
  el.querySelector('#ner-dl-retry')!.classList.add('hidden');
  el.classList.remove('ner-dl-error');
}
function showRetry(el: HTMLElement): void {
  el.querySelector('#ner-dl-retry')!.classList.remove('hidden');
  el.classList.add('ner-dl-error');
}
