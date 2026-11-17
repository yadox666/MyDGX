import asyncio
import hashlib
import importlib.metadata
import json
import os
import tempfile
from pathlib import Path
from functools import lru_cache
from typing import Any

import torch
import whisper
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse


app = FastAPI(title="MyDGX Whisper", version="1.1.0")
MODEL_ROOT = Path(os.getenv("WHISPER_MODEL_DIR", "/models"))
HF_HUB = Path(os.getenv("WHISPER_HF_HUB", "/hf/hub"))
DEFAULT_MODEL = os.getenv("WHISPER_DEFAULT_MODEL", "turbo")
MAX_UPLOAD_BYTES = int(os.getenv("WHISPER_MAX_UPLOAD_MB", "64")) * 1024 * 1024
# Room for the multipart boundaries and the small form fields next to the audio.
MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024


class RequestSizeLimit:
    """Reject oversized bodies before multipart parsing spools them to disk."""

    def __init__(self, inner: Any) -> None:
        self.inner = inner

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http" or scope.get("method") not in {"POST", "PUT", "PATCH"}:
            await self.inner(scope, receive, send)
            return
        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None:
            try:
                too_large = int(declared) > MAX_REQUEST_BYTES
            except ValueError:
                await JSONResponse({"detail": "Content-Length no válido"}, status_code=400)(scope, receive, send)
                return
            if too_large:
                await JSONResponse({"detail": "El audio supera el límite configurado"}, status_code=413)(scope, receive, send)
                return
        received = 0

        async def limited_receive() -> dict[str, Any]:
            nonlocal received
            message = await receive()
            if message.get("type") == "http.request":
                received += len(message.get("body") or b"")
                if received > MAX_REQUEST_BYTES:
                    raise HTTPException(status_code=413, detail="El audio supera el límite configurado")
            return message

        await self.inner(scope, limited_receive, send)


app.add_middleware(RequestSizeLimit)
SAMPLE_RATE = 16_000
ALLOWED_MODELS = {
    "tiny", "tiny.en", "base", "base.en", "small", "small.en",
    "medium", "medium.en", "large", "large-v1", "large-v2", "large-v3", "turbo",
}
MODEL_ALIASES = {
    "whisper": DEFAULT_MODEL,
    "whisper-turbo": "turbo",
    "whisper-large-v3": "large-v3",
    "openai/whisper-large-v3": "large-v3",
    "openai/whisper-large-v3-turbo": "turbo",
}
_models: dict[str, Any] = {}
_model_lock = asyncio.Lock()
_inference_lock = asyncio.Lock()


@lru_cache(maxsize=32)
def checkpoint_sha256(path_text: str, size: int, modified_ns: int) -> str:
    path = Path(path_text)
    digest = hashlib.sha256()
    with path.open("rb") as checkpoint:
        while chunk := checkpoint.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def checkpoint_descriptor(name: str) -> dict[str, Any]:
    path = MODEL_ROOT / f"{name}.pt"
    if not path.is_file():
        return {"installed": False}
    stat = path.stat()
    return {
        "installed": True,
        "bytes": stat.st_size,
        "sha256": checkpoint_sha256(str(path), stat.st_size, stat.st_mtime_ns),
    }


def hf_snapshot(root: Path) -> Path | None:
    ref = root / "refs" / "main"
    if ref.is_file():
        candidate = root / "snapshots" / ref.read_text().strip()
        if candidate.is_dir():
            return candidate
    snapshots = sorted(path for path in (root / "snapshots").glob("*") if path.is_dir())
    return snapshots[-1] if snapshots else None


def hf_format(snapshot: Path) -> str:
    try:
        config = json.loads((snapshot / "config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ""
    if config.get("model_type") == "whisper" and any(
        (snapshot / name).is_file() for name in ("model.safetensors", "pytorch_model.bin")
    ):
        return "transformers"
    if (snapshot / "model.bin").is_file() and "suppress_ids_begin" in config:
        return "ctranslate2"
    return ""


def hf_whisper_repos() -> dict[str, dict[str, Any]]:
    repos: dict[str, dict[str, Any]] = {}
    for root in sorted(HF_HUB.glob("models--*")):
        snapshot = hf_snapshot(root)
        if not snapshot:
            continue
        model_format = hf_format(snapshot)
        if not model_format:
            continue
        files = []
        for path in sorted(snapshot.rglob("*")):
            if path.is_file():
                files.append((str(path.relative_to(snapshot)), path.stat().st_size))
        if not files:
            continue
        repo = root.name.removeprefix("models--").replace("--", "/")
        repos[repo] = {
            "path": snapshot,
            "format": model_format,
            "revision": snapshot.name,
            "bytes": sum(size for _, size in files),
            "sha256": hashlib.sha256(
                json.dumps({"repo": repo, "revision": snapshot.name, "files": files}).encode()
            ).hexdigest(),
        }
    return repos


def normalize_model(value: str) -> tuple[str, dict[str, Any] | None]:
    local = hf_whisper_repos().get(value)
    if local:
        return value, local
    model = MODEL_ALIASES.get(value, value)
    if model not in ALLOWED_MODELS:
        raise HTTPException(status_code=400, detail=f"Modelo Whisper no permitido: {value}")
    return model, None


class TransformersWhisper:
    def __init__(self, path: Path) -> None:
        from transformers import WhisperForConditionalGeneration, WhisperProcessor

        dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.processor = WhisperProcessor.from_pretrained(path)
        self.model = WhisperForConditionalGeneration.from_pretrained(
            path, torch_dtype=dtype, attn_implementation="sdpa",
        ).to(self.device).eval()

    def transcribe(self, audio_path: str, task: str, language: str | None, prompt: str | None) -> dict[str, Any]:
        audio = whisper.load_audio(audio_path)
        features = self.processor(
            audio, sampling_rate=SAMPLE_RATE, return_tensors="pt",
            truncation=False, padding="longest", return_attention_mask=True,
        )
        if features.input_features.shape[-1] < 3000:
            features = self.processor(audio, sampling_rate=SAMPLE_RATE, return_tensors="pt", return_attention_mask=True)
        options: dict[str, Any] = {"task": task, "num_beams": 1, "do_sample": False}
        if language:
            options["language"] = language
        if prompt:
            options["prompt_ids"] = torch.tensor(self.processor.get_prompt_ids(prompt), device=self.device)
        with torch.inference_mode():
            tokens = self.model.generate(
                features.input_features.to(self.device, self.model.dtype),
                attention_mask=features.attention_mask.to(self.device),
                return_timestamps=features.input_features.shape[-1] > 3000,
                **options,
            )
        text = self.processor.batch_decode(tokens, skip_special_tokens=True)[0]
        return {"task": task, "language": language, "text": text, "segments": [], "duration": len(audio) / SAMPLE_RATE}


class CTranslate2Whisper:
    def __init__(self, path: Path) -> None:
        from faster_whisper import WhisperModel

        cuda = torch.cuda.is_available()
        self.model = WhisperModel(str(path), device="cuda" if cuda else "cpu", compute_type="default")

    def transcribe(self, audio_path: str, task: str, language: str | None, prompt: str | None) -> dict[str, Any]:
        audio = whisper.load_audio(audio_path)
        segments, info = self.model.transcribe(
            audio, task=task, language=language, initial_prompt=prompt,
            beam_size=5, temperature=0.0, vad_filter=False,
        )
        rows = [
            {"id": index, "start": segment.start, "end": segment.end, "text": segment.text}
            for index, segment in enumerate(segments)
        ]
        return {
            "task": task,
            "language": info.language,
            "text": "".join(row["text"] for row in rows),
            "segments": rows,
            "duration": float(info.duration),
        }


class OpenAIWhisper:
    def __init__(self, name: str) -> None:
        self.model = whisper.load_model(
            name,
            device="cuda" if torch.cuda.is_available() else "cpu",
            download_root=str(MODEL_ROOT),
        )

    def transcribe(self, audio_path: str, task: str, language: str | None, prompt: str | None) -> dict[str, Any]:
        options: dict[str, Any] = {"task": task, "fp16": bool(torch.cuda.is_available()), "verbose": False}
        if language:
            options["language"] = language
        if prompt:
            options["initial_prompt"] = prompt
        return self.model.transcribe(audio_path, **options)


def build_model(name: str, local: dict[str, Any] | None) -> Any:
    if local is None:
        return OpenAIWhisper(name)
    if local["format"] == "ctranslate2":
        return CTranslate2Whisper(local["path"])
    return TransformersWhisper(local["path"])


async def loaded_model(name: str, local: dict[str, Any] | None) -> Any:
    async with _model_lock:
        if name not in _models:
            _models.clear()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            _models[name] = await asyncio.to_thread(build_model, name, local)
        return _models[name]


async def temporary_upload(upload: UploadFile) -> Path:
    suffix = Path(upload.filename or "audio.bin").suffix[:16]
    descriptor, raw_path = tempfile.mkstemp(prefix="mydgx-whisper-", suffix=suffix)
    path = Path(raw_path)
    total = 0
    try:
        with os.fdopen(descriptor, "wb") as target:
            while chunk := await upload.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="El audio supera el límite configurado")
                target.write(chunk)
        if total == 0:
            raise HTTPException(status_code=400, detail="El archivo de audio está vacío")
        return path
    except Exception:
        path.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()


def formatted_transcription(result: dict[str, Any], response_format: str) -> Any:
    if response_format == "text":
        return PlainTextResponse(str(result.get("text") or "").strip())
    if response_format == "verbose_json":
        segments = result.get("segments") or []
        return JSONResponse({
            "task": result.get("task"),
            "language": result.get("language"),
            "duration": result.get("duration") or max(
                (float(segment.get("end") or 0) for segment in segments),
                default=0,
            ),
            "text": str(result.get("text") or "").strip(),
            "segments": segments,
        })
    if response_format not in {"json", "text", "verbose_json"}:
        raise HTTPException(status_code=400, detail="response_format admite json, text o verbose_json")
    return JSONResponse({"text": str(result.get("text") or "").strip()})


async def run_transcription(
    upload: UploadFile,
    model_name: str,
    language: str | None,
    prompt: str | None,
    response_format: str,
    task: str,
) -> Any:
    selected, local = await asyncio.to_thread(normalize_model, model_name)
    path = await temporary_upload(upload)
    try:
        model = await loaded_model(selected, local)
        async with _inference_lock:
            result = await asyncio.to_thread(model.transcribe, str(path), task, language, prompt)
        return formatted_transcription(result, response_format)
    finally:
        path.unlink(missing_ok=True)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "version": importlib.metadata.version("openai-whisper"),
        "cuda": torch.cuda.is_available(),
        "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        "loaded_models": list(_models),
    }


@app.get("/version")
async def version() -> dict[str, str]:
    return {"version": importlib.metadata.version("openai-whisper")}


@app.get("/v1/models")
async def models() -> dict[str, Any]:
    checkpoints = [
        {
            "id": name,
            "object": "model",
            "owned_by": "openai-whisper",
            "repo_id": f"openai/whisper-{name}",
            **await asyncio.to_thread(checkpoint_descriptor, name),
        }
        for name in sorted(ALLOWED_MODELS)
    ]
    repos = [
        {
            "id": repo,
            "object": "model",
            "owned_by": "huggingface",
            "repo_id": repo,
            "format": local["format"],
            "revision": local["revision"],
            "installed": True,
            "bytes": local["bytes"],
            "sha256": local["sha256"],
        }
        for repo, local in (await asyncio.to_thread(hf_whisper_repos)).items()
    ]
    return {"object": "list", "data": checkpoints + repos}


@app.post("/v1/models/{model_name:path}/load")
async def load_model(model_name: str) -> dict[str, Any]:
    selected, local = await asyncio.to_thread(normalize_model, model_name)
    await loaded_model(selected, local)
    return {"loaded_models": list(_models)}


@app.delete("/v1/models")
async def unload_models() -> dict[str, Any]:
    async with _model_lock:
        _models.clear()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return {"loaded_models": []}


@app.post("/v1/audio/transcriptions")
async def transcriptions(
    file: UploadFile = File(...),
    model: str = Form(DEFAULT_MODEL),
    language: str | None = Form(None),
    prompt: str | None = Form(None),
    response_format: str = Form("json"),
) -> Any:
    return await run_transcription(file, model, language, prompt, response_format, "transcribe")


@app.post("/v1/audio/translations")
async def translations(
    file: UploadFile = File(...),
    model: str = Form(DEFAULT_MODEL),
    prompt: str | None = Form(None),
    response_format: str = Form("json"),
) -> Any:
    return await run_transcription(file, model, None, prompt, response_format, "translate")
