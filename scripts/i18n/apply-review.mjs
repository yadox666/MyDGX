#!/usr/bin/env node
// Applies reviewer edits from scripts/i18n/review/*.json. Each edit must match
// exactly once in its file; anything else is reported and left untouched.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const reviewDir = join(root, "scripts/i18n/review");
const files = new Map();
const rejected = [];
let applied = 0;

function source(path) {
  if (!files.has(path)) files.set(path, readFileSync(join(root, path), "utf8"));
  return files.get(path);
}

for (const name of readdirSync(reviewDir).filter((entry) => entry.endsWith(".json")).sort()) {
  for (const edit of JSON.parse(readFileSync(join(reviewDir, name), "utf8"))) {
    const path = edit.file || "frontend/src/App.tsx";
    const text = source(path);
    const count = edit.old ? text.split(edit.old).length - 1 : 0;
    if (count !== 1 || edit.old === edit.new) {
      rejected.push({ review: name, line: edit.line, count, old: String(edit.old).slice(0, 120) });
      continue;
    }
    files.set(path, text.replace(edit.old, () => edit.new));
    applied += 1;
  }
}

for (const [path, text] of files) writeFileSync(join(root, path), text);
console.log(JSON.stringify({ applied, rejected }, null, 1));
