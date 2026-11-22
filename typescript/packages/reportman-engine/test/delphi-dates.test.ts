// The date masks of the reports converted from Delphi: FormatDateTime of Delphi in the TypeScript
// engine and in the C# engine, against Delphi itself (fixtures/delphi-dates.json, written by
// generate-delphi-date-fixtures.mjs: [culture, mask, OLE date, Delphi, C#]).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CultureInfo, RpDateTime } from '@reportman/engine';
import { delphiFormatSettings, formatDateTimeDelphi } from '../src/util/delphidateformat.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'delphi-dates.json'), 'utf8')) as [string, string, number, string, string][];

describe('the date masks of Delphi', () => {
  for (const culture of [...new Set(rows.map((r) => r[0]))]) {
    const of = rows.filter((r) => r[0] === culture);
    it(`give what Delphi gives in ${culture === '' ? 'the invariant culture' : culture} (${of.length} cases)`, () => {
      const settings = delphiFormatSettings(CultureInfo.get(culture));
      const wrong = of
        .map(([, mask, value, delphi]) => ({ mask, value, delphi, ts: formatDateTimeDelphi(RpDateTime.fromOADate(value), mask, settings) }))
        .filter((c) => c.ts !== c.delphi);
      expect(wrong).toEqual([]);
    });
  }

  it('give what Delphi gives in the C# engine too', () => {
    expect(rows.filter((r) => r[3] !== r[4])).toEqual([]);
  });

  it('take the settings of the language of a neutral culture', () => {
    expect(delphiFormatSettings({ name: 'ca' } as CultureInfo)).toBe(delphiFormatSettings(CultureInfo.get('ca-ES')));
  });
});
