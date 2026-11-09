import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('index.html', () => {
  it('favicon data URI has no raw "#" (it would cut the URL; Edge then shows a globe in the taskbar)', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const hrefs = [...html.matchAll(/<link[^>]+rel="icon"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      if (href.startsWith('data:')) expect(href).not.toContain('#');
    }
  });
});
