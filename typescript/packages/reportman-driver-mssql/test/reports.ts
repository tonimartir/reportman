// Synthetic reports for the SQL Server tests: XML .rep files written with the tags and defaults
// of a report saved by the designer (the writer of the PostgreSQL tests), over a connection SAMPLES
// that the tests open on SQL Server; and the copies of a report with the SQL of some datasets
// replaced.

/** ReportWriter: every character but letters, digits and spaces as #code#. */
export function enc(value: string): string {
  let r = '';
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 32) r += value.charAt(i);
    else r += '#' + c + '#';
  }
  return r;
}

type PropValue = string | number | boolean | string[] | { date: number } | undefined;

function prop(name: string, value: PropValue): string {
  if (typeof value === 'boolean') return `<${name} type="Boolean">${value ? 'True' : 'False'}</${name}>`;
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return `<${name} type="Integer">${value}</${name}>`;
    return `<${name} type="Double">${value}</${name}>`;
  }
  if (Array.isArray(value)) return `<${name} type="String">${enc(value.join('\r\n'))}</${name}>`;
  if (value !== undefined && typeof value === 'object') return `<${name} type="Double">${value.date}</${name}>`;
  return `<${name} type="WideString">${enc(value ?? '')}</${name}>`;
}

function props(obj: Record<string, PropValue>): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => prop(k, v))
    .join('\n');
}

const REPORT_DEFAULTS: Record<string, PropValue> = {
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

/** The report connection SAMPLES (TransIsolation: a System.Data.IsolationLevel value). */
export function database(o: Record<string, PropValue> = {}): string {
  return `<DATABASEINFO>\n${props({
    ALIAS: 'SAMPLES', NAME: 'TRpDatabaseInfoItem0', CONFIGFILE: '', LOADPARAMS: false, LOADDRIVERPARAMS: false,
    LOGINPROMPT: false, DRIVER: 8, REPORTTABLE: 'REPMAN_REPORTS', REPORTSEARCHFIELD: 'REPORT_NAME', REPORTFIELD: 'REPORT',
    REPORTGROUPSTABLE: 'REPMAN_GROUPS', ADOCONNECTIONSTRING: '', DOTNETDRIVER: 0, PROVIDERFACTORY: '', ...o,
  })}\n</DATABASEINFO>`;
}

let dataCount = 0;
/** A dataset of the connection SAMPLES. */
export function datainfo(alias: string, sql: string, o: Record<string, PropValue> = {}): string {
  return `<DATAINFO>\n${props({
    ALIAS: alias, NAME: 'TRpDataInfoItem' + dataCount++, DATABASEALIAS: 'SAMPLES', SQL: sql, DATASOURCE: '',
    MYBASEFILENAME: '', MYBASEFIELDS: '', MYBASEINDEXFIELDS: '', MYBASEMASTERFIELDS: '', BDEINDEXFIELDS: '',
    BDEINDEXNAME: '', BDETABLE: '', BDETYPE: 0, BDEFILTER: '', BDEMASTERFIELDS: '', BDEFIRSTRANGE: '',
    BDELASTRANGE: '', DATAUNIONS: '', GROUPUNION: false, OPENONSTART: true, PARALLELUNION: false, ...o,
  })}\n</DATAINFO>`;
}

/** A Delphi TDateTime (days since 1899-12-30). */
export function delphiDate(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): { date: number } {
  return { date: (Date.UTC(y, m - 1, d, hh, mm, ss) - Date.UTC(1899, 11, 30)) / 86400000 };
}

/** A parameter (PARAMTYPE: 0 String, 1 Integer, 2 Double, 3 Date, 4 Time, 5 DateTime, 6 Currency, 7 Bool, 8 ExpreB...). */
export function param(alias: string, type: number, value: string | number | boolean | { date: number }, o: Record<string, PropValue> = {}): string {
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

let compCount = 0;
const TEXT_DEFAULTS: Record<string, PropValue> = {
  WFONTNAME: 'Arial', LFONTNAME: 'Helvetica', BIDIMODE: 0, TYPE1FONT: 0, FONTSIZE: 10, FONTROTATION: 0,
  FONTSTYLE: 0, FONTCOLOR: 0, BACKCOLOR: 16777215, TRANSPARENT: true, CUTTEXT: false, ALIGNMENT: 0, VALIGNMENT: 0,
  INTERLINE: 0, WORDWRAP: false, WORDBREAK: false, SINGLELINE: false, MULTIPAGE: false, PRINTSTEP: 0,
};

/** An expression item (DISPLAYFORMAT, POSX, WIDTH...). */
export function expr(expression: string, o: Record<string, PropValue> = {}): string {
  const head = props({
    NAME: 'TRpExpression' + compCount++, CLASSNAME: 'TRPEXPRESSION', WIDTH: o.WIDTH ?? 1440, HEIGHT: o.HEIGHT ?? 275,
    PRINTCONDITION: o.PRINTCONDITION ?? '', DOBEFOREPRINT: '', DOAFTERPRINT: '', ANNOTATION: '', POSX: o.POSX ?? 0,
    POSY: o.POSY ?? 0, ALIGN: 0,
  });
  return `<COMPONENT>\n${head}\n${props({
    ...TEXT_DEFAULTS, FONTSIZE: o.FONTSIZE ?? 10, WORDWRAP: o.WORDWRAP ?? false,
    EXPRESSION: expression, AGINIVALUE: '0', EXPORTEXPRESSION: '', DATATYPE: 16,
    DISPLAYFORMAT: o.DISPLAYFORMAT ?? '', IDENTIFIER: '', AGGREGATE: 0, GROUPNAME: '',
    AGTYPE: 0, AUTOEXPAND: false, AUTOCONTRACT: false,
    PRINTONLYONE: false, PRINTNULLS: true, EXPORTDISPLAYFORMAT: '', EXPORTLINE: 0,
    EXPORTPOSITION: 0, EXPORTSIZE: 1, EXPORTDONEWLINE: false,
  })}\n</COMPONENT>`;
}

let secCount = 0;
/** A detail section with its items (extra: CHILDSUBREPORT, the child subreport printed after it...). */
export function detail(components: string[], height = 300, extra: Record<string, PropValue> = {}): string {
  return `<SECTION>\n${props({
    NAME: 'TRpSection' + secCount++, WIDTH: 10758, HEIGHT: height, PRINTCONDITION: '',
    DOBEFOREPRINT: '', DOAFTERPRINT: '', SUBREPORT: '@SUB@', GROUPNAME: '', CHANGEEXPRESSION: '',
    BEGINPAGEEXPRESSION: '', SKIPEXPREV: '', SKIPEXPREH: '', SKIPTOPAGEEXPRE: '', BACKEXPRESSION: '', CHANGEBOOL: false,
    PAGEREPEAT: false, FORCEPRINT: false, SKIPPAGE: false, ALIGNBOTTOM: false, SECTIONTYPE: 2,
    AUTOEXPAND: false, AUTOCONTRACT: false, HORZDESP: false, VERTDESP: false, EXTERNALFILENAME: '',
    EXTERNALCONNECTION: '', EXTERNALTABLE: 'REPMAN_REPORTS', EXTERNALFIELD: 'REPORT', EXTERNALSEARCHFIELD: 'REPORT_NAME',
    EXTERNALSEARCHVALUE: '', STREAMFORMAT: 1, SKIPRELATIVEH: false, SKIPRELATIVEV: false, SKIPTYPE: 0, ININUMPAGE: false,
    GLOBAL: false, DPIRES: 100, CACHEDIMAGE: 0, BACKSTYLE: 0, DRAWSTYLE: 2, ...extra,
  })}\n${components.join('\n')}\n</SECTION>`;
}

let subCount = 0;
/** A subreport over a dataset alias with its sections (extra: NAME, PARENTSUBREPORT...). */
export function subreport(alias: string, sections: string[], extra: Record<string, PropValue> = {}): string {
  const name = typeof extra.NAME === 'string' ? extra.NAME : 'TRpSubReport' + subCount++;
  const { NAME: _name, ...rest } = extra;
  return `<SUBREPORT>\n${props({ NAME: name, ALIAS: alias, PRINTONLYIFDATAAVAILABLE: true, REOPENONPRINT: true, ...rest })}\n${sections
    .join('\n')
    .split(prop('SUBREPORT', '@SUB@'))
    .join(`<SUBREPORT type="String">${enc(name)}</SUBREPORT>`)}\n</SUBREPORT>`;
}

/** The XML of a report. */
export function report(parts: { databases?: string[]; data?: string[]; params?: string[]; subs?: string[] }): string {
  dataCount = 0;
  const xml = `<?xml version="1.0" standalone="no"?>\n<!DOCTYPE REPORT_MANAGER_2>\n<REPORT>\n${props(REPORT_DEFAULTS)}\n${[
    ...(parts.databases ?? [database()]),
    ...(parts.data ?? []),
    ...(parts.params ?? []),
    ...(parts.subs ?? []),
  ].join('\n')}\n</REPORT>\n`;
  compCount = 0;
  secCount = 0;
  subCount = 0;
  return xml;
}

/**
 * A report that prints the columns of one dataset D, one row per record: each expression in
 * `columns` (D.NAME, FORMATSTR(...)...) side by side, small type.
 */
export function listReport(sql: string, columns: string[], options: { params?: string[]; data?: string[]; databases?: string[] } = {}): string {
  const width = Math.floor(10700 / Math.max(1, columns.length));
  return report({
    databases: options.databases,
    data: [datainfo('D', sql), ...(options.data ?? [])],
    params: options.params,
    subs: [subreport('D', [detail(columns.map((c, i) => expr(c, { POSX: i * width, WIDTH: width - 20, FONTSIZE: 7 })), 220)])],
  });
}

/** The report with the SQL of the given datasets replaced (nothing else changes). */
export function withSql(xml: string, sql: Record<string, string>): string {
  let found = 0;
  const out = xml.replace(/<DATAINFO>[\s\S]*?<\/DATAINFO>/g, (block) => {
    const alias = /<ALIAS type="(?:Wide)?String">([^<]*)<\/ALIAS>/.exec(block)?.[1];
    if (alias === undefined || sql[alias] === undefined) return block;
    found++;
    return block.replace(/<SQL type="(?:Wide)?String">[\s\S]*?<\/SQL>/, '<SQL type="WideString">' + enc(sql[alias]) + '</SQL>');
  });
  if (found !== Object.keys(sql).length) throw new Error('A dataset to adapt was not found');
  return out;
}
