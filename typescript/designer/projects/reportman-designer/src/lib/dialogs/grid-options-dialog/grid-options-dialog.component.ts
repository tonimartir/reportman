import { Component, ViewEncapsulation, Injector } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { TranslationService } from "../../services/translator.service";
import { Ventana } from "../../shell/ventana";
import { PresentacionService } from "../../shell/presentacion.service";
import { SharedModule } from "../../shell/shared.module";

@Component({
  selector: "app-grid-options-dialog",
  imports: [CommonModule, FormsModule, SharedModule],
  templateUrl: "./grid-options-dialog.component.html",
  styleUrls: ["./grid-options-dialog.component.css"],
  encapsulation: ViewEncapsulation.Emulated,
})
export class GridOptionsDialogComponent extends Ventana<IGridOptions, IGridOptions | undefined> {
  protected stringOk: string;
  protected stringCancel: string;
  protected stringTitle: string;
  protected stringHorizontal: string;
  protected stringVertical: string;
  protected stringVisible: string;
  protected stringEnabled: string;
  protected stringGridType: string;
  protected stringLines: string;
  protected stringPoints: string;
  protected stringColor: string;
  public gridOptions: IGridOptions = {
    gridVisible: true,
    gridColor: "#000000",
    gridEnabled: true,
    gridWidth: 1440,
    gridHeight: 1440,
    gridLines: false,
  };
  constructor(
    injector: Injector,
    private translator: TranslationService
  ) {
    super(injector, { nombre: "GridOptionsDialog" });
    this.stringOk = translator.TranslateStr(93);
    this.stringCancel = translator.TranslateStr(94);
    this.stringTitle = translator.TranslateStr(8);
    this.stringHorizontal = translator.TranslateStr(180);
    this.stringVertical = translator.TranslateStr(181);
    this.stringVisible = translator.TranslateStr(183);
    this.stringEnabled = translator.TranslateStr(182);
    this.stringGridType = translator.TranslateStr(646);
    this.stringLines = translator.TranslateStr(184);
    this.stringPoints = translator.TranslateStr(896);
    this.stringColor = translator.TranslateStr(185);
  }
  public override _inicializarDatos(): void | Promise<void> {
    this.gridOptions = this.peticion;
  }
  public confirm() {
    this.cerrarModal(this.gridOptions);
  }

  public cancel() {
    this.cerrarModal(undefined);
  }

  public static async showGridOptions(
    pres: PresentacionService,
    initialSelection?: IGridOptions
  ): Promise<IGridOptions | undefined> {
    const modal = await pres.abrirModal(GridOptionsDialogComponent, { peticion: initialSelection });
    const resultado = modal.esperarResultadoModal();
    return resultado;
  }
}

export interface IGridOptions {
  gridVisible: boolean;
  gridLines: boolean;
  gridEnabled: boolean;
  gridColor: string;
  gridWidth: number;
  gridHeight: number;
}
