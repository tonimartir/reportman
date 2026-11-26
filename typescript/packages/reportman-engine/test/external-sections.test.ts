// External sections (Report files sharing sections), compatibility only, as the C# engine: a
// section whose items Delphi loads from a file or a database prints the items the .rep carries (the
// copy the Delphi designer saves with it), nothing is opened, nothing fails, and the six properties
// are written again as they were read. Only the Delphi engine loads them (26-11-2026).

import { describe, expect, it } from 'vitest';
import { readReportXml, writeReportXmlBytes } from '@reportman/lib';
import { PdfDevice } from '@reportman/pdf';
import { prepareReport } from '@reportman/engine';
import { addLabel, detailOf, newReport } from './build-report.js';

const EXTERNAL = {
  // A path Delphi evaluates when the report runs, with a parameter the report does not have
  externalFilename: "@'shared/header-'+M.COMPANY+'.rep'",
  externalConnection: 'SHARED_SECTIONS',
  externalTable: 'REPMAN_REPORTS',
  externalField: 'REPORT',
  externalSearchField: 'REPORT_NAME',
  externalSearchValue: 'HEADER',
};

function reportWithExternalSection() {
  const report = newReport({ width: 8000, height: 3000 });
  const section = detailOf(report);
  section.height = 1500;
  Object.assign(section, EXTERNAL);
  addLabel(section, 'The copy the report carries', { posX: 200, posY: 200, width: 6000, height: 400 });
  return report;
}

describe('an external section', () => {
  it('prints the items the .rep carries, opening no file nor database', async () => {
    const device = new PdfDevice({ compressed: false });
    const run = await prepareReport(reportWithExternalSection(), { device });
    device.print(await run.execute());
    const pdf = Buffer.from(device.pdfBytes).toString('latin1');
    expect(pdf).toContain('(The copy the report carries)');
  });

  it('keeps its six properties and its items when the report is written again', () => {
    const read = readReportXml(writeReportXmlBytes(reportWithExternalSection()));
    const section = read.subReports[0]!.sections.find((s) => s.externalFilename !== '')!;
    expect({
      externalFilename: section.externalFilename,
      externalConnection: section.externalConnection,
      externalTable: section.externalTable,
      externalField: section.externalField,
      externalSearchField: section.externalSearchField,
      externalSearchValue: section.externalSearchValue,
    }).toEqual(EXTERNAL);
    expect(section.components).toHaveLength(1);
  });
});
