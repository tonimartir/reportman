// Generates test/fixtures/text-extent-freetype.json: text measurements of the C# engine with the
// FreeType driver (PrintOutPDFFreeType.TextExtentLineInfo and TextExtent through golden-cs
// text-extent --driver freetype, fonts from the system font folders) over texts x font families
// x styles x sizes x widths x wrapping x alignments. The fonts are those of the machine: the test
// only compares on the same font files (the fingerprint of reportman-engine's FreeType fixtures).
//
//   node packages/reportman-text/test/generate-text-extent-freetype.mjs     (from typescript/, Windows)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const golden = path.join(root, 'typescript/tools/golden-cs/bin/Release/net10.0/golden-cs.exe');

const texts = [
  '', 'A', 'Hello world', 'Hello world, this is a test of wrapping text in a narrow box',
  'The quick brown fox jumps over the lazy dog. THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG!',
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'Supercalifragilisticexpialidocious-and-more-hyphenated-words-to-break',
  'antidisestablishmentarianismantidisestablishmentarianism',
  'two  spaces   three    four     end', '   leading spaces', 'trailing spaces   ', '     ',
  'line one\nline two\nline three', 'windows\r\nline\r\nbreaks\r\n', 'mac\rcarriage\rreturns', '\n\nleading line feeds',
  'trailing line feed\n', 'tabs\tbetween\twords\t\tdouble',
  'Ñandú, pingüino, acción, über, garçon, smørrebrød, Ærø, ßtraße',
  'Precio: 1.234,56 € — “comillas” ‘simples’ … • – ™ ‰ Œuvre',
  'Ĉu ŝi ĝojas? Łódź, Kraków, Gdańsk, Zürich, İstanbul',
  'Greek αβγδε and Cyrillic абвгд and CJK 中文',
  'emoji 😀 pair 𝄞 music', 'numbers 0123456789 +-*/=()[]{}<>@#$%^&_|~`\'"',
  '1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16-17-18-19-20', 'word - word -- word --- end', 'a\n \n b \n  c  \n',
  'MMMMMMMMMM WWWWWWWWWW iiiiiiiiii llllllllll', 'office fluffy affine ffi ffl fi fl',
  'Total customers by country and region, with subtotals per group and a grand total at the end',
  'يُعصر زيت الزيتون البكر الممتاز لدينا على البارد من زيتون أربيكينا',
  'English then العربية 123 and back (brackets) [x]',
  'שמן הזית הכתית המעולה שלנו מופק בכבישה קרה',
  'हमारा एक्स्ट्रा वर्जिन जैतून का तेल अक्टूबर में तोड़े गए जैतूनों',
  'น้ำมันมะกอกของเราสกัดเย็นจากมะกอกที่เก็บเกี่ยวในเดือนตุลาคม',
  'ご注文ありがとうございます。当店のオリーブオイルは低温圧搾しています。',
  '한국어 텍스트 줄 바꿈 테스트 문장입니다',
];
const fonts = ['Arial', 'Times New Roman', 'Courier New', 'Verdana', 'Tahoma', 'Segoe UI', 'Calibri', 'Cambria', 'Georgia', 'Noto Sans', 'NoSuchFont', 'Helvetica', 'Consolas', 'Bahnschrift', 'Ubuntu Mono', 'Yu Gothic', 'MS Gothic', 'Nirmala UI', 'Leelawadee UI'];
const cases = [];
let k = 0;
for (const t of texts)
  for (const f of fonts) {
    k++;
    const style = k % 4;
    const size = [8, 10, 12, 15, 9, 11][k % 6];
    const width = [20000, 3000, 1500, 800][k % 4];
    const wordWrap = k % 3 !== 0;
    cases.push({ text: t, wFontName: f, fontSize: size, fontStyle: style, width, wordWrap, alignment: [0, 2, 4, 1024][k % 4] });
  }
const casesFile = path.join(os.tmpdir(), 'rm-text-extent-freetype-cases.json');
fs.writeFileSync(casesFile, JSON.stringify(cases));
const outFile = path.join(here, 'fixtures/text-extent-freetype.json');
execFileSync(golden, ['text-extent', casesFile, outFile, '--driver', 'freetype'], { stdio: 'inherit' });
console.log(cases.length, 'cases');
