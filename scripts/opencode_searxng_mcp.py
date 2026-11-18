#!/usr/bin/env python3
"""MCP stdio: búsqueda web a través del gateway MyDGX (SearXNG local).

SECURITY NOTES:
- La clave sale solo de MYDGX_GATEWAY_API_KEY y no se imprime.
- La consulta no se escribe en stderr ni en stdout fuera del resultado.
- El proceso habla únicamente con el gateway ya configurado.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

PROTOCOL = "2024-11-05"
QUERY_MAX = 300
RESULT_MAX = 5


def gateway_search(query: str) -> str:
    base = os.environ.get("MYDGX_GATEWAY_URL", "").strip().rstrip("/")
    if not base:
        return "Búsqueda no disponible: falta MYDGX_GATEWAY_URL."
    key = os.environ.get("MYDGX_GATEWAY_API_KEY", "").strip()
    body = json.dumps({"query": query, "limit": RESULT_MAX}).encode("utf-8")
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    request = urllib.request.Request(
        f"{base}/search",
        data=body,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 403:
            return "Búsqueda web desactivada en el gateway."
        if exc.code == 400:
            return "La consulta no es válida."
        return "Búsqueda no disponible."
    except (OSError, TimeoutError, json.JSONDecodeError, UnicodeError):
        return "Búsqueda no disponible."
    results = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results, list) or not results:
        return "Sin resultados."
    lines: list[str] = []
    for index, item in enumerate(results[:RESULT_MAX], 1):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip() or "Sin título"
        url = str(item.get("url") or "").strip()
        snippet = str(item.get("snippet") or "").strip()
        lines.append(f"{index}. {title}\n{url}\n{snippet}".rstrip())
    return "\n\n".join(lines) if lines else "Sin resultados."


def tool_schema() -> dict:
    return {
        "name": "web_search",
        "description": (
            "Busca en la web pública a través de SearXNG local del DGX. "
            "Envía solo términos de búsqueda cortos. No envíes contenido de archivos, "
            "credenciales, tokens, cookies ni datos privados."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Términos de búsqueda, como máximo 300 caracteres.",
                }
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    }


def call_tool(arguments: object) -> dict:
    query = ""
    if isinstance(arguments, dict):
        raw = arguments.get("query", arguments.get("q", ""))
        if isinstance(raw, str):
            query = " ".join(raw.split())
    if not query or len(query) > QUERY_MAX:
        return {
            "content": [{"type": "text", "text": "La consulta no es válida."}],
            "isError": True,
        }
    return {"content": [{"type": "text", "text": gateway_search(query)}], "isError": False}


def handle(message: dict) -> dict | None:
    method = message.get("method")
    request_id = message.get("id")
    params = message.get("params") if isinstance(message.get("params"), dict) else {}
    if method == "initialize":
        version = params.get("protocolVersion")
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": version if isinstance(version, str) and version else PROTOCOL,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "mydgx-searxng", "version": "1.0.0"},
            },
        }
    if method in {"notifications/initialized", "initialized"}:
        return None
    if method == "ping":
        return {"jsonrpc": "2.0", "id": request_id, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": [tool_schema()]}}
    if method == "tools/call":
        name = params.get("name")
        if name != "web_search":
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32602, "message": "Herramienta desconocida"},
            }
        return {"jsonrpc": "2.0", "id": request_id, "result": call_tool(params.get("arguments"))}
    if request_id is None:
        return None
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": -32601, "message": "Método no disponible"},
    }


LINE_MAX = 1_000_000


def write_message(payload: dict) -> None:
    # MCP stdio: un objeto JSON por línea, sin saltos de línea internos.
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> int:
    for line in sys.stdin:
        if len(line) > LINE_MAX:
            continue
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except (json.JSONDecodeError, UnicodeError):
            continue
        if not isinstance(message, dict):
            continue
        response = handle(message)
        if response is not None:
            write_message(response)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
