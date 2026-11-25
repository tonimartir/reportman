import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  ViewEncapsulation,
  OnChanges,
  SimpleChanges,
  ViewChild,
  Inject,
  Optional,
  signal,
} from "@angular/core";

import { FormsModule } from "@angular/forms";
import { TranslationService } from "../../services/translator.service";
import { ReportDatasetHelper } from "../../models/report-dataset-helper";
import { FunctionHelp, ReadReportOperation, ReadReportRequest, Report, SyntaxCheckResult } from "@reportman/lib";
import { NgxReportmanLibService } from "../../services/ngx-reportman-lib.service";
import { PresentacionService } from "../../shell/presentacion.service";
import { SharedModule } from "../../shell/shared.module";
import { DESIGNER_AI, DesignerAi } from "../../shell/designer-ai";
import { ExpressionEditorComponent } from "../expression-editor/expression-editor.component";
import { AiChatComponent } from "../../ai/ai-chat.component";

const CHAT_OPEN_KEY = "rpd_expr_chat_open";

/**
 * The expression builder, laid out like the Delphi dialog: the expression on top, the categories
 * (fields, functions, variables, constants, operators) with their help underneath, and the AI chat
 * on the right in suggestion mode. The editor is Monaco with the expression language, so what the
 * list offers also comes up under the caret; the syntax check is the engine's, with the error marked.
 */
@Component({
  selector: "report-expression-builder",
  imports: [FormsModule, SharedModule, ExpressionEditorComponent],
  templateUrl: "./expression-builder.component.html",
  styleUrls: ["./expression-builder.component.css"],
  encapsulation: ViewEncapsulation.Emulated,
})
export class ExpressionBuilderComponent implements OnInit, OnChanges {
  @ViewChild(ExpressionEditorComponent) private editor?: ExpressionEditorComponent;
  @ViewChild(AiChatComponent) protected chat?: AiChatComponent;

  @Input() public expression = "";
  @Input() public report?: Report;
  @Input() public reportDatasetHelper?: ReportDatasetHelper;
  @Output() public okClicked = new EventEmitter<string>();
  @Output() public cancelClicked = new EventEmitter();

  public categories: string[] = [];
  public selectedCategory = "";
  public mappedFunctions = new Map<string, FunctionHelp[]>();
  public items: FunctionHelp[] = [];
  public selectedItem?: FunctionHelp;
  protected stringOk;
  protected stringCancel;
  protected stringActualizar;
  protected stringExpression;
  protected chatOpen = readFlag(CHAT_OPEN_KEY, true);
  /** The last syntax check: null = not checked since the last edit. */
  protected syntax = signal<SyntaxCheckResult | null>(null);
  protected checking = signal(false);
  protected evaluation = signal<{ value: string; type: string } | { error: string } | null>(null);
  private checkTimer?: any;

  constructor(
    protected t: TranslationService,
    private reportService: NgxReportmanLibService,
    private presentationService: PresentacionService,
    @Optional() @Inject(DESIGNER_AI) protected ai: DesignerAi | null
  ) {
    this.stringOk = t.TranslateStr(93) || "Aceptar";
    this.stringCancel = t.TranslateStr(94) || "Cancelar";
    this.stringActualizar = t.TranslateStr(1149) + " " + t.TranslateStr(247);
    this.stringExpression = t.TranslateStr(208);
  }

  public ngOnInit(): void {
    this.refreshData();
  }

  public ngOnChanges(changes: SimpleChanges): void {
    if (changes["reportDatasetHelper"]) {
      this.refreshData();
    }
  }

  /** The report's parameter aliases, for `M.` completion. */
  protected get parameters(): string[] {
    return (this.report?.params ?? []).map((p: any) => p.alias ?? "").filter((a: string) => a);
  }

  protected get allItems(): FunctionHelp[] {
    return this.reportDatasetHelper?.functions ?? [];
  }

  public async refreshData() {
    this.categories.splice(0, this.categories.length);
    this.mappedFunctions.clear();
    this.selectedItem = undefined;
    if (this.reportDatasetHelper?.functions) {
      for (const func of this.reportDatasetHelper.functions) {
        const category = func.category;
        if (!category) continue;
        if (!this.selectedCategory) {
          this.selectedCategory = category;
        }
        if (!this.mappedFunctions.get(category)) {
          this.mappedFunctions.set(category, []);
          this.categories.push(category);
        }
        this.mappedFunctions.get(category)?.push(func);
      }
      if (this.selectedCategory && this.mappedFunctions.has(this.selectedCategory)) {
        this.selectCategory(this.selectedCategory);
      } else if (this.categories.length) {
        this.selectCategory(this.categories[0]);
      }
    }
  }

  /** Reopens the datasets so the columns are current (the server remembers them otherwise). */
  public async refreshColumns() {
    if (!this.reportDatasetHelper) {
      return;
    }
    const loading = await this.presentationService.mostrarLoading();
    try {
      const readRequest = new ReadReportRequest();
      readRequest.operation = ReadReportOperation.ReadFunctionsColumns;
      readRequest.report = this.report;
      readRequest.properties = [{ name: "refresh", value: "true" }];
      const response = await this.reportService.getReadReportResponse(readRequest);
      if (!response.errorMessage) {
        this.reportDatasetHelper.functions = response.functions;
        this.reportDatasetHelper.dataSets = response.dataSets;
      } else {
        await this.presentationService.mostrarError(response.errorMessage);
      }
    } catch (err) {
      await this.presentationService.mostrarError(err);
    } finally {
      loading.ocultar();
    }
    this.refreshData();
  }

  // ---- editing ----

  protected onExpressionChange(text: string): void {
    this.expression = text;
    this.evaluation.set(null);
    if (this.syntax()) {
      this.syntax.set(null);
      this.editor?.setError(null);
    }
    // A quiet second after typing: the engine parses it (cheap: no datasets are opened once their columns are known).
    clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => this.checkSyntax(true), 900);
  }

  public currentExpression(): string {
    return this.editor?.content ?? this.expression;
  }

  /** The engine's parser on the current text; marks the error in the editor. */
  public async checkSyntax(silent = false): Promise<SyntaxCheckResult | null> {
    const expression = this.currentExpression();
    if (!expression.trim()) {
      this.syntax.set(null);
      this.editor?.setError(null);
      return null;
    }
    this.checking.set(true);
    try {
      const readRequest = new ReadReportRequest();
      readRequest.operation = ReadReportOperation.CheckSyntax;
      readRequest.report = this.report;
      readRequest.expression = expression;
      const response = await this.reportService.getReadReportResponse(readRequest);
      if (this.currentExpression() !== expression) return null; // typed on; this answer is old
      const result = response.syntaxCheck ?? { valid: false, message: response.errorMessage ?? "" };
      this.syntax.set(result);
      this.editor?.setError(result.valid ? null : { message: result.message ?? "", line: result.line, column: result.position });
      return result;
    } catch (err: any) {
      if (!silent) await this.presentationService.mostrarError(err);
      return null;
    } finally {
      this.checking.set(false);
    }
  }

  public async evaluate() {
    const expression = this.currentExpression();
    const loading = await this.presentationService.mostrarLoading();
    try {
      const readRequest = new ReadReportRequest();
      readRequest.operation = ReadReportOperation.Evaluate;
      readRequest.report = this.report;
      readRequest.expression = expression;
      const response = await this.reportService.getReadReportResponse(readRequest);
      if (!response.errorMessage) {
        this.evaluation.set({ value: String(response.evaluateResult?.value ?? ""), type: response.evaluateResult?.dataType ?? "" });
      } else {
        // The error stays in the dialog, next to the expression, instead of vanishing.
        this.evaluation.set({ error: response.errorMessage });
      }
    } catch (err: any) {
      this.evaluation.set({ error: err?.error?.error ?? err?.message ?? String(err) });
    } finally {
      loading.ocultar();
    }
  }

  protected isError(e: { value: string; type: string } | { error: string } | null): e is { error: string } {
    return !!e && "error" in e;
  }

  public accept() {
    this.okClicked.emit(this.currentExpression());
  }

  public cancel() {
    this.cancelClicked.emit();
  }

  public selectCategory(cat: string) {
    this.selectedCategory = cat;
    this.items = this.mappedFunctions.get(cat) ?? [];
  }

  public selectItem(item: FunctionHelp) {
    this.selectedItem = item;
  }

  /** Inserts the item where the caret is (a function with its parentheses). */
  public insertSelection(item: FunctionHelp) {
    const name = item.name ?? "";
    const isFunction = (item.model ?? "").includes("(") && /^[A-Za-z_]\w*$/.test(name);
    this.editor?.insertAtCursor(isFunction ? name + "()" : name);
  }

  public focus() {
    this.editor?.focusEditor();
  }

  // ---- chat (suggestion mode) ----

  protected toggleChat(): void {
    this.chatOpen = !this.chatOpen;
    writeFlag(CHAT_OPEN_KEY, this.chatOpen);
  }

  /**
   * The chat's handler: natural language → expression; the engine checks it and, when it does not
   * parse, the AI gets one chance to fix it (the Delphi dialog's rule), then it is offered anyway.
   */
  protected chatHandler = async (prompt: string, chat: AiChatComponent): Promise<void> => {
    if (!this.ai) return;
    const run = chat.run();
    const current = this.currentExpression();
    let result = await this.ai.suggestExpression(
      { prompt, currentExpression: current, cursorPosition: this.editor?.cursorOffset() ?? current.length, fix: false, report: this.report },
      run.onProgress,
      run.signal
    );
    if (result.errorMessage) {
      chat.finish(result);
      chat.addError(result.errorMessage);
      return;
    }
    let expression = result.expression?.trim() ?? "";
    if (!expression) {
      chat.finish(result);
      if (result.explanation?.trim()) chat.addAssistant(result.explanation.trim());
      else chat.addAssistant(chat.t.t("Ai_NoAnswer"), true, { local: true });
      return;
    }
    let check = await this.checkText(expression);
    let fixed = false;
    if (check && !check.valid) {
      chat.addSystem(chat.t.t("Ai_Fixing"));
      const retry = await this.ai.suggestExpression(
        { prompt, currentExpression: expression, cursorPosition: expression.length, fix: true, report: this.report },
        run.onProgress,
        run.signal
      );
      if (!retry.errorMessage && retry.expression?.trim()) {
        expression = retry.expression.trim();
        result = { ...retry, steps: [...(result.steps ?? []), ...(retry.steps ?? [])] };
        check = await this.checkText(expression);
        fixed = !!check?.valid;
      }
    }
    chat.finish(result);
    let explanation = result.explanation?.trim() || chat.t.t("Ai_ExpressionGenerated");
    if (fixed) explanation = chat.t.t("Ai_Fixed") + "\n\n" + explanation;
    else if (check && !check.valid) explanation = chat.t.t("Ai_StillInvalid", { error: check.message ?? "" }) + "\n\n" + explanation;
    chat.setSuggestion(expression, explanation);
  };

  private async checkText(expression: string): Promise<SyntaxCheckResult | null> {
    try {
      const readRequest = new ReadReportRequest();
      readRequest.operation = ReadReportOperation.CheckSyntax;
      readRequest.report = this.report;
      readRequest.expression = expression;
      const response = await this.reportService.getReadReportResponse(readRequest);
      return response.syntaxCheck ?? null;
    } catch {
      return null;
    }
  }

  protected applySuggestion(expression: string): void {
    this.editor?.applyText(expression);
    this.expression = expression;
    this.checkSyntax(true);
  }
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
