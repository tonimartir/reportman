// The image decoding fixtures of images.test.ts: a report with every image of the catalogue
// (test/images/catalogue.mjs) embedded and stretched, run by golden-cs (PrintOutPDFStandard,
// uncompressed: SkiaSharp decodes what is not JPEG or BMP), and the image XObjects of its PDF
// (dictionary, data and soft mask) written to fixtures/images/decoded.json.
//
//   node packages/reportman-pdf/test/generate-image-fixtures.mjs     (from typescript/)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { catalogue } from './images/catalogue.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const golden = path.join(root, 'typescript/tools/golden-cs/bin/Release/net10.0/golden-cs.exe');
const out = path.join(here, 'fixtures/images');
fs.mkdirSync(out, { recursive: true });

const images = catalogue();
const names = Object.keys(images);
const components = names.map((name, i) => {
  const bytes = images[name];
  return `<COMPONENT>
<NAME type="String">TRpImage${i}</NAME>
<CLASSNAME type="String">TRPIMAGE</CLASSNAME>
<WIDTH type="Integer">500</WIDTH>
<HEIGHT type="Integer">500</HEIGHT>
<POSX type="Integer">${(i % 10) * 1000}</POSX>
<POSY type="Integer">${Math.floor(i / 10) * 700}</POSY>
<DRAWSTYLE type="Integer">1</DRAWSTYLE>
<DPIRES type="Integer">100</DPIRES>
<STREAM type="Binary" size="${bytes.length}">${Buffer.from(bytes).toString('hex').toUpperCase()}</STREAM>
</COMPONENT>`;
});
const rep = `<?xml version="1.0" standalone="no"?>
<!DOCTYPE REPORT_MANAGER_2>
<REPORT>
<PAGEORIENTATION type="Integer">1</PAGEORIENTATION>
<PAGESIZE type="Integer">1</PAGESIZE>
<PDFCOMPRESSED type="Boolean">False</PDFCOMPRESSED>
<SUBREPORT>
<NAME type="String">TRpSubReport0</NAME>
<SECTION>
<NAME type="String">TRpSection0</NAME>
<WIDTH type="Integer">10758</WIDTH>
<HEIGHT type="Integer">${Math.ceil(names.length / 10) * 700 + 200}</HEIGHT>
<SUBREPORT type="String">TRpSubReport0</SUBREPORT>
<SECTIONTYPE type="Integer">2</SECTIONTYPE>
${components.join('\n')}
</SECTION>
</SUBREPORT>
</REPORT>
`;
const repFile = path.join(out, 'catalogue.rep');
const pdfFile = path.join(out, 'catalogue.cs.pdf');
fs.writeFileSync(repFile, rep);
execFileSync(golden, ['run', repFile, path.join(out, 'catalogue.meta.json'), '--pdf', pdfFile]);
fs.unlinkSync(path.join(out, 'catalogue.meta.json'));

// The image XObjects of the PDF, in the order they were drawn (each image, then its soft mask)
const pdf = fs.readFileSync(pdfFile);
const src = pdf.toString('latin1');
const objects = [];
const re = /<< \/Type \/XObject\r\n([\s\S]*?)>>\r\nstream\r\n/g;
let m;
while ((m = re.exec(src))) {
  const dict = m[1];
  const start = m.index + m[0].length;
  const length = Number(/\/Length (\d+)/.exec(dict)[1]);
  // Without the object number of the mask and the image number, which depend on the report
  objects.push({ dict: dict.replace(/\/SMask \d+ +0 R/, '/SMask 0 R').replace(/\/Name \/Im\d+/, '/Name /Im'), data: pdf.subarray(start, start + length).toString('base64') });
}
const decoded = {};
let k = 0;
for (const name of names) {
  const image = objects[k++];
  const mask = /\/SMask/.test(image.dict) ? objects[k++] : null;
  decoded[name] = { image, mask };
}
fs.writeFileSync(path.join(out, 'decoded.json'), JSON.stringify(decoded, null, 1));
// The report and the PDF are made again from the catalogue: only the decoded images are kept
fs.unlinkSync(pdfFile);
fs.unlinkSync(repFile);
console.log(names.length + ' images, ' + objects.length + ' XObjects');
