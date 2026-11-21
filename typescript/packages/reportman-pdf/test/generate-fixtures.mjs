// Generates the PDF parity fixtures with the C# engine (golden-cs run, PrintOutPDFStandard,
// uncompressed): for each report, the metafile as JSON and the C# PDF.
//
//   customers   samples/customers.rep
//   invoices    samples/invoices.rep
//   features    a copy of customers.rep whose first section is replaced with a matrix of the
//               features the samples do not use: every shape, brush and pen style, every
//               standard font and style, alignments, word wrap, justification, clipping,
//               background, underline, strikeout, rotation, line breaks, tabs, escapes,
//               Windows-1252 best fit characters and annotations (links and notes). Its
//               annotation texts, which the metafile JSON does not carry, are written to
//               features.annotations.json in object order.
//
//   node packages/reportman-pdf/test/generate-fixtures.mjs     (from typescript/)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const golden = path.join(root, 'typescript/tools/golden-cs/bin/Release/net10.0/golden-cs.exe');
const samples = path.join(root, 'samples');
const fixtures = path.join(here, 'fixtures');
fs.mkdirSync(fixtures, { recursive: true });

// Strings of a .rep: #<decimal># for every character but letters and digits
const enc = (s) => {
  let r = '';
  for (let k = 0; k < s.length; k++) {
    const c = s.charAt(k);
    r += /[A-Za-z0-9]/.test(c) ? c : '#' + s.charCodeAt(k) + '#';
  }
  return r;
};
const bool = (b) => (b ? 'True' : 'False');
const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);
const TAB = String.fromCharCode(9);
const BACKSLASH = String.fromCharCode(92);

let counter = 0;
const annotations = [];

function label(o) {
  counter++;
  if (o.annotation) annotations.push(o.annotation);
  return `<COMPONENT>
<NAME type="String">TRpFeature${counter}</NAME>
<CLASSNAME type="String">TRPLABEL</CLASSNAME>
<WIDTH type="Integer">${o.w}</WIDTH>
<HEIGHT type="Integer">${o.h}</HEIGHT>
<PRINTCONDITION type="WideString"></PRINTCONDITION>
<DOBEFOREPRINT type="WideString"></DOBEFOREPRINT>
<DOAFTERPRINT type="WideString"></DOAFTERPRINT>
<ANNOTATION type="String">${o.annotation ? enc("'" + o.annotation + "'") : ''}</ANNOTATION>
<POSX type="Integer">${o.x}</POSX>
<POSY type="Integer">${o.y}</POSY>
<ALIGN type="Integer">0</ALIGN>
<WFONTNAME type="WideString">Arial</WFONTNAME>
<LFONTNAME type="WideString">Helvetica</LFONTNAME>
<BIDIMODE type="Integer">0</BIDIMODE>
<TYPE1FONT type="Integer">${o.font ?? 0}</TYPE1FONT>
<FONTSIZE type="Integer">${o.size ?? 9}</FONTSIZE>
<FONTROTATION type="Integer">${o.rot ?? 0}</FONTROTATION>
<FONTSTYLE type="Integer">${o.style ?? 0}</FONTSTYLE>
<FONTCOLOR type="Integer">${o.color ?? 0}</FONTCOLOR>
<BACKCOLOR type="Integer">${o.back ?? 16777215}</BACKCOLOR>
<TRANSPARENT type="Boolean">${bool(o.transparent ?? true)}</TRANSPARENT>
<CUTTEXT type="Boolean">${bool(o.cut ?? false)}</CUTTEXT>
<ALIGNMENT type="Integer">${o.align ?? 0}</ALIGNMENT>
<VALIGNMENT type="Integer">${o.valign ?? 0}</VALIGNMENT>
<INTERLINE type="Integer">0</INTERLINE>
<WORDWRAP type="Boolean">${bool(o.wrap ?? false)}</WORDWRAP>
<WORDBREAK type="Boolean">False</WORDBREAK>
<SINGLELINE type="Boolean">${bool(o.single ?? false)}</SINGLELINE>
<MULTIPAGE type="Boolean">False</MULTIPAGE>
<PRINTSTEP type="Integer">0</PRINTSTEP>
<WIDETEXT type="WideString">${enc(o.text)}</WIDETEXT>
</COMPONENT>
`;
}

function shape(o) {
  counter++;
  if (o.annotation) annotations.push(o.annotation);
  return `<COMPONENT>
<NAME type="String">TRpFeature${counter}</NAME>
<CLASSNAME type="String">TRPSHAPE</CLASSNAME>
<WIDTH type="Integer">${o.w}</WIDTH>
<HEIGHT type="Integer">${o.h}</HEIGHT>
<PRINTCONDITION type="WideString"></PRINTCONDITION>
<DOBEFOREPRINT type="WideString"></DOBEFOREPRINT>
<DOAFTERPRINT type="WideString"></DOAFTERPRINT>
<ANNOTATION type="String">${o.annotation ? enc("'" + o.annotation + "'") : ''}</ANNOTATION>
<POSX type="Integer">${o.x}</POSX>
<POSY type="Integer">${o.y}</POSY>
<ALIGN type="Integer">0</ALIGN>
<SHAPE type="Integer">${o.shape}</SHAPE>
<BRUSHSTYLE type="Integer">${o.brush}</BRUSHSTYLE>
<BRUSHCOLOR type="Integer">${o.brushColor}</BRUSHCOLOR>
<PENSTYLE type="Integer">${o.pen}</PENSTYLE>
<PENCOLOR type="Integer">${o.penColor}</PENCOLOR>
<PENWIDTH type="Integer">${o.penWidth}</PENWIDTH>
</COMPONENT>
`;
}

function featureComponents() {
  let xml = '';
  // Shapes: every shape type with brush styles, pen styles and pen widths
  const brushes = [0, 1, 2, 5, 14];
  const pens = [0, 1, 2, 3, 4, 5];
  const widths = [0, 15, 60, 0, 33];
  for (let row = 0; row < 3; row++)
    for (let s = 0; s < 10; s++) {
      const k = row * 10 + s;
      xml += shape({
        x: 60 + s * 1065,
        y: 60 + row * 640,
        w: s % 2 === 0 ? 950 : 700,
        h: s % 3 === 0 ? 560 : 420,
        shape: s,
        brush: brushes[k % brushes.length],
        brushColor: [0x1f4e79, 0x00c0ff, 0xf0f0f0, 0x3366cc, 0x808080][k % 5],
        pen: pens[k % pens.length],
        penColor: [0x000000, 0x0000ff, 0x00aa00, 0xff8800, 0x7949855][k % 5],
        penWidth: widths[k % widths.length],
        annotation: k === 7 ? 'URL:https://example.com/shape?a=1&b=(2)' : k === 12 ? 'A note on a shape' : undefined,
      });
    }
  // Clear pen and clear brush: nothing painted; clear pen with a fill
  xml += shape({ x: 60, y: 1980, w: 500, h: 200, shape: 0, brush: 1, brushColor: 255, pen: 5, penColor: 0, penWidth: 0 });
  xml += shape({ x: 660, y: 1980, w: 500, h: 200, shape: 4, brush: 0, brushColor: 0xff, pen: 5, penColor: 0, penWidth: 0 });
  xml += shape({ x: 1260, y: 1980, w: 500, h: 200, shape: 2, brush: 0, brushColor: 0xff00, pen: 5, penColor: 0, penWidth: 0 });
  // Fonts: every standard font type (and Linked / Embedded, which become Helvetica) and style
  for (let font = 0; font < 7; font++)
    for (let style = 0; style < 4; style++)
      xml += label({
        x: 60 + style * 2680,
        y: 2260 + font * 230,
        w: 2600,
        h: 220,
        font,
        style,
        size: 8,
        color: [0, 0x7f0000, 0x007f00, 0x00007f][style],
        text: `Font ${font} style ${style}: Ññ €“”‘’ (a\\b) çß`,
      });
  const para =
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation.';
  // Alignment, word wrap, justification, background, clipping
  const boxes = [
    { align: 0, valign: 0, wrap: true },
    { align: 2, valign: 16, wrap: true, transparent: false, back: 0xccffff },
    { align: 4, valign: 32, wrap: true, cut: true },
    { align: 1024, valign: 0, wrap: true, transparent: false, back: 0xe0e0ff },
  ];
  boxes.forEach((b, i) => (xml += label({ x: 60 + i * 2680, y: 3920, w: 2560, h: 1050, size: 8, text: para, ...b })));
  xml += label({ x: 60, y: 5050, w: 2560, h: 1050, size: 8, align: 1024, wrap: true, text: 'Justified' + LF + 'lines with line feeds and some longer words in them' + CRLF + 'and Windows line breaks too, so every paragraph ends unjustified.' });
  xml += label({ x: 2740, y: 5050, w: 2560, h: 300, size: 9, align: 2, single: true, text: 'single line' + LF + 'with a line feed' + CRLF + 'and a CR LF' });
  xml += label({ x: 2740, y: 5400, w: 2560, h: 230, size: 9, cut: true, text: 'A long line without word wrap that is cut at the edge of its box, and goes on and on' });
  xml += label({ x: 2740, y: 5700, w: 2560, h: 400, size: 8, wrap: true, cut: true, valign: 16, text: para });
  xml += label({ x: 5420, y: 5050, w: 2560, h: 230, size: 10, style: 4, text: 'Underlined text' });
  xml += label({ x: 5420, y: 5300, w: 2560, h: 230, size: 10, style: 8, color: 0xff, text: 'Struck out text' });
  xml += label({ x: 5420, y: 5550, w: 2560, h: 230, size: 10, style: 12, text: 'Underlined and struck out' });
  xml += label({ x: 5420, y: 5800, w: 2560, h: 500, size: 9, style: 5, wrap: true, align: 1024, transparent: false, back: 0xddffdd, text: 'Underlined, bold and justified text over several lines of a box' });
  xml += label({ x: 8100, y: 5050, w: 2560, h: 1050, size: 11, font: 2, wrap: true, align: 4, valign: 32, text: 'Times centered' + LF + LF + 'with an empty line' + TAB + 'and a tab' });
  // Rotation (around the top left corner of the box)
  const rots = [450, 900, 1800, 2700, 3150, 3600];
  rots.forEach((rot, i) => (xml += label({ x: 900 + i * 1700, y: 6900, w: 1500, h: 400, size: 9, rot, text: `Rotated ${rot / 10} degrees` })));
  xml += label({ x: 400, y: 7900, w: 1800, h: 600, size: 8, rot: 900, wrap: true, cut: true, transparent: false, back: 0xffeeaa, style: 4, text: para });
  xml += label({ x: 3000, y: 7800, w: 2400, h: 400, size: 10, rot: 300, transparent: false, back: 0xaaeeff, align: 4, text: 'Rotated with background' });
  xml += label({ x: 6200, y: 7500, w: 2400, h: 400, size: 10, rot: 2250, style: 8, text: 'Rotated and struck out' });
  // Characters: escapes, best fit, controls, surrogates
  xml += label({ x: 60, y: 8100, w: 10600, h: 230, size: 9, text: 'Escapes ( ) ' + BACKSLASH + ' and best fit: Łódź ĉĝĥ Ω ≠ ‰ ™ – — … ﬁ ＡＢＣ emoji 😀 end' });
  xml += label({ x: 60, y: 8380, w: 10600, h: 230, size: 9, font: 1, text: 'Courier: 0123456789 ¡¿ ÀÉÎÕÜ àéîõü ¤ ¶ § µ ° ± ² ³ ½ ¼ ¾' });
  xml += label({ x: 60, y: 8660, w: 10600, h: 260, size: 12, font: 3, text: 'Symbol abcdefg ABCDEFG 12345' });
  xml += label({ x: 60, y: 8960, w: 10600, h: 260, size: 12, font: 4, text: 'Zapf abcdefg ABCDEFG 12345' });
  // Annotations: a link and notes (one with non ASCII text)
  xml += label({ x: 60, y: 9280, w: 3000, h: 230, size: 9, style: 4, color: 0xff0000, text: 'A link to reportman.es', annotation: 'URL:https://reportman.es/' });
  xml += label({ x: 3200, y: 9280, w: 3000, h: 230, size: 9, text: 'A text note', annotation: 'A note (with parentheses) and a backslash ' + BACKSLASH });
  xml += label({ x: 6400, y: 9280, w: 3000, h: 230, size: 9, text: 'A note with accents', annotation: 'Una nota en español: ñ, á, €' });
  // Sizes, in two columns
  const sizes = [[6, 14, 24], [7, 18, 36]];
  const tops = [9600, 9950, 10550];
  sizes.forEach((col, c) => col.forEach((size, r) => (xml += label({ x: 60 + c * 5340, y: tops[r], w: 5200, h: [350, 600, 900][r], size, font: (c + r) % 3 === 1 ? 2 : 0, style: (c * 3 + r) % 4, text: `Size ${size}: the quick fox` }))));
  return xml;
}

function makeFeaturesRep() {
  let xml = fs.readFileSync(path.join(samples, 'customers.rep'), 'utf8');
  const start = xml.indexOf('<NAME type="String">TRpSection0</NAME>');
  const end = xml.indexOf('</SECTION>', start);
  if (start < 0 || end < 0) throw new Error('customers.rep changed: TRpSection0 is not there');
  let section = xml.substring(start, end);
  section = section.replace(/<HEIGHT type="Integer">\d+<\/HEIGHT>/, '<HEIGHT type="Integer">11600</HEIGHT>');
  const firstComp = section.indexOf('<COMPONENT>');
  section = section.substring(0, firstComp) + featureComponents();
  xml = xml.substring(0, start) + section + xml.substring(end);
  // One customer: the page header with the features and the data fit in one page
  const sql = xml.indexOf('</SQL>');
  if (sql < 0) throw new Error('customers.rep changed: no SQL');
  return xml.substring(0, sql) + ' LIMIT 1' + xml.substring(sql);
}

function run(name, rep) {
  const meta = path.join(fixtures, name + '.meta.json');
  const pdf = path.join(fixtures, name + '.cs.pdf');
  execFileSync(golden, ['run', rep, meta, '--pdf', pdf, '--sqlite', path.join(samples, 'samples.db')], { stdio: 'inherit' });
  // Compact JSON
  fs.writeFileSync(meta, JSON.stringify(JSON.parse(fs.readFileSync(meta, 'utf8'))));
  console.log(`${name}: ${meta}, ${pdf}`);
}

run('customers', path.join(samples, 'customers.rep'));
run('invoices', path.join(samples, 'invoices.rep'));
const featuresRep = path.join(fixtures, 'features.rep');
fs.writeFileSync(featuresRep, makeFeaturesRep());
fs.writeFileSync(path.join(fixtures, 'features.annotations.json'), JSON.stringify(annotations, null, 1));
run('features', featuresRep);
