#!/usr/bin/env node
// Bundles bits/<name>/src/*.js (in filename order) into the single-file
// bits/<name>/main.js that Plethora runs. No dependencies.
//   node tools/build-bit.mjs beast
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const name = process.argv[2];
if (!name) {
  console.error("usage: node tools/build-bit.mjs <bit-name>");
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "bits", name);
const srcDir = join(root, "src");
const files = readdirSync(srcDir).filter((f) => f.endsWith(".js")).sort();
// Section banners name modules without paths or extensions: Plethora's
// validator reads path-like strings in source as remote resources.
const body = files.map((f) => `// ==== module ${f.replace(/\.js$/, "")} ====\n${readFileSync(join(srcDir, f), "utf8").trim()}\n`).join("\n");
const out = `// Generated from the modules in src - edit those, not this file.\n(() => {\n"use strict";\n\n${body}\n})();\n`;
writeFileSync(join(root, "main.js"), out);
console.log(`built ${name}/main.js from ${files.length} modules (${out.length} bytes)`);
