import { Injectable, inject } from '@angular/core';
import { TranslationService } from '../services/translator.service';
import { AiAccountService } from './ai-account.service';
import { AiConfigService, AiMode, AiScope, AiTier } from './ai-config.service';
import { DESIGNER_HOST, designerHostHeaders, resolveDesignerHost } from './designer-host';
import type { DatabaseConfig } from './hub-databases.service';

/** One streamed frame of any AI endpoint through the bridge (designer envelope or NlToSql progress: same fields). */
export interface BridgeProgress {
  actor: 'None' | 'System' | 'User' | 'AI' | string;
  id: number | null;
  stage: string;
  chunkType: 'Start' | 'Partial' | 'End' | 'Full' | string;
  chunk: string;
  inputTokens: number;
  outputTokens: number;
  prefillPercentage: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens?: number;
  modelName?: string;
  totalTokens?: number;
}

export interface DesignerToolExecution {
  requestId?: string;
  toolName?: string;
  status?: string;
  explanation?: string;
  purpose?: string;
  createdDatasetName?: string;
  createdDatasetAlias?: string;
  initialSql?: string;
  finalSql?: string;
  finalErrorMessage?: string;
}

/** A dataset's SQL the cloud cannot run and asks the page for. */
export interface ClientSqlRequest {
  id: string;
  datasetAlias?: string;
  databaseAlias: string;
  sql: string;
  parameters?: { name: string; value?: unknown; dbType?: number | null }[];
}

/** What running one of them gave: its columns, or the database's message for the cloud to fix the SQL. */
export interface ClientSqlResult {
  id: string;
  success: boolean;
  errorMessage?: string;
  columns?: { name: string; dataType: string; size?: number }[];
}

/** ReportDesigner/ModifyReportStream final frame. */
export interface ModifyReportResult {
  result?: {
    contextJson?: string;
    operationsJson?: string;
    modifiedReportDocument?: string;
    explanation?: string;
    errorMessage?: string;
    debugDetails?: string;
    reportFormat?: string;
    /** Completed, Partial, Blocked, Failed or NeedsClientSqlResults (the turn waits for clientSqlRequests). */
    status?: string;
    iterationsUsed?: number;
    creditsConsumed?: number;
    toolExecutions?: DesignerToolExecution[];
    clientSqlRequests?: ClientSqlRequest[];
    /** The signed state of a turn that waits: sent back as it is, with workingContextJson as the context. */
    continuation?: string;
    workingContextJson?: string;
    success?: boolean;
  };
  steps?: TokenUsage[];
  creditsConsumed?: number | null;
  errorMessage?: string;
  /** Why the cloud refused it, for the page to tell: 'SchemaTooLargeForTier' (the plan), the bridge's codes. */
  errorCode?: string;
  debugDetails?: string;
  userProfile?: any;
}

/** ReportDesigner/PreprocessSqlContextStream final frame. */
export interface PreprocessSqlContextResult {
  result?: { dataSources?: { dataInfoName: string; sqlExplanation?: string; errorMessage?: string }[] };
  steps?: TokenUsage[];
  creditsConsumed?: number | null;
  errorMessage?: string;
  userProfile?: any;
}

/** NlToSql/* and ReportmanExpression/* final frame. */
export interface QueryApiResult {
  result?: {
    sql?: string;
    expression?: string;
    explanation?: string;
    errorMessage?: string;
    totalInputTokens?: number;
    totalOutputTokens?: number;
    creditsConsumed?: number;
    autoComplete?: { inlineCompletions?: string[]; listCompletions?: string[] };
    steps?: TokenUsage[];
    success?: boolean;
  };
  errorMessage?: string;
  userProfile?: any;
}

/**
 * What the schema generator asks a client with a direct connection to read (NlToSql/GenerateSchemaStream): the names of the tables, the columns of some, the relations in which
 * some are source or target, the first rows of some. No SQL travels.
 */
export interface SchemaClientRequest {
  id: string;
  kind: 'Tables' | 'Columns' | 'Relations' | 'Rows' | string;
  tables?: string[];
  maxRows?: number;
}

/** What reading one of them gave (by its id), as the API's SchemaClientResult: the server reads them. */
export interface SchemaClientResult {
  id: string;
  success: boolean;
  errorMessage?: string;
  [read: string]: unknown;
}

/** A schema as the cloud writes it (DatabaseConfig): what «Import» of the local schema screen takes. */
export interface GeneratedSchema {
  name?: string;
  schemaTables?: { name: string; context?: string; columns?: any[]; foreignKeys?: any[] }[];
  [other: string]: unknown;
}

/** NlToSql/GenerateSchemaStream final frame (GenerateSchemaApiResult). */
export interface GenerateSchemaApiResult {
  result?: {
    /** Completed, NeedsClientResults (read clientRequests and call again with the continuation) or Failed. */
    status?: 'Completed' | 'NeedsClientResults' | 'Failed' | string;
    clientRequests?: SchemaClientRequest[];
    continuation?: string;
    schema?: GeneratedSchema | null;
    explanation?: string;
    warnings?: string[];
    /** The credits of the whole generation so far (every call). */
    creditsConsumed?: number;
    turns?: number;
    steps?: TokenUsage[];
  };
  userProfile?: any;
  errorMessage?: string;
  errorCode?: string;
}

export type ProgressHandler = (p: BridgeProgress) => void;

/**
 * Where the page reaches the cloud's AI by default: the bridge of Reportman.Designer.Server.Ai, which
 * forwards the very same call. A host that mounts it elsewhere says so in DesignerHost.aiBridgeUrl.
 */
export const AI_BRIDGE = '/api/ai/';

/**
 * The copilot's wire client: the same cloud endpoints, bodies and SSE framing the Delphi and C#
 * designers use, called through the designer's server bridge (`/api/ai/{cloud route}`), which
 * forwards them with the session and copies the chunks back as they arrive; the login goes through
 * its relay. Plain fetch, because the HttpClient interceptor cannot stream: the host's session
 * goes in its cookie.
 */
@Injectable({ providedIn: 'root' })
export class CopilotApiService {
  private host = resolveDesignerHost(inject(DESIGNER_HOST, { optional: true }));
  private aiAccount = inject(AiAccountService);
  private aiConfig = inject(AiConfigService);
  private t = inject(TranslationService);

  /** Log of every request and answer, for the "Red" tab of the panel. */
  readonly netLog: { time: Date; text: string }[] = [];

  // ---- designer ----

  modifyReportStream(
    body: {
      reportDocument: string;
      config: { hubDatabaseId: number; hubSchemaId: number } | null;
      userInstructions: string[];
      existingContextJson: string;
      apiKey?: string | null;
      /** The turn being answered: its continuation and what running its SQL gave. */
      continuation?: string;
      clientSqlResults?: ClientSqlResult[];
    },
    onProgress: ProgressHandler,
    signal: AbortSignal,
  ): Promise<ModifyReportResult> {
    return this.stream<ModifyReportResult>('ReportDesigner/ModifyReportStream', {
      ...this.base('report'),
      config: body.config ?? undefined,
      apiKey: body.apiKey ?? undefined,
      reportDocument: body.reportDocument,
      reportFormat: 'Xml',
      userInstructions: body.userInstructions,
      userLanguage: this.aiLanguage(),
      existingOperationsJson: '',
      existingContextJson: body.existingContextJson ?? '',
      returnModifiedDocument: true,
      simplifiedPrompt: false,
      // The page runs the SQL of a connection the cloud cannot reach (the server's, through SqlColumns).
      clientExecutesSql: true,
      continuation: body.continuation || undefined,
      clientSqlResults: body.clientSqlResults?.length ? body.clientSqlResults : undefined,
    }, onProgress, signal);
  }

  preprocessSqlContextStream(
    config: { hubDatabaseId: number; hubSchemaId: number } | null,
    dataSources: { dataInfoName: string; databaseAlias: string; sql: string }[],
    onProgress: ProgressHandler,
    signal: AbortSignal,
  ): Promise<PreprocessSqlContextResult> {
    return this.stream<PreprocessSqlContextResult>('ReportDesigner/PreprocessSqlContextStream', {
      ...this.base('report'),
      config: config ?? undefined,
      userLanguage: this.aiLanguage(),
      dataSources,
    }, onProgress, signal);
  }

  // ---- SQL and expressions ----

  translateToSqlStream(config: DatabaseConfig, prompt: string, sqlToRefine: string, onProgress: ProgressHandler, signal: AbortSignal, parameters?: { name: string }[]): Promise<QueryApiResult> {
    return this.stream<QueryApiResult>('NlToSql/TranslateToSQLStream', {
      ...this.base('sql'),
      config,
      runtime: 'ADO_Net',
      userQuery: [prompt],
      sqlToRefine,
      parameters,
      complex: false,
      transcribeLanguage: this.transcribeLanguage(),
    }, onProgress, signal);
  }

  /** The audit of a dataset's SQL: technical, in the person's language, the text the copilot later reads as sqlExplanation. */
  explainSqlStream(config: DatabaseConfig, sql: string, onProgress: ProgressHandler, signal: AbortSignal, technical = true): Promise<QueryApiResult> {
    return this.stream<QueryApiResult>('NlToSql/ExplainSQLStream', {
      ...this.base('sql'),
      config,
      runtime: 'ADO_Net',
      sqlToExplain: sql,
      transcribeLanguage: this.transcribeLanguage(),
      userLanguage: this.aiLanguage(),
      tecnicalExplanation: technical,
    }, onProgress, signal);
  }

  /**
   * «Analizar con IA» of a schema (the local schema screen, F6): the cloud says, in Markdown, what it understands of
   * each table and column (🟢/🟡/🔴). The schema goes inline; nothing is stored in the cloud. With the provider and
   * mode of the schemas assistant (Precision/Fast unless the person chose), the same as «Generate with AI».
   */
  analyzeSchemaStream(config: DatabaseConfig, onProgress: ProgressHandler, signal: AbortSignal): Promise<QueryApiResult> {
    return this.stream<QueryApiResult>('NlToSql/AnalyzeSchemaStream', {
      ...this.base('schemas'),
      config,
      languageCodeIso: this.aiAccount.languageCode(),
      transcribeLanguage: this.transcribeLanguage(),
    }, onProgress, signal);
  }

  /**
   * One call of «Generar con IA»: the cloud explores the database for the domain
   * the person wrote and proposes a schema. A direct connection (`clientExecutes`) is read by whoever reaches it: the
   * answer may be NeedsClientResults with what to read, and the next call carries the `continuation` and the
   * `clientResults`. An Agent's database (`config.hubDatabaseId`) the cloud reads itself, in one call. With the
   * provider and mode of the schemas assistant; the texts of the progress, in the language of the AI.
   */
  generateSchemaStream(
    body: {
      domain: string;
      schemaName?: string;
      clientExecutes: boolean;
      config: { name?: string; dialect?: string; hubDatabaseId?: number };
      initialTables?: string[];
      continuation?: string;
      clientResults?: SchemaClientResult[];
    },
    onProgress: ProgressHandler,
    signal: AbortSignal,
  ): Promise<GenerateSchemaApiResult> {
    return this.stream<GenerateSchemaApiResult>('NlToSql/GenerateSchemaStream', {
      ...this.base('schemas'),
      config: body.config,
      domain: body.domain,
      schemaName: body.schemaName ?? '',
      languageCodeIso: this.aiAccount.languageCode(),
      clientExecutes: body.clientExecutes,
      initialTables: body.initialTables?.length && !body.continuation ? body.initialTables : undefined,
      continuation: body.continuation || undefined,
      clientResults: body.clientResults?.length ? body.clientResults : undefined,
    }, onProgress, signal);
  }

  suggestSqlCodeStream(config: DatabaseConfig, sql: string, cursorPosition: number, onProgress: ProgressHandler, signal: AbortSignal, parameters?: { name: string }[]): Promise<QueryApiResult> {
    return this.stream<QueryApiResult>('NlToSql/SuggestSqlCodeStream', {
      ...this.base('sql'),
      config,
      runtime: 'ADO_Net',
      sql,
      cursorPosition,
      parameters,
    }, onProgress, signal);
  }

  suggestExpressionStream(
    prompt: string,
    currentExpression: string,
    semanticContextJson: string,
    fix: boolean,
    onProgress: ProgressHandler,
    signal: AbortSignal,
    cursorPosition?: number,
  ): Promise<QueryApiResult> {
    return this.stream<QueryApiResult>('ReportmanExpression/SuggestExpressionStream', {
      ...this.base('expression'),
      config: {},
      userQuery: [prompt],
      currentExpression,
      fix,
      cursorPosition: cursorPosition ?? currentExpression.length,
      semanticContextJson,
      userLanguage: this.aiLanguage(),
    }, onProgress, signal);
  }

  /** POST /api/aireport (through the bridge): flags an AI answer as inappropriate or wrong. */
  async reportAbuse(errorType: 'InappropriateContent' | 'InaccurateContent', userComments: string, aiContent: string): Promise<void> {
    const url = this.host.aiBridgeUrl + 'api/aireport';
    this.log('POST ' + url);
    const response = await fetch(url, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ errorType, userComments, aiContent }),
    });
    this.log('HTTP ' + response.status + ' ' + url);
    if (!response.ok) {
      const text = await response.text();
      if (response.status === 401) this.onUnauthorized(text);
      throw new Error(this.describeFailure(response.status, text));
    }
  }

  // ---- plumbing ----

  /** Tier, mode and agent of the assistant that asks: each one keeps its own. */
  private base(scope: AiScope): Record<string, any> {
    const selection = this.aiConfig.selection(scope);
    const tier: AiTier = selection.tier();
    const mode: AiMode = selection.mode();
    const { agentSecret, agentAiId } = selection.agentCredentials();
    const body: Record<string, any> = { aiTier: tier, mode };
    if (tier === 'LocalAgent') {
      body['agentSecret'] = agentSecret;
      body['agentAiId'] = agentAiId;
      body['simplifiedPrompt'] = true;
    }
    return body;
  }

  /** The page's language: the cloud's own messages (errors, credits) come in it. */
  private language(): string {
    return this.t.lang();
  }

  /** The language the AI answers in, chosen in the account card (as Delphi sends its AILanguage). */
  private aiLanguage(): string {
    return this.aiAccount.language();
  }

  /** The cloud's TranscribeLanguage: the same names as the AI language. */
  private transcribeLanguage(): string {
    return this.aiLanguage();
  }

  /**
   * The host's session goes in its cookie; the AI's own session, when the person logged into
   * Reportman AI in the chat, in its header (the bridge turns it into the Bearer). Without it the
   * installation's guest credits pay.
   */
  private async headers(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      ...(await designerHostHeaders(this.host)),
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Accept-Language': this.language(),
    };
    const token = this.aiAccount.token;
    if (token) headers['X-Reportman-AI-Token'] = token;
    return headers;
  }

  /** A 401: the host's session ended (back to its login), or the cloud refused the AI session (back to guest). */
  private onUnauthorized(text: string): void {
    let code = '';
    try { code = JSON.parse(text)?.code ?? ''; } catch { /* the cloud's plain text */ }
    if (code === 'LoginRequired') this.host.sessionLost?.();
    else void this.aiAccount.sessionRejected();
  }

  /**
   * What to tell the person when a call fails before streaming: the bridge's own refusals come as
   * {error, code} and are translated; the cloud's (401, 402 no credits…) pass as the cloud wrote them.
   */
  private describeFailure(status: number, text: string): string {
    try {
      const body = JSON.parse(text);
      if (body?.code) return this.bridgeMessage(body.code, body.error);
      if (body?.error) return body.error;
    } catch { /* plain text from the cloud */ }
    return text || 'HTTP ' + status;
  }

  private bridgeMessage(code: string, fallback?: string): string {
    const key = 'AiBridge_' + code;
    const text = this.t.t(key);
    return text && text !== key ? text : fallback || code;
  }

  /**
   * One SSE call through the bridge: `data: {progress}` frames go to onProgress (a frame is progress
   * when it has actor and stage; final when it has result or errorMessage), the final frame is
   * returned. The redundant AI "Full" frame the designer emits after the token stream is dropped, as
   * the clients do. Aborting the signal closes the connection, and the server stops the cloud's call.
   */
  private async stream<T extends { errorMessage?: string; errorCode?: string; result?: any }>(endpoint: string, body: any, onProgress: ProgressHandler, signal: AbortSignal): Promise<T> {
    const url = this.host.aiBridgeUrl + endpoint;
    const started = Date.now();
    this.log('POST ' + url);
    const response = await fetch(url, { method: 'POST', headers: await this.headers(), body: JSON.stringify(body), signal });
    if (!response.ok) {
      const text = await response.text();
      this.log('HTTP ' + response.status + ' (' + (Date.now() - started) + ' ms) ' + text.slice(0, 200));
      if (response.status === 401) this.onUnauthorized(text);
      throw new Error(this.describeFailure(response.status, text));
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: T | undefined;
    const streamedIds = new Set<number>();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.substring(6).trim();
          if (data === '[DONE]') break;
          let parsed: any;
          try { parsed = JSON.parse(data); } catch { continue; }
          if (parsed.actor !== undefined && parsed.stage !== undefined) {
            const p: BridgeProgress = {
              actor: parsed.actor, id: parsed.id ?? null, stage: parsed.stage, chunkType: parsed.chunkType ?? 'Full',
              chunk: parsed.chunk ?? '', inputTokens: parsed.inputTokens ?? 0, outputTokens: parsed.outputTokens ?? 0,
              prefillPercentage: parsed.prefillPercentage ?? 0,
            };
            if (p.actor === 'AI' && p.id != null) {
              if (p.chunkType === 'Full' && p.stage === 'ReceivingResponse' && streamedIds.has(p.id)) continue;
              if (p.chunkType !== 'Full') streamedIds.add(p.id);
            }
            onProgress(p);
          } else if (parsed.result !== undefined || parsed.errorMessage !== undefined) {
            finalResult = parsed as T;
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* closed */ }
    }
    // The bridge closes a stream the cloud left half-way with its own final frame (errorCode).
    if (finalResult?.errorCode) finalResult.errorMessage = this.bridgeMessage(finalResult.errorCode, finalResult.errorMessage);
    this.log('HTTP 200 stream (' + (Date.now() - started) + ' ms)' + (finalResult?.errorMessage ? ' error: ' + finalResult.errorMessage : ''));
    if (!finalResult) throw new Error('The stream ended without a result');
    return finalResult;
  }

  log(line: string): void {
    this.netLog.push({ time: new Date(), text: line });
    if (this.netLog.length > 200) this.netLog.splice(0, this.netLog.length - 200);
  }
}
