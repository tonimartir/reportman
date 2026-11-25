import {
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
  ViewContainerRef,
  Output,
  EventEmitter,
  HostListener,
  ViewEncapsulation,
  NgZone,
  ChangeDetectorRef,
  signal,
} from "@angular/core";
import {
  PrintPosItem,
  Report,
  Section,
  SubReport,
  ChangeObjectOperation,
  OperationType,
  PropertyType,
  ReportItem,
  LabelItem,
  ExpressionItem,
  ShapeItem,
  ShapeType,
  ImageItem,
  BarcodeItem,
  ChartItem,
  ExecuteReportRequest,
  ReadReportRequest,
  ReportResult,
  WriteReportRequest,
  hydrateReport,
} from "@reportman/lib";
import {
  Canvas,
  Rect,
  Group,
  Textbox,
  FabricImage,
  ModifiedEvent,
  TPointerEvent,
  BasicTransformEvent,
  FabricObject,
  ActiveSelection,
  controlsUtils,
} from "fabric";
import {
  ComponentEditorDesign,
  CoordType,
  ReportEditorDesign,
  SectionEditorDesign,
  SubreportEditorDesign,
} from "../models/report-editor-design";
import { DesignUtils } from "../models/design-utils";
import { MeasureUnitType, ReportDesignPreferences } from "../models/report-design-preferences";
import { TopRulerComponent } from "../top-ruler/top-ruler.component";
import { TopRulerOption } from "../models/top-ruler-margin-option";

import { FormsModule } from "@angular/forms";
import { ObjectInspectorComponent } from "../object-inspector/object-inspector.component";
import { CanvasService, RectangleArea } from "../services/canvas.service";
import { TranslationService } from "../services/translator.service";
import { ReportStructureTreeComponent } from "../report-structure-tree/report-structure-tree.component";
import { GridOptionsDialogComponent } from "../dialogs/grid-options-dialog/grid-options-dialog.component";
import { PresentacionService } from "../shell/presentacion.service";
import { NavegacionService } from "../shell/app-services";
import { NgxReportmanLibService } from "../services/ngx-reportman-lib.service";
import { SharedModule } from "../shell/shared.module";
import { OpcionMenu } from "../shell/opcion-menu";
import { TipoConfirmacion } from "../shell/tipo-confirmacion";
import { Subscription } from "rxjs";
import { CacheService } from "../shell/app-services";
import { DBClientService } from "../shell/app-services";
import { CueListComponent } from "../components/cue-list/cue-list.component";

/** Which tab the right dock shows; empty when it is closed. */
export type DesignerRightPanel = "" | "copilot" | "history";

/** The texts of the editor's own chrome. */
export interface DesignerLabels {
  reportOptions: string;
  undo: string;
  redo: string;
  delete: string;
  cut: string;
  copy: string;
  paste: string;
  structure: string;
  properties: string;
  copilot: string;
  history: string;
  closePanel: string;
  modified: string;
  selectedObjects: string;
  aiWorking: string;
  aiStop: string;
}

/** The translation key of each chrome text: the host's `labels` may still say them otherwise. */
const LABEL_KEYS: Record<keyof DesignerLabels, string> = {
  reportOptions: "DesignerReportOptions",
  undo: "DesignerUndo",
  redo: "DesignerRedo",
  delete: "Delete",
  cut: "DesignerCut",
  copy: "Copy",
  paste: "DesignerPaste",
  structure: "DesignerStructure",
  properties: "DesignerProperties",
  copilot: "Copilot",
  history: "DesignerHistory",
  closePanel: "DesignerClosePanel",
  modified: "DesignerModified",
  selectedObjects: "DesignerSelectedObjects",
  aiWorking: "DesignerAiWorking",
  aiStop: "CopilotStop",
};

const LAYOUT_KEYS = {
  rightPanel: "rpd_right_panel",
  leftWidth: "rpd_left_width",
  rightWidth: "rpd_right_width",
  treeHeight: "rpd_tree_height",
};

function readNumber(key: string, fallback: number): number {
  try {
    const value = parseFloat(localStorage.getItem(key) ?? "");
    return isNaN(value) || value <= 0 ? fallback : value;
  } catch {
    return fallback;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

@Component({
  selector: "report-editor",
  imports: [
    TopRulerComponent,
    ObjectInspectorComponent,
    FormsModule,
    ReportStructureTreeComponent,
    SharedModule,
    CueListComponent,
  ],
  templateUrl: "./report-editor.component.html",
  styleUrl: "./report-editor.component.css",
  // Fabric does not work with Shadow DOM
  encapsulation: ViewEncapsulation.Emulated,
})
export class ReportEditorComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild("canvasContainer", { static: true })
  public canvasContainer!: ElementRef<HTMLDivElement>;
  @ViewChild("objectInspector")
  public objectInspector?: ObjectInspectorComponent;
  @ViewChild("reportStructure")
  public reportStructure?: ReportStructureTreeComponent;
  public report?: Report;
  @Input()
  public designPreferences: ReportDesignPreferences;
  @Input()
  public reportName?: string;
  @Output()
  public executed = new EventEmitter<ReportResult>();
  /** The host docks a copilot (content marked `rpdCopilot`): the right panel gets its tab. */
  @Input()
  public copilot = false;
  /** The host can store a report under another name: «Save as...» appears in the report menu. */
  @Input()
  public allowSaveAs = false;
  /** «Save as...» saved the report under this name, which is now the editor's. */
  @Output()
  public savedAs = new EventEmitter<string>();
  /**
   * The last run that failed, over the canvas until it is closed or the report runs again: a toast
   * went away before it could be read, and the text could not be copied to the copilot.
   */
  public readonly runError = signal<{ message: string; component?: string; property?: string } | null>(null);
  /** While the AI rewrites the document the canvas, tree and inspector are shielded; the dock stays live. */
  public readonly aiBusy = signal(false);
  public readonly aiBusyText = signal("");
  /** The person pressed Stop on the shield. */
  @Output()
  public aiStopRequested = new EventEmitter<void>();

  /** Locks (or frees) the document while an AI change is in flight. */
  public setAiBusy(busy: boolean, text = ""): void {
    this.aiBusy.set(busy);
    this.aiBusyText.set(text);
    this.cdr.markForCheck();
  }
  /** Texts of the editor's own chrome, for a host that translates; Spanish by default. */
  @Input()
  public labels: Partial<DesignerLabels> = {};

  @ViewChild("leftCol", { static: true })
  private leftCol!: ElementRef<HTMLElement>;
  @ViewChild("rightCol", { static: true })
  private rightCol!: ElementRef<HTMLElement>;

  // Layout, as in the desktop designer: a left column (structure over properties), the canvas and
  // a right dock with the copilot and the history. Sizes and the open tab are remembered per browser.
  protected leftWidth = readNumber(LAYOUT_KEYS.leftWidth, 272);
  protected rightWidth = readNumber(LAYOUT_KEYS.rightWidth, 360);
  protected treeHeight = readNumber(LAYOUT_KEYS.treeHeight, 240);
  protected rightPanel: DesignerRightPanel = "";

  protected DesignElementType = DesignElementType;
  protected canvas!: Canvas;
  // While a section bar is being dragged, the costly canvas.setDimensions() (it reassigns
  // the canvas backstore and re-renders everything) is deferred until it is released. See calcSubReportDimensions and objectModified.
  private isSectionResizing = false;
  private canvasElement?: HTMLCanvasElement;
  private changingZoom = false;
  private currentReportName?: string;
  protected selectedZoom = 1.0;
  public reportDesign = new ReportEditorDesign();
  // Initial size of the placeholder canvas (in recreateCanvas), before a report is loaded.
  public readonly MAXIMUMWIDTH = 2500;
  // FIXED margin (screen px, NOT scaled by zoom) around the report inside the canvas. The
  // canvas surface = scaled content (maxWidth/maxHeight, which already grow with the zoom) + this
  // margin. It exists so that the bottom/side resize bars can be stretched beyond the
  // edge of the report. Being fixed, the surface grows just as much as needed and never explodes with the zoom
  // (scaling this margin inflated the backstore and exceeded the Fabric cache limit -> slow and
  // blurry text). After a drag is released the surface is recalculated, so it is possible to keep
  // stretching indefinitely; the margin only limits how much it grows in a single drag.
  public readonly SURFACEMARGIN = 600;
  public readonly titleBarHeight = 20;
  private readonly rulerSize = 17;
  protected topRulerMargin = new TopRulerOption();
  protected activeSection?: Section;
  private subNavZoom?: Subscription;
  private afterUndoDoTimer?: ReturnType<typeof setTimeout>;
  protected zoomOptions = [
    { label: "40%", value: 0.4 },
    { label: "50%", value: 0.5 },
    { label: "60%", value: 0.6 },
    { label: "75%", value: 0.75 },
    { label: "90%", value: 0.9 },
    { label: "100%", value: 1 },
    { label: "110%", value: 1.1 },
    { label: "125%", value: 1.25 },
    { label: "140%", value: 1.4 },
    { label: "150%", value: 1.5 },
    { label: "175%", value: 1.75 },
    { label: "200%", value: 2 },
    { label: "250%", value: 2.5 },
    { label: "300%", value: 3.0 },
  ];
  protected designElementsMap = new Map<DesignElementType, boolean>();
  protected designElementsArray: DesignElementButton[] = [];
  protected errorMessage?: string;
  public isFabricActive = false;


  private canvasSubscription: Subscription;
  constructor(
    private canvasService: CanvasService,
    private translator: TranslationService,
    private pres: PresentacionService,
    private nav: NavegacionService,
    private cache: CacheService,
    private client: DBClientService,
    private containerRef: ViewContainerRef,
    private reportService: NgxReportmanLibService,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef
  ) {
    this.canvasSubscription = this.canvasService.selectionChanged.subscribe(() => {
      this.selectionChanged();
    });

    this.designElementsMap.set(DesignElementType.Pointer, true);
    this.designPreferences = new ReportDesignPreferences();
    this.topRulerMargin.margin = this.rulerSize;
    FabricObject.ownDefaults.cornerColor = "#FFF";
    FabricObject.ownDefaults.cornerStrokeColor = "#000";
    FabricObject.ownDefaults.cornerStyle = "circle";
    FabricObject.ownDefaults.cornerSize = 11;
    FabricObject.ownDefaults.borderColor = "#000";
    FabricObject.ownDefaults.transparentCorners = false;
    for (const current of Object.values(DesignElementType).filter((v) => typeof v === "number")) {
      const elType = current as DesignElementType;
      let label = "";
      let img: number | string | undefined = undefined;
      let imgSize: number | undefined = undefined;
      let shape: ShapeType | undefined = undefined;
      switch (elType) {
        case DesignElementType.Pointer:
          label = this.translator.TranslateStr(21);
          img = "north_west";
          imgSize = 18;
          break;
        case DesignElementType.Label:
          label = this.translator.TranslateStr(1203);
          img = "bootstrapTextareaT";
          imgSize = 20;
          break;
        case DesignElementType.Expression:
          label = this.translator.TranslateStr(571);
          img = "functions";
          imgSize = 18;
          break;
        case DesignElementType.Shape:
          label = this.translator.TranslateStr(1206);
          img = "category";
          imgSize = 18;
          shape = ShapeType.Rectangle;
          break;
        case DesignElementType.Image:
          label = this.translator.TranslateStr(1205);
          img = "image";
          imgSize = 18;
          break;
        case DesignElementType.Barcode:
          label = this.translator.t("DesignerToolBarcode");
          img = "matBarcodeSharp";
          imgSize = 22;
          break;
        case DesignElementType.Chart:
          label = this.translator.t("DesignerToolChart");
          img = "ionBarChartSharp";
          imgSize = 18;
          break;
      }
      this.designElementsArray.push({
        designElement: current as DesignElementType,
        icon: img,
        iconSize: imgSize,
        label: label,
        currentShape: shape,
      });
    }
  }
  protected getReportMenuOptions(): OpcionMenu[] {
    const reportMenuOptions: OpcionMenu[] = [];
    reportMenuOptions.push({
      nombre: this.translator.TranslateStr(179),
      callback: () => {
        this.gridOptionsClick();
      },
      disabled: !this.report,
    });
    reportMenuOptions.push({
      nombre: this.translator.TranslateStr(54),
      callback: () => {
        this.preview(undefined);
      },
      disabled: !this.report,
    });
    reportMenuOptions.push({
      nombre: this.translator.TranslateStr(54) + "(" + this.translator.TranslateStr(125) + ")",
      callback: () => {
        this.preview([
          this.report!.subReports.indexOf(this.canvasService.selectedItem as SubReport),
        ]);
      },
      disabled: !(this.canvasService.selectedItem?.className == "TRPSUBREPORT"),
    });
    // «New report» (790), not the hint of the action (41, «Creates a new report»).
    reportMenuOptions.push({
      nombre: this.translator.TranslateStr(790),
      callback: () => {
        this.newReport();
      },
    });
    if (this.allowSaveAs) {
      reportMenuOptions.push({
        nombre: this.translator.TranslateStr(48),
        callback: () => {
          this.saveAs();
        },
        disabled: !this.report,
      });
    }
    reportMenuOptions.push({
      nombre: this.L.history,
      checked: this.rightPanel === "history",
      callback: () => this.toggleRight("history"),
    });
    reportMenuOptions.push({
      nombre: this.translator.t("DesignerClearUndo"),
      callback: () => {
        this.limpiarCola();
      },
    });
    return reportMenuOptions;
  }
  public async newReport() {
    if (!this.report) {
      return;
    }
    // Only the changes would be lost: the stored report stays as it is until it is saved.
    if (!(await this.confirmDiscardChanges())) {
      return;
    }
    this.report.undoCue!.undoOperations = [];
    this.report.undoCue!.redoOperations = [];
    this.report.dataInfo = [];
    this.report.components.clear();
    this.report.subReports = [];
    const subreport = new SubReport();
    SubReport.initNew(this.report, subreport);
    this.report.newName(subreport);
    this.report.subReports.push(subreport);
    this.selectSubReport(subreport);
    // The empty report is not what is stored: leaving now must ask, as for any other change.
    this.report.modified = true;
    this.runError.set(null);
  }

  /**
   * Whether the changes may be lost (leaving, a new report): true without changes; otherwise asks
   * Save / Don't save / Cancel, as the desktop designers do. Save answers what saving answered.
   */
  public async confirmDiscardChanges(): Promise<boolean> {
    if (!this.report?.modified) {
      return true;
    }
    const answer = await this.pres.pedirConfirmacion({
      titulo: this.translator.t("DesignerUnsavedTitle"),
      descripcion: this.translator.t("DesignerUnsavedQuestion"),
      tipo: TipoConfirmacion.PosNegNeut,
      textoPositivo: this.translator.TranslateStr(46),
      textoNegativo: this.translator.t("DesignerDontSave"),
    });
    if (answer === true) {
      return await this.save();
    }
    return answer === false;
  }

  /** Closing or reloading the tab with changes: the browser asks (it does not let a page say what). */
  @HostListener("window:beforeunload", ["$event"])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.report?.modified) {
      event.preventDefault();
      event.returnValue = "";
    }
  }

  public ngOnChanges(changes: SimpleChanges): void {
    if (changes["report"]) {
      this.initReport();
    } else {
      if (changes["reportName"]) {
        this.currentReportName = changes["reportName"].currentValue;
      }
    }
  }
  private onLoadingFontDone = (event: Event) => {
    // Here you can check whether the loaded font is the one you want
    console.log("Event loadingdone fonts:", event);
    // console.log('Loaded fonts:', document.fonts);
  };
  private onErrorLoadingFontDone = (event: Event) => {
    // Here you can check whether the loaded font is the one you want
    console.log("Error Event loadingdone fonts:", event);
    // console.log('Loaded fonts:', document.fonts);
  };
  public async ngOnDestroy() {
    this.subNavZoom?.unsubscribe();
    this.canvasSubscription.unsubscribe();

    document.fonts.removeEventListener("loadingdone", this.onLoadingFontDone);
    document.fonts.removeEventListener("loadingerror", this.onErrorLoadingFontDone);
    if (this.canvasElement) {
      this.canvasElement.removeEventListener("keydown", this.handleArrowKeys);
    }
    document.removeEventListener("mousedown", this.onDocMouseDown);
    if (this.canvas) {
      this.canvas.off("mouse:down", this.onCanvasMouseDown);
    }
  }
  public async ngOnInit() {
    this.restoreLayout();
    /*await this.waitForFont('Arial');
    await document.fonts.ready;
    console.log('=== Fuentes cargadas ===');
    document.fonts.forEach((fontFace) => {
      console.log(`Family: ${fontFace.family}`);
      console.log(`Style: ${fontFace.style}`);
      console.log(`Weight: ${fontFace.weight}`);
      console.log(`Status: ${fontFace.status}`); // 'loaded' or 'unloaded'
      console.log('-----------------------------');
    });*/

    document.fonts.addEventListener("loadingdone", this.onLoadingFontDone);

    const definedFonts = [
      "Arial",
      "Courier New",
      "Times New Roman",
      "Microsoft YaHei",
      "Microsoft Sans Serif",
      "Arial Narrow",
    ];

    definedFonts.forEach((fontName) => {
      document.fonts.load(`1em "${fontName}"`);
      document.fonts.load(`bold 1em "${fontName}"`);
      document.fonts.load(`italic 1em "${fontName}"`);
      document.fonts.load(`italic bold 1em "${fontName}"`);
    });
    this.subNavZoom = this.pres.ratio$.subscribe((ratio) => {
      this.recreateCanvas();
    });

    this.currentReportName = this.reportName;
    if (this.currentReportName) {
      const loading = await this.pres.mostrarLoading();
      try {
        this.errorMessage = await this.readReport();
      } finally {
        loading.ocultar();
      }
    }
    document.addEventListener("mousedown", this.onDocMouseDown);
    document.addEventListener("keydown", this.handleArrowKeys);
    if (this.report != null) {
      this.initReport();
    }
    // The report arrived after an await: without this the panels that depend on it (the structure
    // tree, the properties) would not appear until the next user event.
    this.cdr.markForCheck();
  }

  // ---- layout: right dock, resizable columns, status bar ----

  /** The editor's chrome texts: the host's `labels` over the library's translations. */
  protected get L(): DesignerLabels {
    const version = this.translator.changes();
    if (!this.labelsCache || this.labelsCache.version !== version || this.labelsCache.host !== this.labels) {
      const translated = {} as DesignerLabels;
      for (const [label, key] of Object.entries(LABEL_KEYS)) (translated as any)[label] = this.translator.t(key);
      this.labelsCache = { version, host: this.labels, value: { ...translated, ...this.labels } };
    }
    return this.labelsCache.value;
  }
  private labelsCache?: { version: number; host: Partial<DesignerLabels> | undefined; value: DesignerLabels };

  /** What the status bar says about the selection: its name and what it is. */
  protected get statusSelection(): { name: string; kind: string } | null {
    const selected = this.canvasService.getSelectedReportItems(this);
    if (selected && selected.length > 1) return { name: String(selected.length), kind: this.L.selectedObjects };
    const item = (selected?.[0]?.item ?? this.canvasService.selectedItem) as { name?: string; alias?: string; className?: string } | undefined;
    if (!item) return null;
    const kind = (item.className ?? "").replace(/^TRP/i, "");
    // Datasets, connections and parameters are known by their alias, not by their internal name.
    const name = item.alias || item.name || "";
    return name || kind ? { name: name || kind, kind: name ? kind : "" } : null;
  }

  protected get zoomLabel(): string {
    return Math.round((this.reportDesign.zoom || 1) * 100) + "%";
  }

  /**
   * Opens the right dock with the copilot unless the user closed it or left it on the history: the
   * desktop designer does the same with its chat panel.
   */
  private restoreLayout(): void {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LAYOUT_KEYS.rightPanel);
    } catch {
      /* private mode */
    }
    if (stored === "none") this.rightPanel = "";
    else if (stored === "history") this.rightPanel = "history";
    else this.rightPanel = this.copilot ? "copilot" : "";
    if (this.rightPanel === "copilot" && !this.copilot) this.rightPanel = "";
  }

  protected setRight(panel: DesignerRightPanel): void {
    this.rightPanel = panel;
    try {
      localStorage.setItem(LAYOUT_KEYS.rightPanel, panel || "none");
    } catch {
      /* private mode */
    }
  }

  /**
   * The host shows the copilot's tab, for this opening only (the layout the person keeps is not
   * changed): a sample report opens with a request in its prompt box.
   */
  showCopilot(): void {
    if (!this.copilot || this.rightPanel === "copilot") return;
    this.rightPanel = "copilot";
    this.cdr.markForCheck();
  }

  /** A bar button: opens its tab, or closes the dock when that tab is the one showing. */
  protected toggleRight(panel: DesignerRightPanel): void {
    this.setRight(this.rightPanel === panel ? "" : panel);
  }

  /**
   * Drags one of the three dividers. The element is resized directly while dragging (no change
   * detection per pixel) and the final size is stored when the pointer is released.
   */
  protected startResize(kind: "left" | "right" | "tree", down: PointerEvent): void {
    down.preventDefault();
    const gutter = down.currentTarget as HTMLElement;
    try {
      gutter.setPointerCapture(down.pointerId);
    } catch {
      /* a synthetic pointer has nothing to capture */
    }
    gutter.classList.add("is-dragging");
    const startX = down.clientX;
    const startY = down.clientY;
    const left = this.leftCol.nativeElement;
    const right = this.rightCol.nativeElement;
    const tree = left.querySelector<HTMLElement>("report-structure-tree");
    const start = kind === "left" ? left.offsetWidth : kind === "right" ? right.offsetWidth : tree?.offsetHeight ?? 0;
    const total = left.parentElement?.clientWidth ?? window.innerWidth;
    let value = start;
    const move = (ev: PointerEvent) => {
      if (kind === "left") {
        value = clamp(start + (ev.clientX - startX), 180, Math.min(560, total - 240));
        left.style.width = value + "px";
      } else if (kind === "right") {
        value = clamp(start - (ev.clientX - startX), 260, Math.min(760, total - 240));
        right.style.width = value + "px";
      } else if (tree) {
        value = clamp(start + (ev.clientY - startY), 80, left.clientHeight - 120);
        tree.style.flex = "0 0 " + value + "px";
      }
    };
    const up = () => {
      gutter.removeEventListener("pointermove", move);
      gutter.removeEventListener("pointerup", up);
      gutter.removeEventListener("pointercancel", up);
      gutter.classList.remove("is-dragging");
      if (kind === "left") this.leftWidth = value;
      else if (kind === "right") this.rightWidth = value;
      else this.treeHeight = value;
      const key = kind === "left" ? LAYOUT_KEYS.leftWidth : kind === "right" ? LAYOUT_KEYS.rightWidth : LAYOUT_KEYS.treeHeight;
      try {
        localStorage.setItem(key, String(Math.round(value)));
      } catch {
        /* private mode */
      }
    };
    gutter.addEventListener("pointermove", move);
    gutter.addEventListener("pointerup", up);
    gutter.addEventListener("pointercancel", up);
  }
  private destroyCanvas() {
    if (this.canvas) {
      // Remove the Fabric listeners
      this.canvas.off();

      // Release resources and references
      this.canvas.dispose();

      // Remove the element from the DOM if it is still there
      if (this.canvasElement && this.canvasElement.parentNode) {
        this.canvasElement.parentNode.removeChild(this.canvasElement);
      }

      // Clear local references
      this.canvas = undefined!;
      this.canvasElement = undefined!;
    }
  }
  private recreateCanvas() {
    this.destroyCanvas();
    // Create the <canvas> element
    const logicalWidth = this.MAXIMUMWIDTH;
    const logicalHeight = 2400;
    this.canvasElement = document.createElement("canvas");
    this.canvasElement.id = "myCanvas";
    this.canvasElement.width = logicalWidth;
    this.canvasElement.height = logicalHeight;

    this.canvasElement.style.width = `${logicalWidth}px`;
    this.canvasElement.style.height = `${logicalHeight}px`;
    this.canvasContainer.nativeElement.appendChild(this.canvasElement);

    // The element itself, not its id: Fabric looks an id up in document, which does not see into a
    // shadow root (<reportman-designer>), and would draw on a canvas of its own nobody sees.
    this.canvas = new Canvas(this.canvasElement, {
      imageSmoothingEnabled: false,
      enableRetinaScaling: true,
      renderOnAddRemove: true,
      // Free (non-proportional) scaling by default from the corners:
      // width and height need to be adjusted independently. Fabric uses by default
      // uniformScaling=true (proportional, "locked" except with Shift); we invert it so that
      // the default behavior is the one that used to require holding Shift..
      uniformScaling: false,
    });
    console.log("window.devicePixelRatio =", window.devicePixelRatio);
    const backingRatio =
      this.canvasElement.width / this.canvasElement.getBoundingClientRect().width;
    console.log("BackingRatio: " + backingRatio.toFixed(4));

    this.reportDesign.canvas = this.canvas;

    this.canvasService.canvas = this.canvas;

    this.canvasService.rectangleDrawn.subscribe((area) => {
      this.createComponent(area);
    });

    // Move detection
    this.canvas.on("object:moving", (e) => {
      this.objectMoving(e);
    });

    // Scale detection
    this.canvas.on("object:scaling", (e) => {
      this.objectScaling(e);
    });
    // End of move/resize
    this.canvas.on("object:modified", (e) => {
      this.objectModified(e);
    });
    this.canvas.on("mouse:down", this.onCanvasMouseDown);
    this.canvasService.setCanvas(this.canvas);

    const subrepRefresh = this.reportDesign.subreportEditor?.subReport;
    if (subrepRefresh) {
      this.selectSubReport(subrepRefresh);
    }
  }

  private onCanvasMouseDown = (e: any) => {
    this.isFabricActive = true;
    // Detect whether a section has been selected
    // the target will be undefined
    if (e.target == undefined && this.reportDesign.subreportEditor) {
      // Look for the section
      if (e.scenePoint.x && e.scenePoint.y) {
        const x = e.scenePoint.x as number;
        const y = e.scenePoint.y as number;
        for (const secEditor of this.reportDesign.subreportEditor.sectionEditors) {
          if (secEditor.posX <= x && secEditor.posX + secEditor.width >= x) {
            if (secEditor.posYSection <= y && secEditor.posYEnd >= y) {
              // Select the section visually
              if (secEditor.section) {
                this.canvasService.selectItem(secEditor.section);
              }
            }
          }
        }
      }
    }
  };

  private onDocMouseDown = (e: MouseEvent) => {
    // The node clicked, also inside a shadow root (there e.target is the host by the time the event reaches document).
    const target = (e.composedPath()[0] ?? e.target) as Node;
    if (!this.canvas.wrapperEl.contains(target) && !this.canvasElement!.contains(target)) {
      this.isFabricActive = false;
    }
  };
  public zoomPlus() {
    for (let idx = 0; idx < this.zoomOptions.length - 1; idx++) {
      const zoomOption = this.zoomOptions[idx];
      if (zoomOption.value == this.reportDesign.zoom) {
        const newZoom = this.zoomOptions[idx + 1].value;
        this.reportDesign.zoom = newZoom;
        this.onZoomChange(newZoom);
        break;
      }
    }
  }
  public zoomMinus() {
    for (let idx = 1; idx < this.zoomOptions.length; idx++) {
      const zoomOption = this.zoomOptions[idx];
      if (zoomOption.value == this.reportDesign.zoom) {
        const newZoom = this.zoomOptions[idx - 1].value;
        this.reportDesign.zoom = newZoom;
        this.onZoomChange(newZoom);
        break;
      }
    }
  }
  private handleArrowKeys = (e: KeyboardEvent) => {
    if (!this.report) {
      return;
    }
    // if a form control or modal dialog has focus, do not intercept Ctrl+V for report paste
    if (e.ctrlKey && e.key.toLowerCase() === "v") {
      // The focus as seen from this component: inside a shadow root, document only sees the host.
      const root = this.containerRef.element.nativeElement.getRootNode() as Document | ShadowRoot;
      const activeEl = root.activeElement as HTMLElement | null;
      if (activeEl) {
        const tag = activeEl.tagName.toLowerCase();
        const inModal = this.nav.hasModalesAbiertos();
        if (
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          activeEl.isContentEditable ||
          inModal
        ) {
          return;
        }
      }
      this.pasteClicked();
      e.preventDefault();
      return;
    }
    if (!this.isFabricActive) {
      return;
    }
    // Undo
    if (e.ctrlKey && e.key.toLowerCase() === "z") {
      this.undoClick();
      e.preventDefault();
      return;
    }
    // redo
    if (e.ctrlKey && e.key.toLowerCase() === "y") {
      this.redoClick();
      e.preventDefault();
      return;
    }
    /*    // zoom plus
    if (e.ctrlKey && e.key.toLowerCase() === "+") {
      this.zoomPlus();
      e.preventDefault();
      return;
    }
    // zoom minus
    if (e.ctrlKey && e.key.toLowerCase() === "-") {
      this.zoomMinus();
      e.preventDefault();
      return;
    }*/

    // Ctrl+V must paste even if no component objects are selected (for example, a section is selected)
    if (e.ctrlKey && e.key.toLowerCase() === "v") {
      this.pasteClicked();
      e.preventDefault();
      return;
    }

    // Selected objects (twips)
    const selectedObjects = this.canvas.getActiveObjects();
    if (!selectedObjects || selectedObjects.length == 0) {
      return;
    }
    const items = this.getSelectedReportItems(selectedObjects);
    let isSection = false;
    let isComponent = false;
    for (const item of items) {
      if (item.SectionEditor) {
        isSection = true;
      } else {
        if (item.ComponentEditor) {
          isComponent = true;
        }
      }
    }
    if (!isSection && !isComponent) {
      return;
    }
    if (isComponent) {
      switch (e.key) {
        case "Delete":
          this.deleteClicked();
          e.preventDefault();
          return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "c") {
        this.copyClicked();
        e.preventDefault();
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "x") {
        this.cutClicked();
        e.preventDefault();
        return;
      }
    }
    // Paste from clipboard (section context is determined in sectionSelected())
    if (e.ctrlKey && e.key.toLowerCase() === "v") {
      this.pasteClicked();
      e.preventDefault();
      return;
    }
    if (!isComponent) {
      return;
    }
    let stepXtwips = this.report.gridEnabled ? this.report.gridWidth! : 1440 / 10;
    let stepYtwips = this.report.gridEnabled ? this.report.gridHeight! : 1440 / 10;
    let stepX = DesignUtils.twipsTopx(stepXtwips) * this.reportDesign.zoom;
    let stepY = DesignUtils.twipsTopx(stepYtwips) * this.reportDesign.zoom;
    if (e.shiftKey) {
      stepXtwips = 1440 / 2.54 / 10 / 2;
      stepYtwips = stepXtwips;
      stepX = DesignUtils.twipsTopx(stepXtwips) * this.reportDesign.zoom;
      stepY = stepX;
    }

    for (const item of items) {
      const printPosItem = item.item as PrintPosItem;
      switch (e.key) {
        case "ArrowLeft":
          printPosItem.posX -= stepXtwips;
          break;
        case "ArrowRight":
          printPosItem.posX += stepXtwips;
          break;
        case "ArrowUp":
          printPosItem.posY -= stepYtwips;
          break;
        case "ArrowDown":
          printPosItem.posY += stepYtwips;
          break;
      }
    }

    const activeObject = this.canvas.getActiveObject();
    if (!activeObject) {
      return;
    }

    let moved = false;

    switch (e.key) {
      case "ArrowLeft":
        if (typeof activeObject.left === "number") {
          activeObject.left -= stepX;
        }
        moved = true;
        break;
      case "ArrowRight":
        if (typeof activeObject.left === "number") {
          activeObject.left += stepX;
        }
        moved = true;
        break;
      case "ArrowUp":
        if (typeof activeObject.top === "number") {
          activeObject.top -= stepY;
        }
        moved = true;
        break;
      case "ArrowDown":
        if (typeof activeObject.top === "number") {
          activeObject.top += stepY;
        }
        moved = true;
        break;
    }

    if (moved) {
      activeObject.setCoords();
      // The local clip is relative to the group: after moving with the arrow keys it has to be recalculated
      // (when dragging with the mouse objectMoving does it) or the clipping window travels
      // with the component and stops matching the bounds of the section.
      const movedObjects =
        activeObject.type == "activeselection"
          ? (activeObject as ActiveSelection).getObjects()
          : [activeObject];
      for (const movedObject of movedObjects) {
        const movedEditor = (movedObject as any).componentEditorDesign as
          | ComponentEditorDesign
          | undefined;
        movedEditor?.updateClipPathGroup();
      }
      this.canvas.requestRenderAll();
      e.preventDefault();
    }
  };
  private objectScaling(e: BasicTransformEvent<TPointerEvent> & { target: FabricObject }) {
    const obj = e.target;
    if (!(obj as any).componentEditorDesign) {
      return;
    }
    // Apply the new sizes directly and reset the scaling
    const newWidth = e.target.width! * e.target.scaleX!;
    const newHeight = e.target.height! * e.target.scaleY!;

    const componentEditor = (obj as any).componentEditorDesign as ComponentEditorDesign;
    const sectionEditor = componentEditor.sectionEditor!;
    const group = componentEditor.group!;
    group.set({
      clipPath: undefined,
      width: newWidth,
      height: newHeight,
      scaleX: 1,
      scaleY: 1,
    });
    const relPosX = -newWidth / 2;
    const relPosY = -newHeight / 2;
    //const relPosX = 0;
    //const relPosY = 0;
    componentEditor.rect!.set({
      left: relPosX,
      top: relPosY,
      width: newWidth,
      height: newHeight,
    });

    const recTitle = componentEditor.rectTitle;
    if (recTitle) {
      recTitle.set({
        left: relPosX,
        top: relPosY,
        width: newWidth,
        height: newHeight,
      });
      /*const clipPath = recTitle.clipPath!;
      clipPath.set({
        left: relPosX,
        top: relPosY,
        width: newWidth,
        height: newHeight,
      });*/
      recTitle.set({
        left: relPosX,
        top: relPosY,
        width: newWidth,
        height: newHeight,
        // clipPath: clipPath,
      });
    }

    const component = componentEditor.component!;
    const leftPos = e.target.left - sectionEditor.posX;
    const topPos = e.target.top - sectionEditor.posYSection;
    if ((obj as any).__startPosX == null) {
      (obj as any).__startPosX = component.posX;
      (obj as any).__startPosY = component.posY;
      (obj as any).__startWidth = component.width;
      (obj as any).__startHeight = component.height;
      (obj as any).__parentName = sectionEditor.section?.name;
    }
    const newPosXTwips = DesignUtils.pxTotwips(leftPos / this.reportDesign.zoom);
    const newPosYTwips = DesignUtils.pxTotwips(topPos / this.reportDesign.zoom);
    const newWidthTwips = DesignUtils.pxTotwips(newWidth / this.reportDesign.zoom);
    const newHeightTwips = DesignUtils.pxTotwips(newHeight / this.reportDesign.zoom);
    const newPosXTwipsGrid = this.reportDesign.alignToGridTwips(newPosXTwips, CoordType.X);
    const newPosYTwipsGrid = this.reportDesign.alignToGridTwips(newPosYTwips, CoordType.Y);
    const newWidthTwipsGrid = this.reportDesign.alignToGridTwips(newWidthTwips, CoordType.X);
    const newHeightTwipsGrid = this.reportDesign.alignToGridTwips(newHeightTwips, CoordType.Y);
    // Opposite edges at the START of the drag (stable). We do NOT use e.target.left/top as an anchor: when
    // scale/width are reset during object:scaling, Fabric stops keeping the opposite edge fixed on
    // the left/top handles (on right/bottom it does not reposition, which is why they work). The
    // SIZE (newWidth/newHeight) is reliable, so we derive the position of the moving edge
    // from the fixed starting edge. This way the right/bottom anchor stays exact (with and without grid).
    const startRightTwips = (obj as any).__startPosX + (obj as any).__startWidth;
    const startBottomTwips = (obj as any).__startPosY + (obj as any).__startHeight;
    const changePosX =
      e.transform.corner == "tl" || e.transform.corner == "ml" || e.transform.corner == "bl";
    const changePosY =
      e.transform.corner == "tl" || e.transform.corner == "mt" || e.transform.corner == "tr";

    // --- X axis ---
    let finalPosXTwips: number;
    let finalWidthTwips: number;
    if (changePosX) {
      // Moves the LEFT edge → the (starting) RIGHT edge stays anchored.
      const rawLeftTwips = startRightTwips - newWidthTwips;
      finalPosXTwips = this.reportDesign.alignToGridTwips(rawLeftTwips, CoordType.X);
      finalWidthTwips = startRightTwips - finalPosXTwips; // leaves the right edge untouched
      group.set({
        left: sectionEditor.posX + DesignUtils.twipsTopx(finalPosXTwips) * this.reportDesign.zoom,
        width: DesignUtils.twipsTopx(finalWidthTwips) * this.reportDesign.zoom,
      });
    } else {
      // Fixed left edge: only the size is snapped to the grid.
      finalPosXTwips = newPosXTwipsGrid;
      finalWidthTwips = newWidthTwipsGrid;
    }

    // --- Y axis ---
    let finalPosYTwips: number;
    let finalHeightTwips: number;
    if (changePosY) {
      // Moves the TOP edge → the (starting) BOTTOM edge stays anchored.
      const rawTopTwips = startBottomTwips - newHeightTwips;
      finalPosYTwips = this.reportDesign.alignToGridTwips(rawTopTwips, CoordType.Y);
      finalHeightTwips = startBottomTwips - finalPosYTwips; // leaves the bottom edge untouched
      group.set({
        top:
          sectionEditor.posYSection +
          DesignUtils.twipsTopx(finalPosYTwips) * this.reportDesign.zoom,
        height: DesignUtils.twipsTopx(finalHeightTwips) * this.reportDesign.zoom,
      });
    } else {
      // Fixed top edge: only the size is snapped to the grid.
      finalPosYTwips = newPosYTwipsGrid;
      finalHeightTwips = newHeightTwipsGrid;
    }

    component.posX = finalPosXTwips;
    component.posY = finalPosYTwips;
    component.width = finalWidthTwips;
    component.height = finalHeightTwips;

    /*    if (newPosYTwips != newPosYTwipsGrid || newPosXTwips != newPosXTwips) {
      const scaledPosX = DesignUtils.twipsTopx(component.posX) * this.zoom;
      const scaledPosY = DesignUtils.twipsTopx(component.posY) * this.zoom;
      const leftPos = sectionEditor.posX + scaledPosX;
      const topPos = sectionEditor.posYSection + scaledPosY;
      group.set({ left: leftPos, top: topPos });
    }
    if (
      newWidthTwips != newWidthTwipsGrid ||
      newHeightTwips != newHeightTwipsGrid
    ) {
      const scaledWidth = DesignUtils.twipsTopx(component.width) * this.zoom;
      const scaledHeight = DesignUtils.twipsTopx(component.height) * this.zoom;
      group.set({ width: scaledWidth, height: scaledHeight });
    }
*/
    componentEditor.update("", false);
    // Invalidate the group cache. With objectCaching (the default for the group) the cache canvas is
    // created at the initial size; when ENLARGING without marking dirty, Fabric redraws the old cache and the
    // content that sticks out is clipped (when shrinking it is not noticeable, the cache is larger). Shapes
    // already worked because update() marks dirty in TRPSHAPE; images and text did not.
    group.dirty = true;
    this.canvas.requestRenderAll();
    // this.canvas.renderAll();*/
  }
  public getSelectedReportItems(selectedObjects: FabricObject[]): SelectedReportItem[] {
    const items: SelectedReportItem[] = [];
    if (!selectedObjects) {
      return items;
    }
    for (const selected of selectedObjects) {
      if ((selected as any).componentEditorDesign) {
        const secDesign = (selected as any).componentEditorDesign as ComponentEditorDesign;
        const selItem = new SelectedReportItem(secDesign.component!, selected);
        selItem.ComponentEditor = secDesign;
        items.push(selItem);
      } else {
        if ((selected as any).sectionEditorDesign) {
          const secDesign = (selected as any).sectionEditorDesign as SectionEditorDesign;
          if (secDesign.section) {
            const selItem = new SelectedReportItem(secDesign.section!, selected);
            selItem.SectionEditor = secDesign;
            items.push(selItem);
          }
        }
      }
    }
    return items;
  }
  private objectMovingSection(e: BasicTransformEvent<TPointerEvent> & { target: FabricObject }) {
    this.isSectionResizing = true;
    const obj = e.target;
    const sectionEditor = (obj as any).sectionEditorDesign as SectionEditorDesign;
    if ((obj as any).isTopBar) {
      const sectionToEdit = sectionEditor.previousSection;
      const sectionEditorDesignToEdit = sectionEditor.previousSectionEditor;
      if (sectionToEdit && sectionEditorDesignToEdit?.topRect) {
        const topRect: Group = sectionEditorDesignToEdit.topRect;
        let newHeight = obj.top - (topRect.top + topRect.height);
        if (newHeight < 0) {
          newHeight = 0;
          obj.top = topRect.top + topRect.height - 1;
        }
        if ((obj as any).__startHeight == null) {
          (obj as any).__startHeight = sectionToEdit.height;
        }
        sectionToEdit.height = Math.round(
          DesignUtils.pxTotwips(newHeight / this.reportDesign.zoom)
        );
        // sectionEditorDesignToEdit.rightRect!.setCoords();
        // this.setGridBackground(this.reportDesign.subreportEditor!.subReport!);
        this.recolocarSecciones(obj as Rect | Group);
        this.canvas.requestRenderAll();
      }
    } else {
      if ((obj as any).isRightBar) {
        const section = sectionEditor.section;
        if (section && sectionEditor.rightRect) {
          let newWidth = obj.left - sectionEditor.posX;
          if (newWidth < 0) {
            newWidth = 0;
            obj.left = sectionEditor.posX;
          }
          if ((obj as any).__startWidth == null) {
            (obj as any).__startWidth = section.width;
          }
          section.width = Math.round(DesignUtils.pxTotwips(newWidth / this.reportDesign.zoom));
        }
        this.recolocarSecciones(undefined);
        //this.setGridBackground(
        //  this.reportDesign.subreportEditor?.subReport!
        //);
        this.canvas.requestRenderAll();
      }
    }

    this.canvas.requestRenderAll();
  }
  private objectMoving(e: BasicTransformEvent<TPointerEvent> & { target: FabricObject }) {
    if ((e.target as any).sectionEditorDesign) {
      this.objectMovingSection(e);
      return;
    }
    const moved: FabricObject[] = [];
    const isGroup = e.target.type == "activeselection";
    if (isGroup) {
      const targetGroup = e.target as ActiveSelection;
      for (const object of targetGroup.getObjects()) {
        moved.push(object);
      }
    } else {
      moved.push(e.target);
    }
    // Check whether all the elements belong to the same section
    let sectionEditorCommon: SectionEditorDesign | undefined;
    let referenceComponent: FabricObject | undefined = undefined;
    for (const obj of moved) {
      if ((obj as any).componentEditorDesign) {
        const compDesign = (obj as any).componentEditorDesign as ComponentEditorDesign;
        if (!sectionEditorCommon) {
          sectionEditorCommon = compDesign.sectionEditor;
        } else {
          if (sectionEditorCommon != compDesign.sectionEditor) {
            sectionEditorCommon = undefined;
            break;
          }
        }
        if ((obj as any).__startPosX == null) {
          (obj as any).__startPosX = compDesign.component.posX;
          (obj as any).__startPosY = compDesign.component.posY;
          (obj as any).__parentName = compDesign.sectionEditor.section?.name;
        }
      }
      if (!referenceComponent) {
        referenceComponent = obj;
      } else {
        const componentEditorRef = (referenceComponent as any)
          .componentEditorDesign as ComponentEditorDesign;
        const componentEditor = (obj as any).componentEditorDesign as ComponentEditorDesign;
        if (componentEditor.posY < componentEditorRef.posY) {
          referenceComponent = obj;
        } else {
          if (componentEditor.posY == componentEditorRef.posY) {
            if (componentEditor.posX < componentEditorRef.posX) {
              referenceComponent = obj;
            }
          }
        }
      }
    }
    if (
      this.report?.gridEnabled &&
      moved.length > 1 &&
      (referenceComponent as any)?.componentEditorDesign
    ) {
      // Grid snap of the MULTIPLE SELECTION: we align the top-left corner of the reference
      // component (the top-left-most one) to the grid and move the WHOLE selection by that
      // delta
      const targetGroup = e.target as ActiveSelection;
      const componentEditor = (referenceComponent as any)
        .componentEditorDesign as ComponentEditorDesign;
      const sectionEditor = componentEditor.sectionEditor;
      referenceComponent!.setCoords();
      const refRect = referenceComponent!.getBoundingRect();
      const refPosXTwips = DesignUtils.pxTotwips(
        (refRect.left - sectionEditor.posX) / this.reportDesign.zoom
      );
      const refPosYTwips = DesignUtils.pxTotwips(
        (refRect.top - sectionEditor.posYSection) / this.reportDesign.zoom
      );
      const refPosXTwipsGrid = this.reportDesign.alignToGridTwips(refPosXTwips, CoordType.X);
      const refPosYTwipsGrid = this.reportDesign.alignToGridTwips(refPosYTwips, CoordType.Y);
      const targetLeftPx =
        DesignUtils.twipsTopx(refPosXTwipsGrid * this.reportDesign.zoom) + sectionEditor.posX;
      const targetTopPx =
        DesignUtils.twipsTopx(refPosYTwipsGrid * this.reportDesign.zoom) +
        sectionEditor.posYSection;
      // Delta between the current corner and the grid-aligned corner, applied to the whole selection.
      targetGroup.set({
        left: targetGroup.left + (targetLeftPx - refRect.left),
        top: targetGroup.top + (targetTopPx - refRect.top),
      });
      targetGroup.setCoords();
    }
    for (const obj of moved) {
      // Movement of elements
      if ((obj as any).componentEditorDesign) {
        const group = obj as Group;
        group.setCoords();
        const rect = group.getBoundingRect();
        const groupTop = moved.length > 1 ? rect.top : group.top;
        const groupLeft = moved.length > 1 ? rect.left : group.left;
        const componentEditor = (obj as any).componentEditorDesign as ComponentEditorDesign;
        const initialSectionEditor = componentEditor.sectionEditor!;
        const initialSection = componentEditor.sectionEditor.section!;
        const componentToEdit = componentEditor.component;
        const sectionEditors =
          componentEditor.sectionEditor.reportEditor.subreportEditor?.sectionEditors;
        let section = initialSection;
        let actualSectionEditor: SectionEditorDesign | undefined;

        // It can move from one section to another; we determine which section it is in now
        if (sectionEditors) {
          for (const sectionEditor of sectionEditors) {
            if (groupTop >= sectionEditor.posYSection && sectionEditor.section) {
              if (groupTop <= sectionEditor.posYEnd) {
                if (initialSectionEditor != sectionEditor) {
                  const indexEditor = initialSectionEditor.components.indexOf(componentEditor);
                  initialSectionEditor.components.splice(indexEditor, 1);
                  const indexCompo = initialSection.components.indexOf(componentToEdit);
                  initialSection.components.splice(indexCompo, 1);

                  sectionEditor.components.push(componentEditor);
                  section = sectionEditor.section!;
                  section.components.push(componentToEdit);
                  componentEditor.sectionEditor = sectionEditor;
                  actualSectionEditor = sectionEditor;
                } else {
                  actualSectionEditor = sectionEditor;
                }
                break;
              }
            }
          }
          actualSectionEditor = componentEditor.sectionEditor;
          // Calculation of the new position
          if (actualSectionEditor) {
            let newPosX = groupLeft - actualSectionEditor.posX;
            if (newPosX < 0) {
              newPosX = 0;
            }
            let newComponentEditorPosX = groupLeft;
            if (newComponentEditorPosX < actualSectionEditor.posX) {
              newComponentEditorPosX = actualSectionEditor.posX;
            }
            const newPosY = groupTop - actualSectionEditor.posYSection;
            const newComponentEditorPosY = groupTop;
            componentEditor.posX = newComponentEditorPosX;
            componentEditor.posY = newComponentEditorPosY;

            const newPosXTwips = DesignUtils.pxTotwips(newPosX / this.reportDesign.zoom);
            const newPosYTwips = DesignUtils.pxTotwips(newPosY / this.reportDesign.zoom);
            const newPosXTwipsGrid = this.reportDesign.alignToGridTwips(newPosXTwips, CoordType.X);
            const newPosYTwipsGrid = this.reportDesign.alignToGridTwips(newPosYTwips, CoordType.Y);
            if (moved.length == 1) {
              componentToEdit.posX = newPosXTwipsGrid;
              componentToEdit.posY = newPosYTwipsGrid;
            } else {
              componentToEdit.posX = newPosXTwips;
              componentToEdit.posY = newPosYTwips;
            }
            if (
              (newPosYTwips != newPosYTwipsGrid || newPosXTwips != newPosXTwipsGrid) &&
              !isGroup
            ) {
              const scaledPosX = DesignUtils.twipsTopx(newPosXTwipsGrid) * this.reportDesign.zoom;
              const scaledPosY = DesignUtils.twipsTopx(newPosYTwipsGrid) * this.reportDesign.zoom;

              const leftPos = actualSectionEditor.posX + scaledPosX;
              const topPos = actualSectionEditor.posYSection + scaledPosY;
              group.set({ left: leftPos, top: topPos });
              newComponentEditorPosX = leftPos;
              componentEditor.clipPathComponent?.set({
                left: leftPos,
                top: topPos,
              });
            }
            if (!isGroup) {
              /*componentEditor.clipPath!.set({
                left: actualSectionEditor.posX,
                top: actualSectionEditor.posYSection,
                width: actualSectionEditor.width,
                height: actualSectionEditor.height,
              });*/
              // No clipPath is set so that the group can move freely
              // it will be set when the movement ends
              group.set({ left: newComponentEditorPosX });
              // The component moves relative to its section → recalculate its local clip (cacheable).
              componentEditor.updateClipPathGroup();
            } else {
              group.set({ clipPath: undefined });
            }
          }
        }
      }
    }
    this.canvas.requestRenderAll();
  }
  private objectModified(e: ModifiedEvent<TPointerEvent>) {
    const moved: FabricObject[] = [];
    if (e.target.type == "activeselection") {
      for (const object of (e.target as ActiveSelection).getObjects()) {
        moved.push(object);
      }
    } else {
      moved.push(e.target);
    }
    const isGroup = moved.length > 1;
    let requireSubreportUpdate = false;
    const groupId = this.report!.undoCue!.getGroupId();
    for (const obj of moved) {
      const startPosX = (obj as any).__startPosX;
      const startPosY = (obj as any).__startPosY;
      const startWidth = (obj as any).__startWidth;
      const startHeight = (obj as any).__startHeight;
      const oldParentName = (obj as any).__parentName;
      // when an object is moved the clipPath must be set again
      if ((obj as any).componentEditorDesign) {
        const group = obj as Group;
        const componentEditor = (obj as any).componentEditorDesign as ComponentEditorDesign;
        const item = componentEditor.component;
        // Also for a multiple selection: the local clip is relative to the group and becomes
        // stale after the drag (the center is computed through the absolute matrix, so it
        // is valid even if the ActiveSelection is still active).
        componentEditor.updateClipPathGroup();
        if (isGroup) {
          requireSubreportUpdate = componentEditor.sectionEditor.section?.name != oldParentName;
        }
        const op = new ChangeObjectOperation(OperationType.Modify, groupId);
        op.componentClass = item.className;
        op.componentName = item.name;
        op.parentName = componentEditor.sectionEditor.section?.name;
        op.oldParentName = oldParentName;
        if (op.parentName == op.oldParentName) {
          delete op.parentName;
          delete op.oldParentName;
        }
        if (item.posX != startPosX) {
          op.addProperty("posX", PropertyType.Integer, startPosX, item.posX);
        }
        if (item.posY != startPosY) {
          op.addProperty("posY", PropertyType.Integer, startPosY, item.posY);
        }
        if (startWidth != null) {
          if (item.width != startWidth) {
            op.addProperty("width", PropertyType.Integer, startWidth, item.width);
          }
          if (item.height != startHeight) {
            op.addProperty("height", PropertyType.Integer, startHeight, item.height);
          }
        }
        if (op.properties.length > 0 || op.parentName) {
          this.report?.undoCue?.addOperation(op, this.report);
          this.objectInspector?.loadObject();
        }
        this.canvas.requestRenderAll();
      }
      if (requireSubreportUpdate) {
        this.canvasService.clearSelection();
        this.recolocarSecciones(undefined);
      }
      if ((obj as any).sectionEditorDesign) {
        const sectionEditor = (obj as any).sectionEditorDesign as SectionEditorDesign;
        const op = new ChangeObjectOperation(OperationType.Modify, groupId);
        op.oldParentName = oldParentName;
        if (op.parentName == op.oldParentName) {
          delete op.parentName;
          delete op.oldParentName;
        }
        if ((obj as any).isTopBar) {
          const sectionToEdit = sectionEditor.previousSection;
          const sectionEditorDesignToEdit = sectionEditor.previousSectionEditor;
          if (sectionToEdit && sectionEditorDesignToEdit?.topRect) {
            op.componentClass = sectionToEdit.className;
            op.componentName = sectionToEdit.name;
            op.addProperty("height", PropertyType.Integer, startHeight, sectionToEdit.height);
            this.report?.undoCue?.addOperation(op, this.report);
            this.objectInspector?.loadObject();
          }
        } else {
          if ((obj as any).isRightBar) {
            const section = sectionEditor.section;
            if (section && sectionEditor.rightRect) {
              let refreshSections = false;
              const subreport = this.report!.getParentSubReport(section);
              // Sync other sections width
              for (const sec of subreport.sections) {
                if (sec.syncWidth && sec != section) {
                  refreshSections = true;
                  const newOp = new ChangeObjectOperation(OperationType.Modify, groupId);
                  newOp.componentClass = sec.className;
                  newOp.groupId = groupId;
                  newOp.componentName = sec.name;
                  const origWidth = sec.width;
                  sec.width = section.width;
                  newOp.addProperty("width", PropertyType.Integer, origWidth, sec.width);
                  this.report?.undoCue?.addOperation(newOp, this.report);
                }
              }
              // This used to be INSIDE the previous loop → it ran once for EACH synchronized
              // section (O(K × total)), hence the 8-10 s when releasing the horizontal resize. A single
              // time at the end is enough.
              if (refreshSections) {
                this.recolocarSecciones(undefined);
              }
              op.componentClass = section.className;
              op.componentName = section.name;
              op.addProperty("width", PropertyType.Integer, startWidth, section.width);
              this.report?.undoCue?.addOperation(op, this.report);
              this.objectInspector?.loadObject();
            }
          }
        }
      }

      delete (obj as any).__startPosX;
      delete (obj as any).__startPosY;
      delete (obj as any).__startWidth;
      delete (obj as any).__startHeight;
      delete (obj as any).__parentName;
    }
    // canvas.setDimensions() was deferred during the drag of the section bar; on release we
    // apply it just ONCE (it reassigns the canvas to the final height and re-renders everything).
    if (this.isSectionResizing) {
      this.isSectionResizing = false;
      this.calcSubReportDimensions();
      if (this.reportDesign.subreportEditor) {
        this.setGridBackground(this.reportDesign.subreportEditor.subReport!);
        // When a section is resized its bounds change → recalculate the (local) clip of its
        // components; it was deferred during the drag. It is cheap (one Rect per component, once).
        for (const se of this.reportDesign.subreportEditor.sectionEditors) {
          for (const ce of se.components) {
            ce.updateClipPathGroup();
          }
        }
      }
      this.canvas.requestRenderAll();
    }
  }
  private drawLeftRuler(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    const dpr = window.devicePixelRatio;
    const izoom = 1 / dpr;
    ctx.scale(dpr, dpr);
    const divideUnit =
      this.designPreferences.MeaureUnit === MeasureUnitType.Cm
        ? (96 * izoom) / 2.54
        : 96 * izoom * this.reportDesign.zoom;
    // White background in the ruler area
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, y, width * izoom, height * izoom);

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1 / dpr;
    ctx.font = `${Math.floor((width * 0.6 * 1) / dpr)}px Arial`;
    ctx.fillStyle = "#000000";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    const totalUnits = Math.floor((height / divideUnit) * 10);

    for (let i = 0; i <= totalUnits; i++) {
      const lineY = y + i * (divideUnit / 10);

      const isWhole = i % 10 === 0;
      const isHalf = i % 5 === 0;

      const lineLength = (isWhole ? width * 0.5 : isHalf ? width * 0.35 : width * 0.2) * izoom;

      // Line to the right of the ruler area
      ctx.beginPath();
      ctx.moveTo(x + width * izoom, lineY);
      ctx.lineTo(x + width * izoom - lineLength, lineY);
      ctx.stroke();

      // Text on the left inside the ruler
      if (isWhole && i > 0) {
        const label = (i / 10).toString();
        ctx.fillText(label, x + 2, lineY - 2 * dpr);
      }
    }
    // Right border line of the ruler
    ctx.beginPath();
    ctx.moveTo(x + width * izoom - 0.5 * izoom, y);
    ctx.lineTo(x + width * izoom - 0.5 * izoom, y + height * izoom);
    ctx.stroke();
  }

  public async setGridBackground(subReport: SubReport) {
    const gridSizeXTwips = this.report?.gridWidth ?? 5;
    const gridSizeYTwips = this.report?.gridHeight ?? 5;
    const gridLines = this.report?.gridLines ?? false;
    const gridVisible = this.report?.gridVisible ?? false;
    const gridColor = DesignUtils.numberToHexColor(this.report?.gridColor ?? 0);

    // Create an offscreen canvas
    const dpr = window.devicePixelRatio || 1;
    // Logical size (in CSS pixels)
    const logicalWidth = this.reportDesign.subreportEditor!.maxWidth || 10;
    const logicalHeight = this.reportDesign.subreportEditor!.maxHeight || 10;

    // Physical size (real screen pixels)
    const gridCanvas = document.createElement("canvas");
    gridCanvas.width = logicalWidth * dpr;
    gridCanvas.height = logicalHeight * dpr;

    // Keep the original CSS size
    gridCanvas.style.width = `${logicalWidth}px`;
    gridCanvas.style.height = `${logicalHeight}px`;
    const ctx = gridCanvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.scale(dpr, dpr);
    // const izoom = 1 / dpr;
    const izoom = 1;
    ctx.imageSmoothingEnabled = false;
    ctx.imageSmoothingQuality = "low";
    let posY = 0;

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1 * izoom;
    if (gridLines) {
      for (const section of subReport.sections) {
        const scaledHeight = DesignUtils.twipsTopx(
          (section.height ?? 0) * this.reportDesign.zoom * izoom
        );
        const scaledWidth = DesignUtils.twipsTopx(
          (section.width ?? 0) * this.reportDesign.zoom * izoom
        );

        posY = posY + this.titleBarHeight * izoom;
        if (scaledHeight > 0) {
          ctx.fillStyle = "white";
          ctx.fillRect(this.rulerSize * izoom, posY, scaledWidth, scaledHeight);
        }
        if (gridVisible) {
          for (let y = 0; y <= (section.height ?? 0); y += gridSizeYTwips) {
            const yScaled = posY + DesignUtils.twipsTopx(y * this.reportDesign.zoom * izoom);
            ctx.beginPath();
            ctx.moveTo(this.rulerSize, yScaled);
            ctx.lineTo(scaledWidth + this.rulerSize * izoom, yScaled);
            ctx.stroke();
          }
        }
        if (gridVisible) {
          for (let x = 0; x <= (section.width ?? 0); x += gridSizeXTwips) {
            const xScaled = DesignUtils.twipsTopx(x * this.reportDesign.zoom * izoom);
            ctx.beginPath();
            ctx.moveTo(xScaled + this.rulerSize, posY);
            ctx.lineTo(xScaled + this.rulerSize * izoom, posY + scaledHeight);
            ctx.stroke();
          }
        }
        posY = posY + scaledHeight;
      }
    } else {
      for (const section of subReport.sections) {
        const scaledHeight = DesignUtils.twipsTopx(
          (section.height ?? 0) * this.reportDesign.zoom * izoom
        );
        const scaledWidth = DesignUtils.twipsTopx(
          (section.width ?? 0) * this.reportDesign.zoom * izoom
        );

        posY = posY + this.titleBarHeight * izoom;
        if (scaledHeight > 0) {
          ctx.fillStyle = "white";
          ctx.fillRect(this.rulerSize * izoom, posY, scaledWidth, scaledHeight);
        }
        ctx.fillStyle = gridColor;
        if (gridVisible) {
          const pixelSize = 1 * izoom;
          for (let y = 0; y <= (section.height ?? 0); y += gridSizeYTwips) {
            const yScaled = Math.round(
              posY + DesignUtils.twipsTopx(y * this.reportDesign.zoom * izoom)
            );
            for (let x = 0; x <= (section.width ?? 0); x += gridSizeXTwips) {
              const xScaled = Math.round(
                DesignUtils.twipsTopx(x * this.reportDesign.zoom * izoom) + this.rulerSize * izoom
              );
              ctx.fillRect(xScaled, yScaled, pixelSize, pixelSize);
              // ctx.fillRect(xScaled, yScaled, 1, 1);
            }
          }
        }
        posY = posY + scaledHeight;
      }
    }
    posY = 0;

    const fabricImage = new FabricImage(gridCanvas, {
      selectable: false,
      evented: false,
      originX: "left",
      originY: "top",
      scaleX: 1 / dpr,
      objectCaching: false,
      scaleY: 1 / dpr,
    });
    this.canvas.backgroundImage = fabricImage;
  }
  public recolocarSecciones(elementoMovido: Rect | Group | undefined) {
    if (!this.reportDesign.subreportEditor) {
      return;
    }
    this.calcSubReportDimensions();
    // The background bitmap (a full-size canvas) is deferred during the section drag, like
    // setDimensions; it is regenerated once on release (in objectModified). In all other cases
    // (load, grid option change) it is drawn normally.
    if (!this.isSectionResizing) {
      this.setGridBackground(this.reportDesign.subreportEditor!.subReport!);
    }
    let posY = 0;
    for (const sectionEditor of this.reportDesign.subreportEditor.sectionEditors) {
      // Previous posYSection: if it does not change, the components of this section have not moved and there is NO
      // need to reposition them (typical case of a WIDTH resize, and of the sections above the one
      // resized in HEIGHT). It avoids the O(all components) reflow per frame.
      const oldPosYSection = sectionEditor.posYSection;
      // Add the title rectangle of the section
      const group = sectionEditor.topRect!;
      if (elementoMovido != group) {
        group.set({ top: posY });
        group.setCoords();
      }
      sectionEditor.posYTitle = posY;
      posY = posY + this.titleBarHeight;
      sectionEditor.posYSection = posY;
      if (elementoMovido != sectionEditor.rightRect && sectionEditor.rightRect) {
        const section = sectionEditor.section!;

        const scaledHeight = DesignUtils.twipsTopx(section.height ?? 0) * this.reportDesign.zoom;
        const scaledWidth = DesignUtils.twipsTopx(section.width ?? 0) * this.reportDesign.zoom;

        sectionEditor.rightRect?.set({
          height: scaledHeight,
          left: scaledWidth + sectionEditor.posX,
          top: posY,
        });
        /*sectionEditor.rightRect!.height = scaledHeight;
        sectionEditor.rightRect!.left = scaledWidth;
        sectionEditor.rightRect!.top = posY;*/

        sectionEditor.rightRect!.setCoords();
        posY = posY + scaledHeight;
        sectionEditor.posYEnd = posY;
        sectionEditor.height = sectionEditor.posYEnd - sectionEditor.posYSection;
        sectionEditor.width = scaledWidth;
      }
      // Ruler
      if (sectionEditor.section) {
        let crearRuler = false;
        if (sectionEditor.leftRuler) {
          if (sectionEditor.height != sectionEditor.leftRuler.height) {
            if (sectionEditor.height > 0) {
              crearRuler = true;
            }
            this.canvas.remove(sectionEditor.leftRuler);
            this.canvas.requestRenderAll();
            sectionEditor.leftRuler = undefined;
          }
        } else {
          if (sectionEditor.height > 0) {
            crearRuler = true;
          }
        }
        const rulerXPos = -this.topRulerMargin.margin + this.rulerSize;
        if (crearRuler) {
          const rulerImg = this.createLeftRulerImage(
            this.rulerSize,
            sectionEditor.height,
            rulerXPos,
            sectionEditor.posYSection
          );
          sectionEditor.leftRuler = rulerImg;
          this.canvas.add(rulerImg);
          this.canvas.requestRenderAll();
        } else {
          if (sectionEditor.leftRuler) {
            sectionEditor.leftRuler.set({
              left: rulerXPos,
              top: sectionEditor.posYSection,
            });
          }
        }
      }

      // Only reposition components if the section has moved vertically.
      if (sectionEditor.posYSection !== oldPosYSection) {
        this.recolocarComponentesSeccion(sectionEditor);
      }
    }
  }
  public recolocarComponentesSeccion(sectionEditor: SectionEditorDesign) {
    for (const cEditor of sectionEditor.components) {
      // EXPERIMENT (easy rollback): instead of cEditor.update("", false) —which RECREATES every image
      // (new Image() + decode) and rebuilds clip/content on every frame, O(all components)
      // per frame— we only REPOSITION the group when the section moves (cheap). It isolates whether the
      // heavy component reflow is the cause of the extreme slowness when resizing sections.
      const group = cEditor.group;
      const component = cEditor.component;
      if (!group || !component) {
        continue;
      }
      group.set({
        left:
          sectionEditor.posX + DesignUtils.twipsTopx(component.posX ?? 0) * this.reportDesign.zoom,
        top:
          sectionEditor.posYSection +
          DesignUtils.twipsTopx(component.posY ?? 0) * this.reportDesign.zoom,
      });
      group.setCoords();
      // cEditor.update("", false); // original (heavy): it recreated images and clip on every frame
    }
  }
  private crearComponente(sectionEditor: SectionEditorDesign, component: PrintPosItem): Group {
    const cEditor = new ComponentEditorDesign(component as PrintPosItem, sectionEditor);
    sectionEditor.components.push(cEditor);
    // Add the component rectangle
    const scaledHeight = DesignUtils.twipsTopx(component.height ?? 0) * this.reportDesign.zoom;
    const scaledWidth = DesignUtils.twipsTopx(component.width ?? 0) * this.reportDesign.zoom;

    const rectTitle = new Rect({
      left: 0,
      top: 0,
      width: scaledWidth,
      height: scaledHeight,
      fill: "transparent",
      stroke: "black",
      originX: "left",
      originY: "top",
    });
    cEditor.rect = rectTitle;
    const groupObject: FabricObject[] = [rectTitle];
    switch (component.className) {
      case "TRPCHART":
      case "TRPEXPRESSION":
      case "TRPLABEL":
      case "TRPBARCODE":
        {
          const textData = DesignUtils.getTextDataFromComponent(component, this.report!);
          let fontSize = DesignUtils.FontSizeToFabricFontSize(10) * this.reportDesign.zoom;
          if (textData.fontSize) {
            fontSize = textData.fontSize * this.reportDesign.zoom;
          }
          const textTitle = new Textbox(textData.text ?? "", {
            left: 0,
            top: 0,
            splitByGrapheme: true,
            width: scaledWidth,
            //originY: 'center',
            //originX: 'center',
            // left: scaledWidth / 2,
            // top: scaledHeight / 2,
            selectable: false,
            evented: false,
            textAlign: textData.align,
            fontSize: fontSize,
            fill: textData.fontColor,
            textBackgroundColor: textData.backColor,
            originX: "left",
            originY: "top",
            //clipPath: rectTitle,
          });
          if (textData.fontFamily) {
            textTitle.fontFamily = textData.fontFamily;
          }
          cEditor.rectTitle = textTitle;
          groupObject.push(textTitle);
        }
        break;
      case "TRPSHAPE":
        {
          const compoShape = component as ShapeItem;
          const drawElement = cEditor.updateComponentEditorShape(compoShape, true, false)!;
          groupObject.push(drawElement);
        }
        break;
      case "TRPIMAGE":
        {
          const compoImage = component as ImageItem;
          const drawElement = cEditor.updateComponentEditorImage(compoImage, true);
          groupObject.push(drawElement);
        }
        break;
    }
    const scaledPosX = DesignUtils.twipsTopx(component.posX) * this.reportDesign.zoom;
    const scaledPosY = DesignUtils.twipsTopx(component.posY) * this.reportDesign.zoom;

    const leftPos = sectionEditor.posX + scaledPosX;
    const topPos = sectionEditor.posYSection + scaledPosY;

    const group = new Group(groupObject, {
      left: leftPos,
      top: topPos,
      width: scaledWidth,
      height: scaledHeight,
      selectable: true,
      hasControls: true,
      lockSkewingX: true,
      lockSkewingY: true,
      hasBorders: true,
      lockScalingFlip: true,
      centeredScaling: false,
      originX: "left",
      originY: "top",
    });
    group.setCoords();

    // Fixed resize cursor per control. The designer objects do not rotate
    // (rotation/skew locked), so we do not need the default "rotation-aware" cursor;
    // besides, the default controls ship scaleCursorStyleHandler/scaleSkewCursorStyleHandler
    // which compute the cursor and IGNORE control.cursorStyle, so the
    // cursorStyleHandler has to be overridden to fix the pointer of each corner/side.
    const cursorPorControl: Record<string, string> = {
      tl: "nwse-resize",
      br: "nwse-resize",
      tr: "nesw-resize",
      bl: "nesw-resize",
      mt: "ns-resize",
      mb: "ns-resize",
      ml: "ew-resize",
      mr: "ew-resize",
    };

    group.forEachControl((control, key) => {
      const cursor = cursorPorControl[key];
      if (cursor) {
        control.cursorStyle = cursor;
        control.cursorStyleHandler = () => cursor;
      }
      switch (key) {
        case "mt":
        case "mb":
          control.render = controlsUtils.renderSquareControl;
          control.sizeX = 20;
          control.sizeY = 6;
          break;
        case "ml":
        case "mr":
          control.render = controlsUtils.renderSquareControl;
          control.sizeX = 6;
          control.sizeY = 20;
          break;
        case "mtr":
          control.visible = false;
          break;
        default:
          break;
      }
    });

    cEditor.group = group;
    // Full text style (bold, italic, transparent, valign, clip) also
    // on the initial load: it used to be applied indirectly by the update() that
    // recolocarSecciones launched after loading; when the reflow was optimized it stopped happening.
    switch (component.className) {
      case "TRPCHART":
      case "TRPEXPRESSION":
      case "TRPLABEL":
      case "TRPBARCODE":
        // The default layout of the Group (FitContent) sizes the group to the bounding box of
        // its children ONLY at initialization. The Textbox, when it wraps the text to the width
        // (splitByGrapheme), is taller than the component when the text wraps over
        // several lines (typical of long expressions) → the group —and therefore the
        // selection box— was much taller than the element. The update() that
        // the reflow launched after loading used to fix it; when it was optimized that stopped. We force here the size
        // of the group to that of the component and move the rectangle to its center, like update().
        group.set({ width: scaledWidth, height: scaledHeight });
        rectTitle.set({
          left: -scaledWidth / 2,
          top: -scaledHeight / 2,
          width: scaledWidth,
          height: scaledHeight,
        });
        group.setCoords();
        cEditor.updateTextTitle(scaledWidth, scaledHeight, false);
        break;
    }
    cEditor.updateClipPathGroup();
    (group as any).componentEditorDesign = cEditor;
    return group;
  }
  private crearComponentesSeccion(sectionEditor: SectionEditorDesign) {
    if (!sectionEditor?.section?.components) {
      return;
    }
    for (const component of sectionEditor.section.components) {
      // this.recolocarComponenteSeccion(sectionEditor, cEditor, true);
      const group = this.crearComponente(sectionEditor, component);
      this.canvas.add(group);
    }
  }
  private crearElementosSeccion(section: Section | undefined) {
    const sectionEditor = new SectionEditorDesign(this.reportDesign);
    sectionEditor.posX = this.rulerSize;
    sectionEditor.section = section;
    if (section) {
      // In SCALED px (with zoom), as recolocarSecciones sets them: updateClipPathGroup
      // computes the section clip with these values at creation time. Without the
      // zoom, at >100% the clip was too small and cut the components on the right/bottom.
      sectionEditor.width = DesignUtils.twipsTopx(section.width!) * this.reportDesign.zoom;
      sectionEditor.height = DesignUtils.twipsTopx(section.height!) * this.reportDesign.zoom;
    }
    const sectionEditors = this.reportDesign.subreportEditor!.sectionEditors;
    let antSection: Section | undefined = undefined;
    let antSectionEditor: SectionEditorDesign | undefined = undefined;
    let posY = 0;
    if (sectionEditors.length > 0) {
      antSectionEditor = sectionEditors[sectionEditors.length - 1];
      antSection = antSectionEditor.section;
      posY = antSectionEditor.posYEnd;
    }
    sectionEditor.previousSection = antSection;
    sectionEditor.previousSectionEditor = antSectionEditor;
    sectionEditors.push(sectionEditor);

    // Add the title rectangle of the section
    const rectTitle = new Rect({
      left: 0,
      top: 0,
      fill: sectionEditor.section == this.activeSection ? "darkgrey" : "lightgrey",
      stroke: "black",
      // FIXED width (not the surface one, which is dynamic): the title bar is "sticky" —
      // relocateLeftRulers re-anchors it to the left edge of the viewport on every scroll—, so it only
      // needs to be wider than the viewport, not than the content. Tying it to the surface width
      // (dynamic and captured at creation) meant that, when a section was enlarged and the surface grew,
      // its selection area no longer covered the whole visible width. A large constant = always
      // selectable across the whole visible row, at any zoom/scroll.
      width: this.MAXIMUMWIDTH,
      height: section ? this.titleBarHeight : this.titleBarHeight * 0.6,
      originX: "left",
      originY: "top",
    });
    const groupObject: FabricObject[] = [rectTitle];
    if (section) {
      // The section's name as the structure tree says it, in the designer's language.
      const topCaption = this.report
        ? DesignUtils.getSectionDisplayName(this.report, section, false, this.translator)
        : DesignUtils.sectionTypeToString(section.sectionType, section.groupName);
      const textTitle = new Textbox(topCaption, {
        left: 10, // 10px from the left edge of the rect
        top: 5,
        splitByGrapheme: true,
        width: 180,
        selectable: false,
        evented: false,
        textAlign: "left",
        originX: "left",
        originY: "top",
        fontSize: 10,
      });
      groupObject.push(textTitle);
    }

    const group = new Group(groupObject, {
      left: 0,
      top: posY,
      selectable: true,
      hasControls: false,
      lockSkewingX: true,
      lockSkewingY: true,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      lockMovementX: true,
      hasBorders: true,
      lockMovementY: sectionEditors.length === 1,
      originX: "left",
      originY: "top",
      // No cache: it is a rect + short text that spans the whole width of the surface. With the default
      // cache, at high zoom its side would exceed the maxCacheSideLimit (4096) of Fabric and the section
      // name would come out blurry (rescaled cache). Disabling it is free here and avoids that.
      objectCaching: false,
    });
    (group as any).sectionEditorDesign = sectionEditor;
    (group as any).isTopBar = true;
    (group as any).rectTitle = rectTitle;

    sectionEditor.topRect = group;

    this.canvas.add(group);
    sectionEditor.posYTitle = posY;
    posY = posY + this.titleBarHeight;
    sectionEditor.posYSection = posY;
    if (section) {
      const scaledHeight = DesignUtils.twipsTopx(section.height ?? 0) * this.reportDesign.zoom;
      const scaledWidth = DesignUtils.twipsTopx(section.width ?? 0) * this.reportDesign.zoom;
      // Add the section rectangle
      const rect = new Rect({
        left: scaledWidth + sectionEditor.posX,
        top: posY,
        fill: "lightgrey",
        stroke: "black",
        width: 15,
        height: scaledHeight,
        lockScalingY: true,
        hasControls: false,
        lockSkewingX: true,
        lockSkewingY: true,
        lockRotation: true,
        lockMovementX: false,
        lockMovementY: true,
        lockScalingX: true,
        selectable: true,
        originX: "left",
        originY: "top",
      });
      sectionEditor.rightRect = rect;
      this.canvas.add(rect);
      (rect as any).sectionEditorDesign = sectionEditor;
      (rect as any).isRightBar = true;

      // scaledHeight ALREADY includes the zoom: multiplying it again shifted the stacking
      // of sections at creation with zoom > 100% (recolocarSecciones hid it later).
      posY = posY + scaledHeight;
      sectionEditor.posYEnd = posY;
      this.crearComponentesSeccion(sectionEditor);
    }
  }
  public calcSubReportDimensions() {
    if (!this.reportDesign.subreportEditor) {
      return;
    }
    let maxWidth = 0;
    let maxHeight = 0;
    // Calculation of the height and the width
    for (const section of this.reportDesign.subreportEditor.subReport!.sections) {
      const scaledHeight = DesignUtils.twipsTopx(section.height ?? 0) * this.reportDesign.zoom;
      const scaledWidth = DesignUtils.twipsTopx(section.width ?? 0) * this.reportDesign.zoom;
      maxHeight += this.titleBarHeight;
      maxHeight += scaledHeight;
      if (scaledWidth > maxWidth) {
        maxWidth = scaledWidth + this.rulerSize;
      }
    }
    this.topRulerMargin.width = maxWidth;
    this.reportDesign.subreportEditor.maxWidth = maxWidth;
    this.reportDesign.subreportEditor.maxHeight = maxHeight;
    // The canvas surface = ALREADY scaled content (maxWidth/maxHeight grow with the zoom because
    // everything is drawn in scaled px) + a FIXED margin. This way the horizontal/vertical scroll always reaches
    // the edge of the report at any zoom, without enlarging the canvas more than needed. Before,
    // the width was a constant (MAXIMUMWIDTH) that did not scale -> at >100% the content exceeded the
    // canvas and the horizontal scroll did not reach it.
    const newCanvasWidth = Math.ceil(maxWidth + this.SURFACEMARGIN);
    const newCanvasHeight = Math.ceil(
      this.reportDesign.subreportEditor.maxHeight + this.SURFACEMARGIN
    );
    // setDimensions() rescales the canvas and triggers a FULL render of EVERYTHING (the 138 images,
    // also with objectCaching:false) → ~300-480ms. Since it is called in every recolocarSecciones (every
    // frame of the resize) it was THE bottleneck; and in a WIDTH resize the canvas dimensions
    // do not even change. We only call it when they really change.
    if (
      !this.isSectionResizing &&
      (this.canvas.getWidth() !== newCanvasWidth || this.canvas.getHeight() !== newCanvasHeight)
    ) {
      this.canvas.setDimensions(
        { width: newCanvasWidth, height: newCanvasHeight },
        { backstoreOnly: false }
      );
    }
  }
  public selectSubReport(subReport: SubReport) {
    this.canvas?.clear();
    const fabricCanvasEl = this.canvas.getElement(); // returns the real <canvas>
    fabricCanvasEl.style.imageRendering = "pixelated";
    const ctx = this.canvas.getContext();
    ctx.imageSmoothingEnabled = false;
    ctx.imageSmoothingQuality = "low";
    this.canvas.backgroundColor = "gray";

    this.reportDesign.subreportEditor = new SubreportEditorDesign();
    this.reportDesign.subreportEditor.reportEditorDesign = this.reportDesign;
    this.reportDesign.subreportEditor.subReport = subReport;
    this.calcSubReportDimensions();
    // setGridBackground is not called here: recolocarSecciones (at the end of this method)
    // regenerates it anyway — calling it twice doubled ~200ms per build.

    /*    this.canvasElement = document.createElement('canvas');
    this.canvasElement.id = 'myCanvas';
    this.canvasElement.width = maxWidth;
    this.canvasElement.height = maxHeight;

    // Insert it into the template div
    this.canvasContainer.nativeElement.appendChild(this.canvasElement);

    // Initialize Fabric.js with the canvas ID
    this.canvas = new Canvas('myCanvas');*/

    //this.canvasElement!.width = maxWidth;
    //this.canvasElement!.height = maxHeight;
    //this.canvas.width = maxWidth;
    //this.canvas.height = maxHeight;

    if (subReport.sections) {
      for (const section of subReport.sections) {
        this.crearElementosSeccion(section);
      }
      // The last bar, to resize the last section
      this.crearElementosSeccion(undefined);
    }
    //this.canvas.renderAll();

    // let posY = 0;
    /*for (const sectionEditor of this.reportDesign.subreportEditor
      .sectionEditors) {
      if (sectionEditor.section) {
        const section = sectionEditor.section;
        const scaledHeight = DesignUtils.twipsTopx(
          (section.height ?? 0) * this.zoom
        );
        posY = posY + this.titleBarHeight;
        if (scaledHeight > 0) {
          const rulerXPos = -this.topRulerMargin.margin + this.rulerSize;
          const rulerImg = this.createLeftRulerImage(
            this.rulerSize,
            scaledHeight,
            rulerXPos,
            posY
          );
          sectionEditor.leftRuler = rulerImg;
          this.canvas.add(rulerImg);
        }
        posY = posY + scaledHeight;
      }
    }*/
    this.recolocarSecciones(undefined);

    this.canvas.requestRenderAll();
    //this.canvasElement!.width = maxWidth;
    // this.canvasElement!.height = posY;
    // this.canvas.width = maxWidth;
    // this.canvas.height = posY;
  }
  private relocateLeftRulers() {
    const rulerXPos = -this.topRulerMargin.margin + this.rulerSize;
    if (this.reportDesign.subreportEditor) {
      for (const sectionEditor of this.reportDesign.subreportEditor.sectionEditors) {
        if (sectionEditor.leftRuler) {
          sectionEditor.leftRuler.set({ left: rulerXPos });
          sectionEditor.leftRuler.setCoords();
        }
        if (sectionEditor.topRect) {
          sectionEditor.topRect.set({ left: rulerXPos });
          // setCoords is MANDATORY: topRect is selectable and its click area is its aCoords (Fabric
          // caches them). Without it, when the bar is re-anchored on every scroll the VISUAL moves but the
          // click area stays at the last position set with setCoords -> after enlarging a section
          // (auto-scroll to the right) and going back to the left, the left half of the bar
          // was "dead" and could only be selected from the right.
          sectionEditor.topRect.setCoords();
        }
      }
    }
  }
  private createLeftRulerImage(
    width: number,
    height: number,
    left: number,
    top: number
  ): FabricImage {
    // Create an offscreen canvas
    const offscreen = document.createElement("canvas");
    offscreen.width = Math.max(width, 1);
    offscreen.height = Math.max(height, 1);
    const ctx = offscreen.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.imageSmoothingQuality = "low";
    // Use the ruler drawing function in this context
    this.drawLeftRuler(offscreen, ctx, 0, 0, width, height);

    // Create a fabric.Image with the offscreen canvas
    const img = new FabricImage(offscreen, {
      left: left,
      top: top,
      selectable: false,
      evented: false,
      scaleX: 1,
      scaleY: 1,
      originX: "left",
      originY: "top",
    });

    return img;
  }
  public initReport() {
    if (!this.report) {
      return;
    }
    this.reportDesign.report = this.report;
    // const sectionTitleHeight = 40;
    if (this.report.subReports.length == 0) {
      this.report.subReports.push(new SubReport());
    }
    this.selectSubReport(this.report.subReports[0]);
  }
  /**
   * Swaps the whole document for another one (the AI copilot's answer). Takes the plain JSON the
   * server produces, UndoCue included: the cloud records the AI's operations in it, so Undo keeps
   * working across the swap and reverts the AI change as one group.
   */
  public replaceReport(raw: any, markModified = true): void {
    const snapshot = hydrateReport(typeof raw === "string" ? JSON.parse(raw) : raw);
    this.canvasService.clearSelection();
    try {
      this.canvas?.discardActiveObject();
    } catch {
      // no canvas yet
    }
    this.activeSection = undefined;
    this.report = snapshot;
    this.report.modified = markModified;
    this.initReport();
    this.objectInspector?.resetDatasetHelper();
    setTimeout(() => this.objectInspector?.loadObject(), 0);
    this.cdr.markForCheck();
  }

  /** The document as the server understands it (what save() sends), for snapshots and the copilot. */
  public documentJson(): string {
    return JSON.stringify(this.report);
  }

  private deselectAllObjects() {
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
  }
  // Debounce the report refresh, in case several operations are undone in a row
  public afterUndoDo(operations: ChangeObjectOperation[]) {
    if (this.afterUndoDoTimer) {
      clearTimeout(this.afterUndoDoTimer);
    }

    // We create a new one
    this.afterUndoDoTimer = setTimeout(() => {
      this.objectInspector?.loadObject();
      this.refreshSubReport();
    }, 200);
  }
  public refreshSubReport() {
    // We keep the previous selection
    const activeObjects = this.canvas.getActiveObjects() ?? [];
    const activeNames: string[] = [];
    for (const activeObject of activeObjects) {
      if ((activeObject as any).componentEditorDesign) {
        const compoEditor = (activeObject as any).componentEditorDesign as ComponentEditorDesign;
        activeNames.push(compoEditor.component.name);
      }
    }
    this.selectSubReport(this.reportDesign.subreportEditor!.subReport!);
    const objs = this.canvas.getObjects() ?? [];
    const foundObjs: PrintPosItem[] = [];
    const foundFabric: FabricObject[] = [];
    for (const obj of objs) {
      if ((obj as any).componentEditorDesign) {
        const compoEditor = (obj as any).componentEditorDesign as ComponentEditorDesign;
        if (activeNames.indexOf(compoEditor.component.name) >= 0) {
          foundObjs.push(compoEditor.component);
          foundFabric.push(obj);
        }
      }
    }
    if (foundObjs.length === 1) {
      this.canvasService.selectItem(foundObjs[0]);
    } else {
      this.canvasService.selectFabricItems(foundFabric);
    }
  }
  public undoClick() {
    this.deselectAllObjects();
    const operation = this.report?.undoCue?.undo(this.report);
    if (operation) {
      this.afterUndoDo(operation);
    }
  }
  public redoClick() {
    this.deselectAllObjects();
    const operation = this.report?.undoCue?.redo(this.report);
    if (operation) {
      this.afterUndoDo(operation);
    }
  }

  protected onScroll(): void {
    const div = this.canvasContainer!.nativeElement;
    // Forces Angular to detect the change immediately
    this.ngZone.run(() => {
      this.topRulerMargin.margin = -div.scrollLeft + this.rulerSize;
    });

    // console.log("Scroll horizontal:", this.topRulerMargin.margin);
    if (this.reportDesign.subreportEditor?.subReport) {
      this.relocateLeftRulers();
      this.canvas?.requestRenderAll();
    }
  }
  public onZoomChange(event: any) {
    if (this.changingZoom) {
      return;
    }
    this.changingZoom = true;
    try {
      this.selectSubReport(this.reportDesign.subreportEditor!.subReport!);
    } finally {
      this.changingZoom = false;
    }
  }
  public async waitForFont(fontName: string): Promise<void> {
    if ("fonts" in document) {
      try {
        // Wait until the font is available, or time out after 3 seconds
        await Promise.race([
          (document as any).fonts.load(`1em ${fontName}`),
          new Promise((_, reject) => setTimeout(() => reject("Timeout cargando fuente"), 3000)),
        ]);
      } catch (e) {
        console.warn(e);
      }
    } else {
      // If the Font Loading API is not supported, assume it is already loaded
      return;
    }
  }
  private clearSelectedDesginElmentType() {
    for (const current of Object.values(DesignElementType).filter((v) => typeof v === "number")) {
      this.designElementsMap.set(current as DesignElementType, false);
    }
  }
  protected toolElementClicked(selection: DesignElementType) {
    this.clearSelectedDesginElmentType();
    this.designElementsMap.set(selection, true);
    if (selection == DesignElementType.Pointer) {
      this.canvasService.disableInsertMode();
    } else {
      this.canvasService.clearSelection();
      this.canvasService.enableInsertMode();
    }
  }
  private getSelectedDesignElementType(): DesignElementType {
    for (const current of Object.values(DesignElementType).filter((v) => typeof v === "number")) {
      const currentType = current as DesignElementType;
      const wasSelected = this.designElementsMap.get(currentType);
      if (wasSelected) {
        return currentType;
      }
    }
    return DesignElementType.Pointer;
  }
  private findSectionEditor(area: RectangleArea): SectionEditorDesign | undefined {
    if (!this.reportDesign.subreportEditor) {
      return undefined;
    }
    for (const secEditor of this.reportDesign.subreportEditor.sectionEditors) {
      if (secEditor.posYEnd >= area.top) {
        if (secEditor.section) {
          return secEditor;
        } else {
          return undefined;
        }
      }
    }
    return undefined;
  }
  private createComponent(area: RectangleArea) {
    if (!this.report) {
      return;
    }
    const groupId = this.report.undoCue!.getGroupId();
    const op = new ChangeObjectOperation(OperationType.Add, groupId);
    const selectedType = this.getSelectedDesignElementType();
    this.clearSelectedDesginElmentType();
    this.designElementsMap.set(DesignElementType.Pointer, true);
    const section = this.findSectionEditor(area);
    if (!section) {
      return undefined;
    }
    let newItem: PrintPosItem | undefined = undefined;
    switch (selectedType) {
      case DesignElementType.Label:
        {
          const label = new LabelItem();
          label.className = "TRPLABEL";
          DesignUtils.setLanguageText(label.allStrings, "Text", this.report?.language);
          op.addProperty("allStrings", PropertyType.StringArray, undefined, [...label.allStrings]);
          DesignUtils.initText(this.report, label, op);
          newItem = label;
        }
        break;
      case DesignElementType.Expression:
        {
          const expre = new ExpressionItem();
          expre.expression = "2+2";
          expre.className = "TRPEXPRESSION";
          op.addProperty("expression", PropertyType.String, undefined, expre.expression);
          DesignUtils.initText(this.report, expre, op);
          newItem = expre;
        }
        break;
      case DesignElementType.Shape:
        {
          const shape = new ShapeItem();
          shape.className = "TRPSHAPE";
          let shapeType = ShapeType.Rectangle;
          for (const buttonDesign of this.designElementsArray) {
            if (buttonDesign.designElement == DesignElementType.Shape) {
              shapeType = buttonDesign.currentShape ?? ShapeType.Rectangle;
            }
          }
          shape.shape = shapeType;
          op.addProperty("shape", PropertyType.Integer, undefined, shape.shape);

          newItem = shape;
        }
        break;
      case DesignElementType.Image:
        {
          const image = new ImageItem();
          image.className = "TRPIMAGE";
          newItem = image;
        }
        break;
      case DesignElementType.Barcode:
        {
          const barcode = new BarcodeItem();
          barcode.className = "TRPBARCODE";
          barcode.expression = "'123456'";
          op.addProperty("expression", PropertyType.String, undefined, barcode.expression);
          newItem = barcode;
        }
        break;
      case DesignElementType.Chart:
        {
          const chart = new ChartItem();
          chart.className = "TRPCHART";
          chart.valueExpression = "2+2";
          op.addProperty("valueExpression", PropertyType.String, undefined, chart.valueExpression);
          DesignUtils.initText(this.report, chart, op);
          newItem = chart;
        }
        break;
    }
    if (!newItem) {
      return;
    }
    newItem.hidden = false;
    newItem.align = 0;
    this.report?.newName(newItem);
    this.report.components.set(newItem.name.toUpperCase(), newItem);
    let relposX = area.left - section.posX;
    relposX = DesignUtils.pxTotwips(relposX / this.reportDesign.zoom);
    let relposY = area.top - section.posYSection;
    relposY = DesignUtils.pxTotwips(relposY / this.reportDesign.zoom);
    newItem.posX = relposX;
    newItem.posY = relposY;
    newItem.width = DesignUtils.pxTotwips(area.width / this.reportDesign.zoom);
    newItem.height = DesignUtils.pxTotwips(area.height / this.reportDesign.zoom);
    // A click (no drag) places the component with the usual size of its kind, as the desktop
    // designer does, instead of an invisible 0x0 object.
    const defaultSize = DEFAULT_COMPONENT_SIZES[selectedType];
    if (defaultSize && (area.width < CLICK_TOLERANCE_PX || area.height < CLICK_TOLERANCE_PX)) {
      newItem.width = defaultSize.width;
      newItem.height = defaultSize.height;
    }
    op.oldItemIndex = section.section!.components.length;
    section.section!.components.push(newItem);
    op.componentClass = newItem.className;
    op.addProperty("posX", PropertyType.Integer, undefined, newItem.posX);
    op.addProperty("posY", PropertyType.Integer, undefined, newItem.posY);
    op.addProperty("width", PropertyType.Integer, undefined, newItem.width);
    op.addProperty("height", PropertyType.Integer, undefined, newItem.height);
    op.parentName = section.section?.name;
    op.componentName = newItem.name;
    this.report.undoCue?.addOperation(op, this.report);
    const subreport = this.reportDesign.subreportEditor!.subReport!;
    this.selectSubReport(subreport);
    this.selectPrintItem(newItem);
  }
  private selectPrintItem(item: PrintPosItem) {
    if (!this.report) {
      return;
    }
    if (!this.reportDesign.subreportEditor) {
      return;
    }
    for (const sectionEditor of this.reportDesign.subreportEditor.sectionEditors) {
      for (const compoEditor of sectionEditor.components) {
        if (compoEditor.component == item) {
          this.canvasService.selectItem(item);
          if (compoEditor.group) {
            this.canvas.setActiveObject(compoEditor.group);
          }
          return;
        }
      }
    }
  }
  protected cutClicked() {
    // Copy selection to clipboard
    if (!this.copySelectedItems()) {
      return;
    }
    this.deleteClicked();
  }
  private copySelectedItems(): boolean {
    const items = this.selectedPosItems();
    if (!items) {
      return false;
    }
    const printposItems: PrintPosItem[] = [];
    for (const item of items) {
      printposItems.push(item.item as PrintPosItem);
    }
    this.report!.copyItemsToClipboard(printposItems, navigator.clipboard);
    return true;
  }
  protected async copyClicked() {
    this.copySelectedItems();
  }
  protected async pasteClicked() {
    const section = this.sectionSelected();
    if (!section) {
      return;
    }
    const progress = await this.pres.mostrarLoading();
    try {
      await this.report!.pasteItemsFromClipboard(section, navigator.clipboard);
      // Select the section visually
      this.canvasService.selectItem(section);
    } finally {
      progress.ocultar();
      this.refreshSubReport();
    }
  }
  protected deleteClicked() {
    if (!this.reportStructure) {
      throw new Error("No report structure");
    }
    if (!this.report) {
      throw new Error("No report assigned");
    }
    const items = this.selectedPosItems();
    if (!items) {
      return;
    }
    if (items.length > 0) {
      const groupId = this.report.undoCue!.getGroupId();
      for (const item of items) {
        const pitem = item.item as PrintPosItem;
        const section = this.report.getParentSection(pitem);
        const index = section.components.indexOf(pitem);
        this.report.deleteComponentPrintPosItem(section, pitem, index, groupId);
        if (item.ComponentEditor?.group) this.canvas.remove(item.ComponentEditor.group);
      }
      // The active selection still points at the removed objects: drop it, or the toolbar keeps
      // offering to delete, cut and copy what is no longer there.
      this.canvasService.clearSelection();
    }
  }
  protected selectedPosItems(): SelectedReportItem[] | undefined {
    const items = this.canvasService.getSelectedReportItems(this);
    if (!items) {
      return undefined;
    }
    for (const item of items) {
      switch (item.item.className) {
        case "TRPDATAINFOITEM":
        case "TRPDATABASEINFOITEM":
        case "TRPSECTION":
        case "TRPSUBREPORT":
        case "TRPPARAM":
          return undefined;
      }
    }
    return items;
  }
  protected sectionSelected(): Section | undefined {
    return this.activeSection;
    /*
    const items = this.canvasService.getSelectedReportItems(this);
    if (!items) {
      return undefined;
    }
    if (!(items.length == 1)) {
      return undefined;
    }
    if (items[0].item.className == "TRPSECTION") {
      return items[0].item as Section;
    } else {
      return undefined;
    }*/
  }
  private async gridOptionsClick() {
    if (!this.report?.undoCue) {
      return;
    }
    const result = await GridOptionsDialogComponent.showGridOptions(this.pres, {
      gridColor: DesignUtils.numberToHexColor(this.report.gridColor!),
      gridHeight: DesignUtils.twipsToUnit(
        this.report.gridHeight!,
        this.designPreferences.MeaureUnit,
        4
      ),
      gridWidth: DesignUtils.twipsToUnit(
        this.report.gridWidth!,
        this.designPreferences.MeaureUnit,
        4
      ),
      gridLines: this.report.gridLines,
      gridEnabled: this.report.gridEnabled,
      gridVisible: this.report.gridVisible,
    });
    if (result) {
      const groupId = this.report.undoCue.getGroupId();
      const op = new ChangeObjectOperation(OperationType.Modify, groupId);
      op.componentName = "REPORT";
      op.componentClass = "TRPREPORT";
      const newColor = DesignUtils.hexColorToNumber(result.gridColor);
      if (newColor != this.report.gridColor) {
        op.addProperty("gridColor", PropertyType.Integer, this.report.gridColor, newColor);
        this.report.gridColor = newColor;
      }
      if (this.report.gridEnabled !== result.gridEnabled) {
        op.addProperty(
          "gridEnabled",
          PropertyType.Integer,
          this.report.gridEnabled,
          result.gridEnabled
        );
        this.report.gridEnabled = result.gridEnabled;
      }
      const twipsHeight = DesignUtils.unitToTwips(
        result.gridHeight,
        this.designPreferences.MeaureUnit
      );
      if (this.report.gridHeight !== twipsHeight) {
        op.addProperty("gridHeight", PropertyType.Integer, this.report.gridHeight, twipsHeight);
        this.report.gridEnabled = result.gridEnabled;
        this.report.gridHeight = twipsHeight;
      }
      const twipsWidth = DesignUtils.unitToTwips(
        result.gridWidth,
        this.designPreferences.MeaureUnit
      );
      if (this.report.gridHeight !== twipsHeight) {
        op.addProperty("gridWidth", PropertyType.Integer, this.report.gridWidth, twipsWidth);
        this.report.gridEnabled = result.gridEnabled;
        this.report.gridWidth = twipsWidth;
      }
      if (this.report.gridVisible !== result.gridVisible) {
        op.addProperty(
          "gridVisible",
          PropertyType.Integer,
          this.report.gridVisible,
          result.gridVisible
        );
        this.report.gridVisible = result.gridVisible;
      }
      if (this.report.gridLines !== result.gridLines) {
        op.addProperty("gridLines", PropertyType.Integer, this.report.gridLines, result.gridLines);
        this.report.gridLines = result.gridLines;
      }
      if (op.properties.length > 0) {
        this.report.undoCue.addOperation(op, this.report);
      }
      this.refreshSubReport();
    }
  }
  public async preview(subreportIndexes?: number[]) {
    if (!this.report) {
      return;
    }
    this.runError.set(null);
    const loading = await this.pres.mostrarLoading();
    try {
      const request = new ExecuteReportRequest();
      //newReport.params = [];
      //request.report = newReport;
      request.reportName = this.currentReportName;
      request.report = this.report;
      request.subreportIndexes = subreportIndexes;
      // request.reportJson = JSON.stringify(this.report);
      const result = await this.reportService.getExecuteReportResponse(request);
      // No rows: said in the designer's language («No data available to print»), as the Delphi
      // designer says it, not as a failure of some component.
      if (result.noData) throw new Error(this.translator.TranslateStr(799));
      if (result.errorMessage) {
        // Over the canvas until closed, with the culprit selected (the Delphi designer selects it too).
        this.runError.set({
          message: result.errorMessage,
          component: result.errorComponentName || undefined,
          property: result.errorComponentProperty || undefined,
        });
        if (result.errorComponentName) {
          this.selectComponentByName(result.errorComponentName);
        }
        return;
      }

      this.executed.emit(result.result);
    } catch (error) {
      // Shown here: the toolbar and the report menu call this without waiting, so a thrown error
      // (a missing table, a wrong expression) only reached the console and the preview did nothing.
      await this.pres.mostrarError(error);
    } finally {
      loading.ocultar();
    }
  }
  /** Selects a component by its name: its subreport, then the item on the canvas (and in the tree). */
  public selectComponentByName(name: string): void {
    if (!this.report) {
      return;
    }
    let compo: ReportItem;
    try {
      compo = this.report.getComponentByName(name);
    } catch {
      // A name the engine reported but the document does not have (a dataset, a parameter).
      return;
    }
    let subreport: SubReport | undefined = undefined;
    let pitem: PrintPosItem | undefined = undefined;
    if (PrintPosItem.isPrintPosItem(compo.className)) {
      pitem = compo as PrintPosItem;
      subreport = this.report.getParentSubReport(this.report.getParentSection(pitem));
    } else if (compo.className === "TRPSUBREPORT") {
      subreport = compo as SubReport;
    }
    if (subreport && this.reportDesign.subreportEditor?.subReport != subreport) {
      this.selectSubReport(subreport);
    }
    if (pitem) {
      const item = pitem;
      setTimeout(() => {
        this.selectPrintItem(item);
      }, 200);
    }
    this.canvasService.selectItem(compo);
  }

  /** The failed run's text, whole, for the copilot or a message. */
  protected async copyRunError(): Promise<void> {
    const e = this.runError();
    if (!e) {
      return;
    }
    try {
      await navigator.clipboard.writeText(e.message);
    } catch (error) {
      await this.pres.mostrarError(error);
    }
  }

  protected tx(key: string): string {
    return this.translator.t(key);
  }

  protected txNum(key: number): string {
    return this.translator.TranslateStr(key);
  }

  /**
   * «Save as...»: asks the new name (folders allowed, «.rep» added), asks before replacing another
   * report, saves there and goes on with that name. The host learns it through `savedAs`.
   */
  public async saveAs(): Promise<boolean> {
    if (!this.report || !this.currentReportName) {
      return false;
    }
    const slash = this.currentReportName.indexOf("/");
    const alias = slash > 0 ? this.currentReportName.substring(0, slash) : "";
    const current = slash > 0 ? this.currentReportName.substring(slash + 1) : this.currentReportName;
    const answer = await this.pres.pedirTexto({
      titulo: this.translator.TranslateStr(48),
      descripcion: this.translator.t("DesignerSaveAsName"),
      valorOmision: current,
    });
    if (answer.cancelado) {
      return false;
    }
    let path = (answer.valor ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (!path) {
      return false;
    }
    if (!/\.rep$/i.test(path)) {
      path += ".rep";
    }
    const target = alias ? alias + "/" + path : path;
    if (target === this.currentReportName) {
      return await this.save();
    }
    if (await this.reportExists(target)) {
      const replace = await this.pres.pedirConfirmacion({
        titulo: this.translator.TranslateStr(48),
        descripcion: this.translator.t("DesignerSaveAsExists", { name: path }),
        tipo: TipoConfirmacion.PosNeg,
      });
      if (!replace) {
        return false;
      }
    }
    const previous = this.currentReportName;
    this.currentReportName = target;
    if (!(await this.save())) {
      this.currentReportName = previous;
      return false;
    }
    this.savedAs.emit(target);
    return true;
  }

  /** Whether the store already has a report with that name (reading it is the only way every host has). */
  private async reportExists(reportName: string): Promise<boolean> {
    try {
      const request = new ReadReportRequest();
      request.reportName = reportName;
      const response = await this.reportService.getReadReportResponse(request);
      return !response.errorMessage && !!response.report;
    } catch {
      return false;
    }
  }

  /** Saves the report; false (with the error shown) when the server refused it. */
  public async save(): Promise<boolean> {
    if (!this.report) {
      return false;
    }
    const loading = await this.pres.mostrarLoading();
    try {
      const request = new WriteReportRequest();
      //request.report = this.report;
      request.reportJson = JSON.stringify(this.report);
      request.reportName = this.currentReportName;
      const result = await this.reportService.getWriteReportResponse(request);
      if (result.errorMessage) {
        throw new Error(result.errorMessage);
      }
      this.report.modified = false;
      return true;
    } catch (error) {
      await this.pres.mostrarError(error);
      return false;
    } finally {
      loading.ocultar();
    }
  }
  private async readReport(): Promise<string | undefined> {
    const readRequest = new ReadReportRequest();
    readRequest.reportName = this.reportName;
    const response = await this.reportService.getReadReportResponse(readRequest);
    if (response.errorMessage) {
      return response.errorMessage;
    } else {
      this.report = response.report;
      return undefined;
    }
  }
  protected elementDesignOptions(designElementButton: DesignElementButton): OpcionMenu[] {
    const designElement = designElementButton.designElement;
    switch (designElement) {
      case DesignElementType.Shape: {
        const resultado: OpcionMenu[] = [];
        resultado.push({
          nombre: "",
          icono: "matRectangleOutline",
          title: this.translator.TranslateStr(606),
          checked: designElementButton.currentShape == ShapeType.Rectangle,
          callback: () => {
            this.toolElementClicked(designElementButton.designElement);
            designElementButton.currentShape = ShapeType.Rectangle;
          },
        });
        resultado.push({
          nombre: "",
          icono: "matSquareOutline",
          title: this.translator.TranslateStr(609),
          checked: designElementButton.currentShape == ShapeType.Square,
          callback: () => {
            this.toolElementClicked(designElementButton.designElement);
            designElementButton.currentShape = ShapeType.Square;
          },
        });
        resultado.push({
          nombre: "",
          icono: "tablerRectangle",
          title: this.translator.TranslateStr(607),
          checked: designElementButton.currentShape == ShapeType.RoundRect,
          callback: () => {
            this.toolElementClicked(designElementButton.designElement);
            designElementButton.currentShape = ShapeType.RoundRect;
          },
        });
        resultado.push({
          nombre: "",
          icono: "tablerSquare",
          title: this.translator.TranslateStr(608),
          checked: designElementButton.currentShape == ShapeType.RoundSquare,
          callback: () => {
            this.toolElementClicked(designElementButton.designElement);
            designElementButton.currentShape = ShapeType.RoundSquare;
          },
        });
        resultado.push({
          nombre: "",
          icono: "tablerOvalVertical",
          title: this.translator.TranslateStr(605),
          checked: designElementButton.currentShape == ShapeType.Ellipse,
          callback: () => {
            this.toolElementClicked(designElementButton.designElement);
            designElementButton.currentShape = ShapeType.Ellipse;
          },
        });
        resultado.push({
          nombre: "",
          icono: "tablerCircle",
          title: this.translator.TranslateStr(604),
          checked: designElementButton.currentShape == ShapeType.Circle,
          callback: () => {
            this.toolElementClicked(designElementButton.designElement);
            designElementButton.currentShape = ShapeType.Circle;
          },
        });
        resultado.push({
          nombre: "",
          icono: 198,
          title: this.translator.TranslateStr(306),
          checked: designElementButton.currentShape == ShapeType.HorzLine,
          callback: () => {
            this.toolElementClicked(designElementButton.designElement);
            designElementButton.currentShape = ShapeType.HorzLine;
          },
        });
        resultado.push({
          nombre: "",
          icono: 199,
          title: this.translator.TranslateStr(307),
          checked: designElementButton.currentShape == ShapeType.VertLine,
          callback: () => {
            this.toolElementClicked(designElementButton.designElement);
            designElementButton.currentShape = ShapeType.VertLine;
          },
        });
        resultado.push({
          nombre: "",
          icono: 200,
          title: this.translator.TranslateStr(719),
          checked: designElementButton.currentShape == ShapeType.Oblique1,
          callback: () => {
            this.toolElementClicked(designElementButton.designElement);
            designElementButton.currentShape = ShapeType.Oblique1;
          },
        });
        resultado.push({
          nombre: "",
          icono: 201,
          title: this.translator.TranslateStr(720),
          checked: designElementButton.currentShape == ShapeType.Oblique2,
          callback: () => {
            this.toolElementClicked(designElementButton.designElement);
            designElementButton.currentShape = ShapeType.Oblique2;
          },
        });
        return resultado;
      }
      default:
        return [];
    }
  }
  public async limpiarCola() {
    const cue = this.report?.undoCue;
    if (!cue || (!cue.undoOperations.length && !cue.redoOperations.length)) {
      return;
    }
    if (
      await this.pres.pedirConfirmacion({
        titulo: this.translator.t("DesignerClearUndo"),
        descripcion: this.translator.t("DesignerClearUndoQuestion"),
      })
    ) {
      cue.clear();
      // The history travels inside the stored document: emptying it is a change to save.
      this.report!.modified = true;
    }
  }
  private selectionChanged() {
    if (!this.report) {
      return;
    }
    const items = this.canvasService.getSelectedReportItems(this);
    if (!items) {
      return;
    }
    let newSelected: Section | undefined = undefined;
    for (const item of items) {
      switch (item.item.className) {
        case "TRPSECTION":
          newSelected = item.item as Section;
          break;
        case "TRPSUBREPORT":
          newSelected = (item.item as SubReport).sections[0];
          break;
        case "TRPLABEL":
        case "TRPCHART":
        case "TRPSHAPE":
        case "TRPBARCODE":
        case "TRPEXPRESSION":
        case "TRPIMAGE":
          {
            const sec = this.report.getParentSection(item.item as PrintPosItem);
            if (!newSelected) {
              newSelected = sec;
            } else {
              if (newSelected !== sec) {
                newSelected = undefined;
                break;
              }
            }
          }
          break;
      }
    }
    if (newSelected != null) {
      this.activeSection = newSelected;
    } else {
      this.activeSection = undefined;
    }
    if (this.reportDesign.subreportEditor?.sectionEditors) {
      for (const sectionEditor of this.reportDesign.subreportEditor.sectionEditors) {
        const group = sectionEditor.topRect;
        const rect = (group as any).rectTitle as Rect;
        if (sectionEditor.section == this.activeSection) {
          rect.set({ fill: "darkgrey" });
        } else {
          rect.set({ fill: "lightgrey" });
        }
      }
      this.canvas.requestRenderAll();
    }
  }
}

interface DesignElementButton {
  designElement: DesignElementType;
  icon?: number | string;
  iconSize?: number;
  label?: string;
  currentShape?: ShapeType;
}
export enum DesignElementType {
  Pointer,
  Label,
  Expression,
  Shape,
  Image,
  Barcode,
  Chart,
}
/** A drawn rectangle smaller than this (in px) counts as a click. */
const CLICK_TOLERANCE_PX = 6;
/** Size (twips) a component gets when it is placed with a click instead of a drag. */
const DEFAULT_COMPONENT_SIZES: Partial<Record<DesignElementType, { width: number; height: number }>> = {
  [DesignElementType.Label]: { width: 1500, height: 275 },
  [DesignElementType.Expression]: { width: 1500, height: 275 },
  [DesignElementType.Shape]: { width: 1440, height: 1440 },
  [DesignElementType.Image]: { width: 1440, height: 1440 },
  [DesignElementType.Barcode]: { width: 2880, height: 720 },
  [DesignElementType.Chart]: { width: 5760, height: 2880 },
};
export class SelectedReportItem {
  public ComponentEditor?: ComponentEditorDesign;
  public SectionEditor?: SectionEditorDesign;
  constructor(
    public item: ReportItem,
    public fabricObject: FabricObject | undefined,
    label?: string
  ) {}
}
