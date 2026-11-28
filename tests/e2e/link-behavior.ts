import assert from "node:assert/strict";
import { test } from "node:test";
import type { Locator } from "playwright";
import { context, origin, pageFor, wait } from "./fixture.ts";

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

  async function dropOn(target: Locator, fraction: number, save = true) {
    const start = (await booking.boundingBox())!;
    const end = (await target.boundingBox())!;
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
  await wait(page, () => document.querySelector("#bookmark-count")!.textContent === "1 Bookmark");
  await title.click();
  await page.waitForURL(url);
  assert.equal((await (await client.get(detail)).json()).unread, false);
  await page.goto(origin + "/bookmarks");
  await page.locator("#unread-toggle").click();
  await wait(page, () => document.querySelector("#unread-toggle")!.getAttribute("aria-pressed") === "true");
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
  const url = (await result.getAttribute("href"))!;
  await context.route(url, route => route.fulfill({body:"Article"}));
  const article = context.waitForEvent("page");
  await page.keyboard.press("Enter");
  const destination = await article;
  await destination.waitForURL(url);
  await destination.close();
});
