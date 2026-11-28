import { $, $$, escapeHTML, icon, toast } from "./dom";
import { preference, readPreference } from "./storage";
import { linkTargets } from "./preferences";
import { t } from "./language";
import { errorText, api } from "./api";
import { session } from "./session";
import { type Results, type Bookmark, type Tag, searchParams, selectedTags, tagMarkup, host, unreadAttribute } from "./bookmark-data";

let queryText = "";
let archived = false;
let unreadOnly = false;
let layout = readPreference("layout", "grid");
let books: Bookmark[] = [];
let totalCount = 0;
let facetsTags: Tag[] = [];
let tagLimit = 40;
export const bookmarkQuery = () => queryText;
export function initialQuery(query: string) { queryText = query; }
export function showAllResults(query: string) {
  queryText = query;
  archived = false;
  unreadOnly = false;
}
let bookmarkController: AbortController | undefined;
let bookmarkTimer: number;
let bookmarkSequence = 0;

function bookCard(b: Bookmark) {
  const domain = host(b.url);
  return `<article class="bookmark-card"><div class="bookmark-card-top"><span class="domain"><span class="domain-icon" aria-hidden="true">${escapeHTML(domain[0]?.toUpperCase() || "B")}</span>${escapeHTML(domain)}</span><button class="icon-button" data-edit-bookmark="${b.id}" aria-label="${escapeHTML(t("common.editNamedItem", {name: b.title || domain}))}">${icon("edit")}</button></div><a class="bookmark-title" target="${linkTargets["bookmark-target"]}" rel="noopener" ${unreadAttribute(b)} href="${escapeHTML(b.url)}">${b.unread ? `<span class="unread-dot" role="img" aria-label="${t("bookmarks.unread")}" title="${t("bookmarks.unread")}"></span>` : ""}${escapeHTML(b.title || b.url)}</a><p class="bookmark-description">${escapeHTML(b.description || b.notes)}</p><div class="tags">${b.tag_names
    .slice(0, 8)
    .map(
      (t) =>
        `<button class="tag-chip" data-bookmark-tag="${escapeHTML(t)}">#${escapeHTML(t)}</button>`,
    )
    .join(
      "",
    )}${b.tag_names.length > 8 ? `<span class="tag-chip">+${b.tag_names.length - 8}</span>` : ""}</div></article>`;
}
function setLayout(value: string) {
  layout = value;
  preference("layout", value);
  $("#bookmarks").classList.toggle("list", value === "list");
  $("#grid-view").setAttribute("aria-pressed", String(value === "grid"));
  $("#list-view").setAttribute("aria-pressed", String(value === "list"));
}
export function renderBookmarks() {
  $("#bookmarks").innerHTML = books.length
    ? books.map(bookCard).join("")
    : `<div class="empty-state">${icon("bookmark")}<p>${queryText || unreadOnly ? t("bookmarks.noMatches") : archived ? t("bookmarks.emptyArchive") : t("bookmarks.emptyLibrary")}</p><p>${queryText || unreadOnly ? t("bookmarks.noMatchesHint") : t("bookmarks.emptyLibraryHint")}</p>${!queryText && !archived && !unreadOnly ? `<button class="button" data-action="new-bookmark">${t("bookmarks.add")}</button>` : ""}</div>`;
  const count = totalCount.toLocaleString(document.documentElement.lang);
  const countKey = archived
    ? (totalCount === 1 ? "bookmarks.archivedCountOne" : "bookmarks.archivedCountOther")
    : (totalCount === 1 ? "bookmarks.countOne" : "bookmarks.countOther");
  $("#bookmark-count").textContent = t(countKey, { count });
  const chosen = selectedTags(queryText),
    names = new Set(facetsTags.map((t) => t.name));
  const tags = [...facetsTags];
  chosen.forEach((name) => {
    if (!names.has(name)) tags.unshift({ name, count: 0 });
  });
  $("#bookmark-tags").innerHTML =
    tagMarkup(tags.slice(0, tagLimit), queryText) +
    (tags.length > tagLimit
      ? `<button class="text-button" data-action="more-tags">${t("bookmarks.moreTags", {count: Math.min(40, tags.length - tagLimit)})}</button>`
      : "") +
    (!tags.length
      ? `<p class="small muted">${t("bookmarks.noTags")}</p>`
      : "");
  $("#load-more").hidden = books.length >= totalCount;
  $("#unread-toggle").setAttribute("aria-pressed", String(unreadOnly));
  $("#archive-toggle").setAttribute("aria-pressed", String(archived));
  setLayout(layout);
}
export async function loadBookmarks(append = false) {
  clearTimeout(bookmarkTimer);
  bookmarkController?.abort();
  bookmarkController = new AbortController();
  const sequence = ++bookmarkSequence;
  const offset = append ? books.length : 0;
  $("#bookmark-count").textContent = t("search.loading");
  $<HTMLButtonElement>("#load-more").disabled = true;
  const filters = searchParams(queryText);
  if (unreadOnly) filters.set("unread", "true");
  const params = new URLSearchParams(filters);
  params.set("limit", "36");
  params.set("offset", String(offset));
  const endpoint = archived ? "archived/" : "";
  try {
    const [data, facets] = await Promise.all([
      api<Results<Bookmark>>(`/api/bookmarks/${endpoint}?${params}`, {
        signal: bookmarkController.signal,
      }),
      api<Results<Tag>>(
        `/api/orbia/facets?${filters}&archived=${archived}`,
        { signal: bookmarkController.signal },
      ),
    ]);
    if (sequence !== bookmarkSequence) return;
    books = append ? [...books, ...data.results] : data.results;
    totalCount = data.count;
    facetsTags = facets.results;
    renderBookmarks();
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError") && sequence === bookmarkSequence) {
      $("#bookmark-count").textContent = errorText(error);
      $("#bookmarks").innerHTML =
        `<div class="empty-state">${t("search.loadFailed")}</div>`;
    }
  } finally {
    if (sequence === bookmarkSequence) $<HTMLButtonElement>("#load-more").disabled = false;
  }
}
export function queryBookmarks(query: string, immediate = true) {
  history.replaceState(
    null,
    "",
    "/bookmarks" + (query ? "?q=" + encodeURIComponent(query) : ""),
  );
  queryText = query;
  tagLimit = 40;
  $<HTMLInputElement>("#bookmark-query").value = query;
  clearTimeout(bookmarkTimer);
  // Abort immediately so an older response cannot overwrite the next keystroke.
  bookmarkController?.abort();
  bookmarkSequence++;
  if (immediate) loadBookmarks();
  else bookmarkTimer = setTimeout(() => loadBookmarks(), 150);
}

export const bookmarkActions = {
  grid: () => setLayout("grid"),
  list: () => setLayout("list"),
  "archive-view": () => {
    archived = !archived;
    loadBookmarks();
  },
  "unread-view": () => {
    unreadOnly = !unreadOnly;
    loadBookmarks();
  },
  "clear-filters": () => {
    unreadOnly = false;
    queryBookmarks("");
  },
  "load-more": () => loadBookmarks(true),
  "more-tags": () => {
    tagLimit += 40;
    renderBookmarks();
  },
};
async function markOpenedBookmark(event: MouseEvent) {
  if (event.defaultPrevented || (event.type === "auxclick" && event.button !== 1)) return;
  if (!(event.target instanceof Element)) return;
  const id = event.target.closest<HTMLElement>("a[data-unread-id]")?.dataset.unreadId;
  if (!id) return;
  try {
    await api(`/api/bookmarks/${id}/`, {
      method: "PATCH", body: JSON.stringify({ unread: false }), keepalive: true,
    });
    const book = books.find(b => String(b.id) === id);
    if (book) book.unread = false;
    for (const link of $$("a[data-unread-id]")) {
      if (link.dataset.unreadId !== id) continue;
      delete link.dataset.unreadId;
      link.querySelector(".unread-dot")?.remove();
    }
    if (session.mode === "bookmarks" && unreadOnly) loadBookmarks();
  } catch (error) {
    toast(errorText(error), true);
  }
}
document.addEventListener("click", markOpenedBookmark);
document.addEventListener("auxclick", markOpenedBookmark);
window.addEventListener("pageshow", event => {
  if (event.persisted && session.mode === "bookmarks") loadBookmarks();
});

$<HTMLInputElement>("#bookmark-query").addEventListener("input", () =>
  queryBookmarks($<HTMLInputElement>("#bookmark-query").value, false),
);
