import { Component, EventEmitter, Inject, Optional, Output, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslationService } from '../services/translator.service';
import { DESIGNER_AI, DesignerAi, DesignerAiAccount, DesignerAiAccountLink } from '../shell/designer-ai';

/** Opens the Reportman AI login; emits true when the person ended up logged in. */
export function openAiLogin(dialog: MatDialog, account: DesignerAiAccount) {
  return dialog.open(AiLoginDialogComponent, { data: account, autoFocus: 'first-tabbable', maxWidth: '95vw', panelClass: 'rp-designer-dialog' }).afterClosed();
}

/** The tier badge's colours, the ones TFRpLoginFrame.UpdateUI paints (Delphi's BGR turned to CSS). */
const TIER_COLORS: Record<number, [string, string]> = {
  1: ['#e0e0e0', '#36454f'],
  2: ['#e0f2f1', '#1b5e20'],
  3: ['#e1f5fe', '#0d47a1'],
  4: ['#0277bd', '#ffffff'],
  5: ['#212121', '#ffd700'],
};

/**
 * The Reportman AI account card (the Delphi designer's TFRpLoginFrame), the same one on top of every
 * chat, in the schema selector and in the connection wizard. A guest sees the invitation to log in;
 * an account its plan, avatar and name. The whole card opens the menu: log in (with the gift), the
 * AI's language, the price plans, the cloud's schemas, the Agent download and log out. Its state is
 * the host's single one (DESIGNER_AI.account), so every card changes at once.
 */
@Component({
  selector: 'rp-ai-account',
  imports: [MatMenuModule, MatIconModule],
  template: `
    @if (account; as a) {
      <button type="button" class="rp-acc" [matMenuTriggerFor]="menu" [attr.aria-label]="t.t('Ai_AccountMenu')">
        @if (a.loggedIn()) {
          <span class="rp-acc-tier" [style.background]="tierColors()[0]" [style.color]="tierColors()[1]">{{ tierLabel() }}</span>
          @if (a.avatarUrl() && !avatarFailed()) {
            <img class="rp-acc-avatar" [src]="a.avatarUrl()" alt="" referrerpolicy="no-referrer" (error)="avatarFailed.set(true)" />
          } @else {
            <span class="material-icons rp-acc-avatar-ico" aria-hidden="true">account_circle</span>
          }
          <span class="rp-acc-name" [title]="a.email()">{{ a.displayName() }}</span>
        } @else {
          <span class="material-icons rp-acc-guest-ico" aria-hidden="true">person_outline</span>
          <span class="rp-acc-name">{{ t.t('Ai_AccountGuest') }}</span>
        }
        <span class="material-icons rp-acc-arrow" aria-hidden="true">arrow_drop_down</span>
      </button>
      <mat-menu #menu="matMenu" class="rp-designer-menu" xPosition="before">
        @if (!a.loggedIn() && !a.managedByHost) {
          <button mat-menu-item (click)="login()"><mat-icon>login</mat-icon><span>{{ t.t('Ai_AccountLoginGift', { credits: gift() }) }}</span></button>
        } @else if (a.loggedIn()) {
          <div class="rp-acc-who">{{ a.email() }}</div>
        }
        <button mat-menu-item [matMenuTriggerFor]="languages"><mat-icon>translate</mat-icon><span>{{ t.t('Ai_AccountLanguage', { language: languageLabel() }) }}</span></button>
        <button mat-menu-item (click)="open('plans')"><mat-icon>workspace_premium</mat-icon><span>{{ t.t('Ai_AccountPlans') }}</span></button>
        <button mat-menu-item (click)="open('schemas')"><mat-icon>schema</mat-icon><span>{{ t.t('Ai_AccountSchemas') }}</span></button>
        <button mat-menu-item (click)="open('agent')"><mat-icon>download</mat-icon><span>{{ t.t('Ai_AccountAgent') }}</span></button>
        @if (a.loggedIn() && !a.managedByHost) {
          <div class="rp-acc-sep"></div>
          <button mat-menu-item (click)="a.logout()"><mat-icon>logout</mat-icon><span>{{ t.t('Ai_AccountLogout') }}</span></button>
        }
      </mat-menu>
      <mat-menu #languages="matMenu" class="rp-designer-menu">
        @for (l of a.languages; track l.value) {
          <button mat-menu-item (click)="a.setLanguage(l.value)">
            @if (l.value === a.language()) { <mat-icon>check</mat-icon> } @else { <mat-icon></mat-icon> }
            <span>{{ l.label }}</span>
          </button>
        }
      </mat-menu>
    }
  `,
  styles: [`
    :host { display: block; }
    .rp-acc { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 30px; padding: 3px 4px 3px 8px; box-sizing: border-box;
      border: 1px solid var(--rpd-accent-border); border-radius: 6px; background: var(--rpd-surface); color: var(--rpd-text);
      font: inherit; font-size: var(--rpd-fs); text-align: left; cursor: pointer; }
    .rp-acc:hover, .rp-acc:focus-visible { background: var(--rpd-accent-bg); border-color: var(--rpd-accent); }
    .rp-acc-tier { flex: 0 0 auto; padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: 700; letter-spacing: 0.3px; }
    .rp-acc-avatar { flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }
    .rp-acc-avatar-ico, .rp-acc-guest-ico { flex: 0 0 auto; font-size: 20px; color: var(--rpd-text-3); }
    .rp-acc-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .rp-acc-arrow { flex: 0 0 auto; font-size: 18px; color: var(--rpd-accent); }
    .rp-acc-who { padding: 4px 12px; color: var(--rpd-text-3); font-size: var(--rpd-fs); }
    .rp-acc-sep { border-top: 1px solid var(--rpd-border-soft); margin: 3px 0; }
  `],
})
export class AiAccountComponent {
  /** Login or logout, from this card or any other (Delphi's OnAuthChanged): true when logged in. */
  @Output() changed = new EventEmitter<boolean>();

  readonly account: DesignerAiAccount | null;
  readonly avatarFailed = signal(false);
  private dialog = inject(MatDialog);

  readonly tierLabel = computed(() => {
    const name = (this.account?.tierName() ?? '').toUpperCase();
    if (!name) return 'GUEST';
    return name === 'ENTERPRISE' ? 'ENT' : name;
  });
  readonly tierColors = computed(() => TIER_COLORS[this.account?.tierId() ?? 1] ?? TIER_COLORS[1]);
  readonly gift = computed(() => (this.account?.giftCredits() ?? 0).toLocaleString());
  readonly languageLabel = computed(() => {
    const value = this.account?.language() ?? '';
    return this.account?.languages.find((l) => l.value === value)?.label ?? value;
  });

  constructor(public t: TranslationService, @Optional() @Inject(DESIGNER_AI) ai: DesignerAi | null) {
    this.account = ai?.account ?? null;
    let first = true;
    effect(() => {
      const loggedIn = this.account?.loggedIn() ?? false;
      this.account?.avatarUrl();
      untracked(() => {
        this.avatarFailed.set(false);
        if (first) first = false;
        else this.changed.emit(loggedIn);
      });
    });
  }

  login(): void {
    if (this.account) openAiLogin(this.dialog, this.account);
  }

  open(link: DesignerAiAccountLink): void {
    const url = this.account?.linkUrl(link);
    if (url) window.open(url, '_blank', 'noopener');
  }
}

/**
 * Logging into Reportman AI (the Delphi designer's TFRpLoginVCL): Google, Microsoft, or a code sent
 * by email. It closes itself once the session arrives, whichever way it came (the providers come back
 * through a popup, after this dialog asked for it).
 */
@Component({
  selector: 'rp-ai-login-dialog',
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatProgressBarModule],
  template: `
    <h2 mat-dialog-title>{{ t.t('Ai_LoginTitle') }}</h2>
    <mat-dialog-content class="rp-login">
      <p class="rp-login-gift">{{ t.t('Ai_LoginGift', { credits: gift() }) }}</p>
      <div class="rp-login-providers">
        <button mat-stroked-button type="button" (click)="account.loginWithProvider('google')" [disabled]="account.busy()">
          <svg class="rp-provider-logo" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>{{ t.t('Ai_LoginGoogle') }}</button>
        <button mat-stroked-button type="button" (click)="account.loginWithProvider('microsoft')" [disabled]="account.busy()">
          <svg class="rp-provider-logo" viewBox="0 0 23 23" aria-hidden="true">
            <path fill="#F25022" d="M1 1h10v10H1z"/><path fill="#7FBA00" d="M12 1h10v10H12z"/>
            <path fill="#00A4EF" d="M1 12h10v10H1z"/><path fill="#FFB900" d="M12 12h10v10H12z"/>
          </svg>{{ t.t('Ai_LoginMicrosoft') }}</button>
        <button mat-stroked-button type="button" (click)="account.loginWithProvider('apple')" [disabled]="account.busy()">
          <svg class="rp-provider-logo" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M18.71,19.5C17.88,20.74 17,21.95 15.66,21.97C14.32,22 13.89,21.18 12.37,21.18C10.84,21.18 10.37,21.95 9.1,22C7.79,22.05 6.8,20.68 5.96,19.47C4.25,17 2.94,12.45 4.7,9.39C5.57,7.87 7.13,6.91 8.82,6.88C10.1,6.86 11.32,7.75 12.11,7.75C12.89,7.75 14.37,6.68 15.92,6.84C16.57,6.87 18.39,7.1 19.56,8.82C19.47,8.88 17.39,10.1 17.41,12.63C17.44,15.65 20.06,16.66 20.09,16.67C20.06,16.74 19.67,18.11 18.71,19.5M13,3.5C13.73,2.67 14.94,2.04 15.94,2C16.07,3.17 15.6,4.35 14.9,5.19C14.21,6.04 13.07,6.7 11.95,6.61C11.8,5.46 12.36,4.26 13,3.5Z"/>
          </svg>{{ t.t('Ai_LoginApple') }}</button>
      </div>
      <div class="rp-login-or">{{ t.t('Ai_LoginOrEmail') }}</div>
      <form class="rp-login-email" (ngSubmit)="codeSent() ? enter() : sendCode()">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>{{ t.t('Ai_LoginEmail') }}</mat-label>
          <input matInput type="email" name="email" autocomplete="email" [(ngModel)]="email" [disabled]="account.busy()" required />
        </mat-form-field>
        @if (codeSent()) {
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>{{ t.t('Ai_LoginCode') }}</mat-label>
            <input matInput name="code" autocomplete="one-time-code" inputmode="numeric" [(ngModel)]="code" [disabled]="account.busy()" required />
          </mat-form-field>
        }
        <div class="rp-login-row">
          @if (codeSent()) {
            <button mat-button type="button" (click)="sendCode()" [disabled]="account.busy() || !validEmail()">{{ t.t('Ai_LoginResend') }}</button>
            <button mat-flat-button color="primary" type="submit" [disabled]="account.busy() || !code.trim()">{{ t.t('Ai_LoginEnter') }}</button>
          } @else {
            <button mat-flat-button color="primary" type="submit" [disabled]="account.busy() || !validEmail()">{{ t.t('Ai_LoginSendCode') }}</button>
          }
        </div>
      </form>
      @if (status()) { <div class="rp-login-status" role="status">{{ status() }}</div> }
      @if (account.error()) { <div class="rp-login-error" role="alert">{{ account.error() }}</div> }
    </mat-dialog-content>
    @if (account.busy()) { <mat-progress-bar mode="indeterminate"></mat-progress-bar> }
    <mat-dialog-actions align="end">
      <button mat-button (click)="ref.close(false)">{{ t.t('Ai_Cancel') }}</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .rp-login { display: flex; flex-direction: column; gap: 10px; width: min(400px, 86vw); box-sizing: border-box; }
    .rp-login-gift { margin: 0; color: #555; font-size: 13px; line-height: 1.45; }
    .rp-login-providers { display: flex; flex-direction: column; gap: 6px; }
    // The logo of each provider, as in the desktop designers' login
    .rp-provider-logo { width: 18px; height: 18px; margin-right: 8px; vertical-align: middle; }
    .rp-login-or { color: #777; font-size: 12px; text-align: center; }
    .rp-login-email { display: flex; flex-direction: column; gap: 8px; }
    .rp-login-row { display: flex; justify-content: flex-end; gap: 6px; }
    .rp-login-status { color: #2e7d32; font-size: 12px; }
    .rp-login-error { padding: 8px 10px; border-radius: 4px; background: #fdecea; color: #b3261e; font-size: 12px; }
  `],
})
export class AiLoginDialogComponent {
  readonly ref = inject(MatDialogRef<AiLoginDialogComponent, boolean>);
  readonly account = inject(MAT_DIALOG_DATA) as DesignerAiAccount;
  readonly t = inject(TranslationService);

  email = this.account.email();
  code = '';
  readonly codeSent = signal(false);
  readonly status = signal('');
  readonly gift = computed(() => this.account.giftCredits().toLocaleString());

  constructor() {
    // Whichever way the session arrives (the code, or a provider's popup), the dialog is done.
    effect(() => {
      if (this.account.loggedIn()) untracked(() => this.ref.close(true));
    });
  }

  validEmail(): boolean {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this.email.trim());
  }

  async sendCode(): Promise<void> {
    if (!this.validEmail()) return;
    this.status.set('');
    if (await this.account.sendCode(this.email.trim())) {
      this.codeSent.set(true);
      this.status.set(this.t.t('Ai_LoginCodeSent'));
    }
  }

  async enter(): Promise<void> {
    if (!this.code.trim()) return;
    this.status.set('');
    await this.account.loginWithCode(this.email.trim(), this.code.trim());
  }
}
