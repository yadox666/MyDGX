# MyDGX

<p align="right"><a href="README.es.md">Versión en español</a></p>

<p align="center">
  <img src="frontend/public/apple-touch-icon.png" width="92" alt="MyDGX">
</p>

<h3 align="center">Your personal supercomputer, under control.</h3>

<p align="center">
  A local, open source dashboard to monitor, configure and operate NVIDIA GB10 systems:
  DGX Spark, ASUS Ascent GX10, HP ZGX Nano G1n, Lenovo ThinkStation PGX and Dell Pro Max GB10.
</p>

<p align="center">
  <strong>Models</strong> · <strong>Multi-model profiles</strong> ·
  <strong>Historical telemetry</strong> · <strong>OpenAI Gateway</strong> ·
  <strong>Safe updates</strong>
</p>

![MyDGX overview on NVIDIA DGX Spark](docs/screenshots/resumen-darkmode.png)

## What is MyDGX?

MyDGX brings the everyday tasks of a local AI machine together in a single interface:

- monitoring of GPU, CPU, unified memory, temperature, power, network and disk;
- persistent history in SQLite, browsable from 1 hour to 7 days;
- model inventory, inspection and removal;
- Hugging Face search with a recommender for the Spark and a pre-check of the
  GGUF headers before downloading;
- download by name with Ollama and import of your own GGUF files from a ZIP, with
  an automatic test when finished;
- up to two simultaneous profiles, each with several models, engines and ports;
- deduplication of shared models and a joint preflight of memory, aliases and ports;
- preventive memory calculation for weights, context, KV cache and system reserve;
- default profiles with autostart and recovery from out-of-memory errors;
- your own apps that start and stop with the profile (for example a RAG that uses its models);
- instant start of a model from *Models* (Quick profile: survives a deploy, not a system reboot) and a Default profile with the models that must always start;
- memory mode to pause optional services and restore them later;
- reproducible benchmarks with an automatic queue for new models and a
  [ranking of models tested on the Spark](docs/en/modelos-probados.md);
- local chat, Open WebUI and a multimodal lab;
- local MyDGX assistant with documentation, live telemetry and confirmed actions;
- OpenAI-compatible catalog for every model in the active profile;
- checks for DGX OS, CUDA, kernel, drivers, llama.cpp, packages and services;
- controlled updates with post-update integrity verification;
- persistent technical logs, jobs and audit trail;
- day and night modes, responsive design and automatic vendor identity;
- SSH acceptance test to [check a DGX Spark before buying it](docs/en/comprobar-spark.md),
  new or second-hand.

Everything runs locally. Tokens and keys are read from `.env`; they are not
stored in SQLite or returned to the browser.

## Supported hardware

MyDGX detects the vendor through DMI, device-tree, DGX OS and the GPU. When the
identification is unambiguous it adapts the overview, the photo and the branding.

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

It also runs on Ubuntu and other development environments. Features that
depend on NVIDIA, systemd, APT, NVMe or SMART are shown as unavailable
when the system does not provide them.

## Quick install from macOS (recommended)

If you have a Mac, you don't need Terminal, Git, Python or Node.js. **MyDGXTray**, the
menu bar app, ships with MyDGX inside and an assistant installs it on the
Spark over SSH. The Spark builds and installs everything else.

**You need:**
- macOS 13 or later (Apple Silicon or Intel);
- a DGX Spark (or a compatible GB10 system) with the first boot already completed;
- the username and password from that first boot, with `sudo` permission;
- both machines on the same network, or remote SSH access, and Internet during the
  installation.

**Steps:**

1. Download `MyDGXTray-<version>-macos-universal.zip` from
   [Releases](https://github.com/yadox666/MyDGX/releases), unzip it and
   drag **MyDGXTray** to `Applications`.
2. Open it. If macOS blocks it, go to **System Settings › Privacy &
   Security** and click **Open Anyway**. The **Spark Setup
   Assistant** opens on its own.
3. **Search:** click **Find my Spark** and accept the **Local Network** permission.
   Pick the machine or type its IP or name, for example `spark-1a2b.local`.
4. **Connect:** enter the Spark username and password. The assistant
   saves its SSH fingerprint, creates a key just for this Mac and authorizes it. The
   password is used once and is not stored.
5. **Install:** click **Install MyDGX**. The first time takes between 20 and 40
   minutes; the Mac does not go to sleep in the meantime. If something fails, **Retry**
   keeps what is already installed.
6. **Done:** click **Open Dashboard**.

<table>
  <tr>
    <td width="50%"><strong>1 · Search</strong><br><img src="docs/images/setup-find.png" alt="Assistant: find the Spark on the network"></td>
    <td width="50%"><strong>2 · Connect</strong><br><img src="docs/images/setup-connect.png" alt="Assistant: Spark username and password"></td>
  </tr>
  <tr>
    <td width="50%"><strong>3 · Install</strong><br><img src="docs/images/setup-install.png" alt="Assistant: install MyDGX on the Spark"></td>
    <td width="50%"><strong>4 · Done</strong><br><img src="docs/images/setup-done.png" alt="Assistant: Spark ready"></td>
  </tr>
</table>

### MyDGX Tray: your Spark from the menu bar

**MyDGX Tray** is the all-in-one suite to control your DGX Spark from your Mac.
It installs MyDGX, keeps the connection alive and gathers in a single menu, next to the clock,
everything you would do from the Terminal. The menu bar always shows the Spark's GPU and RAM
usage (`GPU 4% · RAM 29%`); one click opens the menu.

![MyDGX Tray: the menu bar menu explained block by block](docs/images/mydgx-tray.png)

1. **Live status.** Which Spark you are using, whether you reach it over the local network (LAN) or over
   the Internet, and how much memory is left free for models.
2. **Machine control.** Switch between several Sparks or servers, open or
   close the SSH tunnel and shut the machine down with confirmation. The tunnel is encrypted,
   opens no ports on the router and reconnects on its own.
3. **AI profiles.** Shows the loaded profiles, how many models they have and
   how much memory they use. Stop one or start another without opening the dashboard.
4. **Your apps, one click away.** Dashboard, Open WebUI, ComfyUI, your RAG AI deployments, the apps of
   your profiles and a ready-to-use SSH Terminal. They open at a local
   address on the Mac (`http://127.0.0.1:…`) through the tunnel.
5. **Coding agents.** Launch Claude Code or OpenCode against your local
   models. If no published model supports tool calling with at least 32k of
   context, the submenu explains what is missing instead of failing.
6. **Settings.** Connection profiles, keys, backups,
   deployment and app updates.

For day-to-day use:
- **Update MyDGX:** install the new version of the app and click
  **Settings → Deployment → Save and deploy**. It keeps `.env`, models and
  databases.
- **Add another Spark or a remote server:** use the **magic wand** in
  *Settings*.
- **Language:** the app is available in Spanish and English.

Full guide, with permissions, your own SSH keys, remote access and
troubleshooting: **[Quick start with MyDGXTray](docs/en/quickstart.md)**. Without a Mac, or for
development, follow the [manual installation](#manual-installation-linux-or-development).

## Application tour

Each section matches an entry in the main menu. The screenshots were
taken in night mode on a real NVIDIA DGX Spark. The interface is available
in Spanish and English: the language is taken from the browser and can be changed with the
language button in the header or from *Settings*.

- [Sidebar](#sidebar)
- [Overview](#overview)
- [Chat](#chat)
- [Models](#models)
- [Profiles](#multi-model-profiles)
- [Benchmarks](#benchmarks)
- [Storage](#storage)
- [Engines](#engines)
- [AI Lab](#ai-lab)
- [Settings](#settings)
- [System](#system)
- [Logs](#logs)

### Sidebar

<img src="docs/screenshots/barra-lateral-darkmode.png" width="260" alt="Sidebar with active profiles and memory">

Always visible next to the menu. It identifies the machine and summarizes what is loaded.

- detected vendor, model and operating system (DGX Spark, GB10, DGX OS);
- active profiles with their models and a shortcut to the profile's web app;
- unified memory bar with the per-model breakdown and total used;
- counters of loaded models and profiles next to each menu entry.

### Overview

![Overview](docs/screenshots/resumen-darkmode.png)

Home page: the machine's status at a glance and shortcuts to the
installed tools.

- greeting with the Spark's status, host, architecture and uptime;
- detected platform, GPU, unified memory and disk;
- shortcuts to DGX Dashboard, Open WebUI, ComfyUI and the profiles' web apps;
- live indicators for GPU, CPU, unified memory and disk with thresholds;
- live **unified memory map**: CUDA driver, each model, reclaimable disk
  cache and free memory;
- *Stop models* button in the header to free all inference at once.

![Gateway and services in the Overview](docs/screenshots/resumen-gateway-darkmode.png)

- live resources (GPU temperature, used memory and network traffic);
- **Gateway API**: OpenAI-compatible base URL, port, authentication and published
  models with the exact name to use in the `model` field;
- service status (Ollama, Open WebUI, ComfyUI, DGX Dashboard).

![System telemetry](docs/screenshots/resumen-telemetria-darkmode.png)

- persistent **historical telemetry** in SQLite, from 1 hour to 7 days, with
  backward navigation;
- charts for GPU utilization and temperature, power, CPU and memory, network and
  disk I/O, with the interval's average and maximum.

![Inference usage per model](docs/screenshots/resumen-consumo-darkmode.png)

- **usage per model**: GPU, GPU memory, unified RAM and CPU of each loaded
  model, with its history;
- shows whether the metric is attributed to the process, to Ollama, or whether the engine does not
  expose it.

### Chat

![Chat with the MyDGX assistant](docs/screenshots/chat-darkmode.png)

Local chat with any loaded model and with the **MyDGX assistant**.

- model selector between the assistant and the models of the active profiles;
- the assistant queries telemetry, system, models, profiles and documentation
  with read-only tools;
- the actions it proposes (starting profiles, freeing memory…) always
  require confirmation in the interface;
- suggested frequent questions and access to Open WebUI for an advanced
  experience.

![Open WebUI in dark mode with ComfyUI's FLUX.1 Schnell selected as the model](docs/images/openwebui-chat.png)

Details in [MyDGX assistant](docs/en/asistente-mydgx.md).

### Models

![Installed models and memory map](docs/screenshots/modelos-darkmode.png)

Local library and model downloads.

- *Installed*, *Explore Hugging Face*, *Download with Ollama* and
  *Import ZIP* tabs;
- unified memory map to see what fits before starting anything;
- filters by status (loaded), modality (text, vision, voice, image and video),
  source (Ollama, Hugging Face) and size;
- card for each model: parameters, quantization, family, format, context on
  start, digest and estimated memory versus free memory;
- **Start** loads a model right away in the Quick profile; the
  **Default** checkbox adds it to the profile that always starts with MyDGX;
- integrity verification, favorites, loading and unloading Ollama models in memory and
  deletion of models not used by any profile.

#### Explore Hugging Face

![Hugging Face recommender for the Spark](docs/screenshots/modelos-huggingface-darkmode.png)

Searches the Hub for models and ranks them by what fits and performs well on this Spark, not
just by popularity.

**Search**

- three views: *For this Spark* (recommender), *All Hugging Face* (general
  search by name, author or architecture) and *Favorites*, which are saved with their
  card for later review;
- filters by task, size (*Best quality that fits*, for example), content
  (all or uncensored only, with a link to the uncensored model catalog),
  input modality, runtime and format;
- number of results per search and a button to analyze more candidates;
- models that require runtimes MyDGX does not install (for
  example, REAP variants) are discarded.

**Recommender**

- each card shows the MyDGX score (0–100), the status (*Ideal*,
  *Compatible*, *Tight fit* or *Not recommended*), whether it is already installed, and tags
  such as *Chat*, *Reasoning* or *Uncensored*;
- the ranking uses live telemetry: actual free memory and system reserve;
- alternative sort by recommendation, estimated performance (tok/s), less
  memory, community score, downloads, likes or trending;
- built-in help that explains Q8, MTP, Heretic, Abliterated and
  other terms in plain language.

**Choosing files and downloading**

- the repository card lists the quantizations, shards, vision projectors
  (`mmproj`) and drafters for speculative decoding;
- before downloading, the **pre-check** reads the remote GGUF headers and
  shows architecture, quantization, native context, built-in MTP and estimated
  memory with 32K context;
- it warns if shards are missing, if llama.cpp does not recognize the architecture, if the model
  exceeds safe memory, if you only picked a drafter or a projector, or if the
  repository offers a drafter you have not selected;
- it also warns if the model fits the machine but not next to the ones already
  running, if the card advertises MTP but the GGUF lacks those layers, and if a
  drafter's vocabulary does not match the model's (llama.cpp would reject it);
- the recommendation prefers Q6 over Q8 (same practical quality, less memory),
  understands Unsloth dynamic `UD-…_K_XL` quantizations and picks the best one
  that fits in free memory without stopping what is running; when the repository
  ships a drafter, it downloads it instead of the `mmproj` (llama.cpp does not
  combine vision and speculative decoding) and leaves vision as optional;
- if you download a drafter later, that model's profiles without speculative
  decoding or vision turn it on automatically (recorded in the audit log);
- it rejects files that are already downloaded and reuses the ongoing download
  if the repository is already being fetched;
- when finished, Benchmarks checks that the model starts and responds and compares the
  actual memory with the estimate.

#### Download with Ollama

![Downloading models with Ollama](docs/screenshots/modelos-ollama-darkmode.png)

Downloads a model by its exact name. It is not a search engine: to discover
models use *Explore Hugging Face*.

- accepts names from the Ollama library (`qwen3:8b`) and Hugging Face GGUF
  with the path `hf.co/author/repository:QUANTIZATION`;
- one-click examples (`qwen3:8b`, `llama3.2:3b`, `gemma3:12b`,
  `nomic-embed-text`…) and a link to the Ollama library;
- live progress and a cancel button;
- MyDGX cancels the download if the size does not fit in unified memory;
- when finished, the model appears in *Installed* with its quantization, family and
  parameters, and if automatic mode is on its benchmark is queued;
- Ollama activity and recent tasks panels with the download
  history.

#### Import ZIP

![Importing a GGUF model from a ZIP](docs/screenshots/modelos-importar-zip-darkmode.png)

Upload a GGUF model you already have on your computer: models that are not on
Hugging Face, your own builds or offline machines.

- shows the free space, the maximum ZIP size allowed at that moment and
  the main model's limit; the absolute maximum is 512 GB and is changed with
  `MODEL_IMPORT_MAX_GB`;
- a four-step guide explains what to put in the ZIP:
  - the `.gguf` model (with all its `-0000N-of-0000M` parts if it is split);
  - the `mmproj-*.gguf` projector for vision (optional);
  - an `mtp-…`, `dspark-…` or `eagle3-…` drafter to gain speed (optional);
  - `README.md` and `LICENSE` (optional);
- the optional `mydgx.json` sets name, description, license, base model,
  tags, task (`chat` or `vision`) and the model editor settings
  (context, temperature, `top_p`, model, `mmproj` and
  drafter files…); a downloadable template is provided;
- the import runs in five steps with progress: upload, ZIP review,
  extraction, model analysis and test;
- encrypted ZIPs, symbolic links, dangerous paths, duplicate files,
  abnormal compression and damaged GGUF files are rejected; any other files are ignored
  with a warning;
- the model is added to the library as `imported/name` and, if the test is
  enabled, it is started the same way as with **Start** and a short benchmark runs
  with speed, latency, actual memory and drafter acceptance.

#### Recommendations for DGX Spark

The Hugging Face search computes the ranking with the actual free memory and the
budget reserved for the system. Besides format, quantization, context,
license and popularity, it favors MoE architectures with few active parameters and
models that declare MTP, DFlash or DSpark for speculative decoding. The
estimate includes the KV cache, concurrent slots and a 1.5 GiB reserve when
a speculative technique is detected.

Popularity is shown as **HF community score (0–100)**, calculated from the
downloads, likes and trending data published by Hugging Face. It contributes up to 12 points
to the MyDGX ranking, but does not replace compatibility, memory or technical benchmarks.

Performance in tokens/s is a **comparative estimate**, based on the active
weights and the bandwidth, not a guaranteed benchmark. It can vary by runtime,
prompt, context and batching. `SPARK_CLUSTER_SIZE` lets you describe between one and
four linked Sparks; values greater than one are only valid if ConnectX-7 and
tensor parallel are actually configured. The base bandwidth is set with
`SPARK_MEMORY_BANDWIDTH_GBPS` (273 GB/s by default).

### Multi-model profiles

![Active profiles](docs/screenshots/perfiles-darkmode.png)

A profile describes a complete operational group: models, aliases, engines, ports,
contexts, slots, quantization, sampling parameters, KV cache, modalities and
memory limits.

- up to two user profiles loaded at once, plus **Default** and **Quick**;
- each card shows models, ports, estimated memory and safe capacity, with
  a bar that indicates whether the set fits in memory;
- list of models with engine, task, port and context;
- default profile (reloaded when MyDGX starts), favorites, search,
  editing, stopping and deletion;
- the editor warns about unsaved changes before closing.

![Profile with a web app](docs/screenshots/perfiles-app-darkmode.png)

- **profile app**: your own `start.sh` that starts and stops with the profile,
  with status, restart and an *Open* button when it publishes a website.

Before starting, MyDGX:

1. checks that ports are not repeated;
2. estimates weights, context, cache and system reserve;
3. downloads and verifies missing models;
4. starts the models in order and validates their health endpoint;
5. reduces the context and retries when it detects memory saturation;
6. rolls back the whole group if it cannot leave it in a consistent state.

The activated profile becomes the default for the next startup.

### Benchmarks

![Benchmarks](docs/screenshots/benchmarks-darkmode.png)

Measures every model on the machine with the same protocol and tells you which one performs best on this
machine. These are not catalog figures: each result comes from running the model here,
isolated and with versioned tests per task type.

- four-step flow: choose, isolate (free memory and warm up only that
  model), measure and compare;
- tests per modality: text (tok/s, first token, stability), voice (real-time
  factor, word error rate, intelligibility), image and video (time,
  reproducibility), vision and embeddings (semantic quality, NDCG);
- **sequential multimodal suite** to measure all pending models in one
  go; it then restores the resident profiles and models;
- automatic queue for new models when the system is idle;
- append-only history and JSON export and import.

![Performance by category](docs/screenshots/benchmarks-ranking-darkmode.png)

- counters for historical runs, valid runs and measured artifacts;
- **ranking by category** with MyDGX score /100, tokens per second and time to
  first token;
- comparison by environment (llama.cpp versions, driver…) to compare only
  under equal conditions.

![Efficiency and memory](docs/screenshots/benchmarks-eficiencia-darkmode.png)

- output versus first token in a bubble chart;
- efficiency per active parameter and use of the GB10's memory
  bandwidth.

![Speed and speech recognition](docs/screenshots/benchmarks-voz-darkmode.png)

- speed versus active parameters on a logarithmic scale, distinguishing MoE and
  dense models;
- speech recognition ranking: real-time factor and word error rate.

![Speech and image synthesis](docs/screenshots/benchmarks-sintesis-voz-darkmode.png)

- speech synthesis: score, real-time factor and intelligibility checked with local
  Whisper;
- image generation: time and reproducibility with a fixed seed.

![Model cards](docs/screenshots/benchmarks-fichas-darkmode.png)

- **model cards** with score, output, first token, stability, peak
  memory, size, parameters and quantization;
- search, sorting by category and score, and results import.

![Model card details](docs/screenshots/benchmarks-fichas-detalle-darkmode.png)

- description, license, languages, base model and Hugging Face tags;
- score evolution, artifact history, re-run of the measurement and full
  downloadable card.

Details in [Benchmarks](docs/en/benchmarks.md).

> **Which model should I use?** See the
> **[ranking of supported and tested models on DGX Spark](docs/en/modelos-probados.md#text-model-ranking)**:
> 47 text, voice, image and vision results measured on a real Spark, with
> speed, size, parameters, whether the model reasons and a link to Hugging Face or Ollama.

### Storage

![Storage, NVMe and SMART](docs/screenshots/almacenamiento-darkmode.png)

Disk status and where the space goes.

- **NVMe drives and SMART health**: temperature, life used, spare, power-on hours and
  power cycles, errors, unsafe shutdowns and data read and written;
- **storage map** in the same style as the memory map;
- **actual usage**: space breakdown by data type (system, models, apps,
  MyDGX…), measured in the background and cached;
- **user apps**: each home directory with its size;
- capacity of each partition, excluding read-only snap mounts.

### Engines

![Inference engines and memory mode](docs/screenshots/motores-darkmode.png)

MyDGX installs llama.cpp, Ollama and an OpenAI-compatible Whisper service
accelerated with CUDA on top of the official NVIDIA PyTorch image for GB10. It also
discovers vLLM, SGLang, TensorRT-LLM, LM Studio, ComfyUI, NVIDIA Riva and NVIDIA
NIM; those external engines are registered by endpoint without necessarily mixing
their CUDA or Python stacks.

- card for each runtime with version, status and capabilities (chat, vision,
  embeddings, metrics, GGUF…);
- ComfyUI, Whisper and SearXNG are enabled or disabled persistently;
- **memory mode**: choose what to stop (llama.cpp profiles, ComfyUI, Whisper, TTS,
  Open WebUI, SearXNG, gateway, Ollama models), shows how much each one frees
  and drops the page cache to make room for a large model;
- *Restore* starts again exactly what was stopped.

Details in the [User guide](docs/en/guia-de-uso.md#engines).

### AI Lab

![Multimodal lab](docs/screenshots/laboratorio-ia-darkmode.png)

Test the active profile and the managed engines without leaving the dashboard.

- image and video generation with ComfyUI;
- text to speech, transcription, vision, embeddings and reranking;
- shows the OpenAI endpoint being used (`/v1/images/generations`…) and the
  input and output type;
- inputs and results are not stored in SQLite.

Details in [AI Lab](docs/en/laboratorio-ia.md).

### Settings

![Settings and gateway](docs/screenshots/configuracion-darkmode.png)

Browser and gateway preferences.

- automatic, day or night appearance, and language (automatic, Spanish or English);
- MyDGX access key, stored only in `sessionStorage`;
- integration status (Hugging Face token, updates, services);
- **Active profile's OpenAI Gateway**: autostart, web search with
  SearXNG for OpenCode and Claude Code, listen interface, port, timeout,
  maximum request size and published models with their alias.

### System

![System and services](docs/screenshots/sistema-darkmode.png)

The System page clearly distinguishes DGX OS, Ubuntu, Debian and other systems,
and shows checks with pass, warning or optional states.

- grouped checks: base, DGX OS, GPU, containers, security and
  services;
- versions of the kernel, NVIDIA driver, CUDA, llama.cpp, Ollama, Docker, Python and
  relevant packages;
- installation integrity, systemd services and controlled APT
  updates;
- after an update it checks APT, DKMS, NVIDIA Container Toolkit and whether
  llama.cpp needs rebuilding, and offers a guided repair.

### Logs

![Persistent logs](docs/screenshots/logs-darkmode.png)

Persistent diagnostics and audit trail.

- totals of events, warnings and errors in the last 24 hours and the configured
  retention;
- filters by level, category and text, and *Live* mode;
- each event shows action, entity and category (profiles, benchmarks,
  runtime, HTTP…);
- tokens and secrets are never logged.

## Profiles

A **profile** is the editable configuration of one or more models: how they are
downloaded, how much context they use and on which engines and ports they run. It is
started and stopped from *Profiles* or the menu bar app. There are also
two read-only profiles managed from *Models*:
**Default** (always starts) and **Quick** (instant start of a model).

### Profile app

A profile can have an associated **app**: a directory in the service user's
home (for example `/home/nvidia/rag-ai`) with its own `start.sh` that
accepts `start`, `stop`, `restart` and `status` (exit code 0 if running).

- When the profile is loaded, once inference is responding, MyDGX runs
  `start.sh status` and, if it is not running, `start.sh start` in the background.
- When the profile is stopped, MyDGX runs `start.sh stop` before unloading the models,
  unless another loaded profile uses the same app.
- The app uses its own `.env`. MyDGX does not pass its secrets to it: only `PATH`,
  `HOME`, the language and `MYDGX_GATEWAY_URL` (`http://127.0.0.1:<port>/v1`).
- Output goes to `logs/apps/<app>.log`. Only directories you own are accepted,
  without symbolic links and with a `start.sh` that is not writable by other users;
  `PROFILE_APPS` restricts the list and `PROFILE_APPS_ROOT` changes the directory.

## OpenAI-compatible Gateway

Each active profile acts as an independent catalog. Its models and aliases are
published through a single port, much like OpenAI or OpenRouter:

```text
http://127.0.0.1:4000/v1
```

Main endpoints:

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/embeddings`
- `POST /v1/images/generations`
- `POST /v1/audio/transcriptions`
- `POST /v1/audio/speech`
- `POST /v1/videos`
- `POST /v1/rerank`

Example:

```bash
curl http://127.0.0.1:4000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"MODEL_ALIAS","messages":[{"role":"user","content":"Hello"}]}'
```

If the gateway listens outside localhost, set `GATEWAY_API_KEY` and send
`Authorization: Bearer YOUR_GATEWAY_API_KEY`.

## Manual installation (Linux or development)

On macOS the
[quick install with MyDGXTray](#quick-install-from-macos-recommended) is easier.
This path installs MyDGX by hand, directly on the machine, or deploys it from
a copy of the source code with `./start.sh deploy`.

### Requirements

- DGX OS or a compatible Ubuntu;
- Python 3.10 or later;
- Node.js 20 or later;
- npm.

### Local installation

```bash
cp .env.example .env
./start.sh setup
./start.sh start
```

Open [http://127.0.0.1:8088](http://127.0.0.1:8088).

Commands:

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
./start.sh --recover mydgx-backup-YYYYMMDDTHHMMSSZ.tar.gz [--check]
```

`start.sh` is idempotent: it can be run again without deleting the database,
the profiles or the downloaded models. `--recover` is the exception: it
restores a backup made in *System → Backup* after showing a summary and asking
you to type `RESTORE`; see the usage guide.

### OpenCode

MyDGX can install OpenCode and configure it against the gateway of the loaded
profile. The workspace and generated files are stored outside the repository,
in `~/opencode`:

```bash
./start.sh install-opencode
./start.sh install-opencode my-project
cd ~/opencode
/path/to/MyDGX-Dashboard/start.sh opencode
/path/to/MyDGX-Dashboard/start.sh opencode --active
/path/to/MyDGX-Dashboard/start.sh opencode MODEL_ALIAS
```

OpenCode and Claude Code need a loaded model with at least 32,768 tokens of
context: their system prompt and tools take up about 16,000 before the
first message. Models with less context do not appear in the selector, and if
you ask for one, the script refuses to start and explains how to raise the
profile's context. The minimum can be changed with `MYDGX_AGENT_MIN_CONTEXT`.

The default mode is `plan` and read-only. `--active` allows editing,
asks for confirmation for bash and enables the Playwright, Shodan and NVD MCPs.
Web search is enabled by default in both modes: OpenCode queries
local SearXNG through `POST /v1/search`. It is turned off in Settings → Gateway
and OpenCode stops offering the tool the next time it is opened. `webfetch`
and the native `websearch` remain disabled.
The configuration automatically includes every chat or vision model
published by the gateway; you can select any of them by its alias. Without an
alias, a profile model with tool calling, chat and the most
context is chosen. Each model inherits its context, tool calling, reasoning
and image input from the gateway; the output limit is one eighth of the context (between
4096 and 32000 tokens, adjustable with `MYDGX_OPENCODE_MAX_OUTPUT_TOKENS`). The
MyDGX rules are added as `instructions` without replacing OpenCode's base
prompt, and both modes block reading `.env`, `*.pem` and `*.key`.
The installation adds the `authorized-pentest` and `blackbox-wordpress`
workflows to `~/opencode/.opencode/skills/`, adapted from the
BugHunter lab. The skills respect the documented scope and do not enable invasive
actions without authorization.
Optional keys are injected only through `MYDGX_GATEWAY_API_KEY`,
`SHODAN_API_KEY` and `NVD_API_KEY`; they are not written to the configuration.
`SHODAN_API_KEY` and `NVD_API_KEY` are read from the environment or, if missing, from the
MyDGX `.env`. `scripts/mcp_env.py` reads only those two names and passes them to the
corresponding MCP process, not to the agent's shell. Shodan is enabled when there is a key
and NVD works without one under the public rate limit.

### Claude Code

Claude Code connects to the gateway's Anthropic Messages endpoint (`/v1/messages`)
with the same automatic detection as OpenCode: local gateway, Tray tunnel or
`MYDGX_GATEWAY_URL`. The workspace is stored in `~/claude-code`:

```bash
./start.sh install-claude-code
cd ~/claude-code
/path/to/MyDGX-Dashboard/start.sh claude
/path/to/MyDGX-Dashboard/start.sh claude --active
/path/to/MyDGX-Dashboard/start.sh claude MODEL_ALIAS
/path/to/MyDGX-Dashboard/start.sh claude -- -p "Summarize this repository"
```

Each run discovers the gateway's chat or vision models and generates
`~/claude-code/.claude/mydgx-settings.json`, which is passed with `--settings`. All
Claude Code model tiers (Fable, Opus, Sonnet, Haiku and subagents)
point to the selected alias, compaction uses the model's real context and
telemetry, auto-update, automatic memory (which
would save project notes in `~/.claude`) and the attribution header that
invalidates the KV cache of local engines are disabled. `~/.claude` is not modified. The
launcher's header goes to stderr, so `-p --output-format json` produces
clean JSON for scripts and CI.

The modes match OpenCode's: `plan` and read-only by default;
`--active` accepts edits, asks for confirmation for bash and loads only the
Playwright and NVD MCPs and, if `SHODAN_API_KEY` exists in the environment or in `.env`,
Shodan (`--strict-mcp-config`).
Web search is enabled by default in both modes, with the same `searxng` MCP
as OpenCode and the same checkbox in Settings → Gateway. Native `WebSearch`
and `WebFetch` remain blocked. Both modes block subagents and
reading `.env` and private keys. The skills are copied to
`~/claude-code/.claude/skills/` and the instructions to `~/claude-code/CLAUDE.md`.
The gateway key is provided only through `MYDGX_GATEWAY_API_KEY` and
`ANTHROPIC_API_KEY` is removed from the session environment.

## DGX Spark acceptance test

`./start.sh test` integrates a hardware and health test over SSH. The first
run creates a local file with `0600` permissions:

> If you are evaluating a new or used unit before paying, follow the guide
> **[How to check a DGX Spark before buying it](docs/en/comprobar-spark.md)**.

```text
config/dgx-health-check/dgx-spark.env
```

You can also run it directly without preparing the configuration:

```bash
./start.sh test root@192.168.1.100
./start.sh test root@192.168.1.100 -p22
./start.sh test root@192.168.1.100 -p 2222
./start.sh test -i ~/.ssh/spark_key root@192.168.1.100 -p 2222
```

The port is optional and defaults to `22`. `-i` selects a private key, as in
OpenSSH. Without it, OpenSSH first tries the available keys; if none
authenticates, it asks for the password directly in the terminal. MyDGX never receives or stores that password.

On the local network, you can create or update the initial configuration through
Bonjour/mDNS. It only selects SSH services whose name identifies a
DGX, Spark or NVIDIA and reuses a local key only if it authenticates:

```bash
./start.sh --autodiscover --config
# Equivalent:
./start.sh test --autodiscover
```

Edit at least `DGX_HOST`, check the user and select the SSD you purchased:

```dotenv
DGX_HOST=spark-xxxx.local
DGX_USER=nvidia
DGX_PORT=22
DGX_EXPECT_DISK_TB=1
DGX_IDENTITY=~/.ssh/id_ed25519
DGX_ACCEPT_NEW=0
DGX_STRICT=0
```

Then run:

```bash
./start.sh test
./start.sh test --strict
./start.sh test --interactive --accept-new
./start.sh test --expect-fingerprint SHA256:VERIFIED_FINGERPRINT
./start.sh test --help
```

Command-line options take precedence over environment variables and
the configuration file. You can also use an alternative file:

```bash
./start.sh test --config /secure/path/dgx-spark.env
```

The test verifies DGX OS, `aarch64`, GB10, unified memory, storage,
NVMe SMART, temperatures, NVIDIA Xid errors and short memory,
disk and CUDA exercises. It creates and deletes a temporary 256 MiB remote file; it does not write
to block devices.

It does not accept passwords as arguments, variables or configuration. For the
first connection, compare the SSH fingerprint with the Spark's console before using
`--accept-new`.

An old key is replaced automatically without running `ssh-keygen -R`
when `DGX_ACCEPT_NEW=1`. A warning is shown and the operation only affects
the exact host and port entry, which is useful with rented machines that
reuse addresses. `DGX_EXPECT_FINGERPRINT` is an optional strict lock
for permanent machines.

## Deployment on DGX OS or Ubuntu

```bash
./start.sh deploy
```

To optionally install an hourly DuckDNS updater, define
`DUCKDNS_DOMAIN` and `DUCKDNS_TOKEN` only in the DGX's `.env` and run:

```bash
./start.sh deploy --duckdns --repair --interactive
```

The token is not copied from the Mac or printed. After the first installation,
regular deployments keep and update the service.

To publish only interface changes, without installing packages or
restarting services:

```bash
./start.sh deploy --frontend
```

This mode builds React locally, transfers only `frontend/dist`, activates the
new version atomically and keeps the previous one as a backup. If
`USER@HOST` is not given, it first uses MyDGXTray's active connection.

To deploy exactly what is published on GitHub, instead of the local working
copy:

```bash
./start.sh deploy --github            # latest commit of main on origin
./start.sh deploy --github v1.2.0     # a specific branch or tag
```

It runs on the Mac, from the git clone: it fetches `origin`, extracts the commit
with `git archive` to a temporary folder (without uncommitted changes, ignored
files or `.env`) and deploys from there with the same backups and
the same rollback. The DGX needs neither GitHub access nor credentials. The
deployed commit is recorded in `.mydgx-source-commit`. With
`MYDGX_REQUIRE_SIGNED_TAG=1` only tags with a valid signature are accepted
(`git verify-tag`). It can be combined with the other modes, for example
`--github main --frontend`.

The deployment:

- installs the dashboard dependencies and diagnostic tools;
- automatically enables, starts and verifies the MyDGX gateway;
- prepares CUDA and builds llama.cpp for GB10/sm_121 when applicable;
- detects changes to the kernel, driver, CUDA or llama.cpp revision;
- keeps the previous installation until verifications are complete;
- installs `mydgx.service`, `mydgx-gateway.service` and the system repair tool;
- enables the dashboard to start automatically with Linux;
- can set up Ollama, Docker, NVIDIA Container Toolkit, Open WebUI, Whisper
  as a local GPU service, SearXNG as a private search engine and ComfyUI for image
  and video;
- never copies `.env`, tokens or private keys from another machine;
- finishes by listing the profile apps installed in `PROFILE_APPS_ROOT` (by
  default the home of the DGX's SSH user), the profile each one uses and the
  folders with a `start.sh` that are ignored for not meeting the security rules.

Whisper is installed by default with the `turbo` model on
`nvcr.io/nvidia/pytorch:25.09-py3`. It can be adjusted before deployment with
`MYDGX_WHISPER_MODEL`, `MYDGX_WHISPER_BASE_IMAGE` or explicitly disabled
with `MYDGX_INSTALL_WHISPER=0`.

SearXNG is installed by default with Open WebUI, listens only on
`127.0.0.1:8888` and needs no external keys. It can be disabled with
`MYDGX_INSTALL_SEARXNG=0` or pinned to an image through
`MYDGX_SEARXNG_IMAGE=searxng/searxng@sha256:DIGEST`. The deployment uses the container
when Docker is working and automatically switches to an isolated native installation
when the provider does not allow running the daemon.

ComfyUI is installed with PyTorch CUDA 13 and safe settings for the GB10's unified
memory. The deployment downloads FLUX.1 Schnell FP8 and Wan 2.1 T2V
1.3B from the official Comfy-Org repositories, validates their SHA-256 and automatically
connects image and multimedia tools in Open WebUI. It can be skipped
with `MYDGX_INSTALL_COMFYUI=0`, download the runtime without models through
`MYDGX_INSTALL_COMFYUI_MODELS=0` or pin the revision with `MYDGX_COMFYUI_REF`.

![«MyDGX - Imagen Flux» workflow in ComfyUI with FLUX.1 Schnell, generated images and job queue](docs/images/comfyui-flux-workflow.png)

Everything that is downloaded is pinned: the SearXNG image by digest, ComfyUI and
llama.cpp by commit, Open WebUI and Ollama by version, the Ollama installer and
the Hashcat archive by SHA-256 and the NodeSource repository by its key
fingerprint. If a provider changes something, the deployment stops instead of
running unreviewed code; to update, review the change and update the pinned
value (`MYDGX_SEARXNG_IMAGE`, `MYDGX_COMFYUI_REF`, `MYDGX_LLAMA_CPP_REF` with a
full commit, `MYDGX_OPENWEBUI_VERSION`, `MYDGX_HASHCAT_SHA256` or the
constants at the top of the remote script in `deploy.sh`).

On Linux without systemd the local `start.sh` supervisor is used.

## Configuration

Copy `.env.example` to `.env` and only edit the local file:

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

Key variables:

- `HF_HOME`: Hugging Face cache;
- `OLLAMA_URL`, `OPENWEBUI_URL`, `DGX_DASHBOARD_URL`: local services;
- `ASSISTANT_ENABLED`, `ASSISTANT_MODEL`: local operations assistant and its preferred model;
- `ASSISTANT_FALLBACK_TO_AVAILABLE`: allows using another local model if the preferred one does not respond;
- `LLAMA_CPP_SERVER_PATH`: llama-server executable;
- `ENABLE_PROFILE_AUTOSTART`: startup of the default profile;
- `GATEWAY_HOST`, `GATEWAY_PORT`: OpenAI endpoint of the active profile;
- `METRICS_INTERVAL_SECONDS`, `METRICS_RETENTION_HOURS`: history;
- `ENABLE_SYSTEM_UPDATES`, `ENABLE_FIRMWARE_UPDATES`, `ENABLE_SERVICE_CONTROL`: privileged operations;
- `DEVICE_VARIANT_OVERRIDE`: `nvidia`, `asus`, `hp`, `lenovo`, `dell` or `generic` when
  automatic chassis detection is not enough;
- `TRUSTED_HOSTS`: extra names accepted in `Host` if you connect through your own DNS
  name;
- `PROFILE_APPS_ROOT`, `PROFILE_APPS`: where profile apps are looked up and an optional
  allowlist.

Dangerous options are disabled by default. The full list of
variables, with default values, is in [Configuration](docs/en/configuracion.md).

## Persistence

SQLite keeps:

- general and per-model telemetry;
- profiles, favorites and default profile;
- jobs, progress and events;
- structured logs and audit trail;
- non-secret preferences.

Models stay in the standard Hugging Face and Ollama caches.
Tokens, passwords, cookies and API keys are never stored in the database.

## Security

- MyDGX listens only on `127.0.0.1` by default.
- For remote access, an SSH tunnel or an authenticated HTTPS proxy is recommended.
- The browser cannot send arbitrary commands to the system.
- Privileged actions use a closed list of services and commands.
- The deployment does not grant `NOPASSWD: ALL`.
- Authorization headers, cookies, request bodies and secrets are not
  written to the logs.
- Sensitive fields are redacted before events are persisted.
- Dashboard and gateway reject browser requests from other websites (`Origin`,
  `Sec-Fetch-Site`) and unrecognized `Host` headers (DNS rebinding).
- The deployment verifies the DGX's SSH key and the installers by checksum or
  signature, pins image and repository versions, and never copies `.env` files.
- Profile apps run without MyDGX's secrets and only if their
  `start.sh` is owned by the MyDGX user and nobody else can modify it.

Do not commit `.env`, databases, model caches or private keys to Git.
Full model in [Security](docs/en/seguridad.md).

## Additional documentation

- **[Quickstart: from GitHub to the first deployment](docs/en/quickstart.md)**
- **[How to check a DGX Spark before buying it](docs/en/comprobar-spark.md)**
- **[Supported and tested models: ranking with real benchmarks](docs/en/modelos-probados.md)**
- [User guide by section](docs/en/guia-de-uso.md)
- [Configuration: variables, secrets and optional services](docs/en/configuracion.md)
- [Full API reference](docs/en/api.md)
- [Security and threat model](docs/en/seguridad.md)
- [MyDGX assistant and its API](docs/en/asistente-mydgx.md)
- [Reproducible benchmarks and API](docs/en/benchmarks.md)
- [OpenAI Gateway clients](docs/en/gateway-clientes.md)
- [Multimodal AI Lab](docs/en/laboratorio-ia.md)
- [Safe conversion to server mode](docs/en/modo-servidor.md)
- [MyDGXTray for macOS](macos/MyDGXTray/README.md)
- [MyDGXTray configurable fields](macos/MyDGXTray/PREFERENCIAS.md)

## Project status

MyDGX is under active development. The interface can be tried on macOS, but
GPU, DGX OS and systemd operations must be validated on real GB10 hardware before
being used in production.

The screenshots on this page were generated with each vendor's identity
view in a development environment; unavailable services appear
as such on purpose.

## Trademarks and images

NVIDIA, DGX, ASUS, HP, Lenovo, Dell and their logos are trademarks of their respective
owners. Product images come from official product or
press pages and are used solely to identify the managed hardware.

## License

MyDGX code is distributed under the [MIT license](LICENSE). Third-party trademarks,
models and graphic assets remain the property of their
respective owners.
