// Writes the synthetic reports of the FreeType parity tests (fixtures/freetype/ft-*.rep): reports
// without data for the typography the samples do not cover: fonts and styles, fallback by coverage,
// HTML text, right to left and complex scripts, PDF/A-3. Each report is described compactly below
// and written with the tags and defaults of a report saved by the designer.
//
//   node test/synthetic/make-freetype-reports.mjs      (from packages/reportman-engine)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../fixtures/freetype");
fs.mkdirSync(out, { recursive: true });

// ---------------------------------------------------------------------------------------------
// XML writing (ReportWriter: every character but letters, digits and spaces as #code#)

function enc(value) {
  let r = '';
  for (const ch of String(value)) {
    const c = ch.codePointAt(0);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 32) r += ch;
    else if (c > 0xffff) {
      const s = ch;
      r += '#' + s.charCodeAt(0) + '##' + s.charCodeAt(1) + '#';
    } else r += '#' + c + '#';
  }
  return r;
}

function prop(name, value) {
  if (typeof value === 'boolean') return `<${name} type="Boolean">${value ? 'True' : 'False'}</${name}>`;
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return `<${name} type="Integer">${value}</${name}>`;
    return `<${name} type="Double">${value}</${name}>`;
  }
  if (value && typeof value === 'object' && 'date' in value) return `<${name} type="Double">${value.date}</${name}>`;
  if (Array.isArray(value)) return `<${name} type="String">${enc(value.join('\r\n'))}</${name}>`;
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
  DOCCREATOR: 'Report Manager', DOCPRODUCER: '', DOCSUBJECT: '', DOCTITLE: 'Synthetic', DOCCREATIONDATE: '',
  DOCMODIFICATIONDATE: '', DOCKEYWORDS: '', DOCXMPCONTENT: '',
};

function database(o = {}) {
  return `<DATABASEINFO>\n${props({
    ALIAS: 'SAMPLES', NAME: 'TRpDatabaseInfoItem0', CONFIGFILE: '', LOADPARAMS: false, LOADDRIVERPARAMS: false,
    LOGINPROMPT: false, DRIVER: 8, REPORTTABLE: 'REPMAN_REPORTS', REPORTSEARCHFIELD: 'REPORT_NAME', REPORTFIELD: 'REPORT',
    REPORTGROUPSTABLE: 'REPMAN_GROUPS', ADOCONNECTIONSTRING: '', DOTNETDRIVER: 0, PROVIDERFACTORY: '', ...o,
  })}\n</DATABASEINFO>`;
}

let dataCount = 0;
function datainfo(alias, sql, o = {}) {
  return `<DATAINFO>\n${props({
    ALIAS: alias, NAME: 'TRpDataInfoItem' + dataCount++, DATABASEALIAS: 'SAMPLES', SQL: sql, DATASOURCE: '',
    MYBASEFILENAME: '', MYBASEFIELDS: '', MYBASEINDEXFIELDS: '', MYBASEMASTERFIELDS: '', BDEINDEXFIELDS: '',
    BDEINDEXNAME: '', BDETABLE: '', BDETYPE: 0, BDEFILTER: '', BDEMASTERFIELDS: '', BDEFIRSTRANGE: '',
    BDELASTRANGE: '', DATAUNIONS: '', GROUPUNION: false, OPENONSTART: true, PARALLELUNION: false, ...o,
  })}\n</DATAINFO>`;
}

/** A parameter; value goes last (its type depends on PARAMTYPE). */
function param(alias, type, value, o = {}) {
  const { VALUE: _v, ...rest } = o;
  const head = props({
    NAME: alias, INTNAME: alias, DESCRIPTION: o.DESCRIPTION ?? alias, HINT: '', ERRORMESSAGE: '', VALIDATION: '',
    SEARCH: '', VISIBLE: true, ISREADONLY: false, NEVERVISIBLE: false, ALLOWNULLS: false, PARAMTYPE: type,
    DATASETS: [], ITEMS: [], VALUES: [], SELECTED: [], LOOKUPDATASET: '', SEARCHDATASET: '', SEARCHPARAM: '',
    ...rest,
  });
  let v;
  if (typeof value === 'number' && Number.isInteger(value) && type === 1) v = `<VALUE type="Integer">${value}</VALUE>`;
  else if (typeof value === 'number') v = `<VALUE type="Double">${value}</VALUE>`;
  else if (typeof value === 'boolean') v = `<VALUE type="Boolean">${value ? 'True' : 'False'}</VALUE>`;
  else if (value && typeof value === 'object') v = `<VALUE type="Double">${value.date}</VALUE>`;
  else v = `<VALUE type="String">${enc(value)}</VALUE>`;
  return `<PARAMETER>\n${head}\n${v}\n</PARAMETER>`;
}

let compCount = 0;
const TEXT_DEFAULTS = {
  WFONTNAME: 'Arial', LFONTNAME: 'Helvetica', BIDIMODE: 0, TYPE1FONT: 0, FONTSIZE: 10, FONTROTATION: 0,
  FONTSTYLE: 0, FONTCOLOR: 0, BACKCOLOR: 16777215, TRANSPARENT: true, CUTTEXT: false, ALIGNMENT: 0, VALIGNMENT: 0,
  INTERLINE: 0, WORDWRAP: false, WORDBREAK: false, SINGLELINE: false, MULTIPAGE: false, PRINTSTEP: 0, ISHTML: false,
};

function head(cls, prefix, o) {
  return props({
    NAME: o.NAME ?? prefix + compCount++, CLASSNAME: cls, WIDTH: o.WIDTH ?? 1440, HEIGHT: o.HEIGHT ?? 275,
    PRINTCONDITION: o.PRINTCONDITION ?? '', DOBEFOREPRINT: o.DOBEFOREPRINT ?? '', DOAFTERPRINT: o.DOAFTERPRINT ?? '',
    ANNOTATION: o.ANNOTATION ?? '', POSX: o.POSX ?? 0, POSY: o.POSY ?? 0, ALIGN: o.ALIGN ?? 0,
  });
}

const HEAD_KEYS = ['NAME', 'WIDTH', 'HEIGHT', 'PRINTCONDITION', 'DOBEFOREPRINT', 'DOAFTERPRINT', 'ANNOTATION', 'POSX', 'POSY', 'ALIGN'];
const rest = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !HEAD_KEYS.includes(k)));

function label(text, o = {}) {
  const r = rest(o);
  const texts = Array.isArray(text) ? text : [text];
  return `<COMPONENT>\n${head('TRPLABEL', 'TRpLabel', o)}\n${props({ ...TEXT_DEFAULTS, ...r })}\n${prop('WIDETEXT', texts.join('\n'))}\n</COMPONENT>`;
}

function expr(expression, o = {}) {
  const r = rest(o);
  return `<COMPONENT>\n${head('TRPEXPRESSION', 'TRpExpression', o)}\n${props({
    ...TEXT_DEFAULTS, ...Object.fromEntries(Object.entries(r).filter(([k]) => k in TEXT_DEFAULTS)),
    EXPRESSION: expression, AGINIVALUE: r.AGINIVALUE ?? '0', EXPORTEXPRESSION: r.EXPORTEXPRESSION ?? '', DATATYPE: r.DATATYPE ?? 16,
    DISPLAYFORMAT: r.DISPLAYFORMAT ?? '', IDENTIFIER: r.IDENTIFIER ?? '', AGGREGATE: r.AGGREGATE ?? 0, GROUPNAME: r.GROUPNAME ?? '',
    AGTYPE: r.AGTYPE ?? 0, AUTOEXPAND: r.AUTOEXPAND ?? false, AUTOCONTRACT: r.AUTOCONTRACT ?? false,
    PRINTONLYONE: r.PRINTONLYONE ?? false, PRINTNULLS: r.PRINTNULLS ?? true, EXPORTDISPLAYFORMAT: '', EXPORTLINE: 0,
    EXPORTPOSITION: 0, EXPORTSIZE: 1, EXPORTDONEWLINE: false,
  })}\n</COMPONENT>`;
}

function shape(o = {}) {
  const r = rest(o);
  return `<COMPONENT>\n${head('TRPSHAPE', 'TRpShape', { WIDTH: 500, HEIGHT: 500, ...o })}\n${props({
    SHAPE: 0, BRUSHSTYLE: 1, BRUSHCOLOR: 16777215, PENSTYLE: 0, PENCOLOR: 0, PENWIDTH: 0, ...r,
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

function report(file, { props: p = {}, databases = [database()], data = [], params = [], subs = [] }) {
  dataCount = 0;
  const xml = `<?xml version="1.0" standalone="no"?>\n<!DOCTYPE REPORT_MANAGER_2>\n<REPORT>\n${props({ ...REPORT_DEFAULTS, ...p })}\n${[
    ...databases,
    ...data,
    ...params,
    ...subs,
  ].join('\n')}\n</REPORT>\n`;
  fs.writeFileSync(path.join(out, file), xml);
  compCount = 0;
  secCount = 0;
  subCount = 0;
}

/** A Delphi TDateTime (days since 1899-12-30). */
function delphiDate(y, m, d, hh = 0, mm = 0, ss = 0) {
  return { date: (Date.UTC(y, m - 1, d, hh, mm, ss) - Date.UTC(1899, 11, 30)) / 86400000 };
}

// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// The reports

/** A report of one detail section, no data: the components given, printed once. */
function sheet(file, components, { height = 15000, props: p = {}, extra = [] } = {}) {
  report(file, {
    props: p,
    databases: [],
    data: [],
    subs: [subreport('', [section('detail', { HEIGHT: height }, components)], { PRINTONLYIFDATAAVAILABLE: false })],
    ...extra,
  });
}

const LOREM =
  'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs: AVAWAY To Ty LT. ' +
  'Sphinx of black quartz, judge my vow, while the office staff file their affidavits and fluffy waffles.';

// Fonts and styles: families, sizes, styles, decorations, alignments, wrapping, clipping,
// backgrounds, rotation, kerning and ligatures, variable fonts and collections.
{
  const c = [];
  let y = 0;
  const row = (h) => {
    const r = y;
    y += h;
    return r;
  };
  const families = [
    'Arial', 'Times New Roman', 'Courier New', 'Verdana', 'Tahoma', 'Segoe UI', 'Calibri', 'Cambria', 'Georgia', 'Consolas',
    'Trebuchet MS', 'Palatino Linotype', 'Gabriola', 'Bahnschrift', 'Ubuntu Mono', 'Noto Sans', 'NoSuchFont', 'Helvetica',
    'Yu Gothic', 'MS Gothic', 'Segoe UI Emoji',
  ];
  for (const f of families) {
    const top = row(300);
    for (let s = 0; s < 4; s++)
      c.push(label(f + ' ' + ['regular', 'bold', 'italic', 'bold italic'][s] + ' AVAWAY fi', { POSX: s * 2700, POSY: top, WIDTH: 2650, HEIGHT: 300, WFONTNAME: f, FONTSTYLE: s, FONTSIZE: 9 }));
  }
  let top = row(500);
  for (const [i, size] of [6, 8, 11, 14, 20, 28].entries())
    c.push(label('Size ' + size, { POSX: i * 1800, POSY: top, WIDTH: 1800, HEIGHT: 500, FONTSIZE: size }));
  top = row(350);
  c.push(label('Underlined text', { POSY: top, WIDTH: 2600, FONTSTYLE: 4 }));
  c.push(label('Struck out text', { POSX: 2700, POSY: top, WIDTH: 2600, FONTSTYLE: 8 }));
  c.push(label('Bold underlined', { POSX: 5400, POSY: top, WIDTH: 2600, FONTSTYLE: 5, WFONTNAME: 'Calibri' }));
  c.push(label('Colored text', { POSX: 8100, POSY: top, WIDTH: 2600, FONTCOLOR: 255 }));
  top = row(1100);
  c.push(label(LOREM, { POSY: top, WIDTH: 3400, HEIGHT: 1100, WORDWRAP: true, ALIGNMENT: 0, FONTSIZE: 8 }));
  c.push(label(LOREM, { POSX: 3600, POSY: top, WIDTH: 3400, HEIGHT: 1100, WORDWRAP: true, ALIGNMENT: 1, FONTSIZE: 8, WFONTNAME: 'Times New Roman' }));
  c.push(label(LOREM, { POSX: 7200, POSY: top, WIDTH: 3400, HEIGHT: 1100, WORDWRAP: true, ALIGNMENT: 2, FONTSIZE: 8, WFONTNAME: 'Verdana' }));
  top = row(1200);
  c.push(label(LOREM, { POSY: top, WIDTH: 3400, HEIGHT: 1200, WORDWRAP: true, ALIGNMENT: 3, FONTSIZE: 8, WFONTNAME: 'Calibri' }));
  c.push(label(LOREM, { POSX: 3600, POSY: top, WIDTH: 3400, HEIGHT: 600, WORDWRAP: true, CUTTEXT: true, FONTSIZE: 8, TRANSPARENT: false, BACKCOLOR: 13434879 }));
  c.push(label('Bottom', { POSX: 7200, POSY: top, WIDTH: 1600, HEIGHT: 1200, VALIGNMENT: 1, TRANSPARENT: false, BACKCOLOR: 15790320 }));
  c.push(label('Center', { POSX: 9000, POSY: top, WIDTH: 1600, HEIGHT: 1200, VALIGNMENT: 2, ALIGNMENT: 2 }));
  top = row(1600);
  c.push(label('Rotated 90', { POSX: 200, POSY: top + 1500, WIDTH: 1500, HEIGHT: 300, FONTROTATION: 900 }));
  c.push(label('Rotated 45 underlined', { POSX: 1200, POSY: top + 1200, WIDTH: 2500, HEIGHT: 300, FONTROTATION: 450, FONTSTYLE: 4 }));
  c.push(label('Single line\nwith a line feed', { POSX: 4000, POSY: top, WIDTH: 3000, SINGLELINE: true }));
  c.push(label('Two lines\nwith a line feed\r\nand a third', { POSX: 4000, POSY: top + 400, WIDTH: 3000, HEIGHT: 900 }));
  c.push(label('Courier type 1', { POSX: 7500, POSY: top, WIDTH: 3000, TYPE1FONT: 1 }));
  c.push(label('Times type 1', { POSX: 7500, POSY: top + 400, WIDTH: 3000, TYPE1FONT: 2 }));
  c.push(label('Tabs\tbetween\twords', { POSX: 7500, POSY: top + 800, WIDTH: 3000 }));
  top = row(400);
  c.push(label('office fluffy affine waffle', { POSY: top, WIDTH: 3500, WFONTNAME: 'Calibri', FONTSIZE: 12 }));
  c.push(label('office fluffy affine waffle', { POSX: 3600, POSY: top, WIDTH: 3500, WFONTNAME: 'Gabriola', FONTSIZE: 14 }));
  c.push(label('AVAWAY To Ty LT kerning', { POSX: 7200, POSY: top, WIDTH: 3500, WFONTNAME: 'Georgia', FONTSIZE: 12 }));
  top = row(300);
  c.push(expr("'Price: '+FORMATSTR('#,##0.00',1234.5)+' € — “quotes” ‘single’ … • – ™'", { POSY: top, WIDTH: 10000 }));
  sheet('ft-fonts.rep', c);
}

// Fallback by coverage: scripts the requested font has no glyphs for, alone and mixed with Latin,
// symbols, emoji, and a wrapped line of text without spaces.
{
  const c = [];
  const texts = [
    'Japanese こんにちは世界、日本語のテキスト',
    'Chinese 你好世界，中文文本',
    'Korean 안녕하세요 세계',
    'Greek Ευχαριστούμε πολύ',
    'Cyrillic Спасибо большое',
    'Armenian Բարեւ Georgian გამარჯობა',
    'Ethiopic ሰላም Cherokee ᏣᎳᎩ',
    'Symbols ★ ✓ ☎ ♠ ∑ ∫ ≠ ∞ → ⇒ ①②③',
    'Emoji 😀 🎉 👍🏽 🇪🇸 👨‍👩‍👧 ❤️',
    'Mixed: price 100 € and 日本 and ★ and Ελλάδα',
    'Thai inside Arial ภาษาไทย and Devanagari नमस्ते',
  ];
  texts.forEach((t, i) => c.push(label(t, { POSY: i * 360, WIDTH: 10000, HEIGHT: 340, FONTSIZE: 10 })));
  c.push(label('日本語のテキストは単語の間に空白がないので、行の折り返しは文字の途中でも行われます。これは長い文章です。', {
    POSY: 4200, WIDTH: 3000, HEIGHT: 1500, WORDWRAP: true, WFONTNAME: 'Arial',
  }));
  c.push(label('Bold 日本語 Ελληνικά', { POSX: 3500, POSY: 4200, WIDTH: 4000, FONTSTYLE: 1 }));
  c.push(label('Italic 中文 Русский', { POSX: 3500, POSY: 4600, WIDTH: 4000, FONTSTYLE: 2, WFONTNAME: 'Times New Roman' }));
  sheet('ft-fallback.rep', c, { height: 6000 });
}

// HTML text: tags, attributes, colours, sizes, families, entities, paragraphs, tables, malformed
// markup and the placeholders of the expressions.
{
  const c = [];
  const html = [
    'Plain <b>bold</b> <i>italic</i> <u>underline</u> <s>strike</s> <strong>strong</strong> <em>em</em> <del>del</del> <strike>strike2</strike>',
    '<b>Bold <i>bold italic <u>and underlined</u></i></b> back to normal',
    'Colours: <font color="#FF0000">red</font> <font color=#00f>blue</font> <font color="green">green</font> <span style="color:#808080">grey span</span>',
    'Faces: <font face="Courier New">Courier New</font> <font face=\'Times New Roman\'>Times</font> <span style="font-family: Verdana">Verdana span</span>',
    'Sizes: <font size="1">1</font> <font size="3">3</font> <font size="5">5</font> <font size="7">7</font> <span style="font-size:14pt">14pt</span> <span style="font-size:9px">9px</span>',
    'Entities: &amp; &lt;tag&gt; &quot;quoted&quot; &#39;apos&#39; non&nbsp;breaking &euro; &copy;',
    'Line<br>break<br/>and <br />more',
    '<p>First paragraph</p><p>Second paragraph</p><div>A div</div>',
    '<table><tr><td>Cell 1</td><td>Cell 2</td></tr><tr><th>Head A</th><th>Head B</th></tr></table>',
    'Unclosed <b>bold and <i>italic',
    'Stray </b> closing and a < b > c comparison',
    '<script>alert(1)</script>Script removed <img src="x.png"> image removed <a href="#">link text</a>',
    '   Leading spaces and    runs   of    spaces',
    '<span style="font-family:\'Times New Roman\'; font-size:12pt; color:red">styled span</span> after',
    'Mixed <b>日本語</b> and <i>Ελληνικά</i> in HTML',
  ];
  html.forEach((t, i) => c.push(label(t, { POSY: i * 420, WIDTH: 10000, HEIGHT: 400, ISHTML: true, WORDWRAP: true })));
  c.push(expr("'Expression with <b>'+'bold'+'</b> and {{1+2}} placeholder'", { POSY: 6400, WIDTH: 10000, HEIGHT: 400, ISHTML: true }));
  c.push(label('Label with {{2*3}} and {{UPPERCASE(\'x\')}} and {{bad(}} placeholders', { POSY: 6800, WIDTH: 10000, HEIGHT: 400, ISHTML: true }));
  c.push(label('<b>Wrapped</b> HTML text with <font color="#0000FF">several runs</font> that needs more than one line of the box, <i>right aligned</i>', {
    POSY: 7300, WIDTH: 3000, HEIGHT: 1500, ISHTML: true, WORDWRAP: true, ALIGNMENT: 1,
  }));
  c.push(label('<u>Centered</u> and <s>justified is ignored</s> for HTML text in a wrapped box with more words', {
    POSX: 3500, POSY: 7300, WIDTH: 3000, HEIGHT: 1500, ISHTML: true, WORDWRAP: true, ALIGNMENT: 3,
  }));
  sheet('ft-html.rep', c, { height: 9500 });
}

// Multipage HTML: a long HTML expression split across pages (TrySplitHtmlForMultipage).
{
  const para = (i) =>
    '<b>Paragraph ' + i + '.</b> ' + 'Lorem ipsum <i>dolor sit amet</i>, consectetur <font color="#C00000">adipiscing</font> elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';
  let long = '';
  for (let i = 1; i <= 40; i++) long += para(i) + '<br>';
  report('ft-html-multipage.rep', {
    databases: [],
    data: [],
    subs: [
      subreport('', [
        section('pageheader', { HEIGHT: 400 }, [label('Multipage HTML', { WIDTH: 5000, FONTSIZE: 14 }), expr('PAGE', { POSX: 9000, WIDTH: 1000 })]),
        section('detail', { HEIGHT: 400, AUTOEXPAND: true, AUTOCONTRACT: true }, [
          expr("'" + long.replaceAll("'", "''") + "'", { WIDTH: 6000, HEIGHT: 400, FONTSIZE: 11, WORDWRAP: true, MULTIPAGE: true, ISHTML: true }),
        ]),
        section('pagefooter', { HEIGHT: 300 }, [expr("'Page '+STR(PAGE)", { WIDTH: 3000 })]),
      ], { PRINTONLYIFDATAAVAILABLE: false }),
    ],
  });
}

// Right to left and complex scripts: Arabic and Hebrew paragraphs, numbers and Latin inside them,
// brackets, alignments, a right to left object without letters, Devanagari, Thai, Japanese, emoji.
{
  const c = [];
  const rtl = { BIDIMODE: 1 };
  c.push(label('مرحبا بالعالم', { ...rtl, WIDTH: 5000, FONTSIZE: 14 }));
  c.push(label('שלום עולם', { ...rtl, POSX: 5200, WIDTH: 5000, FONTSIZE: 14 }));
  c.push(label('يُعصر زيت الزيتون البكر الممتاز لدينا على البارد من زيتون أربيكينا المقطوف في شهر أكتوبر، ويُعبأ في غضون ساعات قليلة.', {
    ...rtl, POSY: 500, WIDTH: 5000, HEIGHT: 1200, WORDWRAP: true, ALIGNMENT: 1, WFONTNAME: 'Arial',
  }));
  c.push(label('שמן הזית הכתית המעולה שלנו מופק בכבישה קרה מזיתי ארבקינה הנקטפים באוקטובר.', {
    ...rtl, POSX: 5200, POSY: 500, WIDTH: 5000, HEIGHT: 1200, WORDWRAP: true, ALIGNMENT: 1, WFONTNAME: 'Arial',
  }));
  c.push(label('السعر 1250.50 يورو (مع الضريبة) و ABC-123', { ...rtl, POSY: 1900, WIDTH: 5000 }));
  c.push(label('המחיר 99.90 ₪ [כולל מע"מ] code XY-7', { ...rtl, POSX: 5200, POSY: 1900, WIDTH: 5000 }));
  c.push(label('English with عربي inside and עברית too', { POSY: 2300, WIDTH: 5000 }));
  c.push(label('123 456 + 789', { ...rtl, POSX: 5200, POSY: 2300, WIDTH: 5000 }));
  c.push(label('نص في المنتصف', { ...rtl, POSY: 2700, WIDTH: 5000, ALIGNMENT: 2 }));
  c.push(label('نص بمحاذاة اليسار', { ...rtl, POSX: 5200, POSY: 2700, WIDTH: 5000, ALIGNMENT: 0 }));
  c.push(label('توزيع النص بالتساوي في سطور متعددة داخل مربع ضيق جدا', { ...rtl, POSY: 3100, WIDTH: 2500, HEIGHT: 900, WORDWRAP: true, ALIGNMENT: 3 }));
  c.push(label('<b>عريض</b> و <font color="#FF0000">أحمر</font> HTML', { ...rtl, POSX: 5200, POSY: 3100, WIDTH: 5000, ISHTML: true }));
  c.push(label('हमारा एक्स्ट्रा वर्जिन जैतून का तेल अक्टूबर में तोड़े गए जैतूनों से बनता है।', {
    POSY: 4100, WIDTH: 5000, HEIGHT: 900, WORDWRAP: true, WFONTNAME: 'Nirmala UI',
  }));
  c.push(label('น้ำมันมะกอกของเราสกัดเย็นจากมะกอกที่เก็บเกี่ยวในเดือนตุลาคม', {
    POSX: 5200, POSY: 4100, WIDTH: 5000, HEIGHT: 900, WORDWRAP: true, WFONTNAME: 'Leelawadee UI',
  }));
  c.push(label('ご注文ありがとうございます', { POSY: 5100, WIDTH: 5000, WFONTNAME: 'Yu Gothic', FONTSTYLE: 1 }));
  c.push(label('😀 🎉 👍🏽 🇪🇸 ❤️ 123', { POSX: 5200, POSY: 5100, WIDTH: 5000 }));
  c.push(label('😀 🎉 👍🏽', { ...rtl, POSY: 5500, WIDTH: 5000 }));
  c.push(label('عربي mixed with emoji 😀 and 123', { ...rtl, POSX: 5200, POSY: 5500, WIDTH: 5000 }));
  sheet('ft-rtl.rep', c, { height: 6200 });
}

// PDF/A-3B: XMP metadata, output intent, embedded files with their relationships.
{
  const hex = (s) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
  const efile = (name, mime, rel, desc, content) =>
    `<EMBEDDEDFILE>\n${props({ FILENAME: name, MIMETYPE: mime, DESCRIPTION: desc, CREATIONDATE: '2026-01-02T10:20:30+01:00', MODIFICATIONDATE: '2026-03-04T05:06:07Z', RELATIONSHIP: rel })}\n<STREAM type="Binary" size="${new TextEncoder().encode(content).length}">${hex(content)}</STREAM>\n</EMBEDDEDFILE>`;
  report('ft-pdfa.rep', {
    props: { PDFCONFORMANCE: 1, DOCTITLE: 'PDF/A-3 test', DOCAUTHOR: 'Synthetic & <co>', DOCSUBJECT: 'Embedded files', DOCKEYWORDS: 'pdfa, test, xmp', DOCCREATOR: 'Report Manager', DOCPRODUCER: 'Reportman', DOCCREATIONDATE: '2026-05-06T07:08:09+02:00' },
    databases: [],
    data: [],
    subs: [
      efile('invoice.xml', 'text/xml', 2, 'The invoice data', '<?xml version="1.0"?><invoice><total>12.30</total></invoice>'),
      efile('notes.txt', 'text/plain', 4, 'Notes', 'Some notes ñ'),
      subreport('', [section('detail', { HEIGHT: 3000 }, [
        label('PDF/A-3 document with embedded files', { WIDTH: 8000, FONTSIZE: 14, FONTSTYLE: 1 }),
        label('Helvetica text is embedded too: AVAWAY €', { POSY: 500, WIDTH: 8000 }),
        label('Courier type 1 text', { POSY: 900, WIDTH: 8000, TYPE1FONT: 1 }),
        label('Ελληνικά 日本語 عربي', { POSY: 1300, WIDTH: 8000 }),
        shape({ POSY: 1700, WIDTH: 5000, HEIGHT: 500, BRUSHSTYLE: 0, BRUSHCOLOR: 15790320 }),
      ])], { PRINTONLYIFDATAAVAILABLE: false }),
    ],
  });
}
