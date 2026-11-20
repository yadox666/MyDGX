# MyDGX

<p align="right"><a href="README.md">English version</a></p>

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

![Resumen de MyDGX en NVIDIA DGX Spark](docs/screenshots/resumen-darkmode.png)

## ¿Qué es MyDGX?

MyDGX reúne en una sola interfaz las tareas habituales de un equipo de IA local:

- monitorización de GPU, CPU, memoria unificada, temperatura, potencia, red y disco;
- histórico persistente en SQLite con navegación de 1 hora a 7 días;
- inventario, inspección y eliminación de modelos;
- búsqueda en Hugging Face con recomendador para el Spark y comprobación previa
  de las cabeceras GGUF antes de descargar;
- descarga por nombre con Ollama e importación de GGUF propios desde un ZIP, con
  prueba automática al terminar;
- hasta dos perfiles simultáneos, cada uno con varios modelos, motores y puertos;
- deduplicación de modelos compartidos y preflight conjunto de memoria, alias y puertos;
- cálculo preventivo de memoria para pesos, contexto, caché KV y reserva del sistema;
- perfiles predeterminados con arranque automático y recuperación ante errores de memoria;
- apps propias que arrancan y se paran con el perfil (por ejemplo un RAG que usa sus modelos);
- encendido inmediato de un modelo desde *Modelos* (perfil Quick: sobrevive a un deploy, no a un reinicio del equipo) y perfil Default con los modelos que deben arrancar siempre;
- modo memoria para pausar servicios opcionales y restaurarlos después;
- benchmarks reproducibles con cola automática para modelos nuevos y un
  [ranking de modelos probados en el Spark](docs/es/modelos-probados.md);
- chat local, Open WebUI y laboratorio multimodal;
- asistente MyDGX local con documentación, telemetría en vivo y acciones confirmadas;
- catálogo OpenAI compatible para todos los modelos del perfil activo;
- comprobación de DGX OS, CUDA, kernel, drivers, llama.cpp, paquetes y servicios;
- actualizaciones controladas con verificación posterior de integridad;
- logs técnicos, trabajos y auditoría persistentes;
- modos día y noche, diseño responsive e identidad automática del fabricante;
- prueba de aceptación por SSH para [comprobar un DGX Spark antes de comprarlo](docs/es/comprobar-spark.md),
  nuevo o de segunda mano.

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

## Instalación rápida desde macOS (recomendada)

Si tienes un Mac, no necesitas Terminal, Git, Python ni Node.js. **MyDGXTray**, la
app de la barra de menús, trae MyDGX dentro y un asistente lo instala en el
Spark por SSH. El Spark compila e instala todo lo demás.

**Necesitas:**
- macOS 13 o posterior (Apple Silicon o Intel);
- un DGX Spark (o un equipo GB10 compatible) con el primer arranque ya hecho;
- el usuario y la contraseña de ese primer arranque, con permiso `sudo`;
- los dos equipos en la misma red, o acceso SSH remoto, e Internet durante la
  instalación.

**Pasos:**

1. Descarga `MyDGXTray-<versión>-macos-universal.zip` desde
   [Releases](https://github.com/yadox666/MyDGX/releases), descomprímelo y
   arrastra **MyDGXTray** a `Aplicaciones`.
2. Ábrela. Si macOS la bloquea, ve a **Ajustes del Sistema › Privacidad y
   seguridad** y pulsa **Abrir igualmente**. El **Asistente de instalación
   Spark** se abre solo.
3. **Buscar:** pulsa **Buscar mi Spark** y acepta el permiso de **Red local**.
   Elige el equipo o escribe su IP o nombre, por ejemplo `spark-1a2b.local`.
4. **Conectar:** escribe el usuario y la contraseña del Spark. El asistente
   guarda su huella SSH, crea una clave solo para este Mac y la autoriza. La
   contraseña se usa una vez y no se guarda.
5. **Instalar:** pulsa **Instalar MyDGX**. La primera vez tarda entre 20 y 40
   minutos; el Mac no se duerme mientras tanto. Si algo falla, **Reintentar**
   conserva lo ya instalado.
6. **Listo:** pulsa **Abrir Dashboard**.

<table>
  <tr>
    <td width="50%"><strong>1 · Buscar</strong><br><img src="docs/images/setup-find.png" alt="Asistente: buscar el Spark en la red"></td>
    <td width="50%"><strong>2 · Conectar</strong><br><img src="docs/images/setup-connect.png" alt="Asistente: usuario y contraseña del Spark"></td>
  </tr>
  <tr>
    <td width="50%"><strong>3 · Instalar</strong><br><img src="docs/images/setup-install.png" alt="Asistente: instalar MyDGX en el Spark"></td>
    <td width="50%"><strong>4 · Listo</strong><br><img src="docs/images/setup-done.png" alt="Asistente: Spark listo"></td>
  </tr>
</table>

### MyDGX Tray: tu Spark desde la barra de menús

**MyDGX Tray** es la suite todo en uno para controlar tu DGX Spark desde el Mac.
Instala MyDGX, mantiene la conexión y reúne en un solo menú, junto al reloj,
todo lo que harías con la Terminal. En la barra ves siempre el uso de GPU y RAM
del Spark (`GPU 4% · RAM 29%`); un clic abre el menú.

![MyDGX Tray: el menú de la barra explicado por bloques](docs/images/mydgx-tray.png)

1. **Estado en vivo.** Qué Spark usas, si llegas por la red local (LAN) o por
   Internet y cuánta memoria queda libre para modelos.
2. **Control del equipo.** Cambia entre varios Sparks o servidores, abre o
   cierra el túnel SSH y apaga el equipo con confirmación. El túnel va cifrado,
   no abre puertos en el router y se reconecta solo.
3. **Perfiles de IA.** Muestra los perfiles cargados, cuántos modelos tienen y
   cuánta memoria ocupan. Detén uno o arranca otro sin entrar en el dashboard.
4. **Tus apps, a un clic.** Dashboard, Open WebUI, ComfyUI, RAGKit, las apps de
   tus perfiles y una Terminal SSH ya configurada. Se abren en una dirección
   local del Mac (`http://127.0.0.1:…`) a través del túnel.
5. **Agentes de código.** Lanza Claude Code u OpenCode contra tus modelos
   locales. Si ningún modelo publicado admite tool calling con al menos 32k de
   contexto, el submenú explica qué falta en lugar de fallar.
6. **Preferencias.** Perfiles de conexión, claves, copias de seguridad,
   despliegue y actualizaciones de la app.

Para el día a día:
- **Actualizar MyDGX:** instala la nueva versión de la app y pulsa
  **Preferencias → Despliegue → Guardar y desplegar**. Conserva `.env`, modelos y
  bases de datos.
- **Añadir otro Spark o un servidor remoto:** usa la **varita mágica** de
  *Preferencias*.
- **Idioma:** la app está en español e inglés.

Guía completa, con permisos, claves SSH propias, acceso remoto y solución de
problemas: **[Inicio rápido con MyDGXTray](docs/es/quickstart.md)**. Sin Mac, o para
desarrollar, sigue la [instalación manual](#instalación-manual-linux-o-desarrollo).

## Recorrido por la aplicación

Cada apartado corresponde a una entrada del menú principal. Las capturas están
tomadas en modo noche sobre un NVIDIA DGX Spark real. La interfaz está disponible
en español e inglés: el idioma se toma del navegador y se cambia con el botón de
idioma de la cabecera o desde *Configuración*.

- [Barra lateral](#barra-lateral)
- [Resumen](#resumen)
- [Chat](#chat)
- [Modelos](#modelos)
- [Perfiles](#perfiles-multimodelo)
- [Benchmarks](#benchmarks)
- [Almacenamiento](#almacenamiento)
- [Motores](#motores)
- [Laboratorio IA](#laboratorio-ia)
- [Configuración](#configuración)
- [Sistema](#sistema)
- [Logs](#logs)

### Barra lateral

<img src="docs/screenshots/barra-lateral-darkmode.png" width="260" alt="Barra lateral con perfiles activos y memoria">

Siempre visible junto al menú. Identifica el equipo y resume lo que está cargado.

- fabricante, modelo y sistema operativo detectados (DGX Spark, GB10, DGX OS);
- perfiles activos con sus modelos y acceso directo a la app web del perfil;
- barra de memoria unificada con el reparto por modelo y el total usado;
- contadores de modelos y perfiles cargados junto a cada entrada del menú.

### Resumen

![Resumen](docs/screenshots/resumen-darkmode.png)

Página de inicio: estado del equipo de un vistazo y accesos directos a las
herramientas instaladas.

- saludo con el estado del Spark, host, arquitectura y tiempo encendido;
- plataforma, GPU, memoria unificada y disco detectados;
- accesos a DGX Dashboard, Open WebUI, ComfyUI y a las apps web de los perfiles;
- indicadores en vivo de GPU, CPU, memoria unificada y disco con umbrales;
- **mapa de memoria unificada** en vivo: driver CUDA, cada modelo, caché de disco
  recuperable y memoria libre;
- botón *Parar modelos* en la cabecera para liberar toda la inferencia de golpe.

![Gateway y servicios en el Resumen](docs/screenshots/resumen-gateway-darkmode.png)

- recursos en vivo (temperatura de GPU, memoria usada y tráfico de red);
- **Gateway API**: URL base OpenAI compatible, puerto, autenticación y modelos
  publicados con el nombre exacto que hay que usar en el campo `model`;
- estado de los servicios (Ollama, Open WebUI, ComfyUI, DGX Dashboard).

![Telemetría del sistema](docs/screenshots/resumen-telemetria-darkmode.png)

- **telemetría histórica** persistente en SQLite, de 1 hora a 7 días, con
  navegación hacia atrás;
- gráficas de utilización y temperatura de GPU, potencia, CPU y memoria, red y
  E/S de disco, con media y máximo del intervalo.

![Consumo de inferencia por modelo](docs/screenshots/resumen-consumo-darkmode.png)

- **consumo por modelo**: GPU, memoria de GPU, RAM unificada y CPU de cada modelo
  cargado, con su histórico;
- indica si la métrica se atribuye al proceso, a Ollama o si el motor no la
  expone.

### Chat

![Chat con el asistente MyDGX](docs/screenshots/chat-darkmode.png)

Chat local con cualquier modelo cargado y con el **asistente MyDGX**.

- selector de modelo entre el asistente y los modelos de los perfiles activos;
- el asistente consulta telemetría, sistema, modelos, perfiles y documentación
  con herramientas de solo lectura;
- las acciones que propone (arrancar perfiles, liberar memoria…) siempre
  requieren confirmación en la interfaz;
- sugerencias de preguntas frecuentes y acceso a Open WebUI para una experiencia
  avanzada.

![Open WebUI en modo oscuro con FLUX.1 Schnell de ComfyUI seleccionado como modelo](docs/images/openwebui-chat.png)

Detalle en [Asistente MyDGX](docs/es/asistente-mydgx.md).

### Modelos

![Modelos instalados y mapa de memoria](docs/screenshots/modelos-darkmode.png)

Biblioteca local y descarga de modelos.

- pestañas *Instalados*, *Explorar Hugging Face*, *Descargar con Ollama* e
  *Importar ZIP*;
- mapa de memoria unificada para ver qué cabe antes de encender nada;
- filtros por estado (cargados), modalidad (texto, visión, voz, imagen y vídeo),
  origen (Ollama, Hugging Face) y tamaño;
- ficha de cada modelo: parámetros, cuantización, familia, formato, contexto al
  encender, digest y memoria estimada frente a la libre;
- **Encender** carga un modelo al momento en el perfil Quick; la casilla
  **Default** lo añade al perfil que arranca siempre con MyDGX;
- verificación de integridad, favoritos, carga y descarga de Ollama en memoria y
  borrado de modelos que no use ningún perfil.

#### Explorar Hugging Face

![Recomendador de Hugging Face para el Spark](docs/screenshots/modelos-huggingface-darkmode.png)

Busca modelos en el Hub y los ordena por lo que cabe y rinde en este Spark, no
solo por popularidad.

**Búsqueda**

- tres vistas: *Para este Spark* (recomendador), *Todo Hugging Face* (búsqueda
  general por nombre, autor o arquitectura) y *Favoritos*, que se guardan con su
  ficha para revisarlos después;
- filtros por tarea, tamaño (*Mejor calidad que cabe*, por ejemplo), contenido
  (todos o solo sin censura, con enlace al catálogo de modelos sin censura),
  modalidad de entrada, runtime y formato;
- número de resultados por búsqueda y botón para analizar más candidatos;
- se descartan los modelos que exigen runtimes que MyDGX no instala (por
  ejemplo, las variantes REAP).

**Recomendador**

- cada tarjeta muestra la puntuación MyDGX (0–100), el estado (*Ideal*,
  *Compatible*, *Ajustado* o *No recomendado*), si ya está instalado y etiquetas
  como *Chat*, *Reasoning* o *Uncensored*;
- el ranking usa la telemetría en vivo: memoria libre real y reserva del sistema;
- orden alternativo por recomendación, rendimiento estimado (tok/s), menor
  memoria, score de la comunidad, descargas, likes o tendencia;
- ayuda integrada que explica en lenguaje llano Q8, MTP, Heretic, Abliterated y
  otros términos.

**Elegir archivos y descargar**

- la ficha del repositorio lista las cuantizaciones, los shards, los proyectores
  de visión (`mmproj`) y los drafters para decodificación especulativa;
- antes de descargar, la **comprobación previa** lee las cabeceras GGUF remotas y
  muestra arquitectura, cuantización, contexto nativo, MTP integrado y memoria
  estimada con 32K de contexto;
- avisa si faltan shards, si llama.cpp no reconoce la arquitectura, si el modelo
  supera la memoria segura, si solo has elegido un drafter o un proyector, o si el
  repositorio ofrece un drafter que no has seleccionado;
- rechaza los ficheros que ya están descargados y reutiliza la descarga en curso
  si el repositorio ya se está bajando;
- al terminar, Benchmarks comprueba que el modelo arranca y responde y compara la
  memoria real con la estimada.

#### Descargar con Ollama

![Descarga de modelos con Ollama](docs/screenshots/modelos-ollama-darkmode.png)

Descarga un modelo por su nombre exacto. No es un buscador: para descubrir
modelos usa *Explorar Hugging Face*.

- acepta nombres de la biblioteca de Ollama (`qwen3:8b`) y GGUF de Hugging Face
  con la ruta `hf.co/autor/repositorio:CUANTIZACIÓN`;
- ejemplos de un clic (`qwen3:8b`, `llama3.2:3b`, `gemma3:12b`,
  `nomic-embed-text`…) y enlace a la biblioteca de Ollama;
- progreso en vivo y botón para cancelar;
- MyDGX cancela la descarga si el tamaño no cabe en la memoria unificada;
- al terminar, el modelo aparece en *Instalados* con su cuantización, familia y
  parámetros, y si el modo automático está activo se encola su benchmark;
- paneles de actividad de Ollama y de tareas recientes con el histórico de
  descargas.

#### Importar ZIP

![Importación de un modelo GGUF desde un ZIP](docs/screenshots/modelos-importar-zip-darkmode.png)

Sube un modelo GGUF que ya tienes en el ordenador: modelos que no están en
Hugging Face, compilaciones propias o equipos sin conexión.

- muestra el espacio libre, el tamaño máximo que admite el ZIP en ese momento y
  el límite del modelo principal; el máximo absoluto es 512 GB y se cambia con
  `MODEL_IMPORT_MAX_GB`;
- una guía en cuatro pasos explica qué meter en el ZIP:
  - el modelo `.gguf` (con todas sus partes `-0000N-of-0000M` si está dividido);
  - el proyector `mmproj-*.gguf` para visión (opcional);
  - un drafter `mtp-…`, `dspark-…` o `eagle3-…` para ganar velocidad (opcional);
  - `README.md` y `LICENSE` (opcional);
- el `mydgx.json` opcional fija nombre, descripción, licencia, modelo base,
  etiquetas, tarea (`chat` o `vision`) y los ajustes del editor de modelos
  (contexto, temperatura, `top_p`, ficheros del modelo, del `mmproj` y del
  drafter…); hay una plantilla descargable;
- la importación va en cinco pasos con progreso: subida, revisión del ZIP,
  extracción, análisis del modelo y prueba;
- se rechazan ZIP cifrados, enlaces simbólicos, rutas peligrosas, ficheros
  duplicados, compresión anómala y GGUF dañados; el resto de ficheros se ignora
  y se avisa;
- el modelo queda en la biblioteca como `imported/nombre` y, si la prueba está
  activada, se arranca igual que con **Encender** y se ejecuta un benchmark corto
  con velocidad, latencia, memoria real y aceptación del drafter.

#### Recomendaciones para DGX Spark

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

### Perfiles multimodelo

![Perfiles activos](docs/screenshots/perfiles-darkmode.png)

Un perfil describe un grupo operativo completo: modelos, alias, motores, puertos,
contextos, slots, cuantización, parámetros de sampling, caché KV, modalidades y
límites de memoria.

- hasta dos perfiles de usuario cargados a la vez, más **Default** y **Quick**;
- cada tarjeta muestra modelos, puertos, memoria estimada y capacidad segura, con
  una barra que indica si el conjunto cabe en memoria;
- lista de modelos con motor, tarea, puerto y contexto;
- perfil predeterminado (se recarga al iniciar MyDGX), favoritos, búsqueda,
  edición, detención y borrado;
- el editor avisa de los cambios sin guardar antes de cerrar.

![Perfil con app web](docs/screenshots/perfiles-app-darkmode.png)

- **app del perfil**: un `start.sh` propio que arranca y se para con el perfil,
  con estado, reinicio y botón *Abrir* cuando publica una web.

Antes de arrancar, MyDGX:

1. comprueba que los puertos no se repitan;
2. estima pesos, contexto, caché y reserva para el sistema;
3. descarga y verifica los modelos ausentes;
4. arranca los modelos en orden y valida su endpoint de salud;
5. reduce el contexto y reintenta cuando detecta saturación de memoria;
6. revierte el grupo completo si no puede dejarlo en un estado consistente.

El perfil activado se convierte en el predeterminado para el próximo arranque.

### Benchmarks

![Benchmarks](docs/screenshots/benchmarks-darkmode.png)

Mide cada modelo del equipo con el mismo protocolo y dice cuál rinde mejor en esta
máquina. No son cifras de catálogo: cada resultado sale de ejecutar el modelo aquí,
aislado y con pruebas versionadas por tipo de tarea.

- flujo en cuatro pasos: elige, aísla (libera memoria y calienta solo ese
  modelo), mide y compara;
- pruebas por modalidad: texto (tok/s, primer token, estabilidad), voz (tiempo
  real, error de palabras, inteligibilidad), imagen y vídeo (tiempo,
  reproducibilidad), visión y embeddings (calidad semántica, NDCG);
- **suite multimodal secuencial** para medir todos los modelos pendientes de una
  vez; restaura después los perfiles y modelos residentes;
- cola automática para los modelos nuevos cuando el sistema está libre;
- histórico de solo añadido y exportación e importación en JSON.

![Rendimiento por categoría](docs/screenshots/benchmarks-ranking-darkmode.png)

- contadores de runs históricos, válidos y artefactos medidos;
- **ranking por categoría** con score MyDGX /100, tokens por segundo y tiempo al
  primer token;
- comparación por entorno (versiones de llama.cpp, driver…) para comparar solo
  en igualdad de condiciones.

![Eficiencia y memoria](docs/screenshots/benchmarks-eficiencia-darkmode.png)

- salida frente a primer token en un gráfico de burbujas;
- eficiencia por parámetro activo y aprovechamiento del ancho de banda de memoria
  del GB10.

![Velocidad y reconocimiento de voz](docs/screenshots/benchmarks-voz-darkmode.png)

- velocidad frente a parámetros activos en escala logarítmica, distinguiendo MoE y
  modelos densos;
- ranking de reconocimiento de voz: tiempo real y tasa de error de palabras.

![Síntesis de voz e imagen](docs/screenshots/benchmarks-sintesis-voz-darkmode.png)

- síntesis de voz: score, tiempo real e inteligibilidad comprobada con Whisper
  local;
- generación de imagen: tiempo y reproducibilidad con semilla fija.

![Fichas por modelo](docs/screenshots/benchmarks-fichas-darkmode.png)

- **fichas por modelo** con score, salida, primer token, estabilidad, memoria
  pico, tamaño, parámetros y cuantización;
- búsqueda, orden por categoría y score, e importación de resultados.

![Detalle de fichas](docs/screenshots/benchmarks-fichas-detalle-darkmode.png)

- descripción, licencia, idiomas, modelo base y etiquetas de Hugging Face;
- evolución del score, histórico del artefacto, repetición de la medida y ficha
  completa descargable.

Detalle en [Benchmarks](docs/es/benchmarks.md).

> **¿Qué modelo uso?** Consulta el
> **[ranking de modelos soportados y probados en DGX Spark](docs/es/modelos-probados.md#ranking-de-modelos-de-texto)**:
> 32 modelos de texto, voz, imagen y visión medidos en un Spark real, con
> velocidad, tamaño, parámetros y enlace a Hugging Face u Ollama.

### Almacenamiento

![Almacenamiento, NVMe y SMART](docs/screenshots/almacenamiento-darkmode.png)

Estado de los discos y en qué se va el espacio.

- **unidades NVMe y salud SMART**: temperatura, vida utilizada, reserva, horas y
  ciclos de encendido, errores, apagados inseguros y datos leídos y escritos;
- **mapa de almacenamiento** con el mismo estilo que el de memoria;
- **uso real**: distribución del espacio por tipo de dato (sistema, modelos, apps,
  MyDGX…), medida en segundo plano y guardada en caché;
- **apps de usuario**: cada directorio del home con su tamaño;
- capacidad de cada partición, sin los montajes de solo lectura de snap.

### Motores

![Motores de inferencia y modo memoria](docs/screenshots/motores-darkmode.png)

MyDGX instala llama.cpp, Ollama y un servicio Whisper OpenAI-compatible
acelerado con CUDA sobre la imagen oficial NVIDIA PyTorch para GB10. También
descubre vLLM, SGLang, TensorRT-LLM, LM Studio, ComfyUI, NVIDIA Riva y NVIDIA
NIM; esos motores externos se registran por endpoint sin mezclar necesariamente
sus stacks CUDA o Python.

- tarjeta de cada runtime con versión, estado y capacidades (chat, visión,
  embeddings, métricas, GGUF…);
- ComfyUI, Whisper y SearXNG se activan o desactivan de forma persistente;
- **modo memoria**: elige qué parar (perfiles llama.cpp, ComfyUI, Whisper, TTS,
  Open WebUI, SearXNG, gateway, modelos de Ollama), muestra cuánto libera cada
  uno y vacía la caché de páginas para hacer sitio a un modelo grande;
- *Restaurar* vuelve a arrancar exactamente lo que se paró.

Detalle en la [Guía de uso](docs/es/guia-de-uso.md#motores).

### Laboratorio IA

![Laboratorio multimodal](docs/screenshots/laboratorio-ia-darkmode.png)

Prueba el perfil activo y los motores administrados sin salir del panel.

- generación de imagen y vídeo con ComfyUI;
- texto a voz, transcripción, visión, embeddings y reranking;
- muestra el endpoint OpenAI que se usa (`/v1/images/generations`…) y el tipo de
  entrada y salida;
- las entradas y resultados no se guardan en SQLite.

Detalle en [Laboratorio IA](docs/es/laboratorio-ia.md).

### Configuración

![Configuración y gateway](docs/screenshots/configuracion-darkmode.png)

Preferencias del navegador y del gateway.

- apariencia automática, día o noche, e idioma (automático, español o inglés);
- clave de acceso MyDGX, guardada solo en `sessionStorage`;
- estado de las integraciones (token de Hugging Face, actualizaciones, servicios);
- **Gateway OpenAI del perfil activo**: arranque automático, búsqueda web con
  SearXNG para OpenCode y Claude Code, interfaz de escucha, puerto, timeout,
  tamaño máximo de petición y modelos publicados con su alias.

### Sistema

![Sistema y servicios](docs/screenshots/sistema-darkmode.png)

La página Sistema diferencia claramente DGX OS, Ubuntu, Debian y otros sistemas,
y muestra comprobaciones con estados correcto, aviso u opcional.

- comprobaciones agrupadas: base, DGX OS, GPU, contenedores, seguridad y
  servicios;
- versiones de kernel, driver NVIDIA, CUDA, llama.cpp, Ollama, Docker, Python y
  paquetes relevantes;
- integridad de la instalación, servicios systemd y actualizaciones APT
  controladas;
- tras una actualización comprueba APT, DKMS, NVIDIA Container Toolkit y la
  necesidad de recompilar llama.cpp, y ofrece una reparación guiada.

### Logs

![Logs persistentes](docs/screenshots/logs-darkmode.png)

Diagnóstico y auditoría persistentes.

- totales de eventos, avisos y errores de las últimas 24 horas y retención
  configurada;
- filtros por nivel, categoría y texto, y modo *En directo*;
- cada evento muestra acción, entidad y categoría (perfiles, benchmarks,
  runtime, HTTP…);
- los tokens y secretos nunca se registran.

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

## Instalación manual (Linux o desarrollo)

En macOS es más fácil la
[instalación rápida con MyDGXTray](#instalación-rápida-desde-macos-recomendada).
Esta vía instala MyDGX a mano, directamente en el equipo, o lo despliega desde
una copia del código con `./start.sh deploy`.

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
`SHODAN_API_KEY` y `NVD_API_KEY` se leen del entorno o, si faltan, del `.env` de
MyDGX. `scripts/mcp_env.py` lee solo esos dos nombres y los pasa al proceso del
MCP correspondiente, no a la shell del agente. Shodan se activa cuando hay clave
y NVD funciona sin ella con el límite público.

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
MCP Playwright, NVD y, si existe `SHODAN_API_KEY` en el entorno o en `.env`,
Shodan (`--strict-mcp-config`).
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
> **[Cómo comprobar un DGX Spark antes de comprarlo](docs/es/comprobar-spark.md)**.

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

Para desplegar exactamente lo publicado en GitHub, en lugar de la copia de
trabajo local:

```bash
./start.sh deploy --github            # último commit de main en origin
./start.sh deploy --github v1.2.0     # una rama o un tag concretos
```

Se ejecuta en el Mac, desde el clon git: descarga `origin`, extrae el commit
con `git archive` a una carpeta temporal (sin cambios sin confirmar, archivos
ignorados ni `.env`) y despliega desde ahí con las mismas copias de seguridad y
la misma vuelta atrás. El DGX no necesita acceso a GitHub ni credenciales. El
commit desplegado queda en `.mydgx-source-commit`. Con
`MYDGX_REQUIRE_SIGNED_TAG=1` solo se aceptan tags con firma válida
(`git verify-tag`). Se combina con los demás modos, por ejemplo
`--github main --frontend`.

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

![Workflow «MyDGX - Imagen Flux» en ComfyUI con FLUX.1 Schnell, imágenes generadas y cola de trabajos](docs/images/comfyui-flux-workflow.png)

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
- `ENABLE_SYSTEM_UPDATES`, `ENABLE_FIRMWARE_UPDATES`, `ENABLE_SERVICE_CONTROL`: operaciones privilegiadas;
- `DEVICE_VARIANT_OVERRIDE`: `nvidia`, `asus`, `hp`, `lenovo`, `dell` o `generic` cuando
  la detección automática del chasis no sea suficiente;
- `TRUSTED_HOSTS`: nombres extra aceptados en `Host` si accedes por un nombre DNS
  propio;
- `PROFILE_APPS_ROOT`, `PROFILE_APPS`: dónde se buscan las apps de perfil y lista
  blanca opcional.

Las opciones peligrosas están desactivadas por defecto. La lista completa de
variables, con valores por defecto, está en [Configuración](docs/es/configuracion.md).

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
Modelo completo en [Seguridad](docs/es/seguridad.md).

## Documentación adicional

- **[Quickstart: desde GitHub hasta el primer despliegue](docs/es/quickstart.md)**
- **[Cómo comprobar un DGX Spark antes de comprarlo](docs/es/comprobar-spark.md)**
- **[Modelos soportados y probados: ranking con benchmarks reales](docs/es/modelos-probados.md)**
- [Guía de uso por secciones](docs/es/guia-de-uso.md)
- [Configuración: variables, secretos y servicios opcionales](docs/es/configuracion.md)
- [Referencia completa de la API](docs/es/api.md)
- [Seguridad y modelo de amenazas](docs/es/seguridad.md)
- [Asistente MyDGX y su API](docs/es/asistente-mydgx.md)
- [Benchmarks reproducibles y API](docs/es/benchmarks.md)
- [Clientes del Gateway OpenAI](docs/es/gateway-clientes.md)
- [Laboratorio IA multimodal](docs/es/laboratorio-ia.md)
- [Conversión segura a modo servidor](docs/es/modo-servidor.md)
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

