#!/usr/bin/env python3
"""Add an SSH-verified DGX to the macOS MyDGX Tray configuration."""

from __future__ import annotations

import json
import os
import re
import socket
import stat
import sys
import tempfile
import uuid
from pathlib import Path

SPANISH = os.environ.get("MYDGX_LANGUAGE") == "es"


def tr(spanish: str, english: str) -> str:
    return spanish if SPANISH else english


SAFE_HOST = re.compile(r"^[A-Za-z0-9._:-]+$")


def addresses(host: str) -> set[str]:
    values = {host.casefold().rstrip(".")}
    try:
        values.update(
            item[4][0].casefold().rstrip(".")
            for item in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        )
    except socket.gaierror:
        pass
    return values


def port_available(port: int) -> bool:
    for family, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        sock = socket.socket(family, socket.SOCK_STREAM)
        try:
            sock.bind((host, port))
        except OSError:
            return False
        finally:
            sock.close()
    return True


def alias_for(host: str, existing: set[str]) -> str:
    short = host.rstrip(".").split(".", 1)[0]
    match = re.fullmatch(r"spark[-_]?([A-Za-z0-9_-]+)", short, re.IGNORECASE)
    base = f"DGX Spark {match.group(1)}" if match else f"DGX {short}"
    alias = base
    suffix = 2
    while alias.casefold() in existing:
        alias = f"{base} {suffix}"
        suffix += 1
    return alias


def allocate_ports(connections: list[dict]) -> tuple[int, int, int]:
    used = {
        int(tunnel[key])
        for profile in connections
        for tunnel in [profile.get("tunnel") or {}]
        for key in ("localAPIPort", "localOpenWebUIPort", "localGatewayPort")
        if isinstance(tunnel.get(key), int)
    }
    for offset in range(0, 40_001, 10_000):
        candidate = (18_088 + offset, 13_000 + offset, 14_000 + offset)
        if max(candidate) > 65_535:
            break
        if all(port not in used and port_available(port) for port in candidate):
            return candidate
    raise SystemExit(
        tr(
            "ERROR: no hay tres puertos locales libres para el nuevo túnel.",
            "ERROR: no three free local ports for the new tunnel.",
        )
    )


def main() -> int:
    if len(sys.argv) != 5:
        print(
            tr(
                "Uso: add-dgx-to-tray.py HOST PUERTO IDENTIDAD RAÍZ",
                "Usage: add-dgx-to-tray.py HOST PORT IDENTITY ROOT",
            ),
            file=sys.stderr,
        )
        return 2
    host, port_text, identity_value, source_value = sys.argv[1:]
    if not SAFE_HOST.fullmatch(host):
        raise SystemExit(tr("ERROR: host descubierto no válido.", "ERROR: invalid discovered host."))
    try:
        port = int(port_text)
    except ValueError as exc:
        raise SystemExit(tr("ERROR: puerto SSH no válido.", "ERROR: invalid SSH port.")) from exc
    if not 1 <= port <= 65_535:
        raise SystemExit(tr("ERROR: puerto SSH fuera de rango.", "ERROR: SSH port out of range."))

    identity = Path(identity_value).expanduser()
    if not identity.is_file() or identity.is_symlink():
        raise SystemExit(
            tr(
                "ERROR: se necesita una clave SSH privada verificada.",
                "ERROR: a verified private SSH key is required.",
            )
        )
    if stat.S_IMODE(identity.stat().st_mode) & 0o077:
        raise SystemExit(
            tr(
                "ERROR: la clave SSH debe tener permisos 0600 o más restrictivos.",
                "ERROR: SSH key must have permissions 0600 or stricter.",
            )
        )
    display_identity = str(identity)
    if identity.is_relative_to(Path.home()):
        display_identity = f"~/{identity.relative_to(Path.home())}"

    source = Path(source_value).resolve()
    if not (source / "start.sh").is_file():
        raise SystemExit(tr("ERROR: la raíz local de MyDGX no es válida.", "ERROR: invalid local MyDGX root."))

    config_dir = Path.home() / ".MyDGX"
    config_path = config_dir / "config"
    if config_path.is_symlink():
        raise SystemExit(
            tr(
                "ERROR: ~/.MyDGX/config no puede ser un enlace simbólico.",
                "ERROR: ~/.MyDGX/config cannot be a symbolic link.",
            )
        )
    if config_path.exists():
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SystemExit(
                tr(
                    f"ERROR: configuración del Tray no válida: {exc}",
                    f"ERROR: invalid Tray configuration: {exc}",
                )
            ) from exc
    else:
        config = {"version": 2, "activeConnectionID": "", "connections": []}

    connections = config.get("connections")
    if not isinstance(connections, list):
        raise SystemExit(
            tr(
                "ERROR: ~/.MyDGX/config no contiene perfiles válidos.",
                "ERROR: ~/.MyDGX/config does not contain valid profiles.",
            )
        )

    discovered = addresses(host)
    for profile in connections:
        ssh = profile.get("ssh") or {}
        candidates = {str(ssh.get("host") or ""), str(profile.get("apiHost") or "")}
        if any(discovered.intersection(addresses(candidate)) for candidate in candidates if candidate):
            print(f"existing\t{profile.get('alias') or host}\t{profile.get('id') or ''}")
            return 0

    local_api, local_openwebui, local_gateway = allocate_ports(connections)
    profile_id = str(uuid.uuid4())
    alias = alias_for(
        host,
        {str(profile.get("alias") or "").casefold() for profile in connections},
    )
    profile = {
        "id": profile_id,
        "alias": alias,
        "kind": "lan",
        "scheme": "http",
        "apiHost": host,
        "apiPort": 8088,
        "dashboardPath": "/",
        "openWebUIURL": None,
        "apiKeyAccount": profile_id,
        "caCertificatePath": "",
        "refreshIntervalSeconds": 5,
        "ssh": {
            "host": host,
            "user": "nvidia",
            "port": port,
            "identityFile": display_identity,
        },
        "tunnel": {
            "enabled": True,
            "localAPIPort": local_api,
            "remoteAPIHost": "127.0.0.1",
            "remoteAPIPort": 8088,
            "localOpenWebUIPort": local_openwebui,
            "remoteOpenWebUIHost": "127.0.0.1",
            "remoteOpenWebUIPort": 3000,
            "localGatewayPort": local_gateway,
            "remoteGatewayHost": "127.0.0.1",
            "remoteGatewayPort": 4000,
            "localDGXDashboardPort": 11000,
            "remoteDGXDashboardHost": "127.0.0.1",
            "remoteDGXDashboardPort": 11000,
        },
        "deployment": {
            "sourcePath": str(source),
            "remoteDirectory": "MyDGX-Dashboard",
        },
    }
    connections.append(profile)
    config["version"] = max(2, int(config.get("version") or 2))
    config["activeConnectionID"] = profile_id

    config_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=".config.", dir=config_dir)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(config, handle, indent=2, sort_keys=True)
            handle.write("\n")
        temporary.chmod(0o600)
        os.replace(temporary, config_path)
    finally:
        temporary.unlink(missing_ok=True)
    config_path.chmod(0o600)
    print(f"added\t{alias}\t{profile_id}\t{local_api}\t{local_openwebui}\t{local_gateway}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
