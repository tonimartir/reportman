// Reports built in code, as the C# console tests build them (Report.CreateNew, AddSubReport and
// the items of a section): a user page size, the margins, one subreport with a detail section.

import {
  ExpressionItem,
  LabelItem,
  PageSizeType,
  Report,
  Section,
  SectionType,
  ShapeItem,
  SubReport,
  type PrintPosItem,
} from '@reportman/lib';

export interface PageOptions {
  width?: number;
  height?: number;
  margin?: number;
}

let counter = 0;
const nextName = (prefix: string): string => prefix + String(++counter);

/** Report.CreateNew with a user page size (A4 by default) and the same margin on every side. */
export function newReport(options: PageOptions = {}): Report {
  const report = new Report();
  report.pageSize = PageSizeType.User;
  report.customPageWidth = options.width ?? 11906;
  report.customPageHeight = options.height ?? 16838;
  const margin = options.margin ?? 0;
  report.leftMargin = margin;
  report.topMargin = margin;
  report.rightMargin = margin;
  report.bottomMargin = margin;
  addSubReport(report);
  return report;
}

/** AddSubReport: a new subreport with a detail section. */
export function addSubReport(report: Report): SubReport {
  const sub = new SubReport();
  sub.name = nextName('TRPSUBREPORT');
  const detail = new Section();
  detail.name = nextName('TRPSECTION');
  detail.sectionType = SectionType.Detail;
  detail.subReportName = sub.name;
  detail.width = SubReport.defaultSectionWidth;
  sub.sections.push(detail);
  report.subReports.push(sub);
  return sub;
}

/** The first detail section of a subreport (the first subreport by default). */
export function detailOf(report: Report, sub: SubReport = report.subReports[0]!): Section {
  return sub.sections[SubReport.firstDetail(sub)]!;
}

function add<T extends PrintPosItem>(section: Section, item: T, prefix: string, set: Partial<T>): T {
  item.name = nextName(prefix);
  Object.assign(item, set);
  section.components.push(item);
  return item;
}

export function addLabel(section: Section, text: string, set: Partial<LabelItem> = {}): LabelItem {
  return add(section, new LabelItem(), 'TRPLABEL', { allStrings: [text], ...set });
}

export function addExpression(section: Section, expression: string, set: Partial<ExpressionItem> = {}): ExpressionItem {
  return add(section, new ExpressionItem(), 'TRPEXPRESSION', { expression, ...set });
}

export function addShape(section: Section, set: Partial<ShapeItem> = {}): ShapeItem {
  return add(section, new ShapeItem(), 'TRPSHAPE', set);
}
