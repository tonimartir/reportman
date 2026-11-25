import { Component, OnDestroy, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ReportResult } from '@reportman/lib';
import { TranslationService } from '../services/translator.service';

/**
 * The preview: the PDF the server produced (the editor's `executed` output), shown by the browser's
 * own viewer, with its page count and a download. Open it with PdfViewerDialogComponent.open().
 */
@Component({
  selector: 'rp-pdf-viewer-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="pdf-head">
      <span>{{ t.t('PdfPages', { count: result.pageCount }) }} · {{ result.pageSizeName || (result.pageWidth + ' × ' + result.pageHeight) }}</span>
      <span class="pdf-spacer"></span>
      <a mat-stroked-button [href]="downloadUrl" [download]="fileName"><mat-icon>download</mat-icon> {{ t.t('PdfDownload') }}</a>
      <button mat-icon-button mat-dialog-close [attr.aria-label]="t.t('Close')"><mat-icon>close</mat-icon></button>
    </div>
    <iframe class="pdf-frame" [src]="url" title="PDF"></iframe>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; }
    .pdf-head { display: flex; align-items: center; gap: 8px; padding: 4px 8px 4px 16px; border-bottom: 1px solid var(--rpd-border, #e0e0e0); font-size: 13px; color: var(--rpd-text-2, #555); }
    .pdf-spacer { flex: 1 1 auto; }
    .pdf-frame { flex: 1 1 auto; border: 0; width: 100%; min-height: 0; }
  `],
})
export class PdfViewerDialogComponent implements OnDestroy {
  readonly data = inject(MAT_DIALOG_DATA) as ReportResult | { result: ReportResult; fileName?: string };
  readonly result: ReportResult = 'result' in this.data ? this.data.result : this.data;
  readonly fileName = ('fileName' in this.data && this.data.fileName) || 'informe.pdf';
  readonly t = inject(TranslationService);
  private sanitizer = inject(DomSanitizer);
  readonly downloadUrl: string;
  readonly url: SafeResourceUrl;

  /** The preview of an execution, in a large dialog. */
  static open(dialog: MatDialog, result: ReportResult, fileName?: string) {
    return dialog.open(PdfViewerDialogComponent, {
      data: { result, fileName },
      width: '90vw',
      height: '92vh',
      maxWidth: '95vw',
      panelClass: 'rp-pdf-dialog',
    });
  }

  constructor() {
    const bytes = atob(this.result.base64Pdf);
    const array = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
    this.downloadUrl = URL.createObjectURL(new Blob([array], { type: 'application/pdf' }));
    this.url = this.sanitizer.bypassSecurityTrustResourceUrl(this.downloadUrl + '#zoom=page-width');
  }

  ngOnDestroy(): void {
    URL.revokeObjectURL(this.downloadUrl);
  }
}
