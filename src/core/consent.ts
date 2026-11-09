/**
 * Consent for the two features that use the network: the smart name finder (one-time model
 * download from Hugging Face) and the weekly update check (GitHub). Both are off until the user
 * ticks them on the first-run card or in Settings. Without consent Alias sends no request.
 */
import { nerEnabled, setNerEnabled } from './ner/model-cache';
import { setUpdateCheckEnabled, updateCheckEnabled } from './update-check';

const KEY = 'alias.consent.v1';

export interface Choices {
  finder: boolean;
  updates: boolean;
}

/** Has the user answered the first-run card? (Values from storage are checked like input.) */
export function consentAsked(): boolean {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    return !!v && typeof v === 'object' && (v as { asked?: unknown }).asked === true;
  } catch {
    return false;
  }
}

/** Store the answer of the first-run card and switch both features accordingly. */
export function saveConsent(c: Choices): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ asked: true }));
  } catch {
    /* storage not available: the card shows again next time */
  }
  setNerEnabled(c.finder);
  setUpdateCheckEnabled(c.updates);
}

/** Current choices (both false until the user turns them on). */
export function currentChoices(): Choices {
  return { finder: nerEnabled(), updates: updateCheckEnabled() };
}

export interface NetworkStarters {
  loadFinder: () => void;
  checkUpdates: () => void;
}

/**
 * Starts what the user agreed to – and nothing else. Called after the first-run card and on
 * every later start. Returns what was started (for tests).
 */
export function startNetworkFeatures(run: NetworkStarters): Choices {
  const started: Choices = { finder: false, updates: false };
  if (!consentAsked()) return started;
  const c = currentChoices();
  if (c.finder) {
    run.loadFinder();
    started.finder = true;
  }
  if (c.updates) {
    run.checkUpdates();
    started.updates = true;
  }
  return started;
}
