// A shape with a clear pen and a clear brush paints nothing, as tests/FormasClearTest of the C#
// engine checks it in the PDF (the preview part is in reportman-canvas/test/canvas.test.ts): a
// shape item of a report, the page content of the uncompressed PDF holds no path operator. A
// visible control shape and hatched shapes with a clear pen prove the measure sees what is drawn.
// The C# PDFCanvas skipped the drawing only for BrushStyle 2, a slip from Delphi's rppdffile.pas
// (1, bsClear): a clear brush fell through to "S" and stroked the outline with the default pen.

import { describe, expect, it } from 'vitest';
import { BrushType, PenType, ShapeType } from '@reportman/lib';
import { PdfDevice } from '@reportman/pdf';
import { prepareReport } from '@reportman/engine';
import { addShape, detailOf, newReport } from './build-report.js';

/** The path-construction operators (m l c v re) of the uncompressed PDF of a report with one shape. */
async function pathOperators(shape: ShapeType, penStyle: PenType, brushStyle: BrushType): Promise<number> {
  const report = newReport({ width: 5000, height: 4000 });
  const s = detailOf(report);
  s.height = 3000;
  addShape(s, { posX: 500, posY: 500, width: 3000, height: 2000, shape, penStyle, brushStyle, penColor: 0, brushColor: 0, penWidth: 20 });
  const device = new PdfDevice({ compressed: false });
  const run = await prepareReport(report, { device });
  device.print(await run.execute());
  const pdf = Buffer.from(device.pdfBytes).toString('latin1');
  return (pdf.match(/^(-?[\d.]+ )+(m|l|c|v|re)\r?$/gm) ?? []).length;
}

const shapes = [
  ShapeType.Rectangle,
  ShapeType.Square,
  ShapeType.RoundRect,
  ShapeType.Ellipse,
  ShapeType.Circle,
  ShapeType.HorzLine,
  ShapeType.VertLine,
  ShapeType.Oblique1,
  ShapeType.Oblique2,
];

describe('a shape with a clear pen and a clear brush', () => {
  it('is seen by the measure when it is drawn: a solid outlined rectangle', async () => {
    expect(await pathOperators(ShapeType.Rectangle, PenType.Solid, BrushType.Clear)).toBeGreaterThan(0);
  });

  it.each(shapes.map((s) => [ShapeType[s], s] as const))('paints nothing in the PDF: %s', async (_name, shape) => {
    expect(await pathOperators(shape, PenType.Clear, BrushType.Clear)).toBe(0);
  });

  it('does not swallow the brush: a hatched rectangle and ellipse without outline are still filled', async () => {
    expect(await pathOperators(ShapeType.Rectangle, PenType.Clear, BrushType.Horizontal)).toBeGreaterThan(0);
    expect(await pathOperators(ShapeType.Ellipse, PenType.Clear, BrushType.Horizontal)).toBeGreaterThan(0);
  });
});
