import { computed, signal } from '@angular/core';
import { AiProgress, AiStage, AiTokenUsage } from './ai-types';

/** One row of the usage header: the tokens of one model call, by its stream id. */
export interface AiTokenRow {
  id: string;
  inputTokens: number;
  outputTokens: number;
  /** 0..1 while the prompt is being read and no token came out yet. */
  prefill: number;
}

const DEFAULT_ROW = '__default__';

/**
 * What one inference looks like while it runs, for the usage header: busy or not, the current
 * stage, one row of tokens per model call the server runs (the Delphi TFRpAISelection rows), the
 * live tail of the text arriving, and the abort handle. The frames come from the host's stream;
 * the owner (a chat, an editor) creates one tracker and hands it to the header.
 */
export class AiInferenceTracker {
  readonly busy = signal(false);
  readonly stage = signal<AiStage>('');
  readonly rows = signal<AiTokenRow[]>([]);
  readonly liveTail = signal('');
  /** The last text of the wait in the AI provider's queue («Queued: 3 s»), shown where the stage goes. */
  readonly queueText = signal('');

  readonly totalInput = computed(() => this.rows().reduce((s, r) => s + r.inputTokens, 0));
  readonly totalOutput = computed(() => this.rows().reduce((s, r) => s + r.outputTokens, 0));
  /** The prefill to show when there is one call and it is still reading the prompt; else 0. */
  readonly prefill = computed(() => {
    const rows = this.rows();
    if (rows.length !== 1) return 0;
    return rows[0].outputTokens > 0 ? 0 : rows[0].prefill;
  });

  private abortController?: AbortController;
  private estimatedPrefill = 0;

  /** The abort signal of the running inference, if any. */
  get signal(): AbortSignal | undefined {
    return this.abortController?.signal;
  }

  /** Starts a new inference: clears the rows, marks busy and returns the signal to pass to the host. */
  begin(): AbortSignal {
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.rows.set([]);
    this.stage.set('PreparingContext');
    this.liveTail.set('');
    this.queueText.set('');
    this.estimatedPrefill = 0;
    this.busy.set(true);
    return this.abortController.signal;
  }

  /** Feeds one streamed frame. */
  progress(p: AiProgress): void {
    this.stage.set(p.stage);
    if (p.stage === 'Queued') {
      this.queueText.set(p.chunk ?? '');
      return;
    }
    if (p.actor === 'AI' && p.id != null) {
      const id = String(p.id);
      const rows = [...this.rows()];
      let row = rows.find((r) => r.id === id);
      if (!row) {
        row = { id, inputTokens: 0, outputTokens: 0, prefill: 0 };
        rows.push(row);
      }
      // Each frame carries totals so far; keep the maximum, frames may arrive out of order.
      row.inputTokens = Math.max(row.inputTokens, p.inputTokens || 0);
      row.outputTokens = Math.max(row.outputTokens, p.outputTokens || 0);
      row.prefill = Math.max(row.prefill, Math.min(p.prefillPercentage || 0, 1));
      if (p.chunkType === 'End' || p.chunkType === 'Full') {
        // The call is over: its row stays with the final counts (Delphi removes it; here the
        // totals are what the person wants to see when it is done).
      }
      this.rows.set(rows);
    } else if (!this.rows().length) {
      // No model call yet: a synthetic prefill per stage, so the bar moves while the server prepares.
      this.estimatedPrefill = estimatePrefill(p.stage, p.chunkType);
    }
    if (p.stage === 'ReceivingResponse' && p.chunkType === 'Partial' && p.chunk) {
      const tail = (this.liveTail() + p.chunk).replace(/\s+/g, ' ');
      this.liveTail.set(tail.length > 160 ? '…' + tail.slice(-160) : tail);
    }
  }

  /** The synthetic prefill while no model call has reported anything (0..1). */
  stagePrefill(): number {
    return this.rows().length ? 0 : this.estimatedPrefill;
  }

  /**
   * Ends the inference. The final `steps` of the whole call, when the server sends them, replace
   * the live estimate (one row without id, as Delphi does).
   */
  finish(steps?: AiTokenUsage[]): void {
    if (steps?.length) {
      const i = steps.reduce((s, x) => s + (x.inputTokens ?? 0), 0);
      const o = steps.reduce((s, x) => s + (x.outputTokens ?? 0), 0);
      if (i > 0 || o > 0) this.rows.set([{ id: DEFAULT_ROW, inputTokens: i, outputTokens: o, prefill: 0 }]);
    }
    this.busy.set(false);
    this.stage.set('');
    this.liveTail.set('');
    this.abortController = undefined;
  }

  /** Cancels the running inference (the host's fetch gets an AbortError). */
  stop(): void {
    this.abortController?.abort();
  }

  /** The id the header prints: whole when short, `8 first…4 last` when long, nothing for the totals row. */
  static shortId(id: string): string {
    if (id === DEFAULT_ROW) return '';
    return id.length > 18 ? id.slice(0, 8) + '…' + id.slice(-4) : id;
  }
}

/** The Delphi designer's estimate when the server sends no prefill: how far along each stage is. */
export function estimatePrefill(stage: AiStage, chunkType: string): number {
  switch (stage) {
    case 'PreparingContext': return 0.15;
    case 'SendingRequest': return 0.45;
    case 'ReceivingResponse': return chunkType === 'Start' ? 0.7 : 1;
    case 'ParsingResult':
    case 'ParsingOperations': return 0.9;
    case 'ApplyingOperations': return 0.95;
    default: return 0;
  }
}
