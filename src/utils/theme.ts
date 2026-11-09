import { iconMoon, iconSun, iconSunMoon } from '../icons';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'alias.theme.v1';

const valid = (v: string | null): v is ThemeMode => v === 'light' || v === 'dark' || v === 'system';

export function getStoredTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (valid(v)) return v;
  } catch {
    /* storage not available */
  }
  return 'system';
}

/** Light and dark set `data-theme`; "system" removes it and follows `prefers-color-scheme`. */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage not available */
  }
  syncThemeButton();
}

export function cycleTheme(): void {
  const order: ThemeMode[] = ['system', 'light', 'dark'];
  const i = order.indexOf(getStoredTheme());
  applyTheme(order[(i + 1) % order.length]);
}

const LABEL: Record<ThemeMode, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const NEXT: Record<ThemeMode, ThemeMode> = { system: 'light', light: 'dark', dark: 'system' };

export function syncThemeButton(): void {
  const btn = document.getElementById('btn-theme');
  if (!btn) return;
  const mode = getStoredTheme();
  const text = `Appearance: ${LABEL[mode]} – click for ${LABEL[NEXT[mode]]}`;
  btn.setAttribute('aria-label', text);
  btn.title = text;
  btn.innerHTML = mode === 'system' ? iconSunMoon : mode === 'light' ? iconSun : iconMoon;
}
