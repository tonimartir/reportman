import { Component, Inject, Input, Optional, Output, EventEmitter, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslationService } from '../services/translator.service';
import { DESIGNER_AI, DesignerAi, DesignerAiScope } from '../shell/designer-ai';
import { AiInferenceTracker } from './ai-inference-tracker';

/**
 * The usage header every AI surface shares (the Delphi designer's TFRpAISelection). At rest it is
 * the provider and mode selectors plus the credit gauge; while an inference runs it turns into
 * Stop, a spinner and one row of tokens per model call the server is running, so several threads
 * show as several rows. The host's settings come through DESIGNER_AI; the inference through a
 * tracker the owner feeds.
 */
@Component({
  selector: 'rp-ai-usage-header',
  imports: [CommonModule, MatSelectModule, MatTooltipModule],
  template: `
    @if (!tracker?.busy()) {
      <div class="rp-ai-usage rp-ai-usage-rest" [class.rp-ai-usage-compact]="compact">
        @if (ai) {
          <div class="rpd-select-chip" [matTooltip]="t.t('Ai_Provider')" [matTooltipShowDelay]="400">
            <span class="material-icons rp-ai-chip-ico" aria-hidden="true">psychology</span>
            @if (!compact) { <span class="rpd-select-chip-caption">{{ t.t('Ai_Provider') }}</span> }
            <mat-select class="rpd-select" panelClass="rpd-select-panel" [panelWidth]="null" hideSingleSelectionIndicator
              [value]="ai.selection(scope).provider()" (valueChange)="ai.selection(scope).setProvider($event)" [aria-label]="t.t('Ai_Provider')">
              <mat-select-trigger>{{ providerLabel() }}</mat-select-trigger>
              @for (op of ai.providers(); track op.value) {
                <mat-option [value]="op.value">{{ op.label }}@if (op.description) { <small class="rp-ai-op-desc"> · {{ op.description }}</small> }</mat-option>
              }
            </mat-select>
          </div>
          <div class="rpd-select-chip" [matTooltip]="t.t('Ai_Mode')" [matTooltipShowDelay]="400">
            <span class="material-icons rp-ai-chip-ico" aria-hidden="true">speed</span>
            @if (!compact) { <span class="rpd-select-chip-caption">{{ t.t('Ai_Mode') }}</span> }
            <mat-select class="rpd-select" panelClass="rpd-select-panel" [panelWidth]="null" hideSingleSelectionIndicator
              [value]="ai.selection(scope).mode()" (valueChange)="ai.selection(scope).setMode($event)" [aria-label]="t.t('Ai_Mode')">
              @for (op of ai.modes(); track op.value) { <mat-option [value]="op.value">{{ op.label }}</mat-option> }
            </mat-select>
          </div>
          <span class="rpd-spacer"></span>
          @if (showGauge && ai.selection(scope).consumesCredits()) {
            <svg class="rp-ai-gauge" viewBox="0 0 24 24" role="img" [attr.aria-label]="t.t('Ai_Credits') + ' ' + percent() + '%'" [matTooltip]="ai.creditsTooltip()" [matTooltipShowDelay]="200">
              <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--rpd-surface-3)" stroke-width="2.5"></circle>
              <circle cx="12" cy="12" r="10.5" fill="none" [attr.stroke]="gaugeColor()" stroke-width="2.5" stroke-linecap="round"
                [attr.stroke-dasharray]="dash()" transform="rotate(-90 12 12)"></circle>
              <!-- The used percentage in the middle, as Delphi's TFRpAISelection draws it (no % sign). -->
              <text x="12" y="12" text-anchor="middle" dominant-baseline="central" class="rp-ai-gauge-text"
                [attr.fill]="percentColor()">{{ percent() }}</text>
            </svg>
          }
        }
        <ng-content></ng-content>
      </div>
    } @else {
      <div class="rp-ai-usage rp-ai-usage-busy" [class.rp-ai-usage-compact]="compact">
        <button type="button" class="rpd-tool rpd-tool-text rp-ai-stop" (click)="stop.emit()" [attr.aria-label]="t.t('Ai_Stop')">
          <span class="material-icons" aria-hidden="true">stop_circle</span> {{ t.t('Ai_Stop') }}
        </button>
        <span class="rp-ai-spinner" aria-hidden="true"></span>
        <div class="rp-ai-rows">
          @if (tracker!.rows().length) {
            @for (row of tracker!.rows(); track row.id; let i = $index) {
              <div class="rp-ai-row">
                @if (i === 0 && tracker!.rows().length > 1) { <b>{{ tracker!.rows().length }}-</b> }
                {{ t.t('Ai_InputOutput') }}:
                @if (row.outputTokens === 0 && row.prefill > 0) {
                  <span class="rp-ai-prefill">{{ t.t('Ai_Prefill', { percent: (row.prefill * 100).toFixed(0) }) }}</span>
                } @else {
                  {{ row.inputTokens.toLocaleString() }}
                }
                / {{ row.outputTokens.toLocaleString() }}
                @if (shortId(row.id)) { <span class="rp-ai-id">#{{ shortId(row.id) }}</span> }
              </div>
            }
          } @else {
            <div class="rp-ai-row rp-ai-row-wait">{{ stageLabel() }}</div>
          }
          @if (showTail && tracker!.liveTail()) { <div class="rp-ai-tail">{{ tracker!.liveTail() }}</div> }
        </div>
        <ng-content select="[rpAiBusyExtra]"></ng-content>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .rp-ai-usage { display: flex; align-items: center; gap: 5px; min-height: 28px; padding: 3px 6px; background: var(--rpd-surface); border-bottom: 1px solid var(--rpd-border-soft); font-size: var(--rpd-fs); }
    .rp-ai-usage-rest .rpd-select-chip { flex: 0 1 auto; max-width: 220px; }
    .rp-ai-usage-compact .rpd-select-chip { max-width: 150px; }
    .rp-ai-chip-ico { font-size: 14px; color: var(--rpd-text-3); }
    .rp-ai-op-desc { color: var(--rpd-text-3); font-weight: 400; }
    .rp-ai-gauge { width: 26px; height: 26px; flex: 0 0 auto; }
    .rp-ai-gauge-text { font-size: 9px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .rp-ai-usage-busy { align-items: flex-start; }
    .rp-ai-stop { border-color: #e2a5a0; color: var(--rpd-danger); flex: 0 0 auto; }
    .rp-ai-spinner { flex: 0 0 16px; width: 16px; height: 16px; margin-top: 5px; border-radius: 50%; border: 2px solid var(--rpd-accent-border); border-top-color: var(--rpd-accent); animation: rp-ai-spin 0.9s linear infinite; }
    @keyframes rp-ai-spin { to { transform: rotate(360deg); } }
    .rp-ai-rows { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; padding-top: 3px; }
    .rp-ai-row { color: var(--rpd-text-2); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 18px; }
    .rp-ai-row b { color: var(--rpd-text); margin-right: 3px; }
    .rp-ai-row-wait { color: var(--rpd-text-3); font-style: italic; }
    .rp-ai-prefill { color: var(--rpd-accent-strong); }
    .rp-ai-id { margin-left: 6px; color: var(--rpd-text-3); font-family: monospace; font-size: var(--rpd-fs-sm); }
    .rp-ai-tail { color: var(--rpd-text-3); font-family: monospace; font-size: var(--rpd-fs-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left; }
  `],
})
export class AiUsageHeaderComponent {
  /** The inference this header reflects; without one it only shows the settings. */
  @Input() tracker?: AiInferenceTracker;
  /** Hide the credit gauge (an editor's header shows it in the dialog's chat instead). */
  @Input() showGauge = true;
  /** Narrow places: icons only on the selectors. */
  @Input() compact = false;
  /** Show the live tail of the text arriving under the token rows. */
  @Input() showTail = true;
  /** The assistant whose provider and mode the selectors show and change. */
  @Input() scope: DesignerAiScope = 'report';
  @Output() stop = new EventEmitter<void>();

  readonly gaugeColor = computed(() => {
    // Violet while spending the credit bag (29-10-2026): never read as the day's green/orange/red.
    if (this.ai?.usingBag?.()) return '#7e57c2';
    const v = this.ai?.creditsRatio() ?? 0;
    if (v >= 0.9) return '#c62828';
    if (v >= 0.75) return '#ef6c00';
    if (v >= 0.5) return '#f9a825';
    return '#2e7d32';
  });

  constructor(public t: TranslationService, @Optional() @Inject(DESIGNER_AI) public ai: DesignerAi | null) {}

  providerLabel(): string {
    const value = this.ai?.selection(this.scope).provider();
    return this.ai?.providers().find((p) => p.value === value)?.label ?? value ?? '';
  }

  dash(): string {
    const circumference = 2 * Math.PI * 10.5;
    const v = Math.max(0, Math.min(1, this.ai?.creditsRatio() ?? 0));
    return (v * circumference).toFixed(2) + ' ' + circumference.toFixed(2);
  }

  /** Credits used, 0–100, rounded as Delphi shows it inside the gauge. */
  readonly percent = computed(() => Math.max(0, Math.min(100, Math.round((this.ai?.creditsRatio() ?? 0) * 100))));
  /** The number takes the arc's colour; at 0 it is grey, except while spending the credit bag: a violet 0 says the
   *  day is spent and the bag has started (29-10-2026). */
  readonly percentColor = computed(() => (this.percent() > 0 || this.ai?.usingBag?.() ? this.gaugeColor() : 'var(--rpd-text-3)'));

  shortId(id: string): string {
    return AiInferenceTracker.shortId(id);
  }

  stageLabel(): string {
    const stage = this.tracker?.stage() ?? '';
    // The server writes the wait in the queue already in the person's language.
    if (stage === 'Queued') return this.tracker?.queueText() || this.t.t('Ai_StageWorking');
    const key: Record<string, string> = {
      PreparingContext: 'Ai_StagePreparing',
      SendingRequest: 'Ai_StageSending',
      ReceivingResponse: 'Ai_StageReceiving',
      ParsingOperations: 'Ai_StageParsing',
      ParsingResult: 'Ai_StageParsing',
      ApplyingOperations: 'Ai_StageApplying',
    };
    return this.t.t(key[stage] ?? (stage ? 'Ai_StageWorking' : 'Ai_Waiting'));
  }
}
