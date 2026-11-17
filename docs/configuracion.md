# Configuración

MyDGX se configura con variables de entorno leídas del archivo `.env` en la raíz
del proyecto. Copia `.env.example` a `.env` y edita solo el archivo local. En el
DGX, el despliegue crea `.env` y nunca lo sobrescribe ni lo copia desde el Mac.

Los secretos (`*_API_KEY`, `*_TOKEN`) solo se leen en el servidor. Nunca se
devuelven al navegador, no se escriben en logs ni en SQLite, y no deben
aparecer en el código ni en Git. En los ejemplos se usan marcadores como
`YOUR_API_KEY`.

Un test (`test_every_setting_is_documented`) falla si se añade una variable sin
documentarla aquí.

## Servidor y acceso

| Variable | Por defecto | Descripción |
|---|---|---|
| `APP_NAME` | `MyDGX` | Nombre mostrado. |
| `HOST` | `127.0.0.1` | Dirección del dashboard. Con una dirección de red configura contraseña o clave API. |
| `PORT` | `8088` | Puerto del dashboard. |
| `MYDGX_API_KEY` | vacío | **Secreto.** Clave para `/api/*`, cabecera `X-MyDGX-Key`. |
| `MYDGX_DASHBOARD_PASSWORD` | vacío | **Secreto.** Si se define, activa el login web y una cookie de sesión `HttpOnly`. |
| `MYDGX_SESSION_TTL_MINUTES` | `60` | Caducidad absoluta de la sesión web. Se limita entre 1 minuto y 24 horas. |
| `DUCKDNS_DOMAIN` | vacío | Subdominio DuckDNS o nombre completo terminado en `.duckdns.org`. Admite varios separados por comas. |
| `DUCKDNS_TOKEN` | vacío | **Secreto.** Token de DuckDNS; se usa únicamente en el DGX. |
| `TRUSTED_HOSTS` | vacío | Nombres extra aceptados en la cabecera `Host` (por ejemplo `spark.lan`), separados por comas. Loopback y la dirección de escucha ya se aceptan. |
| `DATABASE_PATH` | `./data/mydgx.db` | Base de datos SQLite. |
| `DEVICE_VARIANT_OVERRIDE` | vacío | Fuerza la identidad del equipo: `nvidia`, `asus`, `hp`, `lenovo`, `dell` o `generic`. |

Para instalar el actualizador horario de DuckDNS, configura ambos valores
directamente en el `.env` del DGX y ejecuta desde una terminal:

```bash
./start.sh deploy --duckdns --repair --interactive
```

El token no se copia desde el Mac ni aparece en los logs. El temporizador se
ejecuta al arrancar y después aproximadamente cada hora.

## Telemetría y logs

| Variable | Por defecto | Descripción |
|---|---|---|
| `METRICS_INTERVAL_SECONDS` | `5` | Intervalo de muestreo. |
| `METRICS_RETENTION_HOURS` | `168` | Horas de histórico de métricas. |
| `LOG_RETENTION_DAYS` | `30` | Días de logs técnicos. |

## Servicios locales

| Variable | Por defecto | Descripción |
|---|---|---|
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama. |
| `OPENWEBUI_URL` | `http://127.0.0.1:3000` | Open WebUI (uso interno). |
| `OPENWEBUI_PUBLIC_URL` | vacío | URL de Open WebUI que abre el navegador, por ejemplo a través del túnel. |
| `OPENWEBUI_TOOL_API_KEY` | vacío | **Secreto.** Clave con la que Open WebUI llama a `/api/openwebui/tools/*`. La genera el despliegue. |
| `DGX_DASHBOARD_URL` | `http://127.0.0.1:11000` | Dashboard oficial de NVIDIA. |
| `VLLM_URL` | `http://127.0.0.1:8000` | vLLM externo. |
| `SGLANG_URL` | `http://127.0.0.1:30000` | SGLang externo. |
| `TRTLLM_URL` | `http://127.0.0.1:8001` | TensorRT-LLM externo. |
| `LMSTUDIO_URL` | `http://127.0.0.1:1234` | LM Studio (servidor compatible con OpenAI). |
| `COMFYUI_URL` | `http://127.0.0.1:8188` | ComfyUI. |
| `COMFYUI_PUBLIC_URL` | vacío | URL de ComfyUI para el navegador. |
| `WHISPER_URL` | `http://127.0.0.1:9000` | Servicio de transcripción. |
| `TTS_URL` | `http://127.0.0.1:9010` | Servicio de síntesis de voz. |
| `RIVA_URL` | `http://127.0.0.1:8002` | NVIDIA Riva. |
| `MULTIMODAL_MAX_UPLOAD_MB` | `64` | Tamaño máximo de archivo en el Laboratorio IA. |

## Hugging Face

| Variable | Por defecto | Descripción |
|---|---|---|
| `HF_HOME` | `~/.cache/huggingface` | Caché de modelos. |
| `HF_TOKEN` | vacío | **Secreto.** Para repositorios privados o con acceso restringido y mayor cuota. |
| `HF_DOWNLOAD_WORKERS` | `4` | Descargas paralelas de archivos. |

## llama.cpp

| Variable | Por defecto | Descripción |
|---|---|---|
| `LLAMA_CPP_SERVER_PATH` | `llama-server` | Ejecutable principal. |
| `LLAMA_CPP_B10679_PATH` | vacío | Build b10679 anterior, usada por los modelos que la requieren. Al actualizar a v1.0.0 se conserva en `/usr/local/lib/mydgx/llama-b10679/llama-server`. |
| `LLAMA_CPP_B11429_PATH` | vacío | Build fijada b11429 (ARTIFEX), usada por los modelos que la requieren. |

## Perfiles y apps

| Variable | Por defecto | Descripción |
|---|---|---|
| `ENABLE_PROFILE_AUTOSTART` | `true` | Recarga el perfil predeterminado al arrancar MyDGX. |
| `DEFAULT_PROFILE_ID` | vacío | Perfil predeterminado inicial (normalmente se elige con *Activar*). |
| `PROFILE_BIND_HOST` | `127.0.0.1` | Dirección en la que escuchan los runtimes de perfil. |
| `PROFILE_START_TIMEOUT_SECONDS` | `180` | Espera máxima a que un modelo responda al arrancar. |
| `PROFILE_RESTORE_RETRY_SECONDS` | `300` | Reintento de restauración del perfil predeterminado tras un fallo. |
| `PROFILE_APPS_ROOT` | home del usuario | Directorio cuyos subdirectorios con `start.sh` pueden ser apps de perfil. |
| `PROFILE_APPS` | vacío | Lista blanca opcional de apps (`ragkit,otra`). Vacío: todas las válidas. |

## Gateway

| Variable | Por defecto | Descripción |
|---|---|---|
| `GATEWAY_ENABLED` | `true` | Arranca el gateway con MyDGX. |
| `GATEWAY_HOST` | `127.0.0.1` | Dirección del gateway. Recomendado: solo localhost y túnel SSH. |
| `GATEWAY_PORT` | `4000` | Puerto del gateway. |
| `GATEWAY_API_KEY` | vacío | **Secreto.** Obligatoria si el gateway escucha en la red. |
| `GATEWAY_REQUEST_TIMEOUT_SECONDS` | `600` | Timeout de inferencia. |
| `GATEWAY_MAX_REQUEST_MB` | `32` | Tamaño máximo de petición. |
| `GATEWAY_LITELLM_PORT` | `4001` | Puerto interno del adaptador LiteLLM (Responses y Anthropic). |
| `GATEWAY_CORS_ORIGINS` | vacío | Orígenes de navegador permitidos, separados por comas. |

Host, puerto, timeout y tamaño también se cambian desde *Configuración*. Lo
guardado en la interfaz tiene prioridad sobre `.env`.

## Dimensionado del DGX Spark

| Variable | Por defecto | Descripción |
|---|---|---|
| `SPARK_CLUSTER_SIZE` | `1` | Número de Spark enlazados (1 a 4), para calcular memoria y ancho de banda. |
| `SPARK_MEMORY_BANDWIDTH_GBPS` | `273` | Ancho de banda por Spark, usado para estimar tokens por segundo. |

## Operaciones privilegiadas

| Variable | Por defecto | Descripción |
|---|---|---|
| `ENABLE_SYSTEM_UPDATES` | `false` | Permite aplicar actualizaciones APT y la reparación del sistema. |
| `ENABLE_SERVICE_CONTROL` | `false` | Permite arrancar, parar y reiniciar servicios de la lista. |
| `MANAGED_SERVICES` | `mydgx,mydgx-gateway,mydgx-searxng,mydgx-comfyui,mydgx-whisper,ollama,docker,open-webui` | Lista cerrada de servicios controlables. |

## Asistente

| Variable | Por defecto | Descripción |
|---|---|---|
| `ASSISTANT_ENABLED` | `true` | Activa MyDGX Copilot. |
| `ASSISTANT_MODEL` | `llama3.2:3b` | Modelo preferido (Ollama o alias de un perfil cargado). |
| `ASSISTANT_FALLBACK_TO_AVAILABLE` | `true` | Usa otro modelo local con herramientas si el preferido no está. |
| `ASSISTANT_MIN_FALLBACK_PARAMETERS_B` | `3.0` | Tamaño mínimo, en miles de millones de parámetros, del modelo de reserva. |
| `ASSISTANT_MAX_TOOL_ROUNDS` | `6` | Rondas máximas de herramientas por respuesta. |
| `ASSISTANT_ACTION_TTL_SECONDS` | `300` | Caducidad de las acciones propuestas sin confirmar. |

## Benchmarks

| Variable | Por defecto | Descripción |
|---|---|---|
| `BENCHMARK_ENABLED` | `true` | Activa los benchmarks. |
| `BENCHMARK_AUTO_NEW_MODELS` | `true` | Mide automáticamente los modelos nuevos cuando el equipo está libre. |
| `BENCHMARK_REPETITIONS` | `3` | Repeticiones por prueba. |
| `BENCHMARK_TELEMETRY_INTERVAL_SECONDS` | `1.0` | Muestreo de telemetría durante la medición. |
| `BENCHMARK_QUIET_SECONDS` | `120` | Tiempo sin actividad requerido antes de medir automáticamente. |
| `BENCHMARK_QUEUE_POLL_SECONDS` | `20` | Frecuencia de revisión de la cola. |
| `BENCHMARK_QUEUE_MAX_AGE_HOURS` | `24` | Antigüedad máxima de una entrada en cola. |
| `BENCHMARK_RELEASE_IDLE_OLLAMA` | `true` | Descarga modelos de Ollama inactivos antes de medir. |

## Variables del despliegue

Las lee `start.sh deploy` en el Mac, no el backend:

| Variable | Descripción |
|---|---|
| `OPENWEBUI_VERSION` | Versión de Open WebUI (fijada por defecto). |
| `SEARXNG_IMAGE` | Imagen de SearXNG, fijada por digest. |
| `COMFYUI_REF` | Commit de ComfyUI. |
| `MYDGX_KNOWN_HOSTS` | Archivo de claves SSH de confianza (por defecto `~/.MyDGX/known_hosts`). |
| `MYDGX_SSH_HOST_FINGERPRINT` | Huella esperada del DGX (`SHA256:...`) para despliegues no interactivos. |
| `MYDGX_SSH_ACCEPT_NEW` | `1` acepta una clave nueva sin confirmar. Solo para equipos efímeros. |
| `MYDGX_HASHCAT_SHA256` | SHA-256 esperado si se cambia la versión de hashcat. |
| `MYDGX_CLAUDE_INSTALLER_SHA256` | SHA-256 del instalador nativo de Claude Code. |

Ver [Seguridad](seguridad.md) para el detalle de verificación.
