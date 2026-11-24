# Gateway de modelos y clientes

MyDGX publica el perfil activo en `http://127.0.0.1:4000`. El gateway mantiene
el catálogo, los alias, las capacidades y la seguridad de MyDGX. LiteLLM se
ejecuta únicamente como adaptador interno en `127.0.0.1:4001` para traducir
Anthropic Messages y OpenAI Responses; no se expone directamente.
Los motores ComfyUI administrados aparecen en el catálogo aunque no haya un
perfil conversacional cargado.

## Endpoints

- OpenAI Chat Completions: `POST /v1/chat/completions`
- OpenAI Responses: `POST /v1/responses`
- Compactación de OpenAI Responses: `POST /v1/responses/compact`
- Recuento de entrada de OpenAI Responses: `POST /v1/responses/input_tokens`
- Anthropic Messages: `POST /v1/messages`
- Conteo Anthropic: `POST /v1/messages/count_tokens`
- Catálogo: `GET /v1/models`, con `context_length` y `capabilities`
  (`tools`, `reasoning`, `vision`) por alias. `tools` es `false` en modelos
  llama.cpp sin plantilla Jinja.
- Completions, embeddings, imagen (generación y edición), audio, vídeo y reranking: rutas descritas en
  el README, condicionadas por la tarea del modelo.
- ComfyUI administrado: `POST /v1/images/generations`, `POST /v1/videos`,
  `GET /v1/videos/{id}` y `GET /v1/videos/{id}/content`.

Los endpoints Anthropic y Responses pasan por LiteLLM. El recuento de tokens de
entrada usa el tokenizador seleccionado por LiteLLM y no ejecuta inferencia; no
admite identificadores `conversation` almacenados. La disponibilidad de la
compactación usa el endpoint nativo del proveedor cuando existe; en caso
contrario, MyDGX genera un mensaje resumen reutilizable en texto marcado como
`plaintext-summary-v1`. Chat Completions y las capacidades multimedia conservan
el proxy nativo. El modelo solicitado siempre debe ser un alias saludable del
perfil activo.

Los modelos que saben pensar envían su razonamiento en todos los formatos:
`reasoning_content` en Chat Completions, elementos `reasoning` en Responses y
bloques `thinking` en Anthropic Messages. Los clientes lo piden con su parámetro
habitual (`reasoning_effort`, `reasoning.effort` o `thinking`); ver
[Razonamiento](api.md#razonamiento). En Open WebUI, pon **Reasoning Effort** en
los parámetros avanzados del modelo (por ejemplo `high`) y el razonamiento
aparece en un bloque plegable mientras el modelo trabaja.

## Open WebUI

La instalación administrada configura:

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

Open WebUI se conecta desde localhost y no necesita copiar la clave del gateway.
El deployment instala SearXNG enlazado exclusivamente a `127.0.0.1:8888` y
habilita cinco resultados por búsqueda. Usa un contenedor aislado cuando Docker
está operativo; en rentals que no permiten el daemon instala el mismo servicio
en un entorno Python aislado. No requiere claves de Brave, Tavily ni otros
proveedores.

Para que un agente busque, deben estar activos los tres niveles de Open WebUI:
búsqueda global en **Admin → Web Search**, búsqueda para el modelo y el botón de
búsqueda del chat. Los modelos con tool calling nativo fiable deciden mejor
cuándo consultar; con modelos pequeños puede ser necesario activar la búsqueda
manualmente. Una configuración guardada previamente en Admin prevalece sobre las
variables del entorno.

La instalación también carga un workflow API de FLUX.1 Schnell FP8 en Open
WebUI. El botón de imagen del chat envía el prompt directamente al ComfyUI local.
Para vídeo, Open WebUI recibe la conexión OpenAPI **MyDGX Laboratorio IA**:
actívala desde el selector de herramientas y el agente podrá iniciar un trabajo
Wan 2.1, consultar su progreso y recuperar su resultado. La conexión usa una
credencial independiente generada durante el deployment; no reutiliza ni expone
la clave general de MyDGX.

Si cambia el puerto desde Preferencias, MyDGX actualiza `open-webui.env`; reinicia
MyDGX y Open WebUI para aplicar el cambio.

## Claude Code

Claude Code usa Anthropic Messages, no Chat Completions. MyDGX puede instalarlo,
descubrir los aliases cargados y configurarlo en `~/claude-code`:

```bash
./start.sh install-claude-code
cd ~/claude-code
/ruta/a/MyDGX-Dashboard/start.sh claude
/ruta/a/MyDGX-Dashboard/start.sh claude --active
```

Configuración manual equivalente:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:4000
export ANTHROPIC_AUTH_TOKEN=YOUR_GATEWAY_API_KEY
export ANTHROPIC_DEFAULT_OPUS_MODEL=YOUR_PROFILE_MODEL_ALIAS
export ANTHROPIC_DEFAULT_SONNET_MODEL=YOUR_PROFILE_MODEL_ALIAS
export ANTHROPIC_DEFAULT_HAIKU_MODEL=YOUR_PROFILE_MODEL_ALIAS
claude
```

Usa un modelo con tool calling fiable. La clave puede ser un valor no vacío
cuando el acceso es exclusivamente localhost; para red debe coincidir con
`GATEWAY_API_KEY`.

Razonamiento: Claude Code envía `thinking: {"type": "adaptive"}` con
`output_config.effort`; el gateway lo convierte en un presupuesto explícito y el
modelo local piensa de verdad. La configuración generada sigue el valor por
defecto del perfil (`alwaysThinkingEnabled`); Tab lo activa o desactiva y
`/effort` (o `CLAUDE_CODE_EFFORT_LEVEL`) elige el nivel. Si el modelo no sabe
razonar, se añade `CLAUDE_CODE_DISABLE_THINKING=1`. Si hay cargado un modelo con
herramientas de, como mucho, el 60 % de los parámetros activos del principal, el
nivel haiku (títulos, resúmenes, comprobaciones) lo usa; `MYDGX_SMALL_MODEL`
fija uno concreto.

Con la búsqueda web del gateway activada, Claude Code recibe el MCP `searxng`
en los modos plan y activo. La herramienta llama a `POST /v1/search` y `WebSearch`
y `WebFetch` nativos permanecen denegados. La clave se referencia como
`${MYDGX_GATEWAY_API_KEY}` y no se copia a `mydgx-mcp.json`.

## OpenCode

MyDGX puede instalarlo, descubrir los aliases cargados y generar su configuración
en `~/opencode`:

```bash
./start.sh install-opencode
cd ~/opencode
/ruta/a/MyDGX-Dashboard/start.sh opencode
/ruta/a/MyDGX-Dashboard/start.sh opencode --active
```

También puedes configurar manualmente el runtime OpenAI-compatible para Chat
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

No uses el proveedor `openai` contra un backend que solo admita Chat
Completions; ese proveedor puede seleccionar Responses. MyDGX también expone
Responses mediante LiteLLM cuando el cliente lo requiera.

Razonamiento (OpenCode 1.x): los modelos que saben pensar reciben las variantes
`none`, `low`, `medium` y `high`, que envían `reasoning_effort`. Elígelas con el
atajo de variantes o con `opencode run --variant high`; sin variante manda el
valor por defecto del perfil. `small_model` (títulos y resúmenes) usa un modelo
más pequeño si hay uno cargado o, si no, la entrada `<alias>-fast`: el mismo
modelo con `reasoning_effort: none`. `MYDGX_SMALL_MODEL` fija uno concreto.

Herramientas: cuando la petición declara `tools`, el gateway entrega cada
llamada completa justo antes del chunk final, con los argumentos JSON reparados
si el modelo los dejó mal formados (comas finales, llaves sin cerrar, bloques de
código). También convierte en llamadas reales los bloques
`<tool_call>{"name": …, "arguments": …}</tool_call>` que el modelo deje en el
texto, solo si la herramienta existe en la petición.

Con la búsqueda web del gateway activada (el valor por defecto, en
Configuración → Gateway), OpenCode recibe el MCP `searxng` en los modos plan y
activo. La herramienta llama a `POST /v1/search` del mismo gateway y este
consulta SearXNG en `127.0.0.1:8888`. `webfetch` y el `websearch` nativo
permanecen desactivados. La clave sigue referenciada como
`{env:MYDGX_GATEWAY_API_KEY}` y no se copia al JSON.

Si el gateway no es localhost, exporta `MYDGX_GATEWAY_URL` y
`MYDGX_GATEWAY_API_KEY` antes del comando. La clave se referencia desde el
entorno y no se copia a `opencode.json`.

## Codex CLI

Codex usa exclusivamente Responses:

```toml
model_provider = "mydgx"
model = "YOUR_PROFILE_MODEL_ALIAS"

[model_providers.mydgx]
name = "MyDGX"
base_url = "http://127.0.0.1:4000/v1"
env_key = "MYDGX_GATEWAY_KEY"
wire_api = "responses"
```

Define `MYDGX_GATEWAY_KEY` fuera del archivo. Codex exige un modelo con tool
calling sólido; que una respuesta de texto funcione no valida las herramientas.

## Cline y Continue

Selecciona proveedor OpenAI-compatible, base
`http://127.0.0.1:4000/v1`, el alias del perfil y Chat Completions. Activa
tools únicamente si el modelo y su plantilla los soportan.

## Acceso desde macOS

MyDGXTray crea tres forwards SSH:

- panel: `127.0.0.1:18088` → DGX `127.0.0.1:8088`;
- Open WebUI: `127.0.0.1:13000` → DGX `127.0.0.1:3000`;
- gateway: `127.0.0.1:14000` → DGX `127.0.0.1:4000`.

En aplicaciones del Mac usa `http://127.0.0.1:14000/v1` para OpenAI y
`http://127.0.0.1:14000` para Claude Code. Los puertos son configurables en las
preferencias del Tray.

## Red y CORS

Mantén `GATEWAY_HOST=127.0.0.1` y usa túnel SSH. Si debe escuchar en red:

1. configura `GATEWAY_API_KEY`;
2. usa TLS mediante un reverse proxy;
3. limita firewall y clientes;
4. añade a `GATEWAY_CORS_ORIGINS` únicamente orígenes web explícitos.

No uses `*` para CORS con credenciales. Las claves no se guardan en perfiles,
SQLite, código ni archivos de configuración compartidos.

## Diagnóstico

```bash
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:4000/v1/models
```

Si Anthropic o Responses devuelve `adapter_unavailable`, revisa
`logs/litellm.log`, la instalación de LiteLLM y que exista un perfil activo con
un modelo chat/visión saludable. Los despliegues RAG AI y Voice Agent requieren su adaptador
específico; ComfyUI administrado ya se traduce a imagen y vídeo compatibles.
