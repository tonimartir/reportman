// The expression parity of @reportman/engine in a browser: every case of the fixtures evaluated as
// eval-parity.test.ts does it and compared with the C# results; the page prints a summary that
// tools/check-browser.mjs reads.
import { createContext, DateTimeKind, Evaluator, ParamType, RpDateTime, VariantType, type LocalTimeZone } from '@reportman/engine';
import cases from '../../packages/reportman-engine/test/fixtures/eval-cases.json';

interface Case {
  expr: string;
  format?: string;
  tz?: boolean;
}
interface Golden {
  today: string;
  timeZone: string;
  extra: Case[];
  results: string[][];
}
const goldens = import.meta.glob<Golden>('../../packages/reportman-engine/test/fixtures/eval-golden.*.json', { import: 'default' });
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const hostTimeZone: LocalTimeZone = {
  utcOffsetMinutes: (dt) => -new Date(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second).getTimezoneOffset(),
  utcOffsetMinutesFromUtc: (dt) => -new Date(Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second)).getTimezoneOffset(),
};
const machineZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const lines = [navigator.userAgent];
let failures = 0;
for (const [file, load] of Object.entries(goldens).sort()) {
  const culture = /eval-golden\.(.+)\.json$/.exec(file)![1]!;
  const golden = await load();
  const [y, m, d] = golden.today.split('-').map(Number) as [number, number, number];
  const now = () => RpDateTime.create(y, m, d, 12, 0, 0, 0, DateTimeKind.Local);
  const ctx = createContext(culture, { timeZone: hostTimeZone, now });
  const host = { now, fileExists: () => false, fileFunctions: true };
  const all = [...(cases as Case[]), ...golden.extra];
  let compared = 0;
  const diffs: string[] = [];
  for (let i = 0; i < all.length; i++) {
    const c = all[i]!;
    if (c.tz && golden.timeZone !== machineZone) continue;
    compared++;
    let row: string[];
    try {
      const ev = new Evaluator({ context: ctx, host });
      ev.expression = c.expr;
      const v = ev.evaluate();
      row = [VariantType[v.varType]!, v.toString(ctx)];
      if (c.format !== undefined) row.push(v.toFormatString(ctx, c.format, ParamType.Unknown, true));
    } catch (e) {
      const err = e as { netType?: string; name: string; message: string };
      row = ['!', err.netType ?? err.name, err.message];
    }
    row = row.map((s) => s.replace(LONE, '\ufffd'));
    if (JSON.stringify(row) !== JSON.stringify(golden.results[i])) diffs.push(`${c.expr}\n   C#: ${JSON.stringify(golden.results[i])}\n   browser: ${JSON.stringify(row)}`);
  }
  failures += diffs.length;
  lines.push(`${culture}: ${compared} compared, ${diffs.length} different`, ...diffs.slice(0, 5));
}
lines.push(failures === 0 ? 'RESULT: all the same' : `RESULT: ${failures} different`);
document.getElementById('out')!.textContent = lines.join('\n');
// The summary back to tools/check-browser.mjs
await fetch('/__result', { method: 'POST', body: lines.join('\n') });
