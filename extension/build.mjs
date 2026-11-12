// Local build: copies the extension's files into extension/dist/ and checks them.
// Load the printed folder in Chrome or Edge: chrome://extensions → Developer mode → Load unpacked.
// Usage: node extension/build.mjs
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist", "vtiger-reader-extension");

const files = [
  "manifest.json",
  "background.js",
  "options.html",
  "options.js",
  "crm-look.css",
  "crm-shadow.js",
  "crm-layout.js",
];

// 1. The manifest must parse and list the files we copy.
const manifest = JSON.parse(await readFile(join(here, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("manifest_version must be 3");

// 2. Every script must at least parse.
for (const f of files.filter((f) => f.endsWith(".js"))) {
  const check = spawnSync(process.execPath, ["--check", join(here, f)], { encoding: "utf8" });
  if (check.status !== 0) {
    process.stderr.write(check.stderr);
    throw new Error(`syntax error in ${f}`);
  }
}

// 3. Copy into dist/.
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const f of files) {
  await cp(join(here, f), join(out, f));
}

// 4. Zip of the same folder, to move it to Windows (unzip, then Load unpacked).
const zip = join(here, "dist", `vtiger-reader-extension-${manifest.version}.zip`);
await rm(zip, { force: true });
const packed = spawnSync("python3", ["-m", "zipfile", "-c", zip, ...files.map((f) => join(out, f))], { encoding: "utf8" });
if (packed.status !== 0) {
  process.stderr.write(packed.stderr);
  throw new Error("zip failed (needs python3)");
}

console.log("Build ready (load this folder as unpacked):");
console.log(out);
console.log("Zip (unzip on Windows, then load the folder unpacked):");
console.log(zip);
