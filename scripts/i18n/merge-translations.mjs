#!/usr/bin/env node
// Merges translated chunks into the catalogs and lists keys still untranslated.
//   frontend: frontend/src/locales/en.json  (keys from frontend-keys.json)
//   backend:  backend/locales/en.json       (keys from backend-keys.json)
// Existing catalog entries win over chunk output so manual fixes survive.
// Chunks live in scripts/i18n/translations/<target>-NN.output.json.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const chunks = join(root, "scripts/i18n/translations");
const read = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);
const placeholders = (text, pattern) => JSON.stringify((text.match(pattern) || []).sort());
const targets = [
  { name: "frontend", keys: "scripts/i18n/frontend-keys.json", extraKeys: "scripts/i18n/frontend-extra-keys.json", catalog: "frontend/src/locales/en.json", pattern: /\{\w+\}/g },
  { name: "backend", keys: "scripts/i18n/backend-keys.json", catalog: "backend/locales/en.json", pattern: /\{\d+\}|\{\{|\}\}/g },
];

const report = {};
for (const target of targets) {
  const translated = {};
  for (const file of (existsSync(chunks) ? readdirSync(chunks) : []).filter((entry) => entry.startsWith(`${target.name}-`) && entry.endsWith(".output.json")).sort()) {
    Object.assign(translated, read(join(chunks, file), {}));
  }
  const catalogPath = join(root, target.catalog);
  const existing = read(catalogPath, {});
  // Extra keys cover t(variable) calls, whose values the extractor cannot see.
  const keys = [...new Set([...read(join(root, target.keys), []), ...(target.extraKeys ? read(join(root, target.extraKeys), []) : [])])];
  const merged = {};
  const missing = [];
  const mismatched = [];
  for (const key of keys) {
    const value = existing[key] ?? translated[key];
    if (typeof value !== "string" || !value) {
      missing.push(key);
    } else if (placeholders(key, target.pattern) !== placeholders(value, target.pattern)) {
      mismatched.push(key);
    } else {
      merged[key] = value;
    }
  }
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeFileSync(catalogPath, JSON.stringify(merged, null, 2) + "\n");
  if (missing.length || mismatched.length) {
    mkdirSync(chunks, { recursive: true });
    writeFileSync(join(chunks, `${target.name}-missing.input.json`), JSON.stringify([...missing, ...mismatched], null, 1) + "\n");
  }
  report[target.name] = { keys: keys.length, translated: Object.keys(merged).length, missing: missing.length, mismatched };
}
console.log(JSON.stringify(report, null, 1));
