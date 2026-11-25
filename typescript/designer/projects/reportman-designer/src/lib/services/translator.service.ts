import { Injectable, signal } from "@angular/core";
import { translate, setLanguage, translateNum, currentLanguage, designerLanguages } from "@reportman/lib";

@Injectable({ providedIn: "root" })
export class TranslationService {
  /** Moves on every change of language: a computed text that reads it is recomputed in the new one. */
  public readonly changes = signal(0);

  /** The languages the designer speaks, by their code and their own name. */
  public readonly languages = designerLanguages;

  /**
   * The designer's language: the host sets it when its own changes. One it does not speak is said in
   * English. Resolves once its texts are loaded (Spanish and English are always there).
   */
  public async setLang(lang: string): Promise<void> {
    await setLanguage(lang);
    this.changes.update((n) => n + 1);
  }

  public lang(): string {
    return currentLanguage();
  }

  public t(key: string, params?: any): string {
    return translate(key, params);
  }
  public TranslateStr(numberValue: number, params?: any) {
    return translateNum(numberValue, params);
  }
}
