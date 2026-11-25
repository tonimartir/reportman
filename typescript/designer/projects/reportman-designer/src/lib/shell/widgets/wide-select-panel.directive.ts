import { Directive, ElementRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSelect } from '@angular/material/select';

/**
 * `<mat-select rpWideSelectPanel>`: the open list as wide as its longest option instead of the closed one
 * (a wide dropdown), but never narrower than the field (the form field's
 * box, or the chip the select sits in) and at most ~600 px or the screen. Material's empty `panelWidth` lets the
 * panel fit its options; the limits go on the panel itself when it opens, before it is painted, so they also hold
 * inside the web component's shadow root.
 */
@Directive({ selector: 'mat-select[rpWideSelectPanel]' })
export class WideSelectPanelDirective {
  private select = inject(MatSelect);
  private host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    this.select.panelWidth = null;
    this.select.openedChange.pipe(takeUntilDestroyed()).subscribe((opened) => {
      if (opened) this.limit(3);
    });
  }

  /**
   * When `openedChange` fires the panel is in the DOM but `MatSelect.panel` may not be set yet (it is a view query
   * resolved on the next change detection): look it up by its id in the select's own root (the document, or the
   * shadow root of the web component), and try again on the next frames if it is not there.
   */
  private limit(tries: number): void {
    const root = this.host.getRootNode() as Document | ShadowRoot;
    const panel = (root.getElementById?.(`${this.select.id}-panel`) ?? this.select.panel?.nativeElement) as HTMLElement | null | undefined;
    if (!panel) {
      if (tries > 0) requestAnimationFrame(() => this.limit(tries - 1));
      return;
    }
    const field = this.host.closest('.mat-mdc-text-field-wrapper, .rpd-select-chip') ?? this.host;
    const screen = Math.max(0, window.innerWidth - 16);
    panel.style.minWidth = Math.min(field.getBoundingClientRect().width, screen) + 'px';
    panel.style.maxWidth = Math.min(600, screen) + 'px';
  }
}
