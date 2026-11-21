import { PrintPosItem } from "./print-pos-item.js";
import { ReportItem } from "./report-item.js";
import { Report } from "./report.js";
import { Section, SectionType } from "./section.js";

/**
 * C# SubReport: the defaults are the ones of its constructor. As in the engine it is a ReportItem,
 * not a PrintItem: a subreport has no size, print condition nor print events.
 */
export class SubReport extends ReportItem {
  /** The dataset the subreport is bound to; empty: no data. */
  public alias = "";
  public printOnlyIfDataAvailable = true;
  public reOpenOnPrint = true;
  /** The parent subreport, by name (uppercase as the reader stores it); empty: none. */
  public parentSub = "";
  /** The section of the parent subreport that owns this one, by name (uppercase); empty: none. */
  public parentSec = "";
  public sections: Section[] = [];
  constructor() {
    super();
    this.className = "TRPSUBREPORT";
  }
  public static firstDetail(subreport: SubReport): number {
    for (let idx = 0; idx < subreport.sections.length; idx++) {
      const section = subreport.sections[idx];
      if (section.sectionType == SectionType.Detail) {
        return idx;
      }
    }
    throw new Error("No detail");
  }
  public static detailCount(subreport: SubReport): number {
    let count = 0;
    for (const section of subreport.sections) {
      if (section.sectionType == SectionType.Detail) {
        count++;
      }
    }
    return count;
  }
  /** A new section's width, as Delphi's TRpSection (C_DEFAULT_SECTION_WIDTH): 19 cm in twips. */
  public static readonly defaultSectionWidth = Math.round((19 / 2.54) * 1440);
  public static initNew(report: Report, subreport: SubReport) {
    const detailSection = new Section();
    detailSection.sectionType = SectionType.Detail;
    detailSection.width = SubReport.defaultSectionWidth;
    detailSection.height = Math.round((2 / 2.54) * 1440);
    report.newName(detailSection);
    subreport.sections = [];
    subreport.sections.push(detailSection);
  }
  public static getSectionAddIndex(subreport: SubReport, section: Section): number | undefined {
    let waitForType = SectionType.Detail;
    switch (section.sectionType) {
      case SectionType.GroupFooter:
        waitForType = SectionType.GroupFooter;
        break;
      case SectionType.PageFooter:
        waitForType = SectionType.PageFooter;
        break;
      case SectionType.PageHeader:
        return 0;
      case SectionType.Detail:
        break;
    }
    let idx = 0;
    for (; idx < subreport.sections.length; idx++) {
      const sec = subreport.sections[idx];
      if (sec.sectionType == waitForType) {
        break;
      }
      if (sec.sectionType == SectionType.PageFooter && waitForType == SectionType.GroupFooter) {
        break;
      }
    }
    if (idx >= subreport.sections.length) {
      return undefined;
    } else {
      return idx;
    }
  }
  public clone(): SubReport {
    const dup = new SubReport();
    Object.assign(dup, this);
    dup.sections = [];
    for (const sec of this.sections) {
      const newSec = new Section();
      Object.assign(newSec, sec);
      newSec.components = [];
      for (const compo of sec.components) {
        const newCompo = Report.newComponentByClassName(compo.className!) as PrintPosItem;
        Object.assign(newCompo, compo);
        newSec.components.push(newCompo);
      }
      dup.sections.push(newSec);
    }
    return dup;
  }
}
