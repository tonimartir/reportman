import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { OpcionMenu, iconName } from '../opcion-menu';

/**
 * `<menu [opciones] (seleccionado)>`: the original host application's popup menu body, used by the structure tree inside
 * a CDK overlay. Clicking an entry emits it; the host decides what to run.
 */
@Component({
  selector: 'menu',
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="rp-popup-menu" role="menu">
      @for (op of opciones; track $index) {
        @if (op.separador || op.separadorCompleto) {
          <div class="rp-popup-sep" [class.rp-popup-sep-full]="op.separadorCompleto"></div>
        } @else if (op.informativo) {
          <div class="rp-popup-info">{{ op.nombre }}</div>
        } @else {
          <button type="button" class="rp-popup-item" role="menuitem" [disabled]="op.disabled" [title]="op.title || ''"
            (click)="seleccionado.emit(op)" [style.background]="op.colorFondo || null" [style.color]="op.colorTexto || null">
            <span class="rp-popup-icon">
              @if (op.checked) { <mat-icon>check</mat-icon> } @else if (op.icono) { <mat-icon>{{ iconName(op.icono) }}</mat-icon> }
            </span>
            <span class="rp-popup-text">{{ op.nombre }}</span>
          </button>
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .rp-popup-menu { background: #fff; border: 1px solid var(--rpd-border, #d4d4d8); border-radius: 4px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); padding: 3px 0; min-width: 168px; font-family: var(--rpd-font, inherit); font-size: var(--rpd-fs-lg, 12px); }
    .rp-popup-item { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 26px; border: 0; background: transparent; text-align: left; padding: 0 12px 0 8px; font: inherit; cursor: pointer; color: var(--rpd-text, #333); }
    .rp-popup-item:hover:not(:disabled) { background: var(--rpd-hover, #F0F0F0); }
    .rp-popup-item:disabled { color: var(--rpd-text-3, #aaa); cursor: default; }
    .rp-popup-icon { width: 16px; display: inline-flex; justify-content: center; }
    .rp-popup-icon mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .rp-popup-sep { border-top: 1px solid var(--rpd-border-soft, #e0e0e0); margin: 3px 0; }
    .rp-popup-sep-full { border-top-width: 2px; margin: 5px 0; }
    .rp-popup-info { padding: 4px 12px; color: var(--rpd-text-3, #888); font-size: var(--rpd-fs, 11px); }
  `],
})
export class MenuComponent {
  @Input() opciones?: OpcionMenu[];
  @Output() seleccionado = new EventEmitter<OpcionMenu>();
  readonly iconName = iconName;
}
