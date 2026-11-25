import { computed, inject, signal } from '@angular/core';
import { TranslationService } from '../services/translator.service';
import { AiAccountService } from '../server/ai-account.service';
import { AiConfigService, AiScope } from '../server/ai-config.service';
import { DatabaseConfig, HubDatabasesService, hubSchemaLabel, isAgentOffline } from '../server/hub-databases.service';
import { DesignerAiBridgeService } from '../server/designer-ai-bridge.service';
import { DESIGNER_HOST, resolveDesignerHost } from '../server/designer-host';
import type { DesignerAiSchemaInfo, DesignerAiSchemaTable } from '../shell/designer-ai';

/**
 * One schema of the list: its key (`local:<subschema>` or `hub:<hubSchemaId>`), its text (name and tables), ⚠ over the
 * plan, local or cloud, a cloud one whose Agent is not connected (the red dot), and one of the cloud's example
 * databases (the DEMO chip: public, read-only, for anybody without a login or a key).
 */
export interface SchemaOption {
  key: string;
  label: string;
  warn: boolean;
  icon: 'storage' | 'cloud';
  offline: boolean;
  example: boolean;
}

/**
 * A schema chosen in the list (`byHand`), or by the list itself: the subschema just made in the other tab, or the one
 * chosen there read again. `remember`: kept for the connection as the one to start with next time.
 */
export interface SchemaChosen {
  key: string;
  byHand: boolean;
  remember: boolean;
}

/**
 * The part of the database an AI assistant reads (F5): one list with the
 * subschemas of a connection's own schema (local) and the account's Hub schemas (cloud), what each one weighs against
 * the plan, and the schema screens. Each assistant keeps its own: the copilot the report's, the SQL editor the
 * dataset's, which never moves the copilot's. Made in an injection context; `rp-schema-selector` shows it.
 */
export class SchemaChoice {
  private hub = inject(HubDatabasesService);
  private bridge = inject(DesignerAiBridgeService);
  private aiAccount = inject(AiAccountService);
  private aiConfig = inject(AiConfigService);
  private t = inject(TranslationService);
  private host = resolveDesignerHost(inject(DESIGNER_HOST, { optional: true }));

  /** The schema the server gives for the connection when it is a direct one with tables (its subschemas, who made them). */
  readonly info = signal<DesignerAiSchemaInfo | null>(null);
  /** That connection's alias ('' without one): its local schema screen, the subschema remembered for it. */
  readonly alias = signal('');
  /** What the list shows chosen: `local:<subschema>` ('' = all the tables) or `hub:<hubSchemaId>`; '' nothing. */
  readonly selectedKey = signal('');
  /** The Hub database behind the Agent connection, for «New cloud schema». */
  readonly agentHubDatabaseId = signal(0);

  /**
   * `scope`: the assistant whose provider decides the plan's ⚠ (the AI on an Agent has no limit). `selectedHub`: the
   * cloud schema chosen, when the owner keeps it elsewhere (the copilot: the Hub selection); by default the list's own.
   */
  constructor(private readonly options: { scope?: AiScope; selectedHub?: () => DatabaseConfig | null } = {}) {}

  /** Over the plan with the cloud AI (the AI on an Agent has no limit; unknown limits: no mark). */
  private overPlan(tables: { columns?: unknown[] }[]): boolean {
    if (this.aiConfig.selection(this.options.scope ?? 'report').tier() === 'LocalAgent') return false;
    const limits = this.aiAccount.planLimits();
    if (!limits) return false;
    const widest = tables.reduce((max, t) => Math.max(max, t.columns?.length ?? 0), 0);
    return (limits.maxTables > 0 && tables.length > limits.maxTables) || (limits.maxColumns > 0 && widest > limits.maxColumns);
  }

  /** The name and its tables; the ⚠ and the red dot go in front of it in the template. */
  private label(name: string, tables: unknown[]): string {
    return name + ' (' + tables.length + ')';
  }

  readonly localOptions = computed<SchemaOption[]>(() => {
    const s = this.info();
    if (!s) return [];
    const options: SchemaOption[] = [];
    // F8: a connection's file offers its subschemas only: its dictionary («all the tables») never goes to the AI (a
    // big database does not fit). A host's «all» is not a dictionary but a part the host defines (e.g. a host with its
    // own schema: its business tables, without the technical ones), and it stays.
    if (s.source !== 'file') {
      const all = DesignerAiBridgeService.tablesOf(s.tables, undefined, s.excludedRelations);
      const allWarns = this.overPlan(all);
      options.push({ key: 'local:', label: this.label(this.alias() + ' · ' + this.t.t('CopilotSubschemaAll'), all), warn: allWarns, icon: 'storage', offline: false, example: false });
    }
    for (const part of s.schemas ?? []) {
      const tables = DesignerAiBridgeService.tablesOf(s.tables, part, s.excludedRelations);
      const warn = this.overPlan(tables);
      options.push({ key: 'local:' + part.name, label: this.label(part.name, tables), warn, icon: 'storage', offline: false, example: false });
    }
    return options;
  });

  /**
   * The Hub schemas of the account and of this server's Agent connections, «schema - Agent»; not in a host that
   * describes its own database (e.g. a host with its own schema: no Hub there).
   */
  readonly cloudOptions = computed<SchemaOption[]>(() => {
    if (this.info()?.source === 'host') return [];
    return this.hub.databases().map((d) => {
      const tables = d.schemaTables ?? [];
      const warn = this.overPlan(tables);
      return { key: 'hub:' + d.hubSchemaId, label: this.label(hubSchemaLabel(d), tables), warn, icon: 'cloud', offline: isAgentOffline(d), example: !!d.isExample };
    });
  });

  /** The chosen one, for the closed list (its icon in front); null with nothing chosen. */
  readonly selectedOption = computed(() => [...this.localOptions(), ...this.cloudOptions()].find((o) => o.key === this.selectedKey()) ?? null);

  readonly selectedWarns = computed(() => !!this.selectedOption()?.warn);

  /** The cloud schema chosen, or null (a local one, or nothing). */
  readonly selectedHub = computed<DatabaseConfig | null>(() => {
    const key = this.selectedKey();
    if (!key.startsWith('hub:')) return null;
    if (this.options.selectedHub) return this.options.selectedHub();
    return this.cloudSchema(Number(key.substring('hub:'.length)));
  });

  /**
   * The tables of the choice, for what is completed without the AI: a subschema's as they travel (tablesOf), all the
   * tables of a host's «all», or a cloud schema's; null with nothing chosen (or a choice gone from the lists).
   */
  readonly selectedTables = computed<DesignerAiSchemaTable[] | null>(() => {
    const key = this.selectedKey();
    if (key.startsWith('hub:')) return this.selectedHub()?.schemaTables ?? null;
    const s = this.info();
    if (!s || !key.startsWith('local:')) return null;
    const name = key.substring('local:'.length);
    const part = name ? (s.schemas ?? []).find((p) => p.name === name) : undefined;
    return name && !part ? null : DesignerAiBridgeService.tablesOf(s.tables, part, s.excludedRelations);
  });

  /**
   * F8: a connection's file with no subschema of it chosen (none yet, or the chosen one is gone from the file): the
   * assistant sends nothing, neither the dictionary nor a Hub schema the person did not choose.
   */
  readonly missingSubschema = computed(() => {
    const s = this.info();
    const key = this.selectedKey();
    if (s?.source !== 'file' || key.startsWith('hub:')) return false;
    const name = key.startsWith('local:') ? key.substring('local:'.length) : '';
    return !name || !(s.schemas ?? []).some((p) => p.name === name);
  });

  /** «New … schema» and the schema screens: not for a host's own areas, which its metadata makes. */
  readonly offersSchemaScreens = computed(() => this.info()?.source !== 'host');

  /**
   * The local schema screen of the connection: why not, if it cannot be opened. A connection's file, or an Agent
   * connection without one yet: its screen makes it from the catalog its Agent reads (a remote connection may have a
   * local schema too).
   */
  readonly localScreen = computed(() => {
    const s = this.info();
    const screen = s ? s.source === 'file' : !!this.alias() && this.agentHubDatabaseId() > 0;
    if (!this.host.openLocalSchemas || !screen) return { why: ' ' };
    return { why: this.host.canEditLocalSchemas?.() === false ? this.t.t('CopilotLocalSchemasAdminOnly') : '' };
  });
  readonly newLocal = computed(() => this.localScreen());

  /** «New cloud schema» needs a Hub database: the chosen cloud schema's, or the Agent connection's. */
  readonly newCloud = computed(() => {
    const key = this.selectedKey();
    const agent = this.agentHubDatabaseId();
    if (key.startsWith('local:') && !agent) return { why: this.t.t('CopilotNotInHub'), hubDatabaseId: 0 };
    const hubDatabaseId = key.startsWith('hub:') ? this.selectedHub()?.hubDatabaseId ?? 0 : agent;
    return hubDatabaseId ? { why: '', hubDatabaseId } : { why: this.t.t('CopilotNotInHub'), hubDatabaseId: 0 };
  });

  /** The Hub schemas, read once (the agents' AI endpoints come with them). */
  loadCloud(): Promise<void> {
    return this.hub.load();
  }

  /** The list opens: the cloud schemas read over a minute ago are read again (their Agents' state); none in a host's own database. */
  refreshCloudIfStale(): void {
    if (this.info()?.source !== 'host') this.hub.refreshIfStale();
  }

  /** A Hub schema of the list by its id. */
  cloudSchema(hubSchemaId: number | null | undefined): DatabaseConfig | null {
    return hubSchemaId ? this.hub.databases().find((d) => d.hubSchemaId === hubSchemaId) ?? null : null;
  }

  /**
   * A connection's own schema (a direct one with tables) and the subschema to start with, which it returns: `preferred`
   * (a dataset's, D3) while the file has it, then the one chosen last time for the connection; with a connection's
   * file, then its first subschema, and nothing without one (F8 A3, never its dictionary); else all the tables.
   */
  startLocal(alias: string, info: DesignerAiSchemaInfo, preferred = ''): string {
    const parts = info.schemas ?? [];
    const has = (name: string) => !!name && parts.some((p) => p.name === name);
    const remembered = DesignerAiBridgeService.rememberedSubschema(alias);
    const file = info.source === 'file';
    const start = has(preferred) ? preferred : has(remembered) ? remembered : file ? parts[0]?.name ?? '' : '';
    this.alias.set(alias);
    this.info.set(info);
    this.selectedKey.set(file && !start ? '' : 'local:' + start);
    return start;
  }

  /**
   * Where a dataset's assistant starts (the SQL editor, once the cloud list is loaded): what the dataset was made with.
   * Its connection's own schema (a direct one, or an Agent one with a local file): startLocal with the dataset's
   * subschema; an Agent one's dataset made with a Hub schema, that schema (the file's subschemas are in the list). An
   * Agent connection without a file: the dataset's Hub schema while the list has it, else the connection's. A direct
   * connection the server could not describe: nothing, never a cloud schema of another database; nor while its schema
   * is not known. Neither (no connection, one the server cannot tell): the dataset's Hub schema, else the copilot's,
   * which is what the AI used for it until now.
   */
  startDataset(alias: string, info: DesignerAiSchemaInfo | null, dataset: { schemaName?: string; hubSchemaId?: number }): void {
    const listed = (id: number | null | undefined) => !!this.cloudSchema(id);
    if (alias && info && (info.kind === 'direct' || info.source === 'file') && info.tables.length) {
      const agent = info.kind === 'agent' ? info.hubDatabaseId ?? 0 : 0;
      this.agentHubDatabaseId.set(agent);
      const own = !!dataset.schemaName && (info.schemas ?? []).some((p) => p.name === dataset.schemaName);
      if (agent && !own && listed(dataset.hubSchemaId)) {
        this.alias.set(alias);
        this.info.set(info);
        this.selectedKey.set('hub:' + dataset.hubSchemaId);
        return;
      }
      this.startLocal(alias, info, dataset.schemaName ?? '');
      return;
    }
    // An Agent connection keeps its alias: «New local schema» makes its file
    this.alias.set(info?.kind === 'agent' ? alias : '');
    this.info.set(null);
    this.agentHubDatabaseId.set(info?.kind === 'agent' ? info.hubDatabaseId ?? 0 : 0);
    let id: number | null | undefined = null;
    if (info?.kind === 'agent') {
      const ofConnection = info.hubDatabaseId ? this.hub.byHubDatabaseId(info.hubDatabaseId)?.hubSchemaId : null;
      id = [dataset.hubSchemaId, info.hubSchemaId, ofConnection].find(listed);
    } else if (info ? info.kind !== 'direct' : !alias) {
      id = [dataset.hubSchemaId, this.hub.selectedSchemaId()].find(listed);
    }
    this.selectedKey.set(id ? 'hub:' + id : '');
  }

  /** «New local schema» was chosen: what its screen makes is chosen when it comes back, over a cloud schema chosen before. */
  private creating = false;

  openLocalSchemas(create: boolean): void {
    const alias = this.alias();
    if (this.localScreen().why || !alias) return;
    const key = this.selectedKey();
    if (create) this.creating = true;
    this.host.openLocalSchemas?.(alias, create, !create && key.startsWith('local:') ? key.substring('local:'.length) || undefined : undefined);
  }

  openCloudSchemas(create: boolean): void {
    const base = (this.host.webAppUrl || 'https://app.reportman.es').replace(/\/+$/, '') + '/database-config';
    const hubDatabaseId = this.newCloud().hubDatabaseId;
    const url = create && hubDatabaseId ? base + '?new=1&hubDatabaseId=' + hubDatabaseId : base;
    window.open(url, '_blank', 'noopener');
  }

  /**
   * Back from the local schema screen (another tab): the connection's file is read again. The subschema chosen, if
   * still there, is chosen again (what the other tab changed in it travels from now on); with none chosen (F8: none
   * yet), the one just made there. Null when nothing is to be chosen.
   */
  async reread(): Promise<SchemaChosen | null> {
    const alias = this.alias();
    const s = this.info();
    // A connection's file; or an Agent connection without one yet, whose screen may have just made it
    if (!alias || (s ? s.source !== 'file' : !(this.agentHubDatabaseId() > 0))) return null;
    const before = new Set((s?.schemas ?? []).map((p) => p.name));
    const fresh = await this.bridge.schemaForAlias(alias, false, true);
    if (!fresh || fresh.source !== 'file') return null;
    this.info.set(fresh);
    const key = this.selectedKey();
    const parts = fresh.schemas ?? [];
    const made = parts.find((p) => !before.has(p.name));
    // «New local schema» (an Agent connection starts with its cloud schema): the one its screen made, once it is there
    if (this.creating && made) {
      this.creating = false;
      this.selectedKey.set('local:' + made.name);
      return { key: 'local:' + made.name, byHand: false, remember: true };
    }
    if (key.startsWith('hub:')) return null;
    const current = key.startsWith('local:') ? key.substring('local:'.length) : '';
    if (current && parts.some((p) => p.name === current)) return { key, byHand: false, remember: false };
    if (current) return null;
    if (!made) return null;
    this.selectedKey.set('local:' + made.name);
    return { key: 'local:' + made.name, byHand: false, remember: true };
  }
}
