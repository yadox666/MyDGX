# Guía de uso

Recorrido por cada sección del dashboard, los conceptos que maneja y la API que
hay detrás. La referencia completa de endpoints está en [API](api.md).

## Conceptos clave

| Concepto | Qué es |
|---|---|
| **Modelo** | Pesos descargados en la caché de Hugging Face (`HF_HOME`) o en Ollama. Descargar no implica cargar en memoria. |
| **Perfil** | Receta de inferencia: uno o varios modelos con su motor (llama.cpp, Ollama, vLLM, SGLang, TensorRT-LLM, ComfyUI, Whisper...), puerto, contexto y parámetros. Puede haber **hasta dos perfiles cargados** a la vez si caben en memoria. |
| **Perfil predeterminado** | Perfil que MyDGX vuelve a cargar al arrancar (`ENABLE_PROFILE_AUTOSTART`). Se fija con *Activar*. |
| **App del perfil** | Aplicación propia (por ejemplo `~/ragkit`) que arranca y se para con el perfil mediante su `start.sh`. |
| **Perfil Default** | Perfil de solo lectura con los modelos marcados como *Default* en *Modelos* (por ejemplo un modelo de embeddings que siempre debe estar disponible). Arranca siempre al iniciar MyDGX y no cuenta para el límite de dos perfiles. |
| **Perfil Quick** | Perfil de solo lectura que se crea al pulsar *Encender* en un modelo de *Modelos*. Se carga al momento si cabe y se vacía con *Apagar*. Se conserva si solo se reinicia MyDGX (por ejemplo con un `deploy` normal), pero se vacía al reiniciar el equipo o con `deploy --repair`. No cuenta para el límite de dos perfiles. |
| **Gateway** | Endpoint OpenAI/Anthropic único (`http://127.0.0.1:4000/v1`) que enruta por alias de modelo a los perfiles cargados. |
| **Motor** | Runtime que sirve modelos. Algunos son servicios del sistema (Ollama, ComfyUI, Whisper, SearXNG) y otros los lanza MyDGX por perfil (llama-server). |
| **Modo memoria** | Pausa temporal de servicios opcionales para dejar sitio a un modelo grande, con restauración posterior. |
| **Trabajo** | Operación larga (descarga, verificación, arranque, benchmark, actualización) con progreso, cancelación y resultado. |

La memoria del GB10 es unificada (CPU y GPU comparten los 128 GB). Por eso MyDGX
calcula cuánta memoria necesita cada perfil antes de cargarlo y bloquea las
combinaciones que no caben.

## Resumen

- Telemetría en tiempo real: GPU, CPU, memoria unificada, temperatura, consumo,
  red y disco, con histórico configurable.
- **Mapa de memoria**: qué ocupa la memoria (perfiles, Ollama, servicios,
  sistema y caché de páginas) y cuánto queda libre de verdad.
- Consumo de inferencia por modelo en la última hora.
- Actividad reciente de trabajos y descargas.

En el panel lateral, la tarjeta del equipo muestra el modelo de DGX, el estado de
CUDA, las descargas en curso con su porcentaje y los **perfiles cargados**. Un
clic sobre ellos abre *Perfiles*.

API: `GET /api/overview`, `GET /api/metrics/history`, `GET /api/metrics/models`.

## Chat

Dos modos:

- **Chat** con cualquier modelo de Ollama o de un perfil cargado
  (`POST /api/chat`).
- **MyDGX Copilot**, el asistente operativo. Responde con datos reales del
  equipo, busca en esta documentación, recomienda modelos y propone acciones que
  solo se ejecutan si las confirmas. Ver [Asistente MyDGX](asistente-mydgx.md).

## Modelos

- **Recomendados**: modelos de Hugging Face filtrados por tarea, tamaño,
  alineamiento, runtime, formato y modalidad. Puntuación combinada de
  compatibilidad con el equipo, rendimiento estimado o medido y Score comunidad HF.
- **Instalados**: modelos de Ollama y Hugging Face, con tamaño, origen y si están
  cargados en memoria.
- Acciones por modelo:
  - descargar un snapshot o solo los archivos necesarios;
  - verificar la integridad con SHA-256;
  - borrar, escribiendo el nombre para confirmar;
  - marcar como favorito;
  - **Encender**: carga el modelo al momento en el perfil **Quick** si cabe en
    memoria y se puede levantar (los de Hugging Face deben ser GGUF). Los modelos
    encendidos quedan arriba de la lista con la etiqueta *Quick* y el botón
    **Apagar**, que los baja de memoria. Si el modelo ya lo carga otro perfil, el
    botón muestra el nombre de ese perfil. Si no cabe junto a lo que ya está
    cargado, el botón aparece desactivado como **No cabe ahora** y, al pasar el
    ratón, explica cuánta memoria falta o qué alias o puerto choca. Lo mismo ocurre
    con el botón de arrancar de cada perfil. Ambos se recalculan en cuanto cambia
    lo que está levantado. En el menú izquierdo, *Perfiles* y *Modelos* muestran
    con un número cuántos hay levantados;
  - **Liberar** un modelo de Ollama cargado por el propio Ollama (`keep_alive`), o
    un modelo de Hugging Face que tenga cargado ComfyUI (por ejemplo Qwen-Image).
    En ComfyUI se liberan todos sus modelos a la vez y se vuelven a cargar en la
    siguiente generación;
  - pulsar el botón rojo **Parar modelos** (en la barra superior, junto a *Modo
    noche*; solo aparece si hay modelos activos y su tooltip explica el efecto)
    para recuperar memoria de golpe: apaga todos los perfiles cargados,
    incluido Quick, y descarga los modelos de Ollama. Se mantienen el modelo del
    chat (y su perfil), el perfil Default y lo que usan ComfyUI, TTS y Whisper.
    Pide confirmación antes;
  - marcar la casilla **Default** para añadirlo al perfil Default, que arranca
    en cada inicio. Si Default ya está cargado, el cambio se aplica al momento.
- Descarga de Ollama por nombre exacto (`qwen3:32b`, `gpt-oss:120b`...).
- Un modelo cargado por un perfil no se puede borrar: detén antes ese perfil o
  apágalo.

Quick y Default aparecen en el mapa de memoria unificada, en la tarjeta del
equipo del panel lateral y en la app de la barra de menús como cualquier perfil
cargado. Si solo se reinicia MyDGX (un `deploy` sin `--repair`), Quick vuelve con sus
modelos. Tras reiniciar el DGX o un `deploy --repair`, Quick queda vacío. Default
vuelve a arrancar siempre.

API: `POST /api/models/quick/start`, `POST /api/models/quick/stop`,
`PUT /api/models/persistence` (Default).

Las descargas pasan a ser trabajos con progreso. Puedes cancelarlas, y MyDGX
rechaza las que no caben en memoria física. Con `HF_TOKEN` en el `.env` del
servidor se pueden descargar repositorios privados o con acceso restringido. El
token nunca llega al navegador.

## Benchmarks

Miden velocidad de prefill y decode, latencia, memoria, consumo, temperatura,
estabilidad y calidad. Opciones:

- medir un modelo concreto;
- lanzar una suite con varios candidatos;
- dejar que MyDGX mida automáticamente los modelos nuevos
  (`BENCHMARK_AUTO_NEW_MODELS`).

La suite restaura después el estado previo: perfiles, servicios y modelos de
Ollama. Los resultados se pueden exportar e importar como paquetes verificables.
Los resultados medidos alimentan las recomendaciones de *Modelos*. Metodología en
[Benchmarks](benchmarks.md).

## Perfiles

Cada tarjeta muestra modelos, motor, alias publicados, memoria estimada, estado
de descarga, plan de memoria y, si tiene, la app asociada.

- **Crear o editar**: elige motor, modelo (o un repositorio recomendado, que
  rellena GGUF, contexto y parámetros), alias, puerto, contexto y parámetros de
  muestreo.
  - Puedes añadir hasta 12 modelos adicionales: embeddings, reranking, visión,
    audio, imagen...
  - *Ajustar contexto automáticamente* reduce el contexto si no cabe en memoria,
    sin bajar del mínimo indicado.
- **Arrancar**: descarga lo que falte y carga todos los modelos del perfil. Si ya
  hay otro perfil cargado, el plan conjunto comprueba memoria, puertos y alias.
- **Detener**: para el perfil o todos, y sus apps.
- **Activar**: lo marca como predeterminado para el próximo arranque de MyDGX.
- **Default y Quick** llevan la etiqueta *Solo lectura*: se pueden arrancar o
  detener, pero no editar, activar ni borrar; se gestionan desde
  *Modelos*. No cuentan para el límite de dos perfiles cargados.

### App del perfil

Una app es un directorio con un `start.sh` que acepta `start`, `stop`, `restart`
y `status`, este último con código de salida `0` si está en marcha. MyDGX la
arranca cuando el perfil está listo y la para al detenerlo. Si dos perfiles
cargados usan la misma app, solo se para cuando se detiene el último.

Para añadir una app:

1. Copia la app al DGX como subdirectorio directo de `PROFILE_APPS_ROOT`
   (por defecto el home del usuario de MyDGX), por ejemplo `/home/nvidia/ragkit`.
2. Su `start.sh` debe pertenecer al usuario de MyDGX y no ser escribible por
   grupo ni por otros: `chmod 755 start.sh`. No se aceptan enlaces simbólicos.
3. Crea su `.env` directamente en el DGX. El despliegue nunca copia archivos
   `.env`.
4. Opcional: limita las apps permitidas con `PROFILE_APPS=ragkit,otra`.
5. En *Perfiles → Editar*, el desplegable **App del perfil** lista las apps
   válidas. Elige una y guarda.

La app recibe en su entorno `MYDGX_GATEWAY_URL` para usar los modelos del perfil
y **no** recibe los secretos de MyDGX (`HF_TOKEN`, claves API). Su salida se
guarda en `logs/apps/<nombre>.log`. La tarjeta del perfil muestra el estado de la
app y botones para consultar el estado o reiniciarla.

#### App web: alias y puerto

Si la app es web, en el editor del perfil, junto a **App del perfil**, indica:

- **Alias de la app web**: nombre del acceso directo (por defecto, el nombre del
  directorio).
- **Puerto web en 127.0.0.1**: puerto entre 1024 y 65535. Déjalo vacío para quitar
  el acceso web.

El alias y el puerto pertenecen a la app, no al perfil: si dos perfiles usan la
misma app, comparten su configuración. MyDGX rechaza puertos ya ocupados por
MyDGX, el gateway, los servicios configurados, los modelos de cualquier perfil,
los túneles por defecto de la app de la barra de menús, los rangos de Default
(20000-29999) y Quick (30000-39999) u otra app.

`start.sh` recibe además `MYDGX_APP_NAME`, `MYDGX_APP_HOST=127.0.0.1`,
`MYDGX_APP_PORT`, `MYDGX_APP_ALIAS` y `MYDGX_APP_URL`, y **debe escuchar en ese
puerto de localhost**, por ejemplo:

```bash
uvicorn app:app --host "${MYDGX_APP_HOST:-127.0.0.1}" --port "${MYDGX_APP_PORT:-8501}"
```

Si cambias el puerto con la app en marcha, reiníciala para que lo use.

Mientras la app está en marcha:

- **Resumen** muestra un botón con su alias y su puerto junto a *DGX Dashboard*,
  *Open WebUI* y *ComfyUI*. Aparece atenuado si la app aún arranca o no responde
  en su puerto.
- La tarjeta del perfil muestra **Abrir**.
- La app de la barra de menús añade **Abrir <alias> · :<puerto>** en el menú.
  Con túnel SSH, reenvía el mismo número de puerto del Mac (`127.0.0.1:<puerto>`)
  al DGX y lo mantiene abierto, así que el botón de *Resumen* también funciona
  desde el navegador del Mac. El puerto debe estar libre en el Mac.

API: `/api/profiles*`, `POST /api/profile-apps/{name}/{action}`,
`PUT /api/profile-apps/{name}/web`; las apps web activas están en
`GET /api/overview` (`web_apps`).

## Almacenamiento

- Capacidad y uso por partición.
- Distribución real por tipo de dato: modelos de Hugging Face, Ollama, ComfyUI,
  datos de MyDGX y sistema.
- Unidades NVMe con salud SMART: desgaste, temperatura y errores.

## Motores

- Estado de cada runtime: llama.cpp (con las builds disponibles), Ollama, vLLM,
  SGLang, TensorRT-LLM, ComfyUI, Whisper y SearXNG.
- **Activar o desactivar** ComfyUI, Whisper y SearXNG de forma persistente
  (`POST /api/engines/{engine_id}/action`). No se puede desactivar un motor que
  usa un perfil cargado.
- **Modo memoria**:
  - pausa temporalmente servicios opcionales (ComfyUI, Whisper, TTS, Open WebUI,
    SearXNG), descarga los modelos de Ollama y vacía la caché de páginas para
    liberar memoria;
  - opcionalmente detiene también los perfiles;
  - *Restaurar* vuelve a arrancar exactamente lo que se paró;
  - no actúa mientras hay una suite de benchmarks o un perfil arrancando.

Que un motor aparezca *activo* significa que su servicio responde. Whisper y
ComfyUI cargan sus modelos bajo demanda en la primera petición, así que pueden
estar activos sin ocupar apenas memoria.

## Laboratorio IA

Pruebas interactivas de imagen, audio (ASR y TTS), vídeo, visión, embeddings y
reranking con los modelos disponibles. Los resultados se guardan como artefactos
descargables. Las mismas capacidades se exponen a Open WebUI como servidor de
herramientas. Ver [Laboratorio IA](laboratorio-ia.md).

## Configuración

- Tema día/noche y tamaño de letra.
- **Clave de acceso MyDGX**: se guarda solo en `sessionStorage` del navegador y se
  envía como `X-MyDGX-Key`.
- Estado de las integraciones: token de Hugging Face, actualizaciones y control de
  servicios.
- **Gateway**: activación, escucha (localhost recomendado), puerto, timeout,
  tamaño máximo de petición y modelos publicados. Los cambios de host, puerto o
  activación requieren reiniciar MyDGX.

## Sistema

- Identidad del equipo (NVIDIA, ASUS, HP, Lenovo, Dell o genérico).
- *Readiness*: requisitos obligatorios, avisos con instrucciones de corrección y
  opcionales.
- Plataforma, sistema operativo y versiones instaladas: driver, CUDA, kernel y
  runtimes.
- Integridad de kernel, DKMS, paquetes NVIDIA y llama.cpp.
- Servicios administrados. Arrancar, parar o reiniciar requiere
  `ENABLE_SERVICE_CONTROL=true` y confirmación.
- Actualizaciones APT y reparación del runtime. Requieren
  `ENABLE_SYSTEM_UPDATES=true` y escribir la confirmación (`ACTUALIZAR MYDGX`,
  `REPARAR MYDGX`).

## Logs

Diagnóstico persistente, filtrable por nivel, categoría y texto, con paginación.
Los secretos y cabeceras de autorización se redactan antes de guardarse. La
auditoría (`GET /api/audit`) registra cada acción con su resultado.
