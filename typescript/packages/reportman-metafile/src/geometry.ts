// System.Drawing.Point and Rectangle, as plain values (twips unless stated otherwise).

/** A point or an extent (System.Drawing.Point). */
export interface Point {
  x: number;
  y: number;
}

/** A rectangle (System.Drawing.Rectangle): position and size. */
export interface Rectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A new point. */
export function point(x: number, y: number): Point {
  return { x, y };
}

/** A new rectangle. */
export function rectangle(left: number, top: number, width: number, height: number): Rectangle {
  return { left, top, width, height };
}
