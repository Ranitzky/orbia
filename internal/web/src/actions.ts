import { errorText } from "./api";
import { $, $$, toast } from "./dom";
import { toggleTheme } from "./preferences";
import { session } from "./session";
import { isEditing, setPage, dashboardKeydown } from "./dashboard";
import { toggleTag } from "./bookmark-data";
import { bookmarkActions, bookmarkQuery, showAllResults, queryBookmarks } from "./bookmarks";
import { openSearch, selectPanelTag, searchKeydown } from "./search";
import { openCommands, commandKeydown, runCommand } from "./commands";
import { editLink, editGroup, editPage } from "./dashboard-editor";
import { editBookmark } from "./bookmark-editor";
import { copyActions, openSettings } from "./settings";
import { logout } from "./access";
import { setMode, toggleEdit } from "./navigation";

const actions: Record<string, () => void | Promise<void>> = {
  dashboard: () => setMode("dashboard"),
  bookmarks: () => setMode("bookmarks"),
  search: openSearch,
  command: openCommands,
  settings: openSettings,
  theme: toggleTheme,
  "new-link": () => editLink(),
  "new-group": () => editGroup(),
  "new-page": () => editPage(true),
  "edit-page": () => editPage(false),
  "new-bookmark": () => editBookmark(),
  "mobile-add": () =>
    session.mode === "dashboard" ? editLink() : editBookmark(),
  ...bookmarkActions,
  "all-results": () => {
    showAllResults($<HTMLInputElement>("#panel-query").value);
    setMode("bookmarks");
  },
  ...copyActions,
  logout,
};

document.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) return;
  const el = event.target.closest<HTMLElement>("button, a, [data-close]");
  if (!el) return;
  if (el.dataset.close) {
    const dialog = document.getElementById(el.dataset.close);
    if (dialog instanceof HTMLDialogElement) dialog.close();
    return;
  }
  try {
    if (el.dataset.action) {
      await actions[el.dataset.action]?.();
      return;
    }
    if (el.dataset.page) {
      setPage(el.dataset.page);
      return;
    }
    if (el.dataset.editGroup) {
      editGroup(el.dataset.editGroup);
      return;
    }
    if (el.dataset.addTo) {
      editLink(undefined, el.dataset.addTo);
      return;
    }
    if (el.dataset.link && isEditing()) {
      event.preventDefault();
      editLink(el.dataset.link);
      return;
    }
    if (el.dataset.editBookmark) {
      editBookmark(Number(el.dataset.editBookmark));
      return;
    }
    if (el.dataset.bookmarkTag) {
      if (session.mode !== "bookmarks") setMode("bookmarks");
      queryBookmarks(toggleTag(bookmarkQuery(), el.dataset.bookmarkTag));
      return;
    }
    if (el.dataset.panelTag) {
      selectPanelTag(el.dataset.panelTag);
      return;
    }
    if (el.dataset.command !== undefined)
      runCommand(Number(el.dataset.command));
  } catch (error) {
    toast(errorText(error), true);
  }
});

document.addEventListener("keydown", (event) => {
  if (!session.authenticated || event.isComposing) return;
  const modifier = event.metaKey || event.ctrlKey,
    key = event.key.toLowerCase(),
    dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
  if (event.altKey && key !== "#") return;
  if (modifier && (key === "k" || key === "p")) {
    event.preventDefault();
    key === "k" ? openCommands() : openSearch();
    return;
  }
  if (dialog) {
    // WebKit with keyboard navigation disabled otherwise skips buttons and links.
    if (event.key === "Tab" && !modifier) {
      const controls = $$("button, a[href], input, textarea, select", dialog)
        .filter(el => !el.matches(":disabled") && el.tabIndex >= 0 && el.getClientRects().length);
      if (controls.length) {
        event.preventDefault();
        const index = controls.findIndex(el => el === document.activeElement);
        const step = event.shiftKey ? -1 : 1;
        controls[(index + step + controls.length) % controls.length].focus();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      dialog.close();
      return;
    }
    if (dialog.id === "search-dialog") searchKeydown(event);
    if (dialog.id === "command-dialog") commandKeydown(event);
    return;
  }
  if (modifier && key === "e") {
    event.preventDefault();
    toggleEdit();
    return;
  }
  if (event.metaKey !== event.ctrlKey && !event.shiftKey && (key === "d" || key === "b")) {
    event.preventDefault();
    setMode(key === "d" ? "dashboard" : "bookmarks");
    return;
  }
  if (modifier) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]'))
    return;
  if (key === "/" || key === "+" || key === "#" || key === ",") {
    event.preventDefault();
    if (key === "/") openSearch();
    if (key === "+") actions["mobile-add"]();
    if (key === "#") openSearch("#");
    if (key === ",") openSettings();
    return;
  }
  if (session.mode === "bookmarks") return;
  dashboardKeydown(event);
});
