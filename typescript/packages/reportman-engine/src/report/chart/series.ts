// Port of Reportman.Drawing.Series (Series.cs): the data a chart item accumulates while its
// subreport runs (its series, their values, captions and colours) and the appearance and axis
// settings it is drawn with. A device with a chart support of its own (PrintOut.drawChart)
// receives a Series; the others draw it with the vector chart (vectorchart.ts).

import { AutoRangeAxis, BarType, ChartType } from '@reportman/lib';
import type { RpDateTime } from '../../util/datetime.js';

/** A chart's appearance, its value axis and the series it contains (Series). */
export class Series {
  /** How the value axis range is computed (with LowValue and HighValue). */
  autoRange: AutoRangeAxis = AutoRangeAxis.Default;
  /** Lower bound of the value axis when it is fixed. */
  lowValue = 0.0;
  /** Upper bound of the value axis when it is fixed. */
  highValue = 0.0;
  /** The value axis uses a logarithmic scale. */
  logaritmic = false;
  /** Base of the logarithmic scale. */
  logBase = 0.0;
  /** The value axis is inverted. */
  inverted = false;
  /** Font size of the chart texts, in points (a C# float). */
  fontSize = 0;
  /** Resolution of the chart, in dots per inch (a C# float). */
  resolution = 100;
  showLegend = false;
  horzFontRotation = 0;
  vertFontRotation = 0;
  vertFontSize = 0;
  horzFontSize = 0;
  showHint = false;
  /** Width the chart item printed with, in twips. */
  printWidth = 0;
  /** Height the chart item printed with, in twips. */
  printHeight = 0;
  effect3D = false;
  markStyle = 0;
  /** How several bar series are combined. */
  multiBar: BarType = BarType.None;
  /** The series of the chart. */
  readonly seriesItems: SeriesItem[] = [];

  /** Removes every series. */
  clear(): void {
    this.seriesItems.length = 0;
  }
}

/** One series of a chart: its values, the colour and caption of each one, its own caption (SeriesItem). */
export class SeriesItem {
  /** The values (Y) of the points. */
  readonly values: number[] = [];
  /** The X values of the points (a number or a date), when the chart has an X expression. */
  readonly valuesX: (number | RpDateTime)[] = [];
  /** The colour of each point, -1 for the colour of the series. */
  readonly colors: number[] = [];
  /**
   * The caption of each point. C# parity: a caption expression whose result is not a string gives
   * null (the implicit string conversion of a Variant), drawn as no caption.
   */
  readonly valueCaptions: (string | null)[] = [];
  /** The colour of the series, -1 for the palette colour. */
  color = -1;
  caption = '';
  maxValue = -10e300;
  minValue = +10e300;
  chartStyle: ChartType = ChartType.Bar;
  /** The function of a function series (GRAPHICNEWFUNCTION), null for a series of values. */
  functionName: string | null = null;
  functionParams: string | null = null;

  /** The colour of the last point; nothing when the series has no points. */
  setLastValueColor(newcolor: number): void {
    if (this.colors.length === 0) return;
    this.colors[this.colors.length - 1] = newcolor;
  }
}
