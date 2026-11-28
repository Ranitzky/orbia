import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const web = new URL("../internal/web/", import.meta.url);
const templates = new URL("src/html/", web);
const assets = new URL("static/", web);
const check = process.argv.includes("--check");

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("src/main.ts", web))],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
  write: false,
  legalComments: "none",
});
const js = bundle.outputFiles[0].text;
const hash = createHash("sha256").update(js).digest("hex").slice(0, 16);
const shell = await readFile(new URL("index.html", templates), "utf8");
const include = /^( *)<!-- include ([\w-]+) -->$/gm;
const partials = new Map<string, string>();
for (const [, , name] of shell.matchAll(include)) {
  partials.set(name, await readFile(new URL(name + ".html", templates), "utf8"));
}
const html = shell.replace(include, (_, indent: string, name: string) =>
  partials.get(name)!.trimEnd().split("\n").map(line => line && indent + line).join("\n"),
).replace("{{appHash}}", hash);

for (const [name, contents] of [["app.js", js], ["index.html", html]]) {
  const path = new URL(name, assets);
  if (check) {
    if (await readFile(path, "utf8") !== contents) {
      throw new Error(`${name} is out of date. Run npm run build:web.`);
    }
  } else {
    await writeFile(path, contents);
  }
}
