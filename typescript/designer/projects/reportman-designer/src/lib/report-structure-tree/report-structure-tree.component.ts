import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnDestroy,
  ViewEncapsulation,
  ViewChild,
  ElementRef,
  OnChanges,
  SimpleChanges,
  ChangeDetectorRef,
  Inject,
  Optional,
} from "@angular/core";

// Import the classes of @reportman/lib
import {
  Report,
  SubReport,
  DataInfo,
  DatabaseInfo,
  Param,
  Section,
  ReportItem,
  PrintItem,
  SectionType,
  ParamType,
  PrintPosItem,
  ReadReportRequest,
  ReadReportOperation,
  ChangeObjectOperation,
  OperationType,
  VariantType,
} from "@reportman/lib";
import { TranslationService } from "../services/translator.service";
import { DesignUtils } from "../models/design-utils";
import { CanvasService } from "../services/canvas.service";
import { Subscription } from "rxjs";
import { ReportEditorComponent } from "../report-editor/report-editor.component";
import { FileService } from "../services/file.service";
import { NgxReportmanLibService } from "../services/ngx-reportman-lib.service";
import { PresentacionService } from "../shell/presentacion.service";
import { SharedModule } from "../shell/shared.module";
import { OpcionMenu } from "../shell/opcion-menu";
import {
  FlexibleConnectedPositionStrategyOrigin,
  NoopScrollStrategy,
  ScrollStrategy,
} from "@angular/cdk/overlay";
import { TipoConfirmacion } from "../shell/tipo-confirmacion";
import { DESIGNER_CONNECTIONS, DesignerConnections } from "../shell/designer-connections";
import { DESIGNER_AI, DesignerAi } from "../shell/designer-ai";

@Component({
  selector: "report-structure-tree",
  templateUrl: "./report-structure-tree.component.html",
  styleUrls: ["./report-structure-tree.component.css"],
  encapsulation: ViewEncapsulation.Emulated,
  imports: [SharedModule],
})
export class ReportStructureTreeComponent implements OnDestroy, OnChanges {
  @Input() public report: Report | null = null;
  @Input() public reportEditor: ReportEditorComponent | null = null;
  /** The panel's title, given by the editor. */
  @Input() public heading = "Estructura";

  @Output() public selected = new EventEmitter<any>();
  @ViewChild("fileInput") public fileInput?: ElementRef<HTMLInputElement>;
  @ViewChild("inputName") protected inputName?: ElementRef<HTMLInputElement>;
  @ViewChild("elemento") private el?: ElementRef<HTMLDivElement>;

  public expandedNodes = new Set<string>();

  // New: the item currently selected
  public selectedItem: ReportItem | undefined = undefined;
  private canvasSubscription: Subscription;
  protected editingSubreportName: SubReport | undefined = undefined;
  protected editingName = "";
  public dropdownOpen = false;
  protected opciones?: OpcionMenu[];
  protected overlayOrigin?: FlexibleConnectedPositionStrategyOrigin;
  protected overlayScrollStrategy: ScrollStrategy = new NoopScrollStrategy();
  protected abierto = false;
  protected fontSize?: string;

  protected traducciones = {
    conexiones: "",
    datos: "",
    parametros: "",
    subinformes: "",
  };

  constructor(
    protected t: TranslationService,
    private canvasService: CanvasService,
    private fileService: FileService,
    private pres: PresentacionService,
    private reportService: NgxReportmanLibService,
    private cdr: ChangeDetectorRef,
    private host: ElementRef<HTMLElement>,
    @Optional() @Inject(DESIGNER_CONNECTIONS) private connections: DesignerConnections | null,
    @Optional() @Inject(DESIGNER_AI) protected ai: DesignerAi | null
  ) {
    this.expandedNodes.add("subreports");
    this.traducciones.conexiones = t.TranslateStr(1275);
    this.traducciones.datos = t.TranslateStr(876);
    this.traducciones.parametros = t.TranslateStr(152);
    this.traducciones.subinformes = t.TranslateStr(125);
    this.canvasSubscription = this.canvasService.selectionChanged.subscribe(() => {
      this.selectionChanged();
    });
  }
  public getStructureOptions(): OpcionMenu[] {
    const structureOptions: OpcionMenu[] = [];
    const exportItem: OpcionMenu = {
      icono: 180,
      nombre: "Exportar",
      disabled: !this.selectedItem,
      callback: () => {
        this.exportClick();
      },
    };
    structureOptions.push(exportItem);
    const importItem: OpcionMenu = {
      icono: 179,
      nombre: "Importar",
      disabled: !this.selectedItem,
      callback: () => {
        this.importClick();
      },
    };
    structureOptions.push(importItem);

    /*
      <boton
    [iconoSize]="19"
    estilo="toolbar"
    [disabled]="!selectedItem"
    (clicked)="exportClick()"
    [icono]="180"
  ></boton>
  <boton [iconoSize]="19" estilo="toolbar" (clicked)="importClick()" [icono]="179"></boton>*/
    /* this.structureOptions.push({
      label: this.t.TranslateStr(149),
      children: addSubMenu,
    });
    for (const menu of addSubMenu) {
      structureOptions.push(menu);
    }*/
    return structureOptions;
  }

  protected getNewOptions(): OpcionMenu[] {
    const newOptions: OpcionMenu[] = [];
    newOptions.push({
      nombre: this.t.TranslateStr(125),
      callback: () => this.addSubreport(),
    });
    newOptions.push({
      nombre: this.t.TranslateStr(484),
      callback: () => this.addSection(SectionType.PageHeader),
      disabled: this.getSelectedSubreport() ? false : true,
    });
    newOptions.push({
      nombre: this.t.TranslateStr(493),
      callback: () => this.addSection(SectionType.GroupHeader),
      disabled: this.getSelectedSubreport() ? false : true,
    });
    newOptions.push({
      nombre: this.t.TranslateStr(488),
      callback: () => this.addSection(SectionType.Detail),
      disabled: this.getSelectedSubreport() ? false : true,
    });
    newOptions.push({
      nombre: this.t.TranslateStr(491),
      callback: () => this.addSection(SectionType.PageFooter),
      disabled: this.getSelectedSubreport() ? false : true,
    });
    newOptions.push({
      nombre: this.t.TranslateStr(722),
      callback: () => this.addParam(),
    });
    newOptions.push({
      nombre: this.t.TranslateStr(876),
      callback: () => this.addDataset(),
    });
    newOptions.push({
      nombre: this.t.TranslateStr(154),
      callback: () => this.addConnection(),
    });
    return newOptions;
  }

  public ngOnChanges(changes: SimpleChanges): void {
    if (changes["report"]) {
      //  this.selectionChanged();
    }
  }

  private addSubreport() {
    if (!this.report) {
      return;
    }
    const subreport = new SubReport();
    SubReport.initNew(this.report, subreport);
    this.report.newName(subreport);
    const groupId = this.report!.undoCue!.getGroupId();
    this.report.addSubReport(subreport, groupId);
    this.selectPrintItem(subreport);
  }
  private async addConnection() {
    if (!this.report) {
      return;
    }
    // The alias has to match one the host resolves: offer those, leaving room to type a new one.
    let known: string[] = [];
    if (this.connections) {
      try { known = await this.connections.listAliases(); } catch { known = []; }
    }
    const inUse = new Set(this.report.databaseInfo.map((d) => (d.alias ?? "").toUpperCase()));
    const opciones = known.filter((a) => !inUse.has(a.toUpperCase()));
    const pedirDato = await this.pres.pedirOpcion({
      descripcion: this.t.TranslateStr(1275),
      titulo: this.t.TranslateStr(399),
      valorOmision: opciones.length === 1 ? opciones[0] : "",
      aceptarVacio: false,
      opciones,
      ayuda: known.length > 0 ? undefined : this.t.TranslateStr(174),
    });
    if (pedirDato.cancelado) {
      return;
    }
    const alias = pedirDato.valor;
    if (!alias) {
      return;
    }
    const item = new DatabaseInfo();
    item.alias = alias.toUpperCase();
    this.report.newName(item);
    const groupId = this.report!.undoCue!.getGroupId();
    this.report.addDatabaseInfo(item, groupId);
    this.selectPrintItem(item);
  }
  private async addDataset() {
    if (!this.report) {
      return;
    }
    const pedirDato = await this.pres.pedirTexto({
      descripcion: this.t.TranslateStr(518),
      titulo: this.t.TranslateStr(539),
      valorOmision: "",
      aceptarVacio: false,
    });
    if (pedirDato.cancelado) {
      return;
    }
    const alias = pedirDato.valor?.trim();
    if (!alias) {
      return;
    }
    const item = new DataInfo();
    item.alias = alias.toUpperCase();
    // As Delphi's ANewExecute: on the report's first connection.
    const connection = this.report.databaseInfo[0]?.alias;
    if (connection) item.databaseAlias = connection;
    this.report.newName(item);
    const groupId = this.report!.undoCue!.getGroupId();
    this.report.addDataInfo(item, groupId);
    this.selectPrintItem(item);
  }
  private async addParam() {
    if (!this.report) {
      return;
    }
    const pedirDato = await this.pres.pedirTexto({
      descripcion: this.t.TranslateStr(722),
      titulo: this.t.TranslateStr(186),
      valorOmision: "",
      aceptarVacio: false,
    });
    if (pedirDato.cancelado) {
      return;
    }
    const alias = pedirDato.valor;
    if (!alias) {
      return;
    }
    const item = new Param();
    item.paramType = ParamType.String;
    item.value = { type: VariantType.String, value: "" };
    item.visible = false;
    item.alias = alias.toUpperCase();
    this.report.newName(item);
    const groupId = this.report!.undoCue!.getGroupId();
    this.report.addParam(item, groupId);
    this.selectPrintItem(item);
  }
  protected async deleteItem(item: ReportItem) {
    if (!this.report) {
      return;
    }
    let deleteRelated = false;
    const isSubReport = item.className == "TRPSUBREPORT";
    let subreportIndex = isSubReport ? this.report.subReports.indexOf(item as SubReport) : -1;
    if (isSubReport) {
      const subreport = item as SubReport;
      if (subreport.alias) {
        const resultadopPregunta = await this.pres.pedirConfirmacion({
          titulo: this.t.TranslateStr(150),
          descripcion: this.t.t("DesignerDeleteRelatedData"),
          tipo: TipoConfirmacion.PosNegNeut,
        });
        if (resultadopPregunta == undefined) {
          return;
        }
        if (resultadopPregunta) {
          deleteRelated = true;
        }
      }
    }
    if (!isSubReport || !(item as SubReport).alias) {
      const resultado = await this.pres.pedirConfirmacion({
        titulo: "Eliminar",
        descripcion: "¿Eliminar elemento seleccionado?",
      });
      if (!resultado) {
        return;
      }
    }
    const groupId = this.report!.undoCue!.getGroupId();
    this.report?.deleteItem(item, groupId, deleteRelated);
    if (isSubReport) {
      subreportIndex--;
      if (subreportIndex < 0) {
        subreportIndex = 0;
      }
      this.reportEditor?.selectSubReport(this.report?.subReports[subreportIndex]);
    }
    this.reportEditor?.refreshSubReport();
  }
  private async addSection(sectionType: SectionType) {
    if (!this.report?.undoCue) {
      throw new Error("Report not assigned");
    }
    const subreport = this.getSelectedSubreport();
    if (!subreport) {
      throw new Error("A subreport must be selected");
    }
    const groupId = this.report.undoCue.getGroupId();
    let groupName: string | undefined = undefined;
    const section = new Section();
    // As wide as the subreport's detail (a group or a header printed narrower or wider than the
    // detail); Delphi's 19 cm (C_DEFAULT_SECTION_WIDTH) when there is none.
    const reference = subreport.sections.find((s) => s.sectionType === SectionType.Detail) ?? subreport.sections[0];
    section.width = reference?.width ?? SubReport.defaultSectionWidth;
    section.height = Math.round((2 / 2.54) * 1440);

    section.sectionType = sectionType;
    this.report?.newName(section);
    if (sectionType == SectionType.GroupHeader) {
      const pedirDato = await this.pres.pedirTexto({
        descripcion: this.t.TranslateStr(277),
        titulo: this.t.TranslateStr(276),
        valorOmision: "GROUP",
        aceptarVacio: false,
      });
      if (pedirDato.cancelado) {
        return;
      }
      groupName = pedirDato.valor;
      if (!groupName) {
        return;
      }
      section.groupName = groupName.toUpperCase();
    }
    const idx = SubReport.getSectionAddIndex(subreport, section);
    this.report.addSection(subreport, section, groupId, idx);
    if (sectionType == SectionType.GroupHeader) {
      const footer = new Section();
      footer.width = section.width;
      footer.height = section.height;
      footer.sectionType = SectionType.GroupFooter;
      this.report?.newName(footer);
      footer.groupName = (groupName ?? "").toUpperCase();
      const idxFooter = SubReport.getSectionAddIndex(subreport, footer);
      this.report.addSection(subreport, footer, groupId, idxFooter);
    }
    this.reportEditor?.refreshSubReport();
  }
  protected getSelectedSubreport(): SubReport | undefined {
    if (!this.selectedItem || !this.report) {
      return undefined;
    }
    if (this.selectedItem.className == "TRPSECTION") {
      return this.report.getParentSubReport(this.selectedItem as Section);
    } else {
      if (this.selectedItem.className == "TRPSUBREPORT") {
        return this.selectedItem as SubReport;
      }
    }
    return undefined;
  }
  private selectPrintItem(printItem: ReportItem) {
    this.selectedItem = printItem;
    this.canvasService.selectItem(printItem);
  }
  private selectionChanged() {
    if (!this.report || !this.reportEditor) {
      return;
    }
    const items = this.canvasService.getSelectedReportItems(this.reportEditor);
    if (!items || items.length != 1) {
      this.selectedItem = undefined;
      return;
    }
    if (items[0].item != this.selectedItem) {
      this.selectedItem = undefined;
    }
    // Detect subreport change
    if (items.length > 0) {
      const item = items[0].item;
      let subrep: SubReport | undefined = undefined;
      switch (item.className) {
        case "TRPSUBREPORT":
          {
            subrep = item as SubReport;
            if (this.selectedItem == item) {
              break;
            }
            this.expandSubreport(subrep);
            this.onSelect(subrep);
            this.cdr.detectChanges();
            const subreportElement = this.nodeById(subrep.name);
            subreportElement?.scrollIntoView({
              block: "center",
              inline: "nearest",
              behavior: "smooth",
            });
          }
          break;
        case "TRPSECTION":
          {
            subrep = this.report.getParentSubReportOrUndefined(item as Section);
            if (!subrep) {
              this.canvasService.clearSelection();
              break;
            }
            if (this.selectedItem == item) {
              break;
            }
            this.expandSubreport(subrep);
            // Only highlight the tree node. Do NOT call onSelect()/selectItem() here: this runs
            // in reaction to a selection that ALREADY happened (typically a mousedown on the
            // section bar in the canvas)
            this.selectedItem = item;
            this.cdr.detectChanges();
            const sectionElement = this.nodeById(item.name);
            sectionElement?.scrollIntoView({
              block: "center",
              inline: "nearest",
              behavior: "smooth",
            });
          }
          break;
        case "TRPBARCODE":
        case "TRPLABEL":
        case "TRPCHART":
        case "TRPIMAGE":
        case "TRPSHAPE":
        case "TRPEXPRESSION":
          {
            const section = this.report.getParentSection(item as PrintPosItem);
            subrep = this.report.getParentSubReport(section as Section);
            if (this.selectedItem == item) {
              break;
            }
            this.expandSubreport(subrep);
            this.selectedItem = section;
            this.cdr.detectChanges();
            const sectionElement = this.nodeById(section.name);
            sectionElement?.scrollIntoView({
              block: "center",
              inline: "nearest",
              behavior: "smooth",
            });
          }
          break;
      }
      if (subrep) {
        const currentSubreport = this.reportEditor.reportDesign.subreportEditor?.subReport;
        if (currentSubreport != subrep) {
          this.reportEditor.selectSubReport(subrep);
        }
      }
    }
  }
  public ngOnDestroy(): void {
    this.canvasSubscription.unsubscribe();
  }

  /** A node of this tree by its id, looked up here and not in document (which does not see into a shadow root). */
  private nodeById(id: string): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>("#" + CSS.escape(id));
  }

  private expandSubreport(subrep: SubReport) {
    if (!this.expandedNodes.has("subreports")) {
      this.expandedNodes.add("subreports");
    }
    if (!this.expandedNodes.has(this.getNodeId("sub", subrep.name))) {
      this.expandedNodes.add(this.getNodeId("sub", subrep.name));
    }
  }

  protected onSelect(item: any) {
    this.selectedItem = item;
    this.canvasService.selectItem(item as ReportItem);
    // this.selected.emit(item);
  }
  protected onSelectDataSetSubreport(item: any, subreport: SubReport) {
    if (this.reportEditor?.reportDesign.subreportEditor?.subReport != subreport) {
      this.reportEditor!.selectSubReport(subreport);
    }
    this.onSelect(item);
  }
  protected subReportClick(item: SubReport, ev: MouseEvent) {
    if (ev.button == 0) {
      this.onSelect(item);
    } else {
      if (ev.button == 2) {
        this.onSelect(item);
        ev.preventDefault();
        this.openSubReportMenu(item, ev);
      }
    }
  }

  public toggleNode(nodeId: string) {
    if (this.expandedNodes.has(nodeId)) {
      this.expandedNodes.delete(nodeId);
    } else {
      this.expandedNodes.add(nodeId);
    }
  }

  public isExpanded(nodeId: string): boolean {
    return this.expandedNodes.has(nodeId);
  }

  public getNodeId(prefix: string, name: string) {
    return `${prefix}:${name}`;
  }
  protected sectionDisplayName(section: Section): string {
    if (!this.report) {
      return "";
    } else {
      return DesignUtils.getSectionDisplayName(this.report, section, true, this.t);
    }
  }
  protected subreportDisplayName(subreport: SubReport): string {
    if (!this.report) {
      return "";
    }
    return DesignUtils.getSubreportDisplayName(
      subreport.name,
      this.t,
      true,
      subreport.alias
    );
  }
  protected exportDisabled() {
    switch (this.selectedItem?.className) {
      case "TRPSUBREPORT":
      case "TRPREPORT":
        return false;
      default:
        return true;
    }
  }
  protected exportClick() {
    switch (this.selectedItem?.className) {
      case "TRPSUBREPORT":
        this.exportSubReport(this.selectedItem as SubReport);
        break;
      case "TRPREPORT":
        this.exportReport(this.reportEditor?.reportName ?? "report");
        break;
    }
  }
  private exportSubReport(subreport: SubReport) {
    if (!this.report) {
      return;
    }
    const subreportName = DesignUtils.getSubreportDisplayName(
      subreport.name,
      this.t,
      true,
      subreport.alias
    );
    this.export(this.report, subreportName, this.report.subReports.indexOf(subreport));
  }
  private exportReport(filename: string) {
    if (!this.report) {
      return;
    }
    this.export(this.report, filename, undefined);
  }
  private async export(report: Report, filename: string, subreportIndex: number | undefined) {
    const loading = await this.pres.mostrarLoading();
    try {
      const request = new ReadReportRequest();
      request.report = report;
      if (subreportIndex != null) {
        request.expression = subreportIndex.toString();
        request.operation = ReadReportOperation.ExportSubReport;
      } else {
        request.operation = ReadReportOperation.ExportReport;
      }
      const response = await this.reportService.getReadReportResponse(request);
      if (response.errorMessage) {
        await this.pres.mostrarError(response.errorMessage);
      } else {
        const valueString = response.evaluateResult?.value;
        this.fileService.downloadFile(valueString, filename + ".rep");
      }
    } finally {
      loading.ocultar();
    }
  }
  protected async importClick() {
    if (!this.report) {
      return;
    }
    this.fileInput?.nativeElement.click();
  }
  public onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];

    if (!file.name.endsWith(".rep")) {
      alert(this.t.t("DesignerChooseRepFile"));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      // "reader.result" is base64 with the prefix "data:...;base64,xxxx"
      const result = reader.result as string;

      // Keep only the base64 part, without the prefix
      const base64File = result.split(",")[1];
      this.importReport(base64File);
      input.value = "";
    };

    reader.readAsDataURL(file); // converts the file to base64
  }
  private async importReport(base64File: string) {
    if (!this.report || !this.reportEditor) {
      return;
    }
    /*const loading = await this.pres.mostrarLoading();
    try {
      const request = new ReadReportRequest();
      request.report = this.report;
      request.expression = base64File;
      request.operation = ReadReportOperation.Import;
      const response = await this.reportService.getReadReportResponse(request);
      if (response.errorMessage) {
        await this.pres.mostrarError(response.errorMessage);
      } else {
        this.reportEditor.report = response.report;
        this.reportEditor.initReport();
      }
    } finally {
      loading.ocultar();
    }*/
    let reportToImport: Report | undefined;
    const loading = await this.pres.mostrarLoading();
    try {
      const request = new ReadReportRequest();
      request.expression = base64File;
      request.operation = ReadReportOperation.ReadReport;
      const response = await this.reportService.getReadReportResponse(request);
      if (response.errorMessage || !response.report) {
        await this.pres.mostrarError(response.errorMessage);
      } else {
        reportToImport = response.report;
        // Check duplicate aliases
      }
    } finally {
      loading.ocultar();
    }
    if (!reportToImport) {
      return;
    }
    for (const dataSet of reportToImport.dataInfo) {
      if (this.report.containsDataInfo(dataSet.alias ?? "")) {
        const resultadoConfirmacion = await this.pres.pedirConfirmacion({
          titulo: this.t.t("DesignerDuplicated"),
          descripcion: this.t.t("DesignerDatasetRenamed", { alias: dataSet.alias }),
        });
        if (!resultadoConfirmacion) {
          return;
        }
      }
    }
    this.report.import(reportToImport);
  }
  protected upEnabled(): boolean {
    if (!this.selectedItem || !this.report) {
      return false;
    }
    switch (this.selectedItem.className) {
      case "TRPREPORT":
        return false;
      case "TRPSUBREPORT": {
        const subrep = this.selectedItem as SubReport;
        const isFirstSubreport = this.report.subReports.indexOf(subrep) == 0;
        return !isFirstSubreport;
      }
      case "TRPSECTION": {
        const section = this.selectedItem as Section;
        const subreport = this.report!.getParentSubReportOrUndefined(section);
        if (!subreport) {
          return false;
        }
        const index = subreport.sections.indexOf(section);
        if (subreport.sections.length <= 1) {
          return false;
        }
        const isFirstSection = index == 0;
        if (!isFirstSection) {
          if (subreport.sections[index - 1].sectionType == section.sectionType) {
            return true;
          } else {
            return false;
          }
        } else {
          return false;
        }
      }
      case "TRPPARAM": {
        const param = this.selectedItem as Param;
        const isFirstParam = this.report.params.indexOf(param) == 0;
        return !isFirstParam;
      }
      case "TRPDATAINFOITEM": {
        const ditem = this.selectedItem as DataInfo;
        const isFirstDataInfo = this.report.dataInfo.indexOf(ditem) == 0;
        return !isFirstDataInfo;
      }
      case "TRPDATABASEINFOITEM": {
        const dbitem = this.selectedItem as DatabaseInfo;
        const isFirstDbInfo = this.report.databaseInfo.indexOf(dbitem) == 0;
        return !isFirstDbInfo;
      }
      default:
        throw new Error("Classname incorrect: " + this.selectedItem.className);
    }
  }
  protected downEnabled(): boolean {
    if (!this.selectedItem || !this.report) {
      return false;
    }
    switch (this.selectedItem.className) {
      case "TRPREPORT":
        return false;
      case "TRPSUBREPORT": {
        const subrep = this.selectedItem as SubReport;
        const isLastSubreport =
          this.report.subReports.indexOf(subrep) >= this.report.subReports.length - 1;
        return !isLastSubreport;
      }
      case "TRPSECTION": {
        const section = this.selectedItem as Section;
        const subreport = this.report?.getParentSubReportOrUndefined(section);
        if (!subreport) {
          return false;
        }
        if (subreport.sections.length <= 1) {
          return false;
        }
        const index = subreport.sections.indexOf(section);
        const isLastSection = index >= subreport.sections.length - 1;
        if (!isLastSection) {
          if (subreport.sections[index + 1].sectionType == section.sectionType) {
            return true;
          } else {
            return false;
          }
        } else {
          return false;
        }
      }
      case "TRPPARAM": {
        const param = this.selectedItem as Param;
        const isLastParam = this.report.params.indexOf(param) >= this.report.params.length - 1;
        return !isLastParam;
      }
      case "TRPDATAINFOITEM": {
        const ditem = this.selectedItem as DataInfo;
        const isLastDataInfo =
          this.report.dataInfo.indexOf(ditem) >= this.report.dataInfo.length - 1;
        return !isLastDataInfo;
      }
      case "TRPDATABASEINFOITEM": {
        const dbitem = this.selectedItem as DatabaseInfo;
        const isLastDbInfo =
          this.report.databaseInfo.indexOf(dbitem) >= this.report.databaseInfo.length - 1;
        return !isLastDbInfo;
      }
      default:
        throw new Error("Classname incorrect: " + this.selectedItem.className);
    }
  }
  protected upClick() {
    if (!this.selectedItem || !this.report) {
      return;
    }
    this.report.upReportItem(this.selectedItem);
    this.reportEditor?.refreshSubReport();
  }
  protected downClick() {
    if (!this.selectedItem || !this.report) {
      return;
    }
    this.report.downReportItem(this.selectedItem);
    this.reportEditor?.refreshSubReport();
  }
  protected subreportDblClick(sub: SubReport) {
    this.editingName = sub.name;
    this.editingSubreportName = sub;
    setTimeout(() => this.inputName?.nativeElement.focus());
  }
  protected async subreportDuplicate(subreport: any) {
    if (!this.report) {
      return;
    }
    if (!(subreport instanceof SubReport)) {
      return;
    }
    const sub = subreport as SubReport;
    const resultadoNombre = await this.pres.pedirTexto({
      titulo: "Duplicar",
      descripcion: "Nombre del subinforme",
      valorOmision: sub.name,
      aceptarVacio: false,
    });
    if (resultadoNombre.cancelado) {
      return;
    }
    const nombre = resultadoNombre.valor;
    if (!nombre) {
      return;
    }
    if (this.report?.components.get(nombre.toUpperCase())) {
      throw new Error("El nombre ya existe");
    }
    let nombreAlias: string | undefined = undefined;
    if (sub.alias) {
      const resultadoAlias = await this.pres.pedirTexto({
        titulo: "Duplicar",
        descripcion: "Nombre del conjunto de datos",
        valorOmision: sub.alias,
        aceptarVacio: false,
      });
      if (resultadoAlias.cancelado) {
        return;
      }
      nombreAlias = resultadoAlias.valor;
    }
    const newReport = new Report();
    const subrepClone = sub.clone();
    if (nombreAlias) {
      subrepClone.alias = nombreAlias;
    }
    subrepClone.name = nombre;
    newReport.subReports.push(subrepClone);
    if (subrepClone.alias) {
      const dataInfo = this.getDatasetAlias(subrepClone.alias);
      if (dataInfo) {
        newReport.dataInfo.push(dataInfo.clone());
      }
    }
    this.report.import(newReport);
  }
  protected subReportNameSelectAll(event: FocusEvent) {
    const input = event.target as HTMLInputElement;
    input.select();
  }
  protected subReportNameEnter() {
    if (!this.editingSubreportName || !this.report?.undoCue) {
      return;
    }
    const newName = this.editingName.trim();
    if (!newName) {
      return;
    }
    const compo = this.report.components.get(newName.toUpperCase());
    if (compo == this.editingSubreportName) {
      this.cancelEditSubreportName();
      return;
    }
    if (compo !== undefined) {
      throw new Error("Duplicate name");
    }
    const oldName = this.editingSubreportName.name;
    this.report.components.delete(this.editingSubreportName.name);
    this.report.components.set(newName.toUpperCase(), this.editingSubreportName);
    this.editingSubreportName.name = newName;
    this.cancelEditSubreportName();
    const changeOp = new ChangeObjectOperation(
      OperationType.Rename,
      this.report.undoCue.getGroupId()
    );
    changeOp.componentName = newName;
    changeOp.oldParentName = oldName;
    this.report.undoCue.addOperation(changeOp, this.report);
  }
  protected cancelEditSubreportName() {
    this.editingSubreportName = undefined;
    this.editingName = "";
  }
  protected onOutsideClick() {
    this.abierto = false;
  }

  protected onOverlayDetach() {
    this.abierto = false;
  }
  protected openSubReportMenu(subrep: SubReport, ev: MouseEvent) {
    this.opciones = [];
    this.opciones.push({ nombre: "Renombrar", callback: () => this.subreportDblClick(subrep) });
    this.overlayOrigin = ev;
    this.abierto = true;

    // Update the overlay font size
    const element = this.el?.nativeElement;
    if (element) {
      const styles = window.getComputedStyle(element);
      this.fontSize = styles.fontSize;
    }
  }
  protected opcionSeleccionada(opcion: OpcionMenu) {
    this.abierto = false;
    opcion.callback?.();
  }
  protected getDatasetAlias(alias: string | undefined): DataInfo | undefined {
    if (!this.report) {
      return undefined;
    }
    for (const data of this.report.dataInfo) {
      if (data.alias === alias) {
        return data;
      }
    }
    return undefined;
  }
}
