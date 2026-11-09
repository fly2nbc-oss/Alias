/** Files -> text (port of parser/*.rs). PDF (pdf.js) and Excel (SheetJS) are loaded on demand,
 *  so they do not slow down the app start. */
import { extensionOf, formatFromExt, isWritable } from './formats';
import { officeExtras } from './office-extras';
import { extractText, ODF, PPTX } from './office-xml';
import { decodeText } from './text-codec';
import { readZip, u8ToStr, type ZipEntry } from './zip';

export interface ParsedFile {
  content: string;
  format: string;
  writable: boolean;
}

export async function parseFile(name: string, bytes: Uint8Array): Promise<ParsedFile> {
  const ext = extensionOf(name);
  const kind = formatFromExt(ext);
  if (!kind) throw new Error(`Unsupported format: .${ext}`);
  let content: string;
  switch (kind) {
    case 'text':
      content = decodeText(bytes)[0];
      break;
    case 'docx':
      content = readDocx(readZip(bytes));
      break;
    case 'pptx':
      content = readPptx(readZip(bytes));
      break;
    case 'odf':
      content = readOdf(readZip(bytes));
      break;
    case 'xlsx':
      content = await readSpreadsheet(bytes);
      content += officeExtras(readZip(bytes), 'xlsx', content);
      break;
    case 'xls':
      content = await readSpreadsheet(bytes);
      break;
    case 'pdf':
      content = await readPdf(bytes);
      break;
  }
  return { content, format: ext, writable: isWritable(kind) };
}

const entry = (zip: ZipEntry[], name: string) => {
  const e = zip.find((z) => z.name === name);
  return e ? u8ToStr(e.data) : null;
};

/** Entries with prefix/suffix, in natural order (slide2 before slide10). */
function namesSorted(zip: ZipEntry[], prefix: string, suffix: string): string[] {
  const num = (n: string) => parseInt(n.slice(prefix.length).replace(/[^0-9]/g, ''), 10) || 0;
  return zip
    .map((z) => z.name)
    .filter((n) => n.startsWith(prefix) && n.endsWith(suffix) && !n.slice(prefix.length).includes('/'))
    .sort((a, b) => num(a) - num(b) || (a < b ? -1 : a > b ? 1 : 0));
}

// ---------------------------------------------------------------- Word

export function readDocx(zip: ZipEntry[]): string {
  const xml = entry(zip, 'word/document.xml');
  if (xml === null) throw new Error("'word/document.xml' not found");
  let output = extractDocxText(xml);
  for (const z of zip) {
    if ((z.name.startsWith('word/header') || z.name.startsWith('word/footer')) && z.name.endsWith('.xml')) {
      const hf = extractDocxText(u8ToStr(z.data)).trim();
      if (hf) output += '\n' + hf;
    }
  }
  output = output.trim();
  return (output + officeExtras(zip, 'docx', output)).trim();
}

/** Paragraphs as lines, table cells tab-separated, `<w:tab>`/`<w:br>` as tab/line break. */
function extractDocxText(xml: string): string {
  let output = '';
  let para = '';
  let cells: string[] = [];
  let inBody = false;
  let inCell = false;
  let inRun = false;
  let inText = false;
  let preserve = false;
  let i = 0;
  const n = xml.length;
  while (i < n) {
    if (xml[i] === '<') {
      i++;
      const closing = xml[i] === '/';
      if (closing) i++;
      const tagStart = i;
      while (i < n && xml[i] !== '>') i++;
      const raw = xml.slice(tagStart, i);
      const selfClosing = raw.endsWith('/');
      if (i < n) i++;
      const name = (raw.trim().split(/\s+/)[0] ?? '').replace(/\/+$/, '');
      if (name === 'w:t' && !closing) preserve = raw.includes('xml:space="preserve"');
      if (!closing && !selfClosing) {
        if (name === 'w:body' || name === 'w:ftr' || name === 'w:hdr') inBody = true;
        else if (name === 'w:tc' && inBody) inCell = true;
        else if (name === 'w:r' && inBody) inRun = true;
        else if (name === 'w:t' && inBody && inRun) inText = true;
      } else if (closing) {
        if (name === 'w:body' || name === 'w:ftr' || name === 'w:hdr') inBody = false;
        else if (!inBody) {
          /* ignore outside the body */
        } else if (name === 'w:tr') {
          if (cells.length) {
            output += cells.join('\t') + '\n';
            cells = [];
          } else if (para) {
            output += para + '\n';
            para = '';
          }
        } else if (name === 'w:tc') {
          cells.push(para.replace(/\n+$/, ''));
          para = '';
          inCell = false;
        } else if (name === 'w:p') {
          if (inCell) {
            if (para) para += '\n';
          } else {
            output += para + '\n';
            para = '';
          }
          inRun = false;
          inText = false;
        } else if (name === 'w:r') {
          inRun = false;
          inText = false;
        } else if (name === 'w:t') {
          inText = false;
        }
      } else if (inBody && inRun) {
        if (name === 'w:tab') para += '\t';
        else if (name === 'w:br') para += '\n';
      }
    } else if (inText) {
      const s = i;
      while (i < n && xml[i] !== '<') i++;
      const decoded = decodeDocxEntities(xml.slice(s, i));
      para += preserve ? decoded : decoded.trim();
    } else {
      i++;
    }
  }
  return cleanOutput(output);
}

function decodeDocxEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#xD;/g, '')
    .replace(/&#xA;/g, '\n');
}

/** At most 2 empty lines in a row. */
function cleanOutput(s: string): string {
  let result = '';
  let blank = 0;
  for (const line of s.split('\n')) {
    if (!line.trim()) {
      blank++;
      if (blank <= 2) result += '\n';
    } else {
      blank = 0;
      result += line + '\n';
    }
  }
  return result;
}

// ---------------------------------------------------------------- PowerPoint / OpenDocument

export function readPptx(zip: ZipEntry[]): string {
  let out = '';
  namesSorted(zip, 'ppt/slides/slide', '.xml').forEach((name, idx) => {
    out += `=== Slide ${idx + 1} ===\n`;
    const xml = entry(zip, name);
    if (xml !== null) out += extractText(xml, PPTX);
    const notes = entry(zip, name.replace('ppt/slides/slide', 'ppt/notesSlides/notesSlide'));
    if (notes !== null) {
      const t = extractText(notes, PPTX);
      if (t.trim()) out += '--- Notes ---\n' + t;
    }
    out += '\n';
  });
  return out + officeExtras(zip, 'pptx', out);
}

export function readOdf(zip: ZipEntry[]): string {
  const xml = entry(zip, 'content.xml');
  if (xml === null) throw new Error('content.xml missing');
  let out = extractText(xml, ODF);
  const styles = entry(zip, 'styles.xml');
  if (styles !== null) {
    const hf = extractText(styles, ODF);
    if (hf.trim()) out += '\n' + hf;
  }
  return out + officeExtras(zip, 'odf', out);
}

// ---------------------------------------------------------------- Excel (xlsx/xlsm/xls)

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }
  return String(v);
}

async function readSpreadsheet(bytes: Uint8Array): Promise<string> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true, UTC: true });
  let out = '';
  for (const sheetName of wb.SheetNames) {
    out += `=== Sheet: ${sheetName} ===\n`;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: true, defval: '', blankrows: false });
    for (const row of rows) {
      const cells = row.map(cellToString);
      if (cells.every((c) => c === '')) continue;
      out += cells.join('\t') + '\n';
    }
    out += '\n';
  }
  return out;
}

// ---------------------------------------------------------------- PDF (text layer only)

/**
 * Runs ES module code (pdf.js worker, inlined) in a Web Worker.
 * Under file:// Chromium refuses module workers from Blob URLs, but classic workers run and may
 * load Blob modules via import(), though only ones they created themselves (the page's Blob URLs
 * count as foreign under origin `null`). Messages that arrive before loading are buffered.
 */
function moduleWorkerFromCode(code: string): Worker {
  const loader = `const q = [], buf = (e) => q.push(e);
self.addEventListener('message', buf);
const src = ${JSON.stringify(code)};
import(URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))).then(() => {
  self.removeEventListener('message', buf);
  for (const e of q) self.dispatchEvent(new MessageEvent('message', { data: e.data, ports: [...e.ports] }));
}, (err) => { setTimeout(() => { throw err; }); });`;
  return new Worker(URL.createObjectURL(new Blob([loader], { type: 'text/javascript' })));
}

async function readPdf(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  if (typeof Worker !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerPort) {
    const workerCode = (await import('pdfjs-dist/build/pdf.worker.min.mjs?raw')).default;
    pdfjs.GlobalWorkerOptions.workerPort = moduleWorkerFromCode(workerCode);
  }
  const task = pdfjs.getDocument({ data: bytes.slice() });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    if (e instanceof Error && e.name === 'PasswordException') throw new Error('PDF is password-protected');
    throw new Error(`PDF: ${e instanceof Error ? e.message : String(e)}`);
  }
  let out = '';
  for (let p = 1; p <= doc.numPages; p++) {
    try {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      let text = '';
      for (const item of tc.items) {
        if (!('str' in item)) continue;
        text += item.str + (item.hasEOL ? '\n' : '');
      }
      out += `=== Page ${p} ===\n${text.trimEnd()}\n\n`;
    } catch (e) {
      out += `=== Page ${p} === (text not readable: ${e instanceof Error ? e.message : String(e)})\n\n`;
    }
  }
  await task.destroy();
  if (out.split('\n').every((l) => !l.trim() || l.startsWith('=== Page'))) {
    throw new Error('PDF contains no text layer (scanned document?)');
  }
  return out;
}

