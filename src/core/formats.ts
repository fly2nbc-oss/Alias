/** Supported file formats (port of formats.rs) */
import { findMatches, type Pair } from './substitute';

export type FormatKind = 'text' | 'docx' | 'xlsx' | 'pptx' | 'odf' | 'xls' | 'pdf';

export const TEXT_EXTENSIONS = [
  'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'xml', 'html', 'htm', 'yaml', 'yml',
  'toml', 'ini', 'cfg', 'conf', 'properties', 'sql', 'eml',
];
const OTHER_EXTENSIONS = ['docx', 'docm', 'xlsx', 'xlsm', 'pptx', 'pptm', 'odt', 'ods', 'odp', 'xls', 'pdf'];

export function formatFromExt(ext: string): FormatKind | null {
  const e = ext.toLowerCase();
  if (TEXT_EXTENSIONS.includes(e)) return 'text';
  switch (e) {
    case 'docx': case 'docm': return 'docx';
    case 'xlsx': case 'xlsm': return 'xlsx';
    case 'pptx': case 'pptm': return 'pptx';
    case 'odt': case 'ods': case 'odp': return 'odf';
    case 'xls': return 'xls';
    case 'pdf': return 'pdf';
    default: return null;
  }
}

/** Can an encoded/decoded copy be written in the original format? */
export function isWritable(kind: FormatKind): boolean {
  return kind !== 'xls' && kind !== 'pdf';
}

export function extensionOf(name: string): string {
  const m = /\.([^.\\/]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export function allExtensions(): string[] {
  return [...TEXT_EXTENSIONS, ...OTHER_EXTENSIONS];
}

/**
 * Output name `<stem>_anonym.<ext>` or `<stem>_original.<ext>`; the opposite suffix is replaced.
 * With `ps` search terms are also replaced in the file stem (`Vertrag_Max_Mustermann.docx` ->
 * `Vertrag_Person-1_anonym.docx`): `_` counts as a separator; if the stem has no spaces,
 * spaces in the replacement become `_`. Characters not allowed on Windows are dropped.
 */
export function outputName(name: string, mode: 'encode' | 'decode', ps?: readonly Pair[]): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot + 1) : 'txt';
  const [suffix, opposite] = mode === 'encode' ? ['_anonym', '_original'] : ['_original', '_anonym'];
  let core = stem;
  for (const s of [opposite, suffix]) {
    if (stem.endsWith(s) && stem.length > s.length) {
      core = stem.slice(0, -s.length);
      break;
    }
  }
  if (ps?.length) core = replaceInStem(core, ps);
  return `${core}${suffix}.${ext}`;
}

function replaceInStem(stem: string, ps: readonly Pair[]): string {
  // Search version of the same length: `_` -> space, so word boundaries and multi-word terms match
  const spaced = stem.replace(/_/g, ' ');
  const matches = findMatches(spaced, ps);
  if (!matches.length) return stem;
  const underscore = !/\s/.test(stem) && stem.includes('_');
  let out = '';
  let cursor = 0;
  for (const [s, e, rep] of matches) {
    out += stem.slice(cursor, s) + (underscore ? rep.replace(/\s+/g, '_') : rep).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '');
    cursor = e;
  }
  out += stem.slice(cursor);
  return out.replace(/^[\s.]+|[\s.]+$/g, '') || 'document';
}
