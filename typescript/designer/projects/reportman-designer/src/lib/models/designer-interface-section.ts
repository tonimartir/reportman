import {
  Section,
  ReportItem,
  SkipType,
  BackStyleType,
  ImageDrawStyleType,
  SharedImageType,
  SectionType,
} from "@reportman/lib";
import { DesignerInterfaceSize } from "./designer-interface-size";
import { IObjectInspector } from "../interfaces/object-inspector.interface";
import { TranslationService } from "../services/translator.service";
import { DesignUtils } from "./design-utils";

export class DesignerInterfaceSection extends DesignerInterfaceSize {
  private FSection?: Section;

  constructor(
    nreport: any,
    nrepitem: Map<number, ReportItem>,
    nobjinsp: IObjectInspector,
    ntranslator: TranslationService
  ) {
    super(nreport, nrepitem, nobjinsp, ntranslator);
    if (nrepitem.size === 1) {
      this.FSection = nrepitem.values().next().value as Section;
    }
  }

  public get section(): Section {
    if (!this.FSection) {
      throw new Error("Item not assigned");
    }
    return this.FSection;
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
    super.GetProperties(lnames, llabels, ltypes, lvalues, lhints, lcat, lorder);

    const tr = this.translator.TranslateStr.bind(this.translator);
    const ref = "refsection.html";
    const cat = tr(280);

    const sectionType = this.section.sectionType;

    if (
      sectionType === SectionType.PageFooter ||
      sectionType === SectionType.PageHeader ||
      sectionType === SectionType.GroupFooter ||
      sectionType === SectionType.GroupHeader
    ) {
      lnames.push("global");
      llabels.push(tr(486));
      ltypes.push(tr(568));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.global);
    }

    if (sectionType !== SectionType.PageFooter) {
      // AutoExpand
      lnames.push("autoExpand");
      llabels.push(tr(610));
      ltypes.push(tr(568));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.autoExpand);

      // AutoContract
      lnames.push("autoContract");
      llabels.push(tr(611));
      ltypes.push(tr(568));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.autoContract);
    }

    if (sectionType === SectionType.GroupHeader || sectionType === SectionType.GroupFooter) {
      // IniNumPage
      lnames.push("iniNumPage");
      llabels.push(tr(940));
      ltypes.push(tr(568));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.iniNumPage);

      // Group Name
      lnames.push("groupName");
      llabels.push(tr(277));
      ltypes.push(tr(557));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.groupName);

      // Group Expression
      lnames.push("changeExpression");
      llabels.push(tr(615));
      ltypes.push(tr(571));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.changeExpression);

      // Change bool
      lnames.push("changeBool");
      llabels.push(tr(616));
      ltypes.push(tr(568));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.changeBool);

      if (sectionType === SectionType.GroupHeader) {
        // Page repeat
        lnames.push("pageRepeat");
        llabels.push(tr(617));
        ltypes.push(tr(568));
        lhints.push(ref);
        lcat.push(cat);
        lvalues?.push(this.section.pageRepeat);

        // Footer at report end
        lnames.push("forcePrint");
        llabels.push(tr(919));
        ltypes.push(tr(568));
        lhints.push(ref);
        lcat.push(cat);
        lvalues?.push(this.section.forcePrint);
      }
    }

    if (
      sectionType === SectionType.GroupHeader ||
      sectionType === SectionType.GroupFooter ||
      sectionType === SectionType.Detail
    ) {
      // Begin page
      lnames.push("beginPageExpression");
      llabels.push(tr(618));
      ltypes.push(tr(571));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.beginPageExpression);

      // Skip page
      lnames.push("skipPage");
      llabels.push(tr(619));
      ltypes.push(tr(568));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.skipPage);

      // Align bottom
      lnames.push("alignBottom");
      llabels.push(tr(620));
      ltypes.push(tr(568));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.alignBottom);

      // Horz desp
      lnames.push("horzDesp");
      llabels.push(tr(308));
      ltypes.push(tr(568));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.horzDesp);

      // Vert desp
      lnames.push("vertDesp");
      llabels.push(tr(1124));
      ltypes.push(tr(568));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.vertDesp);

      // Skip type
      lnames.push("skipType");
      llabels.push(tr(926));
      ltypes.push(tr(569));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.skipType as number);

      // Skip to page
      lnames.push("skipToPageExpre");
      llabels.push(tr(927));
      ltypes.push(tr(571));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.skipToPageExpre);

      // Skip Expre H
      lnames.push("skipExpreH");
      llabels.push(tr(922));
      ltypes.push(tr(571));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.skipExpreH);

      // Horz relative skip
      lnames.push("skipRelativeH");
      llabels.push(tr(920));
      ltypes.push(tr(568));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.skipRelativeH);

      // Skip Expre V
      lnames.push("skipExpreV");
      llabels.push(tr(923));
      ltypes.push(tr(571));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.skipExpreV);

      // Vert relative skip
      lnames.push("skipRelativeV");
      llabels.push(tr(921));
      ltypes.push(tr(568));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.skipRelativeV);

      // Child subreport
      lnames.push("childSubReportName");
      llabels.push(tr(834));
      ltypes.push(tr(961));
      lhints.push(ref);
      lcat.push(cat);
      const newValSub = this.section.childSubReportName
        ? DesignUtils.getSubreportDisplayName(
            this.section.childSubReportName,
            this.translator,
            false
          )
        : "";
      lvalues?.push(newValSub);
    }

    if (sectionType === SectionType.PageFooter) {
      // Print after report end
      lnames.push("forcePrint");
      llabels.push(tr(919));
      ltypes.push(tr(568));
      lhints.push(ref);
      lcat.push(cat);
      lvalues?.push(this.section.forcePrint);
    }

    /* // External section
    lnames.push(tr(830));
    ltypes.push(tr(830));
    lhints.push(ref);
    lcat.push(cat);
    if (lvalues) lvalues.push(this.FSection.ExternalFilename);

    // External Data
    lnames.push(tr(861));
    ltypes.push(tr(861));
    lhints.push(ref);
    lcat.push(cat);
    if (lvalues) lvalues.push(this.FSection.GetExternalDataDescription());*/

    // Back image expression
    lnames.push("backExpression");
    llabels.push(tr(1248));
    ltypes.push(tr(571));
    lhints.push(ref);
    lcat.push(cat);
    lvalues?.push(this.section.backExpression);

    // Image
    lnames.push("streamBase64");
    llabels.push(tr(639));
    ltypes.push(tr(639));
    lhints.push(ref);
    lcat.push(cat);
    if (lvalues) {
      lvalues.push(this.section.streamBase64);
    }

    // DPI Resolution
    lnames.push("dpires");
    llabels.push(tr(666));
    ltypes.push(tr(559));
    lhints.push(ref);
    lcat.push(cat);
    lvalues?.push(this.section.dpires);

    // BackStyle
    lnames.push("backStyle");
    llabels.push(tr(1250));
    ltypes.push(tr(569));
    lhints.push(ref);
    lcat.push(cat);
    lvalues?.push(this.section.backStyle as number);

    // DrawStyle
    lnames.push("drawStyle");
    llabels.push(tr(667));
    ltypes.push(tr(569));
    lhints.push(ref);
    lcat.push(cat);
    lvalues?.push(this.section.drawStyle as number);

    // Shared image mode
    lnames.push("sharedImage");
    llabels.push(tr(1409));
    ltypes.push(tr(569));
    lhints.push(ref);
    lcat.push(cat);
    lvalues?.push(this.section.sharedImage as number);

    // SyncWidth
    lnames.push("syncWidth");
    llabels.push(tr(1481));
    ltypes.push(tr(568));
    lhints.push(ref);
    lcat.push(cat);
    lvalues?.push(this.section.syncWidth);
  }

  public override GetPropertyValues(pname: string, lpossiblevalues: string[]): void {
    if (!this.FSection) {
      throw new Error("Item not assigned");
    }

    if (pname === "skipType") {
      lpossiblevalues.push(
        this.translator.TranslateStr(95),
        this.translator.TranslateStr(924),
        this.translator.TranslateStr(925)
      );
      return;
    }

    if (pname === "childSubReportName") {
      lpossiblevalues.push("");
      for (const sub of this.report.subReports) {
        lpossiblevalues.push(DesignUtils.getSubreportDisplayName(sub.name, this.translator, false));
      }
      return;
    }
    if (pname === "backStyle") {
      this.FillBackStyleDescriptions(lpossiblevalues);
      return;
    }

    if (pname === "drawStyle") {
      this.FillDrawStyleDescriptions(lpossiblevalues);
      return;
    }

    if (pname === "sharedImage") {
      this.FillSharedImageDescriptions(lpossiblevalues);
      return;
    }

    super.GetPropertyValues(pname, lpossiblevalues);
  }

  private FillBackStyleDescriptions(lvalues: string[]): void {
    lvalues.push(
      this.translator.TranslateStr(1251),
      this.translator.TranslateStr(1252),
      this.translator.TranslateStr(1253)
    );
  }

  private FillDrawStyleDescriptions(lvalues: string[]): void {
    lvalues.push(
      this.translator.TranslateStr(636),
      this.translator.TranslateStr(637),
      this.translator.TranslateStr(638),
      this.translator.TranslateStr(668),
      this.translator.TranslateStr(1326)
    );
  }

  private FillSharedImageDescriptions(lvalues: string[]): void {
    lvalues.push(
      this.translator.TranslateStr(294),
      this.translator.TranslateStr(1420),
      this.translator.TranslateStr(1421)
    );
  }

  public override GetProperty(pname: string): any {
    if (!this.FSection) {
      throw new Error("Item not assigned");
    }

    switch (pname) {
      case "global":
        return this.section.global;
      case "autoExpand":
        return this.section.autoExpand;
      case "autoContract":
        return this.section.autoContract;
      case "iniNumPage":
        return this.section.iniNumPage;
      case "groupName":
        return this.section.groupName;
      case "changeExpression":
        return this.section.changeExpression;
      case "changeBool":
        return this.section.changeBool;
      case "pageRepeat":
        return this.section.pageRepeat;
      case "forcePrint":
        return this.section.forcePrint;
      case "beginPageExpression":
        return this.section.beginPageExpression;
      case "skipPage":
        return this.section.skipPage;
      case "alignBottom":
        return this.section.alignBottom;
      case "horzDesp":
        return this.section.horzDesp;
      case "vertDesp":
        return this.section.vertDesp;
      case "skipType":
        return this.section.skipType;
      case "skipToPageExpre":
        return this.section.skipToPageExpre;
      case "skipExpreH":
        return this.section.skipExpreH;
      case "skipRelativeH":
        return this.section.skipRelativeH;
      case "skipExpreV":
        return this.section.skipExpreV;
      case "skipRelativeV":
        return this.section.skipRelativeV;
      case "syncWidth":
        return this.section.syncWidth;
      case "childSubReportName":
        return this.section.childSubReportName
          ? DesignUtils.getSubreportDisplayName(
              this.section.childSubReportName,
              this.translator,
              false
            )
          : "";
      // case "externalFilename":
      //  return this.section.externalFilename;
      case "backExpression":
        return this.section.backExpression;
      case "streamBase64":
        return this.section.streamBase64;
      case "dpires":
        return this.section.dpires;
      case "backStyle":
        return this.section.backStyle;
      case "drawStyle":
        return this.section.drawStyle;
      case "sharedImage":
        return this.section.sharedImage;
    }
    super.GetProperty(pname);
  }

  public override SetProperty(pname: string, newvalue: any): void {
    if (!this.section) {
      throw new Error("Item not assigned");
    }

    const s = this.section;

    switch (pname) {
      case "global":
        s.global = newvalue;
        return;
      case "autoExpand":
        s.autoExpand = newvalue;
        return;
      case "autoContract":
        s.autoContract = newvalue;
        return;
      case "iniNumPage":
        s.iniNumPage = newvalue;
        return;
      case "groupName":
        s.groupName = newvalue;
        return;
      case "changeExpression":
        s.changeExpression = newvalue;
        return;
      case "changeBool":
        s.changeBool = newvalue;
        return;
      case "pageRepeat":
        s.pageRepeat = newvalue;
        return;
      case "forcePrint":
        s.forcePrint = newvalue;
        return;
      case "beginPageExpression":
        s.beginPageExpression = newvalue;
        return;
      case "syncWidth":
        s.syncWidth = newvalue;
        return;
      case "skipPage":
        s.skipPage = newvalue;
        return;
      case "alignBottom":
        s.alignBottom = newvalue;
        return;
      case "horzDesp":
        s.horzDesp = newvalue;
        return;
      case "vertDesp":
        s.vertDesp = newvalue;
        return;
      case "skipType":
        s.skipType = newvalue as SkipType;
        return;
      case "skipToPageExpre":
        s.skipToPageExpre = newvalue;
        return;
      case "skipExpreH":
        s.skipExpreH = newvalue;
        return;
      case "skipRelativeH":
        s.skipRelativeH = newvalue;
        return;
      case "skipExpreV":
        s.skipExpreV = newvalue;
        return;
      case "skipRelativeV":
        s.skipRelativeV = newvalue;
        return;
      case "childSubReportName": {
        s.childSubReportName = "";
        for (const subreport of this.report.subReports) {
          const dispName = DesignUtils.getSubreportDisplayName(
            subreport.name,
            this.translator,
            false
          );
          if (dispName == newvalue) {
            s.childSubReportName = newvalue;
            break;
          }
        }
        return;
      }
      case "externalFilename":
        s.externalFilename = newvalue;
        return;
      case "backExpression":
        s.backExpression = newvalue;
        return;
      case "streamBase64": {
        s.streamBase64 = newvalue;
        return;
      }
      case "dpires":
        s.dpires = newvalue;
        return;
      case "backStyle":
        s.backStyle = newvalue as BackStyleType;
        return;
      case "drawStyle":
        s.drawStyle = newvalue as ImageDrawStyleType;
        return;
      case "sharedImage":
        s.sharedImage = newvalue as SharedImageType;
        return;
    }
    super.SetProperty(pname, newvalue);
  }
}
