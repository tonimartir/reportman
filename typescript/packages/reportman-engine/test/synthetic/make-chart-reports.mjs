// Writes the synthetic chart reports of the chart parity tests (fixtures/chart/ch-*.rep): XML
// reports over samples.db that cover every chart type of ChartItem (the vector chart draws bars,
// horizontal bars, lines, points and areas, and the other types as bars), one and several
// series, the change of serie and clear expressions (boolean and by value), the value condition,
// automatic and fixed value ranges, negative, decimal, large and infinite values, legends, value
// captions, colours, fonts, charts too small to draw, charts in detail, footer and child
// subreport sections, the GRAPHIC* functions and the chart identifier, and the errors of the C#
// engine.
//
//   node test/synthetic/make-chart-reports.mjs      (from packages/reportman-engine)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../fixtures/chart');
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
  DOCCREATOR: 'Report Manager', DOCPRODUCER: '', DOCSUBJECT: '', DOCTITLE: 'Charts', DOCCREATIONDATE: '',
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
function datainfo(alias, sql, o = {}) {
  return `<DATAINFO>\n${props({
    ALIAS: alias, NAME: 'TRpDataInfoItem' + dataCount++, DATABASEALIAS: 'SAMPLES', SQL: sql, DATASOURCE: '',
    MYBASEFILENAME: '', MYBASEFIELDS: '', MYBASEINDEXFIELDS: '', MYBASEMASTERFIELDS: '', BDEINDEXFIELDS: '',
    BDEINDEXNAME: '', BDETABLE: '', BDETYPE: 0, BDEFILTER: '', BDEMASTERFIELDS: '', BDEFIRSTRANGE: '',
    BDELASTRANGE: '', DATAUNIONS: '', GROUPUNION: false, OPENONSTART: true, PARALLELUNION: false, ...o,
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

const TEXT_DEFAULTS = {
  WFONTNAME: 'Arial', LFONTNAME: 'Helvetica', BIDIMODE: 0, TYPE1FONT: 0, FONTSIZE: 7, FONTROTATION: 0,
  FONTSTYLE: 0, FONTCOLOR: 0, BACKCOLOR: 16777215, TRANSPARENT: true, CUTTEXT: false, ALIGNMENT: 0, VALIGNMENT: 0,
  INTERLINE: 0, WORDWRAP: false, WORDBREAK: false, SINGLELINE: false, MULTIPAGE: false, PRINTSTEP: 0,
};
const textOf = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => k in TEXT_DEFAULTS));

function label(text, o = {}) {
  return `<COMPONENT>\n${head('TRPLABEL', 'TRpLabel', o)}\n${props({ ...TEXT_DEFAULTS, ...textOf(rest(o)) })}\n${prop('WIDETEXT', text)}\n</COMPONENT>`;
}

function expr(expression, o = {}) {
  const r = rest(o);
  return `<COMPONENT>\n${head('TRPEXPRESSION', 'TRpExpression', o)}\n${props({
    ...TEXT_DEFAULTS, ...textOf(r),
    EXPRESSION: expression, AGINIVALUE: '0', EXPORTEXPRESSION: '', DATATYPE: 16, DISPLAYFORMAT: r.DISPLAYFORMAT ?? '',
    IDENTIFIER: r.IDENTIFIER ?? '', AGGREGATE: 0, GROUPNAME: '', AGTYPE: 0, AUTOEXPAND: false, AUTOCONTRACT: false,
    PRINTONLYONE: false, PRINTNULLS: true, EXPORTDISPLAYFORMAT: '', EXPORTLINE: 0, EXPORTPOSITION: 0, EXPORTSIZE: 1,
    EXPORTDONEWLINE: false,
  })}\n</COMPONENT>`;
}

/** ChartType of the item. */
const ChartType = {
  Line: 0, Bar: 1, Point: 2, Horzbar: 3, Area: 4, Pie: 5, Arrow: 6, Bubble: 7, Gantt: 8, Splines: 9, CandleStick: 10,
  Pyramid: 11, Polar: 12, PointFigure: 13, Funnel: 14, Kagi: 15, Doughnut: 16, Radar: 17, Renko: 18, ErrorBar: 19,
};
const TYPE_NAMES = Object.fromEntries(Object.entries(ChartType).map(([k, v]) => [v, k]));

const CHART_DEFAULTS = {
  VALUEEXPRESSION: '', VALUEXEXPRESSION: '', GETVALUECONDITION: '', CHANGESERIEEXPRESSION: '', CAPTIONEXPRESSION: '',
  COLOREXPRESSION: '', SERIECOLOREXPRESSION: '', SERIECAPTION: '', CLEAREXPRESSION: '', CHANGESERIEBOOL: false,
  CHARTTYPE: ChartType.Bar, IDENTIFIER: '', CLEAREXPRESSIONBOOL: false, DRIVER: 0, VIEW3D: false, VIEW3DWALLS: false,
  PERSPECTIVE: 15, ELEVATION: 345, ROTATION: 345, ZOOM: 100, HORZOFFSET: 0, VERTOFFSET: 0, TILT: 0, ORTHOGONAL: true,
  MULTIBAR: 1, RESOLUTION: 200, SHOWLEGEND: false, SHOWHINT: true, MARKSTYLE: 0, HORZFONTSIZE: 8, VERTFONTSIZE: 8,
  HORZFONTROTATION: 0, VERTFONTROTATION: 0, AUTORANGE: 0, YMIN: dbl(0), YMAX: dbl(0),
};

/** A chart item; the properties as the designer writes them (the text ones and the chart ones). */
function chart(o = {}) {
  const r = rest(o);
  const chartProps = Object.fromEntries(Object.entries(r).filter(([k]) => !(k in TEXT_DEFAULTS)));
  return `<COMPONENT>\n${head('TRPCHART', 'TRpChart', { WIDTH: 3500, HEIGHT: 2300, ...o })}\n${props({
    ...TEXT_DEFAULTS, FONTSIZE: 8, ...textOf(r),
  })}\n${props({ ...CHART_DEFAULTS, ...chartProps })}\n</COMPONENT>`;
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

/** An integer parameter (PARAMTYPE 1) of the datasets given. */
function param(alias, value, datasets) {
  return `<PARAMETER>\n${props({
    NAME: alias, INTNAME: alias, DESCRIPTION: alias, HINT: '', ERRORMESSAGE: '', VALIDATION: '', SEARCH: '', VISIBLE: false,
    ISREADONLY: false, NEVERVISIBLE: false, ALLOWNULLS: false, PARAMTYPE: 1, DATASETS: datasets, ITEMS: [], VALUES: [],
    SELECTED: [], LOOKUPDATASET: '', SEARCHDATASET: '', SEARCHPARAM: '',
  })}\n<VALUE type="Integer">${value}</VALUE>\n</PARAMETER>`;
}

const written = [];
function report(file, { props: p = {}, data = [], params = [], subs = [] }) {
  const xml = `<?xml version="1.0" standalone="no"?>\n<!DOCTYPE REPORT_MANAGER_2>\n<REPORT>\n${props({ ...REPORT_DEFAULTS, ...p })}\n${[
    database(),
    ...data,
    ...params,
    ...subs,
  ].join('\n')}\n</REPORT>\n`;
  fs.writeFileSync(path.join(out, file), xml);
  written.push(file);
  dataCount = 0;
  compCount = 0;
  secCount = 0;
  subCount = 0;
}

/** A Report Manager string literal. */
const q = (s) => "'" + s.replace(/'/g, "''") + "'";

// ---------------------------------------------------------------------------------------------
// The data

// Products by category: 8 rows (a caption per category).
const SQL_CAT =
  'SELECT C.NAME AS CATEGORY, COUNT(*) AS N, SUM(P.UNITS_IN_STOCK) AS STOCK, AVG(P.UNIT_PRICE) AS PRICE, ' +
  'SUM(P.UNITS_IN_STOCK) - 400 AS DELTA, CASE WHEN COUNT(*) > 5 THEN 255 ELSE 0 END AS COL ' +
  'FROM PRODUCTS P JOIN CATEGORIES C ON C.CATEGORY_ID = P.CATEGORY_ID GROUP BY C.NAME ORDER BY C.NAME';
// Orders by month: 24 rows, two years.
const SQL_MON =
  "SELECT CAST(strftime('%Y', ORDER_DATE) AS INTEGER) AS YEAR, CAST(strftime('%m', ORDER_DATE) AS INTEGER) AS MONTH, " +
  "'Year ' || strftime('%Y', ORDER_DATE) AS YEARTEXT, " +
  "substr('JanFebMarAprMayJunJulAugSepOctNovDec', (CAST(strftime('%m', ORDER_DATE) AS INTEGER) - 1) * 3 + 1, 3) AS MONTH_NAME, " +
  'COUNT(*) AS N, COUNT(*) - 25 AS DELTA, COUNT(*) * 1000.5 AS BIG, COUNT(*) / 1000.0 AS SMALL, ' +
  'CASE WHEN COUNT(*) > 25 THEN 255 ELSE 0 END AS COL, ' +
  "CASE WHEN strftime('%Y', ORDER_DATE) = '2025' THEN 32768 ELSE 0 END AS SCOL " +
  'FROM ORDERS GROUP BY 1, 2 ORDER BY 1, 2';
// Fishes: 28 rows.
const SQL_FISH = 'SELECT SPECIES_NO, CATEGORY, COMMON_NAME, LENGTH_CM FROM FISHES ORDER BY SPECIES_NO';

/**
 * Subreports of charts: each one a dataset (the alias @ of the expressions), a group header with
 * a title, an empty detail and the charts in the group footer, with a label under each one.
 */
function chartSubreports(prefix, sql, charts, { cols = 3, cellW = 3580, cellH = 2700, rows = 5, detail = [], title = '' } = {}) {
  const data = [];
  const subs = [];
  const per = cols * rows;
  for (let s = 0, k = 0; s < charts.length; s += per, k++) {
    const alias = prefix + k;
    data.push(datainfo(alias, sql));
    const comps = [];
    charts.slice(s, s + per).forEach((c, i) => {
      const x = (i % cols) * cellW;
      const y = Math.floor(i / cols) * cellH;
      const { caption, DX, DY, ...o } = c;
      const sub = (v) => (typeof v === 'string' ? v.replace(/@/g, alias) : v);
      const oo = Object.fromEntries(Object.entries(o).map(([key, v]) => [key, sub(v)]));
      comps.push(chart({ POSX: x + (DX ?? 0), POSY: y + (DY ?? 0), ...oo }));
      comps.push(label(caption ?? '', { POSX: x, POSY: y + cellH - 300, WIDTH: cellW - 100, HEIGHT: 220 }));
    });
    const nrows = Math.ceil(Math.min(per, charts.length - s) / cols);
    subs.push(
      subreport(alias, [
        section('groupheader', { HEIGHT: 300, GROUPNAME: 'G' + alias, CHANGEEXPRESSION: "'X'" }, [label(title + ' ' + (k + 1), { WIDTH: 6000, FONTSTYLE: 1 })]),
        section('detail', { HEIGHT: detail.length > 0 ? 250 : 0 }, detail.map((d) => d(alias))),
        section('groupfooter', { HEIGHT: nrows * cellH, GROUPNAME: 'G' + alias }, comps),
      ]),
    );
  }
  return { data, subs };
}

const ALL_TYPES = Object.values(ChartType);

// ---------------------------------------------------------------------------------------------
// The reports

// Every chart type, one series with a caption per value, positive values.
report('ch-types.rep', {
  ...chartSubreports(
    'CAT',
    SQL_CAT,
    ALL_TYPES.map((t) => ({ CHARTTYPE: t, VALUEEXPRESSION: '@.STOCK', CAPTIONEXPRESSION: '@.CATEGORY', caption: TYPE_NAMES[t] })),
    { title: 'Chart types' },
  ),
});

// Every chart type with two series (a year each, the change of serie by value), negative and
// positive values, a legend and the month captions; 12 points (lines draw their marks).
report('ch-types-multi.rep', {
  ...chartSubreports(
    'MON',
    SQL_MON,
    ALL_TYPES.map((t) => ({
      CHARTTYPE: t,
      VALUEEXPRESSION: '@.DELTA',
      CAPTIONEXPRESSION: '@.MONTH_NAME',
      CHANGESERIEEXPRESSION: '@.YEAR',
      SERIECAPTION: '@.YEARTEXT',
      SHOWLEGEND: true,
      caption: TYPE_NAMES[t] + ' 2 series',
    })),
    { title: 'Chart types, two series' },
  ),
});

// Changes of serie: boolean and by value, many series (the palette wraps, the legend overflows),
// series without caption ("Serie n"), captions from the first series only, horizontal bars.
report('ch-series.rep', {
  ...chartSubreports(
    'MON',
    SQL_MON,
    [
      { VALUEEXPRESSION: '@.N', CHANGESERIEEXPRESSION: '@.MONTH=1', CHANGESERIEBOOL: true, SERIECAPTION: '@.YEARTEXT', SHOWLEGEND: true, caption: 'bool: January' },
      { VALUEEXPRESSION: '@.N', CHANGESERIEEXPRESSION: '@.MONTH>6', CHANGESERIEBOOL: true, SERIECAPTION: '@.MONTH_NAME', SHOWLEGEND: true, caption: 'bool: after June' },
      { VALUEEXPRESSION: '@.N', CHANGESERIEEXPRESSION: '@.MONTH>6', CAPTIONEXPRESSION: '@.MONTH_NAME', SHOWLEGEND: true, caption: 'by value: halves' },
      { VALUEEXPRESSION: '@.N', CHANGESERIEEXPRESSION: 'True', CAPTIONEXPRESSION: '@.MONTH_NAME', SHOWLEGEND: true, caption: 'True by value: one' },
      { VALUEEXPRESSION: '@.N', CHANGESERIEEXPRESSION: '@.YEAR', SHOWLEGEND: true, caption: 'no serie caption' },
      { VALUEEXPRESSION: '@.N', CHANGESERIEEXPRESSION: '@.YEAR', SHOWLEGEND: false, CAPTIONEXPRESSION: '@.MONTH_NAME', caption: 'no legend' },
      { CHARTTYPE: ChartType.Horzbar, VALUEEXPRESSION: '@.DELTA', CHANGESERIEEXPRESSION: '@.YEAR', SERIECAPTION: '@.YEARTEXT', CAPTIONEXPRESSION: '@.MONTH_NAME', SHOWLEGEND: true, caption: 'horizontal 2 series' },
      { CHARTTYPE: ChartType.Line, VALUEEXPRESSION: '@.N', CHANGESERIEEXPRESSION: '@.YEAR', SERIECAPTION: '@.YEARTEXT', SHOWLEGEND: true, caption: 'lines 2 series' },
      { CHARTTYPE: ChartType.Area, VALUEEXPRESSION: '@.DELTA', CHANGESERIEEXPRESSION: '@.YEAR', SERIECAPTION: '@.YEARTEXT', SHOWLEGEND: true, caption: 'areas 2 series' },
      { CHARTTYPE: ChartType.Line, VALUEEXPRESSION: '@.N', CHANGESERIEEXPRESSION: '@.MONTH', SERIECAPTION: '@.MONTH_NAME', SHOWLEGEND: true, caption: 'lines, a serie per record' },
      { VALUEEXPRESSION: '@.N', CHANGESERIEEXPRESSION: '@.YEAR', CAPTIONEXPRESSION: '@.MONTH_NAME', SERIECAPTION: "'A very long caption of the serie '+@.YEARTEXT", SHOWLEGEND: true, WIDTH: 3500, caption: 'long legend' },
    ],
    { title: 'Series' },
  ),
});

// More series than colours in the palette: a serie per fish (28), each one a value.
report('ch-palette.rep', {
  ...chartSubreports(
    'FISH',
    SQL_FISH,
    [
      { VALUEEXPRESSION: '@.LENGTH_CM', CHANGESERIEEXPRESSION: 'True', CHANGESERIEBOOL: true, SERIECAPTION: '@.COMMON_NAME', SHOWLEGEND: true, WIDTH: 10700, HEIGHT: 4000, caption: '28 series' },
      { VALUEEXPRESSION: '@.LENGTH_CM', CHANGESERIEEXPRESSION: 'True', CHANGESERIEBOOL: true, SHOWLEGEND: true, WIDTH: 10700, HEIGHT: 4000, caption: '28 series without caption' },
      { CHARTTYPE: ChartType.Line, VALUEEXPRESSION: '@.LENGTH_CM', CAPTIONEXPRESSION: '@.COMMON_NAME', WIDTH: 10700, HEIGHT: 4000, caption: '28 points, no marks' },
      { CHARTTYPE: ChartType.Line, MARKSTYLE: 1, VALUEEXPRESSION: '@.LENGTH_CM', CAPTIONEXPRESSION: '@.COMMON_NAME', WIDTH: 10700, HEIGHT: 4000, caption: '28 points, marks' },
      { CHARTTYPE: ChartType.Splines, VALUEEXPRESSION: '@.LENGTH_CM', CHANGESERIEEXPRESSION: '@.CATEGORY', SERIECAPTION: '@.CATEGORY', SHOWLEGEND: true, WIDTH: 10700, HEIGHT: 4000, caption: 'splines by category' },
      { CHARTTYPE: ChartType.Horzbar, VALUEEXPRESSION: '@.LENGTH_CM', CAPTIONEXPRESSION: '@.COMMON_NAME', WIDTH: 10700, HEIGHT: 8000, caption: 'horizontal 28 bars' },
    ],
    { cols: 1, cellW: 10758, cellH: 4300, rows: 3, title: 'Palette' },
  ),
});

// Clear expressions (boolean and by value) and the value condition.
report('ch-clear.rep', {
  ...chartSubreports(
    'MON',
    SQL_MON,
    [
      { VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: '@.MONTH_NAME', CLEAREXPRESSION: '@.YEAR', caption: 'clear by year' },
      { VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: '@.MONTH_NAME', CLEAREXPRESSION: '@.MONTH=7', CLEAREXPRESSIONBOOL: true, caption: 'clear bool July' },
      { VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: '@.MONTH_NAME', CLEAREXPRESSION: '@.MONTH>12', CLEAREXPRESSIONBOOL: true, caption: 'clear never' },
      { VALUEEXPRESSION: '@.N', CHANGESERIEEXPRESSION: '@.MONTH>6', SERIECAPTION: '@.MONTH_NAME', SHOWLEGEND: true, CLEAREXPRESSION: '@.YEAR', caption: 'clear and change' },
      { VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: '@.MONTH_NAME', GETVALUECONDITION: '@.MONTH<=6', caption: 'condition first half' },
      { VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: '@.MONTH_NAME', GETVALUECONDITION: '@.MONTH>12', caption: 'condition never' },
      { VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: '@.MONTH_NAME', GETVALUECONDITION: '@.YEAR=2025', CLEAREXPRESSION: '@.MONTH=1', CLEAREXPRESSIONBOOL: true, caption: 'condition and clear' },
      { VALUEEXPRESSION: '', CAPTIONEXPRESSION: '@.MONTH_NAME', caption: 'no value expression' },
      { VALUEEXPRESSION: '@.N', VALUEXEXPRESSION: '@.MONTH', CAPTIONEXPRESSION: '@.MONTH_NAME', caption: 'X numbers' },
      { VALUEEXPRESSION: '@.N', VALUEXEXPRESSION: 'TODAY', CHARTTYPE: ChartType.Point, caption: 'X dates' },
      { VALUEEXPRESSION: 'IIF(@.MONTH=3, NULL, @.N)', CAPTIONEXPRESSION: '@.MONTH_NAME', caption: 'a null value' },
      { VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: '@.MONTH_NAME', CLEAREXPRESSION: '1/0', caption: 'clear 1/0' },
    ],
    { title: 'Clear and condition' },
  ),
});

// Value ranges: automatic and fixed bounds, negative, decimal, large and equal values.
const rangeCharts = (type) => [
  { VALUEEXPRESSION: '@.N', AUTORANGE: 4, YMIN: dbl(-50), YMAX: dbl(200), caption: 'fixed -50 200' },
  { VALUEEXPRESSION: '@.N', AUTORANGE: 4, YMIN: dbl(10), YMAX: dbl(20), caption: 'fixed inside the data' },
  { VALUEEXPRESSION: '@.N', AUTORANGE: 2, YMIN: dbl(5), YMAX: dbl(10), caption: 'auto upper, low 5' },
  { VALUEEXPRESSION: '@.N', AUTORANGE: 3, YMIN: dbl(-5), YMAX: dbl(1000), caption: 'auto lower, high 1000' },
  { VALUEEXPRESSION: '@.N', AUTORANGE: 1, YMIN: dbl(-100), YMAX: dbl(100), caption: 'auto both' },
  { VALUEEXPRESSION: '-@.N', caption: 'negative values' },
  { VALUEEXPRESSION: '-@.N', AUTORANGE: 4, YMIN: dbl(-100.5), YMAX: dbl(0.25), caption: 'negative, fixed' },
  { VALUEEXPRESSION: '@.SMALL', caption: 'decimals' },
  { VALUEEXPRESSION: '@.SMALL/100', caption: 'small decimals' },
  { VALUEEXPRESSION: '@.BIG', caption: 'large values' },
  { VALUEEXPRESSION: '@.BIG*1000', caption: 'millions' },
  { VALUEEXPRESSION: '7', caption: 'equal values' },
  { VALUEEXPRESSION: '0', caption: 'zeros' },
  { VALUEEXPRESSION: '@.DELTA*0.37', caption: 'both signs' },
  { VALUEEXPRESSION: '@.DELTA*0.37', AUTORANGE: 4, YMIN: dbl(-3.3), YMAX: dbl(7.7), caption: 'both signs, fixed' },
].map((c) => ({ CHARTTYPE: type, CAPTIONEXPRESSION: '@.MONTH_NAME', ...c }));
report('ch-ranges.rep', { ...chartSubreports('MON', SQL_MON, rangeCharts(ChartType.Bar), { title: 'Ranges' }) });
report('ch-ranges-lines.rep', {
  ...chartSubreports('MON', SQL_MON, [...rangeCharts(ChartType.Line), ...rangeCharts(ChartType.Horzbar)], { title: 'Ranges of lines and horizontal bars' }),
});
// The report language: the numbers of the axis with the Spanish culture of the language.
report('ch-ranges-lang.rep', { props: { LANGUAGE: 1 }, ...chartSubreports('MON', SQL_MON, rangeCharts(ChartType.Bar).slice(7, 12), { title: 'Language' }) });

// Infinite and NaN values: skipped by the range; the bars saturate (and Math.Abs may overflow,
// as in C#), a report each.
const infinite = {
  'ch-inf-bar': { VALUEEXPRESSION: "IIF(@.CATEGORY='Preserves', 1.5e308*10, @.N)", CAPTIONEXPRESSION: '@.CATEGORY' },
  'ch-inf-neg': { VALUEEXPRESSION: "IIF(@.CATEGORY='Preserves', -1.5e308*10, @.N)", CAPTIONEXPRESSION: '@.CATEGORY' },
  'ch-inf-nan': { VALUEEXPRESSION: "IIF(@.CATEGORY='Preserves', 1.5e308*10-1.5e308*10, @.N)", CAPTIONEXPRESSION: '@.CATEGORY' },
  'ch-inf-line': { CHARTTYPE: ChartType.Line, VALUEEXPRESSION: "IIF(@.CATEGORY='Preserves', 1.5e308*10, @.N)" },
  'ch-inf-line-neg': { CHARTTYPE: ChartType.Line, VALUEEXPRESSION: "IIF(@.CATEGORY='Preserves', -1.5e308*10, @.N)" },
  'ch-inf-horz': { CHARTTYPE: ChartType.Horzbar, VALUEEXPRESSION: "IIF(@.CATEGORY='Preserves', 1.5e308*10, @.N)" },
  'ch-inf-horz-neg': { CHARTTYPE: ChartType.Horzbar, VALUEEXPRESSION: "IIF(@.CATEGORY='Preserves', -1.5e308*10, @.N)" },
  'ch-inf-only': { VALUEEXPRESSION: '1.5e308*10' },
  'ch-inf-huge': { VALUEEXPRESSION: "IIF(@.CATEGORY='Preserves', 1.5e308, -1.5e308)", CAPTIONEXPRESSION: '@.CATEGORY' },
};
for (const [name, c] of Object.entries(infinite))
  report(name + '.rep', { ...chartSubreports('CAT', SQL_CAT, [{ ...c, caption: name }], { title: name }) });

// Fonts, colours, captions and sizes.
report('ch-style.rep', {
  ...chartSubreports(
    'MON',
    SQL_MON,
    [
      { VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: '@.MONTH_NAME', FONTSIZE: 0, caption: 'font size 0' },
      { VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: '@.MONTH_NAME', FONTSIZE: 12, FONTCOLOR: 255, TYPE1FONT: 1, WFONTNAME: 'Courier New', caption: 'Courier 12 red' },
      { VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: '@.MONTH_NAME', FONTSIZE: 6, TYPE1FONT: 2, WFONTNAME: '', caption: 'Times 6, no font name' },
      { VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: '@.MONTH_NAME', FONTSIZE: 30, caption: 'font too big' },
      { VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: '@.MONTH_NAME', WIDTH: 600, HEIGHT: 400, caption: 'too small' },
      { VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: '@.N', caption: 'number captions' },
      { VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: "@.MONTH_NAME+' of the year '+@.YEARTEXT", caption: 'long captions' },
      { CHARTTYPE: ChartType.Horzbar, VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: "@.MONTH_NAME+' of the year '+@.YEARTEXT", caption: 'long horizontal captions' },
      { VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: '@.MONTH_NAME', COLOREXPRESSION: '@.COL', caption: 'value colours' },
      { VALUEEXPRESSION: '@.N', CHANGESERIEEXPRESSION: '@.YEAR', SERIECOLOREXPRESSION: '@.SCOL', SHOWLEGEND: true, caption: 'serie colours' },
      { CHARTTYPE: ChartType.Line, VALUEEXPRESSION: '@.N', CHANGESERIEEXPRESSION: '@.YEAR', SERIECOLOREXPRESSION: '@.SCOL', COLOREXPRESSION: '@.COL', SHOWLEGEND: true, caption: 'line colours' },
      { VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: '@.MONTH_NAME', VIEW3D: true, VIEW3DWALLS: true, MULTIBAR: 2, ZOOM: 150, SERIESCOLORS: '255,65280', caption: '3D, stacked (no effect)' },
      { VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: '@.MONTH_NAME', PRINTCONDITION: 'False', caption: 'not printed' },
      { VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: '@.MONTH_NAME', DOBEFOREPRINT: "'before'", caption: 'before print' },
      { CHARTTYPE: ChartType.Point, VALUEEXPRESSION: '@.N', FONTSIZE: 20, WIDTH: 3500, HEIGHT: 2300, caption: 'points, big font' },
    ],
    { title: 'Style' },
  ),
});

// The GRAPHIC* functions and the chart identifier: values added from expressions of the detail.
report('ch-graphic.rep', {
  ...chartSubreports(
    'MON',
    SQL_MON,
    [
      { IDENTIFIER: 'GR1', SHOWLEGEND: true, caption: 'GRAPHICNEW' },
      { IDENTIFIER: 'GR2', CHARTTYPE: ChartType.Line, caption: 'GRAPHICNEWXY, FUNCTION' },
      { IDENTIFIER: 'GR3', caption: 'GRAPHICCLEAR on January' },
      { IDENTIFIER: 'GR4', VALUEEXPRESSION: '@.N', CAPTIONEXPRESSION: '@.MONTH_NAME', caption: 'GRAPHICBOUNDS' },
      { IDENTIFIER: 'GR5', VALUEEXPRESSION: '@.N', caption: 'expression and GRAPHICNEW' },
      { IDENTIFIER: 'GR6', VALUEEXPRESSION: '@.N', caption: 'GRAPHICBOUNDS auto' },
      { IDENTIFIER: 'GR7', caption: 'nothing' },
    ],
    {
      title: 'GRAPHIC functions',
      detail: [
        (a) => expr(`GRAPHICNEW('GR1', ${a}.N, ${a}.MONTH=1, ${a}.MONTH_NAME, ${a}.YEARTEXT)`, { WIDTH: 700 }),
        (a) => expr(`GRAPHICCOLOR('GR1', 255)`, { POSX: 800, WIDTH: 700, PRINTCONDITION: `${a}.MONTH=6` }),
        (a) => expr(`GRAPHICSERIECOLOR('GR1', 32768)`, { POSX: 1600, WIDTH: 700, PRINTCONDITION: `${a}.MONTH=12` }),
        (a) => expr(`GRAPHICNEWXY('gr2', ${a}.MONTH, ${a}.N+0.5, False, ${a}.MONTH_NAME, 'XY')`, { POSX: 2400, WIDTH: 700 }),
        (a) => expr(`GRAPHICNEWFUNCTION('GR2', 'AVERAGE', '3', 'Average')`, { POSX: 3200, WIDTH: 700, PRINTCONDITION: `${a}.MONTH=12` }),
        (a) => expr(`GRAPHICCLEAR('GR3')`, { POSX: 4000, WIDTH: 700, PRINTCONDITION: `${a}.MONTH=1` }),
        (a) => expr(`GRAPHICNEW('M.GR3', ${a}.DELTA, False, '', '')`, { POSX: 4800, WIDTH: 700 }),
        (a) => expr(`GRAPHICBOUNDS('GR4', False, False, -10, 60.5, False, 10, False)`, { POSX: 5600, WIDTH: 700, PRINTCONDITION: `${a}.MONTH=1` }),
        (a) => expr(`GRAPHICNEW('GR5', 100-${a}.N, True, 'n', 'second')`, { POSX: 6400, WIDTH: 700, PRINTCONDITION: `${a}.MONTH=12` }),
        (a) => expr(`GRAPHICBOUNDS('GR6', True, True, -1000, 1000, True, 2.5, True)`, { POSX: 7200, WIDTH: 700 }),
        (a) => expr(`GRAPHICCOLOR('GR7', 255)`, { POSX: 8000, WIDTH: 700, PRINTCONDITION: `${a}.MONTH=1` }),
        (a) => expr(`GRAPHICSERIECOLOR('GR7', 255)`, { POSX: 8600, WIDTH: 700, PRINTCONDITION: `${a}.MONTH=1` }),
        (a) => expr(`GRAPHICNEWFUNCTION('GR7', 'F', '', 'none')`, { POSX: 9200, WIDTH: 700, PRINTCONDITION: `${a}.MONTH=1` }),
        () => expr(`IIF(GR7=NULL, 'null', GR7)`, { POSX: 9800, WIDTH: 900 }),
      ],
    },
  ),
});

// The chart identifier is a variable: assigned and read.
report('ch-identifier.rep', {
  data: [datainfo('CAT', SQL_CAT)],
  subs: [
    subreport('CAT', [
      section('groupheader', { HEIGHT: 300, GROUPNAME: 'G', CHANGEEXPRESSION: "'X'" }, [expr("'['+STR(IIF(CH=NULL, -1, 1))+']'", { WIDTH: 3000 })]),
      section('detail', { HEIGHT: 250 }, [expr('CAT.CATEGORY', { WIDTH: 3000 }), expr('CH:=CAT.N', { POSX: 3100, WIDTH: 1000 }), expr('M.CH', { POSX: 4200, WIDTH: 1000 })]),
      section('groupfooter', { HEIGHT: 2600, GROUPNAME: 'G' }, [
        chart({ IDENTIFIER: 'CH', VALUEEXPRESSION: 'CAT.N', CAPTIONEXPRESSION: 'CAT.CATEGORY', WIDTH: 5000 }),
        expr('CH', { POSX: 5200, WIDTH: 1000 }),
      ]),
    ]),
  ],
});

// Charts in a detail section (printed with the values so far), in the page footer and in a child
// subreport (the series are not cleared when it starts again).
report('ch-sections.rep', {
  data: [
    datainfo('CAT', SQL_CAT),
    datainfo('CATS', 'SELECT CATEGORY_ID, NAME FROM CATEGORIES WHERE CATEGORY_ID <= 3 ORDER BY CATEGORY_ID'),
    datainfo('PROD', 'SELECT CATEGORY_ID, NAME, UNITS_IN_STOCK FROM PRODUCTS WHERE CATEGORY_ID = :CATEGORY_ID ORDER BY PRODUCT_ID', { DATASOURCE: 'CATS' }),
  ],
  params: [param('CATEGORY_ID', 0, ['PROD'])],
  subs: [
    subreport('CAT', [
      section('pageheader', { HEIGHT: 300 }, [label('Charts in sections', { WIDTH: 5000, FONTSTYLE: 1 })]),
      section('detail', { HEIGHT: 1500 }, [
        expr('CAT.CATEGORY', { WIDTH: 3000 }),
        chart({ VALUEEXPRESSION: 'CAT.STOCK', CAPTIONEXPRESSION: 'CAT.CATEGORY', POSX: 3200, WIDTH: 7000, HEIGHT: 1450, FONTSIZE: 6 }),
      ]),
      section('pagefooter', { HEIGHT: 1500 }, [chart({ CHARTTYPE: ChartType.Line, VALUEEXPRESSION: 'CAT.N', WIDTH: 10000, HEIGHT: 1450, FONTSIZE: 6 })]),
    ], { NAME: 'TRpSubReport0' }),
    subreport('CATS', [
      section('detail', { HEIGHT: 300, CHILDSUBREPORT: 'TRPSUBREPORT2' }, [expr('CATS.NAME', { WIDTH: 4000 })]),
    ], { NAME: 'TRpSubReport1' }),
    subreport('PROD', [
      section('groupheader', { HEIGHT: 0, GROUPNAME: 'GP', CHANGEEXPRESSION: "'X'" }, []),
      section('detail', { HEIGHT: 220 }, [expr('PROD.NAME', { POSX: 500, WIDTH: 5000, FONTSIZE: 6 })]),
      section('groupfooter', { HEIGHT: 2000, GROUPNAME: 'GP' }, [chart({ VALUEEXPRESSION: 'PROD.UNITS_IN_STOCK', CAPTIONEXPRESSION: 'PROD.NAME', WIDTH: 10000, HEIGHT: 1900, FONTSIZE: 5 })]),
    ], { NAME: 'TRpSubReport2', PARENTSUBREPORT: 'TRpSubReport1' }),
  ],
});

// Errors of the C# engine.
const errorReport = (file, chartProps, detail = []) =>
  report(file, {
    data: [datainfo('MON', SQL_MON)],
    subs: [
      subreport('MON', [
        section('groupheader', { HEIGHT: 300, GROUPNAME: 'G', CHANGEEXPRESSION: "'X'" }, [label('Error', { WIDTH: 3000 })]),
        section('detail', { HEIGHT: 250 }, detail),
        section('groupfooter', { HEIGHT: 2600, GROUPNAME: 'G' }, [chart({ IDENTIFIER: 'GR1', ...chartProps })]),
      ]),
    ],
  });
errorReport('ch-err-notchart.rep', {}, [expr("GRAPHICNEW('NOPE', 1, False, '', '')", { WIDTH: 2000 })]);
errorReport('ch-err-field.rep', {}, [expr("GRAPHICCLEAR('MON.N')", { WIDTH: 2000 })]);
errorReport('ch-err-type.rep', {}, [expr("GRAPHICCOLOR('GR1', 1.5)", { WIDTH: 2000 })]);
errorReport('ch-err-bounds.rep', {}, [expr("GRAPHICBOUNDS('GR1', True, True, 0, 1, False, 'x', False)", { WIDTH: 2000 })]);
errorReport('ch-err-value.rep', { VALUEEXPRESSION: 'MON.MONTH_NAME' });
errorReport('ch-err-valuex.rep', { VALUEEXPRESSION: 'MON.N', VALUEXEXPRESSION: 'MON.MONTH_NAME' });
errorReport('ch-err-color.rep', { VALUEEXPRESSION: 'MON.N', COLOREXPRESSION: '1.5' });
errorReport('ch-err-seriecolor.rep', { VALUEEXPRESSION: 'MON.N', SERIECOLOREXPRESSION: "'red'" });
errorReport('ch-err-clear.rep', { VALUEEXPRESSION: 'MON.N', CLEAREXPRESSION: 'UNKNOWNIDEN' });
errorReport('ch-err-clearbool.rep', { VALUEEXPRESSION: 'MON.N', CLEAREXPRESSION: 'MON.MONTH_NAME', CLEAREXPRESSIONBOOL: true });
errorReport('ch-err-condition.rep', { VALUEEXPRESSION: 'MON.N', GETVALUECONDITION: "'x'" });
errorReport('ch-err-changeserie.rep', { VALUEEXPRESSION: 'MON.N', CHANGESERIEEXPRESSION: 'MON.SMALL', CHANGESERIEBOOL: true });
errorReport('ch-err-seriecaption.rep', { VALUEEXPRESSION: 'MON.N', CHANGESERIEEXPRESSION: 'MON.YEAR', SERIECAPTION: 'UNKNOWNIDEN' });
errorReport('ch-err-caption.rep', { VALUEEXPRESSION: 'MON.N', CAPTIONEXPRESSION: 'MON.N+' });

console.log(written.join('\n'));
