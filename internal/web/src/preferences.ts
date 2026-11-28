import { $, $$ } from "./dom";
import { t } from "./language";

import { readPreference, preference } from "./storage";

export const linkTargets: Record<string, string> = {};
for (const [key, selector] of [["dashboard-target", ".quicklink"], ["bookmark-target", ".bookmark-title, .panel-result"]]) {
  const select = $<HTMLSelectElement>(`#${key}`);
  linkTargets[key] = readPreference(key, "_self") === "_blank" ? "_blank" : "_self";
  select.value = linkTargets[key];
  select.addEventListener("change", () => {
    linkTargets[key] = select.value;
    preference(key, select.value);
    for (const link of $$<HTMLAnchorElement>(selector)) link.target = select.value;
  });
}

export function theme(value: string) {
  document.documentElement.dataset.theme = value;
  preference("theme", value);
  $<HTMLMetaElement>('meta[name="theme-color"]').content =
    value === "dark" ? "#090f12" : "#f2f6f7";
  $("#theme-label").textContent =
    value === "dark"
      ? t("theme.switchToLight")
      : t("theme.switchToDark");
}
document.documentElement.dataset.theme = readPreference("theme", "dark");

export function toggleTheme() {
  theme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}
