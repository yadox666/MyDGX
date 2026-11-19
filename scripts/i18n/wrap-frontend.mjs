#!/usr/bin/env node
// Wraps user-visible Spanish text of the frontend in t(); prints a report of skipped literals.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(root, "frontend", "package.json"));
const ts = require("typescript");

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["frontend/src/App.tsx", "frontend/src/AuthGate.tsx", "frontend/src/MarkdownMessage.tsx"];

const TEXT_ATTRIBUTES = new Set([
  "title", "placeholder", "aria-label", "alt", "label", "eyebrow", "description", "summary", "badge",
  "ariaLabel", "hint", "text", "message", "confirmLabel", "emptyLabel", "caption", "subtitle", "heading",
  "tooltip", "helper", "help", "detail", "empty", "action", "actionLabel", "note",
]);
const CODE_ATTRIBUTES = new Set([
  "className", "key", "id", "dataKey", "nameKey", "stackId", "xAxisId", "yAxisId", "href", "src", "type", "name", "value", "defaultValue", "role", "htmlFor",
  "target", "rel", "method", "accept", "autoComplete", "inputMode", "pattern", "lang", "dir", "kind",
  "mode", "variant", "size", "data-category", "data-state", "style", "d", "viewBox", "fill", "stroke",
]);
const NON_TEXT_CALLS = new Set([
  "includes", "startsWith", "endsWith", "split", "replace", "replaceAll", "getItem", "setItem",
  "removeItem", "querySelector", "querySelectorAll", "fetch", "api", "apiBlob", "get", "has", "set",
  "delete", "addEventListener", "removeEventListener", "dispatchEvent", "Event", "CustomEvent",
  "RegExp", "URL", "URLSearchParams", "append", "indexOf", "lastIndexOf", "match", "test", "join",
  "localeCompare", "padStart", "padEnd", "toLocaleString", "Intl", "t", "translateServerText",
]);
const SPANISH_WORDS = /(^|[^\p{L}])(de|del|la|el|los|las|en|no|para|con|sin|un|una|se|que|por|al|y|o|es|su|sus|ya|lo|más|si|hay|este|esta|desde|hasta)(?=$|[^\p{L}])/iu;

function looksLikeCode(text) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^(https?:|\/|\.\/|#|--|\.)/.test(trimmed)) return true;
  if (/^[\w.-]+$/.test(trimmed) && !/[áéíóúñ]/i.test(trimmed) && !/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+$/.test(trimmed)) return true;
  if (trimmed.split(/\s+/).every((part) => /^[a-z0-9_:-]+$/.test(part)) && /[-_:]/.test(trimmed)) return true;
  if (/^[\d\s.,:%×x+\-/()]*$/.test(trimmed)) return true;
  if (/[{}]|=>|;\S|<\/?[a-z]|\w=\w/.test(trimmed)) return true;
  return false;
}

function looksHuman(text, strict) {
  if (looksLikeCode(text)) return false;
  if (!/\p{L}{2,}/u.test(text)) return false;
  if (!strict) return true;
  if (/[áéíóúñ¿¡]/i.test(text)) return true;
  if (SPANISH_WORDS.test(text)) return true;
  if (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(\s|$)/.test(text.trim()) && /\s/.test(text.trim())) return true;
  if (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{3,}$/.test(text.trim())) return true;
  return false;
}

function jsxRendered(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length === 1) return text;
  return lines
    .map((line, index) => {
      let value = line.replace(/\t/g, " ");
      if (index > 0) value = value.replace(/^\s+/, "");
      if (index < lines.length - 1) value = value.replace(/\s+$/, "");
      return value;
    })
    .filter((line) => line.length)
    .join(" ");
}

const quote = (text) => JSON.stringify(text);

function calleeName(call) {
  const expression = call.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return "";
}

function placeholderName(expression, used) {
  let base = "value";
  if (ts.isIdentifier(expression)) base = expression.text;
  else if (ts.isPropertyAccessExpression(expression)) base = expression.name.text;
  else if (ts.isCallExpression(expression)) {
    const name = calleeName(expression);
    if (name && !["String", "Number", "bytes", "Math"].includes(name)) base = name;
    const argument = expression.arguments[0];
    if (argument && (ts.isIdentifier(argument) || ts.isPropertyAccessExpression(argument))) {
      base = ts.isIdentifier(argument) ? argument.text : argument.name.text;
    }
  }
  base = base.replace(/[^\w]/g, "") || "value";
  let name = base;
  for (let index = 2; used.has(name); index += 1) name = `${base}${index}`;
  used.add(name);
  return name;
}

function skipReason(node) {
  let current = node;
  let parent = node.parent;
  while (parent && (ts.isParenthesizedExpression(parent) || ts.isConditionalExpression(parent) && parent.condition !== current
    || ts.isBinaryExpression(parent) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(parent.operatorToken.kind))) {
    current = parent;
    parent = parent.parent;
  }
  if (!parent) return "sin-contexto";
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return "import";
  if (ts.isLiteralTypeNode(parent) || ts.isTypeNode(parent)) return "tipo";
  if (ts.isPropertyAssignment(parent) && parent.name === current) return "clave";
  if (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent) && parent.argumentExpression === current) return "acceso";
  if (ts.isCaseClause(parent)) return "comparacion";
  if (ts.isBinaryExpression(parent)) {
    const kind = parent.operatorToken.kind;
    if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(kind)) {
      return "comparacion";
    }
  }
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    const name = ts.isCallExpression(parent) ? calleeName(parent) : parent.expression.getText();
    if (NON_TEXT_CALLS.has(name)) return `llamada:${name}`;
  }
  if (ts.isJsxAttribute(parent)) {
    const name = parent.name.getText();
    if (CODE_ATTRIBUTES.has(name)) return `atributo:${name}`;
  }
  if (ts.isPropertyAssignment(parent)) {
    const key = parent.name.getText().replace(/["']/g, "");
    if (CODE_ATTRIBUTES.has(key) || ["id", "kind", "status", "state", "value", "model", "path", "url", "key", "type", "role", "category"].includes(key)) {
      return `propiedad:${key}`;
    }
  }
  return "";
}

function insideCodeElement(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxElement(current)) {
      const tag = current.openingElement.tagName.getText();
      if (["code", "pre", "kbd", "samp"].includes(tag)) return true;
    }
  }
  return false;
}

function insideTCall(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isCallExpression(current) && ["t", "translateServerText"].includes(calleeName(current))) return true;
  }
  return false;
}

function collect(sourceFile, text, report) {
  const edits = [];
  const add = (node, replacement, kind) => edits.push({ start: node.getStart(sourceFile), end: node.getEnd(), replacement, kind });

  function visit(node) {
    if (insideTCall(node)) return;
    if (ts.isJsxText(node)) {
      const rendered = jsxRendered(node.getFullText(sourceFile));
      const key = rendered.trim();
      if (key && looksHuman(key, false) && !insideCodeElement(node)) {
        const lead = /^\s/.test(rendered) ? '{" "}' : "";
        const trail = /\s$/.test(rendered) ? '{" "}' : "";
        const full = node.getFullText(sourceFile);
        const leading = full.match(/^\s*/)[0];
        const trailing = full.match(/\s*$/)[0];
        const keepLead = leading.includes("\n") ? leading : "";
        const keepTrail = trailing.includes("\n") ? trailing : "";
        edits.push({
          start: node.getFullStart(),
          end: node.getEnd(),
          replacement: `${keepLead}${lead}{t(${quote(key)})}${trail}${keepTrail}`,
          kind: "jsx-text",
        });
      }
      return;
    }
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText();
      const value = node.initializer.text;
      if (!CODE_ATTRIBUTES.has(name) && (TEXT_ATTRIBUTES.has(name) ? looksHuman(value, false) : looksHuman(value, true))) {
        add(node.initializer, `{t(${quote(value)})}`, "jsx-attribute");
      }
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (ts.isJsxAttribute(node.parent)) return;
      const value = node.text;
      if (looksHuman(value, true)) {
        const reason = skipReason(node);
        if (reason) report.push({ line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1, reason, text: value });
        else add(node, `t(${quote(value)})`, "string");
      }
      return;
    }
    if (ts.isTemplateExpression(node) && !ts.isTaggedTemplateExpression(node.parent)) {
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      const literalText = parts.join(" ");
      const nested = node.templateSpans.some((span) => {
        let found = false;
        const scan = (child) => {
          if (ts.isCallExpression(child) && ["t", "translateServerText"].includes(calleeName(child))) return;
          if (ts.isTemplateExpression(child) || ts.isStringLiteral(child) && looksHuman(child.text, true)) found = true;
          else ts.forEachChild(child, scan);
        };
        scan(span.expression);
        return found;
      });
      if (looksHuman(literalText, true) && !looksLikeCode(literalText.replace(/\s+/g, " "))) {
        const reason = skipReason(node);
        if (reason) {
          report.push({ line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1, reason, text: node.getText() });
        } else if (!nested) {
          const used = new Set();
          let key = node.head.text;
          const values = [];
          for (const span of node.templateSpans) {
            const name = placeholderName(span.expression, used);
            key += `{${name}}${span.literal.text}`;
            values.push(`${name}: ${span.expression.getText(sourceFile)}`);
          }
          add(node, `t(${quote(key)}, { ${values.join(", ")} })`, "template");
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  edits.sort((a, b) => (a.end - a.start) - (b.end - b.start));
  const chosen = [];
  for (const edit of edits) {
    if (chosen.some((other) => edit.start < other.end && other.start < edit.end)) continue;
    chosen.push(edit);
  }
  return chosen.sort((a, b) => b.start - a.start);
}

const summary = {};
const allKeys = new Set();
const skipped = [];
for (const file of files) {
  const path = join(root, file);
  let text = readFileSync(path, "utf8");
  let total = 0;
  const fileReport = [];
  for (let pass = 0; pass < 4; pass += 1) {
    const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    fileReport.length = 0;
    const edits = collect(sourceFile, text, fileReport);
    if (!edits.length) break;
    for (const edit of edits) text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
    total += edits.length;
  }
  if (total && !/from "\.\/i18n"/.test(text)) {
    const lastImport = [...text.matchAll(/^import .*;$/gm)].pop();
    const at = lastImport ? lastImport.index + lastImport[0].length : 0;
    text = `${text.slice(0, at)}\nimport { t } from "./i18n";${text.slice(at)}`;
  }
  writeFileSync(path, text);
  for (const match of text.matchAll(/\bt\(("(?:[^"\\]|\\.)*")/g)) allKeys.add(JSON.parse(match[1]));
  summary[relative(root, path)] = total;
  skipped.push(...fileReport.map((item) => ({ file, ...item })));
}
writeFileSync(join(root, "scripts/i18n/frontend-keys.json"), JSON.stringify([...allKeys].sort(), null, 2) + "\n");
writeFileSync(join(root, "scripts/i18n/frontend-skipped.json"), JSON.stringify(skipped, null, 2) + "\n");
console.log(JSON.stringify({ wrapped: summary, keys: allKeys.size, skipped: skipped.length }));
