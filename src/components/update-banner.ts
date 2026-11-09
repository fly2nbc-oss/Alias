import { checkForUpdate, dismissUpdate, shouldNotify, type UpdateInfo } from '../core/update-check';
import { showToast } from './notification';

/**
 * Release check (only when the user turned it on): asks GitHub at most once a week and shows a
 * hint at the top when a newer version exists.
 */
export function initUpdateCheck(delayMs = 4000): void {
  // Do not slow down the start: check shortly after loading
  setTimeout(async () => {
    const info = await checkForUpdate(import.meta.env.VITE_APP_VERSION);
    if (shouldNotify(info)) showUpdateBanner(info);
  }, delayMs);
}

export function showUpdateBanner(info: UpdateInfo): void {
  showToast(`Alias ${info.latest} is available (you have ${import.meta.env.VITE_APP_VERSION}).`, 'info', undefined, {
    sticky: true,
    id: 'update-banner',
    actions: [
      // Installed with install.cmd? Then install.cmd of the new version updates it.
      { label: 'Download', onClick: () => window.open(info.url, '_blank', 'noopener,noreferrer'), primary: true },
      { label: 'Skip this version', onClick: () => dismissUpdate(info.latest) },
    ],
  });
}
