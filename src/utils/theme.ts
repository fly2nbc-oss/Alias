export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'alias-theme';

export function getStoredTheme(): ThemeMode {
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === 'light' || v === 'dark' || v === 'system') return v;
  return 'system';
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  if (mode === 'light') root.classList.add('light');
  if (mode === 'dark') root.classList.add('dark');
  localStorage.setItem(STORAGE_KEY, mode);
  syncThemeButton();
}

export function cycleTheme(): void {
  const order: ThemeMode[] = ['system', 'light', 'dark'];
  const i = order.indexOf(getStoredTheme());
  applyTheme(order[(i + 1) % order.length]);
}

export function syncThemeButton(): void {
  const btn = document.getElementById('btn-theme');
  if (!btn) return;
  const mode = getStoredTheme();
  const labels: Record<ThemeMode, string> = {
    system: 'System',
    light: 'Light',
    dark: 'Dark',
  };
  btn.setAttribute(
    'aria-label',
    `Appearance: ${labels[mode]}. Click to cycle.`,
  );
  btn.setAttribute('title', `${labels[mode]} — click for next theme`);
  btn.textContent =
    mode === 'system' ? '◐ System' : mode === 'light' ? '☀ Light' : '☾ Dark';
}
