import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdate, compareVersions, dismissUpdate, setUpdateCheckEnabled, shouldNotify } from './update-check';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

const release = (tag: string, url = `https://github.com/fly2nbc-oss/Alias/releases/tag/${tag}`) =>
  ({ ok: true, status: 200, json: async () => ({ tag_name: tag, html_url: url }) }) as Response;

describe('compareVersions', () => {
  it('compares numerically and handles pre-releases', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1);
    expect(compareVersions('v1.2.0', '1.2')).toBe(0);
    expect(compareVersions('1.1.0', '1.2.0')).toBe(-1);
    expect(compareVersions('2.0.0-rc1', '2.0.0')).toBe(-1);
    expect(compareVersions('2.0.0', '2.0.0-rc1')).toBe(1);
  });
});

describe('checkForUpdate', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is off until the user turns it on: no request without consent', async () => {
    fetchMock.mockResolvedValue(release('v1.3.0'));
    expect(await checkForUpdate('1.2.0')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    setUpdateCheckEnabled(true);
    expect((await checkForUpdate('1.2.0'))?.latest).toBe('1.3.0');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a newer release and asks GitHub at most once a week', async () => {
    setUpdateCheckEnabled(true);
    fetchMock.mockResolvedValue(release('v1.3.0'));
    const a = await checkForUpdate('1.2.0');
    expect(a).toEqual({ latest: '1.3.0', url: 'https://github.com/fly2nbc-oss/Alias/releases/tag/v1.3.0', newer: true });
    expect(shouldNotify(a)).toBe(true);
    const b = await checkForUpdate('1.2.0');
    expect(b?.latest).toBe('1.3.0');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await checkForUpdate('1.2.0', true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('respects "skip this version" and the off switch', async () => {
    setUpdateCheckEnabled(true);
    fetchMock.mockResolvedValue(release('v1.3.0'));
    dismissUpdate('1.3.0');
    expect(shouldNotify(await checkForUpdate('1.2.0'))).toBe(false);
    setUpdateCheckEnabled(false);
    vi.stubGlobal('localStorage', new MemoryStorage());
    setUpdateCheckEnabled(false);
    expect(await checkForUpdate('1.2.0')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is silent on errors, but a manual check reports them', async () => {
    setUpdateCheckEnabled(true);
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await checkForUpdate('1.2.0')).toBeNull();
    await expect(checkForUpdate('1.2.0', true)).rejects.toThrow('offline');
  });

  it('ignores foreign release URLs and odd tags', async () => {
    setUpdateCheckEnabled(true);
    fetchMock.mockResolvedValue(release('v9.9.9', 'https://evil.example/download'));
    expect((await checkForUpdate('1.0.0'))?.url).toBe('https://github.com/fly2nbc-oss/Alias/releases/latest');
    fetchMock.mockResolvedValue(release('<img src=x>'));
    await expect(checkForUpdate('1.0.0', true)).rejects.toThrow();
  });

  it('distrusts tampered values in localStorage (shared file:// origin)', async () => {
    localStorage.setItem(
      'alias.updateCheck.v1',
      JSON.stringify({ enabled: true, checkedAt: Date.now(), latest: '99.0.0', url: 'https://evil.example/installer.zip' }),
    );
    const info = await checkForUpdate('1.0.0');
    expect(info?.url).toBe('https://github.com/fly2nbc-oss/Alias/releases/latest');
    localStorage.setItem('alias.updateCheck.v1', JSON.stringify({ enabled: true, checkedAt: Date.now(), latest: '<b>x</b>' }));
    fetchMock.mockResolvedValue(release('v1.0.0'));
    expect((await checkForUpdate('1.0.0'))?.latest).toBe('1.0.0');
  });

  it('same or older release is not newer', async () => {
    setUpdateCheckEnabled(true);
    fetchMock.mockResolvedValue(release('v1.2.0'));
    expect(shouldNotify(await checkForUpdate('1.2.0'))).toBe(false);
  });
});
