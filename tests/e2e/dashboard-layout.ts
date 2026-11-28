import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { pageFor, wait } from "./fixture.ts";

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
      const card = getComputedStyle(el.firstElementChild!);
      return {
        columns: cards.filter((rect) => rect.top === cards[0].top).length,
        bordered: parseFloat(card.borderTopWidth) > 0,
        padded: parseFloat(card.paddingLeft) > 0,
        linkDisplay: getComputedStyle(el.querySelector(".quicklink")!).display,
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
        display: getComputedStyle(el.firstElementChild!).display,
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

test("dashboard controls stay in the header on full and empty pages", async () => {
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
    const root = document.scrollingElement!;
    return root.scrollHeight > root.clientHeight;
  });
  const grid = page.locator("#groups");
  const gridScrolls = () => grid.evaluate(el => el.scrollHeight > el.clientHeight);
  const gridMask = () => grid.evaluate(el => getComputedStyle(el).maskImage);
  const control = page.locator('.header .nav-item[data-action="command"]');
  const controlTop = () => control.evaluate(el => el.getBoundingClientRect().top);
  const top = await controlTop();
  assert.ok(top >= 0 && top < 76);
  await control.click();
  await page.locator("#command-dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await scrolls(), false);
  assert.equal(await gridScrolls(), false);
  assert.equal(await gridMask(), "none");

  await page.getByRole("tab", { name: /Work/ }).click();
  await grid.locator(".empty-state").waitFor();
  assert.equal(await controlTop(), top);
  assert.equal(await scrolls(), false);

  await page.getByRole("tab", { name: /Home/ }).click();
  await grid.locator(".quicklink").last().waitFor();
  await page.setViewportSize({ width: 1440, height: 550 });
  assert.equal(await controlTop(), top);
  assert.equal(await scrolls(), false);
  assert.equal(await gridScrolls(), true);
  await wait(page, () => getComputedStyle(document.querySelector("#groups")!).maskImage !== "none");
  await grid.evaluate(el => { el.scrollTop = el.scrollHeight; });
  assert.ok(await grid.evaluate(el => el.scrollTop > 0));
  await wait(page, () => getComputedStyle(document.querySelector("#groups")!).maskImage === "none");
  await grid.evaluate(el => { el.scrollTop = 0; });
  await wait(page, () => getComputedStyle(document.querySelector("#groups")!).maskImage !== "none");
  assert.equal(await controlTop(), top);
  await page.setViewportSize({ width: 390, height: 768 });
  assert.equal(await scrolls(), true);
  assert.equal(await gridMask(), "none");
});

test("quick status stays below the grid when typing shortcuts", async () => {
  const page = await pageFor();
  const grid = page.locator("#groups");
  const status = page.locator("#quick-status");
  const positions = () => page.locator("#groups, #quick-status").evaluateAll(
    elements => elements.map(el => el.getBoundingClientRect().top + window.scrollY),
  );
  const height = 844;
  for (const width of [1440, 820, 641, 390, 320]) {
    await page.setViewportSize({ width, height });
    const before = await positions();
    await page.keyboard.type("f");
    assert.deepEqual(await positions(), before);
    const gridBox = (await grid.boundingBox())!;
    const statusBox = (await status.boundingBox())!;
    assert.ok(gridBox.y + gridBox.height <= statusBox.y);
    if (width > 900) {
      // WebKit can report the bottom edge a fraction of a CSS pixel off.
      assert.equal(Math.round(statusBox.y + statusBox.height), height - 16);
    }
    assert.ok(statusBox.x + statusBox.width <= width);
    assert.equal(await grid.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.keyboard.type("zz");
    assert.match((await status.textContent())!, /Kein passendes Kürzel/);
    assert.deepEqual(await positions(), before);
    await page.keyboard.press("Escape");
    assert.equal(await status.isVisible(), false);
    assert.deepEqual(await positions(), before);
  }
});
