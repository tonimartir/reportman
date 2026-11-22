// The text output of the C# engine (PrintOutText as the device of the run, golden-cs run --text)
// for the samples of run-cases.json of the engine, some synthetic reports of the engine, and the
// synthetic reports of the text device written here (syn-text*.rep). Each case runs with a printer
// driver; the layout differs by driver (the steps a driver prints change the measure), so each
// case keeps its layout too. Also the code page tables of .NET (golden-cs encoding).
//
//   test/fixtures/text/cases.json        the cases, their driver and the clock of the C# run
//   test/fixtures/text/NAME.txt          the bytes PrintOutText writes
//   test/fixtures/text/NAME.layout.json  the objects of the metafile of the run (class, left, top,
//                                        width, height, text or the barcode): the layout on the grid
//   test/fixtures/text/cpNNN.json        what .NET writes for each UTF-16 code unit
//   test/fixtures/text/syn-text*.rep     the synthetic reports
//
//   node test/generate-text-fixtures.mjs        (from packages/reportman-export; golden-cs built)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const exe = path.join(root, 'typescript/tools/golden-cs/bin/Release/net10.0/golden-cs.exe');
const engineTest = path.join(root, 'typescript/packages/reportman-engine/test');
const db = path.join(root, 'samples/samples.db');
const out = path.join(here, 'fixtures/text');
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (/\.(txt|layout\.json)$/.test(f)) fs.rmSync(path.join(out, f));

// ---------------------------------------------------------------------------------------------
// The synthetic reports (the XML of a report saved by the designer, as the engine's make-reports)

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

function prop(name, value) {
  if (typeof value === 'boolean') return `<${name} type="Boolean">${value ? 'True' : 'False'}</${name}>`;
  if (typeof value === 'number') return `<${name} type="Integer">${value}</${name}>`;
  return `<${name} type="WideString">${enc(value)}</${name}>`;
}

const props = (obj) => Object.entries(obj).map(([k, v]) => prop(k, v)).join('\n');

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
  DOCCREATOR: 'Report Manager', DOCPRODUCER: '', DOCSUBJECT: '', DOCTITLE: 'Synthetic', DOCCREATIONDATE: '',
  DOCMODIFICATIONDATE: '', DOCKEYWORDS: '', DOCXMPCONTENT: '',
};

const DATABASE = `<DATABASEINFO>\n${props({
  ALIAS: 'SAMPLES', NAME: 'TRpDatabaseInfoItem0', CONFIGFILE: '', LOADPARAMS: false, LOADDRIVERPARAMS: false,
  LOGINPROMPT: false, DRIVER: 8, REPORTTABLE: 'REPMAN_REPORTS', REPORTSEARCHFIELD: 'REPORT_NAME', REPORTFIELD: 'REPORT',
  REPORTGROUPSTABLE: 'REPMAN_GROUPS', ADOCONNECTIONSTRING: '', DOTNETDRIVER: 0, PROVIDERFACTORY: '',
})}\n</DATABASEINFO>`;

function datainfo(alias, sql) {
  return `<DATAINFO>\n${props({
    ALIAS: alias, NAME: 'TRpDataInfoItem0', DATABASEALIAS: 'SAMPLES', SQL: sql, DATASOURCE: '',
    MYBASEFILENAME: '', MYBASEFIELDS: '', MYBASEINDEXFIELDS: '', MYBASEMASTERFIELDS: '', BDEINDEXFIELDS: '',
    BDEINDEXNAME: '', BDETABLE: '', BDETYPE: 0, BDEFILTER: '', BDEMASTERFIELDS: '', BDEFIRSTRANGE: '',
    BDELASTRANGE: '', DATAUNIONS: '', GROUPUNION: false, OPENONSTART: true, PARALLELUNION: false,
  })}\n</DATAINFO>`;
}

let compCount = 0;
const TEXT_DEFAULTS = {
  WFONTNAME: 'Arial', LFONTNAME: 'Helvetica', BIDIMODE: 0, TYPE1FONT: 0, FONTSIZE: 10, FONTROTATION: 0,
  FONTSTYLE: 0, FONTCOLOR: 0, BACKCOLOR: 16777215, TRANSPARENT: true, CUTTEXT: false, ALIGNMENT: 0, VALIGNMENT: 0,
  INTERLINE: 0, WORDWRAP: false, WORDBREAK: false, SINGLELINE: false, MULTIPAGE: false, PRINTSTEP: 0,
};
const HEAD_KEYS = ['WIDTH', 'HEIGHT', 'POSX', 'POSY'];

function head(cls, prefix, o) {
  return props({
    NAME: prefix + compCount++, CLASSNAME: cls, WIDTH: o.WIDTH ?? 1440, HEIGHT: o.HEIGHT ?? 275, PRINTCONDITION: '',
    DOBEFOREPRINT: '', DOAFTERPRINT: '', ANNOTATION: '', POSX: o.POSX ?? 0, POSY: o.POSY ?? 0, ALIGN: 0,
  });
}

const textProps = (o) => ({ ...TEXT_DEFAULTS, ...Object.fromEntries(Object.entries(o).filter(([k]) => !HEAD_KEYS.includes(k) && k in TEXT_DEFAULTS)) });

function label(text, o = {}) {
  return `<COMPONENT>\n${head('TRPLABEL', 'TRpLabel', o)}\n${props(textProps(o))}\n${prop('WIDETEXT', text)}\n</COMPONENT>`;
}

function expr(expression, o = {}) {
  return `<COMPONENT>\n${head('TRPEXPRESSION', 'TRpExpression', o)}\n${props({
    ...textProps(o), EXPRESSION: expression, AGINIVALUE: '0', EXPORTEXPRESSION: '', DATATYPE: 16,
    DISPLAYFORMAT: o.DISPLAYFORMAT ?? '', IDENTIFIER: '', AGGREGATE: o.AGGREGATE ?? 0, GROUPNAME: '', AGTYPE: 0,
    AUTOEXPAND: o.AUTOEXPAND ?? false, AUTOCONTRACT: false, PRINTONLYONE: false, PRINTNULLS: true,
    EXPORTDISPLAYFORMAT: '', EXPORTLINE: 0, EXPORTPOSITION: 0, EXPORTSIZE: 1, EXPORTDONEWLINE: false,
  })}\n</COMPONENT>`;
}

/** A QR barcode item (TYP 17); ECCLEVEL 2 L, 3 M, 4 Q, 5 H. */
function qr(expression, o = {}) {
  return `<COMPONENT>\n${head('TRPBARCODE', 'TRpBarcode', o)}\n${props({ EXPRESSION: expression, MODUL: 10 })}\n<RATIO type="Double">2</RATIO>\n${props({
    TYP: 17, CHECKSUM: false, DISPLAYFORMAT: '', ROTATION: 0, BCOLOR: 0, BACKCOLOR: 16777215, TRANSPARENT: true,
    NUMCOLUMNS: 0, NUMROWS: 0, ECCLEVEL: o.ECCLEVEL ?? -1, TRUNCATED: false,
  })}\n</COMPONENT>`;
}

let secCount = 0;
const SECTION_TYPES = { pageheader: 0, detail: 2, pagefooter: 4 };
function section(type, o, components) {
  return `<SECTION>\n${props({
    NAME: 'TRpSection' + secCount++, WIDTH: o.WIDTH ?? 10758, HEIGHT: o.HEIGHT ?? 300, PRINTCONDITION: '',
    DOBEFOREPRINT: '', DOAFTERPRINT: '', SUBREPORT: 'TRpSubReport0', GROUPNAME: '', CHANGEEXPRESSION: '',
    BEGINPAGEEXPRESSION: '', SKIPEXPREV: '', SKIPEXPREH: '', SKIPTOPAGEEXPRE: '', BACKEXPRESSION: '', CHANGEBOOL: false,
    PAGEREPEAT: false, FORCEPRINT: false, SKIPPAGE: false, ALIGNBOTTOM: false, SECTIONTYPE: SECTION_TYPES[type],
    AUTOEXPAND: o.AUTOEXPAND ?? false, AUTOCONTRACT: o.AUTOCONTRACT ?? false, HORZDESP: false, VERTDESP: false,
    EXTERNALFILENAME: '', EXTERNALCONNECTION: '', EXTERNALTABLE: 'REPMAN_REPORTS', EXTERNALFIELD: 'REPORT',
    EXTERNALSEARCHFIELD: 'REPORT_NAME', EXTERNALSEARCHVALUE: '', STREAMFORMAT: 1, SKIPRELATIVEH: false,
    SKIPRELATIVEV: false, SKIPTYPE: 0, ININUMPAGE: false, GLOBAL: false, DPIRES: 100, CACHEDIMAGE: 0, BACKSTYLE: 0,
    DRAWSTYLE: 2,
  })}\n${components.join('\n')}\n</SECTION>`;
}

function report(file, reportProps, data, sections) {
  const xml = `<?xml version="1.0" standalone="no"?>\n<!DOCTYPE REPORT_MANAGER_2>\n<REPORT>\n${props({ ...REPORT_DEFAULTS, ...reportProps })}\n${DATABASE}\n${data}\n<SUBREPORT>\n${props({
    NAME: 'TRpSubReport0', ALIAS: 'D', PRINTONLYIFDATAAVAILABLE: true, REOPENONPRINT: true,
  })}\n${sections.join('\n')}\n</SUBREPORT>\n</REPORT>\n`;
  fs.writeFileSync(path.join(out, file), xml);
  compCount = 0;
  secCount = 0;
}

// The character grid: alignments (left, right, centre, justify, bottom, vertical centre), single
// line, word wrap, cut text, every font size step and every explicit step, styles, right to left,
// rotation, texts on top of each other, line breaks, and characters outside code page 850.
const LONG = 'The quick brown fox jumps over the lazy dog, again and again: until the line wraps; twice.';
const row = (n) => 120 + n * 240;
report('syn-text.rep', {}, datainfo('D', 'SELECT GREETING_ID, LANGUAGE, NATIVE_NAME, GREETING, DIRECTION FROM GREETINGS ORDER BY GREETING_ID'), [
  section('pageheader', { HEIGHT: 9000 }, [
    label('Left', { POSY: row(0), WIDTH: 3000 }),
    label('Right', { POSX: 3000, POSY: row(0), WIDTH: 3000, ALIGNMENT: 1 }),
    label('Centre', { POSX: 6000, POSY: row(0), WIDTH: 3000, ALIGNMENT: 2 }),
    label('Bottom', { POSY: row(1), WIDTH: 1500, HEIGHT: 720, VALIGNMENT: 1 }),
    label('VCentre', { POSX: 1600, POSY: row(1), WIDTH: 1500, HEIGHT: 720, VALIGNMENT: 2 }),
    label('First line\r\nSecond line\r\nThird', { POSX: 3200, POSY: row(1), WIDTH: 2000, HEIGHT: 720 }),
    label('One\r\nsingle line', { POSX: 5300, POSY: row(1), WIDTH: 2500, SINGLELINE: true }),
    label('rotated', { POSX: 8000, POSY: row(1), WIDTH: 900, HEIGHT: 500, FONTROTATION: 900 }),
    label(LONG, { POSY: row(4), WIDTH: 3000, HEIGHT: 240, WORDWRAP: true }),
    label(LONG, { POSX: 3200, POSY: row(4), WIDTH: 3000, HEIGHT: 480, WORDWRAP: true, CUTTEXT: true }),
    label(LONG, { POSX: 6400, POSY: row(4), WIDTH: 4000, HEIGHT: 240, WORDWRAP: true, ALIGNMENT: 3 }),
    label(LONG, { POSY: row(10), WIDTH: 2500, HEIGHT: 240, WORDWRAP: true, ALIGNMENT: 1 }),
    label(LONG, { POSX: 2700, POSY: row(10), WIDTH: 2500, HEIGHT: 240, WORDWRAP: true, ALIGNMENT: 2 }),
    label('Averyveryverylongwordthatdoesnotfitinthebox', { POSX: 5400, POSY: row(10), WIDTH: 1500, HEIGHT: 240, WORDWRAP: true }),
    label('No wrap, too long for its box', { POSX: 7100, POSY: row(10), WIDTH: 1500 }),
    ...[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20].map((size, i) =>
      label('Size ' + size, { POSX: i < 6 ? 0 : 5400, POSY: row(16 + (i % 6)), WIDTH: 5000, FONTSIZE: size })),
    ...[1, 2, 3, 4, 5, 6, 7].map((step, i) =>
      label('Step ' + step + ' 1234567890', { POSX: i < 4 ? 0 : 5400, POSY: row(23 + (i % 4)), WIDTH: 5000, PRINTSTEP: step })),
    ...[1, 2, 4, 8, 3].map((style, i) => label('Style ' + style, { POSX: i * 2000, POSY: row(28), WIDTH: 1900, FONTSTYLE: style })),
    label('Right to left', { POSY: row(29), WIDTH: 3000, BIDIMODE: 1 }),
    label('AAAAAAAAAAAAAAAAAAAA', { POSX: 3200, POSY: row(29), WIDTH: 3000 }),
    label('BBBB', { POSX: 3700, POSY: row(29), WIDTH: 1000 }),
    label('Cut at the page edge, it does not fit', { POSX: 9000, POSY: row(29), WIDTH: 3000 }),
    label('Año, ñandú, café, Ægir, Œuvre, 100 €, ā, ł, 中文, 😀, x́', { POSY: row(30), WIDTH: 10000 }),
    label('Size 8 and size 12 on one line', { POSY: row(31), WIDTH: 4000, FONTSIZE: 8 }),
    label('then 12', { POSX: 4500, POSY: row(31), WIDTH: 3000, FONTSIZE: 12 }),
    // Red for C# is the known color Red (-143 in .NET 10), never the RGB value 255
    label('Known red', { POSY: row(32), WIDTH: 2000, FONTCOLOR: -143 }),
    label('RGB red', { POSX: 2400, POSY: row(32), WIDTH: 2000, FONTCOLOR: 255 }),
    label('Red bold', { POSX: 4800, POSY: row(32), WIDTH: 2000, FONTCOLOR: -143, FONTSTYLE: 1 }),
  ]),
  section('detail', { HEIGHT: 240, AUTOEXPAND: true, AUTOCONTRACT: true }, [
    expr('D.GREETING_ID', { WIDTH: 500, ALIGNMENT: 1 }),
    expr('D.LANGUAGE', { POSX: 600, WIDTH: 1400 }),
    expr('D.NATIVE_NAME', { POSX: 2100, WIDTH: 1800 }),
    expr('D.GREETING', { POSX: 4000, WIDTH: 3500, WORDWRAP: true, AUTOEXPAND: true }),
    expr('D.DIRECTION', { POSX: 7600, WIDTH: 600 }),
  ]),
  section('pagefooter', { HEIGHT: 300 }, [expr("'Page '+STR(PAGE)", { WIDTH: 3000 }), expr('TODAY', { POSX: 6000, WIDTH: 3000, ALIGNMENT: 1, DISPLAYFORMAT: 'dd/MM/yyyy' })]),
]);

// A receipt: a custom page 80 mm wide at 8 lines per inch, no margins, the drawer opened before
// and after, amounts right aligned at several sizes.
report('syn-text-receipt.rep', {
  PAGESIZE: 2, PAGEWIDTH: 4535, PAGEHEIGHT: 11339, CUSTOMPAGEWIDTH: 4535, CUSTOMPAGEHEIGHT: 11339, LEFTMARGIN: 0,
  TOPMARGIN: 0, RIGHTMARGIN: 0, BOTTOMMARGIN: 0, LINESPERINCH: 800, REPORTACTIONDRAWERBEFORE: true, REPORTACTIONDRAWERAFTER: true,
}, datainfo('D', 'SELECT L.LINE_NO, P.NAME, L.QUANTITY, L.UNIT_PRICE, L.QUANTITY * L.UNIT_PRICE AS AMOUNT FROM ORDER_LINES L JOIN PRODUCTS P ON P.PRODUCT_ID = L.PRODUCT_ID WHERE L.ORDER_ID <= 3 ORDER BY L.ORDER_ID, L.LINE_NO'), [
  section('pageheader', { WIDTH: 4535, HEIGHT: 720 }, [
    label('TICKET', { WIDTH: 4535, HEIGHT: 360, FONTSIZE: 16, ALIGNMENT: 2, FONTSTYLE: 1 }),
    label('Mare Nostrum Fine Foods', { POSY: 360, WIDTH: 4535, FONTSIZE: 8, ALIGNMENT: 2 }),
  ]),
  section('detail', { WIDTH: 4535, HEIGHT: 180 }, [
    expr('D.QUANTITY', { WIDTH: 400, FONTSIZE: 10, ALIGNMENT: 1 }),
    expr('D.NAME', { POSX: 500, WIDTH: 2600, FONTSIZE: 10, CUTTEXT: true }),
    expr('D.AMOUNT', { POSX: 3135, WIDTH: 1400, FONTSIZE: 10, ALIGNMENT: 1, DISPLAYFORMAT: '#,##0.00' }),
  ]),
  section('pagefooter', { WIDTH: 4535, HEIGHT: 540 }, [
    label('TOTAL', { WIDTH: 2000, HEIGHT: 360, FONTSIZE: 14, FONTSTYLE: 1 }),
    expr('D.AMOUNT', { POSX: 2000, WIDTH: 2535, HEIGHT: 360, FONTSIZE: 14, ALIGNMENT: 1, AGGREGATE: 1, DISPLAYFORMAT: '#,##0.00' }),
    label('Thank you', { POSY: 360, WIDTH: 4535, FONTSIZE: 8, ALIGNMENT: 2 }),
  ]),
]);

// QR codes on a receipt: the TM88 drivers draw them by themselves (GS ( k), centred, left or
// right by the box, and the lines under them are consumed; the other drivers get the modules as
// drawings, which a text device does not print.
report('syn-text-qr.rep', {
  PAGESIZE: 2, PAGEWIDTH: 4535, PAGEHEIGHT: 11339, CUSTOMPAGEWIDTH: 4535, CUSTOMPAGEHEIGHT: 11339, LEFTMARGIN: 0,
  TOPMARGIN: 0, RIGHTMARGIN: 0, BOTTOMMARGIN: 0,
}, datainfo('D', 'SELECT ORDER_ID, ORDER_NUMBER FROM ORDERS WHERE ORDER_ID <= 2 ORDER BY ORDER_ID'), [
  section('detail', { WIDTH: 4535, HEIGHT: 3600 }, [
    expr("'Order '+D.ORDER_NUMBER", { WIDTH: 4535, ALIGNMENT: 2 }),
    qr("'https://reportman.es/?order='+STR(D.ORDER_ID)", { POSX: 1367, POSY: 300, WIDTH: 1800, HEIGHT: 1800, ECCLEVEL: 3 }),
    label('Scan me', { POSY: 1000, WIDTH: 1300 }),
    qr("'ÁBC ñ €'", { POSY: 2200, WIDTH: 1000, HEIGHT: 1000, ECCLEVEL: 5 }),
    qr('D.ORDER_NUMBER', { POSX: 3300, POSY: 2200, WIDTH: 1200, HEIGHT: 1000 }),
    label('End', { POSY: 3300, WIDTH: 4535, ALIGNMENT: 2 }),
  ]),
]);

// 9.6 lines per inch: the line spacing codes n/216 and n/180 are computed in decimal by C# (22.5
// is 22.500000000000000000000000007 there, so 23), and the lines of a page too.
report('syn-text-lpi.rep', { LINESPERINCH: 960 }, datainfo('D', 'SELECT CUSTOMER_ID, CODE, COMPANY_NAME, CITY FROM CUSTOMERS WHERE CUSTOMER_ID <= 40 ORDER BY CUSTOMER_ID'), [
  section('pageheader', { HEIGHT: 400 }, [label('Customers at 9.6 lines per inch', { WIDTH: 6000, FONTSIZE: 12 })]),
  section('detail', { HEIGHT: 150 }, [
    expr('D.CODE', { WIDTH: 1000, FONTSIZE: 8 }),
    expr('D.COMPANY_NAME', { POSX: 1100, WIDTH: 4000, FONTSIZE: 8 }),
    expr('D.CITY', { POSX: 5200, WIDTH: 2000, FONTSIZE: 8, ALIGNMENT: 1 }),
  ]),
]);

// ---------------------------------------------------------------------------------------------
// The cases

const runCases = JSON.parse(fs.readFileSync(path.join(engineTest, 'run-cases.json'), 'utf8'));
const engineCase = (name) => {
  const c = runCases.find((x) => x.name === name);
  if (c === undefined) throw new Error('No run case ' + name);
  return { ...c, report: path.resolve(engineTest, c.report) };
};
const synthetic = (name) => ({ name, report: path.join(out, name + '.rep') });

const cases = [];
const add = (base, options = {}) => cases.push({ ...base, ...options, name: options.name ?? base.name });
// The samples and some synthetic reports of the engine (groups, word wrap, page counts) in PLAIN
for (const name of ['customers', 'customers-es', 'invoices', 'invoices-range', 'labels', 'contacts', 'contacts-es', 'year-over-year',
  'year-over-year-es', 'syn-layout', 'syn-multipage', 'syn-pagecount', 'syn-twopass', 'syn-groups', 'syn-columns', 'syn-nodata'])
  add(engineCase(name), { driver: 'PLAIN' });
// Every driver on the synthetic report of the grid
const drivers = ['PLAIN', 'PLAINFULL', 'EPSON', 'EPSON-MASTER', 'EPSON-ESCP', 'EPSON-ESCPQ', 'IBMPROPRINTER', 'HP-PCL', 'VT100',
  'EPSONTMU210', 'EPSONTMU210CUT', 'EPSONTM88II', 'EPSONTM88IICUT', 'EPSONTM88CP850', 'EPSONTM88CP858CUT', 'EPSONTM88UTF8'];
for (const driver of drivers) add(synthetic('syn-text'), { name: 'syn-text.' + driver, driver });
add(synthetic('syn-text'), { name: 'syn-text.PLAIN-utf8', driver: 'PLAIN', oem: false });
add(synthetic('syn-text'), { name: 'syn-text.EPSON-ESCP-fullplain', driver: 'EPSON-ESCP', fullPlain: true });
// No driver at all: the printer configuration decides, and for the default printer it has none
add(synthetic('syn-text'), { name: 'syn-text.nodriver', driver: '' });
for (const driver of ['PLAIN', 'EPSON', 'HP-PCL', 'EPSONTMU210', 'EPSONTM88IICUT', 'EPSONTM88UTF8CUT'])
  add(synthetic('syn-text-receipt'), { name: 'syn-text-receipt.' + driver, driver });
for (const driver of ['PLAIN', 'EPSONTMU210', 'EPSONTM88II', 'EPSONTM88IICUT', 'EPSONTM88CP858', 'EPSONTM88UTF8CUT'])
  add(synthetic('syn-text-qr'), { name: 'syn-text-qr.' + driver, driver });
for (const driver of ['PLAIN', 'EPSON', 'EPSON-ESCPQ', 'EPSONTMU210', 'EPSONTM88II'])
  add(synthetic('syn-text-lpi'), { name: 'syn-text-lpi.' + driver, driver });
// A sample on the line printers
for (const driver of ['EPSON', 'EPSON-ESCP', 'IBMPROPRINTER', 'HP-PCL']) add(engineCase('customers'), { name: 'customers.' + driver, driver });
add(engineCase('invoices'), { name: 'invoices.EPSON-ESCP', driver: 'EPSON-ESCP' });

/** The objects of the metafile JSON of golden-cs: [class, left, top, width, height, text?]. */
function layout(meta) {
  return {
    pageSizeIndex: meta.pageSizeIndex,
    customX: meta.customX,
    customY: meta.customY,
    orientation: meta.orientation,
    pages: meta.pages.map((p) =>
      p.objects.map((o) => {
        const r = [o.class.replace('MetaObject', ''), o.Left, o.Top, o.Width, o.Height];
        if (o.class === 'MetaObjectText') r.push(o.text);
        if (o.class === 'MetaObjectBarcode') r.push(o.Symbology, o.Ecc, o.Modules, o.Rows, o.Columns, o.Flags);
        return r;
      }),
    ),
  };
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-text-'));
const result = [];
for (const c of cases) {
  const metaFile = path.join(work, c.name + '.meta.json');
  const args = ['run', c.report, metaFile, '--sqlite', db, '--text', path.join(out, c.name + '.txt'), '--text-driver', c.driver];
  if (c.oem !== undefined) args.push('--text-oem', String(c.oem));
  if (c.fullPlain) args.push('--text-fullplain', 'true');
  for (const [k, v] of Object.entries(c.params ?? {})) args.push('--param', k + '=' + v);
  if (c.culture) args.push('--culture', c.culture);
  const r = spawnSync(exe, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(c.name + ': ' + (r.stderr || r.stdout));
  const clock = /clock=(\S+)/.exec(r.stdout)?.[1];
  fs.writeFileSync(path.join(out, c.name + '.layout.json'), JSON.stringify(layout(JSON.parse(fs.readFileSync(metaFile, 'utf8')))) + '\n');
  result.push({
    name: c.name,
    report: path.relative(here, c.report).split(path.sep).join('/'),
    ...(c.params === undefined ? {} : { params: c.params }),
    ...(c.culture === undefined ? {} : { culture: c.culture }),
    driver: c.driver,
    ...(c.oem === undefined ? {} : { oem: c.oem }),
    ...(c.fullPlain ? { fullPlain: true } : {}),
    clock,
  });
  console.log(c.name + ': ' + r.stdout.trim().split(/\r?\n/).pop());
}
fs.writeFileSync(path.join(out, 'cases.json'), JSON.stringify(result, null, 2) + '\n');

// The code pages: what the device writes in them (without the map of UTF-8, the standard
// encoding: its cases are enough), and how 437 reads bytes (Reportman.Server's text format)
for (const cp of [437, 850, 858, 28591, 65001]) {
  const file = path.join(out, 'cp' + cp + '.json');
  const r = spawnSync(exe, ['encoding', String(cp), file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('encoding ' + cp + ': ' + (r.stderr || r.stdout));
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (cp === 437) {
    delete j.map;
    delete j.cases;
  } else delete j.decode;
  if (cp === 65001) delete j.map;
  fs.writeFileSync(file, JSON.stringify(j) + '\n');
}
fs.rmSync(work, { recursive: true, force: true });
