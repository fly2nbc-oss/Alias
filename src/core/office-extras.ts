/**
 * Extra text sections for showing Office files. Rule: everything that is replaced when
 * encoding must also be shown; only then can the user have it found.
 * The sections follow the main text under headings like "--- Comments ---".
 */
import { extensionOf, formatFromExt } from './formats';
import * as ox from './office-xml';
import { altTextAttr, isExternalHref } from './office-xml';
import { formulaLiterals, FORMULA_ELEMENTS, headerFooterText, HEADER_FOOTER_ELEMENTS, LITERAL_ELEMENTS } from './xlsx-formula';
import { readZip, u8ToStr, type ZipEntry } from './zip';

type Kind = 'docx' | 'pptx' | 'xlsx' | 'odf';

const text = (zip: ZipEntry[], name: string): string | null => {
  const e = zip.find((z) => z.name === name);
  return e ? u8ToStr(e.data) : null;
};

/** Entries whose name matches, in natural order (comment2 before comment10) */
function matching(zip: ZipEntry[], re: RegExp): string[] {
  const num = (n: string) => parseInt(n.replace(/[^0-9]/g, ''), 10) || 0;
  return zip
    .map((z) => z.name)
    .filter((n) => re.test(n))
    .sort((a, b) => num(a) - num(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** Collect the lines of a section (without empty lines and duplicates) */
class Section {
  readonly lines: string[] = [];
  private readonly seen = new Set<string>();
  constructor(readonly title: string) {}
  add(s: string | string[]): void {
    for (const raw of Array.isArray(s) ? s : s.split('\n')) {
      const l = raw.trimEnd();
      if (!l.trim() || this.seen.has(l)) continue;
      this.seen.add(l);
      this.lines.push(l);
    }
  }
  render(): string {
    return this.lines.length ? `\n--- ${this.title} ---\n${this.lines.join('\n')}\n` : '';
  }
}

const each = (zip: ZipEntry[], re: RegExp, fn: (xml: string, name: string) => void) => {
  for (const n of matching(zip, re)) fn(text(zip, n)!, n);
};

/** Default names like "Picture 1", "Grafik 3", "TextBox 2" are not shown */
const GENERIC_NAME = /^[\p{L} ]+ ?\d+$/u;

/**
 * Sections for `kind`. `shown` is the text already shown (document properties that
 * already appear there are not repeated).
 */
export function officeExtras(zip: ZipEntry[], kind: Kind, shown: string, depth = 0): string {
  const s = {
    footnotes: new Section('Footnotes'),
    endnotes: new Section('Endnotes'),
    comments: new Section('Comments'),
    deleted: new Section('Deleted text (tracked changes)'),
    fields: new Section('Field codes'),
    blocks: new Section('Building blocks'),
    masters: new Section('Slide masters and layouts'),
    headers: new Section('Headers and footers'),
    shapes: new Section('Text boxes and shapes'),
    formulas: new Section('Text in formulas'),
    charts: new Section('Charts'),
    smartart: new Section('SmartArt'),
    objects: new Section('Embedded objects'),
    alt: new Section('Alt text and tooltips'),
    links: new Section('Links'),
    props: new Section('Document properties'),
  };

  if (kind === 'docx') {
    each(zip, /^word\/footnotes\.xml$/, (x) => s.footnotes.add(ox.extractText(x, ox.DOCX)));
    each(zip, /^word\/endnotes\.xml$/, (x) => s.endnotes.add(ox.extractText(x, ox.DOCX)));
    each(zip, /^word\/comments\.xml$/, (x) => s.comments.add(ox.extractText(x, ox.DOCX)));
    each(zip, /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$|^word\/glossary\/document\.xml$/, (x, n) => {
      if (/^word\/(document|header\d*|footer\d*)\.xml$/.test(n)) s.deleted.add(ox.extractText(x, ox.DOCX_DELETED));
      for (const l of ox.extractText(x, ox.DOCX_FIELDS).split('\n')) if (!TRIVIAL_FIELD.test(l)) s.fields.add(l.trim());
    });
    each(zip, /^word\/glossary\/document\.xml$/, (x) => s.blocks.add(ox.extractText(x, ox.DOCX)));
  } else if (kind === 'pptx') {
    each(zip, /^ppt\/(slideMasters|slideLayouts|notesMasters|handoutMasters)\/[^/]+\.xml$/, (x) => s.masters.add(ox.extractText(x, ox.PPTX)));
    each(zip, /^ppt\/comments\/[^/]+\.xml$/, (x, n) => s.comments.add(ox.extractText(x, /modernComment/.test(n) ? ox.PPTX : ox.PPTX_COMMENTS)));
  } else if (kind === 'xlsx') {
    each(zip, /^xl\/comments[^/]*\.xml$/, (x) => s.comments.add(ox.extractText(x, ox.XLSX_COMMENTS)));
    each(zip, /^xl\/threadedComments\/[^/]+\.xml$/, (x) => s.comments.add(ox.extractText(x, ox.XLSX_THREADED)));
    each(zip, /^xl\/(worksheets|chartsheets|charts)\/[^/]+\.xml$/, (x) => {
      if (!/Header>|Footer>/.test(x)) return;
      ox.mapElementText(x, HEADER_FOOTER_ELEMENTS, (t) => {
        s.headers.add(headerFooterText(t));
        return null;
      });
    });
    each(zip, /^xl\/drawings\/[^/]+\.xml$/, (x) => s.shapes.add(ox.extractText(x, ox.PPTX)));
    each(zip, /^xl\/.*\.xml$/, (x) => {
      if (!/<(f|formula[12]?|xm:f|definedName|calculatedColumnFormula|x12ac:list)\b/.test(x)) return;
      ox.mapElementText(x, FORMULA_ELEMENTS, (t, el) => {
        if (LITERAL_ELEMENTS.includes(el)) s.formulas.add(formulaLiterals(t).filter((l) => /\p{L}/u.test(l)));
        return null;
      });
    });
  } else {
    each(zip, /^.+\/content\.xml$/, (x, n) => {
      s.objects.add(`[${n.slice(0, -'/content.xml'.length)}]`);
      s.objects.add(ox.extractText(x, ox.ODF));
    });
    if (s.objects.lines.every((l) => l.startsWith('['))) s.objects.lines.length = 0;
    each(zip, /(^|\/)(content|styles)\.xml$/, (x) => {
      // Title/description in paragraphs already appear in the main text
      s.alt.add(ox.extractText(x, ox.ODF_ALT).split('\n').filter((l) => !shown.includes(l.trim())));
      s.alt.add(ox.attrValues(x, (el, a) => (el === 'text:a' || el === 'draw:a') && (a === 'office:title' || a === 'office:name')));
      if (x.includes('table:formula') || x.includes('table:condition')) {
        const fs = ox.attrValues(x, (_el, a) => a === 'table:formula' || a === 'table:condition');
        s.formulas.add(fs.flatMap(formulaLiterals).filter((l) => /\p{L}/u.test(l)));
      }
      if (x.includes('xlink:href')) s.links.add(ox.attrValues(x, (_el, a) => a === 'xlink:href').filter(isExternalHref).map(safeDecodeUri));
    });
    each(zip, /^meta\.xml$/, (x) => s.props.add(ox.extractText(x, ox.METADATA_SHOWN)));
  }

  if (kind !== 'odf') {
    // Charts and SmartArt (DrawingML), in all OOXML formats
    each(zip, /^(word|ppt|xl)\/charts\/[^/]+\.xml$/, (x) => {
      s.charts.add(ox.extractText(x, ox.PPTX));
      s.charts.add(ox.extractText(x, ox.CHART_VALUES).split('\n').filter((l) => /\p{L}/u.test(l)));
    });
    each(zip, /^(word|ppt|xl)\/diagrams\/data[^/]*\.xml$/, (x) => s.smartart.add(ox.extractText(x, ox.PPTX)));
    each(zip, /^(word|ppt|xl)\/.*\.(xml|vml)$/, (x) => {
      if (!/docPr|cNvPr|<v:|hyperlink|hlink/.test(x)) return;
      s.alt.add(ox.attrValues(x, altTextAttr).filter((v) => !GENERIC_NAME.test(v.trim())));
    });
    each(zip, /\.rels$/, (x) => {
      if (!x.includes('External')) return;
      for (const m of x.match(/<Relationship\b[^>]*>/g) ?? []) {
        if (!/TargetMode\s*=\s*["']External["']/.test(m)) continue;
        // Encoding removes template and mail merge sources anyway
        if (/Type\s*=\s*["'][^"']*\/(attachedTemplate|mailMergeSource|mailMergeHeaderSource|recipientData)["']/.test(m)) continue;
        const t = /\sTarget\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m);
        if (t) s.links.add(safeDecodeUri(ox.decodeEntities(t[1] ?? t[2] ?? '')));
      }
    });
    each(zip, /^docProps\/core\.xml$/, (x) => s.props.add(ox.extractText(x, ox.METADATA_SHOWN)));
    each(zip, /^docProps\/app\.xml$/, (x) => {
      // Part titles (sheet names, slide titles), hyperlink list, template, unless already shown
      // HeadingPairs only holds labels ("Worksheets", "Fonts Used")
      const vals = ox.extractText(ox.removeElements(x, ['HeadingPairs'])[0], ox.APP_STRINGS).split('\n');
      s.props.add(vals.filter((v) => v.trim() && !/^Normal\.dot[mx]?$/i.test(v.trim()) && !shown.includes(v.trim())));
    });
  }

  let out = Object.values(s)
    .map((sec) => sec.render())
    .join('');
  if (kind !== 'odf' && depth < 1) out += embeddedText(zip, depth);
  return out;
}

/** Do not show field codes without content (page numbers, tables of contents, cross references) */
const TRIVIAL_FIELD = /^\s*(PAGE|NUMPAGES|SECTIONPAGES|PAGEREF|TOC|SEQ|NOTEREF|SECTION|STYLEREF|DATE|TIME|CREATEDATE|SAVEDATE|PRINTDATE|EQ)\b/;

function safeDecodeUri(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

/** Text of embedded Office documents (workbooks behind charts, embedded documents) */
function embeddedText(zip: ZipEntry[], depth: number): string {
  let out = '';
  for (const n of matching(zip, /(^|\/)embeddings\/[^/]+$/)) {
    const base = n.slice(n.lastIndexOf('/') + 1);
    const kind = formatFromExt(extensionOf(base));
    if (kind !== 'docx' && kind !== 'pptx' && kind !== 'xlsx' && kind !== 'odf') continue;
    try {
      const sub = readZip(zip.find((z) => z.name === n)!.data);
      const body = embeddedBody(sub, kind);
      const t = (body + officeExtras(sub, kind, body, depth + 1)).trim();
      if (t) out += `\n--- Embedded: ${base} ---\n${t}\n`;
    } catch {
      /* not readable: reported when saving */
    }
  }
  return out;
}

/** Main text of an embedded document (synchronous; xlsx simplified, without SheetJS) */
function embeddedBody(zip: ZipEntry[], kind: Kind): string {
  const get = (n: string) => text(zip, n);
  switch (kind) {
    case 'docx': {
      let out = '';
      each(zip, /^word\/(document|header\d*|footer\d*)\.xml$/, (x) => (out += ox.extractText(x, ox.DOCX)));
      return out;
    }
    case 'pptx': {
      let out = '';
      each(zip, /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/, (x) => (out += ox.extractText(x, ox.PPTX)));
      return out;
    }
    case 'xlsx': {
      const wb = get('xl/workbook.xml');
      let out = wb ? ox.attrValues(wb, (el, a) => el === 'sheet' && a === 'name').map((s) => `=== Sheet: ${s} ===\n`).join('') : '';
      const sst = get('xl/sharedStrings.xml');
      if (sst) out += ox.extractText(sst, ox.XLSX);
      each(zip, /^xl\/worksheets\/[^/]+\.xml$/, (x) => {
        out += ox.extractText(x, ox.XLSX_SHEET).split('\n').filter((l) => /\p{L}/u.test(l)).join('\n');
      });
      return out;
    }
    case 'odf': {
      const c = get('content.xml');
      return c ? ox.extractText(c, ox.ODF) : '';
    }
  }
}
