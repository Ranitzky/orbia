import assert from "node:assert/strict";
import { test } from "node:test";
import { command, context, pageFor } from "./fixture.ts";

test("default quicklinks, prefix-only search, target preview and Enter navigation", async () => {
  const page = await pageFor();
  const names = await page.locator(".quick-name").allTextContents();
  assert.deepEqual(names, ["Amazon", "eBay", "Gmail", "GitHub", "Figma", "Notion", "Booking.com"]);
  await page.keyboard.type("f");
  assert.equal(await page.locator(".quicklink.matched").count(), 1);
  assert.match(
    (await page.locator("#quick-status").textContent())!,
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

test("quicklinks launch immediately by full keyboard code or touch", async () => {
  for (const mobile of [false, true]) {
    const page = await pageFor(mobile ? {
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    } : {});
    await context.route("https://github.com/**", route => route.fulfill({ body: "GitHub" }));
    if (mobile) {
      await page.locator('[data-link="git"]').tap();
    } else {
      await page.keyboard.type("gi");
      assert.match((await page.locator("#quick-status").textContent())!, /GitHub/);
      await page.keyboard.press("t");
    }
    await page.waitForURL("https://github.com/");
  }
});

test("keyboard editing persists, duplicate codes rejected, page switching and commands work", async () => {
  const page = await pageFor();
  await page.keyboard.press("Meta+e");
  await page.locator("#edit-bar").waitFor();
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
    (await page.locator("#editor-error").textContent())!,
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
    (await page.locator(".page-tab[aria-selected=true]").textContent())!,
    /Home/,
  );
  await page.keyboard.press("2");
  assert.match(
    (await page.locator(".page-tab[aria-selected=true]").textContent())!,
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
