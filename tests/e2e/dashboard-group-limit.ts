import assert from "node:assert/strict";
import { test } from "node:test";
import { pageFor } from "./fixture.ts";

test("adding a seventh group shows an error toast", async () => {
  const page = await pageFor({}, "en");
  await page.keyboard.press("Meta+e");
  const editBar = page.locator("#edit-bar");
  await editBar.getByRole("button", { name: "Add page", exact: true }).click();
  const newPage = page.getByRole("dialog", { name: "Add dashboard page", exact: true });
  await newPage.getByLabel("Name", { exact: true }).fill("Group limit");
  await newPage.getByRole("button", { name: "Save", exact: true }).click();
  const editor = page.locator("#editor-dialog");
  await editor.waitFor({ state: "hidden" });

  const add = editBar.getByRole("button", { name: "Add group", exact: true });
  for (let number = 1; number <= 6; number++) {
    await add.click();
    await editor.getByLabel("Name", { exact: true }).fill(`Group ${number}`);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
  }

  await add.click();
  const toast = page.locator("#toast.error");
  await toast.waitFor();
  assert.equal(await toast.textContent(), "This page already has six groups.");
  assert.equal(await editor.isVisible(), false);
  assert.equal(await page.locator(".group-card").count(), 6);
});
