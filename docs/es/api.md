# Referencia de la API

MyDGX expone dos APIs HTTP:

| Servicio | Dirección por defecto | Para qué |
|---|---|---|
| **Dashboard** | `http://127.0.0.1:8088/api/...` | Administrar el equipo: telemetría, modelos, perfiles, motores, benchmarks, sistema, logs y asistente. |
| **Gateway** | `http://127.0.0.1:4000/v1/...` | Consumir los modelos de los perfiles cargados con protocolo OpenAI (y Anthropic `/v1/messages`). |

Esta página lista **todos** los endpoints. Un test (`test_every_route_is_documented`)
falla si se añade una ruta sin documentarla aquí.

## Autenticación y protecciones

**Dashboard.**

- Si `MYDGX_API_KEY` está definida, cada petición a `/api/*` (salvo
  `GET /api/health`) debe llevar la cabecera `X-MyDGX-Key: YOUR_API_KEY`.
- Sin clave y escuchando solo en loopback (`HOST=127.0.0.1`), la API acepta
  peticiones sin cabecera. Si `HOST` no es loopback y no hay clave, responde
  `503 Configura MYDGX_API_KEY para acceso de red`.
- Las herramientas de Open WebUI (`/api/openwebui/tools/*`) usan su propia clave
  `OPENWEBUI_TOOL_API_KEY`, que gestiona el despliegue.

**Gateway.** Los clientes en loopback (por ejemplo a través de un túnel SSH) no
necesitan clave. Los demás deben enviar `Authorization: Bearer YOUR_GATEWAY_API_KEY`
o `x-api-key: YOUR_GATEWAY_API_KEY`. El gateway no arranca en una dirección de red
sin `GATEWAY_API_KEY`.

**Ambos servicios rechazan peticiones de navegador de otras webs:**

- `Host` debe ser loopback, la IP en la que escucha el servicio (o las del propio
  equipo si escucha en todas) o un nombre de `TRUSTED_HOSTS`. Protege contra DNS
  rebinding. Respuesta: `403 Host no permitido`.
- En `POST`, `PUT`, `PATCH` y `DELETE` se rechaza un `Origin` distinto del propio
  (o de los orígenes CORS permitidos) y `Sec-Fetch-Site: cross-site`.
  `curl`, scripts y servidores no envían `Origin`, así que no se ven afectados.

**Confirmaciones.** Las operaciones destructivas o de impacto exigen un texto de
confirmación exacto en el cuerpo o en `?confirm=`; se indica en cada endpoint.
Así un clic o una petición accidental no borra ni detiene nada.

**Trabajos.** Las operaciones largas (descargas, verificaciones, arranque de
perfiles, benchmarks, actualizaciones) devuelven `{"job_id": "..."}` y siguen en
segundo plano. Su progreso se consulta en `GET /api/jobs/{job_id}`.

**Errores.** Formato FastAPI: `{"detail": "mensaje en español"}` con el código
HTTP adecuado (`400` validación, `403` desactivado o prohibido, `404` no existe,
`409` conflicto de estado, `5xx` fallo del runtime).

```bash
# Ejemplo: estado general con clave (sustituye el marcador; nunca la pegues en scripts versionados)
curl -s -H "X-MyDGX-Key: $MYDGX_API_KEY" http://127.0.0.1:8088/api/overview
```

## Estado y configuración

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/api/health` | Salud del dashboard (`status`, `name`, `version`). Sin autenticación. |
| GET | `/api/auth/status` | Si el dashboard pide contraseña (`required`), si la sesión actual es válida (`authenticated`), los segundos que le quedan y la duración de sesión. Sin autenticación; no se cachea. |
| POST | `/api/auth/login` | Recibe `{"password": "…"}` y, si coincide, abre una sesión con una cookie `httponly` y `samesite=strict`. Devuelve `401` si la contraseña es incorrecta y `429` con `Retry-After` tras demasiados intentos. |
| POST | `/api/auth/refresh` | Renueva una cookie de sesión válida otros `MYDGX_SESSION_TTL_MINUTES`, sin pasar nunca de `MYDGX_SESSION_MAX_HOURS` desde que entraste. El dashboard solo la llama tras actividad del usuario. Devuelve `401` si la sesión ha caducado. |
| POST | `/api/auth/logout` | Cierra la sesión borrando la cookie. |
| GET | `/api/config` | Configuración pública: URLs de servicios, si hay token HF o claves configuradas (solo booleanos), funciones activadas. |
| GET | `/api/overview` | Telemetría actual, identidad del equipo, servicios, suite de benchmarks en curso, mapa de memoria, perfiles cargados (`running_profiles`) y apps web activas (`web_apps`: `name`, `alias`, `port`, `url`, `state`, `reachable`). |
| GET | `/api/metrics/history` | Histórico del host. Parámetros: `minutes`, o `start` y `end` ISO. |
| GET | `/api/metrics/models` | Telemetría por modelo. Parámetros: `minutes`, `profile_id`. |
| GET | `/api/settings/env` | Parámetros del `.env` editables desde Configuración (valor actual, valor por defecto, límites y si requieren reinicio) y `hf_token_configured`. El token nunca se devuelve. |
| PUT | `/api/settings/env` | Cambia esos parámetros en `.env` y en memoria. Cuerpo: `values` (clave → valor), `hf_token` (se verifica con Hugging Face antes de guardarlo) o `clear_hf_token`. Las claves de autenticación, red y operaciones privilegiadas no se aceptan. |
| POST | `/api/settings/hf-token/verify` | Comprueba el `HF_TOKEN` configurado con Hugging Face. Devuelve `configured`, `valid` y el nombre de la cuenta. |
| GET | `/api/notifications` | Avisos de error (descarga fallida, error cargando modelo o arrancando perfil, benchmark fallido, modelo defectuoso o incompleto): fecha, título, texto, log saneado y si están leídos. Devuelve también `unread`. Parámetro: `limit`. |
| POST | `/api/notifications/read` | Marca avisos como leídos. Cuerpo: `ids` o `all: true`. |
| GET | `/api/gateway/config` | Configuración y estado del gateway: host, puerto, alias publicados, perfil activo y `web_search`. |
| PUT | `/api/gateway/config` | Cambia `enabled`, `host`, `port`, `request_timeout_seconds`, `max_request_mb` y `web_search` (por defecto `true`). Host, puerto y activación requieren reiniciar el gateway. La búsqueda web se aplica al guardar. |

## Modelos

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/api/models` | Modelos instalados de Ollama y Hugging Face, modelos cargados en memoria y persistencia. |
| PUT | `/api/models/persistence` | Añade o quita un modelo del perfil **Default**, que arranca siempre con MyDGX. Si Default está cargado, el cambio se aplica al momento. Cuerpo: `source` (`ollama`/`huggingface`), `model_id`, `enabled` y, opcional, `context_size`. Sin `context_size` usa el mismo contexto que `quick/start`. |
| POST | `/api/models/quick/start` | **Enciende** un modelo instalado al momento en el perfil **Quick**, si cabe en memoria. Quick no se restaura al reiniciar. Cuerpo: `source`, `model_id` y, opcional, `context_size` (se ajusta al rango entre el mínimo de los agentes y el máximo del modelo, que `GET /api/models` publica en `quick_start.context`). `409` si no cabe o ya está cargado. |
| GET | `/api/models/settings` | **Ajustes de arranque** de un GGUF descargado. Para cada valor da el automático, el efectivo y su origen (`ficha`, `GGUF`, `manual`…). Incluye las cuantizaciones principales con su arquitectura y si el llama.cpp instalado la reconoce, los mmproj, el rango de contexto y los drafters disponibles para la decodificación especulativa. Parámetro: `model_id`. |
| PUT | `/api/models/settings` | Guarda valores manuales para ese modelo; un campo `null` vuelve al automático y un cuerpo solo con `model_id` lo restablece todo. Campos: `model_filename`, `mmproj_filename` (`""` desactiva la visión), `context_size`, `context_max`, muestreo (`temperature`, `top_p`, `top_k`, `min_p`, `repeat_penalty`, `presence_penalty`), `cache_type_k`/`cache_type_v`, `spec_type` (`off` o un `draft-*`), `draft_filename` y `spec_draft_n_max`. Si el modelo está en Default, se actualiza también ahí. |
| POST | `/api/models/quick/stop` | **Apaga** un modelo de Quick sin tocar los demás. Al apagar el último, Quick desaparece. Cuerpo: `source`, `model_id`. |
| POST | `/api/models/stop-all` | **Para todos los modelos** salvo el del chat: detiene los perfiles cargados (también Quick) menos Default y el que aloja el modelo del asistente, y descarga los residentes de Ollama que no pertenezcan a ellos. No toca ComfyUI, TTS ni Whisper. Devuelve `stopped_profiles`, `released_ollama` y `kept_profiles`; `409` si hay un perfil arrancando. |
| POST | `/api/models/comfyui/release` | **Libera** la memoria de ComfyUI. Descarga todos los modelos que tenga cargados, porque ComfyUI no permite soltar uno solo; se vuelven a cargar en la siguiente generación. Devuelve `502` si ComfyUI no responde. |
| GET | `/api/models/search` | Recomendaciones para este equipo (memoria, compatibilidad, rendimiento estimado, Score comunidad HF). Parámetros: `q`, `task`, `size`, `alignment`, `runtime`, `model_format`, `modality`, `limit`, `page`. |
| GET | `/api/models/huggingface/search` | Búsqueda general en Hugging Face. Parámetros: `q`, `task`, `modality`, `limit`. |
| GET | `/api/models/huggingface/favorites` | Lista de favoritos. |
| PUT | `/api/models/huggingface/favorites` | Añade o quita un favorito. Cuerpo: `repo_id`, `enabled`. |
| GET | `/api/models/huggingface/inspect/{repo_id}` | Metadatos, formatos, archivos y capacidades de un repositorio. Parámetro: `revision`. |
| POST | `/api/models/huggingface/download` | Descarga un snapshot completo. Cuerpo: `repo_id`, `revision`. Devuelve `job_id`. |
| POST | `/api/models/huggingface/files/download` | Descarga solo algunos archivos (por ejemplo un GGUF). Cuerpo: `repo_id`, `revision`, `files`. Devuelve `job_id`. Al terminar, pone en cola un benchmark automático de los GGUF principales descargados. Ese benchmark comprueba que arrancan y responden, y mide la memoria real frente a la estimada y la aceptación del drafter. |
| POST | `/api/models/huggingface/preflight` | **Comprobación previa** sin descargar nada: lee por HTTP Range la cabecera de cada GGUF seleccionado. Devuelve para cada uno el papel que tiene (principal, mmproj o un tipo de drafter), la arquitectura, si el llama.cpp instalado la reconoce, el contexto nativo, la cuantización, si lleva MTP integrado y la memoria estimada con 32K. Incluye avisos: shards incompletos, falta del modelo principal, drafter con mmproj, drafter disponible pero no seleccionado (en `suggested_draft`) o memoria insuficiente. Cuerpo: `repo_id`, `revision`, `files`. |
| GET | `/api/models/import/limits` | Límites para importar un ZIP: espacio libre, tamaño máximo del ZIP ahora mismo (`max_upload_now_bytes`, cabe el ZIP y su extracción con 2 GiB de margen), tope de `MODEL_IMPORT_MAX_GB`, memoria máxima del modelo principal y el espacio de nombres (`imported`). |
| POST | `/api/models/import/upload` | **Importa un modelo GGUF desde un ZIP**. El cuerpo es el ZIP en bruto (no multipart) con `Content-Length` obligatorio; parámetros `filename` (debe acabar en `.zip`) y `run_test` (`true` por defecto). Responde `{job_id}` de un trabajo `models.import` con cinco pasos: subir, comprobar (rutas seguras, sin cifrado ni enlaces simbólicos, compresión razonable, `mydgx.json` válido), extraer a `imported/<nombre>` en la caché HF, analizar (partes completas, arquitectura, memoria) y probar con un benchmark de una repetición. El resultado se lee en `/api/jobs/{job_id}/result`. 400 si el archivo no es válido, 409 si ya hay otra importación, 413 si no cabe. Cancelable. |
| POST | `/api/models/huggingface/integrity/{repo_id}` | Verifica los SHA-256 de la caché local contra Hugging Face. Devuelve `job_id`. |
| DELETE | `/api/models/huggingface/{repo_id}` | Borra un repositorio de la caché. `?confirm=` el `repo_id` exacto. `409` si lo usa un perfil cargado o una descarga. |
| POST | `/api/models/ollama/pull` | Descarga un modelo de Ollama. Cuerpo: `name`. Devuelve `job_id`. |
| POST | `/api/models/ollama/update` | Vuelve a descargar un modelo de Ollama para actualizarlo. Cuerpo: `name`. |
| POST | `/api/models/ollama/load` | Carga un modelo de Ollama en memoria. Cuerpo: `name`, `keep_alive` (`10m`, `1h`, `0`...). |
| POST | `/api/models/ollama/unload` | Descarga un modelo de Ollama de la memoria. Cuerpo: `name`. |
| DELETE | `/api/models/ollama/{name}` | Elimina un modelo de Ollama. `?confirm=` el nombre exacto. |

Todas las descargas están limitadas al tamaño de la memoria física del equipo.

## Perfiles

Un perfil agrupa uno o varios modelos (principal más adicionales) con su motor,
puerto, contexto y parámetros. Puede haber hasta dos perfiles o modelos Quick de
chat o visión cargados a la vez; `GET /api/profiles` (`runtime`) y el plan de
arranque informan de las plazas ocupadas en `llm_slots` y `max_llm_slots`.

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/api/profiles` | Perfiles con modelos, plan de memoria, estado de ejecución, apps disponibles (`apps`, con alias y puerto web en `apps.web`) y estado del runtime. |
| POST | `/api/profiles` | Crea un perfil (cuerpo `ProfilePayload`, ver abajo). |
| PUT | `/api/profiles/{profile_id}` | Reemplaza la configuración de un perfil. En una receta, conserva el vínculo y la marca como editada (`recipe_modified`), así que deja de actualizarse sola. |
| GET | `/api/profiles/recipes` | Catálogo de recetas de GitHub (`source: github`) o, sin conexión, la copia local (`source: local` y `error`). Cada receta trae `version`, `changelog`, `categories` (`text`, `code`, `vision`, `embeddings`, `image`, `video`, `audio`) y `description` (`es`, `en`), `memory_gib`, `installed_version` (0 si no está instalada) `installed_ids`, `missing_models` (modelos de la receta instalada que faltan por descargar) y `running`. `?refresh=true` ignora la caché de 5 minutos. |
| POST | `/api/profiles/recipes/{recipe_id}/install` | Instala la receta como perfil editable con su propio `id` y nombre. Body: `download_models`. Devuelve `id`, `name`, `version` y los `jobs` de descarga. `409` si ya está instalada o el nombre existe. |
| POST | `/api/profiles/recipes/{recipe_id}/copy` | Crea un perfil normal y editable a partir de la receta publicada. Body: `name` (obligatorio, no puede empezar por `RECIPE`) y `download_models`. Devuelve `id`, `name` y `jobs`. |
| POST | `/api/profiles/recipes/{recipe_id}/download` | Pone en cola la descarga de los modelos que falten de una receta instalada, modelos adicionales y drafters MTP incluidos. Devuelve `id` y `jobs`. `404` si no está instalada. |
| POST | `/api/profiles/recipes/{recipe_id}/update` | Sustituye la receta instalada por la versión publicada, aunque sea menor (para retirar una versión con errores). Conserva `id`, favorito, predeterminado y la app de arranque si la receta no define otra, y quita la marca `recipe_modified`. `409` si el perfil está cargado. |
| POST | `/api/profiles/{profile_id}/duplicate` | Crea una copia editable con otro nombre (`name`). Copia modelos y parámetros, pero no el favorito ni el predeterminado, y da puertos llama.cpp nuevos. `409` si el nombre ya existe. |
| POST | `/api/profiles/{profile_id}/models` | Añade un modelo descargado como modelo adicional, con la misma configuración que *Encender*. Cuerpo: `source` (`huggingface` u `ollama`), `model_id` y, opcionalmente, `context_size`. Recibe puerto y alias propios. Si el perfil está cargado, se aplica al reiniciarlo. `409` si ya lo contiene o ya tiene el máximo de modelos; `403` en Default y Quick. |
| PATCH | `/api/profiles/{profile_id}/favorite` | Marca o desmarca favorito. Cuerpo: `favorite`. |
| POST | `/api/profiles/{profile_id}/download` | Descarga todos los modelos que falten del perfil. Devuelve `job_id`. |
| POST | `/api/profiles/{profile_id}/models/{model_id}/download` | Descarga un único modelo del perfil. |
| POST | `/api/profiles/{profile_id}/activate` | Lo marca como predeterminado (se arranca al iniciar MyDGX) sin cargarlo. |
| GET | `/api/profiles/{profile_id}/runtime-plan` | Plan conjunto antes de arrancar: memoria necesaria, conflictos de alias y puertos, reasignaciones. |
| POST | `/api/profiles/{profile_id}/start` | Prepara (descarga lo que falte) y arranca el perfil. Devuelve `job_id` (`profile.prepare-start`, cancelable). |
| POST | `/api/profiles/{profile_id}/stop` | Detiene un perfil cargado y su app. |
| POST | `/api/profiles/stop` | Detiene todos los perfiles y sus apps. |
| DELETE | `/api/profiles/{profile_id}` | Borra el perfil. `?confirm=` el nombre exacto del perfil. |
| GET | `/api/profiles/model-defaults` | Parámetros con los que arrancaría un modelo descargado (los mismos de *Encender*: contexto, muestreo de la ficha o del GGUF, caché KV, `mmproj`), para rellenar un modelo de un perfil. Parámetros: `source` (`huggingface` u `ollama`) y `model_id`. |
| GET | `/api/profiles/recommend/{repo_id}` | Recomienda motor, archivo GGUF, contexto y parámetros para un repositorio. Parámetros: `task`, `runtime`. |
| GET | `/api/profile-apps` | Lista las apps de la carpeta de apps que tienen `start.sh`, ejecuta `start.sh status` en cada una (salvo las que tienen una acción en curso) y devuelve `root`, `available`, `states` y `web`. |
| POST | `/api/profile-apps/{name}/{action}` | Ejecuta `start.sh` de una app de perfil. `action`: `start`, `stop`, `restart` o `status`. |
| PUT | `/api/profile-apps/{name}/web` | Fija el alias y el puerto web de una app (`alias`, `port` 1024-65535; `port: null` lo quita). `409` si el alias o el puerto ya están en uso (MyDGX, gateway, servicios, modelos de perfiles, túneles del systray, rangos de Default/Quick u otra app). Devuelve `restart_required` si la app está en marcha. |

Campos principales de `ProfilePayload`: `name`, `engine` (`llama.cpp`, `ollama`,
`vllm`, `sglang`, `tensorrt-llm`, `openai-compatible`, `comfyui`, `diffusers`,
`whisper`, `riva`, `nvidia-nim`), `task`, `model_ref`, `model_repo`,
`model_filename` o `model_files`, `model_alias`, `port`, `context_size`,
parámetros de muestreo (`temperature`, `top_p`, `top_k`, `min_p`...),
`additional_models` (hasta 12), `memory_reserve_mb`, `auto_fit_context`,
`minimum_context_size` y `app` (nombre de la app que se arranca con el perfil;
ver [Guía de uso](guia-de-uso.md#app-del-perfil)).

## Laboratorio IA y herramientas de Open WebUI

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/api/multimodal/capabilities` | Modelos y tareas disponibles (imagen, audio, vídeo, embeddings, reranking, TTS, ASR). |
| POST | `/api/multimodal/run` | Ejecuta una tarea. Cuerpo: `model`, `task`, `prompt`, `data_url` (archivo en base64), `documents`, `voice`, `response_format`. |
| POST | `/api/multimodal/video/jobs` | Lanza una generación de vídeo en segundo plano. Devuelve `job_id`. |
| GET | `/api/artifacts/{artifact_id}` | Descarga un resultado (imagen, audio, vídeo) generado. |
| GET | `/api/openwebui/tools/openapi.json` | Especificación OpenAPI que Open WebUI importa como servidor de herramientas. |
| GET | `/api/openwebui/tools/capabilities` | Capacidades expuestas a Open WebUI. |
| POST | `/api/openwebui/tools/run` | Ejecuta una tarea multimodal desde Open WebUI. |
| POST | `/api/openwebui/tools/video/jobs` | Lanza un vídeo desde Open WebUI. Cuerpo: `model`, `prompt`. |
| GET | `/api/openwebui/tools/jobs/{job_id}` | Estado de un trabajo lanzado desde Open WebUI. |
| GET | `/api/openwebui/tools/jobs/{job_id}/result` | Resultado de ese trabajo. |

Detalle de tareas y formatos en [Laboratorio IA](laboratorio-ia.md).

## Benchmarks

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/api/benchmarks` | Ejecuciones, cola, suite en curso y algoritmo de puntuación. Parámetro: `limit`. |
| GET | `/api/benchmarks/pending` | Número de modelos instalados ejecutables que aún no han completado la suite (`pending`). Lo usa el contador del menú lateral. |
| POST | `/api/benchmarks/runs` | Mide un objetivo. Cuerpo: `target`, `protocol_id`, `repetitions`, `strict_isolation`. |
| POST | `/api/benchmarks/suite` | Lanza una suite sobre varios candidatos. Cuerpo: `repetitions`, `candidate_keys`. |
| POST | `/api/benchmarks/suite/{suite_id}/stop` | Detiene la suite y restaura el estado previo. |
| POST | `/api/benchmarks/queue/{entry_id}/skip` | Quita un modelo de la cola automática. |
| GET | `/api/benchmarks/runs/{run_id}` | Detalle de una ejecución. |
| GET | `/api/benchmarks/runs/{run_id}/export` | Exporta la ejecución como paquete verificable. |
| POST | `/api/benchmarks/import` | Importa un paquete exportado. Cuerpo: `bundle`. |

Metodología completa en [Benchmarks](benchmarks.md).

## Chat y asistente

| Método | Ruta | Para qué |
|---|---|---|
| POST | `/api/chat` | Chat directo con un modelo (Ollama o `profile:PROFILE_ID:MODEL_ID`). Cuerpo: `model`, `message`, `history`. |
| GET | `/api/assistant/status` | Disponibilidad del asistente, modelo elegido y fallbacks. |
| POST | `/api/assistant/chat` | Turno del asistente operativo. Cuerpo: `message`, `history`, `model`. |
| POST | `/api/assistant/actions/confirm` | Ejecuta una acción propuesta. Cuerpo: `action_id`. |
| POST | `/api/assistant/actions/reject` | Descarta una acción propuesta. Cuerpo: `action_id`. |

Detalle en [Asistente MyDGX](asistente-mydgx.md).

## Trabajos, logs y auditoría

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/api/jobs` | Trabajos recientes con progreso y estado. |
| GET | `/api/jobs/{job_id}` | Estado y eventos de un trabajo. |
| POST | `/api/jobs/{job_id}/cancel` | Cancela un trabajo compatible: descargas, verificaciones y preparación de perfil. |
| GET | `/api/jobs/{job_id}/result` | Resultado de un trabajo terminado. |
| GET | `/api/logs` | Logs técnicos estructurados. Parámetros: `level`, `category`, `q`, `before_id` (paginación), `limit`. |
| GET | `/api/audit` | Auditoría de acciones (quién cambió qué y si tuvo éxito). |

## Motores y modo memoria

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/api/engines` | Motores descubiertos (llama.cpp, Ollama, vLLM, SGLang, TensorRT-LLM, ComfyUI, Whisper, SearXNG), su estado y si se pueden controlar. |
| POST | `/api/engines/{engine_id}/action` | Activa o desactiva ComfyUI, Whisper o SearXNG de forma persistente. Cuerpo: `action` (`start`/`stop`), `confirm` = `"<action> <engine_id>"`. `409` si un perfil cargado usa el motor. |
| GET | `/api/memory-mode` | Servicios opcionales, cuáles están parados por el modo memoria y memoria libre. |
| POST | `/api/memory-mode/services/{service_id}` | Para o arranca un servicio opcional (`comfyui`, `whisper`, `tts`, `open-webui`, `searxng`). Cuerpo: `action`, `confirm` = `"<action> <service_id>"`. |
| POST | `/api/memory-mode/release` | Libera memoria: para servicios, descarga Ollama y opcionalmente detiene perfiles. Cuerpo: `services`, `release_ollama`, `stop_profiles`, `confirm` = `"liberar memoria"`. |
| POST | `/api/memory-mode/restore` | Vuelve a arrancar lo que paró el modo memoria. Cuerpo: `confirm` = `"restaurar servicios"`. |

## Sistema

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/api/storage` | Particiones, unidades NVMe y SMART, y el uso del disco del sistema por grupo (Sistema, Modelos, Apps, MyDGX, Usuario y otros), con `disk_total` y `disk_free`. `home_directories` desglosa «Usuario y otros» por directorio de primer nivel del home (sin lo ya contado en los demás grupos; los menores de 50 MB se agrupan en «Otros»). Las imágenes de solo lectura (`squashfs` de snap, `erofs`, `iso9660`) no aparecen como particiones. El uso se mide en segundo plano y se guarda 10 minutos: mientras se calcula, `usage_pending` es `true` y se devuelve la última medida (o listas vacías la primera vez); `usage_updated_at` indica cuándo se midió. `?refresh=true` fuerza una medida nueva. |
| GET | `/api/system/health-center` | Diagnóstico DGX con severidad y confianza: temperatura, memoria PSI/swap, disco, baja potencia sostenida, fallos de modelos, servicios, compatibilidad PyTorch/SM121 y Docker, KV OOM y eventos Xid/OOM/térmicos del arranque actual. Devuelve estado, completitud de colectores, hallazgos activos, resoluciones de siete días y `checks` (valor observado, umbral y estado `ok`/`warning`/`critical`/`unknown`/`not_applicable` por regla). `?refresh=true` repite el sondeo de PyTorch, que si no se reutiliza diez minutos. |
| GET | `/api/system/health-center/summary` | Resumen ligero para la cabecera, sin reevaluar: estado, contadores y hasta tres hallazgos activos. Una evaluación completa se ejecuta en segundo plano cada cinco minutos. |
| GET | `/api/system/backups` | Lista las copias de seguridad de `data/backups`: `name`, `size` y `created_at`, de la más reciente a la más antigua. |
| POST | `/api/system/backups` | Crea una copia `.tar.gz` con la base de datos, `config` y `data/*.json`, sin `.env` ni archivos `*.env`. Devuelve `name`, `size` y `created_at`. `409` si ya se está creando otra; `507` si no hay espacio. |
| GET | `/api/system/backups/{name}` | Descarga la copia. `404` si el nombre no es una copia de MyDGX. |
| DELETE | `/api/system/backups/{name}` | Borra la copia del DGX. |
| GET | `/api/system/health-center/report` | Genera un informe JSON redactado: sin logs crudos, hostname, red ni credenciales; incluye plataforma no identificativa, estado de colectores y solo la evidencia coincidente. |
| GET | `/api/system/readiness` | Comprobación de que MyDGX y el sistema están listos, con avisos y recomendaciones. |
| GET | `/api/system/versions` | Versiones de sistema, kernel, CUDA, driver y runtimes. |
| GET | `/api/system/integrity` | Integridad de kernel, DKMS, paquetes NVIDIA, llama.cpp y servicios. |
| GET | `/api/services` | Servicios systemd y contenedores gestionados. |
| POST | `/api/services/action` | `start`, `stop` o `restart` de un servicio de `MANAGED_SERVICES`. Requiere `ENABLE_SERVICE_CONTROL=true`. Cuerpo: `name`, `action`, `confirm` = `"<action> <name>"`. |
| GET | `/api/updates` | Paquetes APT actualizables, con categoría y si son de seguridad. |
| POST | `/api/updates/apply` | Aplica actualizaciones APT. Requiere `ENABLE_SYSTEM_UPDATES=true`, 5 GB libres. Cuerpo: `confirm` = `"ACTUALIZAR MYDGX"`. Devuelve `job_id`. |
| GET | `/api/updates/firmware` | Firmware pendiente según fwupd (dispositivo, versión actual y nueva, notas, si requiere reinicio), reinicio pendiente y estado de la ConnectX-7. Caché de 10 minutos; `?refresh=true` fuerza la consulta. |
| POST | `/api/updates/firmware/apply` | Instala el firmware pendiente con `fwupdmgr update`, sin reiniciar. Requiere `ENABLE_FIRMWARE_UPDATES=true` y que no haya trabajos en curso. Cuerpo: `confirm` = `"ACTUALIZAR FIRMWARE"`. Devuelve `job_id`. |
| POST | `/api/system/repair` | Repara runtime NVIDIA, DKMS y llama.cpp. Requiere `ENABLE_SYSTEM_UPDATES=true`. Cuerpo: `confirm` = `"REPARAR MYDGX"`. Devuelve `job_id`. |

## Gateway (`/v1`)

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/health` | Salud del gateway. Incluye `web_search`. |
| POST | `/v1/search` | Búsqueda web vía SearXNG local. Cuerpo: `{"query":"términos","limit":5}`. Misma autenticación que el resto del gateway. `403` si está desactivada, `503` si SearXNG no responde. No registra la consulta. |
| GET | `/v1/models` | Modelos publicados por los perfiles cargados (alias y nombre completo). |
| GET | `/v1/models/{model_id}` | Detalle de un modelo publicado. |
| POST | `/v1/chat/completions` | Chat OpenAI (streaming incluido). |
| POST | `/v1/completions` | Completado de texto clásico. |
| POST | `/v1/responses` | API Responses de OpenAI. |
| POST | `/v1/messages` | API Messages de Anthropic (para Claude Code). |
| POST | `/v1/messages/count_tokens` | Recuento de tokens estilo Anthropic. |
| POST | `/v1/embeddings` | Embeddings. |
| POST | `/v1/rerank` | Reranking de documentos. |
| POST | `/v1/redact` | Redacción de datos personales con un perfil de Privacy Filter. |
| POST | `/v1/images/generations` | Generación de imagen (ComfyUI). |
| POST | `/v1/audio/transcriptions` | Transcripción (Whisper). |
| POST | `/v1/audio/translations` | Traducción de audio al inglés (Whisper). |
| POST | `/v1/audio/speech` | Síntesis de voz (TTS). |
| POST | `/v1/videos/generations` | Generación de vídeo síncrona. |
| POST | `/v1/videos` | Crea un trabajo de vídeo asíncrono. |
| GET | `/v1/videos/{video_id}` | Estado de un vídeo. |
| GET | `/v1/videos/{video_id}/content` | Descarga el vídeo terminado. |
| DELETE | `/v1/videos/{video_id}` | Borra el vídeo y su trabajo. |

```bash
curl -s http://127.0.0.1:4000/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"ALIAS_DEL_PERFIL","messages":[{"role":"user","content":"Hola"}]}'
```

Configuración de clientes (OpenCode, Claude Code, Open WebUI, SDK de OpenAI) en
[Clientes del gateway](gateway-clientes.md).
