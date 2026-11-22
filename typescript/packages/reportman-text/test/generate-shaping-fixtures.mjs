// The glyphs HarfBuzz gives the C# engine (FontInfoFt.DarForma, golden-cs shape) for texts of
// every script, at the scale of each font and at 1024: the scale the C# FreeType driver shapes
// with for a font whose TTFontData has not measured a character yet (the UnitsPerEM its
// constructor gives), which is most of the time. test/shaping-parity.test.ts compares the
// TypeScript shaper with them. The fonts are the ones of Windows (fixtures/shaping.json keeps the
// size of each file, and the test runs only with the same files).
//
//   node test/generate-shaping-fixtures.mjs     (from packages/reportman-text, Windows)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = path.resolve(here, '../../../tools/golden-cs/bin/Release/net10.0/golden-cs.exe');
const fonts = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Fonts');

const ARABIC = [
  'يهدف إلى ضمان عرض موحّد ودقيق للوثائق في كل مكان.',
  'يُعَدّ معيار PDF أحد أهم المعايير في تبادل المستندات الرقمية.',
  'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
  'مُحَمَّدٌ رَسُولُ اللَّهِ ﷺ',
  'لا إله إلا الله، ١٢٣٤٥٦٧٨٩٠',
];
// Every letter between others (initial, medial and final forms, the cursive joins) with and
// without marks
const LETTERS = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي';
const JOINED = [...LETTERS].map((l) => 'ب' + l + 'ب' + l + ' ' + l + 'ـ' + l).join(' ');
const MARKED = [...LETTERS].map((l) => 'س' + l + 'َّ' + 'ن' + l + 'ِ' + l + 'ُ').join(' ');
const MORE_ARABIC = [JOINED, MARKED, 'كَتَبَ الطَّالِبُ الدَّرْسَ فِي الْمَكْتَبَةِ', 'ﻻ ﻷ ﻹ ﻵ لا لأ لإ لآ'];
const HEBREW = ['שָׁלוֹם עֲלֵיכֶם', 'בְּרֵאשִׁית בָּרָא אֱלֹהִים', 'עברית בלי ניקוד 123'];
const DEVANAGARI = ['हिन्दी भाषा', 'क्षत्रिय श्री द्विज', 'नमस्ते दुनिया'];
const THAI = ['ภาษาไทย สวัสดีครับ', 'ผู้ใหญ่ น้ำ ที่นี่'];
const LATIN = ['office fluffy affinity', 'Vietnamese: Tiếng Việt có dấu ỗ ặ ữ', 'AVATAR Wave To LT'];

const CASES = [];
const add = (file, face, rtl, script, texts) => {
  for (const text of texts) for (const scale of ['font', 1024]) CASES.push({ file, face, rtl, script, text, scale });
};
add('arial.ttf', 0, true, 'Arab', ARABIC.concat(MORE_ARABIC));
add('times.ttf', 0, true, 'Arab', ARABIC.slice(0, 3).concat(MORE_ARABIC));
add('tahoma.ttf', 0, true, 'Arab', ARABIC.slice(0, 3).concat(MORE_ARABIC));
add('segoeui.ttf', 0, true, 'Arab', ARABIC.slice(0, 3).concat(MORE_ARABIC));
add('Nirmala.ttc', 0, true, 'Arab', MORE_ARABIC);
// The one font of Windows with cursive attachments (GPOS lookup 3; units per em 1000, so 1024 is
// not its scale), with Arabic and Manichaean, which HarfBuzz and fontkit join with the Arabic
// shaper. Not Hanifi Rohingya or Sogdian: HarfBuzz joins them in its Universal Shaping Engine and
// fontkit's does not, so their glyphs are not the same yet.
add('SansSerifCollection.ttf', 0, true, 'Arab', MORE_ARABIC.concat(ARABIC.slice(0, 2)));
add('SansSerifCollection.ttf', 0, true, 'Mani', ['𐫀𐫁𐫂𐫃 𐫄𐫅𐫆']);
add('arial.ttf', 0, true, 'Hebr', HEBREW);
add('segoeui.ttf', 0, true, 'Hebr', HEBREW);
add('Nirmala.ttc', 0, false, 'Deva', DEVANAGARI);
add('LeelawUI.ttf', 0, false, 'Thai', THAI);
add('tahoma.ttf', 0, false, 'Thai', THAI);
add('arial.ttf', 0, false, 'Latn', LATIN);
add('calibri.ttf', 0, false, 'Latn', LATIN);
add('cambria.ttc', 0, false, 'Latn', LATIN);

const tmp = path.join(process.env.TEMP ?? '.', 'rm-shaping-text.txt');
const out = [];
for (const c of CASES) {
  const file = path.join(fonts, c.file);
  fs.writeFileSync(tmp, c.text, 'utf8');
  const args = ['shape', file, c.rtl ? '1' : '0', c.script, tmp, String(c.face)];
  if (c.scale !== 'font') args.push(String(c.scale));
  const glyphs = execFileSync(golden, args, { encoding: 'utf8' })
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split(' ').map(Number));
  out.push({ ...c, glyphs });
}
const sizes = Object.fromEntries([...new Set(CASES.map((c) => c.file))].map((f) => [f, fs.statSync(path.join(fonts, f)).size]));
fs.mkdirSync(path.join(here, 'fixtures'), { recursive: true });
fs.writeFileSync(path.join(here, 'fixtures', 'shaping.json'), JSON.stringify({ sizes, cases: out }) + '\n');
console.log(`${out.length} cases`);
