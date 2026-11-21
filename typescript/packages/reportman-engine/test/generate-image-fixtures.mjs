// The image reports of image-parity.test.ts and their reference runs by the C# engine: XML
// reports with images embedded in every format (the image catalogue of reportman-pdf), every draw
// style and resolution, shared images, images from a blob column of samples.db (FISHES.GRAPHIC,
// JPEG), from a file and from IMAGEOP, compressed embedded images and section backgrounds; and
// fishes.rep without its chart. For each case golden-cs writes the metafile JSON and the
// uncompressed PDF into fixtures/images/ (or the error, NAME.error.txt), run from that folder so
// the image files of the expressions are found there.
//
//   node test/generate-image-fixtures.mjs      (from packages/reportman-engine)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { catalogue } from '../../reportman-pdf/test/images/catalogue.mjs';
import { bmp, png } from '../../reportman-pdf/test/images/encoders.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const exe = path.join(root, 'typescript/tools/golden-cs/bin/Release/net10.0/golden-cs.exe');
const db = path.join(root, 'samples/samples.db');
const out = path.join(here, 'fixtures/images');
fs.mkdirSync(out, { recursive: true });

// ---------------------------------------------------------------------------------------------
// XML writing (ReportWriter: every character but letters, digits and spaces as #code#)

function enc(value) {
  let r = '';
  for (const ch of String(value)) {
    const c = ch.codePointAt(0);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 32) r += ch;
    else r += '#' + c + '#';
  }
  return r;
}

function prop(name, value) {
  if (typeof value === 'boolean') return `<${name} type="Boolean">${value ? 'True' : 'False'}</${name}>`;
  if (typeof value === 'number') return `<${name} type="Integer">${value}</${name}>`;
  if (value instanceof Uint8Array) return `<${name} type="Binary" size="${value.length}">${Buffer.from(value).toString('hex').toUpperCase()}</${name}>`;
  return `<${name} type="WideString">${enc(value)}</${name}>`;
}

const props = (obj) =>
  Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => prop(k, v))
    .join('\n');

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
  DOCCREATOR: 'Report Manager', DOCPRODUCER: '', DOCSUBJECT: '', DOCTITLE: 'Images', DOCCREATIONDATE: '',
  DOCMODIFICATIONDATE: '', DOCKEYWORDS: '', DOCXMPCONTENT: '',
};

const database = () =>
  `<DATABASEINFO>\n${props({
    ALIAS: 'SAMPLES', NAME: 'TRpDatabaseInfoItem0', CONFIGFILE: '', LOADPARAMS: false, LOADDRIVERPARAMS: false,
    LOGINPROMPT: false, DRIVER: 8, REPORTTABLE: 'REPMAN_REPORTS', REPORTSEARCHFIELD: 'REPORT_NAME', REPORTFIELD: 'REPORT',
    REPORTGROUPSTABLE: 'REPMAN_GROUPS', ADOCONNECTIONSTRING: '', DOTNETDRIVER: 0, PROVIDERFACTORY: '',
  })}\n</DATABASEINFO>`;

const datainfo = (alias, sql) =>
  `<DATAINFO>\n${props({
    ALIAS: alias, NAME: 'TRpDataInfoItem' + alias, DATABASEALIAS: 'SAMPLES', SQL: sql, DATASOURCE: '',
    MYBASEFILENAME: '', MYBASEFIELDS: '', MYBASEINDEXFIELDS: '', MYBASEMASTERFIELDS: '', BDEINDEXFIELDS: '',
    BDEINDEXNAME: '', BDETABLE: '', BDETYPE: 0, BDEFILTER: '', BDEMASTERFIELDS: '', BDEFIRSTRANGE: '',
    BDELASTRANGE: '', DATAUNIONS: '', GROUPUNION: false, OPENONSTART: true, PARALLELUNION: false,
  })}\n</DATAINFO>`;

let compCount = 0;
const head = (cls, prefix, o) =>
  props({
    NAME: o.NAME ?? prefix + compCount++, CLASSNAME: cls, WIDTH: o.WIDTH ?? 1440, HEIGHT: o.HEIGHT ?? 275,
    PRINTCONDITION: o.PRINTCONDITION ?? '', DOBEFOREPRINT: o.DOBEFOREPRINT ?? '', DOAFTERPRINT: o.DOAFTERPRINT ?? '',
    ANNOTATION: o.ANNOTATION ?? '', POSX: o.POSX ?? 0, POSY: o.POSY ?? 0, ALIGN: o.ALIGN ?? 0,
  });

const TEXT_DEFAULTS = {
  WFONTNAME: 'Arial', LFONTNAME: 'Helvetica', BIDIMODE: 0, TYPE1FONT: 0, FONTSIZE: 8, FONTROTATION: 0,
  FONTSTYLE: 0, FONTCOLOR: 0, BACKCOLOR: 16777215, TRANSPARENT: true, CUTTEXT: false, ALIGNMENT: 0, VALIGNMENT: 0,
  INTERLINE: 0, WORDWRAP: false, WORDBREAK: false, SINGLELINE: false, MULTIPAGE: false, PRINTSTEP: 0,
};

/** An image item: STREAM (embedded bytes) or EXPRESSION, DRAWSTYLE, DPIRES, CACHEDIMAGE. */
function image(o = {}) {
  const { STREAM, EXPRESSION = '', DRAWSTYLE = 1, DPIRES = 100, CACHEDIMAGE = 0, ...h } = o;
  return `<COMPONENT>\n${head('TRPIMAGE', 'TRpImage', { WIDTH: 1500, HEIGHT: 1000, ...h })}\n${props({
    EXPRESSION, ROTATION: 0, DRAWSTYLE, DPIRES, COPYMODE: 10, CACHEDIMAGE, STREAM,
  })}\n</COMPONENT>`;
}

function label(text, o = {}) {
  return `<COMPONENT>\n${head('TRPLABEL', 'TRpLabel', o)}\n${props(TEXT_DEFAULTS)}\n${prop('WIDETEXT', text)}\n</COMPONENT>`;
}

function expr(expression, o = {}) {
  return `<COMPONENT>\n${head('TRPEXPRESSION', 'TRpExpression', o)}\n${props({
    ...TEXT_DEFAULTS, EXPRESSION: expression, AGINIVALUE: '0', EXPORTEXPRESSION: '', DATATYPE: 16, DISPLAYFORMAT: '',
    IDENTIFIER: '', AGGREGATE: 0, GROUPNAME: '', AGTYPE: 0, AUTOEXPAND: false, AUTOCONTRACT: false, PRINTONLYONE: false,
    PRINTNULLS: true, EXPORTDISPLAYFORMAT: '', EXPORTLINE: 0, EXPORTPOSITION: 0, EXPORTSIZE: 1, EXPORTDONEWLINE: false,
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
function subreport(alias, sections) {
  const name = 'TRpSubReport' + subCount++;
  return `<SUBREPORT>\n${props({ NAME: name, ALIAS: alias, PRINTONLYIFDATAAVAILABLE: true, REOPENONPRINT: true })}\n${sections
    .join('\n')
    .split(prop('SUBREPORT', '@SUB@'))
    .join(`<SUBREPORT type="String">${enc(name)}</SUBREPORT>`)}\n</SUBREPORT>`;
}

const cases = [];

function report(name, { data = [], subs = [] }) {
  const xml = `<?xml version="1.0" standalone="no"?>\n<!DOCTYPE REPORT_MANAGER_2>\n<REPORT>\n${props(REPORT_DEFAULTS)}\n${[
    database(),
    ...data,
    ...subs,
  ].join('\n')}\n</REPORT>\n`;
  fs.writeFileSync(path.join(out, name + '.rep'), xml);
  cases.push({ name, report: name + '.rep' });
  compCount = 0;
  secCount = 0;
  subCount = 0;
}

// ---------------------------------------------------------------------------------------------
// The images

const images = catalogue();
const fishes = new DatabaseSync(db, { readOnly: true }).prepare('SELECT SPECIES_NO, GRAPHIC FROM FISHES ORDER BY SPECIES_NO').all();
const jpeg = new Uint8Array(fishes.find((f) => f.SPECIES_NO === 90280).GRAPHIC);
const STYLES = { crop: 0, stretch: 1, full: 2, tile: 3, tiledpi: 4 };

// Every draw style for images of each format, in a section that grows with them (Full: the
// size of the image at its resolution, GraphicExtent, which is 0 x 0 for a PNG or a GIF)
const styleImages = {
  'png-rgba8': images['png-rgba8'],
  'png-pal4-trns': images['png-pal4-trns'],
  'png-i-rgba16': images['png-i-rgba16'],
  'gif-offset-transparent': images['gif-offset-transparent'],
  'bmp-24': images['bmp-24'],
  'bmp-32': images['bmp-32'],
  'bmp-8': images['bmp-8'],
  jpeg,
};
const styleRows = Object.entries(styleImages).map(([name, bytes], row) =>
  section('detail', { HEIGHT: 1300, AUTOEXPAND: true }, [
    label(name, { WIDTH: 1600, HEIGHT: 250 }),
    ...Object.values(STYLES).map((style, i) =>
      image({ STREAM: bytes, DRAWSTYLE: style, POSX: 1700 + i * 1800, POSY: 0, WIDTH: 1700, HEIGHT: 1200, DPIRES: 36 + row * 11 }),
    ),
    // A text after the tiles: the clipping of a tiled image stays (C# parity)
    label('after the tiles ' + name, { POSX: 0, POSY: 600, WIDTH: 1600 }),
  ]),
);
report('img-styles', {
  subs: [
    subreport('', [
      ...styleRows,
      section('detail', { HEIGHT: 2600 }, [
        image({ STREAM: jpeg, DRAWSTYLE: STYLES.full, DPIRES: 72, WIDTH: 4000, HEIGHT: 2500, ANNOTATION: "'URL:https://reportman.es'" }),
        image({ STREAM: images['bmp-24'], DRAWSTYLE: STYLES.full, DPIRES: 300, POSX: 4100, WIDTH: 3000, HEIGHT: 2000, ANNOTATION: "'A bitmap'" }),
        image({ STREAM: jpeg, DRAWSTYLE: STYLES.full, DPIRES: 0, POSX: 7200, WIDTH: 3000, HEIGHT: 2000 }),
        image({ STREAM: jpeg, DRAWSTYLE: 9, POSX: 7200, POSY: 2100, WIDTH: 1000, HEIGHT: 400 }),
      ]),
    ]),
  ],
});

// The whole catalogue (every color type, bit depth and the broken ones) stretched and cropped
report('img-catalogue', {
  subs: [
    subreport('', [
      section('detail', { HEIGHT: Math.ceil(Object.keys(images).length / 10) * 700 + 100 }, [
        ...Object.values(images).map((bytes, i) =>
          image({ STREAM: bytes, DRAWSTYLE: STYLES.stretch, POSX: (i % 10) * 1050, POSY: Math.floor(i / 10) * 700, WIDTH: 500, HEIGHT: 500 }),
        ),
      ]),
      section('detail', { HEIGHT: Math.ceil(Object.keys(images).length / 10) * 700 + 100 }, [
        ...Object.entries(images)
          .filter(([name]) => !/unknown|bad|no-plte|unknown-critical|not-enough|min-code|no-frame|565-trns|bmp-15/.test(name))
          .map(([, bytes], i) =>
            image({ STREAM: bytes, DRAWSTYLE: STYLES.crop, POSX: (i % 10) * 1050, POSY: Math.floor(i / 10) * 700, WIDTH: 900, HEIGHT: 500 }),
          ),
      ]),
    ]),
  ],
});

// Shared images over several pages: an embedded image shared (Fixed, Variable) and not (None),
// a zlib compressed one, and the images of a blob column (each fish twice in a row) with Variable
// (shared while equal) and Fixed (an expression image is stored again); measured (Full, in a
// section that grows) the expression is evaluated twice, which with Fixed stores the image again
const zpng = zlib.deflateSync(images['png-pal4-trns']);
report('img-shared', {
  data: [datainfo('FISH', 'SELECT F.SPECIES_NO, F.COMMON_NAME, F.GRAPHIC FROM FISHES F JOIN (SELECT 1 AS N UNION ALL SELECT 2) R WHERE F.SPECIES_NO <= 90080 ORDER BY F.SPECIES_NO, R.N')],
  subs: [
    subreport('FISH', [
      section('pageheader', { HEIGHT: 900 }, [
        image({ STREAM: images['png-ga8'], CACHEDIMAGE: 1, WIDTH: 800, HEIGHT: 800 }),
        image({ STREAM: images['png-ga8'], CACHEDIMAGE: 0, POSX: 1000, WIDTH: 800, HEIGHT: 800 }),
        image({ STREAM: images['gif-basic'], CACHEDIMAGE: 2, POSX: 2000, WIDTH: 800, HEIGHT: 800 }),
        image({ STREAM: zpng, CACHEDIMAGE: 1, POSX: 3000, WIDTH: 800, HEIGHT: 800 }),
        image({ STREAM: zpng, CACHEDIMAGE: 0, POSX: 4000, WIDTH: 800, HEIGHT: 800 }),
      ]),
      section('detail', { HEIGHT: 3600, AUTOEXPAND: true }, [
        expr('FISH.COMMON_NAME', { WIDTH: 3000 }),
        image({ EXPRESSION: 'FISH.GRAPHIC', CACHEDIMAGE: 2, DRAWSTYLE: STYLES.crop, POSY: 300, WIDTH: 3000, HEIGHT: 2000 }),
        image({ EXPRESSION: 'FISH.GRAPHIC', CACHEDIMAGE: 1, DRAWSTYLE: STYLES.stretch, POSX: 3200, POSY: 300, WIDTH: 2000, HEIGHT: 1500 }),
        image({ EXPRESSION: 'FISH.GRAPHIC', CACHEDIMAGE: 0, DRAWSTYLE: STYLES.full, DPIRES: 200, POSX: 5400, POSY: 300, WIDTH: 2000, HEIGHT: 1500 }),
        image({ EXPRESSION: 'FISH.GRAPHIC', CACHEDIMAGE: 1, DRAWSTYLE: STYLES.full, DPIRES: 300, POSX: 7600, POSY: 300, WIDTH: 1500, HEIGHT: 1000 }),
        image({ EXPRESSION: 'FISH.GRAPHIC', CACHEDIMAGE: 2, DRAWSTYLE: STYLES.full, DPIRES: 400, POSX: 7600, POSY: 1400, WIDTH: 1500, HEIGHT: 1000 }),
      ]),
    ]),
  ],
});

// Section backgrounds: embedded (plain and zlib compressed), shared, from a blob column, every
// background style (Preview: preview only, also drawn in the PDF) and draw style; a section
// with a background style and no image prints no items (C# parity)
const zbmp = zlib.deflateSync(bmp(20, 12, 24, (x, y) => [x * 12, y * 20, 100]));
report('img-background', {
  data: [datainfo('FISH', 'SELECT SPECIES_NO, COMMON_NAME, GRAPHIC FROM FISHES WHERE SPECIES_NO <= 90070 ORDER BY SPECIES_NO')],
  subs: [
    subreport('FISH', [
      section('pageheader', { HEIGHT: 1200, BACKSTYLE: 2, DRAWSTYLE: STYLES.stretch, STREAM: images['png-rgb8'], CACHEDIMAGE: 1 }, [
        label('Page header over a stretched shared background', { WIDTH: 6000 }),
      ]),
      section('detail', { HEIGHT: 2500, BACKSTYLE: 1, DRAWSTYLE: STYLES.full, DPIRES: 96, BACKEXPRESSION: 'FISH.GRAPHIC', CACHEDIMAGE: 2 }, [
        expr('FISH.COMMON_NAME', { POSX: 6000, WIDTH: 3000 }),
      ]),
      section('detail', { HEIGHT: 900, BACKSTYLE: 2, DRAWSTYLE: STYLES.tile, STREAM: zbmp }, [label('Tiled compressed bitmap', { WIDTH: 4000 })]),
      section('detail', { HEIGHT: 600, BACKSTYLE: 2, DRAWSTYLE: STYLES.crop, STREAM: images['gif-basic'] }, [label('Cropped GIF', { WIDTH: 4000 })]),
      section('detail', { HEIGHT: 400, BACKSTYLE: 2 }, [label('Never printed: no background image', { WIDTH: 4000 })]),
      section('pagefooter', { HEIGHT: 700, BACKSTYLE: 0, STREAM: images['bmp-8'] }, [label('Design background, not printed', { WIDTH: 4000 })]),
    ]),
  ],
});

// IMAGEOP: the images of a blob column drawn by an expression in every draw style, preview only
// or not, with an unknown draw style (nothing drawn), and an image from a file
fs.writeFileSync(path.join(out, 'img-file.png'), png(12, 8, 6, 8, (x, y) => [x * 20, y * 30, 200, 120 + x * 10]));
report('img-imageop', {
  data: [datainfo('FISH', 'SELECT SPECIES_NO, GRAPHIC FROM FISHES WHERE SPECIES_NO <= 90050 ORDER BY SPECIES_NO')],
  subs: [
    subreport('FISH', [
      section('detail', { HEIGHT: 2000 }, [
        expr("IMAGEOP(CURRENTPOSY, 0, 2000, 1500, 1, 100, FALSE, 'FISH.GRAPHIC')", { POSX: 9000, WIDTH: 1500 }),
        expr("IMAGEOP(CURRENTPOSY, 2100, 2000, 1500, 0, 100, TRUE, 'FISH.GRAPHIC')", { POSX: 9000, POSY: 300, WIDTH: 1500 }),
        expr("IMAGEOP(CURRENTPOSY, 4200, 2000, 1500, 3, 100, FALSE, 'FISH.GRAPHIC')", { POSX: 9000, POSY: 600, WIDTH: 1500 }),
        expr("IMAGEOP(CURRENTPOSY, 6300, 1000, 800, 7, 100, FALSE, 'FISH.GRAPHIC')", { POSX: 9000, POSY: 900, WIDTH: 1500 }),
        image({ EXPRESSION: "'img-file.png'", DRAWSTYLE: STYLES.stretch, POSX: 6300, POSY: 900, WIDTH: 1200, HEIGHT: 800 }),
      ]),
    ]),
  ],
});

// Crop asks Skia for the size: a 15 bit bitmap (which the PDF writer reads) and bytes that are
// no image fail there (NullReferenceException)
report('img-crop-bmp15', {
  subs: [subreport('', [section('detail', { HEIGHT: 1000 }, [image({ STREAM: images['bmp-15'], DRAWSTYLE: STYLES.crop })])])],
});
report('img-crop-unknown', {
  subs: [subreport('', [section('detail', { HEIGHT: 1000 }, [image({ STREAM: images['unknown'], DRAWSTYLE: STYLES.crop })])])],
});

// An image file that is not there
report('img-file-missing', {
  subs: [subreport('', [section('detail', { HEIGHT: 1000 }, [image({ EXPRESSION: "'no-such-image.png'" })])])],
});

// fishes.rep without its chart (charts are not ported): the JPEG images of FISHES.GRAPHIC (Full)
{
  const src = fs.readFileSync(path.join(root, 'samples/fishes.rep'), 'latin1');
  const i = src.indexOf('<CLASSNAME type="String">TRPCHART</CLASSNAME>');
  const a = src.lastIndexOf('<COMPONENT>', i);
  const b = src.indexOf('</COMPONENT>', i) + '</COMPONENT>'.length;
  fs.writeFileSync(path.join(out, 'img-fishes.rep'), src.slice(0, a) + src.slice(b).replace(/^\r?\n/, ''), 'latin1');
  cases.push({ name: 'img-fishes', report: 'img-fishes.rep' });
}

fs.writeFileSync(path.join(out, 'cases.json'), JSON.stringify(cases, null, 1) + '\n');

// ---------------------------------------------------------------------------------------------
// The reference runs

for (const c of cases) {
  const meta = path.join(out, c.name + '.meta.json');
  const pdf = path.join(out, c.name + '.cs.pdf');
  const errFile = path.join(out, c.name + '.error.txt');
  for (const f of [meta, pdf, errFile]) if (fs.existsSync(f)) fs.unlinkSync(f);
  const r = spawnSync(exe, ['run', c.report, c.name + '.meta.json', '--pdf', c.name + '.cs.pdf', '--sqlite', db], { encoding: 'utf8', cwd: out });
  if (r.status !== 0) {
    const first = (r.stderr || r.stdout).split(/\r?\n/)[0];
    fs.writeFileSync(errFile, first);
    for (const f of [meta, pdf]) if (fs.existsSync(f)) fs.unlinkSync(f);
    console.log(c.name + ': ' + first);
  } else {
    fs.writeFileSync(meta, JSON.stringify(JSON.parse(fs.readFileSync(meta, 'utf8'))));
    console.log(c.name + ': ' + r.stdout.trim() + ', ' + fs.statSync(pdf).size + ' bytes');
  }
}
