// Port of Reportman.Drawing.PrintOutCSV: the texts of a metafile as CSV. Each distinct left of
// the objects (divided by the precision, in twips) is a column of every page, each distinct top
// of a text a row of its page; a page ends with an empty line.

import { type MetaFile, MetaObjectType, type MetaObjectText, type MetaPage } from '@reportman/metafile';

/** Options of metafileToCsv. */
export interface CsvOptions {
  /** The pages, 1-based and inclusive; all of them by default. */
  fromPage?: number;
  toPage?: number;
  /** The field separator (',' by default). */
  separator?: string;
  /** The text qualifier ('"' by default); a qualifier inside a value is doubled. */
  delimiter?: string;
  /** The grid, in twips, that groups objects in columns and rows (10 by default). */
  precision?: number;
  /** The line ending (Environment.NewLine of C#: '\r\n' on Windows, '\n' elsewhere; '\r\n' by default). */
  newLine?: string;
}

/** StringUtil.CustomQuoteStr: the value between qualifiers, each qualifier inside doubled. */
function quote(value: string, q: string): string {
  return q + value.split(q).join(q + q) + q;
}

/** (int / int).ToString("0000000000") as a key: the integer division of C# truncates. */
const cell = (twips: number, precision: number): number => Math.trunc(twips / precision);

/** PrintOutCSV.ExportToCSV. */
export function metafileToCsv(meta: MetaFile, options: CsvOptions = {}): string {
  const separator = options.separator ?? ',';
  const delimiter = options.delimiter ?? '"';
  const precision = options.precision ?? 10;
  const newLine = options.newLine ?? '\r\n';
  const count = meta.pages.currentCount;
  let first = 0;
  let last = count - 1;
  if (options.fromPage !== undefined || options.toPage !== undefined) {
    first = (options.fromPage ?? 1) - 1;
    last = Math.min((options.toPage ?? count) - 1, count - 1);
  }
  const pages: MetaPage[] = [];
  for (let i = first; i <= last; i++) pages.push(meta.pages.get(i));
  // The columns of all the pages (the left of every object)
  const columnKeys = new Set<number>();
  for (const page of pages) for (const obj of page.objects) columnKeys.add(cell(obj.left, precision));
  const columns = [...columnKeys].sort((a, b) => a - b);
  const columnIndex = new Map(columns.map((k, i) => [k, i]));
  let out = '';
  for (const page of pages) {
    const rowKeys = new Set<number>();
    for (const obj of page.objects) if (obj.metaType === MetaObjectType.Text) rowKeys.add(cell(obj.top, precision));
    const rows = [...rowKeys].sort((a, b) => a - b);
    const rowIndex = new Map(rows.map((k, i) => [k, i]));
    // (filled, not sparse: map skips the holes of a sparse array)
    const matrix: (string | undefined)[][] = rows.map(() => new Array<string | undefined>(columns.length).fill(undefined));
    for (const obj of page.objects) {
      if (obj.metaType !== MetaObjectType.Text) continue;
      // A later text in the same cell replaces the earlier one
      matrix[rowIndex.get(cell(obj.top, precision))!]![columnIndex.get(cell(obj.left, precision))!] = page.getText(obj as MetaObjectText);
    }
    for (const row of matrix) {
      out += row.map((v) => quote(v ?? '', delimiter)).join(separator) + newLine;
    }
    // A page ends with an empty line
    out += newLine;
  }
  return out;
}
