// A Report Manager report in a DFM form to the XML the Delphi engine writes for it: what
// TRpBaseReport.LoadFromStream does (TReader.ReadRootComponent: the values the constructors set,
// then the properties of the stream through their setters, the references resolved by name, the
// Loaded methods, EnsureReportItemNames) and then WriteReportXML (rpxmlstream.pas), as
// reptotxt -xml does. The classes are not ported: each object keeps the properties of the stream,
// and the values the Delphi constructors give the others are in the tables below.

import { DfmError, readDfm, type DfmObject, type DfmProperty, type DfmValue } from './reader.js';
import { XmlOut, delphiFloatToStr } from './xmlout.js';

// ---------------------------------------------------------------------------------------------
// Enumerations (their identifiers in declaration order: the ordinal is the index)

const ENUMS = {
  TRpPosAlign: ['rpalnone', 'rpalbottom', 'rpalright', 'rpalbotright', 'rpalleftright', 'rpaltopbottom', 'rpalclient'],
  TRpSelectFontStep: ['rpselectsize', 'rpselectcpi20', 'rpselectcpi17', 'rpselectcpi15', 'rpselectcpi12', 'rpselectcpi10', 'rpselectcpi6', 'rpselectcpi5'],
  TPDFConformanceType: ['PDF_1_4', 'PDF_A_3'],
  TRpOrientation: ['rpOrientationDefault', 'rpOrientationPortrait', 'rpOrientationLandscape'],
  TRpStreamFormat: ['rpStreamzlib', 'rpStreamText', 'rpStreambinary', 'rpStreamXML', 'rpStreamXMLZlib'],
  TRpParamtype: [
    'rpParamString', 'rpParamInteger', 'rpParamDouble', 'rpParamDate', 'rpParamTime', 'rpParamDateTime', 'rpParamCurrency', 'rpParamBool',
    'rpParamExpreB', 'rpParamExpreA', 'rpParamSubst', 'rpParamList', 'rpParamMultiple', 'rpParamSubstE', 'rpParamSubstList',
    'rpParamInitialExpression', 'rpParamUnknown',
  ],
  TRpCachedImage: ['rpCachedNone', 'rpCachedFixed', 'rpCachedVariable'],
  TrpBackStyle: ['baDesign', 'baPreview', 'baPrint'],
  TRpType1Font: ['poHelvetica', 'poCourier', 'poTimesRoman', 'poSymbol', 'poZapfDingbats', 'poLinked', 'poEmbedded'],
  TRpImageDrawStyle: ['rpDrawCrop', 'rpDrawStretch', 'rpDrawFull', 'rpDrawTile', 'rpDrawTiledpi'],
  TRpAggregate: ['rpAgNone', 'rpAgGroup', 'rpAgPage', 'rpAgGeneral'],
  TRpAggregateType: ['rpagSum', 'rpagMin', 'rpagMax', 'rpagAvg', 'rpagStdDev'],
  TRpShapeType: ['rpsRectangle', 'rpsSquare', 'rpsRoundRect', 'rpsRoundSquare', 'rpsEllipse', 'rpsCircle', 'rpsHorzLine', 'rpsVertLine', 'rpsOblique1', 'rpsOblique2'],
  TRpPrinterFontsOption: ['rppfontsdefault', 'rppfontsalways', 'rppfontsnever', 'rppfontsrecalculate'],
  TRpPageSize: ['rpPageSizeDefault', 'rpPageSizeCustom', 'rpPageSizeUser'],
  TRpPrinterSelect: [
    'pRpDefaultPrinter', 'pRpReportPrinter', 'pRpTicketPrinter', 'pRpGraphicprinter', 'pRpCharacterprinter', 'pRpReportPrinter2', 'pRpTicketPrinter2',
    'pRpUserPrinter1', 'pRpUserPrinter2', 'pRpUserPrinter3', 'pRpUserPrinter4', 'pRpUserPrinter5', 'pRpUserPrinter6', 'pRpUserPrinter7', 'pRpUserPrinter8',
    'pRpUserPrinter9', 'pRpPlainPrinter', 'pRpPlainFullPrinter',
    ...Array.from({ length: 50 }, (_, i) => 'pRpPrinter' + (i + 1)),
  ],
  TRpPreviewStyle: ['spWide', 'spNormal', 'spEntirePage', 'spCustom'],
  TRpPreviewWindowStyle: ['spwNormal', 'spwMaximized'],
  TRpSectionType: ['rpsecpheader', 'rpsecgheader', 'rpsecdetail', 'rpsecgfooter', 'rpsecpfooter'],
  TRpSkipType: ['secskipdefault', 'secskipbefore', 'secskipafter'],
  TRpBarcodeType: [
    'bcCode_2_5_interleaved', 'bcCode_2_5_industrial', 'bcCode_2_5_matrix', 'bcCode39', 'bcCode39Extended', 'bcCode128A', 'bcCode128B', 'bcCode128C',
    'bcCode128', 'bcCode93', 'bcCode93Extended', 'bcCodeMSI', 'bcCodePostNet', 'bcCodeCodabar', 'bcCodeEAN8', 'bcCodeEAN13', 'bcCodePDF417', 'bcCodeQr',
  ],
  TRpChartType: [
    'rpchartline', 'rpchartbar', 'rpchartpoint', 'rpcharthorzbar', 'rpchartarea', 'rpchartpie', 'rpchartarrow', 'rpchartbubble', 'rpchartgantt',
    'rpchartsplines', 'rpchartcandlestick', 'rpchartpyramid', 'rpchartpolar', 'rpchartpointfigure', 'rpchartfunnel', 'rpchartkagi', 'rpchartdoughnut',
    'rpchartradar', 'rpchartrenko', 'rpcharterrorbar',
  ],
  TRpChartDriver: ['rpchartdriverdefault', 'rpchartdriverengine', 'rpchartdriverteechart'],
  TRpMultiBar: ['rpMultiNone', 'rpMultiside', 'rpMultiStacked', 'rpMultiStacked100'],
  TRpDbDriver: ['rpdatadbexpress', 'rpdatamybase', 'rpdataibx', 'rpdatabde', 'rpdataado', 'rpdataibo', 'rpdatazeos', 'rpdatadriver', 'rpdotnet2driver', 'rpfiredac', 'rpdbHttp'],
  TRpDatasetType: ['rpdquery', 'rpdtable'],
  TRpReportAction: ['rpDrawerBefore', 'rpDrawerAfter'],
} as const;

type EnumName = keyof typeof ENUMS;

// ---------------------------------------------------------------------------------------------
// The properties a DFM object may have, by class: the published ones and the DefineProperties
// ones, as Delphi reads them. A property that is not here makes Delphi fail, and the converter too.

type Kind = 'int' | 'bool' | 'string' | 'enum' | 'set' | 'strings' | 'binary' | 'collection' | 'ref' | 'variant' | 'int64';
interface PropDef {
  kind: Kind;
  enum?: EnumName;
}
type ClassDef = Record<string, PropDef>;

const I: PropDef = { kind: 'int' };
const B: PropDef = { kind: 'bool' };
const S: PropDef = { kind: 'string' };
const L: PropDef = { kind: 'strings' };
const C: PropDef = { kind: 'collection' };
const R: PropDef = { kind: 'ref' };
const E = (name: EnumName): PropDef => ({ kind: 'enum', enum: name });

const REPORT: ClassDef = {
  GridVisible: B, GridLines: B, GridEnabled: B, GridColor: I, GridWidth: I, GridHeight: I,
  PageOrientation: E('TRpOrientation'), Pagesize: E('TRpPageSize'), PagesizeQt: I, PageHeight: I, PageWidth: I,
  CustomPageHeight: I, CustomPageWidth: I, PageBackColor: I, PreviewStyle: E('TRpPreviewStyle'), PreviewMargins: B,
  PreviewWindow: E('TRpPreviewWindowStyle'), LeftMargin: I, TopMargin: I, RightMargin: I, BottomMargin: I,
  PrinterSelect: E('TRpPrinterSelect'), SubReports: C, DataInfo: C, DatabaseInfo: C, Params: C, Language: I, Copies: I,
  CollateCopies: B, TwoPass: B, PrinterFonts: E('TRpPrinterFontsOption'), PrintOnlyIfDataAvailable: B,
  StreamFormat: E('TRpStreamFormat'), ReportAction: { kind: 'set', enum: 'TRpReportAction' }, PreviewAbout: B,
  Type1Font: E('TRpType1Font'), FontSize: I, FontRotation: I, FontStyle: I, FontColor: I, BackColor: I, Transparent: B,
  CutText: B, Alignment: I, VAlignment: I, WordWrap: B, SingleLine: B, 'BidiModes.Strings': L, MultiPage: B,
  PrintStep: E('TRpSelectFontStep'), PaperSource: I, Duplex: I, ForcePaperName: S, LinesPerInch: I,
  PDFConformance: E('TPDFConformanceType'), PDFCompressed: B, DocAuthor: S, DocTitle: S, DocSubject: S, DocProducer: S,
  DocCreator: S, DocCreationDate: S, DocModificationDate: S, DocKeywords: S, DocXMPContent: S,
  WFontName: S, LFontName: S, EmbeddedFiles: S,
};

const COMMON: ClassDef = { Width: I, Height: I, PrintCondition: S, DoBeforePrint: S, DoAfterPrint: S };
const POS: ClassDef = { ...COMMON, PosX: I, PosY: I, Align: E('TRpPosAlign'), AnnotationExpression: S };
const TEXT: ClassDef = {
  ...POS, Type1Font: E('TRpType1Font'), FontSize: I, FontRotation: I, FontStyle: I, FontColor: I, BackColor: I, Transparent: B,
  CutText: B, Alignment: I, VAlignment: I, WordWrap: B, WordBreak: B, InterLine: I, SingleLine: B, 'BidiModes.Strings': L,
  MultiPage: B, PrintStep: E('TRpSelectFontStep'), IsHtml: B, WFontName: S, LFontName: S,
};

const CLASSES: Record<string, ClassDef> = {
  TRPSUBREPORT: { Sections: C, Alias: S, ParentSubReport: R, ParentSection: R, PrintOnlyIfDataAvailable: B, ReOpenOnPrint: B },
  TRPSECTION: {
    ...COMMON, SubReport: R, GroupName: S, ChangeBool: B, PageRepeat: B, SkipPage: B, AlignBottom: B, SectionType: E('TRpSectionType'),
    Components: C, AutoExpand: B, AutoContract: B, HorzDesp: B, VertDesp: B, ExternalFilename: S, ExternalConnection: S, ExternalTable: S,
    ExternalField: S, ExternalSearchField: S, ExternalSearchValue: S, StreamFormat: E('TRpStreamFormat'), ChildSubReport: R, BeginPage: B,
    FooterAtReportEnd: B, SkipRelativeH: B, SkipRelativeV: B, SkipType: E('TRpSkipType'), IniNumPage: B, Global: B, dpires: I,
    BackStyle: E('TrpBackStyle'), DrawStyle: E('TRpImageDrawStyle'), CachedImage: E('TRpCachedImage'), ChangeExpression: S,
    BeginPageExpression: S, SkipExpreV: S, SkipExpreH: S, SkipToPageExpre: S, BackExpression: S, Stream: { kind: 'binary' },
  },
  TRPLABEL: { ...TEXT, 'AllText.Strings': L, WideText: S },
  TRPEXPRESSION: {
    ...TEXT, DataType: E('TRpParamtype'), DisplayFormat: S, Identifier: S, Aggregate: E('TRpAggregate'), GroupName: S,
    AgType: E('TRpAggregateType'), AutoExpand: B, AutoContract: B, PrintOnlyOne: B, PrintNulls: B, ExportDisplayFormat: S, ExportLine: I,
    ExportPosition: I, ExportSize: I, ExportDoNewLine: B, Expression: S, AgIniValue: S, ExportExpression: S,
  },
  TRPSHAPE: { ...POS, BrushStyle: I, BrushColor: I, PenStyle: I, PenColor: I, Shape: E('TRpShapeType'), PenWidth: I },
  TRPIMAGE: { ...POS, Rotation: I, DrawStyle: E('TRpImageDrawStyle'), dpires: I, CopyMode: I, CachedImage: E('TRpCachedImage'), Expression: S, Stream: { kind: 'binary' } },
  TRPBARCODE: {
    ...POS, Modul: I, Ratio: { kind: 'variant' }, Typ: E('TRpBarcodeType'), Checksum: B, DisplayFormat: S, Rotation: I, BColor: I, BackColor: I,
    Transparent: B, NumColumns: I, NumRows: I, ECCLevel: I, Truncated: B, Expression: S,
  },
  TRPCHART: {
    ...TEXT, Series: C, ChangeSerieBool: B, ChartType: E('TRpChartType'), Identifier: S, ClearExpressionBool: B, Driver: E('TRpChartDriver'),
    View3d: B, View3dWalls: B, Perspective: I, Elevation: I, Rotation: I, Zoom: I, HorzOffset: I, VertOffset: I, Tilt: I, Orthogonal: B,
    MultiBar: E('TRpMultiBar'), Resolution: I, ShowLegend: B, ShowHint: B, MarkStyle: I, HorzFontSize: I, VertFontSize: I,
    HorzFontRotation: I, VertFontRotation: I, GetValueCondition: S, ValueExpression: S, ValueXExpression: S, ChangeSerieExpression: S,
    CaptionExpression: S, SerieCaption: S, ClearExpression: S, ColorExpression: S, SerieColorExpression: S, AutoRange: I, YMin: S, YMax: S,
  },
};

const ITEMS: Record<string, ClassDef> = {
  SubReports: { SubReport: R },
  Sections: { Section: R },
  Components: { Component: R },
  Series: { Color: I },
  Params: {
    Name: S, Visible: B, IsReadOnly: B, NeverVisible: B, AllowNulls: B, Value: { kind: 'variant' }, ParamType: E('TRpParamtype'),
    'Datasets.Strings': L, 'Items.Strings': L, 'Values.Strings': L, 'Selected.Strings': L, LookupDataset: S, SearchDataset: S,
    SearchParam: S, Description: S, Hint: S, Search: S, ErrorMessage: S, Validation: S,
  },
  DatabaseInfo: {
    Alias: S, ConfigFile: S, LoadParams: B, LoadDriverParams: B, LoginPrompt: B, Driver: E('TRpDbDriver'), ReportTable: S,
    ReportSearchField: S, ReportField: S, ReportGroupsTable: S, ADOConnectionString: S,
  },
  DataInfo: {
    Alias: S, DatabaseAlias: S, SQL: S, DataSource: S, MyBaseFilename: S, MyBaseFields: S, MyBaseIndexFields: S, MyBaseMasterFields: S,
    BDEIndexFields: S, BDEIndexName: S, BDETable: S, BDEType: E('TRpDatasetType'), BDEFilter: S, BDEMasterFields: S, BDEFirstRange: S,
    BDELastRange: S, 'DataUnions.Strings': L, GroupUnion: B, OpenOnStart: B, ParallelUnion: B, HubSchemaId: { kind: 'int64' }, SchemaName: S,
  },
};

/** The section list item, the component list item... of each collection property. */
const COLLECTION_OF: Record<string, string> = {
  SubReports: 'SubReports', Sections: 'Sections', Components: 'Components', Series: 'Series', Params: 'Params',
  DatabaseInfo: 'DatabaseInfo', DataInfo: 'DataInfo',
};

// ---------------------------------------------------------------------------------------------
// Typed access to the properties of an object or a collection item

const CRLF = '\r\n';

function describe(v: DfmValue): string {
  return v.type;
}

/** The properties of an object, checked against its class; the last one of a name wins. */
class Props {
  private readonly values = new Map<string, DfmValue>();
  private readonly names = new Map<string, string>();

  constructor(
    properties: readonly DfmProperty[],
    readonly owner: string,
    private readonly cls: ClassDef,
  ) {
    const known = new Map(Object.keys(cls).map((k) => [k.toLowerCase(), k]));
    for (const p of properties) {
      const key = known.get(p.name.toLowerCase());
      if (key === undefined) throw new DfmError(`Error reading ${owner}.${p.name}: Property ${p.name} does not exist`);
      this.values.set(key, p.value);
      this.names.set(key, p.name);
    }
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  raw(name: string): DfmValue | undefined {
    return this.values.get(name);
  }

  private bad(name: string, v: DfmValue): never {
    throw new DfmError(`Error reading ${this.owner}.${name}: Invalid property value (${describe(v)})`);
  }

  int(name: string, init: number): number {
    const v = this.values.get(name);
    if (v === undefined) return init;
    if (v.type === 'integer') return v.value;
    if (v.type === 'int64') return Number(BigInt.asIntN(32, v.value));
    return this.bad(name, v);
  }

  int64(name: string, init: bigint): bigint {
    const v = this.values.get(name);
    if (v === undefined) return init;
    if (v.type === 'integer') return BigInt(v.value);
    if (v.type === 'int64') return v.value;
    return this.bad(name, v);
  }

  bool(name: string, init: boolean): boolean {
    const v = this.values.get(name);
    if (v === undefined) return init;
    if (v.type === 'boolean') return v.value;
    return this.bad(name, v);
  }

  str(name: string, init: string): string {
    const v = this.values.get(name);
    if (v === undefined) return init;
    if (v.type === 'string') return v.value;
    return this.bad(name, v);
  }

  /** The ordinal of an enumerated property (its identifier in any case). */
  ord(name: string, init: number): number {
    const v = this.values.get(name);
    if (v === undefined) return init;
    const values = ENUMS[this.cls[name]!.enum!] as readonly string[];
    if (v.type === 'ident') {
      const i = values.findIndex((x) => x.toLowerCase() === v.value.toLowerCase());
      if (i >= 0) return i;
    }
    return this.bad(name, v);
  }

  set(name: string): string[] {
    const v = this.values.get(name);
    if (v === undefined) return [];
    if (v.type !== 'set') return this.bad(name, v);
    const values = ENUMS[this.cls[name]!.enum!] as readonly string[];
    return v.value.map((e) => {
      const found = values.find((x) => x.toLowerCase() === e.toLowerCase());
      if (found === undefined) this.bad(name, v);
      return found;
    });
  }

  /** The lines of a TStrings (X.Strings = ('a' 'b')). */
  lines(name: string): string[] {
    const v = this.values.get(name + '.Strings');
    if (v === undefined) return [];
    if (v.type !== 'list') return this.bad(name, v);
    return v.value.map((x) => (x.type === 'string' ? x.value : this.bad(name, x)));
  }

  binary(name: string): Uint8Array | undefined {
    const v = this.values.get(name);
    if (v === undefined) return undefined;
    if (v.type !== 'binary') return this.bad(name, v);
    return v.value;
  }

  /** The name of a referenced component, or undefined. */
  ref(name: string): string | undefined {
    const v = this.values.get(name);
    if (v === undefined || v.type === 'nil') return undefined;
    if (v.type === 'ident') return v.value;
    return this.bad(name, v);
  }

  /** The items of a collection, each one with its own properties. */
  items(name: string): Props[] {
    const v = this.values.get(name);
    if (v === undefined) return [];
    if (v.type !== 'collection') return this.bad(name, v);
    const cls = ITEMS[COLLECTION_OF[name]!]!;
    return v.value.map((item, i) => new Props(item.properties, `${this.owner}.${name}[${i}]`, cls));
  }
}

/** TStrings.Text: every line followed by CR LF. */
const text = (lines: readonly string[]): string => lines.map((l) => l + CRLF).join('');
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** AnsiUpperCase of the ANSI code page: the letters of Windows-1252 and of Unicode. */
const upper = (s: string): string => s.toUpperCase();

// ---------------------------------------------------------------------------------------------
// The objects of a report

interface Component {
  name: string;
  className: string; // upper case
  props: Props;
}

interface Report {
  props: Props;
  components: Map<string, Component>; // by upper case name
  language: number;
}

/** The objects of the stream, owned by the report whatever their nesting (ReadDataInner). */
function collect(root: DfmObject): Map<string, Component> {
  const result = new Map<string, Component>();
  const counters = new Map<string, number>();
  const visit = (objects: readonly DfmObject[]): void => {
    for (const o of objects) {
      const className = o.className.toUpperCase();
      const cls = CLASSES[className];
      if (cls === undefined) throw new DfmError(`Class ${o.className} not found`);
      let name = o.name;
      if (name.length === 0) {
        // Generatenewname: the class name and the first free number
        let i = counters.get(className) ?? 0;
        while (result.has((o.className + i).toUpperCase())) i++;
        counters.set(className, i + 1);
        name = o.className + i;
      }
      if (result.has(name.toUpperCase())) throw new DfmError(`A component named ${name} already exists`);
      result.set(name.toUpperCase(), { name, className, props: new Props(o.properties, name, cls) });
      visit(o.children);
    }
  };
  visit(root.children);
  return result;
}

// ---------------------------------------------------------------------------------------------
// The XML (rpxmlstream.pas)

/** The values of a parameter Variant (TReader.ReadVariant) and its XML (WriteParamXML). */
function writeParamValue(out: XmlOut, paramType: number, value: DfmValue | undefined): void {
  // Value = Null: no tag; absent: Unassigned, which is not Null, so the tag is written
  if (value !== undefined && value.type === 'null') return;
  const v: DfmValue | undefined = value?.type === 'nil' ? undefined : value;
  const asNumber = (): number => {
    if (v === undefined) return 0;
    switch (v.type) {
      case 'integer':
      case 'extended':
      case 'single':
      case 'double':
      case 'currency':
      case 'date':
        return v.value;
      case 'int64':
        return Number(BigInt.asIntN(32, v.value));
      case 'boolean':
        return v.value ? -1 : 0;
      case 'string': {
        const n = Number(v.value.trim());
        if (v.value.trim().length === 0 || !Number.isFinite(n)) throw new DfmError(`Could not convert variant of type (String) into type (Double): '${v.value}'`);
        return n;
      }
      default:
        throw new DfmError(`Invalid parameter value (${v.type})`);
    }
  };
  switch (paramType) {
    // String, ExpreB, ExpreA, Subst, List, SubstList, InitialExpression, Unknown: String(Value)
    case 0:
    case 8:
    case 9:
    case 10:
    case 11:
    case 14:
    case 15:
    case 16: {
      let s = '';
      if (v !== undefined) {
        if (v.type === 'string') s = v.value;
        else if (v.type === 'boolean') s = v.value ? 'True' : 'False';
        else if (v.type === 'integer') s = String(v.value);
        else if (v.type === 'int64') s = String(BigInt.asIntN(32, v.value));
        // String(Variant) of a number: FloatToStr with the decimal separator of en-US, the locale of the reference outputs
        else if (v.type === 'extended' || v.type === 'double' || v.type === 'single' || v.type === 'currency') s = delphiFloatToStr(v.value);
        else throw new DfmError(`A parameter value of type ${v.type} in a text parameter is not supported`);
      }
      out.str('VALUE', s);
      return;
    }
    case 1: {
      // Integer: the Variant as an Integer (a double is rounded half to even)
      let n = asNumber();
      if (!Number.isInteger(n)) n = roundHalfEven(n);
      out.int('VALUE', n);
      return;
    }
    case 2:
    case 6:
    case 3:
    case 4:
    case 5:
      out.double('VALUE', asNumber());
      return;
    case 7: {
      let b = false;
      if (v !== undefined) {
        if (v.type === 'boolean') b = v.value;
        else if (v.type === 'string') b = /^true$/i.test(v.value.trim()) || (v.value.trim() !== '' && Number(v.value) !== 0 && Number.isFinite(Number(v.value)));
        else b = asNumber() !== 0;
      }
      out.bool('VALUE', b);
      return;
    }
    // Multiple and SubstE are not in the case of WriteParamXML
    default:
      return;
  }
}

function roundHalfEven(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** The lines of TRpWideStrings.SetText: split at #10, a #13 just after a #10 dropped, the last piece always. */
function wideLines(s: string): string[] {
  const lines: string[] = [];
  let current = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '\n') {
      lines.push(current);
      current = '';
      if (s[i + 1] === '\r') i++;
    } else current += c;
  }
  lines.push(current);
  return lines;
}

/** The decoded EmbeddedFiles of the report (ReadEmbeddedFiles). */
interface EmbeddedFile {
  fileName: string;
  mimeType: string;
  description: string;
  creationDate: string;
  modificationDate: string;
  relationship: number;
  content: Uint8Array;
}

function embeddedFiles(hex: string): EmbeddedFile[] {
  if (hex.length === 0) return [];
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0 || /[^0-9A-Fa-f]/.test(clean)) throw new DfmError('Invalid EmbeddedFiles data');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(clean.substr(i * 2, 2), 16);
  const view = new DataView(bytes.buffer);
  let pos = 0;
  const int32 = (): number => {
    if (pos + 4 > bytes.length) throw new DfmError('Invalid EmbeddedFiles data');
    const v = view.getInt32(pos, true);
    pos += 4;
    return v;
  };
  const utf8 = (): string => {
    const n = int32();
    if (n < 0 || pos + n > bytes.length) throw new DfmError('Invalid EmbeddedFiles data');
    const s = new TextDecoder('utf-8').decode(bytes.subarray(pos, pos + n));
    pos += n;
    return s;
  };
  const count = int32();
  const files: EmbeddedFile[] = [];
  for (let i = 0; i < count; i++) {
    const fileName = utf8();
    const mimeType = utf8();
    const description = utf8();
    const creationDate = utf8();
    const modificationDate = utf8();
    const relationship = int32();
    const size = int32();
    if (size < 0 || pos + size > bytes.length) throw new DfmError('Invalid EmbeddedFiles data');
    files.push({ fileName, mimeType, description, creationDate, modificationDate, relationship, content: bytes.slice(pos, pos + size) });
    pos += size;
  }
  return files;
}

/** The stream of a section or an image: an Int64 size and the bytes (ReadStream). */
function streamBytes(data: Uint8Array | undefined, owner: string): Uint8Array {
  if (data === undefined || data.length === 0) return new Uint8Array(0);
  if (data.length < 8) throw new DfmError(`Error reading ${owner}.Stream: stream read error`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const size = Number(view.getBigInt64(0, true));
  if (size < 0 || 8 + size > data.length) throw new DfmError(`Error reading ${owner}.Stream: stream read error`);
  return data.slice(8, 8 + size);
}

/**
 * A component reference as TReader resolves it (FindNestedComponent): a name of the report, or a
 * path of names separated by '.' (or '->') where each one is owned by the one before; 'Owner' is
 * the component itself. Every object of a report is owned by the report (ReadDataInner), so a
 * path such as TRpSection2.TRpLabel0, which old versions wrote, finds nothing.
 */
function findNested(components: ReadonlyMap<string, Component>, path: string): Component | undefined {
  const parts = path.split(/->|[.-]/).filter((p) => p.length > 0);
  let current: Component | 'root' = 'root';
  for (const part of parts) {
    let found: Component | 'root' | undefined = current === 'root' ? components.get(part.toUpperCase()) : undefined;
    if (found === undefined && part.toLowerCase() === 'owner') found = current;
    if (found === undefined) return undefined;
    current = found;
  }
  return current === 'root' ? undefined : current;
}

/** The XML of a DFM tree. */
export function dfmTreeToXml(root: DfmObject): Uint8Array {
  if (!/^(TRpReport|TRpBaseReport)$/i.test(root.className)) throw new DfmError(`The root of the DFM is a ${root.className}, not a TRpReport`);
  const props = new Props(root.properties, root.className, REPORT);
  const components = collect(root);
  const find = (name: string | undefined): Component | undefined => (name === undefined ? undefined : findNested(components, name));
  const out = new XmlOut();

  // SetLanguage: above 256 it is -1; the parameters use 0 below 0 or above 256 (TRpParamList.SetLanguage)
  let language = props.int('Language', -1);
  if (language > 256) language = -1;
  const paramLanguage = props.has('Language') ? (language < 0 || language > 256 ? 0 : language) : 0;
  // The index of the language in the lists of the text components (GetBidiMode)
  let bidiIndex = language + 1;
  if (bidiIndex < 0 || bidiIndex > 256) bidiIndex = 0;

  // The subreports, their sections and the components of each, as the lists hold them
  interface SectionNode {
    section: Component;
    components: Component[];
  }
  interface SubReportNode {
    subreport: Component;
    sections: SectionNode[];
  }
  const tree: SubReportNode[] = [];
  for (const [i, item] of props.items('SubReports').entries()) {
    const subreport = find(item.ref('SubReport'));
    if (subreport === undefined || subreport.className !== 'TRPSUBREPORT') throw new DfmError(`SubReports[${i}]: the subreport ${item.ref('SubReport') ?? '(none)'} does not exist`);
    const sections: SectionNode[] = [];
    for (const [j, sitem] of subreport.props.items('Sections').entries()) {
      const section = find(sitem.ref('Section'));
      if (section === undefined || section.className !== 'TRPSECTION') throw new DfmError(`${subreport.name}.Sections[${j}]: the section ${sitem.ref('Section') ?? '(none)'} does not exist`);
      // TRpReport.Loaded frees the items of a component that is not there
      const list: Component[] = [];
      for (const citem of section.props.items('Components')) {
        const c = find(citem.ref('Component'));
        if (c !== undefined && c.className !== 'TRPSUBREPORT' && c.className !== 'TRPSECTION') list.push(c);
      }
      sections.push({ section, components: list });
    }
    tree.push({ subreport, sections });
  }

  // TRpReport.Loaded: an identifier already taken (ignoring the case) is cleared
  const identifiers = new Set<string>();
  const cleared = new Set<Component>();
  for (const s of tree)
    for (const sec of s.sections)
      for (const c of sec.components) {
        if (c.className !== 'TRPEXPRESSION' && c.className !== 'TRPCHART') continue;
        const id = c.props.str('Identifier', '');
        if (id.length === 0) continue;
        if (identifiers.has(id.toUpperCase())) cleared.add(c);
        else identifiers.add(id.toUpperCase());
      }

  // SaveToStream: a report without subreports gets one with a detail section
  const added = tree.length === 0;

  out.line('<?xml version="1.0" standalone="no"?>');
  out.line('<!DOCTYPE REPORT_MANAGER_2>');
  out.line('<REPORT>');
  writeReportProps(out, props, language);

  // EnsureReportItemNames: the names the DFM does not keep
  const databases = props.items('DatabaseInfo');
  const datasets = props.items('DataInfo');
  const params = props.items('Params');
  const componentNames = new Set<string>();
  for (const s of tree) {
    componentNames.add(s.subreport.name);
    for (const sec of s.sections) {
      componentNames.add(sec.section.name);
      for (const c of sec.components) componentNames.add(c.name);
    }
  }
  const dbNames: string[] = [];
  const dataNames: string[] = [];
  const paramNames: string[] = [];
  const taken = (candidate: string): boolean =>
    dbNames.includes(candidate) || dataNames.includes(candidate) || paramNames.some((p) => p.toUpperCase() === candidate.toUpperCase()) || componentNames.has(candidate);
  const unique = (prefix: string): string => {
    let n = 1;
    while (taken(prefix + n)) n++;
    return prefix + n;
  };
  for (let i = 0; i < databases.length; i++) dbNames.push(unique('TRPDATABASEINFOITEM'));
  for (let i = 0; i < datasets.length; i++) dataNames.push(unique('TRPDATAINFOITEM'));
  for (let i = 0; i < params.length; i++) paramNames.push(unique('TRPPARAM'));

  for (const [i, db] of databases.entries()) {
    out.line('<DATABASEINFO>');
    writeDatabaseInfo(out, db, dbNames[i]!);
    out.line('</DATABASEINFO>');
  }
  for (const [i, d] of datasets.entries()) {
    out.line('<DATAINFO>');
    writeDataInfo(out, d, dataNames[i]!);
    out.line('</DATAINFO>');
  }
  for (const [i, p] of params.entries()) {
    out.line('<PARAMETER>');
    writeParam(out, p, paramNames[i]!, paramLanguage);
    out.line('</PARAMETER>');
  }
  if (added) {
    writeDefaultSubReport(out);
  }
  for (const s of tree) {
    out.line('<SUBREPORT>');
    const sp = s.subreport.props;
    out.str('NAME', s.subreport.name);
    out.str('ALIAS', sp.str('Alias', '').trim());
    const parentSub = find(sp.ref('ParentSubReport'));
    if (parentSub !== undefined) out.str('PARENTSUBREPORT', parentSub.name);
    const parentSec = find(sp.ref('ParentSection'));
    if (parentSec !== undefined) out.str('PARENTSECTION', parentSec.name);
    out.bool('PRINTONLYIFDATAAVAILABLE', sp.bool('PrintOnlyIfDataAvailable', true));
    out.bool('REOPENONPRINT', sp.bool('ReOpenOnPrint', true));
    for (const sec of s.sections) writeSection(out, sec.section, sec.components, find, bidiIndex, cleared);
    out.line('</SUBREPORT>');
  }
  for (const f of embeddedFiles(props.str('EmbeddedFiles', ''))) {
    out.line('<EMBEDDEDFILE>');
    out.str('FILENAME', f.fileName);
    out.str('MIMETYPE', f.mimeType);
    out.str('DESCRIPTION', f.description);
    out.str('CREATIONDATE', f.creationDate);
    out.str('MODIFICATIONDATE', f.modificationDate);
    out.int('RELATIONSHIP', f.relationship);
    out.binary('STREAM', f.content);
    out.line('</EMBEDDEDFILE>');
  }
  out.line('</REPORT>');
  return out.bytes();
}

function writeReportProps(out: XmlOut, p: Props, language: number): void {
  out.wide('WFONTNAME', p.str('WFontName', 'Arial'));
  out.wide('LFONTNAME', p.str('LFontName', 'Helvetica'));
  out.bool('GRIDVISIBLE', p.bool('GridVisible', true));
  out.bool('GRIDLINES', p.bool('GridLines', false));
  out.bool('GRIDENABLED', p.bool('GridEnabled', true));
  out.int('GRIDCOLOR', p.int('GridColor', 0xff0000));
  out.int('GRIDWIDTH', Math.max(10, p.int('GridWidth', 115)));
  out.int('GRIDHEIGHT', Math.max(10, p.int('GridHeight', 115)));
  out.int('PAGEORIENTATION', p.ord('PageOrientation', 0));
  out.int('PAGESIZE', p.ord('Pagesize', 0));
  out.int('PAGESIZEQT', p.int('PagesizeQt', 0));
  out.int('PAGEHEIGHT', p.int('PageHeight', 16837));
  out.int('PAGEWIDTH', p.int('PageWidth', 11906));
  out.int('CUSTOMPAGEHEIGHT', p.int('CustomPageHeight', 16837));
  out.int('CUSTOMPAGEWIDTH', p.int('CustomPageWidth', 11906));
  out.int('PAGEBACKCOLOR', p.int('PageBackColor', 0xffffff));
  out.int('PREVIEWSTYLE', p.ord('PreviewStyle', 0));
  out.bool('PREVIEWMARGINS', p.bool('PreviewMargins', false));
  out.int('PREVIEWWINDOW', p.ord('PreviewWindow', 0));
  out.int('LEFTMARGIN', p.int('LeftMargin', 574));
  out.int('TOPMARGIN', p.int('TopMargin', 574));
  out.int('RIGHTMARGIN', p.int('RightMargin', 574));
  out.int('BOTTOMMARGIN', p.int('BottomMargin', 861));
  out.int('PRINTERSELECT', p.ord('PrinterSelect', 0));
  out.int('LANGUAGE', language);
  out.int('COPIES', p.int('Copies', 1));
  out.bool('COLLATECOPIES', p.bool('CollateCopies', false));
  out.bool('TWOPASS', p.bool('TwoPass', false));
  out.int('PRINTERFONTS', p.ord('PrinterFonts', 0));
  out.bool('PRINTONLYIFDATAAVAILABLE', p.bool('PrintOnlyIfDataAvailable', false));
  // reptotxt -xml saves with StreamFormat = rpStreamXML
  p.ord('StreamFormat', 1);
  out.int('STREAMFORMAT', 3);
  const actions = p.set('ReportAction');
  out.bool('REPORTACTIONDRAWERBEFORE', actions.includes('rpDrawerBefore'));
  out.bool('REPORTACTIONDRAWERAFTER', actions.includes('rpDrawerAfter'));
  out.bool('PREVIEWABOUT', p.bool('PreviewAbout', true));
  out.int('TYPE1FONT', p.ord('Type1Font', 0));
  out.int('FONTSIZE', p.int('FontSize', 10));
  out.int('FONTROTATION', p.int('FontRotation', 0));
  out.int('FONTSTYLE', p.int('FontStyle', 0));
  out.int('FONTCOLOR', p.int('FontColor', 0));
  out.int('BACKCOLOR', p.int('BackColor', 0xffffff));
  out.bool('TRANSPARENT', p.bool('Transparent', true));
  out.bool('CUTTEXT', p.bool('CutText', false));
  out.int('ALIGNMENT', p.int('Alignment', 0));
  out.int('VALIGNMENT', p.int('VAlignment', 0));
  out.bool('WORDWRAP', p.bool('WordWrap', false));
  out.bool('SINGLELINE', p.bool('SingleLine', false));
  out.bool('MULTIPAGE', p.bool('MultiPage', false));
  out.int('PRINTSTEP', p.ord('PrintStep', 0));
  out.int('PAPERSOURCE', p.int('PaperSource', 0));
  out.int('DUPLEX', p.int('Duplex', 0));
  out.str('FORCEPAPERNAME', p.str('ForcePaperName', ''));
  out.int('LINESPERINCH', p.int('LinesPerInch', 600));
  out.int('PDFCONFORMANCE', p.ord('PDFConformance', 0));
  out.bool('PDFCOMPRESSED', p.bool('PDFCompressed', false));
  out.str('DOCAUTHOR', p.str('DocAuthor', ''));
  out.str('DOCCREATOR', p.str('DocCreator', ''));
  out.str('DOCPRODUCER', p.str('DocProducer', ''));
  out.str('DOCSUBJECT', p.str('DocSubject', ''));
  out.str('DOCTITLE', p.str('DocTitle', ''));
  out.str('DOCCREATIONDATE', p.str('DocCreationDate', ''));
  out.str('DOCMODIFICATIONDATE', p.str('DocModificationDate', ''));
  out.str('DOCKEYWORDS', p.str('DocKeywords', ''));
  out.str('DOCXMPCONTENT', p.str('DocXMPContent', ''));
}

function writeDatabaseInfo(out: XmlOut, p: Props, name: string): void {
  out.str('ALIAS', upper(p.str('Alias', '')));
  out.str('NAME', name);
  out.str('CONFIGFILE', p.str('ConfigFile', ''));
  out.bool('LOADPARAMS', p.bool('LoadParams', true));
  out.bool('LOADDRIVERPARAMS', p.bool('LoadDriverParams', true));
  out.bool('LOGINPROMPT', p.bool('LoginPrompt', false));
  out.int('DRIVER', p.ord('Driver', 0));
  out.str('REPORTTABLE', p.str('ReportTable', 'REPMAN_REPORTS'));
  out.str('REPORTSEARCHFIELD', p.str('ReportSearchField', 'REPORT_NAME'));
  out.str('REPORTFIELD', p.str('ReportField', 'REPORT'));
  out.str('REPORTGROUPSTABLE', p.str('ReportGroupsTable', 'REPMAN_GROUPS'));
  out.wide('ADOCONNECTIONSTRING', p.str('ADOConnectionString', ''));
  // Not in the DFM forms (public fields): their initial values
  out.int('DOTNETDRIVER', 0);
  out.str('PROVIDERFACTORY', '');
}

function writeDataInfo(out: XmlOut, p: Props, name: string): void {
  out.str('ALIAS', upper(p.str('Alias', '')));
  out.str('NAME', name);
  out.str('DATABASEALIAS', upper(p.str('DatabaseAlias', '')));
  out.wide('SQL', p.str('SQL', ''));
  const hub = p.int64('HubSchemaId', 0n);
  if (hub !== 0n) out.int('HUBSCHEMAID', hub);
  const schema = p.str('SchemaName', '');
  if (schema !== '') out.wide('SCHEMANAME', schema);
  out.str('DATASOURCE', upper(p.str('DataSource', '').trim()));
  out.str('MYBASEFILENAME', p.str('MyBaseFilename', ''));
  out.str('MYBASEFIELDS', p.str('MyBaseFields', ''));
  out.str('MYBASEINDEXFIELDS', p.str('MyBaseIndexFields', ''));
  out.str('MYBASEMASTERFIELDS', p.str('MyBaseMasterFields', ''));
  out.str('BDEINDEXFIELDS', p.str('BDEIndexFields', ''));
  out.str('BDEINDEXNAME', p.str('BDEIndexName', ''));
  out.str('BDETABLE', p.str('BDETable', ''));
  out.int('BDETYPE', p.ord('BDEType', 0));
  out.str('BDEFILTER', p.str('BDEFilter', ''));
  out.str('BDEMASTERFIELDS', p.str('BDEMasterFields', ''));
  out.str('BDEFIRSTRANGE', p.str('BDEFirstRange', ''));
  out.str('BDELASTRANGE', p.str('BDELastRange', ''));
  out.str('DATAUNIONS', text(p.lines('DataUnions')));
  out.bool('GROUPUNION', p.bool('GroupUnion', false));
  out.bool('OPENONSTART', p.bool('OpenOnStart', true));
  out.bool('PARALLELUNION', p.bool('ParallelUnion', false));
}

function writeParam(out: XmlOut, p: Props, intName: string, language: number): void {
  out.str('NAME', upper(p.str('Name', '')));
  out.str('INTNAME', intName);
  out.wide('DESCRIPTION', p.str('Description', ''));
  out.wide('HINT', p.str('Hint', ''));
  // GetLineLangByIndex: the line of the language, else the first one
  const errorLines = wideLines(p.str('ErrorMessage', ''));
  out.wide('ERRORMESSAGE', errorLines[language] ?? errorLines[0] ?? '');
  out.wide('VALIDATION', p.str('Validation', ''));
  out.wide('SEARCH', p.str('Search', ''));
  out.bool('VISIBLE', p.bool('Visible', true));
  out.bool('ISREADONLY', p.bool('IsReadOnly', false));
  out.bool('NEVERVISIBLE', p.bool('NeverVisible', false));
  out.bool('ALLOWNULLS', p.bool('AllowNulls', true));
  const paramType = p.ord('ParamType', 0);
  out.int('PARAMTYPE', paramType);
  out.str('DATASETS', text(p.lines('Datasets')));
  out.str('ITEMS', text(p.lines('Items')));
  out.str('VALUES', text(p.lines('Values')));
  out.str('SELECTED', text(p.lines('Selected')));
  out.str('LOOKUPDATASET', p.str('LookupDataset', ''));
  out.str('SEARCHDATASET', p.str('SearchDataset', ''));
  out.str('SEARCHPARAM', p.str('SearchParam', ''));
  writeParamValue(out, paramType, p.raw('Value'));
}

/** The subreport SaveToStream adds to a report without one (AddSubReport). */
function writeDefaultSubReport(out: XmlOut): void {
  out.line('<SUBREPORT>');
  out.str('NAME', 'TRpSubReport0');
  out.str('ALIAS', '');
  out.bool('PRINTONLYIFDATAAVAILABLE', true);
  out.bool('REOPENONPRINT', true);
  const empty = new Props([], 'TRpSection0', CLASSES.TRPSECTION!);
  writeSectionProps(out, { name: 'TRpSection0', className: 'TRPSECTION', props: empty }, 'TRpSubReport0', undefined, { width: 10772, height: 1701, type: 2 });
  out.line('</SECTION>');
  out.line('</SUBREPORT>');
}

function writeSection(
  out: XmlOut,
  section: Component,
  components: readonly Component[],
  find: (name: string | undefined) => Component | undefined,
  bidiIndex: number,
  cleared: ReadonlySet<Component>,
): void {
  const p = section.props;
  const sub = find(p.ref('SubReport'));
  const child = find(p.ref('ChildSubReport'));
  writeSectionProps(out, section, sub?.name, child?.name);
  for (const c of components) writeComponent(out, c, bidiIndex, cleared.has(c));
  out.line('</SECTION>');
}

function writeSectionProps(
  out: XmlOut,
  section: Component,
  subReport: string | undefined,
  childSubReport: string | undefined,
  created?: { width: number; height: number; type: number },
): void {
  const p = section.props;
  out.line('<SECTION>');
  out.str('NAME', section.name);
  out.int('WIDTH', clamp(p.int('Width', created?.width ?? 10772), 0, 86400));
  out.int('HEIGHT', clamp(p.int('Height', created?.height ?? 1701), 0, 86400));
  out.wide('PRINTCONDITION', p.str('PrintCondition', ''));
  out.wide('DOBEFOREPRINT', p.str('DoBeforePrint', ''));
  out.wide('DOAFTERPRINT', p.str('DoAfterPrint', ''));
  if (subReport !== undefined) out.str('SUBREPORT', subReport);
  out.str('GROUPNAME', p.str('GroupName', ''));
  out.wide('CHANGEEXPRESSION', p.str('ChangeExpression', ''));
  out.wide('BEGINPAGEEXPRESSION', p.str('BeginPageExpression', ''));
  if (p.bool('BeginPage', false)) out.bool('BEGINPAGE', true);
  out.wide('SKIPEXPREV', p.str('SkipExpreV', ''));
  out.wide('SKIPEXPREH', p.str('SkipExpreH', ''));
  out.wide('SKIPTOPAGEEXPRE', p.str('SkipToPageExpre', ''));
  out.wide('BACKEXPRESSION', p.str('BackExpression', ''));
  out.bool('CHANGEBOOL', p.bool('ChangeBool', false));
  out.bool('PAGEREPEAT', p.bool('PageRepeat', false));
  out.bool('FORCEPRINT', p.bool('FooterAtReportEnd', false));
  out.bool('SKIPPAGE', p.bool('SkipPage', false));
  out.bool('ALIGNBOTTOM', p.bool('AlignBottom', false));
  out.int('SECTIONTYPE', p.ord('SectionType', created?.type ?? 0));
  out.bool('AUTOEXPAND', p.bool('AutoExpand', false));
  out.bool('AUTOCONTRACT', p.bool('AutoContract', false));
  out.bool('HORZDESP', p.bool('HorzDesp', false));
  out.bool('VERTDESP', p.bool('VertDesp', false));
  out.str('EXTERNALFILENAME', p.str('ExternalFilename', ''));
  out.str('EXTERNALCONNECTION', p.str('ExternalConnection', ''));
  out.str('EXTERNALTABLE', p.str('ExternalTable', 'REPMAN_REPORTS'));
  out.str('EXTERNALFIELD', p.str('ExternalField', 'REPORT'));
  out.str('EXTERNALSEARCHFIELD', p.str('ExternalSearchField', 'REPORT_NAME'));
  out.str('EXTERNALSEARCHVALUE', p.str('ExternalSearchValue', ''));
  out.int('STREAMFORMAT', p.ord('StreamFormat', 1));
  if (childSubReport !== undefined) out.str('CHILDSUBREPORT', childSubReport);
  out.bool('SKIPRELATIVEH', p.bool('SkipRelativeH', false));
  out.bool('SKIPRELATIVEV', p.bool('SkipRelativeV', false));
  out.int('SKIPTYPE', p.ord('SkipType', 0));
  out.bool('ININUMPAGE', p.bool('IniNumPage', false));
  out.bool('GLOBAL', p.bool('Global', false));
  out.int('DPIRES', p.int('dpires', 100));
  out.int('CACHEDIMAGE', p.ord('CachedImage', 0));
  out.int('BACKSTYLE', p.ord('BackStyle', 0));
  out.int('DRAWSTYLE', p.ord('DrawStyle', 2));
  const stream = streamBytes(p.binary('Stream'), section.name);
  if (stream.length > 0) out.binary('STREAM', stream);
}

/** The initial size of each kind of print item (their constructors). */
const SIZE: Record<string, [number, number]> = {
  TRPLABEL: [1440, 275],
  TRPEXPRESSION: [1440, 275],
  TRPSHAPE: [500, 500],
  TRPIMAGE: [500, 500],
  TRPBARCODE: [0, 0],
  TRPCHART: [0, 0],
};

function writeComponent(out: XmlOut, c: Component, bidiIndex: number, identifierCleared: boolean): void {
  const p = c.props;
  const [w, h] = SIZE[c.className] ?? [0, 0];
  out.line('<COMPONENT>');
  out.str('NAME', c.name);
  out.str('CLASSNAME', c.className);
  out.int('WIDTH', clamp(p.int('Width', w), 0, 86400));
  out.int('HEIGHT', clamp(p.int('Height', h), 0, 86400));
  out.wide('PRINTCONDITION', p.str('PrintCondition', ''));
  out.wide('DOBEFOREPRINT', p.str('DoBeforePrint', ''));
  out.wide('DOAFTERPRINT', p.str('DoAfterPrint', ''));
  out.str('ANNOTATION', p.str('AnnotationExpression', ''));
  out.int('POSX', p.int('PosX', 0));
  out.int('POSY', p.int('PosY', 0));
  out.int('ALIGN', p.ord('Align', 0));
  const isText = c.className === 'TRPLABEL' || c.className === 'TRPEXPRESSION' || c.className === 'TRPCHART';
  if (isText) {
    out.wide('WFONTNAME', p.str('WFontName', 'Arial'));
    out.wide('LFONTNAME', p.str('LFontName', 'Helvetica'));
    const bidi = p.lines('BidiModes');
    const mode = bidi.length > bidiIndex ? bidi[bidiIndex] : undefined;
    const rightToLeft = mode === 'BidiPartial' || mode === 'BidiFull';
    out.int('BIDIMODE', rightToLeft ? 1 : 0);
    out.int('TYPE1FONT', p.ord('Type1Font', 0));
    out.int('FONTSIZE', p.int('FontSize', 10));
    out.int('FONTROTATION', p.int('FontRotation', 0));
    out.int('FONTSTYLE', p.int('FontStyle', 0));
    out.int('FONTCOLOR', p.int('FontColor', 0));
    out.int('BACKCOLOR', p.int('BackColor', 0xffffff));
    out.bool('TRANSPARENT', p.bool('Transparent', true));
    out.bool('CUTTEXT', p.bool('CutText', false));
    out.int('ALIGNMENT', p.int('Alignment', 0));
    out.int('VALIGNMENT', p.int('VAlignment', 0));
    out.int('INTERLINE', p.int('InterLine', 0));
    out.bool('WORDWRAP', p.bool('WordWrap', false));
    out.bool('WORDBREAK', p.bool('WordBreak', false));
    out.bool('SINGLELINE', p.bool('SingleLine', false));
    // NeedsBidiModes: a line other than the one implied by RightToLeft
    const needs = bidi.some((line, j) => line !== (j === bidiIndex && rightToLeft ? 'BidiPartial' : 'BidiNo'));
    if (needs) out.str('BIDIMODES', text(bidi));
    out.bool('MULTIPAGE', p.bool('MultiPage', false));
    out.int('PRINTSTEP', p.ord('PrintStep', 0));
    if (p.bool('IsHtml', false)) out.bool('ISHTML', true);
  }
  switch (c.className) {
    case 'TRPLABEL': {
      // TRpLabel.Loaded and UpdateWideText: AllText (old reports) wins; otherwise the lines of
      // WideText split at #10, the last one only when it is not empty
      const all = p.lines('AllText');
      let wide: string;
      if (all.length > 0) wide = all.join('\n');
      else {
        const parts = p.str('WideText', '').split('\n');
        if (parts[parts.length - 1] === '') parts.pop();
        wide = parts.join('\n');
      }
      out.wide('WIDETEXT', wide);
      break;
    }
    case 'TRPEXPRESSION':
      out.wide('EXPRESSION', p.str('Expression', ''));
      out.wide('AGINIVALUE', p.str('AgIniValue', '0'));
      out.wide('EXPORTEXPRESSION', p.str('ExportExpression', ''));
      out.int('DATATYPE', p.ord('DataType', 16));
      out.wide('DISPLAYFORMAT', p.str('DisplayFormat', ''));
      out.str('IDENTIFIER', identifierCleared ? '' : p.str('Identifier', ''));
      out.int('AGGREGATE', p.ord('Aggregate', 0));
      out.str('GROUPNAME', p.str('GroupName', ''));
      out.int('AGTYPE', p.ord('AgType', 0));
      out.bool('AUTOEXPAND', p.bool('AutoExpand', false));
      out.bool('AUTOCONTRACT', p.bool('AutoContract', false));
      out.bool('PRINTONLYONE', p.bool('PrintOnlyOne', false));
      out.bool('PRINTNULLS', p.bool('PrintNulls', true));
      out.wide('EXPORTDISPLAYFORMAT', p.str('ExportDisplayFormat', ''));
      out.int('EXPORTLINE', p.int('ExportLine', 0));
      out.int('EXPORTPOSITION', p.int('ExportPosition', 0));
      out.int('EXPORTSIZE', p.int('ExportSize', 1));
      out.bool('EXPORTDONEWLINE', p.bool('ExportDoNewLine', false));
      break;
    case 'TRPSHAPE':
      out.int('SHAPE', p.ord('Shape', 0));
      out.int('BRUSHSTYLE', p.int('BrushStyle', 0));
      out.int('BRUSHCOLOR', p.int('BrushColor', 0xffffff));
      out.int('PENSTYLE', p.int('PenStyle', 0));
      out.int('PENCOLOR', p.int('PenColor', 0));
      out.int('PENWIDTH', p.int('PenWidth', 0));
      break;
    case 'TRPIMAGE': {
      out.wide('EXPRESSION', p.str('Expression', ''));
      const stream = streamBytes(p.binary('Stream'), c.name);
      if (stream.length > 0) out.binary('STREAM', stream);
      out.int('ROTATION', p.int('Rotation', 0));
      out.int('DRAWSTYLE', p.ord('DrawStyle', 0));
      out.int('DPIRES', p.int('dpires', 100));
      out.int('COPYMODE', p.int('CopyMode', 10));
      out.int('CACHEDIMAGE', p.ord('CachedImage', 0));
      break;
    }
    case 'TRPCHART': {
      out.wide('VALUEEXPRESSION', p.str('ValueExpression', ''));
      out.wide('VALUEXEXPRESSION', p.str('ValueXExpression', ''));
      out.wide('GETVALUECONDITION', p.str('GetValueCondition', ''));
      out.wide('CHANGESERIEEXPRESSION', p.str('ChangeSerieExpression', ''));
      out.wide('CAPTIONEXPRESSION', p.str('CaptionExpression', ''));
      out.wide('COLOREXPRESSION', p.str('ColorExpression', ''));
      out.wide('SERIECOLOREXPRESSION', p.str('SerieColorExpression', ''));
      out.wide('SERIECAPTION', p.str('SerieCaption', ''));
      out.wide('CLEAREXPRESSION', p.str('ClearExpression', ''));
      const series = p.items('Series');
      if (series.length > 0) out.str('SERIESCOLORS', series.map((s) => String(s.int('Color', -1))).join(','));
      out.bool('CHANGESERIEBOOL', p.bool('ChangeSerieBool', false));
      out.int('CHARTTYPE', p.ord('ChartType', 0));
      out.wide('IDENTIFIER', identifierCleared ? '' : p.str('Identifier', ''));
      out.bool('CLEAREXPRESSIONBOOL', p.bool('ClearExpressionBool', false));
      out.int('DRIVER', p.ord('Driver', 0));
      out.bool('VIEW3D', p.bool('View3d', false));
      out.bool('VIEW3DWALLS', p.bool('View3dWalls', false));
      out.int('PERSPECTIVE', p.int('Perspective', 15));
      out.int('ELEVATION', p.int('Elevation', 345));
      out.int('ROTATION', p.int('Rotation', 345));
      out.int('ZOOM', p.int('Zoom', 100));
      out.int('HORZOFFSET', p.int('HorzOffset', 0));
      out.int('VERTOFFSET', p.int('VertOffset', 0));
      out.int('TILT', p.int('Tilt', 0));
      out.bool('ORTHOGONAL', p.bool('Orthogonal', true));
      out.int('MULTIBAR', p.ord('MultiBar', 1));
      out.int('RESOLUTION', p.int('Resolution', 100));
      out.bool('SHOWLEGEND', p.bool('ShowLegend', false));
      out.bool('SHOWHINT', p.bool('ShowHint', true));
      out.int('MARKSTYLE', p.int('MarkStyle', 0));
      out.int('HORZFONTSIZE', p.int('HorzFontSize', 0));
      out.int('VERTFONTSIZE', p.int('VertFontSize', 0));
      out.int('HORZFONTROTATION', p.int('HorzFontRotation', 0));
      out.int('VERTFONTROTATION', p.int('VertFontRotation', 0));
      const range = p.int('AutoRange', 0);
      out.int('AUTORANGE', range >= 0 && range <= 4 ? range : 0);
      out.double('YMIN', invariantFloat(p.str('YMin', ''), 'YMin'));
      out.double('YMAX', invariantFloat(p.str('YMax', ''), 'YMax'));
      break;
    }
    case 'TRPBARCODE': {
      out.wide('EXPRESSION', p.str('Expression', "'5449000000996'"));
      out.int('MODUL', Math.max(1, p.int('Modul', 10)));
      out.double('RATIO', barcodeRatio(p));
      out.int('TYP', p.ord('Typ', 15));
      out.bool('CHECKSUM', p.bool('Checksum', false));
      out.wide('DISPLAYFORMAT', p.str('DisplayFormat', ''));
      out.int('ROTATION', p.int('Rotation', 0));
      out.int('BCOLOR', p.int('BColor', 0));
      out.int('BACKCOLOR', p.int('BackColor', 0xffffff));
      out.bool('TRANSPARENT', p.bool('Transparent', false));
      out.int('NUMCOLUMNS', p.int('NumColumns', 0));
      out.int('NUMROWS', p.int('NumRows', 0));
      out.int('ECCLEVEL', clamp(p.int('ECCLevel', -1), -1, 8));
      out.bool('TRUNCATED', p.bool('Truncated', false));
      break;
    }
  }
  out.line('</COMPONENT>');
}

/** A float property of a barcode (Ratio): any number of the stream, 2 when absent. */
function barcodeRatio(p: Props): number {
  const v = p.raw('Ratio');
  if (v === undefined) return 2;
  switch (v.type) {
    case 'integer':
    case 'extended':
    case 'single':
    case 'double':
    case 'currency':
    case 'date':
      return v.value;
    default:
      throw new DfmError(`Error reading ${p.owner}.Ratio: Invalid property value`);
  }
}

/** StrToFloat with '.' of the YMin and YMax strings of a chart (0 when empty). */
function invariantFloat(s: string, name: string): number {
  if (s.length === 0) return 0;
  const n = Number(s.trim());
  if (s.trim().length === 0 || !Number.isFinite(n)) throw new DfmError(`'${s}' is not a valid floating point value (${name})`);
  return n;
}

/** The XML of a report in a DFM form: the bytes Delphi writes for it (reptotxt -xml). */
export function dfmToXml(bytes: Uint8Array): Uint8Array {
  return dfmTreeToXml(readDfm(bytes));
}
