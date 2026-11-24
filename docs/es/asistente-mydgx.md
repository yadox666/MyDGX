# Asistente MyDGX

El chat integrado funciona como un asistente operativo local. Puede responder
preguntas sobre MyDGX, consultar el estado actual del equipo y proponer acciones.
El modelo nunca recibe acceso general al sistema, SQL, comandos de shell ni URLs
arbitrarias.

Las respuestas del asistente se renderizan como Markdown CommonMark y GFM:
encabezados, énfasis, listas, tareas, tablas, citas, enlaces, imágenes, código,
bloques, tachado y HTML embebido sanitizado. Los mensajes del usuario permanecen
como texto plano. Los enlaces se abren aislados en una pestaña nueva y las
imágenes se cargan sin enviar la cabecera `Referer`.

## Configuración

```dotenv
ASSISTANT_ENABLED=true
ASSISTANT_MODEL=llama3.2:3b
ASSISTANT_FALLBACK_TO_AVAILABLE=true
ASSISTANT_MIN_FALLBACK_PARAMETERS_B=3
ASSISTANT_MAX_TOOL_ROUNDS=6
ASSISTANT_ACTION_TTL_SECONDS=300
```

- `ASSISTANT_ENABLED`: publica y habilita el asistente.
- `ASSISTANT_MODEL`: modelo preferido de Ollama. También acepta una referencia
  `profile:PROFILE_ID:MODEL_ID` o `auto`.
- `ASSISTANT_FALLBACK_TO_AVAILABLE`: si el modelo preferido no responde, prueba
  modelos de chat cargados, el perfil activo y modelos de Ollama instalados.
- `ASSISTANT_MIN_FALLBACK_PARAMETERS_B`: tamaño mínimo estimado de los modelos
  elegidos automáticamente como fallback. No limita un modelo solicitado de
  forma explícita.
- `ASSISTANT_MAX_TOOL_ROUNDS`: máximo de ciclos modelo-herramienta por turno.
- `ASSISTANT_ACTION_TTL_SECONDS`: tiempo disponible para confirmar una acción.

El valor predeterminado es `llama3.2:3b`, un modelo ligero con soporte de
herramientas en Ollama. Debe estar instalado en
Ollama para utilizarlo específicamente:

```bash
ollama pull llama3.2:3b
```

Si no está instalado, el fallback prueba otro modelo compatible de al menos
3B parámetros. Esto evita seleccionar automáticamente modelos demasiado
pequeños para orquestar herramientas; un modelo elegido expresamente no se
filtra.

## Fuentes de conocimiento

El asistente utiliza cuatro fuentes de información:

1. **Mapa de la aplicación** en su prompt de sistema: las secciones de la
   interfaz y los conceptos clave (perfiles, perfiles Default y Quick, apps de
   perfil, gateway, modo memoria, trabajos).
2. **Documentación local:** indexa en memoria la documentación del idioma de la
   interfaz (`README.es.md` y `docs/es/*.md` en español, `README.md` y
   `docs/en/*.md` en inglés), la guía de comprobación DGX y la guía de la
   aplicación macOS. La búsqueda es local y no indexa `.env`, bases de datos,
   logs ni archivos de usuario.
3. **Referencia de la API:** `get_api_reference` lee [api.md](api.md) en el
   mismo idioma; un test mantiene las dos versiones sincronizadas con todas las
   rutas reales. Con ella el asistente
   explica cómo integrar o automatizar MyDGX y muestra ejemplos `curl`. Usa
   siempre marcadores como `YOUR_API_KEY` e indica el texto de confirmación que
   exige cada endpoint. El asistente no ejecuta esas llamadas: son para que las
   lances tú.
4. **Herramientas en vivo:** consulta funciones internas del backend para
   obtener telemetría y estado actual. No realiza peticiones arbitrarias
   construidas por el modelo.

La caché documental se crea al primer uso. Reinicia MyDGX después de modificar
la documentación para que el asistente vuelva a indexarla.

## Herramientas disponibles

Consultas:

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
- `get_recent_events`: logs y auditoría, filtrables por nivel, categoría y texto
- `get_api_reference`: endpoints del dashboard y del gateway con autenticación y
  convenciones
- `get_config`: configuración pública (solo indica si las claves existen)
- `get_memory_mode`: servicios opcionales, memoria que ocupan y qué está parado
- `get_profile_apps`: apps de perfil disponibles y su estado
- `get_updates`: actualizaciones APT disponibles

Acciones confirmadas:

- `start_profile`
- `stop_profile`
- `activate_profile`
- `download_huggingface_model`
- `download_ollama_model`
- `favorite_huggingface_model`
- `cancel_job`: descargas, verificaciones, benchmarks y preparación de perfil
- `control_service`
- `control_engine`: activar o desactivar ComfyUI, Whisper o SearXNG
- `profile_app_action`: arrancar, detener o reiniciar una app de perfil
- `release_memory`: modo memoria (parar servicios opcionales, descargar Ollama y
  opcionalmente detener perfiles)
- `restore_memory`: volver a arrancar lo que paró el modo memoria

Las acciones no se ejecutan durante la inferencia. Se guardan temporalmente con
un identificador aleatorio, aparecen como una tarjeta en el chat y solo se
ejecutan al pulsar **Confirmar**. Al rechazarlas o caducar quedan inutilizables.
Cada propuesta, confirmación y rechazo se registra en la auditoría.

Todas las descargas de modelos, incluidas las iniciadas por el asistente o al
preparar un perfil, están limitadas al tamaño de la memoria física total del
equipo. Hugging Face se valida antes de crear la tarea; si el repositorio no
publica el tamaño de un archivo, la descarga se rechaza. Ollama informa el
tamaño al comenzar el stream y MyDGX lo interrumpe inmediatamente si supera el
límite.

Para mantener precisión con modelos ligeros, MyDGX selecciona dinámicamente las
herramientas relevantes para cada pregunta. El catálogo completo permanece
disponible, pero no se envían al modelo esquemas ajenos a la tarea actual.

`control_service` respeta `ENABLE_SERVICE_CONTROL` y `MANAGED_SERVICES`; el
asistente no amplía esos permisos.

## API

Todos estos endpoints, salvo la salud general, utilizan la misma protección
`X-MyDGX-Key` que el resto del dashboard cuando `MYDGX_API_KEY` está configurada.

### Consultar disponibilidad

`GET /api/assistant/status`

Informa si el asistente está habilitado, si el modelo preferido está instalado,
qué fallbacks están disponibles y cuántos fragmentos documentales se indexaron.
No intenta cargar el modelo ni revela secretos. La interfaz usa este endpoint
para desactivar el compositor y mostrar una corrección concreta cuando no hay
ningún modelo.

### Enviar un turno

`POST /api/assistant/chat`

```json
{
  "message": "Resume el uso de GPU de la última hora",
  "history": [
    {"role": "user", "content": "¿Está preparado el sistema?"},
    {"role": "assistant", "content": "Sí, con un aviso opcional."}
  ],
  "model": null
}
```

`model` es opcional. Si se omite, se usa `ASSISTANT_MODEL` y su fallback.

Respuesta:

```json
{
  "message": {"role": "assistant", "content": "Durante la última hora..."},
  "model": "llama3.2:3b",
  "tools_used": [{"name": "get_metrics_summary", "status": "ok"}],
  "pending_actions": []
}
```

Una acción propuesta aparece en `pending_actions`:

```json
{
  "id": "IDENTIFICADOR_TEMPORAL",
  "name": "start_profile",
  "label": "Arrancar perfil PROFILE_ID",
  "arguments": {"profile_id": "PROFILE_ID"},
  "expires_at": "2026-11-12T08:20:00+00:00"
}
```

### Confirmar una acción

`POST /api/assistant/actions/confirm`

```json
{"action_id": "IDENTIFICADOR_TEMPORAL"}
```

### Rechazar una acción

`POST /api/assistant/actions/reject`

```json
{"action_id": "IDENTIFICADOR_TEMPORAL"}
```

## Ejemplos

- “¿Está listo el equipo para cargar un modelo?”
- “Resume CPU, memoria y GPU de las últimas seis horas.”
- “¿Qué modelos y perfiles tengo instalados?”
- “Recomiéndame tres modelos de código que quepan en este equipo.”
- “Compara el Score comunidad HF, memoria y rendimiento estimado.”
- “Compara los benchmarks medidos de los modelos de código.”
- “Inspecciona los archivos de `owner/model` antes de descargarlo.”
- “Busca en la documentación cómo funciona el gateway.”
- “Arranca el perfil de programación.”
- “No me cabe el modelo de 120B: libera memoria.” Propone `release_memory` con los
  servicios que más ocupan; después puedes pedir “restaura los servicios”.
- “¿Cómo arranco un perfil desde un script con curl?”
- “¿Qué endpoint uso para transcribir audio con el gateway?”
- “¿Por qué falló el último arranque?” Consulta logs de error y trabajos.
- “Reinicia la app de RAG AI.”
- “Desactiva ComfyUI, no lo uso.”
- “Reinicia Ollama.” La acción solo estará disponible si el control de servicios
  está habilitado y `ollama` pertenece a la lista permitida.

## Seguridad

- Ningún secreto se añade al prompt ni a la búsqueda documental.
- Las respuestas públicas de configuración solo indican si una clave existe.
- Los parámetros de herramientas tienen esquemas y límites cerrados.
- Las acciones usan las validaciones y listas permitidas ya existentes.
- Los eventos persistidos pasan por la redacción de datos sensibles.
- El asistente no puede eliminar modelos, perfiles ni datos.
- Para acceso remoto se mantiene la recomendación de HTTPS autenticado o túnel
  SSH y una `MYDGX_API_KEY` robusta.
