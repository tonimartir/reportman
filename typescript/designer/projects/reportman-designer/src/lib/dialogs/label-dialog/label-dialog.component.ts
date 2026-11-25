import { Component, ElementRef, Injector, ViewChild, inject } from "@angular/core";
import { SharedModule } from "../../shell/shared.module";
import { Ventana } from "../../shell/ventana";
import { PresentacionService } from "../../shell/presentacion.service";
import { TranslationService } from "../../services/translator.service";

@Component({
  selector: "label-dialog",
  templateUrl: "./label-dialog.component.html",
  styleUrl: "./label-dialog.component.css",
  imports: [SharedModule],
})
export class LabelDialogComponent extends Ventana<PeticionLabelDialog, string | undefined> {
  @ViewChild("entradaTexto") private entradaTexto?: ElementRef<HTMLElement>;
  protected readonly t = inject(TranslationService);
  protected titulo?: string;
  protected texto = "";
  protected placeholder?: string;
  protected ancho?: string;
  protected alto?: string;

  constructor(injector: Injector) {
    super(injector, { nombre: "LabelDialog" });
  }

  public override _inicializarDatos(): void | Promise<void> {
    this.titulo = this.peticion.titulo;
    this.texto = this.peticion.texto ?? "";
    this.placeholder = this.peticion.placeholder ?? this.t.t("DesignerEnterText");
    this.ancho = this.peticion.ancho ?? "600px";
    this.alto = this.peticion.alto ?? "400px";
  }

  public confirm(text: string) {
    this.cerrarModal(text);
  }

  public cancel() {
    this.cerrarModal(undefined);
  }
  public static async modifyText(
    pres: PresentacionService,
    titulo?: string,
    text?: string,
    placeholder?: string,
    ancho?: string,
    alto?: string
  ): Promise<string | undefined> {
    const peticion = new PeticionLabelDialog();
    peticion.titulo = titulo;
    peticion.texto = text;
    peticion.placeholder = placeholder;
    peticion.ancho = ancho;
    peticion.alto = alto;
    const modal = await pres.abrirModal(LabelDialogComponent, { peticion: peticion });
    const resultado = await modal.esperarResultadoModal();
    return resultado;
  }

  protected override _actualizarFocus(): void | Promise<void> {
    this.entradaTexto?.nativeElement.focus();
  }
}

export class PeticionLabelDialog {
  public titulo?: string;
  public texto?: string;
  public placeholder?: string;
  public ancho?: string;
  public alto?: string;
}
