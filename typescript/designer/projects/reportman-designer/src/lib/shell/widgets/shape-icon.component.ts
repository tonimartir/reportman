import { Component, Input } from '@angular/core';
import { ShapeType } from '@reportman/lib';

/**
 * `<rp-shape-icon [shape]>`: the drawing of a shape of the report, for the menu of the Shape tool.
 * No icon font has the ten shapes of Report Manager (a rounded square, the two obliques), so each
 * one is drawn as the engine prints it: Oblique1 from the top left corner to the bottom right one,
 * Oblique2 from the bottom left to the top right.
 */
@Component({
  selector: 'rp-shape-icon',
  template: `
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="square" aria-hidden="true" focusable="false">
      @switch (shape) {
        @case (ShapeType.Rectangle) { <rect x="2" y="6" width="20" height="12" /> }
        @case (ShapeType.Square) { <rect x="5" y="5" width="14" height="14" /> }
        @case (ShapeType.RoundRect) { <rect x="2" y="6" width="20" height="12" rx="4" /> }
        @case (ShapeType.RoundSquare) { <rect x="5" y="5" width="14" height="14" rx="4" /> }
        @case (ShapeType.Ellipse) { <ellipse cx="12" cy="12" rx="10" ry="6" /> }
        @case (ShapeType.Circle) { <circle cx="12" cy="12" r="7" /> }
        @case (ShapeType.HorzLine) { <line x1="3" y1="12" x2="21" y2="12" /> }
        @case (ShapeType.VertLine) { <line x1="12" y1="3" x2="12" y2="21" /> }
        @case (ShapeType.Oblique1) { <line x1="4" y1="4" x2="20" y2="20" /> }
        @case (ShapeType.Oblique2) { <line x1="4" y1="20" x2="20" y2="4" /> }
      }
    </svg>
  `,
  styles: [`
    :host { display: inline-flex; flex-shrink: 0; width: 24px; height: 24px; margin-right: 16px; color: var(--rpd-text, #333); }
  `],
})
export class ShapeIconComponent {
  @Input() shape?: ShapeType;
  protected readonly ShapeType = ShapeType;
}
