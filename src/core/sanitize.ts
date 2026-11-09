/**
 * Cleanup of encoded Office copies: removes or neutralizes parts that reveal people or
 * origin but cannot be replaced as text (thumbnail, authors, document properties,
 * template path, co-author list, custom XML data …).
 * Only when encoding; decoding does not restore these parts.
 *
 * Parts are removed consistently: `[Content_Types].xml` override, all relationships in `*.rels`
 * (OOXML) or the entry in `META-INF/manifest.xml` (ODF); otherwise Office reports an error.
 */
import type { FormatKind } from './formats';
import * as ox from './office-xml';
import { u8ToStr, strToU8Utf8, withData, type ZipEntry } from './zip';

export interface Report {
  /** Removed/emptied parts (readable) */
  removed: string[];
  /** Parts not checked or not cleaned */
  warnings: string[];
}

export const newReport = (): Report => ({ removed: [], warnings: [] });

export function note(list: string[], s: string): void {
  if (!list.includes(s)) list.push(s);
}

/** Fixed replacement for person names in author fields */
export const AUTHOR = 'Author';
const INITIALS = 'A';

// ---------------------------------------------------------------- Package

/** Mutable view of the ZIP entries; unchanged entries can still be copied raw. */
export class Pkg {
  private readonly texts = new Map<string, string>();
  private readonly changed = new Set<string>();
  private readonly bins = new Map<string, Uint8Array>();
  private readonly dropped = new Set<string>();
  private readonly byName = new Map<string, ZipEntry>();

  constructor(private readonly entries: ZipEntry[]) {
    for (const e of entries) this.byName.set(e.name, e);
  }

  names(): string[] {
    return this.entries.filter((e) => !this.dropped.has(e.name)).map((e) => e.name);
  }

  has(name: string): boolean {
    return this.byName.has(name) && !this.dropped.has(name);
  }

  /** Content as UTF-8 text (cached) */
  text(name: string): string | null {
    if (!this.has(name)) return null;
    let t = this.texts.get(name);
    if (t === undefined) {
      t = u8ToStr(this.data(name)!);
      this.texts.set(name, t);
    }
    return t;
  }

  /**
   * Like `text`, but `null` instead of an error for unreadable entries (encrypted, unknown
   * compression): parts that were never unpacked before must not block saving.
   */
  tryText(name: string): string | null {
    try {
      return this.text(name);
    } catch {
      return null;
    }
  }

  setText(name: string, s: string): void {
    if (!this.has(name) || this.tryText(name) === s) return;
    this.texts.set(name, s);
    this.changed.add(name);
    this.bins.delete(name);
  }

  data(name: string): Uint8Array | null {
    if (!this.has(name)) return null;
    return this.bins.get(name) ?? this.byName.get(name)!.data;
  }

  setData(name: string, d: Uint8Array): void {
    if (!this.has(name)) return;
    this.bins.set(name, d);
    this.texts.delete(name);
    this.changed.delete(name);
  }

  isChanged(name: string): boolean {
    return this.changed.has(name) || this.bins.has(name);
  }

  drop(name: string): void {
    if (this.byName.has(name)) this.dropped.add(name);
  }

  build(): ZipEntry[] {
    const out: ZipEntry[] = [];
    for (const e of this.entries) {
      if (this.dropped.has(e.name)) continue;
      const bin = this.bins.get(e.name);
      if (bin) out.push(withData(e, bin));
      else if (this.changed.has(e.name)) out.push(withData(e, strToU8Utf8(this.texts.get(e.name)!)));
      else out.push(e);
    }
    return out;
  }
}

// ---------------------------------------------------------------- Remove relationships / parts

const lc = (s: string) => s.toLowerCase();

/** Source part of a `.rels` file: `word/_rels/document.xml.rels` -> `word/document.xml`, `_rels/.rels` -> `` */
function relsBaseDir(rels: string): string {
  const m = /^(.*?)_rels\/[^/]*\.rels$/.exec(rels);
  return m ? m[1] : '';
}

/** Target of an internal relationship as ZIP entry name */
export function resolveTarget(rels: string, target: string): string {
  let t = target;
  try {
    t = decodeURIComponent(target);
  } catch {
    /* unchanged */
  }
  const parts = (t.startsWith('/') ? t.slice(1) : relsBaseDir(rels) + t).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

/** Read an attribute from a tag text (decoded) */
export function attr(tagText: string, name: string): string | null {
  const m = new RegExp(`\\s${name.replace(/[.:]/g, '\\$&')}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tagText);
  return m ? ox.decodeEntities(m[1] ?? m[2] ?? '') : null;
}

/** Remove self-closing elements `name` for which `drop(tagText)` is true */
function dropTags(xml: string, name: string, drop: (tagText: string) => boolean): string {
  const re = new RegExp(`<${name}\\b[^>]*?(?:/>|>\\s*</${name}>)`, 'g');
  return xml.replace(re, (t) => (drop(t) ? '' : t));
}

/**
 * Remove parts and all references to them (content types override, relationships, ODF manifest).
 * `.rels` files that belong to removed parts are removed too.
 */
export function removeParts(pkg: Pkg, names: Iterable<string>): void {
  const gone = new Set<string>();
  for (const n of names) {
    if (!pkg.has(n)) continue;
    gone.add(lc(n));
    pkg.drop(n);
    const slash = n.lastIndexOf('/');
    const rels = `${n.slice(0, slash + 1)}_rels/${n.slice(slash + 1)}.rels`;
    if (pkg.has(rels)) {
      gone.add(lc(rels));
      pkg.drop(rels);
    }
  }
  if (!gone.size) return;
  const ct = pkg.text('[Content_Types].xml');
  if (ct !== null) {
    pkg.setText('[Content_Types].xml', dropTags(ct, 'Override', (t) => gone.has(lc((attr(t, 'PartName') ?? '').replace(/^\//, '')))));
  }
  for (const r of pkg.names().filter((x) => x.endsWith('.rels'))) {
    const xml = pkg.tryText(r);
    if (xml === null) continue;
    pkg.setText(
      r,
      dropTags(xml, 'Relationship', (t) => attr(t, 'TargetMode') !== 'External' && gone.has(lc(resolveTarget(r, attr(t, 'Target') ?? '')))),
    );
  }
  const mf = pkg.text('META-INF/manifest.xml');
  if (mf !== null) {
    pkg.setText(
      'META-INF/manifest.xml',
      dropTags(mf, 'manifest:file-entry', (t) => {
        const p = lc(attr(t, 'manifest:full-path') ?? '');
        if (gone.has(p)) return true;
        // Directory entry (`Thumbnails/`) if nothing is left in it
        return p.endsWith('/') && [...gone].some((g) => g.startsWith(p)) && !pkg.names().some((x) => lc(x).startsWith(p));
      }),
    );
  }
}

/**
 * Remove relationships of a part whose Id no longer occurs in the part (after removing
 * elements with `r:id`). Internal targets of these relationships are removed too.
 */
function pruneRels(pkg: Pkg, part: string): number {
  const slash = part.lastIndexOf('/');
  const relsName = `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
  const rels = pkg.text(relsName);
  const xml = pkg.text(part);
  if (rels === null || xml === null) return 0;
  const orphans: string[] = [];
  let n = 0;
  const kept = dropTags(rels, 'Relationship', (t) => {
    const id = attr(t, 'Id') ?? '';
    if (new RegExp(`=\\s*["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(xml)) return false;
    if (attr(t, 'TargetMode') !== 'External') orphans.push(resolveTarget(relsName, attr(t, 'Target') ?? ''));
    n++;
    return true;
  });
  pkg.setText(relsName, kept);
  removeParts(pkg, orphans.filter((o) => pkg.has(o)));
  return n;
}

// ---------------------------------------------------------------- Cleanup per format

const CORE_PERSONAL = [
  'dc:creator',
  'cp:lastModifiedBy',
  'cp:category',
  'cp:contentStatus',
  'dc:identifier',
  'cp:lastPrinted',
  'cp:revision',
  'cp:version',
  'dcterms:created',
  'dcterms:modified',
];
const ODF_META_PERSONAL = [
  'meta:initial-creator',
  'dc:creator',
  'meta:printed-by',
  'meta:print-date',
  'meta:creation-date',
  'dc:date',
  'meta:editing-cycles',
  'meta:editing-duration',
  'meta:template',
  'meta:user-defined',
];

/** Cleans the package before replacing (order: remove first, then replace). */
export function sanitizePackage(pkg: Pkg, kind: FormatKind, report: Report): void {
  if (kind === 'odf') return sanitizeOdf(pkg, report);
  const names = pkg.names();

  // Thumbnail of the first page
  const thumbs = names.filter((n) => /^docProps\/thumbnail\.[^/]+$/i.test(n));
  if (thumbs.length) {
    removeParts(pkg, thumbs);
    note(report.removed, 'Thumbnail image (preview of the first page)');
  }
  if (pkg.has('docProps/custom.xml')) {
    removeParts(pkg, ['docProps/custom.xml']);
    note(report.removed, 'Custom document properties');
  }
  // customXml: SharePoint metadata, bibliography sources, cover page fields, Power Query …
  // Data bound to content controls (w:dataBinding) stays and is only replaced.
  const custom = names.filter((n) => n.startsWith('customXml/'));
  if (custom.length && !hasDataBinding(pkg)) {
    removeParts(pkg, custom);
    note(report.removed, 'Custom XML data (e.g. SharePoint metadata, bibliography sources)');
  }

  const core = pkg.text('docProps/core.xml');
  if (core !== null) {
    const [out, n] = ox.removeElements(core, CORE_PERSONAL);
    if (n) {
      pkg.setText('docProps/core.xml', out);
      note(report.removed, 'Author, last editor, dates, category and status from document properties');
    }
  }
  const app = pkg.text('docProps/app.xml');
  if (app !== null) {
    const [out, n] = ox.mapElementText(app, ['Company', 'Manager', 'HyperlinkBase'], (t) => (t ? '' : null));
    if (n) {
      pkg.setText('docProps/app.xml', out);
      note(report.removed, 'Company, manager and hyperlink base from document properties');
    }
  }

  if (kind === 'docx') sanitizeDocx(pkg, report);
  else if (kind === 'xlsx') sanitizeXlsx(pkg, report);
  else if (kind === 'pptx') sanitizePptx(pkg, report);

  if (pkg.names().some((n) => /(^|\/)vbaProject\.bin$/i.test(n))) note(report.warnings, 'Macros (VBA project) not checked');
}

function hasDataBinding(pkg: Pkg): boolean {
  return pkg.names().some((n) => /^word\/[^/]+\.xml$/.test(n) && (pkg.tryText(n) ?? '').includes('<w:dataBinding'));
}

function setAuthors(pkg: Pkg, part: string, attrs: Record<string, string>, elements?: string[]): boolean {
  const xml = pkg.tryText(part);
  if (xml === null) return false;
  const out = ox.replaceAttrs(xml, (el, a) =>
    a in attrs && (!elements || elements.includes(el)) ? (v) => (v === '' && a !== 'w:initials' ? null : attrs[a]) : null,
  );
  pkg.setText(part, out);
  return out !== xml;
}

function sanitizeDocx(pkg: Pkg, report: Report): void {
  if (pkg.has('word/people.xml')) {
    removeParts(pkg, ['word/people.xml']);
    note(report.removed, 'Co-author list (names and e-mail addresses)');
  }
  const settings = pkg.text('word/settings.xml');
  if (settings !== null) {
    let xml = settings;
    const labels: [string, string][] = [
      ['w:attachedTemplate', 'Attached template path'],
      ['w:mailMerge', 'Mail merge data source'],
      ['w:docVars', 'Document variables'],
    ];
    for (const [el, label] of labels) {
      const [out, n] = ox.removeElements(xml, [el]);
      if (n) note(report.removed, label);
      xml = out;
    }
    pkg.setText('word/settings.xml', xml);
    pruneRels(pkg, 'word/settings.xml');
  }
  let authors = false;
  let tracked = false;
  for (const n of pkg.names()) {
    if (!/^word\/.*\.xml$/.test(n)) continue;
    if (setAuthors(pkg, n, { 'w:author': AUTHOR, 'w:initials': INITIALS })) authors = true;
    if (/^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(n) && /<w:(ins|del|moveFrom|moveTo)\b/.test(pkg.tryText(n) ?? '')) tracked = true;
  }
  if (authors) note(report.removed, 'Author names of comments and tracked changes');
  if (tracked) {
    note(report.warnings, 'Tracked changes are kept: their text is replaced and author names are removed, but deleted text is still in the file');
  }
}

function sanitizeXlsx(pkg: Pkg, report: Report): void {
  let authors = false;
  for (const n of pkg.names()) {
    if (/^xl\/comments[^/]*\.xml$/.test(n)) {
      // `tc={GUID}` links a note to its threaded comment and must stay;
      // keep authors unique (Author, Author 2, …), the list is referenced by index
      const xml = pkg.tryText(n);
      if (xml === null) continue;
      let k2 = 0;
      const [out, k] = ox.mapElementText(xml, ['author'], (t) => {
        if (t.startsWith('tc=')) return null;
        k2++;
        return k2 === 1 ? AUTHOR : `${AUTHOR} ${k2}`;
      });
      pkg.setText(n, out);
      if (k) authors = true;
    } else if (/^xl\/persons\/[^/]+\.xml$/.test(n)) {
      if (setAuthors(pkg, n, { displayName: AUTHOR, userId: AUTHOR, providerId: 'None' }, ['person'])) authors = true;
    }
  }
  if (authors) note(report.removed, 'Comment author names');
  const wb = pkg.text('xl/workbook.xml');
  if (wb !== null) {
    let xml = wb;
    // Absolute save path (C:\Users\<Name>\…)
    xml = xml.replace(/<mc:AlternateContent\b[^>]*>\s*<mc:Choice\b[^>]*>\s*<x15ac:absPath\b[^>]*\/>\s*<\/mc:Choice>\s*<\/mc:AlternateContent>/g, '');
    xml = ox.removeElements(xml, ['x15ac:absPath'])[0];
    if (xml !== wb) note(report.removed, 'File path where the workbook was saved');
    const shared = ox.replaceAttrs(xml, (el, a) => (el === 'fileSharing' && a === 'userName' ? () => AUTHOR : null));
    if (shared !== xml) note(report.removed, 'User name of the write reservation');
    pkg.setText('xl/workbook.xml', shared);
  }
  let refreshed = false;
  for (const n of pkg.names()) {
    if (/^xl\/pivotCache\/pivotCacheDefinition[^/]*\.xml$/.test(n) && setAuthors(pkg, n, { refreshedBy: AUTHOR }, ['pivotCacheDefinition'])) refreshed = true;
  }
  if (refreshed) note(report.removed, 'User name of the last pivot table refresh');
  const names = pkg.names();
  if (names.some((n) => n === 'xl/connections.xml')) note(report.warnings, 'Data connections not checked (may contain server or user names)');
  if (names.some((n) => n.startsWith('xl/revisions/'))) note(report.warnings, 'Shared-workbook change history not checked');
}

function sanitizePptx(pkg: Pkg, report: Report): void {
  let authors = false;
  if (setAuthors(pkg, 'ppt/commentAuthors.xml', { name: AUTHOR, initials: INITIALS }, ['p:cmAuthor'])) authors = true;
  for (const n of pkg.names()) {
    if (/^ppt\/authors\.xml$/.test(n) && setAuthors(pkg, n, { name: AUTHOR, initials: INITIALS, userId: AUTHOR, providerId: 'None' }, ['p188:author'])) {
      authors = true;
    }
  }
  if (authors) note(report.removed, 'Comment author names');
}

function sanitizeOdf(pkg: Pkg, report: Report): void {
  const thumbs = pkg.names().filter((n) => n.startsWith('Thumbnails/'));
  if (thumbs.length) {
    removeParts(pkg, thumbs);
    note(report.removed, 'Thumbnail image (preview of the first page)');
  }
  const meta = pkg.text('meta.xml');
  if (meta !== null) {
    const [out, n] = ox.removeElements(meta, ODF_META_PERSONAL);
    if (n) {
      pkg.setText('meta.xml', out);
      note(report.removed, 'Author, dates, template and custom fields from document properties');
    }
  }
  let authors = false;
  let tracked = false;
  for (const n of pkg.names()) {
    if (!/(^|\/)(content|styles)\.xml$/.test(n)) continue;
    const xml = pkg.tryText(n);
    if (xml === null) continue;
    let [out, k] = ox.mapElementText(xml, ['dc:creator'], (t) => (t === AUTHOR ? null : AUTHOR));
    let k2: number;
    [out, k2] = ox.mapElementText(out, ['meta:creator-initials'], (t) => (t === INITIALS ? null : INITIALS));
    if (k + k2) authors = true;
    if (/<text:changed-region\b/.test(out)) tracked = true;
    pkg.setText(n, out);
  }
  if (authors) note(report.removed, 'Author names of comments and tracked changes');
  if (tracked) {
    note(report.warnings, 'Tracked changes are kept: their text is replaced and author names are removed, but deleted text is still in the file');
  }
  const settings = pkg.text('settings.xml');
  if (settings !== null) {
    const out = settings.replace(
      /(<config:config-item\b[^>]*config:name="(?:PrinterName|PrinterSetup)"[^>]*>)([^<]+)(<\/config:config-item>)/g,
      '$1$3',
    );
    if (out !== settings) {
      pkg.setText('settings.xml', out);
      note(report.removed, 'Printer name and settings');
    }
  }
}

// ---------------------------------------------------------------- Images

const IMAGE_EXT = /\.(png|jpe?g|jfif|gif|bmp|tiff?|emf|wmf|emz|wmz|svg|webp|wdp|hdp|jxr|ico|pict?)$/i;

export const isImage = (name: string) => IMAGE_EXT.test(name);

/**
 * Remove metadata from a JPEG (APP1 Exif/XMP, APP13 IPTC, COM). An EXIF orientation != 1
 * is kept as a minimal Exif block so the image does not appear rotated.
 * Returns `null` if there is nothing to remove or the structure is unexpected.
 */
export function stripJpegMetadata(b: Uint8Array): Uint8Array | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const keep: Uint8Array[] = [b.subarray(0, 2)];
  let p = 2;
  let removed = false;
  let orientation = 1;
  while (p < b.length) {
    if (b[p] !== 0xff) return null;
    let q = p + 1;
    while (q < b.length && b[q] === 0xff) q++;
    if (q >= b.length) return null;
    const m = b[q];
    if (m === 0xda || m === 0xd9) {
      keep.push(b.subarray(p));
      break;
    }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      keep.push(b.subarray(p, q + 1));
      p = q + 1;
      continue;
    }
    if (q + 2 >= b.length) return null;
    const len = (b[q + 1] << 8) | b[q + 2];
    const end = q + 1 + len;
    if (len < 2 || end > b.length) return null;
    if (m === 0xe1 || m === 0xed || m === 0xfe) {
      removed = true;
      if (m === 0xe1) orientation = exifOrientation(b.subarray(q + 3, end)) ?? orientation;
    } else keep.push(b.subarray(p, end));
    p = end;
  }
  if (!removed) return null;
  if (orientation !== 1) keep.splice(1, 0, minimalExif(orientation));
  const total = keep.reduce((s, k) => s + k.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const k of keep) {
    out.set(k, o);
    o += k.length;
  }
  return out;
}

/** Orientation (tag 0x0112) from an APP1 Exif block */
function exifOrientation(seg: Uint8Array): number | null {
  if (seg.length < 14 || String.fromCharCode(...seg.subarray(0, 4)) !== 'Exif') return null;
  const t = seg.subarray(6);
  const le = t[0] === 0x49;
  const u16 = (i: number) => (le ? t[i] | (t[i + 1] << 8) : (t[i] << 8) | t[i + 1]);
  const u32 = (i: number) => (le ? (t[i] | (t[i + 1] << 8) | (t[i + 2] << 16)) + t[i + 3] * 0x1000000 : t[i] * 0x1000000 + ((t[i + 1] << 16) | (t[i + 2] << 8) | t[i + 3]));
  const ifd = u32(4);
  if (ifd + 2 > t.length) return null;
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > t.length) return null;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** APP1 segment that only holds the orientation (big endian) */
function minimalExif(orientation: number): Uint8Array {
  // "Exif\0\0" + TIFF header (8) + IFD: count (2) + 1 entry (12) + next IFD (4)
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
  const len = body.length + 2;
  return new Uint8Array([0xff, 0xe1, len >> 8, len & 0xff, ...body]);
}
