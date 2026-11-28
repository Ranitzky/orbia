import { dashboardPages, isEditing, setPage } from "./dashboard";
import { editLink, editPage } from "./dashboard-editor";
import { editBookmark } from "./bookmark-editor";
import { setMode, toggleEdit } from "./navigation";
import { toggleTheme } from "./preferences";
import { openSearch } from "./search";
import { session } from "./session";
import { openSettings } from "./settings";
import { $, $$, escapeHTML, icon, openDialog } from "./dom";
import { t } from "./language";

export interface Command {
  label: string;
  icon: string;
  key?: string;
  run: () => void;
}
let commands: Command[] = [];
let commandSelected = 0;

function availableCommands(): Command[] {
  return [
    {
      label: t("commands.openDashboard"),
      icon: "grid",
      key: "⌘ D",
      run: () => setMode("dashboard"),
    },
    {
      label: t("commands.openBookmarks"),
      icon: "bookmark",
      key: "⌘ B",
      run: () => setMode("bookmarks"),
    },
    {
      label: t("search.title"),
      icon: "search",
      key: "⌘ P",
      run: openSearch,
    },
    {
      label: t("dashboard.addQuicklink"),
      icon: "plus",
      key: session.mode === "dashboard" ? "+" : "",
      run: () => editLink(),
    },
    { label: t("bookmarks.add"), icon: "plus", key: session.mode === "bookmarks" ? "+" : "", run: () => editBookmark() },
    {
      label: isEditing() ? t("dashboard.finishEditing") : t("dashboard.edit"),
      icon: "edit",
      key: "⌘ E",
      run: toggleEdit,
    },
    ...dashboardPages().map((p, i) => ({
      label: t("commands.switchPage", {name: p.name}),
      icon: "grid",
      key: String(i + 1),
      run: () => {
        setPage(p.id);
        setMode("dashboard");
      },
    })),
    {
      label: t("dashboard.addDashboardPage"),
      icon: "plus",
      run: () => editPage(true),
    },
    {
      label: t("commands.editCurrentPage"),
      icon: "edit",
      run: () => editPage(false),
    },
    {
      label:
        document.documentElement.dataset.theme === "dark"
          ? t("commands.enableLightTheme")
          : t("commands.enableDarkTheme"),
      icon: "sun",
      run: toggleTheme,
    },
    {
      label: t("commands.openSettings"),
      icon: "settings",
      run: openSettings,
    },
  ];
}

export function openCommands() {
  openDialog("#command-dialog");
  $<HTMLInputElement>("#command-query").value = "";
  renderCommands();
  $("#command-query").focus();
}
function renderCommands() {
  const value = $<HTMLInputElement>("#command-query").value.toLocaleLowerCase(document.documentElement.lang);
  commands = availableCommands().filter((c) =>
    c.label.toLocaleLowerCase(document.documentElement.lang).includes(value),
  );
  commandSelected = 0;
  $("#commands").innerHTML =
    `<p class="command-group">${t("commands.groupTitle")}</p>` +
    (commands
      .map(
        (c, i) =>
          `<button class="command-item ${i === 0 ? "selected" : ""}" data-command="${i}">${icon(c.icon)}<span>${escapeHTML(c.label)}</span>${c.key ? `<kbd>${c.key}</kbd>` : ""}</button>`,
      )
      .join("") || `<p class="empty-state">${t("commands.noMatches")}</p>`);
}
function selectCommand(index: number) {
  if (!commands.length) return;
  commandSelected =
    (index + commands.length) % commands.length;
  $$(".command-item").forEach((el, i) =>
    el.classList.toggle("selected", i === commandSelected),
  );
  $$(".command-item")[commandSelected]?.scrollIntoView({
    block: "nearest",
  });
  $("#command-status").textContent =
    commands[commandSelected].label;
}
export function runCommand(index: number) {
  const command = commands[index];
  if (command) {
    $<HTMLDialogElement>("#command-dialog").close();
    command.run();
  }
}

$<HTMLInputElement>("#command-query").addEventListener("input", renderCommands);

export function commandKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    selectCommand(
      commandSelected + (event.key === "ArrowDown" ? 1 : -1),
    );
  }
  if (event.key === "Enter" && event.target === $<HTMLInputElement>("#command-query")) {
    event.preventDefault();
    runCommand(commandSelected);
  }
}
