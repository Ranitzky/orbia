import { $, $$ } from "./dom";
import { preference } from "./storage";

export const defaultLanguage = "en";
type Catalog = Record<string, string>;
const loadCatalog = (path: string): Promise<{ default: Catalog }> => import(path);
export const languageCatalogs: Record<string, () => Promise<{ default: Catalog }>> = {
  de: () => loadCatalog("./de.js?v=7"),
  en: () => loadCatalog("./en.js?v=22"),
};
let messages: Catalog = {};

export function t(key: string, values?: Record<string, unknown>) {
  const text = messages[key] ?? key;
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
}

function translateShell() {
  for (const el of $$("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n!);
  }
  for (const attr of ["aria-label", "placeholder", "content"]) {
    const keyAttr = `data-i18n-${attr}`;
    for (const el of $$(`[${keyAttr}]`)) {
      el.setAttribute(attr, t(el.getAttribute(keyAttr)!));
    }
  }
}

export async function setLanguage(lang: string, persist = false) {
  const select = $<HTMLSelectElement>("#language");
  select.disabled = true;
  try {
    messages = (await languageCatalogs[lang]()).default;
  } catch {
    select.value = document.documentElement.lang;
    return false;
  } finally {
    select.disabled = false;
  }
  document.documentElement.lang = lang;
  select.value = lang;
  translateShell();

  if (persist) preference("language", lang);

  return true;
}
