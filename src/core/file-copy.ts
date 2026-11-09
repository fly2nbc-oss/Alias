/**
 * Copy of the original file with the replacements applied (port of substitutor/file_copy.rs).
 * - Text: replace in the text, the encoding is kept.
 * - Office (docx/xlsx/pptx/odt/ods/odp): text nodes paragraph by paragraph (also across runs),
 *   plus alt texts, field codes, hyperlink targets, document properties, formula literals,
 *   sheet names with their references, chart/pivot caches, headers/footers and embedded
 *   Office documents. All other ZIP entries keep their content.
 * - When encoding, the copy is also cleaned (`sanitize.ts`): thumbnail, authors,
 *   person fields of the properties, template path … are removed and reported.
 * - PDF and .xls: read only.
 */
import { extensionOf, formatFromExt, isWritable, outputName, type FormatKind } from './formats';
import * as ox from './office-xml';
import { altTextAttr, isExternalHref } from './office-xml';
import { isImage, newReport, note, Pkg, sanitizePackage, stripJpegMetadata, type Report } from './sanitize';
import { applyMatches, findMatches, type Match, type Pair } from './substitute';
import { decodeText, encodeText } from './text-codec';
import { FORMULA_ELEMENTS, LITERAL_ELEMENTS, mapHeaderFooter, rewriteFormula, validSheetName, HEADER_FOOTER_ELEMENTS } from './xlsx-formula';
import { readZip, writeZip } from './zip';

export interface CopyResult {
  name: string;
  bytes: Uint8Array;
  replacements: number;
  /**
   * Search terms that occur more often in the shown text than they were replaced in the copy
   * (only with `shownText`). Typical case: xlsx date cells are shown as "2024-03-15" but stored
   * in the file as a serial number and stay unchanged -> warn the user.
   * `original` is the search term (so the alias when decoding).
   */
  missed: MissedTerm[];
  /** Parts removed or emptied when encoding (readable, e.g. "Thumbnail image …") */
  removed: string[];
  /** Parts not checked or not cleaned (images, OLE objects, remaining terms …) */
  warnings: string[];
}

export interface MissedTerm {
  original: string;
  /** Occurrences in the shown text */
  shown: number;
  /** Replacements in the copy */
  replaced: number;
}

export interface CopyOptions {
  /** Remove identifying parts (default: only when encoding) */
  sanitize?: boolean;
}

/** Count per search term (key: term from `ps`) */
type Counts = Map<string, number>;

/**
 * Copy in the original format. `shownText` = the file's text as shown in the app; used to find
 * terms that were replaced less often in the file than they are shown (`missed`).
 */
export function makeCopy(
  sourceName: string,
  bytes: Uint8Array,
  mode: 'encode' | 'decode',
  ps: Pair[],
  shownText?: string,
  opts: CopyOptions = {},
): CopyResult {
  const ext = extensionOf(sourceName);
  const kind = formatFromExt(ext);
  if (!kind) throw new Error(`Format '.${ext}' is not supported`);
  if (!isWritable(kind)) {
    throw new Error(`'.${ext}' can only be opened, not written back. Save the result as text instead.`);
  }
  const sanitize = opts.sanitize ?? mode === 'encode';
  const counts: Counts = new Map();
  let out: Uint8Array;
  let replacements: number;
  let report = newReport();
  if (kind === 'text') [out, replacements] = replaceInText(bytes, ps, counts);
  else ({ bytes: out, replacements, report } = transformZip(bytes, ps, kind, { counts, sanitize }));
  return {
    name: outputName(sourceName, mode, ps),
    bytes: out,
    replacements,
    missed: shownText === undefined ? [] : missedTerms(shownText, ps, counts),
    removed: report.removed,
    warnings: report.warnings,
  };
}

/** Terms that occur more often in the shown text than they were replaced in the copy */
export function missedTerms(shownText: string, ps: Pair[], replaced: Counts): MissedTerm[] {
  const shown: Counts = new Map();
  countMatches(shownText, ps, findMatches(shownText, ps), shown);
  const out: MissedTerm[] = [];
  for (const [original, n] of shown) {
    const r = replaced.get(original) ?? 0;
    if (r < n) out.push({ original, shown: n, replaced: r });
  }
  return out;
}

/** Map matches to their search term (the matched text may differ in case) */
const termIndex = new WeakMap<readonly Pair[], { exact: Set<string>; byKey: Map<string, string> }>();

export function countMatches(text: string, ps: readonly Pair[], matches: Match[], counts: Counts): void {
  if (!matches.length) return;
  let idx = termIndex.get(ps);
  if (!idx) {
    idx = { exact: new Set(ps.map(([f]) => f)), byKey: new Map() };
    for (const [from] of ps) if (!idx.byKey.has(from.toLowerCase())) idx.byKey.set(from.toLowerCase(), from);
    termIndex.set(ps, idx);
  }
  for (const [s, e] of matches) {
    const hit = text.slice(s, e);
    const term = idx.exact.has(hit) ? hit : (idx.byKey.get(hit.toLowerCase()) ?? hit);
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
}

export function replaceInText(raw: Uint8Array, ps: Pair[], counts?: Counts): [Uint8Array, number] {
  const [text, enc] = decodeText(raw);
  const matches = findMatches(text, ps);
  if (counts) countMatches(text, ps, matches, counts);
  return [encodeText(applyMatches(text, matches), enc), matches.length];
}

// ---------------------------------------------------------------- Text locations per part

/** [structure, only touch values that contain letters] */
type SpecUse = [ox.TextSpec, boolean];

/** Which text locations does a ZIP entry contain? */
function specsFor(kind: FormatKind, name: string): SpecUse[] {
  if (name === 'docProps/core.xml' || (kind === 'odf' && name === 'meta.xml')) return [[ox.METADATA, false]];
  if (name === 'docProps/app.xml') return [[ox.APP_STRINGS, false]];
  if (!name.endsWith('.xml')) return [];
  if (kind === 'odf') return /(^|\/)(content|styles)\.xml$/.test(name) ? [[ox.ODF, false], [ox.ODF_ALT, false]] : [];
  // Charts (titles, labels, caches) and SmartArt use DrawingML (<a:t>)
  if (/\/charts\/[^/]+\.xml$/.test(name)) return [[ox.PPTX, false], [ox.CHART_VALUES, true]];
  if (name.includes('/diagrams/')) return [[ox.PPTX, false]];
  const direct = (prefix: string) => name.startsWith(prefix) && !name.slice(prefix.length).includes('/');
  switch (kind) {
    case 'docx': {
      const part =
        /^word\/(document|footnotes|endnotes|comments|header\d*|footer\d*)\.xml$/.test(name) || name === 'word/glossary/document.xml';
      return part ? [[ox.DOCX, false], [ox.DOCX_FIELDS, false]] : [];
    }
    case 'xlsx':
      if (name === 'xl/sharedStrings.xml') return [[ox.XLSX, false]];
      // In worksheets <v> mostly holds a number or a shared string index: only touch values with
      // letters, otherwise a numeric entry (e.g. "1234") would break the file.
      if (name.startsWith('xl/worksheets/sheet')) return [[ox.XLSX_SHEET, true]];
      if (name.startsWith('xl/comments')) return [[ox.XLSX_COMMENTS, false]];
      if (direct('xl/threadedComments/')) return [[ox.XLSX_THREADED, false]];
      if (direct('xl/drawings/')) return [[ox.PPTX, false]];
      return [];
    case 'pptx':
      if (direct('ppt/comments/')) return [[/modernComment/.test(name) ? ox.PPTX : ox.PPTX_COMMENTS, false]];
      return ['ppt/slides/', 'ppt/notesSlides/', 'ppt/slideMasters/', 'ppt/slideLayouts/', 'ppt/notesMasters/', 'ppt/handoutMasters/'].some(direct)
        ? [[ox.PPTX, false]]
        : [];
    default:
      return [];
  }
}

const ALPHA = /\p{Alphabetic}/u;

/** Search with counting (for the copy) and without (for checks) */
interface Finder {
  find(t: string): Match[];
  peek(t: string): Match[];
  /** Replace text and count; `null` if nothing matched */
  apply(t: string): string | null;
  total: number;
}

function finder(ps: Pair[], counts?: Counts): Finder {
  const f: Finder = {
    total: 0,
    peek: (t) => findMatches(t, ps),
    find: (t) => {
      const m = findMatches(t, ps);
      if (counts) countMatches(t, ps, m, counts);
      return m;
    },
    apply: (t) => {
      const m = f.find(t);
      if (!m.length) return null;
      f.total += m.length;
      return applyMatches(t, m);
    },
  };
  return f;
}

export interface ZipCopy {
  bytes: Uint8Array;
  replacements: number;
  report: Report;
}

interface ZipOptions {
  counts?: Counts;
  sanitize?: boolean;
  /** Nesting depth of embedded documents */
  depth?: number;
}

/** Replace only (no cleanup); returns `[bytes, replacements]` as before */
export function replaceInZip(bytes: Uint8Array, ps: Pair[], kind: FormatKind, counts?: Counts): [Uint8Array, number] {
  const r = transformZip(bytes, ps, kind, { counts });
  return [r.bytes, r.replacements];
}

/** Encode/decode an Office file and (optionally) clean it */
export function transformZip(bytes: Uint8Array, ps: Pair[], kind: FormatKind, opts: ZipOptions = {}): ZipCopy {
  const pkg = new Pkg(readZip(bytes));
  const report = newReport();
  const sanitize = opts.sanitize ?? false;
  const f = finder(ps, opts.counts);
  const findAlpha = (t: string): Match[] => (ALPHA.test(t) ? f.find(t) : []);

  // 1. Remove first, then replace (removed parts do not count as replacements)
  if (sanitize) sanitizePackage(pkg, kind, report);

  // 2. Text nodes
  for (const name of pkg.names()) {
    const uses = specsFor(kind, name);
    if (!uses.length) continue;
    let xml = pkg.text(name)!;
    for (const [spec, alphaOnly] of uses) {
      const [out, n] = ox.replaceText(xml, spec, alphaOnly ? findAlpha : f.find);
      f.total += n;
      xml = out;
    }
    pkg.setText(name, xml);
  }

  // 3. Attributes, relationships, formulas, headers/footers …
  replaceExtras(pkg, kind, f, report);

  // 4. Embedded documents and images
  embedded(pkg, kind, ps, opts, f, report);
  if (sanitize) images(pkg, report);

  // 5. What is left over?
  if (sanitize) residualScan(pkg, ps, report);

  return { bytes: writeZip(pkg.build()), replacements: f.total, report };
}

// ---------------------------------------------------------------- Attributes and special places

/** Replace in a URL: percent encoding (`Geheim%20GmbH`) is decoded for the search and applied again afterwards */
function replaceUrl(v: string, apply: (t: string) => string | null): string | null {
  let d = v;
  try {
    d = decodeURI(v);
  } catch {
    /* search unchanged */
  }
  const r = apply(d);
  if (r === null) return null;
  // If the target was canonically encoded, the replacement is encoded too (space in the alias -> %20)
  return encodeURI(d) === v ? encodeURI(r) : r;
}

/** Pivot caches/tables: values and labels (source cells get the same replacement -> consistent) */
const PIVOT_ATTRS: Record<string, string[]> = {
  s: ['v'],
  cacheField: ['name', 'caption'],
  pivotField: ['name'],
  item: ['n'],
  dataField: ['name'],
  pivotTableDefinition: ['dataCaption', 'grandTotalCaption', 'rowHeaderCaption', 'colHeaderCaption'],
};

function replaceExtras(pkg: Pkg, kind: FormatKind, f: Finder, report: Report): void {
  const apply = (v: string) => f.apply(v);
  for (const name of pkg.names()) {
    if (name.endsWith('.rels')) {
      // Hyperlink targets, template and source paths
      const xml = pkg.tryText(name);
      if (xml === null || !xml.includes('External')) continue;
      pkg.setText(
        name,
        ox.replaceAttrs(xml, (el, a) => (el === 'Relationship' && a === 'Target' ? (v) => replaceUrl(v, apply) : null)),
      );
      // TargetMode must be in the same tag: restore internal targets
      if (pkg.text(name) !== xml) pkg.setText(name, restoreInternalTargets(xml, pkg.text(name)!));
      continue;
    }
    if (!/\.(xml|vml)$/.test(name)) continue;
    const before = pkg.tryText(name);
    if (before === null) continue;
    let xml = before;
    if (kind === 'odf') {
      if (/(^|\/)(content|styles)\.xml$/.test(name)) xml = odfAttrs(xml, f, report);
    } else if (/^(word|ppt|xl)\//.test(name) && /docPr|cNvPr|<v:|hyperlink|hlink/.test(xml)) {
      xml = ox.replaceAttrs(xml, (el, a) => (altTextAttr(el, a) ? apply : null));
    }
    if (kind === 'docx' && name.startsWith('customXml/item') && !name.includes('Props')) {
      // Data bound to content controls (only present if not removed)
      const [out, n] = ox.replaceCharData(xml, f.find);
      f.total += n;
      xml = out;
    }
    if (kind === 'xlsx') {
      if (/^xl\/(worksheets|chartsheets|charts)\//.test(name) && /Header>|Footer>/.test(xml)) {
        xml = ox.mapElementText(xml, HEADER_FOOTER_ELEMENTS, (t) => {
          const r = mapHeaderFooter(t, apply);
          return r === t ? null : r;
        })[0];
      }
      if (name.startsWith('xl/pivotCache/') || name.startsWith('xl/pivotTables/')) {
        xml = ox.replaceAttrs(xml, (el, a) => (PIVOT_ATTRS[el]?.includes(a) ? apply : null));
      }
    }
    if (xml !== before) pkg.setText(name, xml);
  }
  if (kind === 'xlsx') xlsxFormulas(pkg, f, report);
}

/**
 * OpenDocument attributes: external links, link tooltips, cached cell values and literals in
 * formulas/validation rules. Sheet names are not renamed (references sit in many attributes with
 * their own quoting rules); matches are reported.
 */
function odfAttrs(xml: string, f: Finder, report: Report): string {
  const apply = (v: string) => f.apply(v);
  const literal = (v: string) => {
    const r = rewriteFormula(v, { literal: apply });
    return r === v ? null : r;
  };
  for (const n of ox.attrValues(xml, (el, a) => el === 'table:table' && a === 'table:name')) {
    if (f.peek(n).length) note(report.warnings, `Sheet name "${n}" not replaced (OpenDocument spreadsheets: rename the sheet manually)`);
  }
  return ox.replaceAttrs(xml, (el, a) => {
    if (a === 'xlink:href') return (v) => (isExternalHref(v) ? replaceUrl(v, apply) : null);
    if (a === 'office:string-value') return apply;
    if (a === 'table:formula' || a === 'table:condition') return literal;
    if ((el === 'text:a' || el === 'draw:a') && (a === 'office:title' || a === 'office:name')) return apply;
    return null;
  });
}

/** `replaceAttrs` does not know TargetMode: only targets with `TargetMode="External"` may change */
function restoreInternalTargets(orig: string, changed: string): string {
  const re = /<Relationship\b[^>]*>/g;
  const a = orig.match(re) ?? [];
  const b = changed.match(re) ?? [];
  if (a.length !== b.length) return orig;
  let k = 0;
  return changed.replace(re, (t) => {
    const o = a[k++];
    return /TargetMode\s*=\s*["']External["']/.test(o) ? t : o;
  });
}

/**
 * Formulas in xlsx: replace literals, update renamed sheets in all references.
 * A sheet is only renamed if no reference to the old name is left afterwards
 * (dry run); otherwise the name stays and there is a warning.
 */
function xlsxFormulas(pkg: Pkg, f: Finder, report: Report): void {
  const wb = pkg.text('xl/workbook.xml');
  if (wb === null) return;
  const sheets = ox.attrValues(wb, (el, a) => el === 'sheet' && a === 'name');
  const taken = new Set(sheets.map((s) => s.toLowerCase()));
  const map = new Map<string, string>();
  for (const old of sheets) {
    const m = f.peek(old);
    if (!m.length) continue;
    const nv = applyMatches(old, m);
    if (!validSheetName(nv) || (taken.has(nv.toLowerCase()) && nv.toLowerCase() !== old.toLowerCase())) {
      note(report.warnings, `Sheet name "${old}" could not be replaced (the alias is not a valid sheet name)`);
      continue;
    }
    taken.add(nv.toLowerCase());
    map.set(old.toLowerCase(), nv);
  }
  for (const n of ox.attrValues(wb, (el, a) => el === 'definedName' && a === 'name')) {
    if (f.peek(n.replace(/_/g, ' ')).length || f.peek(n).length) note(report.warnings, `Defined name "${n}" contains a replaced term and was not renamed`);
  }

  const parts = pkg.names().filter((n) => /^xl\/.*\.xml$/.test(n) && !n.startsWith('xl/sharedStrings'));
  const rewrite = (xml: string, part: string, m: Map<string, string>, literal: ((s: string) => string | null) | undefined) => {
    const sheet = m.size ? (s: string) => m.get(s.toLowerCase()) ?? null : undefined;
    let out = ox.mapElementText(xml, FORMULA_ELEMENTS, (t, el) => {
      const r = rewriteFormula(t, { literal: LITERAL_ELEMENTS.includes(el) ? literal : undefined, sheet });
      return r === t ? null : r;
    })[0];
    if (sheet) {
      out = ox.replaceAttrs(out, (el, a) => {
        if (el === 'hyperlink' && a === 'location') return (v) => rewriteFormula(v, { sheet });
        if ((el === 'worksheetSource' && a === 'sheet') || (part === 'xl/workbook.xml' && el === 'sheet' && a === 'name')) return sheet;
        return null;
      });
    }
    return out;
  };
  const relevant = (xml: string) => /<(f|formula[12]?|xm:f|definedName|c:f|cx:f|calculatedColumnFormula|x12ac:list)\b|location=|worksheetSource|<sheet\b/.test(xml);

  // Dry run without counting: are references to old names left?
  for (let round = 0; map.size && round < 4; round++) {
    const bad: string[] = [];
    const texts = parts.map((p) => {
      const xml = pkg.tryText(p) ?? '';
      return relevant(xml) ? ox.plainContent(rewrite(xml, p, map, undefined)) : '';
    });
    for (const oldKey of map.keys()) if (texts.some((t) => refersToSheet(t, oldKey))) bad.push(oldKey);
    if (!bad.length) break;
    for (const b of bad) {
      note(report.warnings, `Sheet name "${sheets.find((s) => s.toLowerCase() === b) ?? b}" could not be replaced (referenced in a place Alias does not rewrite)`);
      map.delete(b);
    }
  }
  for (const p of parts) {
    const xml = pkg.tryText(p) ?? '';
    if (!relevant(xml)) continue;
    pkg.setText(p, rewrite(xml, p, map, (s) => f.apply(s)));
  }
  // Count renamed sheets as replacements (the sheet name is shown)
  for (const old of sheets) if (map.has(old.toLowerCase())) f.apply(old);
}

/** Does the text still contain a sheet reference to `name` (lower case)? */
function refersToSheet(text: string, name: string): boolean {
  const t = text.toLowerCase();
  const q = name.replace(/'/g, "''");
  if (t.includes(`'${q}'!`) || t.includes(`'${q}:`) || t.includes(`:${q}'!`)) return true;
  if (!/^[\p{L}_][\p{L}\p{N}_.]*$/u.test(name)) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}_.'\\]])${esc}(!|:[\\p{L}_][\\p{L}\\p{N}_.]*!)`, 'u').test(t);
}

// ---------------------------------------------------------------- Embedded objects, images, residual check

const MAX_DEPTH = 2;

function embedded(pkg: Pkg, kind: FormatKind, ps: Pair[], opts: ZipOptions, f: Finder, report: Report): void {
  const sanitize = opts.sanitize ?? false;
  const depth = opts.depth ?? 0;
  for (const name of pkg.names()) {
    const base = name.slice(name.lastIndexOf('/') + 1);
    const isEmbedding = kind === 'odf' ? /^Object \d+$/.test(name) : /(^|\/)embeddings\/[^/]+$/.test(name);
    if (!isEmbedding) continue;
    const sub = formatFromExt(extensionOf(base));
    if (sub && sub !== 'text' && isWritable(sub) && depth < MAX_DEPTH) {
      try {
        const r = transformZip(pkg.data(name)!, ps, sub, { counts: opts.counts, sanitize, depth: depth + 1 });
        if (r.replacements || (sanitize && r.report.removed.length)) pkg.setData(name, r.bytes);
        f.total += r.replacements;
        for (const s of r.report.removed) note(report.removed, `Embedded "${base}": ${s}`);
        for (const s of r.report.warnings) note(report.warnings, `Embedded "${base}": ${s}`);
      } catch {
        if (sanitize) note(report.warnings, `Embedded object "${base}" could not be checked`);
      }
    } else if (sanitize && !isImage(base)) {
      note(report.warnings, `Embedded object "${base}" not checked`);
    }
  }
}

function images(pkg: Pkg, report: Report): void {
  let count = 0;
  let stripped = 0;
  for (const name of pkg.names()) {
    if (!isImage(name)) continue;
    count++;
    if (!/\.(jpe?g|jfif)$/i.test(name)) continue;
    try {
      const out = stripJpegMetadata(pkg.data(name)!);
      if (out) {
        pkg.setData(name, out);
        stripped++;
      }
    } catch {
      /* unreadable: stays unchanged */
    }
  }
  if (stripped) note(report.removed, `Camera and author metadata (EXIF/XMP) from ${stripped} JPEG image${stripped > 1 ? 's' : ''}`);
  if (count) note(report.warnings, `${count} image${count > 1 ? 's' : ''} not checked (may show names, text or faces)`);
}

/** Residual check: search binary data up to this size in full, raster images only at start/end */
const MAX_SCAN_BYTES = 8 * 1024 * 1024;
const IMAGE_HEAD = 256 * 1024;
const IMAGE_TAIL = 64 * 1024;

/** After processing: report original terms that are still somewhere in the file as warnings */
function residualScan(pkg: Pkg, ps: Pair[], report: Report): void {
  if (!ps.length) return;
  const aliases: Pair[] = ps.map(([, a]) => [a, a]);
  // Binary data: short terms match by chance, so only longer or multi-word ones
  const binPairs = ps.filter(([o]) => o.length >= 6 || /\s/.test(o));
  const hits = (text: string, pairs: Pair[]): string[] => {
    const m = findMatches(text, pairs);
    if (!m.length) return [];
    const own = findMatches(text, aliases);
    return [...new Set(m.filter(([s, e]) => !own.some(([a, b]) => s < b && a < e)).map(([s, e]) => text.slice(s, e)))];
  };
  let warned = 0;
  for (const name of pkg.names()) {
    if (warned >= 20) break;
    let found: string[] = [];
    try {
      if (/\.(xml|rels|vml)$/i.test(name)) found = hits(ox.plainContent(pkg.text(name)!), ps); // throws on unreadable entries -> warning below
      else if (binPairs.length) {
        const all = pkg.data(name)!;
        // Raster images: metadata (EXIF, XMP, PNG text) sits at the start or end; vector images
        // (EMF/WMF, often previews of embedded objects) contain text anywhere
        const raster = isImage(name) && !/\.(emf|wmf|emz|wmz|svg)$/i.test(name);
        const parts =
          raster && all.length > IMAGE_HEAD + IMAGE_TAIL
            ? [all.subarray(0, IMAGE_HEAD), all.subarray(all.length - IMAGE_TAIL)]
            : all.length > MAX_SCAN_BYTES
              ? []
              : [all];
        for (const d of parts) {
          const latin1 = new TextDecoder('latin1').decode(d);
          const u16 = (o: number) => new TextDecoder('utf-16le').decode(d.subarray(o, o + ((d.length - o) & ~1)));
          found = [...new Set([...found, ...hits(latin1, binPairs), ...hits(u16(0), binPairs), ...hits(u16(1), binPairs)])];
        }
      }
    } catch {
      note(report.warnings, `"${name}" could not be checked`);
      continue;
    }
    if (!found.length) continue;
    warned++;
    const shown = found.slice(0, 3).map((t) => `"${t}"`).join(', ') + (found.length > 3 ? ' …' : '');
    note(report.warnings, `${shown} still present in ${name}`);
  }
}
