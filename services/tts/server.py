"""MyDGX managed TTS coordinator.

Owns at most one engine worker at a time. Each engine runs in its own virtual
environment because their pinned dependencies are mutually incompatible.
Unloading kills the worker so the GPU memory is returned to the system.
"""
from __future__ import annotations

import asyncio
import json
import os
import socket
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

ENGINE_ROOT = Path(os.getenv("MYDGX_TTS_ENGINE_ROOT", "/opt/engines"))
HF_HUB = Path(os.getenv("HF_HUB_CACHE", "/hf/hub"))
LOAD_TIMEOUT = float(os.getenv("MYDGX_TTS_LOAD_TIMEOUT", "1200"))
SYNTH_TIMEOUT = float(os.getenv("MYDGX_TTS_SYNTH_TIMEOUT", "600"))
WORKER_LOG = Path(os.getenv("MYDGX_TTS_WORKER_LOG", "/tmp/mydgx-tts-worker.log"))

MODELS: dict[str, dict[str, str]] = {
    "Qwen/Qwen3-TTS-12Hz-1.7B-Base": {"engine": "qwen3", "name": "Qwen3-TTS 1.7B Base"},
    "Qwen/Qwen3-TTS-12Hz-0.6B-Base": {"engine": "qwen3", "name": "Qwen3-TTS 0.6B Base"},
    "ResembleAI/chatterbox": {"engine": "chatterbox", "name": "Chatterbox Multilingual"},
    "k2-fsa/OmniVoice": {"engine": "omnivoice", "name": "OmniVoice"},
    "SWivid/F5-TTS": {"engine": "f5", "name": "F5-TTS v1 Base"},
    "FunAudioLLM/Fun-CosyVoice3-0.5B-2512": {"engine": "cosyvoice", "name": "CosyVoice3 0.5B"},
    "fishaudio/s2-pro": {"engine": "fish", "name": "Fish Audio S2 Pro"},
    "mistralai/Voxtral-4B-TTS-2603": {"engine": "voxtral", "name": "Voxtral 4B TTS"},
}


class SpeechRequest(BaseModel):
    model: str = Field(min_length=1, max_length=200)
    input: str = Field(min_length=1, max_length=2000)
    language: str = Field(default="en", pattern=r"^[a-z]{2}$")
    response_format: str = Field(default="wav", pattern=r"^wav$")
    # Optional per-request voice: base64 audio (≤10 MB decoded, ≤60 s) plus its exact
    # transcript. The caller is responsible for holding consent for that voice.
    reference_audio: str = Field(default="", max_length=14_000_000)
    reference_text: str = Field(default="", max_length=2000)
    temperature: float | None = Field(default=None, ge=0.05, le=1.5)
    # Engine-specific sampling knobs (temperature, top_p, cfg_weight, num_steps...);
    # the worker keeps the ones its engine reads and clamps them.
    extras: dict[str, float] = Field(default_factory=dict, max_length=16)


class Worker:
    def __init__(self) -> None:
        self.process: asyncio.subprocess.Process | None = None
        self.repo: str | None = None
        self.port: int | None = None
        self.load_seconds: float | None = None
        self.lock = asyncio.Lock()

    def alive(self) -> bool:
        return bool(self.process and self.process.returncode is None)

    async def stop(self) -> None:
        process, self.process = self.process, None
        self.repo = self.port = self.load_seconds = None
        if process and process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=30)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()


worker = Worker()
app = FastAPI(title="MyDGX TTS", docs_url=None, redoc_url=None, openapi_url=None)


def engine_python(engine: str) -> Path:
    return ENGINE_ROOT / engine / "bin" / "python"


def engine_installed(engine: str) -> bool:
    return engine_python(engine).is_file()


def repo_local(repo: str) -> bool:
    snapshots = HF_HUB / f"models--{repo.replace('/', '--')}" / "snapshots"
    return snapshots.is_dir() and any(snapshots.iterdir())


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def worker_log_tail(lines: int = 12) -> str:
    try:
        content = WORKER_LOG.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    return " | ".join(line.strip() for line in content[-lines:] if line.strip())[-1500:]


async def load(repo: str) -> dict[str, Any]:
    spec = MODELS.get(repo)
    if not spec:
        raise HTTPException(status_code=404, detail="Modelo TTS no soportado")
    if not engine_installed(spec["engine"]):
        raise HTTPException(status_code=409, detail=f"Motor {spec['engine']} no instalado")
    if not repo_local(repo):
        raise HTTPException(status_code=409, detail="El modelo no está descargado")
    if worker.repo == repo and worker.alive():
        return {"loaded": repo, "load_seconds": worker.load_seconds, "reused": True}
    await worker.stop()
    port = free_port()
    started = time.monotonic()
    log = WORKER_LOG.open("wb")
    try:
        process = await asyncio.create_subprocess_exec(
            str(engine_python(spec["engine"])), "-s", "/app/worker.py",
            env={
                **os.environ,
                "MYDGX_TTS_ENGINE": spec["engine"],
                "MYDGX_TTS_REPO": repo,
                "MYDGX_TTS_PORT": str(port),
            },
            stdin=asyncio.subprocess.DEVNULL,
            stdout=log,
            stderr=asyncio.subprocess.STDOUT,
        )
    finally:
        log.close()
    worker.process, worker.repo, worker.port = process, repo, port
    deadline = started + LOAD_TIMEOUT
    async with httpx.AsyncClient(timeout=5) as client:
        while time.monotonic() < deadline:
            if process.returncode is not None:
                detail = worker_log_tail()
                await worker.stop()
                raise HTTPException(status_code=500, detail=f"El worker TTS terminó: {detail}")
            try:
                response = await client.get(f"http://127.0.0.1:{port}/health")
                if response.status_code == 200 and response.json().get("ready"):
                    worker.load_seconds = round(time.monotonic() - started, 3)
                    return {"loaded": repo, "load_seconds": worker.load_seconds, "reused": False}
            except (httpx.HTTPError, ValueError):
                pass
            await asyncio.sleep(1)
    await worker.stop()
    raise HTTPException(status_code=504, detail="El modelo TTS no terminó de cargar")


@app.get("/health")
async def health() -> dict[str, Any]:
    alive = worker.alive()
    return {
        "status": "ok",
        "engines": {name: engine_installed(name) for name in sorted({m["engine"] for m in MODELS.values()})},
        "loaded": worker.repo if alive else None,
        "reference": json.loads(Path("/reference/manifest.json").read_text())["voices"][0]["id"]
        if Path("/reference/manifest.json").is_file() else None,
    }


@app.get("/v1/models")
async def models() -> dict[str, Any]:
    return {
        "object": "list",
        "data": [
            {
                "id": repo,
                "object": "model",
                "name": spec["name"],
                "engine": spec["engine"],
                "engine_installed": engine_installed(spec["engine"]),
                "downloaded": repo_local(repo),
                "loaded": worker.repo == repo and worker.alive(),
            }
            for repo, spec in MODELS.items()
        ],
    }


@app.post("/v1/models/{repo:path}/load")
async def load_model(repo: str) -> dict[str, Any]:
    async with worker.lock:
        return await load(repo)


@app.delete("/v1/models")
async def unload_models() -> dict[str, Any]:
    async with worker.lock:
        previous = worker.repo
        await worker.stop()
    return {"unloaded": previous}


@app.post("/v1/audio/speech")
async def speech(payload: SpeechRequest) -> Response:
    async with worker.lock:
        if worker.repo != payload.model or not worker.alive():
            await load(payload.model)
        port = worker.port
        try:
            async with httpx.AsyncClient(timeout=SYNTH_TIMEOUT) as client:
                body: dict[str, Any] = {"text": payload.input, "language": payload.language}
                if payload.reference_audio:
                    body["reference_audio"] = payload.reference_audio
                    body["reference_text"] = payload.reference_text
                if payload.temperature is not None:
                    body["temperature"] = payload.temperature
                if payload.extras:
                    body["extras"] = payload.extras
                response = await client.post(f"http://127.0.0.1:{port}/synthesize", json=body)
        except httpx.HTTPError as exc:
            detail = "El worker TTS no respondió"
            if worker.process:
                try:
                    await asyncio.wait_for(worker.process.wait(), timeout=1)
                except asyncio.TimeoutError:
                    pass
            if not worker.alive():
                detail = f"El worker TTS terminó y se recargará en la próxima petición: {worker_log_tail()}"
                await worker.stop()
            raise HTTPException(status_code=502, detail=detail) from exc
    if response.status_code in (400, 413):
        try:
            detail = str(response.json().get("detail") or "")[:500]
        except ValueError:
            detail = response.text[:500]
        raise HTTPException(status_code=response.status_code, detail=detail)
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=response.text[:500])
    return Response(
        content=response.content,
        media_type="audio/wav",
        headers={
            "Cache-Control": "no-store",
            "X-TTS-Engine": MODELS[payload.model]["engine"],
            "X-TTS-Synthesis-Ms": response.headers.get("X-TTS-Synthesis-Ms", ""),
        },
    )


@app.on_event("shutdown")
async def shutdown() -> None:
    await worker.stop()
