// The report as the designer receives it: the JSON Reportman.Server writes of its engine's Report
// (Newtonsoft, camelCase, the engine's converters), which has more members than the model of
// @reportman/lib keeps. Besides the design properties (serializeReport) the C# object writes the
// state of a run (all of it at its start for a report just read), values its getters derive from
// other members (the counts of the sections of a subreport, the alignment flags of a text, the
// texts of a parameter in the report's language) and a few members the .rep does not store. They
// are added here with the values C# gives them, so that the designer gets every member it may
// read, as from Reportman.Server.
//
// Fields C# keeps as they come (it deserializes them from the designer's JSON and writes them
// back) are kept when the document has them; members C# derives are always derived again.

import { hydrateReport, readReportXml, serializeReport, SectionType, updateReferences, VariantType, type Report } from '@reportman/lib';

type Json = Record<string, unknown>;

/** A Null Variant as VariantJsonConverter writes it. */
const nullVariant = (): Json => ({ type: 'Null', value: null });

/**
 * HttpAgentBaseUrl of a DatabaseInfo the .rep does not set: the default of the Release build of the
 * engine (the Debug build has another one).
 */
export const HTTP_AGENT_BASE_URL = 'https://aiapi.reportman.es';

// ChartItem.SeriesColors: the palette the engine starts every chart with (a field the .rep does not store)
const SERIES_COLORS = [
  0xff0000, 0xffddff, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xaaaaaa, 0xbb0000, 0x00bb00, 0x0000bb, 0xbbbb00,
  0xbb00bb, 0x00bbbb, 0x777777, 0x773333, 0x337733, 0x333377, 0x777700, 0x770077, 0x007777,
];

// MetaFile.AlignmentFlags of the C# engine
const ALIGN_LEFT = 1;
const ALIGN_RIGHT = 2;
const ALIGN_HCENTER = 4;
const ALIGN_HJUSTIFY = 1024;

/** The members of a run of BaseReport, as a report just loaded has them. */
const REPORT_FIELDS: Json = {
  currentSubReportIndex: 0,
  asyncExecution: false,
  // ThreadPriority.Normal
  asyncPriority: 2,
  printedSomething: false,
  pageNum: 0,
  pageNumGroup: 0,
  internalPageWidth: 0,
  internalPageHeight: 0,
  freeSpace: 0,
  currentOrientation: 0,
  updatePageSize: false,
};

/** The fields of a PrintItem a run or the designer of C# sets (sizes of a run, design visibility, selection). */
const PRINT_ITEM_FIELDS: Json = {
  printWidth: 0,
  printHeight: 0,
  visible: true,
  // System.Drawing.Point and Rectangle as Newtonsoft writes them (their TypeConverter)
  lastExtent: '0, 0',
  selectionIndex: 0,
  selectionRectangle: '0, 0, 0, 0',
};

const EXPRESSION_FIELDS = (): Json => ({
  value: nullVariant(),
  sumValue: nullVariant(),
  dataCount: 0,
  updated: false,
  partialPos: 0,
  isPageCount: false,
  isGroupPageCount: false,
  lastMetaIndex: 0,
  exportValue: nullVariant(),
});

/** Sets the members the object does not have yet. */
function defaults(target: Json, values: Json): void {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in target) || target[key] === undefined) target[key] = typeof value === 'object' && value !== null ? structuredClone(value) : value;
  }
}

/**
 * Strings.GetStringByIndex of the C# engine over the newline separated text a list of lines comes
 * from (Descriptions, Hints): Fill splits at CR, LF or CR LF, always keeping the last part.
 */
function stringByIndex(text: string, index: number): string {
  const list: string[] = [];
  let partial = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\r') {
      list.push(partial);
      partial = '';
      if (i < text.length - 1 && text[i + 1] === '\n') i++;
    } else if (c === '\n') {
      list.push(partial);
      partial = '';
    } else partial += c;
  }
  list.push(partial);
  if (index < 0) index = 0;
  return index < list.length ? list[index]! : list[0]!;
}

/** The text C# keeps for a list of lines (NewlineDelimitedStringConverter wrote it split at LF). */
function linesText(lines: unknown): string {
  return Array.isArray(lines) ? lines.map((l) => String(l ?? '')).join('\n') : typeof lines === 'string' ? lines : '';
}

/** A DateTime as Newtonsoft writes one of kind Unspecified: the wall clock, the fraction trimmed. */
export function unspecifiedDateText(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  let text = `${p(date.getFullYear(), 4)}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
  const ms = date.getMilliseconds();
  if (ms > 0) text += '.' + p(ms, 3).replace(/0+$/, '');
  return text;
}

/** A DateTime of kind Utc as Newtonsoft writes it: the fraction trimmed, Z. */
function utcDateText(date: Date): string {
  const iso = date.toISOString();
  const fraction = iso.substring(20, 23).replace(/0+$/, '');
  return iso.substring(0, 19) + (fraction.length > 0 ? '.' + fraction : '') + 'Z';
}

/** PrintItemText.PrintAlignment: the horizontal alignment flags, mirrored for BidiFull in the report's language. */
function printAlignment(item: Json, language: number): number {
  const alignment = Number(item.alignment ?? 0);
  let result = 0;
  // TextAlignType: Left 0, Right 1, Center 2, Justify 3
  if (alignment === 1) result = ALIGN_RIGHT;
  else if (alignment === 2) result = ALIGN_HCENTER;
  else if (alignment === 3) result = ALIGN_HJUSTIFY;
  let langindex = language + 1;
  if (langindex < 0 || langindex > 256) langindex = 0;
  const modes = Array.isArray(item.bidiModes) ? (item.bidiModes as unknown[]) : [];
  if (modes.length > langindex && modes[langindex] === 'BidiFull') {
    if (alignment === 0) result = ALIGN_RIGHT;
    else if (alignment === 1) result = ALIGN_LEFT;
  }
  return result;
}

/** The length of the bytes of a base64 text. */
function base64Length(text: unknown): number {
  return typeof text === 'string' && text.length > 0 ? Buffer.from(text, 'base64').length : 0;
}

// The models hydrated from a document that had no undo history (C# writes none back for them)
const withoutUndo = new WeakSet<Report>();

/**
 * The model of a report the designer sent (its JSON), as Reportman.Server reads it (Newtonsoft,
 * then BaseReport.UpdateReferences): hydrateReport keeps every member, the runtime ones too, so
 * that it goes back as it came. Read the request with parseDesignerJson.
 */
export function modelFromDocument(document: Json): Report {
  const model = updateReferences(hydrateReport(document));
  if (document.undoCue === undefined || document.undoCue === null) withoutUndo.add(model);
  return model;
}

/**
 * The model of a .rep (XML, plain or zlib) as Reportman.Server reads one (LoadFromStream without
 * converting it to .Net, UpdateReferences): a report of the Delphi engine is converted only to run,
 * so the designer saves it as it was (converted, its SQL parameters and drivers changed and it
 * stopped working in Delphi).
 */
export function modelFromXml(bytes: Uint8Array): Report {
  return updateReferences(readReportXml(bytes));
}

/** The report as Reportman.Server sends it to the designer (the JSON of its engine's Report). */
export function designerDocument(model: Report): Json {
  const doc = serializeReport(model) as Json;
  const language = Number(model.language ?? 0);
  // The engine's report has no name nor class (this model names it REPORT, of class TRPREPORT)
  doc.name = '';
  doc.className = '';
  defaults(doc, REPORT_FIELDS);
  // SortedList<string, string> of the readers of a run
  if (doc.usedDataReaders === undefined || doc.usedDataReaders === null) doc.usedDataReaders = {};

  const subReports = (doc.subReports as Json[] | undefined) ?? [];
  for (const sub of subReports) {
    defaults(sub, { lastRecord: false, currentGroupIndex: 0 });
    const sections = (sub.sections as Json[] | undefined) ?? [];
    const types = sections.map((s) => Number(s.sectionType));
    const first = (t: SectionType) => types.indexOf(t);
    const last = (t: SectionType) => types.lastIndexOf(t);
    // NumberOfSectionsOfType: from the first of the type on
    const count = (t: SectionType) => {
      const from = first(t);
      return from < 0 ? 0 : types.slice(from).filter((x) => x === t).length;
    };
    sub.firstPageHeader = first(SectionType.PageHeader);
    sub.lastPageHeader = last(SectionType.PageHeader);
    sub.pageHeaderCount = count(SectionType.PageHeader);
    sub.pageFooterCount = count(SectionType.PageFooter);
    sub.firstPageFooter = first(SectionType.PageFooter);
    sub.lastPageFooter = last(SectionType.PageFooter);
    sub.firstDetail = first(SectionType.Detail);
    // (last - first) + 1, 0 without any detail
    sub.detailCount = first(SectionType.Detail) < 0 ? 0 : last(SectionType.Detail) - first(SectionType.Detail) + 1;
    sub.lastDetail = last(SectionType.Detail);
    sub.groupCount = count(SectionType.GroupHeader);
    for (const section of sections) {
      defaults(section, { groupValue: nullVariant(), firstPage: 0, ...PRINT_ITEM_FIELDS });
      section.isExternal = false;
      for (const item of (section.components as Json[] | undefined) ?? []) componentDocument(item, language);
    }
  }

  const params = (doc.params as Json[] | undefined) ?? [];
  params.forEach((p, i) => {
    const descriptions = linesText(p.descriptions);
    const hints = linesText(p.hints);
    const errors = linesText(p.errorMessages);
    p.description = descriptions.length === 0 ? '' : stringByIndex(descriptions, language);
    p.userVisible = p.visible === true && p.neverVisible !== true;
    p.hint = hints.length === 0 ? '' : stringByIndex(hints, language);
    p.errorMessage = errors.length === 0 ? '' : stringByIndex(errors, language);
    defaults(p, { lastValue: nullVariant() });
    const value = model.params[i]?.value;
    if (value !== undefined && value.type === VariantType.DateTime && value.value instanceof Date && typeof p.value === 'object' && p.value !== null)
      (p.value as Json).value = unspecifiedDateText(value.value);
  });

  for (const d of (doc.dataInfo as Json[] | undefined) ?? []) {
    // The rows of a run: a report sent or read has none
    d.data = [];
    defaults(d, { sqlOverride: '' });
  }
  for (const db of (doc.databaseInfo as Json[] | undefined) ?? []) defaults(db, { httpAgentBaseUrl: HTTP_AGENT_BASE_URL, httpAgentHubDatabaseId: 0 });
  for (const f of (doc.embeddedFiles as Json[] | undefined) ?? []) defaults(f, { resourceNumber: 0 });

  // The undo history: none when the report has none (hydrateReport always gives the model an empty one)
  const cue = model.undoCue;
  const empty = cue === undefined || (cue.undoOperations.length === 0 && cue.redoOperations.length === 0);
  if (cue === undefined || (empty && withoutUndo.has(model))) delete doc.undoCue;
  else if (doc.undoCue !== null && typeof doc.undoCue === 'object') {
    const json = doc.undoCue as Json;
    const fix = (ops: unknown, source: { date?: Date }[]) => {
      if (!Array.isArray(ops)) return;
      ops.forEach((op: Json, i) => {
        const date = source[i]?.date;
        if (date instanceof Date && !isNaN(date.getTime())) op.date = utcDateText(date);
      });
    };
    fix(json.undoOperations, cue.undoOperations);
    fix(json.redoOperations, cue.redoOperations);
  }
  return doc;
}

/** The members of a component (PrintPosItem) C# writes besides the model's. */
function componentDocument(item: Json, language: number): void {
  defaults(item, PRINT_ITEM_FIELDS);
  // A public field: C# writes it even when the .rep has none (null)
  if (item.annotationExpression === undefined) item.annotationExpression = null;
  switch (item.className) {
    case 'TRPSHAPE':
      defaults(item, { color: 0, brushColorExpression: '' });
      break;
    case 'TRPLABEL':
      item.printAlignment = printAlignment(item, language);
      break;
    case 'TRPEXPRESSION':
      defaults(item, EXPRESSION_FIELDS());
      item.printAlignment = printAlignment(item, language);
      break;
    case 'TRPIMAGE': {
      const length = base64Length(item.streamBase64);
      item.hasEmbeddedImageStream = length > 0;
      item.embeddedImageByteCount = length;
      break;
    }
    case 'TRPCHART':
      defaults(item, { seriesColors: [...SERIES_COLORS] });
      if (item.drawHelper === undefined) item.drawHelper = null;
      item.printAlignment = printAlignment(item, language);
      break;
    case 'TRPBARCODE':
      if (item.currentText === undefined) item.currentText = null;
      break;
  }
}
