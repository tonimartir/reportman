import { NgModule, Pipe, PipeTransform } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OverlayModule } from '@angular/cdk/overlay';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BotonComponent, OpcionesMenuComponent } from './widgets/boton.component';
import { EntradaCheckboxComponent, EntradaSelectComponent, EntradaTextoComponent, OpcionSelectDirective } from './widgets/entradas.component';
import { SplitAreaDirective, SplitComponent } from './widgets/split.component';
import { SqlEditorComponent } from '../components/sql-editor/sql-editor.component';
import { AiChatComponent } from '../ai/ai-chat.component';
import { AiUsageHeaderComponent } from '../ai/ai-usage-header.component';
import { NgIconDirective } from './widgets/ng-icon.directive';
import { MenuComponent } from './widgets/menu.component';

/** `fn | bind: ctx` → the function bound to ctx, for `[obtenerOpciones]="getOptions | bind: this"`. */
@Pipe({ name: 'bind', pure: true })
export class BindPipe implements PipeTransform {
  transform<T extends (...args: any[]) => any>(fn: T, context: any): T {
    return fn ? (fn.bind(context) as T) : fn;
  }
}

const WIDGETS = [
  BotonComponent, OpcionesMenuComponent,
  EntradaSelectComponent, OpcionSelectDirective, EntradaCheckboxComponent, EntradaTextoComponent,
  SplitComponent, SplitAreaDirective, SqlEditorComponent, AiChatComponent, AiUsageHeaderComponent, NgIconDirective, MenuComponent, BindPipe,
];

/**
 * The original host application's SharedModule as the designer needs it: the widgets its templates already use
 * (`boton`, `entrada-*`, `opcion-select`, `split`, `split-area`, `rp-sql-editor`, `rp-ai-chat`, `rp-ai-usage-header`, `menu`,
 * `ngIcon`, the `bind` pipe), now standalone components over Material and the CDK, exported
 * through one module so `imports: [SharedModule]` keeps working in every designer component.
 */
@NgModule({
  imports: [CommonModule, FormsModule, OverlayModule, MatIconModule, MatButtonModule, MatTooltipModule, ...WIDGETS],
  exports: [CommonModule, FormsModule, OverlayModule, MatIconModule, MatButtonModule, MatTooltipModule, ...WIDGETS],
})
export class SharedModule {}
