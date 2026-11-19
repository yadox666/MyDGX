#!/usr/bin/env python3
"""Extract user-facing Spanish backend texts as translation templates.

Every f-string becomes a template whose interpolations are numbered
placeholders ({0}, {1}, ...). The runtime matcher in backend/i18n.py turns
the same templates into regular expressions.
"""
from __future__ import annotations

import ast
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCES = [ROOT / "backend/main.py", ROOT / "backend/gateway.py"]
SPANISH = re.compile(r"[áéíóúñÁÉÍÓÚÑ¿¡]|\b(el|la|los|las|de|del|que|no|un|una|para|con|sin|por|se|ya|está|hay|puede|desde|antes|ningún|ninguna)\b", re.I)
LOG_CALLS = {"log", "debug", "info", "warning", "error", "exception", "critical"}


def template(node: ast.AST) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        parts, index = [], 0
        for value in node.values:
            if isinstance(value, ast.Constant):
                parts.append(str(value.value).replace("{", "{{").replace("}", "}}"))
            else:
                parts.append("{%d}" % index)
                index += 1
        return "".join(parts)
    return None


CODE_LIKE = re.compile(r"^[\w.:/@+-]*$|^[-\w]+=|^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|PRAGMA)\b|[<>]=?|==|\\[nt]|^%|^\$|^/|https?://")
WORD = re.compile(r"[A-Za-zÁÉÍÓÚáéíóúñÑüÜ]{2,}")


def is_user_text(text: str) -> bool:
    literal = re.sub(r"\{\d+\}", " ", text).strip()
    if len(literal) < 3 or not WORD.search(literal):
        return False
    if SPANISH.search(literal):
        return True
    if " " not in literal:
        return bool(re.fullmatch(r"[A-ZÁÉÍÓÚ][a-záéíóúñ]{3,}", literal))
    return len(WORD.findall(literal)) >= 2 and not CODE_LIKE.search(literal)


class Collector(ast.NodeVisitor):
    def __init__(self) -> None:
        self.parents: list[ast.AST] = []
        self.found: list[dict] = []

    def generic_visit(self, node: ast.AST) -> None:
        self.parents.append(node)
        super().generic_visit(node)
        self.parents.pop()

    def context(self, node: ast.AST) -> str:
        parent = self.parents[-1] if self.parents else None
        if isinstance(parent, ast.JoinedStr):
            return "skip"
        if isinstance(parent, ast.keyword):
            call = self.parents[-2]
            return f"kw:{parent.arg}:{call_name(call)}"
        if isinstance(parent, ast.Dict):
            for key, value in zip(parent.keys, parent.values):
                if value is node and isinstance(key, ast.Constant):
                    return f"key:{key.value}"
                if key is node:
                    return "dictkey"
        if isinstance(parent, ast.Call):
            name = call_name(parent)
            if name in LOG_CALLS or name.endswith(".log"):
                return f"log:{name}"
            return f"arg:{name}"
        if isinstance(parent, ast.Compare):
            return "compare"
        if isinstance(parent, (ast.Return,)):
            return "return"
        if isinstance(parent, ast.Assign):
            return "assign"
        return type(parent).__name__ if parent else "module"

    def visit_JoinedStr(self, node: ast.JoinedStr) -> None:
        self.record(node)
        self.generic_visit(node)

    def visit_Constant(self, node: ast.Constant) -> None:
        if isinstance(node.value, str):
            self.record(node)

    def record(self, node: ast.AST) -> None:
        text = template(node)
        if not text or not is_user_text(text):
            return
        context = self.context(node)
        if context in {"skip", "dictkey", "compare"}:
            return
        if self.parents and isinstance(self.parents[-1], ast.Expr):
            return
        self.found.append({"line": node.lineno, "context": context, "text": text})


def call_name(node: ast.AST) -> str:
    if not isinstance(node, ast.Call):
        return ""
    func = node.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        owner = func.value.id if isinstance(func.value, ast.Name) else ""
        return f"{owner}.{func.attr}" if owner else func.attr
    return ""


def main() -> None:
    items = []
    for source in SOURCES:
        collector = Collector()
        collector.visit(ast.parse(source.read_text(), str(source)))
        items += [{"file": source.name, **item} for item in collector.found]
    if "--contexts" in sys.argv:
        for context, count in Counter(item["context"] for item in items).most_common():
            print(f"{count:5d} {context}")
        return
    internal = ("log:", "arg:db.execute", "arg:db.audit", "arg:connection.", "arg:re.", "kw:pattern:", "key:Cache-Control", "key:prompt", "key:instruction")
    excluded = [item for item in items if item["context"].startswith(internal)]
    kept = [item for item in items if item not in excluded]
    keys = sorted({item["text"] for item in kept})
    out = ROOT / "scripts/i18n/backend-keys.json"
    out.write_text(json.dumps(keys, ensure_ascii=False, indent=2) + "\n")
    (ROOT / "scripts/i18n/backend-occurrences.json").write_text(json.dumps(kept, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps({"occurrences": len(kept), "keys": len(keys), "excluded_logs": len(excluded)}))


if __name__ == "__main__":
    main()
