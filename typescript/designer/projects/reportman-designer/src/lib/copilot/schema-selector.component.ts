import { Component, OnDestroy, OnInit, ViewChild, inject, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelect, MatSelectModule } from '@angular/material/select';
import { TranslationService } from '../services/translator.service';
import { WideSelectPanelDirective } from '../shell/widgets/wide-select-panel.directive';
import { SchemaChoice, SchemaChosen } from './schema-choice';

/**
 * The part of the database an AI assistant reads, as the copilot shows it (F5: local and cloud in one list, each with
 * its tables, ⚠ when it goes over the plan; F8: each with its icon, and a connection's file with its subschemas only,
 * never its dictionary): «New local schema…» and «New cloud schema…» at its end, and the gear with the schema screens.
 * Back from the local schema screen (another tab), the file is read again. The copilot and the dataset's SQL editor
 * show it, each with its own SchemaChoice.
 */
@Component({
  selector: 'rp-schema-selector',
  imports: [MatIconModule, MatTooltipModule, MatMenuModule, MatSelectModule, WideSelectPanelDirective],
  template: `
    @let c = choice();
    @if (c.localOptions().length || c.cloudOptions().length || c.info()?.source === 'file') {
      <div class="rpd-select-chip" [matTooltip]="chipTooltip()" [matTooltipShowDelay]="400">
        <span class="material-icons" aria-hidden="true">schema</span>
        <mat-select #schemaSelect rpWideSelectPanel class="rpd-select" panelClass="rpd-select-panel" hideSingleSelectionIndicator
          [value]="c.selectedKey()" (valueChange)="choose($event)" (openedChange)="listOpened($event)"
          [placeholder]="t.t('CopilotSubschema')" [aria-label]="t.t('CopilotSubschema')">
          <!-- Its icon, the ⚠ of the plan, the red dot of an Agent that is not connected, the name and its tables, and
               DEMO after one of the cloud's examples. -->
          <mat-select-trigger>
            @if (c.selectedOption(); as o) {
              <mat-icon class="rpd-opt-ico" aria-hidden="true">{{ o.icon }}</mat-icon>{{ o.warn ? '⚠ ' : '' }}@if (o.offline) {<span class="rpd-offline-dot" role="img" [attr.aria-label]="t.t('Ai_AgentOffline')"></span>}{{ o.label }}@if (o.example) {<span class="rp-demo-badge">DEMO</span>}
            }
          </mat-select-trigger>
          @if (c.localOptions().length) {
            <mat-optgroup [label]="t.t('CopilotSchemasLocal')">
              @for (o of c.localOptions(); track o.key) { <mat-option [value]="o.key"><mat-icon class="rpd-opt-ico" aria-hidden="true">{{ o.icon }}</mat-icon>{{ o.warn ? '⚠ ' : '' }}{{ o.label }}</mat-option> }
            </mat-optgroup>
          }
          @if (c.cloudOptions().length) {
            <mat-optgroup [label]="t.t('CopilotSchemasCloud')">
              @for (o of c.cloudOptions(); track o.key) {
                <mat-option [value]="o.key" [matTooltip]="o.offline ? t.t('Ai_AgentOfflineHint') : o.example ? t.t('Ai_ExampleReadOnly') : ''" [matTooltipShowDelay]="400" matTooltipPosition="right">
                  <mat-icon class="rpd-opt-ico" aria-hidden="true">{{ o.icon }}</mat-icon>{{ o.warn ? '⚠ ' : '' }}@if (o.offline) {<span class="rpd-offline-dot" role="img" [attr.aria-label]="t.t('Ai_AgentOffline')"></span>}{{ o.label }}@if (o.example) {<span class="rp-demo-badge">DEMO</span>}
                </mat-option>
              }
            </mat-optgroup>
          }
          @if (c.offersSchemaScreens()) {
            <mat-option value="__new_local" [disabled]="!!c.newLocal().why">{{ t.t('CopilotNewLocalSchema') }}{{ c.newLocal().why ? ' — ' + c.newLocal().why : '' }}</mat-option>
            <mat-option value="__new_cloud" [disabled]="!!c.newCloud().why">{{ t.t('CopilotNewCloudSchema') }}{{ c.newCloud().why ? ' — ' + c.newCloud().why : '' }}</mat-option>
          }
        </mat-select>
      </div>
    } @else {
      <!-- Nothing to choose: what follows at the right. -->
      <span class="rpd-spacer"></span>
    }
    @if (c.offersSchemaScreens()) {
      <button type="button" class="rpd-tool rpd-tool-sm" [matMenuTriggerFor]="schemaMenu" [matTooltip]="t.t('CopilotConfigureSchemas')" [matTooltipShowDelay]="400" [attr.aria-label]="t.t('CopilotConfigureSchemas')">
        <span class="material-icons" aria-hidden="true">settings</span>
      </button>
      <mat-menu #schemaMenu="matMenu" class="rp-designer-menu">
        <button mat-menu-item (click)="c.openLocalSchemas(false)" [disabled]="!!c.localScreen().why"><mat-icon>storage</mat-icon>{{ t.t('CopilotLocalSchemas') }}{{ c.localScreen().why ? ' — ' + c.localScreen().why : '' }}</button>
        <button mat-menu-item (click)="c.openCloudSchemas(false)"><mat-icon>cloud</mat-icon>{{ t.t('CopilotCloudSchemas') }}</button>
      </mat-menu>
    }
  `,
  styles: [`
    :host { display: flex; align-items: center; gap: 4px; flex: 1 1 auto; min-width: 0; }
    .rpd-select-chip { flex: 1 1 auto; min-width: 0; }
    /* Local or cloud, before the name (and before the ⚠): small, as the chip's own icon. */
    .rpd-opt-ico { width: 14px; height: 14px; font-size: 14px; line-height: 14px; vertical-align: -2px; margin-right: 4px; color: var(--rpd-text-2); }
    .mat-mdc-option .rpd-opt-ico { margin-right: 5px; }
  `],
})
export class SchemaSelectorComponent implements OnInit, OnDestroy {
  /** The assistant's choice: its lists, what is chosen and the screens. */
  readonly choice = input.required<SchemaChoice>();
  /** A schema chosen, by hand or by the list itself (back from the other tab); the actions at the end are not. */
  readonly chosen = output<SchemaChosen>();

  readonly t = inject(TranslationService);
  @ViewChild('schemaSelect') private schemaSelect?: MatSelect;

  ngOnInit(): void {
    // The local schema screen opens in another tab: back here, its new subschemas are in the list.
    window.addEventListener('focus', this.onWindowFocus);
  }

  ngOnDestroy(): void {
    window.removeEventListener('focus', this.onWindowFocus);
  }

  private onWindowFocus = async (): Promise<void> => {
    const chosen = await this.choice().reread();
    if (chosen) this.chosen.emit(chosen);
  };

  /** One choice of the list: a schema, or one of the actions at its end (the choice before stays). */
  choose(key: string): void {
    const c = this.choice();
    if (key === '__new_local' || key === '__new_cloud') {
      if (this.schemaSelect) this.schemaSelect.value = c.selectedKey();
      if (key === '__new_local') c.openLocalSchemas(true);
      else c.openCloudSchemas(true);
      return;
    }
    c.selectedKey.set(key);
    this.chosen.emit({ key, byHand: true, remember: true });
  }

  listOpened(opened: boolean): void {
    if (opened) this.choice().refreshCloudIfStale();
  }

  /**
   * The chip's hint: why the chosen one is a problem (its Agent is not connected, it goes over the plan), that it is one
   * of the cloud's read-only examples, or what it is.
   */
  chipTooltip(): string {
    const o = this.choice().selectedOption();
    const why = [o?.offline ? this.t.t('Ai_AgentOfflineHint') : '', o?.warn ? this.t.t('CopilotOverPlan') : '',
      o?.example ? this.t.t('Ai_ExampleReadOnly') : ''].filter((x) => x);
    return why.length ? why.join(' ') : this.t.t('CopilotSubschema');
  }
}
