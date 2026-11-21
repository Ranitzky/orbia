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

async function pageFor(options = {}) {
  await context?.close();
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...options,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page
    .getByLabel("Passwort", { exact: true })
    .fill("a-long-test-password");
  await page.getByRole("button", { name: "Orbia öffnen", exact: true }).click();
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
  const page = await pageFor();
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

test("dashboard reference, prefix-only search, target preview and Enter navigation", async () => {
  const page = await pageFor();
  assert.equal(await page.locator(".group-card").count(), 6);
  const columns = await page
    .locator("#groups")
    .evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
  assert.equal(columns, 3);
  assert.equal(await page.locator(".quicklink").count(), 24);
  await page.keyboard.type("i");
  assert.equal(await page.locator(".quicklink.matched").count(), 1);
  assert.match(
    await page.locator("#quick-status").textContent(),
    /Immich.*http:\/\/immich\.local/s,
  );
  assert.equal(await page.locator(".quicklink.dimmed").count(), 23);
  await page.keyboard.press("Escape");
  await page.keyboard.type("next");
  assert.equal(await page.locator(".quicklink.matched").count(), 0);
  await page.keyboard.press("Escape");
  await page.keyboard.type("i");
  let navigated = false;
  await context.route("http://immich.local/**", async (route) => {
    navigated = true;
    await route.fulfill({ body: "<title>Immich target</title>Immich" });
  });
  await page.keyboard.press("Enter");
  await page.waitForURL("http://immich.local/");
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
    .getByRole("link", { name: "Immich bearbeiten", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Immich Fotos");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await page.locator("#editor-dialog").waitFor({ state: "hidden" });
  await page.reload();
  await page.locator("#app").waitFor({ state: "visible" });
  assert.equal(
    await page.getByText("Immich Fotos", { exact: true }).count(),
    1,
  );
  await page.keyboard.press("Meta+=");
  await page.getByLabel("Name", { exact: true }).fill("Duplicate");
  await page.getByLabel("Kürzel", { exact: true }).fill("IMM");
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
    /Zuhause/,
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
  await page.keyboard.press("Meta+=");
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
  await page.locator("#quick-input").fill("IM");
  assert.match(await page.locator("#quick-status").textContent(), /Immich/);
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
