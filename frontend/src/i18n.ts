import en from "./locales/en.json";

export type Language = "es" | "en";
export type LanguagePreference = Language | "system";

const STORAGE_KEY = "mydgx-language";
const catalogs: Record<Language, Record<string, string>> = { es: {}, en };

export function storedLanguagePreference(): LanguagePreference {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "es" || value === "en" ? value : "system";
}

function systemLanguage(): Language {
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const base = tag.toLowerCase().split("-")[0];
    if (base === "es" || base === "en") return base;
  }
  return "en";
}

function resolveLanguage(preference: LanguagePreference): Language {
  return preference === "system" ? systemLanguage() : preference;
}

export const language: Language = resolveLanguage(storedLanguagePreference());
document.documentElement.lang = language;

/** Changing the language reloads the page so every module-level text is rebuilt. */
export function setLanguagePreference(preference: LanguagePreference) {
  if (preference === "system") localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, preference);
  if (resolveLanguage(preference) !== language) window.location.reload();
}

type Values = Record<string, string | number | boolean | null | undefined>;

function interpolate(text: string, values?: Values) {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name] ?? "") : match));
}

/** Spanish source text is the key; untranslated keys fall back to Spanish. */
export function t(source: string, values?: Values): string {
  return interpolate(catalogs[language][source] ?? source, values);
}

/** Translates text produced by the backend when it matches a known message exactly. */
export function translateServerText(text: string): string {
  return language === "es" ? text : catalogs[language][text] ?? text;
}

export const locale = language === "es" ? "es-ES" : "en-US";

export const languageHeader = { "X-MyDGX-Language": language };
