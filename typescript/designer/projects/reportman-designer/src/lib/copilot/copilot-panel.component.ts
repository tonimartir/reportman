import { Component, OnInit, ViewChild, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { AiChatComponent } from '../ai/ai-chat.component';
import { ReportEditorComponent } from '../report-editor/report-editor.component';
import { sameSql } from '../models/designer-interface-datainfo';
import { TranslationService } from '../services/translator.service';
import { AiAccountService } from '../server/ai-account.service';
import { DatabaseConfig, HubDatabasesService } from '../server/hub-databases.service';
import { ClientSqlResult, CopilotApiService, TokenUsage } from '../server/copilot-api.service';
import { DesignerDocsService } from '../server/designer-docs.service';
import { DesignerAiBridgeService } from '../server/designer-ai-bridge.service';
import { DESIGNER_HOST, resolveDesignerHost } from '../server/designer-host';
import type { DesignerAiSubschema } from '../shell/designer-ai';
import { SchemaChoice, SchemaChosen } from './schema-choice';
import { SchemaSelectorComponent } from './schema-selector.component';

/**
 * How many times one prompt may wait for the server to run SQL for the cloud: the cloud stops itself
 * (four runs per dataset, five steps), this only guards the page against a cloud that never would.
 */
const MAX_CLIENT_SQL_TURNS = 30;

/**
 * The AI copilot of the designer: the shared chat frame in design mode (the Delphi designer's
 * TFRpChatFrame on the main window). A prompt makes the cloud rewrite the whole report: live
 * context from the designer's server (datasets opened there), the SQL audits that are missing, the document
 * as XML, ModifyReport, and the answer replaces the document, with the canvas locked meanwhile.
 * The UndoCue travels inside the document: the cloud records its operations in it and returns
 * it extended, so the editor's own Undo reverts an AI change like any other (the Delphi rule).
 */
@Component({
  selector: 'rp-copilot-panel',
  imports: [MatIconModule, MatTooltipModule, MatMenuModule, AiChatComponent, SchemaSelectorComponent],
  template: `
    <rp-ai-chat
      mode="design"
      [showSchema]="false"
      [schemaRow]="true"
      [initialMessage]="t.t('CopilotHint')"
      [handler]="handler"
      (refresh)="refreshContext()"
    >
      <!-- Below the provider, mode and gauge: the part of the database the AI reads (local and cloud in one list, the
           schema screens) and the copilot's menu. -->
      <ng-container rpChatSchemaExtra>
        <rp-schema-selector [choice]="schemas" (chosen)="schemaChosen($event)"></rp-schema-selector>
        <button type="button" class="rpd-tool rpd-tool-sm" [matMenuTriggerFor]="moreMenu" [matTooltip]="t.t('More')" [matTooltipShowDelay]="400" [attr.aria-label]="t.t('More')">
          <span class="material-icons" aria-hidden="true">more_vert</span>
        </button>
        <mat-menu #moreMenu="matMenu" class="rp-designer-menu">
          <button mat-menu-item (click)="hub.load(true)"><mat-icon>refresh</mat-icon>{{ t.t('CopilotReloadDatabases') }}</button>
          <button mat-menu-item (click)="designerAi.setSqlAutoComplete(!designerAi.sqlAutoComplete())"><mat-icon>{{ designerAi.sqlAutoComplete() ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>{{ t.t('CopilotSqlAutoComplete') }}</button>
        </mat-menu>
      </ng-container>
    </rp-ai-chat>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
  `],
})
export class CopilotPanelComponent implements OnInit {
  /** The editor whose document the copilot works on. */
  readonly editor = input.required<ReportEditorComponent | undefined>();
  readonly closed = output<void>();
  readonly applied = output<void>();

  readonly hub = inject(HubDatabasesService);
  readonly api = inject(CopilotApiService);
  readonly designerAi = inject(DesignerAiBridgeService);
  readonly t = inject(TranslationService);
  private docs = inject(DesignerDocsService);
  private aiAccount = inject(AiAccountService);
  private host = resolveDesignerHost(inject(DESIGNER_HOST, { optional: true }));

  @ViewChild(AiChatComponent) chat?: AiChatComponent;

  private contextJson = '';
  private schemaResolved = false;
  /**
   * The host's own database behind the report's connection, sent inline: a report of a host application reads the
   * host's own database, which is in no Hub, so the account's Hub databases are not offered then (the
   * selector would name a database the report does not use). Null: the Hub database, as always.
   */
  readonly reportConfig = signal<DatabaseConfig | null>(null);
  /**
   * F5, one list, local and cloud: the report's direct connection
   * (its tables, subschemas and who made them), what is chosen, the Hub database behind its Agent connection. The
   * cloud schema chosen is the Hub selection, which the chat's other selectors share.
   */
  readonly schemas = new SchemaChoice({ selectedHub: () => this.hub.selected() });
  /**
   * The named parts of that database (a host's business areas, a connection file's subschemas) and the one
   * chosen ('' = all): only its tables travel, a fraction of the whole map.
   */
  readonly subschemas = computed<DesignerAiSubschema[]>(() => this.schemas.info()?.schemas ?? []);
  readonly subschema = signal('');
  /** The schema the new report wizard chose, when the account's list does not have it. */
  private wizardConfig: { hubDatabaseId: number; hubSchemaId: number } | null = null;
  /** The person chose in the list: the copilot no longer moves away from an «all» over the plan by itself. */
  private chosenByHand = false;

  constructor() {
    // The plan arrives after the list (the account's status): a host's «all» over it is not the default.
    effect(() => {
      this.aiAccount.planLimits();
      this.schemas.localOptions();
      untracked(() => this.avoidOverPlanDefault());
    });
  }

  async ngOnInit(): Promise<void> {
    await this.hub.load();
    this.resolveInitialSchema();
  }

  /**
   * A schema of the list, chosen by hand or by the list itself: a subschema just made in the local schema screen
   * (another tab), or the one chosen read again from it (what the other tab changed travels from the next prompt on).
   */
  async schemaChosen(chosen: SchemaChosen): Promise<void> {
    if (chosen.byHand) this.chosenByHand = true;
    if (chosen.key.startsWith('local:')) {
      await this.chooseSubschema(chosen.key.substring('local:'.length), chosen.remember);
    } else if (chosen.key.startsWith('hub:')) {
      this.reportConfig.set(null);
      this.hub.select(Number(chosen.key.substring('hub:'.length)));
    }
  }

  /** A host's «all» over the plan: its first area that fits, unless the person or the report chose. */
  private avoidOverPlanDefault(): void {
    if (this.chosenByHand || this.schemas.info()?.source !== 'host' || this.schemas.selectedKey() !== 'local:') return;
    const options = this.schemas.localOptions();
    if (!options[0]?.warn) return;
    const fits = options.find((o) => o.key !== 'local:' && !o.warn);
    if (fits) {
      this.schemas.selectedKey.set(fits.key);
      void this.chooseSubschema(fits.key.substring('local:'.length), false);
    }
  }

  /**
   * The schema the copilot starts with: the database behind the report's Agent alias (what really
   * runs here), else the hubSchemaId the first dataset remembers (the C# designer's rule). Once the
   * report is there it runs once; the wizard's start waits for it (`resolving`) instead of racing it.
   */
  private resolveInitialSchema(): void {
    if (this.schemaResolved) return;
    const report = this.editor()?.report;
    if (!report) {
      setTimeout(() => this.resolveInitialSchema(), 500);
      return;
    }
    this.schemaResolved = true;
    this.resolving = this.resolveFrom(report);
  }

  private resolving: Promise<void> | null = null;

  private async resolveFrom(report: any): Promise<void> {
    try {
      // The server says which Hub database each Agent alias reaches (its SqlSchema).
      for (const db of report.databaseInfo ?? []) {
        if (!db.alias) continue;
        const info = await this.designerAi.schemaForAlias(db.alias);
        // A database the server describes (a direct alias with tables, or an Agent alias with a local file): it goes inline.
        if (info && (info.kind === 'direct' || info.source === 'file') && info.tables.length) {
          const parts = info.schemas ?? [];
          // D3: the part a dataset of this connection was made with wins; then the one chosen here last time;
          // F8 (A3): with a connection's file, then its first subschema, and nothing without one (never its dictionary).
          const ofDataset = (report.dataInfo ?? []).map((d: any) => d.databaseAlias?.toUpperCase() === db.alias!.toUpperCase() ? d.schemaName : '')
            .find((n: string) => !!n && parts.some((p) => p.name === n));
          const agent = info.kind === 'agent' ? info.hubDatabaseId ?? 0 : 0;
          if (agent) this.schemas.agentHubDatabaseId.set(agent);
          // An Agent alias starts with its Hub schema, as before, unless a dataset or the last choice here was a
          // subschema of its file; its subschemas are in the list anyway.
          const remembered = DesignerAiBridgeService.rememberedSubschema(db.alias);
          if (agent && !ofDataset && !parts.some((p) => p.name === remembered)) {
            this.schemas.alias.set(db.alias);
            this.schemas.info.set(info);
            const ofAgent = this.hub.byHubDatabaseId(agent);
            if (ofAgent) { this.hub.select(ofAgent.hubSchemaId); this.schemas.selectedKey.set('hub:' + ofAgent.hubSchemaId); return; }
            continue;
          }
          if (ofDataset) this.chosenByHand = true;
          const start = this.schemas.startLocal(db.alias, info, ofDataset);
          this.subschema.set(start);
          this.reportConfig.set(await this.designerAi.inlineConfigFor(db.alias, start || undefined));
          this.avoidOverPlanDefault();
          return;
        }
        if (info?.kind === 'agent' && info.hubDatabaseId) {
          this.schemas.agentHubDatabaseId.set(info.hubDatabaseId);
          // Its alias, for «New local schema»: its screen makes the file from the catalog its Agent reads
          if (!this.schemas.alias()) this.schemas.alias.set(db.alias);
        }
        const found = info?.kind === 'agent' && info.hubDatabaseId ? this.hub.byHubDatabaseId(info.hubDatabaseId) : null;
        if (found) { this.hub.select(found.hubSchemaId); this.schemas.selectedKey.set('hub:' + found.hubSchemaId); return; }
      }
    } catch { /* fall through */ }
    const first: any = report.dataInfo?.[0];
    if (first?.hubSchemaId && this.hub.databases().some((d) => d.hubSchemaId === first.hubSchemaId)) {
      this.hub.select(first.hubSchemaId);
    }
    const selected = this.hub.selected();
    if (selected) this.schemas.selectedKey.set('hub:' + selected.hubSchemaId);
  }

  /**
   * The new report wizard's text (Delphi's pending prompt): once the report and the chat are
   * there, the copilot takes the schema the wizard chose — a Hub schema, or a subschema of the
   * local file of the report's connection (F8) — and designs with that text.
   */
  async startDesignPrompt(prompt: string, hubDatabaseId: number, hubSchemaId: number, subschema = ''): Promise<void> {
    for (let i = 0; i < 75 && (!this.editor()?.report || !this.chat); i++) await new Promise((r) => setTimeout(r, 200));
    const chat = this.chat;
    const report = this.editor()?.report;
    if (!chat || !report) return;
    // A start of the report's own defaults that is under way ends first: the wizard's choice goes over it.
    if (this.resolving) await this.resolving;
    this.schemaResolved = true;
    if (subschema) {
      // Gone from the file meanwhile: the report's own start, as if the wizard had chosen nothing.
      if (!(await this.chooseWizardSubschema(report, subschema)) && !this.resolving) await (this.resolving = this.resolveFrom(report));
    } else if (hubSchemaId) {
      await this.hub.load();
      this.hub.select(hubSchemaId);
      this.schemas.selectedKey.set('hub:' + hubSchemaId);
      if (!this.hub.selected()) this.wizardConfig = { hubDatabaseId, hubSchemaId };
      if (hubDatabaseId) this.schemas.agentHubDatabaseId.set(hubDatabaseId);
    }
    chat.prompt = prompt;
    await chat.send();
  }

  /**
   * A request left in the prompt box, not sent (the one a sample report suggests to try the copilot):
   * once the chat is there, and never over a text the person already typed.
   */
  async setDraftPrompt(prompt: string): Promise<void> {
    if (!prompt.trim()) return;
    for (let i = 0; i < 75 && !this.chat; i++) await new Promise((r) => setTimeout(r, 200));
    const chat = this.chat;
    if (!chat || chat.prompt.trim()) return;
    chat.setPrompt(prompt);
  }

  /**
   * The wizard's local subschema, chosen as if by hand (and remembered for its connection): the report's direct
   * connection whose file has it. The report names the wizard's connection, so the file is the one it listed.
   */
  private async chooseWizardSubschema(report: any, subschema: string): Promise<boolean> {
    for (const db of report.databaseInfo ?? []) {
      const info = db.alias ? await this.designerAi.schemaForAlias(db.alias) : null;
      if (!info || (info.kind !== 'direct' && info.source !== 'file') || !info.tables.length || !(info.schemas ?? []).some((p) => p.name === subschema)) continue;
      if (info.kind === 'agent' && info.hubDatabaseId) this.schemas.agentHubDatabaseId.set(info.hubDatabaseId);
      this.schemas.alias.set(db.alias);
      this.schemas.info.set(info);
      this.chosenByHand = true;
      this.schemas.selectedKey.set('local:' + subschema);
      await this.chooseSubschema(subschema);
      return true;
    }
    return false;
  }

  /** One design prompt: context → missing audits → ModifyReport → the document is replaced. */
  handler = async (text: string, chat: AiChatComponent): Promise<void> => {
    const editor = this.editor();
    if (!editor?.report) return;
    // F8: to the AI goes a subschema of the connection's file or a cloud schema, never the whole dictionary; and a
    // schema over the plan is not sent to the cloud (the AI on an Agent has no limit: no ⚠ then). Nothing is called.
    if (this.schemas.missingSubschema() || (this.schemas.info()?.source === 'file' && this.schemas.selectedKey().startsWith('local:') && !this.reportConfig())) {
      chat.addError(this.t.t('CopilotChooseSubschema', { alias: this.schemas.alias() }));
      return;
    }
    if (this.schemas.selectedWarns()) {
      chat.addError(this.t.t('CopilotOverPlan'));
      return;
    }
    const run = chat.run();
    const config = this.config();
    editor.setAiBusy(true, this.t.t('CopilotStagePreparing'));
    const stopSub = editor.aiStopRequested.subscribe(() => chat.stop());
    try {
      // 1. Live context from the designer's server (datasets opened there, cached per SQL).
      chat.addSystem(this.t.t('CopilotStagePreparing'));
      const live = await this.docs.aiContext(editor.documentJson());
      if (live.openErrors?.length) {
        chat.addSystem(this.t.t('CopilotOpenErrors') + '\n' + live.openErrors.join('\n'));
      }
      // 2. The audit of every dataset that lacks one: what the AI reads to know what each SQL does.
      const pending = (editor.report.dataInfo ?? []).filter((d: any) => (d.sql ?? '').trim() && !d.sqlExplanation && !d.sqlExplanationError);
      if (pending.length) {
        editor.setAiBusy(true, this.t.t('CopilotStagePreprocess'));
        chat.addSystem(this.t.t('CopilotStagePreprocess') + ' ' + pending.map((d: any) => d.alias).join(', '));
        const sent = pending.map((d: any) => ({ dataInfoName: d.alias, databaseAlias: d.databaseAlias ?? '', sql: d.sql }));
        const pre = await this.api.preprocessSqlContextStream(config, sent, run.onProgress, run.signal);
        if (pre.userProfile) this.aiAccount.updateCredits(pre.userProfile);
        for (const ds of pre.result?.dataSources ?? []) {
          const target: any = editor.report.dataInfo.find((d: any) => d.alias === ds.dataInfoName);
          // As Delphi: an audit is kept only if the dataset still has the SQL that was audited.
          const audited = sent.find((s: any) => s.dataInfoName === ds.dataInfoName);
          if (!target || !audited || !sameSql(audited.sql, target.sql)) continue;
          if (ds.sqlExplanation) target.sqlExplanation = ds.sqlExplanation;
          if (ds.errorMessage) target.sqlExplanationError = ds.errorMessage;
        }
      }
      // 3. Merge the cloud's last contextJson with the fresh live context.
      let previous: any = {};
      try { previous = this.contextJson ? JSON.parse(this.contextJson) : {}; } catch { previous = {}; }
      const merged = { ...previous, expressionContext: live.expressionContext, runtimeDataSources: live.runtimeDataSources };
      // 4. The document as XML (the proven round trip) and the call. While the cloud waits for the
      //    columns of a SQL it cannot run (a connection of this server, not of the Hub), the server runs
      //    it and the call goes on with them.
      editor.setAiBusy(true, this.t.t('CopilotStageSending'));
      const xml = await this.docs.toXml(editor.documentJson());
      let sentXml = xml;
      const steps: TokenUsage[] = [];
      let result = await this.api.modifyReportStream({ reportDocument: xml, config, userInstructions: [text], existingContextJson: JSON.stringify(merged) }, run.onProgress, run.signal);
      for (let turn = 0; result.result?.status === 'NeedsClientSqlResults' && turn < MAX_CLIENT_SQL_TURNS; turn++) {
        if (result.userProfile) this.aiAccount.updateCredits(result.userProfile);
        steps.push(...(result.steps ?? []));
        const waiting = result.result;
        const asked = waiting.clientSqlRequests ?? [];
        sentXml = waiting.modifiedReportDocument || sentXml;
        editor.setAiBusy(true, this.t.t('CopilotStageRunningSql'));
        chat.addSystem(this.t.t('CopilotStageRunningSql') + ' ' + asked.map((q) => q.datasetAlias || q.databaseAlias).join(', '));
        const answers: ClientSqlResult[] = [];
        for (const q of asked) {
          try {
            const reply = await this.docs.sqlColumns(sentXml, q.databaseAlias, q.sql, q.parameters);
            answers.push(reply.error ? { id: q.id, success: false, errorMessage: reply.error } : { id: q.id, success: true, columns: reply.columns ?? [] });
          } catch (err: any) {
            answers.push({ id: q.id, success: false, errorMessage: err?.error?.error ?? err?.message ?? String(err) });
          }
        }
        result = await this.api.modifyReportStream({ reportDocument: sentXml, config, userInstructions: [text], existingContextJson: waiting.workingContextJson ?? '', continuation: waiting.continuation, clientSqlResults: answers }, run.onProgress, run.signal);
      }
      if (result.userProfile) this.aiAccount.updateCredits(result.userProfile);
      steps.push(...(result.steps ?? []));
      chat.finish({ ...result, steps });
      if (result.result?.status === 'NeedsClientSqlResults') {
        chat.addError(this.t.t('CopilotTooManyTurns'));
        return;
      }
      // 5. Outcome, in the clients' order: root error, result error, then apply + explain.
      if (result.errorMessage) {
        chat.addError(result.errorMessage + (result.debugDetails ? '\n' + result.debugDetails : ''));
        return;
      }
      const r = result.result ?? {};
      if (r.errorMessage) {
        chat.addError(r.errorMessage);
        return;
      }
      if (r.contextJson) this.contextJson = r.contextJson;
      let appliedNow = false;
      // After turns, an empty document means the last one sent (it carries the datasets made on the way).
      const document = r.modifiedReportDocument || (sentXml !== xml ? sentXml : '');
      if (document) {
        editor.setAiBusy(true, this.t.t('CopilotStageApplying'));
        // The document comes back with its UndoCue extended by the AI's operations: load it as is.
        const json = await this.docs.fromXml(document);
        editor.replaceReport(json, true);
        await this.ensureConnections(editor, config, chat);
        appliedNow = true;
        this.applied.emit();
      }
      const tools = (r.toolExecutions ?? []).filter((t) => t.toolName).map((t) => '- ' + t.toolName + (t.createdDatasetName ? ' → ' + t.createdDatasetName : '') + (t.status ? ' (' + t.status + ')' : ''));
      const explanation = r.explanation?.trim() || (appliedNow ? this.t.t('CopilotUpdated') : this.t.t('CopilotNoChanges'));
      // «Applied» only when everything of the turn happened: a tool that was blocked or failed (a
      // dataset for a subreport not made yet) or a turn the server ended Blocked/Failed applied part.
      const partial = appliedNow && (r.status === 'Blocked' || r.status === 'Failed'
        || (r.toolExecutions ?? []).some((t) => !!t.status && t.status !== 'Succeeded'));
      // Without an explanation or tools the text is the designer's own ("updated", "no changes"): nothing of the AI to report.
      chat.addAssistant(explanation + (tools.length ? '\n\n' + tools.join('\n') : ''), true, { applied: appliedNow, partial, local: !r.explanation?.trim() && !tools.length });
    } finally {
      stopSub.unsubscribe();
      editor.setAiBusy(false);
    }
  };

  /** Another part of the database for the next prompts; remembered for this connection when the person chose it. */
  async chooseSubschema(name: string, remember = true): Promise<void> {
    this.subschema.set(name ?? '');
    if (remember) DesignerAiBridgeService.rememberSubschema(this.schemas.alias(), name ?? '');
    const config = await this.designerAi.inlineConfigFor(this.schemas.alias(), name || undefined);
    // A file's subschema that cannot be sent leaves nothing to send (F8), not the part chosen before.
    if (config || this.schemas.info()?.source === 'file') this.reportConfig.set(config);
  }

  /** Reopens the datasets and rebuilds the live context (the chat's second button in design mode). */
  async refreshContext(): Promise<void> {
    const editor = this.editor();
    const chat = this.chat;
    if (!editor?.report || !chat) return;
    try {
      const live = await this.docs.aiContext(editor.documentJson(), true);
      chat.addSystem(live.openErrors?.length ? this.t.t('CopilotContextRefreshedErrors') + '\n' + live.openErrors.join('\n') : this.t.t('CopilotContextRefreshed'));
    } catch (err: any) {
      chat.addError(err?.error?.error ?? err?.message ?? String(err));
    }
  }

  // ---- helpers ----

  private config(): { hubDatabaseId: number; hubSchemaId: number } | null {
    const inline = this.reportConfig();
    if (inline) return inline;
    const db = this.hub.selected();
    if (db) return { hubDatabaseId: db.hubDatabaseId, hubSchemaId: db.hubSchemaId };
    // The schema of the wizard's connection, while nobody chose another one in the chat.
    return this.wizardConfig && this.hub.selectedSchemaId() === this.wizardConfig.hubSchemaId ? this.wizardConfig : null;
  }

  /**
   * RpEnsureAgentConnections + RpCheckAgentConnections: the cloud adds connections to the document by
   * alias only, and the alias must run on the server. What to do about it is the host's
   * (Reportman.Server offers its connection wizard on the database the copilot worked with).
   */
  private async ensureConnections(editor: ReportEditorComponent, config: { hubDatabaseId: number; hubSchemaId: number } | null, chat: AiChatComponent): Promise<void> {
    if (!editor.report) return;
    try {
      await this.host.checkReportConnections?.(editor.report, config?.hubDatabaseId);
    } catch (err: any) {
      chat.addSystem(this.t.t('CopilotConnectionFailed') + ' ' + (err?.error?.error ?? err?.message ?? ''));
    }
  }
}
