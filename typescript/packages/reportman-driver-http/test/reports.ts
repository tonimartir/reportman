// The reports of the parity tests, written by generate-fixtures.ts into fixtures/reports/:
//
//   - copies of the sample reports and of the synthetic reports of the engine tests whose report
//     connection is a Reportman AI Agent one (Driver HttpAgent, the connections file
//     dbxconnections.ini, LoadParams): the SQL of the samples (SQLite) runs on the mock Hub as it is;
//   - synthetic reports over the mock Hub: every column type the Hub returns (canned answers),
//     parameters of every type, and one report per error.
//
// The connections file is named relative ("dbxconnections.ini"): golden-cs runs in a folder that
// holds the one of the run (its Url points at the mock Hub of that run), and the TypeScript tests
// give its text to the driver. A report never names the shared connections file of the computer.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
export const reportsDir = path.join(here, 'fixtures/reports');
export const CONFIG_FILE = 'dbxconnections.ini';

// ---------------------------------------------------------------------------------------------
// Agent copies of existing reports

/** ReportWriter's encoding of a string: every character but letters, digits and spaces as #code#. */
function enc(value: string): string {
  let r = '';
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 32) r += value.charAt(i);
    else r += '#' + String(c) + '#';
  }
  return r;
}

/**
 * The report with every connection turned into a Reportman AI Agent one: Driver HttpAgent (10), or
 * `driver` (a connection the connections file maps to the Agent), the connections file of the tests
 * and LoadParams; aliases renamed by `aliases`.
 */
export function agentCopy(xml: string, options: { driver?: number; aliases?: Record<string, string> } = {}): string {
  const setProp = (block: string, name: string, type: string, value: string): string => {
    const re = new RegExp(`<${name} type="[^"]*">[^<]*</${name}>`);
    const tag = `<${name} type="${type}">${value}</${name}>`;
    return re.test(block) ? block.replace(re, tag) : block.replace('</DATABASEINFO>', tag + '\n</DATABASEINFO>');
  };
  let out = xml.replace(/<DATABASEINFO>[\s\S]*?<\/DATABASEINFO>/g, (block) => {
    let b = setProp(block, 'DRIVER', 'Integer', String(options.driver ?? 10));
    b = setProp(b, 'LOADPARAMS', 'Boolean', 'True');
    b = setProp(b, 'CONFIGFILE', 'String', enc(CONFIG_FILE));
    b = setProp(b, 'PROVIDERFACTORY', 'String', '');
    b = setProp(b, 'ADOCONNECTIONSTRING', 'WideString', '');
    return b;
  });
  for (const [from, to] of Object.entries(options.aliases ?? {})) {
    out = out
      .replace(new RegExp(`(<DATABASEINFO>\\s*<ALIAS type="[^"]*">)${from}(</ALIAS>)`), `$1${to}$2`)
      .replace(new RegExp(`(<DATABASEALIAS type="[^"]*">)${from}(</DATABASEALIAS>)`, 'g'), `$1${to}$2`);
  }
  return out;
}

const COPIES: { name: string; source: string }[] = [
  { name: 'customers', source: 'samples/customers.rep' },
  { name: 'invoices', source: 'samples/invoices.rep' },
  { name: 'labels', source: 'samples/labels.rep' },
  { name: 'product-catalog', source: 'samples/product-catalog.rep' },
  { name: 'monthly-sales', source: 'samples/monthly-sales.rep' },
  { name: 'sales-by-category', source: 'samples/sales-by-category.rep' },
  { name: 'fishes', source: 'samples/fishes.rep' },
  { name: 'syn-groups', source: 'typescript/packages/reportman-engine/test/fixtures/run/syn-groups.rep' },
  { name: 'syn-masterdetail', source: 'typescript/packages/reportman-engine/test/fixtures/run/syn-masterdetail.rep' },
  { name: 'syn-params', source: 'typescript/packages/reportman-engine/test/fixtures/run/syn-params.rep' },
  { name: 'syn-twopass', source: 'typescript/packages/reportman-engine/test/fixtures/run/syn-twopass.rep' },
  { name: 'syn-getvalue', source: 'typescript/packages/reportman-engine/test/fixtures/run/syn-getvalue.rep' },
];

// ---------------------------------------------------------------------------------------------
// Synthetic reports (the tags and defaults of a report saved by the designer)

function prop(name: string, value: unknown): string {
  if (typeof value === 'boolean') return `<${name} type="Boolean">${value ? 'True' : 'False'}</${name}>`;
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return `<${name} type="Integer">${value}</${name}>`;
    return `<${name} type="Double">${value}</${name}>`;
  }
  if (Array.isArray(value)) return `<${name} type="String">${enc(value.join('\r\n'))}</${name}>`;
  return `<${name} type="WideString">${enc(String(value))}</${name}>`;
}

function props(obj: Record<string, unknown>): string {
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

function database(alias: string, o: Record<string, unknown> = {}): string {
  return `<DATABASEINFO>\n${props({
    ALIAS: alias, NAME: 'TRpDatabaseInfoItem0', CONFIGFILE: CONFIG_FILE, LOADPARAMS: true, LOADDRIVERPARAMS: false,
    LOGINPROMPT: false, DRIVER: 10, REPORTTABLE: 'REPMAN_REPORTS', REPORTSEARCHFIELD: 'REPORT_NAME', REPORTFIELD: 'REPORT',
    REPORTGROUPSTABLE: 'REPMAN_GROUPS', ADOCONNECTIONSTRING: '', DOTNETDRIVER: 0, PROVIDERFACTORY: '', ...o,
  })}\n</DATABASEINFO>`;
}

let dataCount = 0;
function datainfo(alias: string, database: string, sql: string, o: Record<string, unknown> = {}): string {
  return `<DATAINFO>\n${props({
    ALIAS: alias, NAME: 'TRpDataInfoItem' + dataCount++, DATABASEALIAS: database, SQL: sql, DATASOURCE: '',
    MYBASEFILENAME: '', MYBASEFIELDS: '', MYBASEINDEXFIELDS: '', MYBASEMASTERFIELDS: '', BDEINDEXFIELDS: '',
    BDEINDEXNAME: '', BDETABLE: '', BDETYPE: 0, BDEFILTER: '', BDEMASTERFIELDS: '', BDEFIRSTRANGE: '',
    BDELASTRANGE: '', DATAUNIONS: '', GROUPUNION: false, OPENONSTART: true, PARALLELUNION: false, ...o,
  })}\n</DATAINFO>`;
}

/** A parameter; value: a number (Integer/Double), a boolean, a { date } (Delphi TDateTime) or a string. */
function param(alias: string, type: number, value: number | boolean | string | { date: number }, o: Record<string, unknown> = {}): string {
  const head = props({
    NAME: alias, INTNAME: alias, DESCRIPTION: alias, HINT: '', ERRORMESSAGE: '', VALIDATION: '',
    SEARCH: '', VISIBLE: true, ISREADONLY: false, NEVERVISIBLE: false, ALLOWNULLS: false, PARAMTYPE: type,
    DATASETS: [], ITEMS: [], VALUES: [], SELECTED: [], LOOKUPDATASET: '', SEARCHDATASET: '', SEARCHPARAM: '',
    ...o,
  });
  let v: string;
  if (typeof value === 'number' && Number.isInteger(value) && type === 1) v = `<VALUE type="Integer">${value}</VALUE>`;
  else if (typeof value === 'number') v = `<VALUE type="Double">${value}</VALUE>`;
  else if (typeof value === 'boolean') v = `<VALUE type="Boolean">${value ? 'True' : 'False'}</VALUE>`;
  else if (typeof value === 'object') v = `<VALUE type="Double">${value.date}</VALUE>`;
  else v = `<VALUE type="String">${enc(value)}</VALUE>`;
  return `<PARAMETER>\n${head}\n${v}\n</PARAMETER>`;
}

/** A Delphi TDateTime (days since 1899-12-30). */
function delphiDate(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): { date: number } {
  return { date: (Date.UTC(y, m - 1, d, hh, mm, ss) - Date.UTC(1899, 11, 30)) / 86400000 };
}

let compCount = 0;
const TEXT_DEFAULTS = {
  WFONTNAME: 'Arial', LFONTNAME: 'Helvetica', BIDIMODE: 0, TYPE1FONT: 0, FONTSIZE: 8, FONTROTATION: 0,
  FONTSTYLE: 0, FONTCOLOR: 0, BACKCOLOR: 16777215, TRANSPARENT: true, CUTTEXT: false, ALIGNMENT: 0, VALIGNMENT: 0,
  INTERLINE: 0, WORDWRAP: false, WORDBREAK: false, SINGLELINE: false, MULTIPAGE: false, PRINTSTEP: 0,
};

function head(cls: string, prefix: string, o: Record<string, unknown>): string {
  return props({
    NAME: o.NAME ?? prefix + compCount++, CLASSNAME: cls, WIDTH: o.WIDTH ?? 1440, HEIGHT: o.HEIGHT ?? 240,
    PRINTCONDITION: '', DOBEFOREPRINT: '', DOAFTERPRINT: '', ANNOTATION: '', POSX: o.POSX ?? 0, POSY: o.POSY ?? 0, ALIGN: 0,
  });
}

function label(text: string, o: Record<string, unknown> = {}): string {
  return `<COMPONENT>\n${head('TRPLABEL', 'TRpLabel', o)}\n${props({ ...TEXT_DEFAULTS, FONTSTYLE: o.FONTSTYLE ?? 0 })}\n${prop('WIDETEXT', text)}\n</COMPONENT>`;
}

function expr(expression: string, o: Record<string, unknown> = {}): string {
  return `<COMPONENT>\n${head('TRPEXPRESSION', 'TRpExpression', o)}\n${props({
    ...TEXT_DEFAULTS, EXPRESSION: expression, AGINIVALUE: '0', EXPORTEXPRESSION: '', DATATYPE: 16,
    DISPLAYFORMAT: o.DISPLAYFORMAT ?? '', IDENTIFIER: '', AGGREGATE: 0, GROUPNAME: '', AGTYPE: 0, AUTOEXPAND: false,
    AUTOCONTRACT: false, PRINTONLYONE: false, PRINTNULLS: true, EXPORTDISPLAYFORMAT: '', EXPORTLINE: 0,
    EXPORTPOSITION: 0, EXPORTSIZE: 1, EXPORTDONEWLINE: false,
  })}\n</COMPONENT>`;
}

let secCount = 0;
const SECTION_TYPES: Record<string, number> = { pageheader: 0, groupheader: 1, detail: 2, groupfooter: 3, pagefooter: 4 };
function section(type: string, height: number, components: string[], o: Record<string, unknown> = {}): string {
  return `<SECTION>\n${props({
    NAME: 'TRpSection' + secCount++, WIDTH: 10758, HEIGHT: height, PRINTCONDITION: '', DOBEFOREPRINT: '',
    DOAFTERPRINT: '', SUBREPORT: '@SUB@', GROUPNAME: '', CHANGEEXPRESSION: '', BEGINPAGEEXPRESSION: '', SKIPEXPREV: '',
    SKIPEXPREH: '', SKIPTOPAGEEXPRE: '', BACKEXPRESSION: '', CHANGEBOOL: false, PAGEREPEAT: false, FORCEPRINT: false,
    SKIPPAGE: false, ALIGNBOTTOM: false, SECTIONTYPE: SECTION_TYPES[type], AUTOEXPAND: false, AUTOCONTRACT: false,
    HORZDESP: false, VERTDESP: false, EXTERNALFILENAME: '', EXTERNALCONNECTION: '', EXTERNALTABLE: 'REPMAN_REPORTS',
    EXTERNALFIELD: 'REPORT', EXTERNALSEARCHFIELD: 'REPORT_NAME', EXTERNALSEARCHVALUE: '', STREAMFORMAT: 1,
    SKIPRELATIVEH: false, SKIPRELATIVEV: false, SKIPTYPE: 0, ININUMPAGE: false, GLOBAL: false, DPIRES: 100,
    CACHEDIMAGE: 0, BACKSTYLE: 0, DRAWSTYLE: 2, ...o,
  })}\n${components.join('\n')}\n</SECTION>`;
}

function subreport(alias: string, sections: string[], o: Record<string, unknown> = {}): string {
  const name = String(o.NAME ?? 'TRpSubReport0');
  return `<SUBREPORT>\n${props({ NAME: name, ALIAS: alias, PRINTONLYIFDATAAVAILABLE: true, REOPENONPRINT: true, ...o })}\n${sections
    .join('\n')
    .split(prop('SUBREPORT', '@SUB@'))
    .join(`<SUBREPORT type="String">${enc(name)}</SUBREPORT>`)}\n</SUBREPORT>`;
}

function report(parts: { databases: string[]; data: string[]; params?: string[]; subs: string[] }): string {
  dataCount = 0;
  compCount = 0;
  secCount = 0;
  return `<?xml version="1.0" standalone="no"?>\n<!DOCTYPE REPORT_MANAGER_2>\n<REPORT>\n${props(REPORT_DEFAULTS)}\n${[
    ...parts.databases,
    ...parts.data,
    ...(parts.params ?? []),
    ...parts.subs,
  ].join('\n')}\n</REPORT>\n`;
}

/** A report that prints the given fields of one dataset, a row per record, with their titles. */
function fieldsReport(alias: string, sql: string, fields: { expr: string; title: string; format?: string; width?: number }[], extra: { params?: string[] } = {}): string {
  let x = 0;
  const titles: string[] = [];
  const cells: string[] = [];
  for (const f of fields) {
    const w = f.width ?? 1100;
    titles.push(label(f.title, { POSX: x, WIDTH: w, FONTSTYLE: 1 }));
    cells.push(expr(f.expr, { POSX: x, WIDTH: w, DISPLAYFORMAT: f.format }));
    x += w + 40;
  }
  return report({
    databases: [database(alias)],
    data: [datainfo('T', alias, sql)],
    params: extra.params,
    subs: [subreport('T', [section('pageheader', 300, titles), section('detail', 260, cells)])],
  });
}

/**
 * A master (M) and its detail (D, DataSource M): the detail parameters named as master columns take the
 * values of the current master record (UpdateParams), so the Hub receives every boxed value type.
 */
function linkedReport(masterSql: string, detailSql: string, linked: string[], masterFields: string[], detailFields: string[]): string {
  const cells = (alias: string, fields: string[]): string[] => fields.map((f, i) => expr(alias + '.' + f, { POSX: i * 1500, WIDTH: 1450 }));
  return report({
    databases: [database('AGENT')],
    data: [datainfo('M', 'AGENT', masterSql), datainfo('D', 'AGENT', detailSql, { DATASOURCE: 'M' })],
    params: linked.map((n) => param(n, 1, 0, { VISIBLE: false, DATASETS: ['D'] })),
    subs: [
      subreport('M', [section('detail', 260, cells('M', masterFields), { CHILDSUBREPORT: 'TRPSUBREPORT1' })], { NAME: 'TRpSubReport0' }),
      subreport('D', [section('detail', 240, cells('D', detailFields))], {
        NAME: 'TRpSubReport1',
        PARENTSUBREPORT: 'TRpSubReport0',
        PRINTONLYIFDATAAVAILABLE: false,
      }),
    ],
  });
}

/** The synthetic reports: name -> XML. */
function synthetic(): Record<string, string> {
  const r: Record<string, string> = {};
  r['agent-types'] = fieldsReport('AGENT', 'CANNED types', [
    { expr: 'T.ID', title: 'ID', width: 300 },
    { expr: 'T.I16', title: 'I16', width: 700 },
    { expr: 'T.I32', title: 'I32', width: 900 },
    { expr: 'T.I64', title: 'I64', width: 1500 },
    { expr: 'T.DEC', title: 'DEC', width: 2500 },
    { expr: 'T.DBL', title: 'DBL', width: 1500 },
    { expr: 'T.SGL', title: 'SGL', width: 1000 },
    { expr: 'T.BOOL', title: 'BOOL', width: 500 },
    { expr: 'T.STR', title: 'STR', width: 1200 },
  ]);
  r['agent-types2'] = fieldsReport('AGENT', 'CANNED types', [
    { expr: 'T.ID', title: 'ID', width: 300 },
    { expr: 'T.DT', title: 'DT', format: 'yyyy-MM-dd HH:mm:ss.fffffff', width: 2400 },
    { expr: 'T.DT', title: 'DT', width: 1800 },
    { expr: 'T.GUID', title: 'GUID', width: 2600 },
    { expr: 'T.BYTE', title: 'BYTE', width: 400 },
    { expr: 'T.TS', title: 'TS', width: 1300 },
    { expr: 'T.NOTYPE', title: 'NOTYPE', width: 600 },
    { expr: 'STR(T.I64)', title: 'STR', width: 1500 },
  ]);
  r['agent-zone'] = fieldsReport('AGENT', 'CANNED types-zone', [
    { expr: 'T.ID', title: 'ID', width: 300 },
    { expr: 'T.DT', title: 'DT', format: 'yyyy-MM-dd HH:mm:ss.fffffff', width: 2400 },
  ]);
  r['agent-mismatch'] = fieldsReport('AGENT', 'CANNED mismatch', [
    { expr: 'T.ID', title: 'ID', width: 300 },
    { expr: 'T.I32', title: 'I32', width: 600 },
    { expr: 'T.I64', title: 'I64', width: 600 },
    { expr: 'T.DEC', title: 'DEC', width: 900 },
    { expr: 'T.DBL', title: 'DBL', width: 900 },
    { expr: 'T.BOOL', title: 'BOOL', width: 600 },
    { expr: 'T.DT', title: 'DT', format: 'yyyy-MM-dd HH:mm:ss.fff', width: 2000 },
    { expr: 'T.STR', title: 'STR', width: 1700 },
  ]);
  r['agent-utf8'] = fieldsReport('AGENT', 'CANNED utf8-bom', [{ expr: 'T.A', title: 'A' }]);
  r['agent-latin1'] = fieldsReport('AGENT', 'CANNED latin1', [{ expr: 'T.A', title: 'A' }]);
  r['agent-no-envelope'] = fieldsReport('AGENT', 'CANNED no-envelope', [{ expr: 'T.A', title: 'A' }]);
  r['agent-empty-name'] = fieldsReport('AGENT', 'CANNED empty-name', [
    { expr: 'T.COLUMN1', title: 'C1' },
    { expr: 'T.COLUMN2', title: 'C2' },
  ]);
  r['agent-no-rows'] = fieldsReport('AGENT', 'CANNED no-rows', [{ expr: 'T.A', title: 'A' }]);
  r['agent-slow'] = fieldsReport('AGENT', 'CANNED slow', [{ expr: 'T.A', title: 'A' }]);

  // Parameters of every type, bound to the SQL (the Hub binds them by name) and echoed back
  const P: [string, string][] = [
    ['PSTR', 'String'], ['PEMPTY', 'String'], ['PINT', 'Integer'], ['PNEG', 'Integer'], ['PDBL', 'Double'],
    ['PSMALL', 'Double'], ['PCUR', 'Currency'], ['PDATE', 'Date'], ['PTIME', 'Time'], ['PDT', 'DateTime'],
    ['PTRUE', 'Boolean'], ['PFALSE', 'Boolean'], ['PLONG', 'ExpreB Long'], ['PDIV', 'ExpreB Double'],
    ['PDEC', 'ExpreB Decimal'], ['PNULL', 'ExpreB Null'], ['PCHR', 'ExpreB String'], ['PLIST', 'List'],
  ];
  const sql = 'SELECT ' + P.map(([n]) => `:${n} AS ${n}`).join(', ');
  r['agent-params'] = fieldsReport(
    'AGENT',
    sql,
    P.slice(0, 12).map(([n]) => ({ expr: 'T.' + n, title: n, width: 800 })),
    {
      params: [
        param('PSTR', 0, 'O\'Hara "q" <a&b> +`\\ ñ € 😀\ttab\r\nline\u0001\u007f', { DATASETS: ['T'] }),
        param('PEMPTY', 0, '', { DATASETS: ['T'] }),
        param('PINT', 1, 2147483647, { DATASETS: ['T'] }),
        param('PNEG', 1, -42, { DATASETS: ['T'] }),
        param('PDBL', 2, 1234.5678, { DATASETS: ['T'] }),
        param('PSMALL', 2, 0.00001, { DATASETS: ['T'] }),
        param('PCUR', 6, 1234.5, { DATASETS: ['T'] }),
        param('PDATE', 3, delphiDate(2024, 2, 29), { DATASETS: ['T'] }),
        param('PTIME', 4, delphiDate(1899, 12, 30, 9, 45, 30), { DATASETS: ['T'] }),
        param('PDT', 5, delphiDate(2025, 6, 15, 18, 30, 15), { DATASETS: ['T'] }),
        param('PTRUE', 7, true, { DATASETS: ['T'] }),
        param('PFALSE', 7, false, { DATASETS: ['T'] }),
        param('PLONG', 8, '2147483647*4', { DATASETS: ['T'] }),
        param('PDIV', 8, '1/3', { DATASETS: ['T'] }),
        param('PDEC', 8, '1.5+0', { DATASETS: ['T'] }),
        param('PNULL', 8, 'NULL', { DATASETS: ['T'] }),
        param('PCHR', 8, "'x'", { DATASETS: ['T'] }),
        param('PLIST', 11, "'B'", { DATASETS: ['T'], ITEMS: ['A', 'B'], VALUES: ["'A'", "'B'"] }),
        // a parameter of another dataset is not sent
        param('POTHER', 1, 5, { DATASETS: ['NONE'] }),
      ],
    },
  );
  // the second shows the rest of the columns of the same request: it takes the parameters of the first
  r['agent-params2'] = r['agent-params']!.replace(
    /<SUBREPORT>[\s\S]*<\/SUBREPORT>/,
    /<SUBREPORT>[\s\S]*<\/SUBREPORT>/.exec(fieldsReport('AGENT', sql, P.slice(12).map(([n]) => ({ expr: 'T.' + n, title: n, width: 1400 }))))![0],
  );

  // A dataset per connection of the connections file: credentials, Hub databases, URLs
  const connectionReport = (alias: string, sqlText = 'SELECT COUNT(*) AS N, MIN(CODE) AS C FROM CUSTOMERS', o: Record<string, unknown> = {}): string =>
    report({
      databases: [database(alias, o)],
      data: [datainfo('T', alias, sqlText)],
      subs: [subreport('T', [section('detail', 260, [expr('T.N', { WIDTH: 1000 }), expr('T.C', { POSX: 1100, WIDTH: 1500 })])])],
    });
  for (const alias of ['PRIVATE_KEY', 'PRIVATE_NOKEY', 'PRIVATE_BADKEY', 'PRIVATE_TOKEN', 'NOID', 'BADID', 'UNKNOWNDB', 'REFUSED', 'TRAILING', 'BASEURLKEY', 'MISSING', 'ZEROID'])
    r['agent-conn-' + alias.toLowerCase()] = connectionReport(alias);
  r['agent-conn-noload'] = connectionReport('AGENT', undefined, { LOADPARAMS: false });
  r['agent-conn-drivername'] = connectionReport('MAPPED', undefined, { DRIVER: 8 });
  r['agent-sql-error'] = connectionReport('AGENT', 'SELECT * FROM NOSUCHTABLE');

  // An error answer of the Hub, by canned name
  for (const name of [
    'success-false', 'success-false-null-error', 'success-false-no-error', 'success-false-null-data', 'success-not-bool',
    'data-success-false', 'root-array', 'html-200', 'empty-200', 'truncated-json', 'status-400', 'status-401',
    'status-404', 'status-418', 'status-422', 'status-500', 'status-502', 'status-503', 'bad-int32', 'bad-int64',
    'bad-decimal', 'bad-boolean', 'bad-datetime', 'bad-base64', 'duplicate-column', 'missing-rows', 'missing-name',
    'rows-not-array', 'row-not-array', 'name-not-string', 'no-columns', 'very-slow',
  ])
    r['agent-canned-' + name] = connectionReport('AGENT', 'CANNED ' + name);
  for (const name of ['status-300', 'status-301', 'status-302', 'status-303', 'status-307', 'status-413', 'status-429', 'status-504', 'status-599', 'bad-charset', 'deep-json', 'trailing-comma', 'trailing-text', 'comment-json', 'leading-zero', 'bad-escape', 'control-in-string', 'bad-literal', 'unterminated-string', 'multiline-error', 'non-ascii-error', 'whitespace-only', 'bad-literal-long', 'bad-number', 'bad-number2', 'bad-number3', 'bad-number4', 'bad-property', 'bad-colon', 'mismatched', 'bad-hex', 'eof-after-name'])
    r['agent-canned-' + name] = connectionReport('AGENT', 'CANNED ' + name);
  for (const name of ['quoted-charset', 'utf16-bom', 'bad-utf8', 'duplicate-property'])
    r['agent-' + name] = fieldsReport('AGENT', 'CANNED ' + name, [{ expr: 'T.A', title: 'A', width: 3000 }]);
  r['agent-case-property'] = fieldsReport('AGENT', 'CANNED case-property', [{ expr: 'T.B', title: 'B' }]);

  // Master values of every type as parameters of a detail (Single is left out: the engine boxes it as Double)
  const LINKED = ['I16', 'I32', 'I64', 'DEC', 'DBL', 'BOOL', 'DT', 'BIN', 'STR', 'GUID'];
  r['agent-linked'] = linkedReport(
    'CANNED types',
    'SELECT ' + LINKED.map((n) => ':' + n + ' AS ' + n).join(', '),
    LINKED,
    ['ID', 'I64', 'DEC'],
    ['I64', 'DEC', 'DBL', 'BOOL', 'STR'],
  );
  r['agent-linked-zone'] = linkedReport('CANNED types-zone', 'SELECT :DT AS DT', ['DT'], ['ID'], ['DT']);
  r['agent-linked-empty'] = linkedReport('CANNED no-rows', 'SELECT :A AS A, :B AS B', ['A', 'B'], ['A'], ['A', 'B']);
  r['agent-linked-rows'] = linkedReport('CANNED linked-rows', 'SELECT :K AS K, :V AS V, :K * 10 AS K10', ['K', 'V'], ['K', 'V'], ['K', 'V', 'K10']);
  r['agent-nan'] = fieldsReport('AGENT', 'SELECT :PNAN AS A', [{ expr: 'T.A', title: 'A' }], {
    params: [param('PNAN', 8, '1/0', { DATASETS: ['T'] })],
  });
  return r;
}

/** Writes every report of the tests into fixtures/reports/. */
export function writeReports(): string[] {
  fs.mkdirSync(reportsDir, { recursive: true });
  const names: string[] = [];
  for (const c of COPIES) {
    const xml = fs.readFileSync(path.join(root, c.source), 'latin1');
    fs.writeFileSync(path.join(reportsDir, c.name + '.rep'), agentCopy(xml), 'latin1');
    names.push(c.name);
  }
  for (const [name, xml] of Object.entries(synthetic())) {
    fs.writeFileSync(path.join(reportsDir, name + '.rep'), xml, 'latin1');
    names.push(name);
  }
  return names;
}
