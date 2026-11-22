// The hand-made DFM reports of @reportman/dfm (test/cases/*.rep): what the corpus does not have,
// written as Delphi, an older Delphi or a hand would write them. test/generate-dfm-fixtures.mjs
// runs this and saves the XML Delphi writes for each one (test/cases/*.xml), or the message of
// Delphi for the ones it does not read as reports (invalid-*.rep, test/cases/*.error).
//
// values.rep is written in UTF-8 on purpose: its SQL is a wide string token (it has a code above
// 127, #8364), and Delphi takes each byte inside the quotes of such a token as one character
// (TParser.NextToken), not through the code page of the file.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

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

// A string as ObjectBinaryToText writes a vaWString or vaUTF8String (the strings of Reportman's
// WriteWideString, and the non ASCII ones of TWriter.WriteString): the printable ASCII quoted,
// every other UTF-16 code unit as #code, a line break ( +) every 64 code units
const delphiString = (w, indent = '      ') => {
  if (w.length === 0) return "''";
  const LineLength = 64;
  let out = w.length > LineLength ? '\r\n' + indent : '';
  let i = 0;
  let k = 0;
  const code = (j) => w.charCodeAt(j);
  while (i < w.length) {
    let lineBreak = false;
    if (code(i) >= 32 && code(i) !== 39 && code(i) <= 127) {
      const j = i;
      do i++;
      while (!(i >= w.length || code(i) < 32 || code(i) === 39 || i - k >= LineLength || code(i) > 127));
      if (i - k >= LineLength) lineBreak = true;
      out += "'" + w.slice(j, i) + "'";
    } else {
      out += '#' + code(i);
      i++;
      if (i - k >= LineLength) lineBreak = true;
    }
    if (lineBreak && i < w.length) {
      out += ' +\r\n' + indent;
      k = i;
    }
  }
  return out;
};

// 5. Unicode as Delphi writes it, in every kind of string: published strings (TWriter.WriteString:
//    vaUTF8String in the binary form) and the DefineProperties ones (WriteWideString: vaWString);
//    every script, emoji (a pair split by a line break), combining marks, control characters, a
//    lone surrogate kept (vaWString) and one that WriteString makes U+FFFD; the AnsiUpperCase of the
//    aliases and parameter names (µ, ß, ı and ǅ stay); identifiers repeated in other letters
const scripts =
  'Latin: Año café Ñandú Ærø Straße ÿ; cp1252: € “quoted” ‘single’ — – … ™ š Ÿ ‰; Greek: Ελληνικά; ' +
  'Cyrillic: Привет; Hebrew: שלום; Arabic: مرحبا; CJK: 中文 日本語 한국어; Thai: ภาษาไทย; Devanagari: हिन्दी';
const emoji = 'x'.repeat(63) + '😀 and 🎉 👨‍👩‍👧 🇪🇸 𝔸 e\u0301 \u00a0nbsp \u200bzwsp \ufeffbom \ufffd \uffff end';
const controls = "tab\tquote' hash# del\x7f soh\x01 us\x1f crlf\r\nlf\nend";
const u = delphiString;
// Delphi writes it in ASCII: every other character as a code
const ascii = (text) => {
  const other = /[^\x00-\x7f]/.exec(text);
  if (other !== null) throw new Error('not ASCII: ' + other[0]);
  return Buffer.from(text, 'latin1');
};
writeFileSync(
  join(out, 'unicode.rep'),
  ascii(head() +
    `  SubReports = <
    item
      SubReport = TRpSubReport0
    end>
  DataInfo = <
    item
      Alias = ${u('datos_añoµßıſÿǅǆﬁⅰⓐაꭰ')}
      DatabaseAlias = ${u('conexión')}
      SQL = ${u('select nombre, "año", \'€\' as moneda, \'中文 😀\' as texto from clientes\r\nwhere país = \'España\' and ciudad <> \'Zürich\'')}
      DataSource = ${u(' maestro_ñ ')}
    end
    item
      Alias = ${u('maestro_ñ')}
      DatabaseAlias = ${u('CONEXIÓN')}
      SQL = ${u('select 1')}
    end>
  DatabaseInfo = <
    item
      Alias = ${u('conexión')}
      LoadParams = True
      LoadDriverParams = True
      LoginPrompt = False
      Driver = rpdbHttp
      ReportTable = ''
      ADOConnectionString = ${u('Data Source=C:\\datos\\año\\informe€中文.db')}
    end>
  Params = <
    item
      Name = ${u('año_µß')}
      Value = ${u('valor 😀 ñ €')}
      ParamType = rpParamString
      Items.Strings = (
        ${u('uno ñ')}
        ${u('dos 中文')}
        ${u('tres 😀')})
      Description = ${u('Descripción'+ '\n' + 'Description 中文 😀')}
      Hint = ${u('Pista ñ')}
      ErrorMessage = ${u('Error: valor «inválido» €')}
      Validation = ${u("año<>''")}
      Search = ${u('búsqueda')}
    end>
  StreamFormat = rpStreamText
  ReportAction = []
  Type1Font = poHelvetica
  DocAuthor = ${u('Ærø Ñandú — José')}
  DocTitle = ${u(scripts, '    ')}
  DocSubject = ${u(emoji, '    ')}
  DocKeywords = ${u(controls)}
  DocCreator = ${u('A\ud83d')}
  DocProducer = ${u('AB\ud800')}
  WFontName = ${u('MS ゴシック')}
  LFontName = ${u('DejaVu Sans ñ')}
` +
    subreport('TRpSubReport0', ['TRpSection0']) +
    section('TRpSection0', 'TRpSubReport0', ['TRpLabel0', 'TRpLabel1', 'TRpLabel2', 'TRpLabel3', 'TRpLabel4', 'TRpExpression0', 'TRpExpression1', 'TRpExpression2', 'TRpExpression3', 'TRpChart0', 'TRpBarcode0'], `    GroupName = ${u('grupo_ñ')}
    ChangeExpression = ${u("país='España'")}
`) +
    label('TRpLabel0', u(scripts)) +
    label('TRpLabel1', u(emoji)) +
    label('TRpLabel2', u(controls)) +
    label('TRpLabel3', u('A\ud83d')) +
    label('TRpLabel4', u('AB\ud800 and \udc00 \ud83d\ude00'), `    WFontName = ${u('Noto Sans 中文')}
`) +
    expression('TRpExpression0', 'X', `    DisplayFormat = ${u('#,##0.00 €')}
    ExportDisplayFormat = ${u('0.00 ¤')}
`).replace("Expression = '1+1'", `Expression = ${u("'Año: ' + STR(1) + ' 😀'")}`).replace("'X'", u('Año')) +
    expression('TRpExpression1', 'X').replace("'X'", u('AÑO')) +
    expression('TRpExpression2', 'X').replace("'X'", u('µ')) +
    expression('TRpExpression3', 'X').replace("'X'", u('Μ')) +
    `  object TRpChart0: TRpChart
    Width = 4000
    Height = 3000
    PosX = 0
    PosY = 0
    Type1Font = poHelvetica
    Identifier = ${u('gráfico')}
    Driver = rpchartdriverdefault
    Series = <>
    SerieCaption = ${u('Serie ñ 中文')}
    CaptionExpression = ${u("'Título 😀'")}
  end
  object TRpBarcode0: TRpBarcode
    Width = 2000
    Height = 2000
    PosX = 0
    PosY = 0
    Typ = bcCodeQr
    Expression = ${u("'QR: año 中文 😀'")}
  end
` +
    'end\r\n'),
);

// 6. The grammar of TParser: every byte from 1 to 32 is a blank; # without digits is #0, #$ is
//    hexadecimal, a code wraps at 32 bits and keeps its low 16 bits; each fragment joined with +
//    is decoded on its own (\\x80 is the euro sign of Windows-1252 outside a wide string, U+0080
//    inside one); the f suffix, hexadecimal integers; one token after the end and then anything
const parserCase = Buffer.from(
  head() +
    reportProps(
      `  DocTitle =\x0c'A'#'B'#$41#$20ac#128512 +\x0b\x01\x1f'C'
  DocAuthor = '\x80 '#65 + '\x80'#8364
  DocSubject = 'it''s'#4294967361'x'
  GridColor = $00FF00
`,
    ) +
    subreport('TRpSubReport0', ['TRpSection0']) +
    section('TRpSection0', 'TRpSubReport0', ['TRpBarcode0']) +
    `  object TRpBarcode0: TRpBarcode
    Width = 2000\t\t
    Height = 600
    PosX = 0
    PosY = 0
    Ratio = 3.5f
    Typ = bcCode128
    Expression = 'code'
  end
` +
    "end\r\n\x1a\x0cgarbage 'and an unterminated string",
  'latin1',
);
writeFileSync(join(out, 'parser.rep'), parserCase);

// 7. What LoadFromStream does not take as a report (Invalid stream format), as it tells the form by
//    the first byte: a text DFM with a UTF-8 BOM, or with blanks before "object", and a text DFM
//    compressed with zlib. generate-dfm-fixtures.mjs keeps the message of Delphi (.error) and, for
//    the text ones, the XML that ObjectTextToBinary itself gives (.text.xml): with a BOM TParser
//    reads the bytes of a string as UTF-8, but inside a wide string (a code above 127) each byte is
//    one character; U+FEFF stays. Invalid UTF-8 after a BOM makes TEncoding.UTF8 raise (.text.error).
const bomText = Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]),
  Buffer.from(
    head() +
      reportProps(`  DocTitle = 'Año € 中文 😀 \ufeff'#13#10'raw'
  DocAuthor = 'Año'#8364
`) +
      subreport('TRpSubReport0', ['TRpSection0']) +
      section('TRpSection0', 'TRpSubReport0', ['TRpLabel0']) +
      label('TRpLabel0', "'Mañana ½ ' + 'wide '#8364' ñ'") +
      'end\r\n',
    'utf8',
  ),
]);
writeFileSync(join(out, 'invalid-bom.rep'), bomText);
writeFileSync(
  join(out, 'invalid-bom-utf8.rep'),
  Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(head() + reportProps("  DocTitle = 'Caf\xe9'\n") + subreport('TRpSubReport0', ['TRpSection0']) + section('TRpSection0', 'TRpSubReport0', []) + 'end\n', 'latin1'),
  ]),
);
const plainText = head() + reportProps() + subreport('TRpSubReport0', ['TRpSection0']) + section('TRpSection0', 'TRpSubReport0', []) + 'end\r\n';
writeFileSync(join(out, 'invalid-blank.rep'), Buffer.from(' \r\n' + plainText, 'latin1'));
writeFileSync(join(out, 'invalid-zlib-text.rep'), deflateSync(Buffer.from(plainText, 'latin1')));
console.log('written');
