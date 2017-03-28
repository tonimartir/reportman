export class Metafile {

}
export enum AutoScaleType {
    Wide = 0, Real = 1, EntirePage = 2, Custom = 3, Height = 4
};
export enum BrushType {
    Solid = 0, Clear = 1, Horizontal = 2, Vertical = 3,
    ADiagonal = 4, BDiagonal = 5, ACross = 6, BCross = 7,
    Dense1 = 8, Dense2 = 9, Dense3 = 10, Dense4 = 11,
    Dense5 = 12, Dense6 = 13, Dense7 = 14
};
export enum PenType {
    Solid = 0, Dash = 1, Dot = 2, DashDot = 3, DashDotDot = 4, Clear = 5
};
export enum ImageDrawStyleType {
    Crop = 0, Stretch = 1, Full = 2, Tile = 3, Tiledpi = 4
};
export enum ShapeType {
    Rectangle = 0, Square = 1, RoundRect = 2, RoundSquare = 3,
    Ellipse = 4, Circle = 5, HorzLine = 6, VertLine = 7,
    Oblique1 = 8, Oblique2 = 9
};
export enum PrintStepType {
    BySize = 0, cpi20 = 1, cpi17 = 2, cpi15 = 3, cpi12 = 4,
    cpi10 = 5, cpi6 = 6, cpi5 = 7
};
export enum PdfFontType {
    Helvetica = 0, Courier = 1, TimesRoman = 2, Symbol = 3,
    ZafDingbats = 4, Linked = 5, Embedded = 6
};