# Laboratorio IA

El Laboratorio IA permite probar desde MyDGX los modelos y servicios del perfil
activo. La interfaz descubre sus capacidades, construye la petición adecuada y
envía el contenido directamente al endpoint local configurado para cada modelo.

## Requisitos

1. Crear o editar un perfil en **Perfiles**.
2. Declarar correctamente la tarea, las modalidades de entrada y salida y el
   protocolo del modelo.
3. Activar el perfil y arrancarlo.
4. Comprobar en **Motores** que el runtime o endpoint está disponible.
5. Abrir **Sistema → Laboratorio IA** y pulsar recargar si se acaba de cambiar el perfil.

El selector **Servicio** muestra los modelos habilitados del perfil activo. Si la
instalación administrada de ComfyUI está activa, añade también
`comfyui-image` y `comfyui-video` sin obligar a modificar el perfil de chat. Los
demás servicios externos deben tener un endpoint configurado y un protocolo
soportado.

## Flujo de uso

1. Selecciona un servicio. Se muestran su tarea, modalidades y endpoint.
2. Introduce la instrucción o los documentos requeridos.
3. Para visión o ASR, selecciona una imagen o un audio válido.
4. Pulsa **Ejecutar**. En vídeo, pulsa **Crear trabajo**.
5. Revisa la salida en **Resultado local**.

La interfaz cambia según la tarea:

| Tarea | Entrada | Salida | Endpoint esperado |
| --- | --- | --- | --- |
| Chat | Texto | Texto/JSON | `/v1/chat/completions` |
| Visión | Texto + imagen | Texto/JSON | `/v1/chat/completions` |
| Embeddings | Texto | Vector/JSON | `/v1/embeddings` |
| Generación de imagen | Texto | Imagen base64 o URL | `/v1/images/generations` |
| ASR | Audio | Transcripción/JSON | `/v1/audio/transcriptions` |
| TTS | Texto | Audio reproducible | `/v1/audio/speech` |
| Generación de vídeo | Texto | URL mediante trabajo | `/v1/videos/generations` |
| Reranking | Consulta + documentos | Puntuaciones/JSON | `/v1/rerank` |
| Redacción | Texto | Texto redactado + spans | `/v1/redact` |

## Configuración por tipo

### Chat y visión

`llama.cpp` puede servir chat y visión. Visión requiere que el modelo tenga una
proyección multimedia `mmproj` válida. El laboratorio envía una petición de chat
no streaming; en visión incorpora la imagen como `image_url` en formato data URL.

### Embeddings y reranking

Embeddings envía el texto como `input`. Reranking usa la instrucción como
consulta y cada línea del cuadro **Documentos** como un documento independiente,
con un máximo de 100.

### Imagen, audio y vídeo

Estos perfiles suelen apuntar a motores locales externos como Whisper, Riva, NIM
o un servidor compatible. MyDGX incluye un adaptador nativo para su ComfyUI
administrado:

- FLUX.1 Schnell FP8 para imagen mediante `comfyui-image`;
- Wan 2.1 T2V 1.3B para vídeo mediante `comfyui-video`;
- workflows versionados en `config/comfyui/`;
- medidas específicas para GB10 que desactivan pinned memory y cudaMalloc.

- Imagen solicita una sola salida en `b64_json` y la muestra en la página.
- ASR envía el audio como `multipart/form-data`.
- TTS solicita MP3 y muestra un reproductor.
- Vídeo crea un trabajo asíncrono. El botón **Consultar resultado** revisa su
  estado. MyDGX copia la salida administrada de ComfyUI a `data/artifacts` y
  devuelve una URL autenticada.

## API de MyDGX

El frontend utiliza:

- `GET /api/multimodal/capabilities`: modelos del perfil activo y capacidades.
- `POST /api/multimodal/run`: chat, visión, embeddings, imagen, ASR, TTS y
  reranking.
- `POST /api/multimodal/video/jobs`: creación asíncrona de vídeo.
- `GET /api/jobs`: progreso del trabajo.
- `GET /api/jobs/{id}/result`: resultado estructurado de vídeo.
- `GET /api/artifacts/{id}`: descarga autenticada de una salida multimedia.

Open WebUI recibe además un servidor de herramientas OpenAPI limitado a
`/api/openwebui/tools/*`. Este permite descubrir capacidades, ejecutar tareas
sin adjuntos y crear o consultar trabajos de vídeo. No publica operaciones de
sistema, actualización, perfiles ni borrado.

Ejemplo de petición de embeddings:

```json
{
  "model": "alias-del-modelo",
  "task": "embeddings",
  "prompt": "Texto que se convertirá en vector",
  "data_url": "",
  "documents": [],
  "response_format": "json"
}
```

Ejemplo de reranking:

```json
{
  "model": "alias-del-reranker",
  "task": "reranking",
  "prompt": "¿Qué documento explica mejor CUDA?",
  "documents": [
    "CUDA permite ejecutar cómputo paralelo en la GPU.",
    "SQLite es una base de datos embebida."
  ],
  "response_format": "json"
}
```

## Privacidad y límites

- Imágenes y audios se mantienen en memoria durante la petición; MyDGX no los
  almacena en SQLite ni en disco.
- El límite efectivo de archivo es el menor entre `MULTIMODAL_MAX_UPLOAD_MB` y
  el límite `max_input_mb` del modelo.
- Solo se admiten JPEG, PNG y WebP para visión, y formatos habituales de audio
  para ASR.
- Los resultados estructurados de vídeo se conservan en SQLite. Las salidas
  binarias del ComfyUI administrado se guardan con permisos `0600` en
  `data/artifacts`.
- Las operaciones quedan registradas en auditoría sin guardar prompts, archivos,
  tokens ni cabeceras de autorización.
- Mantén los endpoints ligados a localhost o protegidos por autenticación; nunca
  incluyas claves en perfiles, código o documentación.

## Diagnóstico

- **Sin modelos multimodales**: no hay perfil activo o no contiene modelos
  habilitados. Actívalo y recarga el laboratorio.
- **Servicio no disponible**: arranca el perfil y comprueba el endpoint en
  **Motores**.
- **La tarea no coincide**: revisa la tarea declarada en el perfil.
- **Archivo demasiado grande o tipo no permitido**: reduce o convierte el
  archivo y verifica el límite del modelo.
- **Adaptador requerido**: el motor externo no habla un protocolo soportado.
- **Vídeo sin resultado**: consulta de nuevo el trabajo y revisa
  `mydgx-comfyui.service` y el espacio libre del volumen.
