# Benchmarks reproducibles

La sección **Benchmarks** mide modelos locales con un protocolo estable y guarda
resultados históricos en SQLite. Los valores medidos permanecen separados de
las estimaciones del recomendador y de la popularidad de Hugging Face.

## Protocolo v1

`mydgx-text-generation-v1` admite generación de texto mediante Ollama y
perfiles cargados compatibles con la API OpenAI de llama.cpp u otros motores.

`mydgx-asr-v1` mide exclusivamente modelos Whisper locales con
`POST /v1/audio/transcriptions` multipart. Conserva tiempo total, duración,
factor de tiempo real (RTF), WER, CER y SHA-256 de la transcripción; nunca
persiste el texto reconocido.

El fixture humano `armstrong-en` está descrito en
`backend/fixtures/asr/manifest.json`. Es una grabación NASA de dominio público,
no silencio ni audio sintético. El WAV está incluido para que la suite funcione
sin red; MyDGX exige coincidencia exacta de tamaño y SHA-256. El origen HTTPS
fijado en el manifiesto solo actúa como recuperación, con límite de tamaño.
Una copia ausente o alterada invalida la muestra: no se sustituye por silencio.

`mydgx-image-generation-v1` mide el FLUX gestionado por MyDGX mediante un
workflow ComfyUI reproducible. Solo aparece cuando el checkpoint real existe en
disco y su identidad se calcula con tamaño y SHA-256. Registra tiempo de
generación, integridad PNG, resolución esperada y reproducibilidad de píxeles
con prompt, semilla, dimensiones y pasos versionados. Las imágenes temporales
se eliminan al terminar; SQLite conserva únicamente hashes y métricas.

`mydgx-video-generation-v1` mide exclusivamente el Wan 2.1 T2V gestionado por
MyDGX en ComfyUI local. El candidato solo existe si están presentes los tres
artefactos reales referenciados por `config/comfyui/video-workflow-api.json`:
diffusion model, text encoder y VAE. Su fingerprint compuesto incluye tamaño y
SHA-256 de cada componente, además del SHA-256 del workflow versionado.

El caso Wan fija prompt, seed `424242`, resolución `832×480`, `33` frames,
`30` steps y `24` fps. Registra tiempo, tamaño, firma e integridad del
contenedor, dimensiones y duración/frames cuando pueden inspeccionarse, SHA-256
exacto y un hash perceptual objetivo por frames. Usa `ffprobe` y `ffmpeg`
únicamente si ya están instalados. Sin ellos declara validación de solo firma
de contenedor, deja las métricas no observables como `null`, renormaliza el
score medible y lo marca provisional; nunca presenta esa degradación como
calidad visual. El vídeo se recupera en memoria, se elimina de la salida
gestionada de ComfyUI y no se persiste: SQLite conserva solo hashes y métricas.

`mydgx-embeddings-v1` mide modelos locales mediante la API OpenAI
`POST /v1/embeddings`. Envía en un único batch pares públicos positivos y
negativos versionados, y registra latencia, elementos por segundo, dimensión,
similitud coseno media, margen semántico y exactitud de separación.

`mydgx-reranking-v1` usa el mismo `POST /v1/rerank` del adaptador multimodal.
Sus casos públicos contienen consulta, documentos y orden esperado versionados.
Registra latencia, NDCG, MRR y coincidencia exacta del orden.

Ambos protocolos semánticos solo incorporan modelos habilitados en perfiles
cuando el artefacto está instalado o el modelo está configurado en un servicio
local, y el endpoint se resuelve a `127.0.0.1`, `localhost` o `::1`. No se
admiten APIs cloud ni endpoints remotos. El fingerprint estable usa el digest
del artefacto cuando existe; para un servicio local configurado usa tarea,
motor, referencia de modelo y endpoint loopback normalizado.

`mydgx-vision-v1` mide visión como modalidad independiente, nunca como texto.
Usa un PNG `256×192` generado determinísticamente en memoria y fijado por
SHA-256, sin archivos descargados ni red. Las preguntas, respuestas esperadas
y conceptos aceptados están versionados. Registra latencia y recall normalizado
de conceptos, pero solo persiste métricas y el hash de la respuesta. Admite
llama.cpp/OpenAI locales y Ollama únicamente cuando `POST /api/show` declara
la capability `vision`.

`mydgx-tts-v1` mide TTS configurado en perfiles con endpoint loopback. Usa
textos públicos versionados y WAV para medir latencia, duración, RTF,
integridad RIFF/PCM, frecuencia, canales, profundidad, RMS y ausencia de
silencio. `tts-lab` y las APIs OpenAI reutilizan `execute_multimodal_request`.
Audio y transcripción viven solo en memoria. La inteligibilidad se mide por
round-trip con Whisper local; si no está disponible o falla, esa dimensión vale
cero, el score queda provisional y no se afirma calidad no medida.

La suite incluye:

- una muestra de calentamiento por caso, excluida del score;
- latencia interactiva;
- throughput sostenido;
- generación de código;
- entre 1 y 10 repeticiones medidas;
- temperatura `0`, `top_p=1`, seed `42` y una única petición concurrente;
- en Ollama, `num_ctx` fijo (8192) para que el contexto no dependa del servidor.

MyDGX mide con reloj monotónico:

- tiempo hasta el primer token (TTFT), incluido el razonamiento, y por separado
  el primer token visible (`visible_ttft_ms`);
- tiempo total;
- `finish_reason`/`done_reason`, fin temprano (`early_stop`) y si se alcanzó el
  límite de tokens;
- tokens de entrada y salida cuando el runtime los informa;
- tokens de salida por segundo;
- caracteres por segundo para comparar tokenizadores distintos;
- hashes de salida, nunca el texto generado;
- memoria, utilización GPU, temperatura y potencia disponibles.

Los resultados conservan p50, p95, dispersión, fiabilidad y las muestras
individuales. Las muestras fallidas también se guardan.

## Aislamiento

El aislamiento estricto evita **actividad concurrente**, no la mera residencia en
memoria. Antes de cada muestra comprueba:

- que no haya otro job en cola o ejecución;
- que ningún servidor llama.cpp cargado esté procesando (`/slots`);
- que Ollama no tenga residente otro modelo ajeno a los perfiles cargados.

Al empezar, el runner descarga de memoria los modelos Ollama inactivos que no
pertenecen a un perfil cargado (`BENCHMARK_RELEASE_IDLE_OLLAMA`). Si detecta
actividad espera hasta 40 s; si persiste, aborta el run. Si un servidor
llama.cpp aparece ocupado justo después de una muestra, esa muestra se marca
como contaminada y el run queda fuera de las comparativas.

Los modelos de perfil co-residentes se permiten y se guardan en
`runtime.isolation.co_resident_models`, que no forma parte del hash de runtime.

Mientras dura el run, MyDGX publica una señal compartida en SQLite:

- la API principal responde `423` a chat, asistente, multimodal, descargas y
  arranques de perfil;
- el gateway OpenAI/Anthropic responde `503 benchmark_in_progress` con
  `Retry-After: 30`.

En sentido inverso, cada inferencia del gateway (OpenCode, Claude Code, Codex,
Open WebUI vía gateway…) guarda en SQLite la hora de su inicio y de su final.
El planificador respeta `BENCHMARK_QUIET_SECONDS` también desde esa marca, de
modo que un benchmark automático no arranca entre dos turnos de una sesión
activa.

El tráfico que vaya directo a Ollama (por ejemplo Open WebUI) no se puede
bloquear, y en un objetivo Ollama tampoco se puede detectar: conviene no usarlo
durante el run. El muestreador de telemetría sigue activo porque forma parte de
la medición.

## Benchmark automático al cargar modelos

Con `BENCHMARK_AUTO_NEW_MODELS=true`, el valor predeterminado, MyDGX encola un
benchmark en estos casos:

- al terminar con éxito el arranque de un perfil: uno por cada modelo de chat o
  visión;
- al completar `ollama pull`;
- al autoarrancar el perfil predeterminado.

La cola (`benchmark_queue`) es persistente. El planificador revisa cada
`BENCHMARK_QUEUE_POLL_SECONDS` y solo lanza un benchmark cuando:

- no hay jobs;
- no hay inferencia llama.cpp en curso;
- han pasado `BENCHMARK_QUIET_SECONDS` desde el último chat, asistente o
  multimodal.

Si se pierde el aislamiento, la entrada vuelve a quedar pendiente (hasta 6
intentos). Las entradas caducan a las `BENCHMARK_QUEUE_MAX_AGE_HOURS` y se
descartan si el modelo ya no está cargado.

Para no repetir mediciones, un benchmark automático se omite si ya existe un run
válido con el mismo artefacto, runtime, entorno, protocolo y algoritmo. Las
descargas HF no se miden hasta que el modelo se carga en un perfil.

## Suite secuencial de larga duración

El panel **Completar benchmarks pendientes** ejecuta todos los artefactos
locales que todavía no tienen un run válido con el protocolo y algoritmo
actuales. El inventario incluye:

- modelos instalados en Ollama;
- modelos llama.cpp de texto o visión presentes en perfiles y cuyos archivos
  GGUF ya están descargados;
- modelos Ollama visuales separados de texto según `/api/show`;
- sintetizadores TTS configurados con endpoint loopback;
- modelos de embeddings y reranking instalados/configurados en perfiles con
  endpoint exclusivamente loopback;
- FLUX y Wan gestionados, este último solo con diffusion model, text encoder y
  VAE completos;
- un único candidato por hash de artefacto, aunque aparezca en varios perfiles.

Antes de empezar, MyDGX guarda los IDs de los perfiles cargados y los modelos
residentes en Ollama. Después:

1. bloquea la inferencia de la API y el gateway;
2. detiene todos los perfiles y descarga todos los modelos Ollama de memoria;
3. carga un único modelo;
4. ejecuta el protocolo completo;
5. detiene el runtime y espera a que se recupere la memoria;
6. continúa con el siguiente artefacto;
7. restaura los perfiles y residentes Ollama capturados al inicio.

El estado, el inventario y cada resultado parcial se guardan en
`benchmark_suites` y `benchmark_suite_items`. Si un modelo falla, la suite
registra el error, libera memoria y continúa con el siguiente. Al detenerla
manualmente se cancela la muestra actual y se ejecuta la misma restauración.

Durante el apagado ordenado de MyDGX, la tarea recibe cancelación, marca la
suite como interrumpida y restaura el snapshot antes de que termine el servicio.
Si el proceso muere sin poder ejecutar código, al siguiente arranque la suite
queda marcada como `interrupted` y el mecanismo normal de perfiles deseados
restaura los perfiles persistidos.

Esta operación puede tardar muchas horas y deja temporalmente sin modelos al
chat, asistente, gateway y Open WebUI. El dashboard, el menú lateral y
MyDGXTray muestran el progreso. La parada manual permanece disponible hasta
que comienza la fase final de restauración.

## Identidad y persistencia

Cada run enlaza cuatro fingerprints:

1. artefacto:
   - HF: commit del snapshot local que realmente carga el runtime, archivo,
     digest del blob, tamaño, metadatos y model card de esa revisión;
   - Ollama: digest del manifiesto, familia, tamaño de parámetros y cuantización
     de `/api/show`;
2. runtime: motor, modelo, contexto efectivo y flags. En Ollama añade la
   versión del servidor, los parámetros del Modelfile y el hash de la plantilla;
3. entorno: hardware, memoria, SO, kernel y pila de inferencia (CUDA, driver,
   llama.cpp, Ollama, vLLM, torch). Las demás librerías se guardan, pero no
   alteran el hash, para no fragmentar la comparabilidad;
4. protocolo: definición canónica y hash inmutable.

Las APIs locales sin artefacto inspeccionable usan un fingerprint estable de
tarea, motor, referencia, protocolo y endpoint loopback normalizado; no incluye
credenciales ni el hostname real.

Las tablas `benchmark_runs`, `benchmark_samples` y `benchmark_telemetry` son
append-only desde la API. Los scores son datos derivados con algoritmo
versionado (`spark-text-v2`) y no sustituyen las métricas crudas.

## Score

El score de vídeo usa el algoritmo independiente
`wan-video-reproducibility-v1`. Combina rendimiento, integridad del contenedor,
dimensiones y extensión temporal esperadas, reproducibilidad exacta,
reproducibilidad perceptual y fiabilidad. Solo pondera dimensiones observadas,
publica `score_measured_weight` y queda provisional si faltan `ffprobe` o
`ffmpeg`. No es comparable con scores de otras modalidades.

Visión usa `vision-concept-recall-v1`; TTS usa
`tts-roundtrip-intelligibility-v1`. No son comparables con texto. En TTS, la
ausencia de Whisper conserva el peso de inteligibilidad en cero en vez de
renormalizarlo, por lo que reduce explícitamente el score máximo posible.

El score `/100` resume cuatro dimensiones:

- throughput: 35%;
- latencia: 30%;
- estabilidad: 20%;
- fiabilidad: 15%.

La estabilidad usa el coeficiente de variación de tok/s **dentro de cada caso**
y después promedia los casos. Así, las diferencias normales entre prompts no
penalizan. Con una sola repetición la estabilidad no es medible: el score se
renormaliza con las otras tres dimensiones y se marca como `provisional`.

El resumen incluye un desglose por caso (`cases`) con TTFT, tok/s, CV y fines
tempranos. La UI agrupa los runs por artefacto, con su histórico, y las gráficas
solo comparan runs del mismo entorno, protocolo y algoritmo.

Solo deben compararse scores con el mismo protocolo y una clase de hardware
equivalente. Likes, descargas y tendencia de Hugging Face no forman parte del
score medido.

## API

Todos los endpoints usan `X-MyDGX-Key` cuando la API está protegida.

### Inventario e histórico

`GET /api/benchmarks`

Devuelve protocolos, objetivos elegibles, estado del runner, cola automática
(`queue`, `auto_new_models`, `quiet_seconds`), candidatos de la suite
(`suite_candidates`), suite actual/histórica y runs recientes.

### Descartar una entrada automática

`POST /api/benchmarks/queue/ENTRY_ID/skip`

### Ejecutar

`POST /api/benchmarks/runs`

```json
{
  "target": "ollama:llama3.2:3b",
  "protocol_id": "mydgx-text-generation-v1",
  "repetitions": 3,
  "strict_isolation": true
}
```

Los perfiles cargados usan `profile:PROFILE_ID:MODEL_ID`.

### Ejecutar todos los pendientes

`POST /api/benchmarks/suite`

```json
{"repetitions": 3}
```

Devuelve `suite_id` y `job_id`. Rechaza el inicio si hay otro job, inferencia
llama.cpp activa, otra suite o ningún modelo pendiente.

### Detener y restaurar

`POST /api/benchmarks/suite/SUITE_ID/stop`

Solicita la cancelación de la muestra actual y restaura el snapshot operativo.
Durante `restoring` ya no se acepta una segunda cancelación.

### Consultar detalle

`GET /api/benchmarks/runs/RUN_ID`

Incluye identidad, entorno, runtime, ficha del modelo, muestras y telemetría.

### Exportar

`GET /api/benchmarks/runs/RUN_ID/export`

Genera un bundle JSON con versión de esquema y checksum SHA-256.

### Importar

`POST /api/benchmarks/import`

```json
{"bundle": {"schema": "mydgx-benchmark-bundle", "...": "..."}}
```

El servidor limita el bundle a 10 MiB, valida esquema, checksum, fingerprints,
protocolo y cantidades máximas. Los runs importados quedan marcados y no
sobrescriben resultados existentes.

### Cancelar

`POST /api/jobs/JOB_ID/cancel`

## Configuración

```dotenv
BENCHMARK_ENABLED=true
BENCHMARK_AUTO_NEW_MODELS=true
BENCHMARK_REPETITIONS=3
BENCHMARK_TELEMETRY_INTERVAL_SECONDS=1
BENCHMARK_QUIET_SECONDS=120
BENCHMARK_QUEUE_POLL_SECONDS=20
BENCHMARK_QUEUE_MAX_AGE_HOURS=24
BENCHMARK_RELEASE_IDLE_OLLAMA=true
```

`BENCHMARK_AUTO_AFTER_DOWNLOAD` queda sustituido por `BENCHMARK_AUTO_NEW_MODELS`.

No se necesitan claves adicionales.

## Seguridad y privacidad

- Los bundles no incluyen claves, cookies ni cabeceras de autorización.
- El fingerprint de entorno excluye hostname, número de serie y rutas locales.
- Las respuestas del modelo no se persisten; solo longitud y SHA-256.
- En embeddings y reranking, los textos públicos viven únicamente en la
  definición inmutable del protocolo. Las muestras guardan métricas y hashes de
  vectores, scores y órdenes, nunca consultas ni documentos.
- En visión no se guarda la respuesta ni una copia del fixture generado.
- En TTS no se guarda audio ni transcripción; solo hashes y métricas.
- La model card se limita y pasa por redacción antes de importar.
- Un bundle importado es información no confiable y nunca ejecuta código.
- Los repositorios privados pueden ser identificables por su nombre; revisa el
  JSON antes de compartirlo fuera del entorno autorizado.
