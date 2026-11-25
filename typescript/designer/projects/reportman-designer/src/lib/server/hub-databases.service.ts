import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AgentAiEndpoint, AiConfigService } from './ai-config.service';
import { AiAccountService } from './ai-account.service';
import { DESIGNER_HOST, resolveDesignerHost } from './designer-host';
import { DesignerDocsService } from './designer-docs.service';

/** One column of a Hub schema table, as the cloud describes it (DatabaseConfig.schemaTables). */
export interface SchemaColumn {
  name: string;
  dataType: string;
  context?: string;
  isPrimaryKey?: boolean;
  /** The values the column takes and what each one means. */
  allowedValues?: { value: string; label?: string }[];
}

export interface SchemaTable {
  name: string;
  context?: string;
  columns: SchemaColumn[];
  foreignKeys?: any[];
}

/**
 * A Hub database as the cloud lists it for this account: the same DatabaseConfig object the
 * designers and Reportman.Web send back as `config` in every copilot request.
 */
export interface DatabaseConfig {
  name: string;
  displayName?: string;
  provider?: string;
  dialect?: string;
  hubSchemaId: number;
  hubDatabaseId: number;
  hubRole?: string;
  isExample?: boolean;
  connectionType?: string;
  schemaTables?: SchemaTable[];
  /** Whether its Agent is connected: false draws the red dot; missing or null (an older cloud) draws nothing. */
  isOnline?: boolean | null;
  /** Its Agent's name, for «schema - Agent» in the lists; may be missing. */
  agentName?: string | null;
  /** The server's Agent connection that listed it (GET {designer}/agent-schemas); none in the account's list. */
  alias?: string;
  [key: string]: any;
}

/** What the lists read of a cloud schema: the account's DatabaseConfig, the server's agent-schemas, the app's own types. */
export interface HubSchemaLike {
  name?: string;
  displayName?: string;
  hubDatabaseId?: number;
  hubSchemaId?: number;
  isOnline?: boolean | null;
  agentName?: string | null;
}

/**
 * The label of a cloud schema in every list: «schema - Agent»; without the
 * Agent's name, the cloud's own («database - schema»).
 */
export function hubSchemaLabel(d: HubSchemaLike): string {
  return d.agentName ? (d.name || d.displayName || '') + ' - ' + d.agentName : d.displayName || d.name || '';
}

/** The label of a Hub database (not of a schema): «database - Agent»; the database is the first part of the cloud's «database - schema». */
export function hubDatabaseLabel(d: HubSchemaLike): string {
  const database = (d.displayName || d.name || '').split(' - ')[0];
  return d.agentName ? database + ' - ' + d.agentName : database;
}

/** Its Agent is known not to be connected: the red dot. Not knowing (no isOnline) is not that. */
export function isAgentOffline(d: HubSchemaLike | null | undefined): boolean {
  return d?.isOnline === false;
}

/** Several lists of cloud schemas as one, in their order: each schema once (database|schema), as the first list has it. */
export function mergeHubSchemas<T extends HubSchemaLike>(...lists: T[][]): T[] {
  const seen = new Set<string>();
  return lists.flat().filter((d) => {
    const key = d.hubDatabaseId + '|' + d.hubSchemaId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const SELECTED_KEY = 'rpsrv_selected_db';
/** How old the lists may be when they are shown again: the red dot of an Agent switched off shows within a minute. */
const FRESH_MS = 60_000;

/**
 * GET /api/agent/databases (through the server's bridge): the account's databases plus the agents' AI endpoints;
 * and GET {designer}/agent-schemas: the schemas the server's Agent connections reach with their keys, which never
 * come to the page. One list, each schema once.
 */
@Injectable({ providedIn: 'root' })
export class HubDatabasesService {
  private http = inject(HttpClient);
  private aiConfig = inject(AiConfigService);
  private aiAccount = inject(AiAccountService);
  private docs = inject(DesignerDocsService);
  private host = resolveDesignerHost(inject(DESIGNER_HOST, { optional: true }));

  readonly databases = signal<DatabaseConfig[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly selectedSchemaId = signal<number | null>(readSelected());

  readonly selected = computed(() => {
    const id = this.selectedSchemaId();
    return this.databases().find((d) => d.hubSchemaId === id) ?? null;
  });

  private loaded = false;
  private loadedAt = 0;
  /** The two lists apart: one that fails to load keeps what it had, and never empties the other. */
  private accountList: DatabaseConfig[] = [];
  private serverList: DatabaseConfig[] = [];

  constructor() {
    // Logging into or out of the AI changes whose databases these are (the account's or the
    // guest's examples): a list already loaded is read again, one never asked for waits.
    const initial = this.aiAccount.changes();
    effect(() => {
      if (this.aiAccount.changes() === initial) return;
      untracked(() => {
        if (this.loaded) void this.load(true);
      });
    });
  }

  async load(force = false): Promise<void> {
    if (this.loaded && !force) return;
    this.loading.set(true);
    this.error.set('');
    try {
      // The account's databases when the person logged into the AI; the guest's examples otherwise.
      const token = this.aiAccount.token;
      const headers: Record<string, string> = token ? { 'X-Reportman-AI-Token': token } : {};
      const [account, server] = await Promise.allSettled([
        firstValueFrom(this.http.get(this.host.aiBridgeUrl + 'api/agent/databases', { headers })),
        this.agentSchemas(),
      ]);
      // The AI session changed while asking (a login, or a session the cloud refused): this list is
      // someone else's; ask again as whoever it is now.
      if (this.aiAccount.token !== token) return await this.load(true);
      if (account.status === 'fulfilled') {
        const response: any = account.value;
        this.accountList = response?.databases ?? response?.Databases ?? (Array.isArray(response) ? response : []);
        this.aiConfig.setAgentEndpoints((response?.aiEndpoints ?? response?.AiEndpoints ?? []) as AgentAiEndpoint[]);
      } else {
        const err: any = account.reason;
        this.error.set(err?.error?.error ?? err?.message ?? 'Could not load the databases');
      }
      if (server.status === 'fulfilled' && server.value) this.serverList = server.value;
      if (account.status === 'rejected' && !(server.status === 'fulfilled' && server.value)) return;
      const list = mergeHubSchemas(this.accountList, this.serverList);
      this.databases.set(list);
      const current = this.selectedSchemaId();
      if (current == null || !list.some((d) => d.hubSchemaId === current)) {
        this.select(list[0]?.hubSchemaId ?? null);
      }
      this.loadedAt = Date.now();
      if (account.status === 'fulfilled') this.loaded = true;
    } finally {
      this.loading.set(false);
    }
  }

  /** Read again when what is shown is over a minute old (a list being opened): the Agents' state changes. */
  refreshIfStale(): void {
    if (this.loaded && !this.loading() && Date.now() - this.loadedAt > FRESH_MS) void this.load(true);
  }

  /**
   * GET {designer}/agent-schemas: the schemas of the Hub databases behind the server's Agent connections the person
   * may use, asked with their keys on the server. Null when the server could not answer (an older one, a host that
   * does not give it to this person): what was loaded stays.
   */
  async agentSchemas(): Promise<DatabaseConfig[] | null> {
    try {
      const list = await firstValueFrom(this.http.get<DatabaseConfig[]>(this.docs.url('agent-schemas')));
      return Array.isArray(list) ? list.filter((d) => d?.hubSchemaId != null && d.hubDatabaseId != null) : null;
    } catch {
      return null;
    }
  }

  select(hubSchemaId: number | null): void {
    this.selectedSchemaId.set(hubSchemaId);
    try {
      if (hubSchemaId == null) localStorage.removeItem(SELECTED_KEY);
      else localStorage.setItem(SELECTED_KEY, String(hubSchemaId));
    } catch { /* private mode */ }
  }

  /** The database an Agent alias points to, when the report already names one. */
  byHubDatabaseId(hubDatabaseId: number): DatabaseConfig | null {
    return this.databases().find((d) => d.hubDatabaseId === hubDatabaseId) ?? null;
  }
}

function readSelected(): number | null {
  try {
    const v = localStorage.getItem(SELECTED_KEY);
    return v ? Number(v) : null;
  } catch { return null; }
}
