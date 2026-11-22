// The part of a Canvas 2D context the preview draws with. The drawing code only sees this
// interface, so it runs in Node too: the tests give it a recording fake, a browser gives it a
// CanvasRenderingContext2D or an OffscreenCanvasRenderingContext2D (checked at the end of this
// file, where the DOM types are known).

/** An image the context draws (an ImageBitmap in a browser); opaque to the preview. */
export type CanvasImage = object;

/**
 * What the preview needs of a Canvas 2D context. A CanvasRenderingContext2D (or an
 * OffscreenCanvasRenderingContext2D) is one; the preview never reads back what it drew.
 */
export interface CanvasContext {
  save(): void;
  restore(): void;
  scale(x: number, y: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  closePath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  /** Fills the current path, nonzero winding as PDF f and B. */
  fill(): void;
  stroke(): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  setLineDash(segments: number[]): void;
  fillText(text: string, x: number, y: number): void;
  drawImage(image: CanvasImage, dx: number, dy: number, dw: number, dh: number): void;
  /** Written as a CSS color string. */
  fillStyle: unknown;
  /** Written as a CSS color string. */
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  miterLimit: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  /** PDF text is not kerned: 'none' where the browser has it. */
  fontKerning?: string;
  imageSmoothingEnabled?: boolean;
}

// The browser contexts are CanvasContexts: a compile time check, not exported, so the declarations
// of the package do not need the DOM types
type Assert<T extends CanvasContext> = T;
type BrowserContexts = [Assert<CanvasRenderingContext2D>, Assert<OffscreenCanvasRenderingContext2D>];
