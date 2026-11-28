import { bindQuicklinkDrag } from "./quicklink-drag";
import { $, $$, escapeHTML, icon } from "./dom";
import { preference, readPreference } from "./storage";
import { linkTargets } from "./preferences";
import { t } from "./language";
import { ApiError, api } from "./api";

interface Quicklink { id: string; name: string; code: string; url: string }
interface Group { id: string; name: string; color: string; links: Quicklink[] }
interface Page { id: string; name: string; groups: Group[] }
interface Dashboard { revision: number; pages: Page[] }

let dashboard: Dashboard;
let pageID = readPreference("page", "home");
let editing = false;
let quick = "";
let saving = false;

export const dashboardPages = () => dashboard.pages;
export const isEditing = () => editing;
export const isSaving = () => saving;
export function clearQuickInput() { quick = ""; }

export function activePage(d = dashboard) {
  return d.pages.find((p) => p.id === pageID) || d.pages[0];
}
export function allLinks() {
  return activePage().groups.flatMap((g) => g.links);
}
function quickMatches() {
  return allLinks().filter((l) => l.code.startsWith(quick));
}
function launchQuicklink(link: Quicklink) {
  quick = "";
  renderQuick();
  document.querySelector<HTMLElement>(`.quicklink[data-link="${CSS.escape(link.id)}"]`)?.click();
}
function updateQuickInput(value: string) {
  quick = value.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (!editing && quick.length === 3) {
    const target = allLinks().find(link => link.code === quick);
    if (target) {
      launchQuicklink(target);
      return;
    }
  }
  renderQuick();
}
export function setPage(id: string) {
  pageID = id;
  preference("page", id);
  quick = "";
  renderDashboard();
}

export async function loadDashboard() {
  dashboard = await api<Dashboard>("/api/orbia/dashboard");
  if (!dashboard.pages.some((p) => p.id === pageID))
    pageID = dashboard.pages[0].id;
}
export async function changeDashboard(change: (dashboard: Dashboard) => void) {
  if (saving) throw new Error(t("errors.saveInProgress"));
  const candidate = structuredClone(dashboard);
  change(candidate);
  saving = true;
  try {
    dashboard = await api<Dashboard>("/api/orbia/dashboard", {
      method: "PUT",
      body: JSON.stringify(candidate),
    });
    renderDashboard();
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      await loadDashboard();
      renderDashboard();
    }
    throw error;
  } finally {
    saving = false;
  }
}
const dashboardGrid = $("#groups");
function updateDashboardFade() {
  const remaining = dashboardGrid.scrollHeight - dashboardGrid.clientHeight - dashboardGrid.scrollTop;
  dashboardGrid.classList.toggle("has-more-below", remaining > 1);
}
const dashboardResize = new ResizeObserver(updateDashboardFade);
dashboardGrid.addEventListener("scroll", updateDashboardFade, { passive: true });

function trackGroupGlow(card: HTMLElement) {
  const motion = matchMedia("(prefers-reduced-motion: no-preference)");
  function reset() {
    card.removeAttribute("data-glow-tracking");
    card.style.removeProperty("--group-pointer-x");
    card.style.removeProperty("--group-pointer-y");
    card.style.removeProperty("--group-pointer-spread");
  }
  function move(event: PointerEvent) {
    if (event.pointerType !== "mouse" || !motion.matches) return;
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return reset();
    card.setAttribute("data-glow-tracking", "");
    card.style.setProperty("--group-pointer-x", `${x * 100}%`);
    card.style.setProperty("--group-pointer-y", `${y * 100}%`);
    // Keep the glow visible along the border as the pointer moves toward the middle.
    const spread = Math.min(event.clientY - rect.top, rect.bottom - event.clientY);
    card.style.setProperty("--group-pointer-spread", `${spread}px`);
  }
  card.addEventListener("pointerenter", move);
  card.addEventListener("pointermove", move);
  card.addEventListener("pointerleave", reset);
  card.addEventListener("pointercancel", reset);
}

export function renderDashboard() {
  const page = activePage();
  $("#page-tabs").innerHTML = dashboard.pages
    .map(
      (p, i) =>
        `<button class="page-tab" role="tab" id="page-${escapeHTML(p.id)}" aria-selected="${p.id === page.id}" tabindex="${p.id === page.id ? 0 : -1}" data-page="${escapeHTML(p.id)}"><span>${String(i + 1).padStart(2, "0")}</span>${escapeHTML(p.name)}</button>`,
    )
    .join("");
  dashboardGrid.innerHTML = page.groups.length
    ? page.groups
        .map(
          (g) =>
            `<section class="group-card" data-group="${escapeHTML(g.id)}" style="--group-color:${escapeHTML(g.color)}" aria-label="${escapeHTML(g.name)}"><div class="group-heading"><h2>${escapeHTML(g.name)}<span>//</span></h2>${editing ? `<button class="icon-button" data-edit-group="${escapeHTML(g.id)}" aria-label="${escapeHTML(t("dashboard.editNamedGroup", {name: g.name}))}">${icon("settings")}</button>` : ""}</div><div class="quicklinks">${g.links.map((l) => `<a class="quicklink" target="${linkTargets["dashboard-target"]}" rel="noopener" href="${escapeHTML(l.url)}" data-link="${escapeHTML(l.id)}" ${editing ? `draggable="false" aria-label="${escapeHTML(t("common.editNamedItem", {name: l.name}))}"` : ""}><span class="quick-code">${escapeHTML(l.code)}</span><span class="quick-name">${escapeHTML(l.name)}</span>${icon(editing ? "edit" : "arrow")}</a>`).join("")}${!g.links.length && !editing ? `<p class="empty-group">${t("dashboard.emptyGroup")}</p>` : ""}</div>${editing ? `<button class="group-add" data-add-to="${escapeHTML(g.id)}">${t("dashboard.addQuicklinkToGroup")}</button>` : ""}</section>`,
        )
        .join("")
    : `<div class="empty-state">${icon("grid")}<p>${t("dashboard.emptyPage")}</p><button class="button" data-action="new-group">${t("dashboard.addFirstGroup")}</button></div>`;
  $("#edit-bar").hidden = !editing;
  $("#dashboard-toolbar").hidden =
    dashboard.pages.length === 1 && !editing;
  dashboardResize.disconnect();
  dashboardResize.observe(dashboardGrid);
  for (const card of dashboardGrid.children) {
    dashboardResize.observe(card);
    if (card instanceof HTMLElement && page.groups.length) trackGroupGlow(card);
  }
  renderQuick();
}
function renderQuick() {
  const matches = quickMatches(),
    ids = new Set(matches.map((l) => l.id));
  $$(".quicklink").forEach((link) => {
    link.classList.toggle(
      "dimmed",
      !!quick && !ids.has(link.dataset.link ?? ""),
    );
    link.classList.toggle(
      "matched",
      !!quick && ids.has(link.dataset.link ?? ""),
    );
  });
  const el = $("#quick-status");
  if (!quick) {
    el.replaceChildren();
    return;
  }
  const chosen = matches.length === 1 ? matches[0] : null;
  el.innerHTML = `<span class="query-display">${escapeHTML(quick)}</span><div class="quick-preview">${chosen ? `${escapeHTML(chosen.name)}<span>${escapeHTML(chosen.url)}</span>` : `${matches.length ? t("dashboard.matchingQuicklinks", {count: matches.length}) : t("dashboard.noMatchingCode")}<span>${matches.length ? t("dashboard.narrowCodeSearch") : t("dashboard.clearCodeSearch")}</span>`}</div>${chosen ? `<kbd>${t("dashboard.openQuicklink")}</kbd>` : "<kbd>esc</kbd>"}`;
}

bindQuicklinkDrag(dashboardGrid, () => editing && !saving, (fromID, toID, linkID, beforeID) =>
  changeDashboard(candidate => {
    const groups = activePage(candidate).groups;
    const from = groups.find(g => g.id === fromID);
    const to = groups.find(g => g.id === toID);
    if (!from || !to) return;
    const sourceIndex = from.links.findIndex(link => link.id === linkID);
    if (sourceIndex < 0) return;
    const [link] = from.links.splice(sourceIndex, 1);
    const destination = to.links.findIndex(link => link.id === beforeID);
    to.links.splice(destination < 0 ? to.links.length : destination, 0, link);
  }),
);

export function toggleDashboardEditing() {
  editing = !editing;
  quick = "";
}
$("#page-tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const pages = dashboard.pages,
    index = pages.findIndex((p) => p.id === pageID);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? pages.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + pages.length) %
          pages.length;
  setPage(pages[next].id);
  $$(".page-tab")[next]?.focus();
});

export function dashboardKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    quick = "";
    renderQuick();
    return;
  }
  if (event.key === "Backspace" && quick) {
    event.preventDefault();
    quick = quick.slice(0, -1);
    renderQuick();
    return;
  }
  if (event.key === "Enter" && quick && !editing) {
    event.preventDefault();
    const matches = quickMatches();
    if (matches.length === 1) launchQuicklink(matches[0]);
    return;
  }
  if (!quick && /^[1-9]$/.test(event.key)) {
    const page = dashboard.pages[Number(event.key) - 1];
    if (page) {
      event.preventDefault();
      setPage(page.id);
    }
    return;
  }
  if (/^[a-z0-9]$/i.test(event.key) && !editing) {
    event.preventDefault();
    if (quick.length < 3) {
      updateQuickInput(quick + event.key);
    }
  }
}
