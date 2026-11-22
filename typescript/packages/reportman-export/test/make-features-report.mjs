// The report of the "features" case of delphi-cases.json (fixtures/features.rep): what the samples
// do not have and the SVG and HTML drivers write in their own way, on one page and without data.
// Single line texts (<NOBR>), the vertical alignments, a strikeout and an underline, a text with a
// background, the characters HTML escapes and line breaks, characters that Windows-1252 does not
// have, a rotated text, two styles that differ only in the case of the font name (one CSS class
// in Delphi), and every shape with clear pens and brushes and pen widths at the halves of a point.
//
//   node packages/reportman-export/test/make-features-report.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'fixtures', 'features.rep');

// XML writing (ReportWriter: every character but letters, digits and spaces as #code#, the code
// of each UTF-16 code unit)
function enc(value) {
  let r = '';
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 32) r += value[i];
    else r += '#' + c + '#';
  }
  return r;
}

function prop(name, value) {
  if (typeof value === 'boolean') return `<${name} type="Boolean">${value ? 'True' : 'False'}</${name}>`;
  if (typeof value === 'number') return `<${name} type="Integer">${value}</${name}>`;
  // The reference of a section to its subreport is a String (as the image reports of the engine)
  if (name === 'SUBREPORT') return `<${name} type="String">${enc(value)}</${name}>`;
  return `<${name} type="WideString">${enc(value)}</${name}>`;
}

const props = (obj) =>
  Object.entries(obj)
    .map(([k, v]) => prop(k, v))
    .join('\n');

const REPORT = {
  WFONTNAME: 'Arial', LFONTNAME: 'Helvetica', GRIDVISIBLE: true, GRIDLINES: false, GRIDENABLED: true,
  GRIDCOLOR: 16711680, GRIDWIDTH: 115, GRIDHEIGHT: 115, PAGEORIENTATION: 1, PAGESIZE: 1, PAGESIZEQT: 0,
  PAGEHEIGHT: 16837, PAGEWIDTH: 11906, CUSTOMPAGEHEIGHT: 16837, CUSTOMPAGEWIDTH: 11906, PAGEBACKCOLOR: 15794175,
  PREVIEWSTYLE: 0, PREVIEWMARGINS: false, PREVIEWWINDOW: 0, LEFTMARGIN: 574, TOPMARGIN: 574, RIGHTMARGIN: 574,
  BOTTOMMARGIN: 861, PRINTERSELECT: 0, LANGUAGE: -1, COPIES: 1, COLLATECOPIES: false, TWOPASS: false,
  PRINTERFONTS: 0, PRINTONLYIFDATAAVAILABLE: false, STREAMFORMAT: 3, REPORTACTIONDRAWERBEFORE: false,
  REPORTACTIONDRAWERAFTER: false, PREVIEWABOUT: true, TYPE1FONT: 0, FONTSIZE: 10, FONTROTATION: 0, FONTSTYLE: 0,
  FONTCOLOR: 0, BACKCOLOR: 16777215, TRANSPARENT: true, CUTTEXT: false, ALIGNMENT: 0, VALIGNMENT: 0,
  WORDWRAP: false, SINGLELINE: false, MULTIPAGE: false, PRINTSTEP: 0, PAPERSOURCE: 0, DUPLEX: 0,
  FORCEPAPERNAME: '', LINESPERINCH: 600, PDFCONFORMANCE: 0, PDFCOMPRESSED: false, DOCAUTHOR: 'Synthetic',
  DOCCREATOR: 'Report Manager', DOCPRODUCER: '', DOCSUBJECT: '', DOCTITLE: 'Features', DOCCREATIONDATE: '',
  DOCMODIFICATIONDATE: '', DOCKEYWORDS: '', DOCXMPCONTENT: '',
};

let count = 0;
const head = (cls, prefix, o) =>
  props({
    NAME: prefix + count++, CLASSNAME: cls, WIDTH: o.WIDTH ?? 3000, HEIGHT: o.HEIGHT ?? 300, PRINTCONDITION: '',
    DOBEFOREPRINT: '', DOAFTERPRINT: '', ANNOTATION: '', POSX: o.POSX ?? 0, POSY: o.POSY ?? 0, ALIGN: 0,
  });

function label(text, o = {}) {
  const { WIDTH, HEIGHT, POSX, POSY, ...t } = o;
  return `<COMPONENT>\n${head('TRPLABEL', 'TRpLabel', { WIDTH, HEIGHT, POSX, POSY })}\n${props({
    WFONTNAME: 'Arial', LFONTNAME: 'Helvetica', BIDIMODE: 0, TYPE1FONT: 0, FONTSIZE: 9, FONTROTATION: 0,
    FONTSTYLE: 0, FONTCOLOR: 0, BACKCOLOR: 16777215, TRANSPARENT: true, CUTTEXT: false, ALIGNMENT: 0, VALIGNMENT: 0,
    INTERLINE: 0, WORDWRAP: false, WORDBREAK: false, SINGLELINE: false, MULTIPAGE: false, PRINTSTEP: 0, ...t,
  })}\n${prop('WIDETEXT', text)}\n</COMPONENT>`;
}

function expression(expr, o = {}) {
  const { WIDTH, HEIGHT, POSX, POSY, ...t } = o;
  return `<COMPONENT>\n${head('TRPEXPRESSION', 'TRpExpression', { WIDTH, HEIGHT, POSX, POSY })}\n${props({
    WFONTNAME: 'Arial', LFONTNAME: 'Helvetica', BIDIMODE: 0, TYPE1FONT: 0, FONTSIZE: 9, FONTROTATION: 0,
    FONTSTYLE: 0, FONTCOLOR: 0, BACKCOLOR: 16777215, TRANSPARENT: true, CUTTEXT: false, ALIGNMENT: 0, VALIGNMENT: 0,
    INTERLINE: 0, WORDWRAP: false, WORDBREAK: false, SINGLELINE: false, MULTIPAGE: false, PRINTSTEP: 0,
    EXPRESSION: expr, AGINIVALUE: '0', EXPORTEXPRESSION: '', DATATYPE: 16, DISPLAYFORMAT: '', IDENTIFIER: '',
    AGGREGATE: 0, GROUPNAME: '', AGTYPE: 0, AUTOEXPAND: false, AUTOCONTRACT: false, PRINTONLYONE: false,
    PRINTNULLS: true, EXPORTDISPLAYFORMAT: '', EXPORTLINE: 0, EXPORTPOSITION: 0, EXPORTSIZE: 1, EXPORTDONEWLINE: false,
    ...t,
  })}\n</COMPONENT>`;
}

function shape(o = {}) {
  const { WIDTH, HEIGHT, POSX, POSY, ...s } = o;
  return `<COMPONENT>\n${head('TRPSHAPE', 'TRpShape', { WIDTH, HEIGHT, POSX, POSY })}\n${props({
    SHAPE: 0, BRUSHSTYLE: 0, BRUSHCOLOR: 16777215, PENSTYLE: 0, PENCOLOR: 0, PENWIDTH: 0, ...s,
  })}\n</COMPONENT>`;
}

const components = [];
let y = 0;
const row = (height = 400) => {
  const top = y;
  y += height;
  return top;
};

// Texts (ALIGNMENT and VALIGNMENT are alignment flags: right 2, center 4, justify 1024, bottom
// 16, middle 32)
components.push(label('A single line text', { POSY: row(), SINGLELINE: true }));
components.push(label('Bottom right', { POSY: row(600), HEIGHT: 500, VALIGNMENT: 16, ALIGNMENT: 2 }));
components.push(label('Middle center', { POSY: row(600), HEIGHT: 500, VALIGNMENT: 32, ALIGNMENT: 4 }));
components.push(label('Justified text that wraps in its box', { POSY: row(600), HEIGHT: 500, WIDTH: 1500, ALIGNMENT: 1024, WORDWRAP: true }));
components.push(label('Struck out', { POSY: row(), FONTSTYLE: 8 }));
components.push(label('Underlined and struck out', { POSY: row(), FONTSTYLE: 12, FONTCOLOR: 255 }));
components.push(label('Bold italic underlined', { POSY: row(), FONTSTYLE: 7 }));
components.push(label('On a background', { POSY: row(), TRANSPARENT: false, BACKCOLOR: 11393254, FONTCOLOR: 16777215 }));
// (the lines of the text of a label are its translations: the line breaks come from an expression)
components.push(expression(`'Fish & chips <b>"quoted"</b> it''s'#13#10'the second line'#10'and a third'`, { POSY: row(800), HEIGHT: 700, WIDTH: 5000 }));
components.push(label('Ā ő € – • Ελληνικά 日本語 \u{1F600}', { POSY: row(), WIDTH: 5000 }));
components.push(label('Rotated', { POSY: row(1200), POSX: 600, HEIGHT: 1000, WIDTH: 1000, FONTROTATION: 900 }));
// The same style but the case of the font names: one class in Delphi (a case insensitive list)
components.push(label('Arial and Helvetica', { POSY: row(), FONTSIZE: 11 }));
components.push(label('ARIAL and HELVETICA', { POSY: row(), FONTSIZE: 11, WFONTNAME: 'ARIAL', LFONTNAME: 'HELVETICA' }));

// Shapes: rectangle, square, rounded, ellipse, circle, lines and obliques; clear pens and
// brushes; pen widths of 10, 30 and 50 twips (half a point, one and a half, two and a half)
let x = 0;
const col = () => {
  const left = 5600 + x * 1300;
  x++;
  return left;
};
for (let s = 0; s <= 9; s++) components.push(shape({ SHAPE: s, POSX: col(), POSY: 0, WIDTH: 1000, HEIGHT: 800, PENWIDTH: 30, PENCOLOR: 16711680, BRUSHCOLOR: 65535 }));
x = 0;
components.push(shape({ POSX: col(), POSY: 1200, WIDTH: 1000, HEIGHT: 800, PENSTYLE: 5, BRUSHCOLOR: 12632256 }));
components.push(shape({ POSX: col(), POSY: 1200, WIDTH: 1000, HEIGHT: 800, BRUSHSTYLE: 1, PENWIDTH: 10 }));
components.push(shape({ POSX: col(), POSY: 1200, WIDTH: 1000, HEIGHT: 800, PENSTYLE: 1, PENWIDTH: 50 }));
components.push(shape({ SHAPE: 6, POSX: col(), POSY: 1200, WIDTH: 1000, HEIGHT: 800, PENSTYLE: 5 }));
components.push(shape({ SHAPE: 7, POSX: col(), POSY: 1200, WIDTH: 1000, HEIGHT: 800, PENSTYLE: 2, PENWIDTH: 100 }));

const section = `<SECTION>\n${props({
  NAME: 'TRpSection0', WIDTH: 10758, HEIGHT: y, PRINTCONDITION: '', DOBEFOREPRINT: '', DOAFTERPRINT: '',
  SUBREPORT: 'TRpSubReport0', GROUPNAME: '', CHANGEEXPRESSION: '', BEGINPAGEEXPRESSION: '', SKIPEXPREV: '',
  SKIPEXPREH: '', SKIPTOPAGEEXPRE: '', BACKEXPRESSION: '', CHANGEBOOL: false, PAGEREPEAT: false, FORCEPRINT: false,
  SKIPPAGE: false, ALIGNBOTTOM: false, SECTIONTYPE: 2, AUTOEXPAND: false, AUTOCONTRACT: false, HORZDESP: false,
  VERTDESP: false, EXTERNALFILENAME: '', EXTERNALCONNECTION: '', EXTERNALTABLE: 'REPMAN_REPORTS',
  EXTERNALFIELD: 'REPORT', EXTERNALSEARCHFIELD: 'REPORT_NAME', EXTERNALSEARCHVALUE: '', STREAMFORMAT: 1,
  SKIPRELATIVEH: false, SKIPRELATIVEV: false, SKIPTYPE: 0, ININUMPAGE: false, GLOBAL: false, DPIRES: 100,
  CACHEDIMAGE: 0, BACKSTYLE: 0, DRAWSTYLE: 2,
})}\n${components.join('\n')}\n</SECTION>`;

const subreport = `<SUBREPORT>\n${props({ NAME: 'TRpSubReport0', ALIAS: '', PRINTONLYIFDATAAVAILABLE: false, REOPENONPRINT: true })}\n${section}\n</SUBREPORT>`;

const xml = `<?xml version="1.0" standalone="no"?>\n<!DOCTYPE REPORT_MANAGER_2>\n<REPORT>\n${props(REPORT)}\n${subreport}\n</REPORT>\n`;
fs.writeFileSync(out, xml);
console.log('Written ' + out);
