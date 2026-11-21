# Guía de uso

Recorrido por cada sección del dashboard, los conceptos que maneja y la API que
hay detrás. La referencia completa de endpoints está en [API](api.md).

## Conceptos clave

| Concepto | Qué es |
|---|---|
| **Modelo** | Pesos descargados en la caché de Hugging Face (`HF_HOME`) o en Ollama. Descargar no implica cargar en memoria. |
| **Perfil** | Receta de inferencia: uno o varios modelos con su motor (llama.cpp, Ollama, vLLM, SGLang, TensorRT-LLM, ComfyUI, Whisper...), puerto, contexto y parámetros. Puede haber **hasta dos perfiles o modelos Quick cargados** a la vez si caben en memoria. |
| **Perfil predeterminado** | Perfil que MyDGX vuelve a cargar al arrancar (`ENABLE_PROFILE_AUTOSTART`). Se fija con *Solo predeterminado*. |
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

El chat se abre como ventana flotante abajo a la derecha con el botón del
robot de la cabecera, a la izquierda de las notificaciones. Se cierra con la
X, con Escape o con el mismo botón, y conserva la conversación al reabrirlo.

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
    memoria y se puede levantar (los de Hugging Face deben ser GGUF). El contexto
    es el punto medio entre el mínimo de los agentes de código (32K en modelos de
    chat, 8K en visión) y el máximo que recomienda el autor (`--ctx-size` en la
    ficha) o, si no lo indica, el contexto nativo del GGUF. Nunca supera el nativo.
    Por ejemplo, un modelo de 262K arranca con 144K. Si la ficha usa un `-c`
    menor que ese mínimo (suele ser un ejemplo), arranca con el mínimo. En los
    GGUF que no están encendidos, un slider a la izquierda de *Encender* permite
    elegir otro contexto entre ese mínimo y el contexto nativo del GGUF; muestra
    la memoria que ocuparía y desactiva el botón si con ese contexto no cabe.
    El muestreo (`--temp`,
    `--top-p`, `--top-k`, `--min-p`, penalizaciones) y la caché KV (`-ctk`/`-ctv`)
    se toman del primer comando `llama-server` de ejemplo de la ficha; si el autor
    no indica `--repeat-penalty`, se usa 1.0. Sin comando en la ficha se usa el
    muestreo que trae el GGUF (`general.sampling.*`) y, si tampoco lo hay, los
    valores por defecto de MyDGX. Lo mismo aplica al añadir el modelo a
    *Default*. La memoria necesaria, que decide si el botón está activo, se
    calcula con ese contexto y esa caché KV a partir de la cabecera del GGUF
    (capas de atención, cabezas KV y estado SSM en modelos híbridos), más los
    pesos y el `mmproj`. Los modelos
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
    Usa los mismos parámetros que *Encender*. El contexto es el que marque el
    slider en ese momento; si no lo has movido, el mismo que usaría *Encender*.
    Para cambiar el contexto de un modelo que ya está en Default, desmárcalo,
    mueve el slider y vuelve a marcarlo;
  - **Ajustes de arranque** (icono de deslizadores en los GGUF): muestra cada
    valor con el que se encendería el modelo y su origen (ficha del autor,
    cabecera GGUF, drafter detectado o valor por defecto). Permite fijar a mano:
    - la cuantización principal y el `mmproj` («Sin visión» lo desactiva);
    - el contexto por defecto y el máximo del slider;
    - el drafter, o desactivar la especulativa, y los tokens por borrador;
    - el muestreo y la caché KV.

    Un campo vacío usa el automático y **Restablecer automático** borra todos
    los ajustes manuales. Se aplica la próxima vez que se encienda; si el modelo
    está en Default, también se actualiza allí. Los modelos con ajustes manuales
    llevan la etiqueta *Manual*.
- **Decodificación especulativa**: un drafter es un modelo pequeño que propone
  tokens y el principal los valida, así que genera más rápido con la misma
  calidad. MyDGX reconoce un drafter por:
  - su nombre o carpeta (`mtp-`, `MTP/`, `dspark-`, `dflash-`, `eagle3-`, `draft-`);
  - la arquitectura de su cabecera (`dflash`, `eagle3`…);
  - tener muchos menos tensores que el modelo principal.

  Los drafters nunca se eligen como modelo principal. MyDGX usa el drafter que
  indica la ficha (`--spec-type`, `--spec-draft-model`) si está descargado. Si
  no, prefiere DSpark, DFlash, EAGLE-3 y, por último, el MTP integrado en el
  GGUF (`nextn_predict_layers`). Los modelos con especulativa llevan su etiqueta
  (por ejemplo *DSpark* o *MTP*). Con el `mmproj` activo no se usa, porque
  llama.cpp no combina las dos cosas. Si el modelo no arranca con el drafter,
  MyDGX lo vuelve a lanzar sin él y lo anota en los logs.
- **Comprobación previa a la descarga**: antes de bajar un GGUF, MyDGX lee por
  HTTP Range la cabecera de cada archivo seleccionado, sin descargar los pesos.
  Muestra qué es cada archivo (principal, proyector o drafter), su
  arquitectura y si el llama.cpp instalado la reconoce. También indica el
  contexto nativo, la cuantización y la memoria estimada con 32K. Avisa de:
  - shards incompletos;
  - una selección sin modelo principal;
  - un drafter junto a un `mmproj`;
  - memoria insuficiente.

  Si el repositorio trae un drafter que no está seleccionado, ofrece **Añadir
  drafter y descargar**. La descarga recomendada ya lo incluye cuando el modelo
  no lleva visión.
- **Verificación tras la descarga**: al terminar una descarga de Hugging Face,
  el GGUF principal entra en la cola de **Benchmarks** automáticos. Se lanza
  con la misma configuración que *Encender* (drafter y ajustes manuales
  incluidos). Así se comprueba que arranca y responde, y la ficha del benchmark
  compara el pico de memoria real con la estimada y muestra la tasa de
  aceptación del drafter.
- Descarga de Ollama por nombre exacto (`qwen3:32b`, `gpt-oss:120b`...).
- **Importar ZIP**: para modelos GGUF que ya tienes en tu ordenador (versiones
  propias, modelos que no están en Hugging Face o equipos sin internet). La
  pestaña explica cada paso:
  1. Reúne en una carpeta el `.gguf` (todas las partes si viene en
     `-00001-of-0000N`). Opcionalmente añade el `mmproj-….gguf` para visión, un
     drafter (`mtp-`, `dspark-`, `eagle3-`…), un `README.md` y un `LICENSE`.
     Safetensors y otros archivos se ignoran.
  2. Opcional: añade un `mydgx.json` con `name`, `description`, `license`,
     `base_model`, `tags`, `task` (`chat` o `vision`) y `settings`. Los
     `settings` son los mismos campos que el editor de ajustes del modelo
     (`context_size`, `temperature`, `model_filename`, `spec_type`…). La pestaña
     ofrece una plantilla para descargar.
  3. Comprime la carpeta. Vale con Finder o con `zip -0 -r ../mi-modelo.zip .`
     (sin recomprimir el GGUF), pero sin contraseña ni enlaces simbólicos.
  4. Arrástralo a la pestaña. Con **Probar al terminar**, MyDGX arranca el
     modelo como *Encender* y le pasa un benchmark corto.

  El progreso muestra los cinco pasos: subir, comprobar, extraer, analizar y
  probar. Al final aparece un veredicto con el Score, la velocidad, el tiempo
  hasta la primera palabra, la memoria pico del equipo frente a la estimada del
  modelo y las respuestas válidas, además de
  la tabla de archivos y los avisos. El modelo queda en **Instalados** como
  `imported/<nombre>`. Si la prueba falla, sigue instalado y se puede ajustar.
  Si hay otro benchmark en marcha, la prueba se encola en **Benchmarks**.
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
  - Al escribir el repositorio de un modelo ya descargado (o el nombre en
    Ollama), o con **Parámetros del modelo**, se rellenan los mismos valores que
    usaría *Encender* para ese modelo: GGUF, `mmproj`, tarea, contexto,
    muestreo, caché KV e identificador. Cada modelo del perfil tiene los suyos;
    un modelo nuevo no copia los del principal.
  - El **puerto** es *Automático* por defecto: al guardar, MyDGX elige uno libre
    entre 18080 y 19999 que no use ningún otro perfil, app web ni servicio, y lo
    conserva mientras siga libre. Con *Manual* se usa el número indicado.
  - Puedes añadir hasta 12 modelos adicionales: embeddings, reranking, visión,
    audio, imagen...
  - *Reducir contexto automáticamente tras OOM* reduce el contexto si no cabe en memoria,
    sin bajar del mínimo indicado.
- **Arrancar**: descarga lo que falte y carga todos los modelos del perfil. Si ya
  hay otro perfil cargado, el plan conjunto comprueba memoria, puertos y alias.
- **Detener**: para el perfil o todos, y sus apps.
- **Solo predeterminado**: lo marca como predeterminado para el próximo arranque de MyDGX, sin arrancarlo.
- **Default y Quick** llevan la etiqueta *Solo lectura*: se pueden arrancar o
  detener, pero no editar, activar ni borrar; se gestionan desde
  *Modelos*. Default no cuenta para el límite de dos cargados; cada modelo de
  chat o visión encendido en Quick ocupa una de esas dos plazas.

### Recetas

Una receta es un perfil medido en un DGX Spark y publicado en GitHub, en
`config/recipes.json`. En la página se muestra con un badge azul *RECIPE*.

- **Buscar recetas** está en dos sitios: como pestaña en *Modelos*, junto a
  *Explorar Hugging Face*, y como botón junto a *Nuevo perfil*. Ambos leen el
  catálogo actual de GitHub, y *Actualizar desde GitHub* lo vuelve a leer en
  el momento.
  Si no hay conexión, muestran la copia incluida en tu versión de MyDGX.
- Cada receta tiene categorías con los mismos badges que los modelos: Texto,
  Código, Visión, Embeddings, Imagen, Vídeo y Voz / audio. Los badges de
  arriba filtran la lista por categoría. Las tarjetas de *Perfiles* muestran
  también las categorías de los modelos que contienen.
- Cada receta muestra su descripción, sus modelos (cuantización, contexto,
  KV, MTP y si es uncensored) y la memoria medida con todo cargado.
- *Ver detalles* enseña la receta completa en JSON y *Descargar JSON* la
  guarda en tu equipo.
- *Instalar* añade la receta tal cual, con su nombre, y puede poner en cola la
  descarga de los modelos que falten, drafters MTP incluidos. Cada receta se
  instala una sola vez.
- En la pestaña de *Modelos*, *Instalar con modelos* instala la receta y pone
  en cola todos sus modelos de una vez. Si a una receta instalada le faltan
  modelos, la tarjeta lo indica y ofrece *Descargar N modelo(s)*.
- *Duplicar como perfil* crea un perfil normal con el nombre que elijas, que
  puedes editar a tu gusto.

Una receta instalada es de solo lectura: puedes encenderla, apagarla, marcarla
como favorita o predeterminada y borrarla, pero no editarla ni añadirle
modelos. Para cambiarla, usa *Duplicar* y edita la copia. Los nombres que
empiezan por `RECIPE` quedan reservados para las recetas.

Cada receta tiene un número de versión (`v1`, `v2`…) y una nota de cambios.
Si publicamos una versión nueva, la tarjeta del perfil y *Buscar recetas*
ofrecen *Actualizar a vN*. La actualización conserva el favorito y el
predeterminado, no vuelve a descargar los modelos que ya tienes y exige apagar
antes el perfil. Si se publica una versión anterior para retirar una con
errores, *Buscar recetas* permite volver a ella. Al arrancar, MyDGX actualiza
las recetas que no estén cargadas cuando la copia local trae una versión más
nueva.

Las instalaciones nuevas reciben las recetas de la copia local al arrancar.
La URL del catálogo se cambia con `MYDGX_RECIPES_URL` y solo se acepta
`raw.githubusercontent.com`.

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

Para arrancar, detener o reiniciar una app a mano, con o sin perfil cargado, ve a
**Motores → Apps de perfil**. Cada botón ejecuta `start.sh start`, `stop` o
`restart`, y el estado sale de `start.sh status`. Detener pide confirmación.

API: `/api/profiles*`, `GET /api/profile-apps`, `POST /api/profile-apps/{name}/{action}`,
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

Esa carga bajo demanda no pasa por el control de memoria de los perfiles: un
workflow de ComfyUI puede agotar la memoria aunque cada modelo cupiera al
cargarse. MyDGX vigila la presión de memoria del kernel
(`/proc/pressure/memory`). Si durante 30 s el sistema pasa al menos el 40 % del
tiempo esperando memoria, crea la notificación *Memoria saturada* con los
procesos que más ocupan y un botón **Parar modelos**. El aviso se repite como
mucho cada 15 minutos. En ese estado MyDGX Tray muestra *Spark saturado
(memoria)* en lugar de *No conectado*, porque el equipo sigue respondiendo por
SSH.

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
  tamaño máximo de petición, búsqueda web (SearXNG, activada por defecto) y
  modelos publicados. La búsqueda se aplica al guardar. Los cambios de host,
  puerto o activación requieren reiniciar MyDGX.

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
- Firmware: lo pendiente en fwupd (EC, UEFI, SSD…) y el estado de la ConnectX-7.
  MyDGX lo revisa cada 6 horas y avisa en Notificaciones cuando aparece una
  versión nueva. Instalar exige `ENABLE_FIRMWARE_UPDATES=true`, confirmación y
  que no haya trabajos en curso; MyDGX no reinicia el equipo por su cuenta. La
  ConnectX-7 la actualiza el servicio de NVIDIA al arrancar, solo con un cable
  QSFP conectado. El estado OTA de NVIDIA se consulta en DGX Dashboard.

## Logs

Diagnóstico persistente, filtrable por nivel, categoría y texto, con paginación.
Los secretos y cabeceras de autorización se redactan antes de guardarse. La
auditoría (`GET /api/audit`) registra cada acción con su resultado.
