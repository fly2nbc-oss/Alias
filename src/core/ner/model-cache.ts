/**
 * Management of the NER model cached in the browser (Cache API of transformers.js)
 * and of the "use NER model" switch. The alias table (localStorage) is not touched.
 */

/** Cache name of transformers.js (`env.cacheKey`, default) */
const CACHE_NAME = 'transformers-cache';
const ENABLED_KEY = 'alias.nerEnabled.v1';

/** Off until the user turns it on (first-run card or Settings): the model is a 180 MB download. */
export function nerEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setNerEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, on ? 'true' : 'false');
  } catch {
    /* storage not available */
  }
}

/** Space used by the model cache in bytes (`null` if the Cache API is missing). */
export async function modelCacheSize(): Promise<number | null> {
  if (typeof caches === 'undefined') return null;
  try {
    if (!(await caches.has(CACHE_NAME))) return 0;
    const cache = await caches.open(CACHE_NAME);
    let total = 0;
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      const len = Number(res?.headers.get('content-length'));
      total += Number.isFinite(len) && len > 0 ? len : (await res?.clone().arrayBuffer())?.byteLength ?? 0;
    }
    return total;
  } catch {
    return null;
  }
}

/** Deletes the cached model. */
export async function deleteModelCache(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  return caches.delete(CACHE_NAME);
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}
