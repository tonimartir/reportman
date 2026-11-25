import {
  Component,
  EventEmitter,
  Output,
  ComponentRef,
  ViewEncapsulation,
  Injector,
  ViewChild,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { TranslationService } from "../../services/translator.service";
import { ExpressionBuilderComponent } from "../../components/expression-builder/expression-builder.component";
import { Report } from "@reportman/lib";
import { ReportDatasetHelper } from "../../models/report-dataset-helper";
import { Ventana } from "../../shell/ventana";
import { CierreConfirmable, PresentacionService } from "../../shell/presentacion.service";
import { Texto } from "../../shell/texto";
import { SharedModule } from "../../shell/shared.module";

@Component({
  selector: "app-expression-dialog",
  imports: [CommonModule, FormsModule, ExpressionBuilderComponent, SharedModule],
  templateUrl: "./expression-dialog.component.html",
  styleUrls: ["./expression-dialog.component.css"],
  encapsulation: ViewEncapsulation.Emulated,
})
export class ExpressionDialogComponent
  extends Ventana<PeticionExpressionDialog, string | undefined>
  implements CierreConfirmable
{
  @ViewChild("expressionBuilder") private expressionBuilder?: ExpressionBuilderComponent;
  @Output() public closed = new EventEmitter<string | null>();

  protected expression = "";
  protected report?: Report;
  protected reportDatasetHelper!: ReportDatasetHelper;
  public currentComponentRef?: ComponentRef<ExpressionDialogComponent> = undefined;
  constructor(
    injector: Injector,
    private translator: TranslationService
  ) {
    super(injector, { nombre: "ExpressionDialog" });
  }
  public override _inicializarDatos(): void | Promise<void> {
    this.report = this.peticion.report;
    this.reportDatasetHelper = this.peticion.reportDatasetHelper!;
    this.expression = this.peticion.initialSelection!;
  }

  public confirm(expre: string) {
    this.cerrarModal(expre);
  }

  public cancel() {
    this.cerrarModal(undefined);
  }

  /** Escape or a click outside: an edited expression is not thrown away without asking. */
  public async antesDeCerrar(): Promise<boolean> {
    const current = this.expressionBuilder?.currentExpression() ?? this.expression ?? "";
    if (Texto.normalizarSaltosLinea(current).trim() === Texto.normalizarSaltosLinea(this.expression ?? "").trim()) return true;
    const discard = await this.pres.pedirConfirmacion({
      titulo: this.translator.t("DesignerUnappliedChanges"),
      descripcion: this.translator.t("DesignerDiscardExpression"),
      textoPositivo: this.translator.t("DesignerDiscard"),
      textoNeutral: this.translator.t("DesignerKeepEditing"),
    });
    return discard === true;
  }

  public static async modifyExpression(
    pres: PresentacionService,
    report: Report,
    reportDatasetHelper: ReportDatasetHelper,
    initialSelection?: string
  ): Promise<string | undefined> {
    const peticion = new PeticionExpressionDialog();
    peticion.report = report;
    peticion.reportDatasetHelper = reportDatasetHelper;
    peticion.initialSelection = initialSelection;
    const modal = await pres.abrirModal(ExpressionDialogComponent, { peticion: peticion });
    const resultado = await modal.esperarResultadoModal();
    return resultado;
  }

  protected override _actualizarFocus(): void | Promise<void> {
    this.expressionBuilder?.focus();
  }
}

export class PeticionExpressionDialog {
  public report?: Report;
  public reportDatasetHelper?: ReportDatasetHelper;
  public initialSelection?: string;
}
