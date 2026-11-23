// Writes the synthetic barcode reports of the barcode parity tests (fixtures/barcode/bc-*.rep):
// XML reports, with constant expressions or over samples.db, that cover every symbology of
// BarcodeItem, the checksums, value lengths, modules and ratios, rotations, QR sizes and error
// correction levels, PDF417 rows, columns, error correction and compaction modes, the code set
// switching of automatic Code 128, BARCODEOP and the errors of the C# engine. The bc-delphi-*
// reports are the ones compared with the Delphi engine too (generate-barcode-delphi-fixtures.mjs):
// they have no database, so Delphi runs them as they are.
//
//   node test/synthetic/make-barcode-reports.mjs      (from packages/reportman-engine)
//
// With --cases CASES.json OUT.rep it writes one report instead, with no database: a barcode (and a
// label "cN" under it) per case of the list, each one { text, type (a name of BarType), ... the
// properties of the item }. generate-pdf417-fixtures.mjs runs it with Delphi.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../fixtures/barcode');
fs.mkdirSync(out, { recursive: true });

// ---------------------------------------------------------------------------------------------
// XML writing (the same as make-reports.mjs: every character but letters, digits and spaces as
// #code#)

function enc(value) {
  let r = '';
  for (const ch of String(value)) {
    const c = ch.codePointAt(0);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 32) r += ch;
    else if (c > 0xffff) r += '#' + ch.charCodeAt(0) + '##' + ch.charCodeAt(1) + '#';
    else r += '#' + c + '#';
  }
  return r;
}

/** A Double property written as the designer writes it. */
const dbl = (v) => ({ double: v });

function prop(name, value) {
  if (typeof value === 'boolean') return `<${name} type="Boolean">${value ? 'True' : 'False'}</${name}>`;
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return `<${name} type="Integer">${value}</${name}>`;
    return `<${name} type="Double">${value}</${name}>`;
  }
  if (value && typeof value === 'object' && 'double' in value) return `<${name} type="Double">${value.double}</${name}>`;
  return `<${name} type="WideString">${enc(value)}</${name}>`;
}

function props(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => prop(k, v))
    .join('\n');
}

const REPORT_DEFAULTS = {
  WFONTNAME: 'Arial', LFONTNAME: 'Helvetica', GRIDVISIBLE: true, GRIDLINES: false, GRIDENABLED: true,
  GRIDCOLOR: 16711680, GRIDWIDTH: 115, GRIDHEIGHT: 115, PAGEORIENTATION: 1, PAGESIZE: 1, PAGESIZEQT: 0,
  PAGEHEIGHT: 16837, PAGEWIDTH: 11906, CUSTOMPAGEHEIGHT: 16837, CUSTOMPAGEWIDTH: 11906, PAGEBACKCOLOR: 16777215,
  PREVIEWSTYLE: 0, PREVIEWMARGINS: false, PREVIEWWINDOW: 0, LEFTMARGIN: 574, TOPMARGIN: 574, RIGHTMARGIN: 574,
  BOTTOMMARGIN: 861, PRINTERSELECT: 0, LANGUAGE: -1, COPIES: 1, COLLATECOPIES: false, TWOPASS: false,
  PRINTERFONTS: 0, PRINTONLYIFDATAAVAILABLE: false, STREAMFORMAT: 3, REPORTACTIONDRAWERBEFORE: false,
  REPORTACTIONDRAWERAFTER: false, PREVIEWABOUT: true, TYPE1FONT: 0, FONTSIZE: 10, FONTROTATION: 0, FONTSTYLE: 0,
  FONTCOLOR: 0, BACKCOLOR: 16777215, TRANSPARENT: true, CUTTEXT: false, ALIGNMENT: 0, VALIGNMENT: 0,
  WORDWRAP: false, SINGLELINE: false, MULTIPAGE: false, PRINTSTEP: 0, PAPERSOURCE: 0, DUPLEX: 0,
  FORCEPAPERNAME: '', LINESPERINCH: 600, PDFCONFORMANCE: 0, PDFCOMPRESSED: false, DOCAUTHOR: 'Synthetic',
  DOCCREATOR: 'Report Manager', DOCPRODUCER: '', DOCSUBJECT: '', DOCTITLE: 'Barcodes', DOCCREATIONDATE: '',
  DOCMODIFICATIONDATE: '', DOCKEYWORDS: '', DOCXMPCONTENT: '',
};

function database() {
  return `<DATABASEINFO>\n${props({
    ALIAS: 'SAMPLES', NAME: 'TRpDatabaseInfoItem0', CONFIGFILE: '', LOADPARAMS: false, LOADDRIVERPARAMS: false,
    LOGINPROMPT: false, DRIVER: 8, REPORTTABLE: 'REPMAN_REPORTS', REPORTSEARCHFIELD: 'REPORT_NAME', REPORTFIELD: 'REPORT',
    REPORTGROUPSTABLE: 'REPMAN_GROUPS', ADOCONNECTIONSTRING: '', DOTNETDRIVER: 0, PROVIDERFACTORY: '',
  })}\n</DATABASEINFO>`;
}

let dataCount = 0;
function datainfo(alias, sql) {
  return `<DATAINFO>\n${props({
    ALIAS: alias, NAME: 'TRpDataInfoItem' + dataCount++, DATABASEALIAS: 'SAMPLES', SQL: sql, DATASOURCE: '',
    MYBASEFILENAME: '', MYBASEFIELDS: '', MYBASEINDEXFIELDS: '', MYBASEMASTERFIELDS: '', BDEINDEXFIELDS: '',
    BDEINDEXNAME: '', BDETABLE: '', BDETYPE: 0, BDEFILTER: '', BDEMASTERFIELDS: '', BDEFIRSTRANGE: '',
    BDELASTRANGE: '', DATAUNIONS: '', GROUPUNION: false, OPENONSTART: true, PARALLELUNION: false,
  })}\n</DATAINFO>`;
}

let compCount = 0;
const HEAD_KEYS = ['NAME', 'WIDTH', 'HEIGHT', 'PRINTCONDITION', 'DOBEFOREPRINT', 'DOAFTERPRINT', 'ANNOTATION', 'POSX', 'POSY', 'ALIGN'];
const rest = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !HEAD_KEYS.includes(k)));

function head(cls, prefix, o) {
  return props({
    NAME: o.NAME ?? prefix + compCount++, CLASSNAME: cls, WIDTH: o.WIDTH ?? 1440, HEIGHT: o.HEIGHT ?? 275,
    PRINTCONDITION: o.PRINTCONDITION ?? '', DOBEFOREPRINT: o.DOBEFOREPRINT ?? '', DOAFTERPRINT: o.DOAFTERPRINT ?? '',
    ANNOTATION: o.ANNOTATION ?? '', POSX: o.POSX ?? 0, POSY: o.POSY ?? 0, ALIGN: o.ALIGN ?? 0,
  });
}

const BarType = {
  I25: 0, IND25: 1, MAT25: 2, C39: 3, C39X: 4, C128A: 5, C128B: 6, C128C: 7, C128: 8, C93: 9, C93X: 10,
  MSI: 11, POSTNET: 12, CODABAR: 13, EAN8: 14, EAN13: 15, PDF417: 16, QR: 17,
};

/** A barcode item; TYP is a BarType, the rest the properties as the designer writes them. */
function barcode(expression, o = {}) {
  const r = rest(o);
  return `<COMPONENT>\n${head('TRPBARCODE', 'TRpBarcode', { WIDTH: 3000, HEIGHT: 600, ...o })}\n${props({
    EXPRESSION: expression, MODUL: 10, RATIO: dbl(2), TYP: BarType.EAN13, CHECKSUM: false, DISPLAYFORMAT: '',
    ROTATION: 0, BCOLOR: 0, BACKCOLOR: 16777215, TRANSPARENT: true, NUMCOLUMNS: 0, NUMROWS: 0, ECCLEVEL: -1,
    TRUNCATED: false, ...r,
  })}\n</COMPONENT>`;
}

const TEXT_DEFAULTS = {
  WFONTNAME: 'Arial', LFONTNAME: 'Helvetica', BIDIMODE: 0, TYPE1FONT: 0, FONTSIZE: 7, FONTROTATION: 0,
  FONTSTYLE: 0, FONTCOLOR: 0, BACKCOLOR: 16777215, TRANSPARENT: true, CUTTEXT: false, ALIGNMENT: 0, VALIGNMENT: 0,
  INTERLINE: 0, WORDWRAP: false, WORDBREAK: false, SINGLELINE: false, MULTIPAGE: false, PRINTSTEP: 0,
};

function label(text, o = {}) {
  return `<COMPONENT>\n${head('TRPLABEL', 'TRpLabel', o)}\n${props({ ...TEXT_DEFAULTS, ...rest(o) })}\n${prop('WIDETEXT', text)}\n</COMPONENT>`;
}

function expr(expression, o = {}) {
  const r = rest(o);
  return `<COMPONENT>\n${head('TRPEXPRESSION', 'TRpExpression', o)}\n${props({
    ...TEXT_DEFAULTS, ...Object.fromEntries(Object.entries(r).filter(([k]) => k in TEXT_DEFAULTS)),
    EXPRESSION: expression, AGINIVALUE: '0', EXPORTEXPRESSION: '', DATATYPE: 16, DISPLAYFORMAT: '', IDENTIFIER: '',
    AGGREGATE: 0, GROUPNAME: '', AGTYPE: 0, AUTOEXPAND: false, AUTOCONTRACT: false, PRINTONLYONE: false,
    PRINTNULLS: true, EXPORTDISPLAYFORMAT: '', EXPORTLINE: 0, EXPORTPOSITION: 0, EXPORTSIZE: 1, EXPORTDONEWLINE: false,
  })}\n</COMPONENT>`;
}

let secCount = 0;
const SECTION_TYPES = { pageheader: 0, groupheader: 1, detail: 2, groupfooter: 3, pagefooter: 4 };
function section(type, o = {}, components = []) {
  const { NAME, WIDTH, HEIGHT, ...r } = o;
  return `<SECTION>\n${props({
    NAME: NAME ?? 'TRpSection' + secCount++, WIDTH: WIDTH ?? 10758, HEIGHT: HEIGHT ?? 300, PRINTCONDITION: '',
    DOBEFOREPRINT: '', DOAFTERPRINT: '', SUBREPORT: '@SUB@', GROUPNAME: '', CHANGEEXPRESSION: '',
    BEGINPAGEEXPRESSION: '', SKIPEXPREV: '', SKIPEXPREH: '', SKIPTOPAGEEXPRE: '', BACKEXPRESSION: '', CHANGEBOOL: false,
    PAGEREPEAT: false, FORCEPRINT: false, SKIPPAGE: false, ALIGNBOTTOM: false, SECTIONTYPE: SECTION_TYPES[type],
    AUTOEXPAND: false, AUTOCONTRACT: false, HORZDESP: false, VERTDESP: false, EXTERNALFILENAME: '',
    EXTERNALCONNECTION: '', EXTERNALTABLE: 'REPMAN_REPORTS', EXTERNALFIELD: 'REPORT', EXTERNALSEARCHFIELD: 'REPORT_NAME',
    EXTERNALSEARCHVALUE: '', STREAMFORMAT: 1, SKIPRELATIVEH: false, SKIPRELATIVEV: false, SKIPTYPE: 0, ININUMPAGE: false,
    GLOBAL: false, DPIRES: 100, CACHEDIMAGE: 0, BACKSTYLE: 0, DRAWSTYLE: 2, ...r,
  })}\n${components.join('\n')}\n</SECTION>`;
}

let subCount = 0;
function subreport(alias, sections, o = {}) {
  const name = o.NAME ?? 'TRpSubReport' + subCount++;
  const { NAME: _n, ...r } = o;
  return `<SUBREPORT>\n${props({ NAME: name, ALIAS: alias, PRINTONLYIFDATAAVAILABLE: true, REOPENONPRINT: true, ...r })}\n${sections
    .join('\n')
    .split(prop('SUBREPORT', '@SUB@'))
    .join(`<SUBREPORT type="String">${enc(name)}</SUBREPORT>`)}\n</SUBREPORT>`;
}

const written = [];
function report(file, { props: p = {}, data = [], subs = [], db = true }) {
  dataCount = 0;
  const xml = `<?xml version="1.0" standalone="no"?>\n<!DOCTYPE REPORT_MANAGER_2>\n<REPORT>\n${props({ ...REPORT_DEFAULTS, ...p })}\n${[
    ...(db ? [database()] : []),
    ...data,
    ...subs,
  ].join('\n')}\n</REPORT>\n`;
  fs.writeFileSync(path.resolve(out, file), xml);
  written.push(file);
  compCount = 0;
  secCount = 0;
  subCount = 0;
}

/** A Report Manager string literal. */
const q = (s) => "'" + s.replace(/'/g, "''") + "'";

/**
 * Detail sections with one barcode per cell (and a label with its case under it), the cells laid
 * out in rows of `cols`, a section per `rows` rows.
 */
function grid(cases, { cols = 3, cellW = 3500, cellH = 1100, rowsPerSection = 4, caption = true } = {}) {
  const sections = [];
  const perSection = cols * rowsPerSection;
  for (let s = 0; s < cases.length; s += perSection) {
    const comps = [];
    cases.slice(s, s + perSection).forEach((c, i) => {
      const x = (i % cols) * cellW;
      const y = Math.floor(i / cols) * cellH;
      const { expression, caption: text, DX, DY, ...o } = c;
      comps.push(barcode(expression, { ...o, POSX: x + (DX ?? 0), POSY: y + (DY ?? 0) }));
      if (caption) comps.push(label(text ?? String(expression).slice(0, 40), { POSX: x, POSY: y + cellH - 250, WIDTH: cellW - 100, HEIGHT: 200 }));
    });
    sections.push(section('detail', { HEIGHT: Math.ceil(Math.min(perSection, cases.length - s) / cols) * cellH }, comps));
  }
  return sections;
}

// ---------------------------------------------------------------------------------------------
// One report from a list of cases

if (process.argv[2] === '--cases') {
  const list = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const items = list.map(({ text, type, ...o }, i) => ({ expression: q(text), caption: 'c' + i, TYP: BarType[type], WIDTH: 3400, HEIGHT: 900, ...o }));
  report(path.resolve(process.argv[4]), { db: false, subs: [subreport('', grid(items))] });
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// The reports

// The 1D symbologies: values, lengths, checksums, modules and ratios, transparency and colours.
report('bc-linear.rep', {
  subs: [
    subreport(
      '',
      grid(
        [
          // 2 of 5 interleaved: even and odd lengths, ratios (clamped to 2..3), modules
          { expression: q('12345678'), TYP: BarType.I25, MODUL: 10 },
          { expression: q('1234567'), TYP: BarType.I25, MODUL: 12, RATIO: dbl(2.5) },
          { expression: q('00'), TYP: BarType.I25, RATIO: dbl(1.5) },
          { expression: q('9876543210'), TYP: BarType.I25, RATIO: dbl(3.5), TRANSPARENT: false },
          { expression: q(''), TYP: BarType.I25 },
          // 2 of 5 industrial
          { expression: q('1234'), TYP: BarType.IND25, MODUL: 8 },
          { expression: q('90817'), TYP: BarType.IND25, MODUL: 9, RATIO: dbl(2.75), TRANSPARENT: false, BCOLOR: 255 },
          // 2 of 5 matrix (the empty text: the others are in bc-delphi-linear)
          { expression: q(''), TYP: BarType.MAT25, RATIO: dbl(2) },
          // Code 39: unknown characters skipped, checksum, ratios
          { expression: q('CODE 39'), TYP: BarType.C39, MODUL: 8 },
          { expression: q('ABC-123.$/+%'), TYP: BarType.C39, MODUL: 6, CHECKSUM: true },
          { expression: q('lower*X'), TYP: BarType.C39, MODUL: 7, RATIO: dbl(3) },
          { expression: q('9'), TYP: BarType.C39, MODUL: 10, CHECKSUM: true, TRANSPARENT: false },
          // Code 39 extended
          { expression: q('Code39ext!'), TYP: BarType.C39X, MODUL: 5 },
          { expression: q('a-b.c ~ é'), TYP: BarType.C39X, MODUL: 5, CHECKSUM: true },
          // Code 93 and extended
          { expression: q('CODE93'), TYP: BarType.C93, MODUL: 8 },
          { expression: q('THE QUICK BROWN FOX 0123456789-.$/+%'), TYP: BarType.C93, MODUL: 3, WIDTH: 3400 },
          { expression: q('Hello, World!'), TYP: BarType.C93X, MODUL: 4 },
          { expression: q('code93 extended é'), TYP: BarType.C93X, MODUL: 3, TRANSPARENT: false },
          // MSI, PostNet and Codabar (more of them in bc-delphi-linear)
          { expression: q('123456'), TYP: BarType.MSI },
          { expression: q('12345'), TYP: BarType.POSTNET },
          { expression: q('A1234B'), TYP: BarType.CODABAR },
          // EAN-8 and EAN-13: lengths, checksum, ratios (no effect), text too short
          { expression: q('96385074'), TYP: BarType.EAN8, MODUL: 15 },
          { expression: q('9638507'), TYP: BarType.EAN8, MODUL: 15, CHECKSUM: true },
          { expression: q('12'), TYP: BarType.EAN8, CHECKSUM: true, TRANSPARENT: false },
          { expression: q('1234567'), TYP: BarType.EAN8 },
          { expression: q('5449000000996'), TYP: BarType.EAN13, MODUL: 12 },
          { expression: q('544900000099'), TYP: BarType.EAN13, MODUL: 12, CHECKSUM: true },
          { expression: q('4006381333931'), TYP: BarType.EAN13, CHECKSUM: true, TRANSPARENT: false, BCOLOR: 8388608 },
          { expression: q('400638133393123'), TYP: BarType.EAN13, MODUL: 9 },
          { expression: q('123'), TYP: BarType.EAN13 },
          { expression: q('9780201379624'), TYP: BarType.EAN13, MODUL: 14, RATIO: dbl(2.6) },
          { expression: q(''), TYP: BarType.EAN13, CHECKSUM: true },
          // A number formatted with the display format
          { expression: '1234567.5', TYP: BarType.I25, DISPLAYFORMAT: '00000000', caption: 'format 00000000' },
          { expression: '12', TYP: BarType.EAN13, CHECKSUM: true, DISPLAYFORMAT: '000000000000', caption: 'EAN13 of 12' },
          { expression: 'NULL', TYP: BarType.C128, caption: 'null' },
        ],
      ),
    ),
  ],
});

// Code 128: the fixed code sets and the shortest switching of A, B and C (automatic), FNC1 (the
// character U+00BF) for GS1-128, characters the code sets do not have.
report('bc-code128.rep', {
  subs: [
    subreport(
      '',
      grid(
        [
          { expression: q('Code 128 B'), TYP: BarType.C128B },
          { expression: q('lower in A'), TYP: BarType.C128A },
          { expression: q('CTRL') + '+#9+' + q('TAB'), TYP: BarType.C128A, caption: 'A with a tab' },
          { expression: q('123456'), TYP: BarType.C128C },
          { expression: q('12345'), TYP: BarType.C128C },
          { expression: q('12AB3456'), TYP: BarType.C128C },
          { expression: q('A1B2C3'), TYP: BarType.C128C },
          { expression: q('1234567890'), TYP: BarType.C128 },
          { expression: q('123456789'), TYP: BarType.C128 },
          { expression: q('ABC123456DEF'), TYP: BarType.C128 },
          { expression: q('abc12def'), TYP: BarType.C128 },
          { expression: q('abc1234def'), TYP: BarType.C128 },
          { expression: q('AB') + '+#13+' + q('cd12'), TYP: BarType.C128, caption: 'AB CR cd12' },
          { expression: '#1+' + q('a') + '+#2+' + q('b'), TYP: BarType.C128, caption: 'ctrl a ctrl b' },
          { expression: q('X') + '+#9+#9+' + q('y'), TYP: BarType.C128, caption: 'X tab tab y' },
          { expression: q('¿0012345678901234567¿10L2511'), TYP: BarType.C128, MODUL: 6, WIDTH: 3400, caption: 'GS1 (00)...(10)L2511' },
          { expression: q('¿01095011010209171719050810ABCD1234'), TYP: BarType.C128, MODUL: 6, WIDTH: 3400, caption: 'GS1 (01)(17)(10)' },
          { expression: q('¿12'), TYP: BarType.C128B, caption: 'FNC1 in B' },
          { expression: q('1¿23'), TYP: BarType.C128C, caption: 'FNC1 in C' },
          { expression: q('Ñandú €'), TYP: BarType.C128, caption: 'non ASCII' },
          { expression: q('12a'), TYP: BarType.C128 },
          { expression: q('a12'), TYP: BarType.C128 },
          { expression: q('0'), TYP: BarType.C128 },
          { expression: q(''), TYP: BarType.C128 },
          { expression: q('`{|}~'), TYP: BarType.C128A, caption: 'B characters in A' },
          { expression: q('HELLO') + '+#10+' + q('world') + '+#10+' + q('1234'), TYP: BarType.C128, MODUL: 7, caption: 'mixed A B C' },
          { expression: q('9999') + '+#27+' + q('99'), TYP: BarType.C128, caption: 'C A C' },
          { expression: q('Ratio ignored'), TYP: BarType.C128, RATIO: dbl(3), MODUL: 8, TRANSPARENT: false },
        ],
      ),
    ),
  ],
});

// The symbologies the C# engine did not draw (MSI, PostNet, Codabar) or failed on (2 of 5 matrix),
// drawn as the Delphi engine draws them, and Code 93 (plain and extended) up to and over the 14
// characters after which the weight of its K check character restarts: values, modules, ratios
// (clamped to 2..3 for Codabar and 2.25..3 for the matrix), transparency and colour. No rotations:
// the box of a rotated bar is another in Delphi. Delphi is wrong in some of them (the check digit
// of MSI, the short bars of PostNet, the check characters of a long Code 93, Code 93 extended):
// barcode-delphi.test.ts tells each difference.
report('bc-delphi-linear.rep', {
  db: false,
  subs: [
    subreport(
      '',
      grid(
        [
          { expression: q('123456'), TYP: BarType.MSI, caption: 'msi 123456' },
          { expression: q('12345'), TYP: BarType.MSI, MODUL: 8, RATIO: dbl(2.5), caption: 'msi 12345' },
          { expression: q('0'), TYP: BarType.MSI, caption: 'msi 0' },
          { expression: q('98765432109876543210'), TYP: BarType.MSI, MODUL: 4, TRANSPARENT: false, caption: 'msi 20 digits' },
          { expression: q('80523'), TYP: BarType.MSI, MODUL: 9, RATIO: dbl(3), BCOLOR: 8388608, caption: 'msi 80523' },
          { expression: q(''), TYP: BarType.MSI, caption: 'msi empty' },
          { expression: q('12345'), TYP: BarType.POSTNET, caption: 'postnet 12345' },
          { expression: q('801221905'), TYP: BarType.POSTNET, MODUL: 6, RATIO: dbl(3), caption: 'postnet 801221905' },
          { expression: q('0123456789'), TYP: BarType.POSTNET, MODUL: 5, TRANSPARENT: false, BCOLOR: 255, caption: 'postnet 0123456789' },
          { expression: q(''), TYP: BarType.POSTNET, caption: 'postnet empty' },
          { expression: q('1234'), TYP: BarType.CODABAR, caption: 'codabar 1234' },
          { expression: q('0123456789-$:/.+'), TYP: BarType.CODABAR, MODUL: 5, RATIO: dbl(2.5), caption: 'codabar all' },
          { expression: q('40156'), TYP: BarType.CODABAR, MODUL: 8, RATIO: dbl(3.5), TRANSPARENT: false, caption: 'codabar 40156' },
          { expression: q('12.50+3'), TYP: BarType.CODABAR, MODUL: 7, RATIO: dbl(1.5), caption: 'codabar 12.50+3' },
          { expression: q(''), TYP: BarType.CODABAR, caption: 'codabar empty' },
          { expression: q('1234'), TYP: BarType.MAT25, caption: 'matrix 1234' },
          { expression: q('9081726354'), TYP: BarType.MAT25, MODUL: 6, RATIO: dbl(3.5), caption: 'matrix 9081726354' },
          { expression: q('5'), TYP: BarType.MAT25, MODUL: 8, RATIO: dbl(2), TRANSPARENT: false, caption: 'matrix 5' },
          { expression: q('CODE93'), TYP: BarType.C93, MODUL: 8, caption: 'code93 CODE93' },
          { expression: q('ABCDEFGHIJKLMN'), TYP: BarType.C93, MODUL: 4, caption: 'code93 14' },
          { expression: q('ABCDEFGHIJKLMNO'), TYP: BarType.C93, MODUL: 4, caption: 'code93 15' },
          { expression: q('THE QUICK BROWN FOX 0123456789-.$/+%'), TYP: BarType.C93, MODUL: 3, WIDTH: 3400, caption: 'code93 36' },
          { expression: q('Code 93x'), TYP: BarType.C93X, MODUL: 4, caption: 'code93x Code 93x' },
          { expression: q('Hello, World!'), TYP: BarType.C93X, MODUL: 4, caption: 'code93x Hello, World!' },
        ],
      ),
    ),
  ],
});

// Rotations: the bars as axis-aligned rectangles around the corner (1D), the centre (QR) or the
// origin (PDF417).
const rotations = [0, 300, 450, 900, 1350, 1800, 2700, 3150, -900, 3600, 125];
report('bc-rotation.rep', {
  subs: [
    subreport(
      '',
      grid(
        [
          ...rotations.map((r) => ({ expression: q('5449000000996'), TYP: BarType.EAN13, ROTATION: r, DX: 1200, DY: 450, WIDTH: 1500, HEIGHT: 400, caption: 'EAN13 ' + r })),
          ...rotations.map((r) => ({ expression: q('ROT 128'), TYP: BarType.C128, MODUL: 7, ROTATION: r, TRANSPARENT: r % 900 !== 0, DX: 1200, DY: 450, WIDTH: 1500, HEIGHT: 300, caption: 'C128 ' + r })),
          ...rotations.map((r) => ({ expression: q('QR rotated'), TYP: BarType.QR, ROTATION: r, DX: 500, WIDTH: 1000, HEIGHT: 800, TRANSPARENT: r === 0, caption: 'QR ' + r })),
          ...rotations.map((r) => ({ expression: q('PDF417'), TYP: BarType.PDF417, MODUL: 4, ROTATION: r, DX: 1400, DY: 400, HEIGHT: 300, NUMCOLUMNS: 2, caption: 'PDF417 ' + r })),
        ],
        { cols: 3, cellW: 3580, cellH: 1600, rowsPerSection: 3 },
      ),
    ),
  ],
});

// QR: error correction levels (2 L, 3 M, 4 Q, 5 H, anything else L), modes (numeric,
// alphanumeric, byte, Latin-1), versions from 1 to 40, item boxes wider and taller than high.
const LONG = 'Report Manager is a reporting application (Delphi, .NET, TypeScript). ';
report('bc-qr.rep', {
  subs: [
    subreport(
      '',
      grid(
        [
          { expression: q('Hello'), ECCLEVEL: -1 },
          { expression: q('Hello'), ECCLEVEL: 2 },
          { expression: q('Hello'), ECCLEVEL: 3 },
          { expression: q('Hello'), ECCLEVEL: 4 },
          { expression: q('Hello'), ECCLEVEL: 5 },
          { expression: q('Hello'), ECCLEVEL: 1 },
          { expression: q('Hello'), ECCLEVEL: 8 },
          { expression: q('0123456789012345'), ECCLEVEL: 3 },
          { expression: q('HTTPS://REPORTMAN.ES/QR-CODE 123'), ECCLEVEL: 4 },
          { expression: q('https://reportman.es/?q=qr&lang=en'), ECCLEVEL: 2 },
          { expression: q('Año, pingüino, café, ½ ©'), ECCLEVEL: 3, caption: 'Latin-1' },
          { expression: q(LONG.repeat(2)), ECCLEVEL: 3, caption: 'version ~8' },
          { expression: q(LONG.repeat(6)), ECCLEVEL: 2, caption: 'version ~17' },
          { expression: q('1234567890'.repeat(70)), ECCLEVEL: 5, caption: '700 digits H' },
          { expression: q('A'), WIDTH: 2500, HEIGHT: 900, caption: 'wide box' },
          { expression: q('B'), WIDTH: 900, HEIGHT: 1000, caption: 'tall box' },
          { expression: q('C'), WIDTH: 3000, HEIGHT: 300, caption: 'flat box' },
          { expression: q('Colours'), BCOLOR: 8388736, BACKCOLOR: 65535, TRANSPARENT: false },
          { expression: q('Default back colour'), TRANSPARENT: false, BACKCOLOR: -168 },
          { expression: '12345', DISPLAYFORMAT: '#,##0.00', caption: 'formatted number' },
          { expression: q('x').repeat(1) + "+'\r\n'+" + q('line 2'), caption: 'CR LF' },
          // Characters outside ISO-8859-1 (ZXing.Net writes '?')
          { expression: q('Euro € and 日本'), ECCLEVEL: 3, caption: 'outside Latin-1' },
          { expression: q('Emoji 😀 pair'), caption: 'surrogate pair' },
        ].map((c) => ({ TYP: BarType.QR, WIDTH: 1000, HEIGHT: 1000, ...c })),
        { cols: 3, cellW: 3580, cellH: 1400, rowsPerSection: 4 },
      ),
    ),
  ],
});

// QR of the longest content: version 40.
report('bc-qr40.rep', {
  subs: [
    subreport('', [
      section('detail', { HEIGHT: 9000 }, [barcode(q('9'.repeat(7089)), { TYP: BarType.QR, WIDTH: 9000, HEIGHT: 9000, ECCLEVEL: 2 })]),
      section('detail', { HEIGHT: 9000 }, [barcode(q('Z'.repeat(1852)), { TYP: BarType.QR, WIDTH: 9000, HEIGHT: 9000, ECCLEVEL: 4 })]),
    ]),
  ],
});

// QR versions at their capacity (the data fills the last byte partly: the version ZXing.Net
// chooses) and one character over it, in byte, alphanumeric and numeric modes, at each level.
const QR_CAPACITY = {
  // level: [byte v1, v2, v3], [alphanumeric v1, v2], [numeric v1, v2]
  2: [[17, 32, 53], [25, 47], [41, 77]],
  3: [[14, 26, 42], [20, 38], [34, 63]],
  4: [[11, 20, 32], [16, 29], [27, 48]],
  5: [[7, 14, 24], [10, 20], [17, 34]],
};
const fill = (alphabet, n) => Array.from({ length: n }, (_, i) => alphabet[(i * 7) % alphabet.length]).join('');
const qrVersions = [];
for (const [level, [bytes, alnum, numeric]] of Object.entries(QR_CAPACITY)) {
  for (const n of bytes) qrVersions.push({ expression: q(fill('abcdefghijklmnopqrstuvwxyz', n)), ECCLEVEL: Number(level), caption: `byte ${n} ecc ${level}` });
  qrVersions.push({ expression: q(fill('abcdefghijklmnopqrstuvwxyz', bytes[0] + 1)), ECCLEVEL: Number(level), caption: `byte ${bytes[0] + 1} ecc ${level}` });
  for (const n of alnum) qrVersions.push({ expression: q(fill('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 $%*+-./:', n)), ECCLEVEL: Number(level), caption: `alnum ${n} ecc ${level}` });
  for (const n of numeric) qrVersions.push({ expression: q(fill('0123456789', n)), ECCLEVEL: Number(level), caption: `numeric ${n} ecc ${level}` });
}
report('bc-qr-versions.rep', {
  subs: [
    subreport(
      '',
      grid(
        qrVersions.map((c) => ({ TYP: BarType.QR, WIDTH: 900, HEIGHT: 900, ...c })),
        { cols: 4, cellW: 2680, cellH: 1200, rowsPerSection: 4 },
      ),
    ),
  ],
});

// PDF417 error correction levels 7 and 8 (256 and 512 codewords) and the automatic level by the
// amount of data (3 below 161 codewords, 4 below 321, 5 above).
report('bc-pdf417-ecc.rep', {
  subs: [
    subreport('', [
      section('detail', { HEIGHT: 2000 }, [
        barcode(q('ECC level 7'), { TYP: BarType.PDF417, ECCLEVEL: 7, MODUL: 1, NUMCOLUMNS: 12, WIDTH: 3000, HEIGHT: 1800 }),
        barcode(q('ECC level 8'), { TYP: BarType.PDF417, ECCLEVEL: 8, MODUL: 1, NUMCOLUMNS: 16, POSX: 3500, WIDTH: 3000, HEIGHT: 1800 }),
        barcode(q('1234567890'.repeat(30)), { TYP: BarType.PDF417, MODUL: 1, NUMCOLUMNS: 8, POSX: 7000, WIDTH: 3000, HEIGHT: 1800 }),
      ]),
      section('detail', { HEIGHT: 2000 }, [
        barcode(q('Report Manager, the reporting tool. '.repeat(14)), { TYP: BarType.PDF417, MODUL: 1, NUMCOLUMNS: 14, WIDTH: 3000, HEIGHT: 1800 }),
        barcode(q('Report Manager, the reporting tool. '.repeat(24)), { TYP: BarType.PDF417, MODUL: 1, NUMCOLUMNS: 20, POSX: 3500, WIDTH: 3000, HEIGHT: 1800 }),
        barcode(q('xy'), { TYP: BarType.PDF417, MODUL: 2, NUMROWS: 30, POSX: 7000, WIDTH: 3000, HEIGHT: 1800 }),
      ]),
    ]),
  ],
});

// PDF417: rows and columns (given, one of them, none), error correction levels (Auto and 0 to
// 8), truncated, the compaction modes (numeric, text submodes, binary, multiples of six) and the
// escapes of the text compaction.
report('bc-pdf417.rep', {
  subs: [
    subreport(
      '',
      grid(
        [
          { expression: q('123456789'), NUMCOLUMNS: 3, NUMROWS: 5, MODUL: 5 },
          { expression: q('Report Manager'), MODUL: 4 },
          { expression: q('Report Manager'), NUMCOLUMNS: 4, MODUL: 3 },
          { expression: q('Report Manager'), NUMROWS: 6, MODUL: 3 },
          { expression: q('Truncated'), NUMCOLUMNS: 3, TRUNCATED: true, MODUL: 4 },
          ...[0, 1, 2, 3, 4, 5].map((l) => ({ expression: q('ECC level ' + l), ECCLEVEL: l, MODUL: 2, caption: 'ECC ' + l })),
          { expression: q('ECC level 6'), ECCLEVEL: 6, MODUL: 2, NUMCOLUMNS: 8, HEIGHT: 900 },
          { expression: q('12345678901234567890'), MODUL: 3, caption: 'numeric' },
          { expression: q('Num 0012345678901234567890123456789012345678901234567890 end'), MODUL: 2, NUMCOLUMNS: 6, caption: 'text numeric text' },
          { expression: q('aBcDeF gHiJ'), MODUL: 3, caption: 'lower upper' },
          { expression: q('A1;b2#C3@d4&e'), MODUL: 3, caption: 'mixed punct' },
          { expression: q('!!!*** (punct) ???'), MODUL: 3, caption: 'punctuation' },
          { expression: q('tab') + '+#9+' + q('cr') + '+#13+#10+' + q('lf'), MODUL: 3, caption: 'tab cr lf' },
          { expression: q('Ñandú, ¿qué? and text'), MODUL: 3, caption: 'binary Latin-1' },
          { expression: q('ÀÁÂÃÄÅ then text'), MODUL: 3, caption: 'binary 6' },
          { expression: q('ÀÁÂÃÄÅÆÇÈÉÊË x'), MODUL: 3, caption: 'binary 12' },
          { expression: q('a€b end of it'), MODUL: 3, caption: 'non Latin-1' },
          { expression: q('esc \\065\\066 \\X41 \\\\ end'), MODUL: 3, NUMCOLUMNS: 4, caption: 'escapes' },
          { expression: q('cw \\C900\\C913 x'), MODUL: 3, NUMCOLUMNS: 4, caption: 'codewords' },
          { expression: q('\\C12'), MODUL: 3, caption: 'codeword at end' },
          { expression: q('Lorem ipsum dolor sit amet, consectetur adipiscing elit. 0123456789 '.repeat(3)), MODUL: 2, NUMCOLUMNS: 6, HEIGHT: 900, caption: 'long text' },
          { expression: q(''), MODUL: 3, caption: 'empty' },
          { expression: q('Colour'), MODUL: 3, BCOLOR: 32768 },
        ].map((c) => ({ TYP: BarType.PDF417, WIDTH: 3400, HEIGHT: 700, ...c })),
        { cols: 3, cellW: 3580, cellH: 1150, rowsPerSection: 4 },
      ).concat([
        // The barcode of the sample testpdf417.rep (repsamples of the Delphi repository)
        section('detail', { HEIGHT: 2200 }, [
          barcode(q('123456789'), { TYP: BarType.PDF417, POSX: 500, WIDTH: 4000, HEIGHT: 2000, MODUL: 20, NUMCOLUMNS: 3, NUMROWS: 5, TRANSPARENT: false }),
        ]),
      ]),
    ),
  ],
});

// PDF417 against Delphi: the texts of barcode-delphi-cases.json, the compaction modes at their
// edges (the last characters of a text, the digits that make a numeric compaction, a character
// the text compaction does not have after text), sizes and error correction levels. Those marked
// "delphi" there are the ones the Delphi engine encodes wrong.
const delphiCases = JSON.parse(fs.readFileSync(path.resolve(here, '../barcode-delphi-cases.json'), 'utf8'));
report('bc-delphi-pdf417.rep', {
  db: false,
  subs: [
    subreport(
      '',
      grid(
        delphiCases.pdf417.map(({ caption, text, expect: _expect, delphi: _delphi, ...o }) => ({
          expression: q(text), caption, TYP: BarType.PDF417, MODUL: 2, WIDTH: 3400, HEIGHT: 700, ...o,
        })),
        { cols: 3, cellW: 3580, cellH: 1150, rowsPerSection: 4 },
      ),
    ),
  ],
});

// Data from samples.db: Code 128, QR and EAN-13 of each product, and BARCODEOP in the before
// print expression of the section.
report('bc-data.rep', {
  data: [datainfo('PRO', 'SELECT PRODUCT_ID, SKU, EAN13, NAME, UNIT_PRICE FROM PRODUCTS ORDER BY PRODUCT_ID LIMIT 24')],
  subs: [
    subreport('PRO', [
      section(
        'detail',
        {
          HEIGHT: 1100,
          DOBEFOREPRINT: "BARCODEOP(8600,CURRENTPOSY+100,2000,500,'PRO.SKU','',8,7,2,0,False,128)",
          DOAFTERPRINT: "BARCODEOP(8600,CURRENTPOSY-400,2000,300,'PRO.PRODUCT_ID*1000+7','0000000',0,9,2.5,0,True,0)",
        },
        [
          expr('PRO.NAME', { WIDTH: 3500 }),
          barcode('PRO.EAN13', { POSY: 250, WIDTH: 2200, HEIGHT: 600, MODUL: 15, TYP: BarType.EAN13 }),
          barcode('PRO.SKU', { POSX: 2500, POSY: 250, WIDTH: 2500, HEIGHT: 600, MODUL: 9, TYP: BarType.C128 }),
          barcode("PRO.SKU+' '+PRO.NAME", { POSX: 5300, POSY: 0, WIDTH: 1000, HEIGHT: 1000, TYP: BarType.QR, ECCLEVEL: 3 }),
          barcode('PRO.UNIT_PRICE', { POSX: 6500, POSY: 100, WIDTH: 1800, HEIGHT: 500, TYP: BarType.PDF417, MODUL: 3, DISPLAYFORMAT: '#,##0.00' }),
        ],
      ),
    ]),
  ],
});

// BARCODEOP: every symbology through the report function (modules, ratios, rotations, checksum,
// colour), in the before print expressions of the sections.
const ops = [
  "BARCODEOP(574,CURRENTPOSY,3000,500,'''5449000000996''','',15,12,2,0,False,0)",
  "BARCODEOP(4000,CURRENTPOSY,3000,500,'''544900000099''','',15,12,2,0,True,255)",
  "BARCODEOP(7500,CURRENTPOSY,3000,500,'''9638507''','',14,15,2,0,True,0)",
  "BARCODEOP(574,CURRENTPOSY+700,3000,500,'''CODE 39''','',3,8,2.5,0,True,0)",
  "BARCODEOP(4000,CURRENTPOSY+700,3000,500,'''Code 93''','',10,5,2,0,False,0)",
  "BARCODEOP(7500,CURRENTPOSY+700,3000,500,'''ABC123def''','',8,7,2,0,False,0)",
  "BARCODEOP(574,CURRENTPOSY+1400,3000,500,'''12345678''','',0,9,3,0,False,0)",
  "BARCODEOP(4000,CURRENTPOSY+1400,3000,500,'''4321''','',1,9,2,0,False,0)",
  "BARCODEOP(7500,CURRENTPOSY+1400,3000,400,'''Op PDF417''','',16,4,2,0,False,0)",
  "BARCODEOP(1500,CURRENTPOSY+2600,1500,400,'''Rotated''','',6,8,2,90,False,0)",
  "BARCODEOP(5000,CURRENTPOSY+2600,1500,400,'''Rotated''','',6,8,2,45.5,False,0)",
  "BARCODEOP(8500,CURRENTPOSY+2600,1500,400,'''QR draws nothing''','',17,8,2,0,False,0)",
  "BARCODEOP(574,CURRENTPOSY+3300,3000,400,'123456','00000000',0,9,2,0,False,0)",
  "BARCODEOP(4000,CURRENTPOSY+3300,3000,400,'''4321''','',2,9,2.5,0,False,0)",
  "BARCODEOP(7500,CURRENTPOSY+3300,3000,400,'''24680''','',11,9,2,0,False,0)",
  "BARCODEOP(574,CURRENTPOSY+3900,3000,400,'''28001''','',12,9,2,0,False,255)",
  "BARCODEOP(4000,CURRENTPOSY+3900,3000,400,'''12-34''','',13,9,2,0,False,0)",
];
report('bc-op.rep', {
  subs: [
    subreport('', [
      section('detail', { HEIGHT: 3800, DOBEFOREPRINT: ops.slice(0, 7).join(';') }, [label('BARCODEOP 1', { POSY: 3500 })]),
      section('detail', { HEIGHT: 4600, DOBEFOREPRINT: ops.slice(7).join(';') }, [expr(ops[0].replace('CURRENTPOSY', '3000'), { POSY: 4400, WIDTH: 3000 })]),
    ]),
  ],
});

// The errors of the C# engine, a report each.
const errorCases = {
  'bc-err-matrix': { expression: q('1A'), TYP: BarType.MAT25 },
  'bc-err-msi': { expression: q('12A4'), TYP: BarType.MSI },
  'bc-err-postnet': { expression: q('1234-5'), TYP: BarType.POSTNET },
  'bc-err-codabar': { expression: q('12E4'), TYP: BarType.CODABAR },
  'bc-err-i25': { expression: q('12A4'), TYP: BarType.I25 },
  'bc-err-code93': { expression: q('lower'), TYP: BarType.C93 },
  'bc-err-ean13': { expression: q('12345678901A'), TYP: BarType.EAN13, CHECKSUM: true },
  'bc-err-ean13b': { expression: q('A234567890123'), TYP: BarType.EAN13 },
  'bc-err-ean8': { expression: q('1234567X'), TYP: BarType.EAN8 },
  'bc-err-code128c': { expression: q('12') + '+#9', TYP: BarType.C128C },
  'bc-err-qrempty': { expression: q(''), TYP: BarType.QR },
  'bc-err-qrbig': { expression: q('x'.repeat(3000)), TYP: BarType.QR, ECCLEVEL: 5 },
  'bc-err-pdf417big': { expression: q('Too big'), TYP: BarType.PDF417, NUMCOLUMNS: 1, NUMROWS: 3 },
  'bc-err-pdf417x': { expression: q('hex \\X4'), TYP: BarType.PDF417 },
  'bc-err-pdf417cw': { expression: q('cw \\C999'), TYP: BarType.PDF417 },
  'bc-err-pdf417neg': { expression: q('cw \\C-12'), TYP: BarType.PDF417 },
  'bc-err-pdf417esc': { expression: q('esc \\200 no text value'), TYP: BarType.PDF417 },
  'bc-err-pdf417ecc': { expression: q('ecc 9'), TYP: BarType.PDF417, ECCLEVEL: 9 },
  'bc-err-pdf417rows': { expression: q('rows'), TYP: BarType.PDF417, NUMCOLUMNS: 1, NUMROWS: 99 },
  'bc-err-expression': { expression: 'UNKNOWNFN(1)', TYP: BarType.C128 },
};
for (const [name, c] of Object.entries(errorCases)) {
  const { expression, ...o } = c;
  report(name + '.rep', { subs: [subreport('', [section('detail', { HEIGHT: 1000 }, [barcode(expression, { WIDTH: 3000, HEIGHT: 800, ...o })])])] });
}
report('bc-err-op.rep', {
  subs: [subreport('', [section('detail', { HEIGHT: 1000, DOBEFOREPRINT: "BARCODEOP(574,0,3000,500,'''1A''','',2,10,2,0,False,0)" }, [label('op')])])],
});

console.log(written.join('\n'));
