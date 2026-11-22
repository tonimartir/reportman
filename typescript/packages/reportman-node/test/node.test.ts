import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  fontDirectories,
  fontFiles,
  fontLibrary,
  openReport,
  sqlite,
  renderParametersForm,
  ParameterException,
  type OpenReportOptions,
} from '@reportman/node';
import { pdfCreation } from '../../reportman-engine/test/golden-run.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../../../samples');
const samplesDb = path.join(samples, 'samples.db');
// The C# PDFs of the engine parity tests (golden-cs run: PrintOutPDFStandard, uncompressed)
const goldenRun = path.resolve(here, '../../reportman-engine/test/fixtures/run');

function csPdf(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(goldenRun, name + '.cs.pdf')));
}

/** The options that reproduce a golden-cs run: SQLite samples, the C# clock. */
function goldenOptions(name: string, extra: OpenReportOptions = {}): OpenReportOptions {
  return { connections: { SAMPLES: sqlite(samplesDb) }, clock: pdfCreation(csPdf(name)).clock, ...extra };
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

describe('reportman-node: the two steps against the C# engine', () => {
  it('runs customers.rep to the same PDF as C#, byte for byte', async () => {
    const report = await openReport(path.join(samples, 'customers.rep'), goldenOptions('customers'));
    const pdf = await report.executeToPdf({}, { compressed: false });
    expect(Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf('customers')))).toBe(0);
  });

  it('runs customers.rep in es-ES to the same PDF as C#', async () => {
    const report = await openReport(path.join(samples, 'customers.rep'), goldenOptions('customers-es', { culture: 'es-ES' }));
    const pdf = await report.executeToPdf(null, { compressed: false });
    expect(Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf('customers-es')))).toBe(0);
  });

  it('runs invoices.rep with its defaults and with a range of orders', async () => {
    const report = await openReport(path.join(samples, 'invoices.rep'), goldenOptions('invoices'));
    const pdf = await report.executeToPdf({}, { compressed: false });
    expect(Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf('invoices')))).toBe(0);

    const ranged = await openReport(path.join(samples, 'invoices.rep'), goldenOptions('invoices-range'));
    const pdf2 = await ranged.executeToPdf({ FIRST_ORDER: 7, LAST_ORDER: 9 }, { compressed: false });
    expect(Buffer.compare(Buffer.from(pdf2), Buffer.from(csPdf('invoices-range')))).toBe(0);
  });

  it('runs labels.rep (detail in columns) to the same PDF as C#', async () => {
    const report = await openReport(path.join(samples, 'labels.rep'), goldenOptions('labels'));
    const pdf = await report.executeToPdf({}, { compressed: false });
    expect(Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf('labels')))).toBe(0);
  });

  it.each([
    ['contacts', 'contacts', 'en-US'],
    ['contacts', 'contacts-es', 'es-ES'],
    ['year-over-year', 'year-over-year', 'en-US'],
    ['year-over-year', 'year-over-year-es', 'es-ES'],
  ])('runs %s.rep (unions of datasets, %s) to the same PDF as C#', async (sample, golden, culture) => {
    const report = await openReport(path.join(samples, sample + '.rep'), goldenOptions(golden, { culture }));
    const pdf = await report.executeToPdf({}, { compressed: false });
    expect(Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf(golden)))).toBe(0);
  });

  it('compresses as the report asks by default', async () => {
    const report = await openReport(path.join(samples, 'customers.rep'), goldenOptions('customers'));
    expect(report.model.pdfCompressed).toBe(true);
    const pdf = await report.executeToPdf();
    expect(latin1(pdf)).toContain('/FlateDecode');
    expect(pdf.length).toBeLessThan(csPdf('customers').length);
  });
});

describe('reportman-node: step 1, the parameters', () => {
  it('describes the parameters of invoices.rep as the .NET server does', async () => {
    const report = await openReport(path.join(samples, 'invoices.rep'), goldenOptions('invoices'));
    const json = await report.describeParametersJson();
    expect(JSON.parse(json)).toEqual([
      {
        name: 'FIRST_ORDER', type: 1, typeName: 'Integer', description: 'From order number', hint: '',
        errorMessage: '', value: 1, allowNulls: false, readOnly: false, freeText: false, editable: true,
        options: [], selected: [], hasSearch: false,
      },
      {
        name: 'LAST_ORDER', type: 1, typeName: 'Integer', description: 'To order number', hint: '',
        errorMessage: '', value: 4, allowNulls: false, readOnly: false, freeText: false, editable: true,
        options: [], selected: [], hasSearch: false,
      },
    ]);
    const described = await report.describeParameters();
    expect(described.map((p) => p.name)).toEqual(['FIRST_ORDER', 'LAST_ORDER']);
  });

  it('rejects a value of the wrong type in step 2, naming the parameter', async () => {
    const report = await openReport(path.join(samples, 'invoices.rep'), goldenOptions('invoices'));
    const error = await report.executeToPdf({ FIRST_ORDER: 'seven' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ParameterException);
    expect((error as ParameterException).parameter).toBe('FIRST_ORDER');
  });

  it('draws a reference HTML form from the description', async () => {
    const report = await openReport(path.join(samples, 'invoices.rep'), goldenOptions('invoices'));
    const html = renderParametersForm(await report.describeParameters(), { action: '/print' });
    expect(html).toContain('<form method="post" action="/print">');
    expect(html).toContain('<label for="rp_FIRST_ORDER">From order number</label>');
    expect(html).toContain('<input type="number" step="1" value="1" id="rp_FIRST_ORDER" name="FIRST_ORDER" required>');
    expect(html).toContain('name="LAST_ORDER"');
  });
});

describe('reportman-node: data sources', () => {
  it('opens only the connections the host gives', async () => {
    const report = await openReport(path.join(samples, 'customers.rep'));
    await expect(report.executeToPdf()).rejects.toThrow(/The connection SAMPLES is not defined/);
  });

  it('prints rows the host gives for a dataset, without any database', async () => {
    const report = await openReport(path.join(samples, 'customers.rep'), {
      datasets: {
        CUST: {
          columns: [
            { name: 'CODE', type: 'String' },
            { name: 'COMPANY_NAME', type: 'String' },
            { name: 'CONTACT_NAME', type: 'String' },
            { name: 'CITY', type: 'String' },
            { name: 'COUNTRY', type: 'String' },
            { name: 'PHONE', type: 'String' },
            { name: 'CUSTOMER_SINCE', type: 'String' },
          ],
          rows: [
            ['C1', 'Blumenau Foods', 'Ana Souza', 'Blumenau', 'Brazil', '+55 47 0000 0000', '2020-01-01'],
            ['C2', 'Porto Alegre Market', 'Rui Lima', 'Porto Alegre', 'Brazil', '+55 51 0000 0000', '2021-06-15'],
          ],
        },
      },
    });
    const pdf = await report.executeToPdf({}, { compressed: false });
    const text = latin1(pdf);
    expect(text).toContain('(Blumenau Foods)');
    expect(text).toContain('(Porto Alegre Market)');
  });

  it('refuses a Delphi DFM report with a clear message', async () => {
    const dfm = new TextEncoder().encode('object TRpReport\n  PageHeight = 8120\nend\n');
    await expect(openReport(dfm)).rejects.toThrow(/Delphi DFM format; save it as XML/);
  });
});

describe('reportman-node: the fonts option', () => {
  it('lists the font folders of each platform, the extra ones first', () => {
    expect(fontDirectories('windows', ['X:/extra'], false)).toEqual(['X:/extra']);
    const mac = fontDirectories('macos', ['/extra']);
    expect(mac[0]).toBe('/extra');
    expect(mac).toContain('/Library/Fonts');
    expect(mac).toContain('/System/Library/Fonts');
  });

  it('finds the font files of a folder as the C# scan does: by kind, each folder before its subfolders', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-fonts-'));
    fs.mkdirSync(path.join(dir, 'sub'));
    for (const name of ['b.ttf', 'a.otf', 'c.ttc', 'notes.txt', path.join('sub', 'd.TTF')]) fs.writeFileSync(path.join(dir, name), '');
    expect(fontFiles([dir]).map((p) => path.relative(dir, p))).toEqual(['b.ttf', path.join('sub', 'd.TTF'), 'c.ttc', 'a.otf']);
  });

  const windowsFonts = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Fonts');
  const arial = ['arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'arialbi.ttf'].map((n) => path.join(windowsFonts, n));
  it.skipIf(!arial.every((p) => fs.existsSync(p)))('runs an HTML report with the fonts of a folder, embedded (the FreeType device)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-fonts-'));
    for (const p of arial) fs.copyFileSync(p, path.join(dir, path.basename(p)));
    const fonts = { systemFolders: false, folders: [dir], platform: 'windows' as const };
    expect(fontLibrary(fonts).keys().length).toBeGreaterThanOrEqual(4);
    const letter = path.join(samples, 'letter.rep');
    // Without fonts HTML text needs the shaper the standard 14 fonts do not have
    const standard = await openReport(letter, { connections: { SAMPLES: sqlite(samplesDb) } });
    await expect(standard.executeToPdf({})).rejects.toThrow(/HTML text .* is not supported yet/);
    const report = await openReport(letter, { connections: { SAMPLES: sqlite(samplesDb) }, fonts });
    const pdf = latin1(await report.executeToPdf({}, { compressed: false }));
    expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+Arial/);
    expect(pdf).toContain('/Subtype /CIDFontType2');
    expect(pdf).toContain('/FontFile2 ');
  });

  // A WOFF font that is in node_modules anyway (Open Sans, Apache 2.0, through tedious)
  const openSansWoff = path.resolve(here, '../../../node_modules/js-md4/doc/fonts/OpenSans-Regular-webfont.woff');
  it.skipIf(!fs.existsSync(openSansWoff))('finds and embeds a WOFF font of a folder', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-woff-'));
    fs.copyFileSync(openSansWoff, path.join(dir, 'OpenSans-Regular.woff'));
    const fonts = { systemFolders: false, folders: [dir], platform: 'windows' as const };
    expect(fontFiles([dir])).toEqual([path.join(dir, 'OpenSans-Regular.woff')]);
    const report = await openReport(path.join(samples, 'customers.rep'), {
      connections: { SAMPLES: sqlite(samplesDb) },
      fonts,
      beforeRun: (m) => {
        m.wFontName = 'Open Sans';
        for (const c of m.components.values()) if ('wFontName' in c) (c as { wFontName: string }).wFontName = 'Open Sans';
      },
    });
    const pdf = latin1(await report.executeToPdf({}, { compressed: false }));
    expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+OpenSans/);
    expect(pdf).toContain('/FontFile2 ');
  });
});

describe('reportman-node: progress and cancellation', () => {
  it('reports the records and pages, and the last call has them all', async () => {
    const report = await openReport(path.join(samples, 'customers.rep'), { connections: { SAMPLES: sqlite(samplesDb) } });
    const calls: [number, number][] = [];
    await report.executeToPdf({}, { onProgress: (records, pages) => calls.push([records, pages]) });
    expect(calls.length).toBeGreaterThan(0);
    const [records, pages] = calls[calls.length - 1]!;
    expect(records).toBeGreaterThan(0);
    expect(pages).toBeGreaterThan(0);
  });

  it('fails with the reason of the signal when it is aborted while running', async () => {
    const report = await openReport(path.join(samples, 'customers.rep'), { connections: { SAMPLES: sqlite(samplesDb) } });
    const controller = new AbortController();
    const reason = new Error('the user closed the page');
    // Aborted on the first progress call, while the records are laid out
    const run = report.executeToPdf({}, { signal: controller.signal, onProgress: () => controller.abort(reason) });
    await expect(run).rejects.toBe(reason);
  });

  it('does not start with a signal that is already aborted', async () => {
    const report = await openReport(path.join(samples, 'customers.rep'), { connections: { SAMPLES: sqlite(samplesDb) } });
    await expect(report.executeToMetafile({}, { signal: AbortSignal.abort() })).rejects.toThrow(/aborted/i);
  });
});
