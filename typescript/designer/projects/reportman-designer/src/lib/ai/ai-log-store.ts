import { signal } from '@angular/core';
import { AiLogBlock, AiNetLine, AiProgress } from './ai-types';

const MAX_NET_LINES = 300;

/**
 * The "Registro IA" and "Red" tabs of a chat: every chunk the server streams, grouped the way the
 * Delphi designer groups them — one block per model call (`id`) that grows chunk by chunk while
 * parallel calls grow side by side; the frames without id (the server telling what it does) are
 * one block per stage. `End`/`Full` closes a block; the next frame with that id opens a new one.
 *
 * Each block is shown as markdown, re-rendered from its whole text as it grows (an unfinished
 * table or code fence renders as far as it goes). Several model calls can stream at once, so the
 * rendering is batched: the frames of one animation frame cost one render per touched block.
 */
export class AiLogStore {
  readonly blocks = signal<AiLogBlock[]>([]);
  readonly net = signal<AiNetLine[]>([]);

  private items: AiLogBlock[] = [];
  private dirty = new Set<AiLogBlock>();
  private scheduled = false;

  /** @param render turns a block's text into HTML (the chat's markdown renderer). */
  constructor(private readonly render: (text: string) => string) {}

  /** Feeds one streamed frame. Returns the block it went to. */
  progress(p: AiProgress): AiLogBlock {
    // The wait in the AI provider's queue comes every second with its whole text («Queued: 3 s»): it
    // REWRITES its line while that line is still the last one, instead of adding a line per second.
    if (p.stage === 'Queued') {
      const last = this.items[this.items.length - 1];
      if (last && last.stage === 'Queued') {
        last.text = p.chunk ?? '';
        this.dirty.add(last);
        this.schedule();
        return last;
      }
      const block: AiLogBlock = { key: 'queue', id: p.id, actor: p.actor, stage: p.stage, text: p.chunk ?? '', html: '', closed: true, time: new Date() };
      this.items.push(block);
      this.dirty.add(block);
      this.schedule();
      return block;
    }
    const key = p.id != null ? 'id:' + p.id + ':' + p.actor : 'st:' + p.actor + ':' + p.stage;
    let block = [...this.items].reverse().find((b) => b.key === key && !b.closed);
    if (!block || p.chunkType === 'Start') {
      if (block && p.chunkType === 'Start') block.closed = true;
      block = { key, id: p.id, actor: p.actor, stage: p.stage, text: '', html: '', closed: false, time: new Date() };
      this.items.push(block);
    }
    // Frames of a model call are its text; the others are one line per message.
    if (p.actor === 'AI' && p.id != null) {
      block.text += p.chunk ?? '';
      // Each frame carries the totals so far: keep the largest (frames may come out of order).
      block.inputTokens = Math.max(block.inputTokens ?? 0, p.inputTokens || 0);
      block.outputTokens = Math.max(block.outputTokens ?? 0, p.outputTokens || 0);
      block.ended = new Date();
    }
    else if (p.chunk) block.text += (block.text ? '\n' : '') + p.chunk;
    block.stage = p.stage;
    if (p.chunkType === 'End' || p.chunkType === 'Full') block.closed = true;
    this.dirty.add(block);
    this.schedule();
    return block;
  }

  /** A line of the designer's own (not from the server): "[Esquema] …", "Auditoría guardada", etc. */
  line(text: string, actor = 'System'): void {
    const block: AiLogBlock = { key: 'line', id: null, actor, stage: '', text, html: '', closed: true, time: new Date() };
    this.items.push(block);
    this.dirty.add(block);
    this.schedule();
  }

  netLine(text: string): void {
    const lines = [...this.net(), { time: new Date(), text }];
    if (lines.length > MAX_NET_LINES) lines.splice(0, lines.length - MAX_NET_LINES);
    this.net.set(lines);
  }

  clear(): void {
    this.items = [];
    this.dirty.clear();
    this.blocks.set([]);
  }

  clearNet(): void {
    this.net.set([]);
  }

  /** Everything in the log exactly as it arrived, for the clipboard. */
  copyText(): string {
    return this.items.map((b) => {
      const stats = blockStats(b);
      const head = (b.id != null ? '#' + b.id + ' ' : '') + b.actor + (b.stage ? ' · ' + b.stage : '') + (stats ? ' · ' + stats : '');
      return head + '\n' + b.text;
    }).join('\n\n');
  }

  /** The totals of a finished request (the server's final steps), as one more line of the log. */
  summary(text: string): void {
    this.line(text, 'None');
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    const flush = () => {
      this.scheduled = false;
      for (const b of this.dirty) b.html = this.render(b.text);
      this.dirty.clear();
      this.blocks.set([...this.items]);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
    else setTimeout(flush, 16);
  }
}

/**
 * What a model call read and wrote and how long it took, for its heading: «12.345 → 678 tok · 9,8 s ·
 * 69 tok/s». Measured here, from its first frame to its last, so it is there for every provider.
 */
export function blockStats(b: AiLogBlock): string {
  if (b.actor !== 'AI' || b.id == null) return '';
  const parts: string[] = [];
  const fmt = (n: number) => n.toLocaleString();
  if (b.inputTokens || b.outputTokens) parts.push(fmt(b.inputTokens ?? 0) + ' → ' + fmt(b.outputTokens ?? 0) + ' tok');
  const seconds = b.ended ? (b.ended.getTime() - b.time.getTime()) / 1000 : 0;
  if (seconds > 0) {
    parts.push(seconds.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' s');
    if (b.outputTokens) parts.push(Math.round(b.outputTokens / seconds).toLocaleString() + ' tok/s');
  }
  return parts.join(' · ');
}
