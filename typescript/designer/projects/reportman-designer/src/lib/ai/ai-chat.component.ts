import { AfterViewInit, Component, ElementRef, EventEmitter, Inject, Input, OnInit, Optional, Output, ViewChild, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { TranslationService } from '../services/translator.service';
import { DESIGNER_AI, DesignerAi, DesignerAiSchemaOption, DesignerAiScope } from '../shell/designer-ai';
import { WideSelectPanelDirective } from '../shell/widgets/wide-select-panel.directive';
import { AiInferenceTracker } from './ai-inference-tracker';
import { AiLogStore, blockStats } from './ai-log-store';
import { copyToClipboard, handleCodeCopy, renderAiMarkdown } from './ai-markdown';
import { openAiReport } from './ai-report-dialog.component';
import { AiProgress, AiProgressHandler, AiResultBase } from './ai-types';
import { AiUsageHeaderComponent } from './ai-usage-header.component';
import { AiAccountComponent } from './ai-account.component';

export type AiChatMode = 'suggestion' | 'design';

export interface AiChatMessage {
  role: 'user' | 'assistant' | 'system' | 'error';
  text: string;
  html?: string;
  time: Date;
  applied?: boolean;
  /** Applied, but something of the turn did not happen (a tool blocked or failed): said, not «Applied». */
  partial?: boolean;
  /** An assistant message the designer wrote itself (the welcome, "no answer"): not AI output, nothing to report. */
  local?: boolean;
}

/** What a handler gets to drive one inference: the abort signal and where to send the frames. */
export interface AiChatRun {
  signal: AbortSignal;
  onProgress: AiProgressHandler;
}

/**
 * The chat frame every assistant of the designer shares (the Delphi designer's TFRpChatFrame):
 * usage header, optional schema selector, Chat / AI log / Net tabs, prompt and buttons. Two modes:
 *
 * - `suggestion`: the owner's handler asks the AI and calls `setSuggestion(content, explanation)`;
 *   the chat shows it and lights **Apply**, which emits `apply(content)` (SQL and expressions).
 * - `design`: the owner's handler applies the result itself; the second button is **Refresh
 *   context** and emits `refresh` (the copilot of the report).
 *
 * While the inference runs the frame jumps to the AI log — a report can take minutes, and the log
 * is where the person sees it is alive — and comes back to the chat when it is done.
 */
@Component({
  selector: 'rp-ai-chat',
  imports: [CommonModule, FormsModule, MatSelectModule, MatTooltipModule, AiUsageHeaderComponent, AiAccountComponent, WideSelectPanelDirective],
  template: `
    <div class="rp-chat">
      @if (showAccount && ai?.account && ai?.available()) {
        <!-- Delphi's PLoginHost: the Reportman AI account on top of every chat. -->
        <div class="rp-chat-account"><rp-ai-account (changed)="accountChanged.emit($event)"></rp-ai-account></div>
      }
      <rp-ai-usage-header [tracker]="tracker" [showGauge]="showGauge" [compact]="compactHeader" [scope]="scope" (stop)="stop()">
        <ng-content select="[rpChatHeaderExtra]"></ng-content>
      </rp-ai-usage-header>
      <!-- The second row: what the AI reads (the Hub schema, an area) and its menu; the first is the provider, mode and gauge. -->
      @if ((showSchema && ai) || schemaRow) {
        <div class="rp-chat-schema">
          @if (showSchema && ai) {
          <div class="rpd-select-chip" [matTooltip]="selectedSchema()?.offline ? t.t('Ai_AgentOfflineHint') : selectedSchema()?.example ? t.t('Ai_ExampleReadOnly') : t.t('Ai_Schema')" [matTooltipShowDelay]="400">
            <span class="material-icons rp-chat-chip-ico" aria-hidden="true">schema</span>
            <mat-select rpWideSelectPanel class="rpd-select" panelClass="rpd-select-panel" hideSingleSelectionIndicator
              [value]="ai.selectedSchemaId()" (valueChange)="ai.selectSchema($event)" [placeholder]="t.t('Ai_NoSchema')" [aria-label]="t.t('Ai_Schema')">
              <mat-select-trigger>
                @if (selectedSchema()?.offline) {<span class="rpd-offline-dot" role="img" [attr.aria-label]="t.t('Ai_AgentOffline')"></span>}{{ selectedSchema()?.name }}@if (selectedSchema()?.example) {<span class="rp-demo-badge">DEMO</span>}
              </mat-select-trigger>
              <mat-option [value]="null">{{ t.t('Ai_NoSchema') }}</mat-option>
              @for (s of ai.schemas(); track s.id) {
                <mat-option [value]="s.id" [matTooltip]="s.offline ? t.t('Ai_AgentOfflineHint') : s.example ? t.t('Ai_ExampleReadOnly') : ''" [matTooltipShowDelay]="400" matTooltipPosition="right">
                  @if (s.offline) {<span class="rpd-offline-dot" role="img" [attr.aria-label]="t.t('Ai_AgentOffline')"></span>}{{ s.name }}@if (s.example) {<span class="rp-demo-badge">DEMO</span>}
                </mat-option>
              }
            </mat-select>
          </div>
          <button type="button" class="rpd-tool rpd-tool-sm" (click)="ai.reloadSchemas()" [matTooltip]="t.t('Ai_ReloadSchemas')" [matTooltipShowDelay]="400" [attr.aria-label]="t.t('Ai_ReloadSchemas')">
            <span class="material-icons" aria-hidden="true">refresh</span>
          </button>
          }
          <ng-content select="[rpChatSchemaExtra]"></ng-content>
        </div>
      }

      <div class="rp-chat-tabs" role="tablist">
        <button type="button" class="rpd-tab" role="tab" [class.is-active]="tab() === 'chat'" [attr.aria-selected]="tab() === 'chat'" (click)="tab.set('chat')">{{ t.t('Ai_TabChat') }}</button>
        <button type="button" class="rpd-tab" role="tab" [class.is-active]="tab() === 'log'" [attr.aria-selected]="tab() === 'log'" (click)="tab.set('log')">
          {{ t.t('Ai_TabLog') }} @if (log.blocks().length) { <span class="rp-chat-count">{{ log.blocks().length }}</span> }
        </button>
        <button type="button" class="rpd-tab" role="tab" [class.is-active]="tab() === 'net'" [attr.aria-selected]="tab() === 'net'" (click)="tab.set('net')">{{ t.t('Ai_TabNet') }}</button>
        <span class="rpd-spacer"></span>
        @if (tab() === 'log') {
          <button type="button" class="rpd-tool rpd-tool-sm" (click)="copyLog()" [matTooltip]="t.t('Ai_CopyAll')" [matTooltipShowDelay]="400" [attr.aria-label]="t.t('Ai_CopyAll')"><span class="material-icons" aria-hidden="true">content_copy</span></button>
          <button type="button" class="rpd-tool rpd-tool-sm" (click)="log.clear()" [matTooltip]="t.t('Ai_Clear')" [matTooltipShowDelay]="400" [attr.aria-label]="t.t('Ai_Clear')"><span class="material-icons" aria-hidden="true">delete_sweep</span></button>
        } @else if (tab() === 'net') {
          <button type="button" class="rpd-tool rpd-tool-sm" (click)="log.clearNet()" [matTooltip]="t.t('Ai_Clear')" [matTooltipShowDelay]="400" [attr.aria-label]="t.t('Ai_Clear')"><span class="material-icons" aria-hidden="true">delete_sweep</span></button>
        }
      </div>

      <div class="rp-chat-body" #body (click)="onBodyEvent($event)" (keydown)="onBodyEvent($event)" (scroll)="onBodyScroll()">
        @if (tab() === 'chat') {
          @for (m of messages(); track $index) {
            <div class="rp-msg" [class]="'rp-msg rp-msg-' + m.role">
              @if (m.html) { <div class="rpd-md" [innerHTML]="m.html"></div> } @else { <div class="rp-msg-text">{{ m.text }}</div> }
              @if (m.applied && m.partial) { <div class="rp-msg-applied rp-msg-partial"><span class="material-icons" aria-hidden="true">warning</span> {{ t.t('Ai_PartiallyApplied') }}</div> }
              @else if (m.applied) { <div class="rp-msg-applied"><span class="material-icons" aria-hidden="true">check_circle</span> {{ t.t('Ai_Applied') }}</div> }
              <div class="rp-msg-foot">
                @if (isGenerated(m)) {
                  <button type="button" class="rpd-report-btn" (click)="report(m.text)" [matTooltip]="t.t('Ai_Report')" [matTooltipShowDelay]="300" [attr.aria-label]="t.t('Ai_Report')">
                    <span class="material-icons" aria-hidden="true">thumb_down</span>
                  </button>
                }
                <span class="rpd-spacer"></span>
                <span class="rp-msg-time">{{ m.time.toLocaleTimeString() }}</span>
              </div>
            </div>
          }
        } @else if (tab() === 'log') {
          @for (b of log.blocks(); track $index) {
            <div class="rp-log-block" [class]="'rp-log-block rp-log-' + b.actor.toLowerCase()" [class.is-open]="!b.closed">
              <div class="rp-log-head">
                @if (b.id != null) { <span class="rp-log-id">#{{ b.id }}</span> }
                <span>{{ b.actor }}</span>
                @if (b.stage) { <span class="rp-log-stage">· {{ b.stage }}</span> }
                @if (stats(b); as st) { <span class="rp-log-stats">· {{ st }}</span> }
                @if (!b.closed) { <span class="rp-log-live" aria-hidden="true">▋</span> }
                <span class="rpd-spacer"></span>
                @if (b.actor === 'AI' && (b.closed || !tracker.busy()) && b.text.trim()) {
                  <button type="button" class="rpd-report-btn" (click)="report(b.text)" [matTooltip]="t.t('Ai_Report')" [matTooltipShowDelay]="300" [attr.aria-label]="t.t('Ai_Report')">
                    <span class="material-icons" aria-hidden="true">thumb_down</span>
                  </button>
                }
                <span class="rp-log-time">{{ b.time.toLocaleTimeString() }}</span>
              </div>
              <div class="rpd-md rp-log-text" [innerHTML]="b.html"></div>
            </div>
          } @empty { <p class="rp-chat-hint">{{ t.t('Ai_LogEmpty') }}</p> }
        } @else {
          @for (line of netLines(); track $index) { <div class="rp-net-line"><span class="rp-net-time">{{ line.time.toLocaleTimeString() }}</span> {{ line.text }}</div> }
          @empty { <p class="rp-chat-hint">{{ t.t('Ai_NetEmpty') }}</p> }
        }
      </div>

      <div class="rp-chat-footer">
        <textarea #promptBox class="rpd-textarea rp-chat-prompt" [(ngModel)]="prompt" rows="3" [placeholder]="t.t('Ai_PromptPlaceholder')"
          [disabled]="tracker.busy() || !(ai?.available() ?? false)" (keydown)="onKeydown($event)" [attr.aria-label]="t.t('Ai_PromptPlaceholder')"></textarea>
        <div class="rp-chat-buttons">
          <button type="button" class="rpd-tool rpd-tool-primary rpd-tool-text" (click)="send()" [disabled]="tracker.busy() || !prompt.trim() || !(ai?.available() ?? false)">
            <span class="material-icons" aria-hidden="true">send</span> {{ t.t('Ai_Send') }}
          </button>
          @if (mode === 'suggestion') {
            <button type="button" class="rpd-tool rpd-tool-text" (click)="applySuggestion()" [disabled]="tracker.busy() || suggestion() === null">
              <span class="material-icons" aria-hidden="true">input</span> {{ t.t('Ai_Apply') }}
            </button>
          } @else {
            <button type="button" class="rpd-tool rpd-tool-text" (click)="refresh.emit()" [disabled]="tracker.busy()">
              <span class="material-icons" aria-hidden="true">sync</span> {{ t.t('Ai_RefreshContext') }}
            </button>
          }
          @if (tracker.busy()) {
            <button type="button" class="rpd-tool rpd-tool-text rp-danger" (click)="stop()"><span class="material-icons" aria-hidden="true">stop_circle</span> {{ t.t('Ai_Stop') }}</button>
          } @else {
            <button type="button" class="rpd-tool rpd-tool-text" (click)="clear()"><span class="material-icons" aria-hidden="true">delete_sweep</span> {{ t.t('Ai_Clear') }}</button>
          }
        </div>
        @if (!(ai?.available() ?? false)) { <div class="rp-chat-hint rp-chat-unavailable">{{ t.t('Ai_NotAvailable') }}</div> }
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; min-width: 0; }
    .rp-chat { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; min-width: 0; background: var(--rpd-surface-2); font-size: var(--rpd-fs-lg); }
    .rp-chat-account { padding: 4px 6px; background: var(--rpd-surface); border-bottom: 1px solid var(--rpd-border-soft); }
    .rp-chat-schema { display: flex; align-items: center; gap: 4px; padding: 4px 6px; background: var(--rpd-surface); border-bottom: 1px solid var(--rpd-border-soft); }
    .rp-chat-schema .rpd-select-chip { flex: 1 1 auto; }
    .rp-chat-chip-ico { font-size: 14px; color: var(--rpd-text-3); }
    .rp-chat-tabs { display: flex; align-items: center; gap: 2px; padding: 0 4px; background: var(--rpd-surface); border-bottom: 1px solid var(--rpd-border-soft); }
    .rp-chat-tabs .rpd-tab { height: 26px; }
    .rp-chat-count { background: var(--rpd-surface-3); border-radius: 8px; padding: 0 5px; font-size: var(--rpd-fs-sm); font-weight: 400; }
    .rp-chat-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; line-height: 1.45; }
    .rp-chat-hint { margin: 0; padding: 4px 2px; color: var(--rpd-text-3); font-size: var(--rpd-fs); line-height: 1.5; }
    .rp-msg { position: relative; max-width: 100%; padding: 6px 9px; border-radius: 8px; overflow-wrap: anywhere; }
    .rp-msg-user { align-self: flex-end; margin-left: 28px; border-radius: 8px 8px 2px 8px; background: var(--rpd-accent-bg); white-space: pre-wrap; }
    .rp-msg-assistant { align-self: stretch; border: 1px solid var(--rpd-border-soft); border-radius: 8px 8px 8px 2px; background: var(--rpd-surface); }
    .rp-msg-system { border: 1px solid #f1dfa6; background: #fffaeb; color: #6b4e00; font-size: var(--rpd-fs); white-space: pre-wrap; }
    .rp-msg-error { border: 1px solid #f1c4c0; background: #fdf0ef; color: var(--rpd-danger); white-space: pre-wrap; }
    .rp-msg-foot { display: flex; align-items: center; gap: 4px; margin-top: 3px; }
    .rp-msg-time { color: var(--rpd-text-3); font-size: var(--rpd-fs-sm); }
    .rp-msg-applied { display: flex; align-items: center; gap: 4px; margin-top: 4px; color: var(--rpd-ok); font-size: var(--rpd-fs); }
    .rp-msg-applied .material-icons { font-size: 14px; }
    .rp-msg-partial { color: var(--rpd-warn); }
    .rp-log-stats { color: var(--rpd-text-2); font-variant-numeric: tabular-nums; }
    .rp-danger { border-color: #e2a5a0; color: var(--rpd-danger); }
    .rp-log-block { border: 1px solid var(--rpd-border-soft); border-radius: 4px; background: var(--rpd-surface); font-size: var(--rpd-fs); }
    .rp-log-block.is-open { border-color: var(--rpd-accent-border); }
    .rp-log-system, .rp-log-hub { border-color: #f1dfa6; }
    .rp-log-head { display: flex; align-items: center; gap: 5px; padding: 2px 6px; border-bottom: 1px solid var(--rpd-border-soft); color: var(--rpd-text-2); font-size: var(--rpd-fs-sm); }
    .rp-log-id { font-family: monospace; color: var(--rpd-accent-strong); }
    .rp-log-stage { color: var(--rpd-text-3); }
    .rp-log-live { color: var(--rpd-accent); animation: rp-blink 1s steps(2) infinite; }
    @keyframes rp-blink { to { opacity: 0; } }
    .rp-log-time { color: var(--rpd-text-3); }
    .rp-log-text { padding: 5px 8px; font-size: var(--rpd-fs); }
    .rp-log-text:empty { display: none; }
    .rp-net-line { color: var(--rpd-text-2); font-family: monospace; font-size: var(--rpd-fs-sm); }
    .rp-net-time { color: var(--rpd-text-3); }
    .rp-chat-footer { display: flex; flex-direction: column; gap: 5px; padding: 6px; background: var(--rpd-surface); border-top: 1px solid var(--rpd-border-soft); }
    .rp-chat-prompt { min-height: 54px; font-size: var(--rpd-fs-lg); line-height: 1.4; }
    .rp-chat-buttons { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
    .rp-chat-unavailable { color: #6b4e00; }
  `],
})
export class AiChatComponent implements OnInit, AfterViewInit {
  @Input() mode: AiChatMode = 'suggestion';
  /** Whose provider and mode the header shows: each assistant keeps its own. */
  @Input() scope: DesignerAiScope = 'report';
  @Input() showSchema = false;
  /** The second row even without the Hub schema, for what the owner puts in `rpChatSchemaExtra`. */
  @Input() schemaRow = false;
  /** The Reportman AI account card on top (when the host has an account). */
  @Input() showAccount = true;
  @Input() showGauge = true;
  @Input() compactHeader = false;
  /** The assistant's first message, explaining what this chat does. */
  @Input() initialMessage = '';
  /** The i18n key of the label over a suggestion ("SQL propuesto", "Expresión propuesta"). */
  @Input() suggestionLabelKey = 'Ai_SuggestedSql';
  /** The code fence language of a suggestion. */
  @Input() suggestionLanguage = 'sql';
  /** The text after Apply ("SQL aplicado al editor."). */
  @Input() appliedMessageKey = 'Ai_SqlApplied';
  /** Runs one prompt: asks the AI through `run()` and reports with `setSuggestion` / `addAssistant` / `addError`. */
  @Input() handler?: (prompt: string, chat: AiChatComponent) => Promise<void>;
  @Output() apply = new EventEmitter<string>();
  @Output() refresh = new EventEmitter<void>();
  /** Logged into or out of Reportman AI from the card (true when logged in). */
  @Output() accountChanged = new EventEmitter<boolean>();

  @ViewChild('body') body?: ElementRef<HTMLElement>;
  @ViewChild('promptBox') promptBox?: ElementRef<HTMLTextAreaElement>;

  readonly tracker = new AiInferenceTracker();
  readonly log = new AiLogStore((text) => this.markdown(text));
  readonly messages = signal<AiChatMessage[]>([]);
  readonly tab = signal<'chat' | 'log' | 'net'>('chat');
  readonly suggestion = signal<string | null>(null);

  prompt = '';

  /** The chosen Hub schema of the selector, for its closed text (with the red dot when its Agent is not connected). */
  selectedSchema(): DesignerAiSchemaOption | undefined {
    const id = this.ai?.selectedSchemaId();
    return id == null ? undefined : this.ai?.schemas().find((s) => s.id === id);
  }

  /** Whether the reader is at the bottom of the body: new content follows only then (or when forced). */
  private atBottom = true;
  private scrollPending = false;

  constructor(public t: TranslationService, @Optional() @Inject(DESIGNER_AI) public ai: DesignerAi | null, private dialog: MatDialog) {
    // Coming back to a tab shows its latest content.
    effect(() => {
      this.tab();
      this.scrollToEnd(true);
    });
  }

  ngOnInit(): void {
    if (this.initialMessage) this.addAssistant(this.initialMessage, true, { local: true });
  }

  ngAfterViewInit(): void {
    // Without moving anything: the designer inside a page (a box below the page's own text) must not
    // scroll the page, nor its own box, to show the prompt box
    setTimeout(() => this.promptBox?.nativeElement.focus({ preventScroll: true }), 50);
  }

  netLines() {
    return this.ai?.netLog() ?? this.log.net();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  /**
   * A text left in the prompt box, not sent: the person reads it, changes it or sends it (the request a
   * sample report suggests). The box too, as in `send()`: the binding may not see it within the frame.
   */
  setPrompt(text: string): void {
    this.prompt = text;
    if (this.promptBox) this.promptBox.nativeElement.value = text;
  }

  async send(): Promise<void> {
    const text = this.prompt.trim();
    if (!text || this.tracker.busy() || !this.handler) return;
    this.prompt = '';
    // The box too: with coalesced change detection, a text typed (or pasted, or dictated) and sent within one frame
    // was never seen by the binding, so '' would look unchanged and the old text would stay in the box.
    if (this.promptBox) this.promptBox.nativeElement.value = '';
    this.push({ role: 'user', text, time: new Date() });
    this.suggestion.set(null);
    this.tab.set('log');
    this.log.line('— ' + new Date().toLocaleTimeString() + ' —');
    const signal = this.tracker.begin();
    try {
      await this.handler(text, this);
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal.aborted) this.addSystem(this.t.t('Ai_GenerationStopped'));
      else this.addError(err?.error?.error ?? err?.error?.errorMessage ?? err?.message ?? String(err));
    } finally {
      this.tracker.finish();
      this.tab.set('chat');
      setTimeout(() => this.promptBox?.nativeElement.focus({ preventScroll: true }), 0);
    }
  }

  /**
   * What the handler needs to call the host: the abort signal of the inference `send()` started
   * (or a fresh one when called on its own) and the frame sink (tracker + log).
   */
  run(): AiChatRun {
    if (!this.tracker.busy()) this.runStarted = Date.now();
    const signal = this.tracker.busy() && this.tracker.signal ? this.tracker.signal : this.tracker.begin();
    return { signal, onProgress: (p: AiProgress) => this.progress(p) };
  }

  /** The frames of an inference that is already running (the handler started it with `run()`'s signal). */
  progress(p: AiProgress): void {
    this.tracker.progress(p);
    this.log.progress(p);
    this.scrollToEnd();
  }

  /** Ends the running inference with its final frame (steps, credits). */
  finish(result?: AiResultBase): void {
    this.tracker.finish(result?.steps);
    this.logTotals(result);
  }

  /** When the running request started (for its total time in the log). */
  private runStarted = 0;

  /**
   * The whole request at the end of the log: what every model call read and wrote, with the
   * reasoning part, the model, the credits and the time from the prompt to the answer.
   */
  private logTotals(result?: AiResultBase): void {
    const steps = result?.steps ?? [];
    const parts: string[] = [];
    if (steps.length) {
      const sum = (pick: (x: any) => number | undefined) => steps.reduce((a, x) => a + (pick(x) ?? 0), 0);
      const thinking = sum((x) => x.thinkingTokens);
      if (steps.length > 1) parts.push(this.t.t('Ai_LogCalls', { calls: steps.length }));
      parts.push(this.t.t('Ai_LogTotalTokens', { input: sum((x) => x.inputTokens).toLocaleString(), output: sum((x) => x.outputTokens).toLocaleString() })
        + (thinking ? ' (' + this.t.t('Ai_LogThinking', { tokens: thinking.toLocaleString() }) + ')' : ''));
      const models = [...new Set(steps.map((x) => x.modelName).filter((m) => !!m))];
      if (models.length) parts.push(models.join(', '));
    }
    if (result?.creditsConsumed) parts.push(this.t.t('Ai_LogCredits', { credits: result.creditsConsumed.toLocaleString() }));
    if (this.runStarted) {
      parts.push(((Date.now() - this.runStarted) / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' s');
      this.runStarted = 0;
    }
    if (parts.length) this.log.summary('Σ ' + parts.join(' · '));
  }

  protected stats(b: Parameters<typeof blockStats>[0]): string {
    return blockStats(b);
  }

  /** The AI's proposal: shown with its explanation, Apply lights up. */
  setSuggestion(content: string, explanation?: string): void {
    const label = this.t.t(this.suggestionLabelKey);
    const md = (explanation?.trim() ? explanation.trim() + '\n\n' : '') + '**' + label + ':**\n\n```' + this.suggestionLanguage + '\n' + content + '\n```';
    this.addAssistant(md, true);
    this.suggestion.set(content);
  }

  /**
   * An assistant message. Everything that comes from the AI goes through here and carries the
   * report action; `local` marks the few the designer writes itself (the welcome, "no answer").
   */
  addAssistant(text: string, markdown = true, options?: { applied?: boolean; partial?: boolean; local?: boolean }): void {
    this.push({ role: 'assistant', text, html: markdown ? this.markdown(text) : undefined, time: new Date(), applied: options?.applied, partial: options?.partial, local: options?.local });
  }

  /** A message of the designer (progress, "applied", errors of the context): markdown, never reportable. */
  addSystem(text: string): void {
    this.push({ role: 'system', text, html: this.markdown(text), time: new Date() });
  }

  addError(text: string): void {
    this.push({ role: 'error', text, time: new Date() });
  }

  applySuggestion(): void {
    const content = this.suggestion();
    if (content === null) return;
    this.apply.emit(content);
    const messages = [...this.messages()];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') { messages[i].applied = true; break; }
    }
    this.messages.set(messages);
    this.addSystem(this.t.t(this.appliedMessageKey));
  }

  stop(): void {
    this.tracker.stop();
  }

  clear(): void {
    this.messages.set([]);
    this.suggestion.set(null);
    if (this.initialMessage) this.addAssistant(this.initialMessage, true, { local: true });
  }

  async copyLog(): Promise<void> {
    if (await copyToClipboard(this.log.copyText())) this.log.line(this.t.t('Ai_Copied'));
  }

  /** The report action is on every assistant message the AI wrote, and only there. */
  isGenerated(m: AiChatMessage): boolean {
    return m.role === 'assistant' && !m.local && !!m.text.trim();
  }

  /** Opens "Report AI-generated content" for that text. */
  report(aiContent: string): void {
    if (!this.ai) return;
    openAiReport(this.dialog, this.ai, aiContent).subscribe((sent) => { if (sent) this.addSystem(this.t.t('Ai_ReportSent')); });
  }

  /** The Copy of a code block (the rendered markdown is plain HTML, so its clicks are handled here). */
  onBodyEvent(event: Event): void {
    handleCodeCopy(event, { copy: this.t.t('Ai_CopyCode'), copied: this.t.t('Ai_CodeCopied') });
  }

  onBodyScroll(): void {
    const el = this.body?.nativeElement;
    if (el) this.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }

  private markdown(text: string): string {
    return renderAiMarkdown(text, { thinking: this.t.t('Ai_Thinking'), copy: this.t.t('Ai_CopyCode') });
  }

  private push(m: AiChatMessage): void {
    this.messages.set([...this.messages(), m]);
    this.scrollToEnd(m.role === 'user');
  }

  /**
   * Follows new content while the reader is at the bottom (like the Delphi log: scrolling up more
   * than 100 px to read stops it); `force` for the reader's own actions.
   */
  private scrollToEnd(force = false): void {
    if (!force && !this.atBottom) return;
    if (this.scrollPending) return;
    this.scrollPending = true;
    // After the render: the log publishes its blocks on the next animation frame.
    const go = () => {
      this.scrollPending = false;
      const el = this.body?.nativeElement;
      if (el) { el.scrollTop = el.scrollHeight; this.atBottom = true; }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(go));
    else setTimeout(go, 32);
  }
}
