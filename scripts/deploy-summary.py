#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

import httpx

SPANISH = os.environ.get("MYDGX_LANGUAGE") == "es"


def tr(spanish: str, english: str) -> str:
    return spanish if SPANISH else english


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
    print(
        tr(
            "│  MyDGX · RESUMEN DEL DESPLIEGUE                                     │",
            "│  MyDGX · DEPLOYMENT SUMMARY                                          │",
        )
    )
    print("└──────────────────────────────────────────────────────────────────────┘")

    overview = payloads.get("overview", {})
    host = overview.get("host", {})
    metrics = overview.get("metrics", {})
    section(tr("SISTEMA", "SYSTEM"))
    line(
        tr("Equipo", "Host"),
        host.get("device_model") or host.get("hostname") or tr("No detectado", "Not detected"),
    )
    line(
        tr("Plataforma", "Platform"),
        "DGX Spark / GB10"
        if host.get("is_dgx_spark")
        else host.get("platform", tr("No detectada", "Not detected")),
    )
    line(
        tr("Sistema operativo", "Operating system"),
        host.get("os_name") or host.get("os_family") or tr("No detectado", "Not detected"),
    )
    line("Kernel", f"{host.get('kernel', '—')} · {host.get('architecture', '—')}")
    line(tr("GPU", "GPU"), host.get("gpu_name") or tr("No detectada", "Not detected"))
    line(
        tr("Recursos", "Resources"),
        (
            f"GPU {metrics.get('gpu_utilization', '—')}% · "
            f"CPU {float(metrics.get('cpu_percent') or 0):.1f}% · "
            f"RAM {float(metrics.get('memory_percent') or 0):.1f}% · "
            f"{tr('disco', 'disk')} {float(metrics.get('disk_percent') or 0):.1f}%"
        ),
    )
    if metrics.get("gpu_temperature") is not None:
        line(
            tr("GPU térmica/potencia", "GPU thermal/power"),
            f"{metrics['gpu_temperature']} °C · {metrics.get('gpu_power_watts') or '—'} W",
        )

    readiness = payloads.get("readiness", {})
    summary = readiness.get("summary", {})
    warnings = [
        check for check in readiness.get("checks", [])
        if check.get("status") == "warning"
    ]
    section(tr("INTEGRIDAD Y SERVICIOS", "INTEGRITY AND SERVICES"))
    if readiness:
        line(
            tr("Preparación", "Readiness"),
            f"{mark(not warnings)} {summary.get('ok', 0)} {tr('correctas', 'passed')} · {len(warnings)} {tr('avisos', 'warnings')}",
        )
    else:
        line(tr("Preparación", "Readiness"), tr("○ no disponible", "○ unavailable"))
    for warning in warnings[:8]:
        line(tr("  atención", "  warning"), f"{warning.get('label')}: {warning.get('detail')}")
    for name, online in overview.get("services", {}).items():
        line(
            name.replace("_", " ").title(),
            f"{mark(bool(online))} {tr('disponible', 'available') if online else tr('no disponible', 'unavailable')}",
        )

    gateway = payloads.get("gateway", {})
    line(
        "Gateway OpenAI",
        (
            f"{mark(bool(gateway.get('running')))} {gateway.get('endpoint', tr('no disponible', 'unavailable'))} · "
            f"{len(gateway.get('aliases', []))} {tr('modelo(s)', 'model(s)')}"
        ),
    )

    engines = payloads.get("engines", {}).get("engines", [])
    section(tr("MOTORES", "ENGINES"))
    for engine in engines:
        if not engine.get("installed") and not engine.get("reachable"):
            continue
        state = tr("activo", "active") if engine.get("reachable") else tr("instalado", "installed")
        line(
            str(engine.get("name") or engine.get("id")),
            f"{mark(bool(engine.get('reachable')))} {state} · v{engine.get('version') or tr('desconocida', 'unknown')}",
        )

    models = payloads.get("models", {})
    ollama = models.get("ollama", [])
    huggingface = models.get("huggingface", [])
    all_models = [*ollama, *huggingface]
    loaded = [model for model in all_models if model.get("loaded")]
    assistant = models.get("assistant_model")
    section(tr("MODELOS LOCALES", "LOCAL MODELS"))
    line(
        tr("Inventario", "Inventory"),
        f"{len(all_models)} {tr('locales', 'local')} · {len(loaded)} {tr('cargados', 'loaded')}",
    )
    line(
        tr("Chatbot", "Chatbot"),
        f"{assistant} · {tr('protegido', 'protected')}" if assistant else tr("sin modelo disponible", "no model available"),
    )
    for model in ollama:
        name = str(model.get("name") or model.get("model") or "Ollama")
        labels = [
            tr("cargado", "loaded") if model.get("loaded") else tr("en disco", "on disk"),
            size(model.get("size")),
        ]
        if model.get("assistant"):
            labels.append(tr("chatbot protegido", "protected chatbot"))
        line(name, f"{mark(bool(model.get('loaded')))} {' · '.join(labels)}")
    for model in huggingface:
        labels = [
            tr("cargado", "loaded") if model.get("loaded") else tr("en disco", "on disk"),
            size(model.get("size")),
        ]
        if model.get("assistant"):
            labels.append(tr("chatbot protegido", "protected chatbot"))
        line(str(model.get("repo_id") or "Hugging Face"), f"{mark(bool(model.get('loaded')))} {' · '.join(labels)}")

    profiles = payloads.get("profiles", {})
    runtime = profiles.get("runtime", {})
    active_ids = set(runtime.get("profile_ids") or [])
    section(tr("PERFILES", "PROFILES"))
    default = next((item for item in profiles.get("profiles", []) if item.get("active")), None)
    line(tr("Predeterminado", "Default"), default.get("name") if default else tr("ninguno", "none"))
    line(
        "Runtime",
        f"{len(active_ids)} {tr('perfil(es)', 'profile(s)')} · {runtime.get('running_models', 0)} {tr('modelo(s) cargados', 'model(s) loaded')}",
    )
    for profile in profiles.get("profiles", []):
        if profile.get("id") in active_ids:
            line(str(profile.get("name")), tr("✓ cargado", "✓ loaded"))

    section(tr("ACCESO", "ACCESS"))
    line("Dashboard", base)
    line("Gateway OpenAI", gateway.get("endpoint") or tr("No disponible", "Unavailable"))
    line("Open WebUI", settings.openwebui_public_url or settings.openwebui_url)
    line("DGX Dashboard", settings.dgx_dashboard_url)

    if errors:
        section(tr("DATOS NO DISPONIBLES", "UNAVAILABLE DATA"))
        for name, error in errors.items():
            line(name, error)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
