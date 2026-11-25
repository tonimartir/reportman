import { AfterViewInit, Component, ElementRef, EventEmitter, Inject, Input, OnDestroy, OnInit, Optional, Output, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { loadMonaco } from '../monaco-loader';
import type * as Monaco from 'monaco-editor';
import { TranslationService } from '../../services/translator.service';
import { DESIGNER_HOST, resolveDesignerHost } from '../../server/designer-host';
import { DESIGNER_AI, DesignerAi, DesignerAiSchemaInfo, DesignerAiSchemaTable, DesignerAiSqlParameter } from '../../shell/designer-ai';
import { AiInferenceTracker } from '../../ai/ai-inference-tracker';
import { AiProgress } from '../../ai/ai-types';
import { AiUsageHeaderComponent } from '../../ai/ai-usage-header.component';
import { DesignerAiBridgeService } from '../../server/designer-ai-bridge.service';
import { SchemaChoice, SchemaChosen } from '../../copilot/schema-choice';
import { SchemaSelectorComponent } from '../../copilot/schema-selector.component';

/** A database error located in the SQL, for the editor's markers. */
export interface SqlErrorMarker {
  message: string;
  line?: number;
  column?: number;
}

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'ON', 'AND', 'OR', 'NOT', 'IN', 'EXISTS',
  'BETWEEN', 'LIKE', 'IS NULL', 'IS NOT NULL', 'GROUP BY', 'ORDER BY', 'HAVING', 'ASC', 'DESC', 'DISTINCT', 'AS', 'CASE', 'WHEN', 'THEN',
  'ELSE', 'END', 'UNION', 'UNION ALL', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'CAST', 'WITH', 'LIMIT', 'OFFSET', 'FIRST', 'SKIP', 'TOP',
];
const NOT_AN_ALIAS = new Set(['WHERE', 'ON', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'JOIN', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'SET', 'VALUES', 'UNION', 'AS', 'AND', 'OR', 'NATURAL', 'USING']);

interface AiRequest {
  id: number;
  sql: string;
  offset: number;
  key: string;
  resolve: (r: { inline: string[]; list: string[] }) => void;
}

/**
 * The SQL editor of the dataset dialog: Monaco in process (no WebView, no bridge), with two layers
 * of completion. The static one is free and instant: tables, columns, the aliases of the SQL being
 * written, the report's parameters and the keywords of the dialect, from the part of the database
 * chosen in the header (the copilot's list: a subschema of the connection's own schema or a Hub
 * schema; the dataset's to start with). The AI one (ghost text and list, one request per caret
 * position) follows the Delphi designer's rules: switch in the editor's own header, one second of
 * quiet after the last keystroke, nothing when only the caret moved, the newest request aborts the
 * one in flight, Stop in the header, one row of tokens per model call.
 */
@Component({
  selector: 'rp-sql-editor',
  imports: [CommonModule, MatTooltipModule, AiUsageHeaderComponent, SchemaSelectorComponent],
  template: `
    <div class="rp-sql-header">
      @if (ai) {
        @if (schemas) {
          <!-- The dataset's own choice, as the copilot's list: it never moves the copilot's. -->
          <rp-schema-selector class="rp-sql-schema" [choice]="schemas" (chosen)="schemaChosen($event)"></rp-schema-selector>
        }
        <button type="button" class="rpd-tool rpd-tool-text rp-sql-ai-toggle" [class.is-active]="ai.sqlAutoComplete()" (click)="toggleAi()"
          [matTooltip]="t.t('Ai_AutoCompleteHint')" [matTooltipShowDelay]="300" [attr.aria-pressed]="ai.sqlAutoComplete()" [attr.aria-label]="t.t('Ai_AutoCompleteHint')">
          <span class="material-icons" aria-hidden="true">auto_awesome</span> {{ t.t('Ai_AutoComplete') }}
        </button>
        @if (ai.sqlAutoComplete()) {
          <rp-ai-usage-header class="rp-sql-usage" [tracker]="tracker" [showGauge]="false" [compact]="true" [showTail]="false" scope="sql" (stop)="stopAi()"></rp-ai-usage-header>
        }
      }
    </div>
    <div #host class="rp-monaco"></div>
    @if (!ready) {
      <textarea #fallback class="rp-code" [value]="content" (input)="content = fallback.value" spellcheck="false" wrap="off" [attr.aria-label]="t.t('Sql_Editor')"></textarea>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 160px; position: relative; }
    .rp-sql-header { display: flex; align-items: center; gap: 5px; min-height: 30px; padding: 2px 0 4px; flex: 0 0 auto; }
    .rp-sql-schema { flex: 0 1 340px; }
    .rp-sql-usage { flex: 1 1 auto; min-width: 0; }
    .rp-sql-usage ::ng-deep .rp-ai-usage { border-bottom: 0; background: transparent; padding: 0 4px; min-height: 26px; }
    .rp-monaco { flex: 1 1 auto; min-height: 120px; border: 1px solid var(--rpd-border); border-radius: 4px; overflow: hidden; }
    .rp-code { position: absolute; left: 0; right: 0; bottom: 0; top: 34px; width: 100%; resize: none; border: 1px solid var(--rpd-border); border-radius: 4px; padding: 8px;
      font-family: Consolas, 'Courier New', monospace; font-size: 13px; line-height: 1.4; box-sizing: border-box; }
  `],
})
export class SqlEditorComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() set document(value: string | undefined) {
    this.content = value ?? '';
  }
  /** The connection alias of the dataset: what the AI schema is resolved from. */
  @Input() databaseAlias?: string;
  /** The dataset's part of the database (SchemaName): the selector starts with it. */
  @Input() schemaName?: string;
  /** The Hub schema the dataset was made with (HubSchemaId): the selector starts with it on an Agent connection. */
  @Input() hubSchemaId?: number;
  /** The report's parameters, offered as placeholders and sent to the AI. */
  @Input() parameters: DesignerAiSqlParameter[] = [];
  /** The schema of the connection alias (tables, columns, dialect, its subschemas). */
  @Input() set schema(value: DesignerAiSchemaInfo | null | undefined) {
    this._schema = value ?? null;
    this.applyLanguage();
    if (this.initialized) void this.startSchemaChoice();
  }
  get schema(): DesignerAiSchemaInfo | null {
    return this._schema;
  }
  @Output() execute = new EventEmitter<void>();
  @Output() contentChange = new EventEmitter<string>();
  /** Every frame of the AI autocompletion, for the dialog's AI log. */
  @Output() aiProgress = new EventEmitter<AiProgress>();
  /** Lines the editor wants in the AI log ("[IA] 3 sugerencias", errors). */
  @Output() aiLog = new EventEmitter<string>();
  @ViewChild('host') host?: ElementRef<HTMLDivElement>;

  ready = false;
  readonly tracker = new AiInferenceTracker();

  private _schema: DesignerAiSchemaInfo | null = null;
  private _content = '';
  private monaco?: typeof Monaco;
  private editor?: Monaco.editor.IStandaloneCodeEditor;
  private disposables: { dispose(): void }[] = [];

  // AI request lifecycle (Delphi LCL rules).
  private nextRequestId = 1;
  private pending: AiRequest | null = null;
  private running: AiRequest | null = null;
  private debounceTimer?: any;
  private lastSql: string | null = null;
  private cache: { key: string; at: number; result: { inline: string[]; list: string[] } } | null = null;

  private designerHost = resolveDesignerHost(inject(DESIGNER_HOST, { optional: true }));

  /**
   * The part of the database the dialog's AI reads and the completion offers (the copilot's list, local and cloud):
   * the dataset's own, kept here while the dialog is open; the copilot's choice is never moved. Only with the AI.
   */
  readonly schemas: SchemaChoice | null;
  /** Something was chosen in the list (or the list chose a subschema just made): what the dataset keeps on «Aceptar». */
  private schemaTouched = false;
  private initialized = false;
  private schemaStart = 0;

  constructor(public t: TranslationService, @Optional() @Inject(DESIGNER_AI) public ai: DesignerAi | null) {
    this.schemas = ai ? new SchemaChoice({ scope: 'sql' }) : null;
  }

  get content(): string {
    return this.editor ? this.editor.getValue() : this._content;
  }

  set content(value: string) {
    this._content = value ?? '';
    if (this.editor && this.editor.getValue() !== this._content) this.editor.setValue(this._content);
  }

  ngOnInit(): void {
    this.initialized = true;
    void this.startSchemaChoice();
  }

  /**
   * The list starts with what the dataset was made with (its SchemaName or HubSchemaId), once the cloud list is there,
   * and again when the dialog has the connection's schema; never over a choice made in it.
   */
  private async startSchemaChoice(): Promise<void> {
    const choice = this.schemas;
    if (!choice || this.schemaTouched) return;
    const start = ++this.schemaStart;
    await choice.loadCloud();
    if (start !== this.schemaStart || this.schemaTouched) return;
    choice.startDataset(this.databaseAlias ?? '', this._schema, { schemaName: this.schemaName, hubSchemaId: this.hubSchemaId });
  }

  /**
   * A schema chosen in the list, or the subschema just made in the local schema screen (the one chosen, read again
   * from it, stays as it was): the AI's suggestions for the other one are of no use.
   */
  schemaChosen(chosen: SchemaChosen): void {
    if (chosen.byHand || chosen.remember) this.schemaTouched = true;
    this.cache = null;
    this.lastSql = null;
  }

  /**
   * What the AI calls of the dialog send of the choice: a subschema of the connection's own schema by name, or a Hub
   * schema by id; with nothing chosen, the dataset's SchemaName (the bridge then applies the copilot's order).
   */
  schemaContext(): { schemaName?: string; hubSchemaId?: number } {
    const key = this.schemas?.selectedKey() ?? '';
    if (key.startsWith('hub:')) return { hubSchemaId: Number(key.substring('hub:'.length)) };
    if (key.startsWith('local:')) return { schemaName: key.substring('local:'.length) };
    return { schemaName: this.schemaName || undefined };
  }

  /**
   * «Aceptar»: what the dataset keeps of a choice made in the list (D3), or null. A subschema of the connection's own
   * schema by name (and remembered for the connection, as the copilot remembers it); the Hub schema of an Agent
   * connection by id. A direct connection never keeps a Hub schema of the list (the copilot's rule).
   */
  acceptSchema(): { schemaName: string; hubSchemaId?: number } | null {
    const choice = this.schemas;
    if (!choice || !this.schemaTouched) return null;
    const key = choice.selectedKey();
    if (key.startsWith('local:') && choice.info()) {
      const name = key.substring('local:'.length);
      DesignerAiBridgeService.rememberSubschema(choice.alias(), name);
      return { schemaName: name };
    }
    if (key.startsWith('hub:') && this._schema?.kind === 'agent') return { schemaName: '', hubSchemaId: Number(key.substring('hub:'.length)) };
    return null;
  }

  async ngAfterViewInit(): Promise<void> {
    try {
      if (!this.host) return;
      const monaco = await loadMonaco(this.designerHost.monacoUrl, this.host.nativeElement);
      if (!this.host) return;
      this.monaco = monaco;
      const editor = monaco.editor.create(this.host.nativeElement, {
        value: this._content,
        language: this.languageId(),
        theme: 'vs',
        minimap: { enabled: false },
        automaticLayout: true,
        fontSize: 13,
        fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
        wordWrap: 'on',
        fixedOverflowWidgets: true,
        quickSuggestions: { other: true, comments: false, strings: false },
        suggestOnTriggerCharacters: true,
        wordBasedSuggestions: 'off',
        inlineSuggest: { enabled: true, showToolbar: 'always' },
        scrollBeyondLastLine: false,
        tabSize: 2,
        ariaLabel: this.t.t('Sql_Editor'),
      });
      this.editor = editor;
      this.ready = true;
      editor.onDidChangeModelContent(() => {
        this._content = editor.getValue();
        this.contentChange.emit(this._content);
      });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => this.execute.emit());
      this.registerStaticCompletion(monaco, editor);
      this.registerAiCompletion(monaco, editor);
      editor.focus();
    } catch (err) {
      console.warn('[rp-sql-editor] Monaco could not be loaded, keeping the plain editor', err);
    }
  }

  ngOnDestroy(): void {
    this.stopAi();
    for (const d of this.disposables) { try { d.dispose(); } catch { /* already gone */ } }
    this.editor?.dispose();
  }

  focusEditor(): void {
    this.editor?.focus();
  }

  /** Replaces the whole text as one undoable edit (Ctrl+Z brings the previous SQL back). */
  applyText(text: string): void {
    const editor = this.editor;
    const model = editor?.getModel();
    if (!editor || !model) {
      this.content = text;
      return;
    }
    editor.pushUndoStop();
    editor.executeEdits('reportman-ai', [{ range: model.getFullModelRange(), text, forceMoveMarkers: true }]);
    editor.pushUndoStop();
    editor.focus();
  }

  /** Marks a database error in the editor (whole first line when no position is known). */
  setError(error: SqlErrorMarker | null): void {
    const model = this.editor?.getModel();
    if (!this.monaco || !model) return;
    if (!error) {
      this.monaco.editor.setModelMarkers(model, 'reportman-db', []);
      return;
    }
    const line = Math.min(Math.max(error.line ?? 1, 1), model.getLineCount());
    const column = Math.max(error.column ?? 1, 1);
    const word = error.column ? model.getWordAtPosition({ lineNumber: line, column }) : null;
    const startColumn = word ? word.startColumn : error.column ? column : 1;
    const endColumn = word ? word.endColumn : error.column ? Math.min(column + 1, model.getLineMaxColumn(line)) : model.getLineMaxColumn(line);
    this.monaco.editor.setModelMarkers(model, 'reportman-db', [{
      severity: this.monaco.MarkerSeverity.Error,
      message: error.message,
      startLineNumber: line,
      startColumn,
      endLineNumber: line,
      endColumn,
    }]);
  }

  toggleAi(): void {
    if (!this.ai) return;
    const next = !this.ai.sqlAutoComplete();
    this.ai.setSqlAutoComplete(next);
    if (!next) this.stopAi();
  }

  /** Stops the running autocompletion and forgets the pending one (the header's Stop). */
  stopAi(): void {
    clearTimeout(this.debounceTimer);
    if (this.pending) { this.pending.resolve({ inline: [], list: [] }); this.pending = null; }
    this.tracker.stop();
  }

  // ---- static completion: schema, aliases, parameters, keywords ----

  private languageId(): string {
    const d = (this._schema?.dialect ?? '').toLowerCase();
    if (d === 'postgresql') return 'pgsql';
    if (d === 'mysql') return 'mysql';
    return 'sql';
  }

  private applyLanguage(): void {
    const model = this.editor?.getModel();
    if (this.monaco && model) this.monaco.editor.setModelLanguage(model, this.languageId());
  }

  private registerStaticCompletion(monaco: typeof Monaco, editor: Monaco.editor.IStandaloneCodeEditor): void {
    const owner = this;
    const model = editor.getModel();
    if (!model) return;
    for (const lang of ['sql', 'pgsql', 'mysql']) {
      this.disposables.push(monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ['.', ' '],
        provideCompletionItems: (m, position) => {
          if (m !== model) return { suggestions: [] };
          return { suggestions: owner.staticSuggestions(monaco, m, position) };
        },
      }));
      this.disposables.push(monaco.languages.registerHoverProvider(lang, {
        provideHover: (m, position) => {
          if (m !== model) return null;
          return owner.hover(m, position);
        },
      }));
    }
  }

  /** `FROM t a`, `JOIN t AS a` in the text → alias → table (upper-case keys). */
  private aliases(sql: string): Map<string, string> {
    const map = new Map<string, string>();
    const re = /\b(?:from|join|update|into)\s+("?[\w$.]+"?)(?:\s+(?:as\s+)?("?[\w$]+"?))?/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(sql))) {
      const table = match[1].replace(/"/g, '');
      const alias = match[2]?.replace(/"/g, '');
      if (alias && !NOT_AN_ALIAS.has(alias.toUpperCase())) map.set(alias.toUpperCase(), table);
      map.set(table.toUpperCase(), table);
    }
    return map;
  }

  /** The tables of the part of the database chosen in the header; with nothing chosen, those of the connection alias. */
  private completionTables(): DesignerAiSchemaTable[] {
    return this.schemas?.selectedTables() ?? this._schema?.tables ?? [];
  }

  private tableByName(name: string): DesignerAiSchemaTable | undefined {
    const tables = this.completionTables();
    const upper = name.toUpperCase();
    return tables.find((x) => x.name.toUpperCase() === upper) ?? tables.find((x) => x.name.toUpperCase().endsWith('.' + upper));
  }

  private staticSuggestions(monaco: typeof Monaco, model: Monaco.editor.ITextModel, position: Monaco.Position): Monaco.languages.CompletionItem[] {
    const word = model.getWordUntilPosition(position);
    const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
    const before = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: word.startColumn });
    const sql = model.getValue();
    const aliases = this.aliases(sql);
    const tables = this.completionTables();
    const items: Monaco.languages.CompletionItem[] = [];
    const Kind = monaco.languages.CompletionItemKind;

    // `alias.` or `table.`: the columns of that table only.
    const dotted = /("?[\w$]+"?)\.\s*$/.exec(before);
    if (dotted) {
      const qualifier = dotted[1].replace(/"/g, '');
      const table = this.tableByName(aliases.get(qualifier.toUpperCase()) ?? qualifier);
      if (table) {
        table.columns.forEach((c, i) => items.push({
          label: c.name, kind: Kind.Field, insertText: c.name, range, sortText: '0' + String(i).padStart(4, '0'),
          detail: c.detectedType || c.dataType, documentation: c.isPrimaryKey ? 'PK' : (c.context || undefined),
        }));
      }
      return items;
    }

    // After FROM / JOIN: tables first.
    const afterFrom = /\b(from|join|into|update)\s+$/i.test(before);
    tables.forEach((table, i) => items.push({
      label: table.name, kind: Kind.Struct, insertText: table.name, range, sortText: (afterFrom ? '0' : '1') + String(i).padStart(4, '0'),
      detail: table.context || (table.columns.length + ' ' + this.t.t('Sql_Columns')),
    }));
    if (afterFrom) return items;

    // Columns of the tables named in the SQL (qualified with the alias when there is more than one source).
    const sources = [...aliases.entries()].filter(([key, table]) => key !== table.toUpperCase() || ![...aliases.keys()].some((k) => k !== key && aliases.get(k) === table));
    const qualify = sources.length > 1;
    sources.forEach(([aliasKey, tableName], ti) => {
      const table = this.tableByName(tableName);
      if (!table) return;
      const alias = aliasKey === tableName.toUpperCase() ? tableName : [...aliases.keys()].find((k) => k === aliasKey) ?? tableName;
      table.columns.forEach((c, ci) => items.push({
        label: qualify ? alias + '.' + c.name : c.name, kind: Kind.Field, insertText: qualify ? alias + '.' + c.name : c.name, range,
        sortText: '0' + String(ti).padStart(2, '0') + String(ci).padStart(4, '0'), detail: table.name + ' · ' + (c.detectedType || c.dataType),
      }));
    });

    // The report's parameters, with the placeholder prefix of .NET drivers.
    this.parameters.forEach((p, i) => items.push({
      label: '@' + p.name, kind: Kind.Variable, insertText: '@' + p.name, range, sortText: '2' + String(i).padStart(4, '0'), detail: p.dataType || this.t.TranslateStr(249),
    }));

    SQL_KEYWORDS.forEach((k, i) => items.push({ label: k, kind: Kind.Keyword, insertText: k, range, sortText: '3' + String(i).padStart(4, '0') }));
    return items;
  }

  private hover(model: Monaco.editor.ITextModel, position: Monaco.Position): Monaco.languages.Hover | null {
    const word = model.getWordAtPosition(position);
    if (!word) return null;
    const upper = word.word.toUpperCase();
    const table = this.tableByName(word.word);
    if (table) {
      return { contents: [{ value: '**' + table.name + '**' + (table.context ? ' — ' + table.context : '') }, { value: table.columns.map((c) => c.name + ': ' + (c.detectedType || c.dataType) + (c.isPrimaryKey ? ' (PK)' : '')).join('  \n') }] };
    }
    const aliases = this.aliases(model.getValue());
    for (const [, tableName] of aliases) {
      const t = this.tableByName(tableName);
      const column = t?.columns.find((c) => c.name.toUpperCase() === upper);
      if (column) return { contents: [{ value: '**' + t!.name + '.' + column.name + '**: ' + (column.detectedType || column.dataType) + (column.isPrimaryKey ? ' (PK)' : '') + (column.context ? '\n\n' + column.context : '') }] };
    }
    return null;
  }

  // ---- AI completion ----

  private registerAiCompletion(monaco: typeof Monaco, editor: Monaco.editor.IStandaloneCodeEditor): void {
    const ai = this.ai;
    const model = editor.getModel();
    if (!ai || !model) return;
    const owner = this;
    const enabled = () => ai.sqlAutoComplete() && ai.available();
    for (const lang of ['sql', 'pgsql', 'mysql']) {
      this.disposables.push(monaco.languages.registerInlineCompletionsProvider(lang, {
        provideInlineCompletions: async (m: Monaco.editor.ITextModel, position: Monaco.Position, context: Monaco.languages.InlineCompletionContext) => {
          if (m !== model || !enabled()) return { items: [] };
          const explicit = context.triggerKind === monaco.languages.InlineCompletionTriggerKind.Explicit;
          const s = await owner.aiSuggestions(m, position, explicit);
          return { items: s.inline.filter((x) => x).map((insertText) => ({ insertText })) };
        },
        disposeInlineCompletions: () => { /* nothing to free */ },
      } as any));
      this.disposables.push(monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: [' ', '.', '(', ','],
        provideCompletionItems: async (m, position, context) => {
          if (m !== model || !enabled()) return { suggestions: [] };
          const explicit = context.triggerKind === monaco.languages.CompletionTriggerKind.Invoke;
          const s = await owner.aiSuggestions(m, position, explicit);
          const word = m.getWordUntilPosition(position);
          const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
          return {
            suggestions: s.list.filter((x) => x).map((label, index) => ({
              label, kind: monaco.languages.CompletionItemKind.Snippet, insertText: label, filterText: word.word + label, sortText: '!' + String(index).padStart(3, '0'), range, detail: 'AI',
            })),
          };
        },
      }));
    }
  }

  /**
   * One AI request per caret position, shared by the ghost text and the list. Nothing when only
   * the caret moved; a second of quiet (none when invoked on purpose); the newest request cancels
   * the one in flight, whose promise resolves empty so Monaco frees it.
   */
  private aiSuggestions(model: Monaco.editor.ITextModel, position: Monaco.Position, explicit: boolean): Promise<{ inline: string[]; list: string[] }> {
    const sql = model.getValue();
    const key = position.lineNumber + ':' + position.column + ':' + sql.length;
    if (this.cache && this.cache.key === key && Date.now() - this.cache.at < 2000) return Promise.resolve(this.cache.result);
    if (!explicit && sql === this.lastSql) return Promise.resolve({ inline: [], list: [] });
    return new Promise((resolve) => {
      // A newer keystroke supersedes whatever was waiting.
      if (this.pending) this.pending.resolve({ inline: [], list: [] });
      this.pending = { id: this.nextRequestId++, sql, offset: model.getOffsetAt(position), key, resolve };
      clearTimeout(this.debounceTimer);
      if (this.running) {
        // Let the one in flight die; the pending one starts when it ends.
        this.tracker.stop();
        return;
      }
      this.debounceTimer = setTimeout(() => this.startPending(), explicit ? 0 : 1000);
    });
  }

  private async startPending(): Promise<void> {
    const ai = this.ai;
    const request = this.pending;
    if (!ai || !request || this.running) return;
    this.pending = null;
    this.running = request;
    const signal = this.tracker.begin();
    try {
      const result = await ai.suggestSqlCode(
        { sql: request.sql, cursorPosition: request.offset, databaseAlias: this.databaseAlias, ...this.schemaContext(), parameters: this.parameters },
        (p) => { this.tracker.progress(p); this.aiProgress.emit(p); },
        signal,
      );
      if (result.errorMessage) {
        this.aiLog.emit('[IA] ' + result.errorMessage);
        request.resolve({ inline: [], list: [] });
      } else {
        const value = { inline: result.inline ?? [], list: result.list ?? [] };
        this.lastSql = request.sql;
        this.cache = { key: request.key, at: Date.now(), result: value };
        this.aiLog.emit('[IA] inline: ' + value.inline.length + ' · list: ' + value.list.length);
        request.resolve(value);
      }
      this.tracker.finish(result.steps);
    } catch (err: any) {
      request.resolve({ inline: [], list: [] });
      if (err?.name !== 'AbortError' && !signal.aborted) this.aiLog.emit('[IA] ' + (err?.message ?? String(err)));
      this.tracker.finish();
    } finally {
      this.running = null;
      // The keystrokes that arrived meanwhile: the newest one goes now, without waiting again.
      if (this.pending) this.startPending();
    }
  }
}
