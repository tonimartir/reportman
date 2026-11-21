import { PrintPosItem } from "./print-pos-item.js";

/** C# ShapeItem: the defaults are the ones of its constructor. */
export class ShapeItem extends PrintPosItem {
  public shape = ShapeType.Rectangle;
  public brushStyle = BrushType.Solid;
  public brushColor = 0xffffff;
  public penStyle = PenType.Solid;
  public penColor = 0x000000;
  public penWidth = 0;
  constructor() {
    super();
    this.className = "TRPSHAPE";
    this.width = 500;
    this.height = 500;
  }
}
/// <summary>
/// Available shape types
/// </summary>
export enum ShapeType {
  /// <summary>Rectangle</summary>
  Rectangle,
  /// <summary>Square, if the bounding box is a rectangle the smaller distance will be used to draw the rectangle</summary>
  Square,
  /// <summary>Rectangle with rounded corners</summary>
  RoundRect,
  /// <summary>Like square but with rounded corners</summary>
  RoundSquare,
  /// <summary>An ellipse will be drawn filling the bounding box</summary>
  Ellipse,
  /// <summary>A circle will be drawn filling the bounding box, smaller distance will be used when the bounding box is a rectangle</summary>
  Circle,
  /// <summary>Horizontal line</summary>
  HorzLine,
  /// <summary>Vertical line</summary>
  VertLine,
  /// <summary>Oblique line</summary>
  Oblique1,
  /// <summary>Oblique reversed line</summary>
  Oblique2,
}

/// <summary>
/// Brush types, when drawing shapes, the filling area can be stablished to a specified pattern
/// </summary>
export enum BrushType {
  /// <summary>Solid, default pattern. HatchStyle.SolidDiamond</summary>
  Solid,
  /// <summary>No pattern is used, that is like a transparent color</summary>
  Clear,
  /// <summary>Pattern of horizontal lines. HatchStyle.Horizontal</summary>
  Horizontal,
  /// <summary>Pattern of vertical lines. HatchStyle.Vertical</summary>
  Vertical,
  /// <summary>Pattern of diagonal lines. HatchStyle.LightUpwardDiagonal</summary>
  ADiagonal,
  /// <summary>Pattern of reverse diagonal lines. HatchStyle.LightDownwardDiagonal</summary>
  BDiagonal,
  /// <summary>Pattern of crossed lines. HatchStyle.Cross</summary>
  ACross,
  /// <summary>Pattern of diagonal crossed lines. HatchStyle.DiagonalCross</summary>
  BCross,
  /// <summary>Pattern of dense points type 1. HatchStyle.Percent10</summary>
  Dense1,
  /// <summary>Pattern of dense points type 2. HatchStyle.Percent20</summary>
  Dense2,
  /// <summary>Pattern of dense points type 3. HatchStyle.Percent30</summary>
  Dense3,
  /// <summary>Pattern of dense points type 4. HatchStyle.Percent40</summary>
  Dense4,
  /// <summary>Pattern of dense points type 5. HatchStyle.Percent50</summary>
  Dense5,
  /// <summary>Pattern of dense points type 6. HatchStyle.Percent60</summary>
  Dense6,
  /// <summary>Pattern of dense points type 7. HatchStyle.Percent70</summary>
  Dense7,
}
/// <summary>
/// Pen types, used when drawing shapes
/// </summary>
export enum PenType {
  /// <summary>Solid normal pen</summary>
  Solid,
  /// <summary>Dashed pen</summary>
  Dash,
  /// <summary>Doted pen</summary>
  Dot,
  /// <summary>Dash Dot pen</summary>
  DashDot,
  /// <summary>Dash Dot Dot pen</summary>
  DashDotDot,
  /// <summary>Transparent pen</summary>
  Clear,
}
