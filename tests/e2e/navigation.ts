import assert from "node:assert/strict";
import { test } from "node:test";
import { origin, pageFor, wait } from "./fixture.ts";

test("main navigation highlights only the current view", async () => {
  const page = await pageFor();
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  const items = page.locator(".header-actions .nav-item");
  assert.equal(await items.count(), 2);
  assert.equal(await items.locator("svg").count(), 2);
  assert.equal(await items.locator("kbd").count(), 0);
  assert.ok((await items.allTextContents()).every(text => !text.trim()));
  for (const name of ["Bookmarks", "Dashboard"]) {
    const button = nav.getByRole("button", { name, exact: true });
    assert.equal(await button.locator("span").innerText(), name);
    await button.click();
    await page.locator(name === "Bookmarks" ? "#bookmark-view" : "#dashboard-view").waitFor();
    if (name === "Bookmarks") {
      await page.keyboard.type("Dresden");
      assert.equal(await page.locator("#bookmark-query").inputValue(), "Dresden");
    }
    assert.equal(await nav.locator(".active").count(), 1);
    assert.ok(await button.evaluate(el => el.classList.contains("active")));
    assert.equal(await nav.locator('[aria-current="page"]').count(), 1);
    assert.equal(await button.getAttribute("aria-current"), "page");
  }
});

test("the group border glow follows the mouse and returns to its starting corner", async () => {
  const page = await pageFor({ reducedMotion: "no-preference" });
  const card = page.locator(".group-card").first();
  await card.waitFor();
  const { x, y, width, height } = (await card.boundingBox())!;
  const startingMask = await card.evaluate(el => getComputedStyle(el, "::before").maskImage);
  assert.notEqual(startingMask, "none");

  await page.mouse.move(x + width - 12, y + height - 12);
  await wait(page, () => {
    const style = getComputedStyle(document.querySelector(".group-card")!, "::before");
    return parseFloat(style.getPropertyValue("--group-glow-x")) > 85 &&
      parseFloat(style.getPropertyValue("--group-glow-y")) > 85;
  });
  assert.notEqual(await card.evaluate(el => getComputedStyle(el, "::before").maskImage), startingMask);

  await page.mouse.move(0, 0);
  await wait(page, mask => getComputedStyle(document.querySelector(".group-card")!, "::before").maskImage === mask, startingMask);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.move(x + width - 12, y + height - 12);
  assert.equal(await card.evaluate(el => getComputedStyle(el, "::before").maskImage), startingMask);
});

test("a published update marks the Settings icon and links to the guide inside Settings", async () => {
  const page = await pageFor();
  await page.clock.install();
  let available = false;
  await page.route("**/api/orbia/update", route => route.fulfill({ json: { available } }));
  const initialStatus = page.waitForResponse("**/api/orbia/update");
  await page.reload();
  await initialStatus;
  const settings = page.getByRole("button", { name: "Einstellungen", exact: true });
  const indicator = settings.locator("#settings-update-indicator");
  const notice = page.locator("#update-notice");
  await indicator.waitFor({ state: "hidden" });

  available = true;
  await page.clock.fastForward(60_000);
  await indicator.waitFor();
  assert.equal(await settings.getAttribute("aria-describedby"), "settings-update-indicator");
  assert.equal(await indicator.textContent().then(text => text!.trim()), "Update verfügbar");
  await notice.waitFor({ state: "hidden" });
  await settings.click();
  const status = page.locator("#settings-dialog [role=status]:has(+ .settings-section.settings-general)");
  await status.waitFor();
  await notice.getByText("Update verfügbar", { exact: true }).waitFor();
  const guide = status.getByRole("link", { name: "Update-Anleitung öffnen" });
  assert.equal(await guide.getAttribute("href"), "https://github.com/Ranitzky/orbia#update-orbia");

  available = false;
  await page.clock.fastForward(60_000);
  await notice.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Einstellungen schließen" }).click();
  await indicator.waitFor({ state: "hidden" });
  assert.equal(await settings.getAttribute("aria-describedby"), null);
});

test("dashboard and bookmarks keyboard shortcuts switch views and appear in settings", async () => {
  const page = await pageFor();
  for (const modifier of ["Meta", "Control"]) {
    await page.keyboard.press(`${modifier}+b`);
    await page.waitForURL(`${origin}/bookmarks`);
    await page.locator("#bookmark-view").waitFor();
    assert.equal(await page.locator("#bookmark-query").evaluate(el => document.activeElement === el), true);
    await page.keyboard.press(`${modifier}+d`);
    await page.waitForURL(`${origin}/`);
    await page.locator("#dashboard-view").waitFor();
  }

  await page.locator('.header-actions [data-action="settings"]').click();
  await page.getByText("Tastatur", { exact: true }).click();
  const shortcuts = page.locator(".shortcut-list");
  for (const [label, keys] of [
    ["Dashboard öffnen", "⌘ / Ctrl D"],
    ["Bookmarks öffnen", "⌘ / Ctrl B"],
  ]) {
    const shortcut = shortcuts.getByText(label, { exact: true });
    await shortcut.waitFor();
    assert.equal(await shortcut.evaluate(el => el.nextElementSibling!.textContent), keys);
  }
});

test("switching to scrollable bookmarks preserves the content position and width", async () => {
  const page = await pageFor();
  // Force document overflow independently of the bookmark count while keeping native scrollbars.
  await page.addStyleTag({ content: "#bookmark-view { min-height: 120vh; }" });
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  const layout = () => page.locator("#main").evaluate((main) => {
    const { left, width } = main.getBoundingClientRect();
    const root = document.scrollingElement!;
    return { left, width, scrollable: root.scrollHeight > root.clientHeight };
  });

  const dashboard = await layout();
  assert.equal(dashboard.scrollable, false);

  await nav.getByRole("button", { name: "Bookmarks", exact: true }).click();
  await page.locator(".bookmark-card").first().waitFor();
  assert.deepEqual(await layout(), { ...dashboard, scrollable: true });

  await nav.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.locator("#dashboard-view").waitFor();
  assert.deepEqual(await layout(), dashboard);
});
