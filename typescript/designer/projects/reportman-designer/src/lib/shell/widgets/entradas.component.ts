import { AfterContentInit, Component, ContentChildren, Directive, EventEmitter, Input, Output, QueryList } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSelectModule } from '@angular/material/select';

/** `<opcion-select [valor] [nombre]>`: one option of an `<entrada-select>`. */
@Directive({ selector: 'opcion-select' })
export class OpcionSelectDirective {
  @Input() valor: any;
  @Input() nombre = '';
}

/**
 * `<entrada-select [(valor)]>`: the designer's combobox, a square chip (designer.scss, `.rpd-select`).
 * A bare Material select, without a form field: same keyboard and overlay behaviour, none of the
 * outline, label or 56 px of height. The options come as `<opcion-select>` content children.
 */
@Component({
  selector: 'entrada-select',
  imports: [CommonModule, FormsModule, MatSelectModule],
  template: `
    @if (etiqueta) { <span class="rpd-field-label">{{ etiqueta }}</span> }
    <mat-select class="rpd-select" panelClass="rpd-select-panel" [panelWidth]="null" hideSingleSelectionIndicator [aria-label]="ariaLabel || etiqueta || ''"
      [ngModel]="valor" (ngModelChange)="onChange($event)" [disabled]="!!disabled" [compareWith]="compare">
      @for (op of opciones; track $index) { <mat-option [value]="op.valor">{{ op.nombre }}</mat-option> }
    </mat-select>
    <div hidden><ng-content></ng-content></div>
  `,
  styles: [`:host { display: flex; flex-direction: column; gap: 2px; min-width: 0; }`],
})
export class EntradaSelectComponent implements AfterContentInit {
  @Input() valor: any;
  @Output() valorChange = new EventEmitter<any>();
  @Input() estilo?: string;
  @Input() etiqueta?: string;
  /** Accessible name when the widget has no visible label of its own (the inspector passes the property name). */
  @Input() ariaLabel?: string;
  @Input() disabled?: boolean;
  @ContentChildren(OpcionSelectDirective) opcionesContent!: QueryList<OpcionSelectDirective>;
  opciones: { valor: any; nombre: string }[] = [];

  ngAfterContentInit(): void {
    const refresh = () => (this.opciones = this.opcionesContent.map((o) => ({ valor: o.valor, nombre: o.nombre })));
    refresh();
    this.opcionesContent.changes.subscribe(refresh);
  }

  onChange(value: any): void {
    this.valor = value;
    this.valorChange.emit(value);
  }

  compare = (a: any, b: any): boolean => a === b || (a != null && b != null && String(a) === String(b));
}

/** `<entrada-checkbox [(valor)]>`: a native checkbox in the designer's accent colour. */
@Component({
  selector: 'entrada-checkbox',
  imports: [CommonModule, FormsModule],
  template: `
    <label class="rpd-check">
      <input type="checkbox" [ngModel]="!!valor" (ngModelChange)="onChange($event)" [disabled]="!!disabled" [attr.aria-label]="ariaLabel || etiqueta || null" />
      <span><ng-content></ng-content>{{ etiqueta || '' }}</span>
    </label>
  `,
  styles: [`:host { display: inline-flex; }`],
})
export class EntradaCheckboxComponent {
  @Input() valor: any;
  @Output() valorChange = new EventEmitter<boolean>();
  @Input() estilo?: string;
  @Input() size?: number;
  @Input() etiqueta?: string;
  /** Accessible name when the widget has no visible label of its own (the inspector passes the property name). */
  @Input() ariaLabel?: string;
  @Input() disabled?: boolean;

  onChange(value: boolean): void {
    this.valor = value;
    this.valorChange.emit(value);
  }
}

/** `<entrada-texto [(valor)]>`: a plain input in the designer's control style. */
@Component({
  selector: 'entrada-texto',
  imports: [CommonModule, FormsModule],
  template: `
    @if (etiqueta) { <span class="rpd-field-label">{{ etiqueta }}</span> }
    <input class="rpd-input" [type]="tipo" [ngModel]="valor" (ngModelChange)="onChange($event)" [disabled]="!!disabled"
      [placeholder]="placeholder || ''" (keydown.enter)="enter.emit()" [attr.aria-label]="ariaLabel || etiqueta || placeholder || null" />
  `,
  styles: [`:host { display: flex; flex-direction: column; gap: 2px; min-width: 0; }`],
})
export class EntradaTextoComponent {
  @Input() valor: any;
  @Output() valorChange = new EventEmitter<any>();
  @Output() enter = new EventEmitter<void>();
  @Input() estilo?: string;
  @Input() etiqueta?: string;
  /** Accessible name when the widget has no visible label of its own (the inspector passes the property name). */
  @Input() ariaLabel?: string;
  @Input() placeholder?: string;
  @Input() tipo = 'text';
  @Input() disabled?: boolean;

  onChange(value: any): void {
    this.valor = value;
    this.valorChange.emit(value);
  }
}
