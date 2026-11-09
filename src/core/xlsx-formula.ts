/**
 * Rewrite Excel formulas (file format, A1 notation) selectively: string literals
 * (`"Max Mustermann"`) and sheet references (`'Kunde X'!A1`, `Tabelle1!A1`, `'A:B'!A1`).
 * Everything else (functions, references, structured references `Tabelle[[#Daten],[Spalte]]`,
 * external references `[1]Blatt!A1`) stays character for character.
 */

export interface FormulaOps {
  /** Content of a literal (without quotes, `""` resolved) -> new content or `null` */
  literal?: (s: string) => string | null;
  /** Sheet name of a reference -> new name or `null` (external references are never passed) */
  sheet?: (name: string) => string | null;
}

const IDENT_START = /[\p{L}_\\]/u;
const IDENT = /[\p{L}\p{N}_.\\]/u;

/** Quote a sheet name for a reference (`'` is doubled) */
export const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;

/** May Excel give a sheet this name? */
export function validSheetName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 31 &&
    !/[[\]:*?/\\]/.test(name) &&
    !name.startsWith("'") &&
    !name.endsWith("'") &&
    name.toLowerCase() !== 'history'
  );
}

/** Rewrite a formula; without matches `f` is returned unchanged */
export function rewriteFormula(f: string, ops: FormulaOps): string {
  let out = '';
  let i = 0;
  const n = f.length;
  let afterBracket = false;
  while (i < n) {
    const c = f[i];
    if (c === '"') {
      let j = i + 1;
      let content = '';
      while (j < n) {
        if (f[j] === '"') {
          if (f[j + 1] === '"') {
            content += '"';
            j += 2;
            continue;
          }
          break;
        }
        content += f[j++];
      }
      const end = Math.min(j + 1, n);
      const nv = ops.literal?.(content) ?? null;
      out += nv === null || nv === content ? f.slice(i, end) : `"${nv.replace(/"/g, '""')}"`;
      i = end;
      afterBracket = false;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let content = '';
      while (j < n) {
        if (f[j] === "'") {
          if (f[j + 1] === "'") {
            content += "'";
            j += 2;
            continue;
          }
          break;
        }
        content += f[j++];
      }
      const end = Math.min(j + 1, n);
      if (f[end] === '!' && ops.sheet && !content.includes('[')) {
        const parts = content.split(':');
        const renamed = parts.map((p) => ops.sheet!(p) ?? p);
        out += renamed.some((p, k) => p !== parts[k]) ? quoteSheet(renamed.join(':')) : f.slice(i, end);
      } else out += f.slice(i, end);
      i = end;
      afterBracket = false;
      continue;
    }
    if (c === '[') {
      // structured reference or workbook index: copy unchanged (`'` escapes there)
      let depth = 0;
      let j = i;
      while (j < n) {
        const d = f[j];
        if (d === "'" && depth > 0) {
          j += 2;
          continue;
        }
        if (d === '[') depth++;
        else if (d === ']' && --depth === 0) break;
        j++;
      }
      out += f.slice(i, j + 1);
      i = j + 1;
      afterBracket = true;
      continue;
    }
    if (IDENT_START.test(c) && !(i > 0 && (IDENT.test(f[i - 1]) || f[i - 1] === '#'))) {
      let j = i;
      while (j < n && IDENT.test(f[j])) j++;
      // 3D reference without quotes: Blatt1:Blatt3!A1
      let k = j;
      if (f[k] === ':' && k + 1 < n && IDENT_START.test(f[k + 1])) {
        k++;
        while (k < n && IDENT.test(f[k])) k++;
      }
      if (f[k] === '!' && !afterBracket && ops.sheet) {
        const parts = f.slice(i, k).split(':');
        const renamed = parts.map((p) => ops.sheet!(p) ?? p);
        out += renamed.some((p, x) => p !== parts[x]) ? quoteSheet(renamed.join(':')) : f.slice(i, k);
        i = k;
      } else {
        out += f.slice(i, j);
        i = j;
      }
      afterBracket = false;
      continue;
    }
    out += c;
    i++;
    afterBracket = false;
  }
  return out;
}

/** Contents of all string literals (for display) */
export function formulaLiterals(f: string): string[] {
  const out: string[] = [];
  rewriteFormula(f, {
    literal: (s) => {
      out.push(s);
      return null;
    },
  });
  return out;
}


/** Elements whose text is a formula (cells, names, conditional formats, validation, charts, tables) */
export const FORMULA_ELEMENTS = ['f', 'formula', 'formula1', 'formula2', 'xm:f', 'definedName', 'c:f', 'cx:f', 'calculatedColumnFormula', 'x12ac:list'];
/** Of these, the ones whose literals are content (chart references have no literals) */
export const LITERAL_ELEMENTS = ['f', 'formula', 'formula1', 'formula2', 'xm:f', 'definedName', 'calculatedColumnFormula', 'x12ac:list'];

// ---------------------------------------------------------------- Headers and footers

/** Elements with header/footer text (worksheets, chart sheets, charts) */
export const HEADER_FOOTER_ELEMENTS = ['oddHeader', 'oddFooter', 'evenHeader', 'evenFooter', 'firstHeader', 'firstFooter', 'c:oddHeader', 'c:oddFooter', 'c:evenHeader', 'c:evenFooter', 'c:firstHeader', 'c:firstFooter'];

/** Control codes: section (&L/&C/&R), fields (&P, &D …), font (&"Arial,Fett"), size (&12), color (&K…) */
const HF_CODE = /(&&|&"[^"]*"|&K[0-9A-Fa-f]{6}|&K\d{2}[+-]\d{3}|&\d+|&[A-Za-z])/;

/** Only rewrite the text pieces between the control codes (otherwise e.g. "&LMax" prevents the word boundary) */
export function mapHeaderFooter(s: string, fn: (piece: string) => string | null): string {
  const parts = s.split(HF_CODE);
  for (let i = 0; i < parts.length; i += 2) {
    if (!parts[i]) continue;
    const r = fn(parts[i]);
    if (r !== null) parts[i] = r;
  }
  return parts.join('');
}

/** Readable text of a header/footer (without control codes) */
export function headerFooterText(s: string): string {
  return s
    .split(HF_CODE)
    .filter((_, i) => i % 2 === 0)
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ');
}
