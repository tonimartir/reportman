import {
  Component,
  EventEmitter,
  Output,
  ComponentRef,
  ViewEncapsulation,
  Injector,
  ViewChild,
  signal,
} from "@angular/core";

import { FormsModule } from "@angular/forms";
import { MatDialog } from "@angular/material/dialog";
import { DataInfo, DataSetInformation, ReadReportOperation, ReadReportRequest, Report } from "@reportman/lib";
import { ReportDatasetHelper } from "../../models/report-dataset-helper";
import { NgxReportmanLibService } from "../../services/ngx-reportman-lib.service";
import { CierreConfirmable, PresentacionService } from "../../shell/presentacion.service";
import { LoadingModal } from "../../shell/loading.modal";
import { Ventana } from "../../shell/ventana";
import { SharedModule } from "../../shell/shared.module";
import { Texto } from "../../shell/texto";
import { SqlEditorComponent, SqlErrorMarker } from "../../components/sql-editor/sql-editor.component";
import { DESIGNER_AI, DesignerAi, DesignerAiSchemaInfo, DesignerAiSqlParameter } from "../../shell/designer-ai";
import { AiChatComponent } from "../../ai/ai-chat.component";
import { AiInferenceTracker } from "../../ai/ai-inference-tracker";
import { handleCodeCopy, renderAiMarkdown } from "../../ai/ai-markdown";
import { openAiReport } from "../../ai/ai-report-dialog.component";
import { TranslationService } from "../../services/translator.service";
import { sameSql } from "../../models/designer-interface-datainfo";

const CHAT_OPEN_KEY = "rpd_sql_chat_open";

/**
 * The dataset's SQL dialog, laid out like the Delphi designer's: the editor on the left with the
 * data and the audit underneath, the AI chat on the right. The audit (ExplainSQL) is what the AI
 * later reads to know what the dataset does, and what the developer reads to check the SQL does
 * what they meant; it travels with the dataset (sqlExplanation) and goes stale when the SQL changes.
 */
@Component({
  selector: "rp-sql-dialog",
  imports: [FormsModule, SharedModule],
  templateUrl: "./sql-dialog.component.html",
  styleUrls: ["./sql-dialog.component.css"],
  encapsulation: ViewEncapsulation.Emulated,
})
export class SqlDialogComponent extends Ventana<PeticionSqlDialog, string | undefined> implements CierreConfirmable {
  @Output() public closed = new EventEmitter<string | null>();

  @ViewChild(SqlEditorComponent) public editor?: SqlEditorComponent;
  @ViewChild(AiChatComponent) public chat?: AiChatComponent;

  protected expression = "";
  protected datasetName = "";
  protected databaseAlias = "";
  /** The part of the database the dataset was made with (its SchemaName, D3): the editor's selector starts with it. */
  protected schemaName = "";
  /** The Hub schema the dataset was made with (its HubSchemaId): the selector starts with it on an Agent connection. */
  protected hubSchemaId?: number;
  protected report?: Report;
  protected reportDatasetHelper?: ReportDatasetHelper;
  protected dataInfo?: DataInfo;
  protected dataset?: DataSetInformation;
  protected parameters: DesignerAiSqlParameter[] = [];
  public currentComponentRef?: ComponentRef<SqlDialogComponent> = undefined;
  /** The host's AI, when it provides one. */
  protected ai: DesignerAi | null;
  protected schema: DesignerAiSchemaInfo | null = null;
  protected chatOpen = readFlag(CHAT_OPEN_KEY, true);
  protected bottomTab: "data" | "audit" = "data";
  /** What the last «Obtener datos» failed with; stays in the data panel until the next run. */
  protected error = "";

  // Audit (ExplainSQL): the explanation belongs to one SQL text; another text makes it stale.
  protected readonly auditTracker = new AiInferenceTracker();
  protected auditHtml = signal("");
  /** The audit exactly as the AI wrote it: what a report sends. */
  protected auditText = signal("");
  protected auditError = signal("");
  protected auditStale = signal(false);
  private auditedSql = "";
  /**
   * An audit of an SQL the dataset does not have yet (the editor's text): it waits for «Aceptar»
   * and goes back with the new SQL; «Cancelar» drops it with the edit.
   */
  private pendingAudit?: SqlAudit;

  protected readonly t: TranslationService;
  private readonly dialog: MatDialog;

  constructor(
    injector: Injector,
    private reportService: NgxReportmanLibService
  ) {
    super(injector, { nombre: "SqlDialog" });
    this.ai = injector.get(DESIGNER_AI, null);
    this.t = injector.get(TranslationService);
    this.dialog = injector.get(MatDialog);
  }

  public override async _inicializarDatos(): Promise<void> {
    this.report = this.peticion.report;
    this.reportDatasetHelper = this.peticion.reportDatasetHelper;
    this.expression = Texto.normalizarSaltosLinea(this.peticion.initialSelection ?? "");
    this.datasetName = this.peticion.datasetName ?? "";
    this.dataInfo = this.report?.dataInfo.find((d) => d.alias === this.datasetName);
    this.databaseAlias = this.dataInfo?.databaseAlias ?? "";
    this.schemaName = this.dataInfo?.schemaName ?? "";
    this.hubSchemaId = this.dataInfo?.hubSchemaId || undefined;
    this.parameters = (this.report?.params ?? []).map((p: any) => ({ name: p.alias ?? p.name ?? "", dataType: p.paramType != null ? String(p.paramType) : undefined })).filter((p) => p.name);
    this.auditedSql = this.expression;
    this.showAudit(this.dataInfo?.sqlExplanation ?? "", this.dataInfo?.sqlExplanationError ?? "");
    if (this.ai && this.databaseAlias) {
      try {
        this.schema = await this.ai.schemaForAlias(this.databaseAlias);
        if (this.schema?.error && !this.schema.tables.length) this.chat?.log.line("[Esquema] " + this.schema.error);
      } catch (err: any) {
        this.chat?.log.line("[Esquema] " + (err?.message ?? String(err)));
      }
    }
  }

  protected translate(key: string): string {
    return this.t.t(key);
  }

  // ---- chat (suggestion mode) ----

  /** The chat's handler: natural language → SQL, refining what is in the editor. */
  protected chatHandler = async (prompt: string, chat: AiChatComponent): Promise<void> => {
    if (!this.ai) return;
    const run = chat.run();
    const result = await this.ai.translateToSql(
      { prompt, sqlToRefine: this.currentSql(), databaseAlias: this.databaseAlias || undefined, ...this.schemaContext(), parameters: this.parameters },
      run.onProgress,
      run.signal
    );
    chat.finish(result);
    if (result.errorMessage) {
      chat.addError(result.errorMessage);
      return;
    }
    if (result.sql?.trim()) chat.setSuggestion(result.sql.trim(), result.explanation);
    else if (result.explanation?.trim()) chat.addAssistant(result.explanation.trim());
    else chat.addAssistant(chat.t.t("Ai_NoAnswer"), true, { local: true });
  };

  /** The part of the database chosen in the editor's header: the chat and the audit follow it while the dialog is open. */
  private schemaContext(): { schemaName?: string; hubSchemaId?: number } {
    return this.editor?.schemaContext() ?? { schemaName: this.schemaName || undefined };
  }

  protected applySql(sql: string): void {
    this.editor?.applyText(sql);
  }

  protected toggleChat(): void {
    this.chatOpen = !this.chatOpen;
    writeFlag(CHAT_OPEN_KEY, this.chatOpen);
  }

  // ---- audit ----

  protected onSqlChange(sql: string): void {
    const stale = !!this.auditHtml() && Texto.normalizarSaltosLinea(sql).trim() !== Texto.normalizarSaltosLinea(this.auditedSql).trim();
    this.auditStale.set(stale);
    if (this.error) {
      this.error = "";
      this.editor?.setError(null);
    }
  }

  /** ExplainSQL on the editor's text; the answer is kept in the dataset for the AI and shown to the developer. */
  protected async audit(): Promise<void> {
    if (!this.ai || this.auditTracker.busy()) return;
    const sql = this.currentSql();
    if (!sql.trim()) return;
    this.bottomTab = "audit";
    const signal = this.auditTracker.begin();
    this.chat?.log.line("[" + this.translate("Ai_Audit") + "] " + this.datasetName);
    try {
      const result = await this.ai.explainSql(
        { sql, databaseAlias: this.databaseAlias || undefined, ...this.schemaContext() },
        (p) => { this.auditTracker.progress(p); this.chat?.progress(p); },
        signal
      );
      this.auditTracker.finish(result.steps);
      if (result.errorMessage || !result.text?.trim()) {
        const message = result.errorMessage || this.translate("Ai_NoAnswer");
        this.setAudit({ sql, explanation: "", error: message });
        return;
      }
      this.auditedSql = sql;
      this.setAudit({ sql, explanation: result.text.trim(), error: "" });
      this.chat?.log.line("[" + this.translate("Ai_Audit") + "] " + this.translate("Ai_AuditSaved"));
    } catch (err: any) {
      this.auditTracker.finish();
      if (err?.name === "AbortError" || signal.aborted) return;
      this.setAudit({ sql, explanation: "", error: err?.message ?? String(err) });
    }
  }

  protected stopAudit(): void {
    this.auditTracker.stop();
  }

  /**
   * Shows the audit and keeps it with the SQL it explains. It goes into the dataset (what the .rep
   * keeps and the copilot reads) only while the dataset has that very SQL, as Delphi checks before
   * saving an audit; an audit of the edited text waits for «Aceptar».
   */
  private setAudit(audit: SqlAudit): void {
    if (this.dataInfo && sameSql(audit.sql, this.dataInfo.sql)) {
      this.dataInfo.sqlExplanation = audit.explanation;
      this.dataInfo.sqlExplanationError = audit.error;
      this.pendingAudit = undefined;
    } else {
      this.pendingAudit = audit;
    }
    this.showAudit(audit.explanation, audit.error);
  }

  private showAudit(explanation: string, error: string): void {
    const html = explanation ? renderAiMarkdown(explanation, { thinking: this.t.t("Ai_Thinking"), copy: this.t.t("Ai_CopyCode") }) : "";
    this.auditText.set(explanation);
    this.auditHtml.set(html);
    this.auditError.set(error);
    this.auditStale.set(false);
  }

  /** The audit is AI output: it carries the report action like every answer of the chat. */
  protected reportAudit(): void {
    if (!this.ai || !this.auditText().trim()) return;
    openAiReport(this.dialog, this.ai, this.auditText()).subscribe((sent) => {
      if (sent) this.chat?.addSystem(this.t.t("Ai_ReportSent"));
    });
  }

  protected onAuditEvent(event: Event): void {
    handleCodeCopy(event, { copy: this.t.t("Ai_CopyCode"), copied: this.t.t("Ai_CodeCopied") });
  }

  // ---- data ----

  protected currentSql(): string {
    return Texto.normalizarSaltosLinea(this.editor?.content ?? this.expression);
  }

  protected async open() {
    let loading: LoadingModal | undefined = await this.pres.mostrarLoading();
    this.error = "";
    this.editor?.setError(null);
    this.bottomTab = "data";
    try {
      const readRequest = new ReadReportRequest();
      readRequest.operation = ReadReportOperation.ReadDataset;
      readRequest.report = this.report;
      const sqlNormalized = this.currentSql();
      readRequest.expression = sqlNormalized;
      readRequest.datasetName = this.datasetName;
      const response = await this.reportService.getReadReportResponse(readRequest);
      if (!response.errorMessage) {
        loading.ocultar();
        loading = undefined;
        if (response.dataSets && response.dataSets.length) {
          this.dataset = response.dataSets[0];
        }
      } else {
        // The database's own words, kept in the dialog: a six second toast is gone before the
        // user has read the first line of a long SQL error.
        this.dataset = undefined;
        this.error = response.errorMessage;
        this.editor?.setError(locateSqlError(response.errorMessage, sqlNormalized));
      }
    } catch (err: any) {
      this.dataset = undefined;
      this.error = err?.error?.error ?? err?.error?.errorMessage ?? err?.message ?? String(err);
      this.editor?.setError(locateSqlError(this.error, this.currentSql()));
    } finally {
      if (loading != null) {
        loading.ocultar();
      }
    }
  }

  // ---- close ----

  public async confirm() {
    const sql = this.currentSql();
    if (this.dataInfo && !sameSql(this.expression, sql)) {
      // The new SQL clears the audit when it reaches the dataset (designer-interface-datainfo, as
      // Delphi's SetSQL); the designer offers to redo the audit first.
      if (this.ai && this.auditHtml() && this.auditStale()) {
        const again = await this.pres.pedirConfirmacion({ titulo: this.translate("Ai_Audit"), descripcion: this.translate("Ai_AuditReaudit") });
        if (again) {
          await this.audit();
          if (this.auditError()) return;
        }
      }
      // An audit of exactly this SQL goes back with it, to be written once the dataset has it.
      if (this.pendingAudit && sameSql(this.pendingAudit.sql, sql)) this.peticion.audit = this.pendingAudit;
    }
    // The part of the database chosen in the editor goes back too, for the dataset to keep it (D3).
    this.peticion.schema = this.editor?.acceptSchema() ?? undefined;
    this.cerrarModal(sql);
  }

  public cancel() {
    this.cerrarModal(undefined);
  }

  /** Escape or a click outside: an edited SQL is not thrown away without asking. */
  public async antesDeCerrar(): Promise<boolean> {
    if (sameSql(this.expression, this.currentSql())) return true;
    const discard = await this.pres.pedirConfirmacion({
      titulo: this.translate("DesignerUnappliedChanges"),
      descripcion: this.translate("DesignerDiscardSql"),
      textoPositivo: this.translate("DesignerDiscard"),
      textoNeutral: this.translate("DesignerKeepEditing"),
    });
    return discard === true;
  }

  public static async modifySql(
    pres: PresentacionService,
    peticion: PeticionSqlDialog
  ): Promise<string | undefined> {
    const modal = await pres.abrirModal(SqlDialogComponent, {
      peticion: peticion,
      alto: "100%",
      ancho: "100%",
    });
    return await modal.esperarResultadoModal();
  }

  protected override _actualizarFocus(): void | Promise<void> {
    this.editor?.focusEditor();
  }
}

export class PeticionSqlDialog {
  public report?: Report;
  public reportDatasetHelper?: ReportDatasetHelper;
  public initialSelection?: string;
  public datasetName?: string;
  /** Out: an audit made in the dialog for the SQL it returns, for the caller to store with it. */
  public audit?: SqlAudit;
  /**
   * Out: the part of the database chosen in the editor, for the caller to store in the dataset (D3): SchemaName, and
   * HubSchemaId when it is the Hub schema of an Agent connection. Absent: nothing was chosen, or nothing to keep.
   */
  public schema?: { schemaName: string; hubSchemaId?: number };
}

/** An audit (ExplainSQL) and the SQL text it explains. */
export interface SqlAudit {
  sql: string;
  explanation: string;
  error: string;
}

/**
 * Where a database put the error, from its message: PostgreSQL says "POSITION: n" (a character
 * offset), Firebird "line n, column m", SQL Server "Line n". Nothing located → the first line.
 */
export function locateSqlError(message: string, sql: string): SqlErrorMarker {
  const marker: SqlErrorMarker = { message };
  let m = /line\s+(\d+),\s*column\s+(\d+)/i.exec(message);
  if (m) {
    marker.line = Number(m[1]);
    marker.column = Number(m[2]);
    return marker;
  }
  m = /position:\s*(\d+)/i.exec(message);
  if (m) {
    const offset = Math.max(0, Number(m[1]) - 1);
    const before = sql.slice(0, offset);
    marker.line = before.split("\n").length;
    marker.column = offset - before.lastIndexOf("\n");
    return marker;
  }
  m = /\bline\s+(\d+)/i.exec(message);
  if (m) marker.line = Number(m[1]);
  return marker;
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch { return fallback; }
}

function writeFlag(key: string, value: boolean): void {
  try { localStorage.setItem(key, value ? "1" : "0"); } catch { /* private mode */ }
}
