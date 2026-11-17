import {
  Activity,
  Bot,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Eye,
  Film,
  Gauge,
  Globe,
  HardDrive,
  Image as ImageIcon,
  Info,
  Layers,
  LogOut,
  Menu,
  MessageSquare,
  Mic,
  Moon,
  PackageCheck,
  Pencil,
  Play,
  RefreshCw,
  Rocket,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Star,
  Sun,
  Terminal,
  Thermometer,
  TriangleAlert,
  Trash2,
  Trophy,
  X,
  Zap,
} from "lucide-react";
import { CSSProperties, FormEvent, ReactNode, createElement, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import MarkdownMessage from "./MarkdownMessage";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

type View = "dashboard" | "models" | "benchmarks" | "profiles" | "engines" | "chat" | "multimodal" | "storage" | "system" | "logs" | "settings";
type Theme = "light" | "dark";
type LocalModelFilter = "all" | "loaded" | "text" | "vision" | "audio" | "ollama" | "huggingface" | "compact" | "medium" | "large";
type ModelTask = "chat" | "vision" | "embeddings" | "image-generation" | "asr" | "tts" | "video-generation" | "reranking";
type InputModality = "text" | "image" | "audio" | "video";
type OutputModality = "text" | "image" | "audio" | "video" | "embedding" | "scores";

type Metrics = {
  created_at: string;
  cpu_percent: number;
  memory_percent: number;
  memory_used: number;
  memory_total: number;
  gpu_utilization: number | null;
  gpu_memory_used: number | null;
  gpu_memory_total: number | null;
  gpu_temperature: number | null;
  gpu_power_watts: number | null;
  gpu_power_limit_watts: number | null;
  disk_percent: number;
  disk_used: number;
  disk_total: number;
  disk_read_bytes: number;
  disk_write_bytes: number;
  network_sent: number;
  network_received: number;
};

type ModelMetric = {
  id: number;
  created_at: string;
  profile_id?: string | null;
  model_id: string;
  model_name: string;
  engine: string;
  pid?: number | null;
  attribution: "process" | "ollama" | "external-unattributed";
  cpu_percent?: number | null;
  ram_bytes?: number | null;
  unified_memory_bytes?: number | null;
  gpu_memory_bytes?: number | null;
  gpu_utilization?: number | null;
  active?: boolean;
};

type ModelMetricsResponse = {
  current: ModelMetric[];
  history: ModelMetric[];
  retention_hours: number;
};

type Overview = {
  metrics: Metrics;
  running_profiles?: Array<{ id: string; name: string; app: string; models?: string[] }>;
  web_apps?: WebApp[];
  host: {
    hostname: string;
    platform: string;
    architecture: string;
    os_name: string;
    os_version: string;
    os_id: string;
    os_family: string;
    is_dgx_os: boolean;
    dgx_release: string;
    kernel: string;
    is_dgx_spark: boolean;
    device_variant: "nvidia" | "asus" | "hp" | "lenovo" | "generic" | "other";
    device_vendor: string;
    device_model: string;
    gpu_name: string;
    boot_time: string;
    cpu_count: number;
  };
  services: Record<string, boolean>;
  memory?: Partial<MemoryBreakdown>;
};

type MemoryBreakdown = {
  total: number;
  free: number;
  available: number;
  cache_bytes: number;
  system_bytes: number;
  driver_bytes: number;
  runtimes: Array<{
    kind: string;
    name: string;
    pid: number;
    managed: boolean;
    models: string[];
    bytes: number;
  }>;
};

type Config = {
  app_name: string;
  openwebui_url: string;
  comfyui_url: string;
  dgx_dashboard_url: string;
  hf_token_configured: boolean;
  api_key_required: boolean;
  system_updates_enabled: boolean;
  service_control_enabled: boolean;
  gateway_enabled: boolean;
  gateway_url: string;
  gateway_api_key_configured: boolean;
  assistant_enabled: boolean;
  assistant_model: string;
  benchmark_enabled: boolean;
  benchmark_auto_new_models: boolean;
};

type GatewayConfig = {
  enabled: boolean;
  host: "127.0.0.1" | "0.0.0.0" | "::1" | "::";
  port: number;
  request_timeout_seconds: number;
  max_request_mb: number;
  api_key_configured: boolean;
  endpoint: string;
  anthropic_endpoint: string;
  protocol_adapter: string | null;
  active_profile: string | null;
  aliases: string[];
  models?: GatewayPublishedModel[];
  network_addresses?: string[];
  running: boolean;
};

type GatewayPublishedModel = {
  alias: string;
  full_name: string;
  display_name: string;
  engine: string;
  task: string;
  context_length?: number | null;
};

function GatewayModelList({ gateway, empty }: { gateway: GatewayConfig | null; empty: string }) {
  const models: GatewayPublishedModel[] = gateway?.models?.length
    ? gateway.models
    : (gateway?.aliases ?? []).map((alias) => ({ alias, full_name: alias, display_name: "", engine: "", task: "" }));
  if (!models.length) return <strong>{empty}</strong>;
  return <ul className="gateway-model-list">
    {models.map((model) => <li key={model.alias} title={[model.display_name, model.full_name].filter(Boolean).join(" · ")}>
      <strong>{model.full_name || model.alias}</strong>
      <span>
        <code>model: "{model.alias}"</code>
        {model.engine && <em>{model.engine}</em>}
        {model.task && model.task !== "chat" && <em>{model.task}</em>}
        {model.context_length ? <em>{Math.round(model.context_length / 1024)}k ctx</em> : null}
      </span>
    </li>)}
  </ul>;
}

type ReadinessCheck = {
  id: string;
  label: string;
  category: string;
  status: "ok" | "warning" | "info";
  required: boolean;
  detail: string;
  remediation: string;
};

type Readiness = {
  ready: boolean;
  summary: { ok: number; warnings: number; optional: number; total: number };
  checks: ReadinessCheck[];
  checked_at: string;
};

type SystemIntegrity = {
  supported: boolean;
  healthy: boolean;
  status: "ok" | "warning";
  current_kernel: string;
  latest_kernel: string;
  reboot_required: boolean;
  apt_ok: boolean | null;
  dpkg_ok: boolean | null;
  dkms_ok: boolean | null;
  container_runtime_ok: boolean | null;
  nvidia_ok: boolean | null;
  llama_ok: boolean;
  service_installed: boolean;
  service_enabled: boolean | null;
  service_active: boolean | null;
  repair_available: boolean;
  last_repair: string | null;
  llama_rebuilt: boolean;
  driver_version: string | null;
  cuda_version: string | null;
};

type SystemUpdatePackage = {
  name: string;
  current_version: string;
  candidate_version: string;
  architecture: string;
  repository: string;
  security: boolean;
  category: "kernel" | "nvidia" | "containers" | "runtime" | "system";
  detail: string;
};

type SystemUpdates = {
  supported: boolean;
  packages: SystemUpdatePackage[];
  summary: {
    total?: number;
    security?: number;
    kernel?: number;
    nvidia?: number;
    containers?: number;
    runtime?: number;
    system?: number;
  };
  reboot_required: boolean;
  checked_at: string;
  message: string;
};

type QuickStart = {
  supported: boolean;
  fits: boolean;
  reason: string;
  incremental_mb?: number;
};

type Models = {
  ollama: Array<Record<string, unknown>>;
  running: Array<Record<string, unknown>>;
  runtime_models: Array<{
    name: string;
    model_id: string;
    engine: string;
    runtime: string;
    runtime_version: string;
    size: number;
    estimated: boolean;
  }>;
  assistant_model: string | null;
  huggingface: Array<{
    repo_id: string;
    path: string;
    size: number;
    source: string;
    revisions: Record<string, string>;
    revision: string;
    snapshot_count: number;
    file_count: number;
    formats: string[];
    quantizations: string[];
    configuration: Record<string, string | number | string[]>;
    shard_count: number;
    partial_downloads: number;
    incomplete_shards: number;
    downloaded_at: string;
    persistent: boolean;
    quick: boolean;
    loaded: boolean;
    loaded_by: string[];
    assistant: boolean;
    uncensored?: boolean;
    tasks?: string[];
    pipeline_tag?: string;
    quick_start?: QuickStart;
  }>;
};

function searchStateClass(text: string, resultCount: number | null) {
  if (!text.trim()) return "";
  return resultCount === 0 ? " search-active search-empty" : " search-active";
}

function searchCountLabel(text: string, resultCount: number | null) {
  if (!text.trim() || resultCount === null) return undefined;
  return `${resultCount} ${resultCount === 1 ? "resultado" : "resultados"}`;
}

const UNCENSORED_PATTERN = /uncensored|abliterat|\bablit|heretic|derestrict|unrestrict|unleashed|unfiltered|nsfw|dolphin/i;

function UncensoredBadge({ name, flagged = false }: { name: string; flagged?: boolean }) {
  if (!flagged && !UNCENSORED_PATTERN.test(name)) return null;
  return <span className="badge uncensored" title="Modelo sin filtros de seguridad (uncensored, abliterated o similar), según su nombre o las etiquetas y el modelo base de su ficha">Uncensored</span>;
}

type ModelGlossaryEntry = {
  id: string;
  term: string;
  summary: string;
  category: "Tamaño y precisión" | "Arquitectura y velocidad" | "Uso" | "Formato y runtime" | "Alineación y acceso";
  patterns: RegExp[];
};

const MODEL_GLOSSARY: ModelGlossaryEntry[] = [
  { id: "parameters", term: "7B, 32B, 120B · Parámetros", summary: "Tamaño aproximado del cerebro del modelo. Más parámetros suelen requerir más memoria; no garantizan que sea mejor.", category: "Tamaño y precisión", patterns: [/\b\d+(?:\.\d+)?b\b/i, /parameter/i] },
  { id: "q2-q3", term: "Q2 / Q3", summary: "Cuantización muy comprimida. Ocupa poco y suele ser rápida, pero pierde más calidad.", category: "Tamaño y precisión", patterns: [/\bq[23](?:_[a-z0-9]+)?\b/i, /\biq[23](?:_[a-z0-9]+)?\b/i] },
  { id: "q4-q5", term: "Q4 / Q5", summary: "Equilibrio habitual entre calidad, memoria y velocidad. Q4_K_M suele ser un buen punto de partida.", category: "Tamaño y precisión", patterns: [/\bq[45](?:_[a-z0-9]+)?\b/i, /\biq4(?:_[a-z0-9]+)?\b/i] },
  { id: "q6-q8", term: "Q6 / Q8", summary: "Más fidelidad y mayor consumo. Q8 conserva mucha calidad, pero no siempre mejora lo suficiente para justificar su tamaño.", category: "Tamaño y precisión", patterns: [/\bq[678](?:_[a-z0-9]+)?\b/i, /\bint8\b/i] },
  { id: "k-variants", term: "K_S / K_M / K_L", summary: "Variantes de una cuantización GGUF. S prioriza tamaño, M equilibrio y L algo más de calidad.", category: "Tamaño y precisión", patterns: [/\bq\d+_k_[sml]\b/i, /\bk_[sml]\b/i] },
  { id: "iq", term: "IQ", summary: "Cuantización inteligente de llama.cpp. Busca conservar más calidad con muy pocos bits.", category: "Tamaño y precisión", patterns: [/\biq\d/i] },
  { id: "fp-bf", term: "FP16 / BF16 / FP32", summary: "Pesos con alta precisión. Son fieles, pero ocupan bastante más memoria que una cuantización.", category: "Tamaño y precisión", patterns: [/\bfp(?:16|32)\b/i, /\bbf16\b/i, /float(?:16|32)/i] },
  { id: "fp8-mxfp4", term: "FP8 / MXFP4 / INT4", summary: "Formatos compactos usados por motores GPU. MXFP4 es especialmente interesante para GPT-OSS en el Spark.", category: "Tamaño y precisión", patterns: [/\bfp8\b/i, /\bmxfp4\b/i, /\bint4\b/i] },
  { id: "dense", term: "Dense · Denso", summary: "Activa casi todos sus parámetros en cada token. Es sencillo, pero los modelos grandes pueden ser lentos por el ancho de banda.", category: "Arquitectura y velocidad", patterns: [/\bdense\b/i, /\bdenso\b/i] },
  { id: "moe", term: "MoE · Mixture of Experts", summary: "Tiene muchos parámetros totales, pero usa solo algunos expertos por token. Suele encajar muy bien con DGX Spark.", category: "Arquitectura y velocidad", patterns: [/\bmoe\b/i, /mixture.of.experts/i, /\bexperts?\b/i] },
  { id: "active-parameters", term: "Parámetros activos", summary: "Parte del modelo MoE utilizada para cada token. Explica por qué un modelo enorme puede responder con rapidez.", category: "Arquitectura y velocidad", patterns: [/active.parameters/i, /parámetros activos/i, /\b\d+(?:\.\d+)?b activos\b/i] },
  { id: "mtp", term: "MTP", summary: "Predice varios tokens futuros para acelerar la generación. Necesita soporte del modelo y del motor.", category: "Arquitectura y velocidad", patterns: [/\bmtp\b/i, /multi.token prediction/i] },
  { id: "speculative", term: "Speculative decoding", summary: "Un modelo pequeño propone tokens y el principal los valida. Puede aumentar bastante la velocidad.", category: "Arquitectura y velocidad", patterns: [/speculative/i, /\bdraft model\b/i, /\bdspark\b/i, /\bdflash\b/i] },
  { id: "gqa", term: "GQA / MQA", summary: "Reduce el coste de atención y de la caché KV. Ayuda especialmente con contextos largos.", category: "Arquitectura y velocidad", patterns: [/\bgqa\b/i, /\bmqa\b/i, /grouped.query/i] },
  { id: "flash-attention", term: "Flash Attention", summary: "Implementación de atención más rápida y eficiente en memoria cuando el runtime y la GPU la soportan.", category: "Arquitectura y velocidad", patterns: [/flash.?attention/i, /\bfa2\b/i, /\bfa3\b/i] },
  { id: "kv-cache", term: "KV cache", summary: "Memoria de la conversación ya procesada. Crece con el contexto, los slots y el tamaño del modelo.", category: "Arquitectura y velocidad", patterns: [/\bkv(?:.|_)?cache\b/i] },
  { id: "context", term: "Contexto · 8K / 32K / 128K", summary: "Cantidad máxima de texto que el modelo puede recordar de una petición. Más contexto consume más memoria.", category: "Uso", patterns: [/\bcontext\b/i, /\bcontexto\b/i, /\b\d+k\b/i] },
  { id: "slots", term: "Slots / concurrencia", summary: "Peticiones que el servidor puede atender a la vez. Cada slot añade caché y consumo de memoria.", category: "Uso", patterns: [/\bslots?\b/i, /concurren/i, /parallel/i] },
  { id: "instruct-base", term: "Base / Instruct / Chat", summary: "Base es el modelo sin adaptar; Instruct o Chat está preparado para seguir órdenes y conversar.", category: "Uso", patterns: [/\bbase\b/i, /\binstruct\b/i, /-it\b/i, /\bchat\b/i] },
  { id: "reasoning", term: "Reasoning / Thinking", summary: "Optimizado para resolver problemas paso a paso. Puede ser más capaz, pero también más lento y verboso.", category: "Uso", patterns: [/reasoning/i, /thinking/i, /\breasoner\b/i] },
  { id: "embeddings-reranker", term: "Embeddings / Reranker", summary: "Embeddings convierten texto en vectores; un reranker reordena resultados. No son modelos de chat.", category: "Uso", patterns: [/embedding/i, /rerank/i] },
  { id: "asr-tts", term: "ASR / TTS", summary: "ASR transcribe voz a texto. TTS convierte texto en voz.", category: "Uso", patterns: [/\basr\b/i, /\btts\b/i, /whisper/i, /text.to.speech/i, /speech.to.text/i] },
  { id: "vision-mmproj", term: "Vision / mmproj", summary: "mmproj es el proyector que permite a ciertos GGUF entender imágenes. Debe descargarse junto al modelo.", category: "Uso", patterns: [/mmproj/i, /vision/i, /image.text/i, /multimodal/i] },
  { id: "diffusion", term: "Diffusion / checkpoint", summary: "Familia habitual para generar imagen o vídeo. ComfyUI carga sus checkpoints; no funciona como un chat GGUF.", category: "Uso", patterns: [/diffusion/i, /checkpoint/i, /\bflux\b/i, /wan(?:2|\b)/i] },
  { id: "gguf", term: "GGUF", summary: "Formato preparado para llama.cpp. Es la opción más directa para ejecutar LLM cuantizados localmente.", category: "Formato y runtime", patterns: [/\bgguf\b/i] },
  { id: "safetensors", term: "Safetensors", summary: "Formato seguro de pesos, habitual en Hugging Face. Necesita un runtime compatible como vLLM, ComfyUI o Transformers.", category: "Formato y runtime", patterns: [/safetensors/i] },
  { id: "shards", term: "Shards · partes 00001-of-00004", summary: "Un modelo dividido en varios archivos. Hay que descargar todas las partes de la misma cuantización.", category: "Formato y runtime", patterns: [/shard/i, /\d{5}-of-\d{5}/i] },
  { id: "lora", term: "LoRA / Adapter", summary: "Adaptación pequeña aplicada sobre un modelo base. Por sí sola normalmente no contiene el modelo completo.", category: "Formato y runtime", patterns: [/\blora\b/i, /\badapter\b/i] },
  { id: "awq-gptq", term: "AWQ / GPTQ / EXL2", summary: "Cuantizaciones para runtimes GPU específicos. No son GGUF y requieren un motor compatible.", category: "Formato y runtime", patterns: [/\bawq\b/i, /\bgptq\b/i, /\bexl2\b/i] },
  { id: "runtimes", term: "llama.cpp / Ollama / vLLM / SGLang / TensorRT-LLM", summary: "Son motores que cargan y sirven el modelo. El formato correcto depende del motor elegido.", category: "Formato y runtime", patterns: [/llama\.?cpp/i, /\bollama\b/i, /\bvllm\b/i, /\bsglang\b/i, /tensorrt/i] },
  { id: "uncensored", term: "Uncensored · Sin censura", summary: "Versión comunitaria ajustada para rechazar menos peticiones. No significa que sea oficial, exacta ni libre de límites.", category: "Alineación y acceso", patterns: [/uncensored/i, /uncensor/i, /sin censura/i] },
  { id: "abliterated", term: "Abliterated", summary: "Modelo modificado para reducir mecanismos de rechazo. Puede cambiar su calidad o comportamiento respecto al original.", category: "Alineación y acceso", patterns: [/abliterat/i, /\bablit\b/i] },
  { id: "heretic", term: "Heretic", summary: "Nombre usado por algunas variantes comunitarias con menos rechazos. Revisa siempre autor, pruebas y modelo base.", category: "Alineación y acceso", patterns: [/\bheretic\b/i] },
  { id: "derestricted", term: "Derestricted / No-refusal", summary: "Otra etiqueta para modelos modificados con menos restricciones. No garantiza cero rechazos.", category: "Alineación y acceso", patterns: [/derestrict/i, /no.?refusal/i, /unrestrict/i, /unfiltered/i] },
  { id: "gated", term: "Gated / Restricted", summary: "Hugging Face exige iniciar sesión, aceptar condiciones o pedir acceso antes de descargar.", category: "Alineación y acceso", patterns: [/\bgated\b/i, /\brestricted\b/i] },
];

function glossaryTermsIn(text: string) {
  return MODEL_GLOSSARY.filter((entry) => entry.patterns.some((pattern) => pattern.test(text)));
}

type GlossaryRequest = { title: string; terms: ModelGlossaryEntry[]; parsed: boolean };

function ModelTermsButton({ text, label, onOpen }: { text: string; label: string; onOpen: (request: GlossaryRequest) => void }) {
  const terms = glossaryTermsIn(text);
  return <button
    className="model-term-help"
    type="button"
    title={terms.length ? `Explicar: ${terms.map((term) => term.term).join(", ")}` : "Abrir ayuda de términos de modelos"}
    aria-label={`Explicar términos de ${label}`}
    onClick={(event) => {
      event.preventDefault();
      event.stopPropagation();
      onOpen({ title: label, terms: terms.length ? terms : MODEL_GLOSSARY, parsed: terms.length > 0 });
    }}
  ><CircleHelp size={14} /></button>;
}

function ModelGlossaryDialog({ request, onClose }: { request: GlossaryRequest; onClose: () => void }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
    };
  }, [onClose]);
  const categories = [...new Set(request.terms.map((term) => term.category))];
  return <div className="model-help-overlay" role="dialog" aria-modal="true" aria-label="Ayuda rápida de modelos" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <Card className="model-help-dialog">
      <SectionHeading eyebrow={request.parsed ? "TÉRMINOS DETECTADOS" : "GUÍA RÁPIDA · TL;DR"} title={request.title} action={<button className="icon-button" onClick={onClose} aria-label="Cerrar ayuda"><X size={16} /></button>} />
      <div className="model-help-tldr"><Sparkles size={17} /><p><strong>Regla rápida:</strong> elige un modelo que quepa con margen. Para chat GGUF empieza por Q4_K_M o Q5; usa Q8 si priorizas fidelidad. MoE suele ser rápido en Spark. “Uncensored”, “Heretic” o “Abliterated” describen modificaciones comunitarias, no una garantía de calidad.</p></div>
      {categories.map((category) => <section className="model-help-category" key={category}>
        <h4>{category}</h4>
        <div>{request.terms.filter((term) => term.category === category).map((term) => <article key={term.id}><strong>{term.term}</strong><p>{term.summary}</p></article>)}</div>
      </section>)}
    </Card>
  </div>;
}

function StopAllModelsButton({ notify, onDone }: { notify: (message: string, error?: boolean) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function stopAll() {
    if (!window.confirm("¿Parar todos los modelos? Se apagan todos los perfiles cargados (también Quick) y los modelos que Ollama tenga en memoria. Se mantienen el modelo del chat, el perfil Default y los servicios ComfyUI, TTS y Whisper.")) return;
    setBusy(true);
    try {
      const result = await api<{ stopped_profiles: string[]; released_ollama: string[]; kept_profiles: string[] }>("/api/models/stop-all", { method: "POST" });
      const stopped = [...result.stopped_profiles, ...result.released_ollama];
      notify(stopped.length
        ? `Parados: ${stopped.join(", ")}${result.kept_profiles.length ? ` · siguen: ${result.kept_profiles.join(", ")}` : ""}`
        : "No había modelos que parar; solo quedan el chat, Default y los servicios básicos");
      onDone();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return <button
    className="stop-all-button"
    disabled={busy}
    onClick={() => void stopAll()}
    title="Parar todos los modelos: apaga los perfiles cargados, incluido Quick, y descarga los modelos de Ollama. Se mantienen el modelo del chat, el perfil Default y lo que usan ComfyUI, TTS y Whisper."
  >
    <Square size={13} /> {busy ? "Parando…" : "Parar modelos"}
  </button>;
}

function modelBaseName(repoId: string) {
  return (repoId.split("/").pop() ?? "").toLowerCase().replace(/[-_.](fp8|fp16|bf16|mxfp4|gguf|awq|gptq|mlx|int4|int8)$/g, "").replace(/[^a-z0-9]/g, "");
}

function hfFileGroups(files: HfRemoteFile[]): HfFileGroup[] {
  const groups = new Map<string, HfFileGroup>();
  for (const file of files) {
    const lower = file.name.toLowerCase();
    const gguf = lower.endsWith(".gguf");
    const mmproj = /(?:^|[/_.-])mmproj(?:[/_.-]|$)/i.test(file.name);
    const auxiliary = !gguf || /(?:^|[/_.-])imatrix(?:[/_.-]|$)/i.test(file.name);
    const kind: HfFileGroup["kind"] = auxiliary ? "auxiliary" : mmproj ? "mmproj" : "weights";
    const shardBase = file.name.replace(/-\d{5}-of-\d{5}(?=\.gguf$)/i, "");
    const id = kind === "auxiliary" ? "auxiliary" : `${kind}:${shardBase}`;
    const fallback = shardBase.split("/").pop()?.replace(/\.gguf$/i, "") || "GGUF";
    const detectedQuantization = file.name.match(
      /(?:^|[._/-])((?:UD-)?Q[2-8](?:_[A-Z0-9]+)*|IQ[1-4](?:_[A-Z0-9]+)*|MXFP4|BF16|F16|FP16)(?=[._/-]|$)/i,
    )?.[1]?.toUpperCase();
    const label = kind === "auxiliary"
      ? "Archivos auxiliares"
      : kind === "mmproj"
        ? `Visión · ${detectedQuantization || file.quantization || fallback}`
        : detectedQuantization || file.quantization || fallback;
    const group = groups.get(id) ?? {
      id,
      label,
      kind,
      files: [],
      size: 0,
      sizeKnown: true,
    };
    group.files.push(file);
    if (typeof file.size === "number") group.size += file.size;
    else group.sizeKnown = false;
    groups.set(id, group);
  }
  const preferred = ["Q4_K_M", "Q5_K_M", "Q6_K", "Q4_K_S", "Q5_K_S", "Q4_0", "IQ4_XS", "IQ4_NL", "Q3_K_M", "Q8_0", "Q3_K_S", "Q2_K"];
  const rank = (group: HfFileGroup) => {
    const exact = preferred.indexOf(group.label.toUpperCase());
    return exact >= 0 ? exact : preferred.length + group.label.localeCompare("Q4");
  };
  return [...groups.values()].sort((a, b) => (
    ({ weights: 0, mmproj: 1, auxiliary: 2 })[a.kind] - ({ weights: 0, mmproj: 1, auxiliary: 2 })[b.kind]
    || rank(a) - rank(b)
    || a.label.localeCompare(b.label)
  ));
}

function quantizationHint(label: string) {
  const upper = label.toUpperCase();
  const quality = upper.includes("BF16") || upper.includes("F16")
    ? "Precisión completa · enorme"
    : upper.includes("Q8")
      ? "Máxima fidelidad · grande"
      : upper.includes("Q6")
        ? "Calidad muy alta"
        : upper.includes("Q5")
          ? "Alta calidad"
          : upper.includes("Q4") || upper.includes("IQ4")
            ? "Equilibrio recomendado"
            : upper.includes("Q3") || upper.includes("IQ3")
              ? "Compacta"
              : upper.includes("Q2") || upper.includes("IQ2")
                ? "Muy compacta"
                : upper.includes("IQ1")
                  ? "Mínimo tamaño · menor calidad"
                  : "Variante del modelo";
  const variant = /_(?:S|XS|XXS)(?:$|[_.-])/.test(upper)
    ? "prioriza tamaño"
    : /_(?:M)(?:$|[_.-])/.test(upper)
      ? "equilibrada"
      : /_(?:L|XL|NL)(?:$|[_.-])/.test(upper)
        ? "prioriza calidad"
        : "";
  return `${quality}${variant ? ` · ${variant}` : ""}`;
}

function recommendedHfFiles(inspection: HfInspection) {
  const groups = hfFileGroups(inspection.remote?.files ?? []);
  const weights = groups.find((group) => (
    group.kind === "weights"
    && group.sizeKnown
    && group.size <= inspection.download_limit_bytes
    && group.files.some((file) => !file.downloaded)
  ));
  if (!weights) return [];
  const selected = weights.files.filter((file) => !file.downloaded).map((file) => file.name);
  if (inspection.remote?.input_modalities.includes("image")) {
    const projector = groups.find((group) => (
      group.kind === "mmproj"
      && group.sizeKnown
      && group.files.some((file) => !file.downloaded)
      && group.size + weights.size <= inspection.download_limit_bytes
    ));
    if (projector) selected.push(...projector.files.filter((file) => !file.downloaded).map((file) => file.name));
  }
  return selected;
}

function unsupportedQuickStartReason(category: string) {
  if (category === "Voz / audio") return "Modelo de voz: lo cargan el servicio TTS, Whisper o el Laboratorio IA cuando lo usan; no se enciende como modelo de chat";
  if (category === "Imagen" || category === "Vídeo") return "Modelo de imagen o vídeo: ComfyUI lo carga al generar y desde aquí puedes liberarlo; no se enciende como modelo de chat";
  if (category === "Embeddings") return "Modelo de embeddings: lo cargan los servicios que lo usan; no se enciende como modelo de chat";
  return "Solo tiene pesos safetensors o PyTorch: Encender usa llama.cpp y necesita un GGUF. Descarga una versión GGUF o crea un perfil con un motor compatible";
}

function QuickStartButton({ label, availability, busy, pending, title, onStart, unsupportedReason }: {
  label: string;
  availability?: QuickStart;
  busy: boolean;
  pending: boolean;
  title: string;
  onStart: () => void;
  unsupportedReason?: string;
}) {
  if (unsupportedReason || (availability && !availability.supported)) {
    return <button className="button secondary compact no-fit" disabled title={unsupportedReason || availability?.reason || "Este modelo no se puede encender desde aquí"} aria-label={`${label} no se puede encender aquí`}><Play size={13} /> No disponible</button>;
  }
  if (availability && !availability.fits) {
    return <button className="button secondary compact no-fit" disabled title={availability.reason || "No cabe junto a lo que ya está cargado"} aria-label={`${label} no cabe ahora`}><Play size={13} /> No cabe ahora</button>;
  }
  const extra = availability?.incremental_mb ? ` · ocupará unos ${(availability.incremental_mb / 1024).toFixed(1)} GB` : "";
  return <button className="button primary compact" disabled={busy} onClick={onStart} title={`${title}${extra}`} aria-label={`Encender ${label}`}><Play className={pending ? "spin" : ""} size={13} /> {pending ? "Encendiendo…" : "Encender"}</button>;
}

type Job = {
  id: string;
  kind: string;
  target: string;
  status: string;
  progress: number;
  message: string;
  cancel_requested: number;
  created_at: string;
  events?: JobEvent[];
};

type JobEvent = {
  id: number;
  job_id: string;
  status: string;
  progress: number;
  message: string;
  created_at: string;
};

type BenchmarkSummary = {
  sample_count: number;
  valid_sample_count: number;
  reliability_percent: number;
  ttft_ms?: { p50?: number | null; p95?: number | null };
  total_ms: { mean?: number | null; p50?: number | null; p95?: number | null };
  output_tokens_per_second?: {
    mean?: number | null;
    p50?: number | null;
    coefficient_of_variation?: number | null;
  };
  characters_per_second?: { mean?: number | null };
  resources?: {
    average_gpu_power_watts?: number | null;
    max_gpu_power_watts?: number | null;
    max_gpu_memory_bytes?: number | null;
    max_memory_bytes?: number | null;
    max_gpu_temperature_c?: number | null;
    average_gpu_utilization?: number | null;
    joules_per_output_token?: number | null;
  };
  cases?: Record<string, {
    samples: number;
    valid_samples: number;
    ttft_ms_p50?: number | null;
    output_tokens_per_second_mean?: number | null;
    coefficient_of_variation?: number | null;
    early_stops: number;
  }>;
  score: number;
  score_provisional: boolean;
  duration_seconds?: number | { mean?: number | null };
  real_time_factor?: { mean?: number | null; p50?: number | null };
  word_error_rate?: number | null;
  character_error_rate?: number | null;
  image_validation?: {
    png_integrity_percent?: number | null;
    expected_resolution_percent?: number | null;
    pixel_reproducibility_percent?: number | null;
    method?: string;
  };
  items_per_second?: { mean?: number | null };
  semantic_quality?: {
    pair_accuracy?: number | null;
    mean_margin?: number | null;
  };
  ranking_quality?: {
    ndcg_mean?: number | null;
    mrr_mean?: number | null;
  };
  output_size_bytes?: { mean?: number | null };
  video_validation?: {
    container_integrity_percent?: number | null;
    expected_dimensions_percent?: number | null;
    expected_temporal_extent_percent?: number | null;
    exact_reproducibility_percent?: number | null;
    perceptual_reproducibility_percent?: number | null;
    metadata_method?: string;
    quality_claim?: string;
  };
  vision_quality?: {
    normalized_concept_recall?: number | null;
    method?: string;
    fixture_sha256?: string;
  };
  audio_validation?: {
    integrity_percent?: number | null;
    formats?: string[];
    sample_rates_hz?: number[];
  };
  intelligibility?: {
    available?: boolean;
    word_error_rate?: number | null;
    method?: string;
    quality_claim?: string;
  };
  score_dimensions: Record<string, number | null>;
  score_algorithm: string;
};

type BenchmarkQueueEntry = {
  id: string;
  target: string;
  reason: string;
  status: "pending" | "running" | "done" | "skipped" | "expired" | "failed";
  attempts: number;
  last_reason: string;
  job_id?: string | null;
  created_at: string;
  updated_at: string;
};

type BenchmarkSuiteItem = {
  position: number;
  candidate_key: string;
  target: string;
  model_name: string;
  engine: string;
  protocol_id: string;
  modality: string;
  artifact_hash: string;
  artifact_size?: number | null;
  profile_id: string;
  model_id: string;
  status: "pending" | "loading" | "running" | "completed" | "skipped" | "failed" | "cancelled";
  run_id?: string | null;
  error: string;
  started_at?: string | null;
  completed_at?: string | null;
};

type BenchmarkSuite = {
  id: string;
  job_id: string;
  status: "queued" | "running" | "restoring" | "completed" | "cancelled" | "failed" | "interrupted";
  repetitions: number;
  total_models: number;
  completed_models: number;
  current_position?: number | null;
  current_target: string;
  current_child_job_id?: string | null;
  error: string;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  items: BenchmarkSuiteItem[];
};

type BenchmarkSuiteCandidate = {
  candidate_key: string;
  target: string;
  name: string;
  engine: string;
  protocol_id: string;
  modality: string;
  source: string;
  artifact_hash: string;
  artifact_size?: number | null;
  artifact_size_estimated?: boolean;
  profile_id: string;
  model_id: string;
  measured: boolean;
  suite_completed?: boolean;
  runnable?: boolean;
  blocked_reason?: string;
  variant?: string;
};

type BenchmarkRun = {
  id: string;
  job_id: string;
  protocol_id: string;
  model_id: string;
  environment_id: string;
  target: string;
  runtime_hash: string;
  score_algorithm: string;
  score?: number | null;
  status: string;
  valid: number;
  invalid_reason: string;
  imported: number;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  source: string;
  source_id: string;
  revision: string;
  filename: string;
  artifact_hash: string;
  artifact_size?: number | null;
  quantization: string;
  architecture: string;
  protocol_name: string;
  protocol_version: number;
  environment_hash: string;
  summary: Partial<BenchmarkSummary>;
  runtime: Record<string, unknown>;
  hardware: Record<string, unknown>;
  model_info?: BenchmarkModelInfo;
};

type BenchmarkModelInfo = {
  name: string;
  author: string;
  task: string;
  pipeline_tag: string;
  license: string;
  base_model: string;
  languages: string[];
  library: string;
  downloads?: number | null;
  likes?: number | null;
  tags: string[];
  parameters_b?: number | null;
  active_parameters_b?: number | null;
  estimated_memory_mb?: number | null;
  input_modalities: string[];
  output_modalities: string[];
  summary: string;
};

type BenchmarkDetail = BenchmarkRun & {
  benchmark_model_id: string;
  metadata: Record<string, unknown>;
  card_text: string;
  software: Record<string, unknown>;
  definition: Record<string, unknown>;
  definition_hash: string;
  samples: Array<{
    id: number;
    case_id: string;
    phase: string;
    repetition: number;
    started_at: string;
    ttft_ms?: number | null;
    total_ms: number;
    prompt_tokens?: number | null;
    output_tokens?: number | null;
    output_tps?: number | null;
    chars_per_second?: number | null;
    output_chars: number;
    valid: number;
    error: string;
    native_metrics?: Record<string, unknown>;
  }>;
  telemetry: Array<{
    id: number;
    created_at: string;
    cpu_percent?: number | null;
    memory_used?: number | null;
    gpu_utilization?: number | null;
    gpu_memory_used?: number | null;
    gpu_temperature?: number | null;
    gpu_power_watts?: number | null;
  }>;
};

type BenchmarksResponse = {
  enabled: boolean;
  auto_new_models: boolean;
  quiet_seconds: number;
  queue: BenchmarkQueueEntry[];
  suite?: BenchmarkSuite | null;
  suite_history: BenchmarkSuite[];
  suite_candidates: BenchmarkSuiteCandidate[];
  active: boolean;
  active_job_id?: string | null;
  protocols: Array<{ id: string; version: number; name: string; modality: string; definition_hash: string; active: number }>;
  eligible_targets: Array<{
    target: string;
    name: string;
    engine: string;
    source: string;
    profile_id?: string;
    loaded: boolean;
    protocol_id?: string;
    modality?: string;
  }>;
  runs: BenchmarkRun[];
  score_algorithm: string;
};

type SystemLogEntry = {
  id: number;
  created_at: string;
  level: "debug" | "info" | "warning" | "error" | "critical";
  category: string;
  action: string;
  message: string;
  entity_type: string;
  entity_id: string;
  job_id: string | null;
  detail: Record<string, unknown>;
};

type SystemLogsResponse = {
  entries: SystemLogEntry[];
  summary: Partial<Record<SystemLogEntry["level"], number>>;
  categories: string[];
  retention_days: number;
  has_more: boolean;
};

const activeJobStatuses = new Set(["queued", "running", "cancelling"]);

function jobLabel(kind: string): string {
  return ({
    "profile.prepare-start": "Preparando perfil",
    "profile.download": "Descargando modelo del perfil",
    "ollama.pull": "Descargando modelo Ollama",
    "ollama.update": "Actualizando modelo Ollama",
    "huggingface.download": "Descargando repositorio Hugging Face",
    "huggingface.files.download": "Descargando archivos Hugging Face",
    "huggingface.integrity": "Verificando modelo Hugging Face",
    "multimodal.video": "Generando vídeo",
    "benchmark.run": "Ejecutando benchmark",
    "benchmark.suite": "Suite de benchmarks",
    "benchmark.import": "Importando benchmark",
    "system.update": "Actualizando el sistema",
    "system.repair": "Verificando y reparando el sistema",
  } as Record<string, string>)[kind] || kind.replaceAll(".", " · ");
}

function jobStatusLabel(status: string): string {
  return ({
    queued: "En cola",
    running: "En curso",
    cancelling: "Cancelando",
    cancelled: "Cancelada",
    completed: "Completada",
    failed: "Fallida",
  } as Record<string, string>)[status] || status;
}

function jobTarget(job: Job): string {
  if (job.kind === "profile.prepare-start" || ["apt", "runtime"].includes(job.target)) return "";
  return job.target;
}

function jobNextStep(job: Job): string {
  if (job.status === "queued") return "A continuación: MyDGX iniciará la operación.";
  if (job.kind === "profile.prepare-start") {
    const message = job.message.toLocaleLowerCase();
    if (message.includes("arrancando")) return "Ahora espera que cada modelo responda correctamente.";
    if (message.includes("comprobando archivos")) return "A continuación activará el perfil y arrancará sus modelos.";
    if (message.includes("preparando") || message.includes("descarg")) return "Después verificará archivos, memoria y puertos antes de arrancar.";
    return "MyDGX seguirá preparando los modelos habilitados del perfil.";
  }
  if (job.kind === "benchmark.suite") {
    if (job.message.toLocaleLowerCase().includes("restaur")) {
      return "MyDGX volverá a cargar los perfiles y residentes capturados al inicio.";
    }
    return "Después liberará la memoria y continuará con el siguiente modelo pendiente.";
  }
  if (job.kind.startsWith("huggingface") || job.kind.startsWith("ollama")) {
    return "Al terminar, MyDGX verificará que el modelo haya quedado disponible.";
  }
  if (job.kind === "system.update" || job.kind === "system.repair") {
    return "Después comprobará la integridad de paquetes, kernel y runtimes.";
  }
  return "MyDGX continuará con la siguiente etapa y registrará aquí el resultado.";
}

function SidebarOperations({ jobs }: { jobs: Job[] }) {
  const active = jobs.filter((job) => activeJobStatuses.has(job.status)).slice(0, 2);
  if (!active.length) return null;
  return (
    <section className="sidebar-operations" aria-label="Operaciones en curso">
      <div className="sidebar-operations-title"><Activity size={12} /><span>EN CURSO</span><strong>{active.length}</strong></div>
      {active.map((job) => (
        <div className={`sidebar-operation ${job.kind === "benchmark.suite" ? "benchmark-suite-operation" : ""}`} key={job.id}>
          <div>
            <RefreshCw size={12} className="spin" />
            <span><strong>{jobLabel(job.kind)}</strong><small>{job.message}</small></span>
            <b>{Math.round(job.progress)}%</b>
          </div>
          <div className="sidebar-operation-progress"><span style={{ width: `${job.progress}%` }} /></div>
        </div>
      ))}
    </section>
  );
}

function ActivitySummary({ jobs }: { jobs: Job[] }) {
  const active = jobs.filter((job) => activeJobStatuses.has(job.status));
  const eventLog = jobs
    .flatMap((job) => (job.events?.length ? job.events : [{
      id: 0,
      job_id: job.id,
      status: job.status,
      progress: job.progress,
      message: job.message,
      created_at: job.created_at,
    }]).map((event) => ({ job, event })))
    .sort((left, right) => (
      new Date(right.event.created_at).getTime() - new Date(left.event.created_at).getTime()
      || right.event.id - left.event.id
    ))
    .slice(0, 12);
  return (
    <Card className="activity-summary">
      <div className="activity-summary-head">
        <div>
          <span className="card-kicker"><Terminal size={15} /> Registro de actividad</span>
          <small>Operaciones principales realizadas por MyDGX y su estado actual.</small>
        </div>
        <span className={`activity-count ${active.length ? "live" : ""}`}>{active.length ? `${active.length} en curso` : "En reposo"}</span>
      </div>
      {active.length > 0 && <div className="activity-current">
        {active.slice(0, 3).map((job) => <div key={job.id}>
          <RefreshCw size={16} className="spin" />
          <span><strong>{jobLabel(job.kind)} · {Math.round(job.progress)}%</strong><small>{job.message}</small><em>{jobNextStep(job)}</em></span>
        </div>)}
      </div>}
      {eventLog.length ? <div className="activity-log">
        {eventLog.map(({ job, event }) => {
          const latestEventId = Math.max(0, ...(job.events ?? []).map((item) => item.id));
          const eventActive = activeJobStatuses.has(job.status) && event.id === latestEventId;
          const pastStep = !eventActive && activeJobStatuses.has(event.status);
          const failed = event.status === "failed";
          return <div className={`activity-log-row ${eventActive ? "active" : ""} ${pastStep ? "step" : ""} ${failed ? "failed" : ""}`} key={`${job.id}:${event.id}`}>
            <div className="activity-log-icon">
              {eventActive ? <RefreshCw size={14} className="spin" /> : failed ? <TriangleAlert size={14} /> : pastStep ? <ChevronRight size={14} /> : <CheckCircle2 size={14} />}
            </div>
            <div className="activity-log-copy">
              <div><strong>{jobLabel(job.kind)}</strong>{jobTarget(job) && <code>{jobTarget(job)}</code>}</div>
              <small>{event.message || jobStatusLabel(event.status)}</small>
            </div>
            <div className="activity-log-meta">
              <strong>{eventActive || pastStep ? `${Math.round(event.progress)}%` : jobStatusLabel(event.status)}</strong>
              <small>{new Date(event.created_at).toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</small>
            </div>
          </div>;
        })}
      </div> : <div className="activity-log-empty"><Activity size={18} /><span>Todavía no hay operaciones registradas.</span></div>}
    </Card>
  );
}

type ServingEngine = {
  id: string;
  name: string;
  binary?: string | null;
  endpoint?: string | null;
  installed: boolean;
  reachable: boolean;
  version?: string | null;
  managed: boolean;
  controllable: boolean;
  essential: boolean;
  running: boolean;
  capabilities: string[];
  models: string[];
  containers?: Array<Record<string, unknown>>;
};

type HfRemoteFile = {
  name: string;
  size?: number | null;
  lfs_sha256?: string | null;
  quantization?: string | null;
  downloaded?: boolean;
};

type HfFileGroup = {
  id: string;
  label: string;
  kind: "weights" | "mmproj" | "auxiliary";
  files: HfRemoteFile[];
  size: number;
  sizeKnown: boolean;
};

type HfInspection = {
  repo_id: string;
  description: string;
  description_source: "huggingface_readme" | "generated_public_metadata" | "";
  description_revision: string;
  description_fetched_at?: string | null;
  download_limit_bytes: number;
  remote_error?: string | null;
  remote?: {
    revision: string;
    gated: boolean;
    private: boolean;
    license?: string | null;
    pipeline_tag?: string | null;
    tasks: string[];
    input_modalities: string[];
    output_modalities: string[];
    formats: string[];
    recommended_engines: string[];
    files: HfRemoteFile[];
  } | null;
  local?: {
    refs: Record<string, string>;
    partials: Array<{ name: string; size: number }>;
    quantizations: string[];
    shards: Array<{ name: string; expected: number; present: number[]; missing: number[]; complete: boolean }>;
    snapshots: Array<{ commit: string; size: number; complete: boolean; files: Array<Record<string, unknown>> }>;
  } | null;
};

type HfRecommendation = {
  id: string;
  gguf_search?: string;
  downloads: number;
  likes: number;
  trending_score: number;
  community_score: number;
  community_signals: {
    download_points: number;
    like_points: number;
    trending_points: number;
  };
  pipeline_tag?: string | null;
  tags: string[];
  private: boolean;
  gated: boolean;
  updated_at?: string | null;
  tasks: string[];
  input_modalities: string[];
  output_modalities: string[];
  formats: string[];
  recommended_engines: string[];
  license?: string | null;
  recommended_score: number;
  recommendation_status: "Ideal" | "Compatible" | "Ajustado" | "No recomendado";
  recommended_quantization?: string | null;
  recommended_file?: string | null;
  recommended_files: string[];
  recommended_mmproj_file?: string | null;
  recommended_context: number;
  recommended_slots: number;
  architecture: "MoE" | "Dense";
  is_moe: boolean;
  total_parameters_b?: number | null;
  active_parameters_b?: number | null;
  active_parameter_ratio: number;
  active_weight_mb: number;
  speculative_methods: string[];
  speculative_memory_mb: number;
  estimated_tokens_per_second: number;
  spark_count: number;
  memory_bandwidth_gbps: number;
  estimated_memory_mb: number;
  weight_mb: number;
  kv_cache_mb: number;
  memory_budget_mb: number;
  memory_available_mb: number;
  runtime_requirement: string;
  fits: boolean;
  reasons: string[];
  warnings: string[];
  artifex_verified: boolean;
  uncensored: boolean;
  hft_catalog?: {
    url: string;
    uncensored_iq?: number | null;
    reasoning?: number | null;
    answers?: string | null;
    author?: string;
    base_model?: string;
    summary?: string;
  } | null;
};

type HfSearchResult = HfRecommendation & {
  favorited_at?: string | null;
};

type ModelConfig = {
  engine: "llama.cpp" | "ollama" | "vllm" | "sglang" | "tensorrt-llm" | "openai-compatible" | "comfyui" | "diffusers" | "whisper" | "riva" | "nvidia-nim";
  model_ref: string;
  model_file: string;
  model_repo: string;
  model_filename: string;
  model_files: string[];
  mmproj_file: string;
  mmproj_repo: string;
  mmproj_filename: string;
  model_alias: string;
  port: number;
  context_size: number;
  gpu_layers: number;
  threads: number;
  parallel: number;
  batch_size: number;
  ubatch_size: number;
  temperature: number;
  top_p: number;
  top_k: number;
  min_p: number;
  repeat_penalty: number;
  presence_penalty: number;
  flash_attention: number;
  cache_type_k: "" | "f16" | "q8_0" | "q4_0";
  cache_type_v: "" | "f16" | "q8_0" | "q4_0";
  reasoning_off: number;
  reasoning_effort: "" | "low" | "medium" | "high";
  kv_unified_per_slot: number;
  jinja: number;
  min_free_memory_mb: number;
  source: string;
  runtime_requirement: string;
  task: ModelTask;
  input_modalities: InputModality[];
  output_modalities: OutputModality[];
  runtime_backend: "native" | "external" | "compose";
  endpoint_url: string;
  api_protocol: "openai" | "ollama" | "comfyui" | "tts-lab" | "voice-agent" | "ragkit" | "security-app";
  estimated_memory_mb: number;
  max_input_mb: number;
  timeout_seconds: number;
  enabled: boolean;
};

type ProfileModel = ModelConfig & {
  id: string;
  name: string;
  downloaded: boolean;
};

type Profile = ModelConfig & {
  id: string;
  name: string;
  model_files: string[];
  additional_models: ProfileModel[];
  models: ProfileModel[];
  memory_reserve_mb: number;
  auto_fit_context: number;
  minimum_context_size: number;
  app: string;
  read_only?: boolean;
  memory_plan: {
    required_mb: number;
    reserve_mb: number;
    capacity_mb: number;
    available_mb: number;
    fits: boolean;
    duplicate_ports: number[];
  };
  runtime_plan?: {
    fits: boolean;
    required_mb: number;
    incremental_mb: number;
    reserve_mb: number;
    capacity_mb: number;
    available_mb: number;
    alias_conflicts: string[];
    port_conflicts: number[];
  };
  runs: Array<{ model_id: string; status: string; effective_context?: number; detail: string }>;
  downloaded: boolean;
  favorite: number;
  active: number;
};

type ProfilesResponse = {
  profiles: Profile[];
  runtime: {
    running: boolean;
    profile_id: string | null;
    profile_ids: string[];
    running_models: number;
    models: Array<{ profile_id?: string | null; model_id: string; running: boolean; shared?: boolean; effective_context?: number }>;
    boot_restore?: { state: "idle" | "restoring" | "done"; pending: string[]; errors: string[] };
  };
  autostart_enabled: boolean;
  llama_cpp_available: boolean;
  apps: {
    root: string;
    available: string[];
    states: Record<string, ProfileAppState>;
    web?: Record<string, { alias: string; port: number; url: string }>;
  };
};

type WebApp = {
  name: string;
  alias: string;
  port: number;
  url: string;
  state: ProfileAppState["state"];
  reachable: boolean;
};

function WebAppButton({ app }: { app: WebApp }) {
  const ready = app.state === "running" && app.reachable;
  const title = ready
    ? `${app.name} en 127.0.0.1:${app.port}`
    : app.state === "running"
      ? `${app.name} está en marcha pero no responde en el puerto ${app.port}`
      : `${app.name} se está preparando`;
  return (
    <a className={`button secondary web-app-link ${ready ? "" : "pending"}`} href={webAppHref(app)} target="_blank" rel="noreferrer" title={title}>
      {app.alias} <small>:{app.port}</small> <Rocket size={15} />
    </a>
  );
}

function webAppHref(app: WebApp) {
  return `http://${window.location.hostname || "127.0.0.1"}:${app.port}/`;
}

type ProfileAppState = {
  state: "starting" | "running" | "stopping" | "stopped" | "error";
  message: string;
  profiles: string[];
  updated_at: string;
};

const profileAppStateLabels: Record<ProfileAppState["state"], string> = {
  starting: "Arrancando",
  running: "En marcha",
  stopping: "Deteniendo",
  stopped: "Parada",
  error: "Error",
};

const QUICK_PROFILE_ID = "mydgx-quick";
const MANAGED_PROFILE_IDS = new Set(["mydgx-default", QUICK_PROFILE_ID]);

const navItems: Array<{ id: View; label: string; icon: typeof Gauge }> = [
  { id: "dashboard", label: "Resumen", icon: Gauge },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "models", label: "Modelos", icon: Boxes },
  { id: "profiles", label: "Perfiles", icon: SlidersHorizontal },
  { id: "benchmarks", label: "Benchmarks", icon: Activity },
  { id: "storage", label: "Almacenamiento", icon: HardDrive },
  { id: "engines", label: "Motores", icon: Cpu },
  { id: "multimodal", label: "Laboratorio IA", icon: Sparkles },
  { id: "settings", label: "Configuración", icon: Settings },
  { id: "system", label: "Sistema", icon: Server },
  { id: "logs", label: "Logs", icon: Terminal },
];

const taskOptions: Array<{ id: ModelTask; label: string; input: InputModality[]; output: OutputModality[] }> = [
  { id: "chat", label: "Chat / texto", input: ["text"], output: ["text"] },
  { id: "vision", label: "Visión", input: ["text", "image"], output: ["text"] },
  { id: "embeddings", label: "Embeddings", input: ["text"], output: ["embedding"] },
  { id: "image-generation", label: "Generación de imagen", input: ["text"], output: ["image"] },
  { id: "asr", label: "Audio a texto (ASR)", input: ["audio"], output: ["text"] },
  { id: "tts", label: "Texto a audio (TTS)", input: ["text"], output: ["audio"] },
  { id: "video-generation", label: "Generación de vídeo", input: ["text"], output: ["video"] },
  { id: "reranking", label: "Reranking", input: ["text"], output: ["scores"] },
];

const engineOptions: ModelConfig["engine"][] = [
  "llama.cpp", "ollama", "vllm", "sglang", "tensorrt-llm",
  "openai-compatible", "comfyui", "diffusers", "whisper", "riva", "nvidia-nim",
];

function deviceBranding(host: Overview["host"]) {
  return ({
    nvidia: { logo: "/brand/nvidia.svg", product: "/brand/dgx-spark.png", label: "NVIDIA DGX SPARK", subtitle: "PERSONAL AI SUPERCOMPUTER" },
    asus: { logo: "/brand/asus-logo.png", product: "/brand/asus-ascent-gx10.png", label: "ASUS ASCENT GX10", subtitle: "DESKTOP AI SUPERCOMPUTER" },
    hp: { logo: "/brand/hp-logo.svg", product: "/brand/hp-zgx-nano.png", label: "HP ZGX NANO G1N", subtitle: "AI STATION" },
    lenovo: { logo: "/brand/lenovo-logo.svg", product: "/brand/lenovo-thinkstation-pgx.png", label: "LENOVO THINKSTATION PGX", subtitle: "AI DEVELOPMENT WORKSTATION" },
    generic: { logo: "/brand/nvidia.svg", product: "", label: host.device_model, subtitle: "NVIDIA GB10 PLATFORM" },
    other: { logo: "", product: "", label: host.device_model, subtitle: "AI SYSTEM" },
  }[host.device_variant] ?? { logo: "", product: "", label: host.device_model, subtitle: "NVIDIA GB10 PLATFORM" });
}

function getApiKey() {
  return sessionStorage.getItem("mydgx-api-key") || "";
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const key = getApiKey();
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "X-MyDGX-Key": key } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    if (response.status === 401 && response.headers.get("X-MyDGX-Auth-Required") === "password") {
      window.dispatchEvent(new Event("mydgx-auth-required"));
    }
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }
  return response.json();
}

async function apiBlob(path: string): Promise<Blob> {
  const key = getApiKey();
  const response = await fetch(path, {
    headers: key ? { "X-MyDGX-Key": key } : {},
  });
  if (!response.ok) {
    if (response.status === 401 && response.headers.get("X-MyDGX-Auth-Required") === "password") {
      window.dispatchEvent(new Event("mydgx-auth-required"));
    }
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }
  return response.blob();
}

function bytes(value?: number | null) {
  if (value == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(amount >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function huggingFaceModelName(repoId: string) {
  return repoId.split("/").filter(Boolean).at(-1) || repoId;
}

type LocalModelSpec = { label: string; value?: string | number | null; title?: string };

function localModelCategoryHint(source: "ollama" | "huggingface", model: Record<string, unknown>): string {
  const configuration = (model.configuration ?? {}) as Record<string, unknown>;
  const details = (model.details ?? {}) as Record<string, unknown>;
  return [
    source === "ollama" ? model.name : model.repo_id,
    Array.isArray(model.tasks) ? model.tasks.join(" ") : "",
    model.pipeline_tag,
    JSON.stringify(configuration.architectures ?? ""),
    configuration.model_type,
    details.family,
    JSON.stringify(details.families ?? ""),
    JSON.stringify(model.capabilities ?? ""),
  ].filter(Boolean).join(" ");
}

function localModelCategory(searchable: string): { label: string; icon: typeof Gauge; color: string } {
  const text = searchable.toLowerCase();
  if (/(audio|voice|speech|whisper|tts|asr|wav2vec|bark|vocos|vocoder|snac|encodec|chatterbox|kokoro|xtts|parler|\d+khz)/.test(text)) return { label: "Voz / audio", icon: Mic, color: "#3e8fdc" };
  if (/(wan2|wan_2|ltx|video|text-to-video|image-to-video)/.test(text)) return { label: "Vídeo", icon: Film, color: "#9b66db" };
  if (/(flux|diffusion|sdxl|sd3|hidream|image-gen|qwen-image|text-to-image)/.test(text)) return { label: "Imagen", icon: ImageIcon, color: "#c05bd6" };
  if (/(vision|llava|[-_.]vl\b|[-_.]vl[-_.]|clip|siglip|mmproj)/.test(text)) return { label: "Visión", icon: Eye, color: "#e09a2b" };
  if (/(embed|rerank|bge|e5-|gte-|sentence-transformers|minilm|mpnet)/.test(text)) return { label: "Embeddings", icon: Layers, color: "#2fb3a3" };
  if (/(coder|code)/.test(text)) return { label: "Código", icon: Terminal, color: "#68b929" };
  return { label: "Texto", icon: MessageSquare, color: "#68b929" };
}

const LOCAL_MODEL_SECTIONS = [
  { key: "text", sourceLabel: "Texto", title: "Chat y texto", managed: false },
  { key: "code", sourceLabel: "Código", title: "Código", managed: false },
  { key: "vision", sourceLabel: "Visión", title: "Chat con visión", managed: false },
  { key: "embeddings", sourceLabel: "Embeddings", title: "Embeddings y reranking", managed: false },
  { key: "image", sourceLabel: "Imagen", title: "Generación de imagen", managed: true },
  { key: "video", sourceLabel: "Vídeo", title: "Generación de vídeo", managed: true },
  { key: "audio", sourceLabel: "Voz / audio", title: "Voz y audio", managed: true },
] as const;

function parametersFromName(name: string): string {
  const moe = name.match(/(\d+(?:\.\d+)?)B[-_ ]A(\d+(?:\.\d+)?)B/i);
  if (moe) return `${moe[1]}B · ${moe[2]}B activos`;
  const dense = name.match(/(?:^|[-_ :.])(\d+(?:\.\d+)?)([BM])(?=$|[-_ .])/i);
  return dense ? `${dense[1]}${dense[2].toUpperCase()}` : "";
}

function contextLabel(value: unknown): string {
  const tokens = Number(value);
  if (!Number.isFinite(tokens) || tokens <= 0) return "";
  return tokens >= 1024 ? `${Math.round(tokens / 1024)}K tokens` : `${tokens} tokens`;
}

function HuggingFaceIcon({ size = 26 }: { size?: number }) {
  return <svg className="hf-logo" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Hugging Face">
    <circle cx="32" cy="29" r="24" fill="#FFD21E" />
    <circle cx="32" cy="29" r="24" fill="none" stroke="#FF9D0B" strokeWidth="2.5" />
    <path d="M20.5 24.5q3.5-4.5 7 0M36.5 24.5q3.5-4.5 7 0" fill="none" stroke="#3A3B45" strokeWidth="3" strokeLinecap="round" />
    <ellipse cx="17.5" cy="31.5" rx="3.6" ry="2.4" fill="#FF9D0B" opacity=".55" />
    <ellipse cx="46.5" cy="31.5" rx="3.6" ry="2.4" fill="#FF9D0B" opacity=".55" />
    <path d="M23 33.5q9 9.5 18 0z" fill="#3A3B45" />
    <path d="M27.5 38.2q4.5-2.6 9 0q-4.5 2.4-9 0z" fill="#F94040" />
    <path d="M6.5 45.5c1.8-6.4 6.2-9.6 9.4-8.6c2.4.8 2.6 3.4 1.3 5.6l4.6-4.3c2-1.8 4.6-.4 3.8 2.1l-1 2.6c2-.8 3.6 1.2 2.4 3l-5.2 7.2c-4.2 4.4-10.6 4.2-14 .4c-1.8-2.2-2.2-5.2-1.3-8z" fill="#FFAD03" stroke="#FF9D0B" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M57.5 45.5c-1.8-6.4-6.2-9.6-9.4-8.6c-2.4.8-2.6 3.4-1.3 5.6l-4.6-4.3c-2-1.8-4.6-.4-3.8 2.1l1 2.6c-2-.8-3.6 1.2-2.4 3l5.2 7.2c4.2 4.4 10.6 4.2 14 .4c1.8-2.2 2.2-5.2 1.3-8z" fill="#FFAD03" stroke="#FF9D0B" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>;
}

function LocalModelCard({
  source, name, path, loaded, assistant, badges, specs, meta, size, total, estimated, actions, extra, categoryHint,
}: {
  source: "ollama" | "huggingface" | "runtime";
  name: string;
  path?: string;
  loaded: boolean;
  assistant?: boolean;
  badges?: ReactNode;
  specs: LocalModelSpec[];
  meta: string;
  size: number;
  total: number;
  estimated?: boolean;
  actions?: ReactNode;
  extra?: ReactNode;
  categoryHint: string;
}) {
  const category = localModelCategory(categoryHint);
  const CategoryIcon = category.icon;
  const visible = specs.filter((spec) => spec.value !== undefined && spec.value !== null && String(spec.value).trim() !== "");
  return <Card className={`local-card ${loaded ? "is-loaded" : "is-unloaded"} ${assistant ? "is-assistant" : ""}`}>
    <div className="lc-head" style={{ "--category": category.color } as CSSProperties}>
      <div className={`lc-icon ${source}`}>
        {source === "huggingface" ? <HuggingFaceIcon size={30} /> : source === "ollama" ? <Bot size={20} /> : <Activity size={20} />}
        <span className="lc-category-dot" title={category.label}><CategoryIcon size={10} /></span>
      </div>
      <div className="lc-title">
        <div className="lc-name-row">
          <strong title={path || name}>{name}</strong>
          <span className={`badge ${loaded ? "live" : "local"}`}>{loaded ? "Cargado" : "En disco"}</span>
          {badges}
        </div>
        {path && path !== name && <small className="lc-path" title={path}>{path}</small>}
        <div className="lc-tags">
          <span className="lc-tag category"><CategoryIcon size={11} /> {category.label}</span>
          <span className="lc-tag">{source === "huggingface" ? "Hugging Face" : source === "ollama" ? "Ollama" : "Runtime"}</span>
          {meta && <span className="lc-meta">{meta}</span>}
        </div>
      </div>
      <ModelSizeGauge size={size} total={total} estimated={estimated} label={source === "runtime" ? "Memoria" : "Tamaño"} />
    </div>
    {visible.length > 0 && <dl className="lc-specs">
      {visible.map((spec) => <span key={spec.label}><dt>{spec.label}</dt><dd title={spec.title || String(spec.value)}>{spec.value}</dd></span>)}
    </dl>}
    {extra}
    {actions && <div className="lc-actions">{actions}</div>}
  </Card>;
}

function ModelSizeGauge({
  size,
  total,
  estimated = false,
  label = "Tamaño",
}: {
  size: number;
  total: number;
  estimated?: boolean;
  label?: string;
}) {
  const ratio = total > 0 ? size / total : 0;
  const level = ratio >= 0.85 ? "critical" : ratio >= 0.7 ? "high" : ratio >= 0.5 ? "medium" : "comfortable";
  const percentage = Math.max(0, Math.min(100, ratio * 100));
  const comparison = `${estimated ? "~" : ""}${bytes(size)} de ${bytes(total)}`;

  return (
    <div className="model-size">
      <small>{label}</small>
      <strong>{estimated ? "~" : ""}{bytes(size)}</strong>
      {total > 0 && (
        <div
          className={`model-size-gauge ${level}`}
          title={`${comparison} (${Math.round(ratio * 100)}% de la RAM total)`}
          role="meter"
          aria-label={`${label}: ${comparison}`}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Math.min(size, total)}
        >
          <span className="model-size-gauge-fill" style={{ width: `${percentage}%` }} />
          <span className="model-size-gauge-label">{comparison}</span>
        </div>
      )}
    </div>
  );
}

type UnifiedMemorySegment = {
  name: string;
  bytes: number;
  kind: "system" | "driver" | "model" | "cache" | "available";
  estimated?: boolean;
  description: string;
};

const MEMORY_SEGMENT_DESCRIPTIONS = {
  system: "Kernel, tablas de páginas y procesos que no son runtimes de IA: servicios del sistema, Docker, el propio MyDGX.",
  driver: "Memoria reservada por el driver de NVIDIA para CUDA: KV cache, buffers de cómputo y contextos. En el GB10 no figura en ningún proceso, así que no se puede atribuir con certeza; casi siempre pertenece a los modelos cargados. Se libera al detenerlos.",
  cache: "Copias en RAM de ficheros leídos hace poco (pesos de modelos, descargas). Cuenta como disponible: el kernel la cede al cargar modelos y MyDGX la vacía cuando un modelo no cabe en la memoria libre.",
  available: "Memoria sin ningún uso, utilizable al instante.",
} as const;

const MEMORY_RUNTIME_LABELS: Record<string, string> = {
  "llama-server": "Servidor llama.cpp",
  ollama: "Servidor Ollama",
  comfyui: "Motor ComfyUI de imagen y vídeo",
  whisper: "Servicio Whisper de transcripción",
  tts: "Runtime TTS CUDA",
  "open-webui": "Interfaz Open WebUI",
  gateway: "Gateway API OpenAI compatible",
  searxng: "Buscador SearXNG",
};

function measuredMemorySegments(
  memory: MemoryBreakdown,
): { total: number; used: number; available: number; segments: UnifiedMemorySegment[] } {
  const runtimes = memory.runtimes
    .filter((runtime) => runtime.bytes > 0)
    .map((runtime) => ({
      name: runtime.models.length ? `${runtime.name} · ${runtime.models.join(", ")}` : runtime.name,
      bytes: runtime.bytes,
      kind: "model" as const,
      description: [
        `${MEMORY_RUNTIME_LABELS[runtime.kind] ?? runtime.kind} · PID ${runtime.pid}.`,
        runtime.models.length ? `Modelos en memoria: ${runtime.models.join(", ")}.` : "",
        "Memoria real del proceso: pesos, KV cache y buffers CUDA en la memoria unificada.",
        runtime.managed ? "" : "No lo lanzó MyDGX: no se detiene al vaciar memoria para benchmarks.",
      ].filter(Boolean).join(" "),
    }));
  const accounted = memory.free + (memory.cache_bytes || 0) + (memory.system_bytes || 0) + (memory.driver_bytes || 0)
    + runtimes.reduce((sum, runtime) => sum + runtime.bytes, 0);
  const driverBytes = (memory.driver_bytes || 0) + Math.max(0, memory.total - accounted);
  return {
    total: memory.total,
    used: memory.total - memory.free - memory.cache_bytes,
    available: memory.available,
    segments: [
      ...(memory.system_bytes > 0 ? [{ name: "Sistema y otros", bytes: memory.system_bytes, kind: "system" as const, description: MEMORY_SEGMENT_DESCRIPTIONS.system }] : []),
      ...(driverBytes > 0 ? [{ name: "CUDA del driver (sin proceso atribuible)", bytes: driverBytes, kind: "driver" as const, description: MEMORY_SEGMENT_DESCRIPTIONS.driver }] : []),
      ...runtimes,
      ...(memory.cache_bytes > 0 ? [{ name: "Caché de disco (recuperable)", bytes: memory.cache_bytes, kind: "cache" as const, description: MEMORY_SEGMENT_DESCRIPTIONS.cache }] : []),
      { name: "Libre", bytes: memory.free, kind: "available" as const, description: MEMORY_SEGMENT_DESCRIPTIONS.available },
    ],
  };
}

function unifiedMemorySegments(
  models: Models | null,
  overview: Overview | null,
  modelMetrics: ModelMetricsResponse,
): { total: number; used: number; available: number; segments: UnifiedMemorySegment[] } {
  const measured = overview?.memory;
  if (measured?.runtimes && measured.total) return measuredMemorySegments(measured as MemoryBreakdown);
  const total = overview?.metrics.memory_total ?? 0;
  const used = Math.min(total, overview?.metrics.memory_used ?? 0);
  const available = Math.max(0, total - used);
  const running = models?.running ?? [];
  const overviewTime = new Date(overview?.metrics.created_at ?? 0).getTime();
  const freshMetrics = modelMetrics.current.filter((sample) => (
    sample.active
    && Math.abs(overviewTime - new Date(sample.created_at).getTime()) <= 12_000
  ));
  const telemetryModels = freshMetrics
    .map((sample) => ({
      name: sample.model_name,
      bytes: Number(
        sample.unified_memory_bytes
        ?? (sample.engine === "ollama" ? sample.gpu_memory_bytes : sample.ram_bytes)
        ?? sample.gpu_memory_bytes
        ?? sample.ram_bytes
        ?? 0
      ),
    }))
    .filter((model) => model.bytes > 0 && model.bytes <= used * 1.05);
  const telemetryNames = new Set(telemetryModels.map((model) => model.name.toLocaleLowerCase()));
  const loadedModels: Array<{ name: string; bytes: number; estimated?: boolean }> = [
    ...telemetryModels,
    ...running
      .filter((model) => !telemetryNames.has(String(model.name).toLocaleLowerCase()))
      .map((model) => {
        const name = String(model.name);
        return { name, bytes: Number(model.size_vram ?? model.size ?? 0) };
      }),
    ...(models?.runtime_models ?? [])
      .filter((model) => !telemetryNames.has(model.name.toLocaleLowerCase()))
      .map((model) => ({
        name: model.name,
        bytes: Number(model.size || 0),
        estimated: model.estimated,
      })),
  ].filter((model) => model.bytes > 0);
  const reported = loadedModels.reduce((sum, model) => sum + model.bytes, 0);
  const scale = reported > used && reported > 0 ? used / reported : 1;
  const attributed = loadedModels.map((model) => ({ ...model, bytes: model.bytes * scale }));
  const attributedBytes = attributed.reduce((sum, model) => sum + model.bytes, 0);
  const system = Math.max(0, used - attributedBytes);
  return {
    total,
    used,
    available,
    segments: [
      ...(system > 0 ? [{ name: "Sistema y otros", bytes: system, kind: "system" as const, description: "Memoria usada que no se ha podido atribuir a ningún modelo cargado." }] : []),
      ...attributed.map((model) => ({
        ...model,
        kind: "model" as const,
        description: model.estimated ? "Tamaño estimado a partir del modelo, no medido en el proceso." : "Memoria declarada por el runtime del modelo.",
      })),
      { name: "Disponible", bytes: available, kind: "available" as const, description: "Memoria libre más la caché que el sistema puede ceder." },
    ],
  };
}

function UnifiedMemoryMap({
  models,
  overview,
  modelMetrics,
  compact = false,
  className = "",
}: {
  models: Models | null;
  overview: Overview | null;
  modelMetrics: ModelMetricsResponse;
  compact?: boolean;
  className?: string;
}) {
  const [activeSegment, setActiveSegment] = useState<number | null>(null);
  const memory = unifiedMemorySegments(models, overview, modelMetrics);
  if (!memory.total) return null;
  const percent = (value: number) => value / memory.total * 100;
  const offsets = memory.segments.map((_, index) => (
    memory.segments.slice(0, index).reduce((sum, segment) => sum + percent(segment.bytes), 0)
  ));
  const active = activeSegment !== null ? memory.segments[activeSegment] : undefined;
  if (compact) {
    const cacheBytes = memory.segments.filter((segment) => segment.kind === "cache").reduce((sum, segment) => sum + segment.bytes, 0);
    const compactSegments = memory.segments
      .filter((segment) => segment.kind !== "cache")
      .map((segment) => segment.kind === "available"
        ? { ...segment, bytes: segment.bytes + cacheBytes, description: "Memoria libre más la caché de disco, que el sistema recupera al cargar modelos." }
        : segment);
    return (
      <div className="memory-map-mini" title={`${bytes(memory.used)} usados de ${bytes(memory.total)}`}>
        <div className="memory-map-mini-bar" aria-label={`Memoria: ${bytes(memory.used)} usados de ${bytes(memory.total)}`}>
          {compactSegments.map((segment, index) => (
            <span
              className={`${segment.kind} ${segment.kind === "model" ? `color-${index % 6}` : ""}`}
              key={`${segment.kind}:${segment.name}:${index}`}
              style={{ width: `${segment.bytes / memory.total * 100}%` }}
              title={`${segment.name}: ${segment.estimated ? "~" : ""}${bytes(segment.bytes)} (${percent(segment.bytes).toFixed(1)}%)\n${segment.description}`}
            />
          ))}
        </div>
        <small><span>MEMORIA</span><b>{bytes(memory.used)} / {bytes(memory.total)}</b></small>
      </div>
    );
  }
  return (
    <div className={`memory-map ${className}`.trim()}>
      <div className="memory-map-heading">
        <div><strong>Mapa de memoria unificada</strong><span className="live-memory-indicator"><i /> EN VIVO</span></div>
        <small>{bytes(memory.used)} usados · {bytes(memory.available)} disponibles · {bytes(memory.total)} total</small>
      </div>
      <div className="memory-map-bar-wrap" onMouseLeave={() => setActiveSegment(null)}>
      <div
        className="memory-map-bar"
        role="list"
        aria-label={`Memoria unificada: ${bytes(memory.used)} usados y ${bytes(memory.available)} disponibles`}
      >
        {memory.segments.map((segment, index) => (
          <div
            className={`memory-map-segment ${segment.kind} ${segment.kind === "model" ? `color-${index % 6}` : ""} ${activeSegment === index ? "active" : ""}`}
            key={`${segment.kind}:${segment.name}:${index}`}
            style={{ width: `${percent(segment.bytes)}%` }}
            role="listitem"
            tabIndex={0}
            aria-label={`${segment.name}: ${bytes(segment.bytes)}, ${percent(segment.bytes).toFixed(1)}%. ${segment.description}`}
            onMouseEnter={() => setActiveSegment(index)}
            onFocus={() => setActiveSegment(index)}
            onBlur={() => setActiveSegment(null)}
          >
            <span>{segment.name}</span>
            <small>{segment.estimated ? "~" : ""}{bytes(segment.bytes)} · {Math.round(percent(segment.bytes))}%</small>
          </div>
        ))}
      </div>
      {active && activeSegment !== null && (
        <div
          className="memory-map-tooltip"
          role="tooltip"
          style={{ left: `${Math.min(88, Math.max(12, offsets[activeSegment] + percent(active.bytes) / 2))}%` }}
        >
          <strong>{active.name}</strong>
          <b>{active.estimated ? "~" : ""}{bytes(active.bytes)} · {percent(active.bytes).toFixed(1)}% del total</b>
          <p>{active.description}</p>
        </div>
      )}
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div className="brand-mark" aria-label="MyDGX">
      <div className="spark-device">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

function SectionHeading({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

function ProgressRing({
  value,
  label,
  detail,
}: {
  value: number | null;
  label: string;
  detail: string;
}) {
  const safe = Math.max(0, Math.min(100, value ?? 0));
  const state = safe >= 90 ? "critical" : safe >= 75 ? "warning" : "normal";
  const stateLabel = state === "critical" ? "Crítico" : state === "warning" ? "Atención" : "Normal";
  const angle = Math.PI - safe / 100 * Math.PI;
  const markerX = 60 + 45 * Math.cos(angle);
  const markerY = 64 - 45 * Math.sin(angle);
  return (
    <div className={`metric-ring-wrap ${state}`} aria-label={`${label}: ${value == null ? "sin datos" : `${Math.round(value)} por ciento`}, ${stateLabel}`}>
      <span className="metric-label">{label}</span>
      <div className="metric-gauge">
        <svg viewBox="0 0 120 78" role="img" aria-hidden="true">
          <path className="gauge-track" d="M15 64 A45 45 0 0 1 105 64" pathLength="100" />
          <path className="gauge-zone green" d="M15 64 A45 45 0 0 1 105 64" pathLength="100" />
          <path className="gauge-zone orange" d="M15 64 A45 45 0 0 1 105 64" pathLength="100" />
          <path className="gauge-zone red" d="M15 64 A45 45 0 0 1 105 64" pathLength="100" />
          {value != null && <circle className={`gauge-marker ${state}`} cx={markerX} cy={markerY} r="3.3" />}
          {value != null && <line className="gauge-needle" x1="60" y1="64" x2="60" y2="29" style={{ transform: `rotate(${safe * 1.8 - 90}deg)`, transformOrigin: "60px 64px" }} />}
          <circle className="gauge-hub" cx="60" cy="64" r="5" />
          <text className="gauge-value" x="60" y="58" textAnchor="middle">{value == null ? "—" : `${Math.round(value)}%`}</text>
        </svg>
      </div>
      <div className="metric-state"><i /><span>{stateLabel}</span></div>
      <small>{detail}</small>
      <div className="gauge-scale" aria-hidden="true"><span>0</span><i className="green" /><i className="orange" /><i className="red" /><span>100</span></div>
    </div>
  );
}

function QuickScale({ value, min = 0, max = 100 }: { value: number; min?: number; max?: number }) {
  const position = Math.max(0, Math.min(100, (value - min) / Math.max(1, max - min) * 100));
  return (
    <div className="quick-scale" role="meter" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}>
      <div><span /><i style={{ left: `${position}%` }} /></div>
      <small><span>{min}</span><span>{max}</span></small>
    </div>
  );
}

type TelemetryPoint = {
  timestamp: number;
  time: string;
  cpu: number;
  memory: number;
  gpu: number | null;
  temperature: number | null;
  power: number | null;
  networkRx: number;
  networkTx: number;
  diskRead: number;
  diskWrite: number;
  diskUsage: number;
};

type TelemetrySeries = {
  key: keyof TelemetryPoint;
  label: string;
  color: string;
  unit: string;
};

function metricState(value: number | null, warning: number, critical: number) {
  if (value == null) return "unavailable";
  if (value >= critical) return "critical";
  if (value >= warning) return "warning";
  return "normal";
}

function TelemetryChartCard({
  title,
  data,
  series,
  current,
  status = "normal",
  domain,
}: {
  title: string;
  data: TelemetryPoint[];
  series: TelemetrySeries[];
  current: string;
  status?: "normal" | "warning" | "critical" | "unavailable";
  domain?: [number, number];
}) {
  const identifier = title.toLowerCase().replace(/[^a-z0-9]/g, "");
  const primaryValues = data
    .map((point) => point[series[0].key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const average = primaryValues.length
    ? primaryValues.reduce((total, value) => total + value, 0) / primaryValues.length
    : null;
  const maximum = primaryValues.length ? Math.max(...primaryValues) : null;
  const decimals = series[0].unit === "%" || series[0].unit === "°C" || series[0].unit === "W" ? 1 : 2;
  const summary = (value: number | null) => value == null ? "—" : `${value.toFixed(decimals)} ${series[0].unit}`;
  return (
    <Card className={`telemetry-chart-card ${status}`}>
      <div className="telemetry-chart-head">
        <div><i /><span>{title}</span></div>
        <strong>{current}</strong>
      </div>
      <div className="telemetry-chart-area">
        {data.length > 1 ? <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              {series.map((item, index) => (
                <linearGradient key={item.key} id={`${identifier}${index}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={item.color} stopOpacity={index === 0 ? 0.3 : 0.14} />
                  <stop offset="100%" stopColor={item.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
            <XAxis dataKey="time" minTickGap={48} tick={{ fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
            <YAxis domain={domain} width={42} tick={{ fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 8 }}
              labelStyle={{ color: "var(--text-secondary)" }}
            />
            {series.map((item, index) => (
              <Area
                key={item.key}
                type="monotone"
                dataKey={item.key}
                name={item.label}
                unit={` ${item.unit}`}
                connectNulls
                stroke={item.color}
                fill={`url(#${identifier}${index})`}
                strokeWidth={index === 0 ? 1.8 : 1.35}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer> : <div className="telemetry-no-data">Esperando muestras históricas…</div>}
      </div>
      <div className="telemetry-chart-foot">
        <span>Media <strong>{summary(average)}</strong></span>
        <span>Máx. <strong>{summary(maximum)}</strong></span>
        <div>{series.map((item) => <small key={item.key}><i style={{ background: item.color }} />{item.label}</small>)}</div>
      </div>
    </Card>
  );
}

function StatusDot({ online }: { online: boolean }) {
  return <span className={`status-dot ${online ? "online" : "offline"}`} />;
}

function Dashboard({
  overview,
  models,
  modelMetrics,
  config,
  jobs,
}: {
  overview: Overview | null;
  models: Models | null;
  modelMetrics: ModelMetricsResponse;
  config: Config | null;
  jobs: Job[];
}) {
  const [history, setHistory] = useState<Metrics[]>([]);
  const [historyMinutes, setHistoryMinutes] = useState(() => {
    const saved = Number(localStorage.getItem("mydgx-history-minutes") || 60);
    return [60, 360, 1440, 4320, 10080].includes(saved) ? saved : 60;
  });
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [gateway, setGateway] = useState<GatewayConfig | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: new Date(), end: new Date() });

  useEffect(() => {
    let active = true;
    const loadGateway = () => {
      api<GatewayConfig>("/api/gateway/config")
        .then((value) => { if (active) setGateway(value); })
        .catch(() => undefined);
    };
    loadGateway();
    const timer = window.setInterval(loadGateway, 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const historyRequest = useRef(0);
  const loadHistory = useCallback(async () => {
    const request = ++historyRequest.current;
    const end = new Date(Date.now() - historyOffset * historyMinutes * 60_000);
    const start = new Date(end.getTime() - historyMinutes * 60_000);
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
      const points = await api<Metrics[]>(`/api/metrics/history?${params}`);
      if (request !== historyRequest.current) return;
      setHistory(points);
      setVisibleRange({ start, end });
      setHistoryError("");
    } catch (requestError) {
      if (request === historyRequest.current) setHistoryError((requestError as Error).message);
    } finally {
      if (request === historyRequest.current) setHistoryLoading(false);
    }
  }, [historyMinutes, historyOffset]);

  useEffect(() => {
    localStorage.setItem("mydgx-history-minutes", String(historyMinutes));
    const initialTimer = window.setTimeout(() => void loadHistory(), 0);
    const refreshTimer = historyOffset === 0
      ? window.setInterval(loadHistory, 15_000)
      : undefined;
    return () => {
      window.clearTimeout(initialTimer);
      if (refreshTimer) window.clearInterval(refreshTimer);
    };
  }, [historyMinutes, historyOffset, loadHistory]);

  if (!overview) return <Loading label="Leyendo telemetría del sistema" />;
  const m = overview.metrics;
  const includeDate = historyMinutes > 1440 || historyOffset > 0;
  const telemetryData: TelemetryPoint[] = history.map((item, index) => {
    const timestamp = new Date(item.created_at).getTime();
    const previous = index > 0 ? history[index - 1] : null;
    const previousTimestamp = previous ? new Date(previous.created_at).getTime() : timestamp;
    const elapsedSeconds = Math.max(1, (timestamp - previousTimestamp) / 1000);
    const rate = (current: number, prior: number | undefined) =>
      prior == null || prior <= 0 || current < prior
        ? 0
        : Number(((current - prior) / elapsedSeconds / 1024 ** 2).toFixed(3));
    return {
      timestamp,
      time: new Date(timestamp).toLocaleString([], includeDate
        ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }
        : { hour: "2-digit", minute: "2-digit" }),
      cpu: item.cpu_percent,
      memory: item.memory_percent,
      gpu: item.gpu_utilization,
      temperature: item.gpu_temperature,
      power: item.gpu_power_watts,
      networkRx: rate(item.network_received, previous?.network_received),
      networkTx: rate(item.network_sent, previous?.network_sent),
      diskRead: rate(item.disk_read_bytes, previous?.disk_read_bytes),
      diskWrite: rate(item.disk_write_bytes, previous?.disk_write_bytes),
      diskUsage: item.disk_percent,
    };
  });
  const displayedMetrics = history[history.length - 1] ?? m;
  const latestTelemetry = telemetryData[telemetryData.length - 1];
  const maxHistoryOffset = Math.max(
    0,
    Math.floor((Math.max(1, modelMetrics.retention_hours) * 60) / historyMinutes) - 1,
  );
  const modelHistory = modelMetrics.history.reduce<Record<string, ModelMetric[]>>((groups, sample) => {
    const key = `${sample.profile_id || "standalone"}:${sample.model_id}`;
    (groups[key] ||= []).push(sample);
    return groups;
  }, {});
  const uptime = Math.max(0, new Date(m.created_at).getTime() - new Date(overview.host.boot_time).getTime());
  const uptimeMinutes = Math.floor(uptime / 60_000);
  const uptimeDays = Math.floor(uptimeMinutes / 1_440);
  const uptimeHours = Math.floor((uptimeMinutes % 1_440) / 60);
  const uptimeRemainingMinutes = uptimeMinutes % 60;
  const uptimeLabel = `${uptimeDays} d ${uptimeHours} h ${uptimeRemainingMinutes} min`;
  const branding = deviceBranding(overview.host);
  const gatewayDisplayHosts = gateway
    ? gateway.host === "0.0.0.0" || gateway.host === "::"
      ? gateway.network_addresses?.length
        ? gateway.network_addresses
        : [window.location.hostname || overview.host.hostname]
      : [gateway.host]
    : [];
  const gatewayDisplayHost = gatewayDisplayHosts[0] ?? null;
  const gatewayUrlHost = gatewayDisplayHost?.includes(":") ? `[${gatewayDisplayHost}]` : gatewayDisplayHost;
  const gatewayBaseUrl = gateway && gatewayUrlHost
    ? `http://${gatewayUrlHost}:${gateway.port}/v1`
    : config?.gateway_url ?? "Cargando…";

  return (
    <div className="view-stack dashboard-view">
      <div className={`hero ${overview.host.is_dgx_spark ? "dgx-hero" : ""}`}>
        <div className="hero-copy">
          <div className={overview.host.is_dgx_spark ? "dgx-intro" : ""}>
            <div className="hero-intro-copy">
              {overview.host.is_dgx_spark ? (
                <div className="dgx-brandline">
                  {branding.logo && <span className="vendor-logo"><img src={branding.logo} alt={overview.host.device_vendor} /></span>}
                  <span>{branding.label} · {branding.subtitle}</span>
                </div>
              ) : <span className="eyebrow">CENTRO DE CONTROL</span>}
              <h1>Buenos días, tu Spark está {overview.services.ollama ? "listo." : "en espera."}</h1>
              <p>
                {overview.host.hostname} · {overview.host.architecture} · activo hace {uptimeLabel}
              </p>
            </div>
            {overview.host.is_dgx_spark && branding.product && (
              <div className="dgx-product" aria-hidden="true">
                <div className="dgx-glow" />
                <img className={`device-${overview.host.device_variant}`} src={branding.product} alt="" />
              </div>
            )}
          </div>
          {overview.host.is_dgx_spark && (
            <div className="dgx-facts">
              <span><small>PLATAFORMA</small>{overview.host.device_model}</span>
              <span><small>GPU</small>{overview.host.gpu_name || "NVIDIA GB10"}</span>
              <span><small>MEMORIA</small>{bytes(m.memory_total)} unificada</span>
              <span><small>DISCO</small>{bytes(m.disk_total)} total</span>
            </div>
          )}
          {overview.host.is_dgx_spark && (
            <div className="hero-actions">
              {overview.services.dgx_dashboard && <a className="button secondary" href={config?.dgx_dashboard_url} target="_blank" rel="noreferrer">DGX Dashboard <ExternalLink size={15} /></a>}
              <a className="button primary" href={config?.openwebui_url} target="_blank" rel="noreferrer">Open WebUI <ChevronRight size={15} /></a>
              {overview.services.comfyui && <a className="button secondary" href={config?.comfyui_url} target="_blank" rel="noreferrer">ComfyUI <Sparkles size={15} /></a>}
              {(overview.web_apps ?? []).map((app) => <WebAppButton app={app} key={app.name} />)}
            </div>
          )}
        </div>
        {!overview.host.is_dgx_spark && (
          <div className="hero-actions">
            {overview.services.dgx_dashboard && <a className="button secondary" href={config?.dgx_dashboard_url} target="_blank" rel="noreferrer">DGX Dashboard <ExternalLink size={15} /></a>}
            <a className="button primary" href={config?.openwebui_url} target="_blank" rel="noreferrer">Open WebUI <ChevronRight size={15} /></a>
            {overview.services.comfyui && <a className="button secondary" href={config?.comfyui_url} target="_blank" rel="noreferrer">ComfyUI <Sparkles size={15} /></a>}
              {(overview.web_apps ?? []).map((app) => <WebAppButton app={app} key={app.name} />)}
          </div>
        )}
      </div>

      <div className="metrics-grid">
        <Card className="metrics-card">
          <ProgressRing value={m.gpu_utilization} label="GPU" detail={m.gpu_temperature == null ? "No detectada" : `${m.gpu_temperature} °C`} />
          <ProgressRing value={m.cpu_percent} label="CPU" detail={`${overview.host.cpu_count} núcleos`} />
          <ProgressRing value={m.memory_percent} label="Memoria unificada" detail={`${bytes(m.memory_used)} / ${bytes(m.memory_total)}`} />
          <ProgressRing value={m.disk_percent} label="Disco" detail={`${bytes(m.disk_used)} / ${bytes(m.disk_total)}`} />
        </Card>
        <UnifiedMemoryMap models={models} overview={overview} modelMetrics={modelMetrics} className="dashboard-memory-map" />
        <Card className="quick-grid">
          <div className="card-kicker"><Gauge size={15} /> Recursos en vivo</div>
          <div className="quick-resource-row">
            <div className="quick-icon"><Thermometer /></div>
            <div className="quick-resource-copy"><small>Temperatura GPU</small><strong>{m.gpu_temperature == null ? "—" : `${m.gpu_temperature} °C`}</strong></div>
            {m.gpu_temperature != null && <QuickScale value={m.gpu_temperature} min={30} max={100} />}
          </div>
          <div className="quick-resource-row">
            <div className="quick-icon"><Database /></div>
            <div className="quick-resource-copy"><small>Memoria unificada usada</small><strong>{bytes(m.memory_used)} <b>{Math.round(m.memory_percent)}%</b></strong></div>
            <QuickScale value={m.memory_percent} />
          </div>
          <div className="quick-resource-row traffic">
            <div className="quick-icon"><Zap /></div>
            <div className="quick-resource-copy"><small>Tráfico enviado</small><strong>{latestTelemetry ? `${latestTelemetry.networkTx.toFixed(1)} MiB/s` : "—"} <b>{bytes(m.network_sent)} total</b></strong></div>
            <div className="quick-sparkline" aria-label="Histórico reciente de tráfico enviado">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={telemetryData.slice(-40)}>
                  <Line type="monotone" dataKey="networkTx" stroke="var(--accent)" strokeWidth={2.2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
        <Card className="gateway-summary-card">
          <div className="gateway-summary-head">
            <div className="card-kicker"><Globe size={15} /> Gateway API</div>
            <span className={`badge ${gateway?.running ? "live" : ""}`}>
              {gateway?.running ? "En línea" : gateway?.enabled ? "No disponible" : "Desactivado"}
            </span>
          </div>
          <div className="gateway-summary-endpoint">
            <small>BASE URL · OPENAI COMPATIBLE</small>
            <strong title={gatewayBaseUrl}>{gatewayBaseUrl}</strong>
          </div>
          <div className="gateway-summary-grid">
            <span title={gatewayDisplayHosts.join(", ")}><small>IP / HOST</small><strong>{gatewayDisplayHosts.join(" · ") || "—"}</strong></span>
            <span><small>PUERTO</small><strong>{gateway?.port ?? "—"}</strong></span>
            <span><small>AUTENTICACIÓN</small><strong>{gateway?.api_key_configured ? "Bearer token" : "Sin token"}</strong></span>
            <span className="gateway-summary-models"><small>MODELOS PUBLICADOS</small><GatewayModelList gateway={gateway} empty="Ningún modelo cargado" /></span>
          </div>
          <div className="gateway-token-hint">
            <ShieldCheck size={14} />
            <span><small>Token para clientes</small><strong>{gateway?.api_key_configured ? "Bearer <GATEWAY_API_KEY>" : "No requerido · solo acceso local"}</strong></span>
          </div>
        </Card>
        <Card className="status-card">
          <div className="card-kicker"><Activity size={15} /> Servicios</div>
          {Object.entries(overview.services).map(([name, online]) => (
            <div className="service-row" key={name}>
              <StatusDot online={online} />
              <span>{name.replace("_", " ")}</span>
              <small>{online ? "En línea" : "No disponible"}</small>
            </div>
          ))}
        </Card>
      </div>

      <section className="telemetry-history-section">
        <div className="telemetry-history-heading">
          <div>
            <span className="eyebrow">HISTÓRICO DE RECURSOS</span>
            <h2>Telemetría del sistema</h2>
            <small>
              {visibleRange.start.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
              {" — "}
              {visibleRange.end.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
              {historyLoading && " · actualizando…"}
            </small>
          </div>
          <div className="telemetry-history-controls">
            <div className="telemetry-range-selector">
              {([
                [60, "1 h"],
                [360, "6 h"],
                [1440, "24 h"],
                [4320, "3 d"],
                [10080, "7 d"],
              ] as const).filter(([minutes]) => minutes <= Math.max(60, modelMetrics.retention_hours * 60)).map(([minutes, label]) => (
                <button
                  className={historyMinutes === minutes ? "active" : ""}
                  key={minutes}
                  onClick={() => { setHistoryMinutes(minutes); setHistoryOffset(0); }}
                >{label}</button>
              ))}
            </div>
            <div className="telemetry-navigation">
              <button className="icon-button" aria-label="Periodo anterior" disabled={historyOffset >= maxHistoryOffset} onClick={() => setHistoryOffset((value) => Math.min(maxHistoryOffset, value + 1))}><ChevronLeft size={15} /></button>
              <button className="button secondary" disabled={historyOffset === 0} onClick={() => setHistoryOffset(0)}>Ahora</button>
              <button className="icon-button" aria-label="Periodo siguiente" disabled={historyOffset === 0} onClick={() => setHistoryOffset((value) => Math.max(0, value - 1))}><ChevronRight size={15} /></button>
            </div>
          </div>
        </div>
        {historyError && <div className="telemetry-history-error"><TriangleAlert size={14} />{historyError}<button onClick={() => void loadHistory()}>Reintentar</button></div>}
        <div className="telemetry-chart-grid">
          <TelemetryChartCard
            title="Utilización GPU"
            data={telemetryData}
            series={[{ key: "gpu", label: "GPU", color: "#76b900", unit: "%" }]}
            current={displayedMetrics.gpu_utilization == null ? "No disponible" : `${displayedMetrics.gpu_utilization.toFixed(1)} %`}
            status={metricState(displayedMetrics.gpu_utilization, 75, 90)}
            domain={[0, 100]}
          />
          <TelemetryChartCard
            title="Temperatura GPU"
            data={telemetryData}
            series={[{ key: "temperature", label: "Temperatura", color: "#ed5f5f", unit: "°C" }]}
            current={displayedMetrics.gpu_temperature == null ? "No disponible" : `${displayedMetrics.gpu_temperature.toFixed(1)} °C`}
            status={metricState(displayedMetrics.gpu_temperature, 75, 85)}
            domain={[0, 100]}
          />
          <TelemetryChartCard
            title="Potencia GPU"
            data={telemetryData}
            series={[{ key: "power", label: "Consumo", color: "#f0a22e", unit: "W" }]}
            current={displayedMetrics.gpu_power_watts == null ? "No disponible" : `${displayedMetrics.gpu_power_watts.toFixed(1)} W${displayedMetrics.gpu_power_limit_watts ? ` / ${displayedMetrics.gpu_power_limit_watts.toFixed(0)} W` : ""}`}
            status={metricState(
              displayedMetrics.gpu_power_watts == null || !displayedMetrics.gpu_power_limit_watts ? null : displayedMetrics.gpu_power_watts / displayedMetrics.gpu_power_limit_watts * 100,
              75,
              90,
            )}
          />
          <TelemetryChartCard
            title="CPU y memoria"
            data={telemetryData}
            series={[
              { key: "cpu", label: "CPU", color: "#4d91ff", unit: "%" },
              { key: "memory", label: "Memoria", color: "#a77bf3", unit: "%" },
            ]}
            current={`${displayedMetrics.cpu_percent.toFixed(1)} % CPU`}
            status={metricState(Math.max(displayedMetrics.cpu_percent, displayedMetrics.memory_percent), 75, 90)}
            domain={[0, 100]}
          />
          <TelemetryChartCard
            title="Red"
            data={telemetryData}
            series={[
              { key: "networkRx", label: "Recibido", color: "#4d91ff", unit: "MiB/s" },
              { key: "networkTx", label: "Enviado", color: "#76b900", unit: "MiB/s" },
            ]}
            current={latestTelemetry ? `${latestTelemetry.networkRx.toFixed(2)} MiB/s ↓` : "Sin muestras"}
          />
          <TelemetryChartCard
            title="E/S de disco"
            data={telemetryData}
            series={[
              { key: "diskRead", label: "Lectura", color: "#f0a22e", unit: "MiB/s" },
              { key: "diskWrite", label: "Escritura", color: "#a77bf3", unit: "MiB/s" },
            ]}
            current={latestTelemetry ? `${latestTelemetry.diskRead.toFixed(2)} MiB/s lectura` : "Sin muestras"}
          />
          <TelemetryChartCard
            title="Ocupación de disco"
            data={telemetryData}
            series={[{ key: "diskUsage", label: "Ocupado", color: "#33b7a2", unit: "%" }]}
            current={`${displayedMetrics.disk_percent.toFixed(1)} % · ${bytes(displayedMetrics.disk_used)}`}
            status={metricState(displayedMetrics.disk_percent, 75, 90)}
            domain={[0, 100]}
          />
        </div>
        <p className="telemetry-retention-note">Las muestras se conservan en SQLite durante {modelMetrics.retention_hours || 168} horas. Las tasas de red y disco se calculan entre muestras consecutivas.</p>
      </section>

      <section className="model-telemetry-section">
        <SectionHeading eyebrow="POR MODELO · ÚLTIMA HORA" title="Consumo de inferencia" />
        {modelMetrics.current.length > 0 ? <div className="model-telemetry-grid">
          {modelMetrics.current.map((sample, index) => {
            const key = `${sample.profile_id || "standalone"}:${sample.model_id}`;
            const samples = modelHistory[key] || [];
            const data = samples.map((item) => ({
              time: new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              Memoria: Number(((item.unified_memory_bytes ?? item.gpu_memory_bytes ?? item.ram_bytes ?? 0) / 1024 ** 3).toFixed(2)),
              GPU: item.gpu_utilization ?? 0,
            }));
            return <Card className="model-telemetry-card" key={key}>
              <div className="model-telemetry-head">
                <div><strong title={sample.model_name}>{sample.model_name}</strong><small><StatusDot online={Boolean(sample.active)} /> {sample.active ? "Activo" : "Última muestra"} · {sample.engine}{sample.pid ? ` · PID ${sample.pid}` : ""}</small></div>
                <span className={`attribution ${sample.attribution}`}>{sample.attribution === "process" ? "Proceso" : sample.attribution === "ollama" ? "Ollama" : "No atribuible"}</span>
              </div>
              <div className="model-telemetry-values">
                <span><small>GPU</small><strong>{sample.gpu_utilization == null ? "—" : `${sample.gpu_utilization.toFixed(1)}%`}</strong></span>
                <span><small>Memoria GPU</small><strong>{bytes(sample.gpu_memory_bytes)}</strong></span>
                <span><small>RAM / unificada</small><strong>{bytes(sample.unified_memory_bytes ?? sample.ram_bytes)}</strong></span>
                <span><small>CPU</small><strong>{sample.cpu_percent == null ? "—" : `${sample.cpu_percent.toFixed(1)}%`}</strong></span>
              </div>
              <div className="model-mini-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data}>
                    <defs><linearGradient id={`modelMemory${index}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} /><stop offset="100%" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs>
                    <Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 8 }} />
                    <Area type="monotone" dataKey="Memoria" unit=" GB" stroke="var(--accent)" fill={`url(#modelMemory${index})`} strokeWidth={1.7} />
                    <Area type="monotone" dataKey="GPU" unit="%" stroke="var(--blue)" fill="transparent" strokeWidth={1.2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <small className="telemetry-note">{sample.attribution === "external-unattributed" ? "El motor comparte proceso o no expone métricas por modelo." : "Muestras conservadas en SQLite según la retención configurada."}</small>
            </Card>;
          })}
        </div> : <Card><Empty icon={<Gauge />} title="Sin modelos activos" text="Arranca un perfil o carga un modelo en Ollama para comenzar el histórico." /></Card>}
      </section>

      <ActivitySummary jobs={jobs} />
    </div>
  );
}

function ModelsView({
  models,
  overview,
  modelMetrics,
  jobs,
  refresh,
  notify,
}: {
  models: Models | null;
  overview: Overview | null;
  modelMetrics: ModelMetricsResponse;
  jobs: Job[];
  refresh: () => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [tab, setTab] = useState<"installed" | "catalog" | "ollama">(() => {
    const stored = localStorage.getItem("mydgx-models-tab");
    return stored === "catalog" || stored === "ollama" ? stored : "installed";
  });
  const [catalogMode, setCatalogMode] = useState<"spark" | "all" | "favorites">(() => {
    const stored = localStorage.getItem("mydgx-models-catalog");
    return stored === "all" || stored === "favorites" ? stored : "spark";
  });
  const [ollamaName, setOllamaName] = useState("");
  const [localFilter, setLocalFilter] = useState<LocalModelFilter>("all");
  const [localQuery, setLocalQuery] = useState("");
  const [query, setQuery] = useState("");
  const searchFormRef = useRef<HTMLFormElement>(null);
  const [task, setTask] = useState<"any" | "chat" | "code" | "reasoning" | "embedding" | "vision" | "audio-chat" | "video-chat" | "image-generation" | "asr" | "tts" | "video-generation" | "reranking">("any");
  const [size, setSize] = useState<"any" | "compact" | "balanced" | "large">("any");
  const [alignment, setAlignment] = useState<"any" | "standard" | "uncensored">("any");
  const [runtime, setRuntime] = useState<"any" | "llama.cpp" | "external">("any");
  const [modelFormat, setModelFormat] = useState<"any" | "gguf" | "safetensors" | "onnx">("any");
  const [modality, setModality] = useState<"any" | "text" | "image" | "audio" | "video">("any");
  const [sparkSort, setSparkSort] = useState<"recommended" | "speed" | "memory" | "community" | "downloads" | "likes" | "trending" | "name">("recommended");
  const [results, setResults] = useState<HfRecommendation[]>([]);
  const [sparkLimit, setSparkLimit] = useState<12 | 18 | 30>(() => {
    const stored = Number(localStorage.getItem("mydgx-spark-limit"));
    return stored === 12 || stored === 30 ? stored : 18;
  });
  const [sparkPage, setSparkPage] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [noMoreResults, setNoMoreResults] = useState(false);
  const downloadedRepos = useMemo(
    () => new Set((models?.huggingface ?? []).map((item) => item.repo_id.toLowerCase())),
    [models?.huggingface],
  );
  const installedRecommendations = results.filter((model) => downloadedRepos.has(model.id.toLowerCase())).length;
  const [allResults, setAllResults] = useState<HfSearchResult[]>([]);
  const [favorites, setFavorites] = useState<HfSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [inspection, setInspection] = useState<HfInspection | null>(null);
  const [inspectingRepo, setInspectingRepo] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [showAllFileGroups, setShowAllFileGroups] = useState(false);
  const [quickBusy, setQuickBusy] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState<string | null>(null);
  const [glossaryRequest, setGlossaryRequest] = useState<GlossaryRequest | null>(null);

  const loadFavorites = useCallback(async () => {
    try {
      setFavorites(await api<HfSearchResult[]>("/api/models/huggingface/favorites"));
    } catch (error) {
      notify((error as Error).message, true);
    }
  }, [notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadFavorites(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadFavorites]);
  useEffect(() => {
    localStorage.setItem("mydgx-models-tab", tab);
  }, [tab]);
  useEffect(() => {
    localStorage.setItem("mydgx-models-catalog", catalogMode);
  }, [catalogMode]);
  useEffect(() => {
    localStorage.setItem("mydgx-spark-limit", String(sparkLimit));
  }, [sparkLimit]);
  useEffect(() => {
    if (!inspection) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInspection(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [inspection]);

  async function pull(event: FormEvent) {
    event.preventDefault();
    if (!ollamaName.trim()) return;
    try {
      await api("/api/models/ollama/pull", { method: "POST", body: JSON.stringify({ name: ollamaName.trim() }) });
      setOllamaName("");
      notify("Descarga de Ollama iniciada");
      refresh();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  function searchGgufVariant(text: string) {
    setQuery(text);
    setTimeout(() => searchFormRef.current?.requestSubmit(), 0);
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    setHasSearched(true);
    setBusy(true);
    try {
      if (catalogMode === "all") {
        const params = new URLSearchParams({ q: query.trim(), task, modality, limit: "30" });
        setAllResults(await api<HfSearchResult[]>(`/api/models/huggingface/search?${params}`));
      } else {
        setResults(await api<HfRecommendation[]>(`/api/models/search?${sparkSearchParams(0)}`));
        setSparkPage(0);
        setNoMoreResults(false);
      }
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  function sparkSearchParams(page: number) {
    return new URLSearchParams({
      q: query.trim(), task, size, alignment, runtime, format: modelFormat, modality,
      limit: String(sparkLimit), page: String(page),
    });
  }

  async function loadMoreRecommendations() {
    const next = sparkPage + 1;
    setLoadingMore(true);
    try {
      const more = await api<HfRecommendation[]>(`/api/models/search?${sparkSearchParams(next)}`);
      const known = new Set(results.map((model) => model.id.toLowerCase()));
      const fresh = more.filter((model) => !known.has(model.id.toLowerCase()));
      setResults((current) => [...current, ...fresh]);
      setSparkPage(next);
      const visible = fresh.filter((model) => !downloadedRepos.has(model.id.toLowerCase())).length;
      if (!more.length || next >= 9) setNoMoreResults(true);
      notify(fresh.length
        ? `${visible} modelo(s) nuevos${fresh.length > visible ? ` · ${fresh.length - visible} ya descargados ocultos` : ""}`
        : "No hay más modelos que encajen con estos filtros");
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setLoadingMore(false);
    }
  }

  async function inspect(repoId: string, preferredFiles: string[] = []) {
    setInspectingRepo(repoId);
    setShowAllFileGroups(false);
    try {
      const result = await api<HfInspection>(`/api/models/huggingface/inspect/${encodeURIComponent(repoId)}`);
      setInspection(result);
      const available = new Set((result.remote?.files ?? []).filter((file) => !file.downloaded).map((file) => file.name));
      const preferred = preferredFiles.filter((name) => available.has(name));
      setSelectedFiles(preferred.length ? preferred : recommendedHfFiles(result));
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setInspectingRepo(null);
    }
  }

  async function downloadSelected() {
    if (!inspection || !selectedFiles.length) return;
    const repoId = inspection.repo_id;
    setDownloadBusy(repoId);
    try {
      const result = await api<{ job_id: string; deduplicated?: boolean }>("/api/models/huggingface/files/download", {
        method: "POST",
        body: JSON.stringify({
          repo_id: repoId,
          revision: inspection.remote?.revision || "main",
          files: selectedFiles,
        }),
      });
      notify(result.deduplicated
        ? `La descarga de ${repoId} ya estaba en curso; no se ha duplicado`
        : `${selectedFiles.length} archivo(s) añadidos a la cola`);
      setInspection(null);
      setSelectedFiles([]);
      refresh();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setDownloadBusy(null);
    }
  }

  async function downloadRecommendation(model: HfRecommendation) {
    setDownloadBusy(model.id);
    try {
      if (!model.recommended_files.length) {
        const result = await api<{ job_id: string; deduplicated?: boolean }>("/api/models/huggingface/download", {
          method: "POST",
          body: JSON.stringify({ repo_id: model.id, revision: "main" }),
        });
        notify(result.deduplicated
          ? `La descarga de ${model.id} ya estaba en curso; no se ha duplicado`
          : `Descarga completa iniciada: ${model.id}`);
        refresh();
        return;
      }
      const result = await api<{ job_id: string; deduplicated?: boolean }>("/api/models/huggingface/files/download", {
        method: "POST",
        body: JSON.stringify({
          repo_id: model.id,
          revision: "main",
          files: model.recommended_files,
        }),
      });
      notify(result.deduplicated
        ? `La descarga de ${model.id} ya estaba en curso; no se ha duplicado`
        : `Descarga recomendada iniciada: ${model.recommended_quantization}`);
      refresh();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setDownloadBusy(null);
    }
  }

  async function toggleHfFavorite(repoId: string, enabled: boolean) {
    try {
      await api("/api/models/huggingface/favorites", {
        method: "PUT",
        body: JSON.stringify({ repo_id: repoId, enabled }),
      });
      notify(enabled ? "Modelo guardado en favoritos" : "Modelo eliminado de favoritos");
      await loadFavorites();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function togglePersistence(source: "ollama" | "huggingface", modelId: string, enabled: boolean) {
    try {
      const result = await api<{ applied: boolean }>("/api/models/persistence", {
        method: "PUT",
        body: JSON.stringify({ source, model_id: modelId, enabled }),
      });
      notify(
        `${modelId} ${enabled ? "añadido al" : "quitado del"} perfil Default`
        + (result.applied ? " · aplicado ahora" : " · se aplicará al arrancar Default"),
      );
      refresh();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function quickModel(source: "ollama" | "huggingface", modelId: string, start: boolean) {
    setQuickBusy(`${source}:${modelId}`);
    try {
      const result = await api<{ alias?: string }>(`/api/models/quick/${start ? "start" : "stop"}`, {
        method: "POST",
        body: JSON.stringify({ source, model_id: modelId }),
      });
      notify(start ? `${modelId} encendido en Quick${result.alias ? ` · alias ${result.alias}` : ""}` : `${modelId} apagado`);
      refresh();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setQuickBusy(null);
    }
  }

  async function releaseComfyUI(repoId: string) {
    setQuickBusy(`comfyui:${repoId}`);
    try {
      await api("/api/models/comfyui/release", { method: "POST" });
      notify("ComfyUI ha liberado sus modelos de memoria");
      refresh();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setQuickBusy(null);
    }
  }

  async function verifyIntegrity(repoId: string) {
    try {
      await api<{ job_id: string }>(`/api/models/huggingface/integrity/${encodeURIComponent(repoId)}`, { method: "POST" });
      notify(`Verificación iniciada: ${repoId}`);
      refresh();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function ollamaMemory(name: string, load: boolean) {
    try {
      await api(`/api/models/ollama/${load ? "load" : "unload"}`, {
        method: "POST",
        body: JSON.stringify(load ? { name, keep_alive: "10m" } : { name }),
      });
      notify(load ? `${name} cargado durante 10 minutos` : `${name} descargado de memoria`);
      refresh();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function updateOllama(name: string) {
    try {
      await api("/api/models/ollama/update", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      notify(`Actualización iniciada: ${name}`);
      refresh();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function cancelJob(jobId: string) {
    try {
      await api(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      notify("Cancelación solicitada");
      refresh();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function remove(kind: "ollama" | "huggingface", name: string) {
    if (!window.confirm(`¿Eliminar ${name}? Esta acción libera sus archivos locales.`)) return;
    try {
      await api(`/api/models/${kind}/${encodeURIComponent(name)}?confirm=${encodeURIComponent(name)}`, { method: "DELETE" });
      notify(`${name} eliminado`);
      refresh();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  const runningNames = new Set((models?.running ?? []).map((model) => String(model.name)));
  const isOllamaLoaded = (model: Record<string, unknown>) => (
    Boolean(model.loaded) || runningNames.has(String(model.name))
  );
  const isActiveOllama = (model: Record<string, unknown>) => isOllamaLoaded(model) || Boolean(model.assistant);
  const isActiveHuggingFace = (model: { loaded?: boolean; assistant?: boolean }) => Boolean(model.loaded || model.assistant);
  const matchesLocalFilter = (source: "ollama" | "huggingface", model: Record<string, unknown>, filter: LocalModelFilter = localFilter) => {
    const sizeBytes = Number(model.size ?? 0);
    const searchable = JSON.stringify(model).toLowerCase();
    const category = localModelCategory(localModelCategoryHint(source, model)).label;
    const vision = ["Visión", "Imagen", "Vídeo"].includes(category);
    const audio = category === "Voz / audio";
    if (localQuery.trim() && !searchable.includes(localQuery.trim().toLowerCase())) return false;
    if (filter === "all") return true;
    if (filter === "loaded") return source === "ollama" ? isOllamaLoaded(model) : Boolean(model.loaded);
    if (filter === "text") return !vision && !audio;
    if (filter === "vision") return vision;
    if (filter === "audio") return audio;
    if (filter === "ollama" || filter === "huggingface") return source === filter;
    if (filter === "compact") return sizeBytes <= 10 * 1024 ** 3;
    if (filter === "medium") return sizeBytes > 10 * 1024 ** 3 && sizeBytes <= 50 * 1024 ** 3;
    return sizeBytes > 50 * 1024 ** 3;
  };
  const matchesRuntimeFilter = (model: Models["runtime_models"][number]) => {
    const searchable = `${model.name} ${model.model_id} ${model.engine} ${model.runtime} ${model.runtime_version}`.toLowerCase();
    if (localQuery.trim() && !searchable.includes(localQuery.trim().toLowerCase())) return false;
    return ["all", "loaded", "audio"].includes(localFilter);
  };
  const localCategoryLabel = (source: "ollama" | "huggingface", model: Record<string, unknown>) =>
    localModelCategory(localModelCategoryHint(source, model)).label;
  const runtimeCategoryLabel = (model: Models["runtime_models"][number]) =>
    localModelCategory(`${model.name} ${model.model_id} ${model.engine} ${model.runtime}`).label;
  const visibleModelSections = LOCAL_MODEL_SECTIONS.map((section) => ({
    ...section,
    count: (models?.runtime_models ?? []).filter((model) => matchesRuntimeFilter(model) && runtimeCategoryLabel(model) === section.sourceLabel).length
      + (models?.ollama ?? []).filter((model) => matchesLocalFilter("ollama", model) && localCategoryLabel("ollama", model) === section.sourceLabel).length
      + (models?.huggingface ?? []).filter((model) => matchesLocalFilter("huggingface", model as unknown as Record<string, unknown>) && localCategoryLabel("huggingface", model as unknown as Record<string, unknown>) === section.sourceLabel).length,
  })).filter((section) => section.count > 0);
  const localModelCount = (models?.ollama.length ?? 0) + (models?.huggingface.length ?? 0);
  const loadedModelCount = (models?.ollama ?? []).filter(isOllamaLoaded).length
    + (models?.huggingface ?? []).filter((model) => model.loaded).length
    + (models?.runtime_models ?? []).length;
  const totalMemory = overview?.metrics.memory_total ?? 0;
  const visibleLocalModelCount = (models?.ollama ?? []).filter((model) => matchesLocalFilter("ollama", model)).length
    + (models?.huggingface ?? []).filter((model) => matchesLocalFilter("huggingface", model as unknown as Record<string, unknown>)).length;
  const favoriteIds = new Set(favorites.map((model) => model.id));
  const ollamaJobs = jobs
    .filter((job) => job.kind === "ollama.pull" || job.kind === "ollama.update")
    .sort((a, b) => Number(activeJobStatuses.has(b.status)) - Number(activeJobStatuses.has(a.status)) || b.created_at.localeCompare(a.created_at))
    .slice(0, 8);
  const displayedJobs = jobs.reduce<Array<{ job: Job; duplicateCount: number }>>((groups, job) => {
    const created = Date.parse(job.created_at);
    const duplicate = job.status === "completed" && job.kind.startsWith("huggingface.") && job.kind.includes("download")
      ? groups.find((group) => (
          group.job.kind === job.kind
          && group.job.target === job.target
          && group.job.status === job.status
          && group.job.message === job.message
          && Math.abs(Date.parse(group.job.created_at) - created) <= 60_000
        ))
      : undefined;
    if (duplicate) duplicate.duplicateCount += 1;
    else groups.push({ job, duplicateCount: 1 });
    return groups;
  }, []);
  const filterCount = (value: LocalModelFilter) => (models?.ollama ?? []).filter((model) => matchesLocalFilter("ollama", model, value)).length
    + (models?.huggingface ?? []).filter((model) => matchesLocalFilter("huggingface", model as unknown as Record<string, unknown>, value)).length;
  const inspectionFileGroups = hfFileGroups(inspection?.remote?.files ?? []);
  const primaryInspectionGroups = inspectionFileGroups.filter((group) =>
    (group.kind === "weights" || group.kind === "mmproj")
    && group.files.some((file) => selectedFiles.includes(file.name))
  );
  const visibleInspectionGroups = showAllFileGroups || primaryInspectionGroups.length === 0
    ? inspectionFileGroups
    : primaryInspectionGroups;
  const hiddenInspectionGroupCount = inspectionFileGroups.length - visibleInspectionGroups.length;
  const selectedRemoteFiles = (inspection?.remote?.files ?? []).filter((file) => selectedFiles.includes(file.name));
  const selectedSizeKnown = selectedRemoteFiles.length === selectedFiles.length
    && selectedRemoteFiles.every((file) => typeof file.size === "number");
  const selectedDownloadSize = selectedRemoteFiles.reduce((total, file) => total + (file.size ?? 0), 0);
  const selectedDownloadTooLarge = Boolean(
    inspection
    && selectedSizeKnown
    && selectedDownloadSize > inspection.download_limit_bytes
  );

  function toggleHfFileGroup(group: HfFileGroup, checked: boolean) {
    const pending = group.files.filter((file) => !file.downloaded).map((file) => file.name);
    const weightFiles = new Set(
      inspectionFileGroups
        .filter((candidate) => candidate.kind === "weights")
        .flatMap((candidate) => candidate.files.map((file) => file.name)),
    );
    setSelectedFiles((current) => {
      const withoutGroup = current.filter((name) => !pending.includes(name));
      if (!checked) return withoutGroup;
      const base = group.kind === "weights"
        ? withoutGroup.filter((name) => !weightFiles.has(name))
        : withoutGroup;
      return [...base, ...pending];
    });
  }

  return (
    <div className="view-stack">
      <SectionHeading
        eyebrow="BIBLIOTECA LOCAL"
        title="Modelos"
        action={<button className="icon-button" onClick={refresh} aria-label="Actualizar"><RefreshCw size={17} /></button>}
      />
      <div className="tabs">
        <button className={tab === "installed" ? "active" : ""} onClick={() => setTab("installed")}><HardDrive size={14} /> Instalados <b className="tab-count">{localModelCount}</b></button>
        <button className={tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}><Sparkles size={14} /> Explorar Hugging Face</button>
        <button className={tab === "ollama" ? "active" : ""} onClick={() => setTab("ollama")}><Bot size={14} /> Descargar con Ollama{ollamaJobs.some((job) => activeJobStatuses.has(job.status)) && <b className="tab-count live">●</b>}</button>
      </div>

      {tab === "ollama" ? (
        <div className="ollama-pull-view">
          <Card className="ollama-hero">
            <div className="ollama-hero-icon"><Bot size={26} /></div>
            <div className="ollama-hero-copy">
              <span className="card-kicker">REGISTRO DE OLLAMA</span>
              <h3>Descarga un modelo por su nombre exacto</h3>
              <p>
                Escribe el nombre tal como aparece en la biblioteca de Ollama, o una ruta <code>hf.co/autor/repositorio:CUANTIZACIÓN</code> para
                traer un GGUF de Hugging Face a través de Ollama. No es un buscador: para descubrir modelos usa «Explorar Hugging Face».
              </p>
              <div className="model-help-toolbar">
                <button className="button secondary compact" type="button" onClick={() => setGlossaryRequest({ title: "Ayuda rápida de modelos", terms: MODEL_GLOSSARY, parsed: false })}><CircleHelp size={14} /> Ayuda</button>
                <small>Q8, GGUF, MoE, MTP, Heretic y más</small>
              </div>
              <form className="ollama-pull-form" onSubmit={pull}>
                <Download size={17} />
                <input value={ollamaName} onChange={(event) => setOllamaName(event.target.value)} placeholder="qwen3:8b · llama3.2:3b · hf.co/autor/modelo:Q4_K_M" aria-label="Nombre del modelo de Ollama" />
                <button className="button primary" type="submit" disabled={!ollamaName.trim()}>Descargar</button>
              </form>
              <div className="ollama-examples">
                <small>Ejemplos:</small>
                {["qwen3:8b", "llama3.2:3b", "gemma3:12b", "nomic-embed-text", "hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M"].map((example) => (
                  <button key={example} type="button" onClick={() => setOllamaName(example)}>{example}</button>
                ))}
                <a href="https://ollama.com/library" target="_blank" rel="noreferrer noopener"><ExternalLink size={12} /> Biblioteca de Ollama</a>
              </div>
            </div>
          </Card>
          <div className="ollama-tips">
            <div><Database size={16} /><span><strong>Se guarda en Ollama</strong><small>Aparece en Instalados con su cuantización, familia y parámetros.</small></span></div>
            <div><ShieldCheck size={16} /><span><strong>Límite de memoria</strong><small>MyDGX cancela la descarga si el tamaño no cabe en la memoria unificada.</small></span></div>
            <div><Gauge size={16} /><span><strong>Benchmark automático</strong><small>Al terminar se encola su medición si el modo automático está activo.</small></span></div>
          </div>
          <SectionHeading eyebrow="DESCARGAS" title="Actividad de Ollama" />
          {ollamaJobs.length ? <div className="ollama-job-list">
            {ollamaJobs.map((job) => {
              const active = activeJobStatuses.has(job.status);
              return <Card className={`ollama-job ${job.status}`} key={job.id}>
                <div>
                  {active ? <RefreshCw size={15} className="spin" /> : job.status === "completed" ? <CheckCircle2 size={15} /> : <X size={15} />}
                  <span><strong>{job.target}</strong><small>{jobLabel(job.kind)} · {jobStatusLabel(job.status)} · {job.message}</small></span>
                  <b>{Math.round(job.progress)}%</b>
                  {["queued", "running"].includes(job.status) && <button className="icon-button danger" onClick={() => cancelJob(job.id)} aria-label="Cancelar descarga"><X size={14} /></button>}
                </div>
                {active && <div className="sidebar-operation-progress"><span style={{ width: `${job.progress}%` }} /></div>}
              </Card>;
            })}
          </div> : <Empty icon={<Download />} title="Sin descargas de Ollama" text="Las descargas que lances aparecerán aquí con su progreso." />}
        </div>
      ) : tab === "installed" ? (
        <>

          <UnifiedMemoryMap models={models} overview={overview} modelMetrics={modelMetrics} />

          <div className="local-model-summary">
            <span><Boxes size={15} /><strong>{localModelCount}</strong> modelos locales</span>
            <span className="loaded"><StatusDot online /><strong>{loadedModelCount}</strong> cargados en memoria</span>
            <span><Bot size={15} /><strong>{models?.assistant_model || "Sin modelo"}</strong> chatbot</span>
          </div>

          <div className="local-model-filters" aria-label="Filtrar modelos instalados">
            {([
              ["all", "Todos"],
              ["loaded", "Cargados"],
              ["text", "Texto"],
              ["vision", "Visión / imagen / vídeo"],
              ["audio", "Voz / audio"],
              ["ollama", "Ollama"],
              ["huggingface", "Hugging Face"],
              ["compact", "≤ 10 GB"],
              ["medium", "10–50 GB"],
              ["large", "> 50 GB"],
            ] as Array<[LocalModelFilter, string]>).map(([value, label]) => (
              <button className={localFilter === value ? "active" : ""} key={value} onClick={() => setLocalFilter(value)} type="button" disabled={value !== "all" && filterCount(value) === 0 && localFilter !== value}>{label}<b>{filterCount(value)}</b></button>
            ))}
            <label className={`local-model-search${searchStateClass(localQuery, visibleLocalModelCount + (models?.runtime_models ?? []).filter(matchesRuntimeFilter).length)}`} data-count={searchCountLabel(localQuery, visibleLocalModelCount + (models?.runtime_models ?? []).filter(matchesRuntimeFilter).length)}>
              <Search size={14} />
              <input
                aria-label="Buscar modelos instalados"
                onChange={(event) => setLocalQuery(event.target.value)}
                placeholder="Buscar modelos"
                type="search"
                value={localQuery}
              />
              {localQuery && <button aria-label="Limpiar búsqueda" onClick={() => setLocalQuery("")} type="button"><X size={13} /></button>}
            </label>
          </div>

          <div className="model-list">
            {visibleModelSections.map((category, categoryIndex) => <div className="model-category-wrapper" key={category.key}>
              {category.managed && !visibleModelSections[categoryIndex - 1]?.managed && <div className="managed-model-divider">
                <span>Recursos seleccionados automáticamente</span>
                <small>Los motores de imagen, vídeo y audio cargan el recurso adecuado cuando ejecutas una tarea.</small>
              </div>}
              <section className={`model-category-section ${category.managed ? "is-managed" : "is-user-selectable"}`}>
                <div className="model-category-title">
                  <div><strong>{category.title}</strong><small>{category.managed ? "Gestionados por su motor o perfil" : "Puedes activarlos desde aquí o desde un perfil"}</small></div>
                  <span>{category.count}</span>
                </div>
            {[true, false].map((loadedGroup) => {
              const runtimeCount = loadedGroup ? (models?.runtime_models ?? []).filter((model) => matchesRuntimeFilter(model) && runtimeCategoryLabel(model) === category.sourceLabel).length : 0;
              const ollamaCount = (models?.ollama ?? []).filter((model) => isActiveOllama(model) === loadedGroup && matchesLocalFilter("ollama", model) && localCategoryLabel("ollama", model) === category.sourceLabel).length;
              const huggingFaceCount = (models?.huggingface ?? []).filter((model) => isActiveHuggingFace(model) === loadedGroup && matchesLocalFilter("huggingface", model as unknown as Record<string, unknown>) && localCategoryLabel("huggingface", model as unknown as Record<string, unknown>) === category.sourceLabel).length;
              if (!(runtimeCount + ollamaCount + huggingFaceCount)) return null;
              return <div className={`model-category-cards ${loadedGroup ? "is-active" : "is-available"}`} key={loadedGroup ? "loaded" : "unloaded"}>
            {loadedGroup && (models?.runtime_models ?? []).filter((model) => matchesRuntimeFilter(model) && runtimeCategoryLabel(model) === category.sourceLabel).map((model) => (
              <LocalModelCard
                key={`${model.engine}:${model.name}`}
                source="runtime"
                name={model.name}
                path={model.model_id}
                loaded
                badges={<><span className="badge runtime">{model.engine}</span><UncensoredBadge name={`${model.name} ${model.model_id}`} /></>}
                categoryHint={`${model.name} ${model.model_id} ${model.engine}`}
                meta={model.runtime_version ? `${model.runtime} ${model.runtime_version}` : model.runtime}
                specs={[
                  { label: "Motor", value: model.engine },
                  { label: "Parámetros", value: parametersFromName(model.model_id || model.name) },
                  { label: "Memoria", value: "Estimada", title: "Memoria estimada hasta disponer de atribución directa" },
                ]}
                size={model.size}
                total={totalMemory}
                estimated
                actions={<ModelTermsButton text={`${model.name} ${model.model_id} ${model.engine} ${model.runtime}`} label={model.name} onOpen={setGlossaryRequest} />}
              />
            ))}
            {(models?.ollama ?? []).filter((model) => isActiveOllama(model) === loadedGroup && matchesLocalFilter("ollama", model) && localCategoryLabel("ollama", model) === category.sourceLabel).map((model) => {
              const name = String(model.name);
              const details = (model.details ?? {}) as Record<string, unknown>;
              const loaded = isOllamaLoaded(model);
              const loadedBy = (model.loaded_by as string[] | undefined) ?? [];
              const profileOwner = loadedBy.find((owner) => owner !== "Ollama");
              const quickKey = `ollama:${name}`;
              return (
                <LocalModelCard
                  key={name}
                  source="ollama"
                  name={name}
                  loaded={loaded}
                  assistant={Boolean(model.assistant)}
                  badges={<>
                    {loadedBy.filter((owner) => owner !== "Ollama").map((owner) => <span className={`badge runtime ${owner === "Quick" ? "quick" : ""}`} key={owner}>{owner}</span>)}
                    {Boolean(model.assistant) && <span className="badge assistant"><Bot size={11} /> Chatbot</span>}
                    {Boolean(model.persistent) && <span className="badge">Default</span>}
                    <UncensoredBadge name={name} />
                  </>}
                  categoryHint={localModelCategoryHint("ollama", model)}
                  meta={model.modified_at ? `actualizado ${new Date(String(model.modified_at)).toLocaleDateString()}` : ""}
                  specs={[
                    { label: "Parámetros", value: String(details.parameter_size || "") || parametersFromName(name) },
                    { label: "Cuantización", value: String(details.quantization_level || "") },
                    { label: "Familia", value: String(details.family || "") },
                    { label: "Formato", value: String(details.format || "").toUpperCase() },
                    { label: "Digest", value: String(model.digest || "").slice(0, 12), title: String(model.digest || "") },
                  ]}
                  size={Number(model.size)}
                  total={totalMemory}
                  actions={<>
                    <label className="persistence-toggle" title="Incluir en el perfil Default, que arranca siempre con MyDGX">
                      <input type="checkbox" checked={Boolean(model.persistent)} onChange={(event) => void togglePersistence("ollama", name, event.target.checked)} />
                      <span>Default</span>
                    </label>
                    <ModelTermsButton text={`${name} ${JSON.stringify(details)}`} label={name} onOpen={setGlossaryRequest} />
                    <span className="lc-actions-spacer" />
                    {model.quick
                      ? <button className="button danger compact" disabled={quickBusy !== null} onClick={() => void quickModel("ollama", name, false)} aria-label={`Apagar ${name}`}><Square size={13} /> {quickBusy === quickKey ? "Apagando…" : "Apagar"}</button>
                      : profileOwner
                        ? <button className="button secondary compact" disabled title={`Cargado por el perfil ${profileOwner}; detenlo desde Perfiles`}><Square size={13} /> {profileOwner}</button>
                        : loaded
                          ? <button className="button secondary compact" onClick={() => ollamaMemory(name, false)} aria-label={`Descargar ${name} de memoria`}><Square size={13} /> Liberar</button>
                          : <QuickStartButton label={name} availability={model.quick_start as QuickStart | undefined} busy={quickBusy !== null} pending={quickBusy === quickKey} title="Cargar ahora en el perfil Quick; no se restaura al reiniciar el equipo" onStart={() => void quickModel("ollama", name, true)} />}
                    <button className="icon-button" onClick={() => updateOllama(name)} title="Actualizar desde el registro" aria-label={`Actualizar ${name}`}><RefreshCw size={15} /></button>
                    <button
                      className="icon-button danger"
                      disabled={Boolean(model.assistant)}
                      title={model.assistant ? "Protegido: este modelo lo utiliza el chatbot" : `Eliminar ${name}`}
                      onClick={() => remove("ollama", name)}
                      aria-label={model.assistant ? `${name} está protegido porque lo utiliza el chatbot` : `Eliminar ${name}`}
                    >{model.assistant ? <ShieldCheck size={16} /> : <Trash2 size={16} />}</button>
                  </>}
                />
              );
            })}
            {(models?.huggingface ?? []).filter((model) => isActiveHuggingFace(model) === loadedGroup && matchesLocalFilter("huggingface", model as unknown as Record<string, unknown>) && localCategoryLabel("huggingface", model as unknown as Record<string, unknown>) === category.sourceLabel).map((model) => {
              const verification = jobs.find((job) => (
                job.kind === "huggingface.integrity" && job.target === model.repo_id
              ));
              const verificationActive = Boolean(verification && ["queued", "running"].includes(verification.status));
              const architecture = model.configuration.architectures;
              const architectureLabel = Array.isArray(architecture) ? architecture.join(", ") : String(architecture || model.configuration.model_type || "");
              const incomplete = Boolean(model.partial_downloads || model.incomplete_shards);
              const cardOnly = model.formats.length === 0;
              const runnable = model.quantizations.length > 0 && model.formats.includes("GGUF");
              const baseName = modelBaseName(model.repo_id);
              const ggufVariant = runnable || !baseName ? undefined : (models?.huggingface ?? []).find((other) => other.repo_id !== model.repo_id && other.formats.includes("GGUF") && other.quantizations.length > 0 && other.repo_id.toLowerCase().replace(/[^a-z0-9]/g, "").includes(baseName));
              const variantHint = ggufVariant ? ` Para usarlo enciende ${ggufVariant.repo_id}, la versión GGUF que ya está descargada.` : "";
              const unsupportedReason = cardOnly
                ? `Sin pesos: solo se descargó la ficha (README).${variantHint || " Descarga los pesos para poder usarlo."}`
                : runnable ? undefined
                : `${unsupportedQuickStartReason(localModelCategory(localModelCategoryHint("huggingface", model as unknown as Record<string, unknown>)).label)}.${variantHint}`;
              return (
                <LocalModelCard
                  key={model.repo_id}
                  source="huggingface"
                  name={huggingFaceModelName(model.repo_id)}
                  path={model.repo_id}
                  loaded={Boolean(model.loaded)}
                  assistant={model.assistant}
                  badges={<>
                    {(model.loaded_by ?? []).map((runtime) => <span className={`badge runtime ${runtime === "Quick" ? "quick" : ""}`} key={runtime}>{runtime}</span>)}
                    {model.assistant && <span className="badge assistant"><Bot size={11} /> Chatbot</span>}
                    {model.persistent && <span className="badge">Default</span>}
                    <UncensoredBadge name={model.repo_id} flagged={model.uncensored} />
                    {incomplete && <span className="badge warning">Incompleto</span>}
                    {cardOnly && <span className="badge warning" title="Solo está la ficha del modelo; no hay archivos de pesos">Sin pesos</span>}
                  </>}
                  categoryHint={localModelCategoryHint("huggingface", model as unknown as Record<string, unknown>)}
                  meta={`${model.snapshot_count} snapshot${model.snapshot_count === 1 ? "" : "s"} · ${model.file_count} archivo${model.file_count === 1 ? "" : "s"}${model.shard_count ? ` · ${model.shard_count} shards` : ""}`}
                  specs={[
                    { label: "Parámetros", value: parametersFromName(model.repo_id) },
                    { label: "Cuantización", value: model.quantizations.join(", ") },
                    { label: "Formato", value: model.formats.map((format) => format.toUpperCase()).join(", ") },
                    { label: "Arquitectura", value: architectureLabel },
                    { label: "Contexto nativo", value: contextLabel(model.configuration.max_position_embeddings) },
                    { label: "Revisión", value: model.revision ? model.revision.slice(0, 10) : "", title: model.revision },
                  ]}
                  size={model.size}
                  total={totalMemory}
                  extra={verification && <div className={`model-verification ${verification.status}`}>
                    <ShieldCheck size={13} />
                    <div><strong>{verification.message}</strong><small>{verification.status === "completed" ? "Integridad comprobada" : verification.status === "failed" ? "La verificación falló" : `${Math.round(verification.progress)}% completado`}</small></div>
                    {verificationActive && <span style={{ width: `${verification.progress}%` }} />}
                  </div>}
                  actions={<>
                    <label className={`persistence-toggle ${model.quantizations.length ? "" : "disabled"}`} title={model.quantizations.length ? "Incluir en el perfil Default, que arranca siempre con MyDGX" : "El perfil Default requiere un GGUF"}>
                      <input type="checkbox" disabled={!model.quantizations.length} checked={model.persistent} onChange={(event) => void togglePersistence("huggingface", model.repo_id, event.target.checked)} />
                      <span>Default</span>
                    </label>
                    <ModelTermsButton text={`${model.repo_id} ${model.formats.join(" ")} ${model.quantizations.join(" ")} ${architectureLabel} ${(model.tasks ?? []).join(" ")}`} label={model.repo_id} onOpen={setGlossaryRequest} />
                    <span className="lc-actions-spacer" />
                    {model.quick
                      ? <button className="button danger compact" disabled={quickBusy !== null} onClick={() => void quickModel("huggingface", model.repo_id, false)} aria-label={`Apagar ${model.repo_id}`}><Square size={13} /> {quickBusy === `huggingface:${model.repo_id}` ? "Apagando…" : "Apagar"}</button>
                      : model.loaded_by.includes("ComfyUI")
                        ? <button className="button secondary compact" disabled={quickBusy !== null} onClick={() => void releaseComfyUI(model.repo_id)} title="ComfyUI descarga de memoria todos los modelos que tenga cargados; se vuelven a cargar en la siguiente generación" aria-label={`Liberar ${model.repo_id} de ComfyUI`}><Square size={13} /> {quickBusy === `comfyui:${model.repo_id}` ? "Liberando…" : "Liberar"}</button>
                      : !model.loaded && !incomplete
                        && <QuickStartButton label={model.repo_id} availability={model.quick_start} unsupportedReason={unsupportedReason} busy={quickBusy !== null} pending={quickBusy === `huggingface:${model.repo_id}`} title="Cargar ahora con llama.cpp en el perfil Quick; no se restaura al reiniciar el equipo" onStart={() => void quickModel("huggingface", model.repo_id, true)} />}
                    <a className="icon-button" href={`https://huggingface.co/${model.repo_id}`} target="_blank" rel="noreferrer noopener" title="Abrir en Hugging Face" aria-label={`Abrir ${model.repo_id} en Hugging Face`}><ExternalLink size={15} /></a>
                    <button className="button secondary compact" disabled={inspectingRepo !== null} onClick={() => inspect(model.repo_id)} aria-label={`Inspeccionar ${model.repo_id}`}><Search className={inspectingRepo === model.repo_id ? "spin" : ""} size={13} /> Detalles</button>
                    <button className="icon-button" disabled={verificationActive} onClick={() => verifyIntegrity(model.repo_id)} aria-label={`Verificar ${model.repo_id}`} title={verification?.message || "Verificar integridad (SHA-256)"}><ShieldCheck className={verificationActive ? "spin" : ""} size={15} /></button>
                    <button
                      className="icon-button danger"
                      disabled={model.assistant}
                      title={model.assistant ? "Protegido: este modelo lo utiliza el chatbot" : `Eliminar ${model.repo_id}`}
                      onClick={() => remove("huggingface", model.repo_id)}
                      aria-label={model.assistant ? `${model.repo_id} está protegido porque lo utiliza el chatbot` : `Eliminar ${model.repo_id}`}
                    >{model.assistant ? <ShieldCheck size={16} /> : <Trash2 size={16} />}</button>
                  </>}
                />
              );
            })}
            </div>;
            })}
              </section>
            </div>)}
            {!models?.ollama.length && !models?.huggingface.length && <Empty icon={<Boxes />} title="No hay modelos locales" text="Descarga tu primer modelo desde «Explorar Hugging Face» o «Descargar con Ollama»." />}
            {localModelCount > 0 && visibleLocalModelCount === 0 && <Empty icon={<Search />} title="Ningún modelo coincide" text="Prueba otro filtro." />}
          </div>
        </>
      ) : (
        <>
          <Card className="spark-search-panel">
            <div className="catalog-mode-switch">
              <button className={catalogMode === "spark" ? "active" : ""} onClick={() => setCatalogMode("spark")} type="button"><Sparkles size={13} /> Para este Spark</button>
              <button className={catalogMode === "all" ? "active" : ""} onClick={() => setCatalogMode("all")} type="button"><Globe size={13} /> Todo Hugging Face</button>
              <button className={catalogMode === "favorites" ? "active" : ""} onClick={() => setCatalogMode("favorites")} type="button"><Star size={13} fill={catalogMode === "favorites" ? "currentColor" : "none"} /> Favoritos</button>
            </div>
            <div className="model-help-toolbar catalog-help">
              <button className="button secondary compact" type="button" onClick={() => setGlossaryRequest({ title: "Ayuda rápida de Hugging Face", terms: MODEL_GLOSSARY, parsed: false })}><CircleHelp size={14} /> Ayuda</button>
              <small>¿Q8, MTP, Heretic o Abliterated? Explicaciones simples</small>
            </div>
            <div className="spark-search-copy">
              <div className="spark-search-icon">{catalogMode === "spark" ? <Sparkles /> : catalogMode === "all" ? <Globe /> : <Star />}</div>
              <div><strong>{catalogMode === "spark" ? "Recomendador para este Spark" : catalogMode === "all" ? "Búsqueda general en Hugging Face" : "Modelos guardados para probar"}</strong><small>{catalogMode === "spark" ? (alignment === "uncensored" ? "Analiza memoria, GGUF y el catálogo hft.md de modelos sin censura o abliterados." : "Analiza memoria libre, GGUF, contexto, runtime GB10 y calidad de la ficha.") : catalogMode === "all" ? "Busca cualquier modelo, autor o arquitectura publicada en el Hub." : "Tu lista persistente de candidatos para revisar, comparar o descargar más adelante."}</small></div>
            </div>
            {catalogMode !== "favorites" && <form className={`search-bar${searchStateClass(query, hasSearched && !busy ? (catalogMode === "all" ? allResults : results).length : null)}`} data-count={searchCountLabel(query, hasSearched && !busy ? (catalogMode === "all" ? allResults : results).length : null)} onSubmit={search} ref={searchFormRef}>
              <Search size={18} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ejemplo: Qwen coder, Llama instruct, reasoning…" />
              <button className="button primary" type="submit" disabled={busy}>{busy ? (catalogMode === "spark" ? "Analizando…" : "Buscando…") : (catalogMode === "spark" ? "Recomendar" : "Buscar")}</button>
            </form>}
            {catalogMode !== "favorites" && <a className="hft-catalog-link" href="https://hft.md/uncensored-ai/" target="_blank" rel="noreferrer noopener">
              <ExternalLink size={13} />
              <span>Catálogo sin censura</span>
              <span className="hft-catalog-url">https://hft.md/uncensored-ai/</span>
            </a>}
            {catalogMode === "spark" ? <div className="recommendation-filters">
              <label><span>Tarea</span><select value={task} onChange={(event) => setTask(event.target.value as typeof task)}>
                <option value="any">Cualquier tarea</option><option value="chat">Chat</option><option value="code">Código</option>
                <option value="reasoning">Reasoning</option><option value="embedding">Embeddings</option><option value="vision">Visión</option>
                <option value="audio-chat">Chat con audio</option><option value="video-chat">Chat con vídeo</option>
                <option value="image-generation">Generación de imagen</option><option value="asr">Audio a texto</option>
                <option value="tts">Texto a audio</option><option value="video-generation">Generación de vídeo</option>
                <option value="reranking">Reranking</option>
              </select></label>
              <label><span>Tamaño</span><select value={size} onChange={(event) => setSize(event.target.value as typeof size)}>
                <option value="any">Mejor calidad que quepa</option><option value="compact">Compacto · hasta 16 GB</option>
                <option value="balanced">Equilibrado · hasta 48 GB</option><option value="large">Grande · memoria disponible</option>
              </select></label>
              <label><span>Contenido</span><select value={alignment} onChange={(event) => setAlignment(event.target.value as typeof alignment)}>
                <option value="any">Todos los modelos</option><option value="uncensored">Sin censura · uncensored / abliterated</option>
                <option value="standard">Estándar</option>
              </select></label>
              <label><span>Entrada</span><select value={modality} onChange={(event) => setModality(event.target.value as typeof modality)}>
                <option value="any">Cualquier modalidad</option><option value="text">Texto</option><option value="image">Imagen</option>
                <option value="audio">Audio</option><option value="video">Vídeo</option>
              </select></label>
              <label><span>Runtime</span><select value={runtime} onChange={(event) => setRuntime(event.target.value as typeof runtime)}>
                <option value="any">Mejor runtime disponible</option><option value="llama.cpp">llama.cpp · GGUF</option>
                <option value="external">Motor externo local</option>
              </select></label>
              <label><span>Formato</span><select value={modelFormat} onChange={(event) => setModelFormat(event.target.value as typeof modelFormat)}>
                <option value="any">Cualquier formato</option><option value="gguf">GGUF</option>
                <option value="safetensors">Safetensors</option><option value="onnx">ONNX</option>
              </select></label>
              <label><span>Resultados</span><select value={sparkLimit} onChange={(event) => setSparkLimit(Number(event.target.value) as typeof sparkLimit)}>
                <option value={12}>12 por búsqueda · más rápido</option>
                <option value={18}>18 por búsqueda</option>
                <option value={30}>30 por búsqueda · más completo</option>
              </select></label>
              <span className="memory-live"><StatusDot online />Ranking con telemetría en vivo</span>
            </div> : catalogMode === "all" ? <div className="general-search-filters">
              <label><span>Capacidad</span><select value={task} onChange={(event) => setTask(event.target.value as typeof task)}>
                <option value="any">Cualquier capacidad</option><option value="chat">Chat</option><option value="vision">Chat con imagen</option>
                <option value="audio-chat">Chat con audio</option><option value="video-chat">Chat con vídeo</option>
                <option value="embedding">Embeddings</option><option value="image-generation">Generación de imagen</option>
                <option value="asr">ASR</option><option value="tts">TTS</option><option value="video-generation">Generación de vídeo</option>
                <option value="reranking">Reranking</option>
              </select></label>
              <label><span>Entrada</span><select value={modality} onChange={(event) => setModality(event.target.value as typeof modality)}>
                <option value="any">Cualquier modalidad</option><option value="text">Texto</option><option value="image">Imagen</option>
                <option value="audio">Audio</option><option value="video">Vídeo</option>
              </select></label>
              <span className="general-search-note"><Gauge size={13} />Score para este Spark · comunidad HF como señal secundaria</span>
            </div> : <div className="favorite-summary"><Star size={14} fill="currentColor" /><strong>{favorites.length}</strong><span>modelo(s) guardado(s)</span></div>}
          </Card>

          {catalogMode === "spark" ? <>
            {results.length > 0 && <SectionHeading
              eyebrow={installedRecommendations ? `ORDEN DINÁMICO · ${installedRecommendations} ya instalado${installedRecommendations === 1 ? "" : "s"}` : "ORDEN DINÁMICO"}
              title="Recomendados para este Spark"
              action={<select className="benchmark-comparison-select" value={sparkSort} onChange={(event) => setSparkSort(event.target.value as typeof sparkSort)} aria-label="Ordenar recomendados">
                <option value="recommended">Recomendación para este Spark</option>
                <option value="speed">Rendimiento estimado (tok/s)</option>
                <option value="memory">Menor memoria</option>
                <option value="community">Score comunidad HF</option>
                <option value="downloads">Más descargados</option>
                <option value="likes">Más likes</option>
                <option value="trending">Tendencia</option>
                <option value="name">Nombre</option>
              </select>}
            />}
            <div className="catalog-grid recommendation-grid">
              {results
                .map((model, index) => ({ model, index }))
                .sort((a, b) => {
                  const fit = Number(b.model.fits) - Number(a.model.fits);
                  switch (sparkSort) {
                    case "speed": return fit || (b.model.estimated_tokens_per_second ?? 0) - (a.model.estimated_tokens_per_second ?? 0) || a.index - b.index;
                    case "memory": return a.model.estimated_memory_mb - b.model.estimated_memory_mb || a.index - b.index;
                    case "community": return b.model.community_score - a.model.community_score || a.index - b.index;
                    case "downloads": return b.model.downloads - a.model.downloads;
                    case "likes": return b.model.likes - a.model.likes;
                    case "trending": return b.model.trending_score - a.model.trending_score || a.index - b.index;
                    case "name": return a.model.id.localeCompare(b.model.id);
                    default: return a.index - b.index;
                  }
                })
                .map(({ model, index }) => {
              const memoryPercent = Math.min(100, Math.round(model.estimated_memory_mb / Math.max(1, model.memory_budget_mb) * 100));
              const statusClass = model.recommendation_status.toLowerCase().replace(" ", "-");
              const installed = downloadedRepos.has(model.id.toLowerCase());
              return (
                <Card className={`catalog-card recommendation-card ${model.fits ? "" : "not-fit"} ${installed ? "installed" : ""}`} key={model.id}>
                  <div className="recommendation-head">
                    <span className="recommendation-position">#{index + 1}</span>
                    <div className="score-ring" style={{ "--score": `${model.recommended_score * 3.6}deg` } as CSSProperties}>
                      <strong>{model.recommended_score}</strong><small>/100</small>
                    </div>
                    <span className={`recommendation-status ${statusClass}`}>{model.recommendation_status}</span>
                  </div>
                  <div className="catalog-top"><div className="model-icon hf"><HuggingFaceIcon /></div><div className="recommendation-tags">{installed && <span className="installed">instalado</span>}{model.uncensored && <span className="uncensored">sin censura</span>}{model.hft_catalog && <span className="uncensored">hft.md</span>}{model.tasks.map((item) => <span key={item}>{item}</span>)}</div></div>
                  <div className="recommendation-name" title={model.id}>
                    <span><strong>{model.id.split("/").pop() || model.id}</strong><ModelTermsButton text={`${model.id} ${model.recommended_quantization} ${model.architecture} ${model.runtime_requirement} ${model.speculative_methods.join(" ")} ${model.tasks.join(" ")}`} label={model.id} onOpen={setGlossaryRequest} /></span>
                    {model.id.includes("/") && <small>{model.id}</small>}
                  </div>
                  {model.hft_catalog && <div className="hft-catalog-score" title={model.hft_catalog.summary || "Catálogo hft.md"}>
                    <a href={model.hft_catalog.url} target="_blank" rel="noreferrer">hft.md</a>
                    {model.hft_catalog.uncensored_iq != null && <span>IQ {model.hft_catalog.uncensored_iq}</span>}
                    {model.hft_catalog.reasoning != null && <span>razonamiento {model.hft_catalog.reasoning}</span>}
                    {model.hft_catalog.answers && <span>respuestas {model.hft_catalog.answers}</span>}
                    {model.hft_catalog.base_model && <span>{model.hft_catalog.base_model}</span>}
                  </div>}
                  <small>{model.downloads.toLocaleString()} descargas · {model.likes.toLocaleString()} likes · {model.license || "licencia no indicada"}</small>
                  <div className="hf-community-score" title={`Descargas ${model.community_signals.download_points}/50 · Likes ${model.community_signals.like_points}/40 · Tendencia ${model.community_signals.trending_points}/10`}>
                    <Star size={12} fill="currentColor" /><strong>{model.community_score}/100</strong><span>Comunidad HF</span>
                    {model.trending_score > 0 && <small>tendencia {model.trending_score.toLocaleString()}</small>}
                  </div>
                  <div className="modality-flow"><span>{model.input_modalities.join(" + ")}</span><ChevronRight size={11} /><span>{model.output_modalities.join(" + ")}</span></div>
                  <div className="recommendation-specs">
                    <span><small>Formato</small><strong>{model.recommended_quantization || model.formats.join(" / ") || "Snapshot HF"}</strong></span>
                    <span><small>{model.recommended_context ? "Contexto" : "Runtime"}</small><strong>{model.recommended_context ? `${Math.round(model.recommended_context / 1024)}K` : "Externo local"}</strong></span>
                    <span title="Estimación comparativa basada en pesos activos y ancho de banda; no sustituye un benchmark"><small>Arquitectura</small><strong>{model.architecture}{model.active_parameters_b ? ` · ${model.active_parameters_b}B activos` : ""}</strong></span>
                    <span title="Estimación conservadora; depende del runtime, plantilla, contexto y batching"><small>Rendimiento</small><strong>{model.estimated_tokens_per_second ? `≈${model.estimated_tokens_per_second} tok/s · ${model.recommended_slots} slot(s)` : "Según runtime"}</strong></span>
                    {model.speculative_methods.length > 0 && <span><small>Especulativa</small><strong>{model.speculative_methods.join(" · ")}</strong></span>}
                    {model.spark_count > 1 && <span><small>Cluster</small><strong>{model.spark_count} Sparks · {model.memory_bandwidth_gbps} GB/s</strong></span>}
                    <span><small>Memoria</small><strong>{Math.round(model.estimated_memory_mb / 1024)} GB</strong></span>
                  </div>
                  <div className="memory-fit"><div><span style={{ width: `${memoryPercent}%` }} /></div><small>{memoryPercent}% del presupuesto · {Math.round(model.memory_budget_mb / 1024)} GB utilizables</small></div>
                  <div className="recommendation-reasons">
                    {model.artifex_verified && <span className="verified"><ShieldCheck size={12} />Verificado por ARTIFEX</span>}
                    {model.recommended_mmproj_file && <span className="verified"><ShieldCheck size={12} />mmproj incluido · {model.recommended_mmproj_file}</span>}
                    {model.reasons.slice(0, 2).map((reason) => <span key={reason}><Zap size={11} />{reason}</span>)}
                    {model.warnings.slice(0, 1).map((warning) => <span className="warning" key={warning}><Activity size={11} />{warning}</span>)}
                  </div>
                  <small className="runtime-note">{model.runtime_requirement} · {model.recommended_engines.slice(0, 3).join(" / ")}</small>
                  <div className="catalog-actions">
                    <button className={`icon-button favorite-button ${favoriteIds.has(model.id) ? "selected" : ""}`} onClick={() => void toggleHfFavorite(model.id, !favoriteIds.has(model.id))} aria-label={favoriteIds.has(model.id) ? `Quitar ${model.id} de favoritos` : `Guardar ${model.id} en favoritos`}><Star size={15} fill={favoriteIds.has(model.id) ? "currentColor" : "none"} /></button>
                    <button className="button secondary" disabled={inspectingRepo !== null} onClick={() => inspect(model.id, model.recommended_files)}><Search className={inspectingRepo === model.id ? "spin" : ""} size={15} /> {inspectingRepo === model.id ? "Abriendo…" : "Detalles"}</button>
                    {installed
                      ? <button className="button primary" disabled><CheckCircle2 size={15} /> Instalado</button>
                      : model.gguf_search
                      ? <button className="button primary" onClick={() => searchGgufVariant(model.gguf_search ?? "")} title="Este modelo solo tiene pesos safetensors o PyTorch y en la Spark no hay motor que los ejecute; busca una versión GGUF para llama.cpp"><Search size={15} /> Buscar versión GGUF</button>
                      : <button className="button primary" disabled={!model.fits || downloadBusy !== null} onClick={() => downloadRecommendation(model)}><Download className={downloadBusy === model.id ? "spin" : ""} size={15} /> {downloadBusy === model.id ? "Preparando…" : model.recommended_files.length ? "Descargar recomendada" : "Descargar snapshot"}</button>}
                  </div>
                </Card>
              );
              })}
            </div>
            {!busy && results.length > 0 && <div className="catalog-load-more">
              <button className="button secondary" type="button" disabled={loadingMore || noMoreResults} onClick={() => void loadMoreRecommendations()}>
                <Search className={loadingMore ? "spin" : ""} size={15} />
                {loadingMore ? "Analizando más candidatos…" : noMoreResults ? "No hay más resultados" : `Buscar ${sparkLimit} más`}
              </button>
              <small>{results.length} analizados{sparkPage > 0 ? ` · ${sparkPage + 1} rondas` : ""} · los nuevos se añaden al final y se pueden reordenar con el selector</small>
            </div>}
            {!busy && hasSearched && results.length === 0 && <Empty icon={<Boxes />} title="Sin modelos recomendables" text="Prueba otra búsqueda o amplía los filtros." />}
          </> : catalogMode === "all" ? <>
            {allResults.length > 0 && <SectionHeading eyebrow="HUGGING FACE HUB" title={`${allResults.length} resultados generales`} />}
            <div className="catalog-grid general-results-grid">
              {allResults.map((model) => {
                const installed = downloadedRepos.has(model.id.toLowerCase());
                const recommendationStatus = model.recommendation_status || "No recomendado";
                const statusClass = recommendationStatus.toLowerCase().replace(" ", "-");
                const sparkScore = model.recommended_score ?? 0;
                return (
                <Card className={`catalog-card general-result-card ${installed ? "installed" : ""}`} key={model.id}>
                  <div className="recommendation-head general-score-head">
                    <span className="recommendation-position">SPARK</span>
                    <div className="score-ring" style={{ "--score": `${sparkScore * 3.6}deg` } as CSSProperties}>
                      <strong>{sparkScore}</strong><small>/100</small>
                    </div>
                    <span className={`recommendation-status ${statusClass}`}>{recommendationStatus}</span>
                  </div>
                  <div className="catalog-top">
                    <div className="model-icon hf"><HuggingFaceIcon /></div>
                    <div className="recommendation-tags">
                      {installed && <span className="installed">instalado</span>}
                      {model.pipeline_tag && <span>{model.pipeline_tag}</span>}
                      {model.uncensored && <span className="uncensored">sin censura</span>}
                      {model.gated && <span className="restricted">gated</span>}
                    </div>
                  </div>
                  <div className="catalog-model-name"><strong title={model.id}>{model.id}</strong><ModelTermsButton text={`${model.id} ${model.pipeline_tag ?? ""} ${model.tags.join(" ")} ${model.tasks.join(" ")}`} label={model.id} onOpen={setGlossaryRequest} /></div>
                  <small>{model.downloads.toLocaleString()} descargas · {model.likes.toLocaleString()} likes</small>
                  {typeof model.community_score === "number" && <div className="hf-community-score" title={model.community_signals ? `Descargas ${model.community_signals.download_points}/50 · Likes ${model.community_signals.like_points}/40 · Tendencia ${model.community_signals.trending_points}/10` : "Popularidad relativa en Hugging Face"}>
                    <Star size={12} fill="currentColor" /><strong>{model.community_score}/100</strong><span>Comunidad HF</span>
                    {(model.trending_score ?? 0) > 0 && <small>tendencia {model.trending_score?.toLocaleString()}</small>}
                  </div>}
                  <div className="modality-flow"><span>{model.input_modalities.join(" + ")}</span><ChevronRight size={11} /><span>{model.output_modalities.join(" + ")}</span></div>
                  <div className="general-spark-summary">
                    <span><small>Configuración</small><strong>{model.recommended_quantization || (model.formats ?? []).join(" / ") || "Runtime externo"}</strong></span>
                    <span><small>Memoria estimada</small><strong>{model.estimated_memory_mb ? `${Math.round(model.estimated_memory_mb / 1024)} GB` : "Por determinar"}</strong></span>
                  </div>
                  <div className="general-model-tags">{model.tags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}</div>
                  <div className="catalog-actions">
                    <button className={`icon-button favorite-button ${favoriteIds.has(model.id) ? "selected" : ""}`} onClick={() => void toggleHfFavorite(model.id, !favoriteIds.has(model.id))} aria-label={favoriteIds.has(model.id) ? `Quitar ${model.id} de favoritos` : `Guardar ${model.id} en favoritos`}><Star size={15} fill={favoriteIds.has(model.id) ? "currentColor" : "none"} /></button>
                    <button
                      className="button primary"
                      disabled={inspectingRepo !== null}
                      onClick={() => inspect(model.id, model.recommended_files)}
                      title="MyDGX seleccionará la cuantización adecuada y todos sus archivos"
                    ><Download className={inspectingRepo === model.id ? "spin" : ""} size={15} /> {inspectingRepo === model.id ? "Preparando…" : "Descargar recomendada"}</button>
                  </div>
                </Card>
              );})}
            </div>
            {!busy && hasSearched && allResults.length === 0 && <Empty icon={<Globe />} title="Sin resultados" text="Prueba con otro nombre, autor, arquitectura o filtro." />}
          </> : <>
            {favorites.length > 0 && <SectionHeading eyebrow="PARA MÁS ADELANTE" title={`${favorites.length} modelo(s) favorito(s)`} />}
            <div className="catalog-grid general-results-grid favorite-model-grid">
              {favorites.map((model) => {
                const installed = downloadedRepos.has(model.id.toLowerCase());
                const recommendationStatus = model.recommendation_status || "No recomendado";
                const statusClass = recommendationStatus.toLowerCase().replace(" ", "-");
                const sparkScore = model.recommended_score ?? 0;
                return (
                <Card className={`catalog-card general-result-card favorite-model-card ${installed ? "installed" : ""}`} key={model.id}>
                  <div className="recommendation-head general-score-head">
                    <span className="recommendation-position">SPARK</span>
                    <div className="score-ring" style={{ "--score": `${sparkScore * 3.6}deg` } as CSSProperties}>
                      <strong>{sparkScore}</strong><small>/100</small>
                    </div>
                    <span className={`recommendation-status ${statusClass}`}>{recommendationStatus}</span>
                  </div>
                  <div className="catalog-top">
                    <div className="model-icon hf"><HuggingFaceIcon /></div>
                    <div className="recommendation-tags">
                      {installed && <span className="installed">instalado</span>}
                      {model.pipeline_tag && <span>{model.pipeline_tag}</span>}
                      {model.uncensored && <span className="uncensored">sin censura</span>}
                      {model.gated && <span className="restricted">gated</span>}
                    </div>
                  </div>
                  <div className="catalog-model-name"><strong title={model.id}>{model.id}</strong><ModelTermsButton text={`${model.id} ${model.pipeline_tag ?? ""} ${model.tags.join(" ")} ${model.tasks.join(" ")}`} label={model.id} onOpen={setGlossaryRequest} /></div>
                  <small>{model.downloads.toLocaleString()} descargas · {model.likes.toLocaleString()} likes</small>
                  {typeof model.community_score === "number" && <div className="hf-community-score"><Star size={12} fill="currentColor" /><strong>{model.community_score}/100</strong><span>Comunidad HF</span></div>}
                  <div className="modality-flow"><span>{model.input_modalities.join(" + ")}</span><ChevronRight size={11} /><span>{model.output_modalities.join(" + ")}</span></div>
                  <div className="general-spark-summary">
                    <span><small>Configuración</small><strong>{model.recommended_quantization || (model.formats ?? []).join(" / ") || "Runtime externo"}</strong></span>
                    <span><small>Memoria estimada</small><strong>{model.estimated_memory_mb ? `${Math.round(model.estimated_memory_mb / 1024)} GB` : "Por determinar"}</strong></span>
                  </div>
                  <div className="general-model-tags">{model.tags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}</div>
                  <div className="catalog-actions">
                    <button className="icon-button favorite-button selected" onClick={() => void toggleHfFavorite(model.id, false)} aria-label={`Quitar ${model.id} de favoritos`}><Star size={15} fill="currentColor" /></button>
                    <button
                      className="button primary"
                      disabled={inspectingRepo !== null}
                      onClick={() => inspect(model.id, model.recommended_files)}
                      title="MyDGX seleccionará la cuantización adecuada y todos sus archivos"
                    ><Download className={inspectingRepo === model.id ? "spin" : ""} size={15} /> {inspectingRepo === model.id ? "Preparando…" : "Descargar recomendada"}</button>
                  </div>
                </Card>
              );})}
            </div>
            {!favorites.length && <Empty icon={<Star />} title="Aún no hay favoritos" text="Marca la estrella de cualquier resultado para guardarlo y probarlo más adelante." />}
          </>}
        </>
      )}

      {inspection && (
        <div className="hf-inspector-overlay" role="dialog" aria-modal="true" aria-label={`Detalles de ${inspection.repo_id}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setInspection(null); }}>
        <Card className="hf-inspector">
          <SectionHeading eyebrow="HUGGING FACE" title={inspection.repo_id} action={<div className="dialog-heading-actions"><ModelTermsButton text={`${inspection.repo_id} ${(inspection.remote?.formats ?? []).join(" ")} ${(inspection.remote?.tasks ?? []).join(" ")} ${(inspection.remote?.recommended_engines ?? []).join(" ")}`} label={inspection.repo_id} onOpen={setGlossaryRequest} /><button className="icon-button" onClick={() => setInspection(null)} aria-label="Cerrar detalles"><X size={15} /></button></div>} />
          <div className="hf-inspection-summary">
            <span><small>Revisión</small><strong>{inspection.remote?.revision?.slice(0, 12) || Object.values(inspection.local?.refs || {})[0]?.slice(0, 12) || "—"}</strong></span>
            <span><small>Licencia</small><strong>{inspection.remote?.license || "No indicada"}</strong></span>
            <span><small>Acceso</small><strong>{inspection.remote?.gated ? "Gated" : inspection.remote?.private ? "Privado" : "Público"}</strong></span>
            <span><small>Estado local</small><strong>{inspection.local?.partials.length || inspection.local?.shards.some((item) => !item.complete) ? "Incompleto" : inspection.local ? "Completo" : "No descargado"}</strong></span>
          </div>
          {inspection.remote && <div className="hf-capability-strip">
            <span>{inspection.remote.input_modalities.join(" + ")} → {inspection.remote.output_modalities.join(" + ")}</span>
            <span>{inspection.remote.formats.join(" · ") || "formato no identificado"}</span>
            <span>{inspection.remote.recommended_engines.join(" · ") || "runtime por determinar"}</span>
          </div>}
          {inspection.remote_error && <div className="profile-warning"><ShieldCheck size={15} />No se pudo consultar la ficha remota: {inspection.remote_error}</div>}
          {inspection.local && <div className="hf-local-detail">
            <small>Cuantizaciones: {inspection.local.quantizations.join(", ") || "no detectadas"} · Snapshots: {inspection.local.snapshots.length} · Parciales: {inspection.local.partials.length}</small>
            {inspection.local.shards.map((shard) => <span className={`badge ${shard.complete ? "completed" : "failed"}`} key={`${shard.name}-${shard.expected}`}>{shard.name}: {shard.present.length}/{shard.expected}</span>)}
          </div>}
          {inspection.remote && !inspection.remote.gated && <div className="hf-download-guidance">
            <Download size={15} />
            <span><strong>Esta es la opción que MyDGX recomienda para tu Spark</strong><small>Ya está seleccionada completa. Si está dividida en varios archivos, se descargarán juntos. No necesitas elegir entre S, M o L salvo que quieras ajustar manualmente calidad y tamaño.</small></span>
          </div>}
          {inspection.remote?.gated && <div className="profile-warning">
            <ShieldCheck size={15} />Este repositorio requiere aceptar sus condiciones en Hugging Face y configurar acceso antes de descargar.
          </div>}
          <div className="hf-model-description">
            <div>
              <strong>Descripción del modelo</strong>
              <small>
                {inspection.description_source === "generated_public_metadata"
                  ? "Generada con datos públicos y conservada en la base de datos"
                  : "Ficha de Hugging Face conservada en la base de datos"}
                {inspection.description_revision ? ` · revisión ${inspection.description_revision.slice(0, 12)}` : ""}
              </small>
            </div>
            {inspection.description
              ? <MarkdownMessage
                  content={inspection.description}
                  assetBaseUrl={`https://huggingface.co/${inspection.repo_id}/resolve/${inspection.description_revision || "main"}/`}
                />
              : <p>Este repositorio no proporciona una descripción.</p>}
          </div>
          <div className="hf-file-groups">
            {visibleInspectionGroups.map((group) => {
              const pending = group.files.filter((file) => !file.downloaded);
              const selected = pending.length > 0 && pending.every((file) => selectedFiles.includes(file.name));
              const downloadedCount = group.files.length - pending.length;
              return <details className={`hf-file-group ${selected ? "selected" : ""} ${pending.length ? "" : "downloaded"}`} key={group.id}>
                <summary>
                  {group.kind !== "auxiliary"
                    ? <input
                        aria-label={`Seleccionar ${group.label}`}
                        checked={selected}
                        disabled={!pending.length}
                        name={group.kind === "weights" ? "hf-quantization" : undefined}
                        onChange={(event) => toggleHfFileGroup(group, event.target.checked)}
                        onClick={(event) => event.stopPropagation()}
                        type={group.kind === "weights" ? "radio" : "checkbox"}
                      />
                    : <Info size={15} />}
                  <span>
                    <strong>{group.label}{selected && group.kind === "weights" && <em className="hf-recommended-label">Recomendado para este Spark</em>}</strong>
                    {group.kind !== "auxiliary" && <small className="hf-quantization-hint">{quantizationHint(group.label)}</small>}
                    <small>
                      {group.sizeKnown ? bytes(group.size) : "Tamaño desconocido"} · {group.files.length} {group.files.length === 1 ? "archivo" : "archivos"}
                      {downloadedCount ? ` · ${downloadedCount} ya descargado${downloadedCount === 1 ? "" : "s"}` : ""}
                      {selected ? ` · seleccionado automáticamente${group.files.length > 1 ? " · se descargarán juntos" : ""}` : ""}
                    </small>
                  </span>
                  <ChevronRight className="hf-group-chevron" size={16} />
                </summary>
                <div className="hf-group-files">
                  {group.files.map((file) => <div className={file.downloaded ? "downloaded" : ""} key={file.name}>
                    <span><strong>{file.name}</strong><small>{bytes(file.size)}{file.lfs_sha256 ? ` · SHA256 ${file.lfs_sha256.slice(0, 12)}…` : ""}{file.downloaded ? " · Ya descargado" : ""}</small></span>
                    <ModelTermsButton text={`${file.name} ${file.quantization ?? ""}`} label={file.name} onOpen={setGlossaryRequest} />
                  </div>)}
                </div>
              </details>;
            })}
            {hiddenInspectionGroupCount > 0 && <button className="button secondary hf-show-alternatives" type="button" onClick={() => setShowAllFileGroups(true)}>
              Mostrar otras {hiddenInspectionGroupCount} cuantizaciones y archivos
            </button>}
            {showAllFileGroups && primaryInspectionGroups.length > 0 && <button className="button secondary hf-show-alternatives" type="button" onClick={() => setShowAllFileGroups(false)}>
              Ocultar alternativas
            </button>}
          </div>
          <div className="hf-inspector-actions">
            <small>
              {selectedFiles.length} archivo(s) seleccionado(s)
              {selectedFiles.length > 0 && (
                <> · {selectedSizeKnown
                  ? `${bytes(selectedDownloadSize)} de ${bytes(inspection.download_limit_bytes)} de memoria total`
                  : "tamaño desconocido"}</>
              )}
            </small>
            <button
              className="button primary"
              disabled={!selectedFiles.length || !selectedSizeKnown || selectedDownloadTooLarge || downloadBusy !== null}
              title={selectedDownloadTooLarge
                ? "La selección supera la memoria total del sistema"
                : !selectedSizeKnown && selectedFiles.length ? "No se puede comprobar que la selección cabe" : undefined}
              onClick={downloadSelected}
            ><Download className={downloadBusy === inspection.repo_id ? "spin" : ""} size={14} /> {downloadBusy === inspection.repo_id ? "Preparando…" : "Descargar archivos seleccionados"}</button>
          </div>
        </Card>
        </div>
      )}

      {glossaryRequest && <ModelGlossaryDialog request={glossaryRequest} onClose={() => setGlossaryRequest(null)} />}

      {displayedJobs.length > 0 && (
        <div>
          <SectionHeading eyebrow="TAREAS" title="Actividad reciente" />
          <Card className="jobs">
            {displayedJobs.slice(0, 8).map(({ job, duplicateCount }) => (
              <div className="job-row" key={job.id}>
                <div><strong>{job.target}</strong><small>{job.message}{duplicateCount > 1 ? ` · ${duplicateCount} solicitudes duplicadas agrupadas` : ""}</small></div>
                <div className="job-progress"><span style={{ width: `${job.progress}%` }} /></div>
                <span className={`badge ${job.status}`}>{job.status}</span>
                {["queued", "running"].includes(job.status) && ["ollama.pull", "ollama.update", "huggingface.files.download", "huggingface.integrity"].includes(job.kind) && <button className="icon-button danger" onClick={() => cancelJob(job.id)} aria-label="Cancelar trabajo"><X size={14} /></button>}
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

function ProfilesView({ jobs, notify }: { jobs: Job[]; notify: (message: string, error?: boolean) => void }) {
  type ProfileForm = Omit<Profile, "id" | "active" | "favorite" | "downloaded" | "models" | "memory_plan" | "runs">;
  const blank = (): ProfileForm => ({
    name: "",
    engine: "llama.cpp",
    model_ref: "",
    model_file: "",
    model_repo: "",
    model_filename: "",
    model_files: [],
    mmproj_file: "",
    mmproj_repo: "",
    mmproj_filename: "",
    model_alias: "",
    port: 18080,
    context_size: 8192,
    gpu_layers: -1,
    threads: 1,
    parallel: 1,
    batch_size: 512,
    ubatch_size: 256,
    temperature: 0.7,
    top_p: 0.95,
    top_k: 40,
    min_p: 0,
    repeat_penalty: 1.1,
    presence_penalty: 0,
    flash_attention: 1,
    cache_type_k: "",
    cache_type_v: "",
    reasoning_off: 0,
    reasoning_effort: "",
    kv_unified_per_slot: 0,
    jinja: 0,
    min_free_memory_mb: 0,
    source: "MyDGX",
    runtime_requirement: "",
    task: "chat",
    input_modalities: ["text"],
    output_modalities: ["text"],
    runtime_backend: "native",
    endpoint_url: "",
    api_protocol: "openai",
    estimated_memory_mb: 0,
    max_input_mb: 32,
    timeout_seconds: 600,
    enabled: true,
    additional_models: [],
    memory_reserve_mb: 4096,
    auto_fit_context: 1,
    minimum_context_size: 8192,
    app: "",
  });
  const [data, setData] = useState<ProfilesResponse | null>(null);
  const [appWebDraft, setAppWebDraft] = useState<{ app: string; alias: string; port: string } | null>(null);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formOpenRequest, setFormOpenRequest] = useState(0);
  const editorRef = useRef<HTMLDivElement>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [profileSearch, setProfileSearch] = useState("");
  const [recommendation, setRecommendation] = useState<{ recommended_file?: string; model_max_context?: number; context_source?: string; warning?: string } | null>(null);
  const [requestedStarts, setRequestedStarts] = useState<Record<string, string>>({});
  const enabledAliases = [
    form.model_alias || form.model_ref,
    ...form.additional_models
      .filter((model) => model.enabled)
      .map((model) => model.model_alias || model.model_ref),
  ].map((alias) => alias.trim().toLocaleLowerCase()).filter(Boolean);
  const duplicateAliases = [...new Set(
    enabledAliases.filter((alias, index) => enabledAliases.indexOf(alias) !== index),
  )];

  const load = useCallback(() => {
    api<ProfilesResponse>("/api/profiles").then(setData).catch((error) => notify(error.message, true));
  }, [notify]);
  useEffect(load, [load]);
  const profileJobSignature = jobs
    .filter((job) => job.kind === "profile.prepare-start")
    .map((job) => `${job.id}:${job.status}`)
    .join("|");
  useEffect(() => {
    load();
  }, [load, profileJobSignature]);
  const appTransitioning = Object.values(data?.apps.states ?? {}).some((item) => item.state === "starting" || item.state === "stopping");
  useEffect(() => {
    const timer = window.setInterval(load, appTransitioning ? 4000 : 10000);
    return () => window.clearInterval(timer);
  }, [appTransitioning, load]);

  const storedAppWeb = form.app ? data?.apps.web?.[form.app] : undefined;
  const storedAppWebAlias = storedAppWeb?.alias ?? form.app ?? "";
  const storedAppWebPort = storedAppWeb ? String(storedAppWeb.port) : "";
  const appWeb = appWebDraft && appWebDraft.app === form.app
    ? appWebDraft
    : { app: form.app ?? "", alias: storedAppWebAlias, port: storedAppWebPort };

  function setAppWebField(key: "alias" | "port", value: string) {
    setAppWebDraft({ ...appWeb, [key]: value });
  }

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setPrimaryTask(task: ModelTask) {
    const definition = taskOptions.find((item) => item.id === task)!;
    setForm((current) => ({
      ...current,
      task,
      input_modalities: definition.input,
      output_modalities: definition.output,
    }));
  }

  function setPrimaryEngine(engine: ModelConfig["engine"]) {
    setForm((current) => ({
      ...current,
      engine,
      runtime_backend: engine === "llama.cpp" || engine === "ollama" ? "native" : "external",
      api_protocol: "openai",
    }));
  }

  function addModel() {
    setForm((current) => {
      const {
        name: _name,
        additional_models: _additional,
        memory_reserve_mb: _reserve,
        auto_fit_context: _autoFit,
        minimum_context_size: _minimum,
        app: _app,
        ...base
      } = current;
      void _name;
      void _additional;
      void _reserve;
      void _autoFit;
      void _minimum;
      void _app;
      const nextPort = Math.max(current.port, ...current.additional_models.map((item) => item.port)) + 1;
      const model: ProfileModel = {
        ...base,
        id: `model-${Date.now()}`,
        name: `Modelo ${current.additional_models.length + 2}`,
        model_ref: "",
        model_file: "",
        model_repo: "",
        model_filename: "",
        model_files: [],
        model_alias: "",
        port: Math.min(65535, nextPort),
        downloaded: false,
        enabled: true,
      };
      return { ...current, additional_models: [...current.additional_models, model] };
    });
  }

  function setAdditionalField<K extends keyof ProfileModel>(index: number, key: K, value: ProfileModel[K]) {
    setForm((current) => ({
      ...current,
      additional_models: current.additional_models.map((model, itemIndex) => (
        itemIndex === index ? { ...model, [key]: value } : model
      )),
    }));
  }

  function setAdditionalTask(index: number, task: ModelTask) {
    const definition = taskOptions.find((item) => item.id === task)!;
    setForm((current) => ({
      ...current,
      additional_models: current.additional_models.map((model, itemIndex) => (
        itemIndex === index
          ? { ...model, task, input_modalities: definition.input, output_modalities: definition.output }
          : model
      )),
    }));
  }

  function setAdditionalEngine(index: number, engine: ModelConfig["engine"]) {
    setForm((current) => ({
      ...current,
      additional_models: current.additional_models.map((model, itemIndex) => (
        itemIndex === index
          ? {
            ...model,
            engine,
            runtime_backend: engine === "llama.cpp" || engine === "ollama" ? "native" : "external",
            api_protocol: "openai",
          }
          : model
      )),
    }));
  }

  function removeAdditional(index: number) {
    setForm((current) => ({
      ...current,
      additional_models: current.additional_models.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  useEffect(() => {
    if (formOpenRequest) editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [formOpenRequest]);

  function newProfile() {
    setForm(blank());
    setEditing(null);
    setRecommendation(null);
    setShowForm(true);
    setFormOpenRequest((value) => value + 1);
  }

  function editProfile(profile: Profile) {
    const {
      id: _id,
      active: _active,
      favorite: _favorite,
      downloaded: _downloaded,
      models: _models,
      memory_plan: _memoryPlan,
      runtime_plan: _runtimePlan,
      runs: _runs,
      ...values
    } = profile;
    void _runtimePlan;
    void _id;
    void _active;
    void _favorite;
    void _downloaded;
    void _models;
    void _memoryPlan;
    void _runs;
    setForm({
      ...values,
      threads: Math.max(1, Number(values.threads) || 1),
      additional_models: values.additional_models.map((model) => ({
        ...model,
        threads: Math.max(1, Number(model.threads) || 1),
      })),
    });
    setEditing(profile.id);
    setRecommendation(null);
    setShowForm(true);
    setFormOpenRequest((value) => value + 1);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (duplicateAliases.length) {
      notify(`Alias OpenAI duplicados: ${duplicateAliases.join(", ")}`, true);
      return;
    }
    try {
      let appRestartNotice = "";
      if (form.app && (appWeb.alias !== storedAppWebAlias || appWeb.port !== storedAppWebPort)) {
        const result = await api<{ restart_required: boolean }>(`/api/profile-apps/${encodeURIComponent(form.app)}/web`, {
          method: "PUT",
          body: JSON.stringify({ alias: appWeb.alias.trim(), port: appWeb.port.trim() ? Number(appWeb.port) : null }),
        });
        if (result.restart_required) appRestartNotice = ` · reinicia ${form.app} para que use el puerto nuevo`;
      }
      setAppWebDraft(null);
      await api(editing ? `/api/profiles/${editing}` : "/api/profiles", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({
          ...form,
          flash_attention: Boolean(form.flash_attention),
          reasoning_off: Boolean(form.reasoning_off),
          kv_unified_per_slot: Boolean(form.kv_unified_per_slot),
          jinja: Boolean(form.jinja),
        }),
      });
      notify(`${editing ? "Perfil actualizado" : "Perfil creado"}${appRestartNotice}`);
      setShowForm(false);
      setEditing(null);
      load();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function recommend() {
    const repository = form.model_repo || form.model_ref;
    if (!repository.includes("/")) {
      notify("Introduce un repositorio Hugging Face como organización/modelo", true);
      return;
    }
    setAnalyzing(true);
    try {
      const result = await api<{
        recommended_file?: string;
        recommended_files: string[];
        recommended_mmproj_file?: string | null;
        recommended_context: number;
        model_max_context?: number;
        context_source: string;
        task: ModelTask;
        input_modalities: InputModality[];
        output_modalities: OutputModality[];
        recommended_engine: ModelConfig["engine"];
        recommended_engines: string[];
        estimated_memory_mb: number;
        runtime_requirement: string;
        fits: boolean;
        parameters: Pick<Profile, "gpu_layers" | "batch_size" | "temperature" | "top_p" | "repeat_penalty"> & { flash_attention: boolean };
        warning: string;
      }>(`/api/profiles/recommend/${encodeURIComponent(repository)}?task=${form.task === "embeddings" ? "embedding" : form.task}`);
      setForm((current) => ({
        ...current,
        engine: result.recommended_engine,
        runtime_backend: result.recommended_engine === "llama.cpp" || result.recommended_engine === "ollama" ? "native" : "external",
        task: result.task,
        input_modalities: result.input_modalities,
        output_modalities: result.output_modalities,
        model_filename: result.recommended_file || current.model_filename,
        model_files: result.recommended_files.filter((file) => file !== result.recommended_mmproj_file),
        mmproj_repo: result.recommended_mmproj_file ? repository : "",
        mmproj_filename: result.recommended_mmproj_file || "",
        context_size: result.recommended_context || current.context_size,
        estimated_memory_mb: result.estimated_memory_mb,
        runtime_requirement: result.runtime_requirement,
        gpu_layers: result.parameters.gpu_layers,
        batch_size: result.parameters.batch_size,
        temperature: result.parameters.temperature,
        top_p: result.parameters.top_p,
        repeat_penalty: result.parameters.repeat_penalty,
        flash_attention: Number(result.parameters.flash_attention),
      }));
      setRecommendation(result);
      notify("Recomendaciones aplicadas; revísalas antes de guardar");
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setAnalyzing(false);
    }
  }

  async function action(path: string, success: string) {
    try {
      await api(path, { method: "POST" });
      notify(success);
      load();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function appAction(name: string, appActionName: "status" | "restart") {
    try {
      const result = await api<ProfileAppState & { exit_code: number }>(`/api/profile-apps/${encodeURIComponent(name)}/${appActionName}`, { method: "POST" });
      notify(`${name}: ${profileAppStateLabels[result.state]}`, result.state === "error");
      load();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function selectAndStart(profile: Profile) {
    const missing = profile.models.filter((model) => model.enabled && !model.downloaded).length;
    try {
      const plan = await api<{
        fits: boolean;
        required_mb: number;
        incremental_mb: number;
        available_mb: number;
        capacity_mb: number;
        shared_models: number;
        alias_conflicts: string[];
        port_conflicts: number[];
        profile_ids: string[];
        port_assignments: Array<{ model: string; from: number; to: number }>;
      }>(`/api/profiles/${profile.id}/runtime-plan`);
      if (!plan.fits) {
        const conflict = plan.alias_conflicts.length
          ? `Alias incompatibles: ${plan.alias_conflicts.join(", ")}`
          : plan.port_conflicts.length
            ? `Puertos incompatibles: ${plan.port_conflicts.join(", ")}`
            : plan.profile_ids.filter((id) => !MANAGED_PROFILE_IDS.has(id)).length > 2
              ? "Ya hay dos perfiles cargados"
              : `Se necesitan ${(plan.incremental_mb / 1024).toFixed(1)} GB adicionales y hay ${(plan.available_mb / 1024).toFixed(1)} GB libres`;
        notify(`No se puede arrancar: ${conflict}`, true);
        return;
      }
      const result = await api<{ job_id: string }>(`/api/profiles/${profile.id}/start`, {
        method: "POST",
      });
      setRequestedStarts((current) => ({ ...current, [profile.id]: result.job_id }));
      notify(
        missing
          ? `Preparando ${profile.name}: se descargarán ${missing} modelo(s) y después arrancará`
          : plan.port_assignments.length
            ? `Preparando ${profile.name}: ${plan.port_assignments.map((item) => `${item.model} :${item.from}→:${item.to}`).join(" · ")}`
            : `Preparando ${profile.name}: ${plan.shared_models} modelo(s) compartido(s), ${(plan.incremental_mb / 1024).toFixed(1)} GB nuevos`,
      );
      load();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function downloadMissingModel(profile: Profile, model: ProfileModel) {
    if (model.engine === "ollama") {
      try {
        await api("/api/models/ollama/pull", {
          method: "POST",
          body: JSON.stringify({ name: model.model_ref }),
        });
        notify(`Descarga de ${model.name} añadida a la cola`);
        load();
      } catch (error) {
        notify((error as Error).message, true);
      }
      return;
    }
    await action(
      `/api/profiles/${profile.id}/models/${model.id}/download`,
      `Descarga de ${model.name} añadida a la cola`,
    );
  }

  async function remove(profile: Profile) {
    if (!window.confirm(`¿Eliminar el perfil ${profile.name}?`)) return;
    try {
      await api(`/api/profiles/${profile.id}?confirm=${encodeURIComponent(profile.name)}`, { method: "DELETE" });
      notify("Perfil eliminado");
      load();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function toggleFavorite(profile: Profile) {
    const favorite = !profile.favorite;
    setData((current) => current ? {
      ...current,
      profiles: current.profiles.map((item) => (
        item.id === profile.id ? { ...item, favorite: Number(favorite) } : item
      )),
    } : current);
    try {
      await api(`/api/profiles/${profile.id}/favorite`, {
        method: "PATCH",
        body: JSON.stringify({ favorite }),
      });
    } catch (error) {
      notify((error as Error).message, true);
      load();
    }
  }

  const normalizedSearch = profileSearch.trim().toLocaleLowerCase();
  const visibleProfiles = (data?.profiles ?? []).filter((profile) => {
    if (!normalizedSearch) return true;
    return [
      profile.name,
      profile.engine,
      profile.task,
      profile.model_ref,
      profile.model_repo,
      ...profile.models.flatMap((model) => [
        model.name,
        model.engine,
        model.task,
        model.model_ref,
        model.model_repo,
      ]),
    ].some((value) => String(value || "").toLocaleLowerCase().includes(normalizedSearch));
  });
  const profileIsRunning = (profile: Profile) => Boolean(
    data?.runtime.profile_ids?.includes(profile.id)
    || (data?.runtime.running && data?.runtime.profile_id === profile.id)
  );
  const byFavorite = (left: Profile, right: Profile) => Number(Boolean(right.favorite)) - Number(Boolean(left.favorite));
  const activeProfiles = visibleProfiles.filter(profileIsRunning).sort(byFavorite);
  const availableProfiles = visibleProfiles.filter((profile) => !profileIsRunning(profile)).sort(byFavorite);

  function renderProfileCard(profile: Profile) {
    if (!data) return null;
    const running = data.runtime.profile_ids?.includes(profile.id)
      || (data.runtime.running && data.runtime.profile_id === profile.id);
    const runningProfileCount = (data.runtime.profile_ids ?? []).filter((id) => !MANAGED_PROFILE_IDS.has(id)).length;
    const limitReached = !profile.read_only && runningProfileCount >= 2;
    const runtimePlan = profile.runtime_plan;
    const noFitReason = running
      ? ""
      : limitReached
        ? "Ya hay dos perfiles encendidos; detén uno para arrancar este"
        : !profile.memory_plan.fits
          ? "El conjunto supera la memoria segura del equipo o repite puertos"
          : runtimePlan && !runtimePlan.fits
            ? runtimePlan.alias_conflicts.length
              ? `Alias en uso por otro perfil encendido: ${runtimePlan.alias_conflicts.join(", ")}`
              : runtimePlan.port_conflicts.length
                ? `Puertos en uso por otro perfil encendido: ${runtimePlan.port_conflicts.join(", ")}`
                : `Necesita ${(runtimePlan.incremental_mb / 1024).toFixed(1)} GB más y hay ${(Math.max(0, runtimePlan.available_mb - runtimePlan.reserve_mb) / 1024).toFixed(1)} GB libres`
            : "";
    const startJob = jobs.find((job) => (
      job.kind === "profile.prepare-start"
      && job.target === profile.id
      && ["queued", "running", "cancelling"].includes(job.status)
    ));
    const requestedJob = jobs.find((job) => job.id === requestedStarts[profile.id]);
    const preparing = Boolean(
      startJob
      || (
        requestedStarts[profile.id]
        && (!requestedJob || ["queued", "running", "cancelling"].includes(requestedJob.status))
      )
    );
    const anyPreparing = jobs.some((job) => (
      job.kind === "profile.prepare-start"
      && ["queued", "running", "cancelling"].includes(job.status)
    )) || Object.values(requestedStarts).some((jobId) => {
      const job = jobs.find((item) => item.id === jobId);
      return !job || ["queued", "running", "cancelling"].includes(job.status);
    });
    const missingModels = profile.models.filter((model) => model.enabled && !model.downloaded).length;
    return (
      <Card className={`profile-card ${profile.active ? "active" : ""} ${running ? "running" : ""}`} key={profile.id}>
        <div className="profile-card-head">
          <div className="model-icon"><SlidersHorizontal /></div>
          <div><strong>{profile.name}</strong><small>{profile.engine} · {profile.task} · {profile.model_repo || profile.model_ref}</small></div>
          <div className="profile-badges">
            {profile.source.startsWith("ARTIFEX") ? <span className="badge">ARTIFEX</span> : null}
            {profile.read_only ? <span className="badge" title={profile.id === QUICK_PROFILE_ID ? "Modelos encendidos desde Modelos; no se restaura al reiniciar" : "Modelos marcados como Default en Modelos; arranca siempre con MyDGX"}>Solo lectura</span> : null}
            {profile.active ? <span className="badge live">Predeterminado</span> : null}
            {running ? <span className="badge running">Cargado</span> : null}
          </div>
          <button
            className={`profile-favorite ${profile.favorite ? "selected" : ""}`}
            onClick={() => void toggleFavorite(profile)}
            title={profile.favorite ? "Quitar de favoritos" : "Marcar como favorito"}
            aria-label={profile.favorite ? `Quitar ${profile.name} de favoritos` : `Marcar ${profile.name} como favorito`}
          >
            <Star size={17} fill={profile.favorite ? "currentColor" : "none"} />
          </button>
        </div>
        <div className="profile-specs">
          <span><small>Modelos</small><strong>{profile.models.length}</strong></span>
          <span><small>Puertos</small><strong>{profile.models.map((item) => item.port).join(", ")}</strong></span>
          <span><small>Memoria estimada</small><strong>{(profile.memory_plan.required_mb / 1024).toFixed(1)} GB</strong></span>
          <span><small>Capacidad segura</small><strong>{(profile.memory_plan.capacity_mb / 1024).toFixed(1)} GB</strong></span>
        </div>
        <div className={`profile-capacity ${profile.memory_plan.fits ? "fits" : "over"}`}>
          <span style={{ width: `${Math.min(100, profile.memory_plan.required_mb / Math.max(1, profile.memory_plan.capacity_mb) * 100)}%` }} />
          <small>{profile.memory_plan.fits ? "El conjunto cabe en la memoria segura" : "El conjunto supera la memoria segura o repite puertos"}</small>
        </div>
        <div className="profile-model-roster">
          {profile.models.map((model) => {
            const runtimeModel = data.runtime.models?.find((item) => (
              item.model_id === model.id
              && (item.profile_id === profile.id || (!item.profile_id && data.runtime.profile_id === profile.id))
            ));
            const modelRunning = Boolean(runtimeModel?.running);
            const effectiveContext = runtimeModel?.effective_context || model.context_size;
            return <div key={model.id}>
              <span className={`status-dot ${modelRunning ? "ok" : model.downloaded ? "online" : "warn"}`} />
              <strong>{model.name}</strong>
              <small>{model.engine} · {model.task} · :{model.port}{["chat", "vision", "embeddings"].includes(model.task) ? ` · ${(effectiveContext / 1024).toLocaleString()}K ctx${effectiveContext !== model.context_size ? " (ajustado)" : ""}` : ""}</small>
              {!model.downloaded && ((model.engine === "llama.cpp" && model.model_repo) || model.engine === "ollama") && <button className="profile-model-download" onClick={() => void downloadMissingModel(profile, model)}><Download size={13} /> Descargar modelo</button>}
            </div>;
          })}
          {profile.app ? (() => {
            const appState = data.apps.states[profile.app];
            const available = data.apps.available.includes(profile.app);
            const dot = !available || appState?.state === "error" ? "warn" : appState?.state === "running" ? "ok" : "online";
            const label = !available
              ? `No encontrada en ${data.apps.root}`
              : appState ? profileAppStateLabels[appState.state] : "Se arranca al cargar el perfil";
            return <div className="profile-app-row">
              <span className={`status-dot ${dot}`} />
              <strong><Rocket size={13} /> {data.apps.web?.[profile.app]?.alias ?? profile.app}</strong>
              <small title={appState?.message}>App{data.apps.web?.[profile.app] ? ` web :${data.apps.web[profile.app].port}` : ""} · {label}{appState?.message ? ` · ${appState.message}` : ""}</small>
              {available && <span className="profile-app-actions">
                {appState?.state === "running" && data.apps.web?.[profile.app] && <a className="profile-app-open" href={`http://${window.location.hostname || "127.0.0.1"}:${data.apps.web[profile.app].port}/`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Abrir</a>}
                <button onClick={() => void appAction(profile.app, "status")}><Activity size={13} /> Estado</button>
                {running && <button onClick={() => void appAction(profile.app, "restart")}><RefreshCw size={13} /> Reiniciar</button>}
              </span>}
            </div>;
          })() : null}
        </div>
        <div className="profile-actions">
          {!profile.active && !profile.read_only && <button title="Seleccionarlo sin arrancarlo" onClick={() => action(`/api/profiles/${profile.id}/activate`, `${profile.name} será el perfil predeterminado al arrancar`)}><ShieldCheck size={14} /> Solo predeterminado</button>}
          <button
            className={noFitReason && !preparing ? "no-fit" : undefined}
            title={preparing ? undefined : noFitReason || undefined}
            disabled={preparing || (!running && (anyPreparing || Boolean(noFitReason)))}
            onClick={() => {
              if (!running) {
                void selectAndStart(profile);
              } else if (window.confirm(`¿Detener ${profile.name}? Sus modelos dejarán de responder en el chat y el gateway.`)) {
                void action(`/api/profiles/${profile.id}/stop`, "Perfil detenido");
              }
            }}
          >
            {running ? <Square size={13} /> : <Play size={14} />}
            {running
              ? "Detener"
              : preparing
                ? `Preparando ${Math.round(startJob?.progress ?? 0)}%`
                : anyPreparing
                  ? "Otro perfil en preparación"
                : noFitReason
                  ? "No cabe ahora"
                : missingModels
                  ? `Descargar ${missingModels} y arrancar`
                  : profile.read_only ? "Arrancar" : "Seleccionar y arrancar"}
          </button>
          {startJob && ["queued", "running"].includes(startJob.status) && <button
            className="danger"
            onClick={() => {
              if (window.confirm(`¿Cancelar la preparación de ${profile.name}? Lo ya descargado se queda en la caché.`)) {
                void action(`/api/jobs/${startJob.id}/cancel`, "Cancelación solicitada");
              }
            }}
          ><X size={14} /> Cancelar</button>}
          {profile.read_only
            ? <small className="profile-readonly-hint">Se gestiona desde Modelos</small>
            : <>
              <button onClick={() => editProfile(profile)}><Pencil size={14} /> Editar</button>
              <button className="danger" onClick={() => remove(profile)}><Trash2 size={14} /></button>
            </>}
        </div>
      </Card>
    );
  }

  return (
    <div className="view-stack">
      <SectionHeading
        eyebrow="CONFIGURACIONES DE INFERENCIA"
        title="Perfiles"
        action={<button className="button primary" onClick={newProfile}><Rocket size={15} /> Nuevo perfil</button>}
      />
      <div className="profile-summary">
        <Card><small>Perfil predeterminado</small><strong>{data?.profiles.find((profile) => profile.active)?.name ?? "Sin seleccionar"}</strong></Card>
        <Card><small>Runtime</small><strong>{data?.runtime.running ? `${(data.runtime.profile_ids ?? []).filter((id) => !MANAGED_PROFILE_IDS.has(id)).length}/2 perfiles${(data.runtime.profile_ids ?? []).some((id) => MANAGED_PROFILE_IDS.has(id)) ? " + Default/Quick" : ""} · ${data.runtime.running_models} modelo(s)` : "Detenido"}</strong></Card>
        <Card><small>llama.cpp</small><strong>{data?.llama_cpp_available ? "Detectado" : "No detectado"}</strong></Card>
      </div>
      {data?.runtime.boot_restore?.state === "restoring" && <div className="profile-warning"><RefreshCw className="spin" size={14} />Restaurando los perfiles del último arranque{data.runtime.boot_restore.pending.length ? `: ${data.runtime.boot_restore.pending.join(", ")}` : ""}…</div>}
      {data?.runtime.boot_restore?.state === "done" && data.runtime.boot_restore.errors.length > 0 && <div className="profile-warning"><TriangleAlert size={14} />No se pudieron restaurar tras el arranque: {data.runtime.boot_restore.errors.join(" · ")}</div>}
      <div className={`profile-search${searchStateClass(profileSearch, data ? visibleProfiles.length : null)}`} data-count={searchCountLabel(profileSearch, data ? visibleProfiles.length : null)}>
        <Search size={14} />
        <input
          type="search"
          value={profileSearch}
          onChange={(event) => setProfileSearch(event.target.value)}
          placeholder="Buscar perfiles, modelos, tareas…"
          aria-label="Buscar perfiles"
        />
        {profileSearch && <button onClick={() => setProfileSearch("")} title="Limpiar búsqueda" aria-label="Limpiar búsqueda"><X size={13} /></button>}
      </div>

      {showForm && (
        <div ref={editorRef} className="profile-editor-anchor">
        <Card className="profile-editor">
          <SectionHeading eyebrow={editing ? "EDITANDO" : "NUEVO"} title={editing ? form.name : "Crear perfil"} action={<button className="icon-button" onClick={() => setShowForm(false)}><X size={16} /></button>} />
          <form onSubmit={save}>
            <label>Nombre<input value={form.name} onChange={(event) => setField("name", event.target.value)} required /></label>
            <label>Motor<select value={form.engine} onChange={(event) => setPrimaryEngine(event.target.value as Profile["engine"])}>{engineOptions.map((engine) => <option value={engine} key={engine}>{engine}</option>)}</select></label>
            <label>Tarea<select value={form.task} onChange={(event) => setPrimaryTask(event.target.value as ModelTask)}>{taskOptions.map((task) => <option value={task.id} key={task.id}>{task.label}</option>)}</select></label>
            <label>Runtime<select value={form.runtime_backend} onChange={(event) => setField("runtime_backend", event.target.value as Profile["runtime_backend"])}><option value="native">Nativo</option><option value="external">Endpoint externo local</option><option value="compose" disabled>Compose (próxima fase)</option></select></label>
            <label className="wide">{form.engine === "llama.cpp" ? "Identificador del modelo / API" : "Modelo Ollama"}<input value={form.model_ref} onChange={(event) => setField("model_ref", event.target.value)} placeholder={form.engine === "llama.cpp" ? "mi-modelo" : "qwen3:8b"} required /></label>
            {!["llama.cpp", "ollama"].includes(form.engine) && <>
              <label className="wide">Endpoint local<input type="url" value={form.endpoint_url} onChange={(event) => setField("endpoint_url", event.target.value)} placeholder={form.api_protocol === "tts-lab" ? "http://127.0.0.1:8010/api/projects/mi-voz" : "http://127.0.0.1:8000"} required /></label>
              <label>Protocolo<select value={form.api_protocol} onChange={(event) => setField("api_protocol", event.target.value as Profile["api_protocol"])}><option value="openai">OpenAI compatible</option><option value="tts-lab">TTS Lab</option><option value="voice-agent">Voice Agent (API privada)</option><option value="ragkit">RAGKit</option><option value="security-app">Aplicación de seguridad</option><option value="comfyui">ComfyUI (adaptador requerido)</option></select></label>
              <label>Timeout (s)<input type="number" min={10} max={86400} value={form.timeout_seconds} onChange={(event) => setField("timeout_seconds", Number(event.target.value))} /></label>
            </>}
            {form.engine === "llama.cpp" && (
              <>
                <label className="wide">Repositorio Hugging Face<input value={form.model_repo} onChange={(event) => setField("model_repo", event.target.value)} placeholder="organización/modelo-GGUF" /></label>
                <label>Alias OpenAI servido<input value={form.model_alias} onChange={(event) => setField("model_alias", event.target.value)} placeholder={form.model_ref || "mi-modelo"} /></label>
                <label>Archivo GGUF remoto<input value={form.model_filename} onChange={(event) => setField("model_filename", event.target.value)} placeholder="modelo.Q4_K_M.gguf" /></label>
                <label className="wide">Archivo GGUF local<input value={form.model_file} onChange={(event) => setField("model_file", event.target.value)} placeholder="Se completa al descargar, o indica una ruta absoluta" /></label>
                <label className="wide">Shards GGUF remotos <small>(uno por línea)</small><textarea value={form.model_files.join("\n")} onChange={(event) => setField("model_files", event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))} placeholder={"UD-IQ4_XS/model-00001-of-00003.gguf\nUD-IQ4_XS/model-00002-of-00003.gguf"} /></label>
                {form.task === "vision" && <>
                  <label>Repositorio mmproj<input value={form.mmproj_repo} onChange={(event) => setField("mmproj_repo", event.target.value)} placeholder={form.model_repo || "organización/modelo-GGUF"} /></label>
                  <label>Archivo mmproj remoto<input value={form.mmproj_filename} onChange={(event) => setField("mmproj_filename", event.target.value)} placeholder="mmproj-model-f16.gguf" /></label>
                  <label className="wide">Archivo mmproj local<input value={form.mmproj_file} onChange={(event) => setField("mmproj_file", event.target.value)} /></label>
                </>}
                <div className="wide recommendation-action">
                  <button type="button" className="button secondary" onClick={recommend} disabled={analyzing}><Sparkles size={15} /> {analyzing ? "Analizando ficha…" : "Recomendar desde Hugging Face"}</button>
                  {recommendation && <small>Contexto obtenido de {recommendation.context_source}. GGUF sugerido: {recommendation.recommended_file ?? "no indicado"}.</small>}
                </div>
              </>
            )}
            <label>Puerto preferido <small>(se reasigna si está ocupado)</small><input type="number" value={form.port} min={1024} max={65535} onChange={(event) => setField("port", Number(event.target.value))} /></label>
            <label>Contexto<input type="number" value={form.context_size} min={512} onChange={(event) => setField("context_size", Number(event.target.value))} /></label>
            <label>Capas GPU<input type="number" value={form.gpu_layers} min={-1} onChange={(event) => setField("gpu_layers", Number(event.target.value))} /></label>
            <label>Hilos CPU<input type="number" value={form.threads} min={1} onChange={(event) => setField("threads", Number(event.target.value))} /></label>
            <label>Límite de entrada (MiB)<input type="number" min={1} max={1024} value={form.max_input_mb} onChange={(event) => setField("max_input_mb", Number(event.target.value))} /></label>
            <label>Modalidades<input value={`${form.input_modalities.join(" + ")} → ${form.output_modalities.join(" + ")}`} readOnly /></label>
            {form.engine === "llama.cpp" && <details className="wide profile-advanced">
              <summary>Parámetros avanzados de llama.cpp</summary>
              <div className="advanced-grid">
                <label>Slots paralelos<input type="number" value={form.parallel} min={1} max={32} onChange={(event) => setField("parallel", Number(event.target.value))} /></label>
                <label>Batch<input type="number" value={form.batch_size} min={1} onChange={(event) => setField("batch_size", Number(event.target.value))} /></label>
                <label>Micro-batch<input type="number" value={form.ubatch_size} min={1} onChange={(event) => setField("ubatch_size", Number(event.target.value))} /></label>
                <label>Temperatura<input type="number" step="0.05" value={form.temperature} min={0} max={2} onChange={(event) => setField("temperature", Number(event.target.value))} /></label>
                <label>Top P<input type="number" step="0.01" value={form.top_p} min={0.01} max={1} onChange={(event) => setField("top_p", Number(event.target.value))} /></label>
                <label>Top K<input type="number" value={form.top_k} min={0} onChange={(event) => setField("top_k", Number(event.target.value))} /></label>
                <label>Min P<input type="number" step="0.01" value={form.min_p} min={0} max={1} onChange={(event) => setField("min_p", Number(event.target.value))} /></label>
                <label>Repeat penalty<input type="number" step="0.05" value={form.repeat_penalty} min={0} max={2} onChange={(event) => setField("repeat_penalty", Number(event.target.value))} /></label>
                <label>Presence penalty<input type="number" step="0.1" value={form.presence_penalty} min={0} max={2} onChange={(event) => setField("presence_penalty", Number(event.target.value))} /></label>
                <label>KV cache K<select value={form.cache_type_k} onChange={(event) => setField("cache_type_k", event.target.value as Profile["cache_type_k"])}><option value="">Predeterminado (F16)</option><option value="f16">F16</option><option value="q8_0">Q8_0</option><option value="q4_0">Q4_0</option></select></label>
                <label>KV cache V<select value={form.cache_type_v} onChange={(event) => setField("cache_type_v", event.target.value as Profile["cache_type_v"])}><option value="">Predeterminado (F16)</option><option value="f16">F16</option><option value="q8_0">Q8_0</option><option value="q4_0">Q4_0</option></select></label>
                <label>Memoria libre mínima (MiB)<input type="number" value={form.min_free_memory_mb} min={0} onChange={(event) => setField("min_free_memory_mb", Number(event.target.value))} /></label>
                <label>Reasoning effort<select value={form.reasoning_effort} onChange={(event) => setField("reasoning_effort", event.target.value as Profile["reasoning_effort"])}><option value="">Sin especificar</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
                <label>Runtime requerido<input value={form.runtime_requirement} onChange={(event) => setField("runtime_requirement", event.target.value)} placeholder="llama.cpp b10679 · CUDA 13 · sm_121" /></label>
                <div className="advanced-checks">
                  <label className="checkbox"><input type="checkbox" checked={Boolean(form.flash_attention)} onChange={(event) => setField("flash_attention", Number(event.target.checked))} /><span>Flash Attention</span></label>
                  <label className="checkbox"><input type="checkbox" checked={Boolean(form.jinja)} onChange={(event) => setField("jinja", Number(event.target.checked))} /><span>Plantillas Jinja</span></label>
                  <label className="checkbox"><input type="checkbox" checked={Boolean(form.reasoning_off)} onChange={(event) => setField("reasoning_off", Number(event.target.checked))} /><span>Reasoning desactivado</span></label>
                  <label className="checkbox"><input type="checkbox" checked={Boolean(form.kv_unified_per_slot)} onChange={(event) => setField("kv_unified_per_slot", Number(event.target.checked))} /><span>KV unificado por slot</span></label>
                </div>
              </div>
            </details>}
            <div className="wide capacity-editor">
              <div>
                <strong>Seguridad de memoria del perfil</strong>
                <small>MyDGX suma modelos y contextos antes de detener el perfil actual.</small>
              </div>
              <label>Reserva del sistema (MiB)<input type="number" min={1024} value={form.memory_reserve_mb} onChange={(event) => setField("memory_reserve_mb", Number(event.target.value))} /></label>
              <label>Contexto mínimo de recuperación<input type="number" min={512} value={form.minimum_context_size} onChange={(event) => setField("minimum_context_size", Number(event.target.value))} /></label>
              <label className="checkbox"><input type="checkbox" checked={Boolean(form.auto_fit_context)} onChange={(event) => setField("auto_fit_context", Number(event.target.checked))} /><span>Reducir contexto automáticamente tras OOM</span></label>
            </div>
            <div className="wide capacity-editor">
              <div>
                <strong>App del perfil</strong>
                <small>Se arranca con su <code>start.sh start</code> cuando la inferencia está lista y se detiene con <code>start.sh stop</code> al parar el perfil. Apps disponibles en {data?.apps.root ?? "el home"}.</small>
              </div>
              <label>App al cargar el perfil
                <select value={form.app ?? ""} onChange={(event) => setField("app", event.target.value)}>
                  <option value="">Ninguna</option>
                  {data?.apps.available.map((name) => <option value={name} key={name}>{name}</option>)}
                  {form.app && !data?.apps.available.includes(form.app) ? <option value={form.app}>{form.app} (no encontrada)</option> : null}
                </select>
              </label>
              {form.app ? <>
                <label>Alias de la app web
                  <input maxLength={40} value={appWeb.alias} placeholder={form.app} onChange={(event) => setAppWebField("alias", event.target.value)} />
                </label>
                <label>Puerto web en 127.0.0.1
                  <input type="number" min={1024} max={65535} value={appWeb.port} placeholder="Sin acceso web" onChange={(event) => setAppWebField("port", event.target.value)} />
                </label>
                <small className="wide">Con puerto, <code>start.sh</code> recibe <code>MYDGX_APP_PORT</code>, <code>MYDGX_APP_HOST=127.0.0.1</code> y <code>MYDGX_APP_URL</code>, y la app aparece en Resumen y en la barra de menús mientras está en marcha. El alias y el puerto son de la app y se comparten entre los perfiles que la usan.</small>
              </> : null}
            </div>
            <div className="wide additional-models-editor">
              <div className="additional-models-heading">
                <div><strong>Modelos del perfil</strong><small>El modelo principal y {form.additional_models.length} modelo(s) adicional(es) arrancarán en orden.</small></div>
                <button type="button" className="button secondary" onClick={addModel}><Boxes size={15} /> Añadir modelo</button>
              </div>
              {form.additional_models.map((model, index) => (
                <div className="additional-model-editor" key={model.id}>
                  <div className="additional-model-title">
                    <strong>{model.name || `Modelo ${index + 2}`}</strong>
                    <label className="checkbox"><input type="checkbox" checked={model.enabled} onChange={(event) => setAdditionalField(index, "enabled", event.target.checked)} /><span>Habilitado</span></label>
                    <button type="button" className="icon-button danger" onClick={() => removeAdditional(index)}><Trash2 size={14} /></button>
                  </div>
                  <div className="additional-model-grid">
                    <label>Nombre<input value={model.name} onChange={(event) => setAdditionalField(index, "name", event.target.value)} required /></label>
                    <label>Motor<select value={model.engine} onChange={(event) => setAdditionalEngine(index, event.target.value as ProfileModel["engine"])}>{engineOptions.map((engine) => <option value={engine} key={engine}>{engine}</option>)}</select></label>
                    <label>Tarea<select value={model.task} onChange={(event) => setAdditionalTask(index, event.target.value as ModelTask)}>{taskOptions.map((task) => <option value={task.id} key={task.id}>{task.label}</option>)}</select></label>
                    <label>Identificador / modelo<input value={model.model_ref} onChange={(event) => setAdditionalField(index, "model_ref", event.target.value)} required /></label>
                    <label>Puerto preferido <small>(automático si hay conflicto)</small><input type="number" min={1024} max={65535} value={model.port} onChange={(event) => setAdditionalField(index, "port", Number(event.target.value))} /></label>
                    {!["llama.cpp", "ollama"].includes(model.engine) && <>
                      <label className="span-two">Endpoint local<input type="url" value={model.endpoint_url} onChange={(event) => setAdditionalField(index, "endpoint_url", event.target.value)} placeholder={model.api_protocol === "tts-lab" ? "http://127.0.0.1:8010/api/projects/mi-voz" : "http://127.0.0.1:8000"} required /></label>
                      <label>Protocolo<select value={model.api_protocol} onChange={(event) => setAdditionalField(index, "api_protocol", event.target.value as ModelConfig["api_protocol"])}><option value="openai">OpenAI compatible</option><option value="tts-lab">TTS Lab</option><option value="voice-agent">Voice Agent (API privada)</option><option value="ragkit">RAGKit</option><option value="security-app">Aplicación de seguridad</option><option value="comfyui">ComfyUI</option></select></label>
                    </>}
                    {model.engine === "llama.cpp" && <>
                      <label className="span-two">Repositorio Hugging Face<input value={model.model_repo} onChange={(event) => setAdditionalField(index, "model_repo", event.target.value)} placeholder="organización/modelo-GGUF" /></label>
                      <label>Archivo GGUF remoto<input value={model.model_filename} onChange={(event) => setAdditionalField(index, "model_filename", event.target.value)} /></label>
                      <label>Archivo GGUF local<input value={model.model_file} onChange={(event) => setAdditionalField(index, "model_file", event.target.value)} /></label>
                      {model.task === "vision" && <>
                        <label>Archivo mmproj remoto<input value={model.mmproj_filename} onChange={(event) => setAdditionalField(index, "mmproj_filename", event.target.value)} /></label>
                        <label>Archivo mmproj local<input value={model.mmproj_file} onChange={(event) => setAdditionalField(index, "mmproj_file", event.target.value)} /></label>
                      </>}
                    </>}
                    <label>Contexto<input type="number" min={512} value={model.context_size} onChange={(event) => setAdditionalField(index, "context_size", Number(event.target.value))} /></label>
                    <label>Batch / uBatch<div className="paired-inputs"><input type="number" min={1} value={model.batch_size} onChange={(event) => setAdditionalField(index, "batch_size", Number(event.target.value))} /><input type="number" min={1} value={model.ubatch_size} onChange={(event) => setAdditionalField(index, "ubatch_size", Number(event.target.value))} /></div></label>
                    <label>Memoria estimada (MiB)<input type="number" min={0} value={model.estimated_memory_mb} onChange={(event) => setAdditionalField(index, "estimated_memory_mb", Number(event.target.value))} placeholder="0 = automática" /></label>
                    <label>Alias OpenAI servido<input value={model.model_alias} onChange={(event) => setAdditionalField(index, "model_alias", event.target.value)} /></label>
                  </div>
                </div>
              ))}
            </div>
            {duplicateAliases.length > 0 && <div className="profile-warning wide"><ShieldCheck size={16} />Cada modelo habilitado necesita un alias OpenAI único. Duplicados: {duplicateAliases.join(", ")}.</div>}
            {recommendation?.warning && <div className="profile-warning wide"><ShieldCheck size={16} />{recommendation.warning}</div>}
            <div className="profile-form-actions wide"><button type="button" className="button secondary" onClick={() => setShowForm(false)}>Cancelar</button><button className="button primary" type="submit" disabled={duplicateAliases.length > 0}>Guardar perfil</button></div>
          </form>
        </Card>
        </div>
      )}

      {(activeProfiles.length > 0 || availableProfiles.length > 0) && <div className="profile-groups">
        {activeProfiles.length > 0 && <section className="profile-group split-section is-active">
          <div className="split-section-title"><strong>Activos</strong><span>{activeProfiles.length}</span></div>
          <div className="profiles-list">{activeProfiles.map(renderProfileCard)}</div>
        </section>}
        {availableProfiles.length > 0 && <section className="profile-group split-section">
          <div className="split-section-title"><strong>Disponibles</strong><span>{availableProfiles.length}</span></div>
          <div className="profiles-list">{availableProfiles.map(renderProfileCard)}</div>
        </section>}
      </div>}
      {data && !visibleProfiles.length && (
        <Empty
          icon={<SlidersHorizontal />}
          title={profileSearch ? "No hay coincidencias" : "No hay perfiles"}
          text={profileSearch ? "Prueba con otro nombre, modelo, motor o tarea." : "Crea una configuración para llama.cpp u Ollama y actívala como predeterminada."}
        />
      )}
    </div>
  );
}

type OptionalService = {
  id: string;
  name: string;
  unit: string;
  impact: string;
  installed: boolean;
  active: boolean;
  bytes: number;
  stopped_by_memory_mode: boolean;
};

type MemoryModeStatus = {
  services: OptionalService[];
  ollama_models: string[];
  ollama_bytes: number;
  profiles: Array<{ id: string; name: string; models: string[]; bytes: number }>;
  stopped_profiles: Array<{ id: string; name: string }>;
  stopped: string[];
  since: string | null;
  memory: Partial<MemoryBreakdown>;
  freed_bytes?: number;
  errors?: string[];
};

function MemoryModePanel({ notify, onChange }: { notify: (message: string, error?: boolean) => void; onChange: () => void }) {
  const [status, setStatus] = useState<MemoryModeStatus | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [stopProfiles, setStopProfiles] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setStatus(await api<MemoryModeStatus>("/api/memory-mode"));
    } catch (error) {
      notify((error as Error).message, true);
    }
  }, [notify]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const active = status?.services.filter((service) => service.active) ?? [];
  const chosen = selected ?? new Set(active.filter((service) => service.id !== "gateway").map((service) => service.id));
  const profiles = status?.profiles ?? [];
  const profileBytes = profiles.reduce((sum, profile) => sum + profile.bytes, 0);
  const chosenBytes = active.filter((service) => chosen.has(service.id)).reduce((sum, service) => sum + service.bytes, 0)
    + (status?.ollama_bytes ?? 0) + (stopProfiles ? profileBytes : 0);
  async function run(key: string, path: string, body: Record<string, unknown>, success: (result: MemoryModeStatus) => string) {
    setBusy(key);
    try {
      const result = await api<MemoryModeStatus>(path, { method: "POST", body: JSON.stringify(body) });
      setStatus(result);
      setSelected(null);
      notify(result.errors?.length ? result.errors.join(" · ") : success(result), Boolean(result.errors?.length));
      onChange();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(null);
    }
  }
  function toggle(id: string) {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }
  function releaseAll() {
    const names = [
      ...(stopProfiles ? profiles.map((profile) => `perfil ${profile.name}`) : []),
      ...active.filter((service) => chosen.has(service.id)).map((service) => service.name),
    ];
    if (!window.confirm(`Se detendrán: ${names.join(", ") || "ningún servicio"} y se descargarán los modelos de Ollama. Podrás devolverlo todo con «Restaurar». ¿Continuar?`)) return;
    void run("release", "/api/memory-mode/release", {
      services: [...chosen].filter((id) => active.some((service) => service.id === id)),
      release_ollama: true,
      stop_profiles: stopProfiles && profiles.length > 0,
      confirm: "liberar memoria",
    },
      (result) => `Memoria liberada · ${bytes(result.memory.free ?? 0)} libres`);
  }
  function toggleService(service: OptionalService) {
    const action = service.active ? "stop" : "start";
    if (action === "stop" && !window.confirm(`¿Detener ${service.name}? ${service.impact}`)) return;
    void run(service.id, `/api/memory-mode/services/${encodeURIComponent(service.id)}`, { action, confirm: `${action} ${service.id}` },
      () => `${service.name} ${action === "stop" ? "detenido" : "arrancado"}`);
  }
  if (!status) return null;
  const stoppedNames = [
    ...status.stopped_profiles.map((profile) => `perfil ${profile.name}`),
    ...status.services.filter((service) => service.stopped_by_memory_mode).map((service) => service.name),
  ];
  return <Card className="memory-mode-card">
    <div className="memory-mode-head">
      <div className="model-icon"><Zap /></div>
      <span>
        <strong>Memoria máxima para operaciones intensivas</strong>
        <small>Detén lo opcional para cargar un modelo grande (≈100 GB). La memoria libre real ahora: <b>{bytes(status.memory.free ?? 0)}</b> de {bytes(status.memory.total ?? 0)}.</small>
      </span>
      {stoppedNames.length > 0 && <span className="badge running">Modo memoria activo</span>}
    </div>
    <div className="memory-mode-list">
      <div className={`memory-mode-row ${profiles.length ? "" : "is-stopped"}`}>
        <label>
          <input type="checkbox" disabled={!profiles.length || busy !== null} checked={profiles.length > 0 && stopProfiles} onChange={() => setStopProfiles((value) => !value)} />
          <span>
            <strong>Perfiles llama.cpp</strong>
            <small>{profiles.length
              ? `${profiles.map((profile) => `${profile.name} (${profile.models.join(", ")})`).join(" · ")}. Incluye el modelo del chat del dashboard si usa un perfil. «Restaurar» los vuelve a levantar.`
              : status.stopped_profiles.length ? `Detenidos por modo memoria: ${status.stopped_profiles.map((profile) => profile.name).join(", ")}.` : "Ningún perfil cargado."}</small>
          </span>
        </label>
        <span className="memory-mode-bytes">{profileBytes ? bytes(profileBytes) : "—"}</span>
        <span />
      </div>
      {status.services.filter((service) => service.installed).map((service) => <div className={`memory-mode-row ${service.active ? "" : "is-stopped"}`} key={service.id}>
        <label title={service.impact}>
          <input type="checkbox" disabled={!service.active || busy !== null} checked={service.active && chosen.has(service.id)} onChange={() => toggle(service.id)} />
          <span><strong>{service.name}</strong><small>{service.impact}</small></span>
        </label>
        <span className="memory-mode-bytes">{service.active ? (service.bytes ? bytes(service.bytes) : "—") : service.stopped_by_memory_mode ? "Detenido por modo memoria" : "Detenido"}</span>
        <button className={service.active ? "danger" : "primary-action"} disabled={busy !== null} onClick={() => toggleService(service)}>
          {service.active ? <Square size={13} /> : <Play size={14} />}{busy === service.id ? "Procesando…" : service.active ? "Detener" : "Arrancar"}
        </button>
      </div>)}
      <div className="memory-mode-row">
        <label><input type="checkbox" checked disabled /><span><strong>Modelos en Ollama</strong><small>{status.ollama_models.length ? `Modelo del chat del dashboard y otros: ${status.ollama_models.join(", ")}. Se recargan solos al volver a usarlos.` : "Ninguno cargado."}</small></span></label>
        <span className="memory-mode-bytes">{status.ollama_bytes ? bytes(status.ollama_bytes) : "—"}</span>
        <span />
      </div>
    </div>
    <small className="memory-mode-note"><Info size={12} /> Después levanta el modelo grande desde Perfiles: si no cabe en la memoria libre, MyDGX vacía la caché de disco antes de cargarlo. Para restaurar los perfiles anteriores, detén antes el modelo grande.</small>
    <div className="memory-mode-actions">
      <button className="danger" disabled={busy !== null} onClick={releaseAll}><Zap size={14} />{busy === "release" ? "Liberando…" : `Liberar seleccionados (~${bytes(chosenBytes)} + caché)`}</button>
      {stoppedNames.length > 0 && <button className="primary-action" disabled={busy !== null} onClick={() => {
        if (window.confirm(`¿Volver a arrancar ${stoppedNames.join(", ")}?`)) void run("restore", "/api/memory-mode/restore", { confirm: "restaurar servicios" }, () => "Servicios restaurados");
      }}><RefreshCw size={14} />{busy === "restore" ? "Restaurando…" : `Restaurar (${stoppedNames.join(", ")})`}</button>}
    </div>
  </Card>;
}

function EnginesView({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const [engines, setEngines] = useState<ServingEngine[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{ engines: ServingEngine[] }>("/api/engines");
      setEngines(result.engines);
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setLoading(false);
    }
  }, [notify]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function action(engine: ServingEngine, operation: "start" | "stop") {
    if (operation === "stop" && !window.confirm(`¿Detener ${engine.name}? Los modelos que dependen de este motor dejarán de estar disponibles.`)) return;
    setBusy(engine.id);
    try {
      await api(`/api/engines/${encodeURIComponent(engine.id)}/action`, {
        method: "POST",
        body: JSON.stringify({ action: operation, confirm: `${operation} ${engine.id}` }),
      });
      notify(`${engine.name} ${operation === "start" ? "arrancado" : "detenido"}`);
      await load();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(null);
    }
  }
  return <div className="view-stack">
    <SectionHeading eyebrow="RUNTIMES DE INFERENCIA" title="Motores" action={<button className="icon-button" onClick={load}><RefreshCw className={loading ? "spin" : ""} size={16} /></button>} />
    <MemoryModePanel notify={notify} onChange={() => void load()} />
    <div className="engine-grid">
      {engines.map((engine) => <Card className="engine-card" key={engine.id}>
        <div className="engine-head"><div className="model-icon"><Cpu /></div><span><strong>{engine.name}</strong><small>{engine.version || "Versión no detectada"}</small></span><span className={`badge ${engine.reachable ? "live" : engine.installed ? "running" : ""}`}>{engine.reachable ? "Disponible" : engine.installed ? "Instalado" : "No instalado"}</span></div>
        <div className="engine-capabilities">{engine.capabilities.map((capability) => <span className="badge" key={capability}>{capability}</span>)}</div>
        <small>{engine.endpoint || engine.binary || "Sin endpoint configurado"} · {engine.managed ? "Gestionado por MyDGX" : "Solo descubrimiento"}</small>
        {engine.essential && <small className="engine-protection"><ShieldCheck size={12} /> Protegido: necesario para MyDGX, el gateway, perfiles o chatbot.</small>}
        {engine.controllable && <div className="engine-actions">
          <small>{engine.running
            ? "Opcional · al detenerlo queda desactivado también tras reiniciar el DGX, hasta que lo vuelvas a arrancar aquí."
            : "Desactivado · «Arrancar motor» lo levanta y lo vuelve a activar en el arranque del DGX."}</small>
          <button
            className={engine.running ? "danger" : "primary-action"}
            disabled={busy === engine.id || (!engine.running && !engine.installed)}
            onClick={() => void action(engine, engine.running ? "stop" : "start")}
          >
            {engine.running ? <Square size={13} /> : <Play size={14} />}
            {busy === engine.id ? "Procesando…" : engine.running ? "Detener motor" : "Arrancar motor"}
          </button>
        </div>}
        {engine.models.length > 0 && <div className="engine-models">{engine.models.slice(0, 8).map((model) => <span key={model}>{model}</span>)}</div>}
      </Card>)}
    </div>
  </div>;
}

type MultimodalCapability = {
  id: string;
  alias: string;
  name: string;
  engine: string;
  task: ModelTask;
  input_modalities: InputModality[];
  output_modalities: OutputModality[];
  max_input_mb: number;
  endpoint: string;
};

type MultimodalResponse = {
  content_type: string;
  result?: Record<string, unknown>;
  data_base64?: string;
  job_id?: string;
  artifact_url?: string;
};

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

function MultimodalLabView({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const [models, setModels] = useState<MultimodalCapability[]>([]);
  const [modelAlias, setModelAlias] = useState("");
  const [prompt, setPrompt] = useState("");
  const [documents, setDocuments] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<MultimodalResponse | null>(null);
  const [artifactObjectUrl, setArtifactObjectUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => () => {
    if (artifactObjectUrl) URL.revokeObjectURL(artifactObjectUrl);
  }, [artifactObjectUrl]);

  const load = useCallback(async () => {
    try {
      const response = await api<{ models: MultimodalCapability[] }>("/api/multimodal/capabilities");
      setModels(response.models);
      setModelAlias((current) => response.models.some((model) => model.alias === current) ? current : response.models[0]?.alias || "");
    } catch (error) {
      notify((error as Error).message, true);
    }
  }, [notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selected = models.find((model) => model.alias === modelAlias);
  const needsFile = selected?.task === "vision" || selected?.task === "asr";
  const accept = selected?.task === "vision" ? "image/jpeg,image/png,image/webp" : selected?.task === "asr" ? "audio/*" : undefined;

  async function run(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (needsFile && !file) {
      notify("Selecciona un archivo compatible", true);
      return;
    }
    if (file && file.size > selected.max_input_mb * 1024 * 1024) {
      notify(`El archivo supera ${selected.max_input_mb} MiB`, true);
      return;
    }
    setBusy(true);
    setResult(null);
    setArtifactObjectUrl("");
    try {
      const payload = {
        model: selected.alias,
        task: selected.task,
        prompt,
        data_url: file ? await fileDataUrl(file) : "",
        documents: selected.task === "reranking"
          ? documents.split("\n").map((item) => item.trim()).filter(Boolean)
          : [],
        response_format: selected.task === "tts" ? "mp3" : selected.task === "image-generation" ? "b64_json" : "json",
      };
      if (selected.task === "video-generation") {
        const response = await api<{ job_id: string }>("/api/multimodal/video/jobs", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setResult({ content_type: "application/json", job_id: response.job_id });
        notify("Generación de vídeo enviada a trabajos");
      } else {
        const response = await api<MultimodalResponse>("/api/multimodal/run", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setResult(response);
      }
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  async function checkVideoJob(jobId: string) {
    try {
      const jobs = await api<Job[]>("/api/jobs");
      const job = jobs.find((item) => item.id === jobId);
      if (!job) {
        notify("El trabajo ya no aparece en la actividad reciente", true);
      } else if (job.status === "completed") {
        const completed = await api<MultimodalResponse>(`/api/jobs/${jobId}/result`);
        setResult(completed);
        if (completed.artifact_url) {
          setArtifactObjectUrl(URL.createObjectURL(await apiBlob(completed.artifact_url)));
        }
      } else if (job.status === "failed" || job.status === "cancelled") {
        notify(job.message, true);
      } else {
        notify(`${job.status}: ${job.message}`);
      }
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  const openAIData = Array.isArray(result?.result?.data)
    ? result.result.data as Array<Record<string, unknown>>
    : [];
  const imageBase64 = typeof openAIData[0]?.b64_json === "string" ? openAIData[0].b64_json : "";
  const imageUrl = typeof openAIData[0]?.url === "string" ? openAIData[0].url : "";
  const binaryUrl = result?.data_base64 ? `data:${result.content_type};base64,${result.data_base64}` : "";
  const compactResult = result?.result
    ? JSON.stringify(result.result, (key, value) => key === "b64_json" ? "[contenido base64 omitido]" : value, 2)
    : "";

  return <div className="view-stack">
    <SectionHeading eyebrow="IMAGEN · AUDIO · VÍDEO · EMBEDDINGS" title="Laboratorio multimodal" action={<button className="icon-button" onClick={load}><RefreshCw size={16} /></button>} />
    <Card className="multimodal-intro">
      <Sparkles />
      <div><strong>Prueba el perfil activo y los motores administrados</strong><small>ComfyUI genera imagen y vídeo localmente; las entradas no se guardan en SQLite.</small></div>
    </Card>
    {!models.length ? <Empty icon={<Boxes />} title="Sin modelos multimodales" text="Activa un perfil que declare una tarea y arranca sus endpoints." /> :
      <div className="multimodal-layout">
        <Card className="multimodal-form-card">
          <form onSubmit={run}>
            <label>Servicio<select value={modelAlias} onChange={(event) => { setModelAlias(event.target.value); setFile(null); setResult(null); }}>{models.map((model) => <option value={model.alias} key={model.alias}>{model.name} · {model.task} · {model.engine}</option>)}</select></label>
            <div className="multimodal-capabilities">
              <span className="badge">{selected?.task}</span>
              <small>{selected?.input_modalities.join(" + ")} → {selected?.output_modalities.join(" + ")}</small>
              <small>{selected?.endpoint}</small>
            </div>
            {selected?.task !== "asr" && <label>Instrucción<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={selected?.task === "image-generation" ? "Describe la imagen que quieres generar" : selected?.task === "tts" ? "Texto que se convertirá en voz" : "Introduce la petición"} required={selected?.task !== "reranking"} /></label>}
            {selected?.task === "reranking" && <label>Documentos <small>(uno por línea)</small><textarea value={documents} onChange={(event) => setDocuments(event.target.value)} placeholder={"Primer documento\nSegundo documento"} required /></label>}
            {needsFile && <label className="multimodal-upload">Archivo<input type="file" accept={accept} onChange={(event) => setFile(event.target.files?.[0] || null)} required /><span>{file ? `${file.name} · ${bytes(file.size)}` : `Máximo ${selected.max_input_mb} MiB`}</span></label>}
            <button className="button primary" type="submit" disabled={busy}>{busy ? "Procesando…" : selected?.task === "video-generation" ? "Crear trabajo" : "Ejecutar"}</button>
          </form>
        </Card>
        <Card className="multimodal-result">
          <SectionHeading eyebrow="RESULTADO LOCAL" title={selected?.name || "Salida"} />
          {!result && <Empty icon={<Sparkles />} title="Esperando una ejecución" text="El resultado aparecerá aquí sin registrar el contenido de tu petición." />}
          {result?.job_id && <div className="multimodal-job"><strong>Trabajo creado</strong><code>{result.job_id}</code><small>El vídeo se procesa de forma asíncrona.</small><button className="button secondary" onClick={() => void checkVideoJob(result.job_id!)}>Consultar resultado</button></div>}
          {imageBase64 && <img src={`data:image/png;base64,${imageBase64}`} alt="Resultado generado" />}
          {imageUrl && <a className="button secondary" href={imageUrl} target="_blank" rel="noreferrer">Abrir {selected?.task === "video-generation" ? "vídeo" : "imagen"} generada <ExternalLink size={14} /></a>}
          {binaryUrl && result?.content_type.startsWith("audio/") && <audio src={binaryUrl} controls />}
          {binaryUrl && result?.content_type.startsWith("image/") && <img src={binaryUrl} alt="Resultado generado" />}
          {artifactObjectUrl && result?.content_type.startsWith("video/") && <video src={artifactObjectUrl} controls />}
          {compactResult && <pre>{compactResult}</pre>}
        </Card>
      </div>}
  </div>;
}

function ChatView({ models, config, notify }: { models: Models | null; config: Config | null; notify: (message: string, error?: boolean) => void }) {
  type AssistantAction = {
    id: string;
    name: string;
    label: string;
    arguments: Record<string, unknown>;
    expires_at: string;
    status?: "confirmed" | "rejected" | "running" | "failed";
  };
  type ChatMessage = {
    role: "user" | "assistant";
    content: string;
    model?: string;
    tools?: Array<{ name: string; status: string }>;
    actions?: AssistantAction[];
  };
  type AssistantStatus = {
    enabled: boolean;
    ready: boolean;
    preferred_model: string;
    preferred_available: boolean;
    ollama_reachable: boolean;
    available_models: string[];
    documentation_chunks: number;
    read_tools: string[];
    action_tools: string[];
    remediation: string | null;
  };
  const historyStorageKey = "mydgx.chat.history.v1";
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus | null>(null);
  useEffect(() => {
    api<ProfilesResponse>("/api/profiles").then((result) => setProfiles(result.profiles)).catch(() => undefined);
    api<AssistantStatus>("/api/assistant/status").then(setAssistantStatus).catch(() => undefined);
  }, []);
  const available = [
    ...(config?.assistant_enabled ? [{
      value: "__assistant__",
      label: `Asistente MyDGX · ${config.assistant_model || "automático"}`,
      active: true,
    }] : []),
    ...profiles.flatMap((profile) => profile.models.filter((model) => ["chat", "vision"].includes(model.task)).map((model) => ({
      value: `profile:${profile.id}:${model.id}`,
      label: `${profile.name} · ${model.name} · :${model.port}`,
      active: Boolean(profile.active),
    }))),
    ...(models?.ollama ?? []).map((item) => ({ value: String(item.name), label: String(item.name), active: false })),
  ].sort((a, b) => Number(b.active) - Number(a.active));
  const [model, setModel] = useState("__assistant__");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(historyStorageKey) || "[]");
      if (!Array.isArray(stored)) return [];
      return stored
        .filter((item): item is ChatMessage => (
          item
          && (item.role === "user" || item.role === "assistant")
          && typeof item.content === "string"
        ))
        .slice(-100)
        .map((item) => ({ ...item, content: item.content.slice(0, 32_000) }));
    } catch {
      return [];
    }
  });
  const [sending, setSending] = useState(false);
  const activeModel = available.some((item) => item.value === model) ? model : available[0]?.value || "";
  const activeLabel = available.find((item) => item.value === activeModel)?.label ?? activeModel;
  const assistantUnavailable = activeModel === "__assistant__" && assistantStatus?.ready === false;
  useEffect(() => {
    try {
      if (messages.length) {
        localStorage.setItem(historyStorageKey, JSON.stringify(messages.slice(-100)));
      } else {
        localStorage.removeItem(historyStorageKey);
      }
    } catch {
      // El chat sigue funcionando aunque el navegador bloquee o llene el almacenamiento local.
    }
  }, [messages]);

  async function copyMessage(content: string) {
    try {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(content);
        } catch {
          const textarea = document.createElement("textarea");
          textarea.value = content;
          textarea.setAttribute("readonly", "");
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          const copied = document.execCommand("copy");
          textarea.remove();
          if (!copied) throw new Error("Clipboard unavailable");
        }
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("Clipboard unavailable");
      }
      notify("Mensaje copiado");
    } catch {
      notify("No se pudo copiar el mensaje", true);
    }
  }

  function clearChat() {
    if (!window.confirm("¿Borrar todo el historial de este chat en este navegador?")) return;
    setMessages([]);
    try {
      localStorage.removeItem(historyStorageKey);
    } catch {
      // El estado en memoria ya se ha eliminado.
    }
    notify("Historial del chat eliminado");
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!message.trim() || !activeModel || sending) return;
    const content = message.trim();
    const previous = messages;
    setMessages([...previous, { role: "user", content }]);
    setMessage("");
    setSending(true);
    try {
      const response = await api<{
        message: { content?: string };
        model: string;
        tools_used: Array<{ name: string; status: string }>;
        pending_actions: AssistantAction[];
      }>("/api/assistant/chat", {
        method: "POST",
        body: JSON.stringify({
          model: activeModel === "__assistant__" ? undefined : activeModel,
          message: content,
          history: previous.map(({ role, content: itemContent }) => ({ role, content: itemContent })),
        }),
      });
      setMessages((items) => [...items, {
        role: "assistant",
        content: response.message.content || "Sin respuesta",
        model: response.model,
        tools: response.tools_used,
        actions: response.pending_actions,
      }]);
    } catch (error) {
      const detail = (error as Error).message;
      setMessages((items) => [...items, {
        role: "assistant",
        content: `No pude completar la consulta. ${detail}`,
        model: "MyDGX Copilot",
      }]);
      notify(detail, true);
    } finally {
      setSending(false);
    }
  }

  async function resolveAction(actionId: string, confirm: boolean) {
    setMessages((items) => items.map((item) => ({
      ...item,
      actions: item.actions?.map((action) => (
        action.id === actionId ? { ...action, status: confirm ? "running" : "rejected" } : action
      )),
    })));
    try {
      await api(confirm ? "/api/assistant/actions/confirm" : "/api/assistant/actions/reject", {
        method: "POST",
        body: JSON.stringify({ action_id: actionId }),
      });
      setMessages((items) => items.map((item) => ({
        ...item,
        actions: item.actions?.map((action) => (
          action.id === actionId ? { ...action, status: confirm ? "confirmed" : "rejected" } : action
        )),
      })));
      notify(confirm ? "Acción del asistente ejecutada" : "Acción rechazada");
    } catch (error) {
      setMessages((items) => items.map((item) => ({
        ...item,
        actions: item.actions?.map((action) => (
          action.id === actionId ? { ...action, status: "failed" } : action
        )),
      })));
      notify((error as Error).message, true);
    }
  }

  return (
    <div className="chat-layout">
      <div className="chat-header">
        <div><span className="eyebrow">ASISTENTE LOCAL</span><h2>MyDGX Copilot</h2></div>
        <div className="chat-header-actions">
          {messages.length > 0 && <button className="chat-clear" type="button" onClick={clearChat} aria-label="Borrar chat completo" title="Borrar chat completo"><Trash2 size={15} /></button>}
          <select value={activeModel} onChange={(event) => setModel(event.target.value)}>
            {available.length ? available.map((item) => <option key={item.value} value={item.value}>{item.label}</option>) : <option value="">Sin modelos</option>}
          </select>
        </div>
      </div>
      <div className="messages">
        {messages.length === 0 && (
          <div className="chat-welcome"><Sparkles /><h3>Pregunta o administra tu MyDGX</h3><p>Puede consultar telemetría, sistema, modelos, perfiles y documentación. Las acciones siempre requieren confirmación.</p>
            {assistantUnavailable && <div className="assistant-unavailable"><TriangleAlert size={14} /><span>{assistantStatus?.remediation || "No hay un modelo local disponible"}</span></div>}
            {assistantStatus?.ready && <small>{assistantStatus.documentation_chunks} fragmentos · {assistantStatus.read_tools?.length ?? 0} consultas · {assistantStatus.action_tools?.length ?? 0} acciones confirmadas</small>}
            {!assistantUnavailable && <div className="assistant-suggestions">
              {[
                "Recomiéndame tres modelos de código que quepan en este equipo",
                "Resume el estado del sistema y sus avisos",
                "¿Qué perfiles y modelos tengo cargados ahora?",
                "Busca en la documentación cómo funciona el gateway",
              ].map((suggestion) => <button type="button" key={suggestion} onClick={() => setMessage(suggestion)}>{suggestion}</button>)}
            </div>}
          </div>
        )}
        {messages.map((item, index) => (
          <div className={`message ${item.role}`} key={`${item.role}-${index}`}>
            <span>{item.role === "user" ? "Tú" : item.model || "MyDGX Copilot"}</span>
            {item.role === "assistant"
              ? <MarkdownMessage content={item.content} />
              : <p>{item.content}</p>}
            <div className="message-controls">
              <button className="message-copy" type="button" onClick={() => void copyMessage(item.content)} aria-label="Copiar mensaje" title="Copiar mensaje"><Copy size={13} /></button>
            </div>
            {item.tools && item.tools.length > 0 && <div className="assistant-tools">
              {item.tools.map((tool, toolIndex) => <small key={`${tool.name}-${toolIndex}`} className={tool.status}>{tool.name}</small>)}
            </div>}
            {item.actions?.map((action) => <div className={`assistant-action ${action.status || "pending"}`} key={action.id}>
              <div><ShieldCheck size={15} /><span><strong>Confirmación requerida</strong><small>{action.label}</small></span></div>
              {!action.status && <div>
                <button className="button secondary" type="button" onClick={() => resolveAction(action.id, false)}><X size={14} /> Rechazar</button>
                <button className="button primary" type="button" onClick={() => resolveAction(action.id, true)}><CheckCircle2 size={14} /> Confirmar</button>
              </div>}
              {action.status && <em>{action.status === "running" ? "Ejecutando…" : action.status === "confirmed" ? "Ejecutada" : action.status === "rejected" ? "Rechazada" : "No se pudo ejecutar"}</em>}
            </div>)}
          </div>
        ))}
        {sending && <div className="message assistant"><span>{activeLabel}</span><p className="typing">Pensando<span>.</span><span>.</span><span>.</span></p></div>}
      </div>
      <form className="composer" onSubmit={send}>
        <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={assistantUnavailable ? "Instala o carga un modelo para activar el asistente" : activeModel ? `Pregunta a ${activeLabel}` : "Descarga un modelo para comenzar"} disabled={!activeModel || assistantUnavailable} />
        <button className="button primary" type="submit" disabled={!activeModel || assistantUnavailable || sending}>Enviar <ChevronRight size={16} /></button>
      </form>
      <a className="openwebui-link" href={config?.openwebui_url} target="_blank" rel="noreferrer">Abrir experiencia avanzada en Open WebUI <ExternalLink size={14} /></a>
    </div>
  );
}

function StorageView({ notify }: { notify: (message: string, error?: boolean) => void }) {
  type NvmeDevice = {
    name: string;
    model: string;
    firmware: string;
    state: string;
    capacity: number;
    temperature: number | null;
    namespaces: Array<{ name: string; path: string; size: number }>;
    smart: {
      available: boolean;
      source: string | null;
      critical_warning: number | null;
      available_spare: number | null;
      percentage_used: number | null;
      data_units_read: number | null;
      data_units_written: number | null;
      controller_busy_time: number | null;
      power_cycles: number | null;
      power_on_hours: number | null;
      unsafe_shutdowns: number | null;
      media_errors: number | null;
      num_err_log_entries: number | null;
    };
  };
  const [storage, setStorage] = useState<{
    partitions: Array<Record<string, unknown>>;
    usage_categories: Array<{ id: string; label: string; size: number; description: string }>;
    categorized_total: number;
    model_storage: Array<Record<string, unknown>>;
    nvme_devices: NvmeDevice[];
  } | null>(null);
  useEffect(() => {
    api<typeof storage>("/api/storage").then(setStorage).catch((error) => notify(error.message, true));
  }, [notify]);
  if (!storage) return <Loading label="Calculando almacenamiento" />;
  return (
    <div className="view-stack">
      <SectionHeading eyebrow="NVME" title="Unidades y salud SMART" />
      <div className="storage-grid nvme-grid">
        {storage.nvme_devices.map((device) => {
          const smart = device.smart;
          const healthy = smart.available && (smart.critical_warning ?? 0) === 0;
          const busyTime = smart.controller_busy_time == null
            ? "—"
            : `${Math.floor(smart.controller_busy_time / 60)} h ${smart.controller_busy_time % 60} min`;
          return (
            <Card className="storage-card nvme-card" key={device.name}>
              <div className="card-kicker">
                <HardDrive size={16} />
                {device.model || device.name}
                <StatusDot online={device.state === "live"} />
              </div>
              <strong>{bytes(device.capacity)} <small>{device.name} · FW {device.firmware || "—"}</small></strong>
              <div className="nvme-summary">
                <span><Thermometer size={14} /><strong>{device.temperature == null ? "—" : `${device.temperature} °C`}</strong><small>Temperatura</small></span>
                <span><Activity size={14} /><strong>{smart.percentage_used == null ? "—" : `${smart.percentage_used}%`}</strong><small>Vida utilizada</small></span>
                <span><ShieldCheck size={14} /><strong>{smart.available ? (healthy ? "Correcto" : "Atención") : "Sin acceso"}</strong><small>{smart.source ?? "SMART"}</small></span>
              </div>
              {smart.available ? (
                <div className="nvme-details">
                  <span>Reserva <strong>{smart.available_spare == null ? "—" : `${smart.available_spare}%`}</strong></span>
                  <span>Horas encendido <strong>{smart.power_on_hours == null ? "—" : `${smart.power_on_hours.toLocaleString()} h`}</strong></span>
                  <span>Uso activo <strong>{busyTime}</strong></span>
                  <span>Ciclos encendido <strong>{smart.power_cycles?.toLocaleString() ?? "—"}</strong></span>
                  <span>Errores de medio <strong>{smart.media_errors ?? "—"}</strong></span>
                  <span>Entradas de error <strong>{smart.num_err_log_entries?.toLocaleString() ?? "—"}</strong></span>
                  <span>Apagados inseguros <strong>{smart.unsafe_shutdowns ?? "—"}</strong></span>
                  <span>Leído <strong>{smart.data_units_read == null ? "—" : bytes(smart.data_units_read * 512000)}</strong></span>
                  <span>Escrito <strong>{smart.data_units_written == null ? "—" : bytes(smart.data_units_written * 512000)}</strong></span>
                </div>
              ) : (
                <small className="nvme-note">La unidad se detecta por sysfs; SMART requiere acceso al dispositivo NVMe.</small>
              )}
            </Card>
          );
        })}
        {storage.nvme_devices.length === 0 && <Card className="empty-state"><HardDrive /><strong>No se detectaron controladores NVMe</strong></Card>}
      </div>
      <SectionHeading eyebrow="CAPACIDAD" title="Almacenamiento" />
      <div className="storage-grid">
        {storage.partitions.map((partition) => {
          const percent = Number(partition.percent);
          const kind = String(partition.kind);
          const mountpoint = String(partition.mountpoint);
          return (
            <Card className="storage-card" key={mountpoint}>
              <div className="card-kicker">
                <HardDrive size={16} />
                {mountpoint === "/" ? "Disco del sistema" : mountpoint}
                <span className={`storage-kind ${kind}`}>{kind === "virtual" ? "Virtual" : kind === "physical" ? "Físico" : "Sistema"}</span>
              </div>
              <strong>{bytes(Number(partition.used))} <small>de {bytes(Number(partition.total))}</small></strong>
              <div className="storage-bar"><span style={{ width: `${percent}%` }} /></div>
              <small>{percent}% utilizado · {String(partition.filesystem)} · {String(partition.device)}</small>
            </Card>
          );
        })}
      </div>
      <SectionHeading eyebrow="USO REAL" title="Distribución del almacenamiento" />
      <Card className="storage-breakdown">
        <div className="storage-breakdown-total">
          <span><Database size={17} /><strong>Espacio ocupado clasificado</strong></span>
          <strong>{bytes(storage.categorized_total)}</strong>
        </div>
        {storage.usage_categories.map((category) => {
          const percent = storage.categorized_total > 0
            ? Math.min(100, category.size / storage.categorized_total * 100)
            : 0;
          return <div className="storage-breakdown-row" data-category={category.id} key={category.id}>
            <div><span><strong>{category.label}</strong><small>{category.description}</small></span><strong>{bytes(category.size)}</strong></div>
            <div className="storage-category-bar"><span style={{ width: `${percent}%` }} /></div>
            <small>{percent.toFixed(1)}% del espacio ocupado</small>
          </div>;
        })}
      </Card>
      <SectionHeading eyebrow="DISTRIBUCIÓN" title="Datos de modelos" />
      <Card className="storage-list">
        {storage.model_storage.map((item) => (
          <div key={String(item.path)}><div><Database size={17} /><span><strong>{String(item.name)}</strong><small>{String(item.path)}</small></span></div><strong>{bytes(Number(item.size))}</strong></div>
        ))}
      </Card>
    </div>
  );
}

type BenchmarkCategoryId = "all" | "text" | "voice" | "image" | "vision" | "retrieval";

const BENCHMARK_CATEGORIES: Array<{ id: BenchmarkCategoryId; label: string; icon: typeof Gauge; color: string; modalities: string[] }> = [
  { id: "all", label: "Todos", icon: Gauge, color: "var(--accent)", modalities: [] },
  { id: "text", label: "Texto", icon: MessageSquare, color: "#68b929", modalities: ["text-generation"] },
  { id: "voice", label: "Voz", icon: Mic, color: "#3e8fdc", modalities: ["automatic-speech-recognition", "text-to-speech"] },
  { id: "image", label: "Imagen y vídeo", icon: ImageIcon, color: "#c05bd6", modalities: ["image-generation", "video-generation"] },
  { id: "vision", label: "Visión", icon: Eye, color: "#e09a2b", modalities: ["vision"] },
  { id: "retrieval", label: "Embeddings y rerank", icon: Layers, color: "#2fb3a3", modalities: ["embeddings", "reranking"] },
];

const MODALITY_LABELS: Record<string, string> = {
  "text-generation": "Generación de texto",
  "automatic-speech-recognition": "Reconocimiento de voz",
  "text-to-speech": "Síntesis de voz",
  "image-generation": "Generación de imagen",
  "video-generation": "Generación de vídeo",
  vision: "Visión",
  embeddings: "Embeddings",
  reranking: "Reranking",
};

function benchmarkCategory(modality: string) {
  return BENCHMARK_CATEGORIES.find((category) => category.modalities.includes(modality)) ?? BENCHMARK_CATEGORIES[1];
}

function ModalityIcon({ modality, size }: { modality: string; size: number }) {
  return createElement(modality === "video-generation" ? Film : benchmarkCategory(modality).icon, { size });
}

type BenchmarkMetric = {
  key: string;
  label: string;
  hint: string;
  better: "higher" | "lower";
  value: (summary: Partial<BenchmarkSummary>) => number | null;
  format: (value: number) => string;
};

const finite = (value: unknown) => (value == null || !Number.isFinite(Number(value)) ? null : Number(value));
const pct = (value: unknown, scale = 1) => (finite(value) == null ? null : Number(value) * scale);
const fmtMs = (value: number) => (value >= 10_000 ? `${(value / 1000).toFixed(1)} s` : `${value.toFixed(0)} ms`);
const fmtPct = (value: number) => `${value.toFixed(value >= 99.95 || value === 0 ? 0 : 1)}%`;

const MODALITY_METRICS: Record<string, BenchmarkMetric[]> = {
  "text-generation": [
    { key: "tps", label: "Salida", hint: "Tokens generados por segundo · media", better: "higher", value: (s) => finite(s.output_tokens_per_second?.mean), format: (v) => `${v.toFixed(1)} tok/s` },
    { key: "ttft", label: "Primer token", hint: "TTFT p50 · menor es mejor", better: "lower", value: (s) => finite(s.ttft_ms?.p50), format: fmtMs },
    { key: "stability", label: "Estabilidad", hint: "Variación entre repeticiones", better: "higher", value: (s) => finite(s.score_dimensions?.stability), format: (v) => `${v.toFixed(0)}/100` },
    { key: "memory", label: "Memoria pico", hint: "Memoria unificada máxima durante el run", better: "lower", value: (s) => finite(s.resources?.max_memory_bytes), format: (v) => bytes(v) },
  ],
  "automatic-speech-recognition": [
    { key: "rtf", label: "Tiempo real", hint: "RTF: proceso / duración del audio · menor es mejor", better: "lower", value: (s) => finite(s.real_time_factor?.mean), format: (v) => `${v.toFixed(3)} RTF` },
    { key: "wer", label: "Error palabras", hint: "WER frente al fixture · menor es mejor", better: "lower", value: (s) => pct(s.word_error_rate, 100), format: fmtPct },
    { key: "cer", label: "Error caracteres", hint: "CER · menor es mejor", better: "lower", value: (s) => pct(s.character_error_rate, 100), format: fmtPct },
    { key: "latency", label: "Latencia p50", hint: "Tiempo total por audio", better: "lower", value: (s) => finite(s.total_ms?.p50), format: fmtMs },
  ],
  "text-to-speech": [
    { key: "rtf", label: "Tiempo real", hint: "RTF: síntesis / duración del audio · menor es mejor", better: "lower", value: (s) => finite(s.real_time_factor?.mean), format: (v) => `${v.toFixed(3)} RTF` },
    { key: "intelligibility", label: "Inteligibilidad", hint: "Round-trip con Whisper local", better: "higher", value: (s) => (s.intelligibility?.available ? pct(1 - Number(s.intelligibility.word_error_rate ?? 1), 100) : null), format: fmtPct },
    { key: "integrity", label: "Audio íntegro", hint: "WAV válido y decodificable", better: "higher", value: (s) => finite(s.audio_validation?.integrity_percent), format: fmtPct },
    { key: "latency", label: "Latencia p50", hint: "Tiempo total por frase", better: "lower", value: (s) => finite(s.total_ms?.p50), format: fmtMs },
  ],
  "image-generation": [
    { key: "seconds", label: "Generación", hint: "Tiempo total p50 · menor es mejor", better: "lower", value: (s) => finite(s.total_ms?.p50 ?? s.total_ms?.mean), format: fmtMs },
    { key: "repro", label: "Reproducible", hint: "Coincidencia de píxeles con semilla fija", better: "higher", value: (s) => finite(s.image_validation?.pixel_reproducibility_percent), format: fmtPct },
    { key: "png", label: "PNG íntegro", hint: "Imágenes válidas", better: "higher", value: (s) => finite(s.image_validation?.png_integrity_percent), format: fmtPct },
    { key: "resolution", label: "Resolución", hint: "Resolución esperada", better: "higher", value: (s) => finite(s.image_validation?.expected_resolution_percent), format: fmtPct },
  ],
  "video-generation": [
    { key: "seconds", label: "Generación", hint: "Tiempo total p50 · menor es mejor", better: "lower", value: (s) => finite(s.total_ms?.p50 ?? s.total_ms?.mean), format: fmtMs },
    { key: "repro", label: "Reproducible", hint: "Firma perceptual o exacta con semilla fija", better: "higher", value: (s) => finite(s.video_validation?.perceptual_reproducibility_percent ?? s.video_validation?.exact_reproducibility_percent), format: fmtPct },
    { key: "container", label: "Contenedor", hint: "Vídeo decodificable", better: "higher", value: (s) => finite(s.video_validation?.container_integrity_percent), format: fmtPct },
    { key: "size", label: "Tamaño medio", hint: "Tamaño del vídeo generado", better: "lower", value: (s) => finite(s.output_size_bytes?.mean), format: (v) => bytes(v) },
  ],
  vision: [
    { key: "latency", label: "Latencia p50", hint: "Tiempo total · menor es mejor", better: "lower", value: (s) => finite(s.total_ms?.p50), format: fmtMs },
    { key: "recall", label: "Conceptos", hint: "Recall de conceptos visuales esperados", better: "higher", value: (s) => pct(s.vision_quality?.normalized_concept_recall, 100), format: fmtPct },
    { key: "reliability", label: "Fiabilidad", hint: "Muestras válidas", better: "higher", value: (s) => finite(s.reliability_percent), format: fmtPct },
    { key: "tps", label: "Salida", hint: "Tokens por segundo", better: "higher", value: (s) => finite(s.output_tokens_per_second?.mean), format: (v) => `${v.toFixed(1)} tok/s` },
  ],
  embeddings: [
    { key: "items", label: "Throughput", hint: "Elementos vectorizados por segundo", better: "higher", value: (s) => finite(s.items_per_second?.mean), format: (v) => `${v.toFixed(1)}/s` },
    { key: "pairs", label: "Calidad", hint: "Pares positivos separados de negativos", better: "higher", value: (s) => pct(s.semantic_quality?.pair_accuracy, 100), format: fmtPct },
    { key: "margin", label: "Margen", hint: "Margen semántico medio", better: "higher", value: (s) => finite(s.semantic_quality?.mean_margin), format: (v) => v.toFixed(3) },
    { key: "latency", label: "Latencia p50", hint: "Tiempo total", better: "lower", value: (s) => finite(s.total_ms?.p50), format: fmtMs },
  ],
  reranking: [
    { key: "ndcg", label: "NDCG", hint: "Calidad de ordenación", better: "higher", value: (s) => pct(s.ranking_quality?.ndcg_mean, 100), format: fmtPct },
    { key: "latency", label: "Latencia p50", hint: "Tiempo total · menor es mejor", better: "lower", value: (s) => finite(s.total_ms?.p50), format: fmtMs },
    { key: "mrr", label: "MRR", hint: "Primer resultado relevante", better: "higher", value: (s) => pct(s.ranking_quality?.mrr_mean, 100), format: fmtPct },
    { key: "reliability", label: "Fiabilidad", hint: "Muestras válidas", better: "higher", value: (s) => finite(s.reliability_percent), format: fmtPct },
  ],
};

function benchmarkMetrics(modality: string) {
  return MODALITY_METRICS[modality] ?? MODALITY_METRICS["text-generation"];
}

function metricRelative(metric: BenchmarkMetric, value: number | null, peers: Array<number | null>) {
  const values = peers.filter((item): item is number => item != null && item > 0);
  if (value == null || !values.length) return null;
  if (metric.better === "higher") return Math.max(0.04, value / Math.max(...values));
  return value <= 0 ? 1 : Math.max(0.04, Math.min(...values) / value);
}

function shortModelName(run: BenchmarkRun) {
  return (run.model_info?.name || run.source_id.split("/").pop() || run.source_id).replace(/^ARTIFEX · /, "");
}

function parameterLabel(info?: BenchmarkModelInfo) {
  if (!info?.parameters_b) return "";
  const total = info.parameters_b >= 1 ? `${info.parameters_b}B` : `${Math.round(info.parameters_b * 1000)}M`;
  return info.active_parameters_b ? `${total} · ${info.active_parameters_b}B activos` : total;
}

function compactCount(value?: number | null) {
  if (!value) return "";
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

const BenchmarkModalityCharts = memo(BenchmarkModalityChartsView, (previous, next) =>
  previous.modality === next.modality
  && previous.runs.length === next.runs.length
  && previous.runs.every((run, index) => run.id === next.runs[index].id && run.score === next.runs[index].score));

function BenchmarkModalityChartsView({ modality, runs }: { modality: string; runs: BenchmarkRun[] }) {
  const metrics = benchmarkMetrics(modality);
  const [primary, secondary] = metrics;
  const color = benchmarkCategory(modality).color;
  const rows = runs.map((run) => ({
    name: shortModelName(run).slice(0, 28),
    score: Math.round(Number(run.score ?? run.summary.score ?? 0)),
    primary: primary.value(run.summary),
    secondary: secondary.value(run.summary),
    size: Number(run.artifact_size || 0) / 1024 ** 3,
  }));
  const ranked = (key: "score" | "primary" | "secondary", better: "higher" | "lower") => rows
    .filter((row) => row[key] != null)
    .sort((a, b) => (better === "higher" ? Number(b[key]) - Number(a[key]) : Number(a[key]) - Number(b[key])));
  const height = (count: number) => Math.max(140, 34 * count + 40);
  const bar = (key: "score" | "primary" | "secondary", title: string, hint: string, better: "higher" | "lower", format: (value: number) => string, fill: string) => {
    const data = ranked(key, better);
    return <Card className="benchmark-chart">
      <div><strong>{title}</strong><small>{hint}</small></div>
      {data.length ? <ResponsiveContainer width="100%" height={height(data.length)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 70, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="var(--border)" horizontal={false} />
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12, fill: "var(--text-secondary)" }} />
          <Tooltip formatter={(value) => format(Number(value))} cursor={{ fill: "var(--surface-soft)" }} />
          <Bar dataKey={key} radius={[0, 6, 6, 0]} barSize={18} isAnimationActive={false}>
            {data.map((row, index) => <Cell key={row.name} fill={fill} fillOpacity={index === 0 ? 1 : 0.55} />)}
            <LabelList dataKey={key} position="right" formatter={(value: unknown) => format(Number(value))} style={{ fontSize: 12, fill: "var(--text-secondary)" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer> : <small className="benchmark-chart-empty">Sin datos medidos</small>}
    </Card>;
  };
  const scatter = rows.filter((row) => row.primary != null && row.secondary != null);
  return <section className="benchmark-modality">
    <header>
      <span className="benchmark-modality-icon" style={{ "--category": color } as CSSProperties}><ModalityIcon modality={modality} size={17} /></span>
      <strong>{MODALITY_LABELS[modality] ?? modality}</strong>
      <small>{runs.length} modelo{runs.length === 1 ? "" : "s"} · último resultado válido por artefacto</small>
    </header>
    <div className="benchmark-chart-grid three">
      {bar("score", "Ranking", "Score MyDGX /100 · mayor es mejor", "higher", (value) => `${value.toFixed(0)}`, color)}
      {bar("primary", primary.label, primary.hint, primary.better, primary.format, color)}
      {bar("secondary", secondary.label, secondary.hint, secondary.better, secondary.format, "var(--blue)")}
    </div>
    {scatter.length >= 2 && <Card className="benchmark-chart">
      <div><strong>{primary.label} frente a {secondary.label.toLowerCase()}</strong><small>Cada burbuja es un modelo; su tamaño es el peso en disco. Mejor: {primary.better === "higher" ? "derecha" : "izquierda"} y {secondary.better === "higher" ? "arriba" : "abajo"}.</small></div>
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ top: 12, right: 24, left: 4, bottom: 12 }}>
          <CartesianGrid stroke="var(--border)" />
          <XAxis type="number" dataKey="primary" name={primary.label} tickFormatter={(value) => primary.format(Number(value))} tick={{ fontSize: 11 }} />
          <YAxis type="number" dataKey="secondary" name={secondary.label} tickFormatter={(value) => secondary.format(Number(value))} width={70} tick={{ fontSize: 11 }} />
          <ZAxis type="number" dataKey="size" range={[60, 600]} name="GB" />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
            const row = payload?.[0]?.payload as typeof rows[number] | undefined;
            return row ? <div className="benchmark-tooltip"><strong>{row.name}</strong><span>{primary.label}: {primary.format(Number(row.primary))}</span><span>{secondary.label}: {secondary.format(Number(row.secondary))}</span><span>Disco: {row.size.toFixed(1)} GB · score {row.score}</span></div> : null;
          }} />
          <Scatter data={scatter} fill={color} fillOpacity={0.7} isAnimationActive={false}>
            <LabelList dataKey="name" position="top" style={{ fontSize: 11, fill: "var(--text-secondary)" }} />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </Card>}
  </section>;
}

function BenchmarkModelCard({
  run, runs, modality, peers, active, rerunning, detailLoading, onRerun, onOpen, onExport, onOpenRun,
}: {
  run: BenchmarkRun;
  runs: BenchmarkRun[];
  modality: string;
  peers: BenchmarkRun[];
  active: boolean;
  rerunning: boolean;
  detailLoading: boolean;
  onRerun: () => void;
  onOpen: () => void;
  onExport: () => void;
  onOpenRun: (id: string) => void;
}) {
  const info = run.model_info;
  const category = benchmarkCategory(modality);
  const score = Number(run.score ?? run.summary.score ?? 0);
  const metrics = benchmarkMetrics(modality);
  const history = runs.filter((item) => item.id !== run.id);
  const trend = [...runs].filter((item) => item.valid && item.score != null).reverse()
    .map((item) => ({ date: new Date(item.created_at).toLocaleDateString(), score: Math.round(Number(item.score)) }));
  const facts = [
    { label: "Tamaño", value: bytes(run.artifact_size) },
    { label: "Parámetros", value: parameterLabel(info) },
    { label: "Cuantización", value: run.quantization },
    { label: "Arquitectura", value: run.architecture },
    { label: "Memoria estimada", value: info?.estimated_memory_mb ? bytes(info.estimated_memory_mb * 1024 * 1024) : "" },
    { label: "Licencia", value: info?.license },
    { label: "Idiomas", value: info?.languages.slice(0, 4).join(", ") },
    { label: "Modelo base", value: info?.base_model },
  ].filter((fact) => fact.value);
  return <Card className={`benchmark-model-card-v2 ${run.valid ? "" : "invalid"}`} >
    <div className="bmc-hero" style={{ "--category": category.color } as CSSProperties}>
      <span className="bmc-icon"><ModalityIcon modality={modality} size={22} /></span>
      <div className="bmc-title">
        <span className="bmc-kicker">{MODALITY_LABELS[modality] ?? modality}{info?.author ? ` · ${info.author}` : ""}</span>
        <strong title={run.source_id}>{shortModelName(run)}</strong>
        <div className="bmc-badges">
          <span className={`badge ${run.valid ? "live" : ""}`}>{run.valid ? "Válido" : run.status}</span>
          {run.summary.score_provisional ? <span className="badge" title="Con una sola repetición no se puede medir la estabilidad">Provisional</span> : null}
          {parameterLabel(info) && <span className="badge">{parameterLabel(info)}</span>}
          {run.quantization && <span className="badge">{run.quantization}</span>}
          {run.imported ? <span className="badge">Importado</span> : null}
          {runs.length > 1 && <span className="badge">{runs.length} runs</span>}
        </div>
      </div>
      <div className="benchmark-score bmc-score" style={{ "--score": `${score * 3.6}deg`, "--category": category.color } as CSSProperties}>
        <strong>{Math.round(score)}</strong><small>/100</small>
      </div>
    </div>
    {info?.summary && <p className="bmc-summary">{info.summary}</p>}
    <div className="bmc-metrics">
      {metrics.map((metric) => {
        const value = metric.value(run.summary);
        const relative = metricRelative(metric, value, peers.map((peer) => metric.value(peer.summary)));
        return <div key={metric.key} title={metric.hint}>
          <small>{metric.label}</small>
          <strong>{value == null ? "—" : metric.format(value)}</strong>
          <span className="bmc-meter"><i style={{ width: `${(relative ?? 0) * 100}%`, background: category.color }} /></span>
          <em>{relative == null ? "sin comparación" : relative >= 0.999 ? "mejor de su categoría" : `${Math.round(relative * 100)}% del mejor`}</em>
        </div>;
      })}
    </div>
    <div className="bmc-body">
      <dl className="bmc-facts">
        {facts.map((fact) => <span key={fact.label}><dt>{fact.label}</dt><dd title={String(fact.value)}>{fact.value}</dd></span>)}
      </dl>
      {trend.length > 1 && <div className="bmc-trend">
        <small>Evolución del score</small>
        <ResponsiveContainer width="100%" height={56}>
          <AreaChart data={trend} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
            <Tooltip formatter={(value) => [`${value}/100`, "Score"]} labelFormatter={(label) => String(label)} />
            <Area type="monotone" dataKey="score" stroke={category.color} fill={category.color} fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>}
    </div>
    {(info?.tags.length || info?.downloads || info?.pipeline_tag) ? <div className="bmc-tags">
      {info?.pipeline_tag && <span className="bmc-tag strong">{info.pipeline_tag}</span>}
      {info?.tags.slice(0, 6).map((tag) => <span className="bmc-tag" key={tag}>{tag}</span>)}
      {info?.downloads ? <span className="bmc-tag"><Download size={11} /> {compactCount(info.downloads)}</span> : null}
      {info?.likes ? <span className="bmc-tag"><Star size={11} /> {compactCount(info.likes)}</span> : null}
    </div> : null}
    {!run.valid && <em className="bmc-invalid">{run.invalid_reason || "Resultado excluido de comparativas"}</em>}
    <div className="bmc-footer">
      <small>{run.protocol_name} · {new Date(run.created_at).toLocaleString()} · {run.artifact_hash.slice(0, 10)}…</small>
      <div className="benchmark-run-actions">
        <button className="icon-button" disabled={active || rerunning} title="Ejecutar de nuevo y conservar el histórico" aria-label={`Volver a ejecutar benchmark de ${run.source_id}`} onClick={onRerun}><RefreshCw className={rerunning ? "spin" : ""} size={15} /></button>
        <button className="button secondary" disabled={detailLoading} onClick={onOpen}><Info size={14} /> Ficha completa</button>
        <button className="icon-button" aria-label="Exportar benchmark" onClick={onExport}><Download size={15} /></button>
      </div>
    </div>
    {history.length > 0 && <details className="benchmark-history">
      <summary>Histórico del artefacto ({history.length})</summary>
      {history.map((item) => <button key={item.id} type="button" onClick={() => onOpenRun(item.id)}>
        <span>{new Date(item.created_at).toLocaleString()}</span>
        <span>{item.valid ? `${Math.round(Number(item.score ?? 0))}/100` : item.status}</span>
        <span>{(() => { const value = metrics[0].value(item.summary); return value == null ? "—" : metrics[0].format(value); })()}</span>
        <span>{item.runtime_hash.slice(0, 8)}</span>
      </button>)}
    </details>}
  </Card>;
}

function BenchmarksView({ jobs, notify }: { jobs: Job[]; notify: (message: string, error?: boolean) => void }) {
  const [data, setData] = useState<BenchmarksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [repetitions, setRepetitions] = useState(3);
  const [strictIsolation, setStrictIsolation] = useState(true);
  const [detail, setDetail] = useState<BenchmarkDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rerunningArtifact, setRerunningArtifact] = useState("");
  const [suiteAction, setSuiteAction] = useState<"starting" | "stopping" | "">("");
  const [comparisonKey, setComparisonKey] = useState("");
  const [benchCategory, setBenchCategory] = useState<BenchmarkCategoryId>("all");
  const [benchSort, setBenchSort] = useState<"score" | "recent" | "name">("score");
  const [benchSearch, setBenchSearch] = useState("");
  const [selectedCandidateKeys, setSelectedCandidateKeys] = useState<Set<string>>(new Set());
  const knownCandidateKeys = useRef<Set<string>>(new Set());
  const knownCandidateCompletion = useRef<Map<string, boolean>>(new Map());
  const selectionTouched = useRef(false);
  const [suiteInventoryOpen, setSuiteInventoryOpen] = useState(true);
  const benchmarkJobs = jobs.filter((job) => job.kind === "benchmark.run").slice(0, 8);

  const load = useCallback(async () => {
    try {
      const response = await api<BenchmarksResponse>("/api/benchmarks");
      setData(response);
      const runnable = new Map(
        response.suite_candidates.map((item) => [item.candidate_key, item.runnable !== false]),
      );
      const completion = new Map(
        response.suite_candidates.map((item) => [item.candidate_key, Boolean(item.suite_completed)]),
      );
      const pendingKeys = [...completion]
        .filter(([key, completed]) => !completed && runnable.get(key))
        .map(([key]) => key);
      const previousKeys = knownCandidateKeys.current;
      const previousCompletion = knownCandidateCompletion.current;
      const touched = selectionTouched.current;
      knownCandidateKeys.current = new Set(completion.keys());
      knownCandidateCompletion.current = completion;
      setSelectedCandidateKeys((current) => {
        if (!touched) return new Set(pendingKeys);
        const kept = [...current].filter((key) => (
          runnable.get(key) === true
          && !(completion.get(key) && previousCompletion.get(key) === false)
        ));
        return new Set([...kept, ...pendingKeys.filter((key) => !previousKeys.has(key))]);
      });
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    const timer = window.setInterval(load, data?.active ? 2000 : 10_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [data?.active, load]);

  useEffect(() => {
    if (!detail) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
    };
  }, [detail]);

  async function rerunBenchmark(run: BenchmarkRun) {
    if (!window.confirm(
      `Se volverá a ejecutar el benchmark de ${run.source_id}. El resultado anterior se conservará `
      + "en el histórico y la inferencia quedará pausada durante la medición. ¿Continuar?",
    )) return;
    setRerunningArtifact(run.artifact_hash);
    try {
      await api("/api/benchmarks/runs", {
        method: "POST",
        body: JSON.stringify({
          target: run.target,
          protocol_id: run.protocol_id,
          repetitions,
          strict_isolation: strictIsolation,
        }),
      });
      notify(`Nuevo benchmark encolado: ${run.source_id}`);
      await load();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setRerunningArtifact("");
    }
  }

  async function startSuite() {
    if (!data) return;
    const selectedCandidates = data.suite_candidates.filter(
      (item) => item.runnable !== false && selectedCandidateKeys.has(item.candidate_key),
    );
    if (!selectedCandidates.length) return;
    const totalSize = selectedCandidates.reduce(
      (total, item) => total + Number(item.artifact_size || 0),
      0,
    );
    const confirmed = window.confirm(
      `La suite medirá ${selectedCandidates.length} modelo(s) (${bytes(totalSize)} en disco). `
      + "Puede tardar muchas horas. Durante todo el proceso el chat, el gateway y los perfiles "
      + "no estarán disponibles. MyDGX descargará todos los modelos de memoria, medirá uno por "
      + "uno y restaurará el estado actual al terminar o al detener la suite. ¿Continuar?",
    );
    if (!confirmed) return;
    setSuiteAction("starting");
    try {
      await api("/api/benchmarks/suite", {
        method: "POST",
        body: JSON.stringify({
          repetitions,
          candidate_keys: selectedCandidates.map((item) => item.candidate_key),
        }),
      });
      notify("Suite de benchmarks iniciada");
      await load();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setSuiteAction("");
    }
  }

  async function stopSuite() {
    if (!data?.suite) return;
    if (!window.confirm(
      "Se detendrá la muestra actual y MyDGX restaurará los perfiles y modelos que estaban "
      + "cargados antes de empezar. La restauración puede tardar unos minutos. ¿Detener la suite?",
    )) return;
    setSuiteAction("stopping");
    try {
      await api(`/api/benchmarks/suite/${data.suite.id}/stop`, { method: "POST" });
      notify("Detención solicitada; restaurando el estado anterior");
      await load();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setSuiteAction("");
    }
  }

  async function skipQueueEntry(entryId: string) {
    try {
      await api(`/api/benchmarks/queue/${entryId}/skip`, { method: "POST" });
      notify("Benchmark automático descartado");
      await load();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function cancelRun(jobId: string) {
    try {
      await api(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      notify("Cancelación solicitada");
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function openRun(runId: string) {
    setDetailLoading(true);
    try {
      setDetail(await api<BenchmarkDetail>(`/api/benchmarks/runs/${runId}`));
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setDetailLoading(false);
    }
  }

  async function exportRun(runId: string) {
    try {
      const bundle = await api<Record<string, unknown>>(`/api/benchmarks/runs/${runId}/export`);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `mydgx-benchmark-${runId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      notify("Benchmark exportado");
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function importRun(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("El bundle supera 10 MiB");
      const bundle = JSON.parse(await file.text()) as Record<string, unknown>;
      const result = await api<{ imported: boolean; duplicate: boolean }>("/api/benchmarks/import", {
        method: "POST",
        body: JSON.stringify({ bundle }),
      });
      notify(result.duplicate ? "El benchmark ya existía" : "Benchmark importado");
      await load();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  if (loading && !data) return <Loading label="Cargando benchmarks" />;
  if (!data) return <Empty icon={<Gauge />} title="Benchmarks no disponibles" text="No se pudo consultar la base de benchmarks." />;

  const modalityOf = (run: BenchmarkRun) => data.protocols.find((protocol) => protocol.id === run.protocol_id)?.modality ?? "text-generation";
  const validRuns = data.runs.filter((run) => run.status === "completed" && run.valid);
  const groupKey = (run: BenchmarkRun) => `${run.environment_hash}|${run.score_algorithm}`;
  const comparisonGroups = Array.from(validRuns.reduce((groups, run) => {
    const key = groupKey(run);
    const current = groups.get(key);
    if (current) current.count += 1;
    else groups.set(key, {
      key,
      count: 1,
      label: `${String(run.hardware.device_model || run.hardware.product_name || "Equipo")} · ${run.environment_hash.slice(0, 8)} · ${run.score_algorithm}`,
    });
    return groups;
  }, new Map<string, { key: string; count: number; label: string }>()).values());
  const selectedComparison = comparisonGroups.some((group) => group.key === comparisonKey)
    ? comparisonKey
    : (validRuns[0] ? groupKey(validRuns[0]) : "");
  const comparableByModality = new Map<string, BenchmarkRun[]>();
  for (const run of validRuns.filter((item) => groupKey(item) === selectedComparison)) {
    const modality = modalityOf(run);
    const items = comparableByModality.get(modality) ?? [];
    const protocolId = items[0]?.protocol_id ?? run.protocol_id;
    if (run.protocol_id === protocolId && !items.some((item) => item.artifact_hash === run.artifact_hash)) items.push(run);
    comparableByModality.set(modality, items);
  }
  const artifactGroups = Array.from(data.runs.reduce((groups, run) => {
    const runs = groups.get(run.artifact_hash) ?? [];
    runs.push(run);
    groups.set(run.artifact_hash, runs);
    return groups;
  }, new Map<string, BenchmarkRun[]>()).values()).map((runs) => {
    const run = runs.find((item) => item.status === "completed" && item.valid) ?? runs[0];
    return { runs, run, modality: modalityOf(run) };
  });
  const categoryCounts = Object.fromEntries(BENCHMARK_CATEGORIES.map((category) => [
    category.id,
    category.id === "all" ? artifactGroups.length : artifactGroups.filter((group) => category.modalities.includes(group.modality)).length,
  ])) as Record<BenchmarkCategoryId, number>;
  const activeCategory = BENCHMARK_CATEGORIES.find((category) => category.id === benchCategory) ?? BENCHMARK_CATEGORIES[0];
  const inCategory = (modality: string) => activeCategory.id === "all" || activeCategory.modalities.includes(modality);
  const modalityOrder = BENCHMARK_CATEGORIES.flatMap((category) => category.modalities);
  const chartModalities = modalityOrder.filter((modality) => inCategory(modality) && (comparableByModality.get(modality)?.length ?? 0) > 0);
  const searchTerms = benchSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matchesSearch = ({ run, modality }: { run: BenchmarkRun; modality: string }) => {
    if (!searchTerms.length) return true;
    const info = run.model_info;
    const haystack = [
      run.source_id, run.filename, run.quantization, run.architecture, run.source, run.protocol_name,
      MODALITY_LABELS[modality], info?.name, info?.author, info?.license, info?.base_model, info?.pipeline_tag,
      parameterLabel(info), ...(info?.tags ?? []), ...(info?.languages ?? []),
    ].filter(Boolean).join(" ").toLowerCase();
    return searchTerms.every((term) => haystack.includes(term));
  };
  const visibleGroups = artifactGroups
    .filter((group) => inCategory(group.modality) && matchesSearch(group))
    .sort((a, b) => {
      if (benchSort === "name") return shortModelName(a.run).localeCompare(shortModelName(b.run));
      if (benchSort === "recent") return b.run.created_at.localeCompare(a.run.created_at);
      return modalityOrder.indexOf(a.modality) - modalityOrder.indexOf(b.modality)
        || Number(b.run.valid) - Number(a.run.valid)
        || Number(b.run.score ?? 0) - Number(a.run.score ?? 0);
    });
  const pendingQueue = data.queue.filter((entry) => entry.status === "pending" || entry.status === "running");
  const activeJob = benchmarkJobs.find((job) => activeJobStatuses.has(job.status));
  const activeSuite = data.suite && ["queued", "running", "restoring"].includes(data.suite.status)
    ? data.suite
    : null;
  const suiteJob = activeSuite
    ? jobs.find((job) => job.id === activeSuite.job_id)
    : undefined;
  const selectableCandidates = data.suite_candidates.filter((item) => item.runnable !== false);
  const selectedSuiteCandidates = selectableCandidates.filter(
    (item) => selectedCandidateKeys.has(item.candidate_key),
  );
  const pendingSuiteCount = selectableCandidates.filter((item) => !item.suite_completed).length;
  const blockedSuiteCount = data.suite_candidates.length - selectableCandidates.length;
  const suiteInventory = activeSuite?.items ?? data.suite_candidates;
  const suiteTotalSize = (activeSuite ? suiteInventory : selectedSuiteCandidates).reduce(
    (total, item) => total + Number(item.artifact_size || 0),
    0,
  );
  const suiteHasEstimatedSize = !activeSuite && selectedSuiteCandidates.some(
    (item) => item.artifact_size_estimated,
  );
  const suiteProgress = suiteJob?.progress
    ?? (activeSuite
      ? activeSuite.completed_models / Math.max(1, activeSuite.total_models) * 100
      : 0);
  const currentSuiteItem = activeSuite?.items.find(
    (item) => item.position === activeSuite.current_position,
  );
  const latestSuite = !activeSuite ? data.suite_history[0] : null;
  const latestSuiteCompleted = latestSuite?.items.filter((item) => item.status === "completed") ?? [];
  const latestSuiteFailed = latestSuite?.items.filter((item) => item.status === "failed") ?? [];
  const latestSuiteCancelled = latestSuite?.items.filter((item) => item.status === "cancelled") ?? [];
  const latestSuiteSkipped = latestSuite?.items.filter((item) => item.status === "skipped") ?? [];
  const detailModality = data.protocols.find(
    (protocol) => protocol.id === detail?.protocol_id,
  )?.modality ?? "text-generation";

  return (
    <div className="view-stack benchmarks-view">
      <SectionHeading
        eyebrow="MEDICIÓN REPRODUCIBLE"
        title="Benchmarks"
        action={<button className="icon-button" onClick={() => void load()} aria-label="Actualizar benchmarks"><RefreshCw size={16} /></button>}
      />

      <Card className="benchmark-explainer">
        <div className="bx-hero">
          <div className="bx-hero-icon"><Gauge size={26} /></div>
          <div>
            <span className="card-kicker">QUÉ HACE ESTE MENÚ</span>
            <h3>Mide cada modelo del DGX con el mismo protocolo y te dice cuál rinde mejor en esta máquina</h3>
            <p>
              No son cifras de catálogo: cada número sale de ejecutar el modelo aquí, aislado, con pruebas
              versionadas por tipo de tarea. Los resultados se guardan para siempre y solo se comparan
              entre sí cuando el hardware, el protocolo y el algoritmo de score coinciden.
            </p>
          </div>
          <div className="bx-status">
            <span className={data.active ? "running" : "idle"}><Activity size={13} /> {data.active ? "Benchmark en curso" : "Runner disponible"}</span>
            <span><Zap size={13} /> {data.auto_new_models ? `Auto con modelos nuevos · calma ${data.quiet_seconds}s` : "Automático desactivado"}</span>
            <span><ShieldCheck size={13} /> Protocolo v{data.protocols.find((protocol) => protocol.active)?.version ?? "—"}</span>
          </div>
        </div>

        <ol className="bx-steps">
          {[
            { icon: Boxes, title: "Elige", text: "Selecciona en la suite los modelos pendientes o vuelve a medir uno desde su ficha." },
            { icon: Cpu, title: "Aísla", text: "Libera la memoria, carga solo ese modelo y hace un calentamiento que no cuenta." },
            { icon: Activity, title: "Mide", text: "Repite las pruebas sin tráfico concurrente y registra velocidad, calidad, memoria y potencia." },
            { icon: Trophy, title: "Compara", text: "Calcula un score sobre 100, lo ordena por categoría y conserva todo el histórico." },
          ].map((step, index) => <li key={step.title}>
            <span className="bx-step-num">{index + 1}</span>
            <span className="bx-step-icon"><step.icon size={18} /></span>
            <strong>{step.title}</strong>
            <small>{step.text}</small>
          </li>)}
        </ol>

        <div className="bx-modalities">
          {[
            { category: "text", title: "Texto", metrics: "tok/s · primer token · estabilidad" },
            { category: "voice", title: "Voz", metrics: "tiempo real (RTF) · error de palabras · inteligibilidad" },
            { category: "image", title: "Imagen y vídeo", metrics: "tiempo de generación · integridad · reproducibilidad" },
            { category: "vision", title: "Visión", metrics: "latencia · conceptos reconocidos" },
            { category: "retrieval", title: "Embeddings y rerank", metrics: "elementos/s · calidad semántica · NDCG" },
          ].map((item) => {
            const category = BENCHMARK_CATEGORIES.find((entry) => entry.id === item.category) ?? BENCHMARK_CATEGORIES[0];
            const Icon = category.icon;
            return <div key={item.category} style={{ "--category": category.color } as CSSProperties}>
              <span className="bx-mod-icon"><Icon size={16} /></span>
              <span><strong>{item.title}</strong><small>{item.metrics}</small></span>
            </div>;
          })}
        </div>

        <div className="benchmark-policy bx-policy">
          <span><ShieldCheck size={13} /> Una petición a la vez</span>
          <span><Database size={13} /> Histórico append-only, nada se sobrescribe</span>
          <span><RefreshCw size={13} /> Restaura perfiles y modelos al terminar o cancelar</span>
          <span><Download size={13} /> Exporta e importa resultados en JSON</span>
        </div>
      </Card>

      <Card className={`benchmark-pipeline ${activeSuite ? "is-running" : ""}`}>
        <div className="benchmark-pipeline-hero">
          <div className="benchmark-pipeline-icon"><Boxes size={25} /></div>
          <div>
            <span className="card-kicker">SUITE MULTIMODAL SECUENCIAL · LARGA DURACIÓN</span>
            <h3>Completar benchmarks pendientes</h3>
            <p>
              Descarga todos los modelos de memoria y mide cada artefacto local con su protocolo:
              texto, reconocimiento de voz o generación de imagen. Entre modelos libera la RAM.
            </p>
          </div>
          <div className="benchmark-pipeline-stat">
            <strong>{activeSuite ? `${activeSuite.completed_models}/${activeSuite.total_models}` : selectedSuiteCandidates.length}</strong>
            <small>{activeSuite ? "modelos procesados" : `seleccionados · ${pendingSuiteCount} pendientes`}</small>
            <span>{suiteHasEstimatedSize ? "≈ " : ""}{bytes(suiteTotalSize)}{suiteHasEstimatedSize ? " (incluye estimaciones)" : " en disco"}</span>
          </div>
        </div>

        <div className="benchmark-pipeline-warning">
          <TriangleAlert size={19} />
          <div>
            <strong>Puede tardar muchas horas y deja temporalmente el sistema sin inferencia</strong>
            <span>
              Chat, asistente, perfiles, OpenAI Gateway y Open WebUI no podrán usar modelos
              durante la suite. Puedes detenerla en cualquier momento: MyDGX cancela la muestra
              actual y restaura automáticamente los perfiles y modelos residentes anteriores.
            </span>
          </div>
        </div>

        {activeSuite && <div className="benchmark-pipeline-progress">
          <div>
            <span>
              <RefreshCw size={15} className={activeSuite.status !== "restoring" ? "spin" : ""} />
              <strong>
                {activeSuite.status === "restoring"
                  ? "Restaurando el estado anterior"
                  : currentSuiteItem
                    ? `Midiendo ${currentSuiteItem.model_name}`
                    : "Preparando la suite"}
              </strong>
            </span>
            <b>{Math.round(suiteProgress)}%</b>
          </div>
          <div className="benchmark-pipeline-track">
            <span style={{ width: `${Math.max(1, suiteProgress)}%` }} />
          </div>
          <small>{suiteJob?.message || "Liberando memoria y preparando el siguiente modelo"}</small>
        </div>}

        <details
          className="benchmark-pipeline-models"
          open={Boolean(activeSuite) || suiteInventoryOpen}
          onToggle={(event) => {
            if (!activeSuite) setSuiteInventoryOpen(event.currentTarget.open);
          }}
        >
          <summary>
            <span className="benchmark-pipeline-models-toggle">
              <ChevronRight className={Boolean(activeSuite) || suiteInventoryOpen ? "is-open" : ""} size={15} />
              {Boolean(activeSuite) || suiteInventoryOpen
                ? "Ocultar modelos"
                : `Mostrar ${suiteInventory.length} modelos`}
            </span>
            <small>{activeSuite ? suiteInventory.length : selectedSuiteCandidates.length} de {suiteInventory.length} · {suiteHasEstimatedSize ? "≈ " : ""}{bytes(suiteTotalSize)}</small>
          </summary>
          <div>
            {!activeSuite && suiteInventory.length > 0 && <div className="benchmark-pipeline-selection">
              <span>
                {selectedSuiteCandidates.length} seleccionados · {pendingSuiteCount} pendientes
                {blockedSuiteCount ? ` · ${blockedSuiteCount} sin runtime activo` : ""}
              </span>
              <div>
                <button type="button" onClick={() => {
                  selectionTouched.current = true;
                  setSelectedCandidateKeys(new Set(
                    selectableCandidates.filter((item) => !item.suite_completed).map((item) => item.candidate_key),
                  ));
                }}>Pendientes</button>
                <button type="button" onClick={() => {
                  selectionTouched.current = true;
                  setSelectedCandidateKeys(new Set(selectableCandidates.map((item) => item.candidate_key)));
                }}>Seleccionar todo</button>
                <button type="button" onClick={() => {
                  selectionTouched.current = true;
                  setSelectedCandidateKeys(new Set());
                }}>Ninguno</button>
              </div>
            </div>}
            {suiteInventory.length ? suiteInventory.map((item) => {
              const status = "status" in item ? item.status : "pending";
              const blocked = "runnable" in item && item.runnable === false;
              const completedBefore = "suite_completed" in item && Boolean(item.suite_completed);
              return <div
                className={`benchmark-pipeline-model status-${status}${blocked ? " is-blocked" : ""}${completedBefore ? " is-done" : ""}`}
                key={item.candidate_key}
              >
                {"position" in item
                  ? <span className="benchmark-pipeline-model-order">{item.position}</span>
                  : <label
                      className="benchmark-pipeline-model-check"
                      title={blocked ? item.blocked_reason : `Incluir ${item.name}`}
                    >
                      <input
                        type="checkbox"
                        disabled={blocked}
                        checked={!blocked && selectedCandidateKeys.has(item.candidate_key)}
                        onChange={(event) => {
                          selectionTouched.current = true;
                          const checked = event.target.checked;
                          setSelectedCandidateKeys((current) => {
                            const next = new Set(current);
                            if (checked) next.add(item.candidate_key);
                            else next.delete(item.candidate_key);
                            return next;
                          });
                        }}
                        aria-label={`Incluir ${item.name} en la suite`}
                      />
                    </label>}
                <span>
                  <strong>
                    {"model_name" in item ? item.model_name : item.name}
                    {"variant" in item && item.variant ? <i> · {item.variant}</i> : null}
                  </strong>
                  <small>
                    {item.engine} · {item.modality} · {item.artifact_hash.slice(0, 10)}…
                    {"measured" in item && item.measured ? " · benchmark individual existente" : ""}
                  </small>
                  {blocked && <small className="benchmark-pipeline-model-blocked">
                    <TriangleAlert size={11} /> {item.blocked_reason}
                  </small>}
                </span>
                <b title={"artifact_size_estimated" in item && item.artifact_size_estimated
                  ? "Estimación de memoria del perfil; el archivo de pesos no está declarado"
                  : "Tamaño exacto de los artefactos locales"}>
                  {"artifact_size_estimated" in item && item.artifact_size_estimated ? "≈ " : ""}
                  {bytes(item.artifact_size)}
                </b>
                <em>
                  {status === "completed" ? "Completado"
                    : status === "running" ? "Midiendo"
                      : status === "loading" ? "Cargando"
                        : status === "failed" ? "Falló"
                          : status === "cancelled" ? "Cancelado"
                            : status === "skipped" ? "Omitido"
                              : blocked ? "No disponible"
                                : completedBefore ? "Ya medido"
                                  : "Pendiente"}
                </em>
              </div>;
            }) : <div className="benchmark-pipeline-empty"><CheckCircle2 size={18} /> Todos los modelos locales elegibles ya completaron la suite.</div>}
          </div>
        </details>

        {latestSuite && <details className="benchmark-pipeline-result">
          <summary>
            <span>
              {latestSuiteFailed.length || latestSuiteCancelled.length
                ? <TriangleAlert size={16} />
                : <CheckCircle2 size={16} />}
              <strong>Última ejecución</strong>
            </span>
            <small>
              {latestSuiteCompleted.length} correctos · {latestSuiteFailed.length} fallidos
              {latestSuiteSkipped.length ? ` · ${latestSuiteSkipped.length} omitidos` : ""}
              {latestSuiteCancelled.length ? ` · ${latestSuiteCancelled.length} cancelados` : ""}
            </small>
          </summary>
          <div>
            {latestSuite.items.map((item) => <div className={`benchmark-pipeline-result-row status-${item.status}`} key={item.candidate_key}>
              <span>
                <strong>{item.model_name}</strong>
                <small>{item.engine} · {item.modality}{item.error ? ` · ${item.error}` : ""}</small>
              </span>
              <em>
                {item.status === "completed" ? "Correcto"
                  : item.status === "failed" ? "Falló"
                    : item.status === "skipped" ? "Omitido"
                      : item.status === "cancelled" ? "Cancelado"
                        : "Pendiente"}
              </em>
            </div>)}
            {latestSuiteFailed.length + latestSuiteSkipped.length > 0 && <p className="benchmark-pipeline-result-hint">
              Los modelos fallidos u omitidos siguen en la lista superior y puedes volver a seleccionarlos.
            </p>}
            {latestSuite.error && <p>{latestSuite.error}</p>}
          </div>
        </details>}

        <div className="benchmark-pipeline-actions">
          <span>
            <ShieldCheck size={14} />
            El estado actual se captura antes de empezar y se restaura al finalizar.
          </span>
          {!activeSuite && <div className="benchmark-pipeline-options">
            <label title="Repeticiones medidas por caso; con 2 o más se calcula la estabilidad">Repeticiones
              <input type="number" min={1} max={10} value={repetitions} onChange={(event) => setRepetitions(Math.max(1, Math.min(10, Number(event.target.value))))} />
            </label>
            <label className="checkbox" title="Detiene el tráfico del resto de servicios durante cada medición"><input type="checkbox" checked={strictIsolation} onChange={(event) => setStrictIsolation(event.target.checked)} /><span>Aislamiento estricto</span></label>
          </div>}
          {activeSuite
            ? <button
                className="button danger"
                disabled={activeSuite.status === "restoring" || suiteAction === "stopping"}
                onClick={() => void stopSuite()}
              ><Square size={14} /> {suiteAction === "stopping" ? "Deteniendo…" : activeSuite.status === "restoring" ? "Restaurando…" : "Detener y restaurar"}</button>
            : <button
                className="button primary"
                disabled={!data.enabled || !selectedSuiteCandidates.length || data.active || suiteAction === "starting"}
                onClick={() => void startSuite()}
              ><Play size={15} /> {suiteAction === "starting" ? "Iniciando…" : "Ejecutar suite de benchmarks"}</button>}
        </div>
      </Card>

      {activeJob && <Card className="benchmark-active">
        <div><RefreshCw className="spin" size={18} /><span><strong>{activeJob.message}</strong><small>{activeJob.target}</small></span><b>{Math.round(activeJob.progress)}%</b></div>
        <div className="storage-bar"><span style={{ width: `${activeJob.progress}%` }} /></div>
        <button className="button secondary" onClick={() => void cancelRun(activeJob.id)}>Cancelar</button>
      </Card>}

      {pendingQueue.length > 0 && <Card className="benchmark-queue">
        <div><strong>Cola automática</strong><small>Se ejecuta cuando no hay trabajos, ni inferencia activa, ni uso interactivo reciente</small></div>
        {pendingQueue.map((entry) => <div className="benchmark-queue-row" key={entry.id}>
          <span><strong>{entry.target.replace(/^ollama:/, "").replace(/^profile:/, "perfil ")}</strong><small>{entry.status === "running" ? "Ejecutando" : entry.last_reason || "Esperando ventana libre"} · intento {entry.attempts}</small></span>
          {entry.status === "pending" && <button className="button secondary" onClick={() => void skipQueueEntry(entry.id)}>Descartar</button>}
        </div>)}
      </Card>}

      <div className="benchmark-summary-grid">
        <Card><small>Runs históricos</small><strong>{data.runs.length}</strong><span>Locales e importados</span></Card>
        <Card><small>Runs válidos</small><strong>{validRuns.length}</strong><span>Incluidos en comparativas</span></Card>
        <Card><small>Artefactos medidos</small><strong>{new Set(data.runs.map((run) => run.artifact_hash)).size}</strong><span>Digest exacto</span></Card>
        <Card><small>Protocolo activo</small><strong>v{data.protocols.find((protocol) => protocol.active)?.version ?? "—"}</strong><span>{data.score_algorithm}</span></Card>
      </div>

      <div className="benchmark-category-tabs" role="tablist" aria-label="Categorías de benchmark">
        {BENCHMARK_CATEGORIES.map((category) => {
          const Icon = category.icon;
          const count = categoryCounts[category.id] ?? 0;
          return <button
            key={category.id}
            role="tab"
            type="button"
            aria-selected={activeCategory.id === category.id}
            className={activeCategory.id === category.id ? "active" : ""}
            disabled={category.id !== "all" && count === 0}
            style={{ "--category": category.color } as CSSProperties}
            onClick={() => setBenchCategory(category.id)}
          ><Icon size={15} /><span>{category.label}</span><b>{count}</b></button>;
        })}
      </div>

      {chartModalities.length > 0 && <>
        <SectionHeading
          eyebrow="COMPARACIÓN"
          title={activeCategory.id === "all" ? "Rendimiento por categoría" : `Rendimiento · ${activeCategory.label}`}
          action={comparisonGroups.length > 1 ? <select className="benchmark-comparison-select" value={selectedComparison} onChange={(event) => setComparisonKey(event.target.value)} aria-label="Entorno de comparación">
            {comparisonGroups.map((group) => <option key={group.key} value={group.key}>{group.label} ({group.count})</option>)}
          </select> : undefined}
        />
        {chartModalities.map((modality) => <BenchmarkModalityCharts key={modality} modality={modality} runs={comparableByModality.get(modality) ?? []} />)}
      </>}

      <SectionHeading
        eyebrow="FICHAS"
        title="Resultados por modelo"
        action={<div className="benchmark-list-actions">
          <label className={`benchmark-search${searchStateClass(benchSearch, visibleGroups.length)}`} data-count={searchCountLabel(benchSearch, visibleGroups.length)}>
            <Search size={14} />
            <input
              type="search"
              value={benchSearch}
              onChange={(event) => setBenchSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") setBenchSearch(""); }}
              placeholder="Buscar modelo, autor, tag…"
              aria-label="Buscar en resultados por modelo"
            />
            {benchSearch && <button type="button" onClick={() => setBenchSearch("")} aria-label="Limpiar búsqueda"><X size={13} /></button>}
          </label>
          <select className="benchmark-comparison-select" value={benchSort} onChange={(event) => setBenchSort(event.target.value as typeof benchSort)} aria-label="Ordenar fichas">
            <option value="score">Por categoría y score</option>
            <option value="recent">Más recientes</option>
            <option value="name">Por nombre</option>
          </select>
          <label className="button secondary benchmark-import"><Download size={14} /> Importar JSON<input type="file" accept="application/json,.json" onChange={(event) => { void importRun(event.target.files?.[0]); event.target.value = ""; }} /></label>
        </div>}
      />
      {visibleGroups.length ? <div className="benchmark-model-grid">
        {visibleGroups.map(({ runs, run, modality }) => <BenchmarkModelCard
          key={run.artifact_hash}
          run={run}
          runs={runs}
          modality={modality}
          peers={comparableByModality.get(modality) ?? [run]}
          active={Boolean(data.active)}
          rerunning={rerunningArtifact === run.artifact_hash}
          detailLoading={detailLoading}
          onRerun={() => void rerunBenchmark(run)}
          onOpen={() => void openRun(run.id)}
          onExport={() => void exportRun(run.id)}
          onOpenRun={(id) => void openRun(id)}
        />)}
      </div> : <Empty icon={<Gauge />} title={!artifactGroups.length ? "Todavía no hay benchmarks" : searchTerms.length ? `Nada coincide con «${benchSearch.trim()}»` : "Sin modelos en esta categoría"} text={searchTerms.length ? "Prueba con otro término o cambia de categoría." : "Selecciona un modelo y ejecuta la suite reproducible."} />}

      {detail && <div className="benchmark-detail-overlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setDetail(null); }}>
        <Card className="benchmark-detail" >
          <div className="benchmark-detail-head">
            <div><span className="eyebrow">FICHA COMPLETA</span><h2>{detail.source_id}</h2><small>{detail.artifact_hash.slice(0, 16)}… · {detail.quantization || detail.filename || detail.source}</small></div>
            <button className="icon-button" onClick={() => setDetail(null)} aria-label="Cerrar ficha"><X size={17} /></button>
          </div>
          <div className="benchmark-detail-body">
            {(() => {
              const info = detail.model_info;
              const category = benchmarkCategory(detailModality);
              const radar = Object.entries(detail.summary.score_dimensions ?? {})
                .filter(([, value]) => value != null)
                .map(([key, value]) => ({ dimension: key.replace(/_/g, " "), value: Number(value) }));
              const facts = [
                ["Tarea", MODALITY_LABELS[detailModality] ?? detailModality],
                ["Autor", info?.author],
                ["Parámetros", parameterLabel(info)],
                ["Tamaño en disco", bytes(detail.artifact_size)],
                ["Cuantización", detail.quantization],
                ["Arquitectura", detail.architecture],
                ["Memoria estimada", info?.estimated_memory_mb ? bytes(info.estimated_memory_mb * 1024 * 1024) : ""],
                ["Entrada → salida", info?.input_modalities.length ? `${info.input_modalities.join(", ")} → ${info.output_modalities.join(", ") || "—"}` : ""],
                ["Licencia", info?.license],
                ["Modelo base", info?.base_model],
                ["Librería", info?.library],
                ["Idiomas", info?.languages.slice(0, 8).join(", ")],
                ["Popularidad", info?.downloads || info?.likes ? `${compactCount(info?.downloads) || "0"} descargas · ${compactCount(info?.likes) || "0"} likes` : ""],
              ].filter(([, value]) => value);
              return <div className="benchmark-detail-hero" style={{ "--category": category.color } as CSSProperties}>
                <div className="bdh-info">
                  <span className="bmc-icon"><ModalityIcon modality={detailModality} size={24} /></span>
                  <div>
                    <span className="bmc-kicker">{MODALITY_LABELS[detailModality] ?? detailModality}</span>
                    <strong>{info?.name || detail.source_id}</strong>
                    {info?.summary && <p>{info.summary}</p>}
                  </div>
                  <dl className="bmc-facts">{facts.map(([label, value]) => <span key={label}><dt>{label}</dt><dd title={String(value)}>{value}</dd></span>)}</dl>
                  {info?.tags.length ? <div className="bmc-tags">{info.tags.slice(0, 12).map((tag) => <span className="bmc-tag" key={tag}>{tag}</span>)}</div> : null}
                </div>
                <div className="bdh-radar">
                  <div className="benchmark-score bmc-score large" style={{ "--score": `${Number(detail.summary.score ?? 0) * 3.6}deg`, "--category": category.color } as CSSProperties}>
                    <strong>{Math.round(Number(detail.summary.score ?? 0))}</strong><small>/100</small>
                  </div>
                  {radar.length >= 3 ? <ResponsiveContainer width="100%" height={230}>
                    <RadarChart data={radar} outerRadius="72%">
                      <PolarGrid stroke="var(--border)" />
                      <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                      <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                      <Tooltip formatter={(value) => `${Number(value).toFixed(1)}/100`} />
                      <Radar dataKey="value" name="Score" stroke={category.color} fill={category.color} fillOpacity={0.3} isAnimationActive={false} />
                    </RadarChart>
                  </ResponsiveContainer> : <small className="benchmark-chart-empty">Dimensiones insuficientes para el radar</small>}
                </div>
              </div>;
            })()}
            <div className="benchmark-summary-grid">
              <Card><small>Score medido</small><strong>{detail.summary.score ?? "—"}</strong><span>{detail.score_algorithm}</span></Card>
              {detailModality === "automatic-speech-recognition" ? <>
                <Card><small>RTF / WER</small><strong>{detail.summary.real_time_factor?.mean == null ? "—" : `${Number(detail.summary.real_time_factor.mean).toFixed(3)} / ${((detail.summary.word_error_rate ?? 0) * 100).toFixed(1)}%`}</strong><span>Velocidad / error de palabras</span></Card>
                <Card><small>CER</small><strong>{detail.summary.character_error_rate == null ? "—" : `${(Number(detail.summary.character_error_rate) * 100).toFixed(1)}%`}</strong><span>Fixture de audio versionado</span></Card>
              </> : detailModality === "vision" ? <>
                <Card><small>Latencia p50</small><strong>{detail.summary.total_ms?.p50 == null ? "—" : `${Number(detail.summary.total_ms.p50).toFixed(0)} ms`}</strong><span>Inferencia con imagen local</span></Card>
                <Card><small>Recall de conceptos</small><strong>{detail.summary.vision_quality?.normalized_concept_recall == null ? "—" : `${(Number(detail.summary.vision_quality.normalized_concept_recall) * 100).toFixed(1)}%`}</strong><span>{detail.summary.vision_quality?.method || "Fixture visual versionado"}</span></Card>
              </> : detailModality === "text-to-speech" ? <>
                <Card><small>RTF medio</small><strong>{detail.summary.real_time_factor?.mean == null ? "—" : Number(detail.summary.real_time_factor.mean).toFixed(3)}</strong><span>Síntesis / duración</span></Card>
                <Card><small>Inteligibilidad</small><strong>{!detail.summary.intelligibility?.available ? "No medida" : `${((1 - Number(detail.summary.intelligibility.word_error_rate ?? 1)) * 100).toFixed(1)}%`}</strong><span>{detail.summary.intelligibility?.quality_claim || "Sin afirmación de inteligibilidad"}</span></Card>
              </> : detailModality === "image-generation" ? <>
                <Card><small>Generación p50</small><strong>{detail.summary.total_ms?.p50 == null ? "—" : `${(Number(detail.summary.total_ms.p50) / 1000).toFixed(1)} s`}</strong><span>Workflow y semilla fijos</span></Card>
                <Card><small>Reproducibilidad</small><strong>{detail.summary.image_validation?.pixel_reproducibility_percent == null ? "—" : `${Number(detail.summary.image_validation.pixel_reproducibility_percent).toFixed(0)}%`}</strong><span>Validación de píxeles</span></Card>
              </> : detailModality === "video-generation" ? <>
                <Card><small>Generación p50</small><strong>{detail.summary.total_ms?.p50 == null ? "—" : `${(Number(detail.summary.total_ms.p50) / 1000).toFixed(1)} s`}</strong><span>Workflow Wan reproducible</span></Card>
                <Card><small>Reproducibilidad</small><strong>{detail.summary.video_validation?.perceptual_reproducibility_percent == null && detail.summary.video_validation?.exact_reproducibility_percent == null ? "—" : `${Number(detail.summary.video_validation.perceptual_reproducibility_percent ?? detail.summary.video_validation.exact_reproducibility_percent).toFixed(0)}%`}</strong><span>{detail.summary.video_validation?.quality_claim || "Validación objetiva del contenedor"}</span></Card>
              </> : detailModality === "embeddings" ? <>
                <Card><small>Elementos/s</small><strong>{detail.summary.items_per_second?.mean == null ? "—" : Number(detail.summary.items_per_second.mean).toFixed(1)}</strong><span>Throughput vectorial</span></Card>
                <Card><small>Calidad semántica</small><strong>{detail.summary.semantic_quality?.pair_accuracy == null ? "—" : `${(Number(detail.summary.semantic_quality.pair_accuracy) * 100).toFixed(1)}%`}</strong><span>Margen {detail.summary.semantic_quality?.mean_margin?.toFixed(3) ?? "—"}</span></Card>
              </> : detailModality === "reranking" ? <>
                <Card><small>NDCG</small><strong>{detail.summary.ranking_quality?.ndcg_mean == null ? "—" : `${(Number(detail.summary.ranking_quality.ndcg_mean) * 100).toFixed(1)}%`}</strong><span>Ordenación esperada</span></Card>
                <Card><small>MRR</small><strong>{detail.summary.ranking_quality?.mrr_mean == null ? "—" : `${(Number(detail.summary.ranking_quality.mrr_mean) * 100).toFixed(1)}%`}</strong><span>Primer resultado relevante</span></Card>
              </> : <>
                <Card><small>TTFT p50 / p95</small><strong>{detail.summary.ttft_ms?.p50 == null ? "—" : `${Number(detail.summary.ttft_ms.p50).toFixed(0)} / ${Number(detail.summary.ttft_ms.p95 ?? 0).toFixed(0)} ms`}</strong><span>Primer token</span></Card>
                <Card><small>Throughput</small><strong>{detail.summary.output_tokens_per_second?.mean == null ? "—" : `${Number(detail.summary.output_tokens_per_second.mean).toFixed(1)} tok/s`}</strong><span>{detail.summary.characters_per_second?.mean == null ? "Sin normalizar" : `${Number(detail.summary.characters_per_second.mean).toFixed(0)} chars/s`}</span></Card>
              </>}
              <Card><small>Fiabilidad</small><strong>{detail.summary.reliability_percent ?? 0}%</strong><span>{detail.summary.valid_sample_count ?? 0}/{detail.summary.sample_count ?? 0} muestras</span></Card>
            </div>
            {detail.telemetry.length > 1 && <Card className="benchmark-chart">
              <div><strong>Telemetría durante el run</strong><small>Utilización GPU y potencia observadas</small></div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={detail.telemetry.map((point) => ({ time: new Date(point.created_at).toLocaleTimeString(), gpu: point.gpu_utilization, power: point.gpu_power_watts }))}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="time" />
                  <YAxis width={42} />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="gpu" name="GPU %" stroke="var(--accent)" fill="var(--accent-soft)" />
                  <Area type="monotone" dataKey="power" name="Potencia W" stroke="var(--blue)" fill="transparent" />
                </AreaChart>
              </ResponsiveContainer>
            </Card>}
            <div className="benchmark-detail-grid">
              <div><strong>Artefacto</strong><dl><dt>Fuente</dt><dd>{detail.source}</dd><dt>Revisión</dt><dd>{detail.revision || "—"}</dd><dt>Archivo</dt><dd>{detail.filename || "—"}</dd><dt>Tamaño</dt><dd>{bytes(detail.artifact_size)}</dd><dt>Hash</dt><dd><code>{detail.artifact_hash}</code></dd></dl></div>
              <div><strong>Entorno</strong><dl>{Object.entries(detail.hardware).slice(0, 10).map(([key, value]) => <span key={key}><dt>{key}</dt><dd>{String(value ?? "—")}</dd></span>)}</dl></div>
              <div><strong>Runtime efectivo</strong><pre>{JSON.stringify(detail.runtime, null, 2)}</pre></div>
              <div><strong>Score dimensional{detail.summary.score_provisional ? " · provisional" : ""}</strong><dl>{Object.entries(detail.summary.score_dimensions ?? {}).map(([key, value]) => <span key={key}><dt>{key}</dt><dd>{value == null ? "— (requiere ≥2 repeticiones)" : `${Number(value).toFixed(1)}/100`}</dd></span>)}</dl></div>
            </div>
            {detail.summary.cases && <div className="benchmark-samples benchmark-cases">
              <strong>Resultado por caso</strong>
              <div className="benchmark-sample-head"><span>Caso</span><span>Válidas</span><span>TTFT p50</span><span>tok/s</span><span>CV</span><span>Fin temprano</span></div>
              {Object.entries(detail.summary.cases).map(([caseId, item]) => <div key={caseId}><span>{caseId}</span><span>{item.valid_samples}/{item.samples}</span><span>{item.ttft_ms_p50 == null ? "—" : `${item.ttft_ms_p50.toFixed(0)} ms`}</span><span>{item.output_tokens_per_second_mean == null ? "—" : item.output_tokens_per_second_mean.toFixed(1)}</span><span>{item.coefficient_of_variation == null ? "—" : `${(item.coefficient_of_variation * 100).toFixed(1)}%`}</span><span>{item.early_stops}</span></div>)}
            </div>}
            <div className="benchmark-samples">
              <strong>Muestras</strong>
              <div className="benchmark-sample-head"><span>Caso</span><span>Fase</span><span>TTFT</span><span>tok/s</span><span>Tokens</span><span>Estado</span></div>
              {detail.samples.map((sample) => <div key={sample.id}><span>{sample.case_id}</span><span>{sample.phase} {sample.repetition || ""}</span><span>{sample.ttft_ms == null ? "—" : `${sample.ttft_ms.toFixed(0)} ms`}</span><span>{sample.output_tps == null ? "—" : sample.output_tps.toFixed(1)}</span><span>{sample.output_tokens ?? "—"}</span><span className={sample.valid ? "ok" : "error"}>{sample.valid ? "Válida" : sample.error || "Fallida"}</span></div>)}
            </div>
            {detail.card_text && <details className="benchmark-model-card"><summary>Descripción / model card de Hugging Face</summary><MarkdownMessage content={detail.card_text.slice(0, 12_000)} /></details>}
            <details className="benchmark-raw"><summary>Metadatos completos</summary><pre>{JSON.stringify(detail.metadata, null, 2)}</pre></details>
          </div>
        </Card>
      </div>}
    </div>
  );
}

function SystemView({ config, jobs, overview, notify }: { config: Config | null; jobs: Job[]; overview: Overview | null; notify: (message: string, error?: boolean) => void }) {
  const [services, setServices] = useState<Array<Record<string, unknown>>>([]);
  const [updates, setUpdates] = useState<SystemUpdates | null>(null);
  const [versions, setVersions] = useState<{ components: Array<{ name: string; version?: string; available: boolean; detail: string; category?: string }>; packages: Array<{ name: string; version: string }> } | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [integrity, setIntegrity] = useState<SystemIntegrity | null>(null);
  const readinessGroups = useMemo(() => {
    return (readiness?.checks ?? []).reduce<Record<string, ReadinessCheck[]>>((groups, check) => {
      (groups[check.category] ??= []).push(check);
      return groups;
    }, {});
  }, [readiness]);
  const load = useCallback(() => {
    Promise.all([
      api<Array<Record<string, unknown>>>("/api/services"),
      api<typeof updates>("/api/updates"),
      api<typeof versions>("/api/system/versions"),
      api<Readiness>("/api/system/readiness"),
      api<SystemIntegrity>("/api/system/integrity"),
    ])
      .then(([serviceData, updateData, versionData, readinessData, integrityData]) => {
        setServices(serviceData);
        setUpdates(updateData);
        setVersions(versionData);
        setReadiness(readinessData);
        setIntegrity(integrityData);
      })
      .catch((error) => notify(error.message, true));
  }, [notify]);
  useEffect(load, [load]);
  const maintenanceStatus = jobs
    .filter((job) => ["system.update", "system.repair"].includes(job.kind))
    .map((job) => `${job.id}:${job.status}`)
    .join("|");
  useEffect(() => {
    if (maintenanceStatus.includes(":completed") || maintenanceStatus.includes(":failed")) load();
  }, [load, maintenanceStatus]);

  async function applyUpdates() {
    if (!window.confirm("Se actualizarán los paquetes del sistema. Guarda todo tu trabajo antes de continuar.")) return;
    try {
      await api("/api/updates/apply", { method: "POST", body: JSON.stringify({ confirm: "ACTUALIZAR MYDGX" }) });
      notify("Actualización iniciada; al terminar se verificarán kernel, driver, CUDA, DKMS y llama.cpp");
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function repairSystem() {
    if (!window.confirm("Se comprobarán paquetes, DKMS, driver NVIDIA, CUDA y llama.cpp. La reparación puede tardar varios minutos.")) return;
    try {
      await api("/api/system/repair", { method: "POST", body: JSON.stringify({ confirm: "REPARAR MYDGX" }) });
      notify("Comprobación y reparación iniciada");
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function control(name: string, action: "start" | "stop" | "restart") {
    if (!window.confirm(`¿${action} el servicio ${name}?`)) return;
    try {
      await api("/api/services/action", { method: "POST", body: JSON.stringify({ name, action, confirm: `${action} ${name}` }) });
      notify(`Servicio ${name}: ${action}`);
      load();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  const maintenanceActive = jobs.some((job) =>
    ["system.update", "system.repair"].includes(job.kind) &&
    ["queued", "running"].includes(job.status)
  );
  const systemBranding = overview ? deviceBranding(overview.host) : null;
  const updateCategoryLabels: Record<SystemUpdatePackage["category"], string> = {
    kernel: "Kernel",
    nvidia: "NVIDIA / CUDA",
    containers: "Contenedores",
    runtime: "Runtime",
    system: "Sistema",
  };

  return (
    <div className="view-stack">
      <SectionHeading
        eyebrow={overview?.host.is_dgx_spark ? "PLATAFORMA NVIDIA GB10" : (overview?.host.os_family ?? "SISTEMA").toUpperCase()}
        title="Sistema y servicios"
        action={<button className="icon-button" onClick={load}><RefreshCw size={17} /></button>}
      />
      {overview && systemBranding && (
        <Card className={`system-device-banner device-${overview.host.device_variant}`}>
          <div className="system-device-copy">
            <div className="system-device-brand">
              {systemBranding.logo && <img src={systemBranding.logo} alt={overview.host.device_vendor} />}
              <span>{systemBranding.subtitle}</span>
            </div>
            <strong>{systemBranding.label}</strong>
            <small><StatusDot online /> {overview.host.is_dgx_spark ? "NVIDIA GB10 detectado" : "Equipo detectado"} · {overview.host.hostname}</small>
            <div className="system-device-chips">
              <span>{overview.host.gpu_name || "GPU no detectada"}</span>
              <span>{overview.host.architecture}</span>
              <span>{overview.host.is_dgx_os ? "DGX OS" : overview.host.os_family}</span>
            </div>
          </div>
          <div className="system-device-photo">
            {systemBranding.product
              ? <img src={systemBranding.product} alt={systemBranding.label} />
              : <Cpu aria-label="Equipo sin fotografía disponible" />}
          </div>
        </Card>
      )}
      {readiness && (
        <>
          <Card className={`readiness-summary ${readiness.ready ? "ready" : "attention"}`}>
            <div className="readiness-title">
              {readiness.ready ? <CheckCircle2 /> : <TriangleAlert />}
              <span>
                <strong>{readiness.ready ? "Sistema listo" : "El sistema requiere atención"}</strong>
                <small>{readiness.ready ? "Todos los requisitos obligatorios están disponibles." : "Revisa los avisos antes de activar perfiles o descargar modelos."}</small>
              </span>
            </div>
            <div className="readiness-counts">
              <span className="ok"><CheckCircle2 size={16} /><strong>{readiness.summary.ok}</strong><small>Correctos</small></span>
              <span className="warning"><TriangleAlert size={16} /><strong>{readiness.summary.warnings}</strong><small>Avisos</small></span>
              <span className="info"><Info size={16} /><strong>{readiness.summary.optional}</strong><small>Opcionales</small></span>
            </div>
          </Card>
          <div className="readiness-groups">
            {Object.entries(readinessGroups).map(([category, checks]) => (
              <Card className="readiness-group" key={category}>
                <div className="card-kicker"><ShieldCheck size={16} /> {category}</div>
                <div className="readiness-list">
                  {checks.map((check) => (
                    <div className={`readiness-check ${check.status}`} key={check.id}>
                      {check.status === "ok" ? <CheckCircle2 /> : check.status === "warning" ? <TriangleAlert /> : <Info />}
                      <span>
                        <strong>{check.label}</strong>
                        <small>{check.detail}</small>
                        {check.remediation && <em>{check.remediation}</em>}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
      <div className="system-grid">
        <Card>
          <div className="card-kicker"><Cpu size={16} /> Plataforma y sistema operativo</div>
          <div className="system-facts">
            <div><span>Plataforma</span><strong>{overview ? (overview.host.is_dgx_spark ? overview.host.device_model : "Equipo no DGX Spark") : "Detectando"}</strong></div>
            <div><span>Familia del SO</span><strong>{overview ? (overview.host.is_dgx_os ? "NVIDIA DGX OS" : overview.host.os_family) : "Detectando"}</strong></div>
            <div><span>Distribución</span><strong>{overview?.host.os_name ?? "Detectando"}</strong></div>
            <div><span>Kernel</span><strong>{overview?.host.kernel ?? "—"}</strong></div>
            <div><span>Arquitectura</span><strong>{overview?.host.architecture ?? "—"}</strong></div>
            <div><span>CPU</span><strong>{overview?.host.cpu_count ?? "—"} núcleos</strong></div>
          </div>
        </Card>
        <Card>
          <div className="card-kicker"><Server size={16} /> Servicios administrados</div>
          <div className="service-list">
            {services.map((service) => {
              const active = ["active", "running"].includes(String(service.status));
              return (
                <div className="service-control" key={`${service.type}-${service.name}`}>
                  <StatusDot online={active} />
                  <div><strong>{String(service.name)}</strong><small>{String(service.type)} · {String(service.status)}</small></div>
                  {service.type === "systemd" && <div><button onClick={() => control(String(service.name), "restart")}>Reiniciar</button><button onClick={() => control(String(service.name), active ? "stop" : "start")}>{active ? "Detener" : "Iniciar"}</button></div>}
                </div>
              );
            })}
            {!services.length && <p className="muted">No se detectaron servicios administrados.</p>}
          </div>
        </Card>
        <Card className="integrity-card">
          <div className="card-kicker">
            {integrity?.healthy ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
            Integridad después de actualizar
          </div>
          {integrity && (
            <>
              <div className={`integrity-state ${integrity.healthy ? "ok" : "warning"}`}>
                <strong>{integrity.healthy ? "Sistema coherente" : integrity.reboot_required ? "Reinicio requerido" : "Reparación recomendada"}</strong>
                <small>Kernel activo {integrity.current_kernel}{integrity.latest_kernel !== integrity.current_kernel ? ` · disponible ${integrity.latest_kernel}` : ""}</small>
              </div>
              <div className="integrity-checks">
                {[
                  ["APT", integrity.apt_ok],
                  ["dpkg", integrity.dpkg_ok],
                  ["DKMS", integrity.dkms_ok],
                  ["NVIDIA Container", integrity.container_runtime_ok],
                  ["Driver NVIDIA", integrity.nvidia_ok],
                  ["llama.cpp", integrity.llama_ok],
                  ["Servicio al arrancar", integrity.service_enabled],
                ].map(([label, value]) => (
                  <span key={String(label)} className={value === false ? "warning" : value === true ? "ok" : "info"}>
                    {value === false ? <TriangleAlert /> : value === true ? <CheckCircle2 /> : <Info />}
                    <small>{String(label)}</small>
                  </span>
                ))}
              </div>
              <div className="integrity-actions">
                <small>{integrity.last_repair ? `Última comprobación ${new Date(integrity.last_repair).toLocaleString()}` : "Sin reparación registrada"}</small>
                <button className="button secondary" disabled={!config?.system_updates_enabled || !integrity.repair_available || maintenanceActive} onClick={repairSystem}>Comprobar y reparar</button>
              </div>
            </>
          )}
        </Card>
        <Card className="updates-card">
          <div className="card-kicker"><PackageCheck size={16} /> Actualizaciones</div>
          <div className="updates-overview">
            <div className="update-total">
              <strong>{updates?.supported ? updates.packages.length : "—"}</strong>
              <span>{updates?.supported ? "paquetes disponibles" : "APT no disponible"}</span>
            </div>
            <div className="update-stats">
              <span className={(updates?.summary.security ?? 0) > 0 ? "warning" : ""}><strong>{updates?.summary.security ?? 0}</strong><small>Seguridad</small></span>
              <span><strong>{updates?.summary.kernel ?? 0}</strong><small>Kernel</small></span>
              <span><strong>{updates?.summary.nvidia ?? 0}</strong><small>NVIDIA/CUDA</small></span>
              <span><strong>{updates?.summary.containers ?? 0}</strong><small>Contenedores</small></span>
            </div>
            <div className="update-actions">
              {updates?.reboot_required && <span className="update-reboot"><TriangleAlert size={15} /> Hay un reinicio pendiente</span>}
              <small>{updates?.checked_at ? `Comprobado ${new Date(updates.checked_at).toLocaleString()}` : "Comprobando APT…"}</small>
              <button className="button primary" disabled={!config?.system_updates_enabled || !updates?.packages.length || maintenanceActive} onClick={applyUpdates}>{maintenanceActive ? "Mantenimiento en curso" : "Actualizar sistema"}</button>
              {!config?.system_updates_enabled && <small>Activa ENABLE_SYSTEM_UPDATES en .env</small>}
            </div>
          </div>
          {updates?.message && <div className="update-message">{updates.message}</div>}
          {updates?.packages.length ? (
            <div className="update-packages">
              {updates.packages.map((item) => (
                <div className="update-package" key={item.name}>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{updateCategoryLabels[item.category]} · {item.architecture} · {item.repository}</small>
                  </span>
                  {item.security && <span className="badge warning">Seguridad</span>}
                  <code>{item.current_version || "—"} <span>→</span> {item.candidate_version}</code>
                </div>
              ))}
            </div>
          ) : updates?.supported ? <p className="updates-empty"><CheckCircle2 size={17} /> El sistema está actualizado.</p> : null}
        </Card>
      </div>
      <SectionHeading eyebrow="SOFTWARE" title="Versiones instaladas" />
      <Card className="version-list">
        {versions?.components.map((component) => (
          <div key={component.name}>
            <StatusDot online={component.available} />
            <span><strong>{component.name}</strong><small>{component.category ? `${component.category} · ` : ""}{component.detail}</small></span>
            <code>{component.version ?? "No detectado"}</code>
          </div>
        ))}
        {versions?.packages.map((item) => (
          <div key={item.name}><StatusDot online /><span><strong>{item.name}</strong><small>Paquete DGX OS</small></span><code>{item.version}</code></div>
        ))}
      </Card>
      {jobs.some((job) => ["system.update", "system.repair"].includes(job.kind)) && <Card className="notice"><Terminal /><span>La tarea de mantenimiento se puede seguir en Modelos → Actividad reciente.</span></Card>}
    </div>
  );
}

function LogsView({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const [data, setData] = useState<SystemLogsResponse | null>(null);
  const [level, setLevel] = useState(() => localStorage.getItem("mydgx-logs-level") || "");
  const [category, setCategory] = useState(() => localStorage.getItem("mydgx-logs-category") || "");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [live, setLive] = useState(true);

  const logsRequest = useRef(0);
  const load = useCallback(async () => {
    const request = ++logsRequest.current;
    const params = new URLSearchParams({ limit: "200" });
    if (level) params.set("level", level);
    if (category) params.set("category", category);
    if (appliedQuery) params.set("q", appliedQuery);
    try {
      const result = await api<SystemLogsResponse>(`/api/logs?${params}`);
      if (request === logsRequest.current) setData(result);
    } catch (error) {
      if (request === logsRequest.current) notify((error as Error).message, true);
    }
  }, [appliedQuery, category, level, notify]);

  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    const timer = live ? window.setInterval(load, 3000) : undefined;
    return () => {
      window.clearTimeout(initial);
      if (timer) window.clearInterval(timer);
    };
  }, [live, load]);
  useEffect(() => {
    localStorage.setItem("mydgx-logs-level", level);
    localStorage.setItem("mydgx-logs-category", category);
  }, [category, level]);

  function search(event: FormEvent) {
    event.preventDefault();
    setAppliedQuery(query.trim());
  }

  const counts = data?.summary ?? {};
  return (
    <div className="view-stack">
      <SectionHeading
        eyebrow="DIAGNÓSTICO PERSISTENTE"
        title="Logs"
        action={<div className="logs-heading-actions">
          <button className={`button ${live ? "primary" : "secondary"}`} onClick={() => setLive((current) => !current)}>
            {live ? <Activity size={14} /> : <Square size={13} />} {live ? "En directo" : "Pausado"}
          </button>
          <button className="icon-button" onClick={() => void load()} aria-label="Actualizar logs"><RefreshCw size={16} /></button>
        </div>}
      />
      <div className="logs-summary">
        <Card><small>Últimas 24 h</small><strong>{Object.values(counts).reduce((total, count) => total + (count ?? 0), 0)}</strong></Card>
        <Card className="warning"><small>Warnings</small><strong>{counts.warning ?? 0}</strong></Card>
        <Card className="error"><small>Errores</small><strong>{(counts.error ?? 0) + (counts.critical ?? 0)}</strong></Card>
        <Card><small>Retención</small><strong>{data?.retention_days ?? 30} días</strong></Card>
      </div>
      <Card className="logs-panel">
        <form className="logs-filters" onSubmit={search}>
          <label>Nivel
            <select value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="">Todos</option>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label>Categoría
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Todas</option>
              {(data?.categories ?? []).map((item) => <option value={item} key={item}>{item}</option>)}
            </select>
          </label>
          <label className={`logs-search${searchStateClass(query, data && appliedQuery === query.trim() ? data.entries.length : null)}`} data-count={searchCountLabel(query, data && appliedQuery === query.trim() ? data.entries.length : null)}>Buscar
            <span><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="acción, entidad o mensaje" /><button type="submit">Filtrar</button></span>
          </label>
        </form>
        <div className="logs-table-head"><span>Fecha</span><span>Nivel</span><span>Evento</span><span>Categoría</span></div>
        <div className="logs-list">
          {(data?.entries ?? []).map((entry) => (
            <button
              className={`log-entry level-${entry.level} ${selected === entry.id ? "selected" : ""}`}
              key={entry.id}
              onClick={() => setSelected((current) => current === entry.id ? null : entry.id)}
            >
              <time>{new Date(entry.created_at).toLocaleString()}</time>
              <span className={`log-level ${entry.level}`}>{entry.level}</span>
              <span className="log-message">
                <strong>{entry.message}</strong>
                <small>{entry.action}{entry.entity_id ? ` · ${entry.entity_id}` : ""}</small>
                {selected === entry.id && <code>{JSON.stringify(entry.detail, null, 2)}</code>}
              </span>
              <span className="log-category">{entry.category}</span>
            </button>
          ))}
          {data && data.entries.length === 0 && <Empty icon={<Terminal />} title="Sin resultados" text="No hay logs que coincidan con estos filtros." />}
        </div>
        {data?.has_more && <small className="logs-limit-note">Se muestran los 200 eventos más recientes. Acota los filtros para investigar un caso concreto.</small>}
      </Card>
    </div>
  );
}

function SettingsView({ config, theme, setTheme, notify }: { config: Config | null; theme: Theme; setTheme: (theme: Theme) => void; notify: (message: string, error?: boolean) => void }) {
  const [key, setKey] = useState(getApiKey());
  const [gateway, setGateway] = useState<GatewayConfig | null>(null);
  useEffect(() => {
    api<GatewayConfig>("/api/gateway/config").then(setGateway).catch((error) => notify(error.message, true));
  }, [notify]);

  function saveKey() {
    if (key) sessionStorage.setItem("mydgx-api-key", key);
    else sessionStorage.removeItem("mydgx-api-key");
    notify("Clave guardada solo durante esta sesión");
    window.location.reload();
  }

  async function saveGateway(event: FormEvent) {
    event.preventDefault();
    if (!gateway) return;
    try {
      await api("/api/gateway/config", {
        method: "PUT",
        body: JSON.stringify({
          enabled: gateway.enabled,
          host: gateway.host,
          port: gateway.port,
          request_timeout_seconds: gateway.request_timeout_seconds,
          max_request_mb: gateway.max_request_mb,
        }),
      });
      notify("Gateway actualizado. Ejecuta ./start.sh restart para aplicar host o puerto.");
      setGateway(await api<GatewayConfig>("/api/gateway/config"));
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  return (
    <div className="view-stack settings-view">
      <SectionHeading eyebrow="PREFERENCIAS" title="Configuración" />
      <Card>
        <div className="settings-row"><div><Sun /><span><strong>Apariencia</strong><small>Elige el tema de la interfaz</small></span></div><div className="segmented"><button className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}>Día</button><button className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>Noche</button></div></div>
        <div className="settings-row"><div><ShieldCheck /><span><strong>Clave de acceso MyDGX</strong><small>Se guarda únicamente en sessionStorage</small></span></div><div className="inline-form"><input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={config?.api_key_required ? "Clave requerida" : "No configurada"} autoComplete="off" /><button className="button secondary" onClick={saveKey}>Guardar</button></div></div>
      </Card>
      <Card>
        <div className="card-kicker"><Activity size={16} /> Integraciones</div>
        <div className="integration-list">
          <div><span><strong>Hugging Face</strong><small>Token cargado desde .env</small></span><span className={`badge ${config?.hf_token_configured ? "live" : ""}`}>{config?.hf_token_configured ? "Configurado" : "Público"}</span></div>
          <div><span><strong>Actualizaciones</strong><small>Operación privilegiada controlada</small></span><span className={`badge ${config?.system_updates_enabled ? "live" : ""}`}>{config?.system_updates_enabled ? "Activadas" : "Bloqueadas"}</span></div>
          <div><span><strong>Servicios</strong><small>systemd con lista permitida</small></span><span className={`badge ${config?.service_control_enabled ? "live" : ""}`}>{config?.service_control_enabled ? "Activado" : "Solo lectura"}</span></div>
        </div>
      </Card>
      <Card className="gateway-settings">
        <div className="gateway-settings-head">
          <div><Bot size={17} /><span><strong>Gateway OpenAI del perfil activo</strong><small>{gateway?.endpoint ?? config?.gateway_url ?? "Cargando…"}</small></span></div>
          <span className={`badge ${gateway?.running ? "live" : ""}`}>{gateway?.running ? "En línea" : gateway?.enabled ? "Reinicio pendiente" : "Desactivado"}</span>
        </div>
        {gateway && <form onSubmit={saveGateway}>
          <label className="checkbox"><input type="checkbox" checked={gateway.enabled} onChange={(event) => setGateway({ ...gateway, enabled: event.target.checked })} /><span>Activar gateway al arrancar MyDGX</span></label>
          <label>Escucha<select value={gateway.host} onChange={(event) => setGateway({ ...gateway, host: event.target.value as GatewayConfig["host"] })}><option value="127.0.0.1">Solo localhost (recomendado)</option><option value="::1">Solo localhost IPv6</option><option value="0.0.0.0">Toda la red IPv4</option><option value="::">Toda la red IPv6</option></select></label>
          <label>Puerto<input type="number" min={1024} max={65535} value={gateway.port} onChange={(event) => setGateway({ ...gateway, port: Number(event.target.value) })} /></label>
          <label>Timeout de inferencia (s)<input type="number" min={10} max={7200} value={gateway.request_timeout_seconds} onChange={(event) => setGateway({ ...gateway, request_timeout_seconds: Number(event.target.value) })} /></label>
          <label>Petición máxima (MiB)<input type="number" min={1} max={256} value={gateway.max_request_mb} onChange={(event) => setGateway({ ...gateway, max_request_mb: Number(event.target.value) })} /></label>
          <div className="gateway-profile-summary">
            <span><small>Perfil proxy</small><strong>{gateway.active_profile ?? "Ningún perfil activo"}</strong></span>
            <span><small>Autenticación</small><strong>{gateway.api_key_configured ? "Bearer configurado en .env" : "Sin clave · solo localhost"}</strong></span>
            <span><small>Adaptador de protocolos</small><strong>{gateway.protocol_adapter ? `LiteLLM ${gateway.protocol_adapter}` : "No disponible"}</strong></span>
            <span className="gateway-aliases"><small>Modelos publicados · nombre completo y alias para el campo model</small><GatewayModelList gateway={gateway} empty="Ninguno configurado" /></span>
          </div>
          <div className="gateway-actions"><small>OpenAI: {gateway.endpoint} · Anthropic: {gateway.anthropic_endpoint}</small></div>
          <div className="gateway-actions"><small>Los cambios de host, puerto o activación requieren reiniciar MyDGX.</small><button className="button primary" type="submit">Guardar gateway</button></div>
        </form>}
      </Card>
      <div className="security-note"><ShieldCheck /><div><strong>Diseñado para mantener los secretos en el servidor</strong><p>Las claves de Hugging Face y servicios nunca se devuelven al navegador, a los logs ni a SQLite.</p></div></div>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return <div className="loading"><RefreshCw className="spin" /><span>{label}</span></div>;
}

function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="empty">{icon}<strong>{title}</strong><p>{text}</p></div>;
}

const FONT_RATIO = 1.1;
const LEGACY_FONT_SCALES = [0.9, 1, 1.12, 1.25] as const;

function roundFontScale(value: number) {
  return Math.round(value * 10000) / 10000;
}

function storedFontScale() {
  const scaleRaw = localStorage.getItem("mydgx-font-scale");
  if (scaleRaw !== null) {
    const scale = Number(scaleRaw);
    if (Number.isFinite(scale) && scale > 0) return roundFontScale(scale);
  }
  const raw = localStorage.getItem("mydgx-font-step");
  const stored = Number(raw);
  return raw !== null && Number.isInteger(stored) && stored >= 0 && stored < LEGACY_FONT_SCALES.length
    ? LEGACY_FONT_SCALES[stored]
    : 1;
}

function changeFontScale(current: number, direction: -1 | 1) {
  const exponent = Math.round(Math.log(current) / Math.log(FONT_RATIO)) + direction;
  if (exponent === 0) return 1;
  const next = roundFontScale(FONT_RATIO ** exponent);
  return Number.isFinite(next) && next > 0 ? next : current;
}

function applyFontScale(scale: number) {
  document.documentElement.style.setProperty("--font-scale", String(scale));
  document.documentElement.style.setProperty("--ui-font-scale", String(scale));
}

function FontSizeControl({ onChange }: { onChange: (update: (current: number) => number) => void }) {
  const wait = useRef<number | null>(null);
  const repeat = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (wait.current !== null) window.clearTimeout(wait.current);
    if (repeat.current !== null) window.clearInterval(repeat.current);
    wait.current = null;
    repeat.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const nudge = useCallback(
    (direction: -1 | 1) => onChange((current) => changeFontScale(current, direction)),
    [onChange],
  );

  const startHolding = useCallback((
    direction: -1 | 1,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    stop();
    nudge(direction);
    wait.current = window.setTimeout(() => {
      repeat.current = window.setInterval(() => nudge(direction), 70);
    }, 320);
  }, [nudge, stop]);

  return (
    <div className="font-scale" role="group" aria-label="Tamaño de letra">
      <button type="button" aria-label="Reducir tamaño de letra" onPointerDown={(event) => startHolding(-1, event)} onPointerUp={stop} onPointerCancel={stop}>−</button>
      <span className="font-scale-mark" aria-hidden="true"><span>A</span><span>A</span></span>
      <button type="button" aria-label="Aumentar tamaño de letra" onPointerDown={(event) => startHolding(1, event)} onPointerUp={stop} onPointerCancel={stop}>+</button>
    </div>
  );
}

export default function App({ onLogout }: { onLogout?: () => void }) {
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem("mydgx-theme") as Theme) || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  const [fontScale, setFontScale] = useState(() => {
    const scale = storedFontScale();
    applyFontScale(scale);
    return scale;
  });
  const [view, setView] = useState<View>(() => {
    const stored = localStorage.getItem("mydgx-view");
    return navItems.some((item) => item.id === stored) ? stored as View : "dashboard";
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [modelMetrics, setModelMetrics] = useState<ModelMetricsResponse>({ current: [], history: [], retention_hours: 0 });
  const [config, setConfig] = useState<Config | null>(null);
  const [models, setModels] = useState<Models | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const error = Object.values(errors).find(Boolean) ?? "";
  const reportError = useCallback((source: string, message: string) => {
    setErrors((current) => (current[source] ?? "") === message ? current : { ...current, [source]: message });
  }, []);
  const toastTimer = useRef<number | undefined>(undefined);
  const jobsRequest = useRef(0);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);

  const notify = useCallback((message: string, isError = false) => {
    setToast({ message, error: isError });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const refreshOverview = useCallback(async () => {
    try {
      setOverview(await api<Overview>("/api/overview"));
      reportError("overview", "");
    } catch (requestError) {
      reportError("overview", (requestError as Error).message);
    }
  }, [reportError]);

  const refreshCore = useCallback(async () => {
    try {
      const [modelMetricsData, configData] = await Promise.all([
        api<ModelMetricsResponse>("/api/metrics/models?minutes=60"),
        api<Config>("/api/config"),
      ]);
      setModelMetrics(modelMetricsData);
      setConfig(configData);
      reportError("core", "");
    } catch (requestError) {
      reportError("core", (requestError as Error).message);
    }
  }, [reportError]);

  const loadJobs = useCallback(async () => {
    const request = ++jobsRequest.current;
    const jobData = await api<Job[]>("/api/jobs");
    if (request === jobsRequest.current) setJobs(jobData);
  }, []);

  const refreshModels = useCallback(async () => {
    try {
      const [modelData] = await Promise.all([api<Models>("/api/models"), loadJobs()]);
      setModels(modelData);
      reportError("models", "");
    } catch (requestError) {
      reportError("models", (requestError as Error).message);
    }
  }, [loadJobs, reportError]);

  const refreshJobs = useCallback(async () => {
    try {
      await loadJobs();
      reportError("jobs", "");
    } catch (requestError) {
      reportError("jobs", (requestError as Error).message);
    }
  }, [loadJobs, reportError]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("mydgx-theme", theme);
  }, [theme]);

  useEffect(() => {
    applyFontScale(fontScale);
    localStorage.setItem("mydgx-font-scale", String(fontScale));
    localStorage.removeItem("mydgx-font-step");
  }, [fontScale]);

  const loadedSignature = (overview?.running_profiles ?? [])
    .map((profile) => `${profile.id}:${(profile.models ?? []).join(",")}`)
    .join("|");
  useEffect(() => {
    if (view !== "models") return;
    const timer = window.setTimeout(() => void refreshModels(), 0);
    return () => window.clearTimeout(timer);
  }, [loadedSignature, refreshModels, view]);

  useEffect(() => {
    localStorage.setItem("mydgx-view", view);
    const scrollKey = `mydgx-scroll-${view}`;
    const frame = window.requestAnimationFrame(() => {
      const stored = Number(localStorage.getItem(scrollKey) || 0);
      window.scrollTo({ top: Number.isFinite(stored) ? stored : 0 });
    });
    const rememberScroll = () => localStorage.setItem(scrollKey, String(window.scrollY));
    window.addEventListener("beforeunload", rememberScroll);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("beforeunload", rememberScroll);
      rememberScroll();
    };
  }, [view]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void refreshOverview();
      void refreshCore();
      void refreshModels();
    }, 0);
    const overviewTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshOverview();
    }, 3000);
    const coreTimer = window.setInterval(refreshCore, 5000);
    const modelTimer = window.setInterval(refreshModels, 7000);
    const jobTimer = window.setInterval(refreshJobs, 2000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(overviewTimer);
      window.clearInterval(coreTimer);
      window.clearInterval(modelTimer);
      window.clearInterval(jobTimer);
    };
  }, [refreshCore, refreshJobs, refreshModels, refreshOverview]);

  const runningProfileTotal = overview?.running_profiles?.length ?? 0;
  const loadedModelTotal = new Set(
    (overview?.running_profiles ?? []).flatMap((profile) => profile.models ?? []).map((name) => name.toLocaleLowerCase()),
  ).size;
  const hasActiveModels = loadedModelTotal > 0 || (models?.running.length ?? 0) > 0;
  const navCounts: Partial<Record<View, { value: number; title: string }>> = {
    profiles: { value: runningProfileTotal, title: `${runningProfileTotal} ${runningProfileTotal === 1 ? "perfil levantado" : "perfiles levantados"}` },
    models: { value: loadedModelTotal, title: `${loadedModelTotal} ${loadedModelTotal === 1 ? "modelo cargado" : "modelos cargados"}` },
  };
  const currentLabel = useMemo(() => navItems.find((item) => item.id === view)?.label ?? "MyDGX", [view]);
  const benchmarkSuiteJob = jobs.find(
    (job) => job.kind === "benchmark.suite" && activeJobStatuses.has(job.status),
  );
  function setTheme(next: Theme) { setThemeState(next); }

  let content: ReactNode;
  if (view === "dashboard") content = <Dashboard overview={overview} models={models} modelMetrics={modelMetrics} config={config} jobs={jobs} />;
  else if (view === "models") content = <ModelsView models={models} overview={overview} modelMetrics={modelMetrics} jobs={jobs} refresh={refreshModels} notify={notify} />;
  else if (view === "benchmarks") content = <BenchmarksView jobs={jobs} notify={notify} />;
  else if (view === "profiles") content = <ProfilesView jobs={jobs} notify={notify} />;
  else if (view === "engines") content = <EnginesView notify={notify} />;
  else if (view === "chat") content = <ChatView models={models} config={config} notify={notify} />;
  else if (view === "multimodal") content = <MultimodalLabView notify={notify} />;
  else if (view === "storage") content = <StorageView notify={notify} />;
  else if (view === "system") content = <SystemView config={config} jobs={jobs} overview={overview} notify={notify} />;
  else if (view === "logs") content = <LogsView notify={notify} />;
  else content = <SettingsView config={config} theme={theme} setTheme={setTheme} notify={notify} />;

  return (
    <div className="app-shell">
      <aside className={menuOpen ? "open" : ""}>
        <div className="brand"><Logo /><div><strong>MyDGX</strong><span>SPARK CONTROL</span></div><button className="mobile-close" onClick={() => setMenuOpen(false)}><X /></button></div>
        <nav>
          <span className="nav-label">MENÚ PRINCIPAL</span>
          {navItems.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => { setView(item.id); setMenuOpen(false); }}><Icon size={18} /><span>{item.label}</span>{navCounts[item.id]?.value ? <b className="nav-count" title={navCounts[item.id]?.title} aria-label={navCounts[item.id]?.title}>{navCounts[item.id]?.value}</b> : null}{item.id === "benchmarks" && benchmarkSuiteJob ? <b className="nav-running-dot" title={`Suite ${Math.round(benchmarkSuiteJob.progress)}%`} /> : null}{view === item.id && <ChevronRight size={14} />}</button>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="device-mini">
            <div className="device-image"><Cpu /></div>
            <div><strong>{overview ? (overview.host.is_dgx_spark ? overview.host.device_model : overview.host.hostname) : "Detectando equipo"}</strong><span><StatusDot online={Boolean(overview)} /> {overview ? `${overview.host.is_dgx_spark ? "DGX Spark / GB10" : "No DGX Spark"} · ${overview.host.is_dgx_os ? "DGX OS" : overview.host.os_family}` : "Conectando"}</span></div>
            {overview?.running_profiles?.length ? (
              <button className="device-profiles" onClick={() => { setView("profiles"); setMenuOpen(false); }} title="Ver perfiles">
                <small>{overview.running_profiles.length === 1 ? "Perfil activo" : "Perfiles activos"}</small>
                {overview.running_profiles.map((profile) => (
                  <div key={profile.id}>
                    <span>
                      <SlidersHorizontal size={11} />
                      <b>{profile.name}</b>
                      {profile.app ? <em><Rocket size={10} /> {profile.app}</em> : null}
                    </span>
                    {(profile.models ?? []).map((model) => <i key={model} title={model}>{model}</i>)}
                  </div>
                ))}
              </button>
            ) : null}
            <UnifiedMemoryMap models={models} overview={overview} modelMetrics={modelMetrics} compact />
          </div>
          <SidebarOperations jobs={jobs} />
        </div>
      </aside>
      {menuOpen && <button className="backdrop" onClick={() => setMenuOpen(false)} aria-label="Cerrar menú" />}
      <main>
        <header>
          <button className="menu-button" onClick={() => setMenuOpen(true)}><Menu /></button>
          <span>{currentLabel}</span>
          <div className="appearance-row">
            {hasActiveModels && <StopAllModelsButton notify={notify} onDone={() => { void refreshOverview(); void refreshModels(); }} />}
            <button className="theme-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}<span>Modo {theme === "dark" ? "día" : "noche"}</span></button>
            <FontSizeControl onChange={setFontScale} />
            {onLogout && <button className="session-logout" onClick={onLogout} title="Cerrar sesión" aria-label="Cerrar sesión"><LogOut size={16} /></button>}
          </div>
        </header>
        {error && <div className="error-banner"><ShieldCheck size={18} /><span>{error}</span><button onClick={() => { void refreshOverview(); void refreshCore(); void refreshModels(); }}>Reintentar</button></div>}
        <div className="content">{content}</div>
      </main>
      {toast && <div className={`toast ${toast.error ? "error" : ""}`}>{toast.error ? <ShieldCheck /> : <Sparkles />}<span>{toast.message}</span></div>}
    </div>
  );
}
