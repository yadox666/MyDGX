# Usage guide

A tour of each dashboard section, the concepts it uses, and the API behind it.
The full endpoint reference is in [API](api.md).

## Key concepts

| Concept | What it is |
|---|---|
| **Model** | Weights downloaded to the Hugging Face cache (`HF_HOME`) or to Ollama. Downloading does not mean loading into memory. |
| **Profile** | Inference recipe: one or more models with their engine (llama.cpp, Ollama, vLLM, SGLang, TensorRT-LLM, ComfyUI, Whisper...), port, context, and parameters. **Up to two profiles or Quick models** can be loaded at the same time if they fit in memory. |
| **Default profile** | Profile that MyDGX loads again on startup (`ENABLE_PROFILE_AUTOSTART`). It is set with *Default only*. |
| **Profile app** | Your own application (for example `~/ragkit`) that starts and stops with the profile through its `start.sh`. |
| **Default profile (read-only)** | Read-only profile with the models marked as *Default* in *Models* (for example an embeddings model that must always be available). It always starts when MyDGX starts and does not count toward the two-profile limit. |
| **Quick profile** | Read-only profile created when you press *Start* on a model in *Models*. It loads immediately if it fits and is emptied with *Stop*. It is kept if only MyDGX restarts (for example with a normal `deploy`), but it is emptied when the machine reboots or with `deploy --repair`. It does not count toward the two-profile limit. |
| **Gateway** | Single OpenAI/Anthropic endpoint (`http://127.0.0.1:4000/v1`) that routes by model alias to the loaded profiles. |
| **Engine** | Runtime that serves models. Some are system services (Ollama, ComfyUI, Whisper, SearXNG) and others are launched by MyDGX per profile (llama-server). |
| **Memory mode** | Temporary pause of optional services to make room for a large model, with later restoration. |
| **Job** | Long-running operation (download, verification, startup, benchmark, update) with progress, cancellation, and result. |

The GB10 memory is unified (CPU and GPU share the 128 GB). That is why MyDGX
calculates how much memory each profile needs before loading it and blocks
combinations that do not fit.

## Overview

- Real-time telemetry: GPU, CPU, unified memory, temperature, power draw,
  network, and disk, with configurable history.
- **Memory map**: what is using memory (profiles, Ollama, services,
  system, and page cache) and how much is truly free.
- Inference consumption per model over the last hour.
- Recent activity of jobs and downloads.

In the side panel, the machine card shows the DGX model, the CUDA status,
in-progress downloads with their percentage, and the **loaded profiles**.
Clicking them opens *Profiles*.

API: `GET /api/overview`, `GET /api/metrics/history`, `GET /api/metrics/models`.

## Chat

The chat opens as a floating window in the bottom right from the robot button
in the header, left of the notifications. Close it with the X, Escape or the
same button; the conversation is kept when you reopen it.

Two modes:

- **Chat** with any Ollama model or a model from a loaded profile
  (`POST /api/chat`).
- **MyDGX Copilot**, the operations assistant. It answers with real data from
  the machine, searches this documentation, recommends models, and proposes
  actions that only run if you confirm them. See [MyDGX Assistant](asistente-mydgx.md).

## Models

- **Recommended**: Hugging Face models filtered by task, size,
  alignment, runtime, format, and modality. Combined score of
  compatibility with the machine, estimated or measured performance, and HF community score.
- **Installed**: Ollama and Hugging Face models, with size, source, and whether
  they are loaded in memory.
- Per-model actions:
  - download a snapshot or only the required files;
  - verify integrity with SHA-256;
  - delete, typing the name to confirm;
  - mark as favorite;
  - **Start**: loads the model immediately into the **Quick** profile if it fits
    in memory and can be brought up (Hugging Face models must be GGUF). The
    context is the midpoint between the minimum for coding agents (32K for chat
    models, 8K for vision) and the maximum recommended by the author
    (`--ctx-size` in the model card) or, if not given, the GGUF native context.
    It never exceeds the native one. For example, a 262K model starts with 144K.
    If the model card uses a `-c` smaller than that minimum (usually just an
    example), it starts with the minimum. For GGUFs that are not started, a slider to the left of *Start* lets you
    choose another context between that minimum and the GGUF native context; it shows
    the memory it would use and disables the button if it does not fit with that context.
    Sampling (`--temp`,
    `--top-p`, `--top-k`, `--min-p`, penalties) and the KV cache (`-ctk`/`-ctv`)
    are taken from the first example `llama-server` command in the model card; if the author
    does not specify `--repeat-penalty`, 1.0 is used. Without a command in the card, the
    sampling shipped in the GGUF (`general.sampling.*`) is used and, if there is none,
    MyDGX defaults. The same applies when adding the model to
    *Default*. The required memory, which decides whether the button is enabled, is
    calculated with that context and that KV cache from the GGUF header
    (attention layers, KV heads, and SSM state in hybrid models), plus the
    weights and the `mmproj`. Started
    models stay at the top of the list with the *Quick* tag and the
    **Stop** button, which unloads them from memory. If another profile already
    loads the model, the button shows that profile's name. If it does not fit alongside what is already
    loaded, the button appears disabled as **Does not fit now** and, on
    hover, explains how much memory is missing or which alias or port conflicts. The same happens
    with each profile's start button. Both are recalculated as soon as
    what is running changes. In the left menu, *Profiles* and *Models* show
    with a number how many are running;
  - **Release** an Ollama model loaded by Ollama itself (`keep_alive`), or
    a Hugging Face model loaded by ComfyUI (for example Qwen-Image).
    In ComfyUI all its models are released at once and loaded again on the
    next generation;
  - press the red **Stop models** button (in the top bar, next to *Night
    mode*; it only appears if there are active models and its tooltip explains the effect)
    to reclaim memory at once: it shuts down all loaded profiles,
    including Quick, and unloads the Ollama models. The chat model
    (and its profile), the Default profile, and what ComfyUI, TTS, and Whisper use are kept.
    It asks for confirmation first;
  - check the **Default** box to add it to the Default profile, which starts
    on every boot. If Default is already loaded, the change applies immediately.
    It uses the same parameters as *Start*. The context is whatever the
    slider shows at that moment; if you have not moved it, the same one *Start* would use.
    To change the context of a model already in Default, uncheck it,
    move the slider, and check it again;
  - **Startup settings** (sliders icon on GGUFs): shows each
    value the model would start with and its source (author's model card,
    GGUF header, detected drafter, or default value). It lets you set manually:
    - the main quantization and the `mmproj` («No vision» disables it);
    - the default context and the slider maximum;
    - the drafter, or disable speculative decoding, and the tokens per draft;
    - sampling and the KV cache.

    An empty field uses the automatic value and **Reset to automatic** clears all
    manual settings. It applies the next time the model starts; if the model
    is in Default, it is also updated there. Models with manual settings
    carry the *Manual* tag.
- **Speculative decoding**: a drafter is a small model that proposes
  tokens and the main model validates them, so it generates faster with the same
  quality. MyDGX recognizes a drafter by:
  - its name or folder (`mtp-`, `MTP/`, `dspark-`, `dflash-`, `eagle3-`, `draft-`);
  - the architecture in its header (`dflash`, `eagle3`…);
  - having far fewer tensors than the main model.

  Drafters are never chosen as the main model. MyDGX uses the drafter that
  the model card specifies (`--spec-type`, `--spec-draft-model`) if it is downloaded. If
  not, it prefers DSpark, DFlash, EAGLE-3 and, finally, the MTP built into the
  GGUF (`nextn_predict_layers`). Models with speculative decoding carry its tag
  (for example *DSpark* or *MTP*). It is not used with the `mmproj` active, because
  llama.cpp does not combine the two. If the model does not start with the drafter,
  MyDGX relaunches it without it and notes this in the logs.
- **Pre-download check**: before downloading a GGUF, MyDGX reads via
  HTTP Range the header of each selected file, without downloading the weights.
  It shows what each file is (main, projector, or drafter), its
  architecture, and whether the installed llama.cpp recognizes it. It also shows the
  native context, the quantization, and the estimated memory at 32K. It warns about:
  - incomplete shards;
  - a selection without a main model;
  - a drafter alongside an `mmproj`;
  - insufficient memory.

  If the repository includes a drafter that is not selected, it offers **Add
  drafter and download**. The recommended download already includes it when the model
  has no vision.
- **Post-download verification**: when a Hugging Face download finishes,
  the main GGUF enters the automatic **Benchmarks** queue. It is launched
  with the same configuration as *Start* (drafter and manual settings
  included). This checks that it starts and responds, and the benchmark card
  compares the real peak memory with the estimated one and shows the drafter's
  acceptance rate.
- Ollama download by exact name (`qwen3:32b`, `gpt-oss:120b`...).
- **Import ZIP**: for GGUF models you already have on your computer (your own
  versions, models not on Hugging Face, or machines without internet). The
  tab explains each step:
  1. Gather the `.gguf` in a folder (all parts if it comes as
     `-00001-of-0000N`). Optionally add the `mmproj-….gguf` for vision, a
     drafter (`mtp-`, `dspark-`, `eagle3-`…), a `README.md`, and a `LICENSE`.
     Safetensors and other files are ignored.
  2. Optional: add a `mydgx.json` with `name`, `description`, `license`,
     `base_model`, `tags`, `task` (`chat` or `vision`), and `settings`. The
     `settings` are the same fields as the model settings editor
     (`context_size`, `temperature`, `model_filename`, `spec_type`…). The tab
     offers a template to download.
  3. Compress the folder. Finder or `zip -0 -r ../mi-modelo.zip .` works
     (without recompressing the GGUF), but no password or symbolic links.
  4. Drag it onto the tab. With **Test when finished**, MyDGX starts the
     model as *Start* does and runs a short benchmark on it.

  The progress shows the five steps: upload, check, extract, analyze, and
  test. At the end a verdict appears with the Score, the speed, the time
  to first word, the machine's peak memory versus the model's estimate,
  and the valid responses, plus
  the file table and the warnings. The model stays in **Installed** as
  `imported/<nombre>`. If the test fails, it stays installed and can be adjusted.
  If another benchmark is running, the test is queued in **Benchmarks**.
- A model loaded by a profile cannot be deleted: stop that profile first or
  shut it down.

Quick and Default appear in the unified memory map, in the machine card
of the side panel, and in the menu bar app like any loaded
profile. If only MyDGX restarts (a `deploy` without `--repair`), Quick comes back with its
models. After rebooting the DGX or a `deploy --repair`, Quick is empty. Default
always starts again.

API: `POST /api/models/quick/start`, `POST /api/models/quick/stop`,
`PUT /api/models/persistence` (Default).

Downloads become jobs with progress. You can cancel them, and MyDGX
rejects those that do not fit in physical memory. With `HF_TOKEN` in the
server `.env` you can download private or gated repositories. The
token never reaches the browser.

## Benchmarks

They measure prefill and decode speed, latency, memory, power draw, temperature,
stability, and quality. Options:

- measure a specific model;
- launch a suite with several candidates;
- let MyDGX automatically measure new models
  (`BENCHMARK_AUTO_NEW_MODELS`).

The suite then restores the previous state: profiles, services, and Ollama
models. Results can be exported and imported as verifiable bundles.
Measured results feed the recommendations in *Models*. Methodology in
[Benchmarks](benchmarks.md).

## Profiles

Each card shows models, engine, published aliases, estimated memory, download
status, memory plan and, if it has one, the associated app.

- **Create or edit**: choose engine, model (or a recommended repository, which
  fills in GGUF, context, and parameters), alias, port, context, and sampling
  parameters.
  - When you type the repository of an already downloaded model (or the Ollama
    name), or with **Model parameters**, the same values that
    *Start* would use for that model are filled in: GGUF, `mmproj`, task, context,
    sampling, KV cache, and identifier. Each model in the profile has its own;
    a new model does not copy the main model's values.
  - The **port** is *Automatic* by default: on save, MyDGX picks a free one
    between 18080 and 19999 not used by any other profile, web app, or service, and
    keeps it while it stays free. With *Manual* the given number is used.
  - You can add up to 12 additional models: embeddings, reranking, vision,
    audio, image...
  - *Automatically reduce context after OOM* reduces the context if it does not fit in memory,
    without going below the given minimum.
- **Start**: downloads whatever is missing and loads all the profile's models. If
  another profile is already loaded, the joint plan checks memory, ports, and aliases.
- **Stop**: stops the profile or all of them, and their apps.
- **Default only**: marks it as the default for the next MyDGX startup, without starting it.
- **Default and Quick** carry the *Read only* tag: they can be started or
  stopped, but not edited, activated, or deleted; they are managed from
  *Models*. Default does not count toward the limit of two loaded; each chat
  or vision model started in Quick takes one of those two slots.

### Recipes

A recipe is a profile measured on a DGX Spark and published on GitHub, in
`config/recipes.json`. The page shows it with a blue *RECIPE* badge.

- **Find recipes** lives in two places: as a tab in *Models*, next to
  *Explore Hugging Face*, and as a button next to *New profile*. Both read the
  current catalog from GitHub, and *Refresh from GitHub* reads it again on the
  spot. Without a connection they show the copy bundled with your MyDGX
  version.
- Each recipe has categories with the same badges as models: Text, Code,
  Vision, Embeddings, Image, Video and Voice / audio. The badges at the top
  filter the list by category. *Profiles* cards also show the categories of
  the models they contain, and the same badges, to the right of the profile
  search box, filter the list.
- Each recipe shows its description, its models (quantization, context, KV,
  MTP and whether it is uncensored) and the memory measured with everything
  loaded.
- *View details* shows the full recipe as JSON and *Download JSON* saves it to
  your computer.
- *Install* adds the recipe as is, with its own name, and can queue the
  download of any missing models, MTP drafters included. Each recipe is
  installed once.
- In the *Models* tab, *Install with models* installs the recipe and queues
  all its models at once. If an installed recipe is missing models, its card
  says so and offers *Download N model(s)*.
- *Duplicate as profile* creates a regular profile with the name you choose,
  which you can edit freely.

An installed recipe is read-only: you can start, stop, favorite, set as default
and delete it, but not edit it or add models to it. To change it, use
*Duplicate* and edit the copy. Names starting with `RECIPE` are reserved for
recipes.

Each recipe has a version number (`v1`, `v2`…) and a changelog. When a new
version is published, the profile card and *Find recipes* offer *Update to vN*.
Updating keeps the favorite and default flags, does not download the models you
already have again, and requires stopping the profile first. If an earlier
version is published to withdraw a faulty one, *Find recipes* lets you go back
to it. At startup, MyDGX updates any recipe that is not loaded when the local
copy carries a newer version.

New installations get the recipes from the local copy at startup. Change the
catalog URL with `MYDGX_RECIPES_URL`; only `raw.githubusercontent.com` is
accepted.

#### Image and video recipes

A recipe can also bring a ComfyUI model, such as *RECIPE · Image · Qwen-Image
2.1 Turbo*. Its model uses the `comfyui` engine and protocol and carries a
`comfyui` block:

- `workflow`: a workflow in ComfyUI API format, in `config/comfyui`. MyDGX
  writes the prompt, seed, size and steps into the nodes titled `MyDGX Prompt`,
  `MyDGX Seed`, `MyDGX Size` and `MyDGX Steps`. Only the prompt node is
  required; leave out `MyDGX Steps` when the model has a fixed step schedule.
- `files`: each file with its Hugging Face `repo`, `revision`, `filename`, the
  ComfyUI `folder` (`diffusion_models`, `text_encoders`, `vae`, `loras`…) and
  its `sha256`.

*Install with models* or starting the profile downloads the files into
`ComfyUI/models/<folder>`, checks each hash and refuses to start while any
file is missing. Gated repositories need `HF_TOKEN` and the model terms
accepted on Hugging Face. The image benchmark runs the recipe's workflow with
its own steps. The built-in FLUX.1 Schnell and Wan models stay as they were.

### Profile app

An app is a directory with a `start.sh` that accepts `start`, `stop`, `restart`,
and `status`, the last one returning exit code `0` if it is running. MyDGX
starts it when the profile is ready and stops it when the profile stops. If two loaded
profiles use the same app, it only stops when the last one stops.

To add an app:

1. Copy the app to the DGX as a direct subdirectory of `PROFILE_APPS_ROOT`
   (by default the MyDGX user's home), for example `/home/nvidia/ragkit`.
2. Its `start.sh` must belong to the MyDGX user and not be writable by
   group or others: `chmod 755 start.sh`. Symbolic links are not accepted.
3. Create its `.env` directly on the DGX. Deployment never copies `.env`
   files.
4. Optional: limit the allowed apps with `PROFILE_APPS=ragkit,otra`.
5. In *Profiles → Edit*, the **Profile app** dropdown lists the valid
   apps. Choose one and save.

The app receives `MYDGX_GATEWAY_URL` in its environment to use the profile's models
and does **not** receive MyDGX secrets (`HF_TOKEN`, API keys). Its output is
saved to `logs/apps/<nombre>.log`. The profile card shows the app's status
and buttons to check the status or restart it.

#### Web app: alias and port

If the app is a web app, in the profile editor, next to **Profile app**, set:

- **Web app alias**: name of the shortcut (by default, the
  directory name).
- **Web port on 127.0.0.1**: port between 1024 and 65535. Leave it empty to remove
  web access.

The alias and port belong to the app, not the profile: if two profiles use the
same app, they share its configuration. MyDGX rejects ports already used by
MyDGX, the gateway, the configured services, the models of any profile,
the menu bar app's default tunnels, the Default
(20000-29999) and Quick (30000-39999) ranges, or another app.

`start.sh` also receives `MYDGX_APP_NAME`, `MYDGX_APP_HOST=127.0.0.1`,
`MYDGX_APP_PORT`, `MYDGX_APP_ALIAS`, and `MYDGX_APP_URL`, and **must listen on that
localhost port**, for example:

```bash
uvicorn app:app --host "${MYDGX_APP_HOST:-127.0.0.1}" --port "${MYDGX_APP_PORT:-8501}"
```

If you change the port while the app is running, restart it so it uses the new one.

While the app is running:

- **Overview** shows a button with its alias and port next to *DGX Dashboard*,
  *Open WebUI*, and *ComfyUI*. It appears dimmed if the app is still starting or not responding
  on its port.
- The profile card shows **Open**.
- The menu bar app adds **Open <alias> · :<puerto>** to the menu.
  With an SSH tunnel, it forwards the same port number from the Mac (`127.0.0.1:<puerto>`)
  to the DGX and keeps it open, so the *Overview* button also works
  from the Mac's browser. The port must be free on the Mac.

To start, stop or restart an app by hand, with or without a loaded profile, go to
**Engines → Profile apps**. Each button runs `start.sh start`, `stop` or
`restart`, and the state comes from `start.sh status`. Stopping asks for confirmation.

API: `/api/profiles*`, `GET /api/profile-apps`, `POST /api/profile-apps/{name}/{action}`,
`PUT /api/profile-apps/{name}/web`; active web apps are in
`GET /api/overview` (`web_apps`).

## Storage

- Capacity and usage per partition.
- Real breakdown by data type: Hugging Face models, Ollama, ComfyUI,
  MyDGX data, and system.
- NVMe drives with SMART health: wear, temperature, and errors.

## Engines

- Status of each runtime: llama.cpp (with the available builds), Ollama, vLLM,
  SGLang, TensorRT-LLM, ComfyUI, Whisper, and SearXNG.
- **Enable or disable** ComfyUI, Whisper, and SearXNG persistently
  (`POST /api/engines/{engine_id}/action`). An engine used by a loaded profile
  cannot be disabled.
- **Memory mode**:
  - temporarily pauses optional services (ComfyUI, Whisper, TTS, Open WebUI,
    SearXNG), unloads the Ollama models, and drops the page cache to
    free memory;
  - optionally also stops the profiles;
  - *Restore* starts again exactly what was stopped;
  - does not act while a benchmark suite is running or a profile is starting.

An engine showing as *active* means its service responds. Whisper and
ComfyUI load their models on demand on the first request, so they can
be active while using almost no memory.

That on-demand loading bypasses the profiles' memory control: a
ComfyUI workflow can exhaust memory even if each model fit when
it was loaded. MyDGX watches the kernel memory pressure
(`/proc/pressure/memory`). If for 30 s the system spends at least 40 % of the
time waiting for memory, it creates the *Memory saturated* notification with the
processes using the most memory and a **Stop models** button. The warning repeats at
most every 15 minutes. In that state MyDGX Tray shows *Spark saturated
(memory)* instead of *Not connected*, because the machine still responds over
SSH.

## AI Lab

Interactive tests of image, audio (ASR and TTS), video, vision, embeddings, and
reranking with the available models. Results are saved as downloadable
artifacts. The same capabilities are exposed to Open WebUI as a tool
server. See [AI Lab](laboratorio-ia.md).

## Settings

- Day/night theme and font size.
- **MyDGX access key**: stored only in the browser's `sessionStorage` and
  sent as `X-MyDGX-Key`.
- Integration status: Hugging Face token, updates, and service
  control.
- **Gateway**: activation, listen address (localhost recommended), port, timeout,
  maximum request size, web search (SearXNG, enabled by default), and
  published models. Search applies on save. Changes to host,
  port, or activation require restarting MyDGX.

## System

The **Health Center** tab continuously evaluates temperature, available memory,
Linux PSI, swap, disk, GPU clock/power, and model failures. When opened, it also
checks services, PyTorch CUDA/SM121 compatibility, NVIDIA Docker/CDI, vLLM KV
cache allocation errors, and NVIDIA Xid, OOM, and thermal events from the
current-boot kernel journal.

Below the findings, **Checks** groups the observed value of every rule next to
its threshold by GPU, memory, storage, kernel, runtimes, services, and
inference, so a healthy system still shows what was measured. Memory warns when
MemAvailable is below 10 %, PSI some ≥10 %, PSI full ≥1 %, or swap exceeds
8 GiB. It becomes critical below 4 GiB available or at PSI full ≥5 %. A large
model loaded into the shared 128 GB is therefore not flagged as a problem.

Low-power detection requires at least three consecutive samples from the last
five minutes with high utilization, low power, and a clock at or below 800 MHz.
Hardware, driver, or firmware Xids are critical; those normally caused by an
application are warnings. Host OOM is distinguished from a container memory
limit. Model launch failures count for 24 hours.

Each finding shows severity, confidence, evidence, source, and a recommended
action. If a required collector fails, the header says *Partial diagnosis* and
the coverage row shows which one; findings that depend on it are kept instead of
being marked resolved. The panel re-evaluates every minute while open; the
PyTorch probe is reused for ten minutes unless you press *Evaluate again*.
The header badge next to notifications summarises the state: green when
healthy, orange with warnings, and red with critical problems. Clicking it opens
the Health Center. A full evaluation repeats in the background every five
minutes even while the panel is closed.
Important findings also reach *Notifications* as a single summarised alert.
Critical findings notify immediately; warnings notify once they have stayed
active for two minutes. A finding alerts again only if it gets worse or
reappears after six hours. Memory saturation and model load failures are not
duplicated, since they already have their own notification. The alert includes
a button that opens the Health Center.
Appearances, severity changes, and resolutions are recorded in *Logs*;
resolutions remain visible for seven days. A reading the machine cannot obtain
is shown as unknown, never as zero. Reading the journal depends on the
permissions of the user running MyDGX.

**Redacted report** downloads JSON without raw logs, hostname, network
identifiers, or credentials. It includes non-identifying platform data,
collector status, and only matching evidence after redaction. Review it before
sharing anyway.

DGX-specific rules are inspired by
[spark-doctor](https://github.com/joeynyc/spark-doctor) (MIT), adapted to
MyDGX continuous sampling and profiles.

The **Platform** tab retains:

- Machine identity (NVIDIA, ASUS, HP, Lenovo, Dell, or generic).
- *Readiness*: mandatory requirements, warnings with fix instructions, and
  optional items.
- Platform, operating system, and installed versions: driver, CUDA, kernel, and
  runtimes.
- Integrity of the kernel, DKMS, NVIDIA packages, and llama.cpp.
- Managed services. Starting, stopping, or restarting requires
  `ENABLE_SERVICE_CONTROL=true` and confirmation.
- APT updates and runtime repair. They require
  `ENABLE_SYSTEM_UPDATES=true` and typing the confirmation (`ACTUALIZAR MYDGX`,
  `REPARAR MYDGX`).
- Firmware: what fwupd has pending (EC, UEFI, SSD…) and the ConnectX-7 status.
  MyDGX checks every 6 hours and posts a notification when a new version
  appears. Installing requires `ENABLE_FIRMWARE_UPDATES=true`, confirmation, and
  no running jobs; MyDGX never restarts the machine on its own. The ConnectX-7
  is updated by the NVIDIA service at boot, only with a QSFP cable connected.
  Check the NVIDIA OTA status in DGX Dashboard.

## Logs

Persistent diagnostics, filterable by level, category, and text, with pagination.
Secrets and authorization headers are redacted before being saved. The
audit log (`GET /api/audit`) records each action with its result.
