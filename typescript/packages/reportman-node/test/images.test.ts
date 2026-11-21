// Images through the Node.js host: the images of a blob column (fishes.rep without its chart)
// and an image file named by an expression, which is read only with allowFileAccess; the same
// PDF bytes as the C# engine (the fixtures of the engine image parity tests).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openReport, sqlite, type OpenReportOptions } from 'reportman-node';
import { pdfCreation } from '../../reportman-engine/test/golden-run.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const samplesDb = path.resolve(here, '../../../../samples/samples.db');
const fixtures = path.resolve(here, '../../reportman-engine/test/fixtures/images');

function csPdf(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(fixtures, name + '.cs.pdf')));
}

function options(name: string, extra: OpenReportOptions = {}): OpenReportOptions {
  return { connections: { SAMPLES: sqlite(samplesDb) }, clock: pdfCreation(csPdf(name)).clock, ...extra };
}

/** A string as the .rep XML writes it: every character but letters, digits and spaces as #code#. */
function repString(s: string): string {
  return [...s].map((c) => (/[A-Za-z0-9 ]/.test(c) ? c : '#' + String(c.charCodeAt(0)) + '#')).join('');
}

describe('reportman-node: images', () => {
  it('runs fishes.rep without its chart (JPEG images of a blob column) to the same PDF as C#', async () => {
    const report = await openReport(path.join(fixtures, 'img-fishes.rep'), options('img-fishes'));
    const pdf = await report.executeToPdf({}, { compressed: false });
    expect(Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf('img-fishes')))).toBe(0);
  });

  it('reads the image file an expression names only with allowFileAccess', async () => {
    // The report names img-file.png relative to its folder: here, with its absolute path
    const xml = fs
      .readFileSync(path.join(fixtures, 'img-imageop.rep'), 'latin1')
      .replace(repString("'img-file.png'"), repString("'" + path.join(fixtures, 'img-file.png') + "'"));
    const bytes = new Uint8Array(Buffer.from(xml, 'latin1'));
    const closed = await openReport(bytes, options('img-imageop'));
    await expect(closed.executeToPdf({}, { compressed: false })).rejects.toThrow('File not found:');
    const open = await openReport(bytes, options('img-imageop', { allowFileAccess: true }));
    const pdf = await open.executeToPdf({}, { compressed: false });
    expect(Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf('img-imageop')))).toBe(0);
    // A directory is not a file (FileInfo.Exists)
    const dir = await openReport(new Uint8Array(Buffer.from(xml.replace(repString(path.join(fixtures, 'img-file.png')), repString(fixtures)), 'latin1')), options('img-imageop', { allowFileAccess: true }));
    await expect(dir.executeToPdf({}, { compressed: false })).rejects.toThrow('File not found:');
  });
});
