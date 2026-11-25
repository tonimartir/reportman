import { AfterViewInit, Directive, Injector, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { PresentacionService } from './presentacion.service';

export interface OpcionesVentana<P> {
  nombre?: string;
  peticion?: P;
  titulo?: string;
}

/**
 * The base the designer's dialogs extend. In the original host application this was `Ventana`, a window with routing,
 * modals and twenty services behind it; here it is the thin adapter over a Material dialog:
 * the request arrives as `peticion`, `cerrarModal(result)` closes, and the two hooks the dialogs
 * override (`_inicializarDatos`, `_actualizarFocus`) fire at init and after the view is ready.
 */
@Directive()
export abstract class Ventana<P = any, R = any> implements OnInit, AfterViewInit {
  public readonly pres: PresentacionService;
  public peticion!: P;
  protected readonly dialogRef: MatDialogRef<any, R> | null;

  constructor(injector: Injector, opciones?: Partial<OpcionesVentana<P>>) {
    this.pres = injector.get(PresentacionService);
    this.dialogRef = injector.get(MatDialogRef, null) as MatDialogRef<any, R> | null;
    const data = injector.get(MAT_DIALOG_DATA, null) as (OpcionesVentana<P> & { peticion?: P }) | null;
    this.peticion = (data?.peticion ?? opciones?.peticion) as P;
  }

  public async ngOnInit(): Promise<void> {
    await this._inicializarDatos();
  }

  public ngAfterViewInit(): void {
    setTimeout(() => void this._actualizarFocus());
  }

  public _inicializarDatos(): void | Promise<void> {}

  protected _actualizarFocus(): void | Promise<void> {}

  public cerrarModal(resultado?: R): void {
    this.dialogRef?.close(resultado);
  }
}
