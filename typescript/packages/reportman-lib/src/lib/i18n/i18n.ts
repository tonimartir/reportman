import i18next from "i18next";
import en from "./en.json" with { type: "json" };
import es from "./es.json" with { type: "json" };

/**
 * The languages the designer speaks: the Reportman AI family's (Reportman.Web's list), each by its
 * own name. Spanish and English travel with the code (the default and the fallback); the rest are
 * loaded the first time they are chosen, so a page does not carry six languages it will not show.
 */
export const designerLanguages: { code: string; label: string }[] = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
  { code: "ca", label: "Català" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "zh", label: "中文" },
];

const loaders: Record<string, () => Promise<any>> = {
  ca: () => import("./ca.json", { with: { type: "json" } }),
  fr: () => import("./fr.json", { with: { type: "json" } }),
  de: () => import("./de.json", { with: { type: "json" } }),
  it: () => import("./it.json", { with: { type: "json" } }),
  pt: () => import("./pt.json", { with: { type: "json" } }),
  zh: () => import("./zh.json", { with: { type: "json" } }),
};

i18next.init({
  lng: "es", // idioma por defecto
  resources: {
    en: { translation: en },
    es: { translation: es },
  },
  // A text missing in a language (Chinese has only the classic strings the web designer uses) is
  // said in English.
  fallbackLng: "en",
  interpolation: {
    escapeValue: false, // importante para React/Angular, evitar doble escape
  },
});

/** The designer's code for a language tag ("ca-ES", "pt_BR", "ZH"): one of designerLanguages, or English. */
export function designerLanguageOf(lang: string | null | undefined): string {
  const code = (lang || "").trim().slice(0, 2).toLowerCase();
  return designerLanguages.some((l) => l.code === code) ? code : "en";
}

/** Changes the designer's language, loading its texts the first time; resolves once they are in. */
export async function setLanguage(lang: string): Promise<void> {
  const code = designerLanguageOf(lang);
  if (!i18next.hasResourceBundle(code, "translation") && loaders[code]) {
    const texts = await loaders[code]();
    i18next.addResourceBundle(code, "translation", texts.default ?? texts, true, true);
  }
  await i18next.changeLanguage(code);
}

/** The language the designer speaks now ("es", "en", "ca"…): what its calls tell the server and the AI. */
export function currentLanguage(): string {
  return i18next.language || "es";
}

export function translate(key: string, options?: any): string {
  const traduccion = i18next.t(key, options);
  return traduccion.toString();
}

export function translateNum(numberValue: number, options?: any): string {
  const traduccion = i18next.t("RpKey_" + numberValue.toString(), options);
  return traduccion.toString();
}
