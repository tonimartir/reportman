// Port of Reportman.Drawing.VectorChart (VectorChart.cs): a chart drawn into a metafile page with
// draw and text objects only, what PrintOut.DrawChart does in C# for a device without a chart
// support of its own (the PDF devices among them). Bars, horizontal bars, lines, points and areas
// are drawn natively; every other chart type (pie, radar, bubble...) is drawn as bars, with the
// grid, value labels, axes, point captions and the legend.
//
// C# parity: the numbers of the value axis are formatted with the current culture (the culture
// of the run when the chart prints, which follows the report language), int arithmetic wraps
// around and Math.Abs of Int32.MinValue throws, as in C#.

import {
  AlignmentFlags,
  BrushType,
  MetaObjectDraw,
  MetaObjectText,
  MetaObjectType,
  PDFFontType,
  PenType,
  PrintStepType,
  ShapeType,
  type MetaFile,
  type MetaPage,
} from '@reportman/metafile';
import { AutoRangeAxis, ChartType } from '@reportman/lib';
import type { CultureInfo } from '../../util/culture.js';
import { NetException } from '../../util/netexception.js';
import { formatDouble } from '../../util/numberformat.js';
import { castInt32, i32, idiv, mathRound } from '../barcode/netutil.js';
import type { Series, SeriesItem } from './series.js';

/** The same palette the GDI driver uses, as Report Manager colours (BGR). */
export const VECTOR_CHART_SERIES_COLORS: readonly number[] = [
  0xff0000, 0xff22ff, 0x00ff00, 0x0000ff, 0xff9800, 0x00bcd4, 0x9c27b0, 0xffc107, 0x4caf50, 0x795548, 0x03a9f4,
  0xe91e63, 0x607d8b, 0x009688, 0xff5722, 0x8bc34a, 0x3f51b5, 0xcddc39, 0x9e9e9e, 0x673ab7, 0xa1887f,
];
const TWIPS_PER_POINT = 20;
const GRID_COLOR = 0xd0d0d0;
const AXIS_COLOR = 0x606060;
const WHITE = 0xffffff;
const DOUBLE_MAX = Number.MAX_VALUE;

/** What the chart texts are written with, read from the chart item. */
interface Style {
  fontName: string;
  /** A C# short. */
  fontSize: number;
  fontColor: number;
  type1Font: PDFFontType;
}

/** (int)Math.Round(value): half to even, then the saturating cast of .NET. */
function roundInt(value: number): number {
  return castInt32(mathRound(value));
}

/** Math.Abs(int): OverflowException for Int32.MinValue. */
function absInt(value: number): number {
  if (value === -2147483648) throw new NetException('OverflowException', 'Negating the minimum value of a twos complement number is invalid.');
  return Math.abs(value);
}

/**
 * Draws the series at the given position (twips) with the size the chart item printed with
 * (VectorChart.Draw).
 *
 * @param series The accumulated series of the chart.
 * @param metafile The metafile that receives the objects, on its current page.
 * @param posx Left of the chart, in twips.
 * @param posy Top of the chart, in twips.
 * @param chart The chart item (a text item): its font is used for the labels.
 * @param culture The current culture, for the numbers of the value axis.
 */
export function drawVectorChart(
  series: Series | null,
  metafile: MetaFile,
  posx: number,
  posy: number,
  chart: unknown,
  culture: CultureInfo,
): void {
  if (series === null || series.seriesItems.length === 0 || series.printWidth <= 0 || series.printHeight <= 0) return;
  const page = metafile.pages.get(metafile.currentPage);
  const style = readStyle(chart, series);
  const lineHeight = roundInt(style.fontSize * TWIPS_PER_POINT * 1.35);
  const charWidth = roundInt(style.fontSize * TWIPS_PER_POINT * 0.55);

  let points = 0;
  let anyCaption = false;
  for (const item of series.seriesItems) {
    if (item.values.length > points) points = item.values.length;
    for (let i = 0; i < item.valueCaptions.length; i++) {
      const c = item.valueCaptions[i];
      if (c !== null && c !== undefined && c.length > 0) anyCaption = true;
    }
  }
  if (points === 0) return;

  const kind = series.seriesItems[0]!.chartStyle;
  const horizontal = kind === ChartType.Horzbar;
  const legend = series.showLegend && series.seriesItems.length > 1;

  // Value range: the item's axis bounds when it fixed them, otherwise the data with zero always
  // included (a bar that does not start at zero misleads).
  let [min, max] = range(series);
  const step = niceStep(max - min, 5);
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  if (max <= min) max = min + step;

  // Gutters: value labels on one side, captions on the other, legend on top.
  const widest = formatValue(max, step, culture).length >= formatValue(min, step, culture).length ? formatValue(max, step, culture) : formatValue(min, step, culture);
  const valueGutter = i32(widest.length * charWidth + charWidth * 2);
  const captionGutter = anyCaption
    ? horizontal
      ? Math.min(idiv(series.printWidth, 3), i32(14 * charWidth))
      : i32(lineHeight * 2)
    : idiv(lineHeight, 2);
  const legendGutter = legend ? i32(lineHeight + idiv(lineHeight, 2)) : 0;
  const margin = charWidth;

  let plotLeft: number, plotTop: number, plotWidth: number, plotHeight: number;
  if (horizontal) {
    plotLeft = i32(posx + captionGutter);
    plotTop = i32(posy + legendGutter + idiv(lineHeight, 2));
    plotWidth = i32(series.printWidth - captionGutter - margin);
    plotHeight = i32(series.printHeight - legendGutter - idiv(lineHeight, 2) - lineHeight);
  } else {
    plotLeft = i32(posx + valueGutter);
    plotTop = i32(posy + legendGutter + idiv(lineHeight, 2));
    plotWidth = i32(series.printWidth - valueGutter - margin);
    plotHeight = i32(series.printHeight - legendGutter - idiv(lineHeight, 2) - captionGutter);
  }
  if (plotWidth < charWidth * 4 || plotHeight < lineHeight) return;

  // Grid and value labels.
  const ticks = roundInt((max - min) / step);
  for (let t = 0; t <= ticks; t++) {
    const value = min + t * step;
    const label = formatValue(value, step, culture);
    if (horizontal) {
      const x = i32(plotLeft + roundInt(((value - min) / (max - min)) * plotWidth));
      if (t > 0) line(page, plotTop, x, 1, plotHeight, ShapeType.VertLine, PenType.Dot, GRID_COLOR);
      text(
        page,
        i32(plotTop + plotHeight + idiv(lineHeight, 8)),
        i32(x - charWidth * 4),
        i32(charWidth * 8),
        lineHeight,
        label,
        style,
        AlignmentFlags.AlignHCenter | AlignmentFlags.SingleLine,
        false,
      );
    } else {
      const y = i32(plotTop + plotHeight - roundInt(((value - min) / (max - min)) * plotHeight));
      if (t > 0) line(page, y, plotLeft, plotWidth, 1, ShapeType.HorzLine, PenType.Dot, GRID_COLOR);
      text(
        page,
        i32(y - idiv(lineHeight, 2)),
        posx,
        i32(valueGutter - charWidth),
        lineHeight,
        label,
        style,
        AlignmentFlags.AlignRight | AlignmentFlags.AlignVCenter | AlignmentFlags.SingleLine,
        false,
      );
    }
  }
  // Axes.
  line(page, plotTop, plotLeft, 1, plotHeight, ShapeType.VertLine, PenType.Solid, AXIS_COLOR);
  line(page, i32(plotTop + plotHeight), plotLeft, plotWidth, 1, ShapeType.HorzLine, PenType.Solid, AXIS_COLOR);

  // Series.
  const seriesCount = series.seriesItems.length;
  const slot = horizontal ? idiv(plotHeight, points) : idiv(plotWidth, points);
  const zero = Math.max(min, Math.min(0, max));
  for (let s = 0; s < seriesCount; s++) {
    const item = series.seriesItems[s]!;
    const seriesColor = seriesColorOf(item, s);
    const itemKind = item.chartStyle;
    const asBars =
      itemKind !== ChartType.Line &&
      itemKind !== ChartType.Point &&
      itemKind !== ChartType.Area &&
      itemKind !== ChartType.Splines &&
      itemKind !== ChartType.Arrow;
    let previousX = 0;
    let previousY = 0;
    let havePrevious = false;
    for (let j = 0; j < item.values.length; j++) {
      let value = item.values[j]!;
      // The range leaves out the values that are not finite: an infinity is drawn to the edge of
      // the plot, off the scale, and NaN is not drawn (a line breaks there)
      if (Number.isNaN(value)) {
        havePrevious = false;
        continue;
      }
      if (value === Infinity) value = max;
      else if (value === -Infinity) value = min;
      const color = j < item.colors.length && item.colors[j]! >= 0 ? item.colors[j]! : seriesColor;
      if (horizontal) {
        const barHeight = Math.max(1, roundInt((slot * 0.7) / seriesCount));
        const y = i32(plotTop + j * slot + roundInt(slot * 0.15) + s * barHeight);
        const xValue = i32(plotLeft + roundInt(((value - min) / (max - min)) * plotWidth));
        const xZero = i32(plotLeft + roundInt(((zero - min) / (max - min)) * plotWidth));
        box(page, y, Math.min(xZero, xValue), Math.max(1, absInt(i32(xValue - xZero))), barHeight, color);
        continue;
      }
      const x = i32(plotLeft + j * slot);
      const yValue = i32(plotTop + plotHeight - roundInt(((value - min) / (max - min)) * plotHeight));
      const yZero = i32(plotTop + plotHeight - roundInt(((zero - min) / (max - min)) * plotHeight));
      if (asBars) {
        const barWidth = Math.max(1, roundInt((slot * 0.7) / seriesCount));
        const left = i32(x + roundInt(slot * 0.15) + s * barWidth);
        box(page, Math.min(yZero, yValue), left, barWidth, Math.max(1, absInt(i32(yValue - yZero))), color);
      } else {
        const cx = i32(x + idiv(slot, 2));
        if (itemKind === ChartType.Area)
          box(page, Math.min(yZero, yValue), i32(x + 1), Math.max(1, slot - 2), Math.max(1, absInt(i32(yValue - yZero))), color);
        if (havePrevious && itemKind !== ChartType.Point && itemKind !== ChartType.Area) segment(page, previousX, previousY, cx, yValue, color);
        if (itemKind === ChartType.Point || series.markStyle > 0 || points <= 12) {
          const radius = Math.max(30, idiv(lineHeight, 5));
          shape(page, i32(yValue - radius), i32(cx - radius), radius * 2, radius * 2, ShapeType.Circle, color, PenType.Solid, color);
        }
        previousX = cx;
        previousY = yValue;
        havePrevious = true;
      }
    }
  }

  // Captions under (or beside) each point, from the first series that has them.
  if (anyCaption) {
    let source: SeriesItem | null = null;
    for (const item of series.seriesItems)
      if (item.valueCaptions.length > 0) {
        source = item;
        break;
      }
    if (source !== null) {
      for (let j = 0; j < points && j < source.valueCaptions.length; j++) {
        const caption = source.valueCaptions[j] ?? '';
        if (caption.length === 0) continue;
        if (horizontal)
          text(
            page,
            i32(plotTop + j * slot),
            posx,
            i32(captionGutter - charWidth),
            slot,
            caption,
            style,
            AlignmentFlags.AlignRight | AlignmentFlags.AlignVCenter,
            true,
          );
        else
          text(
            page,
            i32(plotTop + plotHeight + idiv(lineHeight, 4)),
            i32(plotLeft + j * slot),
            slot,
            i32(captionGutter - idiv(lineHeight, 4)),
            caption,
            style,
            AlignmentFlags.AlignHCenter,
            true,
          );
      }
    }
  }

  // Legend: a swatch and the caption of each series, in a row at the top.
  if (legend) {
    let x = plotLeft;
    const swatch = idiv(lineHeight * 2, 3);
    for (let s = 0; s < seriesCount && x < posx + series.printWidth; s++) {
      const item = series.seriesItems[s]!;
      const color = seriesColorOf(item, s);
      const caption = item.caption === null || item.caption.length === 0 ? 'Serie ' + String(s + 1) : item.caption;
      const width = i32(caption.length * charWidth + charWidth);
      box(page, i32(posy + idiv(lineHeight - swatch, 2)), x, swatch, swatch, color);
      text(
        page,
        posy,
        i32(x + swatch + idiv(charWidth, 2)),
        width,
        lineHeight,
        caption,
        style,
        AlignmentFlags.AlignLeft | AlignmentFlags.AlignVCenter | AlignmentFlags.SingleLine,
        false,
      );
      x = i32(x + swatch + width + charWidth * 2);
    }
  }
}

/** The colour of a series: its own, else the palette colour of its index. */
function seriesColorOf(item: SeriesItem, s: number): number {
  return item.color >= 0 ? item.color : VECTOR_CHART_SERIES_COLORS[s % VECTOR_CHART_SERIES_COLORS.length]!;
}

/** Range: the minimum and maximum of the values, widened to the fixed bounds and to zero. */
function range(series: Series): [number, number] {
  let min = DOUBLE_MAX;
  let max = -DOUBLE_MAX;
  for (const item of series.seriesItems) {
    for (let i = 0; i < item.values.length; i++) {
      const v = item.values[i]!;
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === DOUBLE_MAX) {
    min = 0;
    max = 1;
  }
  const fixedLow = series.autoRange === AutoRangeAxis.None || series.autoRange === AutoRangeAxis.AutoUpper;
  const fixedHigh = series.autoRange === AutoRangeAxis.None || series.autoRange === AutoRangeAxis.AutoLower;
  if (fixedLow && series.lowValue < min) min = series.lowValue;
  if (fixedHigh && series.highValue > max) max = series.highValue;
  if (!fixedLow && min > 0) min = 0;
  if (!fixedHigh && max < 0) max = 0;
  if (max === min) max = min + 1;
  return [min, max];
}

/** A round step (1, 2, 2.5, 5 times a power of ten) giving about the wanted number of ticks. */
function niceStep(rangeValue: number, ticks: number): number {
  if (rangeValue <= 0) return 1;
  const raw = rangeValue / Math.max(1, ticks);
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const residual = raw / magnitude;
  const nice = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10;
  return nice * magnitude;
}

/** The value with the decimals the step needs (up to 4), "N" format of the current culture. */
function formatValue(value: number, step: number, culture: CultureInfo): string {
  let decimals = 0;
  let s = step;
  while (decimals < 4 && Math.abs(s - mathRound(s)) > 1e-9) {
    s *= 10;
    decimals++;
  }
  return formatDouble(value, 'N' + String(decimals), culture.number);
}

/**
 * ReadStyle: the font of the chart item. C# parity: C# reads the properties WFontName, FontSize,
 * FontColor and Type1Font by reflection from any object; here from any object with those members.
 */
function readStyle(chart: unknown, series: Series): Style {
  const style: Style = { fontName: 'Arial', fontSize: 8, fontColor: 0, type1Font: PDFFontType.Helvetica };
  if (series.fontSize > 0) style.fontSize = (mathRound(series.fontSize) << 16) >> 16;
  if (chart === null || chart === undefined || typeof chart !== 'object') return style;
  const c = chart as { wFontName?: unknown; fontSize?: unknown; fontColor?: unknown; type1Font?: unknown };
  if (typeof c.wFontName === 'string' && c.wFontName.length > 0) style.fontName = c.wFontName;
  if (typeof c.fontSize === 'number') {
    const size = c.fontSize;
    if (size > 0) style.fontSize = size;
  }
  if (typeof c.fontColor === 'number') style.fontColor = c.fontColor;
  if (typeof c.type1Font === 'number') style.type1Font = c.type1Font as PDFFontType;
  return style;
}

function line(page: MetaPage, top: number, left: number, width: number, height: number, shapeType: ShapeType, pen: PenType, color: number): void {
  shape(page, top, left, width, height, shapeType, color, pen, color);
}

function box(page: MetaPage, top: number, left: number, width: number, height: number, color: number): void {
  shape(page, top, left, width, height, ShapeType.Rectangle, color, PenType.Solid, color);
}

function shape(
  page: MetaPage,
  top: number,
  left: number,
  width: number,
  height: number,
  shapeType: ShapeType,
  brushColor: number,
  pen: PenType,
  penColor: number,
): void {
  const obj = new MetaObjectDraw();
  obj.metaType = MetaObjectType.Draw;
  obj.top = top;
  obj.left = left;
  obj.width = width;
  obj.height = height;
  obj.drawStyle = shapeType;
  obj.brushStyle =
    shapeType === ShapeType.HorzLine || shapeType === ShapeType.VertLine || shapeType === ShapeType.Oblique1 || shapeType === ShapeType.Oblique2
      ? BrushType.Clear
      : BrushType.Solid;
  obj.brushColor = brushColor;
  obj.penStyle = pen;
  obj.penWidth = 0;
  obj.penColor = penColor;
  page.objects.push(obj);
}

/** A straight segment between two points, with the only diagonals the metafile has: the two obliques of a box. */
function segment(page: MetaPage, x1: number, y1: number, x2: number, y2: number, color: number): void {
  if (x2 < x1) {
    let t = x1;
    x1 = x2;
    x2 = t;
    t = y1;
    y1 = y2;
    y2 = t;
  }
  const width = Math.max(1, i32(x2 - x1));
  if (y2 > y1) line(page, y1, x1, width, i32(y2 - y1), ShapeType.Oblique1, PenType.Solid, color);
  else if (y2 < y1) line(page, y2, x1, width, i32(y1 - y2), ShapeType.Oblique2, PenType.Solid, color);
  else line(page, y1, x1, width, 1, ShapeType.HorzLine, PenType.Solid, color);
}

function text(
  page: MetaPage,
  top: number,
  left: number,
  width: number,
  height: number,
  value: string,
  style: Style,
  alignment: number,
  wordWrap: boolean,
): void {
  if (width <= 0 || height <= 0 || value.length === 0) return;
  const obj = new MetaObjectText();
  obj.metaType = MetaObjectType.Text;
  obj.top = top;
  obj.left = left;
  obj.width = width;
  obj.height = height;
  obj.textP = page.addString(value);
  obj.textS = value.length;
  obj.lFontNameP = page.addString(style.fontName);
  obj.lFontNameS = style.fontName.length;
  obj.wFontNameP = page.addString(style.fontName);
  obj.wFontNameS = style.fontName.length;
  obj.fontSize = style.fontSize;
  obj.fontColor = style.fontColor;
  obj.backColor = WHITE;
  obj.transparent = true;
  obj.cutText = true;
  obj.wordWrap = wordWrap;
  obj.alignment = alignment;
  obj.type1Font = style.type1Font;
  obj.printStep = PrintStepType.BySize;
  page.objects.push(obj);
}
