export function showToast(
  message: string,
  type: 'success' | 'error' | 'info' = 'info',
  durationMs = 3500
): void {
  const container = document.getElementById('toast-container')!;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity .3s';
    setTimeout(() => toast.remove(), 300);
  }, durationMs);
}
