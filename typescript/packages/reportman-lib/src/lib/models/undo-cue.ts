import { Report } from "./report.js";
import { ReportItem } from "./report-item.js";
import { Section } from "./section.js";
import { SubReport } from "./sub-report.js";
import { Param } from "./param.js";
import { PrintPosItem } from "./print-pos-item.js";
import { DataInfo } from "./data-info.js";
import { DatabaseInfo } from "./database-info.js";
import { ArrayUtil } from "./array-util.js";
import { Fecha } from "../../util/fecha.js";
import { Variant, VariantType } from "./variant.js";

export class UndoCue {
  public groupId = 0;
  public undoOperations: ChangeObjectOperation[] = [];
  public redoOperations: ChangeObjectOperation[] = [];
  public addOperation(op: ChangeObjectOperation, report: Report) {
    if (!report.modified) {
      report.modified = true;
    }
    this.undoOperations.push(op);
    // se pierde el redo al hacer una nueva operación
    // esto es normal sino complicaría la elección de la implementación
    // y ramas de rehacer
    this.redoOperations = [];
  }
  public getGroupId() {
    if (this.undoOperations.length > 0 || (this.redoOperations.length > 0 && !this.groupId)) {
      if (this.undoOperations.length > 0) {
        this.groupId = this.undoOperations[this.undoOperations.length - 1].groupId;
      }
      if (this.redoOperations.length > 0) {
        const newGroupId = this.redoOperations[0].groupId;
        this.groupId = Math.max(this.groupId, newGroupId);
      }
    }
    this.groupId++;
    return this.groupId;
  }
  public clear() {
    this.undoOperations.splice(0, this.undoOperations.length);
    this.redoOperations.splice(0, this.redoOperations.length);
  }

  public undo(report: Report): ChangeObjectOperation[] | undefined {
    if (this.undoOperations.length == 0) {
      return undefined;
    }
    const operations: ChangeObjectOperation[] = [];
    const gId = this.undoOperations[this.undoOperations.length - 1].groupId;
    let newGroupId = gId;
    while (newGroupId == gId) {
      const op = this.undoOperations.pop();
      if (!op) {
        break;
      }
      operations.push(op);
      this.applyOperation(op, true, report);
      this.redoOperations.push(op);
      if (this.undoOperations.length == 0) {
        break;
      }
      newGroupId = this.undoOperations[this.undoOperations.length - 1].groupId;
    }
    return operations;
  }

  public redo(report: Report): ChangeObjectOperation[] | undefined {
    if (this.redoOperations.length == 0) {
      return undefined;
    }
    const operations: ChangeObjectOperation[] = [];
    const gId = this.redoOperations[this.redoOperations.length - 1].groupId;
    let newGroupId = gId;
    while (newGroupId == gId) {
      const op = this.redoOperations.pop();
      if (!op) {
        break;
      }
      operations.push(op);
      this.applyOperation(op, false, report);
      this.undoOperations.push(op);
      if (this.redoOperations.length == 0) {
        break;
      }
      newGroupId = this.redoOperations[this.redoOperations.length - 1].groupId;
    }
    return operations;
  }
  private getComponentByName(name: string, report: Report): ReportItem | Report | undefined {
    return report.getComponentByName(name);
  }
  private applySwapOperation(
    className: string,
    down: boolean,
    oldIndex: number,
    report: Report,
    parentName?: string
  ) {
    const increment = down ? 1 : -1;
    let array: any[] = [];
    switch (className) {
      case "TRPSUBREPORT":
        array = report.subReports;
        break;
      case "TRPPRINTPOSITEM":
        {
          const section = this.getComponentByName(parentName!, report) as Section;
          array = section.components;
        }
        break;
      case "TRPSECTION":
        {
          const subreport = this.getComponentByName(parentName!, report) as SubReport;
          array = subreport.sections;
        }
        break;
      case "TRPPARAM":
        array = report.params;
        break;
      case "TRPDATAINFOITEM":
        array = report.dataInfo;
        break;
      case "TRPDATABASEINFOITEM":
        array = report.databaseInfo;
        break;
      default:
        throw new Error("Swap not supported for className: " + className);
    }
    ArrayUtil.swap(array, oldIndex, oldIndex + increment);
  }
  private applyOperation(operation: ChangeObjectOperation, isUndo: boolean, report: Report) {
    let target: Report | ReportItem | undefined = undefined;
    let loadTarget = true;
    if (!report.modified) {
      report.modified = true;
    }
    switch (operation.operation) {
      case OperationType.Add:
        if (!isUndo) {
          loadTarget = false;
        }
        break;
      case OperationType.SwapDown:
      case OperationType.SwapUp:
        this.applySwapOperation(
          operation.componentClass!,
          operation.operation == OperationType.SwapDown,
          operation.oldItemIndex!,
          report,
          operation.parentName
        );
        return;
      case OperationType.Rename:
        {
          const oldName = isUndo
            ? (operation.oldParentName as string)
            : (operation.componentName as string);
          const newName = isUndo
            ? (operation.componentName as string)
            : (operation.oldParentName as string);
          const compo = this.getComponentByName(newName, report) as ReportItem;
          compo.name = oldName;
          report.components.delete(newName.toUpperCase());
          report.components.set(oldName.toUpperCase(), compo);
        }
        return;
      case OperationType.Remove:
        if (isUndo) {
          loadTarget = false;
          // Undo remove must create the new element
          target = Report.newComponentByClassName(operation.componentClass!);
          target.name = operation.componentName!;
          if (operation.parentName) {
            const parentCompo = this.getComponentByName(operation.parentName, report) as ReportItem;
            if (!parentCompo) {
              throw new Error("Parent section name not found: " + operation.parentName);
            }
            if (parentCompo.className == "TRPSECTION") {
              const parentSec = parentCompo as Section;
              parentSec.components.splice(operation.oldItemIndex!, 0, target as PrintPosItem);
            } else {
              const parentSub = this.getComponentByName(operation.parentName, report) as SubReport;
              if (!parentSub) {
                throw new Error("Parent section name not found: " + operation.parentName);
              }
              parentSub.sections.splice(operation.oldItemIndex!, 0, target as Section);
            }
          } else {
            // Add to reort element array
            switch (target.className) {
              case "TRPDATAINFOITEM":
                report.dataInfo.splice(operation.oldItemIndex!, 0, target as DataInfo);
                break;
              case "TRPDATABASEINFOITEM":
                report.databaseInfo.splice(operation.oldItemIndex!, 0, target as DatabaseInfo);
                break;
              case "TRPPARAM":
                report.params.splice(operation.oldItemIndex!, 0, target as Param);
                break;
              case "TRPSUBREPORT":
                report.subReports.splice(operation.oldItemIndex!, 0, target as SubReport);
                break;
            }
          }
          report.components.set(operation.componentName!.toUpperCase(), target);
        } else {
          // Redo remove operation
          target = this.getComponentByName(operation.componentName!, report) as SubReport;
          if (!target) {
            throw new Error("Error target not assigned redo operation");
          }
          report.deleteItem(target as ReportItem, 0);
          return;
        }
        break;
      default:
        loadTarget = true;
    }
    if (loadTarget) {
      target = this.getComponentByName(operation.componentName!, report);
    }
    let parentSection: Section | undefined = undefined;
    let parentSubreport: SubReport | undefined = undefined;
    if (operation.operation == OperationType.Add) {
      if (operation.parentName) {
        const parentItem = this.getComponentByName(operation.parentName, report) as ReportItem;
        if (!parentItem) {
          throw new Error("Parent item not found: " + operation.parentName);
        }
        if (parentItem.className == "TRPSECTION") {
          parentSection = parentItem as Section;
        } else {
          parentSubreport = parentItem as SubReport;
        }
      }
      if (isUndo) {
        if (!target) {
          return;
        }
        const targetReportItem = target as ReportItem;
        if (parentSection) {
          for (let idx = 0; idx < parentSection.components.length; idx++) {
            const componentToRemove = parentSection.components[idx];
            if (componentToRemove.name == operation.componentName) {
              parentSection.components.splice(idx, 1);
              operation.oldItemIndex = idx;
              report.components.delete(componentToRemove.name.toUpperCase());
              return;
            }
          }
          throw new Error("Component not found");
        } else {
          switch (targetReportItem.className) {
            case "TRPSECTION":
              if (!parentSubreport) {
                throw new Error("No parentSubreport");
              }
              for (let i = 0; i < parentSubreport.sections.length; i++) {
                if (parentSubreport.sections[i].name == targetReportItem.name) {
                  parentSubreport.sections.splice(i, 1);
                  operation.oldItemIndex = i;
                  report.components.delete(targetReportItem.name.toUpperCase());
                  return;
                }
              }
              throw new Error("Section not found");
            case "TRPSUBREPORT":
              for (let i = 0; i < report.subReports.length; i++) {
                if (report.subReports[i].name == targetReportItem.name) {
                  report.subReports.splice(i, 1);
                  operation.oldItemIndex = i;
                  report.components.delete(targetReportItem.name.toUpperCase());
                  return;
                }
              }
              throw new Error("Subreport not found");
            case "TRPDATAINFOITEM":
              for (let i = 0; i < report.dataInfo.length; i++) {
                if (report.dataInfo[i].name == targetReportItem.name) {
                  report.dataInfo.splice(i, 1);
                  operation.oldItemIndex = i;
                  report.components.delete(targetReportItem.name.toUpperCase());
                  return;
                }
              }
              throw new Error("DataInfo not found");
            case "TRPDATABASEINFOITEM":
              for (let i = 0; i < report.databaseInfo.length; i++) {
                if (report.databaseInfo[i].name == targetReportItem.name) {
                  report.databaseInfo.splice(i, 1);
                  operation.oldItemIndex = i;
                  report.components.delete(targetReportItem.name.toUpperCase());
                  return;
                }
              }
              throw new Error("Database info not found");
            case "TRPPARAM":
              for (let i = 0; i < report.params.length; i++) {
                if (report.params[i].name == targetReportItem.name) {
                  report.params.splice(i, 1);
                  report.components.delete(targetReportItem.name.toUpperCase());
                  return;
                }
              }
              throw new Error("Param not found");
          }
        }
      } else {
        target = Report.newComponentByClassName(operation.componentClass!);
        target.name = operation.componentName!;
        report.components.set(target.name.toUpperCase(), target);
        if (parentSection) {
          const targetPrintPosItem = target as PrintPosItem;
          parentSection.components.splice(operation.oldItemIndex ?? 0, 0, targetPrintPosItem);
        } else {
          if (parentSubreport) {
            parentSubreport.sections.splice(operation.oldItemIndex ?? 0, 0, target as Section);
          } else {
            switch (target.className) {
              case "TRPPARAM":
                report.params.splice(operation.oldItemIndex ?? 0, 0, target as Param);
                break;
              case "TRPDATAINFOITEM":
                report.dataInfo.splice(operation.oldItemIndex ?? 0, 0, target as DataInfo);
                break;
              case "TRPDATABASEINFOITEM":
                report.databaseInfo.splice(operation.oldItemIndex ?? 0, 0, target as DatabaseInfo);
                break;
              case "TRPSUBREPORT":
                report.subReports.splice(operation.oldItemIndex ?? 0, 0, target as SubReport);
                break;
              default:
                throw new Error("Class not found: " + target.className);
            }
          }
        }
      }
    }
    if (operation.parentName && operation.oldParentName) {
      // Canvio del padre
      const newParentName = isUndo ? operation.oldParentName : operation.parentName;
      const oldParentName = isUndo ? operation.parentName : operation.oldParentName;
      const oldParentSection = this.getComponentByName(oldParentName, report) as Section;
      const newParentSection = this.getComponentByName(newParentName, report) as Section;
      if (!oldParentSection) {
        throw new Error("Can not undo/redo");
      }
      if (!newParentSection) {
        throw new Error("Can not undo/redo");
      }
      const indexOld = oldParentSection.components.indexOf(target as PrintPosItem);
      if (indexOld < 0) {
        throw new Error("Component not found");
      }
      oldParentSection.components.splice(indexOld, 1);
      newParentSection.components.push(target as PrintPosItem);
    }
    this.applyPropertiesToObject(operation, target as ReportItem, isUndo);
  }
  public applyPropertiesToObject(
    operation: ChangeObjectOperation,
    item: ReportItem,
    isUndo: boolean
  ) {
    for (const prop of operation.properties) {
      let value: any | undefined = undefined;
      const newVal =
        isUndo && operation.operation !== OperationType.Remove ? prop.oldValue : prop.newValue;
      switch (prop.propertyType) {
        case PropertyType.Date:
          value = Fecha.fromDateTimeESString(newVal);
          break;
        case PropertyType.StringArray:
          // Copia: asignar la referencia almacenada dejaría el histórico de
          // deshacer expuesto a mutaciones de ediciones posteriores.
          value = Array.isArray(newVal) ? [...newVal] : newVal;
          break;
        case PropertyType.Variant:
          {
            const valVariant: Variant = { type: VariantType.String, value: "" };
            const oldVariant = newVal as Variant;
            valVariant.type = oldVariant.type;
            valVariant.value = oldVariant.value;
            switch (valVariant.type) {
              case VariantType.DateTime:
                if (typeof oldVariant.value === "string") {
                  valVariant.value = Fecha.fromISODateTimeString(oldVariant.value);
                }
                break;
            }
            value = valVariant;
          }
          break;
        default:
          value = newVal;
          break;
      }
      // The engine (the cloud's design library, Delphi, C#) names properties as it declares them
      // (FontStyle); this model uses camelCase (fontStyle). The operation applies to the real one.
      const propName = resolvePropertyName(item, prop.propertyName!);
      (item as any)[propName] = value;
    }
  }
}

/** The item's own spelling of a property named by any client: exact, then case-insensitive, then camelCase. */
export function resolvePropertyName(item: object, name: string): string {
  if (name in item) return name;
  const lower = name.toLowerCase();
  for (let proto: any = item; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key.toLowerCase() === lower) return key;
    }
  }
  return name.length ? name[0].toLowerCase() + name.slice(1) : name;
}

export class ChangeObjectOperation {
  public componentName?: string;
  public componentClass?: string;
  public parentName?: string;
  public oldItemIndex?: number;
  public oldParentName?: string;
  public date: Date = new Date();
  public properties: ChangeOperationItem[] = [];
  public expandedProperties = true;
  constructor(
    public operation: OperationType,
    public groupId: number
  ) {}

  public addProperty(propName: string, propType: PropertyType, oldValue: any, newValue: any) {
    this.properties.push(new ChangeOperationItem(propName, propType, oldValue, newValue));
    if (this.properties.length > 5) {
      this.expandedProperties = false;
    }
  }
}

export class ChangeOperationItem {
  constructor(
    public propertyName: string,
    public propertyType: PropertyType,
    public oldValue?: any,
    public newValue?: any
  ) {}
}

export enum PropertyType {
  Integer = 1,
  Number = 2,
  String = 3,
  Date = 4,
  Binary = 5,
  Boolean = 6,
  Variant = 7,
  StringArray = 8,
}

export enum OperationType {
  Add,
  Modify,
  Remove,
  SwapDown,
  SwapUp,
  Rename,
}
