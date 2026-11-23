// The sample reports of the demo: samples/samples.ini (the list of the designers' welcome window),
// their .rep files and the SQLite database, all downloaded from the demo's own folder.
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import type { FontLibrary } from '@reportman/text';
import { BrowserReport } from './browser-report.js';
import { fontLibraryOf, fontsOf } from './fonts.js';
import { sqlJs } from './sqljs.js';
import type { PdfClock } from '@reportman/pdf';

/** A sample of samples.ini. */
export interface Sample {
  /** The file name without .rep. */
  name: string;
  title: string;
  description: string;
  thumbnail: string | null;
}

/** The samples in the order of samples.ini, with the texts of a language ('en', 'es'...). */
export async function loadSamples(base: string, language: string): Promise<Sample[]> {
  const r = await fetch(base + 'samples/samples.ini');
  if (!r.ok) throw new Error('samples/samples.ini: ' + String(r.status));
  const samples: Sample[] = [];
  let keys: Map<string, string> | null = null;
  let file = '';
  const flush = (): void => {
    if (keys === null || !file.toLowerCase().endsWith('.rep')) return;
    const text = (key: string): string => keys!.get(`${key}.${language}`.toLowerCase()) ?? keys!.get(key.toLowerCase()) ?? '';
    samples.push({
      name: file.slice(0, -4),
      title: text('Title') || file,
      description: text('Description'),
      thumbnail: keys.get('thumbnail') ?? null,
    });
  };
  for (const raw of (await r.text()).split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith(';')) continue;
    const section = /^\[(.+)\]$/.exec(line);
    if (section !== null) {
      flush();
      file = section[1]!;
      keys = new Map();
      continue;
    }
    const k = line.indexOf('=');
    if (k > 0 && keys !== null) keys.set(line.slice(0, k).trim().toLowerCase(), line.slice(k + 1).trim());
  }
  flush();
  return samples;
}

async function bytesOf(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ': ' + String(r.status));
  return new Uint8Array(await r.arrayBuffer());
}

let sqlLoading: Promise<{ SQL: SqlJsStatic; db: Uint8Array }> | undefined;

/** sql.js and the sample database, downloaded the first time a report runs. */
function database(base: string): Promise<{ SQL: SqlJsStatic; db: Uint8Array }> {
  sqlLoading ??= Promise.all([initSqlJs({ locateFile: () => base + 'sql-wasm.wasm' }), bytesOf(base + 'samples/samples.db')]).then(
    ([SQL, db]) => ({ SQL, db }),
  );
  sqlLoading.catch(() => (sqlLoading = undefined));
  return sqlLoading;
}

const reports = new Map<string, Promise<Uint8Array>>();

/**
 * Whether a run failed because the report needs the TrueType fonts: HTML text and text from right
 * to left are laid out with them only (with the standard 14 fonts the engine refuses them).
 */
export function needsTrueType(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return e.name === 'ShaperNotSupportedError' || (e.name === 'NotSupportedYetError' && e.message.startsWith('HTML text'));
}

/** Options of a sample run. */
export interface OpenSampleOptions {
  /** Embed TrueType fonts (the open fonts of the demo); false for the standard 14 PDF fonts. */
  trueType: boolean;
  culture: string;
  clock?: PdfClock;
  /** The font files to use instead of those the report names (the check passes them all). */
  fontFiles?: readonly string[];
}

/** An opened sample, with its fonts (for the preview). */
export interface OpenedSample {
  report: BrowserReport;
  fonts: FontLibrary | undefined;
}

/** Opens a sample with every connection of the report on the sample database. */
export async function openSample(base: string, name: string, options: OpenSampleOptions): Promise<OpenedSample> {
  let bytes = reports.get(name);
  if (bytes === undefined) {
    bytes = bytesOf(`${base}samples/${name}.rep`);
    reports.set(name, bytes);
    bytes.catch(() => reports.delete(name));
  }
  const probe = new BrowserReport(await bytes);
  const [{ SQL, db }, fonts] = await Promise.all([
    database(base),
    options.trueType ? fontLibraryOf(base, options.fontFiles ?? fontsOf(probe.model)) : Promise.resolve(undefined),
  ]);
  const connections: Record<string, ReturnType<typeof sqlJs>> = {};
  for (const info of probe.model.databaseInfo) connections[info.alias] = sqlJs(SQL, db);
  const report = new BrowserReport(await bytes, { connections, culture: options.culture, fonts, clock: options.clock });
  return { report, fonts };
}
