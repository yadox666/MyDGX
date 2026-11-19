#!/usr/bin/env python3
"""Create a Claude Code workspace configured for the MyDGX gateway."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import urllib.error
from pathlib import Path

from mcp_env import secret_available

SPANISH = os.environ.get("MYDGX_LANGUAGE") == "es"


def tr(spanish: str, english: str) -> str:
    return spanish if SPANISH else english
from opencode_workspace import (
    NVD_MCP,
    PLAYWRIGHT_MCP,
    SEARXNG_MCP,
    SHODAN_MCP,
    SKILLS_SOURCE,
    discover,
    max_output_tokens,
    select_model,
    with_secrets,
)

TIMEOUT_MS = 1_800_000
MODEL_TIERS = ("FABLE", "OPUS", "SONNET", "HAIKU")

INSTRUCTIONS = """\
# MyDGX · Claude Code

You are using models served through the private MyDGX gateway.

Never read or quote .env files, credentials, tokens, keys, cookies, session data,
or private key material. Stay inside the workspace where Claude Code was
launched. Do not use external directories. Do not launch subagents. If a tool
fails or returns empty, report it once instead of repeating the same call.

Browser, Shodan, and NVD tools exist only in the active profile. Discover which
tools are connected before using them. Use NVD for published CVE records and
never invent CVE identifiers. Only perform security testing against systems for
which the user has explicit authorization.

When gateway web search is enabled, the searxng web_search tool is available in
both profiles. It queries the public web through local SearXNG. Send short
search terms only. Never send file contents, credentials, tokens, cookies, or
private data. The built-in WebSearch and WebFetch tools stay disabled.

For security assessments, load the authorized-pentest skill before starting.
Load blackbox-wordpress only for an authorized WordPress initial-access
reconstruction. Skills never expand the scope or authorization in scope.md.
"""

SECRET_READS = [
    "Read(**/.env)",
    "Read(**/.env.*)",
    "Read(**/*.pem)",
    "Read(**/*.key)",
    "Read(**/id_rsa*)",
    "Read(**/id_ed25519*)",
    "Read(~/.ssh/**)",
    "Read(~/.aws/**)",
    "Read(~/.MyDGX/**)",
]


def playwright_args(workspace: Path) -> list[str]:
    args = ["-y", PLAYWRIGHT_MCP, "--headless", "--no-sandbox"]
    chrome = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    browser = os.environ.get("MYDGX_PLAYWRIGHT_BROWSER", "").strip()
    if not browser and chrome.is_file():
        browser = "chrome"
    if browser:
        profile = workspace / ".claude" / "playwright-profile"
        profile.mkdir(parents=True, exist_ok=True)
        args.extend(["--browser", browser, "--user-data-dir", str(profile)])
    else:
        args.append("--isolated")
    return args


def write_mcp(workspace: Path, base_url: str, active: bool, web_search: bool) -> Path | None:
    servers: dict = {}
    if web_search:
        servers["searxng"] = {
            "command": sys.executable,
            "args": [str(SEARXNG_MCP)],
            "env": {
                "MYDGX_GATEWAY_URL": base_url.rstrip("/"),
                "MYDGX_GATEWAY_API_KEY": "${MYDGX_GATEWAY_API_KEY}",
            },
        }
    if active:
        servers["playwright"] = {
            "command": "npx",
            "args": playwright_args(workspace),
            "env": {
                "PLAYWRIGHT_BROWSERS_PATH": "${PLAYWRIGHT_BROWSERS_PATH}",
                "HOME": "${HOME}",
            },
        }
        nvd = with_secrets(["NVD_API_KEY"], ["npx", "-y", NVD_MCP])
        servers["nvd"] = {
            "command": nvd[0],
            "args": nvd[1:],
            "env": {
                "MCP_TRANSPORT_TYPE": "stdio",
                "NVD_REQUEST_TIMEOUT_MS": "30000",
            },
        }
        if secret_available("SHODAN_API_KEY"):
            shodan = with_secrets(["SHODAN_API_KEY"], ["npx", "-y", SHODAN_MCP])
            servers["shodan"] = {"command": shodan[0], "args": shodan[1:]}
    if not servers:
        return None
    path = workspace / ".claude" / "mydgx-mcp.json"
    path.write_text(json.dumps({"mcpServers": servers}, indent=2) + "\n", encoding="utf-8")
    return path


def write_config(workspace: Path, base_url: str, selected: dict, active: bool, web_search: bool = True) -> Path:
    config_dir = workspace / ".claude"
    config_dir.mkdir(parents=True, exist_ok=True)
    model = selected["id"]
    env = {
        "ANTHROPIC_BASE_URL": base_url.removesuffix("/v1").rstrip("/"),
        "ANTHROPIC_MODEL": model,
        "CLAUDE_CODE_SUBAGENT_MODEL": model,
        "CLAUDE_CODE_MAX_OUTPUT_TOKENS": str(max_output_tokens(selected["context"], "MYDGX_CLAUDE_MAX_OUTPUT_TOKENS")),
        "CLAUDE_CODE_AUTO_COMPACT_WINDOW": str(selected["context"]),
        "API_TIMEOUT_MS": str(TIMEOUT_MS),
        # Claude Code varía esta cabecera en cada petición e invalida la caché
        # KV de llama.cpp/vLLM.
        "CLAUDE_CODE_ATTRIBUTION_HEADER": "0",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        "DISABLE_AUTOUPDATER": "1",
        "DISABLE_TELEMETRY": "1",
        "DISABLE_ERROR_REPORTING": "1",
        # La memoria automática se guarda en ~/.claude, fuera del workspace.
        "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1",
        # El coste se calcula con precios de Anthropic; no aplica al gateway local.
        "DISABLE_COST_WARNINGS": "1",
    }
    env.update({f"ANTHROPIC_DEFAULT_{tier}_MODEL": model for tier in MODEL_TIERS})

    deny = ["WebFetch", "WebSearch", "Task", "Agent", "Workflow", "EnterWorktree", *SECRET_READS]
    search_tools = ["mcp__searxng", "mcp__searxng__web_search"] if web_search else []
    if active:
        permissions = {
            "defaultMode": "acceptEdits",
            "allow": ["Read", "Edit", "Write", "Glob", "Grep", "mcp__playwright", "mcp__nvd", "mcp__shodan", *search_tools],
            "ask": ["Bash"],
            "deny": deny,
        }
    else:
        permissions = {
            "defaultMode": "plan",
            "allow": ["Read", "Glob", "Grep", *search_tools],
            "deny": [*deny, "Bash", "Edit", "Write", "NotebookEdit"],
        }
    permissions["disableBypassPermissionsMode"] = "disable"

    config = {
        "$schema": "https://json.schemastore.org/claude-code-settings.json",
        "model": model,
        "env": env,
        "permissions": permissions,
        "autoMemoryEnabled": False,
        "enableAllProjectMcpServers": False,
    }
    # Fuera de settings.json: Claude Code ignora los allow de proyecto hasta
    # aceptar el diálogo de confianza; --settings los aplica siempre.
    path = config_dir / "mydgx-settings.json"
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    return path


def create_workspace(workspace: Path) -> None:
    config_dir = workspace / ".claude"
    config_dir.mkdir(parents=True, exist_ok=True)
    (workspace / "CLAUDE.md").write_text(INSTRUCTIONS, encoding="utf-8")
    if not SKILLS_SOURCE.is_dir():
        raise SystemExit(
            tr(
                f"ERROR: no se encontraron las plantillas de skills en {SKILLS_SOURCE}",
                f"ERROR: skill templates not found at {SKILLS_SOURCE}",
            )
        )
    skills_target = config_dir / "skills"
    skills_target.mkdir(parents=True, exist_ok=True)
    for source in SKILLS_SOURCE.iterdir():
        if source.is_dir():
            shutil.copytree(source, skills_target / source.name, dirs_exist_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model", default="")
    parser.add_argument("--active", action="store_true")
    parser.add_argument("--assets-only", action="store_true")
    args = parser.parse_args()

    workspace = args.workspace.resolve()
    create_workspace(workspace)
    if args.assets_only:
        print(workspace)
        return 0
    try:
        models, web_search = discover(args.base_url, os.environ.get("MYDGX_GATEWAY_API_KEY", ""))
    except (OSError, RuntimeError, urllib.error.URLError, json.JSONDecodeError) as exc:
        raise SystemExit(
            tr(
                f"ERROR: no se pudo configurar Claude Code desde {args.base_url}: {exc}",
                f"ERROR: could not configure Claude Code from {args.base_url}: {exc}",
            )
        ) from exc
    if not web_search:
        print(
            tr(
                "AVISO: la búsqueda web del gateway está desactivada; Claude Code no recibe la herramienta.",
                "WARNING: gateway web search is disabled; Claude Code will not get the tool.",
            ),
            file=sys.stderr,
        )
    selected = select_model(models, args.model)
    settings = write_config(workspace, args.base_url, selected, args.active, web_search)
    mcp = write_mcp(workspace, args.base_url, args.active, web_search) or ""
    print(f"{selected['id']}\t{settings}\t{mcp}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
