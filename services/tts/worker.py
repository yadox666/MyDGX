"""Single-model TTS worker. Runs inside the virtual environment of its engine."""
from __future__ import annotations

import base64
import binascii
import hashlib
import importlib.util
import io
import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np
import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

os.environ.setdefault("WANDB_MODE", "disabled")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

ENGINE = os.environ["MYDGX_TTS_ENGINE"]
REPO = os.environ["MYDGX_TTS_REPO"]
PORT = int(os.environ["MYDGX_TTS_PORT"])
REFERENCE_DIR = Path(os.getenv("MYDGX_TTS_REFERENCE_DIR", "/reference"))
CLIENT_REFERENCE_DIR = Path(os.getenv("MYDGX_TTS_CLIENT_REFERENCE_DIR", "/tmp/mydgx-tts-refs"))
CLIENT_REFERENCE_KEEP = 16
MAX_REFERENCE_BYTES = 10 * 1024 * 1024
MAX_REFERENCE_SECONDS = 60.0
SEED = 1234
LANGUAGE_NAMES = {"en": "English", "es": "Spanish", "fr": "French", "de": "German", "zh": "Chinese"}


class SynthesisBody(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    language: str = Field(default="en", pattern=r"^[a-z]{2}$")
    reference_audio: str = Field(default="", max_length=14_000_000)
    reference_text: str = Field(default="", max_length=2000)
    temperature: float | None = Field(default=None, ge=0.05, le=1.5)


def client_reference(encoded: str) -> Path:
    """Decode a client reference voice into a normalized WAV cached by content hash."""
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="reference_audio no es base64 válido") from exc
    if not raw or len(raw) > MAX_REFERENCE_BYTES:
        raise HTTPException(status_code=413, detail="La voz de referencia supera el límite")
    digest = hashlib.sha256(raw).hexdigest()
    target = CLIENT_REFERENCE_DIR / f"{digest}.wav"
    if target.is_file():
        os.utime(target)
        return target
    try:
        data, rate = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="La voz de referencia no es un audio legible") from exc
    if not rate or data.shape[0] / rate > MAX_REFERENCE_SECONDS:
        raise HTTPException(status_code=400, detail="La voz de referencia supera 60 s")
    CLIENT_REFERENCE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = target.with_suffix(".part")
    sf.write(str(tmp), data.mean(axis=1), rate, format="WAV", subtype="PCM_16")
    tmp.replace(target)
    for stale in sorted(CLIENT_REFERENCE_DIR.glob("*.wav"), key=lambda p: p.stat().st_mtime)[:-CLIENT_REFERENCE_KEEP]:
        stale.unlink(missing_ok=True)
    return target


def reference_voice() -> tuple[Path, str]:
    manifest = json.loads((REFERENCE_DIR / "manifest.json").read_text(encoding="utf-8"))
    voice = manifest["voices"][0]
    path = REFERENCE_DIR / voice["filename"]
    if hashlib.sha256(path.read_bytes()).hexdigest() != voice["sha256"]:
        raise RuntimeError("La voz de referencia no coincide con su manifiesto")
    return path, str(voice["reference_text"])


def snapshot_dir(repo: str) -> Path:
    root = Path(os.getenv("HF_HUB_CACHE", "/hf/hub")) / f"models--{repo.replace('/', '--')}"
    ref = root / "refs" / "main"
    if ref.is_file():
        candidate = root / "snapshots" / ref.read_text().strip()
        if candidate.is_dir():
            return candidate
    snapshots = sorted((root / "snapshots").iterdir())
    if not snapshots:
        raise RuntimeError(f"{repo} no tiene snapshot local")
    return snapshots[-1]


def dtype() -> torch.dtype:
    return torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16


def as_mono(audio: Any) -> np.ndarray:
    if isinstance(audio, torch.Tensor):
        audio = audio.detach().float().cpu().numpy()
    if isinstance(audio, (list, tuple)):
        audio = np.concatenate([as_mono(part) for part in audio]) if audio else np.zeros(0)
    return np.asarray(audio, dtype=np.float32).reshape(-1)


Synth = Callable[[str, str, Path, str, "float | None"], np.ndarray]


def load_qwen3(_ref_audio: Path, _ref_text: str) -> tuple[Synth, int]:
    from faster_qwen3_tts import FasterQwen3TTS

    model = FasterQwen3TTS.from_pretrained(
        str(snapshot_dir(REPO)), device="cuda", dtype=dtype(), attn_implementation="sdpa",
    )
    model.warmup(prefill_len=100)
    sample_rate = 24_000

    def synth(text: str, language: str, ref_audio: Path, ref_text: str, temperature: float | None) -> np.ndarray:
        chunks = []
        for audio, rate, _ in model.generate_voice_clone_streaming(
            text=text,
            language=LANGUAGE_NAMES.get(language, "English"),
            ref_audio=str(ref_audio),
            ref_text=ref_text,
            chunk_size=8,
            max_new_tokens=1200,
            temperature=0.3 if temperature is None else temperature,
            repetition_penalty=1.5,
            non_streaming_mode=True,
        ):
            if int(rate) != sample_rate:
                raise RuntimeError(f"Sample rate inesperado: {rate}")
            chunks.append(as_mono(audio))
        return np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)

    return synth, sample_rate


def load_chatterbox(ref_audio: Path, _: str) -> tuple[Synth, int]:
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    model = ChatterboxMultilingualTTS.from_pretrained(device="cuda")
    model.prepare_conditionals(str(ref_audio), exaggeration=0.35)
    prepared = {"path": ref_audio}

    def synth(text: str, language: str, ref: Path, _text: str, temperature: float | None) -> np.ndarray:
        if ref != prepared["path"]:
            model.prepare_conditionals(str(ref), exaggeration=0.35)
            prepared["path"] = ref
        return as_mono(model.generate(
            text,
            language_id=language,
            exaggeration=0.35,
            cfg_weight=0.35,
            temperature=0.6 if temperature is None else temperature,
            repetition_penalty=1.2,
        ))

    return synth, int(model.sr)


def load_omnivoice(ref_audio: Path, ref_text: str) -> tuple[Synth, int]:
    from omnivoice import OmniVoice

    model = OmniVoice.from_pretrained(str(snapshot_dir(REPO)), device_map="cuda:0", dtype=torch.float16)
    prompts: dict[tuple[Path, str], Any] = {
        (ref_audio, ref_text): model.create_voice_clone_prompt(ref_audio=str(ref_audio), ref_text=ref_text),
    }

    def synth(text: str, _: str, ref: Path, ref_text_: str, _temperature: float | None) -> np.ndarray:
        key = (ref, ref_text_)
        if key not in prompts:
            if len(prompts) >= 8:
                prompts.pop(next(iter(prompts)))
            prompts[key] = model.create_voice_clone_prompt(ref_audio=str(ref), ref_text=ref_text_)
        return as_mono(model.generate(text=text, voice_clone_prompt=prompts[key]))

    return synth, 24_000


def load_f5(_ref_audio: Path, _ref_text: str) -> tuple[Synth, int]:
    from f5_tts.api import F5TTS

    root = snapshot_dir(REPO) / "F5TTS_v1_Base"
    checkpoint = next(iter(sorted(root.glob("model_*.safetensors"))), None)
    if not checkpoint:
        raise RuntimeError("No se encontró el checkpoint F5TTS_v1_Base")
    vocab = root / "vocab.txt"
    model = F5TTS(
        model="F5TTS_v1_Base",
        ckpt_file=str(checkpoint),
        vocab_file=str(vocab) if vocab.is_file() else "",
        vocoder_local_path=str(snapshot_dir("charactr/vocos-mel-24khz")),
        device="cuda",
    )

    def synth(text: str, _: str, ref: Path, ref_text: str, _temperature: float | None) -> np.ndarray:
        wav, _rate, _spec = model.infer(
            ref_file=str(ref), ref_text=ref_text, gen_text=text, seed=SEED,
            remove_silence=False, show_info=lambda *_: None,
        )
        return as_mono(wav)

    return synth, int(model.target_sample_rate)


LOADERS = {
    "qwen3": load_qwen3,
    "chatterbox": load_chatterbox,
    "omnivoice": load_omnivoice,
    "f5": load_f5,
}

state: dict[str, Any] = {"ready": False}
lock = threading.Lock()
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ready": state["ready"], "engine": ENGINE, "repo": REPO}


@app.post("/synthesize")
def synthesize(body: SynthesisBody) -> Response:
    if not state["ready"]:
        raise HTTPException(status_code=503, detail="Modelo no cargado")
    text = " ".join(body.text.split())
    if body.reference_audio:
        ref_text = " ".join(body.reference_text.split())
        if not ref_text:
            raise HTTPException(status_code=400, detail="reference_text es obligatorio con reference_audio")
        ref_audio = client_reference(body.reference_audio)
    else:
        ref_audio, ref_text = state["reference"]
    with lock:
        torch.manual_seed(SEED)
        torch.cuda.manual_seed_all(SEED)
        started = time.monotonic()
        with torch.inference_mode():
            samples = state["synth"](text, body.language, ref_audio, ref_text, body.temperature)
        torch.cuda.synchronize()
        elapsed_ms = (time.monotonic() - started) * 1000
    if not samples.size:
        raise HTTPException(status_code=500, detail="El motor devolvió audio vacío")
    buffer = io.BytesIO()
    sf.write(buffer, np.clip(samples, -1.0, 1.0), state["sample_rate"], format="WAV", subtype="PCM_16")
    return Response(
        content=buffer.getvalue(),
        media_type="audio/wav",
        headers={"X-TTS-Synthesis-Ms": f"{elapsed_ms:.1f}"},
    )


def soundfile_load(path: Any, *_: Any, **__: Any) -> tuple[torch.Tensor, int]:
    data, sample_rate = sf.read(str(path), dtype="float32", always_2d=True)
    return torch.from_numpy(np.ascontiguousarray(data.T)), int(sample_rate)


def main() -> None:
    if ENGINE not in LOADERS:
        raise SystemExit(f"Motor {ENGINE} sin adaptador")
    if importlib.util.find_spec("torchcodec") is None:
        import torchaudio

        # torchaudio 2.9 delegates load() to torchcodec, which has no aarch64 build for torch 2.9.
        torchaudio.load = soundfile_load
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    ref_audio, ref_text = reference_voice()
    state["reference"] = (ref_audio, ref_text)
    started = time.monotonic()
    state["synth"], state["sample_rate"] = LOADERS[ENGINE](ref_audio, ref_text)
    state["ready"] = True
    print(f"{ENGINE} {REPO} cargado en {time.monotonic() - started:.1f}s", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
