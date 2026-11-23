// Images in the PDF: each image of the catalogue embedded as the C# device embeds it (the
// XObjects golden-cs wrote, fixtures/images/decoded.json, see generate-image-fixtures.mjs), and
// what the C# code does around them: JPEG passthrough, shared images, soft masks, compression,
// GraphicExtent, and the formats that are not ported.

import fs from 'node:fs';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ImageDrawStyleType, MetaFile, MetaPage, OrientationType } from '@reportman/metafile';
import {
  BitmapFormatError,
  ImageFormatNotSupportedError,
  PdfDevice,
  PngIncompleteError,
  bitmapInfoOf,
  cropSizeOf,
  decodeImage,
  renderPdf,
} from '@reportman/pdf';
import { catalogue } from './images/catalogue.mjs';
import { bmp, png } from './images/encoders.mjs';
import { contentStreams } from './pdftools.js';

const fixtures = new URL('./fixtures/images/', import.meta.url);

interface XObject {
  dict: string;
  data: string;
}

/** The image XObjects of an uncompressed PDF, without their mask object number and image number. */
function xobjects(pdf: Uint8Array): XObject[] {
  const buf = Buffer.from(pdf);
  const src = buf.toString('latin1');
  const result: XObject[] = [];
  const re = /<< \/Type \/XObject\r\n([\s\S]*?)>>\r\nstream\r\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const dict = m[1] as string;
    const start = m.index + m[0].length;
    const length = Number((/\/Length (\d+)/.exec(dict) as RegExpExecArray)[1]);
    result.push({
      dict: dict.replace(/\/SMask \d+ +0 R/, '/SMask 0 R').replace(/\/Name \/Im\d+/, '/Name /Im'),
      data: buf.subarray(start, start + length).toString('base64'),
    });
  }
  return result;
}

function imageMeta(images: { data: Uint8Array; style?: ImageDrawStyleType; shared?: boolean; x?: number; w?: number; h?: number; dpi?: number }[]): MetaFile {
  const meta = new MetaFile();
  meta.customX = 11906;
  meta.customY = 16838;
  meta.orientation = OrientationType.Portrait;
  const page = new MetaPage(meta);
  meta.pages.add(page);
  let sharedPos = -1;
  images.forEach((im, i) => {
    const obj = page.drawImage(im.x ?? 1000, 1000 + i * 600, im.w ?? 500, im.h ?? 500, im.style ?? ImageDrawStyleType.Stretch, im.dpi ?? 100, im.data);
    if (im.shared) {
      if (sharedPos < 0) sharedPos = page.addStream(im.data, true);
      obj.sharedImage = true;
      obj.streamPos = sharedPos;
    }
  });
  return meta;
}

const fixedClock = { now: () => new Date(Date.UTC(2026, 10, 21, 0, 31, 17)), offsetMinutes: () => 60 };

describe('image decoding parity with golden-cs (SkiaSharp decodes what is not JPEG or BMP)', () => {
  const decoded = JSON.parse(fs.readFileSync(new URL('decoded.json', fixtures), 'utf8')) as Record<string, { image: XObject; mask: XObject | null }>;
  const images = catalogue() as Record<string, Uint8Array>;
  it.each(Object.keys(images))('%s', (name) => {
    const pdf = renderPdf(imageMeta([{ data: new Uint8Array(images[name]!) }]), { clock: fixedClock });
    const objects = xobjects(pdf);
    const image = objects[0]!;
    const mask = /\/SMask/.test(image.dict) ? (objects[1] as XObject) : null;
    expect({ image, mask }).toEqual(decoded[name]);
  });
});

// A JPEG header: SOI, APP0, a SOF0 of 3 x 2 and the start of scan (passed through, not decoded)
const jpeg = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 2, 0, 3, 1, 1,
  0x11, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0xff, 0xd9,
]);

describe('images in the PDF', () => {
  it('passes a JPEG through with /DCTDecode and /DeviceRGB', () => {
    const pdf = renderPdf(imageMeta([{ data: jpeg }]), { clock: fixedClock });
    const [image] = xobjects(pdf);
    expect(image!.dict).toBe(
      '/Subtype /Image\r\n/Width 3\r\n/Height 2\r\n/ColorSpace /DeviceRGB\r\n/BitsPerComponent 8\r\n/Name /Im\r\n/Length 47\r\n/Filter [/DCTDecode]\r\n',
    );
    expect(Buffer.from(image!.data, 'base64')).toEqual(Buffer.from(jpeg));
  });

  it('writes a shared image once, and its soft mask as the next object, not in the resources', () => {
    const pixels = png(2, 2, 6, 8, (x, y) => [x * 100, y * 100, 50, 128]);
    const pdf = renderPdf(imageMeta([{ data: pixels, shared: true }, { data: pixels, shared: true }]), { clock: fixedClock });
    const src = Buffer.from(pdf).toString('latin1');
    expect(xobjects(pdf)).toHaveLength(2);
    expect(Buffer.from(contentStreams(pdf)[0]!).toString('latin1').match(/\/Im1 Do/g)).toHaveLength(2);
    const smask = /\/SMask (\d+) +0 R/.exec(src) as RegExpExecArray;
    expect(src).toContain('\r\n' + smask[1] + ' 0 obj\r\n<< /Type /XObject\r\n/Subtype /Image\r\n/Width 2\r\n/Height 2\r\n/ColorSpace /DeviceGray');
    expect(src).toMatch(/\/XObject << \r\n\/Im1 \d+ 0 R\r\n>>/);
    expect(src).not.toContain('/Im2 ');
  });

  it('compresses the image streams with Flate, the length written over its placeholder', () => {
    const pixels = png(3, 2, 6, 8, (x, y) => [x * 80, y * 90, 40, 200]);
    const plain = xobjects(renderPdf(imageMeta([{ data: pixels }]), { clock: fixedClock }));
    const pdf = Buffer.from(renderPdf(imageMeta([{ data: pixels }]), { clock: fixedClock, compressed: true }));
    const src = pdf.toString('latin1');
    const re = /<< \/Type \/XObject\r\n[\s\S]*?\/Length (\d+) +\r\n\/Filter \[\/FlateDecode\]\r\n>>\r\nstream\r\n/g;
    const inflated: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      expect(m[0]).toContain('/Length ' + m[1] + ' '.repeat(13 - m[1]!.length) + '\r\n');
      const start = m.index + m[0].length;
      inflated.push(zlib.inflateSync(pdf.subarray(start, start + Number(m[1]))).toString('base64'));
    }
    expect(inflated).toEqual(plain.map((x) => x.data));
  });

  it('centers an image of its own size (Full) and tiles it (Tile) clipped to the rectangle', () => {
    const pixels = bmp(30, 20, 24, () => [1, 2, 3]);
    const full = Buffer.from(contentStreams(renderPdf(imageMeta([{ data: pixels, style: ImageDrawStyleType.Full, w: 1000, h: 1000, dpi: 100 }]), { clock: fixedClock }))[0]!).toString('latin1');
    // 30 x 20 pixels at 100 dpi are 432 x 288 twips, centered in 1000 x 1000
    expect(full).toContain('q\r\nq\r\n1 0 0 1 64.20 759.70 cm\r\n21.60 0 0  14.40 0 0 cm\r\n/Im1 Do\r\nQ\r\n');
    // Tiles of 600 x 400 twips (72 dpi), centered in 1500 x 900 as one tile is smaller. C# parity:
    // the clipping takes width and height as right and bottom, a tile is drawn while its left is
    // not past the width of the (centered) rectangle plus a tile, the second one scaled by its left
    const tile = (x: number): string =>
      Buffer.from(
        contentStreams(renderPdf(imageMeta([{ data: pixels, style: ImageDrawStyleType.Tile, x, w: 1500, h: 900 }]), { clock: fixedClock }))[0]!,
      ).toString('latin1');
    expect(tile(0)).toContain('q\r\n22.50 779.40 7.50 42.50 re\r\nh\r\nW\r\nn\r\n');
    expect(tile(0).match(/\/Im1 Do/g)).toHaveLength(2);
    expect(tile(0)).toContain('1 0 0 1 52.50 759.40 cm\r\n52.50 0 0  20.00 0 0 cm\r\n');
    expect(tile(5000).match(/\/Im1 Do/g)).toHaveLength(1);
  });

  it('measures JPEG and BMP sizes (GraphicExtent); other formats are 0 x 0, as in C#', () => {
    const device = new PdfDevice();
    expect(device.graphicExtent(jpeg, { x: 9, y: 9 }, 96)).toEqual({ x: 45, y: 30 });
    expect(device.graphicExtent(bmp(7, 5, 24, () => [0, 0, 0]), { x: 9, y: 9 }, 100)).toEqual({ x: 101, y: 72 });
    expect(device.graphicExtent(png(7, 5, 2, 8, () => [0, 0, 0]), { x: 9, y: 9 }, 100)).toEqual({ x: 0, y: 0 });
    expect(device.graphicExtent(jpeg, { x: 9, y: 8 }, 0)).toEqual({ x: 9, y: 8 });
  });

  it('gives the size Skia decodes to the Crop draw style, and none where Skia decodes nothing', () => {
    expect(bitmapInfoOf(png(7, 5, 0, 8, () => [0]))).toEqual({ width: 7, height: 5 });
    expect(bitmapInfoOf(jpeg)).toEqual({ width: 3, height: 2 });
    expect(cropSizeOf(jpeg)).toEqual({ width: 3, height: 2 });
    // Bytes that are no image: no size to fit (it was the NullReferenceException of C#), and the
    // PDF draws them as the stretch style does
    expect(cropSizeOf(new Uint8Array([1, 2, 3]))).toBeNull();
    const crop = imageMeta([{ data: new Uint8Array([1, 2, 3]), style: ImageDrawStyleType.Crop }]);
    const stretch = imageMeta([{ data: new Uint8Array([1, 2, 3]), style: ImageDrawStyleType.Stretch }]);
    const render = (meta: typeof crop): string | Uint8Array => {
      try {
        return renderPdf(meta, { clock: fixedClock });
      } catch (e) {
        return String(e);
      }
    };
    expect(render(crop)).toEqual(render(stretch));
  });

  it('fails clearly for the formats Skia decodes that are not ported', () => {
    const webp = new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8 ')]);
    expect(() => decodeImage(webp)).toThrow(ImageFormatNotSupportedError);
    expect(() => decodeImage(new Uint8Array([0, 0, 1, 0, 1, 0]))).toThrow(/ICO and CUR/);
    expect(() => decodeImage(new Uint8Array([0, 0, 4, 3, 0]))).toThrow(/WBMP/);
    const hugeHeader = Buffer.from(bmp(1, 1, 24, () => [0, 0, 0]));
    hugeHeader.writeUInt32LE(40000, 14);
    expect(() => renderPdf(imageMeta([{ data: hugeHeader }]), { clock: fixedClock })).toThrow(/more than 32000 bytes/);
    // Bytes nothing decodes: no image (0 x 0), as SKBitmap.Decode gives null
    expect(decodeImage(new Uint8Array([9, 9, 9]))).toBeNull();
  });

  it('fails as BitmapUtil does for a bitmap it cannot read, and for a truncated interlaced PNG', () => {
    const twoBits = Buffer.from(bmp(4, 1, 8, () => 0, [[0, 0, 0]]));
    twoBits.writeUInt16LE(2, 28);
    expect(() => renderPdf(imageMeta([{ data: twoBits }]), { clock: fixedClock })).toThrow(new BitmapFormatError('Bad bitcount in GetBitmapInfo'));
    const topDown = Buffer.from(bmp(4, 2, 24, () => [0, 0, 0]));
    topDown.writeInt32LE(-2, 22);
    expect(() => renderPdf(imageMeta([{ data: topDown }]), { clock: fixedClock })).toThrow(BitmapFormatError);
    const interlaced = png(20, 20, 2, 8, (x, y) => [x, y, 0], { interlace: true });
    expect(() => decodeImage(interlaced.subarray(0, interlaced.length - 40))).toThrow(PngIncompleteError);
  });
});
