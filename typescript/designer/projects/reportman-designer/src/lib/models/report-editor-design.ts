import {
  Group,
  Rect,
  Textbox,
  FabricImage,
  Line,
  Ellipse,
  FabricObject,
  Pattern,
  Canvas,
} from "fabric";
import {
  Section,
  Report,
  SubReport,
  PrintPosItem,
  ShapeItem,
  PenType,
  BrushType,
  ShapeType,
  ImageItem,
  ImageDrawStyleType,
  PrintItemText,
  BarcodeItem,
  BarcodeType,
} from "@reportman/lib";
import { DesignUtils } from "./design-utils";

export class ReportEditorDesign {
  public subreportEditor?: SubreportEditorDesign;
  public report?: Report;
  public zoom = 1.0;
  public canvas?: Canvas;
  public alignToGridTwips(value: number, coordType: CoordType): number {
    if (!this.report?.gridEnabled) {
      return Math.round(value);
    }
    const gridSize = coordType == CoordType.X ? this.report.gridWidth : this.report.gridHeight;
    if (gridSize == undefined || gridSize <= 0) {
      return value;
    }
    return Math.round(Math.round(value / gridSize) * gridSize);
  }
}

export class SubreportEditorDesign {
  public subReport?: SubReport;
  public sectionEditors: SectionEditorDesign[] = [];
  public reportEditorDesign?: ReportEditorDesign;
  public maxWidth = 0;
  public maxHeight = 0;
  public canvas?: Canvas;
}

export class SectionEditorDesign {
  public section?: Section;
  public previousSection?: Section;
  public topRect?: Group;
  public rightRect?: Rect;
  public leftRuler?: FabricImage;
  public posYTitle = 0;
  public posYSection = 0;
  public posYEnd = 0;
  public posX = 0;
  public width = 0;
  public height = 0;
  public previousSectionEditor?: SectionEditorDesign;
  public components: ComponentEditorDesign[] = [];
  constructor(public reportEditor: ReportEditorDesign) {}
}

export class ComponentEditorDesign {
  public group?: Group;
  public groupWidth?: number;
  public groupHeight?: number;
  public rect?: Rect;
  public clipPathGroup?: Rect;
  public clipPathComponent?: Rect;
  public clipPathSection?: Rect;
  public rectTitle?: Textbox;
  /** The dashed outline of where a rotated text or barcode prints (hidden when it is not rotated). */
  public rectRotation?: Rect;
  private clipRotation?: Rect;
  public recEllipse?: Ellipse;
  public recRect?: Rect;
  public recImage?: FabricImage;
  public recHtmlImage?: HTMLImageElement;
  public recLine?: Line;
  public posX = 0;
  public posY = 0;

  constructor(
    public component: PrintPosItem,
    public sectionEditor: SectionEditorDesign
  ) {}
  public static intersectRects(a: Rect, b: Rect): Rect {
    const aLeft = a.left ?? 0;
    const aTop = a.top ?? 0;
    const aRight = aLeft + (a.width ?? 0);
    const aBottom = aTop + (a.height ?? 0);

    const bLeft = b.left ?? 0;
    const bTop = b.top ?? 0;
    const bRight = bLeft + (b.width ?? 0);
    const bBottom = bTop + (b.height ?? 0);

    const left = Math.max(aLeft, bLeft);
    const top = Math.max(aTop, bTop);
    const right = Math.min(aRight, bRight);
    const bottom = Math.min(aBottom, bBottom);

    let width = right - left;
    let height = bottom - top;

    // If there is no intersection, force an empty rectangle (a clip that draws nothing)
    if (width <= 0 || height <= 0) {
      width = 0;
      height = 0;
    }

    return new Rect({
      left,
      top,
      width,
      height,
      originX: "left",
      originY: "top",
      selectable: false,
      evented: false,
      absolutePositioned: true, // when in global canvas coordinates
    });
  }

  public updateClipPathGroup() {
    const group = this.group;
    const sectionEditor = this.sectionEditor;
    if (!group) {
      return;
    }
    const secW = sectionEditor.width ?? 0;
    const secH = sectionEditor.height ?? 0;
    if (secW <= 0 || secH <= 0) {
      group.set({ clipPath: undefined });
      return;
    }
    // LOCAL clip (NOT absolutePositioned) → it is CACHED, so it does not penalize rendering like the
    // absolute clip (which forced every group to be re-rendered with clipping on each frame, O(N)).
    // Clips the component to the bounds of ITS section: if it goes out of the section, it does not show in the
    // one below. A non-absolute clipPath is positioned relative to the CENTER of the group, so we place
    // the section rect relative to that center. If a component moves together with its section
    // (same delta), this clip is invariant → it does not need to be recalculated in that case.
    const secCenterX = sectionEditor.posX + secW / 2;
    const secCenterY = sectionEditor.posYSection + secH / 2;
    // Center of the group from its ABSOLUTE matrix (the translation of the fabric matrix is the
    // center): using left/top would fail inside an ActiveSelection, where they are relative to the
    // selection and not to the canvas.
    const groupMatrix = group.calcTransformMatrix();
    const grpCenterX = groupMatrix[4];
    const grpCenterY = groupMatrix[5];
    // If the component is entirely INSIDE its section, the clip would cut nothing:
    // we skip it. A clipPath forces fabric to do extra compositing per object on each
    // rasterization of its cache; with ~200 components it dominated the first render of the build.
    const grpW = group.width ?? 0;
    const grpH = group.height ?? 0;
    const EPS = 0.5;
    if (
      grpCenterX - grpW / 2 >= sectionEditor.posX - EPS &&
      grpCenterY - grpH / 2 >= sectionEditor.posYSection - EPS &&
      grpCenterX + grpW / 2 <= sectionEditor.posX + secW + EPS &&
      grpCenterY + grpH / 2 <= sectionEditor.posYSection + secH + EPS
    ) {
      if (group.clipPath) {
        group.set({ clipPath: undefined });
        group.dirty = true;
      }
      this.clipPathGroup = undefined;
      return;
    }
    this.clipPathGroup = new Rect({
      originX: "center",
      originY: "center",
      left: secCenterX - grpCenterX,
      top: secCenterY - grpCenterY,
      width: secW,
      height: secH,
    });
    group.set({ clipPath: this.clipPathGroup });
  }

  public update(propertyName: string, multipleSelection: boolean) {
    const group = this.group!;
    const component = this.component!;
    const reportDesign = this.sectionEditor.reportEditor;
    const scaledPosX = DesignUtils.twipsTopx(component.posX) * reportDesign.zoom;
    const scaledPosY = DesignUtils.twipsTopx(component.posY) * reportDesign.zoom;

    // Add the component rectangle
    const scaledHeight = DesignUtils.twipsTopx(component.height ?? 0) * reportDesign.zoom;
    const scaledWidth = DesignUtils.twipsTopx(component.width ?? 0) * reportDesign.zoom;

    const leftPos = this.sectionEditor.posX + scaledPosX;
    const topPos = this.sectionEditor.posYSection + scaledPosY;
    if (!multipleSelection) {
      group.set({
        left: leftPos,
        top: topPos,
        width: scaledWidth,
        height: scaledHeight,
      });
      group.setCoords();
      const recTitle = this.rect!;
      recTitle.set({
        left: -scaledWidth / 2,
        top: -scaledHeight / 2,
        width: scaledWidth,
        height: scaledHeight,
      });
    }
    switch (component.className) {
      case "TRPSHAPE":
        // If the shape changed it has to be recreated
        if (propertyName == "shape") {
          const drawElement = this.recEllipse ?? this.recLine ?? this.recRect;
          if (drawElement) {
            this.group!.remove(drawElement);
            this.recEllipse = undefined;
            this.recLine = undefined;
            this.recRect = undefined;
          }
          const newDrawElement = this.updateComponentEditorShape(
            component as ShapeItem,
            true,
            false
          )!;
          newDrawElement.left += group.left!;
          newDrawElement.top += group.top!;
          this.group!.add(newDrawElement);
        } else {
          this.updateComponentEditorShape(component as ShapeItem, false, multipleSelection);
          this.group!.dirty = true;
          this.group!.setCoords();
        }
        break;
      case "TRPIMAGE":
        // Real image (streamBase64): the FabricImage has to be recreated. It is also recreated
        // if an orphan FabricImage is left (the image has just been removed and now the
        // expression has to be drawn) or if no drawing element is registered yet.
        if ((component as ImageItem).streamBase64 || this.recImage || !this.rectTitle) {
          const drawElement = this.recImage ?? this.rectTitle;
          if (drawElement) {
            this.group!.remove(drawElement);
            this.recImage = undefined;
            this.rectTitle = undefined;
          }
          const newDrawElement = this.updateComponentEditorImage(component as ImageItem, true);
          newDrawElement.left += group.left!;
          newDrawElement.top += group.top!;
          this.group!.add(newDrawElement);
        } else {
          // Expression image: its drawing is a Textbox like the one of label/expression →
          // a cheap mutation instead of recreating it on every frame during the resize.
          this.updateTextTitle(scaledWidth, scaledHeight, multipleSelection);
        }
        break;
      default:
        this.updateTextTitle(scaledWidth, scaledHeight, multipleSelection);
        break;
    }
    /*const clipPath = new Rect({
          left: sectionEditor.posX - leftPos,
          top: sectionEditor.posYSection - topPos,
          width: sectionEditor.width - leftPos,
          height: sectionEditor.height - topPos,
        });*/
    /*const clipPath = new Rect({
          left: sectionEditor.posX,
          top: sectionEditor.posYSection,
          width: sectionEditor.width,
          height: sectionEditor.height,
          absolutePositioned: true,
          // fill: 'rgba(0,0,255,0.2)',
        });*/
    /*this.clipPath!.set({
      left: this.sectionEditor.posX,
      top: this.sectionEditor.posYSection,
      width: this.sectionEditor.width,
      height: this.sectionEditor.height,
    });*/
    // this.recolocarComponenteSeccion(sectionEditor, cEditor, true);
    this.groupWidth = scaledWidth;
    this.groupHeight = scaledHeight;
    /*if (
          componentEditorDesign.groupWidth != scaledWidth ||
          componentEditorDesign.groupHeight != scaledHeight
        ) {
          const groupObject: FabricObject[] = [];
          groupObject.push(recTitle);
          groupObject.push(textTitle);
          // group recreation
          group.removeAll();
          this.canvas.remove(group);
          group = new Group(groupObject, {
            left: leftPos,
            top: topPos,
            selectable: true,
            hasControls: true,
            lockSkewingX: true,
            lockSkewingY: true,
            lockRotation: true,
            hasBorders: true,
            lockScalingFlip: true,
            clipPath: componentEditorDesign.clipPath,
            centeredScaling: false,
          });
          group.setControlsVisibility({
            mtr: false, // 'mtr' is the name of the rotation control (middle top rotate)
          });
          componentEditorDesign.group = group;
          (group as any).componentEditorDesign = componentEditorDesign;
          componentEditorDesign.groupWidth = scaledWidth;
          componentEditorDesign.groupHeight = scaledHeight;
          this.canvas.add(group);
          group.calcACoords();
          this.canvas.renderAll();
        }*/
    if (!multipleSelection) {
      this.group?.setCoords();
      this.updateClipPathGroup();
    }
  }
  // Mutation of the Textbox of the text components (label, expression, chart,
  // barcode and expression images): it updates properties without recreating the object.
  // It is also invoked when the component is CREATED: creation builds the Textbox with a
  // partial style (without bold/italic/transparent/valign) and relied on the
  // later update() of recolocarSecciones to complete it; that update is no longer launched.
  public updateTextTitle(scaledWidth: number, scaledHeight: number, multipleSelection: boolean) {
    const textTitle = this.rectTitle;
    if (!textTitle) {
      return;
    }
    const component = this.component!;
    const reportDesign = this.sectionEditor.reportEditor;
    const textData = DesignUtils.getTextDataFromComponent(
      component,
      this.sectionEditor.reportEditor.report!
    );
    let fontSize = 10 * reportDesign.zoom;
    if (textData.fontSize) {
      fontSize = textData.fontSize * reportDesign.zoom;
    }
    const textBackColor = textData.transparent ? undefined : textData.backColor;
    textTitle.set({
      fontSize: fontSize,
      splitByGrapheme: true,
      width: scaledWidth,
      text: textData.text,
      fill: textData.fontColor,
      textAlign: textData.align,
      textBackgroundColor: textBackColor,
      fontFamily: textData.fontFamily ? textData.fontFamily : undefined,
      fontWeight: textData.bold ? "bold" : "normal",
      fontStyle: textData.italic ? "italic" : "normal",
      underline: textData.underline ? true : undefined,
      linethrough: textData.strikeout ? true : undefined,
    });
    if (!multipleSelection) {
      const recTitle = this.rect!;
      textTitle.set({ top: -scaledHeight / 2, clipPath: recTitle });
    }
    let topTextPos = -scaledHeight / 2;
    //let realAlign = textData.valign;
    if (scaledHeight < textTitle.height) {
      //  realAlign = "center";
      textTitle.set({ height: scaledHeight });
    } else {
      // textTitle.set({ height: undefined });
    }
    switch (textData.valign) {
      case "center":
        topTextPos = -scaledHeight / 2 + (scaledHeight - textTitle.height) / 2;
        break;
      case "bottom":
        topTextPos = scaledHeight / 2 - textTitle.height;
        break;
    }
    if (!multipleSelection) {
      // The text box lives inside the group, so its origin is the group's centre: when the
      // component is resized the box has to move back to the left edge, or the text keeps the
      // offset of the old width and looks centred or clipped.
      textTitle.set({ top: topTextPos, left: -scaledWidth / 2 });
      this.applyRotation(textTitle, scaledWidth, scaledHeight, topTextPos);
    }
  }

  /**
   * The rotation of a text (fontRotation) or a barcode (rotation), both in tenths of a degree,
   * counterclockwise, as the engine prints them: the whole rectangle of the item turns around its
   * top left corner (PDF and GDI), a QR code around its centre. The box is still what moves and
   * resizes; the text is drawn where it will print, even outside it, with a dashed outline of the
   * turned rectangle.
   */
  private applyRotation(textTitle: Textbox, width: number, height: number, textTop: number) {
    const component = this.component as PrintItemText | BarcodeItem;
    let degrees = 0;
    let aroundCentre = false;
    switch (component.className) {
      case "TRPLABEL":
      case "TRPEXPRESSION":
        degrees = ((component as PrintItemText).fontRotation ?? 0) / 10;
        break;
      case "TRPBARCODE":
        degrees = ((component as BarcodeItem).rotation ?? 0) / 10;
        aroundCentre = (component as BarcodeItem).barType === BarcodeType.CodeQR;
        break;
    }
    const outline = this.rectRotation;
    const group = this.group;
    const left = -width / 2;
    const top = -height / 2;
    if (!degrees) {
      if (textTitle.angle) textTitle.set({ angle: 0, left });
      if (outline?.visible) outline.set({ visible: false });
      if (group && !group.objectCaching) {
        group.set({ objectCaching: true });
        group.dirty = true;
      }
      return;
    }
    // Fabric turns clockwise and Reportman counterclockwise
    const angle = -degrees;
    const radians = (angle * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    // The pivot, in the group's coordinates (its centre is 0, 0)
    const pivotX = aroundCentre ? 0 : left;
    const pivotY = aroundCentre ? 0 : top;
    const turn = (x: number, y: number) => ({
      x: pivotX + (x - pivotX) * cos - (y - pivotY) * sin,
      y: pivotY + (x - pivotX) * sin + (y - pivotY) * cos,
    });
    // The clip of the text is the item's rectangle, in the text's own coordinates (centred), so it
    // turns with it
    this.clipRotation ??= new Rect({ originX: "center", originY: "center" });
    this.clipRotation.set({ left: 0, top: -textTop - textTitle.height / 2, width, height });
    const textCorner = turn(left, textTop);
    textTitle.set({ angle, left: textCorner.x, top: textCorner.y, clipPath: this.clipRotation });
    const outlineCorner = turn(left, top);
    outline?.set({ visible: true, angle, left: outlineCorner.x, top: outlineCorner.y, width, height });
    // The group's cache measures its box: it would cut the text that goes out of it
    if (group) {
      group.set({ objectCaching: false });
      group.dirty = true;
    }
  }
  private createPatternFromBrushType(brushType: BrushType, color: string): Pattern | string | null {
    if (brushType === BrushType.Clear) {
      return null; // No fill
    }

    // Define canvas size and spacing based on density
    const canvasSize = 10;
    const patternCanvas = document.createElement("canvas");
    patternCanvas.width = canvasSize;
    patternCanvas.height = canvasSize;
    const ctx = patternCanvas.getContext("2d")!;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;

    const drawLine = (x1: number, y1: number, x2: number, y2: number) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };

    switch (brushType) {
      case BrushType.Horizontal:
        drawLine(0, canvasSize / 2, canvasSize, canvasSize / 2);
        break;
      case BrushType.Vertical:
        drawLine(canvasSize / 2, 0, canvasSize / 2, canvasSize);
        break;
      case BrushType.ADiagonal: // \
        drawLine(0, canvasSize, canvasSize, 0);
        break;
      case BrushType.BDiagonal: // /
        drawLine(0, 0, canvasSize, canvasSize);
        break;
      case BrushType.ACross: // +
        drawLine(0, canvasSize / 2, canvasSize, canvasSize / 2);
        drawLine(canvasSize / 2, 0, canvasSize / 2, canvasSize);
        break;
      case BrushType.BCross: // X
        drawLine(0, 0, canvasSize, canvasSize);
        drawLine(0, canvasSize, canvasSize, 0);
        break;
      case BrushType.Dense1:
      case BrushType.Dense2:
      case BrushType.Dense3:
      case BrushType.Dense4:
      case BrushType.Dense5:
      case BrushType.Dense6:
      case BrushType.Dense7:
        {
          const density = (brushType - BrushType.Dense1 + 1) * 10; // 10% to 70%
          const spacing = 100 / density;
          for (let x = 0; x < canvasSize; x += spacing) {
            for (let y = 0; y < canvasSize; y += spacing) {
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }
        break;
      default:
        return color; // Solid fill if unknown
    }

    return new Pattern({
      source: patternCanvas,
      repeat: "repeat",
    });
  }
  public updateComponentEditorShape(
    compoShape: ShapeItem,
    create: boolean,
    multipleSelection: boolean
  ): FabricObject | undefined {
    if (multipleSelection && create) {
      return undefined;
    }
    const reportDesign = this.sectionEditor.reportEditor!;
    const scaledHeight = DesignUtils.twipsTopx(compoShape.height ?? 0) * reportDesign.zoom;
    const scaledWidth = DesignUtils.twipsTopx(compoShape.width ?? 0) * reportDesign.zoom;
    let strokeWidth = DesignUtils.twipsTopx(compoShape.penWidth) * reportDesign.zoom;
    if (strokeWidth < 1) {
      strokeWidth = 1;
    }
    const sLeft = 0;
    const sTop = 0;
    const sWidth = scaledWidth;
    const sHeight = scaledHeight;
    let realLeft = sLeft + strokeWidth / 2;
    let realTop = sTop + strokeWidth / 2;
    if (!create) {
      realLeft = -scaledWidth / 2;
      realTop = -scaledHeight / 2;
    }
    let realWidth = scaledWidth - strokeWidth;
    let realHeight = scaledHeight - strokeWidth;
    let strokeColor: string | null = DesignUtils.numberToHexColor(compoShape.penColor);
    let fillColor: string | Pattern | null = DesignUtils.numberToHexColor(compoShape.brushColor);

    const dashLengh = strokeWidth * 5;
    let spaceLength = strokeWidth;
    const dotLength = strokeWidth;
    if (spaceLength < 1) {
      spaceLength = 1;
    }

    let strokeDash: number[] | undefined = undefined;
    switch (compoShape.penStyle) {
      case PenType.Clear:
        strokeColor = null;
        break;
      case PenType.Dash:
        strokeDash = [dashLengh, spaceLength];
        break;
      case PenType.DashDot:
        strokeDash = [dashLengh, spaceLength, dotLength, spaceLength];
        break;
      case PenType.DashDotDot:
        strokeDash = [dashLengh, spaceLength, dotLength, spaceLength, dotLength, spaceLength];
        break;
      case PenType.Dot:
        strokeDash = [dotLength, dotLength];
        break;
    }
    switch (compoShape.brushStyle) {
      case BrushType.Clear:
        fillColor = null;
        break;
      case BrushType.Solid:
        break;
      default:
        fillColor = this.createPatternFromBrushType(compoShape.brushStyle, fillColor);
        break;
    }

    switch (compoShape.shape) {
      case ShapeType.Circle:
      case ShapeType.Square:
      case ShapeType.RoundSquare:
        if (sHeight > sWidth) {
          realHeight = realWidth;
          realTop += realHeight / 2;
          if (create) {
            realTop = scaledHeight / 2 - realHeight / 2 - strokeWidth / 2;
          } else {
            realTop = -realHeight / 2 - strokeWidth / 2;
          }
        } else {
          realWidth = realHeight;
          if (create) {
            realLeft = scaledWidth / 2 - realWidth / 2 - -strokeWidth / 2;
          } else {
            realLeft = -realWidth / 2 - strokeWidth / 2;
          }
        }
        break;
      case ShapeType.HorzLine:
        realHeight = 0;
        break;
      case ShapeType.VertLine:
        realWidth = 0;
        break;
      case ShapeType.Oblique2:
        realHeight = -sHeight;
        realTop = realTop + sHeight;
        break;
    }

    let drawElement: FabricObject | undefined = undefined;
    switch (compoShape.shape) {
      case ShapeType.Circle:
      case ShapeType.Ellipse:
        if (create) {
          drawElement = new Ellipse({
            left: realLeft,
            top: realTop,
            rx: realWidth / 2,
            ry: realHeight / 2,
            strokeDashArray: strokeDash,
            stroke: strokeColor,
            fill: fillColor,
            strokeWidth: strokeWidth,
            originX: "left",
            originY: "top",
          });
          this.recEllipse = drawElement as Ellipse;
        } else {
          drawElement = this.recEllipse! as Ellipse;
          drawElement.set({
            left: realLeft,
            top: realTop,
            rx: realWidth / 2,
            ry: realHeight / 2,
            strokeDashArray: strokeDash,
            stroke: strokeColor,
            fill: fillColor,
            strokeWidth: strokeWidth,
          });
        }
        break;
      case ShapeType.Rectangle:
      case ShapeType.Square:
        if (create) {
          drawElement = new Rect({
            left: realLeft,
            top: realTop,
            width: realWidth,
            height: realHeight,
            strokeDashArray: strokeDash,
            stroke: strokeColor,
            fill: fillColor,
            strokeWidth: strokeWidth,
            originX: "left",
            originY: "top",
          });
          this.recRect = drawElement as Rect;
        } else {
          drawElement = this.recRect!;
          drawElement.set({
            left: realLeft,
            top: realTop,
            width: realWidth,
            height: realHeight,
            strokeDashArray: strokeDash,
            stroke: strokeColor,
            fill: fillColor,
            strokeWidth: strokeWidth,
          });
        }
        break;
      case ShapeType.RoundSquare:
      case ShapeType.RoundRect:
        if (create) {
          drawElement = new Rect({
            left: realLeft,
            top: realTop,
            width: realWidth,
            height: realHeight,
            rx: 5 * reportDesign.zoom,
            ry: 5 * reportDesign.zoom,
            strokeDashArray: strokeDash,
            stroke: strokeColor,
            fill: fillColor,
            strokeWidth: strokeWidth,
            originX: "left",
            originY: "top",
          });
          this.recRect = drawElement as Rect;
        } else {
          drawElement = this.recRect!;
          drawElement.set({
            left: realLeft,
            top: realTop,
            width: realWidth,
            height: realHeight,
            rx: 5 * reportDesign.zoom,
            ry: 5 * reportDesign.zoom,
            strokeDashArray: strokeDash,
            stroke: strokeColor,
            fill: fillColor,
            strokeWidth: strokeWidth,
          });
        }
        break;
      case ShapeType.HorzLine:
      case ShapeType.VertLine:
      case ShapeType.Oblique1:
      case ShapeType.Oblique2:
        if (create) {
          drawElement = new Line([realLeft, realTop, realLeft + realWidth, realTop + realHeight], {
            strokeLineCap: "square",
            stroke: strokeColor,
            fill: fillColor,
            strokeWidth: strokeWidth,
            strokeDashArray: strokeDash,
            originX: "left",
            originY: "top",
          });
          this.recLine = drawElement as Line;
        } else {
          drawElement = this.recLine!;
          drawElement.set({
            x1: realLeft,
            y1: realTop,
            x2: realLeft + realWidth,
            y2: realTop + realHeight,
            stroke: strokeColor,
            fill: fillColor,
            strokeWidth: strokeWidth,
            strokeDashArray: strokeDash,
          });
        }
        break;
      default:
        throw new Error("Shape tipo unknown");
    }
    if (!drawElement) {
      throw new Error("Shape type not assigned");
    }
    return drawElement;
  }
  public updateComponentEditorImage(compoImage: ImageItem, create: boolean): FabricObject {
    const reportDesign = this.sectionEditor.reportEditor!;
    const scaledHeight = DesignUtils.twipsTopx(compoImage.height ?? 0) * reportDesign.zoom;
    const scaledWidth = DesignUtils.twipsTopx(compoImage.width ?? 0) * reportDesign.zoom;
    let realLeft = 0;
    let realTop = 0;
    if (!create) {
      realLeft = -scaledWidth / 2;
      realTop = -scaledHeight / 2;
    }
    const realWidth = scaledWidth;
    const realHeight = scaledHeight;
    let drawElement: FabricObject | undefined = undefined;
    if (compoImage.streamBase64) {
      if (create) {
        const htmlImage = new Image();
        const dataUrl = "data:image/png;base64," + compoImage.streamBase64;
        htmlImage.src = dataUrl;
        // So that fabric does not cut the image
        const image = new FabricImage(htmlImage, {
          left: realLeft,
          top: realTop,
          width: realWidth * 1000,
          height: realHeight * 1000,
          objectCaching: false,
          scaleX: 0.001,
          scaleY: 0.001,
          originX: "left",
          originY: "top",
        });
        htmlImage.onload = () => {
          let scaleX = 1;
          let scaleY = 1;
          let xoffset = 0;
          let yoffset = 0;
          let imageWidth = realWidth;
          let imageHeight = realHeight;
          // const dpi = (compoImage.dpires ?? 100) * reportDesign.zoom;
          switch (compoImage.drawStyle) {
            case ImageDrawStyleType.Stretch:
              scaleX = realWidth / htmlImage.naturalWidth!;
              scaleY = realHeight / htmlImage.naturalHeight!;
              imageWidth = realWidth / scaleX;
              imageHeight = realHeight / scaleY;
              break;
            case ImageDrawStyleType.Center:
            case ImageDrawStyleType.Tile:
            case ImageDrawStyleType.Tiledpi:
            case ImageDrawStyleType.Full:
              {
                const scaleXPrev = realWidth / htmlImage.naturalWidth!;
                const scaleYPrev = realHeight / htmlImage.naturalHeight!;
                const scale = Math.min(scaleXPrev, scaleYPrev);
                scaleY = scale;
                scaleX = scale;
                imageWidth = realWidth / scaleX;
                imageHeight = realHeight / scaleY;
                if (scaleXPrev > scaleYPrev) {
                  xoffset = (realWidth - htmlImage.naturalWidth * scaleX) / 2;
                } else {
                  yoffset = (realHeight - htmlImage.naturalHeight * scaleY) / 2;
                }
              }
              break;
            // Height and Width based on image dimensions and dpi
            /*case ImageDrawStyleType.Tile:
            case ImageDrawStyleType.Tiledpi:
            case ImageDrawStyleType.Full:
              imageWidth = (htmlImage.naturalWidth! / dpi) * 96;
              imageHeight = (htmlImage.naturalHeight! / dpi) * 96;
              scaleX = 1;
              scaleY = 1;
              break;*/
          }
          const newLeft = (imageWidth / 2) * scaleX;
          const newTop = (imageHeight / 2) * scaleY;
          // this.sectionEditor.reportEditor.canvas?.add(clipPath);

          image.set({
            scaleX: scaleX,
            scaleY: scaleY,
            left: -newLeft + xoffset,
            top: -newTop + yoffset,
            width: imageWidth,
            realHeight: imageHeight,
          });
          this.sectionEditor.reportEditor.canvas?.requestRenderAll();
        };
        this.recImage = image;
        this.recHtmlImage = htmlImage;
        drawElement = image;
      } else {
        drawElement = this.recImage!;
      }
    } else {
      if (create) {
        const textData = DesignUtils.getTextDataFromComponent(
          compoImage,
          this.sectionEditor.reportEditor.report!
        );
        let fontSize = 10 * reportDesign.zoom;
        if (textData.fontSize) {
          fontSize = textData.fontSize * reportDesign.zoom;
        }
        const textBackColor = textData.transparent ? undefined : textData.backColor;
        const textTitle = create
          ? new Textbox(textData.text ?? "", { originX: "left", originY: "top" })
          : this.rectTitle!;
        const recTitle = this.rect!;
        textTitle.set({
          top: realTop,
          splitByGrapheme: true,
          fontSize: fontSize,
          width: scaledWidth,
          clipPath: recTitle,
          text: textData.text,
          fill: textData.fontColor,
          textAlign: textData.align,
          textBackgroundColor: textBackColor,
          fontFamily: textData.fontFamily ? textData.fontFamily : undefined,
          fontWeight: textData.bold ? "bold" : "normal",
          fontStyle: textData.italic ? "italic" : "normal",
          underline: textData.underline ? true : undefined,
          linethrough: textData.strikeout ? true : undefined,
        });
        /*let topTextPos = -scaledHeight / 2;
        switch (textData.valign) {
          case 'center':
            topTextPos =
              -scaledHeight / 2 + (scaledHeight - textTitle.height) / 2;
            break;
          case 'bottom':
            topTextPos = scaledHeight / 2 - textTitle.height;
            break;w w
        }
        textTitle.set({ top: topTextPos });*/
        // Register the Textbox: without this, update() does not find the previous element
        // (recImage ?? rectTitle == undefined), never removes it from the group and each
        // call (one per frame during the resize) ADDS one more Textbox.
        this.rectTitle = textTitle;
        drawElement = textTitle;
      } else {
        drawElement = this.rectTitle;
      }
    }
    if (!drawElement) {
      throw Error("No draw element in Image");
    }
    return drawElement;
  }
}

export enum UpdateObjectOperation {
  Create,
  Update,
  Recreate,
}

export enum CoordType {
  X,
  Y,
}
