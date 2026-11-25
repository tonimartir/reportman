import { Injectable, EventEmitter } from "@angular/core";
import { ActiveSelection, Canvas, FabricObject, Group, Rect } from "fabric";
import {
  ReportEditorComponent,
  SelectedReportItem,
} from "../report-editor/report-editor.component";
import { PrintPosItem, ReportItem } from "@reportman/lib";

export interface RectangleArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CreationRectangle {
  drawingRect: FabricObject | null;
  isDrawing: boolean;
  startX: number;
  startY: number;
}

@Injectable({ providedIn: "root" })
export class CanvasService {
  public canvas!: Canvas;
  public selectedItem?: ReportItem;
  public selectionChanged = new EventEmitter<any>();
  public beforeSelectionChanged = new EventEmitter<any>();
  public canvasChanged = new EventEmitter<any>();
  public rectangleDrawn = new EventEmitter<RectangleArea>();

  private creationRect: CreationRectangle = {
    drawingRect: null,
    isDrawing: false,
    startX: 0,
    startY: 0,
  };

  private boundMouseDown = this.onMouseDown.bind(this);
  private boundMouseMove = this.onMouseMove.bind(this);
  private boundMouseUp = this.onMouseUp.bind(this);

  public setCanvas(canvas: Canvas) {
    this.canvas = canvas;

    canvas.on("selection:updated", (e) => this.selectionChangedCanvas(e));
    canvas.on("selection:created", (e) => this.selectionChangedCanvas(e));
    canvas.on("selection:cleared", (e) => this.selectionChangedCanvas(e));
    this.canvasChanged.emit(this.canvas);
  }

  private selectionChangedCanvas(e: any) {
    const sel = e.selected;
    if (sel && sel.length >= 1) {
      const activesel = this.canvas.getActiveObject() as ActiveSelection;
      if (!(activesel as any).componentEditorDesign) {
        const objects = activesel.getObjects != null ? activesel.getObjects() : [activesel];
        if (objects.length > 1) {
          activesel.lockScalingX = true;
          activesel.lockScalingY = true;
          activesel.lockScalingFlip = true;
          activesel.borderColor = "#3b82f6";
          activesel.borderScaleFactor = 1.5;

          // Optional: hide the visual scale controls
          activesel.setControlsVisibility({
            mt: false, // middle top
            mb: false, // middle bottom
            ml: false, // middle left
            mr: false, // middle right
            tl: false, // top-left
            tr: false, // top-right
            bl: false, // bottom-left
            br: false, // bottom-right
            mtr: false, // allow rotation (if wanted)
          });

          for (const object of objects) {
            object.borderColor = "#3b82f6";
            object.borderScaleFactor = 1.75;
          }

          this.canvas.requestRenderAll();
        }
      }
    }

    this.beforeSelectionChanged.emit(this.canvas);
    const selectedArray = this.getActiveObjects();
    let modifiedSelection = false;
    const newSelection = [];
    if (selectedArray) {
      for (const selected of selectedArray) {
        if ((selected as any).sectionEditorDesign && selectedArray.length > 1) {
          modifiedSelection = true;
        } else {
          newSelection.push(selected);
        }
      }
    }
    if (modifiedSelection) {
      if (newSelection.length === 0) {
        this.canvas.discardActiveObject();
      } else if (newSelection.length === 1) {
        // if only one is left, select it directly
        this.canvas.setActiveObject(newSelection[0]);
      } else {
        // create a new selection with the remaining ones
        const newActiveSel = new ActiveSelection(newSelection, {});
        this.canvas.setActiveObject(newActiveSel);
      }
      return;
    }
    const selectedObject = this.getActiveObject();
    if (selectedObject) {
      this.selectedItem = undefined;
    }
    this.selectionChanged.emit(this.canvas);
  }
  public selectItem(item: ReportItem) {
    this.selectedItem = item;
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    this.selectionChanged.emit(this.canvas);
  }
  public selectFabricItems(items: FabricObject[]) {
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    const sel = new ActiveSelection(items);
    this.canvas.setActiveObject(sel);
    this.selectionChanged.emit(this.canvas);
  }
  public clearSelection() {
    this.selectedItem = undefined;
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    this.selectionChanged.emit(this.canvas);
  }

  public getActiveObject(): FabricObject | null {
    return this.canvas?.getActiveObject() || null;
  }
  public getActiveObjects(): FabricObject[] | null {
    return this.canvas?.getActiveObjects() || null;
  }

  public updateObject(props: Partial<FabricObject>, obj: FabricObject) {
    obj.set(props);
    this.canvas.requestRenderAll();
  }

  public getSelectedReportItems(
    reportEditor: ReportEditorComponent
  ): SelectedReportItem[] | undefined {
    if (this.selectedItem) {
      return [new SelectedReportItem(this.selectedItem, undefined)];
    }
    const selectedObjects = this.getActiveObjects();
    if (!selectedObjects) {
      return undefined;
    }
    return reportEditor.getSelectedReportItems(selectedObjects);
  }

  public enableInsertMode() {
    this.canvas.selection = false;

    this.canvas.forEachObject((obj) => {
      obj.selectable = false;
      obj.evented = false;
    });

    this.canvas.on("mouse:down", this.boundMouseDown);
    this.canvas.on("mouse:move", this.boundMouseMove);
    this.canvas.on("mouse:up", this.boundMouseUp);
  }
  public disableInsertMode() {
    this.canvas.selection = true;

    this.canvas.forEachObject((obj) => {
      obj.selectable = true;
      obj.evented = true;
    });

    this.canvas.off("mouse:down", this.boundMouseDown);
    this.canvas.off("mouse:move", this.boundMouseMove);
    this.canvas.off("mouse:up", this.boundMouseUp);

    this.creationRect = {
      drawingRect: null,
      isDrawing: false,
      startX: 0,
      startY: 0,
    };
  }
  private onMouseDown(opt: any) {
    const pointer = opt.scenePoint || this.canvas.getScenePoint(opt.e);
    this.creationRect.isDrawing = true;
    this.creationRect.startX = pointer.x;
    this.creationRect.startY = pointer.y;

    this.creationRect.drawingRect = new Rect({
      left: this.creationRect.startX,
      top: this.creationRect.startY,
      width: 0,
      height: 0,
      fill: "rgba(0, 0, 255, 0.2)",
      stroke: "blue",
      strokeWidth: 1,
      selectable: false,
      evented: false,
      originX: "left",
      originY: "top",
    });

    this.canvas.add(this.creationRect.drawingRect);
  }

  private onMouseMove(opt: any) {
    if (!this.creationRect.isDrawing || !this.creationRect.drawingRect) {
      return;
    }

    const pointer = opt.scenePoint || this.canvas.getScenePoint(opt.e);

    const width = pointer.x - this.creationRect.startX;
    const height = pointer.y - this.creationRect.startY;

    this.creationRect.drawingRect.set({
      width: Math.abs(width),
      height: Math.abs(height),
      left: width < 0 ? pointer.x : this.creationRect.startX,
      top: height < 0 ? pointer.y : this.creationRect.startY,
    });

    this.canvas.requestRenderAll();
  }

  private onMouseUp(opt: any) {
    if (!this.creationRect.isDrawing || !this.creationRect.drawingRect) {
      return;
    }

    this.creationRect.isDrawing = false;

    const { left, top, width, height } = this.creationRect.drawingRect;

    this.canvas.remove(this.creationRect.drawingRect);
    this.creationRect.drawingRect = null;

    this.rectangleDrawn.emit({
      left: left!,
      top: top!,
      width: width!,
      height: height!,
    });

    this.disableInsertMode();
  }
}
