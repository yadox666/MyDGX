# MyDGX Assistant

The built-in chat works as a local operations assistant. It can answer
questions about MyDGX, check the machine's current status and propose actions.
The model is never given general access to the system, SQL, shell commands or arbitrary
URLs.

Assistant responses are rendered as CommonMark and GFM Markdown:
headings, emphasis, lists, task lists, tables, quotes, links, images, code,
blocks, strikethrough and sanitized embedded HTML. User messages remain
plain text. Links open isolated in a new tab and
images load without sending the `Referer` header.

## Configuration

```dotenv
ASSISTANT_ENABLED=true
ASSISTANT_MODEL=llama3.2:3b
ASSISTANT_FALLBACK_TO_AVAILABLE=true
ASSISTANT_MIN_FALLBACK_PARAMETERS_B=3
ASSISTANT_MAX_TOOL_ROUNDS=6
ASSISTANT_ACTION_TTL_SECONDS=300
```

- `ASSISTANT_ENABLED`: publishes and enables the assistant.
- `ASSISTANT_MODEL`: preferred Ollama model. It also accepts a
  `profile:PROFILE_ID:MODEL_ID` reference or `auto`.
- `ASSISTANT_FALLBACK_TO_AVAILABLE`: if the preferred model does not respond, it tries
  loaded chat models, the active profile and installed Ollama models.
- `ASSISTANT_MIN_FALLBACK_PARAMETERS_B`: minimum estimated size of the models
  chosen automatically as fallback. It does not limit a model requested
  explicitly.
- `ASSISTANT_MAX_TOOL_ROUNDS`: maximum model-tool cycles per turn.
- `ASSISTANT_ACTION_TTL_SECONDS`: time available to confirm an action.

The default value is `llama3.2:3b`, a lightweight model with tool
support in Ollama. It must be installed in
Ollama to be used specifically:

```bash
ollama pull llama3.2:3b
```

If it is not installed, the fallback tries another compatible model of at least
3B parameters. This avoids automatically selecting models that are too
small to orchestrate tools; a model chosen explicitly is not
filtered.

## Knowledge sources

The assistant uses four sources of information:

1. **Application map** in its system prompt: the sections of the
   interface and the key concepts (profiles, Default and Quick profiles, profile
   apps, gateway, memory mode, jobs).
2. **Local documentation:** it indexes in memory the documentation in the
   interface language (`README.es.md` and `docs/es/*.md` in Spanish, `README.md` and
   `docs/en/*.md` in English), the DGX check guide and the macOS app
   guide. The search is local and does not index `.env`, databases,
   logs or user files.
3. **API reference:** `get_api_reference` reads [api.md](api.md) in the
   same language; a test keeps both versions in sync with all the real
   routes. With it the assistant
   explains how to integrate or automate MyDGX and shows `curl` examples. It always uses
   placeholders such as `YOUR_API_KEY` and states the confirmation text that
   each endpoint requires. The assistant does not execute those calls: they are for
   you to run.
4. **Live tools:** it queries internal backend functions to
   get telemetry and current status. It does not make arbitrary requests
   constructed by the model.

The documentation cache is built on first use. Restart MyDGX after modifying
the documentation so the assistant reindexes it.

## Available tools

Queries:

- `get_assistant_capabilities`
- `search_mydgx_docs`
- `get_overview`
- `get_metrics_summary`
- `get_model_metrics`
- `get_system_readiness`
- `get_system_versions`
- `get_system_integrity`
- `get_storage`
- `get_models`
- `get_benchmarks`
- `get_profiles`
- `recommend_models`
- `search_huggingface_models`
- `inspect_huggingface_model`
- `get_profile_runtime_plan`
- `get_gateway_status`
- `get_multimodal_capabilities`
- `get_engines`
- `get_services`
- `get_jobs`
- `get_recent_events`: logs and audit, filterable by level, category and text
- `get_api_reference`: dashboard and gateway endpoints with authentication and
  conventions
- `get_config`: public configuration (only indicates whether keys exist)
- `get_memory_mode`: optional services, the memory they use and what is stopped
- `get_profile_apps`: available profile apps and their status
- `get_updates`: available APT updates

Confirmed actions:

- `start_profile`
- `stop_profile`
- `activate_profile`
- `download_huggingface_model`
- `download_ollama_model`
- `favorite_huggingface_model`
- `cancel_job`: downloads, verifications, benchmarks and profile preparation
- `control_service`
- `control_engine`: enable or disable ComfyUI, Whisper or SearXNG
- `profile_app_action`: start, stop or restart a profile app
- `release_memory`: memory mode (stop optional services, unload Ollama and
  optionally stop profiles)
- `restore_memory`: start again whatever memory mode stopped

Actions are not executed during inference. They are stored temporarily with
a random identifier, appear as a card in the chat and are only
executed when you press **Confirm**. When rejected or expired they become unusable.
Every proposal, confirmation and rejection is recorded in the audit.

All model downloads, including those started by the assistant or when
preparing a profile, are limited to the size of the machine's total physical
memory. Hugging Face is validated before the task is created; if the repository does not
publish the size of a file, the download is rejected. Ollama reports the
size when the stream starts and MyDGX interrupts it immediately if it exceeds the
limit.

To stay accurate with lightweight models, MyDGX dynamically selects the
tools relevant to each question. The full catalog remains
available, but schemas unrelated to the current task are not sent to the model.

`control_service` respects `ENABLE_SERVICE_CONTROL` and `MANAGED_SERVICES`; the
assistant does not extend those permissions.

## API

All these endpoints, except the general health check, use the same
`X-MyDGX-Key` protection as the rest of the dashboard when `MYDGX_API_KEY` is configured.

### Check availability

`GET /api/assistant/status`

Reports whether the assistant is enabled, whether the preferred model is installed,
which fallbacks are available and how many documentation chunks were indexed.
It does not try to load the model or reveal secrets. The interface uses this endpoint
to disable the composer and show a specific fix when there is
no model at all.

### Send a turn

`POST /api/assistant/chat`

```json
{
  "message": "Summarize GPU usage over the last hour",
  "history": [
    {"role": "user", "content": "Is the system ready?"},
    {"role": "assistant", "content": "Yes, with one optional warning."}
  ],
  "model": null
}
```

`model` is optional. If omitted, `ASSISTANT_MODEL` and its fallback are used.

Response:

```json
{
  "message": {"role": "assistant", "content": "Over the last hour..."},
  "model": "llama3.2:3b",
  "tools_used": [{"name": "get_metrics_summary", "status": "ok"}],
  "pending_actions": []
}
```

A proposed action appears in `pending_actions`:

```json
{
  "id": "IDENTIFICADOR_TEMPORAL",
  "name": "start_profile",
  "label": "Start profile PROFILE_ID",
  "arguments": {"profile_id": "PROFILE_ID"},
  "expires_at": "2026-11-12T08:20:00+00:00"
}
```

### Confirm an action

`POST /api/assistant/actions/confirm`

```json
{"action_id": "IDENTIFICADOR_TEMPORAL"}
```

### Reject an action

`POST /api/assistant/actions/reject`

```json
{"action_id": "IDENTIFICADOR_TEMPORAL"}
```

## Examples

- “Is the machine ready to load a model?”
- “Summarize CPU, memory and GPU for the last six hours.”
- “Which models and profiles do I have installed?”
- “Recommend three coding models that fit on this machine.”
- “Compare the HF community score, memory and estimated performance.”
- “Compare the measured benchmarks of the coding models.”
- “Inspect the files of `owner/model` before downloading it.”
- “Search the documentation for how the gateway works.”
- “Start the programming profile.”
- “The 120B model doesn't fit: free up memory.” It proposes `release_memory` with the
  services that use the most; afterwards you can ask “restore the services”.
- “How do I start a profile from a script with curl?”
- “Which endpoint do I use to transcribe audio with the gateway?”
- “Why did the last startup fail?” It checks error logs and jobs.
- “Restart the RAG AI app.”
- “Disable ComfyUI, I don't use it.”
- “Restart Ollama.” The action will only be available if service control
  is enabled and `ollama` is on the allowed list.

## Security

- No secret is added to the prompt or to the documentation search.
- Public configuration responses only indicate whether a key exists.
- Tool parameters have closed schemas and limits.
- Actions use the existing validations and allowlists.
- Persisted events go through sensitive-data redaction.
- The assistant cannot delete models, profiles or data.
- For remote access, the recommendation of authenticated HTTPS or an SSH
  tunnel and a strong `MYDGX_API_KEY` still applies.
