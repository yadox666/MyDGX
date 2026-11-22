# API reference

MyDGX exposes two HTTP APIs:

| Service | Default address | Purpose |
|---|---|---|
| **Dashboard** | `http://127.0.0.1:8088/api/...` | Manage the machine: telemetry, models, profiles, engines, benchmarks, system, logs and assistant. |
| **Gateway** | `http://127.0.0.1:4000/v1/...` | Consume the models of the loaded profiles over the OpenAI protocol (and Anthropic `/v1/messages`). |

This page lists **all** endpoints. A test (`test_every_route_is_documented`)
fails if a route is added without being documented here.

## Authentication and protections

**Dashboard.**

- If `MYDGX_API_KEY` is set, every request to `/api/*` (except
  `GET /api/health`) must carry the header `X-MyDGX-Key: YOUR_API_KEY`.
- With no key and listening only on loopback (`HOST=127.0.0.1`), the API accepts
  requests without the header. If `HOST` is not loopback and there is no key, it responds
  `503 Set MYDGX_DASHBOARD_PASSWORD or MYDGX_API_KEY for network access`.
- The Open WebUI tools (`/api/openwebui/tools/*`) use their own key,
  `OPENWEBUI_TOOL_API_KEY`, which is managed by the deployment.

**Gateway.** Loopback clients (for example through an SSH tunnel) do not
need a key. All others must send `Authorization: Bearer YOUR_GATEWAY_API_KEY`
or `x-api-key: YOUR_GATEWAY_API_KEY`. The gateway does not start on a network address
without `GATEWAY_API_KEY`.

**Both services reject browser requests coming from other websites:**

- `Host` must be loopback, the IP the service listens on (or the machine's own
  IPs if it listens on all of them) or a name in `TRUSTED_HOSTS`. This protects against DNS
  rebinding. Response: `403 Host not allowed`.
- On `POST`, `PUT`, `PATCH` and `DELETE`, an `Origin` other than the service's own
  (or the allowed CORS origins) and `Sec-Fetch-Site: cross-site` are rejected.
  `curl`, scripts and servers do not send `Origin`, so they are not affected.

**Confirmations.** Destructive or high-impact operations require an exact
confirmation text in the body or in `?confirm=`; it is stated for each endpoint.
That way an accidental click or request does not delete or stop anything.

**Jobs.** Long-running operations (downloads, verifications, profile
startup, benchmarks, updates) return `{"job_id": "..."}` and continue in the
background. Their progress is available at `GET /api/jobs/{job_id}`.

**Errors.** FastAPI format: `{"detail": "message in Spanish"}` with the appropriate
HTTP code (`400` validation, `403` disabled or forbidden, `404` does not exist,
`409` state conflict, `5xx` runtime failure).

```bash
# Example: overall status with a key (replace the placeholder; never paste it into versioned scripts)
curl -s -H "X-MyDGX-Key: $MYDGX_API_KEY" http://127.0.0.1:8088/api/overview
```

## Status and configuration

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Dashboard health (`status`, `name`, `version`). No authentication. |
| GET | `/api/auth/status` | Whether the dashboard requires a password (`required`), whether the current session is valid (`authenticated`), the seconds it has left and the session duration. No authentication; not cached. |
| POST | `/api/auth/login` | Receives `{"password": "…"}` and, if it matches, opens a session with an `httponly`, `samesite=strict` cookie. Returns `401` if the password is wrong and `429` with `Retry-After` after too many attempts. |
| POST | `/api/auth/refresh` | Renews a valid session cookie for another `MYDGX_SESSION_TTL_MINUTES`, never past `MYDGX_SESSION_MAX_HOURS` since login. The dashboard calls it only after user activity. Returns `401` if the session has expired. |
| POST | `/api/auth/logout` | Ends the session by deleting the cookie. |
| GET | `/api/config` | Public configuration: service URLs, whether an HF token or keys are configured (booleans only), enabled features. |
| GET | `/api/overview` | Current telemetry, machine identity, services, running benchmark suite, memory map, loaded profiles (`running_profiles`) and active web apps (`web_apps`: `name`, `alias`, `port`, `url`, `state`, `reachable`). |
| GET | `/api/metrics/history` | Host history. Parameters: `minutes`, or ISO `start` and `end`. |
| GET | `/api/metrics/models` | Per-model telemetry. Parameters: `minutes`, `profile_id`. |
| GET | `/api/settings/env` | `.env` parameters editable from Settings (current value, default value, limits and whether they require a restart) and `hf_token_configured`. The token is never returned. |
| PUT | `/api/settings/env` | Changes those parameters in `.env` and in memory. Body: `values` (key → value), `hf_token` (verified with Hugging Face before saving) or `clear_hf_token`. Authentication, network and privileged-operation keys are not accepted. |
| POST | `/api/settings/hf-token/verify` | Checks the configured `HF_TOKEN` with Hugging Face. Returns `configured`, `valid` and the account name. |
| GET | `/api/notifications` | Error notices (failed download, error loading a model or starting a profile, failed benchmark, broken or incomplete model): date, title, text, sanitized log and whether they have been read. Also returns `unread`. Parameter: `limit`. |
| POST | `/api/notifications/read` | Marks notices as read. Body: `ids` or `all: true`. |
| GET | `/api/gateway/config` | Gateway configuration and status: host, port, published aliases, active profile and `web_search`. |
| PUT | `/api/gateway/config` | Changes `enabled`, `host`, `port`, `request_timeout_seconds`, `max_request_mb` and `web_search` (default `true`). Host, port and enablement require restarting the gateway. Web search applies on save. |

## Models

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/models` | Installed Ollama and Hugging Face models, models loaded in memory, and persistence. |
| PUT | `/api/models/persistence` | Adds or removes a model from the **Default** profile, which always starts with MyDGX. If Default is loaded, the change applies immediately. Body: `source` (`ollama`/`huggingface`), `model_id`, `enabled` and, optionally, `context_size`. Without `context_size` it uses the same context as `quick/start`. |
| POST | `/api/models/quick/start` | **Starts** an installed model immediately in the **Quick** profile, if it fits in memory. Quick is not restored on restart. Body: `source`, `model_id` and, optionally, `context_size` (clamped to the range between the agents' minimum and the model's maximum, which `GET /api/models` publishes in `quick_start.context`). `409` if it does not fit or is already loaded. |
| GET | `/api/models/settings` | **Startup settings** of a downloaded GGUF. For each value it gives the automatic one, the effective one and its origin (`ficha`, `GGUF`, `manual`…). Includes the main quantizations with their architecture and whether the installed llama.cpp recognizes it, the mmproj files, the context range and the drafters available for speculative decoding. Parameter: `model_id`. |
| PUT | `/api/models/settings` | Saves manual values for that model; a `null` field reverts to automatic and a body with only `model_id` resets everything. Fields: `model_filename`, `mmproj_filename` (`""` disables vision), `context_size`, `context_max`, sampling (`temperature`, `top_p`, `top_k`, `min_p`, `repeat_penalty`, `presence_penalty`), `cache_type_k`/`cache_type_v`, `spec_type` (`off` or a `draft-*`), `draft_filename` and `spec_draft_n_max`. If the model is in Default, it is updated there too. |
| POST | `/api/models/quick/stop` | **Stops** a Quick model without touching the others. When the last one is stopped, Quick disappears. Body: `source`, `model_id`. |
| POST | `/api/models/stop-all` | **Stops all models** except the chat one: stops the loaded profiles (Quick included) except Default and the one hosting the assistant's model, and unloads resident Ollama models that do not belong to them. Does not touch ComfyUI, TTS or Whisper. Returns `stopped_profiles`, `released_ollama` and `kept_profiles`; `409` if a profile is starting. |
| POST | `/api/models/comfyui/release` | **Frees** ComfyUI memory. Unloads all the models it has loaded, because ComfyUI does not allow releasing just one; they are loaded again on the next generation. Returns `502` if ComfyUI does not respond. |
| GET | `/api/models/search` | Recommendations for this machine (memory, compatibility, estimated performance, HF community score). Parameters: `q`, `task`, `size`, `alignment`, `runtime`, `model_format`, `modality`, `limit`, `page`. |
| GET | `/api/models/huggingface/search` | General Hugging Face search. Parameters: `q`, `task`, `modality`, `limit`. |
| GET | `/api/models/huggingface/favorites` | List of favorites. |
| PUT | `/api/models/huggingface/favorites` | Adds or removes a favorite. Body: `repo_id`, `enabled`. |
| GET | `/api/models/huggingface/inspect/{repo_id}` | Metadata, formats, files and capabilities of a repository. Parameter: `revision`. |
| POST | `/api/models/huggingface/download` | Downloads a full snapshot. Body: `repo_id`, `revision`. Returns `job_id`. |
| POST | `/api/models/huggingface/files/download` | Downloads only some files (for example a GGUF). Body: `repo_id`, `revision`, `files`. Returns `job_id`. When finished, it queues an automatic benchmark of the main GGUF files downloaded. That benchmark checks that they start and respond, and measures real versus estimated memory and drafter acceptance. |
| POST | `/api/models/huggingface/preflight` | **Preflight check** without downloading anything: reads the header of each selected GGUF via HTTP Range. For each one it returns its role (main, mmproj or a drafter type), the architecture, whether the installed llama.cpp recognizes it, the native context, the quantization, whether it has built-in MTP and the estimated memory at 32K. Includes warnings: incomplete shards, missing main model, drafter with mmproj, drafter available but not selected (in `suggested_draft`) or insufficient memory. Body: `repo_id`, `revision`, `files`. |
| GET | `/api/models/import/limits` | Limits for importing a ZIP: free space, maximum ZIP size right now (`max_upload_now_bytes`, the ZIP and its extraction fit with a 2 GiB margin), the `MODEL_IMPORT_MAX_GB` cap, the maximum memory for the main model and the namespace (`imported`). |
| POST | `/api/models/import/upload` | **Imports a GGUF model from a ZIP**. The body is the raw ZIP (not multipart) with a mandatory `Content-Length`; parameters `filename` (must end in `.zip`) and `run_test` (`true` by default). Responds with the `{job_id}` of a `models.import` job with five steps: upload, check (safe paths, no encryption or symbolic links, reasonable compression, valid `mydgx.json`), extract to `imported/<nombre>` in the HF cache, analyze (complete parts, architecture, memory) and test with a one-repetition benchmark. The result is read at `/api/jobs/{job_id}/result`. 400 if the file is not valid, 409 if another import is already running, 413 if it does not fit. Cancelable. |
| POST | `/api/models/huggingface/integrity/{repo_id}` | Verifies the SHA-256 hashes of the local cache against Hugging Face. Returns `job_id`. |
| DELETE | `/api/models/huggingface/{repo_id}` | Deletes a repository from the cache. `?confirm=` the exact `repo_id`. `409` if a loaded profile or a download is using it. |
| POST | `/api/models/ollama/pull` | Downloads an Ollama model. Body: `name`. Returns `job_id`. |
| POST | `/api/models/ollama/update` | Downloads an Ollama model again to update it. Body: `name`. |
| POST | `/api/models/ollama/load` | Loads an Ollama model into memory. Body: `name`, `keep_alive` (`10m`, `1h`, `0`...). |
| POST | `/api/models/ollama/unload` | Unloads an Ollama model from memory. Body: `name`. |
| DELETE | `/api/models/ollama/{name}` | Removes an Ollama model. `?confirm=` the exact name. |

All downloads are limited to the size of the machine's physical memory.

## Profiles

A profile groups one or more models (main plus additional) with their engine,
port, context and parameters. Up to two chat or vision profiles or Quick models
can be loaded at the same time; `GET /api/profiles` (`runtime`) and the startup
plan report the occupied slots in `llm_slots` and `max_llm_slots`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/profiles` | Profiles with models, memory plan, execution status, available apps (`apps`, with alias and web port in `apps.web`) and runtime status. |
| POST | `/api/profiles` | Creates a profile (body `ProfilePayload`, see below). |
| PUT | `/api/profiles/{profile_id}` | Replaces a profile's configuration. |
| GET | `/api/profiles/recipes` | Recipe catalog from GitHub (`source: github`) or, offline, the local copy (`source: local` and `error`). Each recipe has `version`, `changelog`, `categories` (`text`, `code`, `vision`, `embeddings`, `image`, `video`, `audio`) and `description` (`es`, `en`), `memory_gib`, `installed_version` (0 when not installed) `installed_ids`, `missing_models` (models of the installed recipe not yet downloaded) and `running`. `?refresh=true` skips the 5-minute cache. |
| POST | `/api/profiles/recipes/{recipe_id}/install` | Installs the recipe as a read-only profile with its own `id` and name. Body: `download_models`. Returns `id`, `name`, `version` and the download `jobs`. `409` if it is already installed or the name exists. |
| POST | `/api/profiles/recipes/{recipe_id}/copy` | Creates a normal, editable profile from the published recipe. Body: `name` (required, cannot start with `RECIPE`) and `download_models`. Returns `id`, `name` and `jobs`. |
| POST | `/api/profiles/recipes/{recipe_id}/download` | Queues the download of any missing models of an installed recipe, additional models and MTP drafters included. Returns `id` and `jobs`. `404` if it is not installed. |
| POST | `/api/profiles/recipes/{recipe_id}/update` | Replaces the installed recipe with the published version, even a lower one (to withdraw a faulty version). Keeps `id`, favorite and default. `409` if the profile is loaded. |
| POST | `/api/profiles/{profile_id}/duplicate` | Creates an editable copy with another name (`name`). Copies models and parameters, but not the favorite or default flag, and assigns new llama.cpp ports. `409` if the name already exists. |
| POST | `/api/profiles/{profile_id}/models` | Adds a downloaded model as an additional model, with the same configuration as *Start*. Body: `source` (`huggingface` or `ollama`), `model_id` and, optionally, `context_size`. It gets its own port and alias. If the profile is loaded, it applies when the profile is restarted. `409` if it already contains it or already has the maximum number of models; `403` on Default and Quick. |
| PATCH | `/api/profiles/{profile_id}/favorite` | Marks or unmarks as favorite. Body: `favorite`. |
| POST | `/api/profiles/{profile_id}/download` | Downloads all of the profile's missing models. Returns `job_id`. |
| POST | `/api/profiles/{profile_id}/models/{model_id}/download` | Downloads a single model of the profile. |
| POST | `/api/profiles/{profile_id}/activate` | Marks it as default (started when MyDGX starts) without loading it. |
| GET | `/api/profiles/{profile_id}/runtime-plan` | Combined plan before starting: required memory, alias and port conflicts, reassignments. |
| POST | `/api/profiles/{profile_id}/start` | Prepares (downloads whatever is missing) and starts the profile. Returns `job_id` (`profile.prepare-start`, cancelable). |
| POST | `/api/profiles/{profile_id}/stop` | Stops a loaded profile and its app. |
| POST | `/api/profiles/stop` | Stops all profiles and their apps. |
| DELETE | `/api/profiles/{profile_id}` | Deletes the profile. `?confirm=` the exact profile name. |
| GET | `/api/profiles/model-defaults` | Parameters a downloaded model would start with (the same as *Start*: context, sampling from the model card or the GGUF, KV cache, `mmproj`), used to prefill a model in a profile. Parameters: `source` (`huggingface` or `ollama`) and `model_id`. |
| GET | `/api/profiles/recommend/{repo_id}` | Recommends engine, GGUF file, context and parameters for a repository. Parameters: `task`, `runtime`. |
| GET | `/api/profile-apps` | Lists the apps in the apps folder with their `start.sh`, runs `start.sh status` for each one (skipping apps with an action in progress) and returns `root`, `available`, `states` and `web`. |
| POST | `/api/profile-apps/{name}/{action}` | Runs a profile app's `start.sh`. `action`: `start`, `stop`, `restart` or `status`. |
| PUT | `/api/profile-apps/{name}/web` | Sets an app's alias and web port (`alias`, `port` 1024-65535; `port: null` removes it). `409` if the alias or port is already in use (MyDGX, gateway, services, profile models, systray tunnels, Default/Quick ranges or another app). Returns `restart_required` if the app is running. |

Main fields of `ProfilePayload`: `name`, `engine` (`llama.cpp`, `ollama`,
`vllm`, `sglang`, `tensorrt-llm`, `openai-compatible`, `comfyui`, `diffusers`,
`whisper`, `riva`, `nvidia-nim`), `task`, `model_ref`, `model_repo`,
`model_filename` or `model_files`, `model_alias`, `port`, `context_size`,
sampling parameters (`temperature`, `top_p`, `top_k`, `min_p`...),
`additional_models` (up to 12), `memory_reserve_mb`, `auto_fit_context`,
`minimum_context_size` and `app` (name of the app started with the profile;
see [Usage guide](guia-de-uso.md#profile-app)).

## AI Lab and Open WebUI tools

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/multimodal/capabilities` | Available models and tasks (image, audio, video, embeddings, reranking, TTS, ASR). |
| POST | `/api/multimodal/run` | Runs a task. Body: `model`, `task`, `prompt`, `data_url` (base64 file), `documents`, `voice`, `response_format`. |
| POST | `/api/multimodal/video/jobs` | Launches a video generation in the background. Returns `job_id`. |
| GET | `/api/artifacts/{artifact_id}` | Downloads a generated result (image, audio, video). |
| GET | `/api/openwebui/tools/openapi.json` | OpenAPI specification that Open WebUI imports as a tool server. |
| GET | `/api/openwebui/tools/capabilities` | Capabilities exposed to Open WebUI. |
| POST | `/api/openwebui/tools/run` | Runs a multimodal task from Open WebUI. |
| POST | `/api/openwebui/tools/video/jobs` | Launches a video from Open WebUI. Body: `model`, `prompt`. |
| GET | `/api/openwebui/tools/jobs/{job_id}` | Status of a job launched from Open WebUI. |
| GET | `/api/openwebui/tools/jobs/{job_id}/result` | Result of that job. |

Task and format details in [AI Lab](laboratorio-ia.md).

## Benchmarks

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/benchmarks` | Runs, queue, running suite and scoring algorithm. Parameter: `limit`. |
| GET | `/api/benchmarks/pending` | Number of installed, runnable models that have not completed the suite yet (`pending`). Used by the sidebar counter. |
| POST | `/api/benchmarks/runs` | Measures a target. Body: `target`, `protocol_id`, `repetitions`, `strict_isolation`. |
| POST | `/api/benchmarks/suite` | Launches a suite over several candidates. Body: `repetitions`, `candidate_keys`. |
| POST | `/api/benchmarks/suite/{suite_id}/stop` | Stops the suite and restores the previous state. |
| POST | `/api/benchmarks/queue/{entry_id}/skip` | Removes a model from the automatic queue. |
| GET | `/api/benchmarks/runs/{run_id}` | Details of a run. |
| GET | `/api/benchmarks/runs/{run_id}/export` | Exports the run as a verifiable bundle. |
| POST | `/api/benchmarks/import` | Imports an exported bundle. Body: `bundle`. |

Full methodology in [Benchmarks](benchmarks.md).

## Chat and assistant

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/chat` | Direct chat with a model (Ollama or `profile:PROFILE_ID:MODEL_ID`). Body: `model`, `message`, `history`. |
| GET | `/api/assistant/status` | Assistant availability, chosen model and fallbacks. |
| POST | `/api/assistant/chat` | Operations assistant turn. Body: `message`, `history`, `model`. |
| POST | `/api/assistant/actions/confirm` | Executes a proposed action. Body: `action_id`. |
| POST | `/api/assistant/actions/reject` | Discards a proposed action. Body: `action_id`. |

Details in [MyDGX Assistant](asistente-mydgx.md).

## Jobs, logs and audit

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/jobs` | Recent jobs with progress and status. |
| GET | `/api/jobs/{job_id}` | Status and events of a job. |
| POST | `/api/jobs/{job_id}/cancel` | Cancels a supported job: downloads, verifications and profile preparation. |
| GET | `/api/jobs/{job_id}/result` | Result of a finished job. |
| GET | `/api/logs` | Structured technical logs. Parameters: `level`, `category`, `q`, `before_id` (pagination), `limit`. |
| GET | `/api/audit` | Action audit (who changed what and whether it succeeded). |

## Engines and memory mode

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/engines` | Discovered engines (llama.cpp, Ollama, vLLM, SGLang, TensorRT-LLM, ComfyUI, Whisper, SearXNG), their status and whether they can be controlled. |
| POST | `/api/engines/{engine_id}/action` | Persistently enables or disables ComfyUI, Whisper or SearXNG. Body: `action` (`start`/`stop`), `confirm` = `"<action> <engine_id>"`. `409` if a loaded profile uses the engine. |
| GET | `/api/memory-mode` | Optional services, which ones are stopped by memory mode, and free memory. |
| POST | `/api/memory-mode/services/{service_id}` | Stops or starts an optional service (`comfyui`, `whisper`, `tts`, `open-webui`, `searxng`). Body: `action`, `confirm` = `"<action> <service_id>"`. |
| POST | `/api/memory-mode/release` | Frees memory: stops services, unloads Ollama and optionally stops profiles. Body: `services`, `release_ollama`, `stop_profiles`, `confirm` = `"liberar memoria"`. |
| POST | `/api/memory-mode/restore` | Starts again whatever memory mode stopped. Body: `confirm` = `"restaurar servicios"`. |

## System

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/storage` | Partitions, NVMe drives and SMART, and system disk usage by group (System, Models, Apps, MyDGX, User and other), with `disk_total` and `disk_free`. `home_directories` breaks down "User and other" by top-level home directory (excluding what is already counted in the other groups; those under 50 MB are grouped into "Other"). Read-only images (snap `squashfs`, `erofs`, `iso9660`) do not appear as partitions. Usage is measured in the background and cached for 10 minutes: while it is being calculated, `usage_pending` is `true` and the last measurement is returned (or empty lists the first time); `usage_updated_at` indicates when it was measured. `?refresh=true` forces a new measurement. |
| GET | `/api/system/health-center` | Evaluates GPU temperature, available memory, disk, model failures, services, and kernel Xid/OOM events. Returns status, summary, active findings and seven-day resolutions, evidence, recommendation, and journal availability. Transitions are stored in Logs. |
| GET | `/api/system/readiness` | Check that MyDGX and the system are ready, with warnings and recommendations. |
| GET | `/api/system/versions` | System, kernel, CUDA, driver and runtime versions. |
| GET | `/api/system/integrity` | Integrity of the kernel, DKMS, NVIDIA packages, llama.cpp and services. |
| GET | `/api/services` | Managed systemd services and containers. |
| POST | `/api/services/action` | `start`, `stop` or `restart` of a service in `MANAGED_SERVICES`. Requires `ENABLE_SERVICE_CONTROL=true`. Body: `name`, `action`, `confirm` = `"<action> <name>"`. |
| GET | `/api/updates` | Upgradable APT packages, with category and whether they are security updates. |
| POST | `/api/updates/apply` | Applies APT updates. Requires `ENABLE_SYSTEM_UPDATES=true` and 5 GB free. Body: `confirm` = `"ACTUALIZAR MYDGX"`. Returns `job_id`. |
| GET | `/api/updates/firmware` | Pending firmware according to fwupd (device, current and new version, notes, whether it needs a restart), pending restart, and ConnectX-7 status. Cached for 10 minutes; `?refresh=true` forces a new check. |
| POST | `/api/updates/firmware/apply` | Installs pending firmware with `fwupdmgr update`, without restarting. Requires `ENABLE_FIRMWARE_UPDATES=true` and no running jobs. Body: `confirm` = `"ACTUALIZAR FIRMWARE"`. Returns `job_id`. |
| POST | `/api/system/repair` | Repairs the NVIDIA runtime, DKMS and llama.cpp. Requires `ENABLE_SYSTEM_UPDATES=true`. Body: `confirm` = `"REPARAR MYDGX"`. Returns `job_id`. |

## Gateway (`/v1`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Gateway health. Includes `web_search`. |
| POST | `/v1/search` | Web search via local SearXNG. Body: `{"query":"terms","limit":5}`. Same authentication as the rest of the gateway. `403` if disabled, `503` if SearXNG does not respond. The query is not logged. |
| GET | `/v1/models` | Models published by the loaded profiles (alias and full name). |
| GET | `/v1/models/{model_id}` | Details of a published model. |
| POST | `/v1/chat/completions` | OpenAI chat (streaming included). |
| POST | `/v1/completions` | Classic text completion. |
| POST | `/v1/responses` | OpenAI Responses API. |
| POST | `/v1/messages` | Anthropic Messages API (for Claude Code). |
| POST | `/v1/messages/count_tokens` | Anthropic-style token counting. |
| POST | `/v1/embeddings` | Embeddings. |
| POST | `/v1/rerank` | Document reranking. |
| POST | `/v1/images/generations` | Image generation (ComfyUI). |
| POST | `/v1/audio/transcriptions` | Transcription (Whisper). |
| POST | `/v1/audio/translations` | Audio translation into English (Whisper). |
| POST | `/v1/audio/speech` | Speech synthesis (TTS). |
| POST | `/v1/videos/generations` | Synchronous video generation. |
| POST | `/v1/videos` | Creates an asynchronous video job. |
| GET | `/v1/videos/{video_id}` | Status of a video. |
| GET | `/v1/videos/{video_id}/content` | Downloads the finished video. |
| DELETE | `/v1/videos/{video_id}` | Deletes the video and its job. |

```bash
curl -s http://127.0.0.1:4000/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"ALIAS_DEL_PERFIL","messages":[{"role":"user","content":"Hello"}]}'
```

Client configuration (OpenCode, Claude Code, Open WebUI, OpenAI SDK) in
[Gateway clients](gateway-clientes.md).
