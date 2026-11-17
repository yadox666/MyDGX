#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.main import settings


def mark(ok: bool) -> str:
    return "✓" if ok else "○"


def size(value: Any) -> str:
    amount = float(value or 0)
    units = ("B", "KiB", "MiB", "GiB", "TiB")
    for unit in units:
        if amount < 1024 or unit == units[-1]:
            return f"{amount:.1f} {unit}" if unit != "B" else f"{int(amount)} B"
        amount /= 1024
    return f"{amount:.1f} TiB"


def line(label: str, value: Any) -> None:
    print(f"  {label:<21} {value}")


def section(title: str) -> None:
    print(f"\n{title}")
    print("  " + "─" * 66)


def main() -> int:
    base = f"http://127.0.0.1:{settings.port}"
    headers = {"X-MyDGX-Key": settings.mydgx_api_key} if settings.mydgx_api_key else {}
    paths = {
        "overview": "/api/overview",
        "readiness": "/api/system/readiness",
        "models": "/api/models",
        "profiles": "/api/profiles",
        "engines": "/api/engines",
        "gateway": "/api/gateway/config",
    }
    payloads: dict[str, Any] = {}
    errors: dict[str, str] = {}
    with httpx.Client(base_url=base, headers=headers, timeout=35) as client:
        for name, path in paths.items():
            try:
                response = client.get(path)
                response.raise_for_status()
                payloads[name] = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                errors[name] = type(exc).__name__

    print("\n┌──────────────────────────────────────────────────────────────────────┐")
    print("│  MyDGX · RESUMEN DEL DESPLIEGUE                                     │")
    print("└──────────────────────────────────────────────────────────────────────┘")

    overview = payloads.get("overview", {})
    host = overview.get("host", {})
    metrics = overview.get("metrics", {})
    section("SISTEMA")
    line("Equipo", host.get("device_model") or host.get("hostname") or "No detectado")
    line("Plataforma", "DGX Spark / GB10" if host.get("is_dgx_spark") else host.get("platform", "No detectada"))
    line("Sistema operativo", host.get("os_name") or host.get("os_family") or "No detectado")
    line("Kernel", f"{host.get('kernel', '—')} · {host.get('architecture', '—')}")
    line("GPU", host.get("gpu_name") or "No detectada")
    line(
        "Recursos",
        (
            f"GPU {metrics.get('gpu_utilization', '—')}% · "
            f"CPU {float(metrics.get('cpu_percent') or 0):.1f}% · "
            f"RAM {float(metrics.get('memory_percent') or 0):.1f}% · "
            f"disco {float(metrics.get('disk_percent') or 0):.1f}%"
        ),
    )
    if metrics.get("gpu_temperature") is not None:
        line("GPU térmica/potencia", f"{metrics['gpu_temperature']} °C · {metrics.get('gpu_power_watts') or '—'} W")

    readiness = payloads.get("readiness", {})
    summary = readiness.get("summary", {})
    warnings = [
        check for check in readiness.get("checks", [])
        if check.get("status") == "warning"
    ]
    section("INTEGRIDAD Y SERVICIOS")
    if readiness:
        line(
            "Preparación",
            f"{mark(not warnings)} {summary.get('ok', 0)} correctas · {len(warnings)} avisos",
        )
    else:
        line("Preparación", "○ no disponible")
    for warning in warnings[:8]:
        line("  atención", f"{warning.get('label')}: {warning.get('detail')}")
    for name, online in overview.get("services", {}).items():
        line(name.replace("_", " ").title(), f"{mark(bool(online))} {'disponible' if online else 'no disponible'}")

    gateway = payloads.get("gateway", {})
    line(
        "Gateway OpenAI",
        (
            f"{mark(bool(gateway.get('running')))} {gateway.get('endpoint', 'no disponible')} · "
            f"{len(gateway.get('aliases', []))} modelo(s)"
        ),
    )

    engines = payloads.get("engines", {}).get("engines", [])
    section("MOTORES")
    for engine in engines:
        if not engine.get("installed") and not engine.get("reachable"):
            continue
        state = "activo" if engine.get("reachable") else "instalado"
        line(
            str(engine.get("name") or engine.get("id")),
            f"{mark(bool(engine.get('reachable')))} {state} · v{engine.get('version') or 'desconocida'}",
        )

    models = payloads.get("models", {})
    ollama = models.get("ollama", [])
    huggingface = models.get("huggingface", [])
    all_models = [*ollama, *huggingface]
    loaded = [model for model in all_models if model.get("loaded")]
    assistant = models.get("assistant_model")
    section("MODELOS LOCALES")
    line("Inventario", f"{len(all_models)} locales · {len(loaded)} cargados")
    line("Chatbot", f"{assistant} · protegido" if assistant else "sin modelo disponible")
    for model in ollama:
        name = str(model.get("name") or model.get("model") or "Ollama")
        labels = ["cargado" if model.get("loaded") else "en disco", size(model.get("size"))]
        if model.get("assistant"):
            labels.append("chatbot protegido")
        line(name, f"{mark(bool(model.get('loaded')))} {' · '.join(labels)}")
    for model in huggingface:
        labels = ["cargado" if model.get("loaded") else "en disco", size(model.get("size"))]
        if model.get("assistant"):
            labels.append("chatbot protegido")
        line(str(model.get("repo_id") or "Hugging Face"), f"{mark(bool(model.get('loaded')))} {' · '.join(labels)}")

    profiles = payloads.get("profiles", {})
    runtime = profiles.get("runtime", {})
    active_ids = set(runtime.get("profile_ids") or [])
    section("PERFILES")
    default = next((item for item in profiles.get("profiles", []) if item.get("active")), None)
    line("Predeterminado", default.get("name") if default else "ninguno")
    line(
        "Runtime",
        f"{len(active_ids)} perfil(es) · {runtime.get('running_models', 0)} modelo(s) cargados",
    )
    for profile in profiles.get("profiles", []):
        if profile.get("id") in active_ids:
            line(str(profile.get("name")), "✓ cargado")

    section("ACCESO")
    line("Dashboard", base)
    line("Gateway OpenAI", gateway.get("endpoint") or "No disponible")
    line("Open WebUI", settings.openwebui_public_url or settings.openwebui_url)
    line("DGX Dashboard", settings.dgx_dashboard_url)

    if errors:
        section("DATOS NO DISPONIBLES")
        for name, error in errors.items():
            line(name, error)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
