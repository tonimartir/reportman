// Writes the synthetic reports of the run parity tests (fixtures/run/syn-*.rep): XML reports over
// samples.db for what the samples do not cover. Each report is described compactly below and
// written with the tags and defaults of a report saved by the designer.
//
//   node test/synthetic/make-reports.mjs      (from packages/reportman-engine)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../fixtures/run');
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
  INTERLINE: 0, WORDWRAP: false, WORDBREAK: false, SINGLELINE: false, MULTIPAGE: false, PRINTSTEP: 0,
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
// The reports

// Groups: two group levels, a group header repeated on every page, page header and footer,
// aggregates by group, page and report, PAGENUM restarted by group, a group footer forced.
report('syn-groups.rep', {
  data: [
    datainfo(
      'ORD',
      'SELECT C.COUNTRY, C.CITY, C.COMPANY_NAME, O.ORDER_NUMBER, O.ORDER_DATE, O.VAT_RATE, O.ORDER_ID FROM ORDERS O ' +
        "JOIN CUSTOMERS C ON C.CUSTOMER_ID = O.CUSTOMER_ID WHERE C.COUNTRY < 'H' AND O.ORDER_ID % 3 = 0 ORDER BY C.COUNTRY, C.CITY, O.ORDER_ID",
    ),
  ],
  subs: [
    subreport('ORD', [
      section('pageheader', { HEIGHT: 500 }, [
        label('Orders by country and city', { FONTSIZE: 14, FONTSTYLE: 1, WIDTH: 6000, HEIGHT: 350 }),
        expr("'Page '+STR(PAGE)+' group page '+STR(PAGENUM)", { POSX: 7000, WIDTH: 3700, ALIGNMENT: 1 }),
      ]),
      section('groupheader', { HEIGHT: 400, GROUPNAME: 'COUNTRY', CHANGEEXPRESSION: 'ORD.COUNTRY', PAGEREPEAT: true, ININUMPAGE: true }, [
        shape({ WIDTH: 10758, HEIGHT: 380, BRUSHSTYLE: 0, BRUSHCOLOR: 15790320, PENSTYLE: 5 }),
        expr('ORD.COUNTRY', { POSX: 100, POSY: 50, WIDTH: 5000, FONTSTYLE: 1 }),
        expr('CURRENTGROUP', { POSX: 6000, POSY: 50, WIDTH: 1000 }),
      ]),
      section('groupheader', { HEIGHT: 300, GROUPNAME: 'CITY', CHANGEEXPRESSION: 'ORD.CITY' }, [
        expr("'  '+ORD.CITY", { POSX: 200, WIDTH: 5000, FONTSTYLE: 2 }),
      ]),
      section('detail', { HEIGHT: 260 }, [
        expr('ORD.ORDER_NUMBER', { POSX: 600, WIDTH: 1500, FONTSIZE: 9 }),
        expr('ORD.COMPANY_NAME', { POSX: 2200, WIDTH: 4000, FONTSIZE: 9 }),
        expr('ORD.ORDER_DATE', { POSX: 6300, WIDTH: 1500, FONTSIZE: 9, DISPLAYFORMAT: 'dd/MM/yyyy' }),
        expr('ORD.VAT_RATE', { POSX: 7900, WIDTH: 1000, FONTSIZE: 9, DISPLAYFORMAT: '#,##0.00', ALIGNMENT: 1 }),
        expr('ORD.VAT_RATE', { POSX: 9000, WIDTH: 1500, FONTSIZE: 9, AGGREGATE: 3, AGTYPE: 0, DISPLAYFORMAT: '#,##0.00', ALIGNMENT: 1 }),
      ]),
      section('groupfooter', { HEIGHT: 280, GROUPNAME: 'CITY' }, [
        expr('1', { POSX: 600, WIDTH: 1000, AGGREGATE: 1, GROUPNAME: 'CITY', FONTSIZE: 8 }),
        expr('ORD.VAT_RATE', { POSX: 2000, WIDTH: 1500, AGGREGATE: 1, GROUPNAME: 'CITY', AGTYPE: 3, DISPLAYFORMAT: '0.000', FONTSIZE: 8 }),
      ]),
      section('groupfooter', { HEIGHT: 320, GROUPNAME: 'COUNTRY', FORCEPRINT: true }, [
        expr("'Orders of '+ORD.COUNTRY", { POSX: 100, WIDTH: 4000, FONTSTYLE: 1 }),
        expr('1', { POSX: 4200, WIDTH: 1000, AGGREGATE: 1, GROUPNAME: 'COUNTRY' }),
        expr('ORD.VAT_RATE', { POSX: 5300, WIDTH: 1300, AGGREGATE: 1, GROUPNAME: 'COUNTRY', AGTYPE: 1 }),
        expr('ORD.VAT_RATE', { POSX: 6700, WIDTH: 1300, AGGREGATE: 1, GROUPNAME: 'COUNTRY', AGTYPE: 2 }),
        expr('ORD.VAT_RATE', { POSX: 8100, WIDTH: 2500, AGGREGATE: 1, GROUPNAME: 'COUNTRY', AGTYPE: 4, DISPLAYFORMAT: '0.0000' }),
      ]),
      section('pagefooter', { HEIGHT: 300 }, [
        expr('ORD.VAT_RATE', { WIDTH: 3000, AGGREGATE: 2, DISPLAYFORMAT: '"Page sum "#,##0.00' }),
        expr('FREE_SPACE_TWIPS', { POSX: 4000, WIDTH: 2000 }),
        expr('PAGEWIDTH+PAGEHEIGHT', { POSX: 6500, WIDTH: 2000 }),
      ]),
    ]),
  ],
});

// Master/detail: customers, their orders (a child subreport re-executed when the customer moves,
// DataSource) and the lines of each order (a third level); a child subreport whose dataset has no
// master is opened again for each customer with an expression parameter (ExpreB); a second
// top-level subreport without dataset.
report('syn-masterdetail.rep', {
  data: [
    datainfo('CUST', 'SELECT CUSTOMER_ID, CODE, COMPANY_NAME, COUNTRY FROM CUSTOMERS WHERE CUSTOMER_ID <= 9 ORDER BY CUSTOMER_ID'),
    datainfo(
      'ORD',
      "SELECT ORDER_ID, ORDER_NUMBER, ORDER_DATE, CUSTOMER_ID FROM ORDERS WHERE CUSTOMER_ID = :CUSTOMER_ID AND ORDER_DATE >= '2025-10-01' ORDER BY ORDER_ID",
      { DATASOURCE: 'CUST' },
    ),
    datainfo('LIN', 'SELECT ORDER_ID, LINE_NO, PRODUCT_ID, QUANTITY, UNIT_PRICE FROM ORDER_LINES WHERE ORDER_ID = :ORDER_ID ORDER BY LINE_NO', {
      DATASOURCE: 'ORD',
    }),
    datainfo('TOT', 'SELECT COUNT(*) AS N, SUM(VAT_RATE) AS VAT FROM ORDERS WHERE CUSTOMER_ID = :CID'),
  ],
  params: [
    param('CUSTOMER_ID', 1, 0, { VISIBLE: false, DATASETS: ['ORD'] }),
    param('ORDER_ID', 1, 0, { VISIBLE: false, DATASETS: ['LIN'] }),
    param('CURID', 1, 0, { VISIBLE: false }),
    param('CID', 8, 'M.CURID', { VISIBLE: false, DATASETS: ['TOT'] }),
  ],
  subs: [
    subreport(
      'CUST',
      [
        section('pageheader', { HEIGHT: 400 }, [label('Customers, orders and lines', { WIDTH: 6000, FONTSIZE: 12, FONTSTYLE: 1 })]),
        section('detail', { HEIGHT: 300, CHILDSUBREPORT: 'TRPSUBREPORT1' }, [
          expr('CUST.CODE', { WIDTH: 1200, FONTSTYLE: 1 }),
          expr('CUST.COMPANY_NAME', { POSX: 1300, WIDTH: 4000, FONTSTYLE: 1 }),
          expr('CUST.COUNTRY', { POSX: 5400, WIDTH: 2000 }),
        ]),
        section('detail', { HEIGHT: 260, CHILDSUBREPORT: 'TRPSUBREPORT3', DOBEFOREPRINT: 'M.CURID:=CUST.CUSTOMER_ID' }, [expr("'Totals of '+CUST.CODE", { POSX: 300, WIDTH: 3000, FONTSIZE: 8 })]),
        section('pagefooter', { HEIGHT: 300 }, [expr("'Page '+STR(PAGE)", { WIDTH: 2000 })]),
      ],
      { NAME: 'TRpSubReport0' },
    ),
    subreport(
      'ORD',
      [
        section('groupheader', { HEIGHT: 260, GROUPNAME: 'ORDS', CHANGEEXPRESSION: "'X'" }, [
          label('Orders since October 2025', { POSX: 300, WIDTH: 4000, FONTSIZE: 8, FONTSTYLE: 2 }),
        ]),
        section('detail', { HEIGHT: 250, CHILDSUBREPORT: 'TRPSUBREPORT2' }, [
          expr('ORD.ORDER_NUMBER', { POSX: 300, WIDTH: 1600, FONTSIZE: 9 }),
          expr('ORD.ORDER_DATE', { POSX: 2000, WIDTH: 1600, FONTSIZE: 9, DISPLAYFORMAT: 'yyyy-MM-dd' }),
          expr('ORD.CUSTOMER_ID', { POSX: 3700, WIDTH: 800, FONTSIZE: 9 }),
        ]),
        section('groupfooter', { HEIGHT: 250, GROUPNAME: 'ORDS' }, [
          expr('1', { POSX: 300, WIDTH: 3000, FONTSIZE: 8, AGGREGATE: 1, GROUPNAME: 'ORDS', DISPLAYFORMAT: '0 "orders"' }),
        ]),
      ],
      { NAME: 'TRpSubReport1', PARENTSUBREPORT: 'TRpSubReport0', PRINTONLYIFDATAAVAILABLE: false },
    ),
    subreport(
      'LIN',
      [
        section('detail', { HEIGHT: 220 }, [
          expr('LIN.LINE_NO', { POSX: 900, WIDTH: 500, FONTSIZE: 8 }),
          expr('LIN.PRODUCT_ID', { POSX: 1500, WIDTH: 800, FONTSIZE: 8 }),
          expr('LIN.QUANTITY*LIN.UNIT_PRICE', { POSX: 2400, WIDTH: 1500, FONTSIZE: 8, DISPLAYFORMAT: '#,##0.00', ALIGNMENT: 1 }),
        ]),
      ],
      { NAME: 'TRpSubReport2', PARENTSUBREPORT: 'TRpSubReport1' },
    ),
    subreport(
      'TOT',
      [section('detail', { HEIGHT: 240 }, [expr("STR(TOT.N)+' orders, VAT '+STR(TOT.VAT)", { POSX: 600, WIDTH: 5000, FONTSIZE: 8 })])],
      { NAME: 'TRpSubReport3', PARENTSUBREPORT: 'TRpSubReport0' },
    ),
    subreport(
      '',
      [section('detail', { HEIGHT: 400 }, [label('End of the customers', { WIDTH: 5000, FONTSTYLE: 1 }), expr("EOF('CUST')", { POSX: 5500, WIDTH: 1500 })])],
      { NAME: 'TRpSubReport4' },
    ),
  ],
});

// Parameters of every type: bound to the SQL (typed), substituted into its text, evaluated before
// and after opening, lists, a multiple selection, initial values; printed back with PARAMINFO.
report('syn-params.rep', {
  data: [
    datainfo(
      'D1',
      'SELECT ORDER_ID, ORDER_NUMBER, ORDER_DATE, VAT_RATE FROM ORDERS WHERE ORDER_ID BETWEEN :FROMID AND :TOID ' +
        'AND ORDER_DATE >= :FROMDATE AND VAT_RATE <= :MAXVAT AND (:FLAG = 1 OR VAT_RATE > 0) AND ORDER_ID <> :EXB ' +
        'AND ORDER_ID NOT IN ({IDS}) {COND} ORDER BY {ORDERBY} LIMIT {LIM}',
    ),
    datainfo('D2', 'SELECT COMPANY_NAME, COUNTRY FROM CUSTOMERS WHERE COUNTRY = :COUNTRY AND COMPANY_NAME LIKE :PATTERN ORDER BY COMPANY_NAME'),
  ],
  params: [
    param('FROMID', 1, 5, { DATASETS: ['D1'] }),
    param('TOID', 1, 60, { DATASETS: ['D1'] }),
    param('FROMDATE', 3, delphiDate(2024, 2, 1), { DATASETS: ['D1'] }),
    param('MAXVAT', 2, 21.5, { DATASETS: ['D1'] }),
    param('FLAG', 7, true, { DATASETS: ['D1'] }),
    param('AMOUNT', 6, 1234.5),
    param('ATIME', 4, delphiDate(1899, 12, 30, 9, 45, 30)),
    param('ADATETIME', 5, delphiDate(2025, 6, 15, 18, 30, 0)),
    param('EXB', 8, '10*4', { DATASETS: ['D1'] }),
    param('EXA', 9, 'M.TOID*2'),
    param('COND', 10, 'AND ORDER_ID > 6', { SEARCH: '{COND}', DATASETS: ['D1'] }),
    param('ORDERBY', 14, "'ORDER_DATE DESC, ORDER_ID'", {
      SEARCH: '{ORDERBY}',
      DATASETS: ['D1'],
      ITEMS: ['By number', 'By date'],
      VALUES: ["'ORDER_NUMBER'", "'ORDER_DATE DESC, ORDER_ID'"],
    }),
    param('LIM', 13, '2+18', { SEARCH: '{LIM}', DATASETS: ['D1'] }),
    param('IDS', 12, '', { SEARCH: '{IDS}', DATASETS: ['D1'], ITEMS: ['Seven', 'Eight', 'Nine'], VALUES: ['7', '8', '9'], SELECTED: ['7', '9'] }),
    param('COUNTRY', 11, "'France'", { DATASETS: ['D2'], ITEMS: ['Spain', 'France'], VALUES: ["'Spain'", "'France'"] }),
    param('PATTERN', 0, 'L%', { DATASETS: ['D2'] }),
    param('INIT1', 15, '1+2'),
    param('INIT2', 15, "'abc'+'d'"),
    param('COUNTER', 1, 0, { VISIBLE: false }),
    param('ONE', 12, '', { ITEMS: ['Only'], VALUES: ['8'], SELECTED: ['8'] }),
  ],
  subs: [
    subreport('D1', [
      section('pageheader', { HEIGHT: 2200 }, [
        expr('M.FROMID', { WIDTH: 2000 }),
        expr('M.TOID', { POSX: 2100, WIDTH: 2000 }),
        expr('M.FROMDATE', { POSY: 250, WIDTH: 3000, DISPLAYFORMAT: 'dddd d MMMM yyyy' }),
        expr('M.MAXVAT', { POSY: 500, WIDTH: 2000 }),
        expr('M.FLAG', { POSY: 750, WIDTH: 2000 }),
        expr('M.AMOUNT', { POSX: 4500, WIDTH: 2500, DISPLAYFORMAT: '#,##0.00' }),
        expr('M.ATIME', { POSX: 4500, POSY: 250, WIDTH: 2500, DISPLAYFORMAT: 'HH:mm:ss' }),
        expr('M.ADATETIME', { POSX: 4500, POSY: 500, WIDTH: 3000 }),
        expr('M.EXB', { POSX: 4500, POSY: 750, WIDTH: 2500 }),
        expr('M.EXA', { POSX: 7600, WIDTH: 2500 }),
        expr('M.ORDERBY', { POSX: 7600, POSY: 250, WIDTH: 3000 }),
        expr('M.IDS', { POSX: 7600, POSY: 500, WIDTH: 3000 }),
        expr('M.COUNTRY', { POSX: 7600, POSY: 750, WIDTH: 3000 }),
        expr("STR(M.INIT1)+' '+M.INIT2", { POSY: 1000, WIDTH: 3000 }),
        expr("PARAMINFO('IDS',0)+'|'+PARAMINFO('IDS',1)+'|'+PARAMINFO('IDS',6)+'|'+PARAMINFO('IDS',7)", { POSX: 3100, POSY: 1000, WIDTH: 7000 }),
        expr("PARAMINFO('ONE',1)+'|'+PARAMINFO('ONE',2)+'|'+PARAMINFO('ONE',3)+'|'+PARAMINFO('ONE',4)+'|'+PARAMINFO('ONE',5)", { POSY: 1250, WIDTH: 10000 }),
        expr(
          "PARAMINFO('COUNTRY',0)+'|'+PARAMINFO('COUNTRY',1)+'|'+PARAMINFO('COUNTRY',2)+'|'+PARAMINFO('COUNTRY',3)+'|'+PARAMINFO('COUNTRY',8)+'|'+PARAMINFO('COUNTRY',10)",
          { POSY: 1500, WIDTH: 10000 },
        ),
        expr("PARAMINFO('FROMID',0)+'|'+PARAMINFO('FROMID',6)+'|'+PARAMINFO('FROMID',7)", { POSY: 1750, WIDTH: 10000 }),
      ]),
      section('detail', { HEIGHT: 250, DOAFTERPRINT: 'M.COUNTER:=M.COUNTER+1' }, [
        expr('D1.ORDER_ID', { WIDTH: 800 }),
        expr('D1.ORDER_NUMBER', { POSX: 900, WIDTH: 1600 }),
        expr('D1.ORDER_DATE', { POSX: 2600, WIDTH: 1600 }),
        expr('D1.VAT_RATE', { POSX: 4300, WIDTH: 1000 }),
        expr('M.COUNTER', { POSX: 5400, WIDTH: 1000 }),
      ]),
    ]),
    subreport('D2', [section('detail', { HEIGHT: 250 }, [expr('D2.COMPANY_NAME', { WIDTH: 5000 }), expr('D2.COUNTRY', { POSX: 5100, WIDTH: 3000 })])]),
  ],
});

const LONG_NOTES = "(NOTES||' '||NOTES||' '||NOTES||' '||NOTES||' '||NOTES||' '||NOTES||' '||NOTES||' '||NOTES)";

// Layout: sections that grow and shrink with their items (AutoExpand, AutoContract), a text that
// continues on the next pages (MultiPage), print conditions, before and after print expressions,
// a group footer at the bottom of the page (AlignBottom) and one that ends the page (SkipPage), a
// group that begins a page (BeginPageExpression), items aligned to the section, PrintOnlyOne,
// PrintNulls, text formats, shapes, and the report functions TEXTOP, GRAPHICOP and TEXTHEIGHT.
report('syn-layout.rep', {
  data: [
    datainfo('FIS', 'SELECT SPECIES_NO, CATEGORY, COMMON_NAME, SPECIES_NAME, LENGTH_CM, NOTES, ' + LONG_NOTES + ' AS LONGNOTES, ' +
      'CASE WHEN SPECIES_NO % 3 = 0 THEN NULL ELSE LENGTH_IN END AS LEN_IN FROM FISHES WHERE SPECIES_NO < 90200 ORDER BY CATEGORY, SPECIES_NO'),
  ],
  params: [param('COUNTER', 1, 0, { VISIBLE: false })],
  subs: [
    subreport('FIS', [
      section('pageheader', { HEIGHT: 700, DOBEFOREPRINT: "TEXTOP(9000,100,1500,300,'textop','Helvetica','Arial',8,0,1,255,0,False,1,False,False,0,16777215,True)" }, [
        label('Layout', { WIDTH: 3000, HEIGHT: 400, FONTSIZE: 16, FONTSTYLE: 3, TYPE1FONT: 2 }),
        label('centered', { POSX: 3200, WIDTH: 2500, ALIGNMENT: 2, VALIGNMENT: 2, HEIGHT: 400, TRANSPARENT: false, BACKCOLOR: 13421772 }),
        label('right', { POSX: 5800, WIDTH: 2000, ALIGNMENT: 1, VALIGNMENT: 1, HEIGHT: 400, TYPE1FONT: 1 }),
        label('rotated', { POSX: 8000, POSY: 100, WIDTH: 900, HEIGHT: 500, FONTROTATION: 450, FONTSIZE: 7 }),
        expr("TEXTHEIGHT('A long text to measure with the device, in a narrow box','Helvetica','Arial',1500,10,0,0,0)", { POSY: 450, WIDTH: 3000, FONTSIZE: 7 }),
        expr("FREE_SPACE_TWIPS+CURRENTPOSY", { POSX: 3200, POSY: 450, WIDTH: 2000, FONTSIZE: 7 }),
        expr("IIF(FIRSTSECTION,'first','not first')", { POSX: 5300, POSY: 450, WIDTH: 2000, FONTSIZE: 7 }),
      ]),
      section('groupheader', {
        HEIGHT: 350, GROUPNAME: 'CAT', CHANGEEXPRESSION: 'FIS.CATEGORY', BEGINPAGEEXPRESSION: "FIS.CATEGORY='Shark'",
        DOBEFOREPRINT: 'GRAPHICOP(574,CURRENTPOSY,10758,20,6,0,0,0,10,8421504)',
      }, [expr('FIS.CATEGORY', { POSY: 40, WIDTH: 5000, FONTSTYLE: 1, PRINTONLYONE: true })]),
      section('detail', { HEIGHT: 600, AUTOEXPAND: true, AUTOCONTRACT: true, DOAFTERPRINT: 'M.COUNTER:=M.COUNTER+1' }, [
        shape({ WIDTH: 10758, HEIGHT: 600, ALIGN: 6, BRUSHSTYLE: 1, PENCOLOR: 12632256 }),
        shape({ POSX: 2400, WIDTH: 20, HEIGHT: 600, SHAPE: 7, ALIGN: 5 }),
        expr('FIS.COMMON_NAME', { POSX: 100, POSY: 50, WIDTH: 2200, FONTSTYLE: 1, CUTTEXT: true }),
        expr('FIS.SPECIES_NAME', { POSX: 100, POSY: 300, WIDTH: 2200, FONTSIZE: 8, FONTSTYLE: 2, PRINTCONDITION: 'FIS.SPECIES_NO<90100' }),
        expr('FIS.NOTES', { POSX: 2500, POSY: 50, WIDTH: 6000, HEIGHT: 250, FONTSIZE: 8, WORDWRAP: true, ALIGNMENT: 3, AUTOEXPAND: true }),
        expr('FIS.LEN_IN', { POSX: 8600, POSY: 50, WIDTH: 1000, DISPLAYFORMAT: '0.00', PRINTNULLS: false, ALIGNMENT: 1 }),
        expr('M.COUNTER', { POSX: 9700, POSY: 50, WIDTH: 900, ALIGNMENT: 1, ANNOTATION: "'Record '+STR(M.COUNTER+1)" }),
        expr("'bottom'", { POSX: 8600, POSY: 350, WIDTH: 1000, HEIGHT: 200, FONTSIZE: 6, ALIGN: 1 }),
      ]),
      section('groupfooter', { HEIGHT: 300, GROUPNAME: 'CAT', ALIGNBOTTOM: false, PRINTCONDITION: "FIS.CATEGORY<>'Cod'" }, [
        expr('FIS.LENGTH_CM', { WIDTH: 3000, AGGREGATE: 1, GROUPNAME: 'CAT', DISPLAYFORMAT: '"Total length "0.0' }),
      ]),
      section('pagefooter', { HEIGHT: 300 }, [expr("'Page '+STR(PAGE)+' records '+STR(M.COUNTER)", { WIDTH: 4000 })]),
    ]),
  ],
});

// Long texts that continue on the next pages (MultiPage in AutoExpand sections), a group footer at
// the bottom of the page and a section that ends the page.
report('syn-multipage.rep', {
  data: [datainfo('FIS', 'SELECT SPECIES_NO, CATEGORY, COMMON_NAME, ' + LONG_NOTES + ' AS LONGNOTES FROM FISHES WHERE SPECIES_NO IN (90020, 90030, 90050, 90070) ORDER BY SPECIES_NO')],
  subs: [
    subreport('FIS', [
      section('pageheader', { HEIGHT: 400 }, [label('Multipage notes', { WIDTH: 5000, FONTSIZE: 14 }), expr('PAGE', { POSX: 9000, WIDTH: 1000 })]),
      section('groupheader', { HEIGHT: 300, GROUPNAME: 'FISH', CHANGEEXPRESSION: 'FIS.SPECIES_NO' }, [expr('FIS.COMMON_NAME', { WIDTH: 5000, FONTSTYLE: 1 })]),
      section('detail', { HEIGHT: 300, AUTOEXPAND: true, AUTOCONTRACT: true }, [
        expr('FIS.LONGNOTES', { POSX: 300, WIDTH: 4200, HEIGHT: 300, FONTSIZE: 12, WORDWRAP: true, MULTIPAGE: true }),
        shape({ POSX: 300, POSY: 0, WIDTH: 4200, HEIGHT: 20, SHAPE: 6, ALIGN: 1, PENWIDTH: 10 }),
        expr("'note of '+STR(FIS.SPECIES_NO)", { POSX: 5000, WIDTH: 3000, FONTSIZE: 7 }),
      ]),
      section('groupfooter', { HEIGHT: 400, GROUPNAME: 'FISH', ALIGNBOTTOM: true }, [expr("'End of '+FIS.COMMON_NAME", { WIDTH: 5000, FONTSTYLE: 2 })]),
      section('pagefooter', { HEIGHT: 300 }, [expr("'Page '+STR(PAGE)", { WIDTH: 3000 })]),
    ]),
  ],
});

// Two pass: PAGECOUNT with and without a display format, the group page count, the skips of a
// section (to a page, and to a position) that need the whole report first.
report('syn-twopass.rep', {
  props: { TWOPASS: true },
  data: [datainfo('CUS', 'SELECT CUSTOMER_ID, COMPANY_NAME, COUNTRY, CITY FROM CUSTOMERS ORDER BY COUNTRY, CITY, CUSTOMER_ID')],
  subs: [
    subreport('CUS', [
      section('pageheader', { HEIGHT: 400 }, [
        expr("'Page '+STR(PAGE)", { WIDTH: 1500 }),
        expr('PAGECOUNT', { POSX: 1600, WIDTH: 1000 }),
        expr('PAGECOUNT', { POSX: 2700, WIDTH: 1500, DISPLAYFORMAT: '000' }),
      ]),
      section('groupheader', { HEIGHT: 350, GROUPNAME: 'COUNTRY', CHANGEEXPRESSION: 'CUS.COUNTRY', PAGEREPEAT: true, ININUMPAGE: true }, [
        expr('CUS.COUNTRY', { WIDTH: 3000, FONTSTYLE: 1 }),
        expr('GROUPPAGECOUNT', { POSX: 3200, WIDTH: 1000 }),
        expr('PAGENUM', { POSX: 4300, WIDTH: 1000 }),
      ]),
      section('detail', { HEIGHT: 900 }, [expr('CUS.COMPANY_NAME', { WIDTH: 5000 }), expr('CUS.CITY', { POSX: 5200, WIDTH: 3000 })]),
      section('groupfooter', { HEIGHT: 300, GROUPNAME: 'COUNTRY', SKIPTYPE: 2, SKIPEXPREV: '200', SKIPRELATIVEV: true, SKIPEXPREH: '574' }, [
        expr("'Customers of '+CUS.COUNTRY", { WIDTH: 4000 }),
        expr('1', { POSX: 4200, WIDTH: 1000, AGGREGATE: 1, GROUPNAME: 'COUNTRY' }),
      ]),
      section('pagefooter', { HEIGHT: 300 }, [expr("'of '+STR(PAGE)", { WIDTH: 2000 }), expr('PAGECOUNT', { POSX: 2100, WIDTH: 1000 })]),
    ]),
  ],
});

// One pass with page counts: the C# device draws each page as soon as it exists, so the pages
// before the last show the page count still blank in its PDF, and the metafile has it.
report('syn-pagecount.rep', {
  data: [datainfo('CUS', 'SELECT CUSTOMER_ID, COMPANY_NAME, COUNTRY FROM CUSTOMERS ORDER BY COUNTRY, CUSTOMER_ID')],
  subs: [
    subreport('CUS', [
      section('pageheader', { HEIGHT: 400 }, [expr("'Page '+STR(PAGE)", { WIDTH: 1500 }), expr('PAGECOUNT', { POSX: 1600, WIDTH: 1000 })]),
      section('groupheader', { HEIGHT: 350, GROUPNAME: 'COUNTRY', CHANGEEXPRESSION: 'CUS.COUNTRY' }, [
        expr('CUS.COUNTRY', { WIDTH: 3000, FONTSTYLE: 1 }),
        expr('GROUPPAGECOUNT', { POSX: 3200, WIDTH: 1000 }),
      ]),
      section('detail', { HEIGHT: 1200 }, [expr('CUS.COMPANY_NAME', { WIDTH: 5000 })]),
      section('groupfooter', { HEIGHT: 300, GROUPNAME: 'COUNTRY' }, [expr("'pages '", { WIDTH: 1000 }), expr('GROUPPAGECOUNT', { POSX: 1100, WIDTH: 1000 })]),
    ]),
  ],
});

// Columns: a detail printed down and then across (VertDesp) and one across and then down
// (HorzDesp); a global page header and footer of a second subreport.
report('syn-columns.rep', {
  data: [
    datainfo('CUS', 'SELECT CUSTOMER_ID, COMPANY_NAME, COUNTRY FROM CUSTOMERS ORDER BY CUSTOMER_ID'),
    datainfo('PRO', 'SELECT PRODUCT_ID, NAME, UNIT_PRICE FROM PRODUCTS ORDER BY PRODUCT_ID LIMIT 40'),
  ],
  subs: [
    subreport('CUS', [
      section('pageheader', { HEIGHT: 300, GLOBAL: true }, [label('Global header', { WIDTH: 4000, FONTSTYLE: 1 }), expr('PAGE', { POSX: 9000, WIDTH: 1000 })]),
      section('detail', { HEIGHT: 500, WIDTH: 3500, VERTDESP: true }, [
        shape({ WIDTH: 3400, HEIGHT: 450, PENCOLOR: 8421504 }),
        expr('CUS.COMPANY_NAME', { POSX: 100, POSY: 50, WIDTH: 3200, FONTSIZE: 8 }),
        expr('CUS.COUNTRY', { POSX: 100, POSY: 250, WIDTH: 3200, FONTSIZE: 7 }),
      ]),
      section('pagefooter', { HEIGHT: 300, GLOBAL: true, FORCEPRINT: true }, [label('Global footer', { WIDTH: 4000, FONTSTYLE: 2 })]),
    ]),
    subreport('PRO', [
      section('detail', { HEIGHT: 400, WIDTH: 2600, HORZDESP: true }, [
        expr('PRO.NAME', { WIDTH: 2500, FONTSIZE: 7, CUTTEXT: true }),
        expr('PRO.UNIT_PRICE', { POSY: 200, WIDTH: 2500, FONTSIZE: 7, DISPLAYFORMAT: 'C2' }),
      ]),
      section('detail', { HEIGHT: 300 }, [expr("'after the products '+STR(PRO.PRODUCT_ID)", { WIDTH: 4000, PRINTCONDITION: 'EOF(\'PRO\')' })]),
    ]),
  ],
});

// The report language: Spanish (1) formats numbers and dates as es-ES on every page, labels take
// the text of the language, SETLANGUAGE changes it while printing.
report('syn-language.rep', {
  props: { LANGUAGE: 1 },
  data: [datainfo('ORD', 'SELECT ORDER_ID, ORDER_DATE, VAT_RATE FROM ORDERS WHERE ORDER_ID <= 12 ORDER BY ORDER_ID')],
  subs: [
    subreport('ORD', [
      section('pageheader', { HEIGHT: 400 }, [label(['Default text', 'English text', 'Texto en castellano'], { WIDTH: 4000 }), expr('LANGUAGE', { POSX: 4200, WIDTH: 1000 })]),
      section('detail', { HEIGHT: 260 }, [
        expr('ORD.ORDER_DATE', { WIDTH: 1600, DISPLAYFORMAT: 'dddd d MMMM yyyy' }),
        expr('ORD.ORDER_DATE', { POSX: 3300, WIDTH: 1600 }),
        expr('ORD.VAT_RATE*1234.5', { POSX: 5000, WIDTH: 1600, DISPLAYFORMAT: '#,##0.00' }),
        expr('ORD.VAT_RATE*1234.5', { POSX: 6700, WIDTH: 1600 }),
        expr("MONTHNAME(ORD.ORDER_DATE)", { POSX: 8400, WIDTH: 1600 }),
      ]),
      section('detail', { HEIGHT: 260, DOAFTERPRINT: 'IIF(ORD.ORDER_ID=6,SETLANGUAGE(0),0)' }, [
        label(['Default', 'English', 'Castellano'], { WIDTH: 3000, FONTSIZE: 7 }),
      ]),
    ]),
  ],
});

// A report of the Delphi engine (dbExpress connection): ConvertToDotNet turns its SQL parameter
// into @CUSTOMERID with a new report parameter, and its Delphi display formats into .Net ones.
report('syn-convert.rep', {
  databases: [database({ DRIVER: 0 })],
  data: [datainfo('ORD', 'SELECT ORDER_ID, ORDER_DATE, VAT_RATE FROM ORDERS WHERE CUSTOMER_ID = :customerid OR :customerid = \'\' ORDER BY ORDER_ID LIMIT 15')],
  subs: [
    subreport('ORD', [
      section('detail', { HEIGHT: 260 }, [
        expr('ORD.ORDER_ID', { WIDTH: 1000 }),
        expr('ORD.ORDER_DATE', { POSX: 1100, WIDTH: 2500, DISPLAYFORMAT: 'dd/mm/yyyy' }),
        expr('ORD.ORDER_DATE', { POSX: 3700, WIDTH: 2500, DISPLAYFORMAT: 'dd mmmm yyyy hh:nn' }),
        expr('M.CUSTOMERID', { POSX: 6300, WIDTH: 1500 }),
      ]),
    ]),
  ],
});

// Nothing to print: a report that prints only with data and a dataset without rows.
report('syn-nodata.rep', {
  props: { PRINTONLYIFDATAAVAILABLE: true },
  data: [datainfo('NONE', 'SELECT ORDER_ID FROM ORDERS WHERE ORDER_ID < 0')],
  subs: [subreport('NONE', [section('detail', { HEIGHT: 260 }, [expr('NONE.ORDER_ID', { WIDTH: 1000 })])])],
});

// An error in a print condition: the message names the item and the property, as in C#.
report('syn-error.rep', {
  data: [datainfo('ORD', 'SELECT ORDER_ID FROM ORDERS WHERE ORDER_ID < 5')],
  subs: [subreport('ORD', [section('detail', { HEIGHT: 260 }, [expr('ORD.ORDER_ID', { WIDTH: 1000, PRINTCONDITION: 'ORD.NOFIELD>1' })])])],
});

// Datasets opened while printing: one that does not open on start and an expression reads
// (OnDatasetNeeded, with a host that answers synchronously), and REOPEN with another SQL.
report('syn-ondemand.rep', {
  data: [
    datainfo('ORD', 'SELECT ORDER_ID, ORDER_NUMBER FROM ORDERS WHERE ORDER_ID <= 6 ORDER BY ORDER_ID'),
    datainfo('CNT', 'SELECT COUNT(*) AS N, MAX(ORDER_DATE) AS LAST FROM ORDERS', { OPENONSTART: false }),
    datainfo('PRO', 'SELECT NAME FROM PRODUCTS WHERE PRODUCT_ID = 1'),
  ],
  subs: [
    subreport('ORD', [
      section('pageheader', { HEIGHT: 600 }, [
        expr("'Orders: '+STR(CNT.N)", { WIDTH: 3000 }),
        expr('CNT.LAST', { POSX: 3100, WIDTH: 2000 }),
        expr("EOF('CNT')", { POSX: 5200, WIDTH: 1000 }),
      ]),
      section('detail', { HEIGHT: 260, DOBEFOREPRINT: "IIF(ORD.ORDER_ID=3,REOPEN('PRO','SELECT NAME FROM PRODUCTS WHERE PRODUCT_ID = 2'),False)" }, [
        expr('ORD.ORDER_NUMBER', { WIDTH: 2000 }),
        expr('PRO.NAME', { POSX: 2100, WIDTH: 5000 }),
      ]),
    ]),
  ],
});

// GETVALUEFROMSQL runs its command without the transaction of the connection, which
// Microsoft.Data.Sqlite refuses: the report fails in C#, and the same way here.
report('syn-getvalue.rep', {
  data: [datainfo('ORD', 'SELECT ORDER_ID FROM ORDERS WHERE ORDER_ID < 3')],
  subs: [
    subreport('ORD', [
      section('detail', { HEIGHT: 260 }, [
        expr('ORD.ORDER_ID', { WIDTH: 1000 }),
        expr("GETVALUEFROMSQL('SAMPLES','SELECT COUNT(*) FROM CUSTOMERS')", { POSX: 1100, WIDTH: 1000 }),
      ]),
    ]),
  ],
});
