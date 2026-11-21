import { PrintItemText } from "./print-item-text.js";

export class LabelItem extends PrintItemText {
  /** The text of each report language: item 0 is the default language, item n + 1 the language n. */
  public allStrings: string[] = [];
  constructor() {
    super();
    this.className = "TRPLABEL";
  }
}
