/**
 * Outline icons (24×24 viewBox, stroke) — technical style, no emoji.
 * Color: currentColor (toolbar buttons inherit text color).
 */
function svg(paths: string, size: 18 | 16 = 18): string {
  const wh = String(size);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${wh}" height="${wh}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="toolbar-icon" aria-hidden="true">${paths}</svg>`;
}

/** Open file / explorer — folder-open (Lucide-style) */
export const iconFolderOpen = svg(
  '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
);

export const iconLock = svg(
  '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  16,
);

export const iconUnlock = svg(
  '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.33-2.5"/>',
  16,
);

export const iconSearch = svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>');

export const iconPlay = svg('<polygon points="6 3 20 12 6 21 6 3"/>');

export const iconClipboard = svg(
  '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
);

export const iconSave = svg(
  '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
);

export const iconArrowUp = svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>');

export const iconArrowDown = svg('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>');

export const iconTrash = svg(
  '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
);

/** Plus — manual entry */
export const iconPlus = svg('<path d="M12 5v14"/><path d="M5 12h14"/>');

/** Info circle — About */
export const iconInfo = svg(
  '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
);
