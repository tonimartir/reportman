import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AiExpressionResult, AiNetLine, AiProgressHandler, AiSqlCodeSuggestions, AiSqlResult, AiTextResult } from '../ai/ai-types';
import {
  DesignerAi, DesignerAiExplainContext, DesignerAiExpressionContext, DesignerAiOption, DesignerAiRelationRef, DesignerAiSchemaInfo, DesignerAiSchemaOption, DesignerAiSchemaTable, DesignerAiScope, DesignerAiSelection, DesignerAiSqlChatContext, DesignerAiSqlCodeContext, DesignerAiSubschema,
} from '../shell/designer-ai';
import { TranslationService } from '../services/translator.service';
import { AiAccountService } from './ai-account.service';
import { CopilotApiService, QueryApiResult } from './copilot-api.service';
import { AiConfigService, AiMode } from './ai-config.service';
import { DatabaseConfig, HubDatabasesService, hubSchemaLabel, isAgentOffline } from './hub-databases.service';
import { DesignerDocsService } from './designer-docs.service';
import { DESIGNER_HOST, resolveDesignerHost } from './designer-host';

const AUTOCOMPLETE_KEY = 'rpsrv_sql_autocomplete';
/** The subschema last chosen in the copilot for a connection (per alias). */
const SUBSCHEMA_KEY = 'rpd_copilot_subschema_';

/** The server's answer to GET /api/designer/SqlSchema. */
interface ServerSqlSchema {
  alias: string;
  kind: 'agent' | 'direct' | 'unknown';
  dialect: string;
  hubDatabaseId?: number | null;
  hubSchemaId?: number | null;
  schemaTables: { name: string; context?: string; columns: { name: string; dataType: string; detectedType?: string; isPrimaryKey?: boolean; context?: string; allowedValues?: { value: string; label?: string }[] }[]; foreignKeys?: any[] }[];
  schemas?: { name: string; description?: string; tables: string[]; columns?: Record<string, string[]> | null; excludedRelations?: DesignerAiRelationRef[] | null }[];
  excludedRelations?: DesignerAiRelationRef[] | null;
  error?: string | null;
  source?: string;
}

/**
 * The designer's AI through its server (DESIGNER_AI, provided by provideReportmanDesigner): the
 * account's settings and credits, the Hub schemas, the schema of any connection alias (served by
 * the designer's server, inline for the cloud), and the streamed calls to the cloud endpoints the
 * Delphi and C# designers use, through the server's bridge.
 */
@Injectable({ providedIn: 'root' })
export class DesignerAiBridgeService implements DesignerAi {
  private api = inject(CopilotApiService);
  private hub = inject(HubDatabasesService);
  private host = resolveDesignerHost(inject(DESIGNER_HOST, { optional: true }));
  private aiAccount = inject(AiAccountService);
  private http = inject(HttpClient);
  private docs = inject(DesignerDocsService);
  private t = inject(TranslationService);
  private aiConfig = inject(AiConfigService);

  // ---- settings ----
  readonly providers = computed<DesignerAiOption[]>(() => this.aiConfig.providers().map((p) => ({ value: p.value, label: p.label, description: p.description, icon: p.icon })));
  readonly modes = computed<DesignerAiOption[]>(() => this.aiConfig.modes().map((m) => ({ value: m.value, label: m.label })));
  readonly creditsRatio = computed(() => this.aiAccount.creditsRatio());
  readonly usingBag = computed(() => this.aiAccount.usingBag());
  /** As the host says (Reportman.Server: whoever designs); without a Reportman AI login, the installation's guest credits pay. */
  readonly available = computed(() => this.enabled() && this.host.aiAvailable());
  readonly enabled = (): boolean => this.host.aiEnabled?.() ?? true;
  /** The Reportman AI account: the card on top of every chat. */
  readonly account = this.aiAccount;
  /**
   * SQL autocompletion while typing. Delphi's default is on; here it is on for an account with
   * credits and off for guests, until the person decides (persisted).
   */
  readonly sqlAutoComplete = signal<boolean>(readFlag(AUTOCOMPLETE_KEY) ?? false);

  // ---- schemas ----
  readonly schemas = computed<DesignerAiSchemaOption[]>(() => this.hub.databases().map((d) => ({ id: d.hubSchemaId, name: hubSchemaLabel(d), offline: isAgentOffline(d), example: !!d.isExample })));
  readonly selectedSchemaId = this.hub.selectedSchemaId;

  readonly netLog = signal<AiNetLine[]>([]);
  private schemaCache = new Map<string, Promise<DesignerAiSchemaInfo | null>>();
  private selections = new Map<DesignerAiScope, DesignerAiSelection>();

  constructor() {
    if (readFlag(AUTOCOMPLETE_KEY) === null) {
      // No decision yet: on once the account is known to have credits.
      setTimeout(() => { if (readFlag(AUTOCOMPLETE_KEY) === null && this.available()) this.sqlAutoComplete.set(true); }, 1500);
    }
  }

  /** Each assistant's provider and mode, kept by AiConfigService (one per scope, in localStorage). */
  selection(scope: DesignerAiScope): DesignerAiSelection {
    let found = this.selections.get(scope);
    if (!found) {
      const s = this.aiConfig.selection(scope);
      found = {
        provider: s.provider,
        mode: s.mode,
        consumesCredits: s.consumesCredits,
        setProvider: (value: string) => s.setProvider(value),
        setMode: (value: string) => s.setMode(value as AiMode),
      };
      this.selections.set(scope, found);
    }
    return found;
  }

  creditsTooltip(): string {
    const a = this.aiAccount;
    if (a.usesFreeCredits() || a.usingBag()) {
      const initial = a.profile()?.freeInitial ?? 0;
      return this.t.t('CreditsBag') + ': ' + a.freeCreditsConsumed().toLocaleString() + ' / ' + initial.toLocaleString();
    }
    return this.t.t('CreditsDaily') + ': ' + a.dailyCreditsConsumed().toLocaleString() + ' / ' + a.dailyCreditsMax().toLocaleString();
  }

  setSqlAutoComplete(value: boolean): void {
    this.sqlAutoComplete.set(value);
    try { localStorage.setItem(AUTOCOMPLETE_KEY, value ? '1' : '0'); } catch { /* private mode */ }
  }

  selectSchema(id: number | null): void {
    this.hub.select(id);
  }

  async reloadSchemas(): Promise<void> {
    await this.hub.load(true);
    this.schemaCache.clear();
  }

  /**
   * GET {designer}/SqlSchema: the server reads the catalog (direct) or the Hub (agent); cached per alias here too.
   * `refresh` makes the server read the database again; `reload` only asks the server again (a subschema edited in
   * another tab).
   */
  schemaForAlias(alias: string, refresh = false, reload = false): Promise<DesignerAiSchemaInfo | null> {
    const key = alias.toUpperCase();
    if (!refresh && !reload && this.schemaCache.has(key)) return this.schemaCache.get(key)!;
    const promise = (async (): Promise<DesignerAiSchemaInfo | null> => {
      try {
        const s = await firstValueFrom(this.http.get<ServerSqlSchema>(this.docs.url('SqlSchema'), { params: { alias, refresh: refresh ? 'true' : 'false' } }));
        return {
          alias: s.alias, kind: s.kind, dialect: s.dialect, hubDatabaseId: s.hubDatabaseId ?? null, hubSchemaId: s.hubSchemaId ?? null, error: s.error ?? undefined, source: s.source ?? undefined,
          tables: (s.schemaTables ?? []).map((t) => ({ name: t.name, context: t.context, columns: t.columns ?? [], foreignKeys: t.foreignKeys })),
          schemas: (s.schemas ?? []).filter((x) => x.name && x.tables?.length),
          excludedRelations: s.excludedRelations ?? null,
        };
      } catch (err: any) {
        this.net('SqlSchema ' + alias + ': ' + (err?.error?.error ?? err?.message ?? String(err)));
        return null;
      }
    })();
    this.schemaCache.set(key, promise);
    promise.then((s) => { if (!s || (s.error && !s.tables.length)) this.schemaCache.delete(key); });
    return promise;
  }

  // ---- inferences ----

  async suggestSqlCode(context: DesignerAiSqlCodeContext, onProgress: AiProgressHandler, signal: AbortSignal): Promise<AiSqlCodeSuggestions> {
    const config = await this.sqlConfig(context);
    if (!config) return { inline: [], list: [], errorMessage: await this.needsSchema(context.databaseAlias) };
    const r = await this.call(() => this.api.suggestSqlCodeStream(config, context.sql, context.cursorPosition, onProgress, signal, parametersOf(context.parameters)));
    const ac = r.result?.autoComplete;
    return { inline: ac?.inlineCompletions ?? [], list: ac?.listCompletions ?? [], errorMessage: r.errorMessage || r.result?.errorMessage || undefined, userProfile: r.userProfile, steps: r.result?.steps };
  }

  async translateToSql(context: DesignerAiSqlChatContext, onProgress: AiProgressHandler, signal: AbortSignal): Promise<AiSqlResult> {
    const config = await this.sqlConfig(context);
    if (!config) return { errorMessage: await this.needsSchema(context.databaseAlias) };
    const r = await this.call(() => this.api.translateToSqlStream(config, context.prompt, context.sqlToRefine, onProgress, signal, parametersOf(context.parameters)));
    return { sql: r.result?.sql, explanation: r.result?.explanation, errorMessage: r.errorMessage || r.result?.errorMessage || undefined, userProfile: r.userProfile, steps: r.result?.steps };
  }

  async explainSql(context: DesignerAiExplainContext, onProgress: AiProgressHandler, signal: AbortSignal): Promise<AiTextResult> {
    const config = await this.sqlConfig(context);
    if (!config) return { errorMessage: await this.needsSchema(context.databaseAlias) };
    const r = await this.call(() => this.api.explainSqlStream(config, context.sql, onProgress, signal, true));
    return { text: r.result?.explanation, errorMessage: r.errorMessage || r.result?.errorMessage || undefined, userProfile: r.userProfile, steps: r.result?.steps };
  }

  async suggestExpression(context: DesignerAiExpressionContext, onProgress: AiProgressHandler, signal: AbortSignal): Promise<AiExpressionResult> {
    let semantic = '';
    try {
      if (context.report) {
        const live = await this.docs.aiContext(JSON.stringify(context.report));
        semantic = JSON.stringify({ expressionContext: live.expressionContext, runtimeDataSources: live.runtimeDataSources });
      }
    } catch { semantic = ''; }
    const r = await this.call(() => this.api.suggestExpressionStream(context.prompt, context.currentExpression, semantic, context.fix, onProgress, signal, context.cursorPosition));
    return { expression: r.result?.expression, explanation: r.result?.explanation, errorMessage: r.errorMessage || r.result?.errorMessage || undefined, userProfile: r.userProfile, steps: r.result?.steps };
  }

  reportAbuse(errorType: 'InaccurateContent' | 'InappropriateContent', comments: string, aiContent: string): Promise<void> {
    return this.api.reportAbuse(errorType, comments, aiContent);
  }

  /**
   * The host's own database behind a report's connection (a `direct` alias whose tables the server
   * resolves: a host application's own database, which is in no Hub), as the DatabaseConfig the cloud takes inline;
   * null for an Agent alias (it goes by its Hub database, as the chat's selector shows) or an alias
   * the server does not describe.
   */
  async inlineConfigFor(databaseAlias: string, subschema?: string): Promise<DatabaseConfig | null> {
    const s = await this.schemaForAlias(databaseAlias);
    // An Agent alias with a local file goes inline too: its subschema, with the dialect of the file
    if (!s || (s.kind !== 'direct' && s.source !== 'file') || !s.tables.length) return null;
    // F8: a connection's file goes to the AI as one of its subschemas, never as its dictionary (a big database does
    // not fit): without a name, or with one the file no longer has, there is nothing to send.
    if (s.source === 'file' && !s.schemas?.some((x) => x.name === subschema)) return null;
    return this.configFor(databaseAlias, subschema);
  }

  /** The subschema last chosen in the copilot for this connection ('' none): where the copilot starts next time. */
  static rememberedSubschema(alias: string): string {
    try { return localStorage.getItem(SUBSCHEMA_KEY + alias.toUpperCase()) ?? ''; } catch { return ''; }
  }

  static rememberSubschema(alias: string, name: string): void {
    try {
      if (name) localStorage.setItem(SUBSCHEMA_KEY + alias.toUpperCase(), name);
      else localStorage.removeItem(SUBSCHEMA_KEY + alias.toUpperCase());
    } catch { /* private mode */ }
  }

  // ---- helpers ----

  /**
   * What the SQL assistants send: the Hub schema chosen in the dataset dialog, as it is (an Agent connection with
   * tables would otherwise go with them inline); else the connection's own, of the subschema it sends.
   */
  private async sqlConfig(context: { databaseAlias?: string; schemaName?: string; hubSchemaId?: number }): Promise<DatabaseConfig | null> {
    if (context.hubSchemaId) {
      await this.hub.load();
      const chosen = this.hub.databases().find((d) => d.hubSchemaId === context.hubSchemaId);
      if (chosen) return chosen;
    }
    return this.configFor(context.databaseAlias, await this.sqlSubschema(context.databaseAlias, context.schemaName));
  }

  /**
   * The subschema of a connection's file the SQL assistants send (F8: never the dictionary). Without a choice of the
   * dataset dialog's selector, the copilot's order applies (the selector starts with it too): the dataset's own (its
   * SchemaName) while the file has it, then the one last chosen in the copilot for that connection, then the first of
   * the file ('' when it has none: refused).
   * Any other schema keeps the dataset's name as it is (a host's «all» is a part the host defines).
   */
  private async sqlSubschema(databaseAlias: string | undefined, schemaName: string | undefined): Promise<string | undefined> {
    if (!databaseAlias) return schemaName;
    const s = await this.schemaForAlias(databaseAlias);
    if (s?.source !== 'file') return schemaName;
    const parts = s.schemas ?? [];
    const has = (name?: string) => !!name && parts.some((p) => p.name === name);
    if (has(schemaName)) return schemaName;
    const remembered = DesignerAiBridgeService.rememberedSubschema(databaseAlias);
    return has(remembered) ? remembered : parts[0]?.name ?? '';
  }

  /** Why there is nothing to send: a connection's file without subschemas (F8, make one), or no schema at all. */
  private async needsSchema(databaseAlias: string | undefined): Promise<string> {
    const s = databaseAlias ? await this.schemaForAlias(databaseAlias) : null;
    return s?.source === 'file' ? this.t.t('CopilotChooseSubschema', { alias: s.alias || databaseAlias }) : this.t.t('AiHelperNeedsSchema');
  }

  /**
   * What travels of a schema for a named part (Ventas, Compras…), the same rule as the engine's
   * LocalSchemaStore.BuildInlineConfig: only its tables, of each one the columns it chose (only its primary key when
   * it chose none: people choose the columns and describe them), their allowed values, and the relations whose two
   * ends travel and that nobody left out (`excluded`, the file's list of every subschema, and the part's own). Without
   * a part («all the tables»), everything but what the file leaves out. One rule for every source, a table never goes
   * whole: a host gives its parts their columns too (the areas of a host with a virtual schema carry that schema's columns).
   */
  static tablesOf(tables: DesignerAiSchemaTable[], part?: DesignerAiSubschema, excluded?: DesignerAiRelationRef[] | null) {
    const keep = part ? new Set(part.tables.map((n) => n.toLowerCase())) : null;
    const chosen = (table: string): Set<string> | null => {
      const entry = Object.entries(part?.columns ?? {}).find(([k, v]) => k.toLowerCase() === table.toLowerCase() && v?.length);
      return entry ? new Set(entry[1].map((n) => n.toLowerCase())) : null;
    };
    const travels = new Map<string, Set<string>>();
    for (const t of tables) {
      if (keep && !keep.has(t.name.toLowerCase())) continue;
      const cols = chosen(t.name);
      travels.set(t.name.toLowerCase(), new Set(t.columns.filter((c) => !part || (cols ? cols.has(c.name.toLowerCase()) : !!c.isPrimaryKey)).map((c) => c.name.toLowerCase())));
    }
    const ends = (table: string, columns: string[] | undefined) => {
      const kept = travels.get((table ?? '').toLowerCase());
      return !!kept && (columns ?? []).every((c) => kept.has((c ?? '').toLowerCase()));
    };
    return tables.filter((t) => travels.has(t.name.toLowerCase())).map((t) => {
      const kept = travels.get(t.name.toLowerCase())!;
      return {
        name: t.name,
        context: t.context ?? '',
        columns: t.columns.filter((c) => kept.has(c.name.toLowerCase())).map((c) => ({
          name: c.name, dataType: c.dataType, context: c.context ?? '', isPrimaryKey: !!c.isPrimaryKey, detectedType: c.detectedType ?? '',
          ...(c.allowedValues?.length ? { allowedValues: c.allowedValues.map((v) => ({ value: v.value, label: v.label ?? '' })) } : {}),
        })),
        foreignKeys: (t.foreignKeys ?? []).filter((fk: any) => (!part || (ends(t.name, fk.sourceColumns) && ends(fk.targetTable, fk.targetColumns)))
          && !DesignerAiBridgeService.isExcluded(t.name, fk, excluded, part?.excludedRelations)),
      };
    });
  }

  /**
   * Whether a relation is in one of the lists of relations left out: the same ends, tables and columns ignoring case,
   * the columns in order (the engine's LocalSchemaStore.IsExcluded).
   */
  static isExcluded(sourceTable: string, fk: { targetTable?: string; sourceColumns?: string[]; targetColumns?: string[] }, ...lists: (DesignerAiRelationRef[] | null | undefined)[]): boolean {
    const same = (a: string | undefined, b: string | undefined) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
    const sameList = (a: string[] | undefined, b: string[] | undefined) => (a ?? []).length === (b ?? []).length && (a ?? []).every((x, i) => same(x, (b ?? [])[i]));
    return lists.some((list) => (list ?? []).some((r) => same(r.sourceTable, sourceTable) && same(r.targetTable, fk.targetTable)
      && sameList(r.sourceColumns, fk.sourceColumns) && sameList(r.targetColumns, fk.targetColumns)));
  }

  /**
   * The DatabaseConfig to send: for a connection alias, the schema the server resolves (inline
   * tables, so the cloud needs no Hub access: any driver works); without one, the Hub schema
   * selected in the chat. A connection's file without the subschema: nothing (F8, never its dictionary,
   * nor a Hub schema nobody chose for it).
   */
  private async configFor(databaseAlias?: string, subschema?: string): Promise<DatabaseConfig | null> {
    await this.hub.load();
    if (databaseAlias) {
      const s = await this.schemaForAlias(databaseAlias);
      const part = subschema ? s?.schemas?.find((x) => x.name === subschema) : undefined;
      if (s?.source === 'file' && (!part || !s.tables.length)) return null;
      if (s && s.tables.length) {
        const hubDb = s.hubDatabaseId ? this.hub.byHubDatabaseId(s.hubDatabaseId) : null;
        return {
          name: s.alias ?? databaseAlias,
          dialect: s.dialect || 'Default',
          hubDatabaseId: s.hubDatabaseId ?? hubDb?.hubDatabaseId ?? 0,
          // A local file's tables are the schema: no Hub schema goes with them (an Agent alias keeps its Hub database)
          hubSchemaId: s.source === 'file' ? 0 : s.hubSchemaId ?? hubDb?.hubSchemaId ?? 0,
          schemaTables: DesignerAiBridgeService.tablesOf(s.tables, part, s.excludedRelations),
          // D3: the cloud writes it in the datasets it makes (SchemaName), so they keep their part of the database
          schemaName: part?.name ?? '',
          runtime: 'ADO_Net',
        };
      }
      if (s?.hubDatabaseId) {
        const hubDb = this.hub.byHubDatabaseId(s.hubDatabaseId);
        if (hubDb) return hubDb;
      }
    }
    return this.hub.selected();
  }

  /** One cloud call: the credits refresh with its answer and the net log is synced whether it worked or not. */
  private async call(fn: () => Promise<QueryApiResult>): Promise<QueryApiResult> {
    try {
      const r = await fn();
      if (r.userProfile) this.aiAccount.updateCredits(r.userProfile);
      return r;
    } catch (err: any) {
      if (err?.name !== 'AbortError') this.api.log((err?.message ?? String(err)));
      throw err;
    } finally {
      this.syncNet();
    }
  }

  private syncNet(): void {
    this.netLog.set([...this.api.netLog]);
  }

  private net(text: string): void {
    this.api.log(text);
    this.syncNet();
  }
}

function parametersOf(parameters?: { name: string }[]): { name: string }[] | undefined {
  return parameters?.length ? parameters.map((p) => ({ name: p.name })) : undefined;
}

function readFlag(key: string): boolean | null {
  try {
    const v = localStorage.getItem(key);
    return v === null ? null : v === '1';
  } catch { return null; }
}
