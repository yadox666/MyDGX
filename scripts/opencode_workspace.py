#!/usr/bin/env python3
"""Create an OpenCode workspace configured for the MyDGX gateway."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

PLAYWRIGHT_MCP = "@playwright/mcp@0.0.83"
SHODAN_MCP = "@burtthecoder/mcp-shodan@1.0.32"
NVD_MCP = "@cyanheads/nist-nvd-mcp-server@0.3.2"
DEFAULT_CONTEXT = 262_144
DEFAULT_STEPS = 8192
DEFAULT_MAX_OUTPUT = 32_000
MIN_MAX_OUTPUT = 4096
MANAGED_ASSISTANT_OWNER = "mydgx:managed-assistant"
# OpenCode aplica la última regla que coincide: la general va primero.
READ_RULES = {
    "*": "allow",
    "*.env": "deny",
    "*.env.*": "deny",
    "*.env.example": "allow",
    "*.pem": "deny",
    "*.key": "deny",
}
SKILLS_SOURCE = Path(__file__).resolve().parents[1] / "config" / "opencode" / "skills"

INSTRUCTIONS = """\
You are using models served through the private MyDGX gateway.

Never read or quote .env files, credentials, tokens, keys, cookies, session data,
or private key material. Stay inside the workspace where OpenCode was launched.
Do not use external directories. Do not launch subagents. If a tool fails or
returns empty, report it once instead of repeating the same call.

Browser, Shodan, and NVD tools exist only in the active profile. Discover which
tools are connected before using them. Use NVD for published CVE records and
never invent CVE identifiers. Only perform security testing against systems for
which the user has explicit authorization.

For security assessments, load the authorized-pentest skill before starting.
Load blackbox-wordpress only for an authorized WordPress initial-access
reconstruction. Skills never expand the scope or authorization in scope.md.
"""

SCOPE = """\
# Scope

**Project:** Authorized local workspace
**Date started:** {today}

## In scope

- Document the authorized systems and objectives here.

## Out of scope

- Third-party infrastructure without written authorization.
- Destructive testing, denial of service, or credential attacks.

## Constraints

- Use low-impact request rates.
- Stop on instability or unexpected sensitive data.
- Store evidence inside this project.
"""

METHODOLOGY = """\
# Methodology

1. Confirm scope and authorization before active testing.
2. Start with passive collection and local artifact review.
3. Model the attack surface and trust boundaries.
4. Form evidence-based hypotheses and select minimally invasive tests.
5. Record evidence, negative results, blockers, and residual uncertainty.
6. Propose remediation and safe post-fix verification.
"""


def request_json(url: str, api_key: str) -> dict:
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.loads(response.read().decode("utf-8"))


def discover(base_url: str, api_key: str) -> list[dict]:
    root = base_url.removesuffix("/v1").rstrip("/")
    health = request_json(f"{root}/health", api_key)
    if health.get("status") != "ok":
        raise RuntimeError("el gateway está desactivado")
    payload = request_json(f"{base_url.rstrip('/')}/models", api_key)
    models = []
    for item in payload.get("data", []):
        model_id = item.get("id")
        task = item.get("task", "chat")
        if model_id and task in {"chat", "vision"}:
            context = item.get("context_length", DEFAULT_CONTEXT)
            if not isinstance(context, int) or context < 1:
                context = DEFAULT_CONTEXT
            # Gateways anteriores no publican capabilities; se asume tool calling.
            capabilities = item.get("capabilities") or {}
            modalities = item.get("input_modalities") or ["text"]
            models.append({
                "id": model_id,
                "context": context,
                "task": task,
                "tools": bool(capabilities.get("tools", True)),
                "reasoning": bool(capabilities.get("reasoning", False)),
                "vision": bool(capabilities.get("vision", task == "vision" or "image" in modalities)),
                "assistant": item.get("owned_by") == MANAGED_ASSISTANT_OWNER,
            })
    if not models:
        raise RuntimeError("el gateway no publica ningún modelo de chat o visión")
    return models


def max_output_tokens(context: int, env_name: str) -> int:
    try:
        value = int(os.environ.get(env_name, "0"))
    except ValueError:
        value = 0
    if value > 0:
        return value
    return max(MIN_MAX_OUTPUT, min(DEFAULT_MAX_OUTPUT, context // 8))


def step_limit() -> int:
    try:
        value = int(os.environ.get("MYDGX_OPENCODE_MAX_STEPS", str(DEFAULT_STEPS)))
    except ValueError:
        value = DEFAULT_STEPS
    return value if value > 0 else 2_147_483_647


def opencode_major(version: str) -> int:
    match = re.search(r"(?<!\d)(\d+)(?:\.\d+)", version)
    return int(match.group(1)) if match else 1


def select_model(models: list[dict], requested: str) -> dict:
    if requested:
        selected = next((model for model in models if model["id"] == requested), None)
        if selected is None:
            available = ", ".join(model["id"] for model in models)
            raise SystemExit(f"ERROR: el modelo {requested!r} no está cargado. Disponibles: {available}")
    else:
        # El gateway ordena alfabéticamente; se prefiere un modelo del perfil
        # con tool calling, de chat y con más contexto antes que el asistente.
        selected = min(
            models,
            key=lambda model: (
                model["assistant"], not model["tools"], model["task"] != "chat", -model["context"],
            ),
        )
    if not selected["tools"]:
        print(
            f"AVISO: {selected['id']} no admite tool calling en el gateway "
            "(llama.cpp sin --jinja); el agente no podrá usar herramientas.",
            file=sys.stderr,
        )
    return selected


def playwright_command(workspace: Path) -> list[str]:
    command = ["npx", "-y", PLAYWRIGHT_MCP, "--headless", "--no-sandbox"]
    chrome = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    browser = os.environ.get("MYDGX_PLAYWRIGHT_BROWSER", "").strip()
    if not browser and chrome.is_file():
        browser = "chrome"
    if browser:
        profile = workspace / ".opencode" / "playwright-profile"
        profile.mkdir(parents=True, exist_ok=True)
        command.extend(["--browser", browser, "--user-data-dir", str(profile)])
    else:
        command.append("--isolated")
    return command


def write_config(
    workspace: Path,
    base_url: str,
    models: list[dict],
    selected: dict,
    active: bool,
    version: str,
) -> Path:
    config_dir = workspace / ".opencode"
    config_dir.mkdir(parents=True, exist_ok=True)
    instructions = config_dir / "BUGHUNTER-LAB.md"
    major = opencode_major(version)

    options = {
        "baseURL": base_url.rstrip("/"),
        "apiKey": "{env:MYDGX_GATEWAY_API_KEY}",
        "timeout": 1_800_000,
        "headerTimeout": 1_800_000,
        "chunkTimeout": 1_800_000,
    }
    model_config = {
        model["id"]: {
            "name": model["id"],
            "modelID": model["id"],
            "tool_call": model["tools"],
            "reasoning": model["reasoning"],
            "attachment": model["vision"],
            "modalities": {
                "input": ["text", "image"] if model["vision"] else ["text"],
                "output": ["text"],
            },
            "temperature": True,
            "limit": {
                "context": model["context"],
                "output": max_output_tokens(model["context"], "MYDGX_OPENCODE_MAX_OUTPUT_TOKENS"),
            },
        }
        for model in models
    }
    if major >= 2:
        provider = {
            "name": "MyDGX",
            "package": "@opencode/ai/providers/openai-compatible",
            "settings": options,
            "models": model_config,
        }
        provider_key = "providers"
    else:
        for value in model_config.values():
            value.pop("modelID", None)
        provider = {
            "npm": "@ai-sdk/openai-compatible",
            "name": "MyDGX",
            "options": options,
            "models": model_config,
        }
        provider_key = "provider"

    denied = {
        "webfetch": "deny",
        "websearch": "deny",
        "task": "deny",
        "question": "deny",
        "external_directory": "deny",
        "doom_loop": "deny",
    }
    plan_permissions = {**denied, "skill": "allow", "read": READ_RULES, "edit": "deny", "bash": "deny"}
    active_permissions = {
        **denied,
        "skill": "allow",
        "read": READ_RULES,
        "edit": "allow",
        "glob": "allow",
        "grep": "allow",
        "list": "allow",
        "bash": "ask",
        "playwright_*": "allow",
        "shodan_*": "allow",
        "nvd_*": "allow",
    }
    permissions = active_permissions if active else plan_permissions
    tools = {"webfetch": False, "websearch": False, "skill": True, "question": False}
    if not active:
        tools.update({"write": False, "edit": False, "bash": False})

    config: dict = {
        "$schema": "https://opencode.ai/config.json",
        "model": f"mydgx/{selected['id']}",
        "small_model": f"mydgx/{selected['id']}",
        "share": "disabled",
        "autoupdate": False,
        "snapshot": False,
        "lsp": False,
        "formatter": False,
        "subagent_depth": 0,
        "default_agent": "build" if active else "plan",
        "enabled_providers": ["mydgx"],
        "instructions": [str(instructions)],
        "permission": permissions,
        "tools": tools,
        # Sin "prompt": en OpenCode sustituye al system prompt base del agente.
        # Las reglas de MyDGX llegan mediante "instructions".
        "agent": {
            "plan": {
                "steps": step_limit(),
                "maxSteps": step_limit(),
                "permission": plan_permissions,
            },
            "build": {
                "mode": "primary",
                "steps": step_limit(),
                "maxSteps": step_limit(),
                "permission": permissions,
            },
        },
        provider_key: {"mydgx": provider},
    }
    if active:
        config["mcp"] = {
            "playwright": {
                "type": "local",
                "command": playwright_command(workspace),
                "environment": {
                    "PLAYWRIGHT_BROWSERS_PATH": "{env:PLAYWRIGHT_BROWSERS_PATH}",
                    "HOME": "{env:HOME}",
                },
                "enabled": True,
                "timeout": 120_000,
            },
            "shodan": {
                "type": "local",
                "command": ["npx", "-y", SHODAN_MCP],
                "environment": {"SHODAN_API_KEY": "{env:SHODAN_API_KEY}"},
                "enabled": bool(os.environ.get("SHODAN_API_KEY")),
                "timeout": 30_000,
            },
            "nvd": {
                "type": "local",
                "command": ["npx", "-y", NVD_MCP],
                "environment": {
                    "MCP_TRANSPORT_TYPE": "stdio",
                    "NVD_API_KEY": "{env:NVD_API_KEY}",
                    "NVD_REQUEST_TIMEOUT_MS": "30000",
                },
                "enabled": True,
                "timeout": 60_000,
            },
        }

    payload = json.dumps(config, indent=2) + "\n"
    path = config_dir / "opencode.json"
    path.write_text(payload, encoding="utf-8")
    (workspace / "opencode.json").write_text(payload, encoding="utf-8")
    return path


def create_workspace(workspace: Path, slug: str, version: str) -> None:
    workspace.mkdir(parents=True, exist_ok=True)
    config_dir = workspace / ".opencode"
    config_dir.mkdir(parents=True, exist_ok=True)
    (config_dir / "BUGHUNTER-LAB.md").write_text(INSTRUCTIONS + "\n", encoding="utf-8")
    version_match = re.search(r"(?<!\d)(\d+\.\d+\.\d+)(?!\d)", version)
    plugin_version = version_match.group(1) if version_match else "1.19.0"
    (config_dir / "package.json").write_text(
        json.dumps(
            {"dependencies": {"@opencode-ai/plugin": plugin_version}},
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    skills_target = workspace / ".opencode" / "skills"
    if not SKILLS_SOURCE.is_dir():
        raise SystemExit(f"ERROR: no se encontraron las plantillas de skills en {SKILLS_SOURCE}")
    skills_target.mkdir(parents=True, exist_ok=True)
    for source in SKILLS_SOURCE.iterdir():
        if source.is_dir():
            shutil.copytree(source, skills_target / source.name, dirs_exist_ok=True)
    readme = workspace / "README.md"
    if not readme.exists():
        readme.write_text(
            "# OpenCode · MyDGX\n\n"
            "Este workspace usa el gateway privado de MyDGX. Cada proyecto puede "
            "vivir en un subdirectorio; la configuración está en el directorio raíz.\n",
            encoding="utf-8",
        )
    if slug:
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", slug):
            raise SystemExit("ERROR: el nombre debe usar minúsculas, números, _ o -.")
        project = workspace / slug
        project.mkdir(parents=True, exist_ok=True)
        pentest = project / "pentest"
        pentest.mkdir(parents=True, exist_ok=True)
        scope = pentest / "scope.md"
        if not scope.exists():
            scope.write_text(SCOPE.format(today=date.today().isoformat()), encoding="utf-8")
        methodology = pentest / "methodology.md"
        if not methodology.exists():
            methodology.write_text(METHODOLOGY, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--version", default="1.0.0")
    parser.add_argument("--model", default="")
    parser.add_argument("--slug", default="")
    parser.add_argument("--active", action="store_true")
    parser.add_argument("--assets-only", action="store_true")
    args = parser.parse_args()

    create_workspace(args.workspace, args.slug, args.version)
    if args.assets_only:
        print(args.workspace.resolve())
        return 0
    try:
        models = discover(args.base_url, os.environ.get("MYDGX_GATEWAY_API_KEY", ""))
    except (OSError, RuntimeError, urllib.error.URLError, json.JSONDecodeError) as exc:
        raise SystemExit(f"ERROR: no se pudo configurar OpenCode desde {args.base_url}: {exc}") from exc
    selected = select_model(models, args.model)
    path = write_config(
        args.workspace.resolve(),
        args.base_url,
        models,
        selected,
        args.active,
        args.version,
    )
    print(f"{selected['id']}\t{path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
