/** Read and write text files, keeping the encoding (port of text_codec.rs).
 *  UTF-8 with/without BOM, UTF-16 LE/BE with BOM, else Windows-1252. */

export type TextEncoding = 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'windows1252';

const startsWith = (b: Uint8Array, p: number[]) => p.every((v, i) => b[i] === v);

function decodeUtf16(bytes: Uint8Array, le: boolean): string {
  const units = new Uint16Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < units.length; i++) {
    const a = bytes[2 * i];
    const b = bytes[2 * i + 1];
    units[i] = le ? a | (b << 8) : (a << 8) | b;
  }
  // Lossy like String::from_utf16_lossy (TextDecoder replaces invalid surrogates). The file's BOM
  // is already removed; another U+FEFF at the start belongs to the content (ignoreBOM, as in Rust).
  return new TextDecoder('utf-16le', { ignoreBOM: true }).decode(new Uint8Array(units.buffer));
}

export function decodeText(bytes: Uint8Array): [string, TextEncoding] {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) {
    return [new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.subarray(3)), 'utf8bom'];
  }
  if (startsWith(bytes, [0xff, 0xfe])) return [decodeUtf16(bytes.subarray(2), true), 'utf16le'];
  if (startsWith(bytes, [0xfe, 0xff])) return [decodeUtf16(bytes.subarray(2), false), 'utf16be'];
  try {
    return [new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), 'utf8'];
  } catch {
    return [new TextDecoder('windows-1252').decode(bytes), 'windows1252'];
  }
}

let cp1252: Map<string, number> | null = null;

function cp1252Table(): Map<string, number> {
  if (!cp1252) {
    cp1252 = new Map();
    const dec = new TextDecoder('windows-1252');
    for (let b = 0; b < 256; b++) cp1252.set(dec.decode(new Uint8Array([b])), b);
  }
  return cp1252;
}

function encodeUtf16(text: string, le: boolean): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out.set(le ? [0xff, 0xfe] : [0xfe, 0xff]);
  for (let i = 0; i < text.length; i++) {
    const u = text.charCodeAt(i);
    out[2 + 2 * i] = le ? u & 0xff : u >> 8;
    out[3 + 2 * i] = le ? u >> 8 : u & 0xff;
  }
  return out;
}

export function encodeText(text: string, enc: TextEncoding): Uint8Array {
  switch (enc) {
    case 'utf8':
      return new TextEncoder().encode(text);
    case 'utf8bom': {
      const body = new TextEncoder().encode(text);
      const out = new Uint8Array(body.length + 3);
      out.set([0xef, 0xbb, 0xbf]);
      out.set(body, 3);
      return out;
    }
    case 'utf16le':
      return encodeUtf16(text, true);
    case 'utf16be':
      return encodeUtf16(text, false);
    case 'windows1252': {
      // Characters that cannot be encoded -> numeric entities (like encoding_rs)
      const table = cp1252Table();
      const bytes: number[] = [];
      for (const ch of text) {
        const b = table.get(ch);
        if (b !== undefined) bytes.push(b);
        else for (const c of `&#${ch.codePointAt(0)};`) bytes.push(c.charCodeAt(0));
      }
      return Uint8Array.from(bytes);
    }
  }
}
