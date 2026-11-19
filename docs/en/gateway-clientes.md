# Model gateway and clients

MyDGX publishes the active profile at `http://127.0.0.1:4000`. The gateway maintains
MyDGX's catalog, aliases, capabilities and security. LiteLLM runs
only as an internal adapter on `127.0.0.1:4001` to translate
Anthropic Messages and OpenAI Responses; it is not exposed directly.
Managed ComfyUI engines appear in the catalog even when no
conversational profile is loaded.

## Endpoints

- OpenAI Chat Completions: `POST /v1/chat/completions`
- OpenAI Responses: `POST /v1/responses`
- Anthropic Messages: `POST /v1/messages`
- Anthropic token count: `POST /v1/messages/count_tokens`
- Catalog: `GET /v1/models`, with `context_length` and `capabilities`
  (`tools`, `reasoning`, `vision`) per alias. `tools` is `false` for
  llama.cpp models without a Jinja template.
- Completions, embeddings, image, audio, video and reranking: routes described in
  the README, depending on the model's task.
- Managed ComfyUI: `POST /v1/images/generations`, `POST /v1/videos`,
  `GET /v1/videos/{id}` and `GET /v1/videos/{id}/content`.

The Anthropic and Responses endpoints go through LiteLLM. Chat Completions and the
multimedia capabilities keep the native proxy. The requested model must always
be a healthy alias of the active profile.

## Open WebUI

The managed installation configures:

```env
ENABLE_OPENAI_API=True
OPENAI_API_BASE_URL=http://127.0.0.1:4000/v1
ENABLE_WEB_SEARCH=True
WEB_SEARCH_ENGINE=searxng
SEARXNG_QUERY_URL=http://127.0.0.1:8888/search
ENABLE_IMAGE_GENERATION=True
IMAGE_GENERATION_ENGINE=comfyui
COMFYUI_BASE_URL=http://127.0.0.1:8188
```

Open WebUI connects from localhost and does not need a copy of the gateway key.
The deployment installs SearXNG bound exclusively to `127.0.0.1:8888` and
enables five results per search. It uses an isolated container when Docker
is working; on rentals that do not allow the daemon, it installs the same service
in an isolated Python environment. No Brave, Tavily or other provider keys
are required.

For an agent to search, all three Open WebUI levels must be enabled:
global search in **Admin → Web Search**, search for the model, and the chat's
search button. Models with reliable native tool calling are better at deciding
when to search; with small models you may need to enable search
manually. A configuration previously saved in Admin takes precedence over the
environment variables.

The installation also loads a FLUX.1 Schnell FP8 API workflow into Open
WebUI. The chat's image button sends the prompt directly to the local ComfyUI.
For video, Open WebUI receives the **MyDGX Laboratorio IA** OpenAPI connection:
enable it from the tool selector and the agent will be able to start a
Wan 2.1 job, check its progress and retrieve its result. The connection uses an
independent credential generated during deployment; it neither reuses nor exposes
the general MyDGX key.

If you change the port from Settings, MyDGX updates `open-webui.env`; restart
MyDGX and Open WebUI to apply the change.

## Claude Code

Claude Code uses Anthropic Messages, not Chat Completions. MyDGX can install it,
discover the loaded aliases and configure it in `~/claude-code`:

```bash
./start.sh install-claude-code
cd ~/claude-code
/ruta/a/MyDGX-Dashboard/start.sh claude
/ruta/a/MyDGX-Dashboard/start.sh claude --active
```

Equivalent manual configuration:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:4000
export ANTHROPIC_AUTH_TOKEN=YOUR_GATEWAY_API_KEY
export ANTHROPIC_DEFAULT_OPUS_MODEL=YOUR_PROFILE_MODEL_ALIAS
export ANTHROPIC_DEFAULT_SONNET_MODEL=YOUR_PROFILE_MODEL_ALIAS
export ANTHROPIC_DEFAULT_HAIKU_MODEL=YOUR_PROFILE_MODEL_ALIAS
claude
```

Use a model with reliable tool calling. The key can be any non-empty value
when access is localhost only; over the network it must match
`GATEWAY_API_KEY`.

With the gateway's web search enabled, Claude Code receives the `searxng` MCP
in plan and active modes. The tool calls `POST /v1/search`, and the native `WebSearch`
and `WebFetch` remain denied. The key is referenced as
`${MYDGX_GATEWAY_API_KEY}` and is not copied into `mydgx-mcp.json`.

## OpenCode

MyDGX can install it, discover the loaded aliases and generate its configuration
in `~/opencode`:

```bash
./start.sh install-opencode
cd ~/opencode
/ruta/a/MyDGX-Dashboard/start.sh opencode
/ruta/a/MyDGX-Dashboard/start.sh opencode --active
```

You can also manually configure the OpenAI-compatible runtime for Chat
Completions:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "mydgx": {
      "name": "MyDGX",
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "http://127.0.0.1:4000/v1"
      },
      "models": {
        "YOUR_PROFILE_MODEL_ALIAS": {}
      }
    }
  }
}
```

Do not use the `openai` provider against a backend that only supports Chat
Completions; that provider may select Responses. MyDGX also exposes
Responses through LiteLLM when the client requires it.

With the gateway's web search enabled (the default, in
Settings → Gateway), OpenCode receives the `searxng` MCP in plan and
active modes. The tool calls `POST /v1/search` on the same gateway, which
queries SearXNG at `127.0.0.1:8888`. `webfetch` and the native `websearch`
remain disabled. The key is still referenced as
`{env:MYDGX_GATEWAY_API_KEY}` and is not copied into the JSON.

If the gateway is not on localhost, export `MYDGX_GATEWAY_URL` and
`MYDGX_GATEWAY_API_KEY` before the command. The key is referenced from the
environment and is not copied into `opencode.json`.

## Codex CLI

Codex uses Responses exclusively:

```toml
model_provider = "mydgx"
model = "YOUR_PROFILE_MODEL_ALIAS"

[model_providers.mydgx]
name = "MyDGX"
base_url = "http://127.0.0.1:4000/v1"
env_key = "MYDGX_GATEWAY_KEY"
wire_api = "responses"
```

Define `MYDGX_GATEWAY_KEY` outside the file. Codex requires a model with solid tool
calling; a working text response does not validate the tools.

## Cline and Continue

Select the OpenAI-compatible provider, base
`http://127.0.0.1:4000/v1`, the profile alias and Chat Completions. Enable
tools only if the model and its template support them.

## Access from macOS

MyDGXTray creates three SSH forwards:

- dashboard: `127.0.0.1:18088` → DGX `127.0.0.1:8088`;
- Open WebUI: `127.0.0.1:13000` → DGX `127.0.0.1:3000`;
- gateway: `127.0.0.1:14000` → DGX `127.0.0.1:4000`.

In Mac applications use `http://127.0.0.1:14000/v1` for OpenAI and
`http://127.0.0.1:14000` for Claude Code. The ports are configurable in the
Tray's Settings.

## Network and CORS

Keep `GATEWAY_HOST=127.0.0.1` and use an SSH tunnel. If it must listen on the network:

1. configure `GATEWAY_API_KEY`;
2. use TLS through a reverse proxy;
3. restrict the firewall and clients;
4. add only explicit web origins to `GATEWAY_CORS_ORIGINS`.

Do not use `*` for CORS with credentials. Keys are not stored in profiles,
SQLite, code or shared configuration files.

## Diagnostics

```bash
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:4000/v1/models
```

If Anthropic or Responses returns `adapter_unavailable`, check
`logs/litellm.log`, the LiteLLM installation, and that there is an active profile with
a healthy chat/vision model. RAGKit and Voice Agent require their own specific
adapter; managed ComfyUI is already translated to compatible image and video.
