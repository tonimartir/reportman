import { InjectionToken, Signal } from "@angular/core";
import { Report } from "@reportman/lib";
import { AiExpressionResult, AiNetLine, AiProgressHandler, AiSqlCodeSuggestions, AiSqlResult, AiTextResult } from "../ai/ai-types";

/** One choice of the usage header's selectors (provider, mode). */
export interface DesignerAiOption {
  value: string;
  label: string;
  description?: string;
  icon?: string;
}

/**
 * Which assistant is asking: the report copilot, the SQL one (chat, audit and completion of the
 * dataset dialog), the expression one or the schemas one (analyze and generate a local schema).
 * Each keeps its own provider and mode, as each Delphi assistant has its own TFRpAISelection.
 */
export type DesignerAiScope = "report" | "sql" | "expression" | "schemas";

/** The provider and mode one assistant uses (the usage header's selectors). */
export interface DesignerAiSelection {
  readonly provider: Signal<string>;
  readonly mode: Signal<string>;
  /** False with a local agent: nothing is charged. */
  readonly consumesCredits: Signal<boolean>;
  setProvider(value: string): void;
  setMode(value: string): void;
}

/** The pages the account menu opens, as the Delphi designer's TFRpLoginFrame does. */
export type DesignerAiAccountLink = "plans" | "schemas" | "agent";

/**
 * The Reportman AI account behind the AI (the Delphi designer's TRpAuthManager): one state for the
 * whole page, so logging in or out from one chat shows in all of them. Without a session the AI
 * runs on the installation's guest credits; logging in gives the account its own gift.
 */
export interface DesignerAiAccount {
  readonly loggedIn: Signal<boolean>;
  /** The host's account (DesignerHost.aiAccount `host`): the card neither logs in nor out. */
  readonly managedByHost?: boolean;
  /** The name to show (the account's, or its email). */
  readonly displayName: Signal<string>;
  readonly email: Signal<string>;
  /** The cloud's tier: 1 guest, 2 free, 3 lite, 4 pro, 5 enterprise. */
  readonly tierId: Signal<number>;
  readonly tierName: Signal<string>;
  readonly avatarUrl: Signal<string>;
  /** The credits the first login gives (the Free tier's), for the guest's invitation. */
  readonly giftCredits: Signal<number>;
  readonly busy: Signal<boolean>;
  /** Why the last login failed, for the login dialog. */
  readonly error: Signal<string>;
  /** The language the AI answers in, by the cloud's names (English, Spanish, ...). */
  readonly language: Signal<string>;
  readonly languages: readonly DesignerAiOption[];
  setLanguage(value: string): void;
  sendCode(email: string): Promise<boolean>;
  loginWithCode(email: string, code: string): Promise<boolean>;
  /** Google, Microsoft or Apple, in a popup: `loggedIn` turns true when it hands the session back. */
  loginWithProvider(provider: "google" | "microsoft" | "apple"): void;
  logout(): Promise<void>;
  linkUrl(link: DesignerAiAccountLink): string;
}

/** One Hub schema the account can work with, for the chat's selector. */
export interface DesignerAiSchemaOption {
  id: number;
  name: string;
  /** Its Agent is known not to be connected: the selector draws a red dot before the name. */
  offline?: boolean;
  /** One of the cloud's example databases (public, read-only, for anybody): the DEMO chip after the name. */
  example?: boolean;
}

export interface DesignerAiSchemaColumn {
  name: string;
  /** The cloud's coarse type (Integer, String, Date, ...). */
  dataType: string;
  /** What the database declares, when known (VARCHAR(40), System.Int64, ...). */
  detectedType?: string;
  isPrimaryKey?: boolean;
  context?: string;
  /** The values the column takes and what each one means (a local schema file, version 2). */
  allowedValues?: { value: string; label?: string }[];
}

export interface DesignerAiSchemaForeignKey {
  constraintName?: string;
  targetTable: string;
  sourceColumns: string[];
  targetColumns: string[];
}

export interface DesignerAiSchemaTable {
  name: string;
  context?: string;
  columns: DesignerAiSchemaColumn[];
  foreignKeys?: DesignerAiSchemaForeignKey[];
}

/** A named part of a schema: its name, the tables it takes and, of some of them, the columns. */
export interface DesignerAiSubschema {
  name: string;
  description?: string;
  tables: string[];
  /** Table name to the columns it takes (a local schema file, version 2); a table that is not here sends its primary key. */
  columns?: Record<string, string[]> | null;
  /** The relations left out of it although both ends travel (a local schema file): they never go to the AI with it. */
  excludedRelations?: DesignerAiRelationRef[] | null;
}

/** A relation by its ends (a local schema file's lists of relations left out): tables and columns ignoring case, columns in order. */
export interface DesignerAiRelationRef {
  sourceTable: string;
  sourceColumns: string[];
  targetTable: string;
  targetColumns: string[];
}

/** The schema behind a connection alias, whatever its driver: what the editor completes with and what the AI gets. */
export interface DesignerAiSchemaInfo {
  alias?: string;
  kind: "agent" | "direct" | "unknown";
  /** A DatabaseDialect name of the cloud (PostgreSQL, Firebird5, SQLite, ...). */
  dialect?: string;
  hubDatabaseId?: number | null;
  hubSchemaId?: number | null;
  tables: DesignerAiSchemaTable[];
  /**
   * Named parts of the tables (a host's business areas, the subschemas of a connection's file): the
   * copilot sends only those of the one chosen, all of them without one.
   */
  schemas?: DesignerAiSubschema[];
  /** The relations left out of every subschema and of all the tables (a local schema file): they never go to the AI. */
  excludedRelations?: DesignerAiRelationRef[] | null;
  error?: string;
  /**
   * Who described it: "host" (the host's own areas, e.g. a host with its own schema), "file" (the connection's local file, whose
   * subschemas people edit), "hub" or "catalog". «New local schema» and the schema screens are only for a file.
   */
  source?: string;
}

/** A report parameter the SQL may name, so the AI keeps the placeholders. */
export interface DesignerAiSqlParameter {
  name: string;
  dataType?: string;
}

export interface DesignerAiSqlCodeContext {
  sql: string;
  /** Character offset of the caret inside sql. */
  cursorPosition: number;
  databaseAlias?: string;
  /** The local subschema (or host zone) of the dataset (its SchemaName, D3): only its tables travel; empty = all. */
  schemaName?: string;
  /** A Hub schema chosen in the dialog (its selector): the AI reads it instead of what the connection alias resolves to. */
  hubSchemaId?: number;
  parameters?: DesignerAiSqlParameter[];
}

export interface DesignerAiSqlChatContext {
  prompt: string;
  /** The SQL in the editor, to refine; empty to start from scratch. */
  sqlToRefine: string;
  databaseAlias?: string;
  /** The local subschema (or host zone) of the dataset (its SchemaName, D3): only its tables travel; empty = all. */
  schemaName?: string;
  /** A Hub schema chosen in the dialog (its selector): the AI reads it instead of what the connection alias resolves to. */
  hubSchemaId?: number;
  parameters?: DesignerAiSqlParameter[];
}

export interface DesignerAiExplainContext {
  sql: string;
  databaseAlias?: string;
  /** The local subschema (or host zone) of the dataset (its SchemaName, D3): only its tables travel; empty = all. */
  schemaName?: string;
  /** A Hub schema chosen in the dialog (its selector): the AI reads it instead of what the connection alias resolves to. */
  hubSchemaId?: number;
}

export interface DesignerAiExpressionContext {
  prompt: string;
  currentExpression: string;
  /** Character offset of the caret inside currentExpression. */
  cursorPosition: number;
  /** True when the expression failed to parse and the AI should repair it keeping the intent. */
  fix: boolean;
  /** The report, for the semantic context (datasets, fields, parameters, functions). */
  report?: Report;
}

/**
 * The AI the designer library talks to, implemented by the host (it owns the account, the tier,
 * the credits, the cloud endpoints and the streaming). The library brings the interface: the chat
 * frame with its two modes, the usage header, the AI log and the editors' autocompletion, the way
 * the Delphi designer's TFRpChatFrame sits on rpdatahttp. Everything streams: `onProgress` gets one
 * frame per step, `signal` cancels.
 */
export interface DesignerAi {
  // ---- settings the usage header shows ----
  readonly providers: Signal<DesignerAiOption[]>;
  readonly modes: Signal<DesignerAiOption[]>;
  /**
   * The provider and mode of one assistant, remembered by the host (always the same object for a
   * scope). The inferences below use the one of their assistant: SQL calls "sql", the expression
   * one "expression".
   */
  selection(scope: DesignerAiScope): DesignerAiSelection;
  /** Consumed share of the credits, 0..1. */
  readonly creditsRatio: Signal<number>;
  /** Spending the credit bag (a paid tier whose day is spent): the gauge turns violet. Optional for older hosts. */
  readonly usingBag?: Signal<boolean>;
  creditsTooltip(): string;
  /** Whether this person may use the AI at all (the host decides: here, whoever designs). */
  readonly available: Signal<boolean>;
  /** The Reportman AI account, for the account card on top of every chat; without it, no card. */
  readonly account?: DesignerAiAccount;
  /** The SQL autocompletion switch (persisted by the host). */
  readonly sqlAutoComplete: Signal<boolean>;
  setSqlAutoComplete(value: boolean): void;

  // ---- schemas ----
  readonly schemas: Signal<DesignerAiSchemaOption[]>;
  readonly selectedSchemaId: Signal<number | null>;
  selectSchema(id: number | null): void;
  reloadSchemas(): Promise<void>;
  /** The schema of a connection alias (any driver), or null when the host cannot tell. */
  schemaForAlias(alias: string, refresh?: boolean): Promise<DesignerAiSchemaInfo | null>;

  // ---- inferences ----
  suggestSqlCode(context: DesignerAiSqlCodeContext, onProgress: AiProgressHandler, signal: AbortSignal): Promise<AiSqlCodeSuggestions>;
  translateToSql(context: DesignerAiSqlChatContext, onProgress: AiProgressHandler, signal: AbortSignal): Promise<AiSqlResult>;
  explainSql(context: DesignerAiExplainContext, onProgress: AiProgressHandler, signal: AbortSignal): Promise<AiTextResult>;
  suggestExpression(context: DesignerAiExpressionContext, onProgress: AiProgressHandler, signal: AbortSignal): Promise<AiExpressionResult>;
  /**
   * Reports an AI answer as inappropriate or wrong (`POST /api/aireport`). Required: every text the
   * AI generates carries a visible report action (the Delphi designer and Reportman.Web do the same).
   */
  reportAbuse(errorType: "InaccurateContent" | "InappropriateContent", comments: string, aiContent: string): Promise<void>;

  // ---- diagnostics ----
  /** Every request and answer, newest last, for the chat's "Red" tab. */
  readonly netLog: Signal<AiNetLine[]>;
}

/** Optional: when the host does not provide it, the dialogs show no AI at all. */
export const DESIGNER_AI = new InjectionToken<DesignerAi>("DESIGNER_AI");
