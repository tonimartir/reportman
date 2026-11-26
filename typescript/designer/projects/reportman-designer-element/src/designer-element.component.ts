import { Component, ElementRef, Injector, OnInit, ViewChild, ViewEncapsulation, booleanAttribute, computed, effect, inject, input, output, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AiAccountService, CopilotPanelComponent, DesignerLabels, PdfViewerDialogComponent, ReportEditorComponent, TranslationService } from '@reportman/ngx-designer';
import { ReportResult } from '@reportman/lib';
import { elementConfig } from './element-config';
import { ShadowRootOverlayContainer } from './shadow-overlay-container';

/** The editor's chrome texts, by the keys reportman-lib has them under. */
const LABEL_KEYS: Record<keyof DesignerLabels, string> = {
  reportOptions: 'DesignerReportOptions', undo: 'DesignerUndo', redo: 'DesignerRedo', delete: 'Delete',
  cut: 'DesignerCut', copy: 'Copy', paste: 'DesignerPaste', structure: 'DesignerStructure',
  properties: 'DesignerProperties', copilot: 'Copilot', history: 'DesignerHistory', closePanel: 'DesignerClosePanel',
  modified: 'DesignerModified', selectedObjects: 'DesignerSelectedObjects', aiWorking: 'DesignerAiWorking', aiStop: 'CopilotStop',
};

/**
 * <reportman-designer>: Report Manager's web designer for any page, whatever its framework. It
 * brings its own Angular, Material and the designer, inside a shadow root: the page's styles do
 * not reach it and its styles do not reach the page.
 *
 *   <reportman-designer server="https://reports.example.com" report="INFORMES/sales.rep" lang="en"></reportman-designer>
 *
 * Attributes: server (the origin of Reportman.Designer.Server; this page's by default), api-base
 * (where its routes hang, /api by default; a host per company: /api/empresas/12/disenador), report
 * (ALIAS/path.rep), lang (es, en, ca, fr, de, it, pt, zh; any other is English), readonly (no
 * save), closable (a close button), no-ai (no copilot), ai-account (login: the person logs into
 * Reportman AI from the chat, the default; host: the host's server puts the person's account),
 * ai-install-id (asked to Reportman.Server when missing and the account is not the host's),
 * ai-callback (the path of this origin where the AI's login comes back; ai-callback.html next to
 * this script by default), design-prompt (a new report's request: the copilot designs it as soon as
 * the report opens, as the new report wizard of Reportman.Server does) and design-subschema (the
 * subschema of the local schema file of the report's connection the copilot designs it with).
 * Property getToken: a function giving the page's session as a Bearer token.
 * Events: saved ({ reportName }), executed (the preview, also shown here), closed, sessionlost.
 */
@Component({
  selector: 'rp-designer-element',
  encapsulation: ViewEncapsulation.ShadowDom,
  imports: [MatTooltipModule, ReportEditorComponent, CopilotPanelComponent],
  template: `
    @if (ready()) {
      <report-editor #editor [reportName]="report()" [copilot]="aiOn()" [labels]="labels()" (executed)="onExecuted($event)">
        <div rpdBarStart class="rpd-bar-group">
          @if (closable()) {
            <button type="button" class="rpd-tool" (click)="closed.emit()" [attr.aria-label]="t.t('Close')" [matTooltip]="t.t('Close')" [matTooltipShowDelay]="400">
              <span class="material-icons" aria-hidden="true">close</span>
            </button>
          }
          <span class="rpd-title" [title]="report()"><small>{{ alias() }} /</small> {{ file() }}</span>
        </div>
        <div rpdBarEnd class="rpd-bar-group">
          <button type="button" class="rpd-tool rpd-tool-text" (click)="preview(false)" [matTooltip]="t.t('PreviewPdf')" [matTooltipShowDelay]="400">
            <span class="material-icons" aria-hidden="true">play_arrow</span> {{ t.t('Preview') }}
          </button>
          <button type="button" class="rpd-tool" (click)="preview(true)" [attr.aria-label]="t.t('PreviewSubreport')" [matTooltip]="t.t('PreviewSubreport')" [matTooltipShowDelay]="400">
            <span class="material-icons" aria-hidden="true">filter_1</span>
          </button>
          @if (!readonly()) {
            <button type="button" class="rpd-tool rpd-tool-primary" (click)="save()">
              <span class="material-icons" aria-hidden="true">save</span> {{ t.t('Save') }}
            </button>
          }
        </div>
        @if (readonly()) {
          <span rpdStatus class="rpd-status-item" [matTooltip]="t.t('RunOnly')">
            <span class="material-icons" aria-hidden="true">visibility</span> {{ t.t('ReadOnly') }}
          </span>
        }
        @if (aiOn()) {
          <rp-copilot-panel rpdCopilot [editor]="editor"></rp-copilot-panel>
        }
      </report-editor>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; position: relative; height: 100%; min-height: 480px; }
    report-editor { flex: 1 1 auto; min-height: 0; }
    .rpd-title small { opacity: .7; }
  `],
})
export class DesignerElementComponent implements OnInit {
  readonly server = input('');
  readonly apiBase = input('/api');
  readonly aiAccount = input<'login' | 'host'>('login');
  readonly report = input('');
  readonly lang = input('es');
  readonly readonly = input(false, { transform: booleanAttribute });
  readonly closable = input(false, { transform: booleanAttribute });
  readonly noAi = input(false, { transform: booleanAttribute });
  readonly aiInstallId = input('');
  readonly aiCallback = input('');
  readonly designPrompt = input('');
  readonly designSubschema = input('');
  readonly getToken =input<(() => string | null | undefined | Promise<string | null | undefined>) | null>(null);

  readonly saved = output<{ reportName: string }>();
  readonly executed = output<ReportResult>();
  readonly closed = output<void>();
  readonly sessionlost = output<void>();

  readonly t = inject(TranslationService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private dialog = inject(MatDialog);
  // Not injected here: the designer's services read the element's configuration once, when the first
  // of them starts, and the account would start before the attributes are read (ngOnInit).
  private injector = inject(Injector);
  @ViewChild('editor') editor?: ReportEditorComponent;
  @ViewChild(CopilotPanelComponent) copilot?: CopilotPanelComponent;

  /** Shown once the stylesheet is in and the configuration is known. */
  readonly ready = signal(false);
  readonly aiOn = computed(() => !this.noAi());
  readonly alias = computed(() => this.report().split('/')[0] ?? '');
  readonly file = computed(() => this.report().split('/').slice(1).join('/'));
  private readonly langVersion = signal(0);
  readonly labels = computed<Partial<DesignerLabels>>(() => {
    this.langVersion();
    const labels: Partial<DesignerLabels> = {};
    for (const [label, key] of Object.entries(LABEL_KEYS)) (labels as any)[label] = this.t.t(key);
    return labels;
  });

  constructor() {
    effect(() => {
      const lang = this.lang();
      void this.t.setLang(lang).then(() => this.langVersion.update((n) => n + 1));
    });
    // `modified`, read-only on the element: the design has changes not saved yet. The page asks it
    // before closing the designer (Angular elements only map inputs, so it goes on the node itself).
    Object.defineProperty(this.host.nativeElement, 'modified', {
      configurable: true,
      get: () => this.editor?.report?.modified === true,
    });
  }

  async ngOnInit(): Promise<void> {
    const root = this.host.nativeElement.shadowRoot;
    if (root) ShadowRootOverlayContainer.root = root;
    // Its texts first: what the editor works out when it starts is said in the page's language.
    await this.t.setLang(this.lang());
    // What the designer's services will read when they start (they start with the editor, below).
    elementConfig.server = this.server();
    elementConfig.apiBase = this.apiBase() || '/api';
    elementConfig.aiAccount = this.aiAccount() === 'host' ? 'host' : 'login';
    elementConfig.ai = !this.noAi();
    elementConfig.getToken = this.getToken();
    elementConfig.sessionLost = () => this.sessionlost.emit();
    elementConfig.aiCallbackPath = this.aiCallback() || callbackPathNextToScript() || '/ai/callback';
    // The installation only matters to log into the AI from the chat, which the host's account skips
    // (and a designer without AI has no chat to log in from).
    elementConfig.aiInstallId = this.aiInstallId()
      || (elementConfig.aiAccount === 'host' || !elementConfig.ai ? '' : await askInstallId(elementConfig.api('/session/config')));
    loadFonts();
    if (root) await addStylesheet(root, elementConfig.asset('reportman-designer.css'));
    this.ready.set(!!this.report());
    // The AI account (or this installation's guest credits) for the copilot's card and gauge.
    if (elementConfig.ai) void this.injector.get(AiAccountService).checkStatus();
    const prompt = this.designPrompt().trim();
    if (elementConfig.ai && prompt.length > 0 && this.ready()) void this.startDesign(prompt, this.designSubschema().trim());
  }

  /**
   * A new report's request (design-prompt): the copilot's tab shows, takes the subschema chosen for it
   * and designs with that text, once the report and the chat are there.
   */
  private async startDesign(prompt: string, subschema: string): Promise<void> {
    for (let i = 0; i < 100 && (!this.copilot || !this.editor); i++) await new Promise((r) => setTimeout(r, 100));
    if (!this.copilot || !this.editor) return;
    this.editor.showCopilot();
    await this.copilot.startDesignPrompt(prompt, 0, 0, subschema);
  }

  async save(): Promise<void> {
    if (await this.editor?.save()) this.saved.emit({ reportName: this.report() });
  }

  async preview(subreportOnly: boolean): Promise<void> {
    if (!this.editor) return;
    let indexes: number[] | undefined;
    if (subreportOnly) {
      const subreport = this.editor.reportDesign?.subreportEditor?.subReport;
      const idx = subreport ? this.editor.report?.subReports.indexOf(subreport) : -1;
      if (idx != null && idx >= 0) indexes = [idx];
    }
    await this.editor.preview(indexes);
  }

  onExecuted(result: ReportResult): void {
    this.executed.emit(result);
    const name = (this.file().split('/').pop() ?? 'report').replace(/\.rep$/i, '');
    PdfViewerDialogComponent.open(this.dialog, result, name + '.pdf');
  }
}

/** ai-callback.html next to this script, when it is on this page's origin. */
function callbackPathNextToScript(): string {
  const url = new URL(elementConfig.asset('ai-callback.html'));
  return url.origin === window.location.origin ? url.pathname : '';
}

/** Reportman.Server says its installation in /api/session/config; another server may not have it. */
async function askInstallId(configUrl: string): Promise<string> {
  try {
    const reply = await fetch(configUrl, { credentials: 'same-origin' });
    return reply.ok ? ((await reply.json())?.aiInstallId ?? '') : '';
  } catch {
    return '';
  }
}

/** The text of the designer's stylesheet, read once for every element of the page (null: it cannot be read). */
let stylesheetText: Promise<string | null> | undefined;

/**
 * The designer's stylesheet inside the shadow root (the page's own never reach in), first, before the
 * styles of the components. Its text is read once and goes in as a <style>: a <link> in the shadow root
 * of a new element (a page that closes the designer and opens another) may never fire its load in
 * Chrome while the element before it is being destroyed, and the designer would wait for it forever.
 * Where the text cannot be read (an element from another origin without CORS), a <link>, waited for
 * three seconds at most.
 */
async function addStylesheet(root: ShadowRoot, href: string): Promise<void> {
  stylesheetText ??= fetch(href)
    .then((reply) => (reply.ok ? reply.text() : null))
    .catch(() => null);
  const text = await stylesheetText;
  if (text !== null) {
    const style = document.createElement('style');
    style.textContent = text;
    root.prepend(style);
    return;
  }
  await new Promise<void>((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    setTimeout(resolve, 3000);
    root.prepend(link);
  });
}

/**
 * Fonts are the document's, never a shadow root's: Roboto and Material Icons, once, from the
 * element's own files (assets/fonts): no request to another site, and they work offline.
 */
function loadFonts(): void {
  const fonts = [elementConfig.asset('assets/fonts/fonts.css')];
  for (const href of fonts) {
    if (document.head.querySelector(`link[href="${href}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
}
