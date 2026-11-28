import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request } from "playwright";
import { pageFor, wait } from "./fixture.ts";

test("a fresh browser starts in English and remembers a switch to German", async () => {
  const page = await pageFor({}, null);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const language = page.getByLabel("Language", { exact: true });
  assert.equal(await language.inputValue(), "en");
  assert.equal(await page.evaluate(() => performance.getEntriesByType("resource")
    .some(entry => new URL(entry.name).pathname === "/de.js")), false);
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
  await wait(page, () => document.querySelector("#bookmark-count")!.textContent === "1 Bookmark");
  const title = await page.locator(".bookmark-title").textContent();
  assert.equal(await page.evaluate(() => performance.getEntriesByType("resource")
    .some(entry => new URL(entry.name).pathname === "/en.js")), false);
  await page.getByRole("button", {name:"Einstellungen", exact:true}).click();
  const reads: string[] = [];
  const record = (request: Request) => reads.push(new URL(request.url()).pathname);
  page.on("request", record);
  await page.getByLabel("Sprache", {exact:true}).selectOption("en");
  await page.getByRole("dialog", {name:"Settings", exact:true}).waitFor();
  page.off("request", record);
  assert.deepEqual(reads, ["/en.js"]);
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.equal(await page.getByLabel("Language", {exact:true}).inputValue(), "en");
  await page.getByRole("button", {name:"Close settings"}).click();
  assert.equal(await page.getByLabel("Filter bookmarks").inputValue(), "Guide #dresden");
  assert.equal(await page.locator("#bookmark-query").getAttribute("placeholder"), "Search or combine #tags …");
  assert.equal(await page.locator(".bookmark-title").textContent(), title);
  await page.getByRole("button", {name:"Edit " + title, exact:true}).click();
  await page.getByRole("dialog", {name:"Edit bookmark"}).waitFor();
  assert.equal(await page.getByLabel("Title", {exact:true}).inputValue(), title);
  assert.equal(await page.getByLabel("Tags", {exact:true}).getAttribute("placeholder"), "Separate tags with commas or enter hashtags.");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+p");
  await page.getByRole("searchbox", {name:"Search bookmarks"}).fill("Guide #dresden");
  await wait(page, () => document.querySelector("#panel-count")!.textContent === "1 result");
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

test("a failed catalog switch keeps the current language and preference", async () => {
  const page = await pageFor();
  await page.route(/\/en\.js\?/, route => route.abort());
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click();
  const language = page.getByLabel("Sprache", { exact: true });
  await language.selectOption("en");
  await page.getByText("Die Sprachdatei konnte nicht geladen werden.", { exact: true }).waitFor();
  assert.equal(await language.inputValue(), "de");
  assert.equal(await page.locator("html").getAttribute("lang"), "de");
  assert.equal(await page.evaluate(() => localStorage.getItem("orbia.language")), "de");
});

test("a missing startup catalog falls back to the other language", async () => {
  const page = await pageFor({}, null);
  await page.route(/\/en\.js\?/, route => route.abort());
  await page.reload();
  await page.getByRole("button", { name: "Einstellungen", exact: true }).waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "de");
  assert.equal(await page.evaluate(() => localStorage.getItem("orbia.language")), null);
});
