// The data host contract: placeholders, asynchronous hosts, rows given by the host
// (DataViewOverride), the implicit transactions, and what is not supported yet.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DatabaseInfo, DataInfo, DriverType, LabelItem, Report, readReportXml, Section, SectionType, SubReport, ExpressionItem } from 'reportman-lib';
import { PdfDevice } from 'reportman-pdf';
import {
  NotSupportedYetError,
  prepareReport,
  rewriteNamedParameters,
  RpDateTime,
  type ConnectionRequest,
  type DataConnection,
  type DataHost,
  type QueryCommand,
} from 'reportman-engine';
import { sqliteHost } from './sqlite-host.js';
import { here, metaFileJson, pdfCreation, runFixtures, samplesDb } from './golden-run.js';

describe('rewriteNamedParameters', () => {
  it('rewrites :NAME, @NAME and $NAME outside literals, identifiers and comments', () => {
    const sql =
      "SELECT ':X', \"a:b\", [c:d], `e:f` FROM T WHERE A = :FIRST AND B = @SECOND_2 -- :NOT\n" +
      "AND C::int = $THIRD /* @NOT */ AND D = @@ROWCOUNT AND E = 'it''s :NOT' AND F = :FIRST";
    const r = rewriteNamedParameters(sql, (p, i) => '$' + String(i + 1));
    expect(r.sql).toBe(
      "SELECT ':X', \"a:b\", [c:d], `e:f` FROM T WHERE A = $1 AND B = $2 -- :NOT\n" +
        "AND C::int = $3 /* @NOT */ AND D = @@ROWCOUNT AND E = 'it''s :NOT' AND F = $4",
    );
    expect(r.placeholders.map((p) => p.prefix + p.name)).toEqual([':FIRST', '@SECOND_2', '$THIRD', ':FIRST']);
  });
});

/** The sqlite host answering with promises. */
function asyncHost(file: string): DataHost & { log: ReturnType<typeof sqliteHost>['log'] } {
  const inner = sqliteHost(file);
  return {
    log: inner.log,
    async connect(request: ConnectionRequest): Promise<DataConnection> {
      const c = inner.connect(request) as DataConnection;
      return {
        query: async (command: QueryCommand) => c.query(command),
        close: async (commit: boolean) => c.close(commit),
      };
    },
  };
}

describe('data hosts', () => {
  it('runs a report with a host that answers asynchronously, as with one that answers at once', async () => {
    const csPdf = new Uint8Array(fs.readFileSync(path.join(runFixtures, 'invoices.cs.pdf')));
    const { now } = pdfCreation(csPdf);
    const model = readReportXml(new Uint8Array(fs.readFileSync(path.resolve(here, '../../../../samples/invoices.rep'))));
    const host = asyncHost(samplesDb);
    const run = await prepareReport(model, { device: new PdfDevice(), data: host, host: { now: () => now, fileExists: () => false } });
    const meta = await run.execute();
    const cs = JSON.parse(fs.readFileSync(path.join(runFixtures, 'invoices.meta.json'), 'utf8')) as unknown;
    expect(metaFileJson(meta)).toEqual(cs);
    // One connection, its implicit transaction committed at the end
    expect(host.log.connects).toEqual(['SAMPLES']);
    expect(host.log.closes).toEqual([{ alias: 'SAMPLES', commit: true }]);
    // The SQL keeps its :NAME placeholders; the parameters arrive by alias
    expect(host.log.queries[0]!.sql).toContain(':FIRST_ORDER');
    expect(Object.keys(host.log.queries[0]!.parameters)).toEqual(['FIRST_ORDER', 'LAST_ORDER']);
  });

  it('cannot open a dataset from inside an expression with an asynchronous host', async () => {
    const model = readReportXml(new Uint8Array(fs.readFileSync(path.join(runFixtures, 'syn-ondemand.rep'))));
    const run = await prepareReport(model, { device: new PdfDevice(), data: asyncHost(samplesDb) });
    await expect(run.execute()).rejects.toThrow(/needs the data while an expression is being evaluated/);
  });

  it('closes the connections when the report fails', async () => {
    const model = readReportXml(new Uint8Array(fs.readFileSync(path.join(runFixtures, 'syn-error.rep'))));
    const host = sqliteHost(samplesDb);
    const run = await prepareReport(model, { device: new PdfDevice(), data: host });
    await expect(run.execute()).rejects.toThrow(/Unknown identifier: ORD.NOFIELD/);
    expect(host.log.closes).toEqual([{ alias: 'SAMPLES', commit: true }]);
  });

  it('fails clearly without a data host', async () => {
    const model = readReportXml(new Uint8Array(fs.readFileSync(path.join(runFixtures, 'syn-error.rep'))));
    const run = await prepareReport(model, { device: new PdfDevice() });
    await expect(run.execute()).rejects.toThrow('No data host: the report connection SAMPLES cannot be opened');
  });
});

/** A report with one dataset PEOPLE printed in a detail section. */
function peopleReport(dataSource = ''): Report {
  const report = new Report();
  const db = new DatabaseInfo();
  db.alias = 'API';
  db.name = 'TRPDATABASEINFOITEM1';
  db.driver = DriverType.DotNet2;
  report.databaseInfo.push(db);
  const master = new DataInfo();
  master.alias = 'MASTER';
  master.name = 'TRPDATAINFOITEM1';
  master.databaseAlias = 'API';
  report.dataInfo.push(master);
  const people = new DataInfo();
  people.alias = 'PEOPLE';
  people.name = 'TRPDATAINFOITEM2';
  people.databaseAlias = 'API';
  people.dataSource = dataSource;
  report.dataInfo.push(people);
  const sub = new SubReport();
  sub.name = 'TRPSUBREPORT1';
  sub.alias = 'PEOPLE';
  const sec = new Section();
  sec.name = 'TRPSECTION1';
  sec.sectionType = SectionType.Detail;
  sec.subReportName = 'TRPSUBREPORT1';
  sec.height = 300;
  const name = new ExpressionItem();
  name.name = 'TRPEXPRESSION1';
  name.expression = "PEOPLE.NAME+' '+STR(PEOPLE.AGE+1)";
  name.width = 4000;
  const title = new LabelItem();
  title.name = 'TRPLABEL1';
  title.allStrings = ['Person'];
  title.posX = 4500;
  sec.components.push(name, title);
  sub.sections.push(sec);
  report.subReports.push(sub);
  return report;
}

/** A host that gives the rows of the datasets itself (a REST API), with a connection that does nothing. */
function restHost(): DataHost {
  return {
    connect: () => ({
      query: () => {
        throw new Error('no SQL here');
      },
      close: () => undefined,
    }),
    datasetRows: ({ alias }) =>
      alias === 'PEOPLE'
        ? {
            columns: [
              { name: 'NAME', type: 'String' },
              { name: 'AGE', type: 'Int32' },
            ],
            rows: [
              ['Ann', 30],
              ['Bob', 41],
            ],
          }
        : { columns: [{ name: 'ID', type: 'Int64' }], rows: [[1n]] },
  };
}

describe('rows given by the host (DataViewOverride)', () => {
  it('prints the rows the host gives', async () => {
    const run = await prepareReport(peopleReport(), { device: new PdfDevice(), data: restHost() });
    const meta = await run.execute();
    const page = meta.pages.get(0);
    const texts = page.objects.map((o) => page.getText(o as never));
    expect(texts).toEqual(['Ann 31', 'Person', 'Bob 42', 'Person']);
  });

  it('with a master dataset is not supported yet', async () => {
    const run = await prepareReport(peopleReport('MASTER'), { device: new PdfDevice(), data: restHost() });
    await expect(run.execute()).rejects.toBeInstanceOf(NotSupportedYetError);
  });
});

describe('not supported yet', () => {
  it('fails clearly for in-memory unions of datasets (Mybase)', async () => {
    const report = peopleReport();
    report.databaseInfo[0]!.driver = DriverType.Mybase;
    report.dataInfo[1]!.dataUnions = ['MASTER'];
    const run = await prepareReport(report, { device: new PdfDevice(), data: { connect: () => ({ query: () => ({ columns: [], rows: [] }), close: () => undefined }) } });
    await expect(run.execute()).rejects.toThrow(/Mybase DataUnions/);
  });

  // product-catalog (barcodes) runs: barcode-parity.test.ts; fishes (images) runs:
  // image-parity.test.ts (img-fishes, without its chart); monthly-sales, sales-by-category and
  // fishes with its chart run: chart-parity.test.ts
  it.each(['letter'])(
    'fails clearly for the sample %s (HTML text)',
    async (name) => {
      const model = readReportXml(new Uint8Array(fs.readFileSync(path.resolve(here, '../../../../samples/' + name + '.rep'))));
      const run = await prepareReport(model, {
        device: new PdfDevice(),
        data: sqliteHost(samplesDb),
        host: { now: () => RpDateTime.create(2026, 1, 1), fileExists: () => false },
      });
      await expect(run.execute()).rejects.toThrow(/is not supported yet by the TypeScript report engine/);
    },
  );
});
