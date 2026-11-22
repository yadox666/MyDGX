"""MyDGX backup archives: creation, encrypted secrets and offline recovery.

Recovery runs without the dashboard: ``./start.sh --recover FILE.tar.gz``.
"""

from __future__ import annotations

import argparse
import base64
import getpass
import io
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Callable

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_VERSION = "mydgx-backup-v1"
MANIFEST_MEMBER = "mydgx/manifest.json"
DATABASE_MEMBER = "mydgx/data/mydgx.db"
SECRETS_MEMBER = "mydgx/secrets.enc"
SECRETS_MAGIC = b"MYDGX-SECRETS-1\n"
CONFIRM_TOKEN = "RESTORE-MYDGX-BACKUP"
MIN_PASSPHRASE_LENGTH = 12
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**17, 8, 1
MAX_SECRETS_BYTES = 16 * 1024 * 1024
SKIPPED_DATA_FILES = frozenset({"litellm.generated.json"})
OPENWEBUI_SKIPPED_DIRS = frozenset({"cache"})
SQLITE_SIDECARS = ("-wal", "-shm", "-journal")
SQLITE_HEADER = b"SQLite format 3\x00"
EXCLUDED_NOTE = ["model caches", "engine virtualenvs", "logs", *sorted(SKIPPED_DATA_FILES)]


class BackupError(Exception):
    """A backup that cannot be created, read or restored; the message is shown to the user."""


def spanish() -> bool:
    return os.environ.get("MYDGX_LANGUAGE") == "es"


def pick(es: str, en: str) -> str:
    return es if spanish() else en


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def is_secret_file(path: Path) -> bool:
    """Secrets live in .env files; they only leave the DGX encrypted."""
    name = path.name.casefold()
    if name.endswith(".example"):
        return False
    return name == ".env" or name.startswith(".env.") or name.endswith(".env")


def regular_file(path: Path) -> bool:
    return path.is_file() and not path.is_symlink()


def is_sqlite(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            return handle.read(len(SQLITE_HEADER)) == SQLITE_HEADER
    except OSError:
        return False


def sqlite_snapshot(source: Path, destination: Path) -> None:
    """Consistent copy of a live database, including pages still in its WAL."""
    origin = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    target = sqlite3.connect(destination)
    try:
        origin.backup(target)
    finally:
        target.close()
        origin.close()


def default_share() -> Path:
    return Path.home() / ".local" / "share" / "mydgx"


def openwebui_data(share: Path) -> Path:
    return share / "open-webui" / "data"


def installed_engines(share: Path) -> list[str]:
    if not share.is_dir():
        return []
    return sorted(
        path.name for path in share.iterdir()
        if path.is_dir() and not path.is_symlink() and ((path / "venv").is_dir() or (path / "enabled").is_file())
    )


def secret_files(root: Path, share: Path) -> list[tuple[Path, str]]:
    found: list[tuple[Path, str]] = []
    if regular_file(root / ".env"):
        found.append((root / ".env", "root/.env"))
    config = root / "config"
    if config.is_dir():
        for path in sorted(config.rglob("*")):
            if regular_file(path) and is_secret_file(path):
                found.append((path, f"root/config/{path.relative_to(config).as_posix()}"))
    if share.is_dir():
        for path in sorted(share.glob("*/*")):
            if regular_file(path) and is_secret_file(path):
                found.append((path, f"share/{path.relative_to(share).as_posix()}"))
    return found


def derive_key(passphrase: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return Scrypt(salt=salt, length=32, n=n, r=r, p=p).derive(passphrase.encode("utf-8"))


def encrypt_secrets(files: list[tuple[Path, str]], passphrase: str) -> bytes:
    bundle = io.BytesIO()
    with tarfile.open(fileobj=bundle, mode="w") as archive:
        for path, name in files:
            data = path.read_bytes()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o600
            info.mtime = int(path.stat().st_mtime)
            archive.addfile(info, io.BytesIO(data))
    salt, nonce = os.urandom(16), os.urandom(12)
    header = json.dumps({
        "cipher": "AES-256-GCM", "kdf": "scrypt", "n": SCRYPT_N, "r": SCRYPT_R, "p": SCRYPT_P,
        "salt": base64.b64encode(salt).decode(), "nonce": base64.b64encode(nonce).decode(),
    }, sort_keys=True).encode()
    key = derive_key(passphrase, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P)
    return SECRETS_MAGIC + header + b"\n" + AESGCM(key).encrypt(nonce, bundle.getvalue(), SECRETS_MAGIC + header)


def decrypt_secrets(blob: bytes, passphrase: str) -> dict[str, bytes]:
    if not blob.startswith(SECRETS_MAGIC) or b"\n" not in blob[len(SECRETS_MAGIC):]:
        raise BackupError(pick("Los secretos cifrados de la copia están dañados.", "The encrypted secrets in the backup are damaged."))
    header, ciphertext = blob[len(SECRETS_MAGIC):].split(b"\n", 1)
    try:
        params = json.loads(header)
        n, r, p = int(params["n"]), int(params["r"]), int(params["p"])
        salt, nonce = base64.b64decode(params["salt"]), base64.b64decode(params["nonce"])
    except (ValueError, KeyError, TypeError) as exc:
        raise BackupError(pick("Los secretos cifrados de la copia están dañados.", "The encrypted secrets in the backup are damaged.")) from exc
    # Bounded so a crafted archive cannot demand gigabytes of scrypt memory.
    if params.get("kdf") != "scrypt" or params.get("cipher") != "AES-256-GCM" or not (2**14 <= n <= 2**20 and 1 <= r <= 16 and 1 <= p <= 4):
        raise BackupError(pick("Formato de secretos cifrados no admitido.", "Unsupported encrypted secrets format."))
    try:
        plain = AESGCM(derive_key(passphrase, salt, n, r, p)).decrypt(nonce, ciphertext, SECRETS_MAGIC + header)
    except InvalidTag as exc:
        raise BackupError(pick("Frase de paso incorrecta o secretos alterados.", "Wrong passphrase or tampered secrets.")) from exc
    secrets: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(plain), mode="r:") as archive:
        for member in archive.getmembers():
            parts = PurePosixPath(member.name).parts
            if not member.isfile() or len(parts) < 2 or parts[0] not in {"root", "share"} or ".." in parts or member.name.startswith("/"):
                raise BackupError(pick("Los secretos cifrados contienen una ruta no válida.", "The encrypted secrets contain an invalid path."))
            if parts[0] == "root" and not (parts[1:] == (".env",) or parts[1] == "config"):
                raise BackupError(pick("Los secretos cifrados contienen una ruta no válida.", "The encrypted secrets contain an invalid path."))
            extracted = archive.extractfile(member)
            assert extracted is not None
            secrets[member.name] = extracted.read()
    return secrets


def add_bytes(archive: tarfile.TarFile, name: str, data: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mode = 0o600
    info.mtime = int(datetime.now(timezone.utc).timestamp())
    archive.addfile(info, io.BytesIO(data))


def build_archive(
    target: Path, *, root: Path, database: Path, share: Path, version: str,
    passphrase: str | None = None, reason: str = "manual",
) -> dict[str, Any]:
    """Write the backup to target atomically and return its manifest."""
    members: list[tuple[Path, str]] = []
    config_root = root / "config"
    if config_root.is_dir():
        for path in sorted(config_root.rglob("*")):
            if regular_file(path) and not is_secret_file(path):
                members.append((path, f"mydgx/config/{path.relative_to(config_root).as_posix()}"))
    for path in sorted(database.parent.glob("*.json")):
        if regular_file(path) and path.name not in SKIPPED_DATA_FILES:
            members.append((path, f"mydgx/data/{path.name}"))
    secrets = secret_files(root, share) if passphrase else []
    partial = target.with_name(f".{target.name}.partial")
    with tempfile.TemporaryDirectory(dir=target.parent) as staging_name:
        staging = Path(staging_name)
        if database.is_file():
            sqlite_snapshot(database, staging / "mydgx.db")
        webui_root = openwebui_data(share)
        if webui_root.is_dir():
            for path in sorted(webui_root.rglob("*")):
                relative = path.relative_to(webui_root)
                if not regular_file(path) or relative.parts[0] in OPENWEBUI_SKIPPED_DIRS or path.name.endswith(SQLITE_SIDECARS):
                    continue
                name = f"mydgx/openwebui/{relative.as_posix()}"
                if is_sqlite(path):
                    snapshot = staging / "openwebui" / relative
                    snapshot.parent.mkdir(parents=True, exist_ok=True)
                    sqlite_snapshot(path, snapshot)
                    path = snapshot
                members.append((path, name))
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "reason": reason,
            "mydgx_version": version,
            "hostname": socket.gethostname(),
            "database": DATABASE_MEMBER if database.is_file() else None,
            "files": [name for _, name in members],
            "openwebui": any(name.startswith("mydgx/openwebui/") for _, name in members),
            "secrets": {"encrypted": bool(secrets), "files": [name for _, name in secrets]},
            "engines": installed_engines(share),
            "excluded": ([] if secrets else [".env and *.env files (secrets)"]) + EXCLUDED_NOTE,
        }
        try:
            with tarfile.open(partial, "w:gz") as archive:
                add_bytes(archive, MANIFEST_MEMBER, json.dumps(manifest, ensure_ascii=False, indent=2).encode())
                if database.is_file():
                    archive.add(staging / "mydgx.db", DATABASE_MEMBER, recursive=False)
                for path, name in members:
                    archive.add(path, name, recursive=False)
                if secrets:
                    add_bytes(archive, SECRETS_MEMBER, encrypt_secrets(secrets, passphrase or ""))
            os.chmod(partial, 0o600)
            partial.rename(target)
        finally:
            partial.unlink(missing_ok=True)
    return manifest


def read_manifest(path: Path) -> dict[str, Any] | None:
    """The manifest is the first member, so this only decompresses the start of the archive."""
    try:
        with tarfile.open(path, "r:gz") as archive:
            member = archive.next()
            if member is None or member.name != MANIFEST_MEMBER or not member.isfile() or member.size > 1024 * 1024:
                return None
            extracted = archive.extractfile(member)
            manifest = json.load(extracted) if extracted else None
    except (OSError, tarfile.TarError, ValueError):
        return None
    return manifest if isinstance(manifest, dict) else None


@dataclass
class Inspection:
    manifest: dict[str, Any]
    staging: Path
    database: Path | None = None
    data_files: list[tuple[str, Path]] = field(default_factory=list)
    config_files: list[tuple[str, Path]] = field(default_factory=list)
    openwebui_files: list[tuple[str, Path]] = field(default_factory=list)
    secrets_blob: bytes | None = None
    counts: dict[str, int] = field(default_factory=dict)


def invalid(member: str) -> BackupError:
    return BackupError(pick(f"La copia contiene una entrada no permitida: {member}", f"The backup contains a disallowed entry: {member}"))


def inspect_archive(path: Path, staging: Path) -> Inspection:
    """Validate the archive and stage its files; nothing outside staging is touched."""
    if not regular_file(path):
        raise BackupError(pick(f"No se encontró la copia: {path}", f"Backup not found: {path}"))
    try:
        archive = tarfile.open(path, "r:gz")
    except (OSError, tarfile.TarError) as exc:
        raise BackupError(pick("El archivo no es una copia .tar.gz válida.", "The file is not a valid .tar.gz backup.")) from exc
    manifest: dict[str, Any] | None = None
    inspection = Inspection(manifest={}, staging=staging)
    seen: set[str] = set()
    with archive:
        members = archive.getmembers()
        total = sum(member.size for member in members if member.isfile())
        if shutil.disk_usage(staging).free < total * 1.2 + 64 * 1024 * 1024:
            raise BackupError(pick("No hay espacio libre suficiente para validar la copia.", "There is not enough free space to validate the backup."))
        for member in members:
            name = member.name
            parts = PurePosixPath(name).parts
            if name.startswith("/") or ".." in parts or len(parts) < 2 or parts[0] != "mydgx" or name in seen:
                raise invalid(name)
            seen.add(name)
            if member.isdir():
                continue
            if not member.isfile():
                raise invalid(name)
            area = parts[1]
            if area == "manifest.json" and len(parts) == 2:
                extracted = archive.extractfile(member)
                try:
                    manifest = json.load(extracted) if extracted and member.size <= 1024 * 1024 else None
                except ValueError:
                    manifest = None
                continue
            if area == "secrets.enc" and len(parts) == 2:
                if member.size > MAX_SECRETS_BYTES:
                    raise invalid(name)
                extracted = archive.extractfile(member)
                inspection.secrets_blob = extracted.read() if extracted else None
                continue
            if area == "data" and len(parts) == 3 and (parts[2] == "mydgx.db" or parts[2].endswith(".json")):
                bucket = None if parts[2] == "mydgx.db" else inspection.data_files
            elif area == "config" and len(parts) >= 3 and not is_secret_file(Path(parts[-1])):
                bucket = inspection.config_files
            elif area == "openwebui" and len(parts) >= 3:
                bucket = inspection.openwebui_files
            else:
                raise invalid(name)
            staged = staging.joinpath(*parts[1:])
            staged.parent.mkdir(parents=True, exist_ok=True)
            extracted = archive.extractfile(member)
            assert extracted is not None
            with staged.open("wb") as handle:
                shutil.copyfileobj(extracted, handle)
            os.chmod(staged, 0o600)
            relative = "/".join(parts[2:])
            if bucket is None:
                inspection.database = staged
            else:
                bucket.append((relative, staged))
    if not isinstance(manifest, dict) or manifest.get("schema_version") != SCHEMA_VERSION:
        raise BackupError(pick("La copia no tiene un manifiesto MyDGX compatible.", "The backup does not have a compatible MyDGX manifest."))
    inspection.manifest = manifest
    if inspection.database is None:
        raise BackupError(pick("La copia no contiene la base de datos de MyDGX.", "The backup does not contain the MyDGX database."))
    connection = sqlite3.connect(f"file:{inspection.database}?mode=ro", uri=True)
    try:
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise BackupError(pick("La base de datos de la copia está dañada (integrity_check).", "The database in the backup is damaged (integrity_check)."))
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "profiles" not in tables:
            raise BackupError(pick("La base de datos de la copia no es de MyDGX.", "The database in the backup is not a MyDGX database."))
        for table in ("profiles", "benchmark_runs", "audit_events"):
            if table in tables:
                inspection.counts[table] = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    except sqlite3.DatabaseError as exc:
        raise BackupError(pick("La base de datos de la copia está dañada.", "The database in the backup is damaged.")) from exc
    finally:
        connection.close()
    if bool(inspection.secrets_blob) != bool((manifest.get("secrets") or {}).get("encrypted")):
        raise BackupError(pick("El manifiesto no coincide con los secretos de la copia.", "The manifest does not match the secrets in the backup."))
    return inspection


def install_file(source: Path | bytes, destination: Path, mode: int = 0o600) -> None:
    """Replace destination atomically; a symlink at destination is replaced, never followed."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.mydgx-restore")
    if isinstance(source, bytes):
        temporary.write_bytes(source)
    else:
        shutil.copyfile(source, temporary)
    os.chmod(temporary, mode)
    if is_sqlite(temporary):
        for suffix in SQLITE_SIDECARS:
            Path(f"{destination}{suffix}").unlink(missing_ok=True)
    os.replace(temporary, destination)


def secret_destination(name: str, root: Path, share: Path) -> Path:
    parts = PurePosixPath(name).parts
    return (root if parts[0] == "root" else share).joinpath(*parts[1:])


def apply_restore(
    inspection: Inspection, secrets: dict[str, bytes] | None, *, root: Path, database: Path, share: Path,
) -> dict[str, list[str]]:
    restored: dict[str, list[str]] = {"database": [], "data": [], "config": [], "config_kept": [], "openwebui": [], "secrets": []}
    assert inspection.database is not None
    install_file(inspection.database, database)
    restored["database"].append(str(database))
    for name, staged in inspection.data_files:
        install_file(staged, database.parent / name)
        restored["data"].append(name)
    for name, staged in inspection.config_files:
        destination = root / "config" / name
        # Files shipped with MyDGX keep the installed version; an old backup must not downgrade them.
        if destination.exists():
            restored["config_kept"].append(name)
            continue
        install_file(staged, destination, 0o644)
        restored["config"].append(name)
    webui = openwebui_data(share)
    for name, staged in inspection.openwebui_files:
        install_file(staged, webui / name)
        restored["openwebui"].append(name)
    for name, data in (secrets or {}).items():
        install_file(data, secret_destination(name, root, share))
        restored["secrets"].append(name)
    return restored


def missing_models(database: Path) -> list[str]:
    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    try:
        rows = connection.execute("SELECT name, model_file, model_repo FROM profiles WHERE model_file != '' ORDER BY name").fetchall()
    except sqlite3.DatabaseError:
        return []
    finally:
        connection.close()
    return [f"{name}: {repo or Path(model_file).name}" for name, model_file, repo in rows if not Path(model_file).expanduser().exists()]


def install_script(engine: str, root: Path) -> Path | None:
    for candidate in (f"install-{engine}.sh", f"install-{engine.replace('-', '')}.sh"):
        path = root / "scripts" / candidate
        if path.is_file():
            return path
    return None


def configured_database(root: Path) -> Path:
    value = "./data/mydgx.db"
    env = root / ".env"
    if regular_file(env):
        for line in env.read_text(encoding="utf-8", errors="replace").splitlines():
            key, separator, raw = line.partition("=")
            if separator and key.strip() == "DATABASE_PATH" and raw.strip():
                value = raw.strip().strip("'\"")
    path = Path(value).expanduser()
    return (path if path.is_absolute() else root / path).resolve()


def summary(path: Path, inspection: Inspection) -> list[str]:
    manifest = inspection.manifest
    secrets = (manifest.get("secrets") or {}).get("files") or []
    counts = inspection.counts
    lines = [
        pick("Copia de seguridad válida:", "Valid backup:") + f" {path.name}",
        pick("  Creada:", "  Created:") + f" {manifest.get('created_at', '?')} · {pick('equipo', 'host')} {manifest.get('hostname', '?')} · MyDGX {manifest.get('mydgx_version', '?')}",
        pick("  Base de datos:", "  Database:") + " " + pick(
            f"{counts.get('profiles', 0)} perfiles, {counts.get('benchmark_runs', 0)} benchmarks, {counts.get('audit_events', 0)} eventos de auditoría",
            f"{counts.get('profiles', 0)} profiles, {counts.get('benchmark_runs', 0)} benchmarks, {counts.get('audit_events', 0)} audit events",
        ),
        pick("  Archivos:", "  Files:") + f" {len(inspection.data_files)} data/, {len(inspection.config_files)} config/, {len(inspection.openwebui_files)} Open WebUI",
        pick("  Secretos:", "  Secrets:") + " " + (
            pick(f"{len(secrets)} archivos .env cifrados", f"{len(secrets)} encrypted .env files") if secrets
            else pick("no incluidos", "not included")
        ),
    ]
    if manifest.get("engines"):
        lines.append(pick("  Motores en el origen:", "  Engines on the source:") + " " + ", ".join(manifest["engines"]))
    return lines


def read_passphrase(args: argparse.Namespace, blob: bytes) -> tuple[dict[str, bytes], str]:
    if args.passphrase_file:
        passphrase = Path(args.passphrase_file).expanduser().read_text(encoding="utf-8").rstrip("\r\n")
        return decrypt_secrets(blob, passphrase), passphrase
    if not sys.stdin.isatty():
        raise BackupError(pick(
            "La copia tiene secretos cifrados: usa --passphrase-file RUTA o --skip-secrets sin terminal.",
            "The backup has encrypted secrets: use --passphrase-file PATH or --skip-secrets without a terminal.",
        ))
    for attempt in range(3):
        passphrase = getpass.getpass(pick("Frase de paso de los secretos: ", "Secrets passphrase: "))
        try:
            return decrypt_secrets(blob, passphrase), passphrase
        except BackupError as exc:
            if attempt == 2:
                raise
            print(exc, file=sys.stderr)
    raise AssertionError("unreachable")


def confirm(args: argparse.Namespace, restore_secrets: bool, has_openwebui: bool) -> None:
    replaced = [pick("la base de datos de MyDGX", "the MyDGX database")]
    if has_openwebui:
        replaced.append(pick("los datos de Open WebUI", "the Open WebUI data"))
    if restore_secrets:
        replaced.append(pick("los secretos (.env)", "the secrets (.env)"))
    print()
    print(pick("ATENCIÓN: se sustituirán ", "WARNING: this replaces ") + ", ".join(replaced) + pick(" de este equipo.", " on this machine."))
    print(pick(
        "Se pararán MyDGX y sus servicios; los modelos cargados se descargarán de memoria.\n"
        "Antes se guarda el estado actual en data/backups/ para poder deshacerlo.",
        "MyDGX and its services will stop; loaded models are unloaded from memory.\n"
        "The current state is saved first in data/backups/ so it can be undone.",
    ))
    if args.confirm is not None:
        if args.confirm != CONFIRM_TOKEN:
            raise BackupError(pick(f"Confirmación no válida: usa --confirm {CONFIRM_TOKEN}", f"Invalid confirmation: use --confirm {CONFIRM_TOKEN}"))
        return
    if not sys.stdin.isatty():
        raise BackupError(pick(f"Sin terminal, confirma con --confirm {CONFIRM_TOKEN}", f"Without a terminal, confirm with --confirm {CONFIRM_TOKEN}"))
    word = pick("RESTAURAR", "RESTORE")
    if input(pick(f"Escribe {word} para continuar: ", f"Type {word} to continue: ")).strip() != word:
        raise BackupError(pick("Cancelado: no se ha cambiado nada.", "Cancelled: nothing was changed."))


def run_start_script(command: str) -> None:
    subprocess.run([str(ROOT / "start.sh"), command], cwd=ROOT, check=True)


def recover(args: argparse.Namespace, *, root: Path = ROOT, share: Path | None = None,
            run: Callable[[str], None] = run_start_script, version: str = "") -> int:
    share = share or default_share()
    archive_path = Path(args.backup).expanduser().resolve()
    database = configured_database(root)
    database.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".mydgx-restore-", dir=database.parent))
    try:
        os.chmod(staging, 0o700)
        inspection = inspect_archive(archive_path, staging)
        print("\n".join(summary(archive_path, inspection)))
        secrets: dict[str, bytes] | None = None
        # The undo archive re-encrypts the current secrets with the same passphrase.
        passphrase_used: str | None = None
        if inspection.secrets_blob and not args.skip_secrets and (not args.check or args.passphrase_file):
            secrets, passphrase_used = read_passphrase(args, inspection.secrets_blob)
        if args.check:
            print(pick("Comprobación terminada: no se ha cambiado nada.", "Check finished: nothing was changed."))
            return 0
        confirm(args, bool(secrets), bool(inspection.openwebui_files))
        print(pick("Parando MyDGX…", "Stopping MyDGX…"))
        run("stop")
        backups = database.parent / "backups"
        backups.mkdir(parents=True, exist_ok=True)
        os.chmod(backups, 0o700)
        undo = backups / f"mydgx-backup-{utc_stamp()}.tar.gz"
        build_archive(undo, root=root, database=database, share=share, version=version,
                      passphrase=passphrase_used, reason="pre-restore")
        print(pick(f"Estado anterior guardado en {undo}", f"Previous state saved in {undo}"))
        restored = apply_restore(inspection, secrets, root=root, database=database, share=share)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    print(pick("Restaurado:", "Restored:") + " " + pick(
        f"base de datos, {len(restored['data'])} data/, {len(restored['config'])} config/ ({len(restored['config_kept'])} ya instalados se conservan), "
        f"{len(restored['openwebui'])} Open WebUI, {len(restored['secrets'])} secretos",
        f"database, {len(restored['data'])} data/, {len(restored['config'])} config/ ({len(restored['config_kept'])} already installed kept), "
        f"{len(restored['openwebui'])} Open WebUI, {len(restored['secrets'])} secrets",
    ))
    pending = recovery_followups(inspection.manifest, bool(restored["secrets"]), root=root, database=database, share=share)
    started = True
    if not args.no_start:
        print(pick("Arrancando MyDGX…", "Starting MyDGX…"))
        try:
            run("start")
            run("wait-ready")
        except subprocess.CalledProcessError:
            started = False
            pending.insert(0, pick("MyDGX no arrancó: revisa ./start.sh logs", "MyDGX did not start: check ./start.sh logs"))
    if pending:
        print(pick("Pendiente:", "To do:"))
        print("\n".join(f"  - {item}" for item in pending))
    print(pick(f"Para deshacer: ./start.sh --recover {undo}", f"To undo: ./start.sh --recover {undo}"))
    return 0 if started else 1


def recovery_followups(manifest: dict[str, Any], secrets_restored: bool, *, root: Path, database: Path, share: Path) -> list[str]:
    pending: list[str] = []
    if not secrets_restored:
        pending.append(pick(
            "Secretos no restaurados: revisa .env (MYDGX_DASHBOARD_PASSWORD, MYDGX_API_KEY, GATEWAY_API_KEY, HF_TOKEN) y reinicia.",
            "Secrets not restored: review .env (MYDGX_DASHBOARD_PASSWORD, MYDGX_API_KEY, GATEWAY_API_KEY, HF_TOKEN) and restart.",
        ))
    present = set(installed_engines(share))
    for engine in manifest.get("engines") or []:
        if engine in present or not isinstance(engine, str):
            continue
        script = install_script(engine, root)
        pending.append(pick(f"Motor {engine} no instalado", f"Engine {engine} not installed") + (f": {script.relative_to(root)}" if script else ""))
    models = missing_models(database)
    if models:
        pending.append(pick(
            f"{len(models)} perfiles sin su modelo en disco; descárgalos desde Modelos:",
            f"{len(models)} profiles without their model on disk; download them from Models:",
        ))
        pending.extend(f"    {item}" for item in models[:20])
    if Path("/run/systemd/system").is_dir() and not Path("/etc/systemd/system/mydgx.service").is_file():
        pending.append(pick("Servicios systemd sin instalar: scripts/install-systemd.sh", "systemd services not installed: scripts/install-systemd.sh"))
    return pending


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="./start.sh --recover", description=pick(
        "Restaura MyDGX desde una copia de seguridad .tar.gz.", "Restore MyDGX from a .tar.gz backup."))
    parser.add_argument("backup", help=pick("copia mydgx-backup-*.tar.gz", "mydgx-backup-*.tar.gz backup"))
    parser.add_argument("--check", action="store_true", help=pick("solo valida y resume; no cambia nada", "validate and summarize only; changes nothing"))
    parser.add_argument("--confirm", help=pick(f"confirmación sin terminal: {CONFIRM_TOKEN}", f"confirmation without a terminal: {CONFIRM_TOKEN}"))
    parser.add_argument("--passphrase-file", help=pick("archivo con la frase de paso de los secretos", "file holding the secrets passphrase"))
    parser.add_argument("--skip-secrets", action="store_true", help=pick("no restaura los secretos cifrados", "do not restore the encrypted secrets"))
    parser.add_argument("--no-start", action="store_true", help=pick("no arranca MyDGX al terminar", "do not start MyDGX afterwards"))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        return recover(args)
    except BackupError as exc:
        print(exc, file=sys.stderr)
        return 2
    except subprocess.CalledProcessError as exc:
        print(pick(f"Falló ./start.sh {exc.cmd[-1]}: no se ha cambiado nada.", f"./start.sh {exc.cmd[-1]} failed: nothing was changed."), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
