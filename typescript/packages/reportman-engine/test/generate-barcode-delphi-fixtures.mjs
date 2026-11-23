// What the Delphi engine draws for the bc-delphi-* reports of barcode-cases.json, the reference of
// barcode-delphi.test.ts: golden-delphi (tools/golden-delphi, built with its build.bat; or the one
// GOLDEN_DELPHI names) runs each report and the rectangles of its metafile are kept in
// fixtures/barcode/NAME.delphi.json.gz, a list per page of { label, bars }: the bars of a barcode
// are the rectangles before the label under it, each one [left, top, width, height, color].
//
// A QR item is run with the error correction level that means the same in Delphi (the item's
// ECCLevel is 2 L, 3 M, 4 Q, 5 H in C# and 0 L, 1 M, 2 Q, 3 H in Delphi).
//
//   node test/generate-barcode-delphi-fixtures.mjs [name...]     (from packages/reportman-engine)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const exe = process.env.GOLDEN_DELPHI ?? path.join(root, 'typescript/tools/golden-delphi/bin_x86/golden-delphi.exe');
const out = path.join(here, 'fixtures/barcode');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-barcode-delphi-'));

/** The report with the QR levels of Delphi (latin1: the reports are ASCII, the bytes are kept). */
function delphiReport(file) {
  const src = fs.readFileSync(file, 'latin1').replace(/<COMPONENT>[\s\S]*?<\/COMPONENT>/g, (component) => {
    if (!component.includes('<TYP type="Integer">17</TYP>')) return component;
    return component.replace(/<ECCLEVEL type="Integer">(-?\d+)<\/ECCLEVEL>/, (_, level) => {
      const delphi = { 3: 1, 4: 2, 5: 3 }[level] ?? 0;
      return `<ECCLEVEL type="Integer">${delphi}</ECCLEVEL>`;
    });
  });
  const copy = path.join(work, path.basename(file));
  fs.writeFileSync(copy, src, 'latin1');
  return copy;
}

const cases = JSON.parse(fs.readFileSync(path.join(here, 'barcode-cases.json'), 'utf8')).filter((c) => c.name.startsWith('bc-delphi-'));
const only = process.argv.slice(2);
for (const c of cases) {
  if (only.length > 0 && !only.includes(c.name)) continue;
  const dir = path.join(work, c.name);
  const r = spawnSync(exe, [delphiReport(path.resolve(here, c.report)), dir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(c.name + ': ' + (r.stdout + r.stderr).split(/\r?\n/)[0]);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const pages = meta.pages.map((page) => {
    const groups = [];
    let bars = [];
    for (const o of page.objects) {
      if (o.type === 'text') {
        groups.push({ label: o.text, bars });
        bars = [];
      } else if (o.type === 'draw') bars.push([o.left, o.top, o.width, o.height, o.brushColor]);
    }
    if (bars.length > 0) groups.push({ label: '', bars });
    return groups;
  });
  fs.writeFileSync(path.join(out, c.name + '.delphi.json.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(pages)), { level: 9 }));
  console.log(c.name + ': ' + pages.reduce((n, p) => n + p.length, 0) + ' barcodes, ' + r.stdout.trim());
}
fs.rmSync(work, { recursive: true, force: true });
