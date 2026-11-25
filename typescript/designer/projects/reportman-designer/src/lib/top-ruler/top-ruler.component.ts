import {
  Component,
  ElementRef,
  Input,
  ViewChild,
  AfterViewInit,
  ViewEncapsulation,
  OnChanges,
  SimpleChanges,
  OnDestroy,
} from "@angular/core";
import { Subscription } from "rxjs";
import { PresentacionService } from "../shell/presentacion.service";

@Component({
  selector: "top-ruler",
  standalone: true,
  encapsulation: ViewEncapsulation.ShadowDom,
  templateUrl: "./top-ruler.component.html",
  styleUrl: "./top-ruler.component.css",
})
export class TopRulerComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() public unit: "cm" | "inch" = "cm";
  @Input() public zoom = 1;

  @ViewChild("rulerCanvas", { static: true })
  protected canvasRef!: ElementRef<HTMLCanvasElement>;

  private topRulerHeight = 0; // px
  protected readonly dpi = 96;
  private resizeObserver?: ResizeObserver;
  private subNavZoom?: Subscription;

  constructor(private pres: PresentacionService) {}

  public ngAfterViewInit(): void {
    this.subNavZoom = this.pres.ratio$.subscribe((ratio) => {
      this.updateCanvasSizeAndRedraw();
    });
    this.observeResize();
    this.updateCanvasSizeAndRedraw();
  }

  public ngOnChanges(changes: SimpleChanges): void {
    if (changes["zoom"] || changes["unit"]) {
      this.updateCanvasSizeAndRedraw();
    }
  }

  public ngOnDestroy(): void {
    this.subNavZoom?.unsubscribe();
    this.resizeObserver?.disconnect();
  }

  private observeResize(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.updateCanvasSizeAndRedraw();
    });
    this.resizeObserver.observe(this.canvasRef.nativeElement);
  }

  private updateCanvasSizeAndRedraw(): void {
    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.imageSmoothingQuality = "low";

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    this.topRulerHeight = rect.height;

    this.drawTopRuler(canvas, ctx);
  }

  private drawTopRuler(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
    const divideUnit = (this.unit === "cm" ? this.dpi / 2.54 : this.dpi) * this.zoom;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, this.topRulerHeight);

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.font = `${Math.floor(this.topRulerHeight * 0.6)}px Arial`;
    ctx.fillStyle = "#000000";

    const totalUnits = Math.floor((canvas.width / divideUnit) * 10);

    for (let i = 0; i <= totalUnits; i++) {
      const x = i * (divideUnit / 10);
      const isWhole = i % 10 === 0;
      const isHalf = i % 5 === 0;

      const lineHeight = isWhole
        ? this.topRulerHeight * 0.5
        : isHalf
          ? this.topRulerHeight * 0.35
          : this.topRulerHeight * 0.2;

      ctx.beginPath();
      ctx.moveTo(x, this.topRulerHeight);
      ctx.lineTo(x, this.topRulerHeight - lineHeight);
      ctx.stroke();

      if (isWhole && i > 0) {
        const label = (i / 10).toString();
        ctx.fillText(label, x + 2, this.topRulerHeight - this.topRulerHeight * 0.6);
      }
    }
  }
}
