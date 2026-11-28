import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { command, errors, pageFor, wait } from "./fixture.ts";

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
  await page.keyboard.type("fi");
  assert.match((await page.locator("#quick-status").textContent())!, /Figma/);
  await page.keyboard.press("Escape");
  await page.locator('.mobile-nav [data-action="search"]').click();
  await page.locator("#panel-query").fill("Travel Guide");
  await wait(
    page,
    () => document.querySelector("#panel-count")!.textContent === "2 Ergebnisse",
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
      () => !!document.activeElement!.closest("#search-dialog"),
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
