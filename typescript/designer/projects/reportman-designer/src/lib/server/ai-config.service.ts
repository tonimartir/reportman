import { Injectable, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import { TranslationService } from '../services/translator.service';

/**
 * Which AI answers: the cloud tiers (Standard / Precision, they consume credits) or one of the
 * account's own agents running a local model (LocalAgent, free). Same values the Delphi, C# and
 * Reportman.Web clients send to the cloud API (AITierType + AIMode).
 */
export type AiTier = 'Standard' | 'Precision' | 'LocalAgent';
export type AiMode = 'Fast' | 'Reasoning';

/** The mode of an assistant whose mode the person never chose (a choice is kept in localStorage). */
export const DEFAULT_AI_MODE: AiMode = 'Reasoning';

/**
 * The designer's assistants: the report copilot, the SQL one (chat, audit and completion of the
 * dataset dialog), the expression one and the schemas one («Analyze with AI» and «Generate with AI»
 * of the local schema screen). Each keeps its own
 * provider and mode, as each Delphi assistant has its own TFRpAISelection; here they are also
 * remembered in the browser.
 */
export type AiScope = 'report' | 'sql' | 'expression' | 'schemas';

/**
 * Where an assistant starts when the person never chose. The schemas one in Precision/Fast (a schema
 * is generated or analyzed in one go, and Precision describes better), kept apart: it never starts
 * from the single choice the page kept before the assistants had their own. The rest in Standard and
 * {@link DEFAULT_AI_MODE}, from that choice when there is one.
 */
export const AI_SCOPE_DEFAULTS: Readonly<Record<AiScope, { provider: string; mode: AiMode; inherits: boolean }>> = {
  report: { provider: 'Standard', mode: DEFAULT_AI_MODE, inherits: true },
  sql: { provider: 'Standard', mode: DEFAULT_AI_MODE, inherits: true },
  expression: { provider: 'Standard', mode: DEFAULT_AI_MODE, inherits: true },
  schemas: { provider: 'Precision', mode: 'Fast', inherits: false },
};

/** An agent-hosted model, from the aiEndpoints part of GET /api/agent/databases. */
export interface AgentAiEndpoint {
  id: number;
  agentSecret: string;
  name: string;
  engine: number;
  agentName: string;
  isOnline: boolean;
}

export interface ProviderOption {
  /** 'Standard' | 'Precision' | 'Agent_<id>' */
  value: string;
  label: string;
  icon?: string;
  description?: string;
  agentSecret?: string;
}

/** One assistant's choice: provider and mode, kept in localStorage under its own keys. */
export class AiScopeSelection {
  readonly provider: WritableSignal<string>;
  readonly mode: WritableSignal<AiMode>;
  readonly tier: Signal<AiTier>;
  readonly consumesCredits: Signal<boolean>;

  constructor(private readonly scope: AiScope, private readonly endpoints: Signal<AgentAiEndpoint[]>) {
    const defaults = AI_SCOPE_DEFAULTS[scope];
    // The first time an assistant is used it starts from the single choice the page kept before
    // the assistants had their own, so nobody loses what they had picked (not the schemas one).
    const legacy = (key: string) => (defaults.inherits ? read(key) : null);
    this.provider = signal(read(PROVIDER_KEY + '_' + scope) || legacy(PROVIDER_KEY) || defaults.provider);
    // Reasoning unless the person chose: it lays out the report changes it makes (columns that fit,
    // nothing on top of another), which Fast did not, as in the Delphi and .NET designers.
    this.mode = signal(((read(MODE_KEY + '_' + scope) || legacy(MODE_KEY)) as AiMode) || defaults.mode);
    this.tier = computed(() => providerToTier(this.provider()));
    this.consumesCredits = computed(() => this.tier() !== 'LocalAgent');
  }

  setProvider(value: string): void {
    this.provider.set(value);
    write(PROVIDER_KEY + '_' + this.scope, value);
  }

  setMode(value: AiMode): void {
    this.mode.set(value);
    write(MODE_KEY + '_' + this.scope, value);
  }

  /** The LocalAgent credentials of this assistant's provider, or nulls for the cloud tiers. */
  agentCredentials(): { agentSecret: string | null; agentAiId: number | null } {
    const p = this.provider();
    if (!p.startsWith('Agent_')) return { agentSecret: null, agentAiId: null };
    const id = Number(p.substring('Agent_'.length));
    const ep = this.endpoints().find((e) => e.id === id);
    return { agentSecret: ep?.agentSecret ?? null, agentAiId: Number.isFinite(id) ? id : null };
  }
}

const PROVIDER_KEY = 'rpsrv_ai_provider';
const MODE_KEY = 'rpsrv_ai_mode';
const SCOPES: AiScope[] = ['report', 'sql', 'expression', 'schemas'];

@Injectable({ providedIn: 'root' })
export class AiConfigService {
  readonly agentEndpoints = signal<AgentAiEndpoint[]>([]);
  private readonly t = inject(TranslationService);

  /** The same list for every assistant: the cloud tiers and the account's online agents. */
  readonly providers = computed<ProviderOption[]>(() => (this.t.changes(), [
    { value: 'Standard', label: 'Standard', description: this.t.t('AiProviderStandardHint') },
    { value: 'Precision', label: 'Precision', description: this.t.t('AiProviderPrecisionHint') },
    ...this.agentEndpoints()
      .filter((e) => e.isOnline)
      .map((e) => ({ value: 'Agent_' + e.id, label: e.name + ' (' + e.agentName + ')', icon: '🤖', agentSecret: e.agentSecret, description: this.t.t('AiProviderAgentHint') })),
  ]));

  readonly modes = computed<ProviderOption[]>(() => (this.t.changes(), [
    { value: 'Fast', label: this.t.t('AiModeFast') },
    { value: 'Reasoning', label: this.t.t('AiModeReasoning') },
  ]));

  private readonly selections = new Map<AiScope, AiScopeSelection>(
    SCOPES.map((s) => [s, new AiScopeSelection(s, this.agentEndpoints)]),
  );

  /** One assistant's provider and mode (always the same object for a scope). */
  selection(scope: AiScope): AiScopeSelection {
    return this.selections.get(scope)!;
  }

  setAgentEndpoints(endpoints: AgentAiEndpoint[] | undefined | null): void {
    this.agentEndpoints.set(endpoints ?? []);
    // A remembered agent that is no longer online falls back to the cloud, assistant by assistant.
    for (const sel of this.selections.values()) {
      const p = sel.provider();
      if (p.startsWith('Agent_') && !this.providers().some((o) => o.value === p)) sel.setProvider('Standard');
    }
  }
}

export function providerToTier(p: string): AiTier {
  if (p === 'Precision') return 'Precision';
  if (p.startsWith('Agent_')) return 'LocalAgent';
  return 'Standard';
}

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}
