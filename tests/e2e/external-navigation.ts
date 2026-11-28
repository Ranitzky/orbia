import assert from "node:assert/strict";
import { test } from "node:test";
import { origin, pageFor, wait } from "./fixture.ts";

test("Linkding omnibox opens its query and Raycast opens the editor by ID", async () => {
  const page = await pageFor();
  await page.goto(origin + "/bookmarks?q=%23dresden");
  await wait(
    page,
    () =>
      document.querySelector("#bookmark-count")!.textContent === "1 Bookmark",
  );
  assert.equal(await page.locator("#bookmark-query").inputValue(), "#dresden");
  assert.equal(await page.locator("#bookmark-query").evaluate(el => document.activeElement === el), true);
  const id = await page
    .locator("[data-edit-bookmark]")
    .getAttribute("data-edit-bookmark");
  await page.goto(origin + "/bookmarks/" + id + "/edit");
  await page.getByRole("dialog", { name: "Bookmark bearbeiten" }).waitFor();
  assert.match(
    await page.getByLabel("Titel", { exact: true }).inputValue(),
    /Dresden/,
  );
});
