// Port of the runtime part of Reportman.Reporting.ChartItem (ChartItem.cs) and of VariableGraph
// (VariableGraph.cs): a chart item collects a value (and its caption and colour) on every record
// of its subreport, starts a new series when its change of serie expression says so, clears them
// on its clear expression, and draws them when it prints: with the device's own chart support
// (PrintOut.drawChart, of Report.ChartingDriver when the host sets one) or else the vector chart.
// Its identifier is a variable the GRAPHIC* report functions find to add values from expressions.

import type { ChartItem as ChartModel } from '@reportman/lib';
import { AutoRangeAxis, BarType, ChartDriver, ChartType } from '@reportman/lib';
import type { MetaFile, Point, PrintOut } from '@reportman/metafile';
import { IdenVariable } from '../../eval/identifiers.js';
import { messageOf } from '../../util/netexception.js';
import { Variant } from '../../variant/variant.js';
import { ReportException } from '../errors.js';
import { PrintItemText, SubReportEvent, type PartialRef } from '../items.js';
import type { ReportRuntime } from '../report.js';
import { Series, SeriesItem } from './series.js';
import { drawVectorChart } from './vectorchart.js';

/**
 * VariableGraph: the variable of a chart item's identifier. It is a plain variable for the
 * expressions (Null until something is assigned to it) that the GRAPHIC* functions recognise.
 */
export class IdenChart extends IdenVariable {
  readonly report: ReportRuntime;
  newChart: ChartItem;

  // C# parity: created with the evaluator the report had when the item was attached to it; a
  // variable does not use its evaluator.
  constructor(report: ReportRuntime, chart: ChartItem) {
    super(null);
    this.report = report;
    this.newChart = chart;
  }

  clear(): void {
    this.newChart.clear();
  }

  newValue(newvalue: number, seriechange: boolean, valuecaption: string | null, seriecaption: string): void {
    this.newChart.newValue(newvalue, seriechange, valuecaption, seriecaption);
  }

  newValueXY(newvalueX: number, newvalue: number, seriechange: boolean, valuecaption: string | null, seriecaption: string): void {
    this.newChart.newValueXY(newvalueX, newvalue, seriechange, valuecaption, seriecaption);
  }

  newFunction(functionName: string, functionParams: string, serieCaption: string): void {
    this.newChart.newFunction(functionName, functionParams, serieCaption);
  }

  graphicBounds(autol: boolean, autoh: boolean, lvalue: number, hvalue: number, logaritmic: boolean, logBase: number, inverted: boolean): void {
    this.newChart.graphicBounds(autol, autoh, lvalue, hvalue, logaritmic, logBase, inverted);
  }

  graphicColor(newcolor: number): void {
    this.newChart.graphicColor(newcolor);
  }

  graphicSerieColor(newcolor: number): void {
    this.newChart.graphicSerieColor(newcolor);
  }
}

/** ChartItem: a chart built from expression driven series while the subreport runs. */
export class ChartItem extends PrintItemText {
  /**
   * The palette of the C# item (SeriesColors). C# parity: nothing reads it; the vector chart has
   * a palette of its own.
   */
  static readonly SERIES_COLORS: readonly number[] = [
    0xff0000, 0xffddff, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xaaaaaa, 0xbb0000, 0x00bb00, 0x0000bb,
    0xbbbb00, 0xbb00bb, 0x00bbbb, 0x777777, 0x773333, 0x337733, 0x333377, 0x777700, 0x770077, 0x007777,
  ];
  /** The accumulated series (FSeries). */
  readonly series: Series;
  readonly idenChart: IdenChart;
  private fClearValue: Variant = Variant.null;
  private fSerieValue: Variant = Variant.null;
  changeSerieExpression: string;
  clearExpression: string;
  getValueCondition: string;
  valueExpression: string;
  valueXExpression: string;
  captionExpression: string;
  serieCaption: string;
  colorExpression: string;
  serieColorExpression: string;
  changeSerieBool: boolean;
  chartStyle: ChartType;
  identifier: string;
  clearExpressionBool: boolean;
  driver: ChartDriver;
  view3d: boolean;
  view3dWalls: boolean;
  perspective: number;
  elevation: number;
  rotation: number;
  zoom: number;
  horzOffset: number;
  vertOffset: number;
  tilt: number;
  orthogonal: boolean;
  multiBar: BarType;
  resolution: number;
  showLegend: boolean;
  showHint: boolean;
  markStyle: number;
  horzFontSize: number;
  vertFontSize: number;
  horzFontRotation: number;
  vertFontRotation: number;
  autoRange: AutoRangeAxis;
  axisYInitial: number;
  axisYFinal: number;
  /** The colours of the series saved with the report: only preserved, they do not change the chart. */
  seriesColorsText: string;

  constructor(report: ReportRuntime, model: ChartModel) {
    super(report, model);
    this.series = new Series();
    this.series.logaritmic = false;
    this.changeSerieExpression = model.changeSerieExpression;
    this.clearExpression = model.clearExpression;
    this.getValueCondition = model.getValueCondition;
    this.valueExpression = model.valueExpression;
    this.valueXExpression = model.valueXExpression;
    this.captionExpression = model.captionExpression;
    this.serieCaption = model.serieCaption;
    this.colorExpression = model.colorExpression;
    this.serieColorExpression = model.serieColorExpression;
    this.changeSerieBool = model.changeSerieBool;
    this.chartStyle = model.chartStyle;
    this.identifier = model.identifier;
    this.clearExpressionBool = model.clearExpressionBool;
    this.driver = model.driver;
    this.view3d = model.view3d;
    this.view3dWalls = model.view3dWalls;
    this.perspective = model.perspective;
    this.elevation = model.elevation;
    this.rotation = model.rotation;
    this.zoom = model.zoom;
    this.horzOffset = model.horzOffset;
    this.vertOffset = model.vertOffset;
    this.tilt = model.tilt;
    this.orthogonal = model.orthogonal;
    this.multiBar = model.multiBar;
    this.resolution = model.resolution;
    this.showLegend = model.showLegend;
    this.showHint = model.showHint;
    this.markStyle = model.markStyle;
    this.horzFontSize = model.horzFontSize;
    this.vertFontSize = model.vertFontSize;
    this.horzFontRotation = model.horzFontRotation;
    this.vertFontRotation = model.vertFontRotation;
    this.autoRange = model.autoRange;
    this.axisYInitial = model.axisYInitial;
    this.axisYFinal = model.axisYFinal;
    this.seriesColorsText = model.seriesColorsText;
    this.idenChart = new IdenChart(report, this);
  }

  private get ctx() {
    return this.report.evaluator.context;
  }

  /** Clear: no series, and the value axis bounds of the item again. */
  clear(): void {
    this.series.clear();
    this.series.highValue = this.axisYFinal;
    this.series.lowValue = this.axisYInitial;
    this.series.autoRange = this.autoRange;
  }

  /** The series start empty with the report; every record adds a value when the condition holds. */
  override subReportChanged(newstate: SubReportEvent, newgroup: string): void {
    switch (newstate) {
      case SubReportEvent.Start:
        this.fClearValue = Variant.null;
        this.fSerieValue = Variant.null;
        this.clear();
        break;
      case SubReportEvent.DataChange:
        // Gets a value if the condition is true
        if (this.checkValueCondition()) this.getNewValue();
        break;
    }
    super.subReportChanged(newstate, newgroup);
  }

  private getNewValue(): void {
    if (this.valueExpression.length === 0) return;
    this.evaluateClearExpression();
    let changeserie = this.evaluateChangeSerieExpression();
    let seriecaption = '';
    if (changeserie) seriecaption = this.evaluateSerieCaption().toString(this.ctx);

    let newcaption: string | null = '';
    if (this.captionExpression.length > 0) {
      // C# parity: string newcaption = Variant, the implicit conversion (null when not a string)
      newcaption = this.evaluateText(this.captionExpression).toImplicitString(this.ctx);
      if (this.series.seriesItems.length === 0) {
        seriecaption = this.evaluateSerieCaption().toString(this.ctx);
        changeserie = true;
      }
    }
    const newvalue = this.evaluateText(this.valueExpression);
    let newdoublevalue = 0;
    if (!newvalue.isNull) newdoublevalue = newvalue.toDouble(this.ctx);
    if (this.valueXExpression.length > 0) {
      const newvalueX = this.evaluateText(this.valueXExpression);
      this.newValueXY(newvalueX, newdoublevalue, changeserie, newcaption, seriecaption);
    } else this.newValue(newdoublevalue, changeserie, newcaption, seriecaption);

    if (this.serieColorExpression.length > 0) {
      const newcolor = this.evaluateText(this.serieColorExpression).toInt(this.ctx);
      if (newcolor !== 0) this.series.seriesItems[this.series.seriesItems.length - 1]!.color = newcolor;
    }
    if (this.colorExpression.length > 0) {
      const newcolor = this.evaluateText(this.colorExpression).toInt(this.ctx);
      if (newcolor !== 0) {
        const nitem = this.series.seriesItems[this.series.seriesItems.length - 1]!;
        nitem.colors[nitem.colors.length - 1] = newcolor;
      }
    }
  }

  private evaluateText(ntext: string): Variant {
    const fevaluator = this.report.evaluator;
    fevaluator.expression = ntext;
    fevaluator.evaluate();
    return fevaluator.result;
  }

  /** EvaluateClearExpression: the series are cleared when the clear expression triggers. */
  evaluateClearExpression(): void {
    if (this.clearExpression.length === 0) return;
    const fevaluator = this.report.evaluator;
    try {
      fevaluator.expression = this.clearExpression;
      fevaluator.evaluate();
      const aresult = fevaluator.result;
      if (this.clearExpressionBool) {
        if (aresult.toBool(fevaluator.context)) this.series.seriesItems.length = 0;
      } else if (Variant.notEquals(this.fClearValue, aresult, fevaluator.context)) {
        this.series.seriesItems.length = 0;
        this.fClearValue = aresult;
      }
    } catch (e) {
      throw new ReportException(messageOf(e) + '\n' + this.name + ' Prop:ClearExpression ', this.name, 'ClearExpression');
    }
  }

  /** EvaluateChangeSerieExpression: a new series starts when the expression says so. */
  evaluateChangeSerieExpression(): boolean {
    if (this.changeSerieExpression.length === 0) return false;
    let nresult = false;
    const fevaluator = this.report.evaluator;
    try {
      fevaluator.expression = this.changeSerieExpression;
      fevaluator.evaluate();
      const aresult = fevaluator.result;
      if (this.changeSerieBool) {
        if (aresult.toBool(fevaluator.context)) nresult = true;
      } else if (Variant.notEquals(this.fSerieValue, aresult, fevaluator.context)) {
        this.fSerieValue = aresult;
        nresult = true;
      }
    } catch (e) {
      throw new ReportException(
        messageOf(e) + '\n' + this.name + ' Prop:ChangeSerieExpression \n' + this.printCondition,
        this.name,
        'ChangeSerieExpression',
      );
    }
    return nresult;
  }

  /** EvaluateSerieCaption: the caption of a new series ("" without an expression). */
  evaluateSerieCaption(): Variant {
    if (this.serieCaption.length === 0) return Variant.fromString('');
    const fevaluator = this.report.evaluator;
    try {
      fevaluator.expression = this.serieCaption;
      fevaluator.evaluate();
      return fevaluator.result;
    } catch (e) {
      throw new ReportException(messageOf(e) + '\n' + this.name + ' Prop:SerieCaption \n' + this.printCondition, this.name, 'SerieCaption');
    }
  }

  /** CheckValueCondition: a value is collected only when the condition holds. */
  checkValueCondition(): boolean {
    if (this.getValueCondition.length === 0) return true;
    const fevaluator = this.report.evaluator;
    try {
      fevaluator.expression = this.getValueCondition;
      fevaluator.evaluate();
      return fevaluator.result.toBool(fevaluator.context);
    } catch (e) {
      throw new ReportException(
        messageOf(e) + '\n' + this.name + ' Prop:GetValueCondition \n' + this.printCondition,
        this.name,
        'GetValueCondition',
      );
    }
  }

  /** GetSeries: the current series; the first one takes the appearance of the item. */
  private getSeries(firstserie: { value: boolean }, seriecaption: string): SeriesItem {
    const s = this.series;
    if (s.seriesItems.length < 1) {
      const aserie = new SeriesItem();
      aserie.chartStyle = this.chartStyle;
      firstserie.value = true;
      aserie.caption = seriecaption;
      s.fontSize = this.fontSize;
      s.resolution = this.resolution;
      s.showLegend = this.showLegend;
      s.multiBar = this.multiBar;
      s.markStyle = this.markStyle;
      s.horzFontRotation = this.horzFontRotation;
      s.vertFontRotation = this.vertFontRotation;
      s.vertFontSize = this.vertFontSize;
      s.horzFontSize = this.horzFontSize;
      s.showHint = this.showHint;
      s.effect3D = this.view3d;
      s.seriesItems.push(aserie);
      return aserie;
    }
    return s.seriesItems[s.seriesItems.length - 1]!;
  }

  /** NewValue: a value in the current series, or in a new one. */
  newValue(newvalue: number, seriechange: boolean, valuecaption: string | null, seriecaption: string): void {
    this.newValueXY(null, newvalue, seriechange, valuecaption, seriecaption);
  }

  /** GraphicBounds: the range and scale of the value axis. */
  graphicBounds(autol: boolean, autoh: boolean, lvalue: number, hvalue: number, logaritmic: boolean, logBase: number, inverted: boolean): void {
    const s = this.series;
    if (autol) s.autoRange = autoh ? AutoRangeAxis.AutoBoth : AutoRangeAxis.AutoLower;
    else s.autoRange = autoh ? AutoRangeAxis.AutoUpper : AutoRangeAxis.None;
    s.logaritmic = logaritmic;
    s.logBase = logBase;
    s.inverted = inverted;
    s.lowValue = lvalue;
    s.highValue = hvalue;
  }

  /** NewFunction: a series computed from the others (only when there is a series already). */
  newFunction(functionName: string, functionParams: string, serieCaption: string): void {
    if (this.series.seriesItems.length > 0) {
      const itemFunc = new SeriesItem();
      itemFunc.caption = serieCaption;
      itemFunc.functionName = functionName;
      itemFunc.functionParams = functionParams;
      this.series.seriesItems.push(itemFunc);
    }
  }

  /** NewValueXY: an X (a number, a date, or none) and Y value, in the current series or a new one. */
  newValueXY(newvalueX: Variant | number | null, newvalue: number, seriechange: boolean, valuecaption: string | null, seriecaption: string): void {
    const firstserie = { value: false };
    let aserie = this.getSeries(firstserie, seriecaption);
    if (seriechange) {
      if (!firstserie.value) {
        aserie = new SeriesItem();
        aserie.chartStyle = this.chartStyle;
        aserie.caption = seriecaption;
        this.series.seriesItems.push(aserie);
      }
    }
    aserie.values.push(newvalue);
    aserie.valueCaptions.push(valuecaption);
    aserie.colors.push(aserie.color);
    if (newvalueX !== null) {
      if (newvalueX instanceof Variant) {
        if (newvalueX.isDateTime()) aserie.valuesX.push(newvalueX.toDateTime(this.ctx));
        else aserie.valuesX.push(newvalueX.toDouble(this.ctx));
      } else aserie.valuesX.push(newvalueX);
    }
  }

  /** GraphicColor: the colour of the last value of the current series. */
  graphicColor(newcolor: number): void {
    if (this.series.seriesItems.length === 0) return;
    this.series.seriesItems[this.series.seriesItems.length - 1]!.setLastValueColor(newcolor);
  }

  /** GraphicSerieColor: the colour of the current series. */
  graphicSerieColor(newcolor: number): void {
    if (this.series.seriesItems.length === 0) return;
    this.series.seriesItems[this.series.seriesItems.length - 1]!.color = newcolor;
  }

  /** DoPrint: the series drawn by the charting driver of the report, else by the device. */
  protected override doPrint(
    adriver: PrintOut,
    aposx: number,
    aposy: number,
    newwidth: number,
    newheight: number,
    metafile: MetaFile,
    maxExtent: Point,
    partialPrint: PartialRef,
  ): void {
    super.doPrint(adriver, aposx, aposy, newwidth, newheight, metafile, maxExtent, partialPrint);
    this.series.printWidth = this.printWidth;
    this.series.printHeight = this.printHeight;

    if (this.series.seriesItems.length === 0) return;
    const chartingDriver = this.report.chartingDriver;
    if (chartingDriver !== null) this.drawChart(chartingDriver, metafile, aposx, aposy);
    else this.drawChart(adriver, metafile, aposx, aposy);
  }

  /** PrintOut.DrawChart: the device's own chart support, else the vector chart (VectorChart.Draw). */
  private drawChart(driver: PrintOut, metafile: MetaFile, posx: number, posy: number): void {
    if (driver.drawChart !== undefined) driver.drawChart(this.series, metafile, posx, posy, this);
    else drawVectorChart(this.series, metafile, posx, posy, this, this.report.culture);
  }
}
