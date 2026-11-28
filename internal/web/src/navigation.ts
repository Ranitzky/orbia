import { $, $$, closeDialogs } from "./dom";
import { type Mode, session } from "./session";
import { clearQuickInput, renderDashboard, toggleDashboardEditing } from "./dashboard";
import { bookmarkQuery, loadBookmarks } from "./bookmarks";

export function setMode(mode: Mode) {
  session.mode = mode;
  clearQuickInput();
  closeDialogs();
  $("#dashboard-view").hidden = mode !== "dashboard";
  $("#bookmark-view").hidden = mode !== "bookmarks";
  $("#nav-dashboard").classList.toggle("active", mode === "dashboard");
  $("#nav-bookmarks").classList.toggle("active", mode === "bookmarks");
  $("#nav-dashboard").setAttribute(
    "aria-current",
    mode === "dashboard" ? "page" : "false",
  );
  $("#nav-bookmarks").setAttribute(
    "aria-current",
    mode === "bookmarks" ? "page" : "false",
  );
  $$<HTMLButtonElement>(".mobile-nav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.action === mode),
  );
  history.replaceState(
    null,
    "",
    mode === "bookmarks"
      ? "/bookmarks" +
          (bookmarkQuery() ? "?q=" + encodeURIComponent(bookmarkQuery()) : "")
      : "/",
  );
  if (mode === "bookmarks") {
    const query = $<HTMLInputElement>("#bookmark-query");
    query.value = bookmarkQuery();
    query.focus();
    loadBookmarks();
  } else renderDashboard();
}

export function toggleEdit() {
  toggleDashboardEditing();
  if (session.mode !== "dashboard") setMode("dashboard");
  else renderDashboard();
}
