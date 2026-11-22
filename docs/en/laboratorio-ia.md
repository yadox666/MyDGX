# AI Lab

The AI Lab lets you test the models and services of the active profile from
MyDGX. The interface discovers their capabilities, builds the right request, and
sends the content directly to the local endpoint configured for each model.

## Requirements

1. Create or edit a profile in **Profiles**.
2. Correctly declare the model's task, input and output modalities, and
   protocol.
3. Activate the profile and start it.
4. Check in **Engines** that the runtime or endpoint is available.
5. Open **System → AI Lab** and press reload if you just changed the profile.

The **Service** selector shows the enabled models of the active profile. If the
managed ComfyUI installation is active, it also adds
`comfyui-image` and `comfyui-video` without requiring changes to the chat profile. The
other external services must have a configured endpoint and a supported
protocol.

## Usage flow

1. Select a service. Its task, modalities, and endpoint are shown.
2. Enter the instruction or the required documents.
3. For vision or ASR, select a valid image or audio file.
4. Press **Run**. For video, press **Create job**.
5. Review the output in **Local result**.

The interface changes depending on the task:

| Task | Input | Output | Expected endpoint |
| --- | --- | --- | --- |
| Chat | Text | Text/JSON | `/v1/chat/completions` |
| Vision | Text + image | Text/JSON | `/v1/chat/completions` |
| Embeddings | Text | Vector/JSON | `/v1/embeddings` |
| Image generation | Text | Base64 image or URL | `/v1/images/generations` |
| ASR | Audio | Transcription/JSON | `/v1/audio/transcriptions` |
| TTS | Text | Playable audio | `/v1/audio/speech` |
| Video generation | Text | URL via job | `/v1/videos/generations` |
| Reranking | Query + documents | Scores/JSON | `/v1/rerank` |
| Redaction | Text | Redacted text + spans | `/v1/redact` |

## Configuration by type

### Chat and vision

`llama.cpp` can serve chat and vision. Vision requires the model to have a valid
multimedia projection `mmproj`. The lab sends a non-streaming chat
request; for vision it includes the image as `image_url` in data URL format.

### Embeddings and reranking

Embeddings sends the text as `input`. Reranking uses the instruction as the
query and each line of the **Documents** box as a separate document,
with a maximum of 100.

### Image, audio, and video

These profiles usually point to external local engines such as Whisper, Riva, NIM,
or a compatible server. MyDGX includes a native adapter for its managed
ComfyUI:

- FLUX.1 Schnell FP8 for image through `comfyui-image`;
- Wan 2.1 T2V 1.3B for video through `comfyui-video`;
- versioned workflows in `config/comfyui/`;
- GB10-specific measures that disable pinned memory and cudaMalloc.

- Image requests a single output in `b64_json` and shows it on the page.
- ASR sends the audio as `multipart/form-data`.
- TTS requests MP3 and shows a player.
- Video creates an asynchronous job. The **View result** button checks its
  status. MyDGX copies the managed ComfyUI output to `data/artifacts` and
  returns an authenticated URL.

## MyDGX API

The frontend uses:

- `GET /api/multimodal/capabilities`: active profile models and capabilities.
- `POST /api/multimodal/run`: chat, vision, embeddings, image, ASR, TTS, and
  reranking.
- `POST /api/multimodal/video/jobs`: asynchronous video creation.
- `GET /api/jobs`: job progress.
- `GET /api/jobs/{id}/result`: structured video result.
- `GET /api/artifacts/{id}`: authenticated download of a media output.

Open WebUI also receives an OpenAPI tool server limited to
`/api/openwebui/tools/*`. It lets you discover capabilities, run tasks
without attachments, and create or check video jobs. It does not expose system,
update, profile, or deletion operations.

Example embeddings request:

```json
{
  "model": "alias-del-modelo",
  "task": "embeddings",
  "prompt": "Text that will be converted into a vector",
  "data_url": "",
  "documents": [],
  "response_format": "json"
}
```

Reranking example:

```json
{
  "model": "alias-del-reranker",
  "task": "reranking",
  "prompt": "Which document best explains CUDA?",
  "documents": [
    "CUDA lets you run parallel compute on the GPU.",
    "SQLite is an embedded database."
  ],
  "response_format": "json"
}
```

## Privacy and limits

- Images and audio are kept in memory during the request; MyDGX does not
  store them in SQLite or on disk.
- The effective file limit is the smaller of `MULTIMODAL_MAX_UPLOAD_MB` and
  the model's `max_input_mb` limit.
- Only JPEG, PNG, and WebP are accepted for vision, and common audio formats
  for ASR.
- Structured video results are kept in SQLite. Binary outputs
  from the managed ComfyUI are saved with `0600` permissions in
  `data/artifacts`.
- Operations are recorded in the audit log without saving prompts, files,
  tokens, or authorization headers.
- Keep endpoints bound to localhost or protected by authentication; never
  include keys in profiles, code, or documentation.

## Troubleshooting

- **No multimodal models**: there is no active profile or it contains no
  enabled models. Activate it and reload the lab.
- **Service unavailable**: start the profile and check the endpoint in
  **Engines**.
- **Task mismatch**: check the task declared in the profile.
- **File too large or type not allowed**: shrink or convert the
  file and check the model's limit.
- **Adapter required**: the external engine does not speak a supported protocol.
- **Video without result**: check the job again and review
  `mydgx-comfyui.service` and the free space on the volume.
