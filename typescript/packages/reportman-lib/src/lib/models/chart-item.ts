import { PrintItemText } from "./print-item-text.js";

/** C# ChartItem: the defaults are the ones of its constructor. */
export class ChartItem extends PrintItemText {
  public valueExpression = "";
  public valueXExpression = "";
  public getValueCondition = "";
  public changeSerieExpression = "";
  public captionExpression = "";
  public colorExpression = "";
  public serieColorExpression = "";
  public serieCaption = "";
  public clearExpression = "";
  public identifier = "";
  public changeSerieBool = false;
  public clearExpressionBool = false;
  public chartStyle = ChartType.Line;
  public driver = ChartDriver.Default;
  public view3d = true;
  public view3dWalls = false;
  public perspective = 15;
  public elevation = 345;
  public rotation = 345;
  public zoom = 100;
  public horzOffset = 0;
  public vertOffset = 0;
  public tilt = 0;
  public orthogonal = true;
  public multiBar = BarType.Side;
  public resolution = 100;
  public showLegend = false;
  public showHint = true;
  public markStyle = 0;
  public horzFontSize = 0;
  public vertFontSize = 0;
  public horzFontRotation = 0;
  public vertFontRotation = 0;
  public autoRange = AutoRangeAxis.Default;
  public axisYInitial = 0;
  public axisYFinal = 0;
  /**
   * The colors of the series saved with the report (Delphi keeps them in its Series collection), as
   * the engine writes them: integers separated by commas. Only preserved, they do not change the chart.
   */
  public seriesColorsText = "";
  constructor() {
    super();
    this.className = "TRPCHART";
    this.width = 500;
    this.height = 500;
  }
}

export enum ChartType {
  Line,
  Bar,
  Point,
  Horzbar,
  Area,
  Pie,
  Arrow,
  Bubble,
  Gantt,
  Splines,
  CandleStick,
  Pyramid,
  Polar,
  PointFigure,
  Funnel,
  Kagi,
  Doughnut,
  Radar,
  Renko,
  ErrorBar,
}

export enum ChartDriver {
  Default,
  Engine,
  Teechart,
}

export enum BarType {
  None,
  Side,
  Stacked,
  Stacked100,
}

export enum AutoRangeAxis {
  Default = 0,
  AutoBoth = 1,
  AutoUpper = 2,
  AutoLower = 3,
  None = 4,
}
