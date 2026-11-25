import { AfterContentInit, Component, ContentChildren, Directive, ElementRef, Input, OnDestroy, QueryList, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * `<div split-area [size] [minSize] [maxSize] cacheSubId>`: one pane of a `<split>`. `size` is
 * the pane's share (the original host application used angular-split percentages), `minSize`/`maxSize` pixels.
 */
@Directive({ selector: '[split-area]', host: { class: 'rp-split-area' } })
export class SplitAreaDirective {
  @Input() size?: number;
  @Input() minSize?: number;
  @Input() maxSize?: number;
  @Input() cacheSubId?: string;
  readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
}

/**
 * `<split [sizeDivisor] cacheId>`: panes side by side with draggable gutters, the angular-split
 * surface the designer's template was written for. Panes come and go (`@if`), so the gutters are
 * rebuilt whenever the content changes; widths are remembered per browser under `cacheId`.
 */
@Component({
  selector: 'split',
  imports: [CommonModule],
  template: `<ng-content></ng-content>`,
  styles: [`
    :host { display: flex; flex-direction: row; min-height: 0; min-width: 0; overflow: hidden; }
    :host ::ng-deep > .rp-split-area { min-width: 0; min-height: 0; overflow: auto; }
    :host ::ng-deep > .rp-split-gutter { flex: 0 0 6px; cursor: col-resize; background: #e0e0e0; user-select: none; }
    :host ::ng-deep > .rp-split-gutter:hover, :host ::ng-deep > .rp-split-gutter.dragging { background: #0078D4; }
  `],
})
export class SplitComponent implements AfterContentInit, OnDestroy {
  @Input() sizeDivisor = 4;
  @Input() cacheId?: string;
  @ContentChildren(SplitAreaDirective) areas!: QueryList<SplitAreaDirective>;
  private host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private gutters: HTMLElement[] = [];
  private sub?: { unsubscribe(): void };

  ngAfterContentInit(): void {
    this.layout();
    this.sub = this.areas.changes.subscribe(() => setTimeout(() => this.layout()));
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.gutters.forEach((g) => g.remove());
  }

  private layout(): void {
    this.gutters.forEach((g) => g.remove());
    this.gutters = [];
    const areas = this.areas.toArray();
    areas.forEach((area, i) => {
      const el = area.element;
      const stored = this.readSize(area);
      const share = stored ?? area.size ?? 100 / Math.max(1, areas.length);
      el.style.flex = `${share} 1 0px`;
      if (area.minSize) el.style.minWidth = area.minSize + 'px';
      if (area.maxSize) el.style.maxWidth = area.maxSize + 'px';
      if (i < areas.length - 1) {
        const gutter = document.createElement('div');
        gutter.className = 'rp-split-gutter';
        el.insertAdjacentElement('afterend', gutter);
        this.gutters.push(gutter);
        this.wireGutter(gutter, area, areas[i + 1]);
      }
    });
  }

  private wireGutter(gutter: HTMLElement, left: SplitAreaDirective, right: SplitAreaDirective): void {
    gutter.addEventListener('pointerdown', (down) => {
      down.preventDefault();
      gutter.setPointerCapture(down.pointerId);
      gutter.classList.add('dragging');
      const startX = down.clientX;
      const leftStart = left.element.getBoundingClientRect().width;
      const rightStart = right.element.getBoundingClientRect().width;
      const total = leftStart + rightStart;
      const move = (ev: PointerEvent) => {
        let newLeft = leftStart + (ev.clientX - startX);
        newLeft = Math.max(left.minSize ?? 40, Math.min(newLeft, total - (right.minSize ?? 40)));
        if (left.maxSize) newLeft = Math.min(newLeft, left.maxSize);
        const newRight = total - newLeft;
        if (right.maxSize && newRight > right.maxSize) return;
        left.element.style.flex = `${newLeft} 1 0px`;
        right.element.style.flex = `${newRight} 1 0px`;
      };
      const up = () => {
        gutter.removeEventListener('pointermove', move);
        gutter.removeEventListener('pointerup', up);
        gutter.classList.remove('dragging');
        this.persist();
      };
      gutter.addEventListener('pointermove', move);
      gutter.addEventListener('pointerup', up);
    });
  }

  private key(area: SplitAreaDirective): string | null {
    return this.cacheId && area.cacheSubId ? `rpsplit_${this.cacheId}_${area.cacheSubId}` : null;
  }

  private readSize(area: SplitAreaDirective): number | null {
    const key = this.key(area);
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      const value = raw === null ? NaN : parseFloat(raw);
      return isNaN(value) ? null : value;
    } catch {
      return null;
    }
  }

  private persist(): void {
    const widths = this.areas.map((a) => a.element.getBoundingClientRect().width);
    const total = widths.reduce((s, w) => s + w, 0) || 1;
    this.areas.forEach((area, i) => {
      const key = this.key(area);
      if (!key) return;
      try { localStorage.setItem(key, String((widths[i] / total) * 100)); } catch { /* ignore */ }
    });
  }
}
