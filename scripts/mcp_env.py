#!/usr/bin/env python3
"""Run an MCP server with selected secrets from the environment or MyDGX .env.

Usage:
  mcp_env.py --has NAME
  mcp_env.py NAME [NAME ...] -- COMMAND [ARGS ...]

SECURITY NOTES:
- Only the requested names are read; the rest of .env never reaches the agent
  or the MCP server.
- Values are never printed. --has only reports availability via exit code.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ENV_FILE = Path(os.environ.get("MYDGX_ENV_FILE") or Path(__file__).resolve().parents[1] / ".env")
LINE = re.compile(r"^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$")
NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")


def parse_value(raw: str) -> str:
    value = raw.strip()
    if value[:1] in {'"', "'"}:
        end = value.find(value[0], 1)
        return value[1:end] if end > 0 else value[1:]
    return re.split(r"\s+#", value, maxsplit=1)[0].strip()


def env_file_values(names: set[str]) -> dict[str, str]:
    try:
        lines = ENV_FILE.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError):
        return {}
    values: dict[str, str] = {}
    for line in lines:
        match = LINE.match(line)
        if match and match.group(1) in names:
            values[match.group(1)] = parse_value(match.group(2))
    return values


def lookup(names: list[str]) -> dict[str, str]:
    found = {name: os.environ[name] for name in names if os.environ.get(name)}
    missing = set(names) - set(found)
    if missing:
        found.update({name: value for name, value in env_file_values(missing).items() if value})
    return found


def secret_available(name: str) -> bool:
    return name in lookup([name])


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "--has" and NAME.match(argv[1]):
        return 0 if secret_available(argv[1]) else 1
    if "--" not in argv:
        print(__doc__.split("\n\n")[1], file=sys.stderr)
        return 2
    split = argv.index("--")
    names, command = argv[:split], argv[split + 1:]
    if not command or not all(NAME.match(name) for name in names):
        print("ERROR: nombres de variable o comando inválidos.", file=sys.stderr)
        return 2
    os.environ.update(lookup(names))
    os.execvp(command[0], command)
    return 127


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
