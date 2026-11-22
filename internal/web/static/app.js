const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const uid = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((n) => n.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const readPreference = (key, fallback) => {
  try {
    return localStorage.getItem(`orbia.${key}`) || fallback;
  } catch {
    return fallback;
  }
};
const preference = (key, value) => {
  try {
    localStorage.setItem(`orbia.${key}`, value);
  } catch {
    /* Preferences are optional in private browsing. */
  }
};
const defaultLanguage = "en";
const languageCatalogs = {
  de: () => import("./de.js?v=3"),
  en: () => import("./en.js?v=18"),
};
let messages = {};

function t(key, values) {
  const text = messages[key] ?? key;
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (_, name) => values[name]);
}

function translateShell() {
  for (const el of $$("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const attr of ["aria-label", "placeholder", "content"]) {
    const keyAttr = `data-i18n-${attr}`;
    for (const el of $$(`[${keyAttr}]`)) {
      el.setAttribute(attr, t(el.getAttribute(keyAttr)));
    }
  }
}

async function setLanguage(lang, persist = false) {
  const select = $("#language");
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
  renderTokens();
  if (persist) preference("language", lang);
  theme(document.documentElement.dataset.theme);
  if (state.authenticated) {
    if (state.mode === "bookmarks") renderBookmarks();
    else renderDashboard();
  }
  $("#import-status").textContent = "";
  $("#toast").hidden = true;
  return true;
}
const state = {
  dashboard: null,
  page: readPreference("page", "home"),
  mode: "dashboard",
  edit: false,
  quick: "",
  query: "",
  archived: false,
  unreadOnly: false,
  layout: readPreference("layout", "grid"),
  books: [],
  count: 0,
  tags: [],
  tagLimit: 40,
  panelBooks: [],
  panelSelected: 0,
  commands: [],
  commandSelected: 0,
  saving: false,
  authenticated: false,
};
const linkTargets = {};
for (const [key, selector] of [["dashboard-target", ".quicklink"], ["bookmark-target", ".bookmark-title, .panel-result"]]) {
  const select = document.getElementById(key);
  linkTargets[key] = readPreference(key, "_self") === "_blank" ? "_blank" : "_self";
  select.value = linkTargets[key];
  select.addEventListener("change", () => {
    linkTargets[key] = select.value;
    preference(key, select.value);
    for (const link of $$(selector)) link.target = select.value;
  });
}
let toastTimer;
function toast(message, error = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("error", error);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      el.hidden = true;
    },
    error ? 7000 : 3500,
  );
}
function errorMessage(status, data) {
  if (status === 401) return t("errors.signInRequired");
  if (status === 409)
    return t("errors.staleDashboard");
  if (status === 413)
    return t("errors.payloadTooLarge");
  if (status === 429) return t("errors.rateLimited");
  if (status === 500) return t("errors.server");
  const field = Object.keys(data || {})[0];
  return t(
    {
      url: "errors.invalidUrl",
      code: "errors.invalidCode",
      tag_names:
        "errors.invalidTags",
      title: "errors.invalidTitle",
      name: "errors.invalidName",
      pages: "errors.pageLimit",
      groups: "errors.groupLimit",
      q: "errors.invalidSearch",
      file: "errors.invalidImportFile",
    }[field] ||
    "errors.invalidRequest"
  );
}
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(
      t("errors.connection"),
    );
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && !path.startsWith("/auth/")) {
      const refreshAccess = state.authenticated;
      showLogin();
      if (refreshAccess) void start();
    }
    let message = errorMessage(response.status, data);
    if (path === pullPath) {
      if (response.status === 400) message = t("linkding.invalidCredentials");
      if (response.status === 422) message = t("linkding.localHttpOnly");
      if (response.status === 409) message = t("linkding.importAlreadyRunning");
      if (response.status === 502) {
        message = t("linkding.importInterrupted");
      }
      if (Number.isInteger(data.changed)) message += " " + t("linkding.importSummary", data);
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}
function showLogin() {
  state.authenticated = false;
  $("#setup-screen").hidden = true;
  closeDialogs();
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#password").focus();
}
function theme(value) {
  document.documentElement.dataset.theme = value;
  preference("theme", value);
  $('meta[name="theme-color"]').content =
    value === "dark" ? "#090f12" : "#f2f6f7";
  $("#theme-label").textContent =
    value === "dark"
      ? t("theme.switchToLight")
      : t("theme.switchToDark");
}
document.documentElement.dataset.theme = readPreference("theme", "dark");
// Keep the bottom search panel above the on-screen keyboard on mobile browsers.
if (window.visualViewport) {
  const updateViewport = () => {
    const viewport = window.visualViewport;
    document.documentElement.style.setProperty(
      "--visual-height",
      `${viewport.height}px`,
    );
    document.documentElement.style.setProperty(
      "--keyboard-inset",
      `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`,
    );
  };
  window.visualViewport.addEventListener("resize", updateViewport);
  window.visualViewport.addEventListener("scroll", updateViewport);
  updateViewport();
}
function toggleTheme() {
  theme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}
function closeDialogs() {
  $$("dialog[open]").forEach((dialog) => dialog.close());
}
function openDialog(id) {
  closeDialogs();
  $(id).showModal();
}
function activePage(d = state.dashboard) {
  return d.pages.find((p) => p.id === state.page) || d.pages[0];
}
function allLinks() {
  return activePage().groups.flatMap((g) => g.links);
}
function quickMatches() {
  return allLinks().filter((l) => l.code.startsWith(state.quick));
}
function launchQuicklink(link) {
  state.quick = "";
  renderQuick();
  $(`.quicklink[data-link="${CSS.escape(link.id)}"]`)?.click();
}
function updateQuickInput(value) {
  state.quick = value.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (!state.edit && state.quick.length === 3) {
    const target = allLinks().find(link => link.code === state.quick);
    if (target) {
      launchQuicklink(target);
      return;
    }
  }
  renderQuick();
}
function setPage(id) {
  state.page = id;
  preference("page", id);
  state.quick = "";
  renderDashboard();
}
function setMode(mode) {
  state.mode = mode;
  state.quick = "";
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
  $$(".mobile-nav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.action === mode),
  );
  history.replaceState(
    null,
    "",
    mode === "bookmarks"
      ? "/bookmarks" +
          (state.query ? "?q=" + encodeURIComponent(state.query) : "")
      : "/",
  );
  if (mode === "bookmarks") {
    $("#bookmark-query").value = state.query;
    loadBookmarks();
  } else renderDashboard();
}
async function loadDashboard() {
  state.dashboard = await api("/api/orbia/dashboard");
  if (!state.dashboard.pages.some((p) => p.id === state.page))
    state.page = state.dashboard.pages[0].id;
}
async function changeDashboard(change) {
  if (state.saving) throw new Error(t("errors.saveInProgress"));
  const candidate = structuredClone(state.dashboard);
  change(candidate);
  state.saving = true;
  try {
    state.dashboard = await api("/api/orbia/dashboard", {
      method: "PUT",
      body: JSON.stringify(candidate),
    });
    renderDashboard();
  } catch (error) {
    if (error.status === 409) {
      await loadDashboard();
      renderDashboard();
    }
    throw error;
  } finally {
    state.saving = false;
  }
}
function renderDashboard() {
  const page = activePage();
  $("#page-tabs").innerHTML = state.dashboard.pages
    .map(
      (p, i) =>
        `<button class="page-tab" role="tab" id="page-${escapeHTML(p.id)}" aria-selected="${p.id === page.id}" tabindex="${p.id === page.id ? 0 : -1}" data-page="${escapeHTML(p.id)}"><span>${String(i + 1).padStart(2, "0")}</span>${escapeHTML(p.name)}</button>`,
    )
    .join("");
  $("#groups").innerHTML = page.groups.length
    ? page.groups
        .map(
          (g) =>
            `<section class="group-card" data-group="${escapeHTML(g.id)}" style="--group-color:${escapeHTML(g.color)}" aria-label="${escapeHTML(g.name)}"><div class="group-heading"><h2>${escapeHTML(g.name)}<span>//</span></h2>${state.edit ? `<button class="icon-button" data-edit-group="${escapeHTML(g.id)}" aria-label="${escapeHTML(t("dashboard.editNamedGroup", {name: g.name}))}">${icon("settings")}</button>` : ""}</div><div class="quicklinks">${g.links.map((l) => `<a class="quicklink" target="${linkTargets["dashboard-target"]}" rel="noopener" href="${escapeHTML(l.url)}" data-link="${escapeHTML(l.id)}" ${state.edit ? `draggable="false" aria-label="${escapeHTML(t("common.editNamedItem", {name: l.name}))}"` : ""}><span class="quick-code">${escapeHTML(l.code)}</span><span class="quick-name">${escapeHTML(l.name)}</span>${icon(state.edit ? "edit" : "arrow")}</a>`).join("")}${!g.links.length && !state.edit ? `<p class="empty-group">${t("dashboard.emptyGroup")}</p>` : ""}</div>${state.edit ? `<button class="group-add" data-add-to="${escapeHTML(g.id)}">${t("dashboard.addQuicklinkToGroup")}</button>` : ""}</section>`,
        )
        .join("")
    : `<div class="empty-state">${icon("grid")}<p>${t("dashboard.emptyPage")}</p><button class="button" data-action="new-group">${t("dashboard.addFirstGroup")}</button></div>`;
  $("#edit-bar").hidden = !state.edit;
  $("#dashboard-toolbar").hidden =
    state.dashboard.pages.length === 1 && !state.edit;
  renderQuick();
}
function renderQuick() {
  const matches = quickMatches(),
    ids = new Set(matches.map((l) => l.id));
  $$(".quicklink").forEach((link) => {
    link.classList.toggle(
      "dimmed",
      !!state.quick && !ids.has(link.dataset.link),
    );
    link.classList.toggle(
      "matched",
      !!state.quick && ids.has(link.dataset.link),
    );
  });
  const el = $("#quick-status");
  if (!state.quick) {
    el.replaceChildren();
    return;
  }
  const chosen = matches.length === 1 ? matches[0] : null;
  el.innerHTML = `<span class="query-display">${escapeHTML(state.quick)}</span><div class="quick-preview">${chosen ? `${escapeHTML(chosen.name)}<span>${escapeHTML(chosen.url)}</span>` : `${matches.length ? t("dashboard.matchingQuicklinks", {count: matches.length}) : t("dashboard.noMatchingCode")}<span>${matches.length ? t("dashboard.narrowCodeSearch") : t("dashboard.clearCodeSearch")}</span>`}</div>${chosen ? `<kbd>${t("dashboard.openQuicklink")}</kbd>` : "<kbd>esc</kbd>"}`;
}
// Track movement only for the duration of a drag. Link arrays change once, on drop.
$("#groups").addEventListener("pointerdown", (start) => {
  if (!state.edit || state.saving || !start.isPrimary || start.button !== 0) return;
  const row = start.target.closest(".quicklink");
  if (!row || (start.pointerType !== "mouse" && !start.target.closest(".quick-code"))) return;
  const source = row.closest(".group-card");
  const session = new AbortController();
  const options = { signal: session.signal };
  let x = start.clientX, y = start.clientY, dragging = false, frame = 0;
  let marker, edge;

  function mark(element, position) {
    if (marker === element && edge === position) return;
    marker?.removeAttribute("data-drop");
    marker = element;
    edge = position;
    if (marker) marker.dataset.drop = position;
  }
  function targetAtPointer() {
    const hit = document.elementFromPoint(x, y);
    const group = hit?.closest("#groups .group-card");
    if (!group) return {};
    const link = hit.closest(".quicklink");
    if (!link) {
      const first = hit.closest(".group-heading") && group.querySelector(".quicklink");
      return first ? { group, element: first, position: "before" } : { group, element: group, position: "end" };
    }
    const rect = link.getBoundingClientRect();
    return { group, element: link, position: y < rect.top + rect.height / 2 ? "before" : "after" };
  }
  function paint() {
    frame = 0;
    if (!row.isConnected || state.mode !== "dashboard") return cancel();
    const target = targetAtPointer();
    mark(target.element, target.position);
    const speed = y < 52 ? -12 : y > innerHeight - 52 ? 12 : 0;
    if (speed) {
      const previous = scrollY;
      window.scrollBy(0, speed);
      if (scrollY !== previous) frame = requestAnimationFrame(paint);
    }
  }
  function cancel() {
    session.abort();
    cancelAnimationFrame(frame);
    mark(null);
    row.classList.remove("dragging");
    if (row.hasPointerCapture(start.pointerId)) row.releasePointerCapture(start.pointerId);
  }
  row.setPointerCapture(start.pointerId);
  row.addEventListener("pointermove", event => {
    if (event.pointerId !== start.pointerId) return;
    x = event.clientX;
    y = event.clientY;
    if (!dragging) {
      if (Math.hypot(x - start.clientX, y - start.clientY) < 6) return;
      dragging = true;
      row.classList.add("dragging");
    }
    if (!frame) frame = requestAnimationFrame(paint);
  }, options);
  row.addEventListener("lostpointercapture", cancel, options);
  row.addEventListener("pointercancel", cancel, options);
  row.addEventListener("pointerup", event => {
    if (event.pointerId !== start.pointerId) return;
    x = event.clientX;
    y = event.clientY;
    const target = dragging && targetAtPointer();
    cancel();
    if (!dragging) return;
    // A completed pointer gesture can still synthesize an edit click.
    const swallow = click => { click.preventDefault(); click.stopImmediatePropagation(); };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    if (!target.group) return;
    const before = target.position === "before" ? target.element :
      target.position === "after" ? target.element.nextElementSibling : null;
    if (target.group === source && (before === row || before === row.nextElementSibling)) return;
    changeDashboard(d => {
      const groups = activePage(d).groups;
      const from = groups.find(g => g.id === source.dataset.group);
      const to = groups.find(g => g.id === target.group.dataset.group);
      const [link] = from.links.splice(from.links.findIndex(l => l.id === row.dataset.link), 1);
      const index = before ? to.links.findIndex(l => l.id === before.dataset.link) : to.links.length;
      to.links.splice(index, 0, link);
    }).catch(error => toast(error.message, true));
  }, options);
});

function toggleEdit() {
  state.edit = !state.edit;
  state.quick = "";
  if (state.mode !== "dashboard") setMode("dashboard");
  else renderDashboard();
}

let bookmarkController,
  bookmarkTimer,
  bookmarkSequence = 0;
// Only the last unfinished hashtag is a prefix. Earlier tags are exact filters.
function searchParams(query) {
  const fragment = /(?:^|\s)#([^\s#"]*)$/u.exec(query);
  const params = new URLSearchParams({q: fragment ? query.slice(0, fragment.index) : query});
  if (fragment) params.set("tag_prefix", fragment[1]);
  return params;
}
const selectedTags = (query) =>
  new Set((searchParams(query).get("q").match(/#[^\s]+/g) || []).map(t => t.slice(1).toLowerCase()));
function toggleTag(query, name) {
  const params = searchParams(query);
  const terms = params.get("q").match(/"[^"]*"|\S+/g) || [];
  const value = `#${name}`;
  const found = terms.findIndex(t => t.toLowerCase() === value.toLowerCase());
  if (found >= 0) terms.splice(found, 1);
  else terms.push(value);
  return terms.length ? terms.join(" ") + " " : "";
}
function tagMarkup(tags, query, panel = false) {
  const selected = selectedTags(query);
  return tags
    .map((t) =>
      panel
        ? `<button class="tag-chip" data-panel-tag="${escapeHTML(t.name)}" aria-pressed="${selected.has(t.name)}">#${escapeHTML(t.name)}</button>`
        : `<button class="tag-item" data-bookmark-tag="${escapeHTML(t.name)}" aria-pressed="${selected.has(t.name)}"><span>#${escapeHTML(t.name)}</span><span>${t.count || 0}</span></button>`,
    )
    .join("");
}
function host(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
function unreadAttribute(book) {
  return book.unread ? `data-unread-id="${book.id}"` : "";
}
function bookCard(b) {
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
function setLayout(value) {
  state.layout = value;
  preference("layout", value);
  $("#bookmarks").classList.toggle("list", value === "list");
  $("#grid-view").setAttribute("aria-pressed", String(value === "grid"));
  $("#list-view").setAttribute("aria-pressed", String(value === "list"));
}
function renderBookmarks() {
  $("#bookmarks").innerHTML = state.books.length
    ? state.books.map(bookCard).join("")
    : `<div class="empty-state">${icon("bookmark")}<p>${state.query || state.unreadOnly ? t("bookmarks.noMatches") : state.archived ? t("bookmarks.emptyArchive") : t("bookmarks.emptyLibrary")}</p><p>${state.query || state.unreadOnly ? t("bookmarks.noMatchesHint") : t("bookmarks.emptyLibraryHint")}</p>${!state.query && !state.archived && !state.unreadOnly ? `<button class="button" data-action="new-bookmark">${t("bookmarks.add")}</button>` : ""}</div>`;
  const count = state.count.toLocaleString(document.documentElement.lang);
  const countKey = state.archived
    ? (state.count === 1 ? "bookmarks.archivedCountOne" : "bookmarks.archivedCountOther")
    : (state.count === 1 ? "bookmarks.countOne" : "bookmarks.countOther");
  $("#bookmark-count").textContent = t(countKey, { count });
  const chosen = selectedTags(state.query),
    names = new Set(state.tags.map((t) => t.name));
  const tags = [...state.tags];
  chosen.forEach((name) => {
    if (!names.has(name)) tags.unshift({ name, count: 0 });
  });
  $("#bookmark-tags").innerHTML =
    tagMarkup(tags.slice(0, state.tagLimit), state.query) +
    (tags.length > state.tagLimit
      ? `<button class="text-button" data-action="more-tags">${t("bookmarks.moreTags", {count: Math.min(40, tags.length - state.tagLimit)})}</button>`
      : "") +
    (!tags.length
      ? `<p class="small muted">${t("bookmarks.noTags")}</p>`
      : "");
  $("#load-more").hidden = state.books.length >= state.count;
  $("#unread-toggle").setAttribute("aria-pressed", String(state.unreadOnly));
  $("#archive-toggle").setAttribute("aria-pressed", String(state.archived));
  setLayout(state.layout);
}
async function loadBookmarks(append = false) {
  clearTimeout(bookmarkTimer);
  bookmarkController?.abort();
  bookmarkController = new AbortController();
  const sequence = ++bookmarkSequence;
  const offset = append ? state.books.length : 0;
  $("#bookmark-count").textContent = t("search.loading");
  $("#load-more").disabled = true;
  const filters = searchParams(state.query);
  if (state.unreadOnly) filters.set("unread", "true");
  const params = new URLSearchParams(filters);
  params.set("limit", "36");
  params.set("offset", String(offset));
  const endpoint = state.archived ? "archived/" : "";
  try {
    const [data, facets] = await Promise.all([
      api(`/api/bookmarks/${endpoint}?${params}`, {
        signal: bookmarkController.signal,
      }),
      api(
        `/api/orbia/facets?${filters}&archived=${state.archived}`,
        { signal: bookmarkController.signal },
      ),
    ]);
    if (sequence !== bookmarkSequence) return;
    state.books = append ? [...state.books, ...data.results] : data.results;
    state.count = data.count;
    state.tags = facets.results;
    renderBookmarks();
  } catch (error) {
    if (error.name !== "AbortError" && sequence === bookmarkSequence) {
      $("#bookmark-count").textContent = error.message;
      $("#bookmarks").innerHTML =
        `<div class="empty-state">${t("search.loadFailed")}</div>`;
    }
  } finally {
    if (sequence === bookmarkSequence) $("#load-more").disabled = false;
  }
}
function queryBookmarks(query, immediate = true) {
  history.replaceState(
    null,
    "",
    "/bookmarks" + (query ? "?q=" + encodeURIComponent(query) : ""),
  );
  state.query = query;
  state.tagLimit = 40;
  $("#bookmark-query").value = query;
  clearTimeout(bookmarkTimer);
  // Abort immediately so an older response cannot overwrite the next keystroke.
  bookmarkController?.abort();
  bookmarkSequence++;
  if (immediate) loadBookmarks();
  else bookmarkTimer = setTimeout(() => loadBookmarks(), 150);
}

let panelController,
  panelTimer,
  panelSequence = 0;
function clearPanelResults() {
  state.panelBooks = [];
  $("#panel-results").replaceChildren();
  $("#panel-tags").replaceChildren();
  $("#panel-count").textContent = t("search.loading");
}
function openSearch() {
  clearPanelResults();
  openDialog("#search-dialog");
  $("#panel-query").value = "";
  $("#panel-query").focus();
  loadPanel();
}
async function loadPanel() {
  clearTimeout(panelTimer);
  panelController?.abort();
  panelController = new AbortController();
  const sequence = ++panelSequence,
    query = $("#panel-query").value;
  const filters = searchParams(query);
  clearPanelResults();
  $("#panel-count").textContent = t("search.loading");
  try {
    const [data, facets] = await Promise.all([
      api(`/api/bookmarks/?${filters}&limit=30`, {
        signal: panelController.signal,
      }),
      api(`/api/orbia/facets?${filters}`, {
        signal: panelController.signal,
      }),
    ]);
    if (sequence !== panelSequence) return;
    state.panelBooks = data.results;
    state.panelSelected = 0;
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
    if (error.name !== "AbortError" && sequence === panelSequence) {
      state.panelBooks = [];
      $("#panel-results").innerHTML =
        `<div class="empty-state">${escapeHTML(error.message)}</div>`;
    }
  }
}
function selectPanel(index) {
  const length = state.panelBooks.length;
  if (!length) return;
  state.panelSelected = (index + length) % length;
  $$(".panel-result").forEach((el, i) =>
    el.classList.toggle("selected", i === state.panelSelected),
  );
  $$(".panel-result")[state.panelSelected]?.scrollIntoView({
    block: "nearest",
  });
  $("#panel-count").textContent =
    t("search.position", {
      title: state.panelBooks[state.panelSelected].title || state.panelBooks[state.panelSelected].url,
      position: state.panelSelected + 1,
      total: length,
    });
}

function availableCommands() {
  return [
    {
      label: t("commands.openDashboard"),
      icon: "grid",
      key: "1–9",
      run: () => setMode("dashboard"),
    },
    {
      label: t("commands.openBookmarks"),
      icon: "bookmark",
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
      key: state.mode === "dashboard" ? "+" : "",
      run: () => editLink(),
    },
    { label: t("bookmarks.add"), icon: "plus", key: state.mode === "bookmarks" ? "+" : "", run: () => editBookmark() },
    {
      label: state.edit ? t("dashboard.finishEditing") : t("dashboard.edit"),
      icon: "edit",
      key: "⌘ E",
      run: toggleEdit,
    },
    ...state.dashboard.pages.map((p, i) => ({
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
function openCommands() {
  openDialog("#command-dialog");
  $("#command-query").value = "";
  renderCommands();
  $("#command-query").focus();
}
function renderCommands() {
  const value = $("#command-query").value.toLocaleLowerCase(document.documentElement.lang);
  state.commands = availableCommands().filter((c) =>
    c.label.toLocaleLowerCase(document.documentElement.lang).includes(value),
  );
  state.commandSelected = 0;
  $("#commands").innerHTML =
    `<p class="command-group">${t("commands.groupTitle")}</p>` +
    (state.commands
      .map(
        (c, i) =>
          `<button class="command-item ${i === 0 ? "selected" : ""}" data-command="${i}">${icon(c.icon)}<span>${escapeHTML(c.label)}</span>${c.key ? `<kbd>${c.key}</kbd>` : ""}</button>`,
      )
      .join("") || `<p class="empty-state">${t("commands.noMatches")}</p>`);
}
function selectCommand(index) {
  if (!state.commands.length) return;
  state.commandSelected =
    (index + state.commands.length) % state.commands.length;
  $$(".command-item").forEach((el, i) =>
    el.classList.toggle("selected", i === state.commandSelected),
  );
  $$(".command-item")[state.commandSelected]?.scrollIntoView({
    block: "nearest",
  });
  $("#command-status").textContent =
    state.commands[state.commandSelected].label;
}
function runCommand(index) {
  const command = state.commands[index];
  if (command) {
    $("#command-dialog").close();
    command.run();
  }
}

let editorSave, editorDelete;
const inputField = (name, label, value = "", options = "") =>
  `<label for="field-${name}">${label}<input id="field-${name}" name="${name}" value="${escapeHTML(value)}" ${options}></label>`;
const textareaField = (name, label, value = "", max = 100000) =>
  `<label for="field-${name}">${label}<textarea id="field-${name}" name="${name}" maxlength="${max}">${escapeHTML(value)}</textarea></label>`;
function editor(title, fields, save, remove) {
  $("#editor-title").textContent = title;
  $("#editor-fields").innerHTML = fields;
  $("#editor-error").textContent = "";
  $("#delete-button").hidden = !remove;
  $("#delete-confirm").hidden = true;
  $("#save-button").disabled = false;
  editorSave = save;
  editorDelete = remove;
  openDialog("#editor-dialog");
  $(
    "#editor-fields input, #editor-fields textarea, #editor-fields select",
  )?.focus();
}
async function saveEditor(event) {
  event.preventDefault();
  if (state.saving) return;
  const button = $("#save-button");
  button.disabled = true;
  $("#editor-error").textContent = "";
  try {
    await editorSave(new FormData($("#editor-form")));
    $("#editor-dialog").close();
    toast(t("editor.saved"));
  } catch (error) {
    $("#editor-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}
function editLink(id, groupID) {
  const page = activePage(),
    group = page.groups.find((g) => g.links.some((l) => l.id === id));
  const link = group?.links.find((l) => l.id === id);
  groupID = group?.id || groupID || page.groups[0]?.id;
  if (!page.groups.length) {
    toast(t("dashboard.groupRequired"));
    editGroup();
    return;
  }
  const fields =
    inputField(
      "name",
      t("editor.name"),
      link?.name,
      'required maxlength="200" autocomplete="off" data-1p-ignore',
    ) +
    `<div class="form-row">${inputField("code", t("dashboard.code"), link?.code, 'required pattern="[A-Za-z0-9]{3}" minlength="3" maxlength="3" placeholder="IMM" autocomplete="off" style="text-transform:uppercase"')}<label for="field-group">${t("dashboard.group")}<select name="group" id="field-group">${page.groups.map((g) => `<option value="${escapeHTML(g.id)}" ${g.id === groupID ? "selected" : ""}>${escapeHTML(g.name)}</option>`).join("")}</select></label></div>` +
    inputField(
      "url",
      t("dashboard.destinationUrl"),
      link?.url,
      'type="url" required placeholder="https://immich.example.com" autocomplete="url"',
    ) +
    `<p class="field-hint">${t("dashboard.codeHint")}</p>`;
  editor(
    link ? t("dashboard.editQuicklink") : t("dashboard.newQuicklink"),
    fields,
    async (form) => {
      const code = form.get("code").toUpperCase(),
        name = form.get("name").trim();
      if (!name) throw new Error(t("editor.nameRequired"));
      if (allLinks().some((l) => l.code === code && l.id !== id))
        throw new Error(t("dashboard.duplicateCode"));
      await changeDashboard((d) => {
        const groups = activePage(d).groups;
        const target = groups.find((g) => g.id === form.get("group"));
        const entry = {
          id: id || uid(),
          name,
          code,
          url: form.get("url").trim(),
        };
        const index = target.links.findIndex((l) => l.id === id);
        if (index >= 0) target.links[index] = entry;
        else {
          for (const group of groups)
            group.links = group.links.filter((l) => l.id !== id);
          target.links.push(entry);
        }
      });
    },
    link
      ? async () =>
          changeDashboard((d) => {
            activePage(d).groups.forEach((g) => {
              g.links = g.links.filter((l) => l.id !== id);
            });
          })
      : null,
  );
}
function editGroup(id) {
  const page = activePage(),
    group = page.groups.find((g) => g.id === id);
  if (!group && page.groups.length >= 6) {
    toast(t("dashboard.groupLimit"), true);
    return;
  }
  const colors = [
    "#36d8d3",
    "#88d9ae",
    "#8abcf4",
    "#bb9ae9",
    "#e9cf81",
    "#ec91b7",
  ];
  editor(
    group ? t("dashboard.editGroup") : t("dashboard.newGroup"),
    inputField("name", t("editor.name"), group?.name, 'required maxlength="80" data-1p-ignore') +
      `<div class="form-row"><label for="field-color">${t("dashboard.accentColor")}<input id="field-color" name="color" type="color" value="${group?.color || colors[page.groups.length]}" required></label><label for="field-position">${t("editor.position")}<select id="field-position" name="position">${Array.from({ length: group ? page.groups.length : page.groups.length + 1 }, (_, i) => `<option value="${i}" ${i === (group ? page.groups.indexOf(group) : page.groups.length) ? "selected" : ""}>${i + 1}</option>`).join("")}</select></label></div>` +
      (group
        ? `<p class="field-hint">${t("dashboard.deleteGroupWarning", {count: group.links.length})}</p>`
        : ""),
    async (form) => {
      if (!form.get("name").trim())
        throw new Error(t("editor.nameRequired"));
      await changeDashboard((d) => {
        const p = activePage(d),
          old = p.groups.find((g) => g.id === id);
        p.groups = p.groups.filter((g) => g.id !== id);
        p.groups.splice(Number(form.get("position")), 0, {
          id: id || uid(),
          name: form.get("name").trim(),
          color: form.get("color"),
          links: old?.links || [],
        });
      });
    },
    group
      ? async () =>
          changeDashboard((d) => {
            const p = activePage(d);
            p.groups = p.groups.filter((g) => g.id !== id);
          })
      : null,
  );
}
function editPage(create) {
  if (create && state.dashboard.pages.length >= 9) {
    toast(t("dashboard.pageLimit"));
    return;
  }
  const page = activePage(),
    newID = uid();
  editor(
    create ? t("dashboard.addDashboardPage") : t("dashboard.editDashboardPage"),
    inputField(
      "name",
      t("editor.name"),
      create ? "" : page.name,
      `required maxlength="80" placeholder="${t("dashboard.pageNamePlaceholder")}" data-1p-ignore`,
    ) +
      `<p class="field-hint">${create ? t("dashboard.newPageHint") : t("dashboard.editPageHint")}</p>`,
    async (form) => {
      const name = form.get("name").trim();
      if (!name) throw new Error(t("editor.nameRequired"));
      await changeDashboard((d) => {
        if (create) d.pages.push({ id: newID, name, groups: [] });
        else activePage(d).name = name;
      });
      if (create) setPage(newID);
      setMode("dashboard");
    },
    !create && state.dashboard.pages.length > 1
      ? async () => {
          await changeDashboard((d) => {
            d.pages = d.pages.filter((p) => p.id !== page.id);
          });
          setPage(state.dashboard.pages[0].id);
        }
      : null,
  );
}
async function editBookmark(id) {
  let b;
  try {
    if (id) b = await api(`/api/bookmarks/${id}/`);
  } catch (error) {
    toast(error.message, true);
    return;
  }
  editor(
    b ? t("bookmarks.edit") : t("bookmarks.new"),
    inputField(
      "url",
      t("bookmarks.url"),
      b?.url,
      'type="url" required autocomplete="url" placeholder="https://"',
    ) +
      inputField(
        "title",
        t("bookmarks.title"),
        b?.title,
        `maxlength="512" placeholder="${t("bookmarks.titlePlaceholder")}" data-1p-ignore`,
      ) +
      textareaField("description", t("bookmarks.description"), b?.description) +
      inputField(
        "tags",
        t("bookmarks.tags"),
        b?.tag_names.join(", "),
        `placeholder="${t("bookmarks.tagsPlaceholder")}" data-1p-ignore`,
      ) +
      textareaField("notes", t("bookmarks.notes"), b?.notes, 500000) +
      `<div class="form-row"><label for="field-archived">${t("bookmarks.status")}<select aria-label="${t("bookmarks.status")}" name="archived" id="field-archived"><option value="false">${t("bookmarks.saved")}</option><option value="true" ${b?.is_archived ? "selected" : ""}>${t("bookmarks.archived")}</option></select></label><label for="field-unread">${t("bookmarks.readStatus")}<select aria-label="${t("bookmarks.readStatus")}" name="unread" id="field-unread"><option value="false">${t("bookmarks.read")}</option><option value="true" ${b?.unread ? "selected" : ""}>${t("bookmarks.unread")}</option></select></label></div>`,
    async (form) => {
      const payload = {
        url: form.get("url").trim(),
        title: form.get("title").trim(),
        description: form.get("description"),
        notes: form.get("notes"),
        tag_names: form
          .get("tags")
          .split(/,|\s+(?=#)/)
          .map((t) => t.trim())
          .filter(Boolean),
        is_archived: form.get("archived") === "true",
        unread: form.get("unread") === "true",
      };
      await api(id ? `/api/bookmarks/${id}/` : "/api/bookmarks/", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      if (state.mode === "bookmarks") await loadBookmarks();
    },
    b
      ? async () => {
          await api(`/api/bookmarks/${b.id}/`, { method: "DELETE" });
          if (state.mode === "bookmarks") await loadBookmarks();
        }
      : null,
  );
}
const tokensPath = "/api/orbia/tokens";
const pullPath = "/api/orbia/linkding-import";
let tokenEntries = [];
let settingsGeneration = 0;

function integrationStatus(id, message, error = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.toggle("error", error);
}
function renderTokens() {
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
        integrationStatus("#token-status", error.message, true);
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
  const entries = await api(tokensPath);
  if (generation !== settingsGeneration) return;
  tokenEntries = entries;
  renderTokens();
}
function clearNewToken() {
  $("#token-value").value = "";
  $("#new-token").hidden = true;
}
$("#settings-dialog").addEventListener("close", () => {
  settingsGeneration++;
  $("#access-form").reset();
  clearNewToken();
  $("#source-token").value = "";
});
$("#token-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter || $("#token-form button");
  const generation = settingsGeneration;
  button.disabled = true;
  clearNewToken();
  integrationStatus("#token-status", "");
  try {
    const result = await api(tokensPath, {method: "POST", body: JSON.stringify({name: $("#token-name").value})});
    if (generation !== settingsGeneration || !$("#settings-dialog").open) return;
    $("#token-name").value = "";
    $("#token-value").value = result.token;
    $("#new-token").hidden = false;
    $("#token-value").select();
    await loadTokens();
  } catch (error) {
    integrationStatus("#token-status", error.message, true);
  } finally {
    button.disabled = false;
  }
});
$("#pull-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("#pull-form button");
  button.disabled = true;
  integrationStatus("#pull-status", t("backup.importing"));
  const body = JSON.stringify({url: $("#source-url").value.trim(), token: $("#source-token").value.trim()});
  $("#source-token").value = "";
  try {
    const result = await api(pullPath, {method: "POST", body});
    integrationStatus("#pull-status", t("linkding.importSummary", result));
  } catch (error) {
    integrationStatus("#pull-status", error.message, true);
  } finally {
    button.disabled = false;
    if (state.authenticated && state.mode === "bookmarks") await loadBookmarks();
  }
});

function updateAccessFields() {
  const needsPassword = $("#access-mode").value === "password";
  $("#new-password").required = needsPassword;
  $("#new-password").disabled = !needsPassword;
  $("#new-password-field").hidden = !needsPassword;
  $("#open-access-hint").hidden = needsPassword;
}
function prepareAccessForm(setup) {
  const form = $("#access-form");
  form.reset();
  $("#access-status").textContent = "";
  $(setup ? "#setup-container" : "#access-settings").append(form);
  const current = !setup && state.accessMode === "password";
  $("#current-password-field").hidden = !current;
  $("#current-password").required = current;
  $("#access-mode").value = state.accessMode === "open" ? "open" : "password";
  updateAccessFields();
}
$("#access-mode").addEventListener("change", updateAccessFields);
$("#access-form").addEventListener("submit", async event => {
  event.preventDefault();
  const setup = state.accessMode === "setup";
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  const mode = $("#access-mode").value;
  const payload = {
    mode,
    password: mode === "password" ? $("#new-password").value : "",
    current: $("#current-password").value,
  };
  integrationStatus("#access-status", "");
  try {
    await api(setup ? "/auth/setup" : "/auth/password", {method: "POST", body: JSON.stringify(payload)});
    state.accessMode = mode;
    prepareAccessForm(false);
    if (setup) await start();
    else {
      $('[data-action="logout"]').hidden = mode === "open";
      integrationStatus("#access-status", t("access.saved"));
    }
  } catch (error) {
    if (error.status === 409 || error.status === 401) {
      await start();
    } else {
      integrationStatus("#access-status", !setup && error.status === 403
        ? t("access.incorrectPassword")
        : error.message, true);
    }
  } finally {
    button.disabled = false;
  }
});

function openSettings() {
  prepareAccessForm(false);
  settingsGeneration++;
  tokenEntries = [];
  renderTokens();
  integrationStatus("#token-status", "");
  loadTokens().catch(error => integrationStatus("#token-status", error.message, true));
  $("#server-url").textContent = location.origin;
  $("#import-status").textContent = "";
  openDialog("#settings-dialog");
}
async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
    showLogin();
  } catch (error) {
    toast(error.message, true);
  }
}
async function importFile() {
  const input = $("#import-file"),
    file = input.files[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    $("#import-status").textContent = t("backup.fileTooLarge");
    input.value = "";
    return;
  }
  input.disabled = true;
  $("#import-status").textContent = t("backup.importing");
  try {
    const result = await api("/api/orbia/import", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
    await loadDashboard();
    renderDashboard();
    if (state.mode === "bookmarks") await loadBookmarks();
    $("#import-status").textContent =
      `${t("backup.imported", {count: result.imported})}${result.dashboard_restored ? " " + t("backup.dashboardRestored") : ""}`;
  } catch (error) {
    $("#import-status").textContent = error.message;
  } finally {
    input.disabled = false;
    input.value = "";
  }
}

const actions = {
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
    state.mode === "dashboard" ? editLink() : editBookmark(),
  grid: () => setLayout("grid"),
  list: () => setLayout("list"),
  "archive-view": () => {
    state.archived = !state.archived;
    loadBookmarks();
  },
  "unread-view": () => {
    state.unreadOnly = !state.unreadOnly;
    loadBookmarks();
  },
  "clear-filters": () => {
    state.unreadOnly = false;
    queryBookmarks("");
  },
  "load-more": () => loadBookmarks(true),
  "more-tags": () => {
    state.tagLimit += 40;
    renderBookmarks();
  },
  "all-results": () => {
    state.query = $("#panel-query").value;
    state.archived = false;
    state.unreadOnly = false;
    setMode("bookmarks");
  },
  "copy-token": async () => {
    const input = $("#token-value");
    try {
      await navigator.clipboard.writeText(input.value);
      integrationStatus("#token-status", t("tokens.copied"));
    } catch {
      input.select();
      integrationStatus("#token-status", t("tokens.copyManually"));
    }
  },
  "copy-url": async () => {
    try {
      await navigator.clipboard.writeText(location.origin);
      toast(t("tokens.serverCopied"));
    } catch {
      toast(t("tokens.copyServerManually"));
    }
  },
  logout,
};
async function markOpenedBookmark(event) {
  if (event.defaultPrevented || (event.type === "auxclick" && event.button !== 1)) return;
  const id = event.target.closest("a[data-unread-id]")?.dataset.unreadId;
  if (!id) return;
  try {
    await api(`/api/bookmarks/${id}/`, {
      method: "PATCH", body: JSON.stringify({ unread: false }), keepalive: true,
    });
    for (const collection of [state.books, state.panelBooks]) {
      const book = collection.find(b => String(b.id) === id);
      if (book) book.unread = false;
    }
    for (const link of $$("a[data-unread-id]")) {
      if (link.dataset.unreadId !== id) continue;
      delete link.dataset.unreadId;
      link.querySelector(".unread-dot")?.remove();
    }
    if (state.mode === "bookmarks" && state.unreadOnly) loadBookmarks();
  } catch (error) {
    toast(error.message, true);
  }
}
document.addEventListener("click", markOpenedBookmark);
document.addEventListener("auxclick", markOpenedBookmark);
window.addEventListener("pageshow", event => {
  if (event.persisted && state.mode === "bookmarks") loadBookmarks();
});
document.addEventListener("click", async (event) => {
  const el = event.target.closest("button, a, [data-close]");
  if (!el) return;
  if (el.dataset.close) {
    document.getElementById(el.dataset.close)?.close();
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
      editLink(null, el.dataset.addTo);
      return;
    }
    if (el.dataset.link && state.edit) {
      event.preventDefault();
      editLink(el.dataset.link);
      return;
    }
    if (el.dataset.editBookmark) {
      editBookmark(Number(el.dataset.editBookmark));
      return;
    }
    if (el.dataset.bookmarkTag) {
      if (state.mode !== "bookmarks") setMode("bookmarks");
      queryBookmarks(toggleTag(state.query, el.dataset.bookmarkTag));
      return;
    }
    if (el.dataset.panelTag) {
      $("#panel-query").value = toggleTag(
        $("#panel-query").value,
        el.dataset.panelTag,
      );
      loadPanel();
      $("#panel-query").focus();
      return;
    }
    if (el.dataset.command !== undefined)
      runCommand(Number(el.dataset.command));
  } catch (error) {
    toast(error.message, true);
  }
});
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#login-form button");
  button.disabled = true;
  $("#login-error").textContent = "";
  try {
    await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: $("#password").value }),
    });
    $("#password").value = "";
    await start();
  } catch (error) {
    $("#login-error").textContent =
      error.status === 401 ? t("auth.incorrectPassword") : error.message;
  } finally {
    button.disabled = false;
  }
});
$("#editor-form").addEventListener("submit", saveEditor);
$("#delete-button").addEventListener("click", () => {
  $("#delete-confirm").hidden = false;
  $("#confirm-delete").focus();
});
$("#confirm-delete").addEventListener("click", async () => {
  const button = $("#confirm-delete");
  button.disabled = true;
  try {
    await editorDelete();
    $("#editor-dialog").close();
    toast(t("editor.deleted"));
  } catch (error) {
    $("#editor-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$("#bookmark-query").addEventListener("input", (event) =>
  queryBookmarks(event.target.value, false),
);
$("#panel-query").addEventListener("input", () => {
  clearPanelResults();
  clearTimeout(panelTimer);
  panelController?.abort();
  panelSequence++;
  panelTimer = setTimeout(loadPanel, 150);
});
$("#command-query").addEventListener("input", renderCommands);
$("#import-file").addEventListener("change", importFile);
$("#page-tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const pages = state.dashboard.pages,
    index = pages.findIndex((p) => p.id === state.page);
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
$$("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  });
});
$("#search-dialog").addEventListener("close", () => {
  clearTimeout(panelTimer);
  panelController?.abort();
  panelSequence++;
});
document.addEventListener("keydown", (event) => {
  if (!state.authenticated || event.isComposing || event.altKey) return;
  const modifier = event.metaKey || event.ctrlKey,
    key = event.key.toLowerCase(),
    dialog = $("dialog[open]");
  if (modifier && (key === "k" || key === "p")) {
    event.preventDefault();
    key === "k" ? openCommands() : openSearch();
    return;
  }
  if (dialog) {
    // WebKit with keyboard navigation disabled otherwise skips buttons and links.
    if (event.key === "Tab" && !modifier) {
      const controls = $$("button, a[href], input, textarea, select", dialog)
        .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
      if (controls.length) {
        event.preventDefault();
        const index = controls.indexOf(document.activeElement);
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
    if (dialog.id === "search-dialog" && event.target === $("#panel-query")) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        selectPanel(state.panelSelected + (event.key === "ArrowDown" ? 1 : -1));
      }
      if (event.key === "Enter") {
        event.preventDefault();
        $$(".panel-result")[state.panelSelected]?.click();
      }
    }
    if (dialog.id === "command-dialog") {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        selectCommand(
          state.commandSelected + (event.key === "ArrowDown" ? 1 : -1),
        );
      }
      if (event.key === "Enter" && event.target === $("#command-query")) {
        event.preventDefault();
        runCommand(state.commandSelected);
      }
    }
    return;
  }
  if (modifier && key === "e") {
    event.preventDefault();
    toggleEdit();
    return;
  }
  if (modifier) return;
  if (event.target.closest('input, textarea, select, [contenteditable="true"]'))
    return;
  if (key === "/" || key === "+" || key === "#" || key === ",") {
    event.preventDefault();
    if (key === "/") openSearch();
    if (key === "+") actions["mobile-add"]();
    if (key === "#") setMode("bookmarks");
    if (key === ",") openSettings();
    return;
  }
  if (state.mode === "bookmarks") return;
  if (event.key === "Escape") {
    state.quick = "";
    renderQuick();
    return;
  }
  if (event.key === "Backspace" && state.quick) {
    event.preventDefault();
    state.quick = state.quick.slice(0, -1);
    renderQuick();
    return;
  }
  if (event.key === "Enter" && state.quick && !state.edit) {
    event.preventDefault();
    const matches = quickMatches();
    if (matches.length === 1) launchQuicklink(matches[0]);
    return;
  }
  if (!state.quick && /^[1-9]$/.test(event.key)) {
    const page = state.dashboard.pages[Number(event.key) - 1];
    if (page) {
      event.preventDefault();
      setPage(page.id);
    }
    return;
  }
  if (/^[a-z0-9]$/i.test(event.key) && !state.edit) {
    event.preventDefault();
    if (state.quick.length < 3) {
      updateQuickInput(state.quick + event.key);
    }
  }
});
async function start() {
  try {
    const access = await api("/auth/status");
    state.accessMode = access.mode;
    $("#setup-screen").hidden = access.mode !== "setup";
    if (access.mode === "setup") {
      state.authenticated = false;
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
    state.authenticated = true;
    $("#login").hidden = true;
    $("#app").hidden = false;
    const edit = location.pathname.match(/^\/bookmarks\/(\d+)\/edit\/?$/);
    const library =
      /^\/bookmarks\/?$/.test(location.pathname) ||
      edit ||
      location.hash === "#bookmarks";
    state.query = library
      ? new URLSearchParams(location.search).get("q") || ""
      : "";
    setMode(library ? "bookmarks" : "dashboard");
    if (edit) await editBookmark(Number(edit[1]));
  } catch (error) {
    if (error.status !== 401) toast(error.message, true);
    showLogin();
  }
}
$("#language").addEventListener("change", async event => {
  const status = $("#language-status");
  status.hidden = true;
  if (!await setLanguage(event.target.value, true)) {
    status.textContent = t("errors.languageLoad");
    status.hidden = false;
  }
});
const savedLanguage = readPreference("language", defaultLanguage);
const initialLanguage = Object.hasOwn(languageCatalogs, savedLanguage) ? savedLanguage : defaultLanguage;
if (await setLanguage(initialLanguage)) {
  start();
} else if (await setLanguage(initialLanguage === defaultLanguage ? "de" : defaultLanguage)) {
  toast(t("errors.languageLoad"), true);
  start();
} else {
  const status = $("#toast");
  status.textContent = "Could not load the language files. / Die Sprachdateien konnten nicht geladen werden.";
  status.classList.add("error");
  status.hidden = false;
}
