/**
 * Text-node based processing of Office XML (port of office_xml.rs).
 *
 * Office often splits continuous text over several runs. So per paragraph the text of all
 * text nodes is joined, searched, and the result is spread back over the original nodes.
 * Markup and formatting stay unchanged; string based on purpose instead of
 * DOMParser/XMLSerializer, which rewrite namespaces and formatting.
 */
import type { Match } from './substitute';

export interface TextSpec {
  /** Elements that form a paragraph (search scope) */
  paraTags: string[];
  /** Elements with text character data; `null` = all character data in the paragraph */
  textTags: string[] | null;
  /** Elements whose character data is never text (ODF: author/date of an annotation in the paragraph) */
  skipTags?: string[];
  /** Empty elements that separate text (tab, break) */
  breakTags: string[];
  /** Add `xml:space="preserve"` when a changed node starts/ends with whitespace */
  addSpacePreserve: boolean;
}

export const DOCX: TextSpec = { paraTags: ['w:p'], textTags: ['w:t', 'w:delText'], breakTags: ['w:tab', 'w:br', 'w:cr'], addSpacePreserve: true };
export const PPTX: TextSpec = { paraTags: ['a:p'], textTags: ['a:t'], breakTags: ['a:br'], addSpacePreserve: false };
export const XLSX: TextSpec = { paraTags: ['si'], textTags: ['t'], breakTags: [], addSpacePreserve: false };
export const XLSX_SHEET: TextSpec = { paraTags: ['is', 'v'], textTags: null, breakTags: [], addSpacePreserve: false };
export const XLSX_COMMENTS: TextSpec = { paraTags: ['text'], textTags: ['t'], breakTags: [], addSpacePreserve: false };
export const ODF: TextSpec = {
  paraTags: ['text:p', 'text:h'],
  textTags: null,
  breakTags: ['text:tab', 'text:line-break', 'text:s'],
  addSpacePreserve: false,
  skipTags: ['dc:creator', 'dc:date', 'meta:creator-initials'],
};
export const METADATA: TextSpec = {
  paraTags: ['dc:creator', 'dc:title', 'dc:subject', 'dc:description', 'cp:lastModifiedBy', 'cp:keywords', 'meta:initial-creator', 'meta:keyword'],
  textTags: null,
  breakTags: [],
  addSpacePreserve: false,
};

interface TextNode {
  /** Range of the raw character data in the XML */
  start: number;
  end: number;
  /** decoded text */
  text: string;
  /** Position of the `>` of the opening text tag without xml:space, if the text follows directly */
  spaceInsertAt: number | null;
}

type Segment = TextNode[];

function scan(xml: string, spec: TextSpec): Segment[][] {
  const n = xml.length;
  const done: Segment[][] = [];
  const stack: Segment[][] = [];
  let textDepth = 0;
  let skipDepth = 0;
  let lastTextOpen: [number, boolean] | null = null;
  let i = 0;
  while (i < n) {
    if (xml[i] !== '<') {
      const start = i;
      while (i < n && xml[i] !== '<') i++;
      const inText = (spec.textTags === null || textDepth > 0) && skipDepth === 0;
      const para = stack[stack.length - 1];
      if (inText && para) {
        const spaceInsertAt = lastTextOpen && !lastTextOpen[1] && lastTextOpen[0] + 1 === start ? lastTextOpen[0] : null;
        para[para.length - 1].push({ start, end: i, text: decodeEntities(xml.slice(start, i)), spaceInsertAt });
      }
      continue;
    }
    // Skip comments, PIs, CDATA, doctype
    const skip: [string, number] | null = xml.startsWith('<!--', i)
      ? ['-->', 4]
      : xml.startsWith('<?', i)
        ? ['?>', 2]
        : xml.startsWith('<![CDATA[', i)
          ? [']]>', 9]
          : xml.startsWith('<!', i)
            ? ['>', 2]
            : null;
    if (skip) {
      const p = xml.indexOf(skip[0], i + skip[1]);
      i = p < 0 ? n : p + skip[0].length;
      continue;
    }
    // Tag up to `>` (mind quotes in attributes)
    let j = i + 1;
    let quote: string | null = null;
    while (j < n) {
      const c = xml[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      j++;
    }
    if (j >= n) break;
    const tag = xml.slice(i + 1, j);
    const closing = tag.startsWith('/');
    const selfClosing = tag.endsWith('/');
    const name = tag.replace(/^\/+/, '').split(/[\s/]/)[0] ?? '';
    const isPara = spec.paraTags.includes(name);
    const isText = spec.textTags?.includes(name) ?? false;
    const isSkip = spec.skipTags?.includes(name) ?? false;
    if (isSkip && !selfClosing) skipDepth = Math.max(0, skipDepth + (closing ? -1 : 1));
    if (closing) {
      if (isPara) {
        const para = stack.pop();
        if (para) {
          const kept = para.filter((s) => s.length > 0);
          if (kept.length) done.push(kept);
        }
      } else if (isText) {
        textDepth = Math.max(0, textDepth - 1);
      }
    } else if (selfClosing) {
      if (spec.breakTags.includes(name)) stack[stack.length - 1]?.push([]);
    } else if (isPara) {
      stack.push([[]]);
    } else if (isText) {
      textDepth++;
      lastTextOpen = [j, tag.includes('xml:space')];
    }
    i = j + 1;
  }
  return done;
}

/** Visible text: one paragraph per line, pieces separated by tabs. */
export function extractText(xml: string, spec: TextSpec): string {
  let out = '';
  for (const para of scan(xml, spec)) {
    const line = para.map((seg) => seg.map((n) => n.text).join('')).join('\t');
    if (line.trim()) out += line.trimEnd() + '\n';
  }
  return out;
}

/** Replace text paragraph by paragraph. `find` returns sorted, non-overlapping matches. */
export function replaceText(xml: string, spec: TextSpec, find: (text: string) => Match[]): [string, number] {
  const edits: [number, number, string][] = [];
  let count = 0;
  for (const para of scan(xml, spec)) {
    for (const seg of para) {
      const joined = seg.map((n) => n.text).join('');
      const matches = find(joined);
      if (!matches.length) continue;
      count += matches.length;
      const newTexts = distribute(seg, joined, matches);
      seg.forEach((node, k) => {
        const nt = newTexts[k];
        if (nt === node.text) return;
        if (spec.addSpacePreserve && node.spaceInsertAt !== null && (/^\s/u.test(nt) || /\s$/u.test(nt))) {
          edits.push([node.spaceInsertAt, node.spaceInsertAt, ' xml:space="preserve"']);
        }
        edits.push([node.start, node.end, encodeEntities(nt)]);
      });
    }
  }
  if (!edits.length) return [xml, count];
  edits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let out = '';
  let cursor = 0;
  for (const [s, e, t] of edits) {
    out += xml.slice(cursor, s) + t;
    cursor = e;
  }
  return [out + xml.slice(cursor), count];
}

/** Unchanged text stays in its node; replacement text goes into the node where the match starts. */
function distribute(nodes: TextNode[], joined: string, matches: Match[]): string[] {
  const bounds: [number, number][] = [];
  let pos = 0;
  for (const n of nodes) {
    bounds.push([pos, pos + n.text.length]);
    pos += n.text.length;
  }
  const out = nodes.map(() => '');
  const copy = (a: number, b: number) => {
    bounds.forEach(([rs, re], k) => {
      const s = Math.max(a, rs);
      const e = Math.min(b, re);
      if (s < e) out[k] += joined.slice(s, e);
    });
  };
  let cursor = 0;
  for (const [start, end, rep] of matches) {
    copy(cursor, start);
    let k = bounds.findIndex(([rs, re]) => start >= rs && start < re);
    if (k < 0) k = nodes.length - 1;
    out[k] += rep;
    cursor = end;
  }
  copy(cursor, joined.length);
  return out;
}

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&([^;&]{1,11});/g, (whole, ent: string) => {
    switch (ent) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
    }
    let cp: number | null = null;
    if (/^#[xX][0-9a-fA-F]+$/.test(ent)) cp = parseInt(ent.slice(2), 16);
    else if (/^#[0-9]+$/.test(ent)) cp = parseInt(ent.slice(1), 10);
    if (cp === null || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return whole;
    return String.fromCodePoint(cp);
  });
}

export function encodeEntities(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------- More text locations

/** Word: only deleted text (display of tracked changes) */
export const DOCX_DELETED: TextSpec = { paraTags: ['w:p'], textTags: ['w:delText'], breakTags: [], addSpacePreserve: false };
/** Word: field codes (`HYPERLINK "mailto:…"`, `INCLUDETEXT "C:\…"`), separate from the visible text */
export const DOCX_FIELDS: TextSpec = { paraTags: ['w:p'], textTags: ['w:instrText', 'w:delInstrText'], breakTags: [], addSpacePreserve: true };
/** Chart caches (categories, series name); only touch with the letter guard (number caches) */
export const CHART_VALUES: TextSpec = { paraTags: ['c:v', 'cx:pt'], textTags: null, breakTags: [], addSpacePreserve: false };
/** PowerPoint: classic comments */
export const PPTX_COMMENTS: TextSpec = { paraTags: ['p:text'], textTags: null, breakTags: [], addSpacePreserve: false };
/** Excel: modern (threaded) comments */
export const XLSX_THREADED: TextSpec = { paraTags: ['text'], textTags: null, breakTags: [], addSpacePreserve: false };
/** OpenDocument: alt text of graphics/objects */
export const ODF_ALT: TextSpec = { paraTags: ['svg:title', 'svg:desc'], textTags: null, breakTags: [], addSpacePreserve: false };
/** docProps/app.xml: part titles (sheet names, slide titles), hyperlink list, template */
export const APP_STRINGS: TextSpec = { paraTags: ['vt:lpstr', 'vt:lpwstr', 'Template'], textTags: null, breakTags: [], addSpacePreserve: false };
/** Only the content fields of the document properties (display) */
export const METADATA_SHOWN: TextSpec = {
  paraTags: ['dc:title', 'dc:subject', 'dc:description', 'cp:keywords', 'meta:keyword'],
  textTags: null,
  breakTags: [],
  addSpacePreserve: false,
};

// ---------------------------------------------------------------- Tags, attributes, elements

export interface Tag {
  /** Position of `<` */
  start: number;
  /** Position after `>` */
  end: number;
  /** qualified name (`w:t`) */
  name: string;
  closing: boolean;
  selfClosing: boolean;
}

/** All tags in document order; comments, PIs, CDATA and doctype are skipped. */
export function* tags(xml: string): Generator<Tag> {
  const n = xml.length;
  let i = xml.indexOf('<');
  while (i >= 0 && i < n) {
    const skip = xml.startsWith('<!--', i)
      ? '-->'
      : xml.startsWith('<?', i)
        ? '?>'
        : xml.startsWith('<![CDATA[', i)
          ? ']]>'
          : xml.startsWith('<!', i)
            ? '>'
            : null;
    if (skip) {
      const p = xml.indexOf(skip, i + 2);
      if (p < 0) return;
      i = xml.indexOf('<', p + skip.length);
      continue;
    }
    let j = i + 1;
    let quote: string | null = null;
    while (j < n) {
      const c = xml[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      j++;
    }
    if (j >= n) return;
    const closing = xml[i + 1] === '/';
    const selfClosing = xml[j - 1] === '/';
    const m = /^[^\s/>]+/.exec(xml.slice(closing ? i + 2 : i + 1, j));
    yield { start: i, end: j + 1, name: m ? m[0] : '', closing, selfClosing };
    i = xml.indexOf('<', j + 1);
  }
}

/** Local name without prefix (`wp:docPr` -> `docPr`) */
export const localName = (q: string) => q.slice(q.indexOf(':') + 1);

/** Escape an attribute value (for `"`-delimited values) */
export function encodeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ATTR_RE = /([^\s=/<>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/**
 * Rewrite attribute values. `pick(element, attribute)` returns a transform (decoded value ->
 * new value or `null` = unchanged) or `null` if the attribute is not of interest.
 * Changed values are written again delimited by `"`; everything else stays byte for byte.
 */
export function replaceAttrs(xml: string, pick: (el: string, attr: string) => ((v: string) => string | null) | null): string {
  const edits: Edit[] = [];
  const re = new RegExp(ATTR_RE.source, 'g');
  for (const t of tags(xml)) {
    if (t.closing) continue;
    const body = xml.slice(t.start, t.end);
    re.lastIndex = t.name.length + 1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      const fn = pick(t.name, m[1]);
      if (!fn) continue;
      const old = decodeEntities(m[3] ?? m[4] ?? '');
      const nv = fn(old);
      if (nv === null || nv === old) continue;
      const vs = t.start + m.index + m[0].length - m[2].length;
      edits.push([vs, vs + m[2].length, `"${encodeAttr(nv)}"`]);
    }
  }
  return applyEdits(xml, edits);
}

/** Values of the chosen attributes (decoded), for display */
export function attrValues(xml: string, want: (el: string, attr: string) => boolean): string[] {
  const out: string[] = [];
  const re = new RegExp(ATTR_RE.source, 'g');
  for (const t of tags(xml)) {
    if (t.closing) continue;
    const body = xml.slice(t.start, t.end);
    re.lastIndex = t.name.length + 1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) if (want(t.name, m[1])) out.push(decodeEntities(m[3] ?? m[4] ?? ''));
  }
  return out;
}

/**
 * Remove elements with their content (nested elements of the same name are counted).
 * Returns the new XML and the number of removed elements.
 */
export function removeElements(xml: string, names: string[]): [string, number] {
  if (!names.some((n) => xml.includes('<' + n))) return [xml, 0];
  const edits: Edit[] = [];
  let open: { name: string; start: number; depth: number } | null = null;
  for (const t of tags(xml)) {
    if (open) {
      if (t.name !== open.name || t.selfClosing) continue;
      if (t.closing) {
        if (--open.depth === 0) {
          edits.push([open.start, t.end, '']);
          open = null;
        }
      } else open.depth++;
      continue;
    }
    if (t.closing || !names.includes(t.name)) continue;
    if (t.selfClosing) edits.push([t.start, t.end, '']);
    else open = { name: t.name, start: t.start, depth: 1 };
  }
  return [applyEdits(xml, edits), edits.length];
}

/**
 * Rewrite the content of simple elements (text only, no child elements): `fn(text, element)` returns
 * the new text or `null`. Self-closing elements are not touched.
 */
export function mapElementText(xml: string, names: string[], fn: (text: string, el: string) => string | null): [string, number] {
  if (!names.some((n) => xml.includes('<' + n))) return [xml, 0];
  const edits: Edit[] = [];
  let open: Tag | null = null;
  for (const t of tags(xml)) {
    if (!t.closing && !t.selfClosing && names.includes(t.name)) {
      open = t;
      continue;
    }
    if (open && t.closing && t.name === open.name) {
      const raw = xml.slice(open.end, t.start);
      const old = decodeEntities(raw);
      const nv = fn(old, t.name);
      if (nv !== null && nv !== old) edits.push([open.end, t.start, encodeEntities(nv)]);
    }
    open = null;
  }
  return [applyEdits(xml, edits), edits.length];
}

/** Replace each text node on its own (for data parts of any structure, e.g. customXml) */
export function replaceCharData(xml: string, find: (text: string) => Match[]): [string, number] {
  const edits: Edit[] = [];
  let count = 0;
  let prev = 0;
  const visit = (end: number) => {
    if (end <= prev) return;
    const text = decodeEntities(xml.slice(prev, end));
    const m = find(text);
    if (!m.length) return;
    count += m.length;
    let out = '';
    let c = 0;
    for (const [s, e, r] of m) {
      out += text.slice(c, s) + r;
      c = e;
    }
    edits.push([prev, end, encodeEntities(out + text.slice(c))]);
  };
  for (const t of tags(xml)) {
    visit(t.start);
    prev = t.end;
  }
  return [applyEdits(xml, edits), count];
}

/** Character data of all text nodes (without markup) and all attribute values except namespace declarations */
export function plainContent(xml: string): string {
  const parts: string[] = [];
  let prev = 0;
  const re = new RegExp(ATTR_RE.source, 'g');
  for (const t of tags(xml)) {
    if (t.start > prev) parts.push(decodeEntities(xml.slice(prev, t.start)));
    if (!t.closing) {
      const body = xml.slice(t.start, t.end);
      re.lastIndex = t.name.length + 1;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body))) if (!m[1].startsWith('xmlns')) parts.push(decodeEntities(m[3] ?? m[4] ?? ''));
    }
    prev = t.end;
  }
  return parts.join('\n');
}

/** Alt text, object names, tooltips (DrawingML, VML, hyperlinks) */
export function altTextAttr(el: string, attr: string): boolean {
  const l = localName(el);
  if (l === 'docPr' || l === 'cNvPr') return attr === 'descr' || attr === 'title' || attr === 'name';
  if (el.startsWith('v:')) return attr === 'alt' || (el === 'v:imagedata' && attr === 'o:title');
  if (l === 'hyperlink' || l === 'hlinkClick' || l === 'hlinkHover') return attr === 'tooltip' || attr === 'w:tooltip' || attr === 'display';
  return false;
}

/** External targets in ODF (`xlink:href` with a scheme or a relative path leading outside) */
export function isExternalHref(v: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('../') || v.startsWith('/') || v.startsWith('\\\\');
}

type Edit = [number, number, string];

function applyEdits(xml: string, edits: Edit[]): string {
  if (!edits.length) return xml;
  edits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let out = '';
  let cursor = 0;
  for (const [s, e, t] of edits) {
    out += xml.slice(cursor, s) + t;
    cursor = e;
  }
  return out + xml.slice(cursor);
}
