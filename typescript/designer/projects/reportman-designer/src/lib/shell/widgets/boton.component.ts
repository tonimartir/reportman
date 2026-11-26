import { Component, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { OpcionMenu, iconName } from '../opcion-menu';
import { ShapeIconComponent } from './shape-icon.component';

export type EstiloBoton = 'normal' | 'confirmacion' | 'ninguno' | 'report';
export type ColorBoton = 'normal' | 'positivo' | 'negativo' | 'neutro';

/** Resolves lazy sub-menus (`obtenerOpciones`) a few levels deep so the menu can render synchronously. */
export async function resolveOpciones(opciones: OpcionMenu[] | undefined, depth = 0): Promise<OpcionMenu[]> {
  const result: OpcionMenu[] = [];
  for (const op of opciones ?? []) {
    const copy: OpcionMenu = { ...op };
    if (depth < 3 && (op.obtenerOpciones || op.opciones?.length)) {
      const children = op.obtenerOpciones ? await op.obtenerOpciones() : op.opciones;
      copy.opciones = await resolveOpciones(children, depth + 1);
    }
    result.push(copy);
  }
  return result;
}

/** Renders a list of OpcionMenu inside a mat-menu, sub-menus included (it nests itself). */
@Component({
  selector: 'rp-opciones-menu',
  imports: [CommonModule, MatMenuModule, MatIconModule, ShapeIconComponent],
  template: `
    @for (op of opciones; track $index) {
      @if (op.separador || op.separadorCompleto) {
        <div class="rp-menu-sep" [class.rp-menu-sep-full]="op.separadorCompleto"></div>
      } @else if (op.informativo) {
        <div class="rp-menu-info">{{ op.nombre }}</div>
      } @else if (op.opciones?.length) {
        <button mat-menu-item [matMenuTriggerFor]="sub" [disabled]="op.disabled">
          @if (op.icono) { <mat-icon>{{ iconName(op.icono) }}</mat-icon> }
          <span>{{ op.nombre }}</span>
        </button>
        <mat-menu #sub="matMenu" class="rp-designer-menu">
          <rp-opciones-menu [opciones]="op.opciones ?? []"></rp-opciones-menu>
        </mat-menu>
      } @else if (op.shape !== undefined) {
        <!-- A shape keeps its drawing when it is the current one: the check goes after its name -->
        <button mat-menu-item [disabled]="op.disabled" [title]="op.title || ''" (click)="op.callback?.()"
          [class.rp-menu-checked]="op.checked" [attr.aria-checked]="op.checked ? 'true' : 'false'" role="menuitemradio">
          <rp-shape-icon matMenuItemIcon [shape]="op.shape"></rp-shape-icon>
          <span class="rp-menu-shape-text">{{ op.nombre }}@if (op.checked) {<span class="material-icons rp-menu-check" aria-hidden="true">check</span>}</span>
        </button>
      } @else {
        <button mat-menu-item [disabled]="op.disabled" [title]="op.title || ''" (click)="op.callback?.()"
          [style.background]="op.colorFondo || null" [style.color]="op.colorTexto || null" [class]="op.clasesCss || ''">
          @if (op.checked) { <mat-icon>check</mat-icon> } @else if (op.icono) { <mat-icon>{{ iconName(op.icono) }}</mat-icon> }
          <span>{{ op.nombre }}</span>
        </button>
      }
    }
  `,
  styles: [`
    .rp-menu-sep { border-top: 1px solid var(--rpd-border-soft, #e0e0e0); margin: 3px 0; }
    .rp-menu-sep-full { border-top-width: 2px; margin: 5px 0; }
    .rp-menu-info { padding: 4px 12px; color: var(--rpd-text-3, #888); font-size: var(--rpd-fs, 11px); }
    .rp-menu-shape-text { display: inline-flex; align-items: center; gap: 12px; }
    .rp-menu-checked .rp-menu-shape-text { font-weight: 600; }
    .rp-menu-check { font-size: 18px; }
  `],
})
export class OpcionesMenuComponent {
  @Input() opciones: OpcionMenu[] = [];
  readonly iconName = iconName;
}

/**
 * The original host application's `<boton>` with the same inputs and outputs, drawn with Material. `estilo="report"`
 * is the dense toolbar button of the designer; `confirmacion` the raised dialog button; `ninguno`
 * a bare icon. With `opciones` or `obtenerOpciones` it opens a Material menu.
 */
@Component({
  selector: 'boton',
  imports: [CommonModule, MatMenuModule, MatTooltipModule, OpcionesMenuComponent],
  template: `
    <!-- The projected content, once: an <ng-content> in each branch below would only ever fill one
         of them (the last), and the tool buttons lost their text (a menu button that names its value) -->
    <ng-template #content><ng-content></ng-content></ng-template>
    @if (estilo === 'report' || estilo === 'ninguno') {
      <!-- The designer's own tool button (designer.scss): one size and one icon size everywhere,
           so iconoSize and iconoColor are deliberately not applied here. -->
      <button type="button" class="rpd-tool" [class.is-active]="activo || seleccionado"
        [disabled]="disabled" [matTooltip]="title || ''" [matTooltipShowDelay]="400" [attr.aria-label]="title || null"
        (click)="onClick($event)" (dblclick)="dblclicked.emit($event)" (contextmenu)="onContext($event)" (auxclick)="auxclicked.emit($event)"
        [matMenuTriggerFor]="hasMenu ? menu : null" #trigger="matMenuTrigger" (menuOpened)="loadOptions()">
        @if (icono) { <span class="material-icons" aria-hidden="true">{{ iconName(icono) }}</span> }
        <ng-container *ngTemplateOutlet="content"></ng-container>
        @if (hasMenu && !ocultarFlechaOpciones && estilo === 'report') { <span class="material-icons rpd-tool-caret" aria-hidden="true">arrow_drop_down</span> }
      </button>
    } @else {
      <!-- Dialog buttons: the same square button as the rest of the designer; the confirming
           one (confirmacion + positivo) is the filled, primary one. -->
      <button type="button" class="rpd-btn rpd-btn-lg" [class.rpd-btn-primary]="estilo === 'confirmacion' && color === 'positivo'"
        [class.is-on]="activo || seleccionado" [disabled]="disabled" [matTooltip]="title || ''" [matTooltipShowDelay]="400" [attr.aria-label]="title || null"
        (click)="onClick($event)" (dblclick)="dblclicked.emit($event)" (contextmenu)="onContext($event)" (auxclick)="auxclicked.emit($event)"
        [matMenuTriggerFor]="hasMenu ? menu : null" #trigger="matMenuTrigger" (menuOpened)="loadOptions()">
        @if (icono) { <span class="material-icons" aria-hidden="true">{{ iconName(icono) }}</span> }
        <ng-container *ngTemplateOutlet="content"></ng-container>
        @if (hasMenu && !ocultarFlechaOpciones) { <span class="material-icons rpd-tool-caret" aria-hidden="true">arrow_drop_down</span> }
      </button>
    }
    <mat-menu #menu="matMenu" class="rp-designer-menu">
      <rp-opciones-menu [opciones]="resolvedOptions"></rp-opciones-menu>
    </mat-menu>
  `,
  styles: [`
    :host { display: inline-flex; }
  `],
})
export class BotonComponent {
  @Input() public icono?: number | string;
  @Input() public iconoSize?: number;
  @Input() public iconoColor?: string;
  @Input() public activo?: boolean;
  @Input() public disabled?: boolean;
  @Input() public seleccionado?: boolean;
  @Input() public title?: string;
  @Input() public estilo: EstiloBoton = 'normal';
  @Input() public color: ColorBoton = 'normal';
  @Input() public alinear?: string;
  @Input() public ocultarFlechaOpciones?: boolean;
  @Input() public menuTrigger: 'click' | 'dblclick' | 'contextmenu' | 'aux' = 'click';
  @Input() public opciones?: OpcionMenu[];
  @Input() public obtenerOpciones?: () => OpcionMenu[] | Promise<OpcionMenu[]>;

  @Output() public clicked = new EventEmitter<MouseEvent>();
  @Output() public dblclicked = new EventEmitter<MouseEvent>();
  @Output() public contextmenued = new EventEmitter<MouseEvent>();
  @Output() public auxclicked = new EventEmitter<MouseEvent>();

  @ViewChild('trigger') trigger?: MatMenuTrigger;

  resolvedOptions: OpcionMenu[] = [];
  readonly iconName = iconName;

  get hasMenu(): boolean {
    return !!(this.opciones?.length || this.obtenerOpciones);
  }

  onClick(event: MouseEvent): void {
    if (!this.hasMenu) this.clicked.emit(event);
  }

  onContext(event: MouseEvent): void {
    this.contextmenued.emit(event);
    if (this.menuTrigger === 'contextmenu' && this.hasMenu) {
      event.preventDefault();
      this.trigger?.openMenu();
    }
  }

  async loadOptions(): Promise<void> {
    const top = this.obtenerOpciones ? await this.obtenerOpciones() : this.opciones ?? [];
    this.resolvedOptions = await resolveOpciones(top);
  }
}
