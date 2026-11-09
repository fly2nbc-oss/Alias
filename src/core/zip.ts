/**
 * Read/write ZIP based on the central directory; fflate only for inflate/deflate of single entries.
 *
 * - Entries stay an array in original order (ODF: `mimetype` first, uncompressed).
 * - Reading is lazy: `entry.data` unpacks on first access (getter, cached).
 *   Unknown compression methods and encrypted entries therefore only show up when their
 *   content is actually needed; when writing they are copied raw.
 * - Unchanged entries are copied raw (local header, compressed data and data descriptor, if any,
 *   byte for byte); only the offsets in the central directory are recomputed.
 * - Changed entries (`withData`) are compressed again and keep timestamp, attributes,
 *   extra fields and method 0/8 of the original.
 * - ZIP64 is read; only the classic format is written (Office files > 4 GB: error).
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

export interface ZipEntry {
  readonly name: string;
  /** Content. For read entries unpacked on first access; throws on unknown method,
   *  encryption, damaged data or an exceeded unpack limit. */
  readonly data: Uint8Array;
  /** 0 = stored (e.g. ODF `mimetype`), 8 = deflate; other values only for entries copied raw */
  readonly compression: number;
}

export interface ReadZipOptions {
  /** Maximum total of unpacked bytes over all read entries (zip bomb protection) */
  maxUnpackedBytes?: number;
  /** Maximum size of a single unpacked entry */
  maxEntryBytes?: number;
}

/** Default limit for unpacked data per archive */
export const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;
/** Default limit for one unpacked entry */
export const MAX_ENTRY_BYTES = 50 * 1024 * 1024;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_DESCRIPTOR = 0x08074b50;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;
const U32_MAX = 0xffffffff;

/** Metadata of an entry from the central directory (kept when the entry changes) */
interface Meta {
  versionMadeBy: number;
  versionNeeded: number;
  flags: number;
  method: number;
  /** DOS time/date, copied unchanged */
  time: number;
  date: number;
  crc: number;
  csize: number;
  usize: number;
  nameBytes: Uint8Array;
  centralExtra: Uint8Array;
  localExtra: Uint8Array;
  comment: Uint8Array;
  internalAttr: number;
  externalAttr: number;
}

interface Archive {
  bytes: Uint8Array;
  comment: Uint8Array;
  budget: { used: number; max: number; maxEntry: number };
}

class ArchiveEntry implements ZipEntry {
  readonly name: string;
  readonly compression: number;
  readonly #archive: Archive;
  readonly #meta: Meta;
  /** Start of the compressed data */
  readonly #dataStart: number;
  /** Range of the whole record (local header up to and including the data descriptor) */
  readonly #record: [number, number];
  #data: Uint8Array | null = null;

  constructor(archive: Archive, meta: Meta, name: string, dataStart: number, record: [number, number]) {
    this.name = name;
    this.compression = meta.method;
    this.#archive = archive;
    this.#meta = meta;
    this.#dataStart = dataStart;
    this.#record = record;
  }

  get data(): Uint8Array {
    if (this.#data) return this.#data;
    const m = this.#meta;
    if (m.flags & FLAG_ENCRYPTED) {
      throw new Error(`'${this.name}' is encrypted — password-protected files are not supported`);
    }
    if (m.method !== 0 && m.method !== 8) {
      throw new Error(`'${this.name}' uses an unsupported compression method (${m.method})`);
    }
    const budget = this.#archive.budget;
    if (m.usize > budget.maxEntry) {
      throw new Error(
        `'${this.name}' unpacks to more than ${Math.round(budget.maxEntry / 1024 / 1024)} MB — refusing to open (zip bomb protection)`,
      );
    }
    if (budget.used + m.usize > budget.max) {
      throw new Error(
        `File unpacks to more than ${Math.round(budget.max / 1024 / 1024)} MB of text — refusing to open (zip bomb protection)`,
      );
    }
    budget.used += m.usize;
    const comp = this.#archive.bytes.subarray(this.#dataStart, this.#dataStart + m.csize);
    let out: Uint8Array;
    if (m.method === 0) {
      if (m.csize !== m.usize) throw corrupt(this.name, 'size mismatch');
      out = comp;
    } else if (m.csize === 0) {
      if (m.usize !== 0) throw corrupt(this.name, 'no data');
      out = new Uint8Array(0);
    } else {
      // One spare byte: if the content does not fit the stated size, the length shows it
      // (with a given buffer fflate does not write past its end).
      try {
        out = inflateSync(comp, { out: new Uint8Array(m.usize + 1) });
      } catch (e) {
        throw corrupt(this.name, e instanceof Error ? e.message : String(e));
      }
      if (out.length !== m.usize) throw corrupt(this.name, 'size mismatch');
    }
    if (crc32(out) !== m.crc) throw corrupt(this.name, 'CRC mismatch');
    this.#data = out;
    return out;
  }

  /** internal: raw data for copying unchanged */
  rawRecord(): Uint8Array {
    return this.#archive.bytes.subarray(this.#record[0], this.#record[1]);
  }
  meta(): Meta {
    return this.#meta;
  }
  archive(): Archive {
    return this.#archive;
  }
}

/** Entry with new content, metadata from the original */
class ChangedEntry implements ZipEntry {
  readonly name: string;
  readonly compression: number;
  readonly data: Uint8Array;
  readonly source: ArchiveEntry;
  constructor(source: ArchiveEntry, data: Uint8Array) {
    this.name = source.name;
    this.compression = source.compression === 0 ? 0 : 8;
    this.data = data;
    this.source = source;
  }
}

/**
 * Entry with new content. Name, timestamp, attributes, extra fields and method (0 stays 0,
 * otherwise deflate) come from the original; do not use `{ ...entry, data }` (loses the metadata).
 */
export function withData(entry: ZipEntry, data: Uint8Array): ZipEntry {
  if (entry instanceof ArchiveEntry) return new ChangedEntry(entry, data);
  if (entry instanceof ChangedEntry) return new ChangedEntry(entry.source, data);
  return { name: entry.name, compression: entry.compression, data };
}

const corrupt = (name: string, why: string) => new Error(`Not a valid Office file ('${name}' is damaged: ${why})`);
const invalid = (why: string) => new Error(`Not a valid Office file (${why})`);

// ---------------------------------------------------------------- Reading

/**
 * Read an archive. Returns the entries in original order; content is only unpacked on access
 * to `data`. Throws on damaged archives, OLE files (encrypted/legacy) etc.
 */
export function readZip(bytes: Uint8Array, opts: ReadZipOptions = {}): ZipEntry[] {
  if (bytes.length >= 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((v, i) => bytes[i] === v)) {
    throw new Error(
      'This file is password-protected or in a legacy binary Office format — remove the password or save it as .docx/.xlsx/.pptx first',
    );
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (p: number) => dv.getUint16(p, true);
  const u32 = (p: number) => dv.getUint32(p, true);
  const u64 = (p: number) => {
    const v = u32(p) + u32(p + 4) * 0x100000000;
    if (!Number.isSafeInteger(v)) throw invalid('ZIP64 value out of range');
    return v;
  };
  const len = bytes.length;

  // End of central directory (search backwards, comment up to 64 KB)
  let eocd = -1;
  for (let p = len - 22; p >= Math.max(0, len - 22 - 0xffff); p--) {
    if (u32(p) === SIG_EOCD && p + 22 + u16(p + 20) <= len) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) throw invalid('end of central directory not found');
  let count = u16(eocd + 10);
  let cdSize = u32(eocd + 12);
  let cdOffset = u32(eocd + 16);
  const comment = bytes.slice(eocd + 22, eocd + 22 + u16(eocd + 20));
  if (eocd >= 20 && u32(eocd - 20) === SIG_EOCD64_LOCATOR) {
    const p = u64(eocd - 12);
    if (p + 56 > len || u32(p) !== SIG_EOCD64) throw invalid('ZIP64 end of central directory not found');
    count = u64(p + 32);
    cdSize = u64(p + 40);
    cdOffset = u64(p + 48);
  }
  if (cdOffset + cdSize > len) throw invalid('central directory out of range');

  const archive: Archive = { bytes, comment, budget: {
      used: 0,
      max: opts.maxUnpackedBytes ?? MAX_UNPACKED_BYTES,
      maxEntry: opts.maxEntryBytes ?? MAX_ENTRY_BYTES,
    },
  };
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let k = 0; k < count; k++) {
    if (p + 46 > len || u32(p) !== SIG_CENTRAL) throw invalid('central directory damaged');
    const nlen = u16(p + 28);
    const elen = u16(p + 30);
    const clen = u16(p + 32);
    if (p + 46 + nlen + elen + clen > len) throw invalid('central directory damaged');
    const meta: Meta = {
      versionMadeBy: u16(p + 4),
      versionNeeded: u16(p + 6),
      flags: u16(p + 8),
      method: u16(p + 10),
      time: u16(p + 12),
      date: u16(p + 14),
      crc: u32(p + 16),
      csize: u32(p + 20),
      usize: u32(p + 24),
      nameBytes: bytes.subarray(p + 46, p + 46 + nlen),
      centralExtra: bytes.subarray(p + 46 + nlen, p + 46 + nlen + elen),
      localExtra: new Uint8Array(0),
      comment: bytes.subarray(p + 46 + nlen + elen, p + 46 + nlen + elen + clen),
      internalAttr: u16(p + 36),
      externalAttr: u32(p + 38),
    };
    let offset = u32(p + 42);
    // ZIP64 extra: only the fields that are 0xFFFFFFFF in the header, in fixed order
    if (meta.usize === U32_MAX || meta.csize === U32_MAX || offset === U32_MAX) {
      const z = findExtra(meta.centralExtra, 0x0001);
      if (!z) throw invalid('ZIP64 field missing');
      const zdv = new DataView(z.buffer, z.byteOffset, z.byteLength);
      let q = 0;
      const next = () => {
        if (q + 8 > z.length) throw invalid('ZIP64 field too short');
        const v = zdv.getUint32(q, true) + zdv.getUint32(q + 4, true) * 0x100000000;
        q += 8;
        return v;
      };
      if (meta.usize === U32_MAX) meta.usize = next();
      if (meta.csize === U32_MAX) meta.csize = next();
      if (offset === U32_MAX) offset = next();
    }
    const name = decodeName(meta.nameBytes, meta.flags);

    // Local header: only for its own name/extra length (may differ from the central directory)
    if (offset + 30 > len || u32(offset) !== SIG_LOCAL) throw invalid(`local header of '${name}' not found`);
    const lnlen = u16(offset + 26);
    const lelen = u16(offset + 28);
    meta.localExtra = bytes.subarray(offset + 30 + lnlen, offset + 30 + lnlen + lelen);
    const dataStart = offset + 30 + lnlen + lelen;
    const dataEnd = dataStart + meta.csize;
    if (dataEnd > len) throw invalid(`data of '${name}' out of range`);
    let recordEnd = dataEnd;
    // The flag in the local header counts: that is where the writer decides on the descriptor
    if (u16(offset + 6) & FLAG_DESCRIPTOR) recordEnd += descriptorLength(dv, dataEnd, meta);
    entries.push(new ArchiveEntry(archive, meta, name, dataStart, [offset, recordEnd]));
    p += 46 + nlen + elen + clen;
  }
  return entries;
}

/**
 * Length of the data descriptor after the compressed data: with/without signature, 32/64-bit sizes.
 * Recognized by CRC and compressed size from the central directory (so a CRC that happens to look
 * like the signature is not mistaken for it). If nothing fits: no descriptor (0).
 */
function descriptorLength(dv: DataView, at: number, m: Meta): number {
  const fits = (p: number, wide: boolean) => {
    const end = p + 4 + (wide ? 16 : 8);
    if (end > dv.byteLength) return false;
    if (dv.getUint32(p, true) !== m.crc) return false;
    const cs = wide ? dv.getUint32(p + 4, true) + dv.getUint32(p + 8, true) * 0x100000000 : dv.getUint32(p + 4, true);
    return cs === m.csize;
  };
  const sig = at + 4 <= dv.byteLength && dv.getUint32(at, true) === SIG_DESCRIPTOR;
  if (sig && fits(at + 4, false)) return 16;
  if (sig && fits(at + 4, true)) return 24;
  if (fits(at, false)) return 12;
  if (fits(at, true)) return 20;
  return 0;
}

/** Content of the extra field with ID `id` (or null) */
function findExtra(extra: Uint8Array, id: number): Uint8Array | null {
  for (let p = 0; p + 4 <= extra.length; ) {
    const fid = extra[p] | (extra[p + 1] << 8);
    const flen = extra[p + 2] | (extra[p + 3] << 8);
    if (fid === id) return extra.subarray(p + 4, Math.min(extra.length, p + 4 + flen));
    p += 4 + flen;
  }
  return null;
}

/** Extra field without the ZIP64 block (when writing, the values go back into the header) */
function withoutZip64(extra: Uint8Array): Uint8Array {
  if (!findExtra(extra, 0x0001)) return extra;
  const parts: Uint8Array[] = [];
  let p = 0;
  while (p + 4 <= extra.length) {
    const flen = extra[p + 2] | (extra[p + 3] << 8);
    const end = Math.min(extra.length, p + 4 + flen);
    if ((extra[p] | (extra[p + 1] << 8)) !== 0x0001) parts.push(extra.subarray(p, end));
    p = end;
  }
  return concat(parts);
}

const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

/** Decode names: bit 11 = UTF-8, otherwise CP437 (like Rust `zip` and Python `zipfile`) */
function decodeName(b: Uint8Array, flags: number): string {
  if (flags & FLAG_UTF8 || b.every((c) => c < 0x80)) return strFromU8(b);
  let s = '';
  for (const c of b) s += c < 0x80 ? String.fromCharCode(c) : CP437_HIGH[c - 0x80];
  return s;
}

// ---------------------------------------------------------------- Writing

export interface WriteZipOptions {
  /** Archive comment; default: that of the entries' source archive */
  comment?: Uint8Array;
}

/**
 * Write an archive. Unchanged read entries are copied raw, changed ones (`withData`) are
 * compressed again with the original metadata, new entries (`{ name, data, compression }`)
 * get the current timestamp.
 */
export function writeZip(entries: readonly ZipEntry[], opts: WriteZipOptions = {}): Uint8Array {
  interface Part {
    local: Uint8Array[];
    meta: Meta;
    offset: number;
  }
  const parts: Part[] = [];
  let offset = 0;
  let comment = opts.comment;
  for (const e of entries) {
    let part: Part;
    if (e instanceof ArchiveEntry) {
      comment ??= e.archive().comment;
      const m = e.meta();
      part = { local: [e.rawRecord()], meta: { ...m, centralExtra: withoutZip64(m.centralExtra) }, offset };
    } else {
      const src = e instanceof ChangedEntry ? e.source.meta() : null;
      if (e instanceof ChangedEntry) comment ??= e.source.archive().comment;
      const data = e.data;
      const method = e.compression === 0 ? 0 : 8;
      const comp = method === 0 ? data : deflateSync(data, { level: 6 });
      const nameBytes = src ? src.nameBytes : strToU8(e.name);
      const [time, date] = src ? [src.time, src.date] : dosNow();
      const meta: Meta = {
        versionMadeBy: src?.versionMadeBy ?? 20,
        versionNeeded: 20,
        // Encryption/data descriptor/deflate options are dropped, the UTF-8 flag stays
        flags: src ? src.flags & ~(FLAG_ENCRYPTED | 0x0006 | FLAG_DESCRIPTOR) : nameBytes.some((c: number) => c >= 0x80) ? FLAG_UTF8 : 0,
        method,
        time,
        date,
        crc: crc32(data),
        csize: comp.length,
        usize: data.length,
        nameBytes,
        centralExtra: src ? withoutZip64(src.centralExtra) : new Uint8Array(0),
        localExtra: src ? withoutZip64(src.localExtra) : new Uint8Array(0),
        comment: src?.comment ?? new Uint8Array(0),
        internalAttr: src?.internalAttr ?? 0,
        externalAttr: src?.externalAttr ?? 0,
      };
      part = { local: [localHeader(meta), comp], meta, offset };
    }
    parts.push(part);
    for (const b of part.local) offset += b.length;
  }
  comment ??= new Uint8Array(0);

  const central = parts.map((p) => centralHeader(p.meta, p.offset));
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  if (parts.length > 0xffff || offset > U32_MAX || cdSize > U32_MAX) {
    throw new Error('Result is too large for a ZIP file (more than 4 GB or 65,535 entries)');
  }
  const eocd = new Uint8Array(22 + comment.length);
  const dv = new DataView(eocd.buffer);
  dv.setUint32(0, SIG_EOCD, true);
  dv.setUint16(8, parts.length, true);
  dv.setUint16(10, parts.length, true);
  dv.setUint32(12, cdSize, true);
  dv.setUint32(16, offset, true);
  dv.setUint16(20, comment.length, true);
  eocd.set(comment, 22);
  return concat([...parts.flatMap((p) => p.local), ...central, eocd]);
}

function localHeader(m: Meta): Uint8Array {
  const h = new Uint8Array(30 + m.nameBytes.length + m.localExtra.length);
  const dv = new DataView(h.buffer);
  dv.setUint32(0, SIG_LOCAL, true);
  dv.setUint16(4, m.versionNeeded, true);
  dv.setUint16(6, m.flags, true);
  dv.setUint16(8, m.method, true);
  dv.setUint16(10, m.time, true);
  dv.setUint16(12, m.date, true);
  dv.setUint32(14, m.crc, true);
  dv.setUint32(18, m.csize, true);
  dv.setUint32(22, m.usize, true);
  dv.setUint16(26, m.nameBytes.length, true);
  dv.setUint16(28, m.localExtra.length, true);
  h.set(m.nameBytes, 30);
  h.set(m.localExtra, 30 + m.nameBytes.length);
  return h;
}

function centralHeader(m: Meta, offset: number): Uint8Array {
  if (m.csize > U32_MAX - 1 || m.usize > U32_MAX - 1 || offset > U32_MAX - 1) {
    throw new Error('Result is too large for a ZIP file (more than 4 GB)');
  }
  const n = m.nameBytes.length;
  const x = m.centralExtra.length;
  const h = new Uint8Array(46 + n + x + m.comment.length);
  const dv = new DataView(h.buffer);
  dv.setUint32(0, SIG_CENTRAL, true);
  dv.setUint16(4, m.versionMadeBy, true);
  dv.setUint16(6, m.versionNeeded, true);
  dv.setUint16(8, m.flags, true);
  dv.setUint16(10, m.method, true);
  dv.setUint16(12, m.time, true);
  dv.setUint16(14, m.date, true);
  dv.setUint32(16, m.crc, true);
  dv.setUint32(20, m.csize, true);
  dv.setUint32(24, m.usize, true);
  dv.setUint16(28, n, true);
  dv.setUint16(30, x, true);
  dv.setUint16(32, m.comment.length, true);
  dv.setUint16(36, m.internalAttr, true);
  dv.setUint32(38, m.externalAttr, true);
  dv.setUint32(42, offset, true);
  h.set(m.nameBytes, 46);
  h.set(m.centralExtra, 46 + n);
  h.set(m.comment, 46 + n + x);
  return h;
}

function dosNow(): [number, number] {
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time, date];
}

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

let crcTable: Int32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c;
    }
  }
  const t = crcTable;
  let c = -1;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

export const u8ToStr = (d: Uint8Array) => strFromU8(d);
export const strToU8Utf8 = (s: string) => strToU8(s);
