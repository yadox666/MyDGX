# MyDGX

<p align="center">
  <img src="frontend/public/apple-touch-icon.png" width="92" alt="MyDGX">
</p>

<h3 align="center">Tu supercomputador personal, bajo control.</h3>

<p align="center">
  Panel local y open source para monitorizar, configurar y operar equipos NVIDIA GB10:
  DGX Spark, ASUS Ascent GX10, HP ZGX Nano G1n, Lenovo ThinkStation PGX y Dell Pro Max GB10.
</p>

<p align="center">
  <strong>Modelos</strong> · <strong>Perfiles multimodelo</strong> ·
  <strong>Telemetría histórica</strong> · <strong>Gateway OpenAI</strong> ·
  <strong>Actualizaciones seguras</strong>
</p>

> **¿Primera instalación?** Sigue el
> **[Quickstart para desplegar un Spark con MyDGXTray](docs/quickstart.md)**.
> Explica paso a paso la descarga desde GitHub, detección del equipo, acceso SSH,
> primer despliegue y conexión local o remota.

![Resumen de MyDGX en NVIDIA DGX Spark](docs/screenshots/summary-nvidia.png)

## ¿Qué es MyDGX?

MyDGX reúne en una sola interfaz las tareas habituales de un equipo de IA local:

- monitorización de GPU, CPU, memoria unificada, temperatura, potencia, red y disco;
- histórico persistente en SQLite con navegación de 1 hora a 7 días;
- inventario, búsqueda, descarga, inspección y eliminación de modelos;
- hasta dos perfiles simultáneos, cada uno con varios modelos, motores y puertos;
- deduplicación de modelos compartidos y preflight conjunto de memoria, alias y puertos;
- cálculo preventivo de memoria para pesos, contexto, caché KV y reserva del sistema;
- perfiles predeterminados con arranque automático y recuperación ante errores de memoria;
- apps propias que arrancan y se paran con el perfil (por ejemplo un RAG que usa sus modelos);
- encendido inmediato de un modelo desde *Modelos* (perfil Quick: sobrevive a un deploy, no a un reinicio del equipo) y perfil Default con los modelos que deben arrancar siempre;
- modo memoria para pausar servicios opcionales y restaurarlos después;
- benchmarks reproducibles con cola automática para modelos nuevos;
- chat local, Open WebUI y laboratorio multimodal;
- asistente MyDGX local con documentación, telemetría en vivo y acciones confirmadas;
- catálogo OpenAI compatible para todos los modelos del perfil activo;
- comprobación de DGX OS, CUDA, kernel, drivers, llama.cpp, paquetes y servicios;
- actualizaciones controladas con verificación posterior de integridad;
- logs técnicos, trabajos y auditoría persistentes;
- modos día y noche, diseño responsive e identidad automática del fabricante.

Todo funciona de forma local. Los tokens y claves se leen desde `.env`; no se
guardan en SQLite ni se devuelven al navegador.

## Equipos compatibles

MyDGX detecta el fabricante mediante DMI, device-tree, DGX OS y la GPU. Cuando la
identificación es inequívoca adapta el resumen, la fotografía y la marca.

<table>
  <tr>
    <td width="50%"><strong>NVIDIA DGX Spark</strong><br><img src="docs/screenshots/summary-nvidia.png" alt="NVIDIA DGX Spark"></td>
    <td width="50%"><strong>ASUS Ascent GX10</strong><br><img src="docs/screenshots/summary-asus.png" alt="ASUS Ascent GX10"></td>
  </tr>
  <tr>
    <td width="50%"><strong>HP ZGX Nano G1n</strong><br><img src="docs/screenshots/summary-hp.png" alt="HP ZGX Nano G1n"></td>
    <td width="50%"><strong>Lenovo ThinkStation PGX</strong><br><img src="docs/screenshots/summary-lenovo.png" alt="Lenovo ThinkStation PGX"></td>
  </tr>
</table>

También funciona en Ubuntu y otros entornos de desarrollo. Las funciones
dependientes de NVIDIA, systemd, APT, NVMe o SMART se muestran como no disponibles
cuando el sistema no las ofrece.

## Recorrido por la aplicación

### Perfiles multimodelo

Un perfil describe un grupo operativo completo: modelos, alias, motores, puertos,
contextos, slots, cuantización, parámetros de sampling, caché KV, modalidades y
límites de memoria.

![Perfiles multimodelo](docs/screenshots/profiles.png)

Antes de arrancar, MyDGX:

1. comprueba que los puertos no se repitan;
2. estima pesos, contexto, caché y reserva para el sistema;
3. descarga y verifica los modelos ausentes;
4. arranca los modelos en orden y valida su endpoint de salud;
5. reduce el contexto y reintenta cuando detecta saturación de memoria;
6. revierte el grupo completo si no puede dejarlo en un estado consistente.

El perfil activado se convierte en el predeterminado para el próximo arranque.

### Sistema y servicios

La página Sistema diferencia claramente DGX OS, Ubuntu, Debian y otros sistemas,
y muestra comprobaciones con estados correcto, aviso u opcional.

![Comprobación del sistema](docs/screenshots/system.png)

Incluye versiones de kernel, driver NVIDIA, CUDA, llama.cpp, Ollama, Docker,
Python y paquetes relevantes. Tras una actualización comprueba APT, DKMS,
NVIDIA Container Toolkit y la necesidad de recompilar llama.cpp.

### Motores de inferencia

![Motores de inferencia](docs/screenshots/engines.png)

MyDGX instala llama.cpp, Ollama y un servicio Whisper OpenAI-compatible
acelerado con CUDA sobre la imagen oficial NVIDIA PyTorch para GB10. También
descubre vLLM, SGLang, TensorRT-LLM, LM Studio, ComfyUI, NVIDIA Riva y NVIDIA
NIM; esos motores externos se registran por endpoint sin mezclar necesariamente
sus stacks CUDA o Python.

ComfyUI, Whisper y SearXNG pueden activarse o desactivarse de forma persistente
desde *Motores*. El **modo memoria** pausa temporalmente los servicios opcionales
(ComfyUI, Whisper, TTS, Open WebUI y SearXNG), descarga los modelos de Ollama y
vacía la caché de páginas para hacer sitio a un modelo grande. *Restaurar* vuelve
a arrancar exactamente lo que se paró. El **mapa de memoria unificada** muestra en
vivo qué ocupa los 128 GB. Detalle en la [Guía de uso](docs/guia-de-uso.md#motores).

### Recomendaciones para DGX Spark

La búsqueda de Hugging Face calcula el ranking con la memoria libre real y el
presupuesto reservado para el sistema. Además de formato, cuantización, contexto,
licencia y popularidad, favorece arquitecturas MoE con pocos parámetros activos y
modelos que declaran MTP, DFlash o DSpark para decodificación especulativa. La
estimación incluye la caché KV, los slots concurrentes y 1,5 GiB de reserva cuando
se detecta una técnica especulativa.

La popularidad se muestra como **Score comunidad HF (0–100)**, calculado con
descargas, likes y tendencia publicados por Hugging Face. Aporta hasta 12 puntos
al ranking MyDGX, pero no sustituye compatibilidad, memoria ni benchmarks técnicos.

El rendimiento en tokens/s es una **estimación comparativa**, basada en los pesos
activos y el ancho de banda, no un benchmark garantizado. Puede variar por runtime,
prompt, contexto y batching. `SPARK_CLUSTER_SIZE` permite describir entre uno y
cuatro Sparks enlazados; valores mayores que uno solo son válidos si ConnectX-7 y
tensor parallel están realmente configurados. El ancho de banda base se ajusta con
`SPARK_MEMORY_BANDWIDTH_GBPS` (273 GB/s por defecto).

<details>
<summary><strong>Ver la galería completa</strong></summary>

#### Modelos

![Inventario y descarga de modelos](docs/screenshots/models.png)

#### Chat local

![Chat local](docs/screenshots/chat.png)

#### Laboratorio multimodal

![Laboratorio multimodal](docs/screenshots/laboratory.png)

#### Almacenamiento

![Almacenamiento, NVMe y SMART](docs/screenshots/storage.png)

#### Logs persistentes

![Logs persistentes](docs/screenshots/logs.png)

#### Configuración

![Configuración y gateway](docs/screenshots/settings.png)

</details>

## Perfiles

Un **perfil** es la configuración editable de uno o varios modelos: cómo se
descargan, cuánto contexto usan y en qué motores y puertos se ejecutan. Se
arranca y se detiene desde *Perfiles* o la app de la barra de menús. Además
existen dos perfiles de solo lectura que se gestionan desde *Modelos*:
**Default** (arranca siempre) y **Quick** (encendido inmediato de un modelo).

### App del perfil

Un perfil puede tener una **app** asociada: un directorio del home del usuario
del servicio (por ejemplo `/home/nvidia/ragkit`) con su propio `start.sh` que
acepta `start`, `stop`, `restart` y `status` (código 0 si está en marcha).

- Al cargar el perfil, cuando la inferencia ya responde, MyDGX ejecuta
  `start.sh status` y, si no está en marcha, `start.sh start` en segundo plano.
- Al detener el perfil, MyDGX ejecuta `start.sh stop` antes de bajar los modelos,
  salvo que otro perfil cargado use la misma app.
- La app usa su propio `.env`. MyDGX no le pasa sus secretos: solo `PATH`,
  `HOME`, el idioma y `MYDGX_GATEWAY_URL` (`http://127.0.0.1:<puerto>/v1`).
- La salida queda en `logs/apps/<app>.log`. Solo se aceptan directorios propios,
  sin enlaces simbólicos y con un `start.sh` no escribible por otros usuarios;
  `PROFILE_APPS` restringe la lista y `PROFILE_APPS_ROOT` cambia el directorio.

## Gateway OpenAI compatible

Cada perfil activo actúa como un catálogo independiente. Sus modelos y alias se
publican por un único puerto, de forma parecida a OpenAI u OpenRouter:

```text
http://127.0.0.1:4000/v1
```

Endpoints principales:

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/embeddings`
- `POST /v1/images/generations`
- `POST /v1/audio/transcriptions`
- `POST /v1/audio/speech`
- `POST /v1/videos`
- `POST /v1/rerank`

Ejemplo:

```bash
curl http://127.0.0.1:4000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"MODEL_ALIAS","messages":[{"role":"user","content":"Hola"}]}'
```

Si el gateway escucha fuera de localhost, configura `GATEWAY_API_KEY` y envía
`Authorization: Bearer YOUR_GATEWAY_API_KEY`.

## Inicio rápido

### Requisitos

- DGX OS o Ubuntu compatible;
- Python 3.10 o posterior;
- Node.js 20 o posterior;
- npm.

### Instalación local

```bash
cp .env.example .env
./start.sh setup
./start.sh start
```

Abre [http://127.0.0.1:8088](http://127.0.0.1:8088).

Comandos:

```bash
./start.sh start
./start.sh stop
./start.sh restart
./start.sh status
./start.sh logs
./start.sh test
./start.sh build
./start.sh dev
./start.sh install-opencode
./start.sh opencode
./start.sh install-claude-code
./start.sh claude
```

`start.sh` es idempotente: puede ejecutarse de nuevo sin borrar la base de datos,
los perfiles ni los modelos descargados.

### OpenCode

MyDGX puede instalar OpenCode y configurarlo contra el gateway del perfil
cargado. El workspace y los archivos generados se guardan fuera del repositorio,
en `~/opencode`:

```bash
./start.sh install-opencode
./start.sh install-opencode mi-proyecto
cd ~/opencode
/ruta/a/MyDGX-Dashboard/start.sh opencode
/ruta/a/MyDGX-Dashboard/start.sh opencode --active
/ruta/a/MyDGX-Dashboard/start.sh opencode MODEL_ALIAS
```

OpenCode y Claude Code necesitan un modelo cargado con al menos 32 768 tokens de
contexto: su prompt de sistema y sus herramientas ocupan unos 16 000 antes del
primer mensaje. Los modelos con menos contexto no aparecen en el selector, y si
pides uno, el script se niega a arrancar y explica cómo subir el contexto del
perfil. El mínimo se puede cambiar con `MYDGX_AGENT_MIN_CONTEXT`.

El modo predeterminado es `plan` y solo lectura. `--active` permite edición,
solicita confirmación para bash y activa los MCP de Playwright, Shodan y NVD.
La búsqueda web está activada por defecto en los dos modos: OpenCode consulta
SearXNG local a través de `POST /v1/search`. Se apaga en Configuración → Gateway
y OpenCode deja de ofrecer la herramienta la próxima vez que se abre. `webfetch`
y el `websearch` nativo siguen desactivados.
La configuración incluye automáticamente todos los modelos de chat o visión
publicados por el gateway; puedes seleccionar cualquiera por su alias. Sin
alias, se elige un modelo del perfil con tool calling, de chat y con más
contexto. Cada modelo hereda del gateway su contexto, tool calling, razonamiento
y entrada de imagen; el límite de salida es una octava parte del contexto (entre
4096 y 32000 tokens, ajustable con `MYDGX_OPENCODE_MAX_OUTPUT_TOKENS`). Las
reglas de MyDGX se añaden como `instructions` sin sustituir el prompt base de
OpenCode, y ambos modos bloquean la lectura de `.env`, `*.pem` y `*.key`.
La instalación añade en `~/opencode/.opencode/skills/` los workflows
`authorized-pentest` y `blackbox-wordpress`, adaptados del laboratorio
BugHunter. Los skills respetan el alcance documentado y no habilitan acciones
invasivas sin autorización.
Las claves opcionales se inyectan únicamente mediante `MYDGX_GATEWAY_API_KEY`,
`SHODAN_API_KEY` y `NVD_API_KEY`; no se escriben en la configuración.

### Claude Code

Claude Code se conecta al endpoint Anthropic Messages del gateway (`/v1/messages`)
con la misma detección automática que OpenCode: gateway local, túnel del Tray o
`MYDGX_GATEWAY_URL`. El workspace se guarda en `~/claude-code`:

```bash
./start.sh install-claude-code
cd ~/claude-code
/ruta/a/MyDGX-Dashboard/start.sh claude
/ruta/a/MyDGX-Dashboard/start.sh claude --active
/ruta/a/MyDGX-Dashboard/start.sh claude MODEL_ALIAS
/ruta/a/MyDGX-Dashboard/start.sh claude -- -p "Resume este repositorio"
```

Cada ejecución descubre los modelos de chat o visión del gateway y genera
`~/claude-code/.claude/mydgx-settings.json`, que se pasa con `--settings`. Todos
los niveles de modelo de Claude Code (Fable, Opus, Sonnet, Haiku y subagentes)
apuntan al alias seleccionado, la compactación usa el contexto real del modelo y
se desactivan telemetría, autoactualización, la memoria automática (que
guardaría notas del proyecto en `~/.claude`) y la cabecera de atribución que
invalida la caché KV de los motores locales. `~/.claude` no se modifica. La
cabecera del lanzador va a stderr, así que `-p --output-format json` produce
JSON limpio para scripts y CI.

Los modos equivalen a los de OpenCode: `plan` y solo lectura por defecto;
`--active` acepta ediciones, pide confirmación para bash y carga únicamente los
MCP Playwright, NVD y, si existe `SHODAN_API_KEY`, Shodan (`--strict-mcp-config`).
La búsqueda web está activada por defecto en los dos modos, con el mismo MCP
`searxng` que OpenCode y la misma casilla de Configuración → Gateway. `WebSearch`
y `WebFetch` nativos siguen bloqueados. Ambos modos bloquean subagentes y la
lectura de `.env` y claves privadas. Los skills se copian en
`~/claude-code/.claude/skills/` y las instrucciones en `~/claude-code/CLAUDE.md`.
La clave del gateway se entrega solo mediante `MYDGX_GATEWAY_API_KEY` y
`ANTHROPIC_API_KEY` se elimina del entorno de la sesión.

## Prueba de aceptación del DGX Spark

`./start.sh test` integra una prueba de hardware y salud por SSH. La primera
ejecución crea un archivo local con permisos `0600`:

> Si estás evaluando una unidad nueva o usada antes de pagar, sigue la guía
> **[Cómo comprobar un DGX Spark antes de comprarlo](docs/comprobar-spark.md)**.

```text
config/dgx-health-check/dgx-spark.env
```

También puedes ejecutarla directamente sin preparar la configuración:

```bash
./start.sh test root@192.168.1.100
./start.sh test root@192.168.1.100 -p22
./start.sh test root@192.168.1.100 -p 2222
```

El puerto es opcional y por defecto es `22`. En este formato OpenSSH prueba
primero las claves disponibles; si ninguna autentica, solicita la contraseña
directamente en la terminal. MyDGX nunca recibe ni almacena esa contraseña.

En la red local, puedes crear o actualizar la configuración inicial mediante
Bonjour/mDNS. Solo selecciona servicios SSH cuyo nombre identifica un
DGX, Spark o NVIDIA y reutiliza una clave local únicamente si autentica:

```bash
./start.sh --autodiscover --config
# Equivalente:
./start.sh test --autodiscover
```

Edita al menos `DGX_HOST`, revisa el usuario y selecciona el SSD adquirido:

```dotenv
DGX_HOST=spark-xxxx.local
DGX_USER=nvidia
DGX_PORT=22
DGX_EXPECT_DISK_TB=1
DGX_IDENTITY=~/.ssh/id_ed25519
DGX_ACCEPT_NEW=0
DGX_STRICT=0
```

Después ejecuta:

```bash
./start.sh test
./start.sh test --strict
./start.sh test --interactive --accept-new
./start.sh test --expect-fingerprint SHA256:HUELLA_VERIFICADA
./start.sh test --help
```

Las opciones de línea de comandos prevalecen sobre las variables de entorno y
el archivo de configuración. También puedes usar un archivo alternativo:

```bash
./start.sh test --config /ruta/segura/dgx-spark.env
```

La prueba verifica DGX OS, `aarch64`, GB10, memoria unificada, almacenamiento,
NVMe SMART, temperaturas, errores NVIDIA Xid y ejercicios breves de memoria,
disco y CUDA. Crea y elimina un archivo remoto temporal de 256 MiB; no escribe
en dispositivos de bloques.

No acepta contraseñas como argumentos, variables o configuración. Para la
primera conexión compara la huella SSH con la consola del Spark antes de usar
`--accept-new`.

Una clave antigua se reemplaza automáticamente sin ejecutar `ssh-keygen -R`
cuando `DGX_ACCEPT_NEW=1`. Se muestra un aviso y la operación afecta únicamente
a la entrada exacta de host y puerto, algo útil con equipos alquilados que
reutilizan direcciones. `DGX_EXPECT_FINGERPRINT` es un bloqueo estricto opcional
para equipos permanentes.

## Despliegue en DGX OS o Ubuntu

```bash
./start.sh deploy
```

Para instalar opcionalmente un actualizador horario de DuckDNS, define
`DUCKDNS_DOMAIN` y `DUCKDNS_TOKEN` únicamente en el `.env` del DGX y ejecuta:

```bash
./start.sh deploy --duckdns --repair --interactive
```

El token no se copia desde el Mac ni se imprime. Tras la primera instalación,
los despliegues normales conservan y actualizan el servicio.

Para publicar únicamente cambios de la interfaz, sin instalar paquetes ni
reiniciar servicios:

```bash
./start.sh deploy --frontend
```

Este modo compila React localmente, transfiere solo `frontend/dist`, activa la
nueva versión de forma atómica y conserva la anterior como respaldo. Si no se
indica `USUARIO@HOST`, utiliza primero la conexión activa de MyDGXTray.

El despliegue:

- instala las dependencias del panel y herramientas de diagnóstico;
- habilita, arranca y verifica automáticamente el gateway MyDGX;
- prepara CUDA y compila llama.cpp para GB10/sm_121 cuando corresponde;
- detecta cambios de kernel, driver, CUDA o revisión de llama.cpp;
- conserva la instalación anterior hasta completar las verificaciones;
- instala `mydgx.service`, `mydgx-gateway.service` y el reparador del sistema;
- habilita el panel para arrancar automáticamente con Linux;
- puede preparar Ollama, Docker, NVIDIA Container Toolkit, Open WebUI, Whisper
  como servicio GPU local, SearXNG como buscador privado y ComfyUI para imagen
  y vídeo;
- nunca copia `.env`, tokens ni claves privadas desde otra máquina;
- termina listando las apps de perfil instaladas en `PROFILE_APPS_ROOT` (por
  defecto el home del usuario SSH del DGX), el perfil que usa cada una y las
  carpetas con `start.sh` que se ignoran por no cumplir las reglas de seguridad.

Whisper se instala por defecto con el modelo `turbo` sobre
`nvcr.io/nvidia/pytorch:25.09-py3`. Puede ajustarse antes del despliegue con
`MYDGX_WHISPER_MODEL`, `MYDGX_WHISPER_BASE_IMAGE` o desactivarse explícitamente
con `MYDGX_INSTALL_WHISPER=0`.

SearXNG se instala por defecto con Open WebUI, solo escucha en
`127.0.0.1:8888` y no necesita claves externas. Puede desactivarse con
`MYDGX_INSTALL_SEARXNG=0` o fijar una imagen mediante
`MYDGX_SEARXNG_IMAGE=searxng/searxng@sha256:DIGEST`. El deployment usa el contenedor
cuando Docker está operativo y cambia automáticamente a una instalación nativa
aislada cuando el proveedor no permite ejecutar el daemon.

ComfyUI se instala con PyTorch CUDA 13 y ajustes seguros para la memoria
unificada del GB10. El deployment descarga FLUX.1 Schnell FP8 y Wan 2.1 T2V
1.3B desde los repositorios oficiales de Comfy-Org, valida sus SHA-256 y conecta
automáticamente imagen y herramientas multimedia en Open WebUI. Puede omitirse
con `MYDGX_INSTALL_COMFYUI=0`, descargar el runtime sin modelos mediante
`MYDGX_INSTALL_COMFYUI_MODELS=0` o fijar la revisión con `MYDGX_COMFYUI_REF`.

Todo lo que se descarga queda fijado: la imagen de SearXNG por digest, ComfyUI y
llama.cpp por commit, Open WebUI y Ollama por versión, el instalador de Ollama y
el archivo de Hashcat por SHA-256 y el repositorio de NodeSource por la huella de
su clave. Si un proveedor cambia algo, el deployment se detiene en lugar de
ejecutar código no revisado; para actualizar, revisa la novedad y cambia el valor
fijado (`MYDGX_SEARXNG_IMAGE`, `MYDGX_COMFYUI_REF`, `MYDGX_LLAMA_CPP_REF` con un
commit completo, `MYDGX_OPENWEBUI_VERSION`, `MYDGX_HASHCAT_SHA256` o las
constantes del inicio del script remoto de `deploy.sh`).

En Linux sin systemd se utiliza el supervisor local de `start.sh`.

## Configuración

Copia `.env.example` a `.env` y modifica únicamente el archivo local:

```dotenv
HOST=127.0.0.1
PORT=8088
DATABASE_PATH=./data/mydgx.db
METRICS_RETENTION_HOURS=168

ASSISTANT_ENABLED=true
ASSISTANT_MODEL=llama3.2:3b
ASSISTANT_FALLBACK_TO_AVAILABLE=true

HF_TOKEN=YOUR_HUGGING_FACE_TOKEN
MYDGX_API_KEY=YOUR_DASHBOARD_API_KEY
GATEWAY_API_KEY=YOUR_GATEWAY_API_KEY
```

Variables destacadas:

- `HF_HOME`: caché de Hugging Face;
- `OLLAMA_URL`, `OPENWEBUI_URL`, `DGX_DASHBOARD_URL`: servicios locales;
- `ASSISTANT_ENABLED`, `ASSISTANT_MODEL`: asistente operativo local y su modelo preferido;
- `ASSISTANT_FALLBACK_TO_AVAILABLE`: permite usar otro modelo local si el preferido no responde;
- `LLAMA_CPP_SERVER_PATH`: ejecutable de llama-server;
- `ENABLE_PROFILE_AUTOSTART`: arranque del perfil predeterminado;
- `GATEWAY_HOST`, `GATEWAY_PORT`: endpoint OpenAI del perfil activo;
- `METRICS_INTERVAL_SECONDS`, `METRICS_RETENTION_HOURS`: histórico;
- `ENABLE_SYSTEM_UPDATES`, `ENABLE_SERVICE_CONTROL`: operaciones privilegiadas;
- `DEVICE_VARIANT_OVERRIDE`: `nvidia`, `asus`, `hp`, `lenovo`, `dell` o `generic` cuando
  la detección automática del chasis no sea suficiente;
- `TRUSTED_HOSTS`: nombres extra aceptados en `Host` si accedes por un nombre DNS
  propio;
- `PROFILE_APPS_ROOT`, `PROFILE_APPS`: dónde se buscan las apps de perfil y lista
  blanca opcional.

Las opciones peligrosas están desactivadas por defecto. La lista completa de
variables, con valores por defecto, está en [Configuración](docs/configuracion.md).

## Persistencia

SQLite conserva:

- telemetría general y por modelo;
- perfiles, favoritos y perfil predeterminado;
- trabajos, progreso y eventos;
- logs estructurados y auditoría;
- preferencias no secretas.

Los modelos permanecen en las cachés estándar de Hugging Face y Ollama. Los
tokens, contraseñas, cookies y claves API nunca se almacenan en la base de datos.

## Seguridad

- MyDGX escucha únicamente en `127.0.0.1` por defecto.
- Para acceso remoto se recomienda un túnel SSH o un proxy HTTPS autenticado.
- El navegador no puede enviar comandos arbitrarios al sistema.
- Las acciones privilegiadas usan una lista cerrada de servicios y comandos.
- El despliegue no concede `NOPASSWD: ALL`.
- Cabeceras de autorización, cookies, cuerpos de petición y secretos no se
  escriben en los logs.
- Los campos sensibles se redactan antes de persistir eventos.
- Dashboard y gateway rechazan peticiones de navegador de otras webs (`Origin`,
  `Sec-Fetch-Site`) y cabeceras `Host` no reconocidas (DNS rebinding).
- El despliegue verifica la clave SSH del DGX, los instaladores por checksum o
  firma, fija versiones de imágenes y repositorios, y nunca copia archivos `.env`.
- Las apps de perfil se ejecutan sin los secretos de MyDGX y solo si su
  `start.sh` es del usuario de MyDGX y no lo puede modificar nadie más.

No confirmes `.env`, bases de datos, cachés de modelos ni claves privadas en Git.
Modelo completo en [Seguridad](docs/seguridad.md).

## Documentación adicional

- **[Quickstart: desde GitHub hasta el primer despliegue](docs/quickstart.md)**
- **[Cómo comprobar un DGX Spark antes de comprarlo](docs/comprobar-spark.md)**
- [Guía de uso por secciones](docs/guia-de-uso.md)
- [Configuración: variables, secretos y servicios opcionales](docs/configuracion.md)
- [Referencia completa de la API](docs/api.md)
- [Seguridad y modelo de amenazas](docs/seguridad.md)
- [Asistente MyDGX y su API](docs/asistente-mydgx.md)
- [Benchmarks reproducibles y API](docs/benchmarks.md)
- [Clientes del Gateway OpenAI](docs/gateway-clientes.md)
- [Laboratorio IA multimodal](docs/laboratorio-ia.md)
- [Conversión segura a modo servidor](docs/modo-servidor.md)
- [MyDGXTray para macOS](macos/MyDGXTray/README.md)
- [Campos configurables de MyDGXTray](macos/MyDGXTray/PREFERENCIAS.md)

## Estado del proyecto

MyDGX está en desarrollo activo. La interfaz puede probarse en macOS, pero las
operaciones GPU, DGX OS y systemd deben validarse en hardware GB10 real antes de
usarse en producción.

Las capturas de esta página se generaron con la vista de identidad de cada
fabricante en un entorno de desarrollo; los servicios no disponibles aparecen
como tales de forma intencionada.

## Marcas e imágenes

NVIDIA, DGX, ASUS, HP, Lenovo, Dell y sus logotipos son marcas de sus respectivos
titulares. Las imágenes de producto proceden de páginas oficiales de producto o
prensa y se utilizan únicamente para identificar el equipo administrado.

## Licencia

El código de MyDGX se distribuye bajo la [licencia MIT](LICENSE). Las marcas,
modelos y recursos gráficos de terceros conservan los derechos de sus
respectivos titulares.

