import { Injectable, computed, inject, signal } from '@angular/core';
import type { DesignerAiAccount, DesignerAiAccountLink, DesignerAiOption } from '../shell/designer-ai';
import { TranslationService } from '../services/translator.service';
import { DESIGNER_HOST, designerHostHeaders, resolveDesignerHost } from './designer-host';

/** The profile part of the cloud's /api/userprofile/status answer (a guest has no email). */
export interface AiProfile {
  email: string;
  userName?: string;
  tierId?: number;
  tierName?: string;
  profileImageUrl?: string;
  freeInitial?: number;
  freeRemaining?: number;
  dailyMax?: number;
  dailyConsumed?: number;
}

const TOKEN_KEY = 'rpsrv_ai_token';
const EMAIL_KEY = 'rpsrv_ai_email';
const LANGUAGE_KEY = 'rpsrv_ai_language';
const DEFAULT_GIFT = 2000;

/** The languages the AI answers in, by the cloud's names (Delphi's GetSupportedAILanguages), with the site's folder. */
const AI_LANGUAGES: { value: string; label: string; code: string }[] = [
  { value: 'English', label: 'English', code: 'en' },
  { value: 'Spanish', label: 'Español', code: 'es' },
  { value: 'Italian', label: 'Italiano', code: 'it' },
  { value: 'French', label: 'Français', code: 'fr' },
  { value: 'German', label: 'Deutsch', code: 'de' },
  { value: 'Portuguese', label: 'Português', code: 'pt' },
  { value: 'Chinese', label: '中文', code: 'zh' },
  { value: 'Catalan', label: 'Català', code: 'ca' },
];

/**
 * The Reportman AI account, ONLY for the AI — the server has its own users. The same idea as the
 * Delphi designer's TRpAuthManager behind TFRpLoginFrame: one state for the whole page, logged into
 * from the AI's chat. Without a session the AI uses the installation's guest credits (100 per
 * installation); logging in gives each account its own gift (2,000 that never expire, the Free tier).
 *
 * The login goes through the designer's server (/api/ai-login, the cloud's own routes), like every AI
 * call: the page never talks to the cloud. It is bound to the server's installation id (the host's
 * aiInstallId), not to the browser: an installation is a server. Google and Microsoft open in a popup that hands the session back, so an
 * open report is never left.
 */
@Injectable({ providedIn: 'root' })
export class AiAccountService implements DesignerAiAccount {
  private host = resolveDesignerHost(inject(DESIGNER_HOST, { optional: true }));
  private t = inject(TranslationService);

  readonly profile = signal<AiProfile | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  /** The gift of logging in: the Free tier's free credits as the cloud reports them. */
  readonly giftCredits = signal(DEFAULT_GIFT);
  /** Bumped on every login and logout, for whoever must react (the chats, the wizard's database lists). */
  readonly changes = signal(0);

  /**
   * The host's server puts the person's account on every AI call (DesignerHost.aiAccount `host`):
   * the page holds no AI session, and there is no logging in or out from the chat.
   */
  readonly managedByHost = this.host.aiAccount === 'host';

  /** Logged into Reportman AI (otherwise: the installation's guest credits). */
  readonly loggedIn = computed(() => !!this.profile()?.email && (this.managedByHost || !!this.tokenSignal()));
  readonly displayName = computed(() => {
    const p = this.profile();
    return p?.email ? p.userName || p.email : '';
  });
  readonly email = computed(() => this.profile()?.email ?? '');
  readonly tierId = computed(() => this.profile()?.tierId ?? 1);
  readonly tierName = computed(() => this.profile()?.tierName ?? '');
  readonly avatarUrl = computed(() => this.profile()?.profileImageUrl ?? '');
  /** The plans of the product, as the status answers them (Tier: maxTables, maxColumnsPerTable…). */
  readonly tiers = signal<any[]>([]);
  /**
   * What the account's plan lets the cloud AI read of a schema (0 = no limit): the copilot marks with ⚠ a
   * schema that goes over it, which the cloud would refuse (the AI on an Agent has no limit). Null until known.
   */
  readonly planLimits = computed<{ maxTables: number; maxColumns: number } | null>(() => {
    const tier = this.tiers().find((t) => Number(t?.id ?? t?.Id) === this.tierId());
    return tier ? { maxTables: Number(tier.maxTables ?? tier.MaxTables ?? 0), maxColumns: Number(tier.maxColumnsPerTable ?? tier.MaxColumnsPerTable ?? 0) } : null;
  });

  /**
   * The language the AI answers in, chosen in the account menu and remembered in this browser
   * (Delphi keeps it in its AILanguage preference); at first the browser's.
   */
  readonly languages: readonly DesignerAiOption[] = AI_LANGUAGES.map((l) => ({ value: l.value, label: l.label }));
  /** The ISO code of the AI language (es, en…): what the cloud's schema analysis is written in. */
  readonly languageCode = computed(() => AI_LANGUAGES.find((l) => l.value === this.language())?.code ?? 'en');
  readonly language = signal<string>(read(LANGUAGE_KEY) ?? defaultLanguage());

  setLanguage(value: string): void {
    if (!AI_LANGUAGES.some((l) => l.value === value)) return;
    this.language.set(value);
    write(LANGUAGE_KEY, value);
  }

  /** The pages the account menu opens (TFRpLoginFrame's menu), the Agent's in the AI's language. */
  linkUrl(link: DesignerAiAccountLink): string {
    if (link === 'plans') return 'https://app.reportman.es/subscription';
    if (link === 'schemas') return 'https://app.reportman.es/database-config';
    const code = AI_LANGUAGES.find((l) => l.value === this.language())?.code ?? 'en';
    // English has no language folder on the site.
    return code === 'en' ? 'https://ai.reportman.es/download' : `https://ai.reportman.es/${code}/download`;
  }

  // --- credits (the gauge), as Delphi's TRpAuthManager and Reportman.Web ---
  readonly usesFreeCredits = computed(() => {
    const p = this.profile();
    return !p || (p.tierId ?? 0) <= 2;
  });
  readonly freeCreditsConsumed = computed(() => (this.profile()?.freeInitial ?? 0) - (this.profile()?.freeRemaining ?? 0));
  readonly dailyCreditsConsumed = computed(() => this.profile()?.dailyConsumed ?? 0);
  readonly dailyCreditsMax = computed(() => this.profile()?.dailyMax ?? 0);
  /**
   * THE CREDIT BAG: a paid tier whose day is spent spends its bag (the
   * piggy bank, freeRemaining: bought credits that never expire). The gauge then shows the bag, in violet.
   */
  readonly usingBag = computed(() => {
    const p = this.profile();
    return !!p && (p.tierId ?? 0) > 2 && (p.dailyMax ?? 0) - (p.dailyConsumed ?? 0) <= 0 && (p.freeRemaining ?? 0) > 0;
  });
  readonly creditsRatio = computed(() => {
    const p = this.profile();
    if (!p) return 0;
    if (this.usesFreeCredits() || this.usingBag()) return (p.freeInitial ?? 0) > 0 ? this.freeCreditsConsumed() / (p.freeInitial ?? 1) : 0;
    return this.dailyCreditsMax() > 0 ? this.dailyCreditsConsumed() / this.dailyCreditsMax() : 0;
  });

  private readonly tokenSignal = signal<string | null>(read(TOKEN_KEY));
  private statusPromise: Promise<void> | null = null;

  constructor() {
    window.addEventListener('message', (event) => this.onPopupMessage(event));
  }

  /** The AI session to send with the AI calls (the server's bridge turns it into the Bearer). */
  get token(): string | null {
    return this.tokenSignal();
  }

  /** Refreshes the profile (guest or account) from the cloud; a session the cloud no longer accepts is dropped. */
  checkStatus(): Promise<void> {
    if (!this.statusPromise) this.statusPromise = this.doCheckStatus().finally(() => (this.statusPromise = null));
    return this.statusPromise;
  }

  /** Every AI answer carries the profile with the credits it just consumed. */
  updateCredits(updated: Partial<AiProfile> | null | undefined): void {
    if (!updated) return;
    // That profile is the caller's; with the host's account somebody else may pay. The host's server
    // knows whose credits to show: ask it again.
    if (this.managedByHost) {
      void this.checkStatus();
      return;
    }
    const current = this.profile() ?? ({ email: '' } as AiProfile);
    this.profile.set({
      ...current,
      freeRemaining: updated.freeRemaining ?? current.freeRemaining,
      freeInitial: updated.freeInitial ?? current.freeInitial,
      dailyConsumed: updated.dailyConsumed ?? current.dailyConsumed,
      dailyMax: updated.dailyMax ?? current.dailyMax,
      tierId: updated.tierId ?? current.tierId,
      tierName: updated.tierName ?? current.tierName,
    });
  }

  // --- login ---

  async sendCode(email: string): Promise<boolean> {
    return this.run(async () => {
      await this.cloud('api/LoginResend/send', { email });
      return true;
    });
  }

  async loginWithCode(email: string, code: string): Promise<boolean> {
    return this.run(async () => {
      const reply = await this.cloud('api/login/email', { email, emailCode: code, installId: this.host.aiInstallId() });
      this.storeSession(email, reply?.token ?? reply?.Token);
      await this.doCheckStatus();
      return this.loggedIn();
    });
  }

  /** Google, Microsoft or Apple in a popup: the cloud comes back to /ai/callback, which hands the session here. */
  loginWithProvider(provider: 'google' | 'microsoft' | 'apple'): void {
    this.error.set('');
    const returnUrl = window.location.origin + this.host.aiCallbackPath;
    const url = `${this.loginUrl()}/api/login/${provider}/web?returnUrl=${encodeURIComponent(returnUrl)}&installId=${encodeURIComponent(this.host.aiInstallId())}`;
    const popup = window.open(url, 'rpsrv_ai_login', 'width=520,height=680');
    if (!popup) this.error.set(this.t.t('AiLoginPopupBlocked'));
  }

  /** Leaves the AI account: the AI goes back to the installation's guest credits. */
  async logout(): Promise<void> {
    if (this.managedByHost) return;   // the host's account: left in the host
    this.dropSession();
    await this.checkStatus();
  }

  /** The cloud refused the session (expired, revoked): drop it, keep the page. */
  async sessionRejected(): Promise<void> {
    if (this.managedByHost) {
      // The host's account for this person was refused: nothing to drop here; show what the host says.
      console.warn('[AI] The cloud refused the account the host gave for this person');
      await this.checkStatus();
      return;
    }
    if (!this.token) return;
    console.warn('[AI] The cloud no longer accepts the AI session; back to the guest credits');
    await this.logout();
  }

  // --- plumbing ---

  private onPopupMessage(event: MessageEvent): void {
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (data?.type !== 'rpsrv-ai-login') return;
    if (data.error) {
      this.error.set(this.t.t('AiLoginProviderFailed', { error: data.error }));
      return;
    }
    if (data.token && data.email) {
      this.storeSession(data.email, data.token);
      void this.checkStatus();
    }
  }

  private storeSession(email: string, token: string | undefined): void {
    if (!token) throw new Error('The login did not return a session');
    write(TOKEN_KEY, token);
    write(EMAIL_KEY, email);
    this.tokenSignal.set(token);
    this.changes.update((n) => n + 1);
  }

  private dropSession(): void {
    remove(TOKEN_KEY);
    remove(EMAIL_KEY);
    this.tokenSignal.set(null);
    this.profile.set(null);
    this.changes.update((n) => n + 1);
  }

  private async doCheckStatus(): Promise<void> {
    try {
      const reply = await this.statusThroughServer();
      const profile = (reply?.profile ?? reply?.Profile) as AiProfile | undefined;
      this.profile.set(profile ?? null);
      const tiers = reply?.tiers ?? reply?.Tiers ?? [];
      this.tiers.set(tiers);
      const free = tiers.find((t: any) => t?.id === 2 || String(t?.name).toLowerCase() === 'free');
      if (free?.maxFreeCredits > 0) this.giftCredits.set(free.maxFreeCredits);
    } catch (err: any) {
      // The cloud refused the AI session (expired, revoked): back to the guest, asked right away
      // (not through checkStatus, which is this very call). This server's own session ending
      // (LoginRequired) is not the AI's business.
      if (err?.status === 401 && err?.code !== 'LoginRequired' && this.token) {
        this.dropSession();
        return this.doCheckStatus();
      }
      // The cloud did not answer (no Internet, a proxy): the designer works on; the AI and its
      // gauge wait until it does.
      console.warn('[AI] Could not reach Reportman AI:', err?.message ?? err);
    }
  }

  /**
   * The profile and credits, through the server's bridge like every AI call (the bridge puts the
   * server's installation and, with the AI session in its header, the Bearer).
   */
  private async statusThroughServer(): Promise<any> {
    const headers: Record<string, string> = { ...(await designerHostHeaders(this.host)), 'Content-Type': 'application/json', 'Accept-Language': this.pageLanguage() };
    if (this.token) headers['X-Reportman-AI-Token'] = this.token;
    const response = await fetch(this.host.aiBridgeUrl + 'api/userprofile/status', { method: 'POST', headers, body: '{}' });
    const text = await response.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* plain text */ }
    if (!response.ok) {
      throw Object.assign(new Error(json?.error ?? json?.message ?? (text || 'HTTP ' + response.status)), { status: response.status, code: json?.code });
    }
    return json;
  }

  /** One login call to the cloud, through the server's relay, as this installation. */
  private async cloud(path: string, body: unknown): Promise<any> {
    const headers: Record<string, string> = {
      ...(await designerHostHeaders(this.host)),
      'Content-Type': 'application/json',
      'Accept-Language': this.pageLanguage(),
      'X-Reportman-WebInstallId': this.host.aiInstallId(),
    };
    let response: Response;
    try {
      response = await fetch(`${this.loginUrl()}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (err: any) {
      throw Object.assign(new Error(this.t.t('CloudConnectionFailed', { url: this.loginUrl() })), { status: 0 });
    }
    const text = await response.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* plain text */ }
    if (!response.ok) {
      const message = json?.message ?? json?.error ?? (typeof json === 'string' ? json : text) ?? 'HTTP ' + response.status;
      throw Object.assign(new Error(message || 'HTTP ' + response.status), { status: response.status });
    }
    return json;
  }

  private async run(action: () => Promise<boolean>): Promise<boolean> {
    this.busy.set(true);
    this.error.set('');
    try {
      return await action();
    } catch (err: any) {
      this.error.set(err?.message ?? String(err));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private pageLanguage(): string {
    return this.t.lang();
  }

  private loginUrl(): string {
    return this.host.aiLoginUrl.replace(/\/+$/, '');
  }
}

/** The browser's language when it is one the AI speaks (Delphi takes the system's); English otherwise. */
function defaultLanguage(): string {
  const code = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return AI_LANGUAGES.find((l) => l.code === code)?.value ?? 'English';
}

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

function remove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* private mode */ }
}
