import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const { chromium, webkit } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
);
let browser, server, origin, temporary, context;
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
    assert.deepEqual(await nav.locator(".active").allTextContents(), [name]);
    assert.deepEqual(await nav.locator('[aria-current="page"]').allTextContents(), [name]);
  }
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
  await command(page, "Neue Quicklink-Liste");
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
  assert.deepEqual(await page.locator("#panel-tags button").allTextContents(), ["#design", "#dev", "#diablo", "#docs"]);
  assert.equal(await page.locator(".panel-result").count(), 4);
  await page.locator('[data-panel-tag="dev"]').click();
  assert.equal(await query.inputValue(), "#dev ");
  await wait(page, () => document.querySelector("#panel-count").textContent === "2 Ergebnisse");
  await query.fill("#games Loot #d");
  await wait(page, () => document.querySelector("#panel-count").textContent === "1 Ergebnis");
  assert.deepEqual(await page.locator("#panel-tags button").allTextContents(), ["#diablo"]);
  await page.locator('[data-action="all-results"]').click();
  const suggestion = page.locator('#bookmark-tags [data-bookmark-tag="diablo"]');
  await suggestion.click();
  assert.equal(await page.locator("#bookmark-query").inputValue(), "#games Loot #diablo ");
  await wait(page, () => document.querySelector("#bookmark-count").textContent === "1 Bookmark");
});

test("bookmark AND filters, matching tag suggestions, text search, list layout and search panel", async () => {
  const page = await pageFor();
  await page.locator("#nav-bookmarks").click();
  await page.locator(".bookmark-card").first().waitFor();
  await page.locator("#bookmark-query").fill("#games #arpg");
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
  await page.locator("#bookmark-query").fill("#games #arpg #diablo Loot");
  await wait(
    page,
    () =>
      document.querySelector("#bookmark-count").textContent === "1 Bookmark",
  );
  assert.match(await page.locator(".bookmark-title").textContent(), /Diablo/);
  await page
    .getByRole("button", { name: "Listenansicht", exact: true })
    .click();
  assert.match(await page.locator("#bookmarks").getAttribute("class"), /list/);
  await page.locator("#nav-dashboard").click();
  await page.keyboard.press("Meta+p");
  await page.locator("#panel-query").fill("#games #arpg #diablo");
  await wait(
    page,
    () => document.querySelector("#panel-count").textContent === "1 Ergebnis",
  );
  assert.equal(await page.locator(".panel-result").count(), 1);
  assert.match(await page.locator(".panel-result").textContent(), /Diablo/);
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
  await page.getByLabel("Tags", { exact: true }).fill("test, privat");
  await page
    .getByLabel("Notizen", { exact: true })
    .fill("Ein Inhalt mit Umlauten.");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await page.locator("#editor-dialog").waitFor({ state: "hidden" });
  await page.locator("#bookmark-query").fill("#privat");
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
  await page.locator("#panel-query").fill("Loot");
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
  await page.goto(origin + "/bookmarks?q=%23diablo");
  await wait(
    page,
    () =>
      document.querySelector("#bookmark-count").textContent === "1 Bookmark",
  );
  assert.equal(await page.locator("#bookmark-query").inputValue(), "#diablo");
  const id = await page
    .locator("[data-edit-bookmark]")
    .getAttribute("data-edit-bookmark");
  await page.goto(origin + "/bookmarks/" + id + "/edit");
  await page.getByRole("dialog", { name: "Bookmark bearbeiten" }).waitFor();
  assert.match(
    await page.getByLabel("Titel", { exact: true }).inputValue(),
    /Diablo/,
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
  await page.locator("#bookmark-query").fill("Loot #diablo");
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
  assert.equal(await page.getByLabel("Filter bookmarks").inputValue(), "Loot #diablo");
  assert.equal(await page.locator(".bookmark-title").textContent(), title);
  await page.getByRole("button", {name:"Edit " + title, exact:true}).click();
  await page.getByRole("dialog", {name:"Edit bookmark"}).waitFor();
  assert.equal(await page.getByLabel("Title", {exact:true}).inputValue(), title);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+p");
  await page.getByRole("searchbox", {name:"Search bookmarks"}).fill("Loot #diablo");
  await wait(page, () => document.querySelector("#panel-count").textContent === "1 result");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+k");
  await page.locator("#command-query").fill("create quicklink list");
  await page.getByRole("button", {name:"Create quicklink list"}).waitFor();
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
  await command(page, "Create quicklink list");
  const editor = page.locator("#editor-dialog");
  await editor.getByLabel("Name", { exact: true }).fill("Group limit");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await editor.waitFor({ state: "hidden" });

  await page.keyboard.press("Meta+e");
  const add = page.getByRole("button", { name: "Add group", exact: true });
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
