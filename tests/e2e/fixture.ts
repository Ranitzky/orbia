import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { after, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Browser, BrowserContext, BrowserContextOptions, Page } from "playwright";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { chromium, webkit } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
) as typeof import("playwright");

export let browser: Browser;
export let context: BrowserContext;
export let origin: string;
export let setupOrigin: string;
export const errors: string[] = [];

let server: ReturnType<typeof spawn> | undefined;
let temporary: string | undefined;

before(
  async () => {
    temporary = await mkdtemp(path.join(tmpdir(), "orbia-e2e-"));
    const binary = path.join(temporary, "server");
    const build = spawnSync(
      "go",
      ["test", "-c", "./internal/app", "-o", binary],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(build.status, 0, build.stderr);
    const fixtureServer = spawn(binary, ["-test.run=^TestBrowserServer$"], {
      cwd: root,
      env: { ...process.env, ORBIA_BROWSER_SERVER: "1" },
      stdio: ["pipe", "pipe", "inherit"],
    });
    server = fixtureServer;
    const output = createInterface({ input: fixtureServer.stdout });
    origin = await new Promise<string>((resolve, reject) => {
      output.on("line", (line) => {
        if (line.startsWith("SETUP ")) setupOrigin = line.slice("SETUP ".length);
        if (line.startsWith("http://")) resolve(line);
      });
      fixtureServer.once("error", reject);
      fixtureServer.once("exit", (code) =>
        reject(new Error(`HTTP fixture stopped (${code})`)),
      );
    });
    const engine = process.env.ORBIA_BROWSER === "webkit" ? webkit : chromium;
    browser = await engine.launch({
      headless: true,
      ...(engine === chromium ? { ignoreDefaultArgs: ["--hide-scrollbars"] } : {}),
      ...(process.env.PLAYWRIGHT_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE }
        : {}),
    });
  },
  { timeout: 120000 },
);

after(async () => {
  await context?.close();
  await browser?.close();
  server?.stdin?.end();
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

export async function pageFor(options: BrowserContextOptions = {}, language: "de" | "en" | null = "de") {
  await context?.close();
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    storageState: {
      cookies: [],
      origins: language ? [{ origin, localStorage: [{ name: "orbia.language", value: language }] }] : [],
    },
    ...options,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page
    .getByLabel(language === "de" ? "Passwort" : "Password", { exact: true })
    .fill("a-long-test-password");
  await page.getByRole("button", { name: language === "de" ? "Orbia öffnen" : "Open Orbia", exact: true }).click();
  await page.locator("#app").waitFor({ state: "visible" });
  return page;
}
export async function wait(
  page: Page,
  ...predicate: [condition: () => boolean] | [condition: (arg: string) => boolean, arg: string]
) {
  if (predicate.length === 2) return page.waitForFunction(...predicate);
  return page.waitForFunction(predicate[0], undefined);
}
export async function command(page: Page, text: string) {
  await page.keyboard.press("Meta+k");
  await page.locator("#command-query").fill(text);
  await page.keyboard.press("Enter");
}
