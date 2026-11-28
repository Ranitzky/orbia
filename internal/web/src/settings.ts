import { $, openDialog, integrationStatus } from "./dom";
import { t } from "./language";
import { errorText, api, pullPath } from "./api";
import { session } from "./session";
import { loadDashboard, renderDashboard } from "./dashboard";
import { loadBookmarks } from "./bookmarks";
import { prepareAccessForm } from "./access";

const tokensPath = "/api/orbia/tokens";
interface TokenEntry { id: number; name: string }
let tokenEntries: TokenEntry[] = [];
let settingsGeneration = 0;

function copyStatus(id: string, message: string, copied = false) {
  $(id).classList.toggle("sr-only", copied);
  integrationStatus(id, message, !copied && message !== "");
}
export function renderTokens() {
  $("#token-list").replaceChildren(...tokenEntries.map(entry => {
    const row = document.createElement("div");
    row.className = "copy-field";
    const name = document.createElement("span");
    name.textContent = entry.name;
    const button = document.createElement("button");
    button.className = "text-button danger-text";
    button.textContent = t("tokens.revoke");
    button.addEventListener("click", async () => {
      if (!confirm(t("tokens.revokeConfirm", {name: entry.name}))) return;
      button.disabled = true;
      try {
        await api(tokensPath + "?id=" + entry.id, {method: "DELETE"});
        clearNewToken();
        await loadTokens();
        integrationStatus("#token-status", t("tokens.revoked"));
      } catch (error) {
        integrationStatus("#token-status", errorText(error), true);
      } finally {
        button.disabled = false;
      }
    });
    row.append(name, button);
    return row;
  }));
}
async function loadTokens() {
  const generation = settingsGeneration;
  const entries = await api<TokenEntry[]>(tokensPath);
  if (generation !== settingsGeneration) return;
  tokenEntries = entries;
  renderTokens();
}
function clearNewToken() {
  $<HTMLInputElement>("#token-value").value = "";
  $("#new-token").hidden = true;
  copyStatus("#token-copy-status", "");
}
$<HTMLDialogElement>("#settings-dialog").addEventListener("close", () => {
  settingsGeneration++;
  $<HTMLFormElement>("#access-form").reset();
  clearNewToken();
  $<HTMLInputElement>("#source-token").value = "";
});
$<HTMLFormElement>("#token-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter instanceof HTMLButtonElement ? event.submitter : $<HTMLButtonElement>("#token-form button");
  const generation = settingsGeneration;
  button.disabled = true;
  clearNewToken();
  integrationStatus("#token-status", "");
  try {
    const result = await api<{ token: string }>(tokensPath, {method: "POST", body: JSON.stringify({name: $<HTMLInputElement>("#token-name").value})});
    if (generation !== settingsGeneration || !$<HTMLDialogElement>("#settings-dialog").open) return;
    $<HTMLInputElement>("#token-name").value = "";
    $<HTMLInputElement>("#token-value").value = result.token;
    $("#new-token").hidden = false;
    $<HTMLInputElement>("#token-value").select();
    await loadTokens();
  } catch (error) {
    integrationStatus("#token-status", errorText(error), true);
  } finally {
    button.disabled = false;
  }
});
$<HTMLFormElement>("#pull-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $<HTMLButtonElement>("#pull-form button");
  button.disabled = true;
  integrationStatus("#pull-status", t("backup.importing"));
  const body = JSON.stringify({url: $<HTMLInputElement>("#source-url").value.trim(), token: $<HTMLInputElement>("#source-token").value.trim()});
  $<HTMLInputElement>("#source-token").value = "";
  try {
    const result = await api<Record<string, number>>(pullPath, {method: "POST", body});
    integrationStatus("#pull-status", t("linkding.importSummary", result));
  } catch (error) {
    integrationStatus("#pull-status", errorText(error), true);
  } finally {
    button.disabled = false;
    if (session.authenticated && session.mode === "bookmarks") await loadBookmarks();
  }
});

export function openSettings() {
  prepareAccessForm(false);
  settingsGeneration++;
  tokenEntries = [];
  renderTokens();
  integrationStatus("#token-status", "");
  loadTokens().catch(error => integrationStatus("#token-status", errorText(error), true));
  $("#server-url").textContent = location.origin;
  copyStatus("#server-url-status", "");
  $("#import-status").textContent = "";
  openDialog("#settings-dialog");
}

async function importFile() {
  const input = $<HTMLInputElement>("#import-file"),
    file = input.files?.[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    $("#import-status").textContent = t("backup.fileTooLarge");
    input.value = "";
    return;
  }
  input.disabled = true;
  $("#import-status").textContent = t("backup.importing");
  try {
    const result = await api<{ imported: number; dashboard_restored: boolean }>("/api/orbia/import", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
    await loadDashboard();
    renderDashboard();
    if (session.mode === "bookmarks") await loadBookmarks();
    $("#import-status").textContent =
      `${t("backup.imported", {count: result.imported})}${result.dashboard_restored ? " " + t("backup.dashboardRestored") : ""}`;
  } catch (error) {
    $("#import-status").textContent = errorText(error);
  } finally {
    input.disabled = false;
    input.value = "";
  }
}

async function copyIntegrationText(text: string) {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Try the selection-based copy when the browser rejects the Clipboard API.
    }
  }

  const focused = document.activeElement;
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.cssText = "position: fixed; top: 0; left: 0; opacity: 0;";
  // A field outside the modal settings dialog cannot receive focus.
  $<HTMLDialogElement>("#settings-dialog").append(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  }
}

export const copyActions = {
  "copy-token": async () => {
    const input = $<HTMLInputElement>("#token-value");
    const copied = await copyIntegrationText(input.value);
    if (!copied) input.select();
    copyStatus("#token-copy-status", t(copied ? "tokens.copied" : "tokens.copyManually"), copied);
  },
  "copy-url": async () => {
    const copied = await copyIntegrationText($("#server-url").textContent ?? "");
    copyStatus("#server-url-status", t(copied ? "tokens.serverCopied" : "tokens.copyServerManually"), copied);
  },
};
$<HTMLInputElement>("#import-file").addEventListener("change", importFile);

export async function refreshUpdateNotice() {
  if (!session.authenticated || document.hidden) return;
  try {
    const response = await fetch("/api/orbia/update");
    if (response.ok) {
      const { available } = await response.json();
      const indicator = $("#settings-update-indicator");
      const settingsButton = $<HTMLButtonElement>("#settings-button");
      const showUpdate = available === true;
      indicator.hidden = !showUpdate;
      $("#update-notice").hidden = !showUpdate;
      if (showUpdate) settingsButton.setAttribute("aria-describedby", indicator.id);
      else settingsButton.removeAttribute("aria-describedby");
    }
  } catch {
    // The update status can be retried without interrupting the current view.
  }
}
document.addEventListener("visibilitychange", refreshUpdateNotice);
setInterval(refreshUpdateNotice, 60_000);
