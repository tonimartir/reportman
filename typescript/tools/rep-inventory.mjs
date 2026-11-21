// rep-inventory: what a set of .rep reports uses, to fix the scope of a port before running them.
// It reads each report with the XML reader of reportman-lib (a Delphi DFM file is listed apart: it is
// saved as XML from the designer first) and counts, over every report:
//   - the classes of the components and the sections by type;
//   - the properties set to something else than the default of their class (the defaults of the C#
//     constructors), and the values of the enumerated ones (barcode types, drivers, fonts...);
//   - in the expressions: the functions (known to the engine or not), the report variables, the
//     fields of each dataset and the parameters they read;
//   - the parameters by type, the connections by driver, the datasets (SQL, master/detail, unions);
//   - the fonts, the display formats, the embedded images by format.
// It never writes a connection string, an SQL sentence or the value of a parameter.
//
//   node tools/rep-inventory.mjs <report.rep | folder>... [--json out.json] [--md out.md]
//
// A folder is searched for *.rep (recursively). Without --md the Markdown summary goes to stdout.
// The packages are read from their builds: run `npm run build` first.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readReportXml,
  ReportReaderError,
  DFM_FORMAT_MESSAGE,
  BarcodeType,
  ChartType,
  ChartDriver,
  DriverType,
  DotNetDriverType,
  ParamType,
  SectionType,
  PDFFontType,
  ImageDrawStyleType,
  ShapeType,
  PDFConformanceType,
  Aggregate,
  AggregateType,
  PrintItemAlign,
  TextAlignType,
  TextAlignVerticalType,
  BackStyleType,
  SkipType,
  PageOrientationType,
  PageSizeType,
  PrintStepType,
  BarType,
  BrushType,
  PenType,
  SharedImageType,
  StreamFormatType,
  DatasetType,
  IsolationLevel,
  AutoScaleType,
  PreviewWindowStyleType,
  PrinterSelectType,
  PrinterFontsType,
  AutoRangeAxis,
  PDFAFRelationShip,
} from 'reportman-lib';
import { Evaluator, EvalParser, TokenType, createContext } from 'reportman-engine';

/**
 * The identifiers a report adds to its evaluator (ReportRuntime, reportman-engine report/report.ts),
 * and PAGECOUNT, which the expression items resolve themselves (a second pass, report/items.ts).
 */
export const REPORT_IDENTIFIERS = [
  'PAGECOUNT',
  'PAGE', 'PAGINA', 'LANGUAGE', 'PAGENUM', 'PAGEWIDTH', 'PAGEHEIGHT', 'FREE_SPACE_CMS', 'FREE_SPACE_INCH',
  'FREE_SPACE_TWIPS', 'CURRENTGROUP', 'CURRENTPOSX', 'CURRENTPOSY', 'FIRSTSECTION', 'EOF', 'SETLANGUAGE',
  'REOPEN', 'GRAPHICOP', 'IMAGEOP', 'BARCODEOP', 'TEXTOP', 'TEXTHEIGHT', 'PARAMINFO', 'SETPAGESOURCE',
  'SETPAGEORIENTATION', 'GETVALUEFROMSQL', 'GRAPHICNEW', 'GRAPHICNEWXY', 'GRAPHICNEWFUNCTION', 'GRAPHICCLEAR',
  'GRAPHICCOLOR', 'GRAPHICSERIECOLOR', 'GRAPHICBOUNDS',
];

/** The enumerated properties, by name (CLASS.prop where two classes give the name another enum). */
const ENUMS = {
  barType: BarcodeType,
  chartStyle: ChartType,
  'TRPCHART.driver': ChartDriver,
  'TRPDATABASEINFOITEM.driver': DriverType,
  dotNetDriver: DotNetDriverType,
  paramType: ParamType,
  dataType: ParamType,
  sectionType: SectionType,
  type1Font: PDFFontType,
  drawStyle: ImageDrawStyleType,
  shape: ShapeType,
  pdfConformance: PDFConformanceType,
  aggregate: Aggregate,
  agType: AggregateType,
  align: PrintItemAlign,
  alignment: TextAlignType,
  vAlignment: TextAlignVerticalType,
  backStyle: BackStyleType,
  skipType: SkipType,
  pageOrientation: PageOrientationType,
  pageSize: PageSizeType,
  printStep: PrintStepType,
  multiBar: BarType,
  brushStyle: BrushType,
  penStyle: PenType,
  sharedImage: SharedImageType,
  streamFormat: StreamFormatType,
  bdeType: DatasetType,
  transIsolation: IsolationLevel,
  autoScale: AutoScaleType,
  previewWindow: PreviewWindowStyleType,
  printerSelect: PrinterSelectType,
  printerFonts: PrinterFontsType,
  autoRange: AutoRangeAxis,
  afRelationShip: PDFAFRelationShip,
};

/** Properties that are content or structure, not features: counted elsewhere or not at all. */
const NOT_FEATURES = new Set([
  'name', 'className', 'components', 'sections', 'subReports', 'dataInfo', 'databaseInfo', 'params', 'undoCue',
  'parentSec', 'parentSub', 'posX', 'posY', 'width', 'height', 'allStrings', 'text', 'alias', 'sql',
  'connectionString', 'providerFactory', 'databaseAlias', 'streamBase64', 'embeddedFiles', 'wFontName',
  'lFontName', 'displayFormat', 'exportDisplayFormat', 'identifier', 'value', 'values', 'items', 'selected',
  'descriptions', 'hints', 'errorMessages', 'datasets', 'search', 'sqlExplanation', 'sqlExplanationError',
  'hubSchemaId', 'schemaName', 'myBaseFields', 'myBaseIndexFields', 'myBaseMasterFields', 'dataUnions',
  'dataSource', 'groupName', 'subReportName', 'childSubReportName', 'sectionType',
]);

/** The properties that hold an expression. */
const isExpressionProperty = (name) => /expre|condition/i.test(name) || ['doBeforePrint', 'doAfterPrint', 'agIniValue', 'validation'].includes(name);

/** A counter of things, with the reports where each one was seen. */
class Tally {
  constructor() {
    this.map = new Map();
  }
  add(key, file, n = 1) {
    let e = this.map.get(key);
    if (e === undefined) this.map.set(key, (e = { count: 0, reports: new Set() }));
    e.count += n;
    e.reports.add(file);
  }
  rows() {
    return [...this.map.entries()]
      .map(([key, e]) => ({ key, count: e.count, reports: e.reports.size }))
      .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
  toJSON() {
    return Object.fromEntries(this.rows().map((r) => [r.key, { count: r.count, reports: r.reports }]));
  }
}

const enumName = (e, v) => (typeof e[v] === 'string' ? e[v] : String(v));

/** The defaults of a class: a new instance of the same model class. */
const defaultsCache = new Map();
function defaultsOf(obj) {
  const ctor = Object.getPrototypeOf(obj)?.constructor;
  if (typeof ctor !== 'function') return {};
  let d = defaultsCache.get(ctor);
  if (d === undefined) {
    try {
      d = new ctor();
    } catch {
      d = {};
    }
    defaultsCache.set(ctor, d);
  }
  return d;
}

/**
 * Values the Delphi designer writes for a property it did not change (its own defaults, where the C#
 * constructor has another one): they count as the default too.
 */
const DESIGNER_DEFAULTS = {
  dpires: [100],
  externalField: ['REPORT'],
  externalTable: ['REPMAN_REPORTS'],
  externalSearchField: ['REPORT_NAME'],
  reportTable: ['REPMAN_REPORTS'],
  reportSearchField: ['REPORT_NAME'],
  reportField: ['REPORT'],
  reportGroupsTable: ['REPMAN_GROUPS'],
  bidiModes: [['BidiNo']],
};

const isDefault = (prop, value, def) => sameValue(value, def) || (DESIGNER_DEFAULTS[prop] ?? []).some((d) => sameValue(value, d));

const sameValue = (a, b) => (Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a ?? []) === JSON.stringify(b ?? []) : a === b);

/** The format of image bytes, by their first bytes. */
function imageFormat(base64) {
  const head = Buffer.from(base64.substring(0, 24), 'base64');
  if (head[0] === 0xff && head[1] === 0xd8) return 'JPEG';
  if (head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG') return 'PNG';
  if (head.toString('latin1', 0, 2) === 'BM') return 'BMP';
  if (head.toString('latin1', 0, 3) === 'GIF') return 'GIF';
  if (head.toString('latin1', 0, 4) === 'RIFF') return 'WEBP';
  if (head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a) return 'TIFF';
  if (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0x00) return 'TIFF';
  if (head[0] === 0xd7 && head[1] === 0xcd) return 'WMF';
  if (head[0] === 0x01 && head[1] === 0x00 && head[2] === 0x00 && head[3] === 0x00) return 'EMF';
  return 'other';
}

/** Collects the reports of the arguments: files, and the *.rep files of folders. */
export function reportFiles(paths) {
  const out = [];
  const walk = (p) => {
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const entry of readdirSync(p).sort()) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const child = join(p, entry);
        if (statSync(child).isDirectory()) walk(child);
        else if (entry.toLowerCase().endsWith('.rep')) out.push(child);
      }
    } else out.push(p);
  };
  for (const p of paths) walk(resolve(p));
  return out;
}

/**
 * The inventory of a set of reports: per report (read or not, and why) and the totals.
 * @param {string[]} files the .rep files
 * @param {string} [base] the folder the file names are written relative to
 */
export function inventory(files, base = process.cwd()) {
  const evaluator = new Evaluator({ context: createContext('en-US') });
  const builtins = new Set(evaluator.identifiers.keys.map((k) => k.toUpperCase()));
  const reportIdens = new Set(REPORT_IDENTIFIERS);
  const parser = new EvalParser(createContext('en-US'));

  const t = {
    classes: new Tally(),
    sections: new Tally(),
    properties: new Tally(),
    enumValues: new Tally(),
    functions: new Tally(),
    unknownFunctions: new Tally(),
    reportVariables: new Tally(),
    identifiers: new Tally(),
    fieldsByDataset: new Tally(),
    paramRefs: new Tally(),
    badExpressions: new Tally(),
    paramTypes: new Tally(),
    paramFeatures: new Tally(),
    drivers: new Tally(),
    datasetFeatures: new Tally(),
    fonts: new Tally(),
    type1Fonts: new Tally(),
    formats: new Tally(),
    images: new Tally(),
  };
  const reports = [];

  for (const path of files) {
    const file = relative(base, path).replace(/\\/g, '/') || basename(path);
    let report;
    try {
      report = readReportXml(new Uint8Array(readFileSync(path)));
    } catch (e) {
      const dfm = e instanceof ReportReaderError && e.message === DFM_FORMAT_MESSAGE;
      reports.push({ file, read: false, reason: dfm ? 'DFM' : 'error', message: e instanceof Error ? e.message : String(e) });
      continue;
    }
    const counts = { components: 0, sections: 0, subreports: report.subReports.length, datasets: report.dataInfo.length, params: report.params.length, expressions: 0 };

    const expressionNames = new Set(); // identifiers of expression items and charts, variables of this report
    const objects = [report, ...report.databaseInfo, ...report.dataInfo, ...report.params];
    for (const sub of report.subReports) {
      objects.push(sub);
      for (const sec of sub.sections) {
        objects.push(sec);
        counts.sections++;
        t.sections.add(enumName(SectionType, sec.sectionType), file);
        for (const c of sec.components) {
          objects.push(c);
          counts.components++;
          if (typeof c.identifier === 'string' && c.identifier.length > 0) expressionNames.add(c.identifier.toUpperCase());
        }
      }
    }
    const datasetAliases = new Set(report.dataInfo.map((d) => (d.alias ?? '').toUpperCase()));
    const paramAliases = new Set(report.params.map((p) => (p.alias ?? '').toUpperCase()));

    for (const obj of objects) {
      const cls = obj.className ?? '?';
      t.classes.add(cls, file);
      const defaults = defaultsOf(obj);
      for (const [prop, value] of Object.entries(obj)) {
        if (value === null || value === undefined || typeof value === 'function') continue;
        if (isExpressionProperty(prop)) {
          if (typeof value === 'string' && value.trim().length > 0) {
            counts.expressions++;
            scanExpression(value, file);
          }
          continue;
        }
        if (NOT_FEATURES.has(prop) || typeof value === 'object' && !Array.isArray(value)) continue;
        const e = ENUMS[cls + '.' + prop] ?? ENUMS[prop];
        if (!isDefault(prop, value, defaults[prop])) {
          t.properties.add(cls + '.' + prop, file);
          if (e !== undefined && typeof value === 'number') t.enumValues.add(`${cls}.${prop} = ${enumName(e, value)}`, file);
          else if (typeof value === 'boolean') t.enumValues.add(`${cls}.${prop} = ${value}`, file);
        }
      }
      // Text: fonts and formats
      if (typeof obj.type1Font === 'number' && obj.className !== 'TRPREPORT') t.type1Fonts.add(enumName(PDFFontType, obj.type1Font), file);
      if (typeof obj.wFontName === 'string' && obj.wFontName.length > 0 && obj.className !== 'TRPREPORT') t.fonts.add('Windows: ' + obj.wFontName, file);
      if (typeof obj.lFontName === 'string' && obj.lFontName.length > 0 && obj.className !== 'TRPREPORT') t.fonts.add('Linux: ' + obj.lFontName, file);
      for (const f of ['displayFormat', 'exportDisplayFormat']) if (typeof obj[f] === 'string' && obj[f].length > 0) t.formats.add(obj[f], file);
      // Images in the report (image items and section backgrounds)
      if (typeof obj.streamBase64 === 'string' && obj.streamBase64.length > 0) t.images.add(cls + ' ' + imageFormat(obj.streamBase64), file);
    }
    for (const f of report.embeddedFiles ?? []) t.images.add('embedded file (PDF/A) ' + (f.mimeType || f.fileName || ''), file);

    for (const p of report.params) {
      t.paramTypes.add(enumName(ParamType, p.paramType), file);
      if (p.lookupDataset) t.paramFeatures.add('lookup dataset', file);
      if (p.searchDataset) t.paramFeatures.add('search dataset', file);
      if (p.search) t.paramFeatures.add('search', file);
      if (p.validation) t.paramFeatures.add('validation expression', file);
      if ((p.datasets ?? []).length > 0) t.paramFeatures.add('assigned to datasets', file);
      if ((p.items ?? []).length > 0) t.paramFeatures.add('list items', file);
      if (p.visible === true) t.paramFeatures.add('visible (asked to the user)', file);
      if (p.neverVisible === true) t.paramFeatures.add('never visible', file);
      if (p.isReadOnly === true) t.paramFeatures.add('read only', file);
      if (p.allowNulls === true) t.paramFeatures.add('allows nulls', file);
    }
    for (const db of report.databaseInfo) {
      let driver = enumName(DriverType, db.driver);
      if (db.driver === DriverType.DotNet || db.driver === DriverType.DotNet2) {
        driver += db.providerFactory ? ' (' + db.providerFactory + ')' : ' (' + enumName(DotNetDriverType, db.dotNetDriver) + ')';
      }
      t.drivers.add(driver, file);
      if (db.loadParams && db.driver !== DriverType.Mybase && db.driver !== DriverType.HttpAgent) t.datasetFeatures.add('connection parameters from dbxconnections.ini (loadParams)', file);
      if (db.configFile) t.datasetFeatures.add('own connections file (configFile)', file);
    }
    for (const d of report.dataInfo) {
      if (d.sql && d.sql.trim().length > 0) t.datasetFeatures.add('SQL', file);
      if (d.dataSource) t.datasetFeatures.add('master/detail (dataSource)', file);
      if ((d.dataUnions ?? []).length > 0) t.datasetFeatures.add(d.parallelUnion ? 'parallel union' : d.groupUnion ? 'grouped union' : 'union', file);
      if (d.myBaseFilename) t.datasetFeatures.add('MyBase file', file);
      if (d.myBaseIndexFields) t.datasetFeatures.add('MyBase index fields', file);
      if (d.bdeTable) t.datasetFeatures.add('BDE table', file);
      if (!d.openOnStart) t.datasetFeatures.add('not opened on start', file);
    }
    reports.push({ file, read: true, ...counts });

    function scanExpression(text, where) {
      try {
        parser.expression = text;
        let guard = 0;
        while (parser.currentToken() !== TokenType.Eof && guard++ < 100000) {
          const token = parser.currentToken();
          const s = parser.tokenString();
          if (token === TokenType.Operator && s.toUpperCase() === 'IIF') t.functions.add('IIF', where);
          if (token === TokenType.Symbol) {
            const name = s.toUpperCase();
            parser.nextToken();
            const call = parser.currentToken() === TokenType.Operator && parser.tokenString() === '(';
            const dot = name.indexOf('.');
            if (call) {
              if (builtins.has(name) || reportIdens.has(name)) t.functions.add(name, where);
              else t.unknownFunctions.add(name, where);
            } else if (dot > 0 && name.startsWith('M.')) t.paramRefs.add(name.substring(2), where);
            else if (dot > 0 && datasetAliases.has(name.substring(0, dot))) t.fieldsByDataset.add(name.substring(0, dot), where);
            else if (dot > 0) t.identifiers.add(name + ' (not a dataset of the report)', where);
            else if (paramAliases.has(name)) t.paramRefs.add(name, where);
            else if (reportIdens.has(name)) t.reportVariables.add(name, where);
            else if (builtins.has(name)) t.functions.add(name, where);
            else if (expressionNames.has(name)) t.identifiers.add('expression identifier', where);
            else t.identifiers.add(name, where);
            continue;
          }
          parser.nextToken();
        }
      } catch (e) {
        t.badExpressions.add(e instanceof Error ? e.message.split('\n')[0] : String(e), where);
      }
    }
  }

  return {
    reports,
    totals: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.toJSON()])),
    tallies: t,
  };
}

/** The Markdown summary of an inventory. */
export function markdown(inv) {
  const read = inv.reports.filter((r) => r.read);
  const notRead = inv.reports.filter((r) => !r.read);
  const out = [];
  out.push('# Inventory of reports', '');
  out.push(`${inv.reports.length} files, ${read.length} read` + (notRead.length > 0 ? `, ${notRead.length} not read` : '') + '.', '');
  if (notRead.length > 0) {
    out.push('## Not read', '');
    for (const r of notRead) out.push(`- \`${r.file}\`: ${r.reason === 'DFM' ? 'Delphi DFM format: save it as XML from the designer' : r.message}`);
    out.push('');
  }
  if (read.length > 0) {
    out.push('## Reports', '', '| Report | Subreports | Sections | Components | Datasets | Parameters | Expressions |', '|---|---:|---:|---:|---:|---:|---:|');
    for (const r of read) out.push(`| \`${r.file}\` | ${r.subreports} | ${r.sections} | ${r.components} | ${r.datasets} | ${r.params} | ${r.expressions} |`);
    out.push('');
  }
  const table = (title, tally, note) => {
    const rows = tally.rows();
    if (rows.length === 0) return;
    out.push(`## ${title}`, '');
    if (note) out.push(note, '');
    out.push('| | Times | Reports |', '|---|---:|---:|');
    for (const r of rows) out.push(`| ${r.key.replace(/\|/g, '\\|')} | ${r.count} | ${r.reports} |`);
    out.push('');
  };
  const t = inv.tallies;
  table('Classes', t.classes);
  table('Sections', t.sections);
  table('Connections by driver', t.drivers, 'The host gives each connection alias its TypeScript driver.');
  table('Datasets', t.datasetFeatures);
  table('Parameters by type', t.paramTypes);
  table('Parameter features', t.paramFeatures);
  table('Functions', t.functions, 'Functions and constants the engine knows (built in or added by the report).');
  table('Unknown functions', t.unknownFunctions, 'Called in an expression, but not a function of the engine.');
  table('Report variables', t.reportVariables);
  table('Dataset fields read, by dataset', t.fieldsByDataset);
  table('Parameters read (by their alias or M.ALIAS)', t.paramRefs);
  table('Other identifiers', t.identifiers, 'Variables, fields without their dataset and names the engine does not know.');
  table('Expressions the parser rejects', t.badExpressions);
  table('Standard PDF fonts (Type1Font)', t.type1Fonts, 'Linked and Embedded need TrueType fonts (the fonts option of reportman-node).');
  table('Fonts by name', t.fonts);
  table('Display formats', t.formats);
  table('Images and embedded files', t.images);
  table('Properties set (not the default of their class)', t.properties);
  table('Values of the enumerated and boolean properties set', t.enumValues);
  return out.join('\n');
}

// The command line
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const take = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const jsonOut = take('--json');
  const mdOut = take('--md');
  if (args.length === 0) {
    console.error('usage: node tools/rep-inventory.mjs <report.rep | folder>... [--json out.json] [--md out.md]');
    process.exit(2);
  }
  const files = reportFiles(args);
  const inv = inventory(files);
  const md = markdown(inv);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ reports: inv.reports, totals: inv.totals }, null, 2) + '\n');
  if (mdOut) writeFileSync(mdOut, md + '\n');
  if (!mdOut) console.log(md);
  process.exit(inv.reports.some((r) => r.read) ? 0 : 1);
}
