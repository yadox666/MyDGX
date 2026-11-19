# Reproducible benchmarks

The **Benchmarks** section measures local models with a stable protocol and stores
historical results in SQLite. Measured values stay separate from
the recommender's estimates and from Hugging Face popularity.

## Protocol v1

`mydgx-text-generation-v1` supports text generation through Ollama and
loaded profiles compatible with the OpenAI API of llama.cpp or other engines.

`mydgx-asr-v1` measures only local Whisper models with multipart
`POST /v1/audio/transcriptions`. It keeps total time, duration,
real-time factor (RTF), WER, CER, and the SHA-256 of the transcription; it never
persists the recognized text.

The human fixture `armstrong-en` is described in
`backend/fixtures/asr/manifest.json`. It is a public-domain NASA recording,
not silence or synthetic audio. The WAV is included so the suite works
offline; MyDGX requires an exact match of size and SHA-256. The HTTPS source
pinned in the manifest only acts as a fallback, with a size limit.
A missing or altered copy invalidates the sample: it is not replaced with silence.

`mydgx-image-generation-v1` measures the MyDGX-managed FLUX through a
reproducible ComfyUI workflow. It only appears when the real checkpoint exists on
disk, and its identity is computed from size and SHA-256. It records generation
time, PNG integrity, expected resolution, and pixel reproducibility
with versioned prompt, seed, dimensions, and steps. Temporary images
are deleted at the end; SQLite keeps only hashes and metrics.

`mydgx-video-generation-v1` measures only the Wan 2.1 T2V managed by
MyDGX in local ComfyUI. The candidate only exists if the three real
artifacts referenced by `config/comfyui/video-workflow-api.json` are present:
diffusion model, text encoder, and VAE. Its composite fingerprint includes the size and
SHA-256 of each component, plus the SHA-256 of the versioned workflow.

The Wan case pins prompt, seed `424242`, resolution `832×480`, `33` frames,
`30` steps, and `24` fps. It records time, size, signature, and integrity of the
container, dimensions, and duration/frames when they can be inspected, exact
SHA-256, and an objective per-frame perceptual hash. It uses `ffprobe` and `ffmpeg`
only if they are already installed. Without them it declares container-signature-only
validation, leaves unobservable metrics as `null`, renormalizes the
measurable score, and marks it provisional; it never presents that degradation as
visual quality. The video is retrieved in memory, deleted from ComfyUI's managed
output, and not persisted: SQLite keeps only hashes and metrics.

`mydgx-embeddings-v1` measures local models through the OpenAI API
`POST /v1/embeddings`. It sends versioned public positive and
negative pairs in a single batch, and records latency, items per second, dimension,
mean cosine similarity, semantic margin, and separation accuracy.

`mydgx-reranking-v1` uses the same `POST /v1/rerank` as the multimodal adapter.
Its public cases contain a versioned query, documents, and expected order.
It records latency, NDCG, MRR, and exact order match.

Both semantic protocols only include models enabled in profiles
when the artifact is installed or the model is configured in a local
service, and the endpoint resolves to `127.0.0.1`, `localhost`, or `::1`. Cloud
APIs and remote endpoints are not accepted. The stable fingerprint uses the digest
of the artifact when it exists; for a configured local service it uses task,
engine, model reference, and normalized loopback endpoint.

`mydgx-vision-v1` measures vision as an independent modality, never as text.
It uses a `256×192` PNG generated deterministically in memory and pinned by
SHA-256, with no downloaded files or network. The questions, expected answers,
and accepted concepts are versioned. It records latency and normalized concept
recall, but only persists metrics and the hash of the response. It supports
local llama.cpp/OpenAI and Ollama only when `POST /api/show` declares
the `vision` capability.

`mydgx-tts-v1` measures TTS configured in profiles with a loopback endpoint. It uses
versioned public texts and WAV to measure latency, duration, RTF,
RIFF/PCM integrity, sample rate, channels, bit depth, RMS, and absence of
silence. `tts-lab` and the OpenAI APIs reuse `execute_multimodal_request`.
Audio and transcription live only in memory. Intelligibility is measured by a
round-trip with local Whisper; if it is unavailable or fails, that dimension is
zero, the score stays provisional, and no unmeasured quality is claimed.

The suite includes:

- one warm-up sample per case, excluded from the score;
- interactive latency;
- sustained throughput;
- code generation;
- between 1 and 10 measured repetitions;
- temperature `0`, `top_p=1`, seed `42`, and a single concurrent request;
- in Ollama, a fixed `num_ctx` (8192) so the context does not depend on the server.

MyDGX measures with a monotonic clock:

- time to first token (TTFT), including reasoning, and separately
  the first visible token (`visible_ttft_ms`);
- total time;
- `finish_reason`/`done_reason`, early stop (`early_stop`), and whether the
  token limit was reached;
- input and output tokens when the runtime reports them;
- output tokens per second;
- characters per second to compare different tokenizers;
- output hashes, never the generated text;
- available memory, GPU utilization, temperature, and power.

Results keep p50, p95, dispersion, reliability, and the individual
samples. Failed samples are also saved.

## Isolation

Strict isolation prevents **concurrent activity**, not mere residency in
memory. Before each sample it checks:

- that there is no other job queued or running;
- that no loaded llama.cpp server is processing (`/slots`);
- that Ollama does not have another model resident that is unrelated to the loaded profiles.

At the start, the runner unloads from memory the idle Ollama models that do not
belong to a loaded profile (`BENCHMARK_RELEASE_IDLE_OLLAMA`). If it detects
activity it waits up to 40 s; if it persists, it aborts the run. If a llama.cpp
server appears busy right after a sample, that sample is marked
as contaminated and the run is excluded from comparisons.

Co-resident profile models are allowed and are saved in
`runtime.isolation.co_resident_models`, which is not part of the runtime hash.

While the run lasts, MyDGX publishes a shared signal in SQLite:

- the main API responds `423` to chat, assistant, multimodal, downloads, and
  profile startups;
- the OpenAI/Anthropic gateway responds `503 benchmark_in_progress` with
  `Retry-After: 30`.

In the other direction, each gateway inference (OpenCode, Claude Code, Codex,
Open WebUI via the gateway…) stores its start and end time in SQLite.
The scheduler also honors `BENCHMARK_QUIET_SECONDS` from that mark, so
an automatic benchmark does not start between two turns of an active
session.

Traffic that goes directly to Ollama (for example Open WebUI) cannot be
blocked, and with an Ollama target it cannot be detected either: it is best not to use it
during the run. The telemetry sampler stays active because it is part of the
measurement.

## Automatic benchmark when loading models

With `BENCHMARK_AUTO_NEW_MODELS=true`, the default value, MyDGX queues a
benchmark in these cases:

- when a profile startup completes successfully: one for each chat or
  vision model;
- when `ollama pull` completes;
- when the default profile autostarts.

The queue (`benchmark_queue`) is persistent. The scheduler checks every
`BENCHMARK_QUEUE_POLL_SECONDS` and only launches a benchmark when:

- there are no jobs;
- there is no llama.cpp inference in progress;
- `BENCHMARK_QUIET_SECONDS` have passed since the last chat, assistant, or
  multimodal request.

If isolation is lost, the entry goes back to pending (up to 6
attempts). Entries expire after `BENCHMARK_QUEUE_MAX_AGE_HOURS` and are
discarded if the model is no longer loaded.

To avoid repeating measurements, an automatic benchmark is skipped if a valid run
already exists with the same artifact, runtime, environment, protocol, and algorithm. HF
downloads are not measured until the model is loaded in a profile.

## Long-running sequential suite

The **Complete pending benchmarks** panel runs all local artifacts
that do not yet have a valid run with the current protocol and algorithm.
The inventory includes:

- models installed in Ollama;
- llama.cpp text or vision models present in profiles whose
  GGUF files are already downloaded;
- visual Ollama models separated from text according to `/api/show`;
- TTS synthesizers configured with a loopback endpoint;
- embeddings and reranking models installed/configured in profiles with
  an exclusively loopback endpoint;
- managed FLUX and Wan, the latter only with a complete diffusion model, text encoder, and
  VAE;
- a single candidate per artifact hash, even if it appears in several profiles.

Before starting, MyDGX saves the IDs of the loaded profiles and the models
resident in Ollama. Then it:

1. blocks inference on the API and the gateway;
2. stops all profiles and unloads all Ollama models from memory;
3. loads a single model;
4. runs the full protocol;
5. stops the runtime and waits for the memory to be reclaimed;
6. continues with the next artifact;
7. restores the profiles and Ollama residents captured at the start.

The state, the inventory, and each partial result are saved in
`benchmark_suites` and `benchmark_suite_items`. If a model fails, the suite
records the error, frees memory, and continues with the next one. Stopping it
manually cancels the current sample and runs the same restoration.

During an orderly MyDGX shutdown, the task receives cancellation, marks the
suite as interrupted, and restores the snapshot before the service exits.
If the process dies without being able to run code, on the next startup the suite
is marked as `interrupted` and the normal desired-profiles mechanism
restores the persisted profiles.

This operation can take many hours and temporarily leaves the
chat, assistant, gateway, and Open WebUI without models. The dashboard, the side menu, and
MyDGXTray show the progress. Manual stop remains available until
the final restoration phase begins.

## Identity and persistence

Each run links four fingerprints:

1. artifact:
   - HF: commit of the local snapshot the runtime actually loads, file,
     blob digest, size, metadata, and model card of that revision;
   - Ollama: manifest digest, family, parameter size, and quantization
     from `/api/show`;
2. runtime: engine, model, effective context, and flags. In Ollama it adds the
   server version, the Modelfile parameters, and the template hash;
3. environment: hardware, memory, OS, kernel, and inference stack (CUDA, driver,
   llama.cpp, Ollama, vLLM, torch). Other libraries are saved, but do not
   change the hash, so as not to fragment comparability;
4. protocol: canonical definition and immutable hash.

Local APIs without an inspectable artifact use a stable fingerprint of
task, engine, reference, protocol, and normalized loopback endpoint; it does not include
credentials or the real hostname.

The `benchmark_runs`, `benchmark_samples`, and `benchmark_telemetry` tables are
append-only from the API. Scores are derived data with a versioned
algorithm (`spark-text-v2`) and do not replace the raw metrics.

## Score

The video score uses the independent algorithm
`wan-video-reproducibility-v1`. It combines performance, container integrity,
expected dimensions and temporal length, exact reproducibility,
perceptual reproducibility, and reliability. It only weights observed dimensions,
publishes `score_measured_weight`, and stays provisional if `ffprobe` or
`ffmpeg` are missing. It is not comparable with scores from other modalities.

Vision uses `vision-concept-recall-v1`; TTS uses
`tts-roundtrip-intelligibility-v1`. They are not comparable with text. In TTS, the
absence of Whisper keeps the intelligibility weight at zero instead of
renormalizing it, so it explicitly lowers the maximum possible score.

The `/100` score summarizes four dimensions:

- throughput: 35%;
- latency: 30%;
- stability: 20%;
- reliability: 15%.

Stability uses the coefficient of variation of tok/s **within each case**
and then averages the cases. This way, normal differences between prompts are not
penalized. With a single repetition stability cannot be measured: the score is
renormalized with the other three dimensions and marked as `provisional`.

The summary includes a per-case breakdown (`cases`) with TTFT, tok/s, CV, and early
stops. The UI groups runs by artifact, with their history, and the charts
only compare runs from the same environment, protocol, and algorithm.

Only compare scores with the same protocol and an equivalent hardware
class. Hugging Face likes, downloads, and trending are not part of the
measured score.

## API

All endpoints use `X-MyDGX-Key` when the API is protected.

### Inventory and history

`GET /api/benchmarks`

Returns protocols, eligible targets, runner status, automatic queue
(`queue`, `auto_new_models`, `quiet_seconds`), suite candidates
(`suite_candidates`), current/historical suite, and recent runs.

### Discard an automatic entry

`POST /api/benchmarks/queue/ENTRY_ID/skip`

### Run

`POST /api/benchmarks/runs`

```json
{
  "target": "ollama:llama3.2:3b",
  "protocol_id": "mydgx-text-generation-v1",
  "repetitions": 3,
  "strict_isolation": true
}
```

Loaded profiles use `profile:PROFILE_ID:MODEL_ID`.

### Run all pending

`POST /api/benchmarks/suite`

```json
{"repetitions": 3}
```

Returns `suite_id` and `job_id`. It rejects the start if there is another job, active
llama.cpp inference, another suite, or no pending model.

### Stop and restore

`POST /api/benchmarks/suite/SUITE_ID/stop`

Requests cancellation of the current sample and restores the operational snapshot.
During `restoring` a second cancellation is no longer accepted.

### View details

`GET /api/benchmarks/runs/RUN_ID`

Includes identity, environment, runtime, model card, samples, and telemetry.

### Export

`GET /api/benchmarks/runs/RUN_ID/export`

Generates a JSON bundle with schema version and SHA-256 checksum.

### Import

`POST /api/benchmarks/import`

```json
{"bundle": {"schema": "mydgx-benchmark-bundle", "...": "..."}}
```

The server limits the bundle to 10 MiB and validates schema, checksum, fingerprints,
protocol, and maximum counts. Imported runs are flagged and do not
overwrite existing results.

### Cancel

`POST /api/jobs/JOB_ID/cancel`

## Configuration

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

`BENCHMARK_AUTO_AFTER_DOWNLOAD` is replaced by `BENCHMARK_AUTO_NEW_MODELS`.

No additional keys are needed.

## Security and privacy

- Bundles do not include keys, cookies, or authorization headers.
- The environment fingerprint excludes hostname, serial number, and local paths.
- Model responses are not persisted; only length and SHA-256.
- In embeddings and reranking, the public texts live only in the
  immutable protocol definition. Samples store metrics and hashes of
  vectors, scores, and orders, never queries or documents.
- In vision, neither the response nor a copy of the generated fixture is saved.
- In TTS, no audio or transcription is saved; only hashes and metrics.
- The model card is truncated and goes through redaction before import.
- An imported bundle is untrusted information and never runs code.
- Private repositories may be identifiable by their name; review the
  JSON before sharing it outside the authorized environment.
