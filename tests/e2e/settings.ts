import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, origin, pageFor, setupOrigin, wait } from "./fixture.ts";

test("settings issue and revoke client credentials and import from Linkding", async () => {
  const page = await pageFor({}, "en");
  await page.getByRole("button", {name: "Settings", exact: true}).click();
  await page.getByText("Linkding integrations", { exact: true }).click();
  await page.getByLabel("App name").fill("Browser test");
  await page.getByRole("button", {name: "Generate token"}).click();
  const value = page.getByLabel("New token · copy it now");
  await value.waitFor();
  const token = await value.inputValue();
  // Plain HTTP outside localhost does not expose the Clipboard API.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined });
  });
  const appName = page.getByLabel("App name");
  const settings = page.getByRole("dialog", { name: "Settings" });
  const copies = [
    ["copy-url", "Server address copied.", origin, "Please copy the address from the field."],
    ["copy-token", "Token copied.", token, "The token is selected. Copy it now."],
  ];
  for (const [action, message, expected] of copies) {
    const button = settings.locator(`[data-action="${action}"]`);
    await button.click();
    await button.locator("svg").waitFor();
    assert.equal(await button.locator("span").isVisible(), false);
    assert.equal(await button.getAttribute("aria-label"), "Copy");
    assert.equal(await settings.locator('[role="status"].sr-only').filter({ hasText: message }).count(), 1);
    await appName.fill("");
    await appName.press("ControlOrMeta+v");
    assert.ok(await appName.inputValue() === expected, `${action} should paste the copied value`);
  }
  await appName.fill("");
  await page.evaluate(() => { document.execCommand = () => false; });
  for (const [action, , , manualCopy] of copies) {
    const button = settings.locator(`[data-action="${action}"]`);
    await button.click();
    await settings.locator('[role="status"].error').filter({ hasText: manualCopy }).waitFor();
    assert.equal(await button.locator("svg").isVisible(), false);
    assert.equal(await button.locator("span").isVisible(), true);
  }
  const headers = {Authorization: "Token " + token};
  const client = page.context().request;
  assert.equal((await client.get(origin + "/api/user/profile/", {headers})).status(), 200);
  assert.equal((await client.get(origin + "/api/orbia/export", {headers})).status(), 401);
  await page.getByRole("button", {name:"Close settings"}).click();
  await wait(page, () => document.querySelector<HTMLInputElement>("#token-value")!.value === "");
  await page.getByRole("button", {name:"Settings", exact:true}).click();
  assert.equal(await settings.locator(".copy-status.error").count(), 0);
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#token-list .copy-field").filter({hasText:"Browser test"}).getByText("Revoke").click();
  await page.getByText("Token revoked.", {exact:true}).waitFor();
  assert.equal((await client.get(origin + "/api/user/profile/", {headers})).status(), 401);

  await page.getByText("Import from Linkding", { exact: true }).click();
  await page.getByLabel("Linkding server", {exact:true}).fill("http://192.168.1.20:9090");
  await page.getByLabel("Linkding API token", {exact:true}).fill("test-token-with-at-least-32-characters");
  await page.getByRole("button", {name:"Start import"}).click();
  await page.getByText("1 changed, 0 unchanged.", {exact:true}).waitFor();
  assert.equal(await page.locator("#source-token").inputValue(), "");
  await page.getByRole("button", {name:"Close settings"}).click();
  await page.locator("#nav-bookmarks").click();
  await page.getByText("Imported via settings", {exact:true}).waitFor();
});

test("first-run setup, passwordless access and password changes in Settings", async () => {
  const owner = await browser.newContext();
  const guest = await browser.newContext();
  try {
    const page = await owner.newPage();
    await page.goto(setupOrigin);
    const mode = page.getByLabel("Sign-in method");
    const save = page.getByRole("button", {name: "Save access settings"});
    const warning = page.getByText("Anyone who can reach this address can manage your bookmarks, app tokens, and settings.");
    await mode.selectOption("open");
    await warning.waitFor();
    const setupWarningColor = await warning.evaluate(el => getComputedStyle(el).color);
    await save.click();
    await page.locator("#app").waitFor();
    const other = await guest.newPage();
    await other.goto(setupOrigin);
    await other.locator("#app").waitFor();
    const settings = page.getByRole("button", {name:"Settings",exact:true});
    await settings.click();
    await page.getByText("Access", { exact: true }).click();
    await warning.waitFor();
    assert.equal(setupWarningColor, await warning.evaluate(el => getComputedStyle(el).color));
    await mode.selectOption("password");
    await page.getByLabel("New password").fill("test-owner-password");
    await save.click();
    await page.getByText("Access settings saved.").waitFor();
    await other.reload();
    await other.getByRole("button", {name:"Open Orbia"}).waitFor();
    await page.getByLabel("Current password").fill("incorrect-password");
    await page.getByLabel("New password").fill("replacement-password");
    await save.click();
    await page.getByText("Incorrect current password.").waitFor();
    await page.getByLabel("Current password").fill("test-owner-password");
    await save.click();
    await page.getByText("Access settings saved.").waitFor();
    await other.getByLabel("Password",{exact:true}).fill("replacement-password");
    await other.getByRole("button",{name:"Open Orbia"}).click();
    await other.locator("#app").waitFor();
    await page.getByLabel("Current password").fill("replacement-password");
    await mode.selectOption("open");
    await save.click();
    await page.getByText("Access settings saved.").waitFor();
    await other.reload();
    await other.locator("#app").waitFor();
  } finally {
    await owner.close();
    await guest.close();
  }
});
