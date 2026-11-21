// rep-inventory over the samples of the repository: what it counts, a DFM file listed apart, and
// nothing of the SQL or the connections in its output.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a JavaScript tool of the workspace, without declarations
import { inventory, markdown, reportFiles } from './rep-inventory.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../samples');

type Row = { count: number; reports: number };
type Inventory = {
  reports: { file: string; read: boolean; reason?: string; datasets?: number }[];
  totals: Record<string, Record<string, Row>>;
};

describe('rep-inventory', () => {
  const inv = inventory(reportFiles([samples]), samples) as Inventory;

  it('reads the eleven samples', () => {
    expect(inv.reports.length).toBe(11);
    expect(inv.reports.every((r) => r.read)).toBe(true);
    expect(inv.reports.find((r) => r.file === 'year-over-year.rep')?.datasets).toBe(6);
  });

  it('counts the classes, the unions and the parameters', () => {
    expect(inv.totals['classes']!['TRPCHART']).toEqual({ count: 3, reports: 3 });
    expect(inv.totals['datasetFeatures']!['parallel union']).toEqual({ count: 2, reports: 1 });
    expect(inv.totals['datasetFeatures']!['union']).toEqual({ count: 1, reports: 1 });
    expect(inv.totals['paramTypes']!['Date']!.reports).toBe(1);
    expect(inv.totals['drivers']!['Mybase']).toEqual({ count: 2, reports: 2 });
  });

  it('separates functions, report variables, fields and parameters', () => {
    expect(inv.totals['functions']!['TODAY']!.reports).toBeGreaterThan(1);
    expect(inv.totals['functions']!['STR']!.reports).toBeGreaterThan(1);
    expect(inv.totals['reportVariables']!['PAGE']!.reports).toBeGreaterThan(1);
    expect(inv.totals['fieldsByDataset']!['DIRECTORY']).toBeDefined();
    // a parameter read by its alias, without M.
    expect(inv.totals['paramRefs']!['FIRST_YEAR']!.count).toBe(4);
    expect(Object.keys(inv.totals['unknownFunctions']!)).toEqual([]);
  });

  it('counts the designer defaults as defaults', () => {
    expect(inv.totals['properties']!['TRPSECTION.dpires']).toBeUndefined();
    expect(inv.totals['properties']!['TRPSECTION.externalField']).toBeUndefined();
    expect(inv.totals['properties']!['TRPEXPRESSION.fontSize']!.count).toBeGreaterThan(0);
  });

  it('lists a DFM report apart, and says nothing of the SQL or the connections', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-inventory-'));
    try {
      fs.copyFileSync(path.join(samples, 'customers.rep'), path.join(dir, 'customers.rep'));
      fs.writeFileSync(path.join(dir, 'old.rep'), 'object TRPREPORT\n  PageOrientation = rpOrientationPortrait\nend\n');
      const two = inventory(reportFiles([dir]), dir) as Inventory;
      expect(two.reports.map((r) => [r.file, r.read, r.reason])).toEqual([
        ['customers.rep', true, undefined],
        ['old.rep', false, 'DFM'],
      ]);
      const md = markdown(two) as string;
      expect(md).toContain('`old.rep`: Delphi DFM format: save it as XML from the designer');
      const json = JSON.stringify(two.totals);
      for (const text of [md, json]) {
        expect(text).not.toMatch(/SELECT|FROM CUSTOMERS/i);
        expect(text).not.toMatch(/Data Source|Database=/i);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
