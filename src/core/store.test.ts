/** Store import: strict checks, IDs, aliases, limits */
import { describe, expect, it } from 'vitest';
import { AliasStore, MAX_STORE_ENTRIES, MAX_STORE_FILE_SIZE, parseStoreExport, readStoreFile, sanitizeEntry } from './store';

const raw = (o: Record<string, unknown>) => ({ id: 'id', original: 'A', alias: 'x', category: 'person', confirmed: true, ...o });

describe('store import', () => {
  it('Kategorien aus Object.prototype oder Arrays → sonstiges', () => {
    const s = new AliasStore();
    s.importEntries(
      parseStoreExport(
        JSON.stringify({
          entries: [
            raw({ id: '1', original: 'A', alias: 'x', category: 'constructor' }),
            raw({ id: '2', original: 'B', alias: 'y', category: '__proto__' }),
            raw({ id: '3', original: 'C', alias: 'z', category: ['email'] }),
            raw({ id: '4', original: 'D', alias: 'w', category: 'toString' }),
            raw({ id: '5', original: 'E', alias: 'v', category: 'email' }),
          ],
        }),
      ),
    );
    expect(s.list().map((e) => e.category)).toEqual(['sonstiges', 'sonstiges', 'sonstiges', 'sonstiges', 'email']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(s.previewAlias('constructor' as never)).toBe('Other-1');
  });

  it('doppelte IDs im Import und mit Bestand → neue ID, nichts überschrieben', () => {
    const s = new AliasStore();
    const first = s.add('Gamma', 'G-1', 'person');
    s.importEntries([
      raw({ id: 'same', original: 'Alpha', alias: 'P-1' }),
      raw({ id: 'same', original: 'Beta', alias: 'P-2' }),
      raw({ id: first.id, original: 'Delta', alias: 'P-3' }),
    ]);
    const list = s.list();
    expect(list.map((e) => e.original)).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
    expect(new Set(list.map((e) => e.id)).size).toBe(4);
    expect(s.add('alpha', null, 'person').alias).toBe('P-1');
    expect(s.list().find((e) => e.original === 'Gamma')!.alias).toBe('G-1');
  });

  it('Alias gleich Original oder schon vergeben → neuer automatischer Alias', () => {
    const s = new AliasStore();
    s.add('Anna', 'Person-1', 'person');
    s.importEntries([
      raw({ id: 'a', original: 'Müller', alias: 'MÜLLER' }),
      raw({ id: 'b', original: 'Schmidt', alias: 'person-1' }),
      raw({ id: 'c', original: 'Meier', alias: 'Person-5' }),
      raw({ id: 'd', original: 'Huber', alias: 'Person-5' }),
    ]);
    const by = Object.fromEntries(s.list().map((e) => [e.original, e.alias]));
    expect(by).toEqual({ Anna: 'Person-1', Meier: 'Person-5', Müller: 'Person-6', Schmidt: 'Person-7', Huber: 'Person-8' });
  });

  it('strenge Feldprüfung', () => {
    expect(sanitizeEntry(null)).toBeNull();
    expect(sanitizeEntry(42)).toBeNull();
    expect(sanitizeEntry([raw({})])).toBeNull();
    expect(sanitizeEntry(raw({ original: '' }))).toBeNull();
    expect(sanitizeEntry(raw({ alias: '   ' }))).toBeNull();
    expect(sanitizeEntry(raw({ original: 5 }))).toBeNull();
    expect(sanitizeEntry(raw({ alias: { toString: () => 'x' } }))).toBeNull();
    expect(sanitizeEntry(raw({ original: 'x'.repeat(10_001) }))).toBeNull();
    expect(sanitizeEntry(raw({ id: 7 }))!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sanitizeEntry(raw({ confirmed: 'no' }))!.confirmed).toBe(true);
    expect(sanitizeEntry(raw({ confirmed: false }))!.confirmed).toBe(false);
  });

  it('parseStoreExport: robuste Fehler', () => {
    expect(() => parseStoreExport('null')).toThrow(/entries/);
    expect(() => parseStoreExport('42')).toThrow(/entries/);
    expect(() => parseStoreExport('"x"')).toThrow(/entries/);
    expect(() => parseStoreExport('{"entries": {}}')).toThrow(/entries/);
    expect(() => parseStoreExport('{')).toThrow(/Invalid alias store file/);
    expect(() => parseStoreExport(' '.repeat(MAX_STORE_FILE_SIZE + 1))).toThrow(/too large/);
    expect(() => parseStoreExport(JSON.stringify(new Array(MAX_STORE_ENTRIES + 1).fill(0)))).toThrow(/too many entries/);
    expect(parseStoreExport(JSON.stringify([raw({}), null, 3, raw({ original: 7 })]))).toHaveLength(1);
  });

  it('readStoreFile prüft die Größe vor dem Lesen', async () => {
    const big = { size: MAX_STORE_FILE_SIZE + 1, text: () => Promise.reject(new Error('should not read')) } as unknown as Blob;
    await expect(readStoreFile(big)).rejects.toThrow(/too large/);
    await expect(readStoreFile(new Blob(['[]']))).resolves.toBe('[]');
  });
});
