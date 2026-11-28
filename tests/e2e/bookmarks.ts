import assert from "node:assert/strict";
import { test } from "node:test";
import { pageFor, wait } from "./fixture.ts";

test("tag prefixes suggest names and bookmarks, then complete the active filter", async () => {
  const page = await pageFor();
  await page.keyboard.press("#");
  await page.locator("#search-dialog").waitFor();
  const query = page.locator("#panel-query");
  assert.equal(await query.inputValue(), "#");
  await page.keyboard.type("D");
  assert.equal(await query.inputValue(), "#D");
  await wait(page, () => document.querySelector("#panel-count")!.textContent === "4 Ergebnisse");
  assert.deepEqual(await page.locator("#panel-tags button").allTextContents(), ["#design", "#dev", "#docs", "#dresden"]);
  assert.equal(await page.locator(".panel-result").count(), 4);
  await page.locator('[data-panel-tag="dev"]').click();
  assert.equal(await query.inputValue(), "#dev ");
  await wait(page, () => document.querySelector("#panel-count")!.textContent === "2 Ergebnisse");
  await query.fill("#travel Guide #dr");
  await wait(page, () => document.querySelector("#panel-count")!.textContent === "1 Ergebnis");
  assert.deepEqual(await page.locator("#panel-tags button").allTextContents(), ["#dresden"]);
  await page.locator('[data-action="all-results"]').click();
  const suggestion = page.locator('#bookmark-tags [data-bookmark-tag="dresden"]');
  await suggestion.click();
  assert.equal(await page.locator("#bookmark-query").inputValue(), "#travel Guide #dresden ");
  await wait(page, () => document.querySelector("#bookmark-count")!.textContent === "1 Bookmark");
});

test("bookmark AND filters, matching tag suggestions, text search, list layout and search panel", async () => {
  const page = await pageFor();
  await page.locator("#nav-bookmarks").click();
  await page.locator(".bookmark-card").first().waitFor();
  await page.locator("#bookmark-query").fill("#travel #city");
  await wait(
    page,
    () =>
      document.querySelector("#bookmark-count")!.textContent === "2 Bookmarks",
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
      document.querySelector("#bookmark-count")!.textContent === "1 Bookmark",
  );
  assert.match((await page.locator(".bookmark-title").textContent())!, /Dresden/);
  await page
    .getByRole("button", { name: "Listenansicht", exact: true })
    .click();
  assert.match((await page.locator("#bookmarks").getAttribute("class"))!, /list/);
  await page.locator("#nav-dashboard").click();
  await page.keyboard.press("Meta+p");
  await page.locator("#panel-query").fill("#travel #city #dresden");
  await wait(
    page,
    () => document.querySelector("#panel-count")!.textContent === "1 Ergebnis",
  );
  assert.equal(await page.locator(".panel-result").count(), 1);
  assert.match((await page.locator(".panel-result").textContent())!, /Dresden/);
  const box = (await page.locator("#search-dialog").boundingBox())!;
  assert.ok(box.y > 550, "search belongs in the lower screen");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#search-dialog").isVisible(), false);
});

test("bookmark create, edit, archive, delete and export through the real API", async () => {
  const page = await pageFor();
  await page.route("**/api/orbia/bookmark-metadata", route => route.fulfill({ json: { title: "", description: "" } }));
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
      document.querySelector("#bookmark-count")!.textContent === "1 Bookmark",
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
      document.querySelector("#bookmark-count")!.textContent === "0 Bookmarks",
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
      document.querySelector("#bookmark-count")!.textContent ===
      "0 Bookmarks im Archiv",
  );
  const data = await page.evaluate(async () => {
    const r = await fetch("/api/orbia/export");
    return r.json();
  });
  assert.equal(data.version, 1);
  assert.ok(data.dashboard.pages.length >= 1);
});
