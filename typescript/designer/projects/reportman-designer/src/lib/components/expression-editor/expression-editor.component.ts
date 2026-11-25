import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { loadMonaco } from '../monaco-loader';
import type * as Monaco from 'monaco-editor';
import { FunctionHelp } from '@reportman/lib';
import { TranslationService } from '../../services/translator.service';
import { DESIGNER_HOST, resolveDesignerHost } from '../../server/designer-host';

/** A parse error located in the expression, for the editor's marker. */
export interface ExpressionErrorMarker {
  message: string;
  line?: number;
  column?: number;
}

const LANGUAGE_ID = 'reportman-expr';
const KEYWORDS = ['AND', 'OR', 'NOT', 'IIF', 'TRUE', 'FALSE', 'NULL'];
let languageRegistered = false;

/** What an item of the function list is, told from its shape (the categories come translated). */
type ItemKind = 'column' | 'variable' | 'function' | 'operator' | 'constant';

function kindOf(item: FunctionHelp): ItemKind {
  const name = item.name ?? '';
  if (/^M\./i.test(name)) return 'variable';
  if (name.includes('.')) return 'column';
  if (!/^[A-Za-z_]\w*$/.test(name)) return 'operator';
  if (KEYWORDS.includes(name.toUpperCase())) return 'operator';
  if ((item.model ?? '').includes('(')) return 'function';
  return 'constant';
}

/**
 * The expression editor of the designer: Monaco with the Reportman expression language (fields as
 * ALIAS.FIELD, variables as M.NAME, functions, IIF, := for assignments), completing what the list
 * under it offers — fields after `ALIAS.`, parameters after `M.`, functions with their signature —
 * and marking the error the engine's syntax check reports. The Delphi dialog has the same list
 * but a plain memo; the web adds what a code editor gives.
 */
@Component({
  selector: 'rp-expression-editor',
  imports: [CommonModule],
  template: `
    <div #host class="rp-monaco"></div>
    @if (!ready) {
      <textarea #fallback class="rp-code" [value]="content" (input)="content = fallback.value" spellcheck="false" [attr.aria-label]="t.TranslateStr(208)"></textarea>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 80px; position: relative; }
    .rp-monaco { flex: 1 1 auto; min-height: 80px; overflow: hidden; }
    .rp-code { position: absolute; inset: 0; width: 100%; height: 100%; resize: none; border: 0; padding: 8px; font-family: Consolas, 'Courier New', monospace; font-size: 13px; line-height: 1.45; box-sizing: border-box; }
  `],
})
export class ExpressionEditorComponent implements AfterViewInit, OnDestroy {
  @Input() set document(value: string | undefined) {
    this.content = value ?? '';
  }
  /** Everything the builder lists: functions, constants, variables, operators and ALIAS.FIELD columns. */
  @Input() set items(value: FunctionHelp[] | undefined) {
    this._items = value ?? [];
    this.index();
  }
  get items(): FunctionHelp[] {
    return this._items;
  }
  /** The report's parameter aliases (offered after `M.`). */
  @Input() parameters: string[] = [];
  @Output() contentChange = new EventEmitter<string>();
  /** Character offset of the caret, on every move. */
  @Output() cursorChange = new EventEmitter<number>();
  @ViewChild('host') host?: ElementRef<HTMLDivElement>;

  ready = false;

  private _items: FunctionHelp[] = [];
  private _content = '';
  private monaco?: typeof Monaco;
  private editor?: Monaco.editor.IStandaloneCodeEditor;
  private disposables: { dispose(): void }[] = [];
  private byName = new Map<string, FunctionHelp>();
  private columnsByAlias = new Map<string, FunctionHelp[]>();
  private functionNames = new Set<string>();

  private designerHost = resolveDesignerHost(inject(DESIGNER_HOST, { optional: true }));

  constructor(public t: TranslationService) {}

  get content(): string {
    return this.editor ? this.editor.getValue() : this._content;
  }

  set content(value: string) {
    this._content = value ?? '';
    if (this.editor && this.editor.getValue() !== this._content) this.editor.setValue(this._content);
  }

  /** Character offset of the caret (end of text when the editor is not up). */
  cursorOffset(): number {
    const model = this.editor?.getModel();
    const position = this.editor?.getPosition();
    return model && position ? model.getOffsetAt(position) : this._content.length;
  }

  async ngAfterViewInit(): Promise<void> {
    try {
      if (!this.host) return;
      const monaco = await loadMonaco(this.designerHost.monacoUrl, this.host.nativeElement);
      if (!this.host) return;
      this.monaco = monaco;
      registerLanguage(monaco);
      const editor = monaco.editor.create(this.host.nativeElement, {
        value: this._content,
        language: LANGUAGE_ID,
        // Only rp.* tokens differ from vs, so the theme being global does not touch the SQL editor.
        theme: 'reportman-expr-light',
        minimap: { enabled: false },
        automaticLayout: true,
        fontSize: 13,
        fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
        wordWrap: 'on',
        lineNumbers: 'off',
        glyphMargin: false,
        folding: false,
        lineDecorationsWidth: 6,
        lineNumbersMinChars: 0,
        renderLineHighlight: 'none',
        fixedOverflowWidgets: true,
        quickSuggestions: { other: true, comments: false, strings: false },
        suggestOnTriggerCharacters: true,
        wordBasedSuggestions: 'off',
        scrollBeyondLastLine: false,
        tabSize: 2,
        ariaLabel: this.t.TranslateStr(208),
      });
      this.editor = editor;
      this.ready = true;
      editor.onDidChangeModelContent(() => {
        this._content = editor.getValue();
        this.contentChange.emit(this._content);
      });
      editor.onDidChangeCursorPosition(() => this.cursorChange.emit(this.cursorOffset()));
      this.registerProviders(monaco, editor);
      editor.focus();
    } catch (err) {
      console.warn('[rp-expression-editor] Monaco could not be loaded, keeping the plain editor', err);
    }
  }

  ngOnDestroy(): void {
    for (const d of this.disposables) { try { d.dispose(); } catch { /* already gone */ } }
    this.editor?.dispose();
  }

  focusEditor(): void {
    this.editor?.focus();
  }

  /** Inserts at the caret (replacing the selection), as one undo step; a space is added when the text would stick to a word. */
  insertAtCursor(text: string): void {
    const editor = this.editor;
    const model = editor?.getModel();
    if (!editor || !model) {
      this._content = this._content + (this._content && !/\s$/.test(this._content) ? ' ' : '') + text;
      return;
    }
    const selection = editor.getSelection() ?? new this.monaco!.Selection(1, 1, 1, 1);
    const before = model.getValueInRange({ startLineNumber: selection.startLineNumber, startColumn: Math.max(1, selection.startColumn - 1), endLineNumber: selection.startLineNumber, endColumn: selection.startColumn });
    const prefix = before && !/[\s(,]$/.test(before) ? ' ' : '';
    editor.pushUndoStop();
    editor.executeEdits('reportman-insert', [{ range: selection, text: prefix + text, forceMoveMarkers: true }]);
    editor.pushUndoStop();
    editor.focus();
  }

  /** Replaces the whole text as one undoable edit and leaves the caret at the end. */
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
    const last = model.getLineCount();
    editor.setPosition({ lineNumber: last, column: model.getLineMaxColumn(last) });
    editor.focus();
  }

  /** Marks the engine's parse error (the word at the position, or the whole line). */
  setError(error: ExpressionErrorMarker | null): void {
    const model = this.editor?.getModel();
    if (!this.monaco || !model) return;
    if (!error) {
      this.monaco.editor.setModelMarkers(model, 'reportman-expr', []);
      return;
    }
    const line = Math.min(Math.max(error.line ?? 1, 1), model.getLineCount());
    const column = Math.min(Math.max(error.column ?? 1, 1), model.getLineMaxColumn(line));
    const word = error.column ? model.getWordAtPosition({ lineNumber: line, column }) : null;
    this.monaco.editor.setModelMarkers(model, 'reportman-expr', [{
      severity: this.monaco.MarkerSeverity.Error,
      message: error.message,
      startLineNumber: line,
      startColumn: word ? word.startColumn : error.column ? column : 1,
      endLineNumber: line,
      endColumn: word ? word.endColumn : error.column ? Math.min(column + 1, model.getLineMaxColumn(line)) : model.getLineMaxColumn(line),
    }]);
  }

  // ---- index of the items ----

  private index(): void {
    this.byName.clear();
    this.columnsByAlias.clear();
    this.functionNames.clear();
    for (const item of this._items) {
      const name = (item.name ?? '').toUpperCase();
      if (!name) continue;
      this.byName.set(name, item);
      const kind = kindOf(item);
      if (kind === 'function') this.functionNames.add(name);
      if (kind === 'column') {
        const alias = name.slice(0, name.indexOf('.'));
        if (!this.columnsByAlias.has(alias)) this.columnsByAlias.set(alias, []);
        this.columnsByAlias.get(alias)!.push(item);
      }
    }
  }

  // ---- providers ----

  private registerProviders(monaco: typeof Monaco, editor: Monaco.editor.IStandaloneCodeEditor): void {
    const owner = this;
    const model = editor.getModel();
    if (!model) return;
    this.disposables.push(monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
      triggerCharacters: ['.'],
      provideCompletionItems: (m, position) => (m === model ? { suggestions: owner.suggestions(monaco, m, position) } : { suggestions: [] }),
    }));
    this.disposables.push(monaco.languages.registerSignatureHelpProvider(LANGUAGE_ID, {
      signatureHelpTriggerCharacters: ['(', ','],
      signatureHelpRetriggerCharacters: [','],
      provideSignatureHelp: (m, position) => (m === model ? owner.signatureHelp(m, position) : null),
    }));
    this.disposables.push(monaco.languages.registerHoverProvider(LANGUAGE_ID, {
      provideHover: (m, position) => (m === model ? owner.hover(m, position) : null),
    }));
  }

  private suggestions(monaco: typeof Monaco, model: Monaco.editor.ITextModel, position: Monaco.Position): Monaco.languages.CompletionItem[] {
    const Kind = monaco.languages.CompletionItemKind;
    const word = model.getWordUntilPosition(position);
    const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
    const before = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: word.startColumn });
    const items: Monaco.languages.CompletionItem[] = [];
    const dotted = /([A-Za-z_]\w*)\.\s*$/.exec(before);
    if (dotted) {
      const qualifier = dotted[1].toUpperCase();
      if (qualifier === 'M') {
        this.parameters.forEach((p, i) => items.push({ label: p, kind: Kind.Variable, insertText: p, range, sortText: String(i).padStart(4, '0'), detail: this.t.TranslateStr(152) }));
        return items;
      }
      (this.columnsByAlias.get(qualifier) ?? []).forEach((c, i) => {
        const field = (c.name ?? '').slice((c.name ?? '').indexOf('.') + 1);
        items.push({ label: field, kind: Kind.Field, insertText: field, range, sortText: String(i).padStart(4, '0'), detail: c.hint || undefined });
      });
      return items;
    }
    let i = 0;
    for (const item of this._items) {
      const name = item.name ?? '';
      if (!name) continue;
      const kind = kindOf(item);
      const sort = (kind === 'column' ? '0' : kind === 'function' ? '1' : kind === 'variable' ? '2' : kind === 'constant' ? '3' : '4') + String(i++).padStart(4, '0');
      switch (kind) {
        case 'column':
          items.push({ label: name, kind: Kind.Field, insertText: name, range, sortText: sort, detail: item.hint || this.t.TranslateStr(247) });
          break;
        case 'function':
          items.push({
            label: name, kind: Kind.Function, insertText: name + '($1)', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range, sortText: sort,
            detail: item.model || undefined, documentation: item.hint || undefined, command: { id: 'editor.action.triggerParameterHints', title: '' },
          });
          break;
        case 'variable':
          items.push({ label: name, kind: Kind.Variable, insertText: name, range, sortText: sort, detail: item.model || undefined, documentation: item.hint || undefined });
          break;
        case 'constant':
          items.push({ label: name, kind: Kind.Constant, insertText: name, range, sortText: sort, detail: item.model || undefined, documentation: item.hint || undefined });
          break;
        case 'operator':
          if (/^[A-Z]+$/i.test(name)) items.push({ label: name, kind: Kind.Keyword, insertText: name, range, sortText: sort, detail: item.model || undefined, documentation: item.hint || undefined });
          break;
      }
    }
    // The M. prefix itself, so the parameters are one dot away.
    if (this.parameters.length) items.push({ label: 'M.', kind: Kind.Module, insertText: 'M.', range, sortText: '2', detail: this.t.TranslateStr(152), command: { id: 'editor.action.triggerSuggest', title: '' } });
    return items;
  }

  /** The function whose parentheses the caret is inside, and which argument it is on. */
  private signatureHelp(model: Monaco.editor.ITextModel, position: Monaco.Position): Monaco.languages.SignatureHelpResult | null {
    const text = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
    let depth = 0;
    let commas = 0;
    let inString = false;
    for (let i = text.length - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === "'") { inString = !inString; continue; }
      if (inString) continue;
      if (ch === ')') depth++;
      else if (ch === '(') {
        if (depth === 0) {
          const m = /([A-Za-z_]\w*)\s*$/.exec(text.slice(0, i));
          const item = m ? this.byName.get(m[1].toUpperCase()) : undefined;
          if (!item || kindOf(item) !== 'function') return null;
          const label = item.model || item.name || '';
          const inner = /\((.*)\)/.exec(label)?.[1] ?? '';
          const params = inner.split(',').map((p) => p.trim()).filter((p) => p);
          return {
            value: {
              signatures: [{ label, documentation: item.hint || undefined, parameters: params.map((p) => ({ label: p })) }],
              activeSignature: 0,
              activeParameter: Math.min(commas, Math.max(0, params.length - 1)),
            },
            dispose: () => { /* nothing */ },
          };
        }
        depth--;
      } else if (ch === ',' && depth === 0) commas++;
    }
    return null;
  }

  private hover(model: Monaco.editor.ITextModel, position: Monaco.Position): Monaco.languages.Hover | null {
    const word = model.getWordAtPosition(position);
    if (!word) return null;
    // ALIAS.FIELD and M.NAME are one identifier for the engine but two words for Monaco.
    const line = model.getLineContent(position.lineNumber);
    const left = /([A-Za-z_]\w*)\.$/.exec(line.slice(0, word.startColumn - 1));
    const candidates = left ? [left[1] + '.' + word.word, word.word] : [word.word];
    for (const name of candidates) {
      const item = this.byName.get(name.toUpperCase());
      if (item) {
        const parts = ['**' + (item.model || item.name) + '**'];
        if (item.hint) parts.push(item.hint);
        if (item.category) parts.push('_' + item.category + '_');
        return { contents: parts.map((value) => ({ value })) };
      }
    }
    return null;
  }
}

/** The Monarch grammar of Reportman expressions, registered once per page. */
function registerLanguage(monaco: typeof Monaco): void {
  if (languageRegistered) return;
  languageRegistered = true;
  monaco.languages.register({ id: LANGUAGE_ID });
  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, {
    brackets: [['(', ')'], ['[', ']']],
    autoClosingPairs: [{ open: '(', close: ')' }, { open: '[', close: ']' }, { open: "'", close: "'", notIn: ['string'] }],
    surroundingPairs: [{ open: '(', close: ')' }, { open: "'", close: "'" }],
    wordPattern: /[A-Za-z_][\w]*/,
  });
  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
    ignoreCase: true,
    keywords: KEYWORDS,
    tokenizer: {
      root: [
        [/\[[^\]]*\]/, 'rp.field'],
        [/M\.[A-Za-z_]\w*/, 'rp.variable'],
        [/[A-Za-z_]\w*\.[A-Za-z_]\w*/, 'rp.field'],
        [/[A-Za-z_]\w*(?=\s*\()/, 'rp.function'],
        [/[A-Za-z_]\w*/, { cases: { '@keywords': 'rp.keyword', '@default': 'identifier' } }],
        [/\d+(\.\d+)?/, 'number'],
        [/'([^']|'')*'/, 'string'],
        [/'([^']|'')*$/, 'string.invalid'],
        [/:=|<>|><|>=|<=|[=<>+\-*\/;,]/, 'operator'],
        [/[()]/, '@brackets'],
        [/\s+/, 'white'],
      ],
    },
  } as Monaco.languages.IMonarchLanguage);
  monaco.editor.defineTheme('reportman-expr-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'rp.field', foreground: '1a5fb4', fontStyle: 'bold' },
      { token: 'rp.variable', foreground: '7a3e9d', fontStyle: 'bold' },
      { token: 'rp.function', foreground: '0a6b4f' },
      { token: 'rp.keyword', foreground: '9c2f8f', fontStyle: 'bold' },
    ],
    colors: {},
  });
}
