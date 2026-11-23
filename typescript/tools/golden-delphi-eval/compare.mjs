// Compares the Delphi expression evaluator (golden-delphi-eval) with the C# one (golden-cs eval).
//
//   node compare.mjs fixtures <culture> <outdir>
//     The cases of the fixtures of @reportman/engine (test/fixtures/eval-cases.json plus the
//     "extra" cases of the culture). C# is the golden file of the culture; Delphi runs with TODAY
//     pinned to the day the golden file was generated on.
//   node compare.mjs cases <culture> <outdir> <cases.json>
//     Any cases ([{expr, format?}]): both engines run now, with the clock of the computer.
//
// Writes in <outdir>: delphi.<name>.<culture>.json, cs.<name>.<culture>.json and
// diffs.<name>.<culture>.json (the differences: {i, expr, format, kind, delphi, cs}), and prints
// the counts. A value is the same when both engines fail, or both give the same type family and
// value: numbers as numbers (relative 1e-12), texts exactly, dates to the second (C# writes a date
// in the format of the culture, which is parsed here for en-US, es-ES and de-DE).
// The formatted texts (cases with "format") are counted apart, kind "format": the display formats
// are another comparison.
//
// Run build.bat first (golden-delphi-eval) and build tools/golden-cs (Release). The clock: a run
// with "cases" must not cross midnight, and the cases should not depend on NOW or TIME beyond a
// comparison. probes.mjs writes the cases of the comparison of 23-11-2026 beyond the fixtures.
//
// REPORTMAN_DELPHI_EVAL: the executable of golden-delphi-eval (default: bin_x86 beside this file).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoTools = path.resolve(here, '..');
const delphiExe = process.env.REPORTMAN_DELPHI_EVAL ?? path.join(here, 'bin_x86/golden-delphi-eval.exe');
const csExe = path.join(repoTools, 'golden-cs/bin/Release/net10.0/golden-cs.exe');
const fixtures = path.join(repoTools, '../packages/reportman-engine/test/fixtures');

const [mode, culture, outDir, casesFile] = process.argv.slice(2);
if (!['fixtures', 'cases'].includes(mode) || !culture || !outDir || (mode === 'cases' && !casesFile)) {
  console.error('node compare.mjs fixtures <culture> <outdir> | cases <culture> <outdir> <cases.json>');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const write = (f, v) => fs.writeFileSync(f, JSON.stringify(v));
const row = (r) => (Array.isArray(r) ? r : r.error !== undefined ? ['!', r.error, r.message] : r.formatted !== undefined ? [r.type, r.text, r.formatted] : [r.type, r.text]);
const name = mode === 'fixtures' ? 'fixtures' : path.basename(casesFile).replace(/\.json$/, '');
const tmp = (n) => path.join(outDir, `tmp.${name}.${culture}.${n}.json`);
const runCs = (cases, n) => {
  write(tmp(n + '.in'), cases);
  execFileSync(csExe, ['eval', tmp(n + '.in'), tmp(n + '.out'), '--culture', culture]);
  const r = read(tmp(n + '.out')).map(row);
  fs.rmSync(tmp(n + '.in'));
  fs.rmSync(tmp(n + '.out'));
  return r;
};
const runDelphi = (cases, n, today) => {
  write(tmp(n + '.in'), cases);
  execFileSync(delphiExe, [culture, tmp(n + '.in'), tmp(n + '.out'), ...(today ? ['--today', today] : [])]);
  const r = read(tmp(n + '.out'));
  fs.rmSync(tmp(n + '.in'));
  fs.rmSync(tmp(n + '.out'));
  return r;
};

let cases;
let cs;
let today;
if (mode === 'fixtures') {
  const golden = read(path.join(fixtures, `eval-golden.${culture}.json`));
  cases = [...read(path.join(fixtures, 'eval-cases.json')), ...golden.extra].map(({ expr, format }) => (format === undefined ? { expr } : { expr, format }));
  cs = golden.results;
  today = golden.today;
} else {
  cases = read(casesFile).map(({ expr, format }) => (format === undefined ? { expr } : { expr, format }));
  cs = runCs(cases, 'cs');
}
const delphi = runDelphi(cases, 'delphi', today);
if (delphi.length !== cases.length || cs.length !== cases.length) throw new Error(`lengths: ${cases.length} cases, ${delphi.length} Delphi, ${cs.length} C#`);

// C# gives one error for the evaluation and the format: the cases with a format that fail are
// evaluated again without it (now: a case that depends on TODAY may give the value of another day,
// but it tells an error of the evaluation from an error of the format).
const again = cases.map((c, i) => i).filter((i) => cases[i].format !== undefined && cs[i][0] === '!');
const csValues = runCs(again.map((i) => ({ expr: cases[i].expr })), 'csvalues');
const csValue = new Map(again.map((i, k) => [i, csValues[k]]));

// The C# text of a date is that of the culture, to the second: to milliseconds since 1970 (UTC
// fields), as the ISO text of Delphi
const csDate = (text) => {
  const m = /^(\d+)[\/.](\d+)[\/.](\d+),? (\d+):(\d+):(\d+)\s*([AP]M)?$/.exec(String(text).replace(/ /g, " "));
  if (!m) return NaN;
  const [a1, a2, y, h, n, sec] = m.slice(1, 7).map(Number);
  const [month, day] = culture === "en-US" ? [a1, a2] : [a2, a1];
  const hour = m[7] ? (h % 12) + (m[7] === "PM" ? 12 : 0) : h;
  return new Date(0).setUTCFullYear(y, month - 1, day) + ((hour * 60 + n) * 60 + sec) * 1000;
};
const delphiDate = (text) => {
  const m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+):(\d+)\.(\d+)$/.exec(text);
  if (!m) return NaN;
  const [y, month, day, h, n, sec, ms] = m.slice(1).map(Number);
  return new Date(0).setUTCFullYear(y, month - 1, day) + ((h * 60 + n) * 60 + sec) * 1000 + ms;
};
const decimalSep = { 'en-US': '.' }[culture] ?? ',';
const family = (t) =>
  ({ Integer: 'number', Long: 'number', Double: 'number', Decimal: 'number', Currency: 'number', Smallint: 'number', Int64: 'number', Byte: 'number', Word: 'number',
    LongWord: 'number', ShortInt: 'number', UInt64: 'number', Single: 'number', Bcd: 'number', String: 'string', Boolean: 'boolean', DateTime: 'date', Null: 'null',
    Empty: 'null', Bytes: 'binary', Binary: 'binary' })[t] ?? t;
const csNumber = (text) => {
  const t = String(text);
  if (/∞|infin|unendlich/i.test(t)) return t.startsWith('-') ? -Infinity : Infinity;
  if (/NaN|NeuN|n\. def\.|Nicht|NAN/i.test(t)) return NaN;
  return Number(decimalSep === '.' ? t : t.replace(/\./g, '').replace(',', '.'));
};
const delphiNumber = (text) => (text === 'NAN' ? NaN : text === 'INF' ? Infinity : text === '-INF' ? -Infinity : Number(text));
const sameNumber = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || a === b || Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));

const count = { same: 0, formatSame: 0, formatDiff: 0, formatErrorBoth: 0 };
const diffs = [];
cases.forEach((c, i) => {
  const d = delphi[i];
  const s = csValue.get(i) ?? cs[i];
  const rec = { i, expr: c.expr, format: c.format, delphi: d, cs: cs[i] };
  if (csValue.has(i)) rec.csValue = s;
  if (d[0] === '!' || s[0] === '!') {
    if (d[0] === '!' && s[0] === '!') count.same++;
    else diffs.push({ ...rec, kind: d[0] === '!' ? 'delphi-error' : 'cs-error' });
    return;
  }
  const fd = family(d[0]);
  let ok = fd === family(s[0]);
  let kind = 'type';
  if (ok) {
    kind = 'value';
    if (fd === 'number') ok = sameNumber(delphiNumber(d[1]), csNumber(s[1]));
    else if (fd === 'string') ok = d[1] === s[1];
    else if (fd === 'boolean') ok = d[1].toLowerCase() === String(s[1]).toLowerCase();
    else if (fd === 'date') {
      // C# cuts the text at the second; a clock value (NOW) may differ in the time between both runs
      const diff = delphiDate(d[1]) - csDate(s[1]);
      // A value of C# evaluated again today can not be compared with the pinned day of Delphi
      ok = (diff >= -1 && diff < 1000) || (today !== undefined && csValue.has(i));
      if (Number.isNaN(diff)) rec.note = 'date text not parsed';
    }
  }
  if (!ok) {
    diffs.push({ ...rec, kind });
    return;
  }
  count.same++;
  if (c.format !== undefined) {
    const df = d.length > 3 ? undefined : d[2];
    const sf = cs[i][0] === '!' ? undefined : cs[i][2];
    if (df === undefined && sf === undefined) count.formatErrorBoth++;
    else if (df === sf) count.formatSame++;
    else {
      count.formatDiff++;
      diffs.push({ ...rec, kind: 'format' });
    }
  }
});
const values = diffs.filter((d) => d.kind !== 'format');
console.log(`${name} ${culture}: ${cases.length} cases; the same value (or an error in both) ${count.same}; differ ${values.length}`);
const byKind = {};
for (const d of values) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
console.log('  differences:', JSON.stringify(byKind));
console.log(`  formatted texts of the cases with the same value: ${count.formatSame} the same, ${count.formatDiff} differ, ${count.formatErrorBoth} fail in both`);
write(path.join(outDir, `delphi.${name}.${culture}.json`), delphi);
write(path.join(outDir, `cs.${name}.${culture}.json`), cs);
fs.writeFileSync(path.join(outDir, `diffs.${name}.${culture}.json`), JSON.stringify(diffs, null, 1));
