// A recording Canvas 2D context for the tests: it keeps the transform and the state the way a
// browser does (save, restore, scale, translate, rotate), and records each drawing call with its
// points on the device and the state it was drawn with.

import type { CanvasContext, CanvasImage } from '@reportman/canvas';

export interface Call {
  op: string;
  /** The points of the call on the device (for paths, texts, rectangles and images). */
  points: [number, number][];
  text?: string;
  image?: CanvasImage;
  /** A width and a height on the device (rect, fillRect, drawImage), when the transform has no rotation. */
  size?: [number, number];
  /** imageSmoothingEnabled when an image was drawn. */
  smoothing?: boolean;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  dash: number[];
  font: string;
}

type Matrix = [number, number, number, number, number, number];

interface State {
  m: Matrix;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  dash: number[];
  font: string;
  lineCap: string;
  lineJoin: string;
  miterLimit: number;
  textAlign: string;
  textBaseline: string;
}

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export class FakeContext implements CanvasContext {
  readonly calls: Call[] = [];
  private s: State = {
    m: [1, 0, 0, 1, 0, 0],
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    dash: [],
    font: '10px sans-serif',
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    textAlign: 'start',
    textBaseline: 'alphabetic',
  };
  private stack: State[] = [];
  fontKerning = 'auto';
  imageSmoothingEnabled = true;

  get depth(): number {
    return this.stack.length;
  }
  get fillStyle(): unknown {
    return this.s.fillStyle;
  }
  set fillStyle(v: unknown) {
    this.s.fillStyle = v;
  }
  get strokeStyle(): unknown {
    return this.s.strokeStyle;
  }
  set strokeStyle(v: unknown) {
    this.s.strokeStyle = v;
  }
  get lineWidth(): number {
    return this.s.lineWidth;
  }
  set lineWidth(v: number) {
    this.s.lineWidth = v;
  }
  get font(): string {
    return this.s.font;
  }
  set font(v: string) {
    this.s.font = v;
  }
  get lineCap(): string {
    return this.s.lineCap;
  }
  set lineCap(v: string) {
    this.s.lineCap = v;
  }
  get lineJoin(): string {
    return this.s.lineJoin;
  }
  set lineJoin(v: string) {
    this.s.lineJoin = v;
  }
  get miterLimit(): number {
    return this.s.miterLimit;
  }
  set miterLimit(v: number) {
    this.s.miterLimit = v;
  }
  get textAlign(): string {
    return this.s.textAlign;
  }
  set textAlign(v: string) {
    this.s.textAlign = v;
  }
  get textBaseline(): string {
    return this.s.textBaseline;
  }
  set textBaseline(v: string) {
    this.s.textBaseline = v;
  }

  /** A point of the user space on the device. */
  map(x: number, y: number): [number, number] {
    const m = this.s.m;
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  private record(op: string, points: [number, number][], extra: Partial<Call> = {}): void {
    this.calls.push({
      op,
      points,
      fillStyle: this.s.fillStyle,
      strokeStyle: this.s.strokeStyle,
      lineWidth: this.s.lineWidth,
      dash: [...this.s.dash],
      font: this.s.font,
      ...extra,
    });
  }

  private sizeOf(w: number, h: number): [number, number] | undefined {
    const m = this.s.m;
    if (m[1] !== 0 || m[2] !== 0) return undefined;
    return [w * m[0], h * m[3]];
  }

  save(): void {
    this.stack.push({ ...this.s, dash: [...this.s.dash] });
    this.record('save', []);
  }
  restore(): void {
    const s = this.stack.pop();
    if (s === undefined) throw new Error('restore without save');
    this.s = s;
    this.record('restore', []);
  }
  scale(x: number, y: number): void {
    this.s.m = multiply(this.s.m, [x, 0, 0, y, 0, 0]);
  }
  translate(x: number, y: number): void {
    this.s.m = multiply(this.s.m, [1, 0, 0, 1, x, y]);
  }
  rotate(angle: number): void {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    this.s.m = multiply(this.s.m, [c, s, -s, c, 0, 0]);
  }
  beginPath(): void {
    this.record('beginPath', []);
  }
  moveTo(x: number, y: number): void {
    this.record('moveTo', [this.map(x, y)]);
  }
  lineTo(x: number, y: number): void {
    this.record('lineTo', [this.map(x, y)]);
  }
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void {
    this.record('bezierCurveTo', [this.map(a, b), this.map(c, d), this.map(x, y)]);
  }
  quadraticCurveTo(a: number, b: number, x: number, y: number): void {
    this.record('quadraticCurveTo', [this.map(a, b), this.map(x, y)]);
  }
  closePath(): void {
    this.record('closePath', []);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.record('rect', [this.map(x, y)], { size: this.sizeOf(w, h) });
  }
  fill(): void {
    this.record('fill', []);
  }
  stroke(): void {
    this.record('stroke', []);
  }
  clip(): void {
    this.record('clip', []);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.record('fillRect', [this.map(x, y)], { size: this.sizeOf(w, h) });
  }
  setLineDash(segments: number[]): void {
    this.s.dash = [...segments];
  }
  fillText(text: string, x: number, y: number): void {
    this.record('fillText', [this.map(x, y)], { text });
  }
  drawImage(image: CanvasImage, dx: number, dy: number, dw: number, dh: number): void {
    this.record('drawImage', [this.map(dx, dy)], { image, size: this.sizeOf(dw, dh), smoothing: this.imageSmoothingEnabled });
  }

  /** The calls of an operation. */
  ops(op: string): Call[] {
    return this.calls.filter((c) => c.op === op);
  }
}
