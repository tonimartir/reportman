// Ports of the chart functions of Reportman.Reporting.BaseReport (IdenGraphicClear,
// IdenGraphicNew, IdenGraphicNewXY, IdenGraphicNewFunction, IdenGraphicBounds, IdenGraphicColor,
// IdenGraphicSerieColor) and of the BaseReport methods they call (GraphicClear, GraphicNew...):
// the first parameter names the identifier of a chart item, found with the report's evaluator.

import { IdenFunction } from '../../eval/identifiers.js';
import { NamedException, NetException } from '../../util/netexception.js';
import { Variant } from '../../variant/variant.js';
import type { ReportRuntime } from '../report.js';
import { IdenChart } from './chartitem.js';

/** The chart variable an identifier names, or the error of the C# engine (a System.Exception). */
function chartOf(report: ReportRuntime, graphicident: string, verb: string): IdenChart {
  const niden = report.evaluator.searchIdentifier(graphicident);
  if (!(niden instanceof IdenChart)) throw new NetException('Exception', 'Identifier: ' + graphicident + ' is not a grafic, calling ' + verb);
  return niden;
}

/** BaseReport.GraphicClear. */
export function graphicClear(report: ReportRuntime, graphicident: string): boolean {
  chartOf(report, graphicident, 'GraphicClear').clear();
  return true;
}

/** BaseReport.GraphicNew. */
export function graphicNew(report: ReportRuntime, graphicident: string, newvalue: number, change: boolean, valuecaption: string, seriecaption: string): boolean {
  chartOf(report, graphicident, 'GraphicNew').newValue(newvalue, change, valuecaption, seriecaption);
  return true;
}

/** BaseReport.GraphicNewXY. */
export function graphicNewXY(
  report: ReportRuntime,
  graphicident: string,
  xvalue: number,
  newvalue: number,
  change: boolean,
  valuecaption: string,
  seriecaption: string,
): boolean {
  chartOf(report, graphicident, 'GraphicNew').newValueXY(xvalue, newvalue, change, valuecaption, seriecaption);
  return true;
}

/** BaseReport.GraphicNewFunction. */
export function graphicNewFunction(report: ReportRuntime, graphicident: string, functionName: string, functionParams: string, seriecaption: string): boolean {
  chartOf(report, graphicident, 'GraphicNew').newFunction(functionName, functionParams, seriecaption);
  return true;
}

/** BaseReport.GraphicBounds. */
export function graphicBounds(
  report: ReportRuntime,
  graphicident: string,
  autol: boolean,
  autoh: boolean,
  lvalue: number,
  hvalue: number,
  logaritmic: boolean,
  logBase: number,
  inverted: boolean,
): boolean {
  chartOf(report, graphicident, 'GraphicNew').graphicBounds(autol, autoh, lvalue, hvalue, logaritmic, logBase, inverted);
  return true;
}

/** BaseReport.GraphicColor. */
export function graphicColor(report: ReportRuntime, graphicident: string, newcolor: number): boolean {
  chartOf(report, graphicident, 'GraphicColor').graphicColor(newcolor);
  return true;
}

/** BaseReport.GraphicSerieColor. */
export function graphicSerieColor(report: ReportRuntime, graphicident: string, newcolor: number): boolean {
  chartOf(report, graphicident, 'GraphicSerieColor').graphicSerieColor(newcolor);
  return true;
}

/** The parameter checks of a chart function: s string, n number, b boolean, i integer. */
type Check = 's' | 'n' | 'b' | 'i';

/** IdenFunctionReport of a chart function. */
abstract class IdenGraphicFunction extends IdenFunction {
  readonly report: ReportRuntime;
  private readonly checks: readonly Check[];

  // C# parity: BaseReport creates its identifiers before InitEvaluator, with a null evaluator.
  constructor(report: ReportRuntime, name: string, checks: string, model: string) {
    super(null);
    this.report = report;
    this.checks = checks.split('') as Check[];
    this.setParamCount(this.checks.length);
    this.name = name;
    this.fModel = model;
  }

  protected get ctx() {
    return this.report.evaluator.context;
  }

  /** The type checks, in order: the first one that fails is error 438 of the translator. */
  protected checkParams(): void {
    this.checks.forEach((c, i) => {
      const p = this.params[i]!;
      const ok = c === 's' ? p.isString() : c === 'n' ? p.isNumber() : c === 'b' ? p.isBoolean() : p.isInteger();
      if (!ok) throw new NamedException(this.report.translator.translateStr(438), this.name);
    });
  }

  protected str(i: number): string {
    return this.params[i]!.toString(this.ctx);
  }

  /** Params[i].AsDouble. */
  protected dbl(i: number): number {
    return this.params[i]!.toDouble(this.ctx);
  }

  /** (bool)Params[i]. */
  protected bool(i: number): boolean {
    return this.params[i]!.toBool(this.ctx);
  }

  /** Params[i].AsInteger. */
  protected int(i: number): number {
    return this.params[i]!.toInt(this.ctx);
  }
}

/** GRAPHICCLEAR(gr): the chart has no series. */
export class IdenGraphicClear extends IdenGraphicFunction {
  constructor(report: ReportRuntime) {
    super(report, 'GRAPHICCLEAR', 's', 'function GraphicClear(gr:string):Boolean');
  }

  protected getValue(): Variant {
    this.checkParams();
    return Variant.fromBoolean(graphicClear(this.report, this.str(0)));
  }
}

/** GRAPHICNEW(gr, value, changeserie, valuecaption, seriecaption): a value in the chart. */
export class IdenGraphicNew extends IdenGraphicFunction {
  constructor(report: ReportRuntime) {
    super(
      report,
      'GRAPHICNEW',
      'snbss',
      'function GraphicClear(gr:string;newvalue:double;changeserie:boolean;valuecaption:string;seriecaption:string):Boolean',
    );
  }

  protected getValue(): Variant {
    this.checkParams();
    return Variant.fromBoolean(graphicNew(this.report, this.str(0), this.dbl(1), this.bool(2), this.str(3), this.str(4)));
  }
}

/** GRAPHICBOUNDS(gr, autol, autoh, low, high, log, logbase, inverted): the value axis. */
export class IdenGraphicBounds extends IdenGraphicFunction {
  constructor(report: ReportRuntime) {
    super(
      report,
      'GRAPHICBOUNDS',
      'sbbnnbnb',
      'function (Gr:string; autol,autoh:boolean; low,high:double;log:boolean; logbase:double; inverted:boolean):Boolean',
    );
  }

  protected getValue(): Variant {
    this.checkParams();
    return Variant.fromBoolean(
      graphicBounds(this.report, this.str(0), this.bool(1), this.bool(2), this.dbl(3), this.dbl(4), this.bool(5), this.dbl(6), this.bool(7)),
    );
  }
}

/** GRAPHICNEWXY(gr, x, y, changeserie, valuecaption, seriecaption): an X and Y value in the chart. */
export class IdenGraphicNewXY extends IdenGraphicFunction {
  constructor(report: ReportRuntime) {
    super(
      report,
      'GRAPHICNEWXY',
      'snnbss',
      'function GraphicClear(gr:string;xvalue,yvalue:double;changeserie:boolean;valuecaption:string;seriecaption:string):Boolean',
    );
  }

  protected getValue(): Variant {
    this.checkParams();
    return Variant.fromBoolean(graphicNewXY(this.report, this.str(0), this.dbl(1), this.dbl(2), this.bool(3), this.str(4), this.str(5)));
  }
}

/** GRAPHICNEWFUNCTION(gr, function, params, seriecaption): a function series. */
export class IdenGraphicNewFunction extends IdenGraphicFunction {
  constructor(report: ReportRuntime) {
    super(
      report,
      'GRAPHICNEWFUNCTION',
      'ssss',
      'function GraphicnewFunction(gr:string;functionName.string;functionParams:string;seriecaption:string):Boolean',
    );
  }

  protected getValue(): Variant {
    this.checkParams();
    return Variant.fromBoolean(graphicNewFunction(this.report, this.str(0), this.str(1), this.str(2), this.str(3)));
  }
}

/** GRAPHICCOLOR(gr, color): the colour of the last value. */
export class IdenGraphicColor extends IdenGraphicFunction {
  constructor(report: ReportRuntime) {
    super(report, 'GRAPHICCOLOR', 'si', 'function GraphicColor(gr:string;Color:integer):Boolean');
  }

  protected getValue(): Variant {
    this.checkParams();
    return Variant.fromBoolean(graphicColor(this.report, this.str(0), this.int(1)));
  }
}

/** GRAPHICSERIECOLOR(gr, color): the colour of the current series. */
export class IdenGraphicSerieColor extends IdenGraphicFunction {
  constructor(report: ReportRuntime) {
    super(report, 'GRAPHICSERIECOLOR', 'si', 'function GraphicSerieColor(gr:string;Color:integer):Boolean');
  }

  protected getValue(): Variant {
    this.checkParams();
    return Variant.fromBoolean(graphicSerieColor(this.report, this.str(0), this.int(1)));
  }
}
