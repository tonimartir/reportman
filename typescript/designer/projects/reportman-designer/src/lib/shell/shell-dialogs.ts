import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TipoConfirmacion } from './tipo-confirmacion';
import { TranslationService } from '../services/translator.service';

@Component({
  selector: 'rp-loading-dialog',
  imports: [MatProgressSpinnerModule],
  template: `<div class="rp-loading"><mat-spinner diameter="40"></mat-spinner></div>`,
  styles: [`.rp-loading { padding: 24px; display: flex; align-items: center; justify-content: center; }`],
})
export class LoadingDialogComponent {}

@Component({
  selector: 'rp-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.titulo || t.t('DesignerConfirmContinue') }}</h2>
    <mat-dialog-content>
      @if (data.descripcionHTML) { <div [innerHTML]="data.descripcionHTML"></div> }
      @else { <p class="rp-confirm-text">{{ data.descripcion }}</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (showNeutral) { <button mat-button (click)="ref.close(undefined)">{{ data.textoNeutral || t.TranslateStr(94) }}</button> }
      @if (showNegative) { <button mat-button (click)="ref.close(false)">{{ data.textoNegativo || (showPositive ? t.TranslateStr(724) : t.t('DesignerReject')) }}</button> }
      @if (showPositive) { <button mat-flat-button color="primary" cdkFocusInitial (click)="ref.close(true)">{{ data.textoPositivo || (showNegative ? t.TranslateStr(723) : t.TranslateStr(93)) }}</button> }
    </mat-dialog-actions>
  `,
  styles: [`.rp-confirm-text { white-space: pre-wrap; max-width: 60ch; }`],
})
export class ConfirmDialogComponent {
  readonly ref = inject(MatDialogRef<ConfirmDialogComponent, boolean | undefined>);
  protected readonly t = inject(TranslationService);
  readonly data = inject(MAT_DIALOG_DATA) as { titulo?: string; descripcion?: string; descripcionHTML?: string; tipo?: TipoConfirmacion; textoPositivo?: string; textoNegativo?: string; textoNeutral?: string };

  private get tipo(): TipoConfirmacion {
    return this.data.tipo ?? TipoConfirmacion.PosNeut;
  }
  get showPositive(): boolean {
    return this.tipo !== TipoConfirmacion.NegNeut;
  }
  get showNegative(): boolean {
    return this.tipo === TipoConfirmacion.PosNeg || this.tipo === TipoConfirmacion.NegNeut || this.tipo === TipoConfirmacion.PosNegNeut;
  }
  get showNeutral(): boolean {
    return this.tipo === TipoConfirmacion.PosNeut || this.tipo === TipoConfirmacion.NegNeut || this.tipo === TipoConfirmacion.PosNegNeut;
  }
}

@Component({
  selector: 'rp-prompt-dialog',
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatCheckboxModule, MatSelectModule, MatAutocompleteModule],
  template: `
    <h2 mat-dialog-title>{{ data.titulo || '' }}</h2>
    <mat-dialog-content>
      @if (data.descripcion) { <p class="rp-prompt-text">{{ data.descripcion }}</p> }
      @switch (data.kind) {
        @case ('boolean') { <mat-checkbox [(ngModel)]="value" name="value">{{ data.descripcion }}</mat-checkbox> }
        @case ('textarea') {
          <mat-form-field appearance="outline" class="rp-prompt-field">
            <textarea matInput rows="6" [(ngModel)]="value" name="value" (keydown.control.enter)="accept($event)"></textarea>
          </mat-form-field>
        }
        @case ('number') {
          <mat-form-field appearance="outline" class="rp-prompt-field">
            <input matInput type="number" [(ngModel)]="value" name="value" (keydown.enter)="accept($event)" />
          </mat-form-field>
        }
        @case ('date') {
          <mat-form-field appearance="outline" class="rp-prompt-field">
            <input matInput type="date" [(ngModel)]="value" name="value" (keydown.enter)="accept($event)" />
          </mat-form-field>
        }
        @case ('datetime') {
          <mat-form-field appearance="outline" class="rp-prompt-field">
            <input matInput type="datetime-local" [(ngModel)]="value" name="value" (keydown.enter)="accept($event)" />
          </mat-form-field>
        }
        @case ('time') {
          <mat-form-field appearance="outline" class="rp-prompt-field">
            <input matInput type="time" [(ngModel)]="value" name="value" (keydown.enter)="accept($event)" />
          </mat-form-field>
        }
        @case ('choice') {
          <mat-form-field appearance="outline" class="rp-prompt-field">
            <input matInput type="text" [(ngModel)]="value" name="value" [matAutocomplete]="auto" (keydown.enter)="accept($event)" />
            <mat-autocomplete #auto="matAutocomplete">
              @for (op of filteredChoices; track op) { <mat-option [value]="op">{{ op }}</mat-option> }
            </mat-autocomplete>
            @if (data.ayuda) { <mat-hint>{{ data.ayuda }}</mat-hint> }
          </mat-form-field>
        }
        @default {
          <mat-form-field appearance="outline" class="rp-prompt-field">
            <input matInput type="text" [(ngModel)]="value" name="value" (keydown.enter)="accept($event)" />
          </mat-form-field>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="ref.close({ cancelado: true })">{{ t.TranslateStr(94) }}</button>
      <button mat-flat-button color="primary" (click)="accept()" [disabled]="!canAccept">{{ t.TranslateStr(93) }}</button>
    </mat-dialog-actions>
  `,
  styles: [`.rp-prompt-field { width: 100%; } .rp-prompt-text { max-width: 60ch; }`],
})
export class PromptDialogComponent {
  readonly ref = inject(MatDialogRef<PromptDialogComponent>);
  protected readonly t = inject(TranslationService);
  readonly data = inject(MAT_DIALOG_DATA) as { kind: string; titulo?: string; descripcion?: string; valorOmision?: any; aceptarVacio?: boolean; opciones?: string[]; ayuda?: string };
  value: any = this.data.valorOmision ?? (this.data.kind === 'boolean' ? false : '');

  /** The known values that match what is typed so far (all of them while the field is empty). */
  get filteredChoices(): string[] {
    const all = this.data.opciones ?? [];
    const typed = String(this.value ?? '').trim().toLowerCase();
    return typed ? all.filter((o) => o.toLowerCase().includes(typed)) : all;
  }

  get canAccept(): boolean {
    if (this.data.kind === 'boolean' || this.data.aceptarVacio) return true;
    return this.value !== undefined && this.value !== null && String(this.value).trim().length > 0;
  }

  accept(event?: Event): void {
    // Enter closes on keydown; without preventDefault the key's activation reaches whatever
    // gets the focus back (the button that opened us) and opens a second, empty dialog.
    event?.preventDefault();
    if (!this.canAccept) return;
    let valor = this.value;
    if (this.data.kind === 'number') valor = valor === '' ? undefined : Number(valor);
    if ((this.data.kind === 'date' || this.data.kind === 'datetime' || this.data.kind === 'time') && typeof valor === 'string' && valor) {
      valor = this.data.kind === 'time' ? new Date(`1970-01-01T${valor}`) : new Date(valor);
    }
    this.ref.close({ valor });
  }
}
