// @reportman/dfm against the Delphi engine: for every report of the corpus (test/fixtures, written
// by test/generate-dfm-fixtures.mjs with tools/golden-dfm), the XML of each of its DFM forms must be
// the bytes Delphi writes when it loads that form and saves it as XML (reptotxt -xml); the same for
// the DFM reports as older versions of Delphi saved them.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ansiUpperCase } from '../src/ansi-upper.js';
import { DfmError, delphiFloatToStr, dfmToXml, dfmTreeToXml, isDfm, readDfm, reportForm } from '../src/index.js';
import { corpus, originals } from './corpus.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ascii = (b: Uint8Array): string => Buffer.from(b).toString('latin1');

/** The first line where two XML texts differ, with its neighbours. */
function firstDifference(expected: string, actual: string): string {
  const a = expected.split('\r\n');
  const b = actual.split('\r\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return `line ${i + 1}:\n  Delphi: ${a[i] ?? '(end)'}\n  dfm:    ${b[i] ?? '(end)'}\n  before: ${a[i - 1] ?? ''}`;
  }
  return 'the same';
}

const reports = corpus();

describe('@reportman/dfm: the XML of Delphi, byte for byte', () => {
  for (const group of [...new Set(reports.map((r) => r.group))]) {
    it(`converts the ${group} reports in every DFM form`, () => {
      const problems: string[] = [];
      for (const r of reports.filter((x) => x.group === group)) {
        const expected = ascii(r.xml);
        for (const form of ['text', 'binary', 'zlib'] as const) {
          const bytes = r[form];
          if (bytes === undefined) continue;
          let actual: string;
          try {
            actual = ascii(dfmToXml(bytes));
          } catch (e) {
            problems.push(`${r.name} (${form}): ${(e as Error).message}`);
            continue;
          }
          if (actual !== expected) problems.push(`${r.name} (${form}) ${firstDifference(expected, actual)}`);
        }
      }
      expect(problems.slice(0, 12).join('\n\n')).toBe('');
    });
  }

  it('converts the DFM reports saved by older versions of Delphi', () => {
    const problems: string[] = [];
    for (const o of originals()) {
      const expected = ascii(o.xml);
      try {
        const actual = ascii(dfmToXml(o.dfm));
        if (actual !== expected) problems.push(`${o.name} (${reportForm(o.dfm)}) ${firstDifference(expected, actual)}`);
      } catch (e) {
        problems.push(`${o.name}: ${(e as Error).message}`);
      }
    }
    expect(problems.join('\n\n')).toBe('');
  });
});

describe('@reportman/dfm: the hand-made reports (test/make-dfm-cases.mjs)', () => {
  const cases = path.join(here, 'cases');
  const exists = (name: string): boolean => fs.existsSync(path.join(cases, name));
  const read = (name: string): string => fs.readFileSync(path.join(cases, name)).toString('latin1');
  for (const file of fs.readdirSync(cases).filter((f) => f.endsWith('.rep')).sort()) {
    const name = file.replace(/\.rep$/, '');
    const bytes = new Uint8Array(fs.readFileSync(path.join(cases, file)));
    if (!exists(name + '.error')) {
      it(`converts ${file} as Delphi does`, () => {
        const expected = read(name + '.xml');
        const actual = ascii(dfmToXml(bytes));
        expect(actual === expected ? 'the same' : firstDifference(expected, actual)).toBe('the same');
      });
      continue;
    }
    // What Delphi does not read as a report (cases/<name>.error has its message)
    it(`refuses ${file} as Delphi does (${read(name + '.error').trim()})`, () => {
      expect(() => dfmToXml(bytes)).toThrow(DfmError);
      expect(isDfm(bytes)).toBe(read(name + '.error').startsWith('Invalid stream format') ? false : true);
    });
    // and what ObjectTextToBinary makes of it without the first byte check of LoadFromStream
    if (exists(name + '.text.xml'))
      it(`reads ${file} as ObjectTextToBinary does`, () => {
        const expected = read(name + '.text.xml');
        const actual = ascii(dfmTreeToXml(readDfm(bytes)));
        expect(actual === expected ? 'the same' : firstDifference(expected, actual)).toBe('the same');
      });
    if (exists(name + '.text.error'))
      it(`can not read ${file}, as ObjectTextToBinary (${read(name + '.text.error').trim()})`, () => {
        expect(() => dfmTreeToXml(readDfm(bytes))).toThrow(DfmError);
      });
  }
});

describe('@reportman/dfm: AnsiUpperCase of Delphi', () => {
  it('maps each code unit through the casing table of Windows, not the one of Unicode', () => {
    expect(ansiUpperCase('año_µßıſÿǅǆﬁ')).toBe('AÑO_µßıſŸǅǄﬁ');
    // Georgian and the small Cherokee letters stay; U+1F80 becomes U+1F88 (JavaScript: two letters)
    expect(ansiUpperCase('აᾀꭰ')).toBe('აᾈꭰ');
    expect('აᾀꭰ'.toUpperCase()).toBe('ᲐἈΙᎠ');
    expect('µß'.toUpperCase()).toBe('ΜSS');
  });
});

describe('@reportman/dfm: forms and numbers', () => {
  it('tells the DFM forms from XML', () => {
    const r = reports[0]!;
    expect(reportForm(r.text)).toBe('text');
    expect(reportForm(r.xml)).toBe('xml');
    const withForms = reports.find((x) => x.binary !== undefined)!;
    expect(reportForm(withForms.binary!)).toBe('binary');
    expect(reportForm(withForms.zlib!)).toBe('zlib-binary');
    expect(isDfm(r.text)).toBe(true);
    expect(isDfm(r.xml)).toBe(false);
    expect(isDfm(new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it('writes the doubles as FloatToStr of Delphi (fixtures/floats.json, from Delphi)', () => {
    const floats = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'floats.json'), 'utf8')) as Record<string, string>;
    const wrong: string[] = [];
    for (const [bits, text] of Object.entries(floats)) {
      const value = Buffer.from(bits, 'hex').readDoubleBE();
      if (delphiFloatToStr(value) !== text) wrong.push(`${value}: Delphi ${text}, dfm ${delphiFloatToStr(value)}`);
    }
    expect(wrong).toEqual([]);
    expect(Object.keys(floats).length).toBeGreaterThan(400);
  });
});
