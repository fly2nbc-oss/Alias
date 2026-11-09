/** Network only after consent: smart name finder and update check are off by default. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consentAsked, currentChoices, saveConsent, startNetworkFeatures } from './consent';
import { nerEnabled } from './ner/model-cache';
import { checkForUpdate, updateCheckEnabled } from './update-check';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

describe('consent', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a fresh browser: nothing asked, both off, nothing started, no request', async () => {
    expect(consentAsked()).toBe(false);
    expect(nerEnabled()).toBe(false);
    expect(updateCheckEnabled()).toBe(false);
    const run = { loadFinder: vi.fn(), checkUpdates: vi.fn() };
    expect(startNetworkFeatures(run)).toEqual({ finder: false, updates: false });
    expect(run.loadFinder).not.toHaveBeenCalled();
    expect(run.checkUpdates).not.toHaveBeenCalled();
    expect(await checkForUpdate('1.0.0')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('old settings without an answer to the card start nothing', () => {
    // e.g. an earlier version wrote these values
    localStorage.setItem('alias.nerEnabled.v1', 'true');
    localStorage.setItem('alias.updateCheck.v1', JSON.stringify({ enabled: true, checkedAt: 0 }));
    const run = { loadFinder: vi.fn(), checkUpdates: vi.fn() };
    startNetworkFeatures(run);
    expect(run.loadFinder).not.toHaveBeenCalled();
    expect(run.checkUpdates).not.toHaveBeenCalled();
  });

  it('Start with both boxes empty: stored, still nothing started', () => {
    saveConsent({ finder: false, updates: false });
    expect(consentAsked()).toBe(true);
    const run = { loadFinder: vi.fn(), checkUpdates: vi.fn() };
    expect(startNetworkFeatures(run)).toEqual({ finder: false, updates: false });
    expect(run.loadFinder).not.toHaveBeenCalled();
  });

  it('starts exactly what was ticked', () => {
    saveConsent({ finder: true, updates: false });
    expect(currentChoices()).toEqual({ finder: true, updates: false });
    const run = { loadFinder: vi.fn(), checkUpdates: vi.fn() };
    expect(startNetworkFeatures(run)).toEqual({ finder: true, updates: false });
    expect(run.loadFinder).toHaveBeenCalledTimes(1);
    expect(run.checkUpdates).not.toHaveBeenCalled();
  });

  it('ignores a tampered consent value', () => {
    localStorage.setItem('alias.consent.v1', JSON.stringify({ asked: 'yes' }));
    expect(consentAsked()).toBe(false);
    localStorage.setItem('alias.consent.v1', '{bad');
    expect(consentAsked()).toBe(false);
  });
});
