import { $, toast } from "./dom";
import { readPreference } from "./storage";
import { theme } from "./preferences";
import { t, setLanguage, defaultLanguage, languageCatalogs } from "./language";
import { ApiError, errorText, api, handleUnauthorized } from "./api";
import { type AccessMode, session } from "./session";
import { loadDashboard, renderDashboard } from "./dashboard";
import { initialQuery, renderBookmarks } from "./bookmarks";
import { editBookmark } from "./bookmark-editor";
import { renderTokens, refreshUpdateNotice } from "./settings";
import { bindAccess, prepareAccessForm, showLogin } from "./access";
import { setMode } from "./navigation";
import "./actions";

// Keep the bottom search panel above the on-screen keyboard on mobile browsers.
const viewport = window.visualViewport;
if (viewport) {
  const updateViewport = () => {
    document.documentElement.style.setProperty(
      "--visual-height",
      `${viewport.height}px`,
    );
    document.documentElement.style.setProperty(
      "--keyboard-inset",
      `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`,
    );
  };
  viewport.addEventListener("resize", updateViewport);
  viewport.addEventListener("scroll", updateViewport);
  updateViewport();
}

async function start() {
  try {
    const access = await api<{ mode: AccessMode; authenticated: boolean }>("/auth/status");
    session.accessMode = access.mode;
    $("#setup-screen").hidden = access.mode !== "setup";
    if (access.mode === "setup") {
      session.authenticated = false;
      $("#app").hidden = true;
      $("#login").hidden = true;
      prepareAccessForm(true);
      $("#access-mode").focus();
      return;
    }
    if (!access.authenticated) {
      if (access.mode === "password") { showLogin(); return; }
      await api("/auth/login", {method: "POST", body: "{}"});
    }
    $('[data-action="logout"]').hidden = access.mode === "open";
    await loadDashboard();
    session.authenticated = true;
    $("#login").hidden = true;
    $("#app").hidden = false;
    void refreshUpdateNotice();
    const edit = location.pathname.match(/^\/bookmarks\/(\d+)\/edit\/?$/);
    const library =
      /^\/bookmarks\/?$/.test(location.pathname) ||
      edit ||
      location.hash === "#bookmarks";
    initialQuery(library
      ? new URLSearchParams(location.search).get("q") || ""
      : "");
    setMode(library ? "bookmarks" : "dashboard");
    if (edit) await editBookmark(Number(edit[1]));
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) toast(errorText(error), true);
    showLogin();
  }
}

async function applyLanguage(lang: string, persist = false) {
  if (!await setLanguage(lang, persist)) return false;
  renderTokens();
  theme(document.documentElement.dataset.theme || "dark");
  if (session.authenticated) {
    if (session.mode === "bookmarks") renderBookmarks();
    else renderDashboard();
  }
  $("#import-status").textContent = "";
  $("#toast").hidden = true;
  return true;
}

bindAccess(start);
handleUnauthorized(() => {
  const refreshAccess = session.authenticated;
  showLogin();
  if (refreshAccess) void start();
});
$<HTMLSelectElement>("#language").addEventListener("change", async () => {
  const status = $("#language-status");
  status.hidden = true;
  if (!await applyLanguage($<HTMLSelectElement>("#language").value, true)) {
    status.textContent = t("errors.languageLoad");
    status.hidden = false;
  }
});
const savedLanguage = readPreference("language", defaultLanguage);
const initialLanguage = Object.hasOwn(languageCatalogs, savedLanguage) ? savedLanguage : defaultLanguage;
if (await applyLanguage(initialLanguage)) {
  start();
} else if (await applyLanguage(initialLanguage === defaultLanguage ? "de" : defaultLanguage)) {
  toast(t("errors.languageLoad"), true);
  start();
} else {
  const status = $("#toast");
  status.textContent = "Could not load the language files. / Die Sprachdateien konnten nicht geladen werden.";
  status.classList.add("error");
  status.hidden = false;
}
