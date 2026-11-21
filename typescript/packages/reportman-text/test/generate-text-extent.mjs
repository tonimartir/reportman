// Generates test/fixtures/text-extent.json: text measurements of the C# engine
// (PrintOutPDFStandard.TextExtentLineInfo and TextExtent through golden-cs text-extent) over a
// deterministic sample of fonts x styles x sizes x wrap widths x alignments x texts.
//
//   node packages/reportman-text/test/generate-text-extent.mjs     (from typescript/)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const golden = path.join(root, 'typescript/tools/golden-cs/bin/Release/net10.0/golden-cs.exe');

const texts = [
  '',
  'A',
  'Hello world',
  'Hello world, this is a test of wrapping text in a narrow box',
  'The quick brown fox jumps over the lazy dog. THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG!',
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  'Supercalifragilisticexpialidocious-and-more-hyphenated-words-to-break',
  'antidisestablishmentarianismantidisestablishmentarianism',
  'two  spaces   three    four     end',
  '   leading spaces',
  'trailing spaces   ',
  '     ',
  'line one\nline two\nline three',
  'windows\r\nline\r\nbreaks\r\n',
  'mac\rcarriage\rreturns',
  '\n\nleading line feeds',
  'trailing line feed\n',
  'tabs\tbetween\twords\t\tdouble',
  'Ñandú, pingüino, acción, über, garçon, smørrebrød, Ærø, ßtraße',
  'Precio: 1.234,56 € — “comillas” ‘simples’ … • – ™ ‰ Œuvre',
  'Ĉu ŝi ĝojas? Łódź, Kraków, Gdańsk, Zürich, İstanbul',
  'Greek αβγδε and Cyrillic абвгд and CJK 中文',
  'emoji 😀 pair 𝄞 music',
  'control \u0001\u0002\u001f chars and NUL \u0000 inside',
  'numbers 0123456789 +-*/=()[]{}<>@#$%^&_|~`\'"',
  '1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16-17-18-19-20',
  'word - word -- word --- end',
  'a\n \n b \n  c  \n',
  'MMMMMMMMMM WWWWWWWWWW iiiiiiiiii llllllllll',
  'Total customers by country and region, with subtotals per group and a grand total at the end',
];

const fonts = [0, 1, 2, 3, 4, 5, 6];
const styles = [0, 1, 2, 3, 4, 8, 15];
const sizes = [6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 30, 36, 48, 72];
const widths = [0, 1, 100, 300, 577, 800, 1000, 1440, 2000, 2345, 3000, 4500, 6000, 10758];
const heights = [0, 100, 230, 500, 1000];
const alignments = [0, 1, 2, 4, 16, 32, 64, 66, 68, 1024, 1024 + 16, 64 + 32];

// Deterministic pseudo random numbers (LCG)
let seed = 20261121;
const rnd = (n) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
};
const pick = (a) => a[rnd(a.length)];

const cases = [];
// Every text with every font, plain, wrapping in a medium box
for (const text of texts)
  for (const type1Font of fonts)
    cases.push({ text, fontSize: 10, fontStyle: 0, type1Font, wordWrap: true, alignment: 0, cutText: false, width: 2000, height: 0 });
// Every text with every Helvetica / Times style, in a narrow box
for (const text of texts)
  for (const type1Font of [0, 2])
    for (const fontStyle of [1, 2, 3])
      cases.push({ text, fontSize: 9, fontStyle, type1Font, wordWrap: true, alignment: 0, cutText: false, width: 900, height: 0 });
// A random sample of everything
for (let k = 0; k < 1000; k++) {
  cases.push({
    text: pick(texts),
    fontSize: pick(sizes),
    fontStyle: pick(styles),
    type1Font: pick(fonts),
    wordWrap: rnd(3) > 0,
    alignment: pick(alignments),
    cutText: rnd(4) === 0,
    width: pick(widths),
    height: pick(heights),
  });
}
// Rotation: TextExtent gives the extent back, TextExtentLineInfo measures
for (const fontRotation of [450, 900, 1800, 2700, -900])
  cases.push({ text: texts[3], fontSize: 10, fontRotation, wordWrap: true, width: 1500, height: 333 });
// (golden-cs text-extent measures every case left to right and not HTML)

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-textextent-'));
const input = path.join(work, 'cases.json');
const output = path.join(work, 'out.json');
fs.writeFileSync(input, JSON.stringify(cases));
execFileSync(golden, ['text-extent', input, output], { stdio: 'inherit' });
const results = JSON.parse(fs.readFileSync(output, 'utf8'));
if (results.length !== cases.length) throw new Error('Result count mismatch');
const compact = results.map((r, i) => {
  if (r.error) return { case: cases[i], error: r.error };
  return {
    case: cases[i],
    extent: r.extent,
    lineExtent: r.lineExtent,
    lines: r.lines.map((l) => {
      if (l.lineHeight !== 0 || l.text !== null) throw new Error('Unexpected line fields');
      return [l.position, l.size, l.width, l.height, l.topPos, l.lastLine ? 1 : 0];
    }),
  };
});
fs.mkdirSync(path.join(here, 'fixtures'), { recursive: true });
fs.writeFileSync(path.join(here, 'fixtures/text-extent.json'), JSON.stringify(compact));
console.log(`${compact.length} cases written to test/fixtures/text-extent.json`);
fs.rmSync(work, { recursive: true, force: true });
