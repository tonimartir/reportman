import { Component, ComponentRef, ViewEncapsulation, Injector } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { TranslationService } from "../../services/translator.service";
import { Ventana } from "../../shell/ventana";
import { PresentacionService } from "../../shell/presentacion.service";
import { SharedModule } from "../../shell/shared.module";

@Component({
  selector: "app-font-selector-dialog",
  imports: [CommonModule, FormsModule, SharedModule],
  templateUrl: "./font-selector-dialog.component.html",
  styleUrls: ["./font-selector-dialog.component.css"],
  encapsulation: ViewEncapsulation.Emulated,
})
export class FontSelectorDialogComponent extends Ventana<FontSelection, FontSelection | undefined> {
  public fonts: string[] = [];
  public selectedFont = "";
  public italic = false;
  public bold = false;
  public strikeout = false;
  public underline = false;

  public previewStyle: any = {};

  public currentComponentRef?: ComponentRef<FontSelectorDialogComponent>;
  public resolvePromise: ((value: FontSelection | null) => void) | null = null;
  protected stringOk: string;
  protected stringCancel: string;

  protected stringFont: string;
  constructor(
    injector: Injector,
    protected translator: TranslationService
  ) {
    super(injector, { nombre: "FontSelectorDialog" });
    this.stringOk = translator.TranslateStr(93);
    this.stringCancel = translator.TranslateStr(94);
    this.stringFont = translator.TranslateStr(566);
  }

  public override _inicializarDatos() {
    this.selectedFont = this.peticion.fontFamily;
    this.italic = this.peticion.italic;
    this.bold = this.peticion.bold;
    this.underline = this.peticion.underline;
    this.strikeout = this.peticion.strikeout;

    this.updatePreview();

    const fontFamilies = new Set<string>();
    document.fonts.forEach((font) => {
      fontFamilies.add(font.family);
    });
    this.fonts = Array.from(fontFamilies).sort();

    if (this.fonts.length === 0) {
      this.fonts = ["Arial", "Verdana", "Times New Roman", "Courier New"];
    }
    if (!this.selectedFont) {
      this.selectedFont = this.fonts[0];
    }
    this.updatePreview();
  }

  public updatePreview() {
    this.previewStyle = {
      "font-family": `'${this.selectedFont}'`,
      "font-style": this.italic ? "italic" : "normal",
      "font-weight": this.bold ? "bold" : "normal",
      "text-decoration": [this.underline ? "underline" : "", this.strikeout ? "line-through" : ""]
        .filter((s) => s)
        .join(" "),
    };
  }

  public confirm() {
    this.cerrarModal(
      new FontSelection(this.selectedFont, this.bold, this.italic, this.underline, this.strikeout)
    );
  }

  public cancel() {
    this.cerrarModal(undefined);
  }
  public static async selectFont(
    pres: PresentacionService,
    initialSelection: FontSelection
  ): Promise<FontSelection | undefined> {
    const modal = await pres.abrirModal(FontSelectorDialogComponent, {
      peticion: initialSelection,
    });
    const resultado = await modal.esperarResultadoModal();
    return resultado;
  }
}
export class FontSelection {
  constructor(
    public fontFamily: string,
    public bold: boolean,
    public italic: boolean,
    public underline: boolean,
    public strikeout: boolean
  ) {}
  public static GetFonSelection(fontFamily: string, intfontstyle: number): FontSelection {
    const data = new FontSelection(
      fontFamily,
      (intfontstyle & 1) > 0,
      (intfontstyle & 2) > 0,
      (intfontstyle & 4) > 0,
      (intfontstyle & 8) > 0
    );
    return data;
  }
  public static FontSelectionToFontStyleInt(data: FontSelection): number {
    let value = 0;
    if (data.bold) {
      value |= 1;
    }
    if (data.italic) {
      value |= 2;
    }
    if (data.underline) {
      value |= 4;
    }
    if (data.strikeout) {
      value |= 8;
    }
    return value;
  }
}
export class PeticionFontDialog {}
