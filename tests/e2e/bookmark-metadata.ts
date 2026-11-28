import assert from "node:assert/strict";
import { test } from "node:test";
import { pageFor, wait } from "./fixture.ts";

declare global {
  interface Window {
    releaseMetadataBody: () => void;
  }
}

test("new bookmarks fill page metadata and keep a manually edited title on URL changes", async () => {
  const page = await pageFor({ reducedMotion: "no-preference" });
  const firstResponse = Promise.withResolvers<void>();
  const requests: string[] = [];
  await page.evaluate(() => {
    const bodyReady = new Promise<void>(resolve => { window.releaseMetadataBody = resolve; });
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (response.headers.get("X-Orbia-Metadata-Fetching") === "1") {
        const readJSON = response.json.bind(response);
        response.json = async () => {
          await bodyReady;
          return readJSON();
        };
      }
      return response;
    };
  });
  await page.route("**/api/orbia/bookmark-metadata", async route => {
    const { url } = route.request().postDataJSON();
    requests.push(url);
    if (url.endsWith("/first")) {
      await firstResponse.promise;
      return route.fulfill({
        headers: { "X-Orbia-Metadata-Fetching": "1" },
        json: { title: "Grüße aus Dresden", description: "Beschreibung der ersten Seite" },
      });
    }
    return route.fulfill({ json: { title: "Neue Seite", description: "Beschreibung der neuen Seite" } });
  });
  await page.locator("#nav-bookmarks").click();
  await page.getByRole("button", { name: "Bookmark hinzufügen", exact: true }).first().click();
  const url = page.getByLabel("URL", { exact: true });
  const title = page.getByLabel("Titel", { exact: true });
  const description = page.locator("#field-description");
  const titleBefore = await title.boundingBox();
  const descriptionBefore = await description.boundingBox();
  try {
    await page.clock.install();
    for (const partial of ["https://g", "https://metadata.t", "https://8.8"]) {
      await url.fill(partial);
      await page.clock.runFor(450);
      assert.deepEqual(requests, []);
      assert.equal(await page.locator('.bookmark-metadata-fields[aria-busy="true"]').count(), 0);
      assert.equal(await page.locator("#bookmark-metadata-status").isVisible(), false);
    }
    const requestStarted = page.waitForRequest(request => request.url().endsWith("/api/orbia/bookmark-metadata"));
    await url.fill("https://metadata.test/first");
    await requestStarted;
    assert.equal(await page.locator('.bookmark-metadata-fields[aria-busy="true"]').count(), 0);
    firstResponse.resolve();
    await page.locator('.bookmark-metadata-fields[aria-busy="true"]').waitFor();
    assert.equal(await page.locator("#bookmark-metadata-status").isVisible(), false);
    assert.deepEqual(await title.boundingBox(), titleBefore);
    assert.deepEqual(await description.boundingBox(), descriptionBefore);
    const glow = () => page.locator(".bookmark-metadata-fields label").evaluateAll(labels => labels.map(label => {
      const style = getComputedStyle(label, "::after");
      return { animation: style.animationName, border: style.borderTopWidth };
    }));
    assert.deepEqual(await glow(), Array(2).fill({ animation: "bookmark-metadata-glow", border: "2px" }));
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.deepEqual(await glow(), Array(2).fill({ animation: "none", border: "2px" }));
    await page.emulateMedia({ reducedMotion: "no-preference" });
  } finally {
    firstResponse.resolve();
    await page.evaluate(() => window.releaseMetadataBody());
  }
  await wait(page, () => document.querySelector<HTMLInputElement>("#field-description")!.value === "Beschreibung der ersten Seite");
  assert.equal(await title.inputValue(), "Grüße aus Dresden");
  assert.deepEqual(await title.boundingBox(), titleBefore);
  assert.equal(await page.locator('.bookmark-metadata-fields[aria-busy="true"]').count(), 0);

  assert.equal(await page.locator('.bookmark-metadata-fields[data-fetch-glow="fading"]').count(), 1);
  const fadingLabel = page.locator(".bookmark-metadata-fields label").first();
  assert.equal(await fadingLabel.evaluate(label => getComputedStyle(label, "::after").animationPlayState.split(",")[0]), "running");
  await page.locator(".bookmark-metadata-fields[data-fetch-glow]").waitFor({ state: "detached" });

  await title.fill("Mein Titel");
  const immediatelyAfterPaste = await url.evaluate((input: HTMLInputElement) => {
    input.value = "https://metadata.test/second";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));
    return {
      glow: document.querySelector(".bookmark-metadata-fields")!.hasAttribute("data-fetch-glow"),
      description: document.querySelector<HTMLInputElement>("#field-description")!.value,
    };
  });
  assert.deepEqual(immediatelyAfterPaste, { glow: true, description: "" });
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await page.locator("#editor-dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Mein Titel bearbeiten", exact: true }).click();
  await page.getByRole("dialog", { name: "Bookmark bearbeiten" }).waitFor();
  assert.equal(await url.inputValue(), "https://metadata.test/second");
  assert.equal(await title.inputValue(), "Mein Titel");
  assert.equal(await description.inputValue(), "Beschreibung der neuen Seite");
});

test("an empty metadata response leaves a visible message and allows manual saving", async () => {
  const page = await pageFor({ viewport: { width: 320, height: 720 } });
  await page.route("**/api/orbia/bookmark-metadata", route => {
    const { url } = route.request().postDataJSON();
    return route.fulfill(url === "https://no-metadata.test/"
      ? { json: { title: "", description: "" } }
      : { status: 204 });
  });
  await page.locator('.mobile-nav [data-action="bookmarks"]').click();
  await page.getByRole("button", { name: "Bookmark hinzufügen", exact: true }).first().click();
  const title = page.getByLabel("Titel", { exact: true });
  const titleBefore = await title.boundingBox();
  const url = page.getByLabel("URL", { exact: true });
  for (const partial of ["https://www.goo", "https://orbia.ran"]) {
    const response = page.waitForResponse(result => result.url().endsWith("/api/orbia/bookmark-metadata"));
    await url.fill(partial);
    assert.equal((await response).status(), 204);
    await page.locator('.bookmark-metadata-fields[aria-busy="true"]').waitFor({ state: "detached" });
    assert.equal(await page.locator("#bookmark-metadata-status").isVisible(), false);
  }
  await url.fill("https://no-metadata.test/");
  await page.getByText("Seitendaten nicht verfügbar.", { exact: true }).waitFor({ timeout: 5000 });
  assert.deepEqual(await title.boundingBox(), titleBefore);
  await title.fill("Mein Titel ohne Metadaten");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await page.getByRole("button", { name: "Mein Titel ohne Metadaten bearbeiten", exact: true }).waitFor();
});
