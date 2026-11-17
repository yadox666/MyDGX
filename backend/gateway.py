from __future__ import annotations

import asyncio
import hmac
import json
import os
import re
import signal
import subprocess
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.datastructures import UploadFile

from backend.main import (
    COMFYUI_MANAGED_MODELS,
    MultimodalRunRequest,
    active_profile,
    benchmark_gate_active,
    browser_request_rejection,
    db,
    execute_multimodal_request,
    gateway_model_full_name,
    execute_video_job,
    gateway_runtime_config,
    managed_comfyui_enabled,
    mark_gateway_inference,
    profile_models,
    running_profile_models,
    running_profiles,
    settings,
    use_published_runtime,
)


def openai_error(message: str, status: int, code: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "error": {
                "message": message,
                "type": "invalid_request_error" if status < 500 else "server_error",
                "param": None,
                "code": code,
            }
        },
    )


def anthropic_error(message: str, status: int, error_type: str = "api_error") -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "type": "error",
            "error": {
                "type": error_type,
                "message": message,
            },
        },
    )


def compatible_error(
    anthropic: bool,
    message: str,
    status: int,
    code: str,
) -> JSONResponse:
    if anthropic:
        error_type = (
            "authentication_error"
            if status in {401, 403}
            else "invalid_request_error"
            if status < 500
            else "api_error"
        )
        return anthropic_error(message, status, error_type)
    return openai_error(message, status, code)


def benchmark_pause_response(anthropic: bool = False) -> JSONResponse | None:
    if not benchmark_gate_active():
        mark_gateway_inference()
        return None
    response = compatible_error(
        anthropic,
        "MyDGX está ejecutando un benchmark aislado; reintenta en unos segundos",
        503,
        "benchmark_in_progress",
    )
    response.headers["Retry-After"] = "30"
    return response


def require_gateway_key(
    request: Request,
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None, alias="x-api-key"),
) -> None:
    config = gateway_runtime_config()
    if not config["enabled"]:
        raise HTTPException(status_code=503, detail="Gateway desactivado")
    key = settings.gateway_api_key
    if config["host"] not in {"127.0.0.1", "localhost", "::1"} and not key:
        raise HTTPException(status_code=503, detail="El acceso de red requiere GATEWAY_API_KEY")
    client_host = request.client.host if request.client else ""
    if client_host in {"127.0.0.1", "::1", "localhost"}:
        return
    if not key:
        return
    scheme, _, supplied = (authorization or "").partition(" ")
    bearer_ok = scheme.lower() == "bearer" and hmac.compare_digest(supplied, key)
    api_key_ok = bool(x_api_key) and hmac.compare_digest(x_api_key or "", key)
    if not bearer_ok and not api_key_ok:
        raise HTTPException(status_code=401, detail="Gateway API key inválida")


def active_routes() -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    runtime_profiles = running_profiles()
    profiles = runtime_profiles
    if not profiles:
        fallback = active_profile()
        profiles = [fallback] if fallback else []
    runtime_ids = {profile["id"] for profile in runtime_profiles}
    routes: dict[str, dict[str, Any]] = {}
    route_keys: set[str] = set()
    for profile in profiles:
        sources = (
            running_profile_models(profile)
            if profile["id"] in runtime_ids
            else [model for model in profile_models(profile) if model.get("enabled", True)]
        )
        for source in sources:
            model = {**source, "_profile_id": profile["id"]}
            alias = model.get("model_alias") or model["model_ref"]
            if alias.casefold() in route_keys:
                continue
            routes[alias] = model
            route_keys.add(alias.casefold())
    managed_assistant = False
    has_conversation_model = any(
        str(model.get("task") or "chat") in {"chat", "vision"}
        for model in routes.values()
    )
    assistant_model = settings.assistant_model.strip()
    if (
        settings.assistant_enabled
        and not has_conversation_model
        and assistant_model
        and not assistant_model.startswith("profile:")
        and re.fullmatch(r"[A-Za-z0-9._:-]+", assistant_model)
    ):
        routes[assistant_model] = {
            "id": "assistant",
            "name": "Asistente local MyDGX",
            "engine": "ollama",
            "model_ref": assistant_model,
            "model_alias": assistant_model,
            "task": "chat",
            "api_protocol": "ollama",
            "context_size": 131072,
            "input_modalities": ["text"],
            "output_modalities": ["text"],
            "_profile_id": "managed-assistant",
        }
        route_keys.add(assistant_model.casefold())
        managed_assistant = True
    if managed_comfyui_enabled():
        for alias, source in COMFYUI_MANAGED_MODELS.items():
            if alias.casefold() not in route_keys:
                routes[alias] = {**source, "_profile_id": "managed-comfyui"}
                route_keys.add(alias.casefold())
    if not routes:
        raise HTTPException(status_code=503, detail="No hay perfiles cargados")
    profile_ids = [profile["id"] for profile in profiles]
    if managed_assistant:
        profile_ids.append("managed-assistant")
    if managed_comfyui_enabled():
        profile_ids.append("managed-comfyui")
    return {"id": "+".join(profile_ids)}, routes


def upstream_url(model: dict[str, Any], endpoint: str) -> str:
    if model["engine"] == "ollama":
        return f"{settings.ollama_url.rstrip('/')}{endpoint}"
    if model["engine"] != "llama.cpp":
        return f"{str(model.get('endpoint_url') or '').rstrip('/')}{endpoint}"
    return f"http://127.0.0.1:{int(model.get('_runtime_port') or model['port'])}{endpoint}"


def upstream_model_id(model: dict[str, Any]) -> str:
    if model["engine"] != "llama.cpp":
        return model["model_ref"]
    return model.get("_runtime_model_alias") or model.get("model_alias") or model["model_ref"]


async def model_is_healthy(model: dict[str, Any]) -> bool:
    try:
        async with httpx.AsyncClient(timeout=2) as client:
            if model["engine"] == "ollama":
                response = await client.get(f"{settings.ollama_url.rstrip('/')}/api/tags")
                if response.status_code >= 400:
                    return False
                installed = {item.get("name") for item in response.json().get("models", [])}
                return model["model_ref"] in installed
            if model["engine"] == "llama.cpp":
                port = int(model.get("_runtime_port") or model["port"])
                response = await client.get(f"http://127.0.0.1:{port}/health")
                return 200 <= response.status_code < 300
            endpoint = str(model.get("endpoint_url") or "").rstrip("/")
            if model.get("api_protocol") == "tts-lab":
                probes = [endpoint]
            else:
                probes = [f"{endpoint}/health", f"{endpoint}/v1/models", f"{endpoint}/system_stats"]
            for probe in probes:
                try:
                    response = await client.get(probe)
                    if 200 <= response.status_code < 300:
                        return True
                except httpx.HTTPError:
                    continue
            return False
    except (httpx.HTTPError, ValueError):
        return False


async def loaded_routes() -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    profile, routes = active_routes()
    health = await asyncio.gather(*(model_is_healthy(model) for model in routes.values()))
    return profile, {
        alias: model
        for (alias, model), healthy in zip(routes.items(), health)
        if healthy
    }


async def close_stream(response: httpx.Response, client: httpx.AsyncClient) -> None:
    await response.aclose()
    await client.aclose()
    # El periodo de calma de los benchmarks cuenta desde el final de la respuesta.
    mark_gateway_inference()


def response_headers(response: httpx.Response) -> dict[str, str]:
    allowed = {
        "cache-control", "content-disposition", "openai-processing-ms",
        "retry-after", "x-request-id",
    }
    return {
        key: value
        for key, value in response.headers.items()
        if key.lower() in allowed
    }


async def stream_response(
    response: httpx.Response,
    client: httpx.AsyncClient,
) -> AsyncIterator[bytes]:
    try:
        async for chunk in response.aiter_raw():
            yield chunk
    finally:
        await close_stream(response, client)


class LiteLLMAdapter:
    def __init__(self) -> None:
        self.process: subprocess.Popen[bytes] | None = None
        self.signature = ""
        self.lock = asyncio.Lock()
        self.log_handle: Any = None

    def _model_config(self, alias: str, model: dict[str, Any]) -> dict[str, Any] | None:
        if str(model.get("task") or "chat") not in {"chat", "vision"}:
            return None
        protocol = str(model.get("api_protocol") or "openai")
        if model["engine"] == "ollama":
            provider_model = f"ollama_chat/{model['model_ref']}"
            api_base = settings.ollama_url.rstrip("/")
            params: dict[str, Any] = {"model": provider_model, "api_base": api_base}
        elif protocol == "openai":
            upstream_id = upstream_model_id(model)
            provider_model = f"openai/{upstream_id}"
            if model["engine"] == "llama.cpp":
                port = int(model.get("_runtime_port") or model["port"])
                api_base = f"http://127.0.0.1:{port}/v1"
            else:
                api_base = str(model.get("endpoint_url") or "").rstrip("/")
                if not api_base.endswith("/v1"):
                    api_base = f"{api_base}/v1"
            params = {
                "model": provider_model,
                "api_base": api_base,
                "api_key": "local-mydgx-upstream",
            }
        else:
            return None
        return {
            "model_name": alias,
            "litellm_params": params,
            "model_info": {
                "mode": "chat",
                "supports_vision": str(model.get("task") or "chat") == "vision",
            },
        }

    def _config(self, routes: dict[str, dict[str, Any]]) -> dict[str, Any]:
        models = [
            config
            for alias, model in sorted(routes.items())
            if (config := self._model_config(alias, model)) is not None
        ]
        return {
            "model_list": models,
            "litellm_settings": {
                "drop_params": True,
                "request_timeout": int(gateway_runtime_config()["request_timeout_seconds"]),
                "set_verbose": False,
            },
            "general_settings": {
                "disable_spend_logs": True,
                "store_model_in_db": False,
            },
        }

    async def stop(self) -> None:
        process, self.process = self.process, None
        self.signature = ""
        if process and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                await asyncio.to_thread(process.wait, 10)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                await asyncio.to_thread(process.wait)
        if self.log_handle:
            self.log_handle.close()
            self.log_handle = None

    async def ensure(self, routes: dict[str, dict[str, Any]]) -> bool:
        config = self._config(routes)
        if not config["model_list"]:
            return False
        signature = json.dumps(config, sort_keys=True, separators=(",", ":"))
        async with self.lock:
            if self.process and self.process.poll() is None and self.signature == signature:
                return True
            await self.stop()
            executable = Path(sys.executable).with_name("litellm")
            if not executable.is_file():
                return False
            config_path = Path(settings.database_path).resolve().parent / "litellm.generated.json"
            temporary = config_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
            os.chmod(temporary, 0o600)
            temporary.replace(config_path)
            log_path = config_path.parent.parent / "logs" / "litellm.log"
            log_path.parent.mkdir(parents=True, exist_ok=True)
            self.log_handle = log_path.open("ab")
            try:
                self.process = subprocess.Popen(
                    [
                        str(executable), "--config", str(config_path),
                        "--host", "127.0.0.1", "--port", str(settings.gateway_litellm_port),
                    ],
                    stdin=subprocess.DEVNULL,
                    stdout=self.log_handle,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
            except OSError:
                await self.stop()
                return False
            self.signature = signature
            deadline = time.monotonic() + 30
            async with httpx.AsyncClient(timeout=1) as client:
                while time.monotonic() < deadline:
                    if self.process.poll() is not None:
                        await self.stop()
                        return False
                    try:
                        response = await client.get(
                            f"http://127.0.0.1:{settings.gateway_litellm_port}/health/liveliness"
                        )
                        if response.status_code < 400:
                            return True
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(0.25)
            await self.stop()
            return False


litellm_adapter = LiteLLMAdapter()


ENDPOINT_TASKS: dict[str, set[str]] = {
    "/v1/chat/completions": {"chat", "vision"},
    "/v1/completions": {"chat"},
    "/v1/embeddings": {"embeddings"},
    "/v1/responses": {"chat", "vision"},
    "/v1/images/generations": {"image-generation"},
    "/v1/audio/transcriptions": {"asr"},
    "/v1/audio/translations": {"asr"},
    "/v1/audio/speech": {"tts"},
    "/v1/videos/generations": {"video-generation"},
    "/v1/videos": {"video-generation"},
    "/v1/rerank": {"reranking"},
}


def supports_endpoint(model: dict[str, Any], endpoint: str) -> bool:
    return str(model.get("task") or "chat") in ENDPOINT_TASKS.get(endpoint, set())


def supports_gateway_protocol(model: dict[str, Any], endpoint: str) -> bool:
    protocol = str(model.get("api_protocol") or "openai")
    if protocol in {"openai", "ollama"}:
        return True
    if protocol == "comfyui":
        return endpoint in {"/v1/images/generations", "/v1/videos/generations", "/v1/videos"}
    return protocol == "tts-lab" and endpoint == "/v1/audio/speech"


async def resolve_route(model_alias: str, endpoint: str) -> dict[str, Any] | JSONResponse:
    try:
        _, routes = await loaded_routes()
    except HTTPException as exc:
        return openai_error(str(exc.detail), exc.status_code, "profile_unavailable")
    model = routes.get(model_alias)
    if not model:
        return openai_error(
            f"El modelo '{model_alias}' no está cargado en el perfil activo",
            404,
            "model_not_found",
        )
    if not supports_endpoint(model, endpoint):
        return openai_error(
            f"El modelo '{model_alias}' no admite este endpoint",
            400,
            "capability_not_supported",
        )
    if not supports_gateway_protocol(model, endpoint):
        return openai_error(
            f"El modelo '{model_alias}' necesita un adaptador de protocolo específico",
            409,
            "protocol_adapter_required",
        )
    return model


_managed_video_tasks: dict[str, asyncio.Task[None]] = {}


def start_managed_video(model: dict[str, Any], prompt: str) -> str:
    alias = str(model.get("model_alias") or model["model_ref"])
    job_id = db.create_job("multimodal.video", alias)
    task = asyncio.create_task(execute_video_job(
        job_id,
        MultimodalRunRequest(
            model=alias,
            task="video-generation",
            prompt=prompt,
        ),
    ))
    _managed_video_tasks[job_id] = task
    task.add_done_callback(lambda _: _managed_video_tasks.pop(job_id, None))
    return job_id


def managed_video_payload(job_id: str) -> dict[str, Any] | None:
    rows = db.rows("SELECT * FROM jobs WHERE id=? AND kind='multimodal.video'", (job_id,))
    if not rows:
        return None
    job = rows[0]
    result_rows = db.rows("SELECT result_json FROM job_results WHERE job_id=?", (job_id,))
    artifact_id = None
    if result_rows:
        try:
            artifact_id = json.loads(result_rows[0]["result_json"]).get("artifact_id")
        except (json.JSONDecodeError, AttributeError):
            artifact_id = None
    return {
        "id": job_id,
        "object": "video",
        "status": job["status"],
        "progress": job["progress"],
        "model": job["target"],
        "error": job["message"] if job["status"] == "failed" else None,
        "created_at": job["created_at"],
        "artifact_id": artifact_id,
    }


async def managed_comfyui_response(
    model: dict[str, Any],
    endpoint: str,
    payload: dict[str, Any],
) -> Response:
    prompt = payload.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        return openai_error("El campo prompt es obligatorio", 400, "prompt_required")
    if endpoint == "/v1/videos/generations":
        job_id = start_managed_video(model, prompt)
        return JSONResponse(status_code=202, content=managed_video_payload(job_id))
    if endpoint != "/v1/images/generations":
        return openai_error(
            "El adaptador ComfyUI no admite este endpoint",
            400,
            "capability_not_supported",
        )
    if int(payload.get("n") or 1) != 1:
        return openai_error("ComfyUI genera una imagen por solicitud", 400, "unsupported_n")
    result = await execute_multimodal_request(
        MultimodalRunRequest(
            model=str(model.get("model_alias") or model["model_ref"]),
            task="image-generation",
            prompt=prompt,
            response_format="b64_json",
        )
    )
    encoded = str(result.get("data_base64") or "")
    if not encoded:
        return openai_error("ComfyUI no devolvió una imagen", 502, "invalid_upstream_response")
    item = (
        {"b64_json": encoded}
        if payload.get("response_format", "url") == "b64_json"
        else {"url": f"data:{result.get('content_type', 'image/png')};base64,{encoded}"}
    )
    return JSONResponse({"created": int(time.time()), "data": [item]})


async def proxy_openai_request(request: Request, endpoint: str) -> Response:
    if paused := benchmark_pause_response():
        return paused
    config = gateway_runtime_config()
    content_length = request.headers.get("content-length")
    maximum = int(config["max_request_mb"]) * 1024 * 1024
    if content_length:
        try:
            if int(content_length) > maximum:
                return openai_error("Solicitud demasiado grande", 413, "request_too_large")
        except ValueError:
            return openai_error("Content-Length inválido", 400, "invalid_content_length")
    body = await request.body()
    if len(body) > maximum:
        return openai_error("Solicitud demasiado grande", 413, "request_too_large")
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return openai_error("El cuerpo debe ser JSON válido", 400, "invalid_json")
    if not isinstance(payload, dict) or not isinstance(payload.get("model"), str):
        return openai_error("El campo model es obligatorio", 400, "model_required")
    requested = payload["model"]
    model = await resolve_route(requested, endpoint)
    if isinstance(model, JSONResponse):
        return model
    protocol = str(model.get("api_protocol") or "openai")
    if protocol == "comfyui":
        try:
            return await managed_comfyui_response(model, endpoint, payload)
        except HTTPException as exc:
            return openai_error(str(exc.detail), exc.status_code, "upstream_unavailable")
    is_tts_lab = endpoint == "/v1/audio/speech" and protocol == "tts-lab"
    if is_tts_lab:
        text = payload.get("input")
        if not isinstance(text, str) or not text.strip():
            return openai_error("El campo input es obligatorio", 400, "input_required")
        output_format = str(payload.get("response_format") or "mp3")
        if output_format not in {"mp3", "wav", "flac", "opus"}:
            output_format = "mp3"
        payload = {
            "text": text,
            "model": upstream_model_id(model),
            "format": output_format,
            "source": "export",
        }
    else:
        payload["model"] = upstream_model_id(model)
    timeout = httpx.Timeout(float(config["request_timeout_seconds"]))
    client = httpx.AsyncClient(timeout=timeout)
    try:
        destination = upstream_url(model, endpoint)
        if is_tts_lab:
            project = await client.get(str(model.get("endpoint_url") or "").rstrip("/"))
            project.raise_for_status()
            payload["clone"] = str(project.json().get("project_type") or "clone") != "design"
            destination = f"{str(model.get('endpoint_url') or '').rstrip('/')}/tts"
        upstream = await client.send(
            client.build_request("POST", destination, json=payload),
            stream=True,
        )
    except (httpx.HTTPError, ValueError):
        await client.aclose()
        return openai_error("El modelo dejó de estar disponible", 503, "upstream_unavailable")
    if upstream.status_code >= 400:
        response_body = (await upstream.aread())[:1_048_576]
        content_type = upstream.headers.get("content-type", "application/json")
        headers = response_headers(upstream)
        await close_stream(upstream, client)
        return Response(
            content=response_body,
            status_code=upstream.status_code,
            media_type=content_type,
            headers=headers,
        )
    content_type = upstream.headers.get("content-type", "")
    if payload.get("stream") or "text/event-stream" in content_type:
        return StreamingResponse(
            stream_response(upstream, client),
            status_code=upstream.status_code,
            media_type=content_type or "text/event-stream",
            headers=response_headers(upstream),
        )
    response_body = await upstream.aread()
    headers = response_headers(upstream)
    await close_stream(upstream, client)
    return Response(
        content=response_body,
        status_code=upstream.status_code,
        media_type=content_type or "application/json",
        headers=headers,
    )


async def proxy_multipart_request(request: Request, endpoint: str) -> Response:
    if paused := benchmark_pause_response():
        return paused
    config = gateway_runtime_config()
    maximum = int(config["max_request_mb"]) * 1024 * 1024
    body = await request.body()
    if len(body) > maximum:
        return openai_error("Solicitud demasiado grande", 413, "request_too_large")
    try:
        form = await request.form()
    except Exception:
        return openai_error("Formulario multipart inválido", 400, "invalid_multipart")
    requested = form.get("model")
    if not isinstance(requested, str):
        return openai_error("El campo model es obligatorio", 400, "model_required")
    model = await resolve_route(requested, endpoint)
    if isinstance(model, JSONResponse):
        return model
    fields: dict[str, str] = {}
    files: list[tuple[str, tuple[str, bytes, str]]] = []
    allowed_audio = {
        "audio/mpeg", "audio/mp3", "audio/mp4", "audio/wav", "audio/x-wav",
        "audio/webm", "audio/ogg", "application/octet-stream",
    }
    for key, value in form.multi_items():
        if isinstance(value, UploadFile):
            content_type = value.content_type or "application/octet-stream"
            if content_type not in allowed_audio:
                return openai_error("Tipo de audio no permitido", 415, "unsupported_media_type")
            content = await value.read(maximum + 1)
            if len(content) > maximum:
                return openai_error("Archivo demasiado grande", 413, "request_too_large")
            files.append((key, (Path(value.filename or "audio").name, content, content_type)))
        elif key == "model":
            fields[key] = upstream_model_id(model)
        else:
            fields[key] = str(value)
    client = httpx.AsyncClient(timeout=float(model.get("timeout_seconds") or config["request_timeout_seconds"]))
    try:
        upstream = await client.send(
            client.build_request(
                "POST", upstream_url(model, endpoint), data=fields, files=files
            ),
            stream=True,
        )
    except httpx.HTTPError:
        await client.aclose()
        return openai_error("El modelo dejó de estar disponible", 503, "upstream_unavailable")
    content_type = upstream.headers.get("content-type", "application/json")
    response_body = await upstream.aread()
    status_code = upstream.status_code
    headers = response_headers(upstream)
    await close_stream(upstream, client)
    return Response(
        content=response_body,
        status_code=status_code,
        media_type=content_type,
        headers=headers,
    )


async def proxy_litellm_request(request: Request, endpoint: str) -> Response:
    if paused := benchmark_pause_response(endpoint.startswith("/v1/messages")):
        return paused
    config = gateway_runtime_config()
    maximum = int(config["max_request_mb"]) * 1024 * 1024
    body = await request.body()
    is_anthropic = endpoint.startswith("/v1/messages")
    if len(body) > maximum:
        return compatible_error(is_anthropic, "Solicitud demasiado grande", 413, "request_too_large")
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return compatible_error(is_anthropic, "El cuerpo debe ser JSON válido", 400, "invalid_json")
    if not isinstance(payload, dict) or not isinstance(payload.get("model"), str):
        return compatible_error(is_anthropic, "El campo model es obligatorio", 400, "model_required")
    try:
        _, routes = await loaded_routes()
    except HTTPException as exc:
        return compatible_error(is_anthropic, str(exc.detail), exc.status_code, "profile_unavailable")
    model = routes.get(payload["model"])
    if not model:
        return compatible_error(
            is_anthropic, "El modelo no está cargado en el perfil activo", 404, "model_not_found"
        )
    if str(model.get("task") or "chat") not in {"chat", "vision"}:
        return compatible_error(
            is_anthropic, "El modelo no admite conversación", 400, "capability_not_supported"
        )
    if model["engine"] != "ollama" and str(model.get("api_protocol") or "openai") != "openai":
        return compatible_error(
            is_anthropic, "El modelo necesita un adaptador no disponible", 409,
            "protocol_adapter_required",
        )
    if not await litellm_adapter.ensure(routes):
        return compatible_error(
            is_anthropic, "El adaptador LiteLLM no está disponible", 503, "adapter_unavailable"
        )
    forwarded_headers = {"content-type": "application/json"}
    for header in ("anthropic-version", "anthropic-beta", "user-agent", "x-request-id"):
        if value := request.headers.get(header):
            forwarded_headers[header] = value
    timeout = httpx.Timeout(float(config["request_timeout_seconds"]))
    client = httpx.AsyncClient(timeout=timeout)
    try:
        upstream = await client.send(
            client.build_request(
                "POST",
                f"http://127.0.0.1:{settings.gateway_litellm_port}{endpoint}",
                content=body,
                headers=forwarded_headers,
            ),
            stream=True,
        )
    except httpx.HTTPError:
        await client.aclose()
        return compatible_error(
            is_anthropic, "El adaptador dejó de estar disponible", 503, "adapter_unavailable"
        )
    content_type = upstream.headers.get("content-type", "")
    if payload.get("stream") or "text/event-stream" in content_type:
        return StreamingResponse(
            stream_response(upstream, client),
            status_code=upstream.status_code,
            media_type=content_type or "text/event-stream",
            headers=response_headers(upstream),
        )
    response_body = await upstream.aread()
    headers = response_headers(upstream)
    await close_stream(upstream, client)
    return Response(
        content=response_body,
        status_code=upstream.status_code,
        media_type=content_type or "application/json",
        headers=headers,
    )


async def proxy_video_job_request(
    request: Request,
    suffix: str = "",
    method: str = "POST",
) -> Response:
    if method == "POST" and (paused := benchmark_pause_response()):
        return paused
    try:
        _, routes = await loaded_routes()
    except HTTPException as exc:
        return openai_error(str(exc.detail), exc.status_code, "profile_unavailable")
    candidates = [
        model
        for model in routes.values()
        if str(model.get("task")) == "video-generation"
        and str(model.get("api_protocol") or "openai") in {"openai", "comfyui"}
    ]
    if len(candidates) != 1:
        return openai_error(
            "El perfil activo debe tener exactamente un motor de vídeo saludable",
            409,
            "video_route_ambiguous",
        )
    model = candidates[0]
    if str(model.get("api_protocol")) == "comfyui":
        if method == "POST":
            try:
                payload = json.loads(await request.body())
            except (json.JSONDecodeError, UnicodeDecodeError):
                return openai_error("El cuerpo debe ser JSON válido", 400, "invalid_json")
            if not isinstance(payload, dict) or not isinstance(payload.get("prompt"), str):
                return openai_error("El campo prompt es obligatorio", 400, "prompt_required")
            job_id = start_managed_video(model, payload["prompt"])
            return JSONResponse(status_code=202, content=managed_video_payload(job_id))
        match = re.fullmatch(r"/([A-Za-z0-9._-]+)(/content)?", suffix)
        if not match:
            return openai_error("Identificador de vídeo inválido", 400, "invalid_video_id")
        job_id, content_suffix = match.groups()
        video = managed_video_payload(job_id)
        if not video:
            return openai_error("Vídeo no encontrado", 404, "video_not_found")
        if method == "DELETE":
            task = _managed_video_tasks.get(job_id)
            if task and not task.done():
                task.cancel()
            if video["status"] not in {"completed", "failed", "cancelled"}:
                db.update_job(job_id, "cancelled", 0, "Generación cancelada")
            artifact_id = video.get("artifact_id")
            if isinstance(artifact_id, str):
                artifact_dir = Path(settings.database_path).expanduser().resolve().parent / "artifacts"
                for extension in (".webm", ".mp4"):
                    path = artifact_dir / f"{artifact_id}{extension}"
                    if path.is_file() and not path.is_symlink():
                        path.unlink()
            return JSONResponse({"id": job_id, "object": "video.deleted", "deleted": True})
        if content_suffix:
            if video["status"] != "completed" or not video.get("artifact_id"):
                return openai_error("El vídeo aún no está disponible", 409, "video_not_ready")
            artifact_dir = Path(settings.database_path).expanduser().resolve().parent / "artifacts"
            for extension, media_type in ((".webm", "video/webm"), (".mp4", "video/mp4")):
                path = artifact_dir / f"{video['artifact_id']}{extension}"
                if path.is_file() and not path.is_symlink():
                    return FileResponse(path, media_type=media_type, filename=path.name)
            return openai_error("Artefacto de vídeo no encontrado", 404, "artifact_not_found")
        return JSONResponse(video)
    body = await request.body()
    if method == "POST":
        try:
            payload = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return openai_error("El cuerpo debe ser JSON válido", 400, "invalid_json")
        if not isinstance(payload, dict):
            return openai_error("El cuerpo debe ser un objeto JSON", 400, "invalid_json")
        payload["model"] = upstream_model_id(model)
        body = json.dumps(payload).encode()
    client = httpx.AsyncClient(timeout=float(gateway_runtime_config()["request_timeout_seconds"]))
    try:
        upstream = await client.send(
            client.build_request(
                method,
                upstream_url(model, f"/v1/videos{suffix}"),
                content=body if method == "POST" else None,
                headers={"content-type": request.headers.get("content-type", "application/json")},
            ),
            stream=True,
        )
    except httpx.HTTPError:
        await client.aclose()
        return openai_error("El motor de vídeo no está disponible", 503, "upstream_unavailable")
    content_type = upstream.headers.get("content-type", "")
    if "text/event-stream" in content_type or "application/octet-stream" in content_type:
        return StreamingResponse(
            stream_response(upstream, client),
            status_code=upstream.status_code,
            media_type=content_type,
            headers=response_headers(upstream),
        )
    response_body = await upstream.aread()
    headers = response_headers(upstream)
    await close_stream(upstream, client)
    return Response(
        content=response_body,
        status_code=upstream.status_code,
        media_type=content_type or "application/json",
        headers=headers,
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.initialize()
    config = gateway_runtime_config()
    if settings.gateway_litellm_port in {int(config["port"]), settings.port}:
        raise RuntimeError("GATEWAY_LITELLM_PORT debe ser un puerto interno exclusivo")
    if config["host"] not in {"127.0.0.1", "localhost", "::1"} and not settings.gateway_api_key:
        raise RuntimeError("GATEWAY_API_KEY es obligatoria cuando el gateway escucha en la red")
    use_published_runtime()
    try:
        yield
    finally:
        use_published_runtime(False)
        await litellm_adapter.stop()


app = FastAPI(
    title="MyDGX OpenAI Gateway",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)
cors_origins = [
    origin.strip()
    for origin in settings.gateway_cors_origins.split(",")
    if origin.strip()
]
if "*" in cors_origins:
    raise RuntimeError("GATEWAY_CORS_ORIGINS no admite el comodín '*'")
if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=[
            "Authorization", "Content-Type", "anthropic-beta",
            "anthropic-version", "x-api-key", "x-request-id",
        ],
    )
gateway_auth = [Depends(require_gateway_key)]


@app.middleware("http")
async def reject_cross_site_requests(request: Request, call_next: Any) -> Any:
    if request.method.upper() == "OPTIONS":
        return await call_next(request)
    reason = browser_request_rejection(request, str(gateway_runtime_config()["host"]), set(cors_origins))
    if reason:
        return openai_error(reason, 403, "forbidden")
    return await call_next(request)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    if request.url.path.startswith("/v1/messages"):
        error_type = "authentication_error" if exc.status_code in {401, 403} else "api_error"
        return anthropic_error(str(exc.detail), exc.status_code, error_type)
    code = "authentication_error" if exc.status_code in {401, 403} else "gateway_unavailable"
    return openai_error(str(exc.detail), exc.status_code, code)


@app.get("/health")
async def health() -> dict[str, Any]:
    config = gateway_runtime_config()
    adapter_binary = Path(sys.executable).with_name("litellm")
    return {
        "status": "ok" if config["enabled"] else "disabled",
        "gateway": "MyDGX",
        "protocol_adapter": "ready" if adapter_binary.is_file() else "unavailable",
    }


def model_capabilities(model: dict[str, Any]) -> dict[str, bool]:
    conversational = str(model.get("task") or "chat") in {"chat", "vision"}
    llama_cpp = model.get("engine") == "llama.cpp"
    return {
        # llama.cpp solo emite tool calls con la plantilla Jinja del modelo.
        "tools": conversational and (not llama_cpp or bool(model.get("jinja", True))),
        "reasoning": conversational and not bool(model.get("reasoning_off", True)),
        "vision": "image" in (model.get("input_modalities") or []),
    }


@app.get("/v1/models", dependencies=gateway_auth)
async def models() -> dict[str, Any]:
    try:
        profile, routes = await loaded_routes()
    except HTTPException as exc:
        return openai_error(str(exc.detail), exc.status_code, "profile_unavailable")
    created = int(time.time())
    return {
        "object": "list",
        "data": [
            {
                "id": alias,
                "object": "model",
                "created": created,
                "owned_by": f"mydgx:{model.get('_profile_id') or profile['id']}",
                "name": gateway_model_full_name(model) or alias,
                "display_name": str(model.get("name") or ""),
                "task": model.get("task", "chat"),
                "input_modalities": model.get("input_modalities", ["text"]),
                "output_modalities": model.get("output_modalities", ["text"]),
                "context_length": int(
                    model.get("_runtime_context_size") or model.get("context_size") or 8192
                ),
                "capabilities": model_capabilities(model),
            }
            for alias, model in sorted(routes.items())
        ],
    }


@app.get("/v1/models/{model_id}", dependencies=gateway_auth)
async def model(model_id: str) -> Any:
    try:
        profile, routes = await loaded_routes()
    except HTTPException as exc:
        return openai_error(str(exc.detail), exc.status_code, "profile_unavailable")
    if model_id not in routes:
        return openai_error("Modelo no cargado", 404, "model_not_found")
    return {
        "id": model_id,
        "object": "model",
        "created": int(time.time()),
        "owned_by": f"mydgx:{routes[model_id].get('_profile_id') or profile['id']}",
        "task": routes[model_id].get("task", "chat"),
        "input_modalities": routes[model_id].get("input_modalities", ["text"]),
        "output_modalities": routes[model_id].get("output_modalities", ["text"]),
        "context_length": int(
            routes[model_id].get("_runtime_context_size")
            or routes[model_id].get("context_size")
            or 8192
        ),
        "capabilities": model_capabilities(routes[model_id]),
    }


@app.post("/v1/chat/completions", dependencies=gateway_auth)
async def chat_completions(request: Request) -> Response:
    return await proxy_openai_request(request, "/v1/chat/completions")


@app.post("/v1/completions", dependencies=gateway_auth)
async def completions(request: Request) -> Response:
    return await proxy_openai_request(request, "/v1/completions")


@app.post("/v1/embeddings", dependencies=gateway_auth)
async def embeddings(request: Request) -> Response:
    return await proxy_openai_request(request, "/v1/embeddings")


@app.post("/v1/responses", dependencies=gateway_auth)
async def responses(request: Request) -> Response:
    return await proxy_litellm_request(request, "/v1/responses")


@app.post("/v1/messages", dependencies=gateway_auth)
async def anthropic_messages(request: Request) -> Response:
    return await proxy_litellm_request(request, "/v1/messages")


@app.post("/v1/messages/count_tokens", dependencies=gateway_auth)
async def anthropic_count_tokens(request: Request) -> Response:
    return await proxy_litellm_request(request, "/v1/messages/count_tokens")


@app.post("/v1/images/generations", dependencies=gateway_auth)
async def images_generations(request: Request) -> Response:
    return await proxy_openai_request(request, "/v1/images/generations")


@app.post("/v1/audio/transcriptions", dependencies=gateway_auth)
async def audio_transcriptions(request: Request) -> Response:
    return await proxy_multipart_request(request, "/v1/audio/transcriptions")


@app.post("/v1/audio/translations", dependencies=gateway_auth)
async def audio_translations(request: Request) -> Response:
    return await proxy_multipart_request(request, "/v1/audio/translations")


@app.post("/v1/audio/speech", dependencies=gateway_auth)
async def audio_speech(request: Request) -> Response:
    return await proxy_openai_request(request, "/v1/audio/speech")


@app.post("/v1/videos/generations", dependencies=gateway_auth)
async def video_generations(request: Request) -> Response:
    return await proxy_openai_request(request, "/v1/videos/generations")


@app.post("/v1/videos", dependencies=gateway_auth)
async def create_video(request: Request) -> Response:
    return await proxy_video_job_request(request)


@app.get("/v1/videos/{video_id}", dependencies=gateway_auth)
async def get_video(video_id: str, request: Request) -> Response:
    if not re.fullmatch(r"[A-Za-z0-9._-]+", video_id):
        return openai_error("Identificador de vídeo inválido", 400, "invalid_video_id")
    return await proxy_video_job_request(request, f"/{video_id}", "GET")


@app.get("/v1/videos/{video_id}/content", dependencies=gateway_auth)
async def get_video_content(video_id: str, request: Request) -> Response:
    if not re.fullmatch(r"[A-Za-z0-9._-]+", video_id):
        return openai_error("Identificador de vídeo inválido", 400, "invalid_video_id")
    return await proxy_video_job_request(request, f"/{video_id}/content", "GET")


@app.delete("/v1/videos/{video_id}", dependencies=gateway_auth)
async def delete_video(video_id: str, request: Request) -> Response:
    if not re.fullmatch(r"[A-Za-z0-9._-]+", video_id):
        return openai_error("Identificador de vídeo inválido", 400, "invalid_video_id")
    return await proxy_video_job_request(request, f"/{video_id}", "DELETE")


@app.post("/v1/rerank", dependencies=gateway_auth)
async def rerank(request: Request) -> Response:
    return await proxy_openai_request(request, "/v1/rerank")
