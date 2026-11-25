import { Component, ElementRef, Injector, ViewChild, ViewEncapsulation, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { DataInfo, Report } from "@reportman/lib";
import { TranslationService } from "../../services/translator.service";
import { Ventana } from "../../shell/ventana";
import { PresentacionService } from "../../shell/presentacion.service";
import { SharedModule } from "../../shell/shared.module";
import { DatasetFieldsOf, UnionSettings } from "../../models/union-settings";

/** A field of the dataset of the selected entry, ticked when the entry names it as a common field. */
export interface UnionFieldItem {
  name: string;
  checked: boolean;
}

/**
 * The dialog of the unions of a dataset of the MyBase connection: the datasets it joins, in order,
 * the fields a parallel union matches by, the grouping and the index fields (the C# designer's
 * UnionsEditorForm). It returns the settings when they are accepted; who opens it applies them.
 */
@Component({
  selector: "app-unions-dialog",
  imports: [CommonModule, FormsModule, SharedModule],
  templateUrl: "./unions-dialog.component.html",
  styleUrls: ["./unions-dialog.component.css"],
  encapsulation: ViewEncapsulation.Emulated,
})
export class UnionsDialogComponent extends Ventana<PeticionUnionsDialog, UnionSettings | undefined> {
  @ViewChild("availableList") private availableList?: ElementRef<HTMLSelectElement>;
  protected readonly t = inject(TranslationService);

  /** The settings as the dialog leaves them. */
  public settings = new UnionSettings();
  /** The dataset whose unions are edited. */
  public alias = "";
  /** The datasets of the report that may be joined: all but this one. */
  public available: string[] = [];
  public selectedAvailable: string | null = null;
  /** The selected entry of the union, -1 for none. */
  public selectedIndex = -1;
  /** The common fields of the selected entry, as written ("F1;F2"). */
  public fieldsText = "";
  /** The fields of the dataset of the selected entry, when the designer knows them. */
  public fieldItems: UnionFieldItem[] = [];
  /** The columns the union gives (empty when the fields of a dataset are not known). */
  public columnsText = "";
  /** What the engine would refuse, shown when OK is pressed. */
  public problem: string | null = null;

  private fieldsOfDataset: DatasetFieldsOf = () => null;
  private readonly fieldCache = new Map<string, string[] | null>();

  constructor(injector: Injector) {
    super(injector, { nombre: "UnionsDialog" });
  }

  public override _inicializarDatos(): void {
    const peticion = this.peticion ?? new PeticionUnionsDialog();
    const info = peticion.dataInfo;
    this.alias = info?.alias ?? "";
    this.settings = peticion.settings
      ? peticion.settings.clone()
      : info
        ? UnionSettings.of(info)
        : new UnionSettings();
    this.fieldsOfDataset = peticion.fieldsOf ?? (() => null);
    const own = this.alias.toUpperCase();
    this.available = [];
    for (const other of peticion.report?.dataInfo ?? []) {
      if (other.alias && other.alias.toUpperCase() !== own) {
        this.available.push(other.alias);
      }
    }
    this.selectedAvailable = this.available.length ? this.available[0] : null;
    this.fillUnions(0);
  }

  protected override _actualizarFocus(): void {
    this.availableList?.nativeElement.focus();
  }

  public get title(): string {
    return this.t.TranslateStr(1083) + " - " + this.alias;
  }

  /** The common fields are edited only in a parallel union, for the selected entry. */
  public get fieldsEnabled(): boolean {
    return this.settings.parallel && this.selectedIndex >= 0;
  }

  private fillUnions(selected: number): void {
    const count = this.settings.entries.length;
    this.selectedIndex = count ? Math.max(0, Math.min(selected, count - 1)) : -1;
    this.showFieldsOfSelected();
    this.updateColumns();
  }

  /** Adds a dataset at the end of the union. */
  public addDataset(dataset: string): void {
    if (!dataset) {
      return;
    }
    this.problem = null;
    this.settings.entries.push(dataset);
    this.fillUnions(this.settings.entries.length - 1);
  }

  public addSelected(): void {
    if (this.selectedAvailable) {
      this.addDataset(this.selectedAvailable);
    }
  }

  public removeSelected(): void {
    const index = this.selectedIndex;
    if (index < 0 || index >= this.settings.entries.length) {
      return;
    }
    this.problem = null;
    this.settings.entries.splice(index, 1);
    this.fillUnions(index);
  }

  public moveSelected(delta: number): void {
    const index = this.selectedIndex;
    const target = index + delta;
    if (index < 0 || target < 0 || target >= this.settings.entries.length) {
      return;
    }
    const [entry] = this.settings.entries.splice(index, 1);
    this.settings.entries.splice(target, 0, entry);
    this.fillUnions(target);
  }

  /** Selects an entry of the union. */
  public selectEntry(index: number | string | null): void {
    const value = index === null || index === "" ? -1 : Number(index);
    this.selectedIndex = Number.isFinite(value) && value >= 0 && value < this.settings.entries.length ? value : -1;
    this.showFieldsOfSelected();
  }

  public setParallel(value: boolean): void {
    this.settings.parallel = !!value;
    this.problem = null;
    this.showFieldsOfSelected();
    this.updateColumns();
  }

  public setGroup(value: boolean): void {
    this.settings.group = !!value;
    this.problem = null;
  }

  public setIndexFields(value: string): void {
    this.settings.indexFields = value ?? "";
    this.problem = null;
  }

  /** The fields of a dataset of the report as the designer knows them (null when it does not). */
  private fieldsOf(dataset: string): string[] | null {
    const key = dataset.toUpperCase();
    if (this.fieldCache.has(key)) {
      return this.fieldCache.get(key) ?? null;
    }
    let fields: string[] | null = null;
    try {
      fields = this.fieldsOfDataset(dataset);
    } catch {
      fields = null;
    }
    this.fieldCache.set(key, fields);
    return fields;
  }

  private showFieldsOfSelected(): void {
    this.fieldItems = [];
    this.fieldsText = "";
    const index = this.selectedIndex;
    if (index < 0 || index >= this.settings.entries.length) {
      return;
    }
    const entry = this.settings.entries[index];
    this.fieldsText = UnionSettings.fieldsOf(entry);
    const fields = this.fieldsEnabled ? this.fieldsOf(UnionSettings.aliasOf(entry)) : null;
    if (fields) {
      const selected = UnionSettings.commonFieldsOf(entry);
      this.fieldItems = fields.map((name) => ({ name, checked: selected.includes(name.toUpperCase()) }));
    }
  }

  /** A field ticked or unticked: the common fields of the selected entry are the ticked ones. */
  public toggleField(index: number, checked: boolean): void {
    if (index < 0 || index >= this.fieldItems.length) {
      return;
    }
    this.fieldItems[index].checked = !!checked;
    const fields = this.fieldItems.filter((f) => f.checked).map((f) => f.name);
    this.setFieldsOfSelected(fields.join(";"), true);
  }

  /** The common fields of the selected entry, as written. */
  public setFieldsOfSelected(fields: string, updateText: boolean): void {
    const index = this.selectedIndex;
    if (index < 0 || index >= this.settings.entries.length) {
      return;
    }
    this.problem = null;
    const entry = UnionSettings.entryOf(UnionSettings.aliasOf(this.settings.entries[index]), fields);
    this.settings.entries[index] = entry;
    if (updateText) {
      this.fieldsText = UnionSettings.fieldsOf(entry);
    } else {
      // Written by hand: the ticks follow what is written
      const selected = UnionSettings.commonFieldsOf(entry);
      for (const item of this.fieldItems) {
        item.checked = selected.includes(item.name.toUpperCase());
      }
    }
    this.updateColumns();
  }

  private updateColumns(): void {
    const columns = this.settings.resultColumns((dataset) => this.fieldsOf(dataset));
    this.columnsText = !columns || columns.length === 0 ? "" : this.t.TranslateStr(1849) + ": " + columns.join(", ");
  }

  public confirm(): void {
    const problem = this.settings.validate((key) => this.t.TranslateStr(key));
    if (problem) {
      this.problem = problem;
      return;
    }
    this.settings.indexFields = this.settings.indexFields.trim();
    this.cerrarModal(this.settings);
  }

  public cancel(): void {
    this.cerrarModal(undefined);
  }

  /** Shows the dialog for a dataset: the settings when the user accepts them, else undefined. */
  public static async editUnions(
    pres: PresentacionService,
    report: Report,
    dataInfo: DataInfo,
    fieldsOf?: DatasetFieldsOf
  ): Promise<UnionSettings | undefined> {
    const peticion = new PeticionUnionsDialog();
    peticion.report = report;
    peticion.dataInfo = dataInfo;
    peticion.fieldsOf = fieldsOf;
    const modal = await pres.abrirModal(UnionsDialogComponent, { peticion: peticion });
    const resultado = await modal.esperarResultadoModal();
    return resultado ?? undefined;
  }
}

export class PeticionUnionsDialog {
  public report?: Report;
  public dataInfo?: DataInfo;
  /** The settings to start from (by default, the dataset's). */
  public settings?: UnionSettings;
  /** The fields of a dataset of the report as the designer knows them. */
  public fieldsOf?: DatasetFieldsOf;
}
