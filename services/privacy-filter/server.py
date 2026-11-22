import asyncio
import importlib.metadata
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Literal

import torch
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

CHECKPOINT = Path(os.environ.get("PRIVACY_FILTER_CHECKPOINT", ""))
MODEL_ID = os.environ.get("PRIVACY_FILTER_MODEL_ID", "openai/privacy-filter")
MAX_CHARS = int(os.environ.get("PRIVACY_FILTER_MAX_CHARS", "400000"))
MAX_ITEMS = 64
MAX_REQUEST_BYTES = MAX_CHARS * 4 + 1024 * 1024
DEVICE: Literal["cpu", "cuda"] = "cuda" if torch.cuda.is_available() else "cpu"

if DEVICE == "cuda" and "OPF_MOE_TRITON" not in os.environ:
    try:
        import triton  # noqa: F401
    except ImportError:
        os.environ["OPF_MOE_TRITON"] = "0"

from opf import DecodeOptions, OPF  # noqa: E402

_redactor: OPF | None = None
_lock = asyncio.Lock()
_moe_kernel = "pytorch"


def warm_up(redactor: OPF) -> str:
    """Load the weights and run once so the first request does not pay for kernel compilation."""
    use_triton = DEVICE == "cuda" and os.environ.get("OPF_MOE_TRITON", "1") != "0"
    try:
        redactor.redact("Warm-up for Alice Example, alice@example.com.")
        return "triton" if use_triton else "pytorch"
    except Exception as exc:
        if not use_triton:
            raise
        print(f"Triton MoE kernels failed ({type(exc).__name__}); using PyTorch kernels", file=sys.stderr, flush=True)
        os.environ["OPF_MOE_TRITON"] = "0"
        redactor.redact("Warm-up for Alice Example, alice@example.com.")
        return "pytorch"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    global _redactor, _moe_kernel
    if not (CHECKPOINT / "config.json").is_file():
        raise RuntimeError(f"Privacy Filter checkpoint not found: {CHECKPOINT}")
    redactor = OPF(model=str(CHECKPOINT), device=DEVICE, output_mode="typed")
    _moe_kernel = await asyncio.to_thread(warm_up, redactor)
    _redactor = redactor
    yield


app = FastAPI(title="MyDGX Privacy Filter", version="1.0.0", lifespan=lifespan)


@app.middleware("http")
async def limit_request_size(request: Request, call_next: Any) -> Any:
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            too_large = int(declared) > MAX_REQUEST_BYTES
        except ValueError:
            return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
        if too_large:
            return JSONResponse({"detail": "The text exceeds the configured limit"}, status_code=413)
    return await call_next(request)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    # The default handler echoes the submitted input, which here is the private text.
    errors = [{"loc": error.get("loc"), "msg": error.get("msg")} for error in exc.errors()]
    return JSONResponse({"detail": errors}, status_code=422)


class RedactRequest(BaseModel):
    model: str = Field(default="", max_length=200)
    input: str | list[str]
    include_text: bool = False
    decode_mode: Literal["viterbi", "argmax"] = "viterbi"


def result_item(index: int, result: Any, include_text: bool) -> dict[str, Any]:
    spans = []
    for span in result.detected_spans:
        item = {"label": span.label, "start": span.start, "end": span.end, "placeholder": span.placeholder}
        if include_text:
            item["text"] = span.text
        spans.append(item)
    payload: dict[str, Any] = {"index": index, "redacted_text": result.redacted_text, "spans": spans}
    if result.warning:
        payload["warning"] = result.warning
    return payload


def run_redaction(texts: list[str], decode_mode: str, include_text: bool) -> list[dict[str, Any]]:
    assert _redactor is not None
    options = DecodeOptions(decode_mode=decode_mode)
    return [
        result_item(index, _redactor.redact(text, decode=options), include_text)
        for index, text in enumerate(texts)
    ]


@app.get("/health")
async def health() -> dict[str, Any]:
    if _redactor is None:
        raise HTTPException(status_code=503, detail="Model is loading")
    return {
        "status": "ok",
        "model": MODEL_ID,
        "version": importlib.metadata.version("opf"),
        "device": torch.cuda.get_device_name(0) if DEVICE == "cuda" else "cpu",
        "moe_kernel": _moe_kernel,
    }


@app.get("/v1/models")
async def models() -> dict[str, Any]:
    return {"object": "list", "data": [{"id": MODEL_ID, "object": "model", "owned_by": "openai", "task": "redaction"}]}


@app.post("/v1/redact")
async def redact(payload: RedactRequest) -> dict[str, Any]:
    if _redactor is None:
        raise HTTPException(status_code=503, detail="Model is loading")
    texts = [payload.input] if isinstance(payload.input, str) else payload.input
    if not texts or len(texts) > MAX_ITEMS:
        raise HTTPException(status_code=400, detail=f"input accepts between 1 and {MAX_ITEMS} texts")
    if not all(isinstance(text, str) for text in texts):
        raise HTTPException(status_code=400, detail="input must be text")
    if sum(len(text) for text in texts) > MAX_CHARS:
        raise HTTPException(status_code=413, detail="The text exceeds the configured limit")
    async with _lock:
        data = await asyncio.to_thread(run_redaction, texts, payload.decode_mode, payload.include_text)
    return {"object": "list", "model": MODEL_ID, "data": data}
