import { ReportItem, Report, ChartItem } from "@reportman/lib";
import { IObjectInspector } from "../interfaces/object-inspector.interface";
import { TranslationService } from "../services/translator.service";
import { DesignerInterfaceText } from "./designer-interface-text";

export class DesignerInterfaceChart extends DesignerInterfaceText {
  private verticalAxisAutoRangeName: string;
  private verticalAxisMinimum: string;
  private verticalAxisMaximum: string;

  constructor(
    nreport: Report,
    nrepitem: Map<number, ReportItem>,
    nobjinsp: IObjectInspector,
    ntranslator: TranslationService
  ) {
    super(nreport, nrepitem, nobjinsp, ntranslator);
    this.verticalAxisAutoRangeName = this.translator.TranslateStr(1449);
    this.verticalAxisMinimum = this.translator.TranslateStr(1450);
    this.verticalAxisMaximum = this.translator.TranslateStr(1451);
  }

  public override GetProperties(
    lnames: string[],
    llabels: string[],
    ltypes: string[],
    lvalues: any[] | null,
    lhints: string[],
    lcat: string[],
    lorder?: (number | null)[] | null
  ): void {
    const push = (
      propName: string,
      label: string,
      type: string,
      hint: string,
      cat: string,
      value: any
    ) => {
      lnames.push(propName);
      llabels.push(label);
      ltypes.push(type);
      lhints.push(hint);
      lcat.push(cat);
      if (lvalues) {
        lvalues.push(value);
      }
      lorder?.push(null);
    };

    const catChart = this.translator.TranslateStr(1207);
    const catView = this.translator.TranslateStr(1208);
    const hint = "refchart.html";

    super.GetProperties(lnames, llabels, ltypes, lvalues, lhints, lcat, lorder);

    push(
      "valueExpression",
      this.translator.TranslateStr(571),
      this.translator.TranslateStr(571),
      hint,
      catChart,
      this.getValueString("valueExpression")
    );
    push(
      "valueXExpression",
      this.translator.TranslateStr(571) + " X",
      this.translator.TranslateStr(571),
      hint,
      catChart,
      this.getValueString("valueXExpression")
    );
    push(
      "identifier",
      this.translator.TranslateStr(304),
      this.translator.TranslateStr(557),
      hint,
      catChart,
      this.getValueString("chart.identifier")
    );
    push(
      "chartStyle",
      this.translator.TranslateStr(712),
      this.translator.TranslateStr(569),
      hint,
      catChart,
      this.getValueInteger("chartStyle")
    );
    push(
      "getValueCondition",
      this.translator.TranslateStr(717),
      this.translator.TranslateStr(571),
      hint,
      catChart,
      this.getValueString("getValueCondition")
    );
    push(
      "changeExpression",
      this.translator.TranslateStr(714),
      this.translator.TranslateStr(571),
      hint,
      catChart,
      this.getValueString("changeSerieExpression")
    );
    push(
      "changeSerieBool",
      this.translator.TranslateStr(715),
      this.translator.TranslateStr(568),
      hint,
      catChart,
      this.getValueBoolean("changeSerieBool")
    );
    push(
      "clearExpression",
      this.translator.TranslateStr(966),
      this.translator.TranslateStr(571),
      hint,
      catChart,
      this.getValueString("clearExpression")
    );
    push(
      "clearExpressionBool",
      this.translator.TranslateStr(967),
      this.translator.TranslateStr(568),
      hint,
      catChart,
      this.getValueBoolean("clearExpressionBool")
    );
    push(
      "captionExpression",
      this.translator.TranslateStr(716),
      this.translator.TranslateStr(571),
      hint,
      catChart,
      this.getValueString("captionExpression")
    );
    push(
      "serieCaption",
      this.translator.TranslateStr(1331),
      this.translator.TranslateStr(571),
      hint,
      catChart,
      this.getValueString("serieCaption")
    );
    push(
      "colorExpression",
      this.translator.TranslateStr(1365),
      this.translator.TranslateStr(571),
      hint,
      catChart,
      this.getValueString("colorExpression")
    );
    push(
      "serieColorExpression",
      this.translator.TranslateStr(1364),
      this.translator.TranslateStr(571),
      hint,
      catChart,
      this.getValueString("serieColorExpression")
    );
    push(
      "driver",
      this.translator.TranslateStr(67),
      this.translator.TranslateStr(569),
      hint,
      catView,
      this.getValueInteger("driver")
    );
    push(
      "view3d",
      this.translator.TranslateStr(904),
      this.translator.TranslateStr(568),
      hint,
      catView,
      this.getValueBoolean("view3d")
    );
    push(
      "view3dWalls",
      this.translator.TranslateStr(905),
      this.translator.TranslateStr(568),
      hint,
      catView,
      this.getValueBoolean("view3dWalls")
    );
    push(
      "perspective",
      this.translator.TranslateStr(906),
      this.translator.TranslateStr(559),
      hint,
      catView,
      this.getValueInteger("perspective")
    );
    push(
      "elevation",
      this.translator.TranslateStr(907),
      this.translator.TranslateStr(559),
      hint,
      catView,
      this.getValueInteger("elevation")
    );
    push(
      "rotation",
      this.translator.TranslateStr(908),
      this.translator.TranslateStr(559),
      hint,
      catView,
      this.getValueInteger("rotation")
    );
    push(
      "orthogonal",
      this.translator.TranslateStr(909),
      this.translator.TranslateStr(568),
      hint,
      catView,
      this.getValueBoolean("orthogonal")
    );
    push(
      "zoom",
      this.translator.TranslateStr(910),
      this.translator.TranslateStr(559),
      hint,
      catView,
      this.getValueInteger("zoom")
    );
    push(
      "horzOffset",
      this.translator.TranslateStr(911),
      this.translator.TranslateStr(559),
      hint,
      catView,
      this.getValueNumber("horzOffset")
    );
    push(
      "vertOffset",
      this.translator.TranslateStr(912),
      this.translator.TranslateStr(559),
      hint,
      catView,
      this.getValueNumber("vertOffset")
    );
    push(
      "tilt",
      this.translator.TranslateStr(913),
      this.translator.TranslateStr(559),
      hint,
      catView,
      this.getValueInteger("tilt")
    );
    push(
      "resolution",
      this.translator.TranslateStr(666),
      this.translator.TranslateStr(559),
      hint,
      catView,
      this.getValueInteger("resolution")
    );
    push(
      "multiBar",
      this.translator.TranslateStr(914),
      this.translator.TranslateStr(569),
      hint,
      catView,
      this.getValueBoolean("multiBar")
    );
    push(
      "showHint",
      this.translator.TranslateStr(1228),
      this.translator.TranslateStr(568),
      hint,
      catView,
      this.getValueBoolean("showHint")
    );
    push(
      "showLegend",
      this.translator.TranslateStr(1229),
      this.translator.TranslateStr(568),
      hint,
      catView,
      this.getValueBoolean("showLegend")
    );
    push(
      "markStyle",
      this.translator.TranslateStr(1351),
      this.translator.TranslateStr(569),
      hint,
      catView,
      this.getValueInteger("markStyle")
    );
    push(
      "vertFontSize",
      this.translator.TranslateStr(1361),
      this.translator.TranslateStr(559),
      hint,
      catView,
      this.getValueInteger("vertFontSize")
    );
    push(
      "horzFontSize",
      this.translator.TranslateStr(1363),
      this.translator.TranslateStr(559),
      hint,
      catView,
      this.getValueInteger("horzFontSize")
    );
    push(
      "vertFontRotation",
      this.translator.TranslateStr(1362),
      this.translator.TranslateStr(559),
      hint,
      catView,
      this.getValueInteger("vertFontRotation")
    );
    push(
      "horzFontRotation",
      this.translator.TranslateStr(1376),
      this.translator.TranslateStr(559),
      hint,
      catView,
      this.getValueInteger("horzFontRotation")
    );
    push(
      "autoRange",
      this.verticalAxisAutoRangeName,
      this.translator.TranslateStr(569),
      hint,
      catView,
      this.getValueInteger("autoRange")
    );
    push(
      "axisYInitial",
      this.verticalAxisMinimum,
      this.translator.TranslateStr(1171),
      hint,
      catView,
      this.getValueNumber("axisYInitial")
    );
    push(
      "axisYFinal",
      this.verticalAxisMaximum,
      this.translator.TranslateStr(1171),
      hint,
      catView,
      this.getValueNumber("axisYFinal")
    );
  }

  public override GetProperty(pname: string): any {
    switch (pname) {
      case "valueExpression":
      case "valueXExpression":
      case "identifier":
      case "getValueCondition":
      case "changeSerieExpression":
      case "clearExpression":
      case "clearExpressionBool":
      case "captionExpression":
      case "serieCaption":
      case "colorExpression":
      case "serieColorExpression":
        return this.getValueString(pname);
      case "chartStyle":
      case "driver":
      case "perspective":
      case "elevation":
      case "zoom":
      case "rotation":
      case "tilt":
      case "resolution":
      case "showHint":
      case "markStyle":
      case "vertFontSize":
      case "horzFontSize":
      case "vertFontRotation":
      case "horzFontRotation":
      case "autoRange":
        return this.getValueInteger(pname);
      case "changeSerieBool":
      case "view3d":
      case "view3dWalls":
      case "orthogonal":
      case "showLegend":
      case "multiBar":
        return this.getValueBoolean(pname);
      case "horzOffset":
      case "vertOffset":
      case "axisYInitial":
      case "axisYFinal":
        return this.getValueNumber(pname);
      default:
        return super.GetProperty(pname);
    }
  }
  public override SetProperty(pname: string, newvalue: any): void {
    switch (pname) {
      case "valueExpression":
      case "valueXExpression":
      case "identifier":
      case "chartStyle":
      case "getValueCondition":
      case "changeSerieExpression":
      case "changeSerieBool":
      case "clearExpression":
      case "clearExpressionBool":
      case "captionExpression":
      case "serieCaption":
      case "colorExpression":
      case "serieColorExpression":
      case "driver":
      case "view3d":
      case "view3dWalls":
      case "perspective":
      case "elevation":
      case "rotation":
      case "orthogonal":
      case "zoom":
      case "horzOffset":
      case "vertOffset":
      case "tilt":
      case "resolution":
      case "multiBar":
      case "showHint":
      case "showLegend":
      case "markStyle":
      case "vertFontSize":
      case "horzFontSize":
      case "vertFontRotation":
      case "horzFontRotation":
      case "autoRange":
      case "axisYInitial":
      case "axisYFinal":
        this.setValue(pname, newvalue);
        break;
      default:
        super.SetProperty(pname, newvalue);
        break;
    }

    // if (chart.drawHelper) {
    //   chart.drawHelper.bitmap = null;
    // }
  }

  public override GetPropertyValues(pname: string, lpossiblevalues: string[]): void {
    const t = this.translator.TranslateStr;

    switch (pname) {
      case "chartStyle":
        lpossiblevalues.push(
          t(895),
          t(897),
          t(896),
          t(898),
          t(899),
          t(900),
          t(901),
          t(902),
          t(903),
          "Splines",
          "CandleStick",
          "Pyramid",
          "Polar",
          "PointFigure",
          "Funnel",
          "Kagi",
          "Doughnut",
          "Radar",
          "Renko",
          "ErrorBar"
        );
        break;
      case "driver":
        lpossiblevalues.push(t(95), t(893), t(894));
        break;
      case "multiBar":
        lpossiblevalues.push(t(915), t(916), t(917), t(918));
        break;
      case "markStyle":
        lpossiblevalues.push(
          t(1352),
          t(1353),
          t(1354),
          t(1355),
          "Valor 2 dec",
          "Valor 3 dec",
          "Porc. 1 dec"
        );
        break;
      case "autoRange":
        lpossiblevalues.push(t(1452), t(1453), t(1454), t(1455), t(1456));
        break;
      default:
        super.GetPropertyValues(pname, lpossiblevalues);
        break;
    }
  }
}
