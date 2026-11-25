import { Directive, ElementRef, Input, OnChanges, Renderer2, inject } from '@angular/core';
import { iconName } from '../opcion-menu';

/**
 * `<span ngIcon="matFormatBold" [size]="14" color="#333">`: the original host application drew these with ng-icons;
 * here the same attributes render a Material Icons glyph, so the templates stay untouched.
 */
@Directive({ selector: '[ngIcon]' })
export class NgIconDirective implements OnChanges {
  @Input() ngIcon: string | number | undefined | null = '';
  @Input() size?: number | string;
  @Input() color?: string;
  @Input() strokeWidth?: number | string;

  private el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private renderer = inject(Renderer2);

  ngOnChanges(): void {
    const glyph = iconName(this.ngIcon);
    this.renderer.addClass(this.el, 'material-icons');
    this.renderer.addClass(this.el, 'rp-ng-icon');
    this.renderer.setProperty(this.el, 'textContent', glyph);
    const size = this.size !== undefined && this.size !== null && this.size !== '' ? Number(this.size) : undefined;
    this.renderer.setStyle(this.el, 'font-size', size ? `${size}px` : '18px');
    this.renderer.setStyle(this.el, 'width', size ? `${size}px` : '18px');
    this.renderer.setStyle(this.el, 'height', size ? `${size}px` : '18px');
    this.renderer.setStyle(this.el, 'line-height', '1');
    this.renderer.setStyle(this.el, 'display', 'inline-flex');
    this.renderer.setStyle(this.el, 'align-items', 'center');
    this.renderer.setStyle(this.el, 'justify-content', 'center');
    this.renderer.setStyle(this.el, 'overflow', 'hidden');
    if (this.color) this.renderer.setStyle(this.el, 'color', this.color.trim());
  }
}
