/**
 * Run-time regressions: detection runs in the UI thread. It used to grow quadratically
 * (pipeline lists and JS regex backtracking; 400 KB of text > 7 s, JSON number rows > 1 min).
 * Thresholds generous on purpose (slow CI): absolute < 2 s for 200 KB, and, if measurable,
 * double input at most ~3× as slow.
 */
import { describe, expect, it } from 'vitest';
import { detectAll } from './index';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Business-letter-like text with many different entities. */
function realistic(len: number): string {
  const r = rng(42);
  const p = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const n = () => Math.floor(r() * 100000);
  const FN = ['Anna', 'Max', 'Laura', 'Thomas', 'Ksenia', 'Jürgen', 'Özlem'];
  const LN = ['Weber', 'Müller', 'Nowak', 'Hoffmann', 'Strauß', 'Becker'];
  const tpl = [
    () => `Sehr geehrte Frau ${p(LN)},\nvielen Dank für Ihre Nachricht vom ${1 + (n() % 28)}.${1 + (n() % 12)}.2024. `,
    () => `${p(FN)} ${p(LN)} von der Acme${n()} GmbH hat das Angebot über ${n()},${n() % 99} € geprüft. `,
    () => `Kontakt: ${p(FN).toLowerCase()}${n()}@example.com, Tel. 089 99998 ${String(n() % 1000).padStart(3, '0')}, IBAN DE89370400440532013000. `,
    () => `Lieferung an ${p(LN)}straße ${1 + (n() % 200)}\n${80000 + (n() % 9999)} München\n`,
    () => `Das Modell XR${n()} wurde mit ÜWN-Prüfst. und XKT Consulting abgestimmt ("Phoenix ${n()}"). `,
    () => `Name\tFirma\tBetrag\n${p(FN)} ${p(LN)}\tNordwind${n()} AG\t${n()}\n`,
  ];
  let s = '';
  while (s.length < len) s += p(tpl)();
  return s;
}

const CASES: Record<string, (n: number) => string> = {
  'realistischer Text': realistic,
  "'1' × n": (n) => '1'.repeat(n),
  "'1.' × n": (n) => '1.'.repeat(n / 2),
  "'1,' × n": (n) => '1,'.repeat(n / 2),
  "'A.' × n": (n) => 'A.'.repeat(n / 2),
  "'A-' × n": (n) => 'A-'.repeat(n / 2),
  "'a.' × n": (n) => 'a.'.repeat(n / 2),
  'Datumsliste': (n) => '01.01.2020 '.repeat(n / 11),
  'Datumsliste ohne Leerzeichen': (n) => '01.01.2020,'.repeat(n / 11),
  'JSON Ganzzahlen': (n) => JSON.stringify(Array.from({ length: n / 6 }, (_, i) => (i * 7919) % 100000)),
  'JSON Fließkomma': (n) => JSON.stringify(Array.from({ length: n / 18 }, (_, i) => i / 3)),
  'Partikel + Leerzeichen': (n) => 'Anna von' + ' '.repeat(n) + 'x',
  'Ansprechpartner + Leerzeichen': (n) => 'Ansprechpartner:' + ' '.repeat(n) + 'x',
  'Modell + Leerzeichen': (n) => 'Modell' + ' '.repeat(n) + ',',
  'Großwörter': (n) => 'Aaa '.repeat(n / 4),
};

function bestOf(runs: number, f: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    f();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

describe('Erkennung skaliert linear', () => {
  for (const [name, make] of Object.entries(CASES)) {
    it(name, { timeout: 60_000 }, () => {
      const small = make(100_000);
      const large = make(200_000);
      const t1 = bestOf(2, () => detectAll(small));
      const t2 = bestOf(2, () => detectAll(large));
      expect(t2, `${name}: ${t2.toFixed(0)} ms für 200 KB`).toBeLessThan(2000);
      if (t2 > 100) expect(t2 / t1, `${name}: ${t1.toFixed(0)} → ${t2.toFixed(0)} ms`).toBeLessThan(3.5);
    });
  }

  it('1 MB realistischer Text < 3 s', { timeout: 60_000 }, () => {
    const text = realistic(1_000_000);
    const t = bestOf(1, () => detectAll(text));
    expect(t).toBeLessThan(3000);
  });
});
