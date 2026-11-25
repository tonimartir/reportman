import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Observable } from 'rxjs';
import { TranslationService } from '../services/translator.service';
import type { DesignerAi } from '../shell/designer-ai';

export type AiReportErrorType = 'InappropriateContent' | 'InaccurateContent';

/** Opens the report dialog for an AI text; emits true once it was sent. */
export function openAiReport(dialog: MatDialog, ai: DesignerAi, aiContent: string): Observable<boolean | undefined> {
  const data: AiReportDialogData = { aiContent, send: (type, comments, content) => ai.reportAbuse(type, comments, content) };
  return dialog.open(AiReportDialogComponent, { data, autoFocus: 'first-tabbable', maxWidth: '95vw', panelClass: 'rp-designer-dialog' }).afterClosed();
}

export interface AiReportDialogData {
  /** The AI text being reported, shown read-only and sent as it is. */
  aiContent: string;
  /** Sends the report (`POST /api/aireport` through the host). */
  send: (errorType: AiReportErrorType, comments: string, aiContent: string) => Promise<void>;
}

/**
 * "Report AI-generated content": the dialog of the Delphi designer (TFRpAIReportVCL) and of
 * Reportman.Web (EU AI Act): the issue (inappropriate or offensive by default, or inaccurate), the
 * person's details, the reported text read-only and the notice that the report is anonymous.
 * After sending it says so for a moment and closes itself.
 */
@Component({
  selector: 'rp-ai-report-dialog',
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressBarModule],
  template: `
    <h2 mat-dialog-title>{{ t.t('Ai_ReportTitle') }}</h2>
    <mat-dialog-content class="rp-report">
      <label class="rp-report-label" for="rp-report-problem">{{ t.t('Ai_ReportProblem') }}</label>
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="rp-report-field">
        <mat-select id="rp-report-problem" [(ngModel)]="errorType" [disabled]="sending() || sent()">
          <mat-option value="InappropriateContent">{{ t.t('Ai_ReportInappropriate') }}</mat-option>
          <mat-option value="InaccurateContent">{{ t.t('Ai_ReportInaccurate') }}</mat-option>
        </mat-select>
      </mat-form-field>

      <label class="rp-report-label" for="rp-report-details">{{ t.t('Ai_ReportDetails') }}</label>
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="rp-report-field">
        <textarea matInput id="rp-report-details" [(ngModel)]="comments" maxlength="2000" rows="3" [disabled]="sending() || sent()"></textarea>
        <mat-hint align="end">{{ comments.length }} / 2000</mat-hint>
      </mat-form-field>

      <label class="rp-report-label" for="rp-report-content">{{ t.t('Ai_ReportAiContent') }}</label>
      <textarea id="rp-report-content" class="rp-report-content" readonly rows="6">{{ data.aiContent }}</textarea>

      <div class="rp-report-disclaimer">{{ t.t('Ai_ReportDisclaimer') }}</div>
      @if (error()) { <div class="rp-report-error" role="alert">{{ t.t('Ai_ReportFailed') }} {{ error() }}</div> }
    </mat-dialog-content>
    @if (sending()) { <mat-progress-bar mode="indeterminate"></mat-progress-bar> }
    <mat-dialog-actions align="end">
      <button mat-button (click)="ref.close(false)" [disabled]="sending()">{{ t.t('Ai_Cancel') }}</button>
      <button mat-flat-button color="primary" (click)="send()" [disabled]="sending() || sent() || !data.aiContent.trim()">
        {{ sent() ? t.t('Ai_ReportSent') : sending() ? t.t('Ai_ReportSending') : t.t('Ai_ReportSend') }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .rp-report { display: flex; flex-direction: column; gap: 4px; width: min(560px, 86vw); box-sizing: border-box; }
    .rp-report-label { font-size: 13px; font-weight: 500; color: #555; margin-top: 4px; }
    .rp-report-field { width: 100%; }
    .rp-report-content { width: 100%; box-sizing: border-box; resize: vertical; padding: 8px 10px; border: 1px solid #d0d0d0; border-radius: 4px;
      background: #f5f5f5; color: #555; font: 12px/1.45 'Cascadia Code', Consolas, monospace; font-variant-ligatures: none; }
    .rp-report-disclaimer { margin-top: 8px; padding: 10px 12px; border: 1px solid #fbc02d; border-radius: 4px; background: #fff9c4; color: #5d4037; font-size: 12px; line-height: 1.45; }
    .rp-report-error { margin-top: 6px; padding: 8px 10px; border-radius: 4px; background: #fdecea; color: #b3261e; font-size: 12px; }
  `],
})
export class AiReportDialogComponent {
  readonly ref = inject(MatDialogRef<AiReportDialogComponent, boolean>);
  readonly data = inject(MAT_DIALOG_DATA) as AiReportDialogData;
  readonly t = inject(TranslationService);

  errorType: AiReportErrorType = 'InappropriateContent';
  comments = '';
  readonly sending = signal(false);
  readonly sent = signal(false);
  readonly error = signal('');

  async send(): Promise<void> {
    if (this.sending() || this.sent()) return;
    this.sending.set(true);
    this.error.set('');
    try {
      await this.data.send(this.errorType, this.comments.trim(), this.data.aiContent);
      this.sent.set(true);
      // A moment to read "Report sent", then away (as Delphi and Reportman.Web do).
      setTimeout(() => this.ref.close(true), 1200);
    } catch (err: any) {
      this.error.set(err?.message ?? String(err));
    } finally {
      this.sending.set(false);
    }
  }
}
