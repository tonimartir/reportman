// Port of the runtime part of Reportman.Reporting.SubReport: the sections of a subreport, its
// groups (group breaks, group values) and the events it sends to its sections and items.

import type { SubReport as SubReportModel } from '@reportman/lib';
import { messageOf, UnNamedException } from '../util/netexception.js';
import { Variant } from '../variant/variant.js';
import { ReportException } from './errors.js';
import { SubReportEvent } from './items.js';
import type { ReportRuntime } from './report.js';
import { type SectionRuntime, SectionType } from './section.js';

export class SubReportRuntime {
  readonly model: SubReportModel;
  readonly report: ReportRuntime;
  readonly name: string;
  /** The current record is the last one. */
  lastRecord = false;
  /** The group that is breaking (0 when none). */
  currentGroupIndex = 0;
  readonly sections: SectionRuntime[] = [];
  alias: string;
  /** The subreport is a child (C# keeps a reference, only tested for null). */
  parentSubReport: SubReportRuntime | null = null;
  parentSection: SectionRuntime | null = null;
  printOnlyIfDataAvailable: boolean;
  reOpenOnPrint: boolean;
  currentGroupName = '';

  constructor(report: ReportRuntime, model: SubReportModel) {
    this.report = report;
    this.model = model;
    this.name = model.name;
    this.alias = model.alias;
    this.printOnlyIfDataAvailable = model.printOnlyIfDataAvailable;
    this.reOpenOnPrint = model.reOpenOnPrint;
  }

  /** SubReportChanged: updates the group values and page counts and tells every section and item. */
  subReportChanged(aevent: SubReportEvent, newgroup: string): void {
    const newstate = aevent;
    if (newstate === SubReportEvent.Start || newstate === SubReportEvent.SubReportStart) {
      this.fillGroupValues();
      for (const sec of this.sections) sec.clearPageCountList();
    } else {
      let index = -1;
      if (newstate === SubReportEvent.GroupChange) index = this.groupIndex(newgroup);
      else if (newstate === SubReportEvent.SubReportEnd) index = this.groupCount;
      if (index > 0) {
        const ffirstdetail = this.firstDetail;
        const flastdetail = this.lastDetail;
        while (index > 0) {
          this.sectionAt(ffirstdetail - index).updatePageCounts();
          this.sectionAt(ffirstdetail - index).clearPageCountList();
          this.sectionAt(flastdetail + index).updatePageCounts();
          // C# parity: the list cleared is the one of the section after the first detail
          this.sectionAt(ffirstdetail + index).clearPageCountList();
          index--;
        }
      }
    }
    for (const sec of this.sections) {
      sec.subReportChanged(newstate, newgroup);
      for (const compo of sec.components) compo.subReportChanged(newstate, newgroup);
    }
  }

  private sectionAt(index: number): SectionRuntime {
    const s = this.sections[index];
    if (s === undefined) throw new RangeError('Index was out of range. Must be non-negative and less than the size of the collection.');
    return s;
  }

  get firstPageHeader(): number {
    return this.firstSectionThatIs(SectionType.PageHeader);
  }

  get lastPageHeader(): number {
    return this.lastSectionThatIs(SectionType.PageHeader);
  }

  /** NumberOfSectionsOfType: the sections of a type from the first one of that type on. */
  numberOfSectionsOfType(atype: SectionType): number {
    let index = this.firstSectionThatIs(atype);
    let count = 0;
    if (index >= 0) {
      while (index < this.sections.length) {
        if (this.sections[index]!.sectionType === atype) count++;
        index++;
      }
    }
    return count;
  }

  /** GroupIndex: the group number of a group header by name (-1 when none). */
  groupIndex(groupname: string): number {
    let index = this.firstSectionThatIs(SectionType.GroupHeader);
    let aresult = -1;
    if (index >= 0) {
      while (index < this.sections.length) {
        if (this.sections[index]!.sectionType !== SectionType.GroupHeader) break;
        if (this.sections[index]!.groupName === groupname) {
          aresult = this.firstDetail - index;
          break;
        }
        index++;
      }
    }
    return aresult;
  }

  get pageHeaderCount(): number {
    return this.numberOfSectionsOfType(SectionType.PageHeader);
  }

  get pageFooterCount(): number {
    return this.numberOfSectionsOfType(SectionType.PageFooter);
  }

  get firstPageFooter(): number {
    return this.firstSectionThatIs(SectionType.PageFooter);
  }

  get lastPageFooter(): number {
    return this.lastSectionThatIs(SectionType.PageFooter);
  }

  get firstDetail(): number {
    return this.firstSectionThatIs(SectionType.Detail);
  }

  get detailCount(): number {
    if (this.sections.length === 0) return 0;
    return this.lastSectionThatIs(SectionType.Detail) - this.firstSectionThatIs(SectionType.Detail) + 1;
  }

  get lastDetail(): number {
    return this.lastSectionThatIs(SectionType.Detail);
  }

  get groupCount(): number {
    return this.numberOfSectionsOfType(SectionType.GroupHeader);
  }

  firstSectionThatIs(atype: SectionType): number {
    for (let i = 0; i < this.sections.length; i++) if (this.sections[i]!.sectionType === atype) return i;
    return -1;
  }

  lastSectionThatIs(atype: SectionType): number {
    let aresult = -1;
    for (let i = 0; i < this.sections.length; i++) if (this.sections[i]!.sectionType === atype) aresult = i;
    return aresult;
  }

  /** InitGroups: a group change for each group from groupindex down to the detail. */
  initGroups(groupindex: number): void {
    const afirstdetail = this.firstDetail;
    let i = afirstdetail - groupindex;
    while (i < afirstdetail) {
      this.subReportChanged(SubReportEvent.GroupChange, this.sectionAt(i).groupName);
      i++;
    }
  }

  /** IsDataAvailable: the subreport has data to print. */
  isDataAvailable(): boolean {
    if (this.alias.length === 0) return true;
    if (!this.printOnlyIfDataAvailable) return true;
    let aresult = false;
    const index = this.report.dataInfoIndexOf(this.alias);
    if (index < 0) throw new UnNamedException('Data alias not found' + this.alias);
    const data = this.report.dataInfos[index]!.data;
    if (data.active && !data.eof) aresult = true;
    return aresult;
  }

  /** GroupChanged: the outermost group that breaks with the current record (0 when none). */
  groupChanged(): number {
    const agroupcount = this.groupCount;
    let acount = agroupcount;
    const afirstdetail = this.firstDetail;
    let i = afirstdetail - agroupcount;
    const ev = this.report.evaluator;
    let aresult = 0;
    while (i < afirstdetail) {
      const sec = this.sectionAt(i);
      ev.expression = sec.changeExpression;
      ev.evaluate();
      if (sec.changeBool) {
        if (ev.result.toBool(ev.context)) {
          aresult = acount;
          this.fillGroupValues();
          break;
        }
      } else if (Variant.notEquals(ev.result, sec.groupValue, ev.context)) {
        aresult = acount;
        this.fillGroupValues();
        break;
      }
      i++;
      acount--;
    }
    this.currentGroupIndex = aresult;
    return aresult;
  }

  private fillGroupValues(): void {
    this.currentGroupName = '';
    this.currentGroupIndex = 0;
    const indexdetail = this.firstDetail;
    const ev = this.report.evaluator;
    for (let i = 0; i < indexdetail; i++) {
      const sec = this.sectionAt(i);
      try {
        if (sec.sectionType === SectionType.GroupHeader) {
          ev.expression = sec.changeExpression;
          ev.evaluate();
          sec.groupValue = ev.result;
        }
      } catch (e) {
        throw new ReportException(messageOf(e), this.name, 'GroupChange');
      }
    }
  }
}
