// The hand-made DFM reports of @reportman/dfm (test/cases/*.rep): what the corpus does not have,
// written as an older Delphi or a hand would write them. test/generate-dfm-fixtures.mjs runs this
// and saves the XML Delphi writes for each one (test/cases/*.xml).
//
// values.rep is written in UTF-8 on purpose: its SQL is a wide string token (it has a code above
// 127, #8364), and Delphi takes each byte inside the quotes of such a token as one character
// (TParser.NextToken), not through the code page of the file.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), 'cases');
mkdirSync(out, { recursive: true });

const head = (extra = '') => `object TRpReport
${extra}`;

const section = (name, sub, comps, extra = '') => `  object ${name}: TRpSection
    Width = 10772
    Height = 1701
    SubReport = ${sub}
    ChangeBool = False
    PageRepeat = False
    SkipPage = False
    AlignBottom = False
    SectionType = rpsecdetail
    AutoExpand = False
    AutoContract = False
${extra}    Components = <${comps.map((c) => `
      item
        Component = ${c}
      end`).join('')}>
  end
`;

const label = (name, text, extra = '') => `  object ${name}: TRpLabel
    Width = 1440
    Height = 275
    PosX = 100
    PosY = 100
    Type1Font = poHelvetica
${extra}    WideText = ${text}
  end
`;

const expression = (name, identifier, extra = '') => `  object ${name}: TRpExpression
    Width = 1440
    Height = 275
    PosX = 200
    PosY = 200
    Type1Font = poHelvetica
    Identifier = '${identifier}'
    AutoExpand = False
    AutoContract = False
    ExportDoNewLine = False
${extra}    Expression = '1+1'
  end
`;

const subreport = (name, sections) => `  object ${name}: TRpSubReport
    Sections = <${sections.map((s) => `
      item
        Section = ${s}
      end`).join('')}>
  end
`;

const reportProps = (extra = '') => `  SubReports = <
    item
      SubReport = TRpSubReport0
    end>
  DataInfo = <>
  DatabaseInfo = <>
  Params = <>
  StreamFormat = rpStreamText
  ReportAction = []
  Type1Font = poHelvetica
${extra}`;

// 1. References: qualified names (old versions) find nothing, Owner.X is the report's X, the case
//    does not matter, a missing name is dropped; identifiers repeated (ignoring the case) are cleared
writeFileSync(
  join(out, 'references.rep'),
  head() +
    reportProps() +
    subreport('TRpSubReport0', ['TRpSection0']) +
    section('TRpSection0', 'TRpSubReport0', ['TRpLabel0', 'TRpSection0.TRpLabel1', 'Owner.TRpLabel2', 'TRPLABEL3', 'Nope', 'TRpExpression0', 'TRpExpression1', 'TRpChart0']) +
    label('TRpLabel0', "'zero'") +
    label('TRpLabel1', "'one'") +
    label('TRpLabel2', "'two'") +
    label('TRpLabel3', "'three'") +
    expression('TRpExpression0', 'Total') +
    expression('TRpExpression1', 'TOTAL') +
    `  object TRpChart0: TRpChart
    Width = 4000
    Height = 3000
    PosX = 0
    PosY = 0
    Type1Font = poHelvetica
    Identifier = 'total'
    Driver = rpchartdriverdefault
    Series = <
      item
        Color = 255
      end
      item
        Color = -1
      end>
    YMin = '-10.5'
    YMax = '100'
    AutoRange = 2
  end
` +
    'end\n',
);

// 2. Values: parameters of every type with every kind of value, the language of the lists, the
//    clamped properties, labels whose text ends in line feeds, the AllText of old versions,
//    BidiFull, non ASCII text in string and wide string fields, embedded files
const utf8 = (s) => Buffer.from(s, 'utf8');
const int32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n);
  return b;
};
const field = (s) => Buffer.concat([int32(utf8(s).length), utf8(s)]);
const blob = Buffer.concat([
  int32(2),
  field('a.txt'), field('text/plain'), field('First file'), field('20260101'), field(''), int32(2), int32(3), Buffer.from('abc'),
  field('empty.bin'), field('application/octet-stream'), field('Año'), field(''), field(''), int32(0), int32(0),
]);
const hex = blob.toString('hex').toUpperCase();
const hexLines = hex.match(/.{1,64}/g).map((l) => `'${l}'`).join(' +\n    ');
const param = (name, type, value, extra = '') => `    item
      Name = '${name}'
${value === undefined ? '' : `      Value = ${value}\n`}      ParamType = ${type}
${extra}    end`;
writeFileSync(
  join(out, 'values.rep'),
  head() +
    `  GridWidth = 5
  GridHeight = 7
  Language = 1
  SubReports = <
    item
      SubReport = TRpSubReport0
    end>
  DataInfo = <
    item
      Alias = 'dataset'
      DatabaseAlias = 'conn'
      SQL = 'select '#39'Ñ'#39', '#8364' from t'#13#10'where x = 1'
      DataSource = ' master '
      DataUnions.Strings = (
        'A'
        'B')
      HubSchemaId = 12345678901
      SchemaName = 'Ventas'
    end>
  DatabaseInfo = <
    item
      Alias = 'conn'
      LoadParams = True
      LoadDriverParams = True
      LoginPrompt = False
      Driver = rpdbHttp
      ReportTable = ''
      ADOConnectionString = 'Data Source=x.db'
    end>
  Params = <
${param('pstr', 'rpParamString', "'texto con '#241")}
${param('pnull', 'rpParamString', 'Null')}
${param('pabsent', 'rpParamString', undefined)}
${param('pnumtext', 'rpParamString', '1.500000000000000000')}
${param('pinttext', 'rpParamString', '42')}
${param('pbooltext', 'rpParamString', 'True')}
${param('pint', 'rpParamInteger', '-7')}
${param('pintabsent', 'rpParamInteger', undefined)}
${param('pintfromdouble', 'rpParamInteger', '2.500000000000000000')}
${param('pdouble', 'rpParamDouble', '3.250000000000000000')}
${param('pcurrency', 'rpParamCurrency', '12345678c')}
${param('psingle', 'rpParamDouble', '1.5s')}
${param('pdate', 'rpParamDate', '45351d')}
${param('pdatetime', 'rpParamDateTime', '45823.7708333333d')}
${param('ptime', 'rpParamTime', '0.5d')}
${param('pbool', 'rpParamBool', 'True')}
${param('pboolabsent', 'rpParamBool', undefined)}
${param('pmulti', 'rpParamMultiple', "'1,2'", `      Items.Strings = (
        'one'
        'two')
      Values.Strings = (
        '1'
        '2')
      Selected.Strings = (
        '0')
`)}
${param('plangs', 'rpParamString', "''", `      Description = 'English'#10'Espa'#241'ol'#10'Catal'#224
      Hint = 'h0'#10'h1'
      ErrorMessage = 'e0'#10#13'e1'#13#10'e2'
      Validation = 'v'
      Search = 's'
      Visible = False
      IsReadOnly = True
      NeverVisible = True
      AllowNulls = False
      Datasets.Strings = (
        'DATASET')
`)}>
  StreamFormat = rpStreamText
  ReportAction = [rpDrawerAfter]
  Type1Font = poCourier
  DocTitle = 'T'#237'tulo '#8364' '#20013' '#256
  DocAuthor = 'Autor'
  WFontName = 'Arial '#20013
  EmbeddedFiles =
    ${hexLines}
` +
    subreport('TRpSubReport0', ['TRpSection0']) +
    section('TRpSection0', 'TRpSubReport0', ['TRpLabel0', 'TRpLabel1', 'TRpLabel2', 'TRpLabel3', 'TRpBarcode0', 'TRpShape0', 'TRpExpression0'], `    BeginPage = True
    GroupName = 'g1'
`) +
    label('TRpLabel0', "'two lines'#10#10", `    Width = 100000
    BidiModes.Strings = (
      'BidiNo'
      'BidiNo'
      'BidiFull')
`) +
    label('TRpLabel1', "#10", `    BidiModes.Strings = (
      'BidiNo'
      'BidiPartial')
`) +
    label('TRpLabel2', "'ignored'", `    AllText.Strings = (
      'old one'
      'old two')
`) +
    label('TRpLabel3', "'Caf'#233' '#8364' '#20013#13#10'end'", `    IsHtml = True
`) +
    `  object TRpBarcode0: TRpBarcode
    Width = 2000
    Height = 600
    PosX = 0
    PosY = 0
    Modul = 0
    ECCLevel = 20
    Ratio = 3.500000000000000000
    Typ = bcCodeQr
    Expression = 'code'
  end
  object TRpShape0: TRpShape
    Width = 500
    Height = 500
    PosX = 0
    PosY = 0
    Shape = rpsEllipse
  end
` +
    expression('TRpExpression0', '', `    ExportSize = 20
    DataType = rpParamDouble
    DisplayFormat = '#,##0.00'
`) +
    'end\n',
);

// 3. A report without subreports: SaveToStream adds TRpSubReport0 with a detail section
writeFileSync(
  join(out, 'no-subreport.rep'),
  `object TRpReport
  SubReports = <>
  DataInfo = <>
  DatabaseInfo = <>
  Params = <>
  StreamFormat = rpStreamText
  ReportAction = []
  Type1Font = poHelvetica
end
`,
);

// 4. Raw Windows-1252 bytes inside the strings of a text DFM, as old versions of Delphi wrote them
const ansi = Buffer.from(
  head() +
    reportProps("  DocTitle = 'A\xf1o \x80 \x93quoted\x94'\n") +
    subreport('TRpSubReport0', ['TRpSection0']) +
    section('TRpSection0', 'TRpSubReport0', ['TRpLabel0']) +
    label('TRpLabel0', "'Ma\xf1ana \x80'") +
    'end\n',
  'latin1',
);
writeFileSync(join(out, 'legacy-ansi.rep'), ansi);
console.log('written');
