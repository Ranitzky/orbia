import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const { chromium, webkit } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
);
let browser, server, origin, temporary, context, setupOrigin;
const errors = [];

before(
  async () => {
    temporary = await mkdtemp(path.join(tmpdir(), "orbia-e2e-"));
    const binary = path.join(temporary, "server");
    const build = spawnSync(
      "go",
      ["test", "-c", "./internal/app", "-o", binary],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(build.status, 0, build.stderr);
    server = spawn(binary, ["-test.run=^TestBrowserServer$"], {
      cwd: root,
      env: { ...process.env, ORBIA_BROWSER_SERVER: "1" },
      stdio: ["pipe", "pipe", "inherit"],
    });
    const output = createInterface({ input: server.stdout });
    origin = await new Promise((resolve, reject) => {
      output.on("line", (line) => {
        if (line.startsWith("SETUP ")) setupOrigin = line.slice("SETUP ".length);
        if (line.startsWith("http://")) resolve(line);
      });
      server.once("error", reject);
      server.once("exit", (code) =>
        reject(new Error(`HTTP fixture stopped (${code})`)),
      );
    });
    const engine = process.env.ORBIA_BROWSER === "webkit" ? webkit : chromium;
    browser = await engine.launch({
      headless: true,
      ...(engine === chromium ? { ignoreDefaultArgs: ["--hide-scrollbars"] } : {}),
      ...(process.env.PLAYWRIGHT_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE }
        : {}),
    });
  },
  { timeout: 120000 },
);

after(async () => {
  await context?.close();
  await browser?.close();
  server?.stdin.end();
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

async function pageFor(options = {}, language = "de") {
  await context?.close();
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    storageState: {
      cookies: [],
      origins: language ? [{ origin, localStorage: [{ name: "orbia.language", value: language }] }] : [],
    },
    ...options,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page
    .getByLabel(language === "de" ? "Passwort" : "Password", { exact: true })
    .fill("a-long-test-password");
  await page.getByRole("button", { name: language === "de" ? "Orbia öffnen" : "Open Orbia", exact: true }).click();
  await page.locator("#app").waitFor({ state: "visible" });
  return page;
}
const wait = async (page, condition, arg) =>
  page.waitForFunction(condition, arg);
async function command(page, text) {
  await page.keyboard.press("Meta+k");
  await page.locator("#command-query").fill(text);
  await page.keyboard.press("Enter");
}

test("main navigation highlights only the current view", async () => {
  const page = await pageFor();
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  for (const name of ["Bookmarks", "Dashboard"]) {
    await nav.getByRole("button", { name, exact: true }).click();
    await page.locator(name === "Bookmarks" ? "#bookmark-view" : "#dashboard-view").waitFor();
    assert.deepEqual((await nav.locator(".active").allTextContents()).map(text => text.trim()), [name]);
    assert.deepEqual((await nav.locator('[aria-current="page"]').allTextContents()).map(text => text.trim()), [name]);
  }
});

test("switching to scrollable bookmarks preserves the content position and width", async () => {
  const page = await pageFor();
  // Keep the overflow independent of the number of seeded bookmarks.
  await page.addStyleTag({ content: "#bookmark-view { min-height: 120vh; }" });
  const classicScrollbar = browser.browserType().name() === "chromium";
  if (classicScrollbar) {
    // Use a classic scrollbar even on systems that default to overlay scrollbars.
    await page.addStyleTag({ content: "html::-webkit-scrollbar { width: 16px; }" });
  }
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  const layout = () => page.locator("#main").evaluate((main) => {
    const { left, width } = main.getBoundingClientRect();
    const root = document.scrollingElement;
    return { left, width, scrollable: root.scrollHeight > root.clientHeight };
  });

  const dashboard = await layout();
  assert.equal(dashboard.scrollable, false);

  await nav.getByRole("button", { name: "Bookmarks", exact: true }).click();
  await page.locator(".bookmark-card").first().waitFor();
  if (classicScrollbar) {
    assert.ok(await page.evaluate(() => document.documentElement.clientWidth < innerWidth));
  }
  assert.deepEqual(await layout(), { ...dashboard, scrollable: true });

  await nav.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.locator("#dashboard-view").waitFor();
  assert.deepEqual(await layout(), dashboard);
});

test("dashboard and bookmark cards retain their responsive layout", async () => {
  const page = await pageFor({}, null);
  if (process.env.ORBIA_SCREENSHOTS) {
    await mkdir(process.env.ORBIA_SCREENSHOTS, { recursive: true });
    await page.setViewportSize({ width: 1671, height: 941 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: path.join(process.env.ORBIA_SCREENSHOTS, "orbia-home.png"),
    });
  }
  for (const [width, columns] of [
    [1440, 3],
    [820, 2],
    [390, 1],
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await page.locator("#groups").evaluate((el) => {
      const cards = [...el.children].map((card) =>
        card.getBoundingClientRect(),
      );
      const card = getComputedStyle(el.firstElementChild);
      return {
        columns: cards.filter((rect) => rect.top === cards[0].top).length,
        bordered: parseFloat(card.borderTopWidth) > 0,
        padded: parseFloat(card.paddingLeft) > 0,
        linkDisplay: getComputedStyle(el.querySelector(".quicklink")).display,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.deepEqual(
      layout,
      {
        columns,
        bordered: true,
        padded: true,
        linkDisplay: "flex",
        overflow: false,
      },
      `dashboard at ${width}px`,
    );
  }
  await page.locator('.mobile-nav [data-action="bookmarks"]').click();
  await page.locator(".bookmark-card").first().waitFor();
  for (const [width, columns] of [
    [1440, 3],
    [820, 2],
    [390, 2],
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await page.locator("#bookmarks").evaluate((el) => {
      const cards = [...el.children].map((card) =>
        card.getBoundingClientRect(),
      );
      return {
        columns: cards.filter((rect) => rect.top === cards[0].top).length,
        display: getComputedStyle(el.firstElementChild).display,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.deepEqual(
      layout,
      { columns, display: "flex", overflow: false },
      `bookmarks at ${width}px`,
    );
  }
});

test("dashboard controls stay at the bottom on full and empty pages", async () => {
  const page = await pageFor({ viewport: { width: 1440, height: 768 } });
  const groups = Array.from({ length: 6 }, (_, group) => ({
    id: `group-${group}`,
    name: `Group ${group + 1}`,
    color: "#36d8d3",
    links: Array.from({ length: 4 }, (_, link) => ({
      id: `link-${group}-${link}`,
      code: `L${group}${link}`,
      name: `Link ${link + 1}`,
      url: "https://example.com/",
    })),
  }));
  await page.route("**/api/orbia/dashboard", route => route.fulfill({ json: {
    revision: 1,
    pages: [{ id: "home", name: "Home", groups }, { id: "work", name: "Work", groups: [] }],
  } }));
  await page.reload();
  await page.locator(".quicklink").last().waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator(".quicklink").count(), 24);

  const scrolls = () => page.evaluate(() => {
    const root = document.scrollingElement;
    return root.scrollHeight > root.clientHeight;
  });
  const grid = page.locator("#groups");
  const gridScrolls = () => grid.evaluate(el => el.scrollHeight > el.clientHeight);
  const controlsBottom = () => page.locator(".dashboard-bottom").evaluate(el => el.getBoundingClientRect().bottom);
  const bottom = await controlsBottom();
  assert.ok(bottom >= 768 - 24 && bottom <= 768);
  assert.equal(await scrolls(), false);
  assert.equal(await gridScrolls(), false);

  await page.getByRole("tab", { name: /Work/ }).click();
  await grid.locator(".empty-state").waitFor();
  assert.equal(await controlsBottom(), bottom);
  assert.equal(await scrolls(), false);

  await page.getByRole("tab", { name: /Home/ }).click();
  await grid.locator(".quicklink").last().waitFor();
  await page.setViewportSize({ width: 1440, height: 550 });
  assert.equal(await controlsBottom(), bottom - (768 - 550));
  assert.equal(await scrolls(), false);
  assert.equal(await gridScrolls(), true);
  await grid.locator(".quicklink").last().scrollIntoViewIfNeeded();
  assert.ok(await grid.evaluate(el => el.scrollTop > 0));
  assert.equal(await controlsBottom(), bottom - (768 - 550));
  await page.setViewportSize({ width: 390, height: 768 });
  assert.equal(await scrolls(), true);
});

test("quick status reserves space between the grid and the input", async () => {
  const page = await pageFor();
  const grid = page.locator("#groups");
  const status = page.locator("#quick-status");
  const positions = () => page.locator("#groups, .dashboard-bottom, #quick-input").evaluateAll(
    elements => elements.map(el => el.getBoundingClientRect().top + window.scrollY),
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 844});
    await page.locator("#quick-input").focus();
    const before = await positions();
    await page.keyboard.type("f");
    assert.deepEqual(await positions(), before);
    const gridBox = await grid.boundingBox();
    const statusBox = await status.boundingBox();
    const bottomBox = await page.locator(".dashboard-bottom").boundingBox();
    assert.ok(gridBox.y + gridBox.height <= statusBox.y);
    assert.ok(statusBox.y + statusBox.height <= bottomBox.y);
    await page.keyboard.type("zz");
    assert.match(await status.textContent(), /Kein passendes Kürzel/);
    assert.deepEqual(await positions(), before);
    await page.keyboard.press("Escape");
    assert.equal(await status.isVisible(), false);
    assert.deepEqual(await positions(), before);
  }
});

test("default quicklinks, prefix-only search, target preview and Enter navigation", async () => {
  const page = await pageFor();
  const names = await page.locator(".quick-name").allTextContents();
  assert.deepEqual(names, ["Amazon", "eBay", "Gmail", "GitHub", "Figma", "Notion", "Booking.com"]);
  await page.keyboard.type("f");
  assert.equal(await page.locator(".quicklink.matched").count(), 1);
  assert.match(
    await page.locator("#quick-status").textContent(),
    /Figma.*https:\/\/www\.figma\.com/s,
  );
  assert.equal(await page.locator(".quicklink.dimmed").count(), 6);
  await page.keyboard.press("Escape");
  await page.keyboard.type("amazon");
  assert.equal(await page.locator(".quicklink.matched").count(), 0);
  await page.keyboard.press("Escape");
  await page.keyboard.type("f");
  let navigated = false;
  await context.route("https://www.figma.com/**", async (route) => {
    navigated = true;
    await route.fulfill({ body: "<title>Figma target</title>Figma" });
  });
  await page.keyboard.press("Enter");
  await page.waitForURL("https://www.figma.com/");
  assert.equal(navigated, true);
});

test("full dashboard codes launch immediately from the keyboard and touch input", async () => {
  for (const mobile of [false, true]) {
    const page = await pageFor(mobile ? {
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    } : {});
    const input = page.locator("#quick-input");
    await context.route("https://github.com/**", route => route.fulfill({ body: "GitHub" }));
    if (mobile) {
      await input.tap();
      await input.fill("gi");
    } else {
      await page.keyboard.type("gi");
    }
    assert.match(await page.locator("#quick-status").textContent(), /GitHub/);
    if (mobile) await input.fill("git");
    else await page.keyboard.press("t");
    await page.waitForURL("https://github.com/");
  }
});

test("keyboard editing persists, duplicate codes rejected, page switching and commands work", async () => {
  const page = await pageFor();
  await page.keyboard.press("Meta+e");
  assert.equal(
    await page.locator("#edit-toggle").getAttribute("aria-pressed"),
    "true",
  );
  await page
    .getByRole("link", { name: "Amazon bearbeiten", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Amazon Shopping");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await page.locator("#editor-dialog").waitFor({ state: "hidden" });
  await page.reload();
  await page.locator("#app").waitFor({ state: "visible" });
  assert.equal(
    await page.getByText("Amazon Shopping", { exact: true }).count(),
    1,
  );
  for (const modifier of ["ctrlKey", "metaKey"]) {
    for (const key of ["+", "="]) {
      const unhandled = await page.evaluate(({ modifier, key }) =>
        document.dispatchEvent(new KeyboardEvent("keydown", { key, [modifier]: true, cancelable: true })),
        { modifier, key });
      assert.equal(unhandled, true);
    }
  }
  await page.keyboard.press("+");
  await page.getByLabel("Name", { exact: true }).fill("Duplicate");
  await page.getByLabel("Kürzel", { exact: true }).fill("AMZ");
  await page
    .getByLabel("Ziel-URL", { exact: true })
    .fill("https://duplicate.test");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  assert.match(
    await page.locator("#editor-error").textContent(),
    /bereits vergeben/,
  );
  await page.keyboard.press("Escape");
  await command(page, "Dashboard-Seite hinzufügen");
  await page.getByLabel("Name", { exact: true }).fill("Arbeit");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await page.locator("#editor-dialog").waitFor({ state: "hidden" });
  assert.equal(
    await page.locator(".page-tab[aria-selected=true]").textContent(),
    "02Arbeit",
  );
  await page.keyboard.press("1");
  assert.match(
    await page.locator(".page-tab[aria-selected=true]").textContent(),
    /Home/,
  );
  await page.keyboard.press("2");
  assert.match(
    await page.locator(".page-tab[aria-selected=true]").textContent(),
    /Arbeit/,
  );
  await page.getByRole("button", { name: "Erste Gruppe anlegen" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Projekte");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await page.locator("#editor-dialog").waitFor({ state: "hidden" });
  await page.keyboard.press("+");
  await page.getByLabel("Name", { exact: true }).fill("Projekt");
  await page.getByLabel("Kürzel", { exact: true }).fill("PRJ");
  await page
    .getByLabel("Ziel-URL", { exact: true })
    .fill("https://project.test");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await page.locator("#editor-dialog").waitFor({ state: "hidden" });
  assert.equal(await page.locator(".quicklink").count(), 1);
  await command(page, "Hellen Modus");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
});

test("tag prefixes suggest names and bookmarks, then complete the active filter", async () => {
  const page = await pageFor();
  await page.keyboard.press("Meta+p");
  const query = page.locator("#panel-query");
  await query.fill("#D");
  await wait(page, () => document.querySelector("#panel-count").textContent === "4 Ergebnisse");
  assert.deepEqual(await page.locator("#panel-tags button").allTextContents(), ["#design", "#dev", "#docs", "#dresden"]);
  assert.equal(await page.locator(".panel-result").count(), 4);
  await page.locator('[data-panel-tag="dev"]').click();
  assert.equal(await query.inputValue(), "#dev ");
  await wait(page, () => document.querySelector("#panel-count").textContent === "2 Ergebnisse");
  await query.fill("#travel Guide #dr");
  await wait(page, () => document.querySelector("#panel-count").textContent === "1 Ergebnis");
  assert.deepEqual(await page.locator("#panel-tags button").allTextContents(), ["#dresden"]);
  await page.locator('[data-action="all-results"]').click();
  const suggestion = page.locator('#bookmark-tags [data-bookmark-tag="dresden"]');
  await suggestion.click();
  assert.equal(await page.locator("#bookmark-query").inputValue(), "#travel Guide #dresden ");
  await wait(page, () => document.querySelector("#bookmark-count").textContent === "1 Bookmark");
});

test("bookmark AND filters, matching tag suggestions, text search, list layout and search panel", async () => {
  const page = await pageFor();
  await page.locator("#nav-bookmarks").click();
  await page.locator(".bookmark-card").first().waitFor();
  await page.locator("#bookmark-query").fill("#travel #city");
  await wait(
    page,
    () =>
      document.querySelector("#bookmark-count").textContent === "2 Bookmarks",
  );
  assert.equal(await page.locator(".bookmark-card").count(), 2);
  assert.equal(
    await page
      .locator("#bookmark-tags")
      .getByRole("button", { name: "#dev" })
      .count(),
    0,
  );
  await page.locator("#bookmark-query").fill("#travel #city #dresden Guide");
  await wait(
    page,
    () =>
      document.querySelector("#bookmark-count").textContent === "1 Bookmark",
  );
  assert.match(await page.locator(".bookmark-title").textContent(), /Dresden/);
  await page
    .getByRole("button", { name: "Listenansicht", exact: true })
    .click();
  assert.match(await page.locator("#bookmarks").getAttribute("class"), /list/);
  await page.locator("#nav-dashboard").click();
  await page.keyboard.press("Meta+p");
  await page.locator("#panel-query").fill("#travel #city #dresden");
  await wait(
    page,
    () => document.querySelector("#panel-count").textContent === "1 Ergebnis",
  );
  assert.equal(await page.locator(".panel-result").count(), 1);
  assert.match(await page.locator(".panel-result").textContent(), /Dresden/);
  const box = await page.locator("#search-dialog").boundingBox();
  assert.ok(box.y > 550, "search belongs in the lower screen");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#search-dialog").isVisible(), false);
});

test("bookmark create, edit, archive, delete and export through the real API", async () => {
  const page = await pageFor();
  await page.locator("#nav-bookmarks").click();
  await page
    .getByRole("button", { name: "Bookmark hinzufügen", exact: true })
    .first()
    .click();
  await page.getByLabel("URL", { exact: true }).fill("https://created.test");
  await page.getByLabel("Titel", { exact: true }).fill("Meine Grüße");
  const tags = page.getByLabel("Tags", { exact: true });
  assert.equal(await tags.getAttribute("placeholder"), "Tags mit Kommas trennen oder als Hashtags eingeben.");
  assert.equal(await tags.getAttribute("data-1p-ignore"), "");
  await tags.fill("#travel #city #dresden, privat");
  await page
    .getByLabel("Notizen", { exact: true })
    .fill("Ein Inhalt mit Umlauten.");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await page.locator("#editor-dialog").waitFor({ state: "hidden" });
  await page.locator("#bookmark-query").fill("#privat #travel #city #dresden");
  await wait(
    page,
    () =>
      document.querySelector("#bookmark-count").textContent === "1 Bookmark",
  );
  await page
    .getByRole("button", { name: "Meine Grüße bearbeiten", exact: true })
    .click();
  await page.getByLabel("Status", { exact: true }).selectOption("true");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await page.locator("#editor-dialog").waitFor({ state: "hidden" });
  await wait(
    page,
    () =>
      document.querySelector("#bookmark-count").textContent === "0 Bookmarks",
  );
  await page.locator("#archive-toggle").click();
  await page
    .getByRole("button", { name: "Meine Grüße bearbeiten", exact: true })
    .click();
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  await page
    .getByRole("button", { name: "Endgültig löschen", exact: true })
    .click();
  await page.locator("#editor-dialog").waitFor({ state: "hidden" });
  await wait(
    page,
    () =>
      document.querySelector("#bookmark-count").textContent ===
      "0 Bookmarks im Archiv",
  );
  const data = await page.evaluate(async () => {
    const r = await fetch("/api/orbia/export");
    return r.json();
  });
  assert.equal(data.version, 1);
  assert.ok(data.dashboard.pages.length >= 1);
});

test("iPhone viewport, touch controls, visible focus, escaping and screenshots", async () => {
  const page = await pageFor({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  await page.keyboard.press("1");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  assert.equal(overflow, false);
  const columns = await page
    .locator("#groups")
    .evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
  assert.equal(columns, 1);
  await page.locator("#quick-input").fill("FI");
  assert.match(await page.locator("#quick-status").textContent(), /Figma/);
  await page.locator("#quick-input").fill("");
  await page.locator('.mobile-nav [data-action="search"]').click();
  await page.locator("#panel-query").fill("Travel Guide");
  await wait(
    page,
    () => document.querySelector("#panel-count").textContent === "2 Ergebnisse",
  );
  assert.equal(
    await page
      .locator("#panel-query")
      .evaluate((el) => document.activeElement === el),
    true,
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(
      () => !!document.activeElement.closest("#search-dialog"),
    ),
    true,
  );
  await page.keyboard.press("Escape");
  await page.locator('.mobile-nav [data-action="bookmarks"]').click();
  await page.locator(".bookmark-card").first().waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.locator('.mobile-nav [data-action="dashboard"]').click();
  const screenshots = process.env.ORBIA_SCREENSHOTS;
  if (screenshots) {
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({
      path: path.join(screenshots, "orbia-iphone.png"),
      fullPage: true,
    });
  }
  assert.deepEqual(errors, [], "no uncaught browser errors");
});

test("desktop screenshot and theme persistence", async () => {
  const page = await pageFor();
  await page.keyboard.press("1");
  if (process.env.ORBIA_SCREENSHOTS) {
    await page.screenshot({
      path: path.join(process.env.ORBIA_SCREENSHOTS, "orbia-dashboard.png"),
      fullPage: true,
    });
    await page.locator("#nav-bookmarks").click();
    await page.locator(".bookmark-card").first().waitFor();
    await page.screenshot({
      path: path.join(process.env.ORBIA_SCREENSHOTS, "orbia-bookmarks.png"),
      fullPage: true,
    });
  }
  await command(page, "Hellen Modus");
  await page.reload();
  await page.locator("#app").waitFor({ state: "visible" });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  assert.deepEqual(errors, []);
});

test("Linkding omnibox opens its query and Raycast opens the editor by ID", async () => {
  const page = await pageFor();
  await page.goto(origin + "/bookmarks?q=%23dresden");
  await wait(
    page,
    () =>
      document.querySelector("#bookmark-count").textContent === "1 Bookmark",
  );
  assert.equal(await page.locator("#bookmark-query").inputValue(), "#dresden");
  const id = await page
    .locator("[data-edit-bookmark]")
    .getAttribute("data-edit-bookmark");
  await page.goto(origin + "/bookmarks/" + id + "/edit");
  await page.getByRole("dialog", { name: "Bookmark bearbeiten" }).waitFor();
  assert.match(
    await page.getByLabel("Titel", { exact: true }).inputValue(),
    /Dresden/,
  );
});

test("a fresh browser starts in English and remembers a switch to German", async () => {
  const page = await pageFor({}, null);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const language = page.getByLabel("Language", { exact: true });
  assert.equal(await language.inputValue(), "en");
  await language.selectOption("de");
  await page.getByRole("dialog", { name: "Einstellungen", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click();
  assert.equal(await page.getByLabel("Sprache", { exact: true }).inputValue(), "de");
});

test("language changes in settings, persists and keeps bookmark search data intact", async () => {
  const page = await pageFor();
  await page.locator("#nav-bookmarks").click();
  await page.locator("#bookmark-query").fill("Guide #dresden");
  await wait(page, () => document.querySelector("#bookmark-count").textContent === "1 Bookmark");
  const title = await page.locator(".bookmark-title").textContent();
  assert.equal(await page.evaluate(() => performance.getEntriesByType("resource")
    .some(entry => new URL(entry.name).pathname === "/en.js")), false);
  await page.getByRole("button", {name:"Einstellungen", exact:true}).click();
  const reads = [];
  const record = request => reads.push(new URL(request.url()).pathname);
  page.on("request", record);
  await page.getByLabel("Sprache", {exact:true}).selectOption("en");
  await page.getByRole("dialog", {name:"Settings", exact:true}).waitFor();
  page.off("request", record);
  assert.deepEqual(reads, ["/en.js"]);
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.equal(await page.getByLabel("Language", {exact:true}).inputValue(), "en");
  await page.getByRole("button", {name:"Close settings"}).click();
  assert.equal(await page.getByLabel("Filter bookmarks").inputValue(), "Guide #dresden");
  assert.equal(await page.locator(".bookmark-title").textContent(), title);
  await page.getByRole("button", {name:"Edit " + title, exact:true}).click();
  await page.getByRole("dialog", {name:"Edit bookmark"}).waitFor();
  assert.equal(await page.getByLabel("Title", {exact:true}).inputValue(), title);
  assert.equal(await page.getByLabel("Tags", {exact:true}).getAttribute("placeholder"), "Separate tags with commas or enter hashtags.");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+p");
  await page.getByRole("searchbox", {name:"Search bookmarks"}).fill("Guide #dresden");
  await wait(page, () => document.querySelector("#panel-count").textContent === "1 result");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+k");
  await page.locator("#command-query").fill("add dashboard page");
  await page.getByRole("button", {name:"Add dashboard page", exact:true}).waitFor();
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", {name:"Settings", exact:true}).click();
  assert.equal(await page.getByLabel("Language", {exact:true}).inputValue(), "en");
  await page.getByRole("button", {name:"Sign out", exact:true}).click();
  await page.getByLabel("Password", {exact:true}).fill("a-long-test-password");
  await page.getByRole("button", {name:"Open Orbia", exact:true}).click();
  await page.getByRole("button", {name:"Settings", exact:true}).click();
  await page.getByLabel("Language", {exact:true}).selectOption("de");
  await page.getByRole("dialog", {name:"Einstellungen", exact:true}).waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "de");
  assert.equal(await page.getByLabel("Sprache", {exact:true}).inputValue(), "de");
});

test("adding a seventh group shows an error toast", async () => {
  const page = await pageFor({}, "en");
  await page.keyboard.press("Meta+e");
  const editBar = page.locator("#edit-bar");
  await editBar.getByRole("button", { name: "Add page", exact: true }).click();
  const newPage = page.getByRole("dialog", { name: "Add dashboard page", exact: true });
  await newPage.getByLabel("Name", { exact: true }).fill("Group limit");
  await newPage.getByRole("button", { name: "Save", exact: true }).click();
  const editor = page.locator("#editor-dialog");
  await editor.waitFor({ state: "hidden" });

  const add = editBar.getByRole("button", { name: "Add group", exact: true });
  for (let number = 1; number <= 6; number++) {
    await add.click();
    await editor.getByLabel("Name", { exact: true }).fill(`Group ${number}`);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
  }

  await add.click();
  const toast = page.locator("#toast.error");
  await toast.waitFor();
  assert.equal(await toast.textContent(), "This page already has six groups.");
  assert.equal(await editor.isVisible(), false);
  assert.equal(await page.locator(".group-card").count(), 6);
});

test("settings issue and revoke client credentials and import from Linkding", async () => {
  const page = await pageFor({}, "en");
  await page.getByRole("button", {name: "Settings", exact: true}).click();
  await page.getByText("Linkding integrations", { exact: true }).click();
  await page.getByLabel("App name").fill("Browser test");
  await page.getByRole("button", {name: "Generate token"}).click();
  const value = page.getByLabel("New token · copy it now");
  await value.waitFor();
  const token = await value.inputValue();
  const headers = {Authorization: "Token " + token};
  const client = page.context().request;
  assert.equal((await client.get(origin + "/api/user/profile/", {headers})).status(), 200);
  assert.equal((await client.get(origin + "/api/orbia/export", {headers})).status(), 401);
  await page.getByRole("button", {name:"Close settings"}).click();
  await wait(page, () => document.querySelector("#token-value").value === "");
  await page.getByRole("button", {name:"Settings", exact:true}).click();
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#token-list .copy-field").filter({hasText:"Browser test"}).getByText("Revoke").click();
  await page.getByText("Token revoked.", {exact:true}).waitFor();
  assert.equal((await client.get(origin + "/api/user/profile/", {headers})).status(), 401);

  await page.getByText("Import from Linkding", { exact: true }).click();
  await page.getByLabel("Linkding server", {exact:true}).fill("http://192.168.1.20:9090");
  await page.getByLabel("Linkding API token", {exact:true}).fill("test-token-with-at-least-32-characters");
  await page.getByRole("button", {name:"Start import"}).click();
  await page.getByText("1 changed, 0 unchanged.", {exact:true}).waitFor();
  assert.equal(await page.locator("#source-token").inputValue(), "");
  await page.getByRole("button", {name:"Close settings"}).click();
  await page.locator("#nav-bookmarks").click();
  await page.getByText("Imported via settings", {exact:true}).waitFor();
});

test("first-run setup, passwordless access and password changes in Settings", async () => {
  const owner = await browser.newContext();
  const guest = await browser.newContext();
  try {
    const page = await owner.newPage();
    await page.goto(setupOrigin);
    const mode = page.getByLabel("Sign-in method");
    const save = page.getByRole("button", {name: "Save access settings"});
    await mode.selectOption("open");
    await save.click();
    await page.locator("#app").waitFor();
    const other = await guest.newPage();
    await other.goto(setupOrigin);
    await other.locator("#app").waitFor();
    const settings = page.getByRole("button", {name:"Settings",exact:true});
    await settings.click();
    await page.getByText("Access", { exact: true }).click();
    await mode.selectOption("password");
    await page.getByLabel("New password").fill("test-owner-password");
    await save.click();
    await page.getByText("Access settings saved.").waitFor();
    await other.reload();
    await other.getByRole("button", {name:"Open Orbia"}).waitFor();
    await page.getByLabel("Current password").fill("incorrect-password");
    await page.getByLabel("New password").fill("replacement-password");
    await save.click();
    await page.getByText("Incorrect current password.").waitFor();
    await page.getByLabel("Current password").fill("test-owner-password");
    await save.click();
    await page.getByText("Access settings saved.").waitFor();
    await other.getByLabel("Password",{exact:true}).fill("replacement-password");
    await other.getByRole("button",{name:"Open Orbia"}).click();
    await other.locator("#app").waitFor();
    await page.getByLabel("Current password").fill("replacement-password");
    await mode.selectOption("open");
    await save.click();
    await page.getByText("Access settings saved.").waitFor();
    await other.reload();
    await other.locator("#app").waitFor();
  } finally {
    await owner.close();
    await guest.close();
  }
});

test("dragging quicklinks saves once per move and supports empty groups", async () => {
  const page = await pageFor();
  await page.keyboard.press("Meta+e");
  const booking = page.locator('[data-link="bkg"] .quick-code');
  const shopping = page.locator('[data-group="shopping"]');
  const travel = page.locator('[data-group="travel"]');
  let writes = 0;
  page.on("request", req => {
    if (req.method() === "PUT" && req.url().endsWith("/api/orbia/dashboard")) writes++;
  });

  async function dropOn(target, fraction, save = true) {
    const start = await booking.boundingBox();
    const end = await target.boundingBox();
    const previous = writes;
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height * fraction, { steps: 8 });
    assert.equal(writes, previous);
    const saved = save && page.waitForResponse(r => r.request().method() === "PUT" && r.url().endsWith("/api/orbia/dashboard"));
    await page.mouse.up();
    if (saved) assert.equal((await saved).status(), 200);
    assert.equal(writes, previous + Number(save));
  }

  await dropOn(shopping.locator(".quicklink").first(), 0.25);
  await shopping.locator('[data-link="bkg"]:first-child').waitFor();
  await dropOn(shopping.locator('[data-link="eby"]'), 0.75);
  await shopping.locator('[data-link="bkg"]:last-child').waitFor();
  await dropOn(shopping.locator(".group-add"), 0.5, false);
  await page.reload();
  await shopping.locator('[data-link="bkg"]:last-child').waitFor();
  await page.keyboard.press("Meta+e");
  await dropOn(travel.locator(".group-add"), 0.5);
  await travel.locator('[data-link="bkg"]').waitFor();
  assert.equal(await page.locator("#editor-dialog").isVisible(), false);
});

test("unread filter, indicators and automatic read state in library and search", async () => {
  const page = await pageFor({}, "en");
  const client = page.context().request;
  const url = "https://reading.test/article";
  const endpoint = origin + "/api/bookmarks/";
  const headers = { Origin: origin };
  const created = await client.post(endpoint, { headers, data: {
    url, title: "Reading fixture", tag_names: ["readingfixture"], unread: true,
  }});
  assert.equal(created.status(), 201);
  const detail = endpoint + (await created.json()).id + "/";
  await page.route(url, route => route.fulfill({ body: "Article" }));
  await page.locator("#nav-bookmarks").click();
  await page.locator("#unread-toggle").click();
  const title = page.locator('.bookmark-title').filter({hasText: "Reading fixture"});
  await title.locator(".unread-dot").waitFor();
  await page.locator("#list-view").click();
  await title.locator(".unread-dot").waitFor();
  await page.locator('[data-bookmark-tag="readingfixture"]').first().click();
  await wait(page, () => document.querySelector("#bookmark-count").textContent === "1 Bookmark");
  await title.click();
  await page.waitForURL(url);
  assert.equal((await (await client.get(detail)).json()).unread, false);
  await page.goto(origin + "/bookmarks");
  await page.locator("#unread-toggle").click();
  await wait(page, () => document.querySelector("#unread-toggle").getAttribute("aria-pressed") === "true");
  assert.equal(await title.count(), 0);
  assert.equal(await page.locator('[data-bookmark-tag="readingfixture"]').count(), 0);
  await client.patch(detail, { headers, data: { unread: true } });
  await page.keyboard.press("Meta+p");
  await page.locator("#panel-query").fill("Reading fixture");
  await page.locator(".panel-result").filter({hasText:"Reading fixture"}).waitFor();
  await page.keyboard.press("Enter");
  await page.waitForURL(url);
  assert.equal((await (await client.get(detail)).json()).unread, false);
});

test("independent link targets persist and apply to keyboard launches", async () => {
  const page = await pageFor({}, "en");
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  const close = page.getByRole("button", { name: "Close settings" });
  await settings.click();
  const dashboard = page.getByLabel("Dashboard links", {exact:true});
  const bookmarks = page.getByLabel("Bookmark links", {exact:true});
  assert.equal(await dashboard.inputValue(), "_self");
  assert.equal(await bookmarks.inputValue(), "_self");
  await dashboard.selectOption("_blank");
  await close.click();
  await page.reload();
  await page.locator(".quicklink").first().waitFor();
  await context.route("https://github.com/**", route => route.fulfill({body:"GitHub"}));
  const popup = context.waitForEvent("page");
  await page.keyboard.type("git");
  const github = await popup;
  await github.waitForURL("https://github.com/");
  assert.equal(await github.evaluate(() => window.opener), null);
  await github.close();
  await page.locator("#nav-bookmarks").click();
  const title = page.locator(".bookmark-title").first();
  assert.equal(await title.getAttribute("target"), "_self");
  await settings.click();
  await bookmarks.selectOption("_blank");
  await dashboard.selectOption("_self");
  await close.click();
  assert.equal(await title.getAttribute("target"), "_blank");
  await page.keyboard.press("Meta+p");
  const result = page.locator(".panel-result").first();
  const url = await result.getAttribute("href");
  await context.route(url, route => route.fulfill({body:"Article"}));
  const article = context.waitForEvent("page");
  await page.keyboard.press("Enter");
  const destination = await article;
  await destination.waitForURL(url);
  await destination.close();
});
