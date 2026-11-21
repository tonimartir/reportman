// What golden-cs writes and how it reads: its executable, its errors and the cells of golden-cs sql.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const goldenExe = path.resolve(here, '../../../tools/golden-cs/bin/Release/net10.0/golden-cs.exe');

/** The error golden-cs prints: its .NET type and message (without the stack trace, lines in \n). */
export function goldenError(output: string): { error: string; message: string } {
  const text = output.replace(/\r\n/g, '\n');
  const m = /^ERROR ([\w.]+): ([\s\S]*?)(?=\n {3}at |\s*$)/.exec(text);
  if (m === null) return { error: 'unknown', message: text.trim() };
  return { error: m[1]!.split('.').pop()!, message: m[2]! };
}

/** What golden-cs sql writes: the schema and the cells, or the error. */
export interface GoldenSql {
  columns?: { columnName: string; dataType: string; columnSize: number | null; dataTypeName: string | null }[];
  rows?: unknown[][];
  error?: string;
  message?: string;
}
