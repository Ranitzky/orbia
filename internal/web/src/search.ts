import { $, $$, escapeHTML, openDialog } from "./dom";
import { linkTargets } from "./preferences";
import { t } from "./language";
import { errorText, api } from "./api";
import { type Results, type Tag, type Bookmark, searchParams, toggleTag, tagMarkup, host, unreadAttribute } from "./bookmark-data";

let panelBooks: Bookmark[] = [];
let panelSelected = 0;
let panelController: AbortController | undefined;
let panelTimer: number;
let panelSequence = 0;
function clearPanelResults() {
  panelBooks = [];
  $("#panel-results").replaceChildren();
  $("#panel-tags").replaceChildren();
  $("#panel-count").textContent = t("search.loading");
}
export function openSearch(initialQuery = "") {
  clearPanelResults();
  openDialog("#search-dialog");
  const query = $<HTMLInputElement>("#panel-query");
  query.value = initialQuery;
  query.focus();
  query.setSelectionRange(initialQuery.length, initialQuery.length);
  loadPanel();
}
async function loadPanel() {
  clearTimeout(panelTimer);
  panelController?.abort();
  panelController = new AbortController();
  const sequence = ++panelSequence,
    query = $<HTMLInputElement>("#panel-query").value;
  const filters = searchParams(query);
  clearPanelResults();
  $("#panel-count").textContent = t("search.loading");
  try {
    const [data, facets] = await Promise.all([
      api<Results<Bookmark>>(`/api/bookmarks/?${filters}&limit=30`, {
        signal: panelController.signal,
      }),
      api<Results<Tag>>(`/api/orbia/facets?${filters}`, {
        signal: panelController.signal,
      }),
    ]);
    if (sequence !== panelSequence) return;
    panelBooks = data.results;
    panelSelected = 0;
    $("#panel-tags").innerHTML =
      tagMarkup(facets.results, query, true) ||
      `<span class="small muted">${t("search.noTags")}</span>`;
    $("#panel-results").innerHTML =
      data.results
        .map(
          (b, i) =>
            `<a class="panel-result ${i === 0 ? "selected" : ""}" target="${linkTargets["bookmark-target"]}" rel="noopener" href="${escapeHTML(b.url)}" ${unreadAttribute(b)} data-panel-index="${i}"><span class="domain-icon" aria-hidden="true">${escapeHTML(host(b.url)[0]?.toUpperCase())}</span><span class="result-text"><strong>${escapeHTML(b.title || b.url)}</strong><span class="domain">${escapeHTML(host(b.url))}</span></span><span class="tags">${b.tag_names
              .slice(0, 3)
              .map((t) => `<span class="tag-chip">#${escapeHTML(t)}</span>`)
              .join("")}</span></a>`,
        )
        .join("") ||
      `<div class="empty-state">${t("search.noBookmarks")}</div>`;
    $("#panel-count").textContent =
      t(data.count === 1 ? "search.result" : "search.results", { count: data.count });
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError") && sequence === panelSequence) {
      panelBooks = [];
      $("#panel-results").innerHTML =
        `<div class="empty-state">${escapeHTML(errorText(error))}</div>`;
    }
  }
}
function selectPanel(index: number) {
  const length = panelBooks.length;
  if (!length) return;
  panelSelected = (index + length) % length;
  $$(".panel-result").forEach((el, i) =>
    el.classList.toggle("selected", i === panelSelected),
  );
  $$(".panel-result")[panelSelected]?.scrollIntoView({
    block: "nearest",
  });
  $("#panel-count").textContent =
    t("search.position", {
      title: panelBooks[panelSelected].title || panelBooks[panelSelected].url,
      position: panelSelected + 1,
      total: length,
    });
}

$<HTMLInputElement>("#panel-query").addEventListener("input", () => {
  clearPanelResults();
  clearTimeout(panelTimer);
  panelController?.abort();
  panelSequence++;
  panelTimer = setTimeout(loadPanel, 150);
});

$<HTMLDialogElement>("#search-dialog").addEventListener("close", () => {
  clearTimeout(panelTimer);
  panelController?.abort();
  panelSequence++;
});

export function selectPanelTag(tag: string) {
  const query = $<HTMLInputElement>("#panel-query");
  query.value = toggleTag(query.value, tag);
  loadPanel();
  query.focus();
}
export function searchKeydown(event: KeyboardEvent) {
  if (event.target !== $<HTMLInputElement>("#panel-query")) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    selectPanel(panelSelected + (event.key === "ArrowDown" ? 1 : -1));
  }
  if (event.key === "Enter") {
    event.preventDefault();
    $$(".panel-result")[panelSelected]?.click();
  }
}
