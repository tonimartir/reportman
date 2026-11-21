import { WIN1252_PAIRS } from './win1252-table.js';

let table: Uint8Array | null = null;

function getTable(): Uint8Array {
  if (table === null) {
    const t = new Uint8Array(0x10000).fill(0x3f);
    for (let c = 0; c < 0x80; c++) t[c] = c;
    for (let i = 0; i < WIN1252_PAIRS.length; i += 2) t[WIN1252_PAIRS[i] as number] = WIN1252_PAIRS[i + 1] as number;
    table = t;
  }
  return table;
}

/** The Windows-1252 byte the C# engine writes for a UTF-16 code unit. */
export function win1252Byte(codeUnit: number): number {
  return getTable()[codeUnit & 0xffff] as number;
}

/**
 * A text as Windows-1252 bytes, one character (0-255) per byte (PDFCanvas.UnicodeToWin1252):
 * the .NET 1252 encoder with its best fit fallback, so Ā becomes A, “ becomes 0x93 and what has
 * no equivalent becomes ?. Each UTF-16 code unit gives one byte: a surrogate pair gives ??.
 */
export function unicodeToWin1252(source: string): string {
  const t = getTable();
  let result = '';
  const CHUNK = 8192;
  for (let i = 0; i < source.length; i += CHUNK) {
    const n = Math.min(CHUNK, source.length - i);
    const part = new Array<number>(n);
    for (let k = 0; k < n; k++) part[k] = t[source.charCodeAt(i + k)] as number;
    result += String.fromCharCode(...part);
  }
  return result;
}
