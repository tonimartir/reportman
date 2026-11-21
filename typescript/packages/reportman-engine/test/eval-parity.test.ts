// Parity of the expression language with the C# engine: every case of fixtures/eval-cases.json
// (plus the per-culture date value checks) is evaluated as golden-cs eval does (a new Evaluator,
// Evaluate, VarType, ToString() and ToString(format, Unknown, true)) and compared with the C#
// output under en-US, es-ES and pt-BR: the same type, text and formatted text, or the same error
// class and message. Regenerate with test/generate-eval-fixtures.mjs.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createContext,
  DateTimeKind,
  Evaluator,
  ParamType,
  RpDateTime,
  VariantType,
  type LocalTimeZone,
} from '@reportman/engine';

interface Case {
  expr: string;
  format?: string;
  tz?: boolean;
}
type Row = [string, string] | [string, string, string];
interface Golden {
  culture: string;
  today: string;
  timeZone: string;
  extra: Case[];
  results: Row[];
}

const read = <T>(name: string): T => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')) as T;
const cases = read<Case[]>('eval-cases.json');

// The host time zone of Node, as .NET's TimeZoneInfo.Local on the same machine.
const hostTimeZone: LocalTimeZone = {
  utcOffsetMinutes: (dt) => -new Date(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second).getTimezoneOffset(),
  utcOffsetMinutesFromUtc: (dt) => -new Date(Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second)).getTimezoneOffset(),
};
const machineTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

// golden-cs writes UTF-8, where a lone surrogate (LEFT of an emoji) becomes U+FFFD: the TypeScript
// text is compared the same way.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const wellFormed = (row: Row): Row => row.map((s) => s.replace(LONE_SURROGATE, '�')) as Row;

function run(c: Case, ctx: ReturnType<typeof createContext>, host: { now: () => RpDateTime; fileExists: () => boolean }): Row {
  try {
    const ev = new Evaluator({ context: ctx, host });
    ev.expression = c.expr;
    const v = ev.evaluate();
    const type = VariantType[v.varType]!;
    const text = v.toString(ctx);
    if (c.format !== undefined) return [type, text, v.toFormatString(ctx, c.format, ParamType.Unknown, true)];
    return [type, text];
  } catch (e) {
    const err = e as { netType?: string; name: string; message: string };
    return ['!', err.netType ?? err.name, err.message];
  }
}

for (const culture of ['en-US', 'es-ES', 'pt-BR', 'de-DE', 'fr-FR']) {
  describe(`expression parity with the C# engine (${culture})`, () => {
    const golden = read<Golden>(`eval-golden.${culture}.json`);
    const [y, m, d] = golden.today.split('-').map(Number) as [number, number, number];
    // TODAY is the generation date; NOW is noon of that date (no case prints NOW).
    const now = () => RpDateTime.create(y, m, d, 12, 0, 0, 0, DateTimeKind.Local);
    const ctx = createContext(culture, { timeZone: hostTimeZone, now });
    const host = { now, fileExists: () => false };
    const all = [...cases, ...golden.extra];
    const sameZone = golden.timeZone === machineTimeZone;

    it('has one golden result per case', () => {
      expect(golden.results.length).toBe(all.length);
    });

    it('gives the same results', () => {
      const differences: string[] = [];
      let compared = 0;
      for (let i = 0; i < all.length; i++) {
        const c = all[i]!;
        if (c.tz && !sameZone) continue;
        compared++;
        const expected = golden.results[i]!;
        const actual = wellFormed(run(c, ctx, host));
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          differences.push(`${JSON.stringify(c)}\n   C#: ${JSON.stringify(expected)}\n   TS: ${JSON.stringify(actual)}`);
        }
      }
      expect(compared).toBeGreaterThan(5000);
      expect(differences.slice(0, 40).join('\n')).toBe('');
    });
  });
}
