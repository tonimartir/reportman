import { ANSI_UPPER_RUNS } from './ansi-upper-table.js';

let table: Uint16Array | undefined;

/**
 * AnsiUpperCase of Delphi on Windows (CharUpperBuff), the setters of Alias, DatabaseAlias,
 * DataSource and of the parameter names: each UTF-16 code unit on its own, through the casing
 * table of Windows, which is not the one of Unicode (`µ`, `ı`, `ſ`, `ǅ` or Georgian stay as they
 * are; `ß` too, it does not become `SS`). `toUpperCase` of JavaScript gives other letters.
 */
export function ansiUpperCase(s: string): string {
  if (table === undefined) {
    table = new Uint16Array(0x10000);
    for (let c = 0; c < 0x10000; c++) table[c] = c;
    for (let i = 0; i < ANSI_UPPER_RUNS.length; i += 4) {
      const [first, count, delta, step] = ANSI_UPPER_RUNS.slice(i, i + 4) as [number, number, number, number];
      for (let j = 0; j < count; j++) table[first + j * step] = first + j * step + delta;
    }
  }
  let out = '';
  for (let i = 0; i < s.length; i++) out += String.fromCharCode(table[s.charCodeAt(i)]!);
  return out;
}
