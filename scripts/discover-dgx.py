#!/usr/bin/env python3
"""Discover a DGX Spark advertising SSH over Bonjour/mDNS."""

from __future__ import annotations

import re
import shutil
import subprocess
import sys


NAME_HINT = re.compile(r"(?:dgx|spark|nvidia)", re.IGNORECASE)
SAFE_HOST = re.compile(r"^[A-Za-z0-9._:-]+$")


def run_with_timeout(command: list[str], seconds: float) -> str:
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        output, _ = process.communicate(timeout=seconds)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            output, _ = process.communicate(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            output, _ = process.communicate()
    return output


def discover_dns_sd() -> set[tuple[str, int, str]]:
    if not shutil.which("dns-sd"):
        return set()
    browse = run_with_timeout(["dns-sd", "-B", "_ssh._tcp", "local."], 4)
    services: set[str] = set()
    for line in browse.splitlines():
        match = re.search(r"\s_ssh\._tcp\.\s+(.+?)\s*$", line)
        if match and NAME_HINT.search(match.group(1)):
            services.add(match.group(1))

    devices: set[tuple[str, int, str]] = set()
    for service in services:
        resolved = run_with_timeout(
            ["dns-sd", "-L", service, "_ssh._tcp", "local."],
            3,
        )
        match = re.search(
            r"can be reached at ([A-Za-z0-9._:-]+)\.?:([0-9]{1,5})\b",
            resolved,
        )
        if not match:
            continue
        host = match.group(1).rstrip(".")
        port = int(match.group(2))
        if SAFE_HOST.fullmatch(host) and 1 <= port <= 65535:
            devices.add((host, port, service))
    return devices


def discover_avahi() -> set[tuple[str, int, str]]:
    if not shutil.which("avahi-browse"):
        return set()
    output = run_with_timeout(["avahi-browse", "-rtp", "_ssh._tcp"], 5)
    devices: set[tuple[str, int, str]] = set()
    for line in output.splitlines():
        if not line.startswith("="):
            continue
        fields = line.split(";")
        if len(fields) < 9:
            continue
        service, host, port_text = fields[3], fields[6].rstrip("."), fields[8]
        if not NAME_HINT.search(f"{service} {host}"):
            continue
        try:
            port = int(port_text)
        except ValueError:
            continue
        if SAFE_HOST.fullmatch(host) and 1 <= port <= 65535:
            devices.add((host, port, service))
    return devices


def main() -> int:
    devices = discover_dns_sd() or discover_avahi()
    if not devices:
        print(
            "No se encontró ningún DGX/Spark/NVIDIA anunciando SSH por mDNS.",
            file=sys.stderr,
        )
        return 1
    if len(devices) > 1:
        print("Se encontraron varios DGX; indica --host explícitamente:", file=sys.stderr)
        for host, port, service in sorted(devices):
            print(f"- {service}: {host}:{port}", file=sys.stderr)
        return 3
    host, port, _ = next(iter(devices))
    print(f"{host}\t{port}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
