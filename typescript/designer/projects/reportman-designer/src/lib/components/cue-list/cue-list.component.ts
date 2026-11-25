import { Component, Input, inject, signal, ViewEncapsulation } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { NgxReportmanLibService } from "../../services/ngx-reportman-lib.service";
import { PresentacionService } from "../../shell/presentacion.service";
import { SharedModule } from "../../shell/shared.module";
import { TranslationService } from "../../services/translator.service";
import { ChangeObjectOperation, OperationType, Report } from "@reportman/lib";

@Component({
  selector: "cue-list",
  imports: [CommonModule, FormsModule, SharedModule],
  templateUrl: "./cue-list.component.html",
  styleUrls: ["./cue-list.component.css"],
  encapsulation: ViewEncapsulation.Emulated,
})
export class CueListComponent {
  protected readonly t = inject(TranslationService);
  @Input() public report?: Report;
  @Input() public redoCue?: boolean;

  protected cuePages: number[] = [];
  protected currentPage = 1;
  protected searchedPage = signal<number>(this.currentPage);
  protected listLimit = 30;

  protected get undoOperationsDesc(): ChangeObjectOperation[] {
    const newCuePages = [];
    // creates a reversed copy
    const undoOp = this.report?.undoCue?.undoOperations;

    if (undoOp) {
      for (let index = 0; index < undoOp.length / this.listLimit; index++) {
        newCuePages.push(index + 1);
      }
      this.cuePages = newCuePages;
      return [...this.report!.undoCue!.undoOperations].reverse();
    } else {
      this.cuePages = [1];
      return [];
    }
  }

  constructor(
    private reportService: NgxReportmanLibService,
    private presentationService: PresentacionService
  ) {}

  protected toggleProperties(op: ChangeObjectOperation) {
    op.expandedProperties = !op.expandedProperties;
  }

  /** The Material icon that stands for an operation in the list. */
  protected operationIcon(operation: OperationType): string {
    switch (operation) {
      case OperationType.Add:
        return "add";
      case OperationType.Modify:
        return "edit";
      case OperationType.Remove:
        return "delete";
      case OperationType.SwapDown:
        return "arrow_downward";
      case OperationType.SwapUp:
        return "arrow_upward";
      case OperationType.Rename:
        return "text_fields";
      default:
        return "help_outline";
    }
  }

  /** What an operation did, in words, for the tooltip of its icon. */
  protected operationText(operation: OperationType): string {
    switch (operation) {
      case OperationType.Add:
        return "Añadido";
      case OperationType.Modify:
        return "Modificado";
      case OperationType.Remove:
        return "Eliminado";
      case OperationType.SwapDown:
        return "Bajado";
      case OperationType.SwapUp:
        return "Subido";
      case OperationType.Rename:
        return "Renombrado";
      default:
        return "";
    }
  }

  protected enterSearchPageInput() {
    if (this.searchedPage() > this.cuePages.length) {
      this.searchedPage.set(this.cuePages.length);
    }
    if (this.searchedPage() <= 0) {
      this.searchedPage.set(1);
    }
    if (!this.searchedPage()) {
      return;
    }
    this.currentPage = this.searchedPage();
  }
}
