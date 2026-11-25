import { hasModifierKey } from '@angular/cdk/keycodes';
import { Injectable, Type, inject } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { LoadingModal } from './loading.modal';
import { TipoConfirmacion } from './tipo-confirmacion';
import { ConfirmDialogComponent, LoadingDialogComponent, PromptDialogComponent } from './shell-dialogs';

export class PeticionConfirmar {
  /** Empty: the dialog asks «Do you want to continue?» in the designer's language. */
  public titulo?: string;
  public descripcion?: string;
  public descripcionHTML?: string;
  public tipo? = TipoConfirmacion.PosNeut;
  public textoPositivo?: string;
  public textoNegativo?: string;
  public textoNeutral?: string;
}

export interface PeticionPedirDato<T> {
  titulo?: string;
  descripcion?: string;
  valorOmision?: T;
  aceptarVacio?: boolean;
}

export interface ResultadoPedirDato<T> {
  valor?: T;
  cancelado?: boolean;
}

export interface ModalHandle<R> {
  esperarResultadoModal(): Promise<R | undefined>;
  cerrarModal(resultado?: R): void;
}

/**
 * A dialog with edits it would lose (the SQL, an expression): Escape and a click outside ask it
 * first, and it closes only if this answers true. Its own buttons do not go through here.
 */
export interface CierreConfirmable {
  antesDeCerrar(): boolean | Promise<boolean>;
}

/**
 * The designer's window to the outside: dialogs, prompts, confirmations, loading overlays and
 * errors. In the original host application this was `PresentacionService`; the name stays so the designer's code does
 * not change, the implementation is Material.
 */
@Injectable({ providedIn: 'root' })
export class PresentacionService {
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  /** Narrow screen (phones): the designer uses it to pick larger controls. */
  public readonly estrecha$ = new BehaviorSubject<boolean>(this.computeEstrecha());
  public readonly ratio$ = new BehaviorSubject<number>(window.devicePixelRatio || 1);

  constructor() {
    window.addEventListener('resize', () => {
      const narrow = this.computeEstrecha();
      if (narrow !== this.estrecha$.value) this.estrecha$.next(narrow);
      const ratio = window.devicePixelRatio || 1;
      if (ratio !== this.ratio$.value) this.ratio$.next(ratio);
    });
  }

  public get estrecha(): boolean {
    return this.estrecha$.value;
  }

  private computeEstrecha(): boolean {
    return window.innerWidth < 768;
  }

  public async abrirModal<C, P>(component: Type<C>, opciones?: { peticion?: P; titulo?: string; sinFondo?: boolean; ancho?: string; alto?: string } & Record<string, any>): Promise<ModalHandle<any>> {
    const ref: MatDialogRef<C, any> = this.dialog.open(component, {
      data: opciones ?? {},
      maxWidth: '95vw',
      maxHeight: '95vh',
      autoFocus: false,
      restoreFocus: true,
      hasBackdrop: !opciones?.sinFondo,
      panelClass: 'rp-designer-dialog',
      disableClose: true,
    });
    // Escape and a click outside still close it, as Material would; a dialog with edits it would
    // lose decides first (CierreConfirmable): a stray Escape must not throw away a typed SQL.
    const closeRequested = async () => {
      const dialog = ref.componentInstance as Partial<CierreConfirmable> | null;
      if (dialog?.antesDeCerrar && !(await dialog.antesDeCerrar())) return;
      ref.close();
    };
    ref.backdropClick().subscribe(() => void closeRequested());
    ref.keydownEvents().subscribe((event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || hasModifierKey(event)) return;
      event.preventDefault();
      void closeRequested();
    });
    return {
      esperarResultadoModal: () => firstValueFrom(ref.afterClosed()),
      cerrarModal: (r) => ref.close(r),
    };
  }

  public async mostrarLoading(): Promise<LoadingModal> {
    const ref = this.dialog.open(LoadingDialogComponent, { disableClose: true, panelClass: 'rp-loading-dialog', hasBackdrop: true });
    return new LoadingModal(() => ref.close());
  }

  public async mostrarError(error: any, _toast?: boolean): Promise<void> {
    const message = this.describe(error);
    console.error('[designer]', error);
    this.snack.open(message, 'OK', { duration: 6000, panelClass: 'rp-error-snack' });
  }

  public async pedirConfirmacion(peticion: PeticionConfirmar): Promise<boolean | undefined> {
    const ref = this.dialog.open(ConfirmDialogComponent, { data: peticion, autoFocus: 'dialog', maxWidth: '95vw' });
    return firstValueFrom(ref.afterClosed());
  }

  public pedirTexto(pet: PeticionPedirDato<string>): Promise<ResultadoPedirDato<string>> {
    return this.prompt<string>('text', pet);
  }

  /** A text the person can type or pick from the known values (autocomplete). */
  public pedirOpcion(pet: PeticionPedirDato<string> & { opciones: string[]; ayuda?: string }): Promise<ResultadoPedirDato<string>> {
    return this.prompt<string>('choice', pet);
  }

  public pedirTextoLargo(pet: PeticionPedirDato<string>): Promise<ResultadoPedirDato<string>> {
    return this.prompt<string>('textarea', pet);
  }

  public pedirNumero(pet: PeticionPedirDato<number>): Promise<ResultadoPedirDato<number>> {
    return this.prompt<number>('number', pet);
  }

  public pedirBooleano(pet: PeticionPedirDato<boolean>): Promise<ResultadoPedirDato<boolean>> {
    return this.prompt<boolean>('boolean', pet);
  }

  public pedirFecha(pet: PeticionPedirDato<Date>): Promise<ResultadoPedirDato<Date>> {
    return this.prompt<Date>('date', pet);
  }

  public pedirFechaHora(pet: PeticionPedirDato<Date>): Promise<ResultadoPedirDato<Date>> {
    return this.prompt<Date>('datetime', pet);
  }

  public pedirHora(pet: PeticionPedirDato<Date>): Promise<ResultadoPedirDato<Date>> {
    return this.prompt<Date>('time', pet);
  }

  private async prompt<T>(kind: string, pet: PeticionPedirDato<T>): Promise<ResultadoPedirDato<T>> {
    const ref = this.dialog.open(PromptDialogComponent, { data: { kind, ...pet }, autoFocus: 'input', maxWidth: '95vw', width: '420px' });
    const result = await firstValueFrom(ref.afterClosed());
    return result ?? { cancelado: true };
  }

  private describe(error: any): string {
    if (!error) return 'Error';
    if (typeof error === 'string') return error;
    if (error.errorMessage) return error.errorMessage;
    if (error.error?.error) return error.error.error;
    if (error.message) return error.message;
    return String(error);
  }
}
