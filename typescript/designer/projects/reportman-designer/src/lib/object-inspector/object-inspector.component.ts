import {
  Component,
  OnInit,
  OnDestroy,
  EventEmitter,
  ViewContainerRef,
  Input,
  ViewChild,
  ElementRef,
  signal,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { CanvasService } from "../services/canvas.service";
import { DesignerInterface } from "../models/designer-interface";
import {
  ChangeObjectOperation,
  OperationType,
  PropertyType,
  ReportItem,
  ReportItemClassName,
  SubReport,
  Report,
  ReadReportRequest,
  ReadReportOperation,
  ParamType,
  Variant,
  VariantType,
  LabelItem,
  ArrayUtil,
  DataInfo,
} from "@reportman/lib";
import { TranslationService } from "../services/translator.service";
import { IObjectInspector } from "../interfaces/object-inspector.interface";
import { DesignerInterfaceLabel } from "../models/designer-interface-label";
import { DesignerInterfaceImage } from "../models/designer-interface-image";
import { DesignerInterfaceParam } from "../models/designer-interface-param";
import { DesignerInterfaceDataInfo, sameSql } from "../models/designer-interface-datainfo";
import { DesignerInterfaceDbInfo } from "../models/designer-interface-dbinfo";
import { DesignerInterfaceSubReport } from "../models/designer-interface-subreport";
import { DesignerInterfaceSection } from "../models/designer-interface-section";
import { DesignerInterfaceBarcode } from "../models/designer-interface-barcode";
import { DesignerInterfaceSizePos } from "../models/designer-interface-size-pos";
import { DesignerInterfaceShape } from "../models/designer-interface-shape";
import { DesignerInterfaceChart } from "../models/designer-interface-chart";
import { DesignerInterfaceExpression } from "../models/designer-interface-expression";
import { DesignerInterfaceText } from "../models/designer-interface-text";
import { FormsModule } from "@angular/forms";
import {
  ReportEditorComponent,
  SelectedReportItem,
} from "../report-editor/report-editor.component";
import { DesignUtils } from "../models/design-utils";
import {
  FontSelection,
  FontSelectorDialogComponent,
} from "../dialogs/font-selector-dialog/font-selector-dialog.component";
import { Subscription } from "rxjs";
import { DesignerInterfaceReport } from "../models/designer-interface-report";
import { ExpressionDialogComponent } from "../dialogs/expression-dialog/expression-dialog.component";
import { ReportDatasetHelper } from "../models/report-dataset-helper";
import { PeticionSqlDialog, SqlDialogComponent } from "../dialogs/sql-dialog/sql-dialog.component";
import { NgxReportmanLibService } from "../services/ngx-reportman-lib.service";
import { PresentacionService } from "../shell/presentacion.service";
import { ClipboardService } from "../shell/app-services";
import { SharedModule } from "../shell/shared.module";
import { OpcionMenu } from "../shell/opcion-menu";
import { CdkAccordion, CdkAccordionItem } from "@angular/cdk/accordion";
import { FabricObject } from "fabric";
import { ComponentEditorDesign } from "../models/report-editor-design";
import { LabelDialogComponent } from "../dialogs/label-dialog/label-dialog.component";
import { UnionsDialogComponent } from "../dialogs/unions-dialog/unions-dialog.component";
import { UNIONS_PROPERTY_TYPE, applyUnionSettings, knownDatasetFields } from "../models/union-settings";

/** The rotations of a text the menu offers first, in degrees: positive is counterclockwise, as Reportman draws. */
const TEXT_ROTATIONS = [
  { key: "DesignerRotationNone", icon: "matTextRotationNone", degrees: 0 },
  { key: "DesignerRotationAngleUp", icon: "matTextRotationAngleup", degrees: 45 },
  { key: "DesignerRotationAngleDown", icon: "matTextRotationAngledown", degrees: -45 },
  { key: "DesignerRotationUp", icon: "matTextRotateUp", degrees: 90 },
  { key: "DesignerRotationDown", icon: "matTextRotationDown", degrees: -90 },
];
/** The angles of the «Custom angle» submenu. */
const CUSTOM_ANGLES = [90, 75, 60, 45, 30, 15, 0, -15, -30, -45, -60, -75, -90];
/**
 * Properties the inspector shows converted (degrees, an index): the undo history must keep what the
 * report holds, which the item has once it is set, not what the inspector showed.
 */
const CONVERTED_PROPERTIES = ["fontRotation", "rotation", "eccLevel"];

@Component({
  selector: "object-inspector",
  imports: [CommonModule, FormsModule, SharedModule, CdkAccordion, CdkAccordionItem],
  templateUrl: "./object-inspector.component.html",
  styleUrls: ["./object-inspector.component.css"],
})
export class ObjectInspectorComponent implements OnInit, IObjectInspector, OnDestroy {
  @Input() public reportEditor: ReportEditorComponent | null = null;
  /** The panel's title, given by the editor. */
  @Input() public heading = "Propiedades";
  @ViewChild("fileInput") public fileInput?: ElementRef<HTMLInputElement>;

  public selectedInterface?: DesignerInterface;
  public isSinglePrintPosItem = false;
  /**
   * The editor of each property type, by the type's name as the designer interfaces give it: the
   * translated text of its RpKey. Built in the language being spoken and again when it changes (it
   * may finish loading after this component is created), or no type would match.
   */
  private get propertyTypes(): Map<string, PropertyTypeDesign> {
    const version = this.translator.changes();
    if (this.propertyTypesCache?.version !== version) {
      const map = new Map<string, PropertyTypeDesign>();
      map.set(this.translator.TranslateStr(568), PropertyTypeDesign.Boolean);
      map.set(this.translator.TranslateStr(559), PropertyTypeDesign.Integer);
      map.set("TWIPS", PropertyTypeDesign.Twips);
      map.set(this.translator.TranslateStr(569), PropertyTypeDesign.Enum);
      map.set(this.translator.TranslateStr(961), PropertyTypeDesign.StringEnum);
      map.set(this.translator.TranslateStr(200), PropertyTypeDesign.String);
      map.set(this.translator.TranslateStr(1188), PropertyTypeDesign.StringMultiline);

      map.set(this.translator.TranslateStr(135), PropertyTypeDesign.Variant);
      map.set(this.translator.TranslateStr(558), PropertyTypeDesign.Color);
      map.set(this.translator.TranslateStr(560), PropertyTypeDesign.FontName);
      map.set(this.translator.TranslateStr(561), PropertyTypeDesign.FontName);
      map.set(this.translator.TranslateStr(566), PropertyTypeDesign.FontStyle);
      map.set(this.translator.TranslateStr(571), PropertyTypeDesign.Expression);
      map.set("SQL", PropertyTypeDesign.Sql);
      map.set(UNIONS_PROPERTY_TYPE, PropertyTypeDesign.Unions);
      map.set(this.translator.TranslateStr(639), PropertyTypeDesign.Image);
      map.set(this.translator.TranslateStr(135), PropertyTypeDesign.Variant);

      map.set("", PropertyTypeDesign.Category);
      this.propertyTypesCache = { version, map };
    }
    return this.propertyTypesCache.map;
  }
  private propertyTypesCache?: { version: number; map: Map<string, PropertyTypeDesign> };
  protected properties: PropertyValue[] = [];
  protected PropertyTypeDesign = PropertyTypeDesign;
  private canvasSubscription?: Subscription;
  private canvasSubscription2?: Subscription;
  private reportDatasetHelper = new ReportDatasetHelper();

  /** After the document is replaced (AI copilot) the cached functions and columns belong to the old one. */
  public resetDatasetHelper(): void {
    this.reportDatasetHelper = new ReportDatasetHelper();
  }

  protected specialNames = [
    "width",
    "height",
    "posX",
    "posY",
    "align",
    "alignment",
    "vAlignment",
    "wFontName",
    "lFontName",
    "type1Font",
    "printStep",
    "fontSize",
    "fontColor",
    "fontStyle",
    "backColor",
    "fontRotation",
    "rightToLeft",
    "transparent",
    "cutText",
    "wordWrap",
    "isHtml",
    "singleLine",
    "autoExpand",
    "autoContract",
    "skipPage",
    "alignBottom",
    "horzDesp",
    "vertDesp",
    "skipType",
    "streamBase64",
    "dpires",
    "backStyle",
    "drawStyle",
    "sharedImage",
    "syncWidth",
    "shape",
    "penStyle",
    "penColor",
    "penWidth",
    "brushStyle",
    "brushColor",
    "bColor",
    "rotation",
    "chartStyle",
    "view3d",
    "view3dWalls",
    "perspective",
    "elevation",
    "orthogonal",
    "zoom",
    "horzOffset",
    "vertOffset",
    "tilt",
    "resolution",
    "multiBar",
    "showHint",
    "showLegend",
    "markStyle",
    "vertFontSize",
    "horzFontSize",
    "vertFontRotation",
    "horzFontRotation",
    "autoRange",
    "axisYInitial",
    "axisYFinal",
  ];
  protected isItalic = signal(false);
  protected isBold = signal(false);
  protected isUnderline = signal(false);
  protected isStrikedThrough = signal(false);
  protected fontSelection?: FontSelection;
  protected itemSearchValue = signal("");

  constructor(
    private canvasService: CanvasService,
    protected translator: TranslationService,
    private vcr: ViewContainerRef,
    private reportService: NgxReportmanLibService,
    private pres: PresentacionService,

    private clipboardService: ClipboardService
  ) {
  }

  public ngOnInit(): void {
    this.canvasSubscription = this.canvasService.selectionChanged.subscribe((sender) => {
      this.loadObject();

      const items = this.canvasService.getSelectedReportItems(this.reportEditor!);
      if (items && items[0] && items.length == 1) {
        this.itemSearchValue.set(items[0].item.name);
      } else if (items?.length == 0) {
        this.itemSearchValue.set("");
      }
    });
    this.canvasSubscription2 = this.canvasService.beforeSelectionChanged.subscribe((sender) =>
      this.unLoadObject()
    );
  }
  public refreshSubReport(subreport: SubReport): void {
    this.reportEditor?.selectSubReport(subreport);
  }
  public ngOnDestroy(): void {
    this.canvasSubscription?.unsubscribe();
    this.canvasSubscription2?.unsubscribe();
  }

  public unLoadObject() {
    this.isSinglePrintPosItem = false;
    // Commit old values
    for (const prop of this.properties) {
      if (prop.modified) {
        prop.commitValue();
      }
    }
  }
  public selectProperty(propertyName: string) {}

  protected searchObject() {
    if (!this.reportEditor) {
      throw new Error("Report Editor not assigned");
    }
    if (this.itemSearchValue().length == 0) {
      return;
    }

    const subreports = this.reportEditor.report?.subReports;
    if (subreports) {
      const subReportSeleccionado = subreports.find(
        (subreport) => subreport.name.toUpperCase() == this.itemSearchValue().toUpperCase()
      );
      if (subReportSeleccionado) {
        this.canvasService.selectItem(subReportSeleccionado);
        return;
      }

      for (const subreport of subreports) {
        const seccionSeleccionada = subreport.sections.find(
          (section) => section.name.toUpperCase() == this.itemSearchValue().toUpperCase()
        );
        if (seccionSeleccionada) {
          this.canvasService.selectItem(seccionSeleccionada);
          return;
        }
      }
    }

    const itemsSeleccionado = this.reportEditor.report?.components.get(
      this.itemSearchValue().toUpperCase()
    );
    if (!itemsSeleccionado) {
      return;
    }
    this.canvasService.selectItem(itemsSeleccionado);

    const fabricObject = this.canvasService.canvas.getObjects().find((obj) => {
      const compoEditor = (obj as any).componentEditorDesign as ComponentEditorDesign;
      return compoEditor?.component.name.toLowerCase() === this.itemSearchValue().toLowerCase();
    });
    if (!fabricObject) {
      return;
    }
    this.canvasService.selectFabricItems([fabricObject as FabricObject]);
  }

  protected getReportMenuOptions(): OpcionMenu[] {
    const opcionesMenu: OpcionMenu[] = [];

    const objs = this.canvasService.canvas.getObjects() ?? [];
    for (const obj of objs) {
      const component = ((obj as any).componentEditorDesign as ComponentEditorDesign)?.component;
      if (component) {
        const opcionMenu: OpcionMenu = {
          nombre: component.name,
          callback: () => {
            this.canvasService.selectFabricItems([obj]);
          },
        };
        opcionesMenu.push(opcionMenu);
      }
    }

    return opcionesMenu;
  }

  public loadObject() {
    this.isSinglePrintPosItem = false;
    if (!this.reportEditor) {
      throw new Error("Report Editor not assigned");
    }
    this.properties.splice(0, this.properties.length);
    const litems = this.canvasService.getSelectedReportItems(this.reportEditor);
    if (!litems || litems.length == 0) {
      return;
    }
    if (litems.length == 1 && litems[0].ComponentEditor) {
      this.isSinglePrintPosItem = true;
    }

    const propertyNames: string[] = [];
    const propertyLabels: string[] = [];
    const propertyTypes: string[] = [];
    const propertyValues: any[] = [];
    const hints: string[] = [];
    const categories: string[] = [];
    const propertyOrder: (number | null)[] = [];

    this.selectedInterface = this.getDesignerInterfaceFromObject(litems);

    this.selectedInterface.GetProperties(
      propertyNames,
      propertyLabels,
      propertyTypes,
      propertyValues,
      hints,
      categories,
      propertyOrder
    );

    // Reorder the properties according to the specified order
    const sortedIndices = Array.from({ length: propertyNames.length }, (_, i) => i);
    sortedIndices.sort((a, b) => {
      const orderA = propertyOrder[a];
      const orderB = propertyOrder[b];

      // Properties with a null order go last
      if (orderA === null || orderA === undefined) {
        return 1;
      }
      if (orderB === null || orderB === undefined) {
        return -1;
      }

      return orderA - orderB;
    });

    // Reorder the arrays according to the sorted indexes
    const reorderArray = (arr: any[]) => {
      return sortedIndices.map((i) => arr[i]);
    };

    propertyNames.splice(0, propertyNames.length, ...reorderArray(propertyNames));
    propertyLabels.splice(0, propertyLabels.length, ...reorderArray(propertyLabels));
    propertyTypes.splice(0, propertyTypes.length, ...reorderArray(propertyTypes));
    propertyValues.splice(0, propertyValues.length, ...reorderArray(propertyValues));
    hints.splice(0, hints.length, ...reorderArray(hints));
    categories.splice(0, categories.length, ...reorderArray(categories));

    for (let i = 0; i < propertyNames.length; i++) {
      const propName = propertyNames[i];
      const propLabel = propertyLabels[i];
      const propTypeName = propertyTypes[i];
      const propType = this.propertyTypes.get(propTypeName) ?? PropertyTypeDesign.String;
      let propValue: number = propertyValues[i];
      if (propType == PropertyTypeDesign.Twips) {
        propValue = DesignUtils.twipsToUnit(
          propValue,
          this.reportEditor.designPreferences.MeaureUnit,
          4
        );
      }
      const prop = new PropertyValue(
        propName,
        propLabel,
        propValue,
        propType,
        hints[i],
        categories[i],
        {
          translator: this.translator,
          clipboardService: this.clipboardService,
          report: this.reportEditor.report!,
          vcr: this.vcr,
          presentationService: this.pres,
          properties: this.properties,
          reportDatasetHelper: this.reportDatasetHelper,
          reportService: this.reportService,
          fileInput: this.fileInput,
          refresh: () => this.loadObject(),
        }
      );
      if (propType == PropertyTypeDesign.Enum || propType == PropertyTypeDesign.StringEnum) {
        this.selectedInterface.GetPropertyValues(propName, prop.possibleValues);
      }
      if (propType == PropertyTypeDesign.FontStyle) {
        this.fontSelection = FontSelection.GetFonSelection("", prop.valueInteger);
        this.isBold.set(this.fontSelection.bold);
        this.isItalic.set(this.fontSelection.italic);
        this.isUnderline.set(this.fontSelection.underline);
        this.isStrikedThrough.set(this.fontSelection.strikeout);
      }
      prop.propertyChange.subscribe((propEvent) => {
        this.propertyChange(propEvent);
      });
      this.properties.push(prop);
    }
  }
  private propertyChange(propValue: PropertyValue) {
    if (!this.reportEditor) {
      throw new Error("Report Editor not assigned");
    }
    const selItems = this.canvasService.getSelectedReportItems(this.reportEditor);
    if (!selItems || selItems.length == 0) {
      return;
    }
    const groupId = propValue.groupId ?? this.reportEditor.report!.undoCue!.getGroupId();
    let propTypeValue: PropertyValue | undefined = undefined;
    if (propValue.name == "paramType") {
      for (const prop of this.properties) {
        if (prop.name == "value") {
          propTypeValue = prop;
          break;
        }
      }
    }
    // The rows of a dataset depend on its connection: the SQL, or the unions of a MyBase one
    const wasMyBase =
      this.selectedInterface instanceof DesignerInterfaceDataInfo ? this.selectedInterface.isMyBase : undefined;
    let updateType: ResfreshLevel = ResfreshLevel.None;
    for (const selItem of selItems) {
      const item = selItem.item;
      const op = new ChangeObjectOperation(OperationType.Modify, groupId);
      op.componentClass = item.className;
      op.componentName = item.name;
      const singleItem: SelectedReportItem[] = [selItem];
      const propInter = this.getDesignerInterfaceFromObject(singleItem);
      let oldValue: any;
      let newValue = propValue.value;
      let valueName = propValue.name;

      if (propValue.name == "text" && item.className == "TRPLABEL") {
        oldValue = [...(item as LabelItem).allStrings];
        valueName = "allStrings";
        propInter.SetProperty(propValue.name, propValue.value);
        newValue = [...(item as LabelItem).allStrings];
      } else if (propValue.name == "dataUnions" && item.className == "TRPDATAINFOITEM") {
        // The cell holds the entries separated by commas; the dataset and its history, the list
        oldValue = [...((item as DataInfo).dataUnions ?? [])];
        propInter.SetProperty(propValue.name, propValue.value);
        newValue = [...(item as DataInfo).dataUnions];
      } else {
        valueName = propValue.name;
        oldValue = (item as any)[propValue.name];
        if (propValue.type == PropertyTypeDesign.Twips) {
          newValue = DesignUtils.unitToTwips(
            newValue,
            this.reportEditor.designPreferences.MeaureUnit,
            0
          );
        }
        propInter.SetProperty(propValue.name, newValue);
        if (CONVERTED_PROPERTIES.includes(propValue.name)) {
          // Undo applies the value as it is: the report's tenths of a degree, the report's level
          newValue = (item as any)[propValue.name];
        }
      }
      const propTyp =
        valueName === "allStrings"
          ? PropertyType.StringArray
          : PropertyValue.PropertyTypeDesignToPropertType(propValue.type);
      op.addProperty(valueName, propTyp, oldValue, newValue);
      if (propValue.name == "paramType" && propTypeValue) {
        const propTypNew = PropertyValue.PropertyTypeDesignToPropertType(propTypeValue.type);
        const oValue = propTypeValue.originalValue;
        let nValue = propInter.GetProperty("value");
        if (propValue.value === ParamType.Date) {
          propTypeValue.setValueVariant(nValue);
          nValue = propTypeValue.value;
          propInter.SetProperty("value", nValue);
        } else if (propValue.value === ParamType.DateTime || propValue.value === ParamType.Time) {
          if (nValue && nValue.value instanceof Date) {
            const d = nValue.value;
            const newDate = new Date(
              d.getUTCFullYear(),
              d.getUTCMonth(),
              d.getUTCDate(),
              0,
              0,
              0,
              0
            );
            nValue = { type: VariantType.DateTime, value: newDate };
            propTypeValue.setValueVariant(nValue);
            propInter.SetProperty("value", nValue);
          }
        }
        op.addProperty(propTypeValue.name, propTypNew, oValue, nValue);
        this.reportEditor.report!.undoCue?.addOperation(op, this.reportEditor.report!);
        propTypeValue.originalValue = nValue;
        propTypeValue.setValueVariant(nValue);
      }
      this.reportEditor.report!.undoCue?.addOperation(op, this.reportEditor.report!);

      updateType = this.updateSelectedObject(selItem, propValue, selItems.length > 1);
    }
    if (
      propValue.name == "databaseAlias" &&
      wasMyBase !== undefined &&
      this.selectedInterface instanceof DesignerInterfaceDataInfo &&
      this.selectedInterface.isMyBase !== wasMyBase
    ) {
      this.loadObject();
    }
    switch (updateType) {
      case ResfreshLevel.UpdateSureport:
        this.reportEditor.refreshSubReport();
        break;
      case ResfreshLevel.UpdateView:
        this.canvasService.canvas.requestRenderAll();
        break;
    }
  }
  private updateSelectedObject(
    selItem: SelectedReportItem,
    propValue: PropertyValue,
    multipleSelection: boolean
  ): ResfreshLevel {
    if (selItem.item.className == "TRPSECTION") {
      switch (propValue.name) {
        case "width":
        case "height":
          return ResfreshLevel.UpdateSureport;
      }
    } else {
      if (selItem.ComponentEditor) {
        switch (selItem.item.className) {
          case "TRPLABEL":
          case "TRPEXPRESSION":
          case "TRPCHART":
            switch (propValue.name) {
              case "fontSize":
              case "wFontName":
              case "lFontName":
              case "fontColor":
              case "fontStyle":
              case "backColor":
              case "cutText":
              case "wordWrap":
              case "singleLine":
              case "posX":
              case "posY":
              case "width":
              case "height":
              case "text":
              case "alignment":
              case "vAlignment":
              case "expression":
              case "valueExpression":
              case "transparent":
              case "fontRotation":
                selItem.ComponentEditor.update(propValue.name, multipleSelection);
                return multipleSelection ? ResfreshLevel.UpdateSureport : ResfreshLevel.UpdateView;
            }
            break;
          case "TRPIMAGE":
            switch (propValue.name) {
              case "expression":
              case "streamBase64":
              case "drawStyle":
              case "width":
              case "height":
              case "posX":
              case "posY":
                selItem.ComponentEditor.update(propValue.name, multipleSelection);
                return multipleSelection ? ResfreshLevel.UpdateSureport : ResfreshLevel.UpdateView;
            }
            break;
          case "TRPBARCODE":
            switch (propValue.name) {
              case "expression":
              case "rotation":
              case "barType":
              case "width":
              case "height":
              case "posX":
              case "posY":
                selItem.ComponentEditor.update(propValue.name, multipleSelection);
                return multipleSelection ? ResfreshLevel.UpdateSureport : ResfreshLevel.UpdateView;
            }
            break;
          case "TRPSHAPE":
            switch (propValue.name) {
              case "penStyle":
              case "brushStyle":
              case "penWidth":
              case "penColor":
              case "brushColor":
              case "drawStyle":
              case "shape":
              case "width":
              case "height":
              case "posX":
              case "posY":
                selItem.ComponentEditor.update(propValue.name, multipleSelection);
                return multipleSelection ? ResfreshLevel.UpdateSureport : ResfreshLevel.UpdateView;
            }
            break;
        }
      }
    }
    return ResfreshLevel.None;
  }

  protected updateProp(prop: string, eventValue: EventTarget | null) {
    if (!this.reportEditor) {
      throw new Error("Report Editor not assigned");
    }
    const litems = this.canvasService.getSelectedReportItems(this.reportEditor);
    if (!litems) {
      return;
    }
    for (const item of litems) {
      if (item.fabricObject) {
        const stringValue = (eventValue as HTMLInputElement).value;
        const value = Number.parseFloat(stringValue);
        const update = { [prop]: value };
        this.canvasService.updateObject(update, item.fabricObject);
      }
    }
  }
  /*protected getTextContent(): string {
    if (this.selectedObject && 'text' in this.selectedObject) {
      return (this.selectedObject as any).text;
    }
    return '';
  }*/
  public getTypeNameFromClassName(className: ReportItemClassName): string {
    switch (className) {
      case "TRPLABEL":
        return "LabelItem";
      case "TRPPARAM":
        return "Param";
      case "TRPEXPRESSION":
        return "ExpressionItem";
      case "TRPCHART":
        return "ChartItem";
      case "TRPSHAPE":
        return "ShapeItem";
      case "TRPIMAGE":
        return "ImageItem";
      case "TRPBARCODE":
        return "BarcodeItem";
      case "TRPDATAINFOITEM":
        return "DataInfo";
      case "TRPDATABASEINFOITEM":
        return "DatabaseInfo";
      case "TRPSUBREPORT":
        return "SubReport";
      case "TRPSECTION":
        return "Section";
      case "TRPREPORT":
        return "Report";
    }
    throw new Error("ClasName to Type name error, className unknown: " + className);
  }
  public getDesignerInterfaceFromObject(selItems: SelectedReportItem[]): DesignerInterface {
    if (!this.reportEditor) {
      throw new Error("Report Editor not assigned");
    }

    let baseclass = "";
    const report = this.reportEditor.report!;
    let idx = 0;
    const litems = new Map<number, ReportItem>();
    for (const selitem of selItems) {
      const nitem = selitem.item;
      const typename = this.getTypeNameFromClassName(nitem.className);
      litems.set(idx, nitem);
      idx++;
      if (baseclass === "") {
        baseclass = typename;
      } else if (typename !== baseclass) {
        switch (typename) {
          case "Report":
            baseclass = "Report";
            break;
          case "ShapeItem":
          case "ImageItem":
          case "BarcodeItem":
            baseclass = "PrintPosItem";
            break;
          case "ExpressionItem":
          case "LabelItem":
          case "ChartItem":
            switch (baseclass) {
              case "ExpressionItem":
              case "LabelItem":
              case "ChartItem":
              case "PrintItemText":
                baseclass = "PrintItemText";
                break;
              default:
                baseclass = "PrintPosItem";
            }
            break;
          case "SubReport":
          case "DatabaseInfo":
          case "DataInfo":
            baseclass = typename;
            break;
          default:
            baseclass = "PrintPosItem";
            break;
        }
      }

      if (baseclass === "PrintPosItem" || baseclass == "Report") {
        break;
      }
    }

    let nresult: DesignerInterface;

    switch (baseclass) {
      case "LabelItem":
        nresult = new DesignerInterfaceLabel(report, litems, this, this.translator);
        break;
      case "Report":
        nresult = new DesignerInterfaceReport(report, litems, this, this.translator);
        break;
      case "PrintItemText":
        nresult = new DesignerInterfaceText(report, litems, this, this.translator);
        break;
      case "ExpressionItem":
        nresult = new DesignerInterfaceExpression(report, litems, this, this.translator);
        break;
      case "ChartItem":
        nresult = new DesignerInterfaceChart(report, litems, this, this.translator);
        break;
      case "ShapeItem":
        nresult = new DesignerInterfaceShape(report, litems, this, this.translator);
        break;
      case "PrintPosItem":
        nresult = new DesignerInterfaceSizePos(report, litems, this, this.translator);
        break;
      case "BarcodeItem":
        nresult = new DesignerInterfaceBarcode(report, litems, this, this.translator);
        break;
      case "Section":
        nresult = new DesignerInterfaceSection(report, litems, this, this.translator);
        break;
      case "SubReport":
        nresult = new DesignerInterfaceSubReport(report, litems, this, this.translator);
        break;
      case "DatabaseInfo":
        nresult = new DesignerInterfaceDbInfo(report, litems, this, this.translator);
        break;
      case "DataInfo":
        nresult = new DesignerInterfaceDataInfo(report, litems, this, this.translator);
        break;
      case "Param":
        nresult = new DesignerInterfaceParam(report, litems, this, this.translator);
        break;
      case "ImageItem":
        nresult = new DesignerInterfaceImage(report, litems, this, this.translator);
        break;
      default:
        throw new Error(`Clase no soportada: ${baseclass}`);
    }

    nresult.SelectionClassName = baseclass;
    return nresult;
  }
  protected trackById(index: number, prop: PropertyValue) {
    return prop.name;
  }
  private StringToPropertyTypeDesign(propertyTypeString: string): PropertyTypeDesign {
    const result = this.propertyTypes.get(propertyTypeString);
    if (!result) {
      throw new Error("Unknown type: " + propertyTypeString);
    }
    return result;
  }
  public swapComponent(front: boolean) {
    if (!this.reportEditor?.report?.undoCue) {
      return;
    }
    const selItems = this.canvasService.getSelectedReportItems(this.reportEditor);
    if (!selItems || selItems.length != 1 || !selItems[0].ComponentEditor) {
      return;
    }
    const report = this.reportEditor.report;
    const compEditor = selItems[0].ComponentEditor;
    const compo = compEditor.component;
    const section = this.reportEditor.report.getParentSection(compo);
    const idx = section.components.indexOf(compo);
    const otherIndex = front ? section.components.length - 1 : 0;
    if (idx == otherIndex) {
      return;
    }
    // Swap with the last element
    const changeOp = new ChangeObjectOperation(
      OperationType.SwapDown,
      report.undoCue!.getGroupId()
    );
    changeOp.oldItemIndex = idx;
    changeOp.componentClass = "TRPPRINTPOSITEM";
    changeOp.parentName = section.name;
    report.undoCue!.addOperation(changeOp, report);
    ArrayUtil.swap(section.components, otherIndex, idx);
    this.refreshSubReport(report.getParentSubReport(section));
  }
  public bringToFront() {
    this.swapComponent(true);
  }
  public sendToBack() {
    this.swapComponent(false);
  }

  protected changeFontStyle(prop: PropertyValue) {
    if (!this.fontSelection) {
      return;
    }
    this.fontSelection.bold = this.isBold();
    this.fontSelection.italic = this.isItalic();
    this.fontSelection.strikeout = this.isStrikedThrough();
    this.fontSelection.underline = this.isUnderline();
    prop.valueInteger = FontSelection.FontSelectionToFontStyleInt(this.fontSelection);
  }

  protected async setFontStyleClick(prop: PropertyValue) {
    await prop.fontStyleClick();

    const styleProperty = this.properties.find((p) => p.type == PropertyTypeDesign.FontStyle);
    if (!styleProperty) {
      return;
    }
    const fontSelection = FontSelection.GetFonSelection("", styleProperty.valueInteger);
    this.isBold.set(fontSelection.bold);
    this.isItalic.set(fontSelection.italic);
    this.isUnderline.set(fontSelection.underline);
    this.isStrikedThrough.set(fontSelection.strikeout);
  }

  protected async pedirTexto(prop: PropertyValue) {
    const result = await LabelDialogComponent.modifyText(
      prop.propServ.presentationService,
      prop.label,
      prop.value
    );
    if (result == undefined) {
      return;
    }
    prop.valueStringTmp = result;
    prop.commitValue();
  }

  // ---- the rotation of a text (fontRotation, in degrees here) ----

  /** The current rotation as the menu's button shows it: a named one, a custom angle, or several values. */
  protected textRotation(prop: PropertyValue): { name: string; icon: string } {
    if (!Number.isFinite(prop.valueInteger)) {
      return { name: this.translator.t("DesignerRotationMixed"), icon: "tablerAngle" };
    }
    const degrees = ObjectInspectorComponent.normalizeDegrees(prop.valueInteger);
    const named = TEXT_ROTATIONS.find((r) => r.degrees === degrees);
    return named
      ? { name: this.translator.t(named.key), icon: named.icon }
      : { name: this.translator.t("DesignerRotationCustomValue", { degrees: String(degrees) }), icon: "tablerAngle" };
  }

  /** The menu of the rotation: the named ones, and a submenu of angles every 15 degrees and any other. */
  protected rotationOptions(): OpcionMenu[] {
    const prop = this.properties.find((p) => p.name === "fontRotation");
    if (!prop) {
      return [];
    }
    const current = !Number.isFinite(prop.valueInteger) ? undefined : ObjectInspectorComponent.normalizeDegrees(prop.valueInteger);
    const isNamed = TEXT_ROTATIONS.some((r) => r.degrees === current);
    return [
      ...TEXT_ROTATIONS.map(
        (r): OpcionMenu => ({
          nombre: this.translator.t(r.key),
          icono: r.icon,
          checked: r.degrees === current,
          callback: () => this.setRotation(prop, r.degrees),
        })
      ),
      { nombre: "", separador: true },
      {
        nombre: this.translator.t("DesignerRotationCustom"),
        icono: "tablerAngle",
        checked: current !== undefined && !isNamed,
        opciones: [
          ...CUSTOM_ANGLES.map(
            (degrees): OpcionMenu => ({
              nombre: degrees + "°",
              checked: degrees === current,
              callback: () => this.setRotation(prop, degrees),
            })
          ),
          { nombre: "", separador: true },
          { nombre: this.translator.t("DesignerRotationOther"), callback: () => this.askRotation(prop) },
        ],
      },
    ];
  }

  private async askRotation(prop: PropertyValue) {
    const answer = await this.pres.pedirNumero({
      titulo: this.translator.t("DesignerRotationCustom"),
      descripcion: this.translator.t("DesignerRotationPrompt"),
      valorOmision: !Number.isFinite(prop.valueInteger) ? 0 : prop.valueInteger,
    });
    const degrees = Number(answer.valor);
    if (answer.cancelado || answer.valor == undefined || !Number.isFinite(degrees)) {
      return;
    }
    this.setRotation(prop, degrees);
  }

  private setRotation(prop: PropertyValue, degrees: number) {
    // Reportman keeps tenths of a degree in a short: normalizing keeps it in range
    prop.valueIntegerTmp = Math.round(ObjectInspectorComponent.normalizeDegrees(degrees) * 10) / 10;
    prop.commitValue();
  }

  /** 270° and -90° are the same rotation: taken to (-180, 180] to compare them. */
  private static normalizeDegrees(degrees: number): number {
    const rest = ((degrees % 360) + 360) % 360;
    return rest > 180 ? rest - 360 : rest;
  }
}
export interface ObjectPropertiesServices {
  translator: TranslationService;
  clipboardService: ClipboardService;
  properties: PropertyValue[];
  vcr: ViewContainerRef;
  presentationService: PresentacionService;
  report: Report;
  reportDatasetHelper: ReportDatasetHelper;
  reportService: NgxReportmanLibService;
  fileInput?: ElementRef<HTMLInputElement>;
  /** Shows the properties of the selection again (a dialog changed several of them). */
  refresh?: () => void;
}
export class PropertyValue {
  public propertyChange = new EventEmitter<PropertyValue>();
  public modified = false;

  private _valueString = "";
  private _valueStringTmp = "";
  public imageSize = "";
  private _valueInteger = 0;
  public _valueIntegerTmp = 0;
  private _valueDateTime = new Date();
  public valueBinary?: string;
  public sizeLabel = "";
  public groupId?: number;
  public possibleValues: string[] = [];
  public get valueString(): string {
    return this._valueString;
  }
  public set valueString(newValue: string) {
    if (this._valueString == newValue) {
      return;
    }
    this._valueString = newValue;
    this.propertyChange.emit(this);
  }
  public get valueStringTmp(): string {
    return this._valueStringTmp;
  }
  public set valueStringTmp(newValue: string) {
    if (this._valueStringTmp == newValue) {
      return;
    }
    this._valueStringTmp = newValue;
    this.modified = true;
  }

  public get valueIntegerTmp(): number {
    return this._valueIntegerTmp;
  }
  public set valueIntegerTmp(newValue: number) {
    if (typeof newValue === "string" || (newValue as any) instanceof String) {
      this._valueIntegerTmp = parseInt(newValue as any);
    } else {
      if (this._valueIntegerTmp == newValue) {
        return;
      }
      this._valueIntegerTmp = newValue;
    }
    this.modified = true;
  }
  public get valueInteger(): number {
    return this._valueInteger;
  }
  public set valueInteger(newValue: number) {
    if (typeof newValue === "string" || (newValue as any) instanceof String) {
      this._valueInteger = parseInt(newValue as any);
    } else {
      if (this._valueInteger == newValue) {
        return;
      }
      this._valueInteger = newValue;
    }
    this.propertyChange.emit(this);
  }
  private _valueBool = false;
  private _valueDouble?: number;
  public _valueDoubleTmp?: number;
  public get valueBool(): boolean {
    return this._valueBool;
  }
  public set valueBool(newValue: boolean) {
    this._valueBool = newValue;
    this.propertyChange.emit(this);
  }
  constructor(
    public name: string,
    public label: string,
    public originalValue: any,
    public type: PropertyTypeDesign,
    public hint: string,
    public category: string,
    public propServ: ObjectPropertiesServices
  ) {
    switch (type) {
      case PropertyTypeDesign.Date:
        this._valueDateTime = originalValue;
        break;
      case PropertyTypeDesign.Integer:
      case PropertyTypeDesign.FontStyle:
        this._valueInteger = originalValue;
        this._valueIntegerTmp = originalValue;
        break;
      case PropertyTypeDesign.Number:
      case PropertyTypeDesign.Twips:
        this.valueDouble = originalValue;
        this._valueDoubleTmp = originalValue;
        break;
      case PropertyTypeDesign.String:
      case PropertyTypeDesign.StringMultiline:
      case PropertyTypeDesign.FontName:
      case PropertyTypeDesign.Expression:
      case PropertyTypeDesign.Sql:
      case PropertyTypeDesign.Unions:
        this._valueString = originalValue;
        this._valueStringTmp = originalValue;
        break;
      case PropertyTypeDesign.Binary:
      case PropertyTypeDesign.Image:
        this.valueBinary = originalValue;
        this.updateSizeLabel();
        break;
      case PropertyTypeDesign.Boolean:
        this._valueBool = originalValue;
        break;
      case PropertyTypeDesign.Enum:
        this._valueInteger = originalValue;
        break;
      case PropertyTypeDesign.StringEnum:
        this._valueString = originalValue;
        break;
      case PropertyTypeDesign.Category:
        this._valueString = originalValue;
        break;
      case PropertyTypeDesign.Variant:
        {
          const variantValue = originalValue as Variant;
          this.setValueVariant(variantValue);
        }
        break;
      case PropertyTypeDesign.Color:
        this._valueString = DesignUtils.numberToHexColor(originalValue);
        break;
    }
  }
  public getImageOptions(): OpcionMenu[] {
    const imageOptions: OpcionMenu[] = [];
    imageOptions.push({
      nombre: this.propServ.translator.TranslateStr(85),
      callback: () => this.uploadImage(),
    });
    imageOptions.push({
      nombre: this.propServ.translator.TranslateStr(9),
      callback: () => this.cutImage(),
      disabled: this.valueString == null,
    });
    imageOptions.push({
      nombre: this.propServ.translator.TranslateStr(10),
      callback: () => this.copyImage(),
      disabled: this.valueString == null,
    });
    imageOptions.push({
      nombre: this.propServ.translator.TranslateStr(11),
      callback: () => this.pasteImage(),
    });
    return imageOptions;
  }

  public get displayValue(): string {
    switch (this.type) {
      case PropertyTypeDesign.FontStyle:
        return DesignUtils.fontStyleToString(this.valueInteger, this.propServ.translator);
      case PropertyTypeDesign.FontName:
      case PropertyTypeDesign.Expression:
      case PropertyTypeDesign.Sql:
      case PropertyTypeDesign.StringMultiline:
      case PropertyTypeDesign.Unions:
        return this.valueString;
      case PropertyTypeDesign.Variant:
        return this.getDisplayValueVariant();
    }
    throw new Error("displayValue not suported for type: " + this.type);
  }
  private getParamType(): ParamType {
    let paramType: ParamType | undefined;
    for (const prop of this.propServ.properties) {
      if (prop.name == "paramType") {
        paramType = prop.value as ParamType;
        break;
      }
    }
    if (paramType == undefined) {
      throw new Error("ParamType not found");
    }
    return paramType;
  }
  private getDisplayValueVariant(): string {
    const paramType = this.getParamType();
    switch (paramType) {
      case ParamType.Bool:
        if (this.valueBool) {
          return "True";
        } else {
          return "False";
        }
      case ParamType.String:
        if (this.valueString == null) {
          return "";
        } else {
          return this.valueString;
        }
      case ParamType.Currency:
      case ParamType.Double:
        if (this.valueDouble == null) {
          return "";
        } else {
          return this.valueDouble.toString();
        }
      case ParamType.Integer:
        if (this.valueInteger == null) {
          return "";
        } else {
          return this.valueInteger.toFixed(0);
        }
      case ParamType.Date:
        if (this.valueDateTime == null) {
          return "";
        } else {
          return this.valueDateTime.toLocaleDateString(undefined, {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });
        }
      case ParamType.DateTime:
        if (this.valueDateTime == null) {
          return "";
        } else {
          return this.valueDateTime.toLocaleString(undefined, {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
        }
      case ParamType.Time:
        if (this.valueDateTime == null) {
          return "";
        } else {
          return this.valueDateTime.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
        }
      case ParamType.ExpreA:
      case ParamType.ExpreB:
      case ParamType.InitialValue:
      case ParamType.Multiple:
      case ParamType.SubsExpreList:
      case ParamType.Unknown:
      case ParamType.Subst:
      case ParamType.SubstExpre:
        return this.valueString;
      default:
        throw new Error("Paramtype not supported");
    }
  }
  private getValueVariant(): Variant {
    const paramType = this.getParamType();
    switch (paramType) {
      case ParamType.Bool:
        return { type: VariantType.Boolean, value: this.valueBool };
      case ParamType.String:
        return { type: VariantType.String, value: this.valueString };
      case ParamType.Currency:
        return { type: VariantType.Decimal, value: this.valueDouble };
      case ParamType.Double:
        return { type: VariantType.Double, value: this.valueDouble };
      case ParamType.Integer:
        return { type: VariantType.Integer, value: this.valueInteger };
      case ParamType.Date:
        if (this.valueDateTime) {
          const newDate = new Date(
            Date.UTC(
              this.valueDateTime.getFullYear(),
              this.valueDateTime.getMonth(),
              this.valueDateTime.getDate()
            )
          );
          return { type: VariantType.DateTime, value: newDate };
        }
        return { type: VariantType.DateTime, value: this.valueDateTime };
      case ParamType.DateTime:
      case ParamType.Time:
        return { type: VariantType.DateTime, value: this.valueDateTime };
      case ParamType.ExpreA:
      case ParamType.ExpreB:
      case ParamType.InitialValue:
      case ParamType.Multiple:
      case ParamType.SubsExpreList:
      case ParamType.Unknown:
      case ParamType.Subst:
      case ParamType.SubstExpre:
        return { type: VariantType.String, value: this.valueString };
      default:
        throw new Error("Paramtype not supported");
    }
  }
  public setValueVariant(variant: Variant): void {
    const paramType = this.getParamType();
    switch (paramType) {
      case ParamType.Bool:
        if (variant.value) {
          this._valueBool = true;
        } else {
          this._valueBool = false;
        }
        break;
      case ParamType.String:
        this._valueString = variant.value;
        break;
      case ParamType.Currency:
      case ParamType.Double:
        this._valueDouble = variant.value;
        break;
      case ParamType.Integer:
        this._valueInteger = variant.value;
        break;
      case ParamType.Date:
      case ParamType.DateTime:
      case ParamType.Time:
        this._valueDateTime = variant.value;
        break;
      case ParamType.ExpreA:
      case ParamType.ExpreB:
      case ParamType.InitialValue:
      case ParamType.Multiple:
      case ParamType.SubsExpreList:
      case ParamType.Unknown:
      case ParamType.Subst:
      case ParamType.SubstExpre:
        this._valueString = variant.value;
        break;
      default:
    }
  }
  public get valueDouble(): number | undefined {
    return this._valueDouble;
  }
  public set valueDouble(newValue: number) {
    this._valueDouble = newValue;
    this.propertyChange.emit(this);
  }
  public get valueDoubleTmp(): number | undefined {
    return this._valueDoubleTmp;
  }
  public set valueDoubleTmp(newValue: number) {
    this._valueDoubleTmp = newValue;
    this.modified = true;
  }
  public get valueDateTime(): Date | undefined {
    return this._valueDateTime;
  }
  public set valueDateTime(newValue: Date) {
    this._valueDateTime = newValue;
    this.propertyChange.emit(this);
  }
  public get value(): any {
    switch (this.type) {
      case PropertyTypeDesign.Date:
        return this.valueDateTime;
      case PropertyTypeDesign.Integer:
        return this.valueInteger;
      case PropertyTypeDesign.Number:
      case PropertyTypeDesign.Twips:
        return this.valueDouble;
      case PropertyTypeDesign.String:
      case PropertyTypeDesign.StringMultiline:
      case PropertyTypeDesign.FontName:
        return this.valueString;
      case PropertyTypeDesign.Binary:
        return this.valueBinary;
      case PropertyTypeDesign.Image:
        return this.valueBinary;
      case PropertyTypeDesign.Boolean:
        return this.valueBool;
      case PropertyTypeDesign.Enum:
        return this.valueInteger;
      case PropertyTypeDesign.StringEnum:
        return this.valueString;
      case PropertyTypeDesign.FontStyle:
        return this.valueInteger;
      case PropertyTypeDesign.Expression:
        return this.valueString;
      case PropertyTypeDesign.Sql:
        return this.valueString;
      case PropertyTypeDesign.Unions:
        return this.valueString;
      case PropertyTypeDesign.Color:
        return DesignUtils.hexColorToNumber(this.valueString);
      case PropertyTypeDesign.Variant:
        return this.getValueVariant();
      case PropertyTypeDesign.Category:
        return this.valueString;
    }
    throw new Error("Property type unknown " + this.type);
  }
  private updateSizeLabel() {
    this.sizeLabel = DesignUtils.getSizeDisplayName(this.valueBinary, this.propServ.translator);
  }
  public onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];

    const reader = new FileReader();
    reader.onload = () => {
      // "reader.result" is base64 with the prefix "data:...;base64,xxxx"
      const result = reader.result as string;

      // Keep only the base64 part, without the prefix
      const base64File = result.split(",")[1];
      this.valueBinary = base64File;
      // this.importReport(base64File);
      input.value = "";
      this.propertyChange.emit(this);
    };

    reader.readAsDataURL(file); // converts the file to base64
  }
  public commitValue() {
    switch (this.type) {
      case PropertyTypeDesign.Integer:
        if (this.valueInteger != this.valueIntegerTmp) {
          this.valueInteger = this.valueIntegerTmp;
        }
        break;
      case PropertyTypeDesign.Number:
      case PropertyTypeDesign.Twips:
        if (this.valueDouble != this.valueDoubleTmp) {
          this.valueDouble = this.valueDoubleTmp ?? 0;
        }
        break;
      default:
        if (this.valueString != this.valueStringTmp) {
          this.valueString = this.valueStringTmp;
        }
        break;
    }
  }
  public cancelValue(ev: Event) {
    switch (this.type) {
      case PropertyTypeDesign.Integer:
        if (this.valueIntegerTmp != this.valueInteger) {
          this.valueIntegerTmp = this.valueInteger;
          ev.preventDefault();
        }
        break;
      case PropertyTypeDesign.Number:
      case PropertyTypeDesign.Twips:
        if (this.valueDoubleTmp != this.valueDouble) {
          this.valueDoubleTmp = this.valueDouble ?? 0;
          ev.preventDefault();
        }
        break;
      default:
        if (this.valueStringTmp != this._valueString) {
          this.valueStringTmp = this._valueString;
          ev.preventDefault();
        }
        break;
    }
  }
  private uploadImage() {
    if (!this.propServ.fileInput) {
      return;
    }
    const inputEl = this.propServ.fileInput.nativeElement;
    const onChange = (event: Event) => {
      this.onFileSelected(event);
      inputEl.removeEventListener("change", onChange);
      // Reset file input to allow selecting same file again
      inputEl.value = "";
    };
    inputEl.addEventListener("change", onChange);
    inputEl.click();
  }
  private async cutImage() {
    if (!this.valueBinary) {
      return;
    }
    await this.propServ.clipboardService.copyBase64ImageToClipboard(this.valueBinary);
    this.valueBinary = undefined;
    this.updateSizeLabel();
    this.propertyChange.emit(this);
  }
  private async pasteImage() {
    const newValue = await this.propServ.clipboardService.getBase64ImageFromClipboard();
    if (newValue) {
      this.valueBinary = newValue;
      this.updateSizeLabel();
      this.propertyChange.emit(this);
    }
  }
  private async copyImage() {
    if (this.valueBinary) {
      await this.propServ.clipboardService.copyBase64ImageToClipboard(this.valueBinary);
    }
  }
  public static PropertyTypeDesignToPropertType(type: PropertyTypeDesign): PropertyType {
    switch (type) {
      case PropertyTypeDesign.Integer:
        return PropertyType.Integer;
      case PropertyTypeDesign.Number:
        return PropertyType.Number;
      case PropertyTypeDesign.String:
      case PropertyTypeDesign.StringMultiline:
        return PropertyType.String;
      case PropertyTypeDesign.Twips:
        return PropertyType.Integer;
      case PropertyTypeDesign.StringArray:
        return PropertyType.StringArray;
      case PropertyTypeDesign.Image:
        return PropertyType.Binary;
      case PropertyTypeDesign.Date:
        return PropertyType.Date;
      case PropertyTypeDesign.Binary:
        return PropertyType.Binary;
      case PropertyTypeDesign.Boolean:
        return PropertyType.Boolean;
      case PropertyTypeDesign.Enum:
        return PropertyType.Integer;
      case PropertyTypeDesign.StringEnum:
        return PropertyType.String;
      case PropertyTypeDesign.Variant:
        return PropertyType.Variant;
      case PropertyTypeDesign.Color:
        return PropertyType.Integer;
      case PropertyTypeDesign.FontName:
        return PropertyType.String;
      case PropertyTypeDesign.FontStyle:
        return PropertyType.Integer;
      case PropertyTypeDesign.Expression:
        return PropertyType.String;
      case PropertyTypeDesign.Sql:
        return PropertyType.String;
      case PropertyTypeDesign.Unions:
        return PropertyType.StringArray;
      case PropertyTypeDesign.Category:
        return PropertyType.String;
      default:
        throw new Error("Conversion not valid PropertyTypeDesign");
    }
  }
  public async stringPropertyClick() {
    switch (this.type) {
      case PropertyTypeDesign.Expression:
        await this.expressionPropertyClick();
        break;
      case PropertyTypeDesign.Sql:
        await this.sqlPropertyClick();
        break;
      case PropertyTypeDesign.StringMultiline:
        await this.stringMultilinePropertyClick();
        break;
      case PropertyTypeDesign.Unions:
        await this.unionsPropertyClick();
        break;
    }
  }
  public async updateReportDatasetHelper(operation: ReadReportOperation) {
    let refreshInformation = false;
    switch (operation) {
      case ReadReportOperation.ReadFunctionsColumns:
        refreshInformation =
          !this.propServ.reportDatasetHelper.functions ||
          !this.propServ.reportDatasetHelper.dataSets;
        break;
      case ReadReportOperation.ReadFunctions:
        refreshInformation = !this.propServ.reportDatasetHelper.functions;
        break;
      case ReadReportOperation.ReadAllTableColumns:
        refreshInformation = !this.propServ.reportDatasetHelper.allDataSets;
        break;
    }
    if (refreshInformation) {
      const loading = await this.propServ.presentationService.mostrarLoading();
      try {
        const readRequest = new ReadReportRequest();
        readRequest.operation = operation;
        readRequest.report = this.propServ.report;
        const response = await this.propServ.reportService.getReadReportResponse(readRequest);
        if (!response.errorMessage) {
          switch (operation) {
            case ReadReportOperation.ReadFunctions:
              this.propServ.reportDatasetHelper.functions = response.functions;
              break;
            case ReadReportOperation.ReadFunctionsColumns:
              this.propServ.reportDatasetHelper.functions = response.functions;
              this.propServ.reportDatasetHelper.dataSets = response.dataSets;
              break;
            case ReadReportOperation.ReadAllTableColumns:
              this.propServ.reportDatasetHelper.allDataSets = response.dataSets;
              break;
          }
        }
      } finally {
        loading.ocultar();
      }
    }
  }
  public async expressionPropertyClick() {
    // Functions and the dataset columns: the server remembers the columns per SQL text, so after
    // the first time this does not open the datasets again.
    await this.updateReportDatasetHelper(ReadReportOperation.ReadFunctionsColumns);
    const result = await ExpressionDialogComponent.modifyExpression(
      this.propServ.presentationService,
      this.propServ.report,
      this.propServ.reportDatasetHelper,
      this.value
    );
    if (result != undefined) {
      this.valueStringTmp = result;
      this.commitValue();
    }
  }
  public async stringMultilinePropertyClick() {
    const resultaPedir = await this.propServ.presentationService.pedirTextoLargo({
      descripcion: this.name,
      valorOmision: this.value,
      titulo: "",
    });
    if (resultaPedir.cancelado) {
      return;
    }
    if (resultaPedir.valor != undefined) {
      this.valueStringTmp = resultaPedir.valor as string;
      this.commitValue();
    }
  }
  public async variantPropertyClick() {
    const paramType = this.getParamType();
    switch (paramType) {
      case ParamType.Bool:
        {
          const resultadoPedir = await this.propServ.presentationService.pedirBooleano({
            descripcion: this.name,
            titulo: "",
          });
          if (resultadoPedir.cancelado) {
            return;
          }
          const resultBool = resultadoPedir.valor;
          if (resultBool !== undefined) {
            this.valueBool = resultBool as boolean;
          }
        }
        break;
      case ParamType.Currency:
      case ParamType.Double:
        {
          const resultadoPedir = await this.propServ.presentationService.pedirNumero({
            descripcion: this.name,
            valorOmision: this.valueDouble,
            titulo: "",
          });
          if (!resultadoPedir) {
            return;
          }
          const resultNumber = resultadoPedir.valor;
          if (resultNumber !== undefined) {
            this.valueDouble = resultNumber as number;
            this.propertyChange.emit(this);
          }
        }
        break;
      case ParamType.Integer:
        {
          const resultadoPedir = await this.propServ.presentationService.pedirNumero({
            descripcion: this.name,
            valorOmision: this.valueInteger,
            titulo: "",
          });
          if (resultadoPedir.cancelado) {
            return;
          }
          const resultInteger = resultadoPedir.valor;
          if (resultInteger !== undefined) {
            this.valueInteger = resultInteger as number;
          }
        }
        break;
      case ParamType.Date:
        {
          const resultadoPedir = await this.propServ.presentationService.pedirFecha({
            descripcion: this.name,
            valorOmision: this.valueDateTime,
            titulo: "",
          });
          if (!resultadoPedir) {
            return;
          }
          if (resultadoPedir.valor !== undefined) {
            this.valueDateTime = resultadoPedir.valor as Date;
          }
        }
        break;
      case ParamType.DateTime:
        {
          const resultadoPedir = await this.propServ.presentationService.pedirFechaHora({
            descripcion: this.name,
            valorOmision: this.valueDateTime,
            titulo: "",
          });
          if (!resultadoPedir) {
            return;
          }
          if (resultadoPedir.valor !== undefined) {
            this.valueDateTime = resultadoPedir.valor as Date;
          }
        }
        break;
      case ParamType.Time:
        {
          const resultadoPedir = await this.propServ.presentationService.pedirHora({
            descripcion: this.name,
            valorOmision: this.valueDateTime,
            titulo: "",
          });
          if (!resultadoPedir) {
            return;
          }
          if (resultadoPedir.valor !== undefined) {
            this.valueDateTime = resultadoPedir.valor as Date;
          }
        }
        break;
      case ParamType.ExpreA:
      case ParamType.ExpreB:
        break;
      case ParamType.Unknown:
      case ParamType.Multiple:
      case ParamType.List:
      case ParamType.SubsExpreList:
      case ParamType.InitialValue:
      case ParamType.String:
      case ParamType.Subst:
      case ParamType.SubstExpre:
        {
          const pedirDato = await this.propServ.presentationService.pedirTextoLargo({
            descripcion: this.name,
            valorOmision: this.valueString,
            titulo: "",
          });
          const result = pedirDato.valor;
          if (result != undefined) {
            this.valueString = result as string;
          }
        }
        break;
      default:
        throw new Error("Unsupported input type");
    }
  }

  public async sqlPropertyClick() {
    await this.updateReportDatasetHelper(ReadReportOperation.ReadAllTableColumns);
    let datasetName = "";
    for (const prop of this.propServ.properties) {
      if (prop.name == "alias") {
        datasetName = prop.value;
        break;
      }
    }
    const peticion = new PeticionSqlDialog();
    peticion.datasetName = datasetName;
    peticion.initialSelection = this.value;
    peticion.reportDatasetHelper = this.propServ.reportDatasetHelper;
    peticion.report = this.propServ.report;
    const result = await SqlDialogComponent.modifySql(this.propServ.presentationService, peticion);
    if (result != undefined) {
      const report = peticion.report;
      const dataInfo = report?.dataInfo.find((d) => d.alias === datasetName);
      // The part of the database chosen in the dialog (D3): what of it the dataset does not have yet.
      const schema = peticion.schema;
      const changes: { name: string; type: PropertyType; oldValue: any; newValue: any }[] = [];
      if (dataInfo && schema) {
        if ((dataInfo.schemaName ?? "") !== schema.schemaName) {
          changes.push({ name: "schemaName", type: PropertyType.String, oldValue: dataInfo.schemaName, newValue: schema.schemaName });
        }
        if (schema.hubSchemaId !== undefined && (dataInfo.hubSchemaId ?? 0) !== schema.hubSchemaId) {
          changes.push({ name: "hubSchemaId", type: PropertyType.Integer, oldValue: dataInfo.hubSchemaId, newValue: schema.hubSchemaId });
        }
      }
      // The SQL and the schema it was written with: one undo step.
      const groupId = changes.length ? report?.undoCue?.getGroupId() : undefined;
      this.groupId = groupId;
      try {
        this.valueStringTmp = result;
        this.commitValue();
      } finally {
        this.groupId = undefined;
      }
      // The new SQL has just cleared the old audit (SetProperty); an audit the dialog made for this
      // very SQL is written now that the dataset has it.
      const audit = peticion.audit;
      if (audit && dataInfo && sameSql(audit.sql, dataInfo.sql)) {
        dataInfo.sqlExplanation = audit.explanation;
        dataInfo.sqlExplanationError = audit.error;
      }
      if (report && dataInfo && changes.length) {
        const op = new ChangeObjectOperation(OperationType.Modify, groupId ?? 0);
        op.componentClass = dataInfo.className;
        op.componentName = dataInfo.name;
        for (const change of changes) {
          op.addProperty(change.name, change.type, change.oldValue, change.newValue);
          (dataInfo as any)[change.name] = change.newValue;
        }
        if (report.undoCue) report.undoCue.addOperation(op, report);
        else report.modified = true;
      }
    }
  }
  /**
   * The dialog of the unions of a dataset of the MyBase connection. It changes several properties of
   * the dataset (the datasets it joins, parallel, grouping, index fields): they are applied here as one
   * undo step, not through the cell, and the rows are shown again.
   */
  public async unionsPropertyClick() {
    const report = this.propServ.report;
    let datasetName = "";
    for (const prop of this.propServ.properties) {
      if (prop.name == "alias") {
        datasetName = prop.value;
        break;
      }
    }
    const dataInfo = report?.dataInfo.find((d) => d.alias === datasetName);
    if (!report || !dataInfo) {
      return;
    }
    // The fields of the datasets as the expression editor gets them (the server remembers the columns
    // per SQL text). Without them the dialog still edits the union: the common fields are written.
    try {
      await this.updateReportDatasetHelper(ReadReportOperation.ReadFunctionsColumns);
    } catch (err) {
      console.warn("[designer] the columns of the datasets could not be read", err);
    }
    const helper = this.propServ.reportDatasetHelper;
    const settings = await UnionsDialogComponent.editUnions(
      this.propServ.presentationService,
      report,
      dataInfo,
      (alias) => knownDatasetFields(helper, alias)
    );
    if (!settings) {
      return;
    }
    if (applyUnionSettings(report, dataInfo, settings)) {
      this.propServ.refresh?.();
    }
  }
  public async fontStyleClick() {
    let fontName = "";
    let fontStyle = 0;
    for (const prop of this.propServ.properties) {
      if (prop.type == PropertyTypeDesign.FontStyle) {
        fontStyle = prop.valueInteger;
      }
      if (prop.type == PropertyTypeDesign.FontName && !fontName) {
        fontName = prop.valueString;
      }
    }
    const fontSel = FontSelection.GetFonSelection(fontName, fontStyle);
    const result = await FontSelectorDialogComponent.selectFont(
      this.propServ.presentationService,
      fontSel
    );
    if (result) {
      let groupId: number | undefined;
      const props: PropertyValue[] = [];
      try {
        for (const prop of this.propServ.properties) {
          if (prop.type == PropertyTypeDesign.FontStyle) {
            if (prop.valueInteger != FontSelection.FontSelectionToFontStyleInt(result)) {
              if (!groupId) {
                groupId = this.propServ.report.undoCue?.getGroupId();
              }
              prop.groupId = groupId;
              props.push(prop);
              prop.valueInteger = FontSelection.FontSelectionToFontStyleInt(result);
            }
          }
          if (prop.type == PropertyTypeDesign.FontName) {
            if (prop.valueString != result.fontFamily) {
              if (!groupId) {
                groupId = this.propServ.report.undoCue?.getGroupId();
              }
              prop.groupId = groupId;
              props.push(prop);
              prop.valueString = result.fontFamily;
            }
          }
        }
      } finally {
        for (const prop of props) {
          prop.groupId = undefined;
        }
      }
    }
  }
}

export enum PropertyTypeDesign {
  Integer = 1,
  Number = 2,
  String = 3,
  Date = 4,
  Binary = 5,
  Boolean = 6,
  Variant = 7,
  Enum = 8,
  Color = 9,
  FontName = 10,
  FontStyle = 11,
  StringArray = 12,
  StringEnum = 13,
  Image = 14,
  Category = 15,
  Expression = 16,
  Sql = 17,
  StringMultiline = 18,
  Twips = 19,
  /** The unions of a dataset of the MyBase connection: the entries separated by commas, with a dialog. */
  Unions = 20,
}

export class FontData {
  public fontFamily?: string;
  public bold = false;
  public italic = false;
  public underline = false;
  public strikeout = false;
}

export enum FontStyle {
  Regular = 0,
  Bold = 1,
  Italic = 2,
  Underline = 4,
  Strikeout = 8,
}

export enum ResfreshLevel {
  None,
  UpdateView,
  UpdateSureport,
}
