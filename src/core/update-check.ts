/**
 * Check for a newer Alias version via the GitHub API (latest published release,
 * no drafts or pre-releases).
 *
 * - Automatically at most once a week per browser: without login GitHub allows 60 requests
 *   per hour and IP; behind a company NAT many users share one IP.
 * - Off until the user turns it on (first-run card or Settings); errors (offline, proxy, limit) stay silent.
 * - Only the release information is fetched; no data from the app is sent.
 */

export const RELEASES_API = 'https://api.github.com/repos/fly2nbc-oss/Alias/releases/latest';
export const RELEASES_PAGE = 'https://github.com/fly2nbc-oss/Alias/releases/latest';

const KEY = 'alias.updateCheck.v1';
/** allowed version string (without "v"), e.g. 1.2.3 or 2.0.0-rc1 */
const VERSION_RE = /^\d+(\.\d+){0,3}(-[0-9A-Za-z.]+)?$/;
/** Interval between automatic checks */
const INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  /** latest published version (without "v") */
  latest: string;
  /** release page */
  url: string;
  /** newer than the running version? */
  newer: boolean;
}

interface Saved {
  enabled: boolean;
  checkedAt: number;
  latest?: string;
  url?: string;
  /** Version whose notice was dismissed */
  dismissed?: string;
}

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    if (s && typeof s === 'object') {
      // Check stored values as strictly as the GitHub answer: under file:// all local HTML files
      // share localStorage, so another page could otherwise plant a fake update notice with
      // its own download link.
      const latest = typeof s.latest === 'string' && VERSION_RE.test(s.latest) ? s.latest : undefined;
      return {
        enabled: s.enabled === true,
        checkedAt: typeof s.checkedAt === 'number' && s.checkedAt <= Date.now() ? s.checkedAt : 0,
        latest,
        url: latest ? safeReleaseUrl(s.url) : undefined,
        dismissed: typeof s.dismissed === 'string' ? s.dismissed : undefined,
      };
    }
  } catch {
    /* storage not available */
  }
  return { enabled: false, checkedAt: 0 };
}

function save(s: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage not available */
  }
}

/** Compares "1.2.10" with "1.2.9"; pre-releases (`-rc1`) count as older than the final version. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.trim().replace(/^v/i, '').split('-', 2);
    return { nums: core.split('.').map((n) => parseInt(n, 10) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

export function updateCheckEnabled(): boolean {
  return load().enabled;
}

export function setUpdateCheckEnabled(enabled: boolean): void {
  save({ ...load(), enabled });
}

export function dismissUpdate(version: string): void {
  save({ ...load(), dismissed: version });
}

/** Accept the release URL only if it belongs to our own repository. */
function safeReleaseUrl(u: unknown): string {
  return typeof u === 'string' && u.startsWith('https://github.com/fly2nbc-oss/Alias/releases/') ? u : RELEASES_PAGE;
}

/**
 * Checks for updates.
 * @param force manual check: ignores the interval and the off switch, throws on errors
 * @returns `null` if no (automatic) check was made or an error occurred
 */
export async function checkForUpdate(current: string, force = false): Promise<UpdateInfo | null> {
  const s = load();
  const fresh = Date.now() - s.checkedAt < INTERVAL_MS;
  if (!force && (!s.enabled || (fresh && s.latest))) {
    if (!s.enabled || !s.latest) return null;
    return { latest: s.latest, url: s.url ?? RELEASES_PAGE, newer: compareVersions(s.latest, current) > 0 };
  }
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const data = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    const latest = typeof data.tag_name === 'string' ? data.tag_name.replace(/^v/i, '') : '';
    if (!VERSION_RE.test(latest)) throw new Error('Unexpected answer from GitHub');
    const url = safeReleaseUrl(data.html_url);
    save({ ...load(), checkedAt: Date.now(), latest, url });
    return { latest, url, newer: compareVersions(latest, current) > 0 };
  } catch (e) {
    // Failures count as a check too, so a proxy does not cause a wait at every start
    save({ ...load(), checkedAt: Date.now() });
    if (force) throw e;
    return null;
  }
}

/** Should the notice be shown (newer and not dismissed)? */
export function shouldNotify(info: UpdateInfo | null): info is UpdateInfo {
  return !!info && info.newer && load().dismissed !== info.latest;
}
