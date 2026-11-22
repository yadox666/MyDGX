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
  FileArchive,
  Film,
  Folder,
  Gauge,
  Globe,
  HardDrive,
  History,
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
  Plug,
  Plus,
  RefreshCw,
  Rocket,
  RotateCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  KeyRound,
  Bell,
  Sparkles,
  Square,
  Star,
  Languages,
  Sun,
  Terminal,
  Thermometer,
  TriangleAlert,
  Trash2,
  Trophy,
  ChevronDown,
  ListPlus,
  Upload,
  X,
  Zap,
  ChefHat,
  MemoryStick,
} from "lucide-react";
import { CSSProperties, FocusEvent, FormEvent, ReactNode, createElement, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import MarkdownMessage from "./MarkdownMessage";
import { language, languageHeader, locale, setLanguagePreference, storedLanguagePreference, t, type LanguagePreference } from "./i18n";
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

type View = "dashboard" | "models" | "benchmarks" | "profiles" | "engines" | "multimodal" | "storage" | "system" | "logs" | "settings";
type Theme = "light" | "dark";
type ThemePreference = Theme | "system";

function readSystemTheme(): Theme {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function storedThemePreference(): ThemePreference {
  const preference = localStorage.getItem("mydgx-theme-preference");
  if (preference === "system" || preference === "light" || preference === "dark") return preference;
  const legacy = localStorage.getItem("mydgx-theme");
  return legacy === "light" || legacy === "dark" ? legacy : "system";
}

function resolveTheme(preference: ThemePreference, systemTheme: Theme): Theme {
  return preference === "system" ? systemTheme : preference;
}
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
    device_variant: "nvidia" | "asus" | "hp" | "lenovo" | "dell" | "generic" | "other";
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
  firmware_updates_enabled?: boolean;
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
  web_search?: boolean;
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
        {model.context_length ? <em>{Math.round(model.context_length / 1024)}{t("k ctx")}</em> : null}
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

type HealthFinding = {
  id: string;
  severity: "info" | "warning" | "critical";
  category: string;
  title: string;
  detail: string;
  evidence: string;
  remediation: string;
  confidence: "low" | "medium" | "high";
  source_note: string;
  active: boolean;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
  occurrences: number;
};

type HealthCheckStatus = "ok" | "warning" | "critical" | "unknown" | "not_applicable";

type HealthCheck = {
  id: string;
  kind: "gpu" | "memory" | "storage" | "kernel" | "runtime" | "services" | "inference";
  label: string;
  status: HealthCheckStatus;
  value: string;
  threshold: string;
};

type HealthCenter = {
  status: "healthy" | "warning" | "critical";
  diagnosis: {
    complete: boolean;
    collectors: Array<{ id: string; status: "ok" | "error" | "not_applicable"; detail: string }>;
  };
  summary: { critical: number; warning: number; info: number; resolved: number };
  findings: HealthFinding[];
  checks: HealthCheck[];
  kernel: {
    available: boolean | null;
    scope: "current_boot";
    sources?: { dmesg: boolean; journal: boolean };
    xid_count: number | null;
    xid_codes?: number[];
    oom_count: number | null;
    host_oom_count?: number | null;
    cgroup_oom_count?: number | null;
    thermal_count?: number | null;
    error?: string;
  };
  runtime: { python?: string; docker?: string; journal?: string; python_detail?: string };
  evaluated_at: string;
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

type FirmwareStatus = {
  supported: boolean;
  updates: Array<{
    device_id: string;
    name: string;
    vendor: string;
    current_version: string;
    new_version: string;
    summary: string;
    description: string;
    urgency: string;
    needs_reboot: boolean;
  }>;
  reboot_pending: boolean;
  connectx: { name: string; package_version: string; running_version: string; state: "cable_required" | "pending" | "current" | "unknown" } | null;
  checked_at: string;
  message: string;
};

type QuickStart = {
  supported: boolean;
  fits: boolean;
  reason: string;
  incremental_mb?: number;
  spare_mb?: number;
  context?: { context_min: number; context_max: number; memory_min_mb: number; memory_max_mb: number };
};

type MemoryEstimate = {
  memory_mb: number;
  context_size: number;
  native_context?: number;
  cache_type: string;
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
    memory_estimate?: MemoryEstimate | null;
    manual_settings?: boolean;
    speculative?: { spec_type: string; draft_filename: string };
    health?: ModelHealth | null;
  }>;
};

type ModelHealth = { status: "healthy" | "defective" | "incomplete"; reason: string; file?: string; at?: string };

function HealthyShield({ health }: { health: ModelHealth }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const tested = health.at ? new Date(health.at).toLocaleString(locale) : "";
  const label = t("Modelo sano: superó el benchmark");
  const show = () => {
    const rect = anchor.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom + 6, left: Math.min(Math.max(rect.left + rect.width / 2, 150), window.innerWidth - 150) });
  };
  const hide = () => setPosition(null);
  return <>
    <span
      ref={anchor}
      className="model-health-shield"
      role="img"
      tabIndex={0}
      aria-label={label}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    ><ShieldCheck size={14} strokeWidth={2.4} /></span>
    {position && createPortal(
      <div className="model-health-tooltip" role="tooltip" style={{ top: position.top, left: position.left }}>
        <strong>{label}</strong>
        {health.file && <small>{health.file}</small>}
        {tested && <small>{t("Probado {date}", { date: tested })}</small>}
      </div>,
      document.body,
    )}
  </>;
}

function ModelHealthBadge({ health }: { health: ModelHealth }) {
  if (health.status === "healthy") return <HealthyShield health={health} />;
  const label = health.status === "incomplete" ? t("INCOMPLETO") : t("DEFECTUOSO");
  const detail = health.file ? `${health.file}: ${health.reason}` : health.reason;
  return <span className={`badge model-health ${health.status}`} title={detail}><TriangleAlert size={11} />{" "}{label}</span>;
}

function searchStateClass(text: string, resultCount: number | null) {
  if (!text.trim()) return "";
  return resultCount === 0 ? " search-active search-empty" : " search-active";
}

function searchCountLabel(text: string, resultCount: number | null) {
  if (!text.trim() || resultCount === null) return undefined;
  return t(resultCount === 1 ? "{count} resultado" : "{count} resultados", { count: resultCount });
}

const HF_RECENT_SEARCHES_KEY = "mydgx-hf-recent-searches";

function storedHfSearches() {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(HF_RECENT_SEARCHES_KEY) || "[]");
    return Array.isArray(values)
      ? values.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

const UNCENSORED_PATTERN = /uncensored|abliterat|\bablit|heretic|derestrict|unrestrict|unleashed|unfiltered|nsfw|dolphin/i;

const UNCENSORED_KINDS: Array<[RegExp, string]> = [
  [/abliterat|ablit/i, "Abliterated"],
  [/heretic/i, "Heretic"],
  [/derestrict/i, "Derestricted"],
  [/unrestrict/i, "Unrestricted"],
  [/unleashed/i, "Unleashed"],
  [/unfiltered/i, "Unfiltered"],
  [/nsfw/i, "NSFW"],
];

function UncensoredBadge({ name, flagged = false, showKind = false }: { name: string; flagged?: boolean; showKind?: boolean }) {
  if (!flagged && !UNCENSORED_PATTERN.test(name)) return null;
  const kind = showKind ? UNCENSORED_KINDS.find(([pattern]) => pattern.test(name))?.[1] : undefined;
  return <span className="badge uncensored" title={t("Modelo sin filtros de seguridad (uncensored, abliterated o similar), según su nombre o las etiquetas y el modelo base de su ficha")}>{kind ?? t("Uncensored")}</span>;
}

const RECIPE_PREFIX = /^RECIPE\s*[·:-]\s*/i;

function ProfileName({ name, as: Tag = "strong" }: { name: string; as?: "strong" | "b" }) {
  const label = name.replace(RECIPE_PREFIX, "");
  return <Tag className="profile-name" title={name}>
    {label !== name && <span className="badge recipe" title={t("Receta de MyDGX: perfil medido que se instala con MyDGX y descarga sus modelos al pedirlo")}>RECIPE</span>}
    {label}
  </Tag>;
}

type ModelGlossaryEntry = {
  id: string;
  term: string;
  summary: string;
  category: "Tamaño y precisión" | "Arquitectura y velocidad" | "Uso" | "Formato y runtime" | "Entrenamiento y variantes" | "Alineación y acceso";
  patterns: RegExp[];
};

const MODEL_GLOSSARY: ModelGlossaryEntry[] = [
  { id: "parameters", term: t("7B, 32B, 120B · Parámetros"), summary: t("Tamaño aproximado del cerebro del modelo. Más parámetros suelen requerir más memoria; no garantizan que sea mejor."), category: "Tamaño y precisión", patterns: [/\b\d+(?:\.\d+)?b\b/i, /parameter/i] },
  { id: "q2-q3", term: "Q2 / Q3", summary: t("Cuantización muy comprimida. Ocupa poco y suele ser rápida, pero pierde más calidad."), category: "Tamaño y precisión", patterns: [/\bq[23](?:_[a-z0-9]+)?\b/i, /\biq[23](?:_[a-z0-9]+)?\b/i] },
  { id: "q4-q5", term: "Q4 / Q5", summary: t("Equilibrio habitual entre calidad, memoria y velocidad. Q4_K_M suele ser un buen punto de partida."), category: "Tamaño y precisión", patterns: [/\bq[45](?:_[a-z0-9]+)?\b/i, /\biq4(?:_[a-z0-9]+)?\b/i] },
  { id: "q6-q8", term: "Q6 / Q8", summary: t("Más fidelidad y mayor consumo. Q8 conserva mucha calidad, pero no siempre mejora lo suficiente para justificar su tamaño."), category: "Tamaño y precisión", patterns: [/\bq[678](?:_[a-z0-9]+)?\b/i, /\bint8\b/i] },
  { id: "k-variants", term: "K_S / K_M / K_L", summary: t("Variantes de una cuantización GGUF. S prioriza tamaño, M equilibrio y L algo más de calidad."), category: "Tamaño y precisión", patterns: [/\bq\d+_k_[sml]\b/i, /\bk_[sml]\b/i] },
  { id: "iq", term: "IQ", summary: t("Cuantización inteligente de llama.cpp. Busca conservar más calidad con muy pocos bits."), category: "Tamaño y precisión", patterns: [/\biq\d/i] },
  { id: "bpw", term: t("BPW · bits por peso"), summary: t("Promedio de bits usados por cada peso. Menos BPW reduce memoria y descarga, pero puede degradar la calidad."), category: "Tamaño y precisión", patterns: [/\bbpw\b/i, /bits?.per.weight/i, /bits?.por.peso/i] },
  { id: "imatrix", term: t("Importance matrix · imatrix · i1"), summary: t("Muestra de activaciones usada para decidir qué pesos necesitan más precisión durante la cuantización. Los repos «i1-GGUF» (por ejemplo de mradermacher) son cuantizaciones con imatrix; las «static» no la usan."), category: "Tamaño y precisión", patterns: [/\bimatrix\b/i, /importance.matrix/i, /\bi1\b/i] },
  { id: "nvfp4", term: "NVFP4", summary: t("Formato de 4 bits de NVIDIA para GPU Blackwell, como el GB10 del Spark, que lo acelera por hardware. Escala cada bloque de 16 valores para perder menos calidad que un INT4. Pensado para vLLM, TensorRT-LLM o SGLang; no es un GGUF."), category: "Tamaño y precisión", patterns: [/\bnvfp4\b/i] },
  { id: "unsloth-dynamic", term: t("UD / K_XL · cuantización dinámica"), summary: t("Cuantizaciones dinámicas de Unsloth: dan más bits a las capas sensibles y menos al resto. A igual tamaño suelen rendir algo mejor que un Q estándar; K_XL es su variante más grande dentro de cada nivel."), category: "Tamaño y precisión", patterns: [/(?:^|[-_.\s/])ud[-_.]/i, /_k_xl\b/i, /unsloth.dynamic/i] },
  { id: "low-bit", term: t("Ternary / BitNet / 1.58-bit"), summary: t("Pesos con solo tres valores (-1, 0, 1) o muy pocos bits. Ocupan muy poco, pero el modelo debe entrenarse así desde el principio y necesita kernels específicos."), category: "Tamaño y precisión", patterns: [/\bternary\b/i, /\bbitnet\b/i, /1\.58.?bit/i] },
  { id: "effective-parameters", term: t("E2B / E4B · parámetros efectivos"), summary: t("Usado por Gemma 3n y Gemma 4: el modelo calcula como uno de ese tamaño, pero guarda más pesos, por ejemplo embeddings por capa. La memoria real puede superar lo que sugiere el número."), category: "Tamaño y precisión", patterns: [/\be\d+(?:\.\d+)?b\b/i] },
  { id: "fp-bf", term: "FP16 / BF16 / FP32", summary: t("Pesos con alta precisión. Son fieles, pero ocupan bastante más memoria que una cuantización."), category: "Tamaño y precisión", patterns: [/\bfp(?:16|32)\b/i, /\bbf16\b/i, /float(?:16|32)/i] },
  { id: "fp8-mxfp4", term: "FP8 / MXFP4 / INT4", summary: t("Formatos compactos usados por motores GPU. MXFP4 es especialmente interesante para GPT-OSS en el Spark."), category: "Tamaño y precisión", patterns: [/\bfp8\b/i, /\bmxfp4\b/i, /\bint4\b/i] },
  { id: "dense", term: t("Dense · Denso"), summary: t("Activa casi todos sus parámetros en cada token. Es sencillo, pero los modelos grandes pueden ser lentos por el ancho de banda."), category: "Arquitectura y velocidad", patterns: [/\bdense\b/i, /\bdenso\b/i] },
  { id: "moe", term: "MoE · Mixture of Experts", summary: t("Tiene muchos parámetros totales, pero usa solo algunos expertos por token. Suele encajar muy bien con DGX Spark."), category: "Arquitectura y velocidad", patterns: [/\bmoe\b/i, /mixture.of.experts/i, /\bexperts?\b/i, /\b\d+x\d+(?:\.\d+)?b\b/i] },
  { id: "active-parameters", term: t("Parámetros activos · A3B / A22B"), summary: t("Parte del modelo MoE utilizada para cada token. Explica por qué un modelo enorme puede responder con rapidez."), category: "Arquitectura y velocidad", patterns: [/active.parameters/i, /parámetros activos/i, /\b\d+(?:\.\d+)?b activos\b/i, /\ba\d+(?:\.\d+)?b\b/i] },
  { id: "expert-pruning", term: t("Expert pruning · poda de expertos"), summary: t("Elimina expertos de un MoE para reducir memoria. Puede conservar bien una especialidad y perder calidad en otros usos."), category: "Arquitectura y velocidad", patterns: [/expert.prun/i, /pruned.expert/i, /poda.de.expert/i] },
  { id: "reap", term: "REAP", summary: t("Método que puntúa y poda expertos según su contribución. Reduce mucho el modelo, pero la calidad depende de los datos usados para calibrarlo."), category: "Arquitectura y velocidad", patterns: [/\breap(?:\d+)?\b/i] },
  { id: "gsq-rco", term: "GSQ / RCO", summary: t("Técnicas de cuantización y selección de expertos. GSQ comprime pesos; RCO elige qué expertos conservar bajo un límite exacto."), category: "Arquitectura y velocidad", patterns: [/\bgsq\b/i, /\brco\b/i] },
  { id: "engram", term: t("Engram"), summary: t("Grandes tablas de memoria consultadas por token. Pueden permanecer en un NVMe rápido mediante mmap y no ocupar toda la RAM."), category: "Arquitectura y velocidad", patterns: [/\bengram\b/i, /\.v41rows\b/i] },
  { id: "mtp", term: t("MTP · Multi-Token Prediction"), summary: t("Capas extra que proponen varios tokens por adelantado; el modelo los valida y la generación se acelera. Pueden venir dentro del GGUF o en un archivo aparte (mtp-*.gguf) que se descarga junto al modelo. MyDGX lo detecta y lo activa en el perfil; si falta el archivo, arranca sin él."), category: "Arquitectura y velocidad", patterns: [/\bmtp\b/i, /multi.token.prediction/i, /\bnextn\b/i] },
  { id: "speculative", term: t("Speculative decoding"), summary: t("Un modelo pequeño propone tokens y el principal los valida. Puede aumentar bastante la velocidad."), category: "Arquitectura y velocidad", patterns: [/speculative/i, /\bdraft(?: model)?\b/i, /\bdspark\b/i, /\bdflash\d*\b/i, /\beagle\d?\b/i] },
  { id: "drafter", term: t("Drafter · modelo borrador"), summary: t("El modelo pequeño que propone tokens en la decodificación especulativa. Puede ser un archivo aparte (mtp-*.gguf, DFlash, EAGLE3 o un modelo pequeño de la misma familia) o venir dentro del GGUF. Debe compartir vocabulario con el modelo principal, y los MTP solo sirven para el modelo con el que se entrenaron. Ocupa algo de memoria extra y en llama.cpp no se combina con visión (mmproj)."), category: "Arquitectura y velocidad", patterns: [/\bdrafters?\b/i, /draft.?model/i, /modelo.borrador/i] },
  { id: "gqa", term: "GQA / MQA", summary: t("Reduce el coste de atención y de la caché KV. Ayuda especialmente con contextos largos."), category: "Arquitectura y velocidad", patterns: [/\bgqa\b/i, /\bmqa\b/i, /grouped.query/i] },
  { id: "flash-attention", term: t("Flash Attention"), summary: t("Implementación de atención más rápida y eficiente en memoria cuando el runtime y la GPU la soportan."), category: "Arquitectura y velocidad", patterns: [/flash.?attention/i, /\bfa2\b/i, /\bfa3\b/i] },
  { id: "flash-line", term: t("Flash · nombre de familia"), summary: t("Etiqueta comercial, no técnica: suele indicar la variante rápida y barata de una familia, a menudo un MoE con pocos parámetros activos. No tiene relación con Flash Attention; compara tamaño, parámetros activos y benchmarks."), category: "Arquitectura y velocidad", patterns: [/[-_.]flash\b(?![-_ ]?att)/i] },
  { id: "next-line", term: t("Next · nueva generación"), summary: t("Marca una generación nueva de la arquitectura (por ejemplo Qwen3-Next o Qwen3-Coder-Next), con cambios internos como atención híbrida o MoE más disperso. Necesita un llama.cpp reciente que la reconozca."), category: "Arquitectura y velocidad", patterns: [/[-_.]next\b/i] },
  { id: "hybrid-ssm", term: t("Hybrid / Mamba / SSM"), summary: t("Mezcla capas de atención con capas de estado (Mamba, SSM o atención lineal). Reduce la caché KV y acelera los contextos largos; necesita un llama.cpp o motor que conozca la arquitectura."), category: "Arquitectura y velocidad", patterns: [/\bmamba\d?\b/i, /\bssm\b/i, /hybrid.attention/i, /nemotron.?h\b/i, /linear.attention/i] },
  { id: "tier-names", term: t("Nano / Mini / Lite / Pro / Max / Ultra"), summary: t("Etiquetas comerciales de gama dentro de una familia. Indican el tamaño relativo, no una técnica; compara parámetros, memoria y benchmarks entre fabricantes."), category: "Arquitectura y velocidad", patterns: [/[-_.](?:nano|mini|tiny|lite|air|small|medium|large|pro|max|ultra|plus|super)\b/i] },
  { id: "turbo-lightning", term: t("Turbo / Lightning / Schnell"), summary: t("Variantes destiladas para generar en menos pasos, sobre todo en imagen y vídeo. Son mucho más rápidas y a cambio pierden algo de detalle o fidelidad al prompt."), category: "Arquitectura y velocidad", patterns: [/\bturbo\b/i, /\blightning\b/i, /\bschnell\b/i, /\bhyper.?sd\b/i, /\blcm\b/i] },
  { id: "kv-cache", term: "KV cache", summary: t("Memoria de la conversación ya procesada. Crece con el contexto, los slots y el tamaño del modelo."), category: "Arquitectura y velocidad", patterns: [/\bkv(?:.|_)?cache\b/i] },
  { id: "omni", term: t("Omni / any-to-any"), summary: t("Un solo modelo que acepta y genera varias modalidades: texto, imagen, audio o vídeo. Necesita un runtime que soporte todas las entradas y salidas que quieras usar."), category: "Uso", patterns: [/\bomni\b/i, /any.to.any/i] },
  { id: "ocr", term: t("OCR / documentos"), summary: t("Modelos especializados en leer texto de imágenes, PDF escaneados o tablas. Suelen ser pequeños y precisos, pero no sirven para conversar."), category: "Uso", patterns: [/\bocr\b/i, /docling/i, /document.(?:parsing|understanding)/i] },
  { id: "coder-fim", term: t("Coder / FIM"), summary: t("Ajustado para programar. FIM (fill-in-the-middle) completa código entre dos fragmentos, que es lo que usan los autocompletados del editor."), category: "Uso", patterns: [/\bcoder\b/i, /\bcoding\b/i, /\bfim\b/i, /fill.in.the.middle/i, /\bcode\b/i] },
  { id: "guard-safety", term: t("Guard / safety"), summary: t("Clasificadores que deciden si una petición o respuesta es segura. Se colocan delante o detrás del modelo de chat; no responden como un asistente."), category: "Uso", patterns: [/\bguard\b/i, /\bsafety\b/i, /shield/i] },
  { id: "roleplay", term: t("Roleplay / RP / creative"), summary: t("Ajustes comunitarios para escritura creativa e interpretación de personajes. Priorizan estilo y continuidad sobre precisión; «unslop» indica que intentan evitar frases repetidas."), category: "Uso", patterns: [/role.?play/i, /\brp\b/i, /creative.writing/i, /\bunslop\b/i, /\bstory/i] },
  { id: "context", term: t("Contexto · 8K / 32K / 128K"), summary: t("Cantidad máxima de texto que el modelo puede recordar de una petición. Más contexto consume más memoria."), category: "Uso", patterns: [/\bcontext\b/i, /\bcontexto\b/i, /\b\d+k\b/i] },
  { id: "slots", term: t("Slots / concurrencia"), summary: t("Peticiones que el servidor puede atender a la vez. Cada slot añade caché y consumo de memoria."), category: "Uso", patterns: [/\bslots?\b/i, /concurren/i, /parallel/i] },
  { id: "instruct-base", term: t("Base / Instruct / Chat"), summary: t("Base es el modelo sin adaptar; Instruct o Chat está preparado para seguir órdenes y conversar."), category: "Uso", patterns: [/\bbase\b/i, /\binstruct\b/i, /-it\b/i, /-pt\b/i, /\bchat\b/i] },
  { id: "reasoning", term: t("Reasoning / Thinking"), summary: t("Optimizado para resolver problemas paso a paso. Puede ser más capaz, pero también más lento y verboso."), category: "Uso", patterns: [/reasoning/i, /thinking/i, /\breasoner\b/i] },
  { id: "rag", term: "RAG", summary: t("Busca información en tus documentos y la añade al prompt antes de responder. No reentrena el modelo."), category: "Uso", patterns: [/\brag\b/i, /retrieval.augmented/i] },
  { id: "agents-tools", term: t("Agentes / tool calling"), summary: t("El modelo puede elegir y llamar herramientas, APIs o funciones. Requiere una plantilla y un runtime compatibles."), category: "Uso", patterns: [/\bagents?\b/i, /agentic/i, /tool.call/i, /tool.use/i, /function.call/i, /computer.use/i] },
  { id: "embeddings-reranker", term: t("Embeddings / Reranker"), summary: t("Embeddings convierten texto en vectores; un reranker reordena resultados. No son modelos de chat."), category: "Uso", patterns: [/embedding/i, /\bembed\b/i, /rerank/i, /\b(?:bge|e5|gte|minilm|mpnet|mxbai|splade)\b/i, /nomic.embed/i, /jina.embed/i] },
  { id: "asr-tts", term: "ASR / STT / TTS", summary: t("ASR o STT transcribe voz a texto. TTS convierte texto en voz."), category: "Uso", patterns: [/\basr\b/i, /\bstt\b/i, /\btts\b/i, /whisper/i, /\bspeech\b/i, /text.to.speech/i, /speech.to.text/i, /\b(?:parakeet|canary|voxtral|moonshine|kokoro|chatterbox)\b/i, /wav2vec/i] },
  { id: "voice-cloning", term: t("Voice cloning / speaker embedding"), summary: t("Imita una voz usando una muestra o una representación del hablante. Usa solo voces con permiso."), category: "Uso", patterns: [/voice.clon/i, /speaker.embedding/i, /reference.audio/i, /zero.shot.voice/i] },
  { id: "vocoder-codec", term: t("Vocoder / audio codec"), summary: t("Un vocoder convierte representaciones acústicas en audio. Un codec comprime audio en tokens que otro modelo puede procesar."), category: "Uso", patterns: [/\bvocoder\b/i, /\bvocos\b/i, /audio.codec/i, /codec.model/i] },
  { id: "vad-diarization", term: t("VAD / diarización"), summary: t("VAD detecta cuándo hay voz; la diarización separa quién habla en una grabación."), category: "Uso", patterns: [/\bvad\b/i, /diari[sz]/i, /speaker.separation/i] },
  { id: "vision-mmproj", term: t("Vision / mmproj"), summary: t("mmproj es el proyector que permite a ciertos GGUF entender imágenes. Debe descargarse junto al modelo."), category: "Uso", patterns: [/mmproj/i, /vision/i, /image.text/i, /multimodal/i, /\bvlm?\b/i, /\bvit\b/i] },
  { id: "diffusion", term: t("Diffusion / checkpoint"), summary: t("Familia habitual para generar imagen o vídeo. ComfyUI carga sus checkpoints; no funciona como un chat GGUF."), category: "Uso", patterns: [/diffusion/i, /diffusers/i, /checkpoint/i, /\bflux\d?\b/i, /wan(?:2|\b)/i, /\bsdxl\b/i, /\bsd\d(?:\.\d)?\b/i, /image.edit/i, /[-_.]edit\b/i] },
  { id: "vae-clip", term: "VAE / CLIP / text encoder", summary: t("CLIP o el text encoder entiende el prompt; el VAE transforma entre imagen y espacio latente. Suelen acompañar al checkpoint."), category: "Uso", patterns: [/\bvae\b/i, /\bclip\b/i, /text.encoder/i] },
  { id: "controlnet-upscaler", term: "ControlNet / Upscaler", summary: t("ControlNet guía composición, pose o bordes. Un upscaler aumenta resolución y detalle después de generar."), category: "Uso", patterns: [/\bcontrolnet\b/i, /\bupscal/i, /\bsuper.resolution\b/i] },
  { id: "t2v-i2v", term: "T2V / I2V / V2V", summary: t("Texto a vídeo, imagen a vídeo o vídeo a vídeo. Más duración, resolución y FPS requieren mucha más memoria y tiempo."), category: "Uso", patterns: [/\bt2v\b/i, /\bi2v\b/i, /\bv2v\b/i, /text.to.video/i, /image.to.video/i, /\bti2v\b/i, /\bltx/i, /hunyuanvideo/i] },
  { id: "fps-frames", term: "FPS / frames", summary: t("Fotogramas por segundo y número total de imágenes del vídeo. Duplicarlos suele acercarse a duplicar el trabajo."), category: "Uso", patterns: [/\bfps\b/i, /\bframes?\b/i, /fotogram/i] },
  { id: "gguf", term: "GGUF", summary: t("Formato preparado para llama.cpp. Es la opción más directa para ejecutar LLM cuantizados localmente."), category: "Formato y runtime", patterns: [/\bgguf\b/i, /\bggml\b/i] },
  { id: "safetensors", term: t("Safetensors"), summary: t("Formato seguro de pesos, habitual en Hugging Face. Necesita un runtime compatible como vLLM, ComfyUI o Transformers."), category: "Formato y runtime", patterns: [/safetensors/i] },
  { id: "shards", term: t("Shards · partes 00001-of-00004"), summary: t("Un modelo dividido en varios archivos. Hay que descargar todas las partes de la misma cuantización."), category: "Formato y runtime", patterns: [/shard/i, /\d{5}-of-\d{5}/i] },
  { id: "lora", term: "LoRA / Adapter", summary: t("Adaptación pequeña aplicada sobre un modelo base. Puede cambiar estilo, voz o capacidad, pero normalmente no incluye el modelo completo."), category: "Formato y runtime", patterns: [/\bq?lora\b/i, /\bdora\b/i, /\badapter\b/i, /\bpeft\b/i] },
  { id: "mlx", term: "MLX", summary: t("Runtime y formato optimizados para Apple Silicon. No es la opción nativa para un DGX Spark con CUDA."), category: "Formato y runtime", patterns: [/\bmlx\b/i, /mlx.community/i] },
  { id: "pytorch-transformers", term: "PyTorch / Transformers", summary: t("Ecosistema general para cargar modelos originales y safetensors. Flexible, aunque suele consumir más recursos que un runtime optimizado."), category: "Formato y runtime", patterns: [/\bpytorch\b/i, /\btransformers\b/i, /\btorch\b/i] },
  { id: "onnx", term: "ONNX", summary: t("Formato portable para inferencia. Necesita ONNX Runtime, TensorRT u otro motor compatible."), category: "Formato y runtime", patterns: [/\bonnx\b/i] },
  { id: "awq-gptq", term: "AWQ / GPTQ / EXL2 / EXL3", summary: t("Cuantizaciones para runtimes GPU específicos. No son GGUF y requieren un motor compatible."), category: "Formato y runtime", patterns: [/\bawq\b/i, /\bgptq\b/i, /\bexl[23]\b/i] },
  { id: "mmap-offload", term: "mmap / offload", summary: t("mmap lee pesos desde disco bajo demanda; offload reparte trabajo entre GPU, RAM o NVMe. Ahorra memoria, pero puede ser más lento."), category: "Formato y runtime", patterns: [/\bmmap\b/i, /\boffload/i, /lazy.mode/i] },
  { id: "runtimes", term: "llama.cpp / Ollama / vLLM / SGLang / TensorRT-LLM", summary: t("Son motores que cargan y sirven el modelo. El formato correcto depende del motor elegido."), category: "Formato y runtime", patterns: [/llama\.?cpp/i, /\bollama\b/i, /\bvllm\b/i, /\bsglang\b/i, /tensorrt/i] },
  { id: "comfyui", term: "ComfyUI / workflow / node", summary: t("Interfaz por nodos para encadenar modelos de imagen, vídeo y audio. Un workflow define el proceso completo."), category: "Formato y runtime", patterns: [/\bcomfyui\b/i, /\bworkflow\b/i, /custom.node/i] },
  { id: "gpu-quant", term: "W4A16 / bnb / AutoRound / 4bit", summary: t("Cuantizaciones para Transformers, vLLM u Optimum: W4A16 indica pesos de 4 bits y activaciones de 16; bnb es bitsandbytes. No son GGUF, así que llama.cpp no las carga."), category: "Formato y runtime", patterns: [/\bw\d+a\d+\b/i, /\bbnb\b/i, /bitsandbytes/i, /autoround/i, /compressed.tensors/i, /\b[2-8].?bit\b/i] },
  { id: "edge-runtime", term: "OpenVINO / RKNN / LiteRT", summary: t("Formatos para CPU Intel, NPU de Rockchip o móviles. No aprovechan la GPU del Spark; busca la versión GGUF o safetensors del mismo modelo."), category: "Formato y runtime", patterns: [/openvino/i, /\brknn\b/i, /\brk18\d+/i, /litert/i, /\btflite\b/i, /on.device/i] },
  { id: "training", term: "SFT / DPO / GRPO / RL", summary: t("Etapas de entrenamiento posteriores al preentrenamiento. SFT enseña con ejemplos; DPO y ORPO con pares de respuestas preferidas; GRPO y RL con recompensas, habitual en modelos de razonamiento."), category: "Entrenamiento y variantes", patterns: [/\bsft\b/i, /\bdpo\b/i, /\borpo\b/i, /\bgrpo\b/i, /\bkto\b/i, /\brlhf\b/i, /[-_.]rl\b/i, /reinforcement.learning/i] },
  { id: "distill", term: t("Distill · destilado"), summary: t("Modelo pequeño entrenado para imitar a uno mayor, como R1-Distill o los «Opus distill» de la comunidad. Hereda estilo y razonamiento, pero no todo su conocimiento; revisa la licencia y el origen de los datos."), category: "Entrenamiento y variantes", patterns: [/distil/i] },
  { id: "finetune-cpt", term: t("Fine-tune / CPT"), summary: t("Fine-tune ajusta un modelo existente con datos propios; CPT (continued pretraining) sigue preentrenándolo con mucho texto de un idioma o dominio. Su calidad depende de quién lo hizo y con qué datos."), category: "Entrenamiento y variantes", patterns: [/fine.?tun/i, /\bft\b/i, /\bcpt\b/i, /continued.pretrain/i] },
  { id: "qat", term: "QAT", summary: t("Quantization-aware training: el modelo se entrena sabiendo que se cuantizará. Una versión QAT en 4 bits suele conservar más calidad que cuantizar después."), category: "Entrenamiento y variantes", patterns: [/\bqat\b/i, /quantization.aware/i] },
  { id: "merge", term: t("Merge / mergekit"), summary: t("Combina los pesos de varios modelos (SLERP, TIES, DARE…) sin reentrenar. Puede mezclar cualidades, pero el resultado es irregular y depende mucho de la receta."), category: "Entrenamiento y variantes", patterns: [/\bmerged?\b/i, /mergekit/i, /\bslerp\b/i, /\bties\b/i, /frankenmerge/i] },
  { id: "preview", term: t("Preview / experimental"), summary: t("Versión temprana publicada para probar. Puede cambiar, tener errores de plantilla o desaparecer; para uso diario conviene la versión estable."), category: "Entrenamiento y variantes", patterns: [/\bpreview\b/i, /experimental/i, /[-_.]exp\b/i, /\balpha\b/i, /\bbeta\b/i] },
  { id: "nsfw", term: t("NSFW / not-for-all-audiences"), summary: t("Hugging Face marca así modelos o tarjetas con contenido adulto o sensible. Requiere confirmar la edad en la web; revisa el uso permitido."), category: "Alineación y acceso", patterns: [/\bnsfw\b/i, /not.for.all.audiences/i] },
  { id: "uncensored", term: t("Uncensored · Sin censura"), summary: t("Versión comunitaria ajustada para rechazar menos peticiones. No significa que sea oficial, exacta ni libre de límites."), category: "Alineación y acceso", patterns: [/uncensored/i, /uncensor/i, /sin censura/i] },
  { id: "abliterated", term: t("Abliterated"), summary: t("Modelo modificado para reducir mecanismos de rechazo. Puede cambiar su calidad o comportamiento respecto al original."), category: "Alineación y acceso", patterns: [/abliterat/i, /obliterat/i, /\bablit\b/i, /\bablated\b/i, /refusal.direction/i] },
  { id: "heretic", term: t("Heretic"), summary: t("Nombre usado por algunas variantes comunitarias con menos rechazos. Revisa siempre autor, pruebas y modelo base."), category: "Alineación y acceso", patterns: [/\bheretic\b/i, /\bheres(?:y|ies)\b/i] },
  { id: "derestricted", term: t("Derestricted / No-refusal"), summary: t("Otra etiqueta para modelos modificados con menos restricciones. No garantiza cero rechazos."), category: "Alineación y acceso", patterns: [/derestrict/i, /decensor/i, /no.?refusal/i, /unrestrict/i, /unfiltered/i] },
  { id: "gated", term: t("Gated / Restricted"), summary: t("Hugging Face exige iniciar sesión, aceptar condiciones o pedir acceso antes de descargar."), category: "Alineación y acceso", patterns: [/\bgated\b/i, /\brestricted\b/i] },
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
    title={terms.length ? t("Explicar: {terms}", { terms: terms.map((term) => term.term).join(", ") }) : t("Abrir ayuda de términos de modelos")}
    aria-label={t("Explicar términos de {label}", { label: label })}
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
  return <div className="model-help-overlay" role="dialog" aria-modal="true" aria-label={t("Ayuda rápida de modelos")} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <Card className="model-help-dialog">
      <SectionHeading eyebrow={request.parsed ? t("TÉRMINOS DETECTADOS") : t("GUÍA RÁPIDA · TL;DR")} title={request.title} action={<button className="icon-button" onClick={onClose} aria-label={t("Cerrar ayuda")}><X size={16} /></button>} />
      <div className="model-help-tldr"><Sparkles size={17} /><p><strong>{t("Regla rápida:")}</strong>{" "}{t("elige un modelo que quepa con margen. Para chat GGUF empieza por Q4_K_M o Q5; usa Q8 si priorizas fidelidad. MoE suele ser rápido en Spark. “Uncensored”, “Heretic” o “Abliterated” describen modificaciones comunitarias, no una garantía de calidad.")}</p></div>
      {categories.map((category) => <section className="model-help-category" key={category}>
        <h4>{t(category)}</h4>
        <div>{request.terms.filter((term) => term.category === category).map((term) => <article key={term.id}><strong>{term.term}</strong><p>{term.summary}</p></article>)}</div>
      </section>)}
    </Card>
  </div>;
}

const SPEC_LABELS: Record<string, string> = {
  "draft-mtp": "MTP",
  "draft-dspark": "DSpark",
  "draft-dflash": "DFlash",
  "draft-eagle3": "EAGLE-3",
  "draft-simple": t("Drafter"),
};

const ROLE_LABELS: Record<string, string> = { main: t("Modelo principal"), mmproj: t("Proyector visual") };

function shortContext(value?: number) {
  return value ? `${Math.round(value / 1024)}K` : "—";
}

function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? t("Drafter {value}", { value: SPEC_LABELS[role] ?? role });
}

function useDialogEscape(onClose: () => void) {
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
}

type PreflightFile = {
  filename: string;
  shards: number;
  expected_shards: number;
  size: number;
  role: string;
  architecture: string;
  quantization: string;
  native_context: number;
  embedded_mtp: boolean;
  runtime_supported: boolean | null;
  header_read: boolean;
  vocab_compatible?: boolean | null;
  memory_mb?: number;
  memory_context?: number;
};

type PreflightReport = {
  repo_id: string;
  total_bytes: number;
  capacity_mb: number;
  files: PreflightFile[];
  mmproj: string[];
  other_files: string[];
  suggested_draft: string[];
  warnings: string[];
};

type PendingDownload = {
  repoId: string;
  revision: string;
  files: string[];
  label: string;
  report?: PreflightReport;
  error?: string;
  onDone?: () => void;
};

function DownloadPreflightDialog({ pending, onCancel, onConfirm }: {
  pending: PendingDownload;
  onCancel: () => void;
  onConfirm: (extraFiles: string[]) => void;
}) {
  useDialogEscape(onCancel);
  const report = pending.report;
  return <div className="model-help-overlay" role="dialog" aria-modal="true" aria-label={t("Comprobación previa de {repoId}", { repoId: pending.repoId })} onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <Card className="model-help-dialog preflight-dialog">
      <SectionHeading eyebrow={t("COMPROBACIÓN PREVIA")} title={pending.repoId} action={<button className="icon-button" onClick={onCancel} aria-label={t("Cerrar comprobación")}><X size={16} /></button>} />
      {pending.error && <div className="profile-warning"><TriangleAlert size={15} />{t("No se pudieron leer las cabeceras: {error}. Puedes descargar igualmente; MyDGX lo verificará después en Benchmarks.", { error: pending.error })}</div>}
      {report && <>
        <p className="preflight-intro">
          {t("{size} en {count} archivo(s). Los datos de abajo salen de la cabecera GGUF de cada archivo, leída sin descargar los pesos.", { size: bytes(report.total_bytes), count: pending.files.length })}
        </p>
        <div className="preflight-files">
          {report.files.map((file) => <div className={`preflight-file ${file.role === "main" ? "main" : ""}`} key={file.filename}>
            <span className="badge">{roleLabel(file.role)}</span>
            <span className="preflight-name"><strong>{file.filename}</strong><small>
              {[
                file.architecture || (file.header_read ? "" : t("cabecera no leída")),
                file.quantization,
                file.shards > 1 || file.expected_shards > 1 ? `${file.shards}/${file.expected_shards} shards` : "",
                bytes(file.size),
                file.native_context ? t("contexto nativo {ctx}", { ctx: shortContext(file.native_context) }) : "",
                file.embedded_mtp ? t("MTP integrado") : "",
              ].filter(Boolean).join(" · ")}
            </small></span>
            <span className="preflight-checks">
              {file.runtime_supported === true && <span className="badge completed">{t("llama.cpp la reconoce")}</span>}
              {file.runtime_supported === false && <span className="badge failed">{t("llama.cpp no la reconoce")}</span>}
              {file.vocab_compatible === true && <span className="badge completed">{t("Vocabulario compatible")}</span>}
              {file.vocab_compatible === false && <span className="badge failed">{t("Vocabulario incompatible")}</span>}
              {file.memory_mb ? <span className={`badge ${file.memory_mb > report.capacity_mb ? "failed" : ""}`}>~{Math.ceil(file.memory_mb / 1024)}{" "}{t("GB con")}{" "}{shortContext(file.memory_context)}</span> : null}
            </span>
          </div>)}
          {report.mmproj.map((name) => <div className="preflight-file" key={name}><span className="badge">{roleLabel("mmproj")}</span><span className="preflight-name"><strong>{name}</strong></span></div>)}
        </div>
        {report.warnings.length > 0
          ? <ul className="preflight-warnings">{report.warnings.map((warning) => <li key={warning}><TriangleAlert size={13} /> {warning}</li>)}</ul>
          : <div className="preflight-ok"><CheckCircle2 size={15} />{" "}{t("Sin problemas detectados.")}</div>}
        <small className="preflight-note">{t("Al terminar, Benchmarks comprueba automáticamente que arranca y responde, y compara la memoria real con la estimada y la aceptación del drafter.")}</small>
      </>}
      <div className="preflight-actions">
        <button className="button secondary" onClick={onCancel}>{t("Cancelar")}</button>
        {report?.suggested_draft.length ? <button className="button secondary" onClick={() => onConfirm(report.suggested_draft)}><Plus size={14} />{" "}{t("Añadir drafter y descargar")}</button> : null}
        <button className="button primary" onClick={() => onConfirm([])}><Download size={14} />{" "}{t("Descargar")}</button>
      </div>
    </Card>
  </div>;
}

type SettingField = { value: number | string | null; auto: number | string | null; origin: string };

type ModelSettingsReport = {
  model_id: string;
  overrides: Record<string, string | number>;
  fields: Record<string, SettingField>;
  files: { filename: string; shards: number; size: number; quantization: string; architecture: string; context_length: number; runtime_supported: boolean | null; selected: boolean }[];
  mmproj: string[];
  mmproj_filename: string;
  context: { minimum: number; maximum: number; default: number; native: number; card: number; origin: string };
  speculative: {
    spec_type: string;
    draft_filename: string;
    spec_draft_n_max: number;
    origin: string;
    blocked_by_mmproj: boolean;
    candidates: { spec_type: string; draft_filename: string; size: number; quantization: string; architecture: string; embedded: boolean }[];
    runtime_supported: boolean | null;
  };
  estimated_memory_mb: number;
};

const ORIGIN_LABELS: Record<string, string> = {
  ficha: t("ficha del autor"),
  GGUF: t("cabecera GGUF"),
  manual: t("manual"),
  MyDGX: t("por defecto"),
  archivo: t("drafter detectado"),
};

const SAMPLING_FIELDS: { key: string; label: string; step: string }[] = [
  { key: "temperature", label: t("Temperatura"), step: "0.05" },
  { key: "top_p", label: t("Top P"), step: "0.01" },
  { key: "top_k", label: t("Top K"), step: "1" },
  { key: "min_p", label: t("Min P"), step: "0.01" },
  { key: "repeat_penalty", label: t("Repeat penalty"), step: "0.01" },
  { key: "presence_penalty", label: t("Presence penalty"), step: "0.05" },
];

function originLabel(origin: string) {
  return ORIGIN_LABELS[origin] ?? origin;
}

function ModelSettingsDialog({ modelId, notify, onClose, onSaved }: {
  modelId: string;
  notify: (message: string, error?: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  useDialogEscape(onClose);
  const [report, setReport] = useState<ModelSettingsReport | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function load(next: ModelSettingsReport) {
    setReport(next);
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(next.overrides)) {
      values[key] = key === "context_size" || key === "context_max" ? String(Math.round(Number(value) / 1024)) : String(value);
    }
    if (next.overrides.spec_type && next.overrides.spec_type !== "off") {
      values.spec = `${next.overrides.spec_type}|${next.overrides.draft_filename ?? ""}`;
    } else if (next.overrides.spec_type === "off") {
      values.spec = "off";
    }
    if ("mmproj_filename" in next.overrides) values.mmproj = next.overrides.mmproj_filename ? String(next.overrides.mmproj_filename) : "none";
    setDraft(values);
  }

  useEffect(() => {
    api<ModelSettingsReport>(`/api/models/settings?${new URLSearchParams({ model_id: modelId })}`)
      .then(load)
      .catch((error) => { notify((error as Error).message, true); onClose(); });
  }, [modelId]);

  const set = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  async function save(reset = false) {
    const body: Record<string, string | number | null> = { model_id: modelId };
    if (!reset) {
      const number = (key: string, scale = 1) => draft[key] !== undefined && draft[key] !== "" ? Number(draft[key]) * scale : null;
      body.model_filename = draft.model_filename || null;
      body.mmproj_filename = draft.mmproj === "none" ? "" : draft.mmproj || null;
      body.context_size = number("context_size", 1024);
      body.context_max = number("context_max", 1024);
      for (const field of SAMPLING_FIELDS) body[field.key] = number(field.key);
      body.cache_type_k = draft.cache_type_k || null;
      body.cache_type_v = draft.cache_type_v || null;
      if (draft.spec === "off") body.spec_type = "off";
      else if (draft.spec) {
        const [specType, draftFile] = draft.spec.split("|");
        body.spec_type = specType;
        body.draft_filename = draftFile || null;
      }
      body.spec_draft_n_max = number("spec_draft_n_max");
    }
    setBusy(true);
    try {
      load(await api<ModelSettingsReport>("/api/models/settings", { method: "PUT", body: JSON.stringify(body) }));
      notify(reset ? t("Ajustes restablecidos a los valores automáticos") : t("Ajustes guardados; se aplican la próxima vez que se encienda"));
      onSaved();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  const spec = report?.speculative;
  const current = spec?.spec_type ? `${SPEC_LABELS[spec.spec_type] ?? spec.spec_type} · ${spec.draft_filename || t("MTP integrado en el GGUF")}` : t("Sin especulativa");
  return <div className="model-help-overlay" role="dialog" aria-modal="true" aria-label={t("Ajustes de {modelId}", { modelId: modelId })} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <Card className="model-help-dialog model-settings-dialog">
      <SectionHeading eyebrow={t("AJUSTES DE ARRANQUE")} title={modelId} action={<button className="icon-button" onClick={onClose} aria-label={t("Cerrar ajustes")}><X size={16} /></button>} />
      {!report ? <p className="preflight-intro"><RefreshCw className="spin" size={14} />{" "}{t("Leyendo cabeceras y ficha…")}</p> : <>
        <p className="preflight-intro">{t("Cada campo vacío usa el valor automático (entre paréntesis, con su origen). Lo que escribas aquí manda sobre la ficha y la cabecera GGUF. Se aplica la próxima vez que se encienda el modelo; si está en Default, también ahí.")}</p>
        <section className="model-settings-section">
          <h4>{t("Archivos")}</h4>
          <label>{t("Cuantización principal")}
            <select value={draft.model_filename ?? ""} onChange={(event) => set("model_filename", event.target.value)}>
              <option value="">{t("Automático (")}{report.files.find((file) => file.selected)?.quantization ?? "—"})</option>
              {report.files.map((file) => <option key={file.filename} value={file.filename}>
                {file.quantization} · {bytes(file.size)} · {file.architecture || "?"}{file.runtime_supported === false ? t(" · llama.cpp no la reconoce") : ""}
              </option>)}
            </select>
          </label>
          {report.mmproj.length > 0 && <label>{t("Proyector visual (mmproj)")}
            <select value={draft.mmproj ?? ""} onChange={(event) => set("mmproj", event.target.value)}>
              <option value="">{t("Automático (")}{report.mmproj_filename || t("ninguno")})</option>
              <option value="none">{t("Sin visión (permite la especulativa)")}</option>
              {report.mmproj.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>}
        </section>
        <section className="model-settings-section">
          <h4>{t("Contexto")}{" "}<small>{t("rango {min}–{max}", { min: shortContext(report.context.minimum), max: shortContext(report.context.maximum) })}{" "}{t("· nativo")}{" "}{shortContext(report.context.native)}{report.context.card ? t(" · ficha {card}", { card: shortContext(report.context.card) }) : ""}{" "}{t("· origen")}{" "}{originLabel(report.context.origin)}</small></h4>
          <label>{t("Por defecto al encender (K)")}
            <input type="number" min={1} step={1} placeholder={`${Math.round(report.context.default / 1024)}`} value={draft.context_size ?? ""} onChange={(event) => set("context_size", event.target.value)} />
          </label>
          <label>{t("Máximo del slider (K)")}
            <input type="number" min={1} step={1} placeholder={`${Math.round(report.context.maximum / 1024)}`} value={draft.context_max ?? ""} onChange={(event) => set("context_max", event.target.value)} />
          </label>
        </section>
        <section className="model-settings-section">
          <h4>{t("Decodificación especulativa")}{" "}<small>{t("ahora:")} {current}{spec?.origin ? t(" · origen {origin}", { origin: originLabel(spec.origin) }) : ""}</small></h4>
          {spec?.runtime_supported === false && <div className="profile-warning"><TriangleAlert size={14} />{t("El llama.cpp instalado no admite")}{" "}<code>--spec-type</code>.</div>}
          {spec?.blocked_by_mmproj && <small className="preflight-note">{t("Con el mmproj activo llama.cpp no usa la especulativa. Elige «Sin visión» si prefieres velocidad a imágenes.")}</small>}
          <label>{t("Drafter")}
            <select value={draft.spec ?? ""} onChange={(event) => set("spec", event.target.value)}>
              <option value="">{t("Automático")}</option>
              <option value="off">{t("Desactivada")}</option>
              {spec?.candidates.map((item) => <option key={`${item.spec_type}|${item.draft_filename}`} value={`${item.spec_type}|${item.draft_filename}`}>
                {SPEC_LABELS[item.spec_type] ?? item.spec_type} · {item.embedded ? t("integrado en el GGUF") : `${item.draft_filename} · ${bytes(item.size)}`}
              </option>)}
            </select>
          </label>
          <label>{t("Tokens por borrador")}
            <input type="number" min={1} max={16} placeholder={spec?.spec_draft_n_max ? String(spec.spec_draft_n_max) : "llama.cpp"} value={draft.spec_draft_n_max ?? ""} onChange={(event) => set("spec_draft_n_max", event.target.value)} />
          </label>
          {spec && !spec.candidates.length && <small className="preflight-note">{t("No hay drafters descargados para este modelo.")}</small>}
        </section>
        <section className="model-settings-section">
          <h4>{t("Muestreo y caché")}</h4>
          {SAMPLING_FIELDS.map((field) => {
            const info = report.fields[field.key];
            return <label key={field.key}>{field.label}
              <input type="number" step={field.step} min={0} placeholder={info?.auto != null ? `${info.auto} (${originLabel(info.origin === "manual" ? "MyDGX" : info.origin)})` : "llama.cpp"} value={draft[field.key] ?? ""} onChange={(event) => set(field.key, event.target.value)} />
            </label>;
          })}
          {(["cache_type_k", "cache_type_v"] as const).map((key) => <label key={key}>{key === "cache_type_k" ? t("Caché K") : t("Caché V")}
            <select value={draft[key] ?? ""} onChange={(event) => set(key, event.target.value)}>
              <option value="">{t("Automático (")}{report.fields[key]?.auto || "f16"})</option>
              {["f16", "q8_0", "q4_0"].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>)}
        </section>
        <div className="preflight-actions">
          <small className="preflight-note">{t("Memoria estimada con los valores actuales: ~{gb} GB", { gb: Math.ceil(report.estimated_memory_mb / 1024) })}</small>
          <button className="button secondary" disabled={busy || !Object.keys(report.overrides).length} onClick={() => void save(true)}><RefreshCw size={14} />{" "}{t("Restablecer automático")}</button>
          <button className="button primary" disabled={busy} onClick={() => void save()}><CheckCircle2 size={14} />{" "}{t("Guardar")}</button>
        </div>
      </>}
    </Card>
  </div>;
}

function StopAllModelsButton({ notify, onDone }: { notify: (message: string, error?: boolean) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function stopAll() {
    if (!window.confirm(t("¿Parar todos los modelos? Se apagan todos los perfiles cargados (también Quick) y los modelos que Ollama tenga en memoria. Se mantienen el modelo del chat, el perfil Default y los servicios ComfyUI, TTS y Whisper."))) return;
    setBusy(true);
    try {
      const result = await api<{ stopped_profiles: string[]; released_ollama: string[]; kept_profiles: string[] }>("/api/models/stop-all", { method: "POST" });
      const stopped = [...result.stopped_profiles, ...result.released_ollama];
      notify(stopped.length
        ? t("Parados: {stopped}{kept}", { stopped: stopped.join(", "), kept: result.kept_profiles.length ? t(" · siguen: {names}", { names: result.kept_profiles.join(", ") }) : "" })
        : t("No había modelos que parar; solo quedan el chat, Default y los servicios básicos"));
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
    title={t("Parar todos los modelos: apaga los perfiles cargados, incluido Quick, y descarga los modelos de Ollama. Se mantienen el modelo del chat, el perfil Default y lo que usan ComfyUI, TTS y Whisper.")}
  >
    <Square size={12} fill="currentColor" /> {busy ? t("Parando…") : t("Parar modelos")}
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
    const drafter = /(?:^|\/)(?:mtp|dspark|dflash|draft|eagle3?|speculative)\d*[-_/]|[-_.](?:dspark|dflash|eagle3)\d*[-_.]/i.test(file.name);
    const auxiliary = !gguf || drafter || /(?:^|[/_.-])imatrix(?:[/_.-]|$)/i.test(file.name);
    const kind: HfFileGroup["kind"] = auxiliary ? "auxiliary" : mmproj ? "mmproj" : "weights";
    const shardBase = file.name.replace(/-\d{5}-of-\d{5}(?=\.gguf$)/i, "");
    const id = kind === "auxiliary" ? "auxiliary" : `${kind}:${shardBase}`;
    const fallback = shardBase.split("/").pop()?.replace(/\.gguf$/i, "") || "GGUF";
    const detectedQuantization = file.name.match(
      /(?:^|[._/-])((?:UD-)?Q[2-8](?:_[A-Z0-9]+)*|IQ[1-4](?:_[A-Z0-9]+)*|MXFP4|BF16|F16|FP16)(?=[._/-]|$)/i,
    )?.[1]?.toUpperCase();
    const label = kind === "auxiliary"
      ? t("Archivos auxiliares")
      : kind === "mmproj"
        ? t("Visión · {value}", { value: detectedQuantization || file.quantization || fallback })
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
  const sharedEngrams = [...groups.values()].filter((group) => (
    group.kind === "weights"
    && group.files.length === 1
    && /(?:^|[/_.-])engram(?:[/_.-]|$)/i.test(group.files[0].name)
    && !/-\d{5}-of-\d{5}\.gguf$/i.test(group.files[0].name)
  ));
  for (const engram of sharedEngrams) {
    let attached = false;
    for (const group of groups.values()) {
      if (group === engram || group.kind !== "weights") continue;
      const shard = group.files[0]?.name.match(/-\d{5}-of-(\d{5})\.gguf$/i);
      const expected = shard ? Number(shard[1]) : 1;
      if (expected <= 1 || group.files.length !== expected - 1) continue;
      group.files.push(...engram.files);
      group.size += engram.size;
      group.sizeKnown = group.sizeKnown && engram.sizeKnown;
      attached = true;
    }
    if (attached) groups.delete(engram.id);
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
    ? t("Precisión completa · enorme")
    : upper.includes("Q8")
      ? t("Máxima fidelidad · grande")
      : upper.includes("Q6")
        ? t("Calidad muy alta")
        : upper.includes("Q5")
          ? t("Alta calidad")
          : upper.includes("Q4") || upper.includes("IQ4")
            ? t("Equilibrio recomendado")
            : upper.includes("Q3") || upper.includes("IQ3")
              ? t("Compacta")
              : upper.includes("Q2") || upper.includes("IQ2")
                ? t("Muy compacta")
                : upper.includes("IQ1")
                  ? t("Mínimo tamaño · menor calidad")
                  : t("Variante del modelo");
  const variant = /_(?:S|XS|XXS)(?:$|[_.-])/.test(upper)
    ? t("prioriza tamaño")
    : /_(?:M)(?:$|[_.-])/.test(upper)
      ? t("equilibrada")
      : /_(?:L|XL|NL)(?:$|[_.-])/.test(upper)
        ? t("prioriza calidad")
        : "";
  return `${quality}${variant ? ` · ${variant}` : ""}`;
}

function hfGroupResidentSize(group: HfFileGroup) {
  const sharedEngram = group.files.find((file) => (
    /(?:^|[/_.-])engram(?:[/_.-]|$)/i.test(file.name)
    && !/-\d{5}-of-\d{5}\.gguf$/i.test(file.name)
  ));
  return Math.max(0, group.size - (sharedEngram?.size ?? 0));
}

type AddToProfileRequest = {
  source: "ollama" | "huggingface";
  modelId: string;
  range?: QuickStart["context"];
  defaultContext?: number;
};

type Recipe = ProfileModel & {
  description: Partial<Record<"es" | "en", string>>;
  memory_gib?: number;
  version: number;
  changelog: Partial<Record<"es" | "en", string>>;
  additional_models: ProfileModel[];
  installed_ids: string[];
  installed_version: number;
  missing_models: string[];
  running: boolean;
  categories?: ModelCategoryKey[];
};

function recipeCategories(recipe: Recipe): ModelCategoryKey[] {
  const declared = (recipe.categories ?? []).filter((key) => key in MODEL_CATEGORIES);
  return declared.length ? declared : profileCategories([recipe, ...recipe.additional_models]);
}

type RecipesResponse = { source: "github" | "local"; url: string; error: string; fetched_at: string; recipes: Recipe[] };

function RecipesDialog({ notify, onClose, onInstalled }: {
  notify: (message: string, error?: boolean) => void;
  onClose: () => void;
  onInstalled: () => void;
}) {
  useDialogEscape(onClose);
  return <div className="model-help-overlay" role="dialog" aria-modal="true" aria-label={t("Buscar recetas")} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <Card className="model-help-dialog recipes-dialog">
      <RecipesBrowser notify={notify} onInstalled={onInstalled} onClose={onClose} />
    </Card>
  </div>;
}

function RecipesBrowser({ notify, onInstalled, onClose, activeDownloads = 0 }: {
  notify: (message: string, error?: boolean) => void;
  onInstalled: () => void;
  onClose?: () => void;
  activeDownloads?: number;
}) {
  const inTab = !onClose;
  const [category, setCategory] = useState<ModelCategoryKey | "all">("all");
  const [catalog, setCatalog] = useState<RecipesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState("");
  const [installing, setInstalling] = useState<{ id: string; mode: "install" | "copy"; name: string; download: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(refresh = false) {
    setLoading(true);
    try {
      setCatalog(await api<RecipesResponse>(`/api/profiles/recipes${refresh ? "?refresh=true" : ""}`));
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api<RecipesResponse>("/api/profiles/recipes")
      .then(setCatalog)
      .catch((error: Error) => notify(error.message, true));
  }, [activeDownloads]);

  function recipeJson(recipe: Recipe) {
    return JSON.stringify(recipe, (key, value) => (["installed_ids", "installed_version", "missing_models", "running"].includes(key) ? undefined : value), 2);
  }

  function downloadRecipe(recipe: Recipe) {
    const url = URL.createObjectURL(new Blob([recipeJson(recipe)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `mydgx-recipe-${recipe.name.replace(RECIPE_PREFIX, "").replace(/[^A-Za-z0-9._-]+/g, "-").toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function install(form = installing) {
    if (!form) return;
    setBusy(true);
    try {
      const copy = form.mode === "copy";
      const result = await api<{ id: string; name: string; jobs: string[] }>(`/api/profiles/recipes/${encodeURIComponent(form.id)}/${copy ? "copy" : "install"}`, {
        method: "POST",
        body: JSON.stringify(copy ? { name: form.name, download_models: form.download } : { download_models: form.download }),
      });
      notify(result.jobs.length
        ? t("{name} instalado · {count} descarga(s) en cola", { name: result.name, count: result.jobs.length })
        : t("{name} instalado", { name: result.name }));
      setInstalling(null);
      onInstalled();
      await load();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  async function downloadModels(recipe: Recipe) {
    setBusy(true);
    try {
      const result = await api<{ jobs: string[] }>(`/api/profiles/recipes/${encodeURIComponent(recipe.id)}/download`, { method: "POST" });
      notify(result.jobs.length
        ? t("{count} descarga(s) en cola para {name}", { count: result.jobs.length, name: recipe.name.replace(RECIPE_PREFIX, "") })
        : t("Los modelos de {name} ya están descargados", { name: recipe.name.replace(RECIPE_PREFIX, "") }));
      await load();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  async function updateRecipe(recipe: Recipe) {
    setBusy(true);
    try {
      await api(`/api/profiles/recipes/${encodeURIComponent(recipe.id)}/update`, { method: "POST" });
      notify(t("{name} actualizada a v{version}", { name: recipe.name.replace(RECIPE_PREFIX, ""), version: recipe.version }));
      onInstalled();
      await load();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  const intro = t("Perfiles medidos en un DGX Spark y publicados en GitHub. Una receta instalada es de solo lectura y se actualiza cuando publicamos una versión nueva; para cambiarla, duplícala como perfil normal. Los modelos se descargan ahora o más tarde desde la tarjeta del perfil.");
  const source = catalog && (catalog.source === "github"
    ? <p className="recipes-source">{t("Catálogo de GitHub · leído a las {time}", { time: new Date(catalog.fetched_at).toLocaleTimeString(locale) })}</p>
    : <div className="profile-warning"><TriangleAlert size={15} />{t("No se pudo leer GitHub ({error}); se muestra la copia incluida en esta versión de MyDGX.", { error: catalog.error })}</div>);
  const visibleRecipes = catalog?.recipes.filter((recipe) => category === "all" || recipeCategories(recipe).includes(category)) ?? [];
  const filters = catalog && catalog.recipes.length > 0 && <CategoryFilters
    value={category}
    onChange={setCategory}
    counts={categoryCounts(catalog.recipes, recipeCategories)}
    total={catalog.recipes.length}
  />;
  const installedCount = catalog?.recipes.filter((recipe) => recipe.installed_version > 0).length ?? 0;
  const updatesCount = catalog?.recipes.filter((recipe) => recipe.installed_version > 0 && recipe.installed_version !== recipe.version).length ?? 0;

  return <>
      {inTab
        ? <Card className="ollama-hero recipes-hero">
          <div className="ollama-hero-icon"><ChefHat size={26} /></div>
          <div className="ollama-hero-copy">
            <span className="card-kicker">{t("RECETAS DE MYDGX")}</span>
            <h3>{t("Perfiles listos para tu DGX Spark")}</h3>
            <p>{intro}</p>
            <div className="recipes-hero-bar">
              <button className="button primary compact" disabled={loading} onClick={() => void load(true)}><RefreshCw className={loading ? "spin" : ""} size={14} />{" "}{loading ? t("Consultando GitHub…") : t("Actualizar desde GitHub")}</button>
              {catalog && <span className="recipes-stats">
                <span className="badge">{t(catalog.recipes.length === 1 ? "{count} receta" : "{count} recetas", { count: catalog.recipes.length })}</span>
                <span className="badge live">{t("{count} instaladas", { count: installedCount })}</span>
                {updatesCount > 0 && <span className="badge recipe">{t("{count} con versión nueva", { count: updatesCount })}</span>}
                {activeDownloads > 0 && <span className="badge running"><RefreshCw className="spin" size={11} />{" "}{t("{count} descarga(s) en curso", { count: activeDownloads })}</span>}
              </span>}
            </div>
            {source}
          </div>
        </Card>
        : <>
          <SectionHeading
            eyebrow={t("RECETAS DE MYDGX")}
            title={t("Buscar recetas")}
            action={<div className="dialog-heading-actions">
              <button className="icon-button" disabled={loading} onClick={() => void load(true)} aria-label={t("Actualizar desde GitHub")} title={t("Actualizar desde GitHub")}><RefreshCw className={loading ? "spin" : ""} size={15} /></button>
              <button className="icon-button" onClick={onClose} aria-label={t("Cerrar")}><X size={16} /></button>
            </div>}
          />
          <p className="preflight-intro">{intro}</p>
          {source}
        </>}
      {!catalog
        ? <p className="preflight-intro"><RefreshCw className="spin" size={14} />{" "}{t("Cargando recetas…")}</p>
        : catalog.recipes.length === 0
          ? <div className="profile-warning"><TriangleAlert size={15} />{t("No hay recetas publicadas.")}</div>
          : <>{filters}{visibleRecipes.length === 0
            ? <div className="profile-warning"><TriangleAlert size={15} />{t("Ninguna receta en esta categoría.")}</div>
            : <div className={`recipes-list ${inTab ? "recipes-grid" : ""}`}>
            {visibleRecipes.map((recipe) => {
              const models = [{ ...recipe, name: recipe.name }, ...recipe.additional_models.filter((model) => model.enabled !== false)];
              const installed = recipe.installed_version > 0;
              const nameTaken = !installed && recipe.installed_ids.length > 0;
              const changed = installed && recipe.installed_version !== recipe.version;
              const changelog = recipe.changelog[language] || recipe.changelog.en || recipe.changelog.es;
              const form = installing?.id === recipe.id ? installing : null;
              return <article key={recipe.id} className="recipe-card">
                <header>
                  <ProfileName name={recipe.name} />
                  <span className="recipe-meta">
                    <span className="badge recipe-version" title={changelog || undefined}>v{recipe.version}</span>
                    {installed && <span className="badge live">{changed ? t("Instalada v{version}", { version: recipe.installed_version }) : t("Instalada")}</span>}
                    {installed && (recipe.missing_models.length
                      ? <span className="badge warning" title={recipe.missing_models.join("\n")}>{t("Faltan {count} modelo(s)", { count: recipe.missing_models.length })}</span>
                      : <span className="badge">{t("Modelos listos")}</span>)}
                    <span className="badge">{t(models.length === 1 ? "{count} modelo" : "{count} modelos", { count: models.length })}</span>
                    {recipe.memory_gib ? <span className="badge" title={t("Memoria medida con todos los modelos cargados")}>≈{recipe.memory_gib.toLocaleString(locale)} GiB</span> : null}
                  </span>
                </header>
                <CategoryBadges categories={recipeCategories(recipe)} />
                <p>{recipe.description[language] || recipe.description.en || recipe.description.es || recipe.source}</p>
                {changelog && <p className="recipe-changelog"><b>v{recipe.version}</b> · {changelog}</p>}
                <ul className="recipe-models">
                  {models.map((model, index) => {
                    const identity = profileModelIdentity(model);
                    return <li key={`${model.id || index}`}>
                      <span className="profile-model-name">
                        <strong title={identity.file || model.model_repo || model.model_ref}>{identity.name}</strong>
                        <UncensoredBadge name={`${model.model_repo} ${identity.file}`} showKind />
                      </span>
                      <small>{[
                        identity.quant,
                        ["chat", "vision", "embeddings"].includes(model.task) ? `${(model.context_size / 1024).toLocaleString(locale)}K ctx` : "",
                        model.cache_type_k ? `KV ${model.cache_type_k}` : "",
                        model.spec_type ? SPEC_LABELS[model.spec_type] ?? model.spec_type : "",
                        model.engine,
                      ].filter(Boolean).join(" · ")}</small>
                    </li>;
                  })}
                </ul>
                {details === recipe.id && <pre className="recipe-json">{recipeJson(recipe)}</pre>}
                {form
                  ? <div className="recipe-install">
                    {form.mode === "copy" && <label><span>{t("Nombre del perfil")}</span><input value={form.name} maxLength={80} onChange={(event) => setInstalling({ ...form, name: event.target.value })} /></label>}
                    <label className="recipe-check"><input type="checkbox" checked={form.download} onChange={(event) => setInstalling({ ...form, download: event.target.checked })} />{t("Descargar también los modelos que falten")}</label>
                    <div className="add-to-profile-actions">
                      <button className="button secondary" disabled={busy} onClick={() => setInstalling(null)}>{t("Cancelar")}</button>
                      <button className="button primary" disabled={busy || (form.mode === "copy" && (form.name.trim().length < 2 || RECIPE_PREFIX.test(form.name.trim())))} onClick={() => void install()}>{form.mode === "copy" ? <Copy size={14} /> : <Plus size={14} />} {busy ? t("Instalando…") : form.mode === "copy" ? t("Duplicar como perfil") : t("Instalar")}</button>
                    </div>
                  </div>
                  : <div className="recipe-actions">
                    <button className="button secondary" onClick={() => setDetails(details === recipe.id ? "" : recipe.id)}><Eye size={14} /> {details === recipe.id ? t("Ocultar detalles") : t("Ver detalles")}</button>
                    <button className="button secondary" onClick={() => downloadRecipe(recipe)}><Download size={14} /> {t("Descargar JSON")}</button>
                    <button className="button secondary" onClick={() => setInstalling({ id: recipe.id, mode: "copy", name: recipe.name.replace(RECIPE_PREFIX, ""), download: true })}><Copy size={14} /> {t("Duplicar como perfil")}</button>
                    {installed && recipe.missing_models.length > 0 && <button className="button primary" disabled={busy || activeDownloads > 0} title={activeDownloads > 0 ? t("Hay descargas en curso") : recipe.missing_models.join("\n")} onClick={() => void downloadModels(recipe)}><Download size={14} /> {t("Descargar {count} modelo(s)", { count: recipe.missing_models.length })}</button>}
                    {changed
                      ? <button className="button primary" disabled={busy || recipe.running} title={recipe.running ? t("Detén el perfil antes de actualizar la receta") : changelog || undefined} onClick={() => void updateRecipe(recipe)}><RefreshCw size={14} /> {recipe.version > recipe.installed_version ? t("Actualizar a v{version}", { version: recipe.version }) : t("Volver a v{version}", { version: recipe.version })}</button>
                      : !installed && <button className="button primary" disabled={nameTaken} title={nameTaken ? t("Ya hay un perfil con este nombre") : undefined} onClick={() => inTab
                        ? void install({ id: recipe.id, mode: "install", name: recipe.name, download: true })
                        : setInstalling({ id: recipe.id, mode: "install", name: recipe.name, download: true })}><Plus size={14} /> {inTab ? t("Instalar con modelos") : t("Instalar")}</button>}
                  </div>}
              </article>;
            })}
          </div>}</>}
  </>;
}

function AddToProfileDialog({ request, notify, onClose }: {
  request: AddToProfileRequest;
  notify: (message: string, error?: boolean) => void;
  onClose: () => void;
}) {
  useDialogEscape(onClose);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const range = request.range && request.range.context_max > request.range.context_min ? request.range : undefined;
  const initial = range ? Math.min(range.context_max, Math.max(range.context_min, request.defaultContext || range.context_min)) : 0;
  const [context, setContext] = useState(initial);
  const memoryAt = (tokens: number) => range && range.memory_min_mb && range.memory_max_mb
    ? range.memory_min_mb + (range.memory_max_mb - range.memory_min_mb) * (tokens - range.context_min) / (range.context_max - range.context_min)
    : 0;

  const contains = (profile: Profile) => profile.models.some((model) => (
    request.source === "ollama"
      ? model.engine === "ollama" && model.model_ref === request.modelId
      : (model.model_repo || "").toLocaleLowerCase() === request.modelId.toLocaleLowerCase()
  ));

  useEffect(() => {
    api<{ profiles: Profile[] }>("/api/profiles")
      .then((data) => {
        const editable = data.profiles.filter((profile) => !profile.read_only && !profile.recipe_id);
        setProfiles(editable);
        setSelected((editable.find((profile) => !contains(profile)) ?? editable[0])?.id ?? "");
      })
      .catch((error: Error) => { notify(error.message, true); setProfiles([]); });
  }, [request.source, request.modelId]);

  async function submit() {
    const profile = profiles?.find((item) => item.id === selected);
    if (!profile) return;
    setBusy(true);
    try {
      const result = await api<{ running: boolean; context_size?: number }>(`/api/profiles/${encodeURIComponent(profile.id)}/models`, {
        method: "POST",
        body: JSON.stringify({
          source: request.source,
          model_id: request.modelId,
          ...(range && context !== initial ? { context_size: context } : {}),
        }),
      });
      notify(
        t("{modelId} añadido a {name}", { modelId: request.modelId, name: profile.name })
        + (result.context_size ? t(" con {context}", { context: contextLabel(result.context_size) }) : "")
        + (result.running ? t(" · se cargará al reiniciar el perfil") : t(" · se cargará al arrancar el perfil")),
      );
      onClose();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return <div className="model-help-overlay" role="dialog" aria-modal="true" aria-label={t("Añadir {modelId} a un perfil", { modelId: request.modelId })} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <Card className="model-help-dialog add-to-profile-dialog">
      <SectionHeading eyebrow={t("AÑADIR A PERFIL")} title={request.modelId} action={<button className="icon-button" onClick={onClose} aria-label={t("Cerrar")}><X size={16} /></button>} />
      <p className="preflight-intro">{t("Se añade con la misma configuración que usaría")}{" "}<strong>{t("Encender")}</strong>{" "}{t("(cuantización, drafter, muestreo y tus ajustes manuales) y un puerto libre propio. Default y Quick se gestionan desde esta página y no aparecen aquí.")}</p>
      {profiles === null
        ? <p className="preflight-intro"><RefreshCw className="spin" size={14} />{" "}{t("Cargando perfiles…")}</p>
        : profiles.length === 0
          ? <div className="profile-warning"><TriangleAlert size={15} />{t("No hay perfiles editables. Crea uno en Perfiles.")}</div>
          : <div className="add-to-profile-list" role="radiogroup" aria-label={t("Perfil de destino")}>
            {profiles.map((profile) => {
              const already = contains(profile);
              return <label key={profile.id} className={`${selected === profile.id ? "selected" : ""} ${already ? "disabled" : ""}`}>
                <input type="radio" name="add-to-profile" value={profile.id} checked={selected === profile.id} disabled={already} onChange={() => setSelected(profile.id)} />
                <span>
                  <ProfileName name={profile.name} />
                  <small>{already ? t("Ya contiene este modelo") : t(profile.models.length === 1 ? "{count} modelo · {engine}{suffix}" : "{count} modelos · {engine}{suffix}", { count: profile.models.length, engine: profile.engine, suffix: profile.active ? t(" · predeterminado") : "" })}</small>
                </span>
              </label>;
            })}
          </div>}
      {range && <div className="add-to-profile-context">
        <span>{t("Contexto")}</span>
        <label className="quick-context-slider" title={t("Va del mínimo de los agentes de código al máximo del autor o del GGUF")}>
          <input type="range" min={range.context_min} max={range.context_max} step={1024} value={context} disabled={busy} onChange={(event) => setContext(Number(event.target.value))} aria-label={t("Contexto de {modelId} en el perfil", { modelId: request.modelId })} />
          <span>{contextLabel(context).replace(t(" tokens"), "")}{memoryAt(context) ? <small>~{(memoryAt(context) / 1024).toFixed(0)} GB</small> : null}</span>
        </label>
      </div>}
      <div className="add-to-profile-actions">
        <button className="button secondary" onClick={onClose}>{t("Cancelar")}</button>
        <button className="button primary" disabled={busy || !selected || Boolean(profiles?.find((item) => item.id === selected && contains(item)))} onClick={() => void submit()}>
          <Plus size={14} /> {busy ? t("Añadiendo…") : t("Añadir al perfil")}
        </button>
      </div>
    </Card>
  </div>;
}

function recommendedHfFiles(inspection: HfInspection) {
  const groups = hfFileGroups(inspection.remote?.files ?? []);
  const weights = groups.find((group) => (
    group.kind === "weights"
    && group.sizeKnown
    && hfGroupResidentSize(group) <= inspection.download_limit_bytes
    && group.files.some((file) => !file.downloaded)
  ));
  if (!weights) return [];
  const selected = weights.files.filter((file) => !file.downloaded).map((file) => file.name);
  if (inspection.remote?.input_modalities.includes("image")) {
    const projector = groups.find((group) => (
      group.kind === "mmproj"
      && group.sizeKnown
      && group.files.some((file) => !file.downloaded)
      && group.size + hfGroupResidentSize(weights) <= inspection.download_limit_bytes
    ));
    if (projector) selected.push(...projector.files.filter((file) => !file.downloaded).map((file) => file.name));
  }
  return selected;
}

function unsupportedQuickStartReason(category: string) {
  if (category === t("Voz / audio")) return t("Modelo de voz: lo cargan el servicio TTS, Whisper o el Laboratorio IA cuando lo usan; no se enciende como modelo de chat");
  if (category === t("Imagen") || category === t("Vídeo")) return t("Modelo de imagen o vídeo: ComfyUI lo carga al generar y desde aquí puedes liberarlo; no se enciende como modelo de chat");
  if (category === t("Embeddings")) return t("Modelo de embeddings: lo cargan los servicios que lo usan; no se enciende como modelo de chat");
  return t("Solo tiene pesos safetensors o PyTorch: Encender usa llama.cpp y necesita un GGUF. Descarga una versión GGUF o crea un perfil con un motor compatible");
}

function QuickStartButton({ label, availability, defaultContext, busy, pending, title, onStart, onContextChange, unsupportedReason }: {
  label: string;
  availability?: QuickStart;
  defaultContext?: number;
  busy: boolean;
  pending: boolean;
  title: string;
  onStart: (contextSize?: number) => void;
  onContextChange?: (contextSize?: number) => void;
  unsupportedReason?: string;
}) {
  const range = availability?.context;
  const initial = range ? Math.min(range.context_max, Math.max(range.context_min, defaultContext || range.context_min)) : 0;
  const [chosen, setChosen] = useState<number | null>(null);
  if (unsupportedReason || (availability && !availability.supported)) {
    return <button className="button secondary compact no-fit" disabled title={unsupportedReason || availability?.reason || t("Este modelo no se puede encender desde aquí")} aria-label={t("{label} no se puede encender aquí", { label: label })}><Play size={13} />{" "}{t("No disponible")}</button>;
  }
  const context = chosen ?? initial;
  const memoryAt = (tokens: number) => range && range.memory_min_mb && range.memory_max_mb
    ? range.memory_min_mb + (range.memory_max_mb - range.memory_min_mb) * (tokens - range.context_min) / (range.context_max - range.context_min)
    : 0;
  const delta = range ? memoryAt(context) - memoryAt(initial) : 0;
  const memoryLimited = availability?.spare_mb != null && (availability.fits || availability.spare_mb < 0);
  const fits = !availability || (memoryLimited ? (availability.spare_mb ?? 0) - delta >= 0 : availability.fits);
  const slider = range && <label className="quick-context-slider" title={t("Contexto al encender: {context} tokens{memory}. Va del mínimo de los agentes de código al máximo del autor o del GGUF", { context: context.toLocaleString(locale), memory: memoryAt(context) ? t(" · ~{gb} GB", { gb: (memoryAt(context) / 1024).toFixed(1) }) : "" })}>
    <input
      type="range"
      min={range.context_min}
      max={range.context_max}
      step={1024}
      value={context}
      disabled={busy}
      onChange={(event) => {
        const value = Number(event.target.value);
        setChosen(value);
        onContextChange?.(value !== initial ? value : undefined);
      }}
      aria-label={t("Contexto al encender {label}", { label: label })}
    />
    <span>{contextLabel(context).replace(t(" tokens"), "")}{memoryAt(context) ? <small>~{(memoryAt(context) / 1024).toFixed(0)} GB</small> : null}</span>
  </label>;
  if (!fits) {
    const reason = memoryLimited && availability?.fits ? t("Con este contexto no cabe junto a lo que ya está cargado") : availability?.reason;
    return <>{slider}<button className="button secondary compact no-fit" disabled title={reason || t("No cabe junto a lo que ya está cargado")} aria-label={t("{label} no cabe ahora", { label: label })}><Play size={13} />{" "}{t("No cabe ahora")}</button></>;
  }
  const incremental = (availability?.incremental_mb ?? 0) + delta;
  const extra = incremental > 0 ? t(" · ocupará unos {toFixed} GB", { toFixed: (incremental / 1024).toFixed(1) }) : "";
  return <>{slider}<button className="button primary compact" disabled={busy} onClick={() => onStart(chosen != null && chosen !== initial ? chosen : undefined)} title={`${title}${extra}`} aria-label={t("Encender {label}", { label: label })}><Play className={pending ? "spin" : ""} size={13} /> {pending ? t("Encendiendo…") : t("Encender")}</button></>;
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
  speculative?: { drafted_tokens: number; accepted_tokens: number; acceptance_rate: number } | null;
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
  parameters_estimated?: boolean;
  memory_bandwidth_gbps?: number;
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
const downloadJobKinds = new Set(["huggingface.download", "huggingface.files.download", "ollama.pull", "ollama.update", "profile.download"]);

function useDownloadTracker(jobs: Job[], onFinished?: () => void) {
  const [requested, setRequested] = useState<Record<string, { jobId?: string; at: number }>>({});
  const active = useMemo(() => new Set(
    jobs.filter((job) => downloadJobKinds.has(job.kind) && activeJobStatuses.has(job.status)).map((job) => job.target.toLowerCase()),
  ), [jobs]);
  const activeKey = [...active].sort().join("\n");
  const previousActive = useRef(activeKey);
  useEffect(() => {
    const ended = previousActive.current.split("\n").some((key) => key && !active.has(key));
    previousActive.current = activeKey;
    if (ended) onFinished?.();
  }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setRequested((current) => {
      const next = { ...current };
      for (const [key, entry] of Object.entries(current)) {
        const job = entry.jobId ? jobs.find((item) => item.id === entry.jobId) : undefined;
        if (job ? !activeJobStatuses.has(job.status) : Date.now() - entry.at > 60_000) delete next[key];
      }
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [jobs]);
  const isDownloading = useCallback((target: string) => {
    const key = target.toLowerCase();
    return active.has(key) || key in requested;
  }, [active, requested]);
  const track = useCallback((target: string, jobId?: string) => {
    setRequested((current) => ({ ...current, [target.toLowerCase()]: { jobId, at: Date.now() } }));
  }, []);
  const untrack = useCallback((target: string) => {
    setRequested((current) => {
      const { [target.toLowerCase()]: _removed, ...rest } = current;
      return rest;
    });
  }, []);
  return { isDownloading, track, untrack };
}

function jobLabel(kind: string): string {
  return ({
    "profile.prepare-start": t("Preparando perfil"),
    "model.quick.start": t("Encendiendo modelo"),
    "model.default.start": t("Cargando modelo en Default"),
    "profile.download": t("Descargando modelo del perfil"),
    "ollama.pull": t("Descargando modelo Ollama"),
    "ollama.update": t("Actualizando modelo Ollama"),
    "huggingface.download": t("Descargando repositorio Hugging Face"),
    "huggingface.files.download": t("Descargando archivos Hugging Face"),
    "huggingface.integrity": t("Verificando modelo Hugging Face"),
    "multimodal.video": t("Generando vídeo"),
    "benchmark.run": t("Ejecutando benchmark"),
    "benchmark.suite": t("Suite de benchmarks"),
    "benchmark.import": t("Importando benchmark"),
    "system.update": t("Actualizando el sistema"),
    "system.repair": t("Verificando y reparando el sistema"),
    "system.firmware": t("Instalando firmware"),
  } as Record<string, string>)[kind] || kind.replaceAll(".", " · ");
}

function jobStatusLabel(status: string): string {
  return ({
    queued: t("En cola"),
    running: t("En curso"),
    cancelling: t("Cancelando"),
    cancelled: t("Cancelada"),
    completed: t("Completada"),
    failed: t("Fallida"),
  } as Record<string, string>)[status] || status;
}

function jobTarget(job: Job): string {
  if (job.kind === "profile.prepare-start" || ["apt", "runtime", "fwupd"].includes(job.target)) return "";
  return job.target;
}

function jobNextStep(job: Job): string {
  if (job.status === "queued") return t("A continuación: MyDGX iniciará la operación.");
  if (job.kind === "profile.prepare-start") {
    const message = job.message.toLocaleLowerCase();
    if (/arrancando|starting/.test(message)) return t("Ahora espera que cada modelo responda correctamente.");
    if (/comprobando archivos|checking files/.test(message)) return t("A continuación activará el perfil y arrancará sus modelos.");
    if (/preparando|descarg|preparing|download/.test(message)) return t("Después verificará archivos, memoria y puertos antes de arrancar.");
    return t("MyDGX seguirá preparando los modelos habilitados del perfil.");
  }
  if (job.kind === "benchmark.suite") {
    if (/restaur|restor/.test(job.message.toLocaleLowerCase())) {
      return t("MyDGX volverá a cargar los perfiles y residentes capturados al inicio.");
    }
    return t("Después liberará la memoria y continuará con el siguiente modelo pendiente.");
  }
  if (job.kind.startsWith("huggingface") || job.kind.startsWith("ollama")) {
    return t("Al terminar, MyDGX verificará que el modelo haya quedado disponible.");
  }
  if (job.kind === "system.update" || job.kind === "system.repair") {
    return t("Después comprobará la integridad de paquetes, kernel y runtimes.");
  }
  if (job.kind === "system.firmware") {
    return t("No apagues el equipo; al terminar indicará si hace falta reiniciar.");
  }
  return t("MyDGX continuará con la siguiente etapa y registrará aquí el resultado.");
}

function SidebarOperations({ jobs }: { jobs: Job[] }) {
  const active = jobs.filter((job) => activeJobStatuses.has(job.status)).slice(0, 2);
  if (!active.length) return null;
  return (
    <section className="sidebar-operations" aria-label={t("Operaciones en curso")}>
      <div className="sidebar-operations-title"><Activity size={12} /><span>{t("EN CURSO")}</span><strong>{active.length}</strong></div>
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
          <span className="card-kicker"><Terminal size={15} />{" "}{t("Registro de actividad")}</span>
          <small>{t("Operaciones principales realizadas por MyDGX y su estado actual.")}</small>
        </div>
        <span className={`activity-count ${active.length ? "live" : ""}`}>{active.length ? t("{length} en curso", { length: active.length }) : t("En reposo")}</span>
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
      </div> : <div className="activity-log-empty"><Activity size={18} /><span>{t("Todavía no hay operaciones registradas.")}</span></div>}
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

type HfGatedAccess = "public" | "granted" | "no_token" | "denied" | "unknown";

function hfGatedBlocked(remote: HfInspection["remote"]) {
  return Boolean(remote?.gated && (remote.access === "no_token" || remote.access === "denied"));
}

function GatedAccessNotice({ repoId, mode, access }: { repoId: string; mode?: string; access?: HfGatedAccess }) {
  const modelUrl = `https://huggingface.co/${repoId}`;
  if (access === "granted") {
    return <div className="gated-access-notice granted">
      <ShieldCheck size={15} />
      <span><strong>{t("Repositorio gated · acceso concedido")}</strong><small>{t("Tu token de Hugging Face tiene acceso; puedes descargarlo.")}</small></span>
    </div>;
  }
  const manual = mode === "manual";
  return <div className="gated-access-notice">
    <TriangleAlert size={15} />
    <div>
      <strong>{access === "denied"
        ? t("Repositorio gated · tu token no tiene acceso")
        : access === "no_token"
        ? t("Repositorio gated · hace falta un token de Hugging Face")
        : t("Repositorio gated · requiere acceso autenticado")}</strong>
      <small>{manual
        ? t("El autor revisa cada solicitud: la descarga no funcionará hasta que la apruebe.")
        : t("Hugging Face concede el acceso en cuanto aceptas las condiciones del modelo.")}</small>
      <ol>
        <li>{t("Inicia sesión en Hugging Face y abre")}{" "}<a href={modelUrl} target="_blank" rel="noreferrer">{repoId}</a>.</li>
        <li>{manual ? t("Pulsa «Request access», rellena el formulario y espera la aprobación del autor.") : t("Pulsa «Agree and access repository» para aceptar las condiciones.")}</li>
        {access !== "denied" && <li>{t("Crea un token de lectura en")}{" "}<a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">huggingface.co/settings/tokens</a>.</li>}
        {access !== "denied" && <li>{t("Pégalo en Configuración → Token de Hugging Face y pulsa Guardar.")}</li>}
        {access === "denied" && <li>{t("Comprueba que el token guardado en Configuración pertenece a la cuenta que aceptó las condiciones.")}</li>}
        <li>{t("Vuelve a abrir Detalles de este modelo y descarga.")}</li>
      </ol>
    </div>
  </div>;
}

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
    gated_mode?: "auto" | "manual" | "";
    access?: HfGatedAccess;
    private: boolean;
    license?: string | null;
    pipeline_tag?: string | null;
    tasks: string[];
    input_modalities: string[];
    output_modalities: string[];
    formats: string[];
    recommended_engines: string[];
    download_supported: boolean;
    download_block_reason: string;
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
  speculative_verified?: boolean;
  optional_mmproj_file?: string | null;
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
  port_auto?: boolean | number;
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
  comfyui?: ComfyUISpec | null;
  enabled: boolean;
};

type ComfyUISpec = {
  workflow: string;
  files: { repo: string; revision: string; filename: string; folder: string; sha256: string }[];
};

type ProfileModel = ModelConfig & {
  id: string;
  name: string;
  downloaded: boolean;
  spec_type?: string;
  draft_filename?: string;
  uncensored?: string;
};

const GGUF_QUANT_SUFFIX = /[-_.]((?:UD-)?(?:I?Q\d(?:_[A-Z0-9]+)*|BF16|F16|F32|MXFP4(?:_[A-Z0-9]+)*))$/i;

function profileModelIdentity(model: ProfileModel) {
  const file = (model.model_filename || model.model_file || model.model_files?.[0] || "").split("/").pop() ?? "";
  const stem = file.replace(/(-\d{5}-of-\d{5})?\.gguf$/i, "");
  const quant = stem.match(GGUF_QUANT_SUFFIX)?.[1] ?? "";
  const reference = (model.model_repo || model.model_ref || "").split("/").pop()?.replace(/[-_.]gguf$/i, "") ?? "";
  const name = (quant ? stem.slice(0, -quant.length - 1) : stem) || reference || model.name;
  return { name, quant: quant.toUpperCase(), file };
}

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
  recipe_id?: string;
  recipe_version?: number;
  recipe_update?: number;
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
    llm_slots: number;
    max_llm_slots: number;
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
    ? t("{name} en 127.0.0.1:{port}", { name: app.name, port: app.port })
    : app.state === "running"
      ? t("{name} está en marcha pero no responde en el puerto {port}", { name: app.name, port: app.port })
      : t("{name} se está preparando", { name: app.name });
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
  starting: t("Arrancando"),
  running: t("En marcha"),
  stopping: t("Deteniendo"),
  stopped: t("Parada"),
  error: t("Error"),
};

const QUICK_PROFILE_ID = "mydgx-quick";
const MANAGED_PROFILE_IDS = new Set(["mydgx-default", QUICK_PROFILE_ID]);

const navItems: Array<{ id: View; label: string; icon: typeof Gauge }> = [
  { id: "dashboard", label: t("Resumen"), icon: Gauge },
  { id: "models", label: t("Modelos"), icon: Boxes },
  { id: "profiles", label: t("Perfiles"), icon: SlidersHorizontal },
  { id: "benchmarks", label: t("Benchmarks"), icon: Activity },
  { id: "storage", label: t("Almacenamiento"), icon: HardDrive },
  { id: "engines", label: t("Motores"), icon: Cpu },
  { id: "settings", label: t("Configuración"), icon: Settings },
  { id: "system", label: t("Sistema"), icon: Server },
  { id: "logs", label: t("Logs"), icon: Terminal },
];

const taskOptions: Array<{ id: ModelTask; label: string; input: InputModality[]; output: OutputModality[] }> = [
  { id: "chat", label: t("Chat / texto"), input: ["text"], output: ["text"] },
  { id: "vision", label: t("Visión"), input: ["text", "image"], output: ["text"] },
  { id: "embeddings", label: t("Embeddings"), input: ["text"], output: ["embedding"] },
  { id: "image-generation", label: t("Generación de imagen"), input: ["text"], output: ["image"] },
  { id: "asr", label: t("Audio a texto (ASR)"), input: ["audio"], output: ["text"] },
  { id: "tts", label: t("Texto a audio (TTS)"), input: ["text"], output: ["audio"] },
  { id: "video-generation", label: t("Generación de vídeo"), input: ["text"], output: ["video"] },
  { id: "reranking", label: t("Reranking"), input: ["text"], output: ["scores"] },
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
    dell: { logo: "/brand/dell-logo.svg", product: "", label: "DELL PRO MAX GB10", subtitle: "AI DEVELOPER DESKTOP" },
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
      ...languageHeader,
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
    headers: { ...languageHeader, ...(key ? { "X-MyDGX-Key": key } : {}) },
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

const MODEL_CATEGORIES = {
  text: { label: t("Texto"), icon: MessageSquare, color: "#68b929" },
  code: { label: t("Código"), icon: Terminal, color: "#68b929" },
  vision: { label: t("Visión"), icon: Eye, color: "#e09a2b" },
  embeddings: { label: t("Embeddings"), icon: Layers, color: "#2fb3a3" },
  image: { label: t("Imagen"), icon: ImageIcon, color: "#c05bd6" },
  video: { label: t("Vídeo"), icon: Film, color: "#9b66db" },
  audio: { label: t("Voz / audio"), icon: Mic, color: "#3e8fdc" },
} satisfies Record<string, { label: string; icon: typeof Gauge; color: string }>;
type ModelCategoryKey = keyof typeof MODEL_CATEGORIES;
const MODEL_CATEGORY_KEYS = Object.keys(MODEL_CATEGORIES) as ModelCategoryKey[];

function localModelCategoryKey(searchable: string): ModelCategoryKey {
  const text = searchable.toLowerCase();
  if (/(audio|voice|speech|whisper|tts|asr|wav2vec|bark|vocos|vocoder|snac|encodec|chatterbox|kokoro|xtts|parler|\d+khz)/.test(text)) return "audio";
  if (/(wan2|wan_2|ltx|video|text-to-video|image-to-video)/.test(text)) return "video";
  if (/(flux|diffusion|sdxl|sd3|hidream|image-gen|qwen-image|text-to-image)/.test(text)) return "image";
  if (/(vision|llava|[-_.]vl\b|[-_.]vl[-_.]|clip|siglip|mmproj)/.test(text)) return "vision";
  if (/(embed|rerank|bge|e5-|gte-|sentence-transformers|minilm|mpnet)/.test(text)) return "embeddings";
  if (/(coder|code)/.test(text)) return "code";
  return "text";
}

function localModelCategory(searchable: string): { label: string; icon: typeof Gauge; color: string } {
  return MODEL_CATEGORIES[localModelCategoryKey(searchable)];
}

function profileModelCategory(model: ProfileModel): ModelCategoryKey {
  if (model.task === "tts" || model.task === "asr") return "audio";
  if (model.task === "image-generation") return "image";
  if (model.task === "video-generation") return "video";
  if (model.task === "embeddings" || model.task === "reranking") return "embeddings";
  if (model.task === "vision" || model.mmproj_filename || model.mmproj_file || model.input_modalities?.includes("image")) return "vision";
  const guessed = localModelCategoryKey(`${model.model_repo} ${model.model_filename} ${model.model_ref}`);
  return guessed === "code" || guessed === "vision" ? guessed : "text";
}

function profileCategories(models: ProfileModel[]): ModelCategoryKey[] {
  const found = new Set(models.filter((model) => model.enabled !== false).map(profileModelCategory));
  return MODEL_CATEGORY_KEYS.filter((key) => found.has(key));
}

function CategoryFilters({ value, onChange, counts, total, className = "" }: {
  value: ModelCategoryKey | "all";
  onChange: (value: ModelCategoryKey | "all") => void;
  counts: Record<ModelCategoryKey, number>;
  total: number;
  className?: string;
}) {
  return <div className={`category-filters ${className}`} role="toolbar" aria-label={t("Filtrar por categoría")}>
    <button className={value === "all" ? "active" : ""} aria-pressed={value === "all"} onClick={() => onChange("all")}>{t("Todas")}<b>{total}</b></button>
    {MODEL_CATEGORY_KEYS.map((key) => {
      const { label, icon: Icon, color } = MODEL_CATEGORIES[key];
      return <button
        key={key}
        className={value === key ? "active" : ""}
        aria-pressed={value === key}
        disabled={!counts[key] && value !== key}
        style={{ "--category": color } as CSSProperties}
        onClick={() => onChange(value === key ? "all" : key)}
      ><Icon size={13} />{label}<b>{counts[key]}</b></button>;
    })}
  </div>;
}

function categoryCounts<T>(items: T[], categoriesOf: (item: T) => ModelCategoryKey[]): Record<ModelCategoryKey, number> {
  return Object.fromEntries(MODEL_CATEGORY_KEYS.map((key) => [
    key, items.filter((item) => categoriesOf(item).includes(key)).length,
  ])) as Record<ModelCategoryKey, number>;
}

function CategoryBadges({ categories }: { categories: ModelCategoryKey[] }) {
  if (!categories.length) return null;
  return <span className="category-badges">
    {categories.map((key) => {
      const { label, icon: Icon, color } = MODEL_CATEGORIES[key];
      return <span key={key} className="category-badge" style={{ "--category": color } as CSSProperties}><Icon size={11} />{label}</span>;
    })}
  </span>;
}

const LOCAL_MODEL_SECTIONS = [
  { key: "text", sourceLabel: t("Texto"), title: t("Chat y texto"), managed: false },
  { key: "code", sourceLabel: t("Código"), title: t("Código"), managed: false },
  { key: "vision", sourceLabel: t("Visión"), title: t("Chat con visión"), managed: false },
  { key: "embeddings", sourceLabel: t("Embeddings"), title: t("Embeddings y reranking"), managed: false },
  { key: "image", sourceLabel: t("Imagen"), title: t("Generación de imagen"), managed: true },
  { key: "video", sourceLabel: t("Vídeo"), title: t("Generación de vídeo"), managed: true },
  { key: "audio", sourceLabel: t("Voz / audio"), title: t("Voz y audio"), managed: true },
] as const;

function parametersFromName(name: string): string {
  const moe = name.match(/(\d+(?:\.\d+)?)B[-_ ]A(\d+(?:\.\d+)?)B/i);
  if (moe) return t("{total}B · {active}B activos", { total: moe[1], active: moe[2] });
  const dense = name.match(/(?:^|[-_ :.])(\d+(?:\.\d+)?)([BM])(?=$|[-_ .])/i);
  return dense ? `${dense[1]}${dense[2].toUpperCase()}` : "";
}

function contextLabel(value: unknown): string {
  const tokens = Number(value);
  if (!Number.isFinite(tokens) || tokens <= 0) return "";
  return tokens >= 1024 ? t("{n}K tokens", { n: Math.round(tokens / 1024) }) : t("{tokens} tokens", { tokens });
}

function HuggingFaceIcon({ size = 26 }: { size?: number }) {
  return <svg className="hf-logo" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={t("Hugging Face")}>
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
  source, name, path, loaded, assistant, badges, specs, meta, size, total, estimated, memory, actions, extra, categoryHint,
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
  memory?: MemoryEstimate | null;
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
          <span className={`badge ${loaded ? "live" : "local"}`}>{loaded ? t("Cargado") : t("En disco")}</span>
          {badges}
        </div>
        {path && path !== name && <small className="lc-path" title={path}>{path}</small>}
        <div className="lc-tags">
          <span className="lc-tag category"><CategoryIcon size={11} /> {category.label}</span>
          <span className="lc-tag">{source === "huggingface" ? t("Hugging Face") : source === "ollama" ? t("Ollama") : t("Runtime")}</span>
          {meta && <span className="lc-meta">{meta}</span>}
        </div>
      </div>
      {memory
        ? <ModelSizeGauge
          size={memory.memory_mb * 1024 * 1024}
          total={total}
          estimated
          label={loaded ? t("Memoria") : t("Memoria al encender")}
          detail={[t("{size} en disco", { size: bytes(size) }), memory.context_size ? t("{n}K contexto", { n: Math.round(memory.context_size / 1024) }) : "", memory.cache_type ? `KV ${memory.cache_type}` : ""].filter(Boolean).join(" · ")}
        />
        : <ModelSizeGauge size={size} total={total} estimated={estimated} label={source === "runtime" ? t("Memoria") : t("Tamaño")} />}
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
  label = t("Tamaño"),
  detail,
}: {
  size: number;
  total: number;
  estimated?: boolean;
  label?: string;
  detail?: string;
}) {
  const ratio = total > 0 ? size / total : 0;
  const level = ratio >= 0.85 ? "critical" : ratio >= 0.7 ? "high" : ratio >= 0.5 ? "medium" : "comfortable";
  const percentage = Math.max(0, Math.min(100, ratio * 100));
  const comparison = t("{prefix}{size} de {total}", { prefix: estimated ? "~" : "", size: bytes(size), total: bytes(total) });

  return (
    <div className="model-size">
      <small>{label}</small>
      <strong>{estimated ? "~" : ""}{bytes(size)}</strong>
      {total > 0 && (
        <div
          className={`model-size-gauge ${level}`}
          title={t("{comparison} ({round}% de la RAM total)", { comparison: comparison, round: Math.round(ratio * 100) })}
          role="meter"
          aria-label={t("{label}: {comparison}", { label, comparison })}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Math.min(size, total)}
        >
          <span className="model-size-gauge-fill" style={{ width: `${percentage}%` }} />
          <span className="model-size-gauge-label">{comparison}</span>
        </div>
      )}
      {detail && <small className="model-size-detail" title={t("Pesos y mmproj, caché KV según la cabecera del GGUF y buffers de cálculo")}>{detail}</small>}
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
  system: t("Kernel, tablas de páginas y procesos que no son runtimes de IA: servicios del sistema, Docker, el propio MyDGX."),
  driver: t("Memoria reservada por el driver de NVIDIA para CUDA: KV cache, buffers de cómputo y contextos. En el GB10 no figura en ningún proceso, así que no se puede atribuir con certeza; casi siempre pertenece a los modelos cargados. Se libera al detenerlos."),
  cache: t("Copias en RAM de ficheros leídos hace poco (pesos de modelos, descargas). Cuenta como disponible: el kernel la cede al cargar modelos y MyDGX la vacía cuando un modelo no cabe en la memoria libre."),
  available: t("Memoria sin ningún uso, utilizable al instante."),
} as const;

const MEMORY_RUNTIME_LABELS: Record<string, string> = {
  "llama-server": t("Servidor llama.cpp"),
  ollama: t("Servidor Ollama"),
  comfyui: t("Motor ComfyUI de imagen y vídeo"),
  whisper: t("Servicio Whisper de transcripción"),
  tts: t("Runtime TTS CUDA"),
  "open-webui": t("Interfaz Open WebUI"),
  gateway: t("Gateway API OpenAI compatible"),
  searxng: t("Buscador SearXNG"),
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
        runtime.models.length ? t("Modelos en memoria: {join}.", { join: runtime.models.join(", ") }) : "",
        t("Memoria real del proceso: pesos, KV cache y buffers CUDA en la memoria unificada."),
        runtime.managed ? "" : t("No lo lanzó MyDGX: no se detiene al vaciar memoria para benchmarks."),
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
      ...(memory.system_bytes > 0 ? [{ name: t("Sistema y otros"), bytes: memory.system_bytes, kind: "system" as const, description: MEMORY_SEGMENT_DESCRIPTIONS.system }] : []),
      ...(driverBytes > 0 ? [{ name: t("CUDA del driver (sin proceso atribuible)"), bytes: driverBytes, kind: "driver" as const, description: MEMORY_SEGMENT_DESCRIPTIONS.driver }] : []),
      ...runtimes,
      ...(memory.cache_bytes > 0 ? [{ name: t("Caché de disco (recuperable)"), bytes: memory.cache_bytes, kind: "cache" as const, description: MEMORY_SEGMENT_DESCRIPTIONS.cache }] : []),
      { name: t("Libre"), bytes: memory.free, kind: "available" as const, description: MEMORY_SEGMENT_DESCRIPTIONS.available },
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
      ...(system > 0 ? [{ name: t("Sistema y otros"), bytes: system, kind: "system" as const, description: t("Memoria usada que no se ha podido atribuir a ningún modelo cargado.") }] : []),
      ...attributed.map((model) => ({
        ...model,
        kind: "model" as const,
        description: model.estimated ? t("Tamaño estimado a partir del modelo, no medido en el proceso.") : t("Memoria declarada por el runtime del modelo."),
      })),
      { name: t("Disponible"), bytes: available, kind: "available" as const, description: t("Memoria libre más la caché que el sistema puede ceder.") },
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
  const memory = unifiedMemorySegments(models, overview, modelMetrics);
  if (!memory.total) return null;
  const percent = (value: number) => value / memory.total * 100;
  if (compact) {
    const cacheBytes = memory.segments.filter((segment) => segment.kind === "cache").reduce((sum, segment) => sum + segment.bytes, 0);
    const compactSegments = memory.segments
      .filter((segment) => segment.kind !== "cache")
      .map((segment) => segment.kind === "available"
        ? { ...segment, bytes: segment.bytes + cacheBytes, description: t("Memoria libre más la caché de disco, que el sistema recupera al cargar modelos.") }
        : segment);
    return (
      <div className="memory-map-mini" title={t("{used} usados de {total}", { used: bytes(memory.used), total: bytes(memory.total) })}>
        <div className="memory-map-mini-bar" aria-label={t("Memoria: {used} usados de {total}", { used: bytes(memory.used), total: bytes(memory.total) })}>
          {compactSegments.map((segment, index) => (
            <span
              className={`${segment.kind} ${segment.kind === "model" ? `color-${index % 6}` : ""}`}
              key={`${segment.kind}:${segment.name}:${index}`}
              style={{ width: `${segment.bytes / memory.total * 100}%` }}
              title={t("{name}: {size} ({pct}%)\n{description}", { name: segment.name, size: `${segment.estimated ? "~" : ""}${bytes(segment.bytes)}`, pct: percent(segment.bytes).toFixed(1), description: segment.description })}
            />
          ))}
        </div>
        <small><span>{t("MEMORIA")}</span><b>{bytes(memory.used)} / {bytes(memory.total)}</b></small>
      </div>
    );
  }
  return (
    <SegmentedMap
      className={className}
      title={t("Mapa de memoria unificada")}
      badge={<span className="live-memory-indicator"><i />{" "}{t("EN VIVO")}</span>}
      summary={t("{used} usados · {available} disponibles · {total} total", { used: bytes(memory.used), available: bytes(memory.available), total: bytes(memory.total) })}
      ariaLabel={t("Memoria unificada: {used} usados y {available} disponibles", { used: bytes(memory.used), available: bytes(memory.available) })}
      total={memory.total}
      segments={memory.segments.map((segment, index) => ({ ...segment, colorIndex: segment.kind === "model" ? index : undefined }))}
    />
  );
}

type MapSegment = {
  name: string;
  bytes: number;
  kind: string;
  description: string;
  colorIndex?: number;
  estimated?: boolean;
};

function SegmentedMap({ title, badge, summary, ariaLabel, total, segments, className = "" }: {
  title: string;
  badge?: ReactNode;
  summary: string;
  ariaLabel: string;
  total: number;
  segments: MapSegment[];
  className?: string;
}) {
  const [activeSegment, setActiveSegment] = useState<number | null>(null);
  const percent = (value: number) => total > 0 ? value / total * 100 : 0;
  const offsets = segments.map((_, index) => (
    segments.slice(0, index).reduce((sum, segment) => sum + percent(segment.bytes), 0)
  ));
  const active = activeSegment !== null ? segments[activeSegment] : undefined;
  return (
    <div className={`memory-map ${className}`.trim()}>
      <div className="memory-map-heading">
        <div><strong>{title}</strong>{badge}</div>
        <small>{summary}</small>
      </div>
      <div className="memory-map-bar-wrap" onMouseLeave={() => setActiveSegment(null)}>
      <div className="memory-map-bar" role="list" aria-label={ariaLabel}>
        {segments.map((segment, index) => (
          <div
            className={`memory-map-segment ${segment.kind} ${segment.colorIndex != null ? `color-${segment.colorIndex % 6}` : ""} ${activeSegment === index ? "active" : ""}`}
            key={`${segment.kind}:${segment.name}:${index}`}
            style={{ width: `${percent(segment.bytes)}%` }}
            role="listitem"
            tabIndex={0}
            aria-label={t("{name}: {size}, {pct}%. {description}", { name: segment.name, size: bytes(segment.bytes), pct: percent(segment.bytes).toFixed(1), description: segment.description })}
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
          <b>{active.estimated ? "~" : ""}{bytes(active.bytes)} · {percent(active.bytes).toFixed(1)}{t("% del total")}</b>
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

function ActivitySection({ eyebrow, title, total, active, children }: {
  eyebrow: string;
  title: string;
  total: number;
  active: number;
  children: ReactNode;
}) {
  return (
    <details className="activity-section">
      <summary className="section-heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        <span className="activity-section-meta">
          {active > 0 && <span className="badge running">{active}{" "}{t("en curso")}</span>}
          <small>{total} {total === 1 ? t("tarea") : t("tareas")}</small>
          <ChevronDown size={18} className="activity-section-chevron" />
        </span>
      </summary>
      {children}
    </details>
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
  const stateLabel = state === "critical" ? t("Crítico") : state === "warning" ? t("Atención") : t("Normal");
  const angle = Math.PI - safe / 100 * Math.PI;
  const markerX = 60 + 45 * Math.cos(angle);
  const markerY = 64 - 45 * Math.sin(angle);
  return (
    <div className={`metric-ring-wrap ${state}`} aria-label={`${label}: ${value == null ? t("sin datos") : t("{value} por ciento", { value: Math.round(value) })}, ${stateLabel}`}>
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
        </ResponsiveContainer> : <div className="telemetry-no-data">{t("Esperando muestras históricas…")}</div>}
      </div>
      <div className="telemetry-chart-foot">
        <span>{t("Media")}{" "}<strong>{summary(average)}</strong></span>
        <span>{t("Máx.")}{" "}<strong>{summary(maximum)}</strong></span>
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

  if (!overview) return <Loading label={t("Leyendo telemetría del sistema")} />;
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
  const uptimeLabel = t("{days} d {hours} h {minutes} min", { days: uptimeDays, hours: uptimeHours, minutes: uptimeRemainingMinutes });
  const branding = deviceBranding(overview.host);
  const hour = new Date().getHours();
  const greeting = hour >= 6 && hour < 14
    ? t("Buenos días, tu Spark está")
    : hour >= 14 && hour < 21
      ? t("Buenas tardes, tu Spark está")
      : t("Buenas noches, tu Spark está");
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
    : config?.gateway_url ?? t("Cargando…");

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
              ) : <span className="eyebrow">{t("CENTRO DE CONTROL")}</span>}
              <h1>{greeting}{" "}{overview.services.ollama ? t("listo.") : t("en espera.")}</h1>
              <p>
                {overview.host.hostname} · {overview.host.architecture}{" "}{t("· activo hace")}{" "}{uptimeLabel}
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
              <span><small>{t("PLATAFORMA")}</small>{overview.host.device_model}</span>
              <span><small>GPU</small>{overview.host.gpu_name || "NVIDIA GB10"}</span>
              <span><small>{t("MEMORIA")}</small>{bytes(m.memory_total)} {t("unificada")}</span>
              <span><small>{t("DISCO")}</small>{bytes(m.disk_total)} {t("total")}</span>
            </div>
          )}
          {overview.host.is_dgx_spark && (
            <div className="hero-actions">
              {overview.services.dgx_dashboard && <a className="button secondary" href={config?.dgx_dashboard_url} target="_blank" rel="noreferrer">{t("DGX Dashboard")}{" "}<ExternalLink size={15} /></a>}
              <a className="button primary" href={config?.openwebui_url} target="_blank" rel="noreferrer">{t("Open WebUI")}{" "}<ChevronRight size={15} /></a>
              {overview.services.comfyui && <a className="button secondary" href={config?.comfyui_url} target="_blank" rel="noreferrer">ComfyUI <Sparkles size={15} /></a>}
              {(overview.web_apps ?? []).map((app) => <WebAppButton app={app} key={app.name} />)}
            </div>
          )}
        </div>
        {!overview.host.is_dgx_spark && (
          <div className="hero-actions">
            {overview.services.dgx_dashboard && <a className="button secondary" href={config?.dgx_dashboard_url} target="_blank" rel="noreferrer">{t("DGX Dashboard")}{" "}<ExternalLink size={15} /></a>}
            <a className="button primary" href={config?.openwebui_url} target="_blank" rel="noreferrer">{t("Open WebUI")}{" "}<ChevronRight size={15} /></a>
            {overview.services.comfyui && <a className="button secondary" href={config?.comfyui_url} target="_blank" rel="noreferrer">ComfyUI <Sparkles size={15} /></a>}
              {(overview.web_apps ?? []).map((app) => <WebAppButton app={app} key={app.name} />)}
          </div>
        )}
      </div>

      <div className="metrics-grid">
        <Card className="metrics-card">
          <ProgressRing value={m.gpu_utilization} label="GPU" detail={m.gpu_temperature == null ? t("No detectada") : `${m.gpu_temperature} °C`} />
          <ProgressRing value={m.cpu_percent} label="CPU" detail={t("{cpu_count} núcleos", { cpu_count: overview.host.cpu_count })} />
          <ProgressRing value={m.memory_percent} label={t("Memoria unificada")} detail={`${bytes(m.memory_used)} / ${bytes(m.memory_total)}`} />
          <ProgressRing value={m.disk_percent} label={t("Disco")} detail={`${bytes(m.disk_used)} / ${bytes(m.disk_total)}`} />
        </Card>
        <UnifiedMemoryMap models={models} overview={overview} modelMetrics={modelMetrics} className="dashboard-memory-map" />
        <Card className="quick-grid">
          <div className="card-kicker"><Gauge size={15} />{" "}{t("Recursos en vivo")}</div>
          <div className="quick-resource-row">
            <div className="quick-icon"><Thermometer /></div>
            <div className="quick-resource-copy"><small>{t("Temperatura GPU")}</small><strong>{m.gpu_temperature == null ? "—" : `${m.gpu_temperature} °C`}</strong></div>
            {m.gpu_temperature != null && <QuickScale value={m.gpu_temperature} min={30} max={100} />}
          </div>
          <div className="quick-resource-row traffic">
            <div className="quick-icon"><Plug /></div>
            <div className="quick-resource-copy"><small>{t("Consumo GPU")}</small><strong>{m.gpu_power_watts == null ? "—" : `${m.gpu_power_watts.toFixed(1)} W`}{m.gpu_power_limit_watts ? <b>{t("de {value} W", { value: m.gpu_power_limit_watts.toFixed(0) })}</b> : null}</strong></div>
            <div className="quick-sparkline" aria-label={t("Histórico reciente de consumo de la GPU")}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={telemetryData.slice(-40)}>
                  <Line type="monotone" dataKey="power" stroke="var(--amber)" strokeWidth={2.2} dot={false} isAnimationActive={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="quick-resource-row">
            <div className="quick-icon"><Database /></div>
            <div className="quick-resource-copy"><small>{t("Memoria unificada usada")}</small><strong>{bytes(m.memory_used)} <b>{Math.round(m.memory_percent)}%</b></strong></div>
            <QuickScale value={m.memory_percent} />
          </div>
          <div className="quick-resource-row traffic">
            <div className="quick-icon"><Zap /></div>
            <div className="quick-resource-copy"><small>{t("Tráfico enviado")}</small><strong>{latestTelemetry ? `${latestTelemetry.networkTx.toFixed(1)} MiB/s` : "—"} <b>{bytes(m.network_sent)} {t("total")}</b></strong></div>
            <div className="quick-sparkline" aria-label={t("Histórico reciente de tráfico enviado")}>
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
            <div className="card-kicker"><Globe size={15} />{" "}{t("Gateway API")}</div>
            <span className={`badge ${gateway?.running ? "live" : ""}`}>
              {gateway?.running ? t("En línea") : gateway?.enabled ? t("No disponible") : t("Desactivado")}
            </span>
          </div>
          <div className="gateway-summary-endpoint">
            <small>{t("BASE URL · OPENAI COMPATIBLE")}</small>
            <strong title={gatewayBaseUrl}>{gatewayBaseUrl}</strong>
          </div>
          <div className="gateway-summary-grid">
            <span title={gatewayDisplayHosts.join(", ")}><small>{t("IP / HOST")}</small><strong>{gatewayDisplayHosts.join(" · ") || "—"}</strong></span>
            <span><small>{t("PUERTO")}</small><strong>{gateway?.port ?? "—"}</strong></span>
            <span><small>{t("AUTENTICACIÓN")}</small><strong>{gateway?.api_key_configured ? t("Bearer token") : t("Sin token")}</strong></span>
            <span className="gateway-summary-models"><small>{t("MODELOS PUBLICADOS")}</small><GatewayModelList gateway={gateway} empty={t("Ningún modelo cargado")} /></span>
          </div>
          <div className="gateway-token-hint">
            <ShieldCheck size={14} />
            <span><small>{t("Token para clientes")}</small><strong>{gateway?.api_key_configured ? t("Bearer <GATEWAY_API_KEY>") : t("No requerido · solo acceso local")}</strong></span>
          </div>
        </Card>
        <Card className="status-card">
          <div className="card-kicker"><Activity size={15} />{" "}{t("Servicios")}</div>
          {Object.entries(overview.services).map(([name, online]) => (
            <div className="service-row" key={name}>
              <StatusDot online={online} />
              <span>{name.replace("_", " ")}</span>
              <small>{online ? t("En línea") : t("No disponible")}</small>
            </div>
          ))}
        </Card>
      </div>

      <section className="telemetry-history-section">
        <div className="telemetry-history-heading">
          <div>
            <span className="eyebrow">{t("HISTÓRICO DE RECURSOS")}</span>
            <h2>{t("Telemetría del sistema")}</h2>
            <small>
              {visibleRange.start.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
              {" — "}
              {visibleRange.end.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
              {historyLoading && <>{" · "}{t("actualizando…")}</>}
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
              <button className="icon-button" aria-label={t("Periodo anterior")} disabled={historyOffset >= maxHistoryOffset} onClick={() => setHistoryOffset((value) => Math.min(maxHistoryOffset, value + 1))}><ChevronLeft size={15} /></button>
              <button className="button secondary" disabled={historyOffset === 0} onClick={() => setHistoryOffset(0)}>{t("Ahora")}</button>
              <button className="icon-button" aria-label={t("Periodo siguiente")} disabled={historyOffset === 0} onClick={() => setHistoryOffset((value) => Math.max(0, value - 1))}><ChevronRight size={15} /></button>
            </div>
          </div>
        </div>
        {historyError && <div className="telemetry-history-error"><TriangleAlert size={14} />{historyError}<button onClick={() => void loadHistory()}>{t("Reintentar")}</button></div>}
        <div className="telemetry-chart-grid">
          <TelemetryChartCard
            title={t("Utilización GPU")}
            data={telemetryData}
            series={[{ key: "gpu", label: "GPU", color: "#76b900", unit: "%" }]}
            current={displayedMetrics.gpu_utilization == null ? t("No disponible") : `${displayedMetrics.gpu_utilization.toFixed(1)} %`}
            status={metricState(displayedMetrics.gpu_utilization, 75, 90)}
            domain={[0, 100]}
          />
          <TelemetryChartCard
            title={t("Temperatura GPU")}
            data={telemetryData}
            series={[{ key: "temperature", label: t("Temperatura"), color: "#ed5f5f", unit: "°C" }]}
            current={displayedMetrics.gpu_temperature == null ? t("No disponible") : `${displayedMetrics.gpu_temperature.toFixed(1)} °C`}
            status={metricState(displayedMetrics.gpu_temperature, 75, 85)}
            domain={[0, 100]}
          />
          <TelemetryChartCard
            title={t("Potencia GPU")}
            data={telemetryData}
            series={[{ key: "power", label: t("Consumo"), color: "#f0a22e", unit: "W" }]}
            current={displayedMetrics.gpu_power_watts == null ? t("No disponible") : `${displayedMetrics.gpu_power_watts.toFixed(1)} W${displayedMetrics.gpu_power_limit_watts ? ` / ${displayedMetrics.gpu_power_limit_watts.toFixed(0)} W` : ""}`}
            status={metricState(
              displayedMetrics.gpu_power_watts == null || !displayedMetrics.gpu_power_limit_watts ? null : displayedMetrics.gpu_power_watts / displayedMetrics.gpu_power_limit_watts * 100,
              75,
              90,
            )}
          />
          <TelemetryChartCard
            title={t("CPU y memoria")}
            data={telemetryData}
            series={[
              { key: "cpu", label: "CPU", color: "#4d91ff", unit: "%" },
              { key: "memory", label: t("Memoria"), color: "#a77bf3", unit: "%" },
            ]}
            current={t("{pct} % CPU", { pct: displayedMetrics.cpu_percent.toFixed(1) })}
            status={metricState(Math.max(displayedMetrics.cpu_percent, displayedMetrics.memory_percent), 75, 90)}
            domain={[0, 100]}
          />
          <TelemetryChartCard
            title={t("Red")}
            data={telemetryData}
            series={[
              { key: "networkRx", label: t("Recibido"), color: "#4d91ff", unit: "MiB/s" },
              { key: "networkTx", label: t("Enviado"), color: "#76b900", unit: "MiB/s" },
            ]}
            current={latestTelemetry ? `${latestTelemetry.networkRx.toFixed(2)} MiB/s ↓` : t("Sin muestras")}
          />
          <TelemetryChartCard
            title={t("E/S de disco")}
            data={telemetryData}
            series={[
              { key: "diskRead", label: t("Lectura"), color: "#f0a22e", unit: "MiB/s" },
              { key: "diskWrite", label: t("Escritura"), color: "#a77bf3", unit: "MiB/s" },
            ]}
            current={latestTelemetry ? t("{rate} MiB/s lectura", { rate: latestTelemetry.diskRead.toFixed(2) }) : t("Sin muestras")}
          />
          <TelemetryChartCard
            title={t("Ocupación de disco")}
            data={telemetryData}
            series={[{ key: "diskUsage", label: t("Ocupado"), color: "#33b7a2", unit: "%" }]}
            current={`${displayedMetrics.disk_percent.toFixed(1)} % · ${bytes(displayedMetrics.disk_used)}`}
            status={metricState(displayedMetrics.disk_percent, 75, 90)}
            domain={[0, 100]}
          />
        </div>
        <p className="telemetry-retention-note">{t("Las muestras se conservan en SQLite durante")}{" "}{modelMetrics.retention_hours || 168}{" "}{t("horas. Las tasas de red y disco se calculan entre muestras consecutivas.")}</p>
      </section>

      <section className="model-telemetry-section">
        <SectionHeading eyebrow={t("POR MODELO · ÚLTIMA HORA")} title={t("Consumo de inferencia")} />
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
                <div><strong title={sample.model_name}>{sample.model_name}</strong><small><StatusDot online={Boolean(sample.active)} /> {sample.active ? t("Activo") : t("Última muestra")} · {sample.engine}{sample.pid ? ` · PID ${sample.pid}` : ""}</small></div>
                <span className={`attribution ${sample.attribution}`}>{sample.attribution === "process" ? t("Proceso") : sample.attribution === "ollama" ? t("Ollama") : t("No atribuible")}</span>
              </div>
              <div className="model-telemetry-values">
                <span><small>GPU</small><strong>{sample.gpu_utilization == null ? "—" : `${sample.gpu_utilization.toFixed(1)}%`}</strong></span>
                <span><small>{t("Memoria GPU")}</small><strong>{bytes(sample.gpu_memory_bytes)}</strong></span>
                <span><small>{t("RAM / unificada")}</small><strong>{bytes(sample.unified_memory_bytes ?? sample.ram_bytes)}</strong></span>
                <span><small>CPU</small><strong>{sample.cpu_percent == null ? "—" : `${sample.cpu_percent.toFixed(1)}%`}</strong></span>
              </div>
              <div className="model-mini-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data}>
                    <defs><linearGradient id={`modelMemory${index}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} /><stop offset="100%" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs>
                    <Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 8 }} />
                    <Area type="monotone" dataKey="Memoria" name={t("Memoria")} unit=" GB" stroke="var(--accent)" fill={`url(#modelMemory${index})`} strokeWidth={1.7} />
                    <Area type="monotone" dataKey="GPU" unit="%" stroke="var(--blue)" fill="transparent" strokeWidth={1.2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <small className="telemetry-note">{sample.attribution === "external-unattributed" ? t("El motor comparte proceso o no expone métricas por modelo.") : t("Muestras conservadas en SQLite según la retención configurada.")}</small>
            </Card>;
          })}
        </div> : <Card><Empty icon={<Gauge />} title={t("Sin modelos activos")} text={t("Arranca un perfil o carga un modelo en Ollama para comenzar el histórico.")} /></Card>}
      </section>

      <ActivitySummary jobs={jobs} />
    </div>
  );
}

type ModelImportLimits = {
  max_zip_bytes: number;
  max_model_bytes: number;
  free_bytes: number;
  max_upload_now_bytes: number;
  namespace: string;
};

type ModelImportTest = {
  status: "pending" | "running" | "passed" | "failed" | "queued" | "skipped";
  message?: string;
  job_id?: string;
  run_id?: string;
  score?: number | null;
  tokens_per_second?: number | null;
  ttft_ms?: number | null;
  reliability_percent?: number | null;
  peak_memory_bytes?: number | null;
  estimated_memory_mb?: number | null;
  acceptance_rate?: number | null;
};

type ModelImportResult = {
  repo_id: string;
  files: Array<{ name: string; size: number; role: string; architecture: string; quantization: string; native_context?: number | null; runtime_supported?: boolean | null }>;
  warnings: string[];
  manifest: { name?: string; task?: string; settings?: Record<string, unknown> };
  launch: { model_filename?: string; mmproj_filename?: string; context_size?: number; estimated_memory_mb?: number; spec_type?: string; draft_filename?: string };
  test: ModelImportTest;
};

const MODEL_IMPORT_STEPS = [
  { title: t("Subir el ZIP"), detail: t("Tu navegador envía el archivo al DGX") },
  { title: t("Comprobar el contenido"), detail: t("Rutas seguras, archivos permitidos y mydgx.json") },
  { title: t("Extraer a la biblioteca"), detail: t("Copia los GGUF y comprueba que no están dañados") },
  { title: t("Analizar el modelo"), detail: t("Arquitectura, contexto, partes y memoria necesaria") },
  { title: t("Probar"), detail: t("Lo arranca como «Encender» y ejecuta un benchmark corto") },
];

const MODEL_IMPORT_TEMPLATE = `{
  "name": "Mi-Modelo-8B",
  "description": "${t("Para qué sirve, de dónde sale y cómo se entrenó.")}",
  "license": "apache-2.0",
  "base_model": "${t("autor/modelo-original")}",
  "tags": ["${t("español")}", "${t("código")}"],
  "task": "chat",
  "settings": {
    "context_size": 32768,
    "temperature": 0.7,
    "top_p": 0.9
  }
}
`;

function ModelImportView({ notify, onImported, onShowInstalled }: {
  notify: (message: string, error?: boolean) => void;
  onImported: () => void;
  onShowInstalled: (repoId: string) => void;
}) {
  const [limits, setLimits] = useState<ModelImportLimits | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [runTest, setRunTest] = useState(true);
  const [upload, setUpload] = useState<{ sent: number; total: number } | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [jobId, setJobId] = useState(() => localStorage.getItem("mydgx-model-import-job") || "");
  const [job, setJob] = useState<Job | null>(null);
  const [benchmarkJob, setBenchmarkJob] = useState<Job | null>(null);
  const [result, setResult] = useState<ModelImportResult | null>(null);
  const [lastStep, setLastStep] = useState(0);
  const request = useRef<XMLHttpRequest | null>(null);
  const announced = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);
  const importedRef = useRef(onImported);
  importedRef.current = onImported;

  useEffect(() => {
    api<ModelImportLimits>("/api/models/import/limits").then(setLimits).catch(() => setLimits(null));
  }, [jobId]);

  const active = Boolean(job && activeJobStatuses.has(job.status));
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const current = await api<Job>(`/api/jobs/${jobId}`);
        if (stopped) return;
        setJob(current);
        const step = /Paso (\d)\/5/.exec(current.message)?.[1];
        if (step) setLastStep(Number(step) - 1);
        if (current.progress >= 77 || current.status === "completed") {
          const found = await api<ModelImportResult>(`/api/jobs/${jobId}/result`).catch(() => null);
          if (!stopped && found) {
            setResult(found);
            if (found.test.job_id && found.test.status === "running") {
              setBenchmarkJob(await api<Job>(`/api/jobs/${found.test.job_id}`).catch(() => null));
            }
          }
        }
        if (current.status === "completed" && announced.current !== jobId) {
          announced.current = jobId;
          importedRef.current();
        }
      } catch {
        if (!stopped) setJob(null);
      }
    };
    void poll();
    const timer = window.setInterval(poll, 2000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [jobId]);

  useEffect(() => {
    if (job && !activeJobStatuses.has(job.status)) setBenchmarkJob(null);
  }, [job]);

  function chooseFile(candidate: File | undefined) {
    if (!candidate) return;
    setUploadError("");
    if (!candidate.name.toLowerCase().endsWith(".zip")) {
      setFile(null);
      setUploadError(t("Elige un archivo .zip (mira el paso 3 para crearlo)."));
      return;
    }
    setFile(candidate);
  }

  function startUpload() {
    if (!file) return;
    if (limits && file.size > limits.max_upload_now_bytes) {
      setUploadError(t("El ZIP ocupa {size} y ahora caben {max_upload_now_bytes}: libera espacio en Almacenamiento.", { size: bytes(file.size), max_upload_now_bytes: bytes(limits.max_upload_now_bytes) }));
      return;
    }
    const xhr = new XMLHttpRequest();
    request.current = xhr;
    setUploadError("");
    setResult(null);
    setJob(null);
    setLastStep(0);
    setUpload({ sent: 0, total: file.size });
    xhr.open("POST", `/api/models/import/upload?filename=${encodeURIComponent(file.name)}&run_test=${runTest}`);
    const key = getApiKey();
    if (key) xhr.setRequestHeader("X-MyDGX-Key", key);
    xhr.setRequestHeader("Content-Type", "application/zip");
    xhr.upload.onprogress = (event) => setUpload({ sent: event.loaded, total: event.total || file.size });
    xhr.onload = () => {
      request.current = null;
      setUpload(null);
      let body: { job_id?: string; detail?: string } = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 401 && xhr.getResponseHeader("X-MyDGX-Auth-Required") === "password") {
        window.dispatchEvent(new Event("mydgx-auth-required"));
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.job_id) {
        localStorage.setItem("mydgx-model-import-job", body.job_id);
        setJobId(body.job_id);
        setFile(null);
        notify(t("ZIP subido; comprobando el modelo"));
      } else {
        setUploadError(body.detail || t("La subida falló (HTTP {status})", { status: xhr.status }));
      }
    };
    xhr.onerror = () => { request.current = null; setUpload(null); setUploadError(t("Se perdió la conexión durante la subida. Vuelve a intentarlo.")); };
    xhr.onabort = () => { request.current = null; setUpload(null); setUploadError(t("Subida cancelada.")); };
    xhr.send(file);
  }

  async function cancelImport() {
    if (request.current) { request.current.abort(); return; }
    const target = benchmarkJob && activeJobStatuses.has(benchmarkJob.status) ? benchmarkJob.id : jobId;
    try {
      await api(`/api/jobs/${target}/cancel`, { method: "POST" });
      notify(t("Cancelación solicitada"));
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  function reset() {
    localStorage.removeItem("mydgx-model-import-job");
    setJobId("");
    setJob(null);
    setResult(null);
    setUploadError("");
    setLastStep(0);
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([MODEL_IMPORT_TEMPLATE], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "mydgx.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const failed = job?.status === "failed" || job?.status === "cancelled";
  const done = job?.status === "completed";
  const test = result?.test;
  const stepState = (index: number): "done" | "running" | "error" | "waiting" => {
    if (upload) return index === 0 ? "running" : "waiting";
    if (!job) return uploadError && index === 0 ? "error" : "waiting";
    if (done) {
      if (index < 4) return "done";
      return test?.status === "passed" ? "done" : test?.status === "failed" ? "error" : "waiting";
    }
    if (failed) return index < lastStep ? "done" : index === lastStep ? "error" : "waiting";
    return index < lastStep ? "done" : index === lastStep ? "running" : "waiting";
  };
  const uploadPercent = upload ? Math.round((upload.sent / Math.max(upload.total, 1)) * 100) : 0;
  const stepDetail = (index: number) => {
    if (index === 0 && upload) return t("{sent} de {total} · {uploadPercent} %", { sent: bytes(upload.sent), total: bytes(upload.total), uploadPercent: uploadPercent });
    if (index === lastStep && job && (active || failed)) return job.message;
    if (index === 4 && benchmarkJob) return `${Math.round(benchmarkJob.progress)} % · ${benchmarkJob.message}`;
    if (index === 4 && test && test.status !== "pending" && test.status !== "running") return test.message || "";
    return MODEL_IMPORT_STEPS[index].detail;
  };
  const showProgress = Boolean(upload || job || uploadError);
  const mainFile = result?.files.find((item) => item.name === result.launch.model_filename) ?? result?.files.find((item) => item.role === "main");

  return <div className="model-import-view">
    <Card className="model-import-hero">
      <div className="model-import-hero-icon"><FileArchive size={26} /></div>
      <div>
        <span className="card-kicker">{t("IMPORTAR DESDE UN ZIP")}</span>
        <h3>{t("Trae un modelo GGUF que ya tienes en tu ordenador")}</h3>
        <p>
          {t("Útil para modelos que no están en Hugging Face, versiones propias o equipos sin internet. MyDGX lo guarda en tu biblioteca como")}{" "}<code>{limits?.namespace ?? "imported"}/nombre</code>{t(", lo comprueba y, si quieres, lo arranca y le pasa un benchmark corto para confirmar que funciona.")}
        </p>
        {limits && <div className="model-import-limits">
          <span><HardDrive size={13} />{" "}{t("Espacio libre:")}{" "}<b>{bytes(limits.free_bytes)}</b></span>
          <span><Upload size={13} />{" "}{t("ZIP máximo ahora:")}{" "}<b>{bytes(limits.max_upload_now_bytes)}</b></span>
          <span><Cpu size={13} />{" "}{t("Modelo principal hasta:")}{" "}<b>{bytes(limits.max_model_bytes)}</b></span>
        </div>}
      </div>
    </Card>

    <div className="model-import-guide">
      <Card className="model-import-step">
        <span className="model-import-step-number">1</span>
        <strong>{t("Reúne los archivos en una carpeta")}</strong>
        <ul>
          <li><b>{t("Obligatorio:")}</b>{" "}{t("el modelo en formato")}{" "}<code>.gguf</code>. {t("Si viene en partes")} (<code>…-00001-of-00003.gguf</code>{t("), incluye")}{" "}<b>{t("todas")}</b>.</li>
          <li><b>{t("Visión (opcional):")}</b>{" "}{t("el proyector")}{" "}<code>mmproj-….gguf</code>.</li>
          <li><b>{t("Más velocidad (opcional):")}</b>{" "}{t("un drafter")}{" "}<code>mtp-…</code>, <code>dspark-…</code> o <code>eagle3-….gguf</code>.</li>
          <li><b>{t("Descripción (opcional):")}</b> <code>README.md</code> y <code>LICENSE</code>.</li>
        </ul>
        <small>{t("Solo se admite GGUF (el formato de llama.cpp). Safetensors, PyTorch u otros archivos se ignoran.")}</small>
      </Card>
      <Card className="model-import-step">
        <span className="model-import-step-number">2</span>
        <strong>{t("Añade")}{" "}<code>mydgx.json</code>{" "}{t("si quieres fijar ajustes")}</strong>
        <p>{t("Es opcional: sin él MyDGX elige contexto y parámetros automáticamente. Todos los campos son opcionales.")}</p>
        <pre className="model-import-template">{MODEL_IMPORT_TEMPLATE}</pre>
        <small>
          <b>task</b>: <code>chat</code> {t("o")} <code>vision</code>. <b>settings</b> {t("admite lo mismo que el editor de ajustes del modelo:")}
          <code> context_size</code>, <code>context_max</code>, <code>temperature</code>, <code>top_p</code>, <code>top_k</code>, <code>min_p</code>,
          <code> repeat_penalty</code>, <code>model_filename</code>, <code>mmproj_filename</code>, <code>spec_type</code>, <code>draft_filename</code>…
        </small>
        <button type="button" className="button secondary compact" onClick={downloadTemplate}><Download size={14} />{" "}{t("Descargar plantilla")}</button>
      </Card>
      <Card className="model-import-step">
        <span className="model-import-step-number">3</span>
        <strong>{t("Comprime la carpeta en un ZIP")}</strong>
        <p><b>{t("Finder:")}</b>{" "}{t("clic derecho sobre la carpeta →")}{" "}<i>{t("Comprimir")}</i>.</p>
        <p><b>{t("Terminal")}</b>{" "}{t("(más rápido, no recomprime los GGUF):")}</p>
        <pre className="model-import-template">{"cd ~/Downloads/mi-modelo\nzip -0 -r ../mi-modelo.zip ."}</pre>
        <small>{t("Sin contraseña y sin enlaces simbólicos. Da igual si los archivos están en la raíz o dentro de una carpeta.")}</small>
      </Card>
    </div>

    <Card className="model-import-upload">
      <span className="model-import-step-number">4</span>
      <strong>{t("Sube el ZIP")}</strong>
      <label
        className={`model-import-drop${dragging ? " dragging" : ""}${file ? " ready" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files?.[0]); }}
      >
        <input ref={inputRef} type="file" accept=".zip,application/zip" disabled={Boolean(upload) || active} onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
        <FileArchive size={28} />
        {file ? <span><b>{file.name}</b> · {bytes(file.size)}</span> : <span>{t("Arrastra aquí el ZIP o")}{" "}<u>{t("elige un archivo")}</u></span>}
      </label>
      <label className="model-import-option">
        <input type="checkbox" checked={runTest} onChange={(event) => setRunTest(event.target.checked)} disabled={Boolean(upload)} />
        <span>
          <b>{t("Probar al terminar")}</b>{" "}{t("(recomendado): arranca el modelo y ejecuta un benchmark corto. Mientras dura (unos minutos) el chat y los perfiles quedan en pausa.")}
        </span>
      </label>
      <div className="model-import-actions">
        <button type="button" className="button" disabled={!file || Boolean(upload) || active} onClick={startUpload}><Upload size={15} />{" "}{t("Importar modelo")}</button>
        {(upload || active) && <button type="button" className="button secondary" onClick={() => void cancelImport()}><X size={15} />{" "}{t("Cancelar")}</button>}
        {(done || failed) && <button type="button" className="button secondary" onClick={reset}><Plus size={15} />{" "}{t("Importar otro")}</button>}
      </div>
      {upload && <div className="model-import-bar"><i style={{ width: `${uploadPercent}%` }} /></div>}
      {upload && <small>{t("No cierres ni recargues esta pestaña hasta que termine la subida.")}</small>}
    </Card>

    {showProgress && <Card className="model-import-progress">
      <strong>{t("Progreso")}</strong>
      <ol className="model-import-timeline">
        {MODEL_IMPORT_STEPS.map((step, index) => {
          const state = stepState(index);
          const skipped = index === 4 && done && test && ["skipped", "queued"].includes(test.status);
          return <li key={step.title} className={`state-${skipped ? "skipped" : state}`}>
            <span className="model-import-dot">
              {state === "done" ? <CheckCircle2 size={16} /> : state === "error" ? <TriangleAlert size={16} /> : state === "running" ? <RefreshCw size={14} className="spin" /> : index + 1}
            </span>
            <div><b>{step.title}</b><small>{stepDetail(index)}</small></div>
          </li>;
        })}
      </ol>
      {(uploadError || failed) && <div className="model-import-error">
        <TriangleAlert size={16} />
        <div>
          <b>{job?.status === "cancelled" ? t("Importación cancelada") : t("No se pudo importar")}</b>
          <span>{uploadError || job?.message}</span>
          <small>{t("Corrige el ZIP siguiendo los pasos 1 a 3 y vuelve a subirlo. No se ha guardado nada a medias.")}</small>
        </div>
      </div>}
    </Card>}

    {result && <Card className={`model-import-result${test?.status === "failed" ? " warn" : ""}`}>
      <div className="model-import-result-head">
        <span className={`model-import-verdict ${test?.status ?? "pending"}`}>
          {test?.status === "passed" ? <CheckCircle2 size={22} /> : test?.status === "failed" ? <TriangleAlert size={22} /> : <PackageCheck size={22} />}
        </span>
        <div>
          <strong>{test?.status === "passed" ? t("Listo: el modelo arranca y responde")
            : test?.status === "failed" ? t("Importado, pero la prueba falló")
            : test?.status === "running" ? t("Importado · probándolo ahora")
            : t("Modelo importado")}</strong>
          <small>{t("Disponible en Instalados como")}{" "}<code>{result.repo_id}</code></small>
        </div>
        <button type="button" className="button secondary compact" onClick={() => onShowInstalled(result.repo_id)}><HardDrive size={14} />{" "}{t("Ver en Instalados")}</button>
      </div>

      {test && ["passed", "failed"].includes(test.status) && <div className="model-import-metrics">
        <div><span>{t("Score MyDGX")}</span><b>{test.score == null ? "—" : Math.round(test.score)}<small>/100</small></b></div>
        <div><span>{t("Velocidad")}</span><b>{test.tokens_per_second == null ? "—" : test.tokens_per_second.toFixed(1)}<small>{" "}{t("tok/s")}</small></b></div>
        <div><span>{t("Primera palabra")}</span><b>{test.ttft_ms == null ? "—" : (test.ttft_ms / 1000).toFixed(2)}<small> s</small></b></div>
        <div title={t("Memoria unificada máxima de todo el equipo durante la prueba, incluidos otros programas")}><span>{t("Memoria pico del equipo")}</span><b>{test.peak_memory_bytes ? bytes(test.peak_memory_bytes) : "—"}</b>{test.estimated_memory_mb ? <small>{t("el modelo, ~")}{bytes(test.estimated_memory_mb * 1024 ** 2)}{" "}{t("con el contexto de la prueba")}</small> : null}</div>
        <div><span>{t("Respuestas válidas")}</span><b>{test.reliability_percent == null ? "—" : Math.round(test.reliability_percent)}<small> %</small></b></div>
        {test.acceptance_rate != null && <div><span>{t("Aceptación del drafter")}</span><b>{Math.round(test.acceptance_rate * 100)}<small> %</small></b></div>}
      </div>}
      {test?.status === "failed" && <div className="model-import-error">
        <TriangleAlert size={16} />
        <div>
          <b>{t("Qué ha pasado")}</b>
          <span>{test.message || t("El benchmark no obtuvo respuestas válidas")}</span>
          <small>{t("El modelo sigue instalado. Prueba a bajar el contexto en el editor de ajustes del modelo (icono de deslizadores) o revisa Logs.")}</small>
        </div>
      </div>}
      {test && ["queued", "skipped"].includes(test.status) && <small className="model-import-note">{test.message}</small>}

      <div className="model-import-launch">
        <span><b>{t("Archivo que usa «Encender»:")}</b> {result.launch.model_filename}</span>
        <span><b>{t("Contexto:")}</b> {shortContext(result.launch.context_size)}{mainFile?.native_context ? t(" de {native_context} nativos", { native_context: shortContext(mainFile.native_context) }) : ""}</span>
        {result.launch.estimated_memory_mb ? <span><b>{t("Memoria estimada:")}</b> {bytes(result.launch.estimated_memory_mb * 1024 ** 2)}</span> : null}
        {result.launch.mmproj_filename && <span><b>{t("Visión:")}</b> {result.launch.mmproj_filename}</span>}
        {result.launch.spec_type && <span><b>{t("Especulativa:")}</b> {SPEC_LABELS[result.launch.spec_type] ?? result.launch.spec_type} · {result.launch.draft_filename}</span>}
        {result.manifest.settings && Object.keys(result.manifest.settings).length > 0 && <span><b>{t("Ajustes de mydgx.json:")}</b> {Object.entries(result.manifest.settings).map(([key, value]) => `${key}=${String(value)}`).join(", ")}</span>}
      </div>

      <table className="model-import-files">
        <thead><tr><th>{t("Archivo")}</th><th>{t("Uso")}</th><th>{t("Arquitectura")}</th><th>{t("Cuant.")}</th><th>{t("Contexto")}</th><th>{t("Tamaño")}</th></tr></thead>
        <tbody>{result.files.map((item) => <tr key={item.name}>
          <td>{item.name}</td>
          <td>{roleLabel(item.role)}</td>
          <td>{item.architecture || "—"}{item.runtime_supported === false && <TriangleAlert size={12} aria-label={t("llama.cpp no la reconoce")} />}</td>
          <td>{item.quantization || "—"}</td>
          <td>{shortContext(item.native_context ?? undefined)}</td>
          <td>{bytes(item.size)}</td>
        </tr>)}</tbody>
      </table>
      {result.warnings.length > 0 && <ul className="model-import-warnings">{result.warnings.map((warning) => <li key={warning}><Info size={13} /> {warning}</li>)}</ul>}
    </Card>}
  </div>;
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
  const [tab, setTab] = useState<"installed" | "catalog" | "recipes" | "ollama" | "import">(() => {
    const stored = localStorage.getItem("mydgx-models-tab");
    return stored === "catalog" || stored === "recipes" || stored === "ollama" || stored === "import" ? stored : "installed";
  });
  const [catalogMode, setCatalogMode] = useState<"spark" | "all" | "favorites">(() => {
    const stored = localStorage.getItem("mydgx-models-catalog");
    return stored === "all" || stored === "favorites" ? stored : "spark";
  });
  const [ollamaName, setOllamaName] = useState("");
  const [localFilter, setLocalFilter] = useState<LocalModelFilter>("all");
  const [localQuery, setLocalQuery] = useState("");
  const [query, setQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>(storedHfSearches);
  const [searchHistoryOpen, setSearchHistoryOpen] = useState(false);
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
  const downloads = useDownloadTracker(jobs, refresh);
  const ollamaInstalled = useMemo(
    () => new Set((models?.ollama ?? []).map((item) => String(item.name ?? "").toLowerCase())),
    [models?.ollama],
  );
  const ollamaTarget = ollamaName.trim().toLowerCase();
  const ollamaAlreadyInstalled = Boolean(ollamaTarget) && (ollamaInstalled.has(ollamaTarget) || (!ollamaTarget.includes(":") && ollamaInstalled.has(`${ollamaTarget}:latest`)));
  const [pendingDownload, setPendingDownload] = useState<PendingDownload | null>(null);
  const [settingsModel, setSettingsModel] = useState<string | null>(null);
  const [addToProfile, setAddToProfile] = useState<AddToProfileRequest | null>(null);
  const [chosenContexts, setChosenContexts] = useState<Record<string, number | undefined>>({});
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
    const name = ollamaName.trim();
    if (!name || downloads.isDownloading(name) || ollamaAlreadyInstalled) return;
    downloads.track(name);
    try {
      const result = await api<{ job_id: string }>("/api/models/ollama/pull", { method: "POST", body: JSON.stringify({ name }) });
      downloads.track(name, result.job_id);
      setOllamaName("");
      notify(t("Descarga de Ollama iniciada"));
      refresh();
    } catch (error) {
      downloads.untrack(name);
      notify((error as Error).message, true);
    }
  }

  function searchGgufVariant(text: string) {
    setQuery(text);
    setTimeout(() => searchFormRef.current?.requestSubmit(), 0);
  }

  function rememberSearch(text: string) {
    const value = text.trim();
    if (!value) return;
    setRecentSearches((current) => {
      const next = [value, ...current.filter((item) => item.toLocaleLowerCase() !== value.toLocaleLowerCase())].slice(0, 8);
      localStorage.setItem(HF_RECENT_SEARCHES_KEY, JSON.stringify(next));
      return next;
    });
  }

  function reuseSearch(text: string) {
    setQuery(text);
    setSearchHistoryOpen(false);
    setTimeout(() => searchFormRef.current?.requestSubmit(), 0);
  }

  function clearSearchHistory() {
    localStorage.removeItem(HF_RECENT_SEARCHES_KEY);
    setRecentSearches([]);
    setSearchHistoryOpen(false);
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    rememberSearch(query);
    setSearchHistoryOpen(false);
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
        ? t("{visible} modelo(s) nuevos{extra}", { visible, extra: fresh.length > visible ? t(" · {value} ya descargados ocultos", { value: fresh.length - visible }) : "" })
        : t("No hay más modelos que encajen con estos filtros"));
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

  async function preflightDownload(pending: PendingDownload) {
    setDownloadBusy(pending.repoId);
    try {
      const report = await api<PreflightReport>("/api/models/huggingface/preflight", {
        method: "POST",
        body: JSON.stringify({ repo_id: pending.repoId, revision: pending.revision, files: pending.files }),
      });
      setPendingDownload({ ...pending, report });
    } catch (error) {
      setPendingDownload({ ...pending, error: (error as Error).message });
    } finally {
      setDownloadBusy(null);
    }
  }

  async function confirmDownload(extraFiles: string[]) {
    const pending = pendingDownload;
    if (!pending) return;
    setPendingDownload(null);
    setDownloadBusy(pending.repoId);
    downloads.track(pending.repoId);
    const files = [...pending.files, ...extraFiles.filter((name) => !pending.files.includes(name))];
    try {
      const result = await api<{ job_id: string; deduplicated?: boolean }>("/api/models/huggingface/files/download", {
        method: "POST",
        body: JSON.stringify({ repo_id: pending.repoId, revision: pending.revision, files }),
      });
      downloads.track(pending.repoId, result.job_id);
      notify(result.deduplicated
        ? t("La descarga de {repoId} ya estaba en curso; no se ha duplicado", { repoId: pending.repoId })
        : `${pending.label}${extraFiles.length ? t(" · con drafter") : ""}`);
      pending.onDone?.();
      refresh();
    } catch (error) {
      downloads.untrack(pending.repoId);
      notify((error as Error).message, true);
    } finally {
      setDownloadBusy(null);
    }
  }

  function recommendedDownloadButton(repoId: string, recommendedFiles: string[], installed: boolean) {
    const opening = inspectingRepo === repoId;
    if (installed || downloads.isDownloading(repoId)) {
      return <>
        <button className="button secondary" disabled={inspectingRepo !== null} onClick={() => inspect(repoId, recommendedFiles)}><Search className={opening ? "spin" : ""} size={15} /> {opening ? t("Abriendo…") : t("Detalles")}</button>
        <button className="button primary" disabled>{installed ? <CheckCircle2 size={15} /> : <RefreshCw className="spin" size={15} />}{" "}{installed ? t("Instalado") : t("Descargando…")}</button>
      </>;
    }
    return <button
      className="button primary"
      disabled={inspectingRepo !== null}
      onClick={() => inspect(repoId, recommendedFiles)}
      title={t("MyDGX seleccionará la cuantización adecuada y todos sus archivos")}
    ><Download className={opening ? "spin" : ""} size={15} /> {opening ? t("Preparando…") : t("Descargar recomendada")}</button>;
  }

  function downloadSelected() {
    if (!inspection || !selectedFiles.length) return;
    void preflightDownload({
      repoId: inspection.repo_id,
      revision: inspection.remote?.revision || "main",
      files: selectedFiles,
      label: t("{length} archivo(s) añadidos a la cola", { length: selectedFiles.length }),
      onDone: () => {
        setInspection(null);
        setSelectedFiles([]);
      },
    });
  }

  async function downloadRecommendation(model: HfRecommendation) {
    if (model.gated) {
      await inspect(model.id, model.recommended_files);
      return;
    }
    if (model.recommended_files.length) {
      void preflightDownload({
        repoId: model.id,
        revision: "main",
        files: model.recommended_files,
        label: t("Descarga recomendada iniciada: {recommended_quantization}", { recommended_quantization: model.recommended_quantization }),
      });
      return;
    }
    setDownloadBusy(model.id);
    downloads.track(model.id);
    try {
      const result = await api<{ job_id: string; deduplicated?: boolean }>("/api/models/huggingface/download", {
        method: "POST",
        body: JSON.stringify({ repo_id: model.id, revision: "main" }),
      });
      downloads.track(model.id, result.job_id);
      notify(result.deduplicated
        ? t("La descarga de {id} ya estaba en curso; no se ha duplicado", { id: model.id })
        : t("Descarga completa iniciada: {id}", { id: model.id }));
      refresh();
    } catch (error) {
      downloads.untrack(model.id);
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
      notify(enabled ? t("Modelo guardado en favoritos") : t("Modelo eliminado de favoritos"));
      await loadFavorites();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function togglePersistence(source: "ollama" | "huggingface", modelId: string, enabled: boolean, contextSize?: number) {
    try {
      const result = await api<{ applied: boolean }>("/api/models/persistence", {
        method: "PUT",
        body: JSON.stringify({ source, model_id: modelId, enabled, ...(enabled && contextSize ? { context_size: contextSize } : {}) }),
      });
      notify(
        `${modelId} ${enabled ? t("añadido al") : t("quitado del")} ${t("perfil Default")}`
        + (result.applied ? t(" · aplicado ahora") : t(" · se aplicará al arrancar Default")),
      );
      refresh();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function quickModel(source: "ollama" | "huggingface", modelId: string, start: boolean, contextSize?: number) {
    setQuickBusy(`${source}:${modelId}`);
    try {
      const result = await api<{ alias?: string }>(`/api/models/quick/${start ? "start" : "stop"}`, {
        method: "POST",
        body: JSON.stringify({ source, model_id: modelId, ...(start && contextSize ? { context_size: contextSize } : {}) }),
      });
      notify(start ? t("{modelId} encendido en Quick{aliasSuffix}", { modelId, aliasSuffix: result.alias ? t(" · alias {alias}", { alias: result.alias }) : "" }) : t("{modelId} apagado", { modelId }));
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
      notify(t("ComfyUI ha liberado sus modelos de memoria"));
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
      notify(t("Verificación iniciada: {repoId}", { repoId: repoId }));
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
      notify(load ? t("{name} cargado durante 10 minutos", { name }) : t("{name} descargado de memoria", { name }));
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
      notify(t("Actualización iniciada: {name}", { name: name }));
      refresh();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function cancelJob(jobId: string) {
    try {
      await api(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      notify(t("Cancelación solicitada"));
      refresh();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function remove(kind: "ollama" | "huggingface", name: string) {
    if (!window.confirm(t("¿Eliminar {name}? Esta acción libera sus archivos locales.", { name: name }))) return;
    try {
      await api(`/api/models/${kind}/${encodeURIComponent(name)}?confirm=${encodeURIComponent(name)}`, { method: "DELETE" });
      notify(t("{name} eliminado", { name }));
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
    const vision = [t("Visión"), t("Imagen"), t("Vídeo")].includes(category);
    const audio = category === t("Voz / audio");
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
  const modelGroupCount = (sourceLabel: string, loadedGroup: boolean) => (
    (loadedGroup ? (models?.runtime_models ?? []).filter((model) => matchesRuntimeFilter(model) && runtimeCategoryLabel(model) === sourceLabel).length : 0)
    + (models?.ollama ?? []).filter((model) => isActiveOllama(model) === loadedGroup && matchesLocalFilter("ollama", model) && localCategoryLabel("ollama", model) === sourceLabel).length
    + (models?.huggingface ?? []).filter((model) => isActiveHuggingFace(model) === loadedGroup && matchesLocalFilter("huggingface", model as unknown as Record<string, unknown>) && localCategoryLabel("huggingface", model as unknown as Record<string, unknown>) === sourceLabel).length
  );
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
  const recipeDownloads = jobs.filter((job) => job.kind === "profile.download" && activeJobStatuses.has(job.status)).length;
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
  const selectedResidentSize = hfFileGroups(selectedRemoteFiles).reduce(
    (total, group) => total + (group.kind === "weights" ? hfGroupResidentSize(group) : group.size),
    0,
  );
  const selectedDownloadTooLarge = Boolean(
    inspection
    && selectedSizeKnown
    && selectedResidentSize > inspection.download_limit_bytes
  );
  const matchingRecentSearches = recentSearches.filter((item) => (
    !query.trim() || item.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  ));

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
        eyebrow={t("BIBLIOTECA LOCAL")}
        title={t("Modelos")}
        action={<button className="icon-button" onClick={refresh} aria-label={t("Actualizar")}><RefreshCw size={17} /></button>}
      />
      <div className="tabs">
        <button className={tab === "installed" ? "active" : ""} onClick={() => setTab("installed")}><HardDrive size={14} />{" "}{t("Instalados")}{" "}<b className="tab-count">{localModelCount}</b></button>
        <button className={tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}><Sparkles size={14} />{" "}{t("Explorar Hugging Face")}</button>
        <button className={tab === "recipes" ? "active" : ""} onClick={() => setTab("recipes")}><ChefHat size={14} />{" "}{t("Buscar recetas")}{recipeDownloads > 0 && <b className="tab-count live">●</b>}</button>
        <button className={tab === "ollama" ? "active" : ""} onClick={() => setTab("ollama")}><Bot size={14} />{" "}{t("Descargar con Ollama")}{ollamaJobs.some((job) => activeJobStatuses.has(job.status)) && <b className="tab-count live">●</b>}</button>
        <button className={tab === "import" ? "active" : ""} onClick={() => setTab("import")}><FileArchive size={14} />{" "}{t("Importar ZIP")}{jobs.some((job) => job.kind === "models.import" && activeJobStatuses.has(job.status)) && <b className="tab-count live">●</b>}</button>
      </div>

      {tab === "recipes" ? (
        <div className="recipes-tab">
          <RecipesBrowser notify={notify} onInstalled={refresh} activeDownloads={recipeDownloads} />
        </div>
      ) : tab === "import" ? (
        <ModelImportView
          notify={notify}
          onImported={refresh}
          onShowInstalled={(repoId) => { setLocalQuery(repoId); setLocalFilter("all"); setTab("installed"); }}
        />
      ) : tab === "ollama" ? (
        <div className="ollama-pull-view">
          <Card className="ollama-hero">
            <div className="ollama-hero-icon"><Bot size={26} /></div>
            <div className="ollama-hero-copy">
              <span className="card-kicker">{t("REGISTRO DE OLLAMA")}</span>
              <h3>{t("Descarga un modelo por su nombre exacto")}</h3>
              <p>
                {t("Escribe el nombre tal como aparece en la biblioteca de Ollama, o una ruta")}{" "}<code>hf.co/autor/repositorio:CUANTIZACIÓN</code>{" "}{t("para traer un GGUF de Hugging Face a través de Ollama. No es un buscador: para descubrir modelos usa «Explorar Hugging Face».")}
              </p>
              <div className="model-help-toolbar">
                <button className="button secondary compact" type="button" onClick={() => setGlossaryRequest({ title: t("Ayuda rápida de modelos"), terms: MODEL_GLOSSARY, parsed: false })}><CircleHelp size={14} />{" "}{t("Ayuda")}</button>
                <small>{t("Q8, GGUF, MoE, MTP, Heretic y más")}</small>
              </div>
              <form className="ollama-pull-form" onSubmit={pull}>
                <Download size={17} />
                <input value={ollamaName} onChange={(event) => setOllamaName(event.target.value)} placeholder={t("qwen3:8b · llama3.2:3b · hf.co/autor/modelo:Q4_K_M")} aria-label={t("Nombre del modelo de Ollama")} />
                <button className="button primary" type="submit" disabled={!ollamaTarget || ollamaAlreadyInstalled || downloads.isDownloading(ollamaTarget)}>{ollamaAlreadyInstalled ? t("Instalado") : downloads.isDownloading(ollamaTarget) ? t("Descargando…") : t("Descargar")}</button>
              </form>
              <div className="ollama-examples">
                <small>{t("Ejemplos:")}</small>
                {["qwen3:8b", "llama3.2:3b", "gemma3:12b", "nomic-embed-text", "hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M"].map((example) => (
                  <button key={example} type="button" onClick={() => setOllamaName(example)}>{example}</button>
                ))}
                <a href="https://ollama.com/library" target="_blank" rel="noreferrer noopener"><ExternalLink size={12} />{" "}{t("Biblioteca de Ollama")}</a>
              </div>
            </div>
          </Card>
          <div className="ollama-tips">
            <div><Database size={16} /><span><strong>{t("Se guarda en Ollama")}</strong><small>{t("Aparece en Instalados con su cuantización, familia y parámetros.")}</small></span></div>
            <div><ShieldCheck size={16} /><span><strong>{t("Límite de memoria")}</strong><small>{t("MyDGX cancela la descarga si el tamaño no cabe en la memoria unificada.")}</small></span></div>
            <div><Gauge size={16} /><span><strong>{t("Benchmark automático")}</strong><small>{t("Al terminar se encola su medición si el modo automático está activo.")}</small></span></div>
          </div>
          <ActivitySection eyebrow={t("DESCARGAS")} title={t("Actividad de Ollama")} total={ollamaJobs.length} active={ollamaJobs.filter((job) => activeJobStatuses.has(job.status)).length}>
          {ollamaJobs.length ? <div className="ollama-job-list">
            {ollamaJobs.map((job) => {
              const active = activeJobStatuses.has(job.status);
              return <Card className={`ollama-job ${job.status}`} key={job.id}>
                <div>
                  {active ? <RefreshCw size={15} className="spin" /> : job.status === "completed" ? <CheckCircle2 size={15} /> : <X size={15} />}
                  <span><strong>{job.target}</strong><small>{jobLabel(job.kind)} · {jobStatusLabel(job.status)} · {job.message}</small></span>
                  <b>{Math.round(job.progress)}%</b>
                  {["queued", "running"].includes(job.status) && <button className="icon-button danger" onClick={() => cancelJob(job.id)} aria-label={t("Cancelar descarga")}><X size={14} /></button>}
                </div>
                {active && <div className="sidebar-operation-progress"><span style={{ width: `${job.progress}%` }} /></div>}
              </Card>;
            })}
          </div> : <Empty icon={<Download />} title={t("Sin descargas de Ollama")} text={t("Las descargas que lances aparecerán aquí con su progreso.")} />}
          </ActivitySection>
        </div>
      ) : tab === "installed" ? (
        <>

          <UnifiedMemoryMap models={models} overview={overview} modelMetrics={modelMetrics} />

          <div className="local-model-summary">
            <span><Boxes size={15} /><strong>{localModelCount}</strong>{" "}{t("modelos locales")}</span>
            <span className="loaded"><StatusDot online /><strong>{loadedModelCount}</strong>{" "}{t("cargados en memoria")}</span>
            <span><Bot size={15} /><strong>{models?.assistant_model || t("Sin modelo")}</strong> chatbot</span>
          </div>

          <div className="local-model-filters" aria-label={t("Filtrar modelos instalados")}>
            {([
              ["all", t("Todos")],
              ["loaded", t("Cargados")],
              ["text", t("Texto")],
              ["vision", t("Visión / imagen / vídeo")],
              ["audio", t("Voz / audio")],
              ["ollama", t("Ollama")],
              ["huggingface", t("Hugging Face")],
              ["compact", t("≤ 10 GB")],
              ["medium", t("10–50 GB")],
              ["large", t("> 50 GB")],
            ] as Array<[LocalModelFilter, string]>).map(([value, label]) => (
              <button className={localFilter === value ? "active" : ""} key={value} onClick={() => setLocalFilter(value)} type="button" disabled={value !== "all" && filterCount(value) === 0 && localFilter !== value}>{label}<b>{filterCount(value)}</b></button>
            ))}
            <label className={`local-model-search${searchStateClass(localQuery, visibleLocalModelCount + (models?.runtime_models ?? []).filter(matchesRuntimeFilter).length)}`} data-count={searchCountLabel(localQuery, visibleLocalModelCount + (models?.runtime_models ?? []).filter(matchesRuntimeFilter).length)}>
              <Search size={14} />
              <input
                aria-label={t("Buscar modelos instalados")}
                onChange={(event) => setLocalQuery(event.target.value)}
                placeholder={t("Buscar modelos")}
                type="search"
                value={localQuery}
              />
              {localQuery && <button aria-label={t("Limpiar búsqueda")} onClick={() => setLocalQuery("")} type="button"><X size={13} /></button>}
            </label>
          </div>

          <div className="model-list">
            {[true, false].map((loadedGroup) => {
              const groupSections = visibleModelSections
                .map((section) => ({ ...section, count: modelGroupCount(section.sourceLabel, loadedGroup) }))
                .filter((section) => section.count > 0);
              if (!groupSections.length) return null;
              return <section className={`model-split split-section ${loadedGroup ? "is-active" : ""}`} key={loadedGroup ? "loaded" : "unloaded"}>
                <div className="split-section-title"><strong>{loadedGroup ? t("Activos") : t("Disponibles")}</strong><span>{groupSections.reduce((total, section) => total + section.count, 0)}</span></div>
            {groupSections.map((category, categoryIndex) => <div className="model-category-wrapper" key={category.key}>
              {category.managed && !groupSections[categoryIndex - 1]?.managed && <div className="managed-model-divider">
                <span>{t("Recursos seleccionados automáticamente")}</span>
                <small>{t("Los motores de imagen, vídeo y audio cargan el recurso adecuado cuando ejecutas una tarea.")}</small>
              </div>}
              <section className={`model-category-section ${category.managed ? "is-managed" : "is-user-selectable"}`}>
                <div className="model-category-title">
                  <div><strong>{category.title}</strong><small>{category.managed ? t("Gestionados por su motor o perfil") : t("Puedes activarlos desde aquí o desde un perfil")}</small></div>
                  <span>{category.count}</span>
                </div>
              <div className={`model-category-cards ${loadedGroup ? "is-active" : "is-available"}`}>
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
                  { label: t("Motor"), value: model.engine },
                  { label: t("Parámetros"), value: parametersFromName(model.model_id || model.name) },
                  { label: t("Memoria"), value: t("Estimada"), title: t("Memoria estimada hasta disponer de atribución directa") },
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
                    {Boolean(model.assistant) && <span className="badge assistant"><Bot size={11} />{" "}{t("Chatbot")}</span>}
                    {Boolean(model.persistent) && <span className="badge">{t("Default")}</span>}
                    <UncensoredBadge name={name} />
                    {model.health ? <ModelHealthBadge health={model.health as ModelHealth} /> : null}
                  </>}
                  categoryHint={localModelCategoryHint("ollama", model)}
                  meta={model.modified_at ? t("actualizado {date}", { date: new Date(String(model.modified_at)).toLocaleDateString(locale) }) : ""}
                  specs={[
                    { label: t("Parámetros"), value: String(details.parameter_size || "") || parametersFromName(name) },
                    { label: t("Cuantización"), value: String(details.quantization_level || "") },
                    { label: t("Familia"), value: String(details.family || "") },
                    { label: t("Formato"), value: String(details.format || "").toUpperCase() },
                    { label: model.quick ? t("Contexto cargado") : t("Contexto al encender"), value: contextLabel((model.memory_estimate as MemoryEstimate | null | undefined)?.context_size) },
                    { label: t("Digest"), value: String(model.digest || "").slice(0, 12), title: String(model.digest || "") },
                  ]}
                  size={Number(model.size)}
                  total={totalMemory}
                  memory={model.memory_estimate as MemoryEstimate | null | undefined}
                  actions={<>
                    <label className="persistence-toggle" title={t("Incluir en el perfil Default, que arranca siempre con MyDGX")}>
                      <input type="checkbox" checked={Boolean(model.persistent)} onChange={(event) => void togglePersistence("ollama", name, event.target.checked)} />
                      <span>{t("Default")}</span>
                    </label>
                    <ModelTermsButton text={`${name} ${JSON.stringify(details)}`} label={name} onOpen={setGlossaryRequest} />
                    <span className="lc-actions-spacer" />
                    {model.quick
                      ? <button className="button danger compact" disabled={quickBusy !== null} onClick={() => void quickModel("ollama", name, false)} aria-label={t("Apagar {name}", { name: name })}><Square size={13} /> {quickBusy === quickKey ? t("Apagando…") : t("Apagar")}</button>
                      : profileOwner
                        ? <button className="button secondary compact" disabled title={t("Cargado por el perfil {profileOwner}; detenlo desde Perfiles", { profileOwner: profileOwner })}><Square size={13} /> {profileOwner}</button>
                        : loaded
                          ? <button className="button secondary compact" onClick={() => ollamaMemory(name, false)} aria-label={t("Descargar {name} de memoria", { name: name })}><Square size={13} />{" "}{t("Liberar")}</button>
                          : <QuickStartButton label={name} availability={model.quick_start as QuickStart | undefined} busy={quickBusy !== null} pending={quickBusy === quickKey} title={t("Cargar ahora en el perfil Quick; no se restaura al reiniciar el equipo")} onStart={() => void quickModel("ollama", name, true)} />}
                    {(model.quick_start as QuickStart | undefined)?.supported !== false && <button className="icon-button" onClick={() => setAddToProfile({ source: "ollama", modelId: name })} title={t("Añadir a un perfil")} aria-label={t("Añadir {name} a un perfil", { name: name })}><ListPlus size={15} /></button>}
                    <button className="icon-button" onClick={() => updateOllama(name)} title={t("Actualizar desde el registro")} aria-label={t("Actualizar {name}", { name: name })}><RefreshCw size={15} /></button>
                    <button
                      className="icon-button danger"
                      disabled={Boolean(model.assistant)}
                      title={model.assistant ? t("Protegido: este modelo lo utiliza el chatbot") : t("Eliminar {name}", { name: name })}
                      onClick={() => remove("ollama", name)}
                      aria-label={model.assistant ? t("{name} está protegido porque lo utiliza el chatbot", { name: name }) : t("Eliminar {name}", { name: name })}
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
              const variantHint = ggufVariant ? t(" Para usarlo enciende {repo_id}, la versión GGUF que ya está descargada.", { repo_id: ggufVariant.repo_id }) : "";
              const unsupportedReason = cardOnly
                ? t("Sin pesos: solo se descargó la ficha (README).{value}", { value: variantHint || t(" Descarga los pesos para poder usarlo.") })
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
                    {model.assistant && <span className="badge assistant"><Bot size={11} />{" "}{t("Chatbot")}</span>}
                    {model.persistent && <span className="badge">{t("Default")}</span>}
                    <UncensoredBadge name={model.repo_id} flagged={model.uncensored} />
                    {model.health && !(incomplete && model.health.status === "healthy") ? <ModelHealthBadge health={model.health} /> : incomplete && <span className="badge warning">{t("Incompleto")}</span>}
                    {cardOnly && <span className="badge warning" title={t("Solo está la ficha del modelo; no hay archivos de pesos")}>{t("Sin pesos")}</span>}
                    {model.speculative && <span className="badge" title={t("Decodificación especulativa con {value}", { value: model.speculative.draft_filename || t("el MTP integrado en el GGUF") })}><Zap size={11} /> {SPEC_LABELS[model.speculative.spec_type] ?? model.speculative.spec_type}</span>}
                    {model.manual_settings && <span className="badge" title={t("Tiene ajustes manuales que mandan sobre la ficha y la cabecera GGUF")}><SlidersHorizontal size={11} />{" "}{t("Manual")}</span>}
                  </>}
                  categoryHint={localModelCategoryHint("huggingface", model as unknown as Record<string, unknown>)}
                  meta={t("{snapshot_count} snapshot{snapshotPlural} · {file_count} archivo{filePlural}{shardSuffix}", { snapshot_count: model.snapshot_count, snapshotPlural: model.snapshot_count === 1 ? "" : "s", file_count: model.file_count, filePlural: model.file_count === 1 ? "" : "s", shardSuffix: model.shard_count ? t(" · {shard_count} shards", { shard_count: model.shard_count }) : "" })}
                  specs={[
                    { label: t("Parámetros"), value: parametersFromName(model.repo_id) },
                    { label: t("Cuantización"), value: model.quantizations.join(", ") },
                    { label: t("Formato"), value: model.formats.map((format) => format.toUpperCase()).join(", ") },
                    { label: t("Arquitectura"), value: architectureLabel },
                    { label: model.quick ? t("Contexto cargado") : t("Contexto al encender"), value: contextLabel(model.memory_estimate?.context_size), title: t("Punto medio entre el mínimo de los agentes de código y el máximo del autor o del GGUF") },
                    { label: t("Contexto nativo"), value: contextLabel(model.configuration.max_position_embeddings || model.memory_estimate?.native_context) },
                    { label: t("Revisión"), value: model.revision ? model.revision.slice(0, 10) : "", title: model.revision },
                  ]}
                  size={model.size}
                  total={totalMemory}
                  memory={model.memory_estimate}
                  extra={<>
                    {model.health && model.health.status !== "healthy" && <div className={`model-health-note ${model.health.status}`}>
                      <TriangleAlert size={13} />
                      <div><strong>{model.health.status === "incomplete" ? t("Modelo incompleto") : t("Modelo defectuoso")}</strong><small>{model.health.file ? `${model.health.file}: ${model.health.reason}` : model.health.reason}</small></div>
                    </div>}
                    {verification && <div className={`model-verification ${verification.status}`}>
                      <ShieldCheck size={13} />
                      <div><strong>{verification.message}</strong><small>{verification.status === "completed" ? t("Integridad comprobada") : verification.status === "failed" ? t("La verificación falló") : t("{progress}% completado", { progress: Math.round(verification.progress) })}</small></div>
                      {verificationActive && <span style={{ width: `${verification.progress}%` }} />}
                    </div>}
                  </>}
                  actions={<>
                    <label className={`persistence-toggle ${model.quantizations.length ? "" : "disabled"}`} title={model.quantizations.length ? t("Incluir en el perfil Default, que arranca siempre con MyDGX") : t("El perfil Default requiere un GGUF")}>
                      <input type="checkbox" disabled={!model.quantizations.length} checked={model.persistent} onChange={(event) => void togglePersistence("huggingface", model.repo_id, event.target.checked, chosenContexts[model.repo_id])} />
                      <span>{t("Default")}</span>
                    </label>
                    <ModelTermsButton text={`${model.repo_id} ${model.formats.join(" ")} ${model.quantizations.join(" ")} ${architectureLabel} ${(model.tasks ?? []).join(" ")}`} label={model.repo_id} onOpen={setGlossaryRequest} />
                    <span className="lc-actions-spacer" />
                    {model.quick
                      ? <button className="button danger compact" disabled={quickBusy !== null} onClick={() => void quickModel("huggingface", model.repo_id, false)} aria-label={t("Apagar {repo_id}", { repo_id: model.repo_id })}><Square size={13} /> {quickBusy === `huggingface:${model.repo_id}` ? t("Apagando…") : t("Apagar")}</button>
                      : model.loaded_by.includes("ComfyUI")
                        ? <button className="button secondary compact" disabled={quickBusy !== null} onClick={() => void releaseComfyUI(model.repo_id)} title={t("ComfyUI descarga de memoria todos los modelos que tenga cargados; se vuelven a cargar en la siguiente generación")} aria-label={t("Liberar {repo_id} de ComfyUI", { repo_id: model.repo_id })}><Square size={13} /> {quickBusy === `comfyui:${model.repo_id}` ? t("Liberando…") : t("Liberar")}</button>
                      : !model.loaded && !incomplete
                        && <QuickStartButton label={model.repo_id} availability={model.quick_start} defaultContext={model.memory_estimate?.context_size} unsupportedReason={unsupportedReason} busy={quickBusy !== null} pending={quickBusy === `huggingface:${model.repo_id}`} title={t("Cargar ahora con llama.cpp en el perfil Quick; no se restaura al reiniciar el equipo")} onStart={(contextSize) => void quickModel("huggingface", model.repo_id, true, contextSize)} onContextChange={(contextSize) => setChosenContexts((current) => ({ ...current, [model.repo_id]: contextSize }))} />}
                    <a className="icon-button" href={`https://huggingface.co/${model.repo_id}`} target="_blank" rel="noreferrer noopener" title={t("Abrir en Hugging Face")} aria-label={t("Abrir {repo_id} en Hugging Face", { repo_id: model.repo_id })}><ExternalLink size={15} /></a>
                    <button className="button secondary compact" disabled={inspectingRepo !== null} onClick={() => inspect(model.repo_id)} aria-label={t("Inspeccionar {repo_id}", { repo_id: model.repo_id })}><Search className={inspectingRepo === model.repo_id ? "spin" : ""} size={13} />{" "}{t("Detalles")}</button>
                    {runnable && !incomplete && !unsupportedReason && model.quick_start?.supported !== false && <button className="icon-button" onClick={() => setAddToProfile({ source: "huggingface", modelId: model.repo_id, range: model.quick_start?.context, defaultContext: chosenContexts[model.repo_id] ?? model.memory_estimate?.context_size })} title={t("Añadir a un perfil, con su contexto")} aria-label={t("Añadir {repo_id} a un perfil", { repo_id: model.repo_id })}><ListPlus size={15} /></button>}
                    {runnable && !incomplete && <button className="icon-button" onClick={() => setSettingsModel(model.repo_id)} title={t("Ajustes de arranque: cuantización, contexto, drafter y muestreo")} aria-label={t("Ajustes de {repo_id}", { repo_id: model.repo_id })}><SlidersHorizontal size={15} /></button>}
                    <button className="icon-button" disabled={verificationActive} onClick={() => verifyIntegrity(model.repo_id)} aria-label={t("Verificar {repo_id}", { repo_id: model.repo_id })} title={verification?.message || t("Verificar integridad (SHA-256)")}><ShieldCheck className={verificationActive ? "spin" : ""} size={15} /></button>
                    <button
                      className="icon-button danger"
                      disabled={model.assistant}
                      title={model.assistant ? t("Protegido: este modelo lo utiliza el chatbot") : t("Eliminar {repo_id}", { repo_id: model.repo_id })}
                      onClick={() => remove("huggingface", model.repo_id)}
                      aria-label={model.assistant ? t("{repo_id} está protegido porque lo utiliza el chatbot", { repo_id: model.repo_id }) : t("Eliminar {repo_id}", { repo_id: model.repo_id })}
                    >{model.assistant ? <ShieldCheck size={16} /> : <Trash2 size={16} />}</button>
                  </>}
                />
              );
            })}
            </div>
              </section>
            </div>)}
              </section>;
            })}
            {!models?.ollama.length && !models?.huggingface.length && <Empty icon={<Boxes />} title={t("No hay modelos locales")} text={t("Descarga tu primer modelo desde «Explorar Hugging Face» o «Descargar con Ollama».")} />}
            {localModelCount > 0 && visibleLocalModelCount === 0 && <Empty icon={<Search />} title={t("Ningún modelo coincide")} text={t("Prueba otro filtro.")} />}
          </div>
        </>
      ) : (
        <>
          <Card className="spark-search-panel">
            <div className="catalog-mode-switch">
              <button className={catalogMode === "spark" ? "active" : ""} onClick={() => setCatalogMode("spark")} type="button"><Sparkles size={13} />{" "}{t("Para este Spark")}</button>
              <button className={catalogMode === "all" ? "active" : ""} onClick={() => setCatalogMode("all")} type="button"><Globe size={13} />{" "}{t("Todo Hugging Face")}</button>
              <button className={catalogMode === "favorites" ? "active" : ""} onClick={() => setCatalogMode("favorites")} type="button"><Star size={13} fill={catalogMode === "favorites" ? "currentColor" : "none"} />{" "}{t("Favoritos")}</button>
            </div>
            <div className="model-help-toolbar catalog-help">
              <button className="button secondary compact" type="button" onClick={() => setGlossaryRequest({ title: t("Ayuda rápida de Hugging Face"), terms: MODEL_GLOSSARY, parsed: false })}><CircleHelp size={14} />{" "}{t("Ayuda")}</button>
              <small>{t("¿Q8, MTP, Heretic o Abliterated? Explicaciones simples")}</small>
            </div>
            <div className="spark-search-copy">
              <div className="spark-search-icon">{catalogMode === "spark" ? <Sparkles /> : catalogMode === "all" ? <Globe /> : <Star />}</div>
              <div><strong>{catalogMode === "spark" ? t("Recomendador para este Spark") : catalogMode === "all" ? t("Búsqueda general en Hugging Face") : t("Modelos guardados para probar")}</strong><small>{catalogMode === "spark" ? (alignment === "uncensored" ? t("Analiza memoria, GGUF y el catálogo hft.md de modelos sin censura o abliterados.") : t("Analiza memoria libre, GGUF, contexto, runtime GB10 y calidad de la ficha.")) : catalogMode === "all" ? t("Busca cualquier modelo, autor o arquitectura publicada en el Hub.") : t("Tu lista persistente de candidatos para revisar, comparar o descargar más adelante.")}</small></div>
            </div>
            {catalogMode !== "favorites" && <form className={`search-bar${searchStateClass(query, hasSearched && !busy ? (catalogMode === "all" ? allResults : results).length : null)}`} data-count={searchCountLabel(query, hasSearched && !busy ? (catalogMode === "all" ? allResults : results).length : null)} onSubmit={search} ref={searchFormRef}>
              <Search size={18} />
              <div className="search-history-field" onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setSearchHistoryOpen(false);
              }}>
                <input
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setSearchHistoryOpen(true); }}
                  onFocus={() => setSearchHistoryOpen(true)}
                  placeholder={t("Ejemplo: Qwen coder, Llama instruct, reasoning…")}
                  autoComplete="off"
                  aria-label={t("Buscar modelos en Hugging Face")}
                  aria-expanded={searchHistoryOpen && matchingRecentSearches.length > 0}
                />
                {searchHistoryOpen && matchingRecentSearches.length > 0 && <div className="search-history-menu">
                  <div className="search-history-head"><span><History size={13} />{" "}{t("Búsquedas recientes")}</span><button type="button" onClick={clearSearchHistory}>{t("Borrar")}</button></div>
                  {matchingRecentSearches.map((item) => <button className="search-history-item" type="button" key={item} onClick={() => reuseSearch(item)}><History size={13} /><span>{item}</span></button>)}
                </div>}
              </div>
              <button className="button primary" type="submit" disabled={busy}>{busy ? (catalogMode === "spark" ? t("Analizando…") : t("Buscando…")) : (catalogMode === "spark" ? t("Recomendar") : t("Buscar"))}</button>
            </form>}
            {catalogMode !== "favorites" && <a className="hft-catalog-link" href="https://hft.md/uncensored-ai/" target="_blank" rel="noreferrer noopener">
              <ExternalLink size={13} />
              <span>{t("Catálogo sin censura")}</span>
              <span className="hft-catalog-url">https://hft.md/uncensored-ai/</span>
            </a>}
            {catalogMode === "spark" ? <div className="recommendation-filters">
              <label><span>{t("Tarea")}</span><select value={task} onChange={(event) => setTask(event.target.value as typeof task)}>
                <option value="any">{t("Cualquier tarea")}</option><option value="chat">{t("Chat")}</option><option value="code">{t("Código")}</option>
                <option value="reasoning">{t("Reasoning")}</option><option value="embedding">{t("Embeddings")}</option><option value="vision">{t("Visión")}</option>
                <option value="audio-chat">{t("Chat con audio")}</option><option value="video-chat">{t("Chat con vídeo")}</option>
                <option value="image-generation">{t("Generación de imagen")}</option><option value="asr">{t("Audio a texto")}</option>
                <option value="tts">{t("Texto a audio")}</option><option value="video-generation">{t("Generación de vídeo")}</option>
                <option value="reranking">{t("Reranking")}</option>
              </select></label>
              <label><span>{t("Tamaño")}</span><select value={size} onChange={(event) => setSize(event.target.value as typeof size)}>
                <option value="any">{t("Mejor calidad que quepa")}</option><option value="compact">{t("Compacto · hasta 16 GB")}</option>
                <option value="balanced">{t("Equilibrado · hasta 48 GB")}</option><option value="large">{t("Grande · memoria disponible")}</option>
              </select></label>
              <label><span>{t("Contenido")}</span><select value={alignment} onChange={(event) => setAlignment(event.target.value as typeof alignment)}>
                <option value="any">{t("Todos los modelos")}</option><option value="uncensored">{t("Sin censura · uncensored / abliterated")}</option>
                <option value="standard">{t("Estándar")}</option>
              </select></label>
              <label><span>{t("Entrada")}</span><select value={modality} onChange={(event) => setModality(event.target.value as typeof modality)}>
                <option value="any">{t("Cualquier modalidad")}</option><option value="text">{t("Texto")}</option><option value="image">{t("Imagen")}</option>
                <option value="audio">{t("Audio")}</option><option value="video">{t("Vídeo")}</option>
              </select></label>
              <label><span>{t("Runtime")}</span><select value={runtime} onChange={(event) => setRuntime(event.target.value as typeof runtime)}>
                <option value="any">{t("Mejor runtime disponible")}</option><option value="llama.cpp">{t("llama.cpp · GGUF")}</option>
                <option value="external">{t("Motor externo local")}</option>
              </select></label>
              <label><span>{t("Formato")}</span><select value={modelFormat} onChange={(event) => setModelFormat(event.target.value as typeof modelFormat)}>
                <option value="any">{t("Cualquier formato")}</option><option value="gguf">GGUF</option>
                <option value="safetensors">{t("Safetensors")}</option><option value="onnx">ONNX</option>
              </select></label>
              <label><span>{t("Resultados")}</span><select value={sparkLimit} onChange={(event) => setSparkLimit(Number(event.target.value) as typeof sparkLimit)}>
                <option value={12}>{t("12 por búsqueda · más rápido")}</option>
                <option value={18}>{t("18 por búsqueda")}</option>
                <option value={30}>{t("30 por búsqueda · más completo")}</option>
              </select></label>
              <span className="memory-live"><StatusDot online />{t("Ranking con telemetría en vivo")}</span>
            </div> : catalogMode === "all" ? <div className="general-search-filters">
              <label><span>{t("Capacidad")}</span><select value={task} onChange={(event) => setTask(event.target.value as typeof task)}>
                <option value="any">{t("Cualquier capacidad")}</option><option value="chat">{t("Chat")}</option><option value="vision">{t("Chat con imagen")}</option>
                <option value="audio-chat">{t("Chat con audio")}</option><option value="video-chat">{t("Chat con vídeo")}</option>
                <option value="embedding">{t("Embeddings")}</option><option value="image-generation">{t("Generación de imagen")}</option>
                <option value="asr">ASR</option><option value="tts">TTS</option><option value="video-generation">{t("Generación de vídeo")}</option>
                <option value="reranking">{t("Reranking")}</option>
              </select></label>
              <label><span>{t("Entrada")}</span><select value={modality} onChange={(event) => setModality(event.target.value as typeof modality)}>
                <option value="any">{t("Cualquier modalidad")}</option><option value="text">{t("Texto")}</option><option value="image">{t("Imagen")}</option>
                <option value="audio">{t("Audio")}</option><option value="video">{t("Vídeo")}</option>
              </select></label>
              <span className="general-search-note"><Gauge size={13} />{t("Score para este Spark · comunidad HF como señal secundaria")}</span>
            </div> : <div className="favorite-summary"><Star size={14} fill="currentColor" /><strong>{favorites.length}</strong><span>{t("modelo(s) guardado(s)")}</span></div>}
          </Card>

          {catalogMode === "spark" ? <>
            {results.length > 0 && <SectionHeading
              eyebrow={installedRecommendations ? t("ORDEN DINÁMICO · {installedRecommendations} ya instalado{value}", { installedRecommendations: installedRecommendations, value: installedRecommendations === 1 ? "" : "s" }) : t("ORDEN DINÁMICO")}
              title={t("Recomendados para este Spark")}
              action={<select className="benchmark-comparison-select" value={sparkSort} onChange={(event) => setSparkSort(event.target.value as typeof sparkSort)} aria-label={t("Ordenar recomendados")}>
                <option value="recommended">{t("Recomendación para este Spark")}</option>
                <option value="speed">{t("Rendimiento estimado (tok/s)")}</option>
                <option value="memory">{t("Menor memoria")}</option>
                <option value="community">{t("Score comunidad HF")}</option>
                <option value="downloads">{t("Más descargados")}</option>
                <option value="likes">{t("Más likes")}</option>
                <option value="trending">{t("Tendencia")}</option>
                <option value="name">{t("Nombre")}</option>
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
                    <span className={`recommendation-status ${statusClass}`}>{t(model.recommendation_status)}</span>
                  </div>
                  <div className="catalog-top"><div className="model-icon hf"><HuggingFaceIcon /></div><div className="recommendation-tags">{installed && <span className="installed">{t("instalado")}</span>}{model.uncensored && <span className="uncensored">{t("sin censura")}</span>}{model.gated && <span className="restricted" title={t("Requiere aceptar condiciones en Hugging Face y un token con acceso")}>gated</span>}{model.hft_catalog && <span className="uncensored">hft.md</span>}{model.tasks.map((item) => <span key={item}>{item}</span>)}</div></div>
                  <div className="recommendation-name" title={model.id}>
                    <span><strong>{model.id.split("/").pop() || model.id}</strong><ModelTermsButton text={`${model.id} ${model.recommended_quantization} ${model.architecture} ${model.runtime_requirement} ${model.speculative_methods.join(" ")} ${model.tasks.join(" ")}`} label={model.id} onOpen={setGlossaryRequest} /></span>
                    {model.id.includes("/") && <small>{model.id}</small>}
                  </div>
                  {model.hft_catalog && <div className="hft-catalog-score" title={model.hft_catalog.summary || t("Catálogo hft.md")}>
                    <a href={model.hft_catalog.url} target="_blank" rel="noreferrer">hft.md</a>
                    {model.hft_catalog.uncensored_iq != null && <span>IQ {model.hft_catalog.uncensored_iq}</span>}
                    {model.hft_catalog.reasoning != null && <span>{t("razonamiento")} {model.hft_catalog.reasoning}</span>}
                    {model.hft_catalog.answers && <span>{t("respuestas")} {model.hft_catalog.answers}</span>}
                    {model.hft_catalog.base_model && <span>{model.hft_catalog.base_model}</span>}
                  </div>}
                  <small>{model.downloads.toLocaleString(locale)}{" "}{t("descargas ·")}{" "}{model.likes.toLocaleString(locale)}{" "}{t("likes ·")}{" "}{model.license || t("licencia no indicada")}</small>
                  <div className="hf-community-score" title={t("Descargas {download_points}/50 · Likes {like_points}/40 · Tendencia {trending_points}/10", { download_points: model.community_signals.download_points, like_points: model.community_signals.like_points, trending_points: model.community_signals.trending_points })}>
                    <Star size={12} fill="currentColor" /><strong>{model.community_score}/100</strong><span>{t("Comunidad HF")}</span>
                    {model.trending_score > 0 && <small>{t("tendencia")} {model.trending_score.toLocaleString(locale)}</small>}
                  </div>
                  <div className="modality-flow"><span>{model.input_modalities.join(" + ")}</span><ChevronRight size={11} /><span>{model.output_modalities.join(" + ")}</span></div>
                  <div className="recommendation-specs">
                    <span><small>{t("Formato")}</small><strong>{model.recommended_quantization || model.formats.join(" / ") || t("Snapshot HF")}</strong></span>
                    <span><small>{model.recommended_context ? t("Contexto") : t("Runtime")}</small><strong>{model.recommended_context ? `${Math.round(model.recommended_context / 1024)}K` : t("Externo local")}</strong></span>
                    <span title={t("Estimación comparativa basada en pesos activos y ancho de banda; no sustituye un benchmark")}><small>{t("Arquitectura")}</small><strong>{model.architecture}{model.active_parameters_b ? t(" · {count}B activos", { count: model.active_parameters_b }) : ""}</strong></span>
                    <span title={t("Estimación conservadora; depende del runtime, plantilla, contexto y batching")}><small>{t("Rendimiento")}</small><strong>{model.estimated_tokens_per_second ? `≈${model.estimated_tokens_per_second} tok/s · ${model.recommended_slots} slot(s)` : t("Según runtime")}</strong></span>
                    {model.speculative_methods.length > 0 && <span title={model.speculative_verified === false ? t("Solo lo dice la ficha; la comprobación previa lee la cabecera del GGUF antes de descargar") : t("El repositorio incluye el drafter y la descarga recomendada lo trae")}><small>{t("Especulativa")}</small><strong>{model.speculative_methods.join(" · ")}{model.speculative_verified === false ? ` ${t("(sin verificar)")}` : ""}</strong></span>}
                    {model.optional_mmproj_file && <span title={t("llama.cpp no combina visión y especulativa; se descarga el drafter. Añade el mmproj desde Detalles si quieres imágenes.")}><small>{t("Visión")}</small><strong>{t("Opcional")}</strong></span>}
                    {model.spark_count > 1 && <span><small>{t("Cluster")}</small><strong>{model.spark_count}{" "}{t("Sparks ·")}{" "}{model.memory_bandwidth_gbps}{" "}{t("GB/s")}</strong></span>}
                    <span><small>{t("Memoria")}</small><strong>{Math.round(model.estimated_memory_mb / 1024)} GB</strong></span>
                  </div>
                  <div className="memory-fit"><div><span style={{ width: `${memoryPercent}%` }} /></div><small>{memoryPercent}{t("% del presupuesto ·")}{" "}{Math.round(model.memory_budget_mb / 1024)}{" "}{t("GB utilizables")}</small></div>
                  <div className="recommendation-reasons">
                    {model.artifex_verified && <span className="verified"><ShieldCheck size={12} />{t("Verificado por ARTIFEX")}</span>}
                    {model.recommended_mmproj_file && <span className="verified"><ShieldCheck size={12} />{t("mmproj incluido ·")}{" "}{model.recommended_mmproj_file}</span>}
                    {model.reasons.slice(0, 2).map((reason) => <span key={reason}><Zap size={11} />{reason}</span>)}
                    {model.warnings.slice(0, 1).map((warning) => <span className="warning" key={warning}><Activity size={11} />{warning}</span>)}
                  </div>
                  <small className="runtime-note">{model.runtime_requirement} · {model.recommended_engines.slice(0, 3).join(" / ")}</small>
                  <div className="catalog-actions">
                    <button className={`icon-button favorite-button ${favoriteIds.has(model.id) ? "selected" : ""}`} onClick={() => void toggleHfFavorite(model.id, !favoriteIds.has(model.id))} aria-label={favoriteIds.has(model.id) ? t("Quitar {id} de favoritos", { id: model.id }) : t("Guardar {id} en favoritos", { id: model.id })}><Star size={15} fill={favoriteIds.has(model.id) ? "currentColor" : "none"} /></button>
                    <button className="button secondary" disabled={inspectingRepo !== null} onClick={() => inspect(model.id, model.recommended_files)}><Search className={inspectingRepo === model.id ? "spin" : ""} size={15} /> {inspectingRepo === model.id ? t("Abriendo…") : t("Detalles")}</button>
                    {installed
                      ? <button className="button primary" disabled><CheckCircle2 size={15} />{" "}{t("Instalado")}</button>
                      : downloads.isDownloading(model.id)
                      ? <button className="button primary" disabled><RefreshCw className="spin" size={15} />{" "}{t("Descargando…")}</button>
                      : model.gguf_search
                      ? <button className="button primary" onClick={() => searchGgufVariant(model.gguf_search ?? "")} title={t("Este modelo solo tiene pesos safetensors o PyTorch y en la Spark no hay motor que los ejecute; busca una versión GGUF para llama.cpp")}><Search size={15} />{" "}{t("Buscar versión GGUF")}</button>
                      : <button className="button primary" disabled={!model.fits || downloadBusy !== null} onClick={() => downloadRecommendation(model)} title={model.gated ? t("Repositorio gated: abre los detalles para comprobar el acceso antes de descargar") : undefined}><Download className={downloadBusy === model.id ? "spin" : ""} size={15} /> {downloadBusy === model.id ? t("Preparando…") : model.gated ? t("Comprobar acceso") : model.recommended_files.length ? t("Descargar recomendada") : t("Descargar snapshot")}</button>}
                  </div>
                </Card>
              );
              })}
            </div>
            {!busy && results.length > 0 && <div className="catalog-load-more">
              <button className="button secondary" type="button" disabled={loadingMore || noMoreResults} onClick={() => void loadMoreRecommendations()}>
                <Search className={loadingMore ? "spin" : ""} size={15} />
                {loadingMore ? t("Analizando más candidatos…") : noMoreResults ? t("No hay más resultados") : t("Buscar {sparkLimit} más", { sparkLimit: sparkLimit })}
              </button>
              <small>{t("{count} analizados", { count: results.length })}{sparkPage > 0 ? t(" · {rounds} rondas", { rounds: sparkPage + 1 }) : ""}{" "}{t("· los nuevos se añaden al final y se pueden reordenar con el selector")}</small>
            </div>}
            {!busy && hasSearched && results.length === 0 && <Empty icon={<Boxes />} title={t("Sin modelos recomendables")} text={t("Prueba otra búsqueda o amplía los filtros.")} />}
          </> : catalogMode === "all" ? <>
            {allResults.length > 0 && <SectionHeading eyebrow={t("HUGGING FACE HUB")} title={t("{count} resultados generales", { count: allResults.length })} />}
            <div className="catalog-grid general-results-grid">
              {allResults.map((model) => {
                const installed = downloadedRepos.has(model.id.toLowerCase());
                const recommendationStatus = model.recommendation_status || t("No recomendado");
                const statusClass = recommendationStatus.toLowerCase().replace(" ", "-");
                const sparkScore = model.recommended_score ?? 0;
                return (
                <Card className={`catalog-card general-result-card ${installed ? "installed" : ""}`} key={model.id}>
                  <div className="recommendation-head general-score-head">
                    <span className="recommendation-position">SPARK</span>
                    <div className="score-ring" style={{ "--score": `${sparkScore * 3.6}deg` } as CSSProperties}>
                      <strong>{sparkScore}</strong><small>/100</small>
                    </div>
                    <span className={`recommendation-status ${statusClass}`}>{t(recommendationStatus)}</span>
                  </div>
                  <div className="catalog-top">
                    <div className="model-icon hf"><HuggingFaceIcon /></div>
                    <div className="recommendation-tags">
                      {installed && <span className="installed">{t("instalado")}</span>}
                      {model.pipeline_tag && <span>{model.pipeline_tag}</span>}
                      {model.uncensored && <span className="uncensored">{t("sin censura")}</span>}
                      {model.gated && <span className="restricted">gated</span>}
                    </div>
                  </div>
                  <div className="catalog-model-name"><strong title={model.id}>{model.id}</strong><ModelTermsButton text={`${model.id} ${model.pipeline_tag ?? ""} ${model.tags.join(" ")} ${model.tasks.join(" ")}`} label={model.id} onOpen={setGlossaryRequest} /></div>
                  <small>{model.downloads.toLocaleString(locale)}{" "}{t("descargas ·")}{" "}{model.likes.toLocaleString(locale)} likes</small>
                  {typeof model.community_score === "number" && <div className="hf-community-score" title={model.community_signals ? t("Descargas {download_points}/50 · Likes {like_points}/40 · Tendencia {trending_points}/10", { download_points: model.community_signals.download_points, like_points: model.community_signals.like_points, trending_points: model.community_signals.trending_points }) : t("Popularidad relativa en Hugging Face")}>
                    <Star size={12} fill="currentColor" /><strong>{model.community_score}/100</strong><span>{t("Comunidad HF")}</span>
                    {(model.trending_score ?? 0) > 0 && <small>{t("tendencia")} {model.trending_score?.toLocaleString(locale)}</small>}
                  </div>}
                  <div className="modality-flow"><span>{model.input_modalities.join(" + ")}</span><ChevronRight size={11} /><span>{model.output_modalities.join(" + ")}</span></div>
                  <div className="general-spark-summary">
                    <span><small>{t("Configuración")}</small><strong>{model.recommended_quantization || (model.formats ?? []).join(" / ") || t("Runtime externo")}</strong></span>
                    <span><small>{t("Memoria estimada")}</small><strong>{model.estimated_memory_mb ? `${Math.round(model.estimated_memory_mb / 1024)} GB` : t("Por determinar")}</strong></span>
                  </div>
                  <div className="general-model-tags">{model.tags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}</div>
                  <div className="catalog-actions">
                    <button className={`icon-button favorite-button ${favoriteIds.has(model.id) ? "selected" : ""}`} onClick={() => void toggleHfFavorite(model.id, !favoriteIds.has(model.id))} aria-label={favoriteIds.has(model.id) ? t("Quitar {id} de favoritos", { id: model.id }) : t("Guardar {id} en favoritos", { id: model.id })}><Star size={15} fill={favoriteIds.has(model.id) ? "currentColor" : "none"} /></button>
                    {recommendedDownloadButton(model.id, model.recommended_files, installed)}
                  </div>
                </Card>
              );})}
            </div>
            {!busy && hasSearched && allResults.length === 0 && <Empty icon={<Globe />} title={t("Sin resultados")} text={t("Prueba con otro nombre, autor, arquitectura o filtro.")} />}
          </> : <>
            {favorites.length > 0 && <SectionHeading eyebrow={t("PARA MÁS ADELANTE")} title={t("{count} modelo(s) favorito(s)", { count: favorites.length })} />}
            <div className="catalog-grid general-results-grid favorite-model-grid">
              {favorites.map((model) => {
                const installed = downloadedRepos.has(model.id.toLowerCase());
                const recommendationStatus = model.recommendation_status || t("No recomendado");
                const statusClass = recommendationStatus.toLowerCase().replace(" ", "-");
                const sparkScore = model.recommended_score ?? 0;
                return (
                <Card className={`catalog-card general-result-card favorite-model-card ${installed ? "installed" : ""}`} key={model.id}>
                  <div className="recommendation-head general-score-head">
                    <span className="recommendation-position">SPARK</span>
                    <div className="score-ring" style={{ "--score": `${sparkScore * 3.6}deg` } as CSSProperties}>
                      <strong>{sparkScore}</strong><small>/100</small>
                    </div>
                    <span className={`recommendation-status ${statusClass}`}>{t(recommendationStatus)}</span>
                  </div>
                  <div className="catalog-top">
                    <div className="model-icon hf"><HuggingFaceIcon /></div>
                    <div className="recommendation-tags">
                      {installed && <span className="installed">{t("instalado")}</span>}
                      {model.pipeline_tag && <span>{model.pipeline_tag}</span>}
                      {model.uncensored && <span className="uncensored">{t("sin censura")}</span>}
                      {model.gated && <span className="restricted">gated</span>}
                    </div>
                  </div>
                  <div className="catalog-model-name"><strong title={model.id}>{model.id}</strong><ModelTermsButton text={`${model.id} ${model.pipeline_tag ?? ""} ${model.tags.join(" ")} ${model.tasks.join(" ")}`} label={model.id} onOpen={setGlossaryRequest} /></div>
                  <small>{model.downloads.toLocaleString(locale)}{" "}{t("descargas ·")}{" "}{model.likes.toLocaleString(locale)} likes</small>
                  {typeof model.community_score === "number" && <div className="hf-community-score"><Star size={12} fill="currentColor" /><strong>{model.community_score}/100</strong><span>{t("Comunidad HF")}</span></div>}
                  <div className="modality-flow"><span>{model.input_modalities.join(" + ")}</span><ChevronRight size={11} /><span>{model.output_modalities.join(" + ")}</span></div>
                  <div className="general-spark-summary">
                    <span><small>{t("Configuración")}</small><strong>{model.recommended_quantization || (model.formats ?? []).join(" / ") || t("Runtime externo")}</strong></span>
                    <span><small>{t("Memoria estimada")}</small><strong>{model.estimated_memory_mb ? `${Math.round(model.estimated_memory_mb / 1024)} GB` : t("Por determinar")}</strong></span>
                  </div>
                  <div className="general-model-tags">{model.tags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}</div>
                  <div className="catalog-actions">
                    <button className="icon-button favorite-button selected" onClick={() => void toggleHfFavorite(model.id, false)} aria-label={t("Quitar {id} de favoritos", { id: model.id })}><Star size={15} fill="currentColor" /></button>
                    {recommendedDownloadButton(model.id, model.recommended_files, installed)}
                  </div>
                </Card>
              );})}
            </div>
            {!favorites.length && <Empty icon={<Star />} title={t("Aún no hay favoritos")} text={t("Marca la estrella de cualquier resultado para guardarlo y probarlo más adelante.")} />}
          </>}
        </>
      )}

      {inspection && (
        <div className="hf-inspector-overlay" role="dialog" aria-modal="true" aria-label={t("Detalles de {repo_id}", { repo_id: inspection.repo_id })} onMouseDown={(event) => { if (event.target === event.currentTarget) setInspection(null); }}>
        <Card className="hf-inspector">
          <SectionHeading eyebrow={t("HUGGING FACE")} title={inspection.repo_id} action={<div className="dialog-heading-actions"><ModelTermsButton text={`${inspection.repo_id} ${(inspection.remote?.formats ?? []).join(" ")} ${(inspection.remote?.tasks ?? []).join(" ")} ${(inspection.remote?.recommended_engines ?? []).join(" ")}`} label={inspection.repo_id} onOpen={setGlossaryRequest} /><button className="icon-button" onClick={() => setInspection(null)} aria-label={t("Cerrar detalles")}><X size={15} /></button></div>} />
          <div className="hf-inspection-summary">
            <span><small>{t("Revisión")}</small><strong>{inspection.remote?.revision?.slice(0, 12) || Object.values(inspection.local?.refs || {})[0]?.slice(0, 12) || "—"}</strong></span>
            <span><small>{t("Licencia")}</small><strong>{inspection.remote?.license || t("No indicada")}</strong></span>
            <span><small>{t("Acceso")}</small><strong>{inspection.remote?.gated ? t("Gated") : inspection.remote?.private ? t("Privado") : t("Público")}</strong></span>
            <span><small>{t("Estado local")}</small><strong>{inspection.local?.partials.length || inspection.local?.shards.some((item) => !item.complete) ? t("Incompleto") : inspection.local ? t("Completo") : t("No descargado")}</strong></span>
          </div>
          {inspection.remote && <div className="hf-capability-strip">
            <span>{inspection.remote.input_modalities.join(" + ")} → {inspection.remote.output_modalities.join(" + ")}</span>
            <span>{inspection.remote.formats.join(" · ") || t("formato no identificado")}</span>
            <span>{inspection.remote.recommended_engines.join(" · ") || t("runtime por determinar")}</span>
          </div>}
          {inspection.remote_error && <div className="profile-warning"><ShieldCheck size={15} />{t("No se pudo consultar la ficha remota:")}{" "}{inspection.remote_error}</div>}
          {inspection.remote && !inspection.remote.download_supported && <div className="profile-warning">
            <TriangleAlert size={15} />{inspection.remote.download_block_reason}
          </div>}
          {inspection.local && <div className="hf-local-detail">
            <small>{t("Cuantizaciones:")}{" "}{inspection.local.quantizations.join(", ") || t("no detectadas")}{" "}{t("· Snapshots:")}{" "}{inspection.local.snapshots.length}{" "}{t("· Parciales:")}{" "}{inspection.local.partials.length}</small>
            {inspection.local.shards.map((shard) => <span className={`badge ${shard.complete ? "completed" : "failed"}`} key={`${shard.name}-${shard.expected}`}>{shard.name}: {shard.present.length}/{shard.expected}</span>)}
          </div>}
          {inspection.remote && !inspection.remote.gated && <div className="hf-download-guidance">
            <Download size={15} />
            <span><strong>{t("Esta es la opción que MyDGX recomienda para tu Spark")}</strong><small>{t("Ya está seleccionada completa. Si está dividida en varios archivos, se descargarán juntos. No necesitas elegir entre S, M o L salvo que quieras ajustar manualmente calidad y tamaño.")}</small></span>
          </div>}
          {inspection.remote?.gated && <GatedAccessNotice repoId={inspection.repo_id} mode={inspection.remote.gated_mode} access={inspection.remote.access} />}
          <div className="hf-model-description">
            <div>
              <strong>{t("Descripción del modelo")}</strong>
              <small>
                {inspection.description_source === "generated_public_metadata"
                  ? t("Generada con datos públicos y conservada en la base de datos")
                  : t("Ficha de Hugging Face conservada en la base de datos")}
                {inspection.description_revision ? t(" · revisión {slice}", { slice: inspection.description_revision.slice(0, 12) }) : ""}
              </small>
            </div>
            {inspection.description
              ? <MarkdownMessage
                  content={inspection.description}
                  assetBaseUrl={`https://huggingface.co/${inspection.repo_id}/resolve/${inspection.description_revision || "main"}/`}
                />
              : <p>{t("Este repositorio no proporciona una descripción.")}</p>}
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
                        aria-label={t("Seleccionar {label}", { label: group.label })}
                        checked={selected}
                        disabled={!pending.length || inspection.remote?.download_supported === false}
                        name={group.kind === "weights" ? "hf-quantization" : undefined}
                        onChange={(event) => toggleHfFileGroup(group, event.target.checked)}
                        onClick={(event) => event.stopPropagation()}
                        type={group.kind === "weights" ? "radio" : "checkbox"}
                      />
                    : <Info size={15} />}
                  <span>
                    <strong>{group.label}{selected && group.kind === "weights" && <em className="hf-recommended-label">{t("Recomendado para este Spark")}</em>}</strong>
                    {group.kind !== "auxiliary" && <small className="hf-quantization-hint">{quantizationHint(group.label)}</small>}
                    <small>
                      {group.sizeKnown ? bytes(group.size) : t("Tamaño desconocido")} · {group.files.length} {group.files.length === 1 ? t("archivo") : t("archivos")}
                      {downloadedCount ? t(" · {downloadedCount} ya descargado{value}", { downloadedCount: downloadedCount, value: downloadedCount === 1 ? "" : "s" }) : ""}
                      {selected ? t(" · seleccionado automáticamente{value}", { value: group.files.length > 1 ? t(" · se descargarán juntos") : "" }) : ""}
                    </small>
                  </span>
                  <ChevronRight className="hf-group-chevron" size={16} />
                </summary>
                <div className="hf-group-files">
                  {group.files.map((file) => <div className={file.downloaded ? "downloaded" : ""} key={file.name}>
                    <span><strong>{file.name}</strong><small>{bytes(file.size)}{file.lfs_sha256 ? ` · SHA256 ${file.lfs_sha256.slice(0, 12)}…` : ""}{file.downloaded ? t(" · Ya descargado") : ""}</small></span>
                    <ModelTermsButton text={`${file.name} ${file.quantization ?? ""}`} label={file.name} onOpen={setGlossaryRequest} />
                  </div>)}
                </div>
              </details>;
            })}
            {hiddenInspectionGroupCount > 0 && <button className="button secondary hf-show-alternatives" type="button" onClick={() => setShowAllFileGroups(true)}>
              {t("Mostrar otras")}{" "}{hiddenInspectionGroupCount}{" "}{t("cuantizaciones y archivos")}
            </button>}
            {showAllFileGroups && primaryInspectionGroups.length > 0 && <button className="button secondary hf-show-alternatives" type="button" onClick={() => setShowAllFileGroups(false)}>
              {t("Ocultar alternativas")}
            </button>}
          </div>
          <div className="hf-inspector-actions">
            <small>
              {selectedFiles.length}{" "}{t("archivo(s) seleccionado(s)")}
              {selectedFiles.length > 0 && (
                <> · {selectedSizeKnown
                  ? selectedResidentSize < selectedDownloadSize
                    ? t("{selectedDownloadSize} de descarga · ~{selectedResidentSize} residentes de {download_limit_bytes}", { selectedDownloadSize: bytes(selectedDownloadSize), selectedResidentSize: bytes(selectedResidentSize), download_limit_bytes: bytes(inspection.download_limit_bytes) })
                    : t("{selectedDownloadSize} de {download_limit_bytes} de memoria total", { selectedDownloadSize: bytes(selectedDownloadSize), download_limit_bytes: bytes(inspection.download_limit_bytes) })
                  : t("tamaño desconocido")}</>
              )}
            </small>
            <button
              className="button primary"
              disabled={inspection.remote?.download_supported === false || hfGatedBlocked(inspection.remote) || !selectedFiles.length || !selectedSizeKnown || selectedDownloadTooLarge || downloadBusy !== null || downloads.isDownloading(inspection.repo_id)}
              title={downloads.isDownloading(inspection.repo_id)
                ? t("Ya hay una descarga en curso de este repositorio; espera a que termine")
                : inspection.remote?.download_supported === false
                ? inspection.remote.download_block_reason
                : hfGatedBlocked(inspection.remote)
                ? t("Repositorio gated: sigue los pasos indicados para obtener acceso")
                : selectedDownloadTooLarge
                ? t("La selección supera la memoria total del sistema")
                : !selectedSizeKnown && selectedFiles.length ? t("No se puede comprobar que la selección cabe") : undefined}
              onClick={downloadSelected}
            ><Download className={downloadBusy === inspection.repo_id || downloads.isDownloading(inspection.repo_id) ? "spin" : ""} size={14} /> {downloadBusy === inspection.repo_id ? t("Preparando…") : downloads.isDownloading(inspection.repo_id) ? t("Descargando…") : t("Descargar archivos seleccionados")}</button>
          </div>
        </Card>
        </div>
      )}

      {glossaryRequest && <ModelGlossaryDialog request={glossaryRequest} onClose={() => setGlossaryRequest(null)} />}
      {pendingDownload && <DownloadPreflightDialog pending={pendingDownload} onCancel={() => setPendingDownload(null)} onConfirm={(extra) => void confirmDownload(extra)} />}
      {settingsModel && <ModelSettingsDialog modelId={settingsModel} notify={notify} onClose={() => setSettingsModel(null)} onSaved={refresh} />}
      {addToProfile && <AddToProfileDialog request={addToProfile} notify={notify} onClose={() => setAddToProfile(null)} />}

      {displayedJobs.length > 0 && (
        <ActivitySection
          eyebrow={t("TAREAS")}
          title={t("Actividad reciente")}
          total={Math.min(displayedJobs.length, 8)}
          active={displayedJobs.slice(0, 8).filter(({ job }) => activeJobStatuses.has(job.status)).length}
        >
          <Card className="jobs">
            {displayedJobs.slice(0, 8).map(({ job, duplicateCount }) => (
              <div className="job-row" key={job.id}>
                <div><strong>{job.target}</strong><small>{job.message}{duplicateCount > 1 ? t(" · {count} solicitudes duplicadas agrupadas", { count: duplicateCount }) : ""}</small></div>
                <div className="job-progress"><span style={{ width: `${job.progress}%` }} /></div>
                <span className={`badge ${job.status}`}>{job.status}</span>
                {["queued", "running"].includes(job.status) && ["ollama.pull", "ollama.update", "huggingface.files.download", "huggingface.integrity"].includes(job.kind) && <button className="icon-button danger" onClick={() => cancelJob(job.id)} aria-label={t("Cancelar trabajo")}><X size={14} /></button>}
              </div>
            ))}
          </Card>
        </ActivitySection>
      )}
    </div>
  );
}

function isAutoPort(model: Pick<ModelConfig, "port_auto">) {
  return model.port_auto !== false && model.port_auto !== 0;
}

function PortField({ auto, port, onAuto, onPort }: {
  auto: boolean;
  port: number;
  onAuto: (auto: boolean) => void;
  onPort: (port: number) => void;
}) {
  return <label>{t("Puerto")}
    <div className="paired-inputs">
      <select value={auto ? "auto" : "manual"} onChange={(event) => onAuto(event.target.value === "auto")} aria-label={t("Modo del puerto")}>
        <option value="auto">{t("Automático")}</option>
        <option value="manual">{t("Manual")}</option>
      </select>
      {auto
        ? <input value={port >= 1024 ? String(port) : t("Al guardar")} readOnly title={t("MyDGX elige un puerto libre que no usa ningún otro perfil, app ni servicio, y lo mantiene mientras siga libre")} />
        : <input type="number" min={1024} max={65535} value={port || ""} onChange={(event) => onPort(Number(event.target.value))} required />}
    </div>
  </label>;
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
    port: 0,
    port_auto: true,
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
  const [recipesOpen, setRecipesOpen] = useState(false);
  const [formOpenRequest, setFormOpenRequest] = useState(0);
  const editorRef = useRef<HTMLDivElement>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [loadingDefaults, setLoadingDefaults] = useState<string | null>(null);
  const [profileSearch, setProfileSearch] = useState("");
  const [profileCategory, setProfileCategory] = useState<ModelCategoryKey | "all">("all");
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
  const downloads = useDownloadTracker(jobs, load);
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
        ...defaults
      } = blank();
      void _name;
      void _additional;
      void _reserve;
      void _autoFit;
      void _minimum;
      void _app;
      // Each model gets its own parameters (from "Parámetros del modelo"), not a copy of the primary's.
      const model: ProfileModel = {
        ...defaults,
        engine: current.engine,
        runtime_backend: current.runtime_backend,
        task: current.task,
        input_modalities: current.input_modalities,
        output_modalities: current.output_modalities,
        id: `model-${Date.now()}`,
        name: `Modelo ${current.additional_models.length + 2}`,
        downloaded: false,
        enabled: true,
      };
      return { ...current, additional_models: [...current.additional_models, model] };
    });
  }

  async function applyModelDefaults(index: number | null, silent = false) {
    const target = index === null ? form : form.additional_models[index];
    if (!target) return;
    const source = target.engine === "ollama" ? "ollama" : "huggingface";
    const modelId = source === "ollama" ? target.model_ref.trim() : target.model_repo.trim();
    if (!modelId || (source === "huggingface" && !modelId.includes("/"))) {
      if (!silent) notify(source === "ollama" ? t("Indica el modelo de Ollama") : t("Indica el repositorio Hugging Face como organización/modelo"), true);
      return;
    }
    setLoadingDefaults(index === null ? "primary" : form.additional_models[index].id);
    try {
      const values = await api<Partial<ModelConfig> & { memory_preview_mb: number }>(
        `/api/profiles/model-defaults?source=${source}&model_id=${encodeURIComponent(modelId)}`,
      );
      const { memory_preview_mb: preview, ...fields } = values;
      const apply = <T extends ModelConfig>(model: T): T => ({
        ...model,
        ...fields,
        model_ref: model.model_ref.trim() || fields.model_ref || "",
        model_alias: model.model_alias.trim() || fields.model_alias || "",
        flash_attention: Number(fields.flash_attention ?? model.flash_attention),
        jinja: Number(fields.jinja ?? model.jinja),
        reasoning_off: Number(fields.reasoning_off ?? model.reasoning_off),
        kv_unified_per_slot: Number(fields.kv_unified_per_slot ?? model.kv_unified_per_slot),
      });
      setForm((current) => index === null
        ? apply(current)
        : { ...current, additional_models: current.additional_models.map((model, itemIndex) => itemIndex === index ? apply(model) : model) });
      notify(t("Parámetros de {modelId} aplicados · contexto {round}K · ~{toFixed} GB en memoria", { modelId: modelId, round: Math.round((fields.context_size ?? 0) / 1024), toFixed: (preview / 1024).toFixed(1) }));
    } catch (error) {
      if (!silent) notify((error as Error).message, true);
    } finally {
      setLoadingDefaults(null);
    }
  }

  // Filling on blur only when the model actually changed keeps hand-tuned parameters of a saved profile.
  const modelFieldOnFocus = useRef("");
  const modelFieldEvents = (index: number | null) => ({
    onFocus: (event: FocusEvent<HTMLInputElement>) => { modelFieldOnFocus.current = event.target.value; },
    onBlur: (event: FocusEvent<HTMLInputElement>) => {
      if (event.target.value.trim() && event.target.value !== modelFieldOnFocus.current) void applyModelDefaults(index, true);
    },
  });

  const defaultsButton = (index: number | null, id: string) => (
    <button type="button" className="button secondary" onClick={() => void applyModelDefaults(index)} disabled={loadingDefaults !== null} title={t("Contexto, muestreo, caché KV y mmproj que usaría Encender para este modelo descargado")}>
      <Sparkles size={15} /> {loadingDefaults === id ? t("Leyendo modelo…") : t("Parámetros del modelo")}
    </button>
  );

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
      notify(t("Alias OpenAI duplicados: {join}", { join: duplicateAliases.join(", ") }), true);
      return;
    }
    try {
      let appRestartNotice = "";
      if (form.app && (appWeb.alias !== storedAppWebAlias || appWeb.port !== storedAppWebPort)) {
        const result = await api<{ restart_required: boolean }>(`/api/profile-apps/${encodeURIComponent(form.app)}/web`, {
          method: "PUT",
          body: JSON.stringify({ alias: appWeb.alias.trim(), port: appWeb.port.trim() ? Number(appWeb.port) : null }),
        });
        if (result.restart_required) appRestartNotice = t(" · reinicia {app} para que use el puerto nuevo", { app: form.app });
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
      notify(`${editing ? t("Perfil actualizado") : t("Perfil creado")}${appRestartNotice}`);
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
      notify(t("Introduce un repositorio Hugging Face como organización/modelo"), true);
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
      notify(t("Recomendaciones aplicadas; revísalas antes de guardar"));
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

  async function duplicate(profile: Profile) {
    const suggestion = t("{name} copia", { name: profile.name.replace(RECIPE_PREFIX, "") }).replace(/[^A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ ·._-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    const name = window.prompt(
      t("Nombre del nuevo perfil (copia de {name}).\nLetras, números, espacios y · . _ - ; de 2 a 80 caracteres.", { name: profile.name }),
      suggestion,
    )?.trim();
    if (!name) return;
    try {
      await api(`/api/profiles/${encodeURIComponent(profile.id)}/duplicate`, { method: "POST", body: JSON.stringify({ name }) });
      notify(t("Perfil «{name}» creado como copia de {name2}; sus modelos llama.cpp usan puertos nuevos", { name: name, name2: profile.name }));
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
        llm_slots: number;
        max_llm_slots: number;
        port_assignments: Array<{ model: string; from: number; to: number }>;
      }>(`/api/profiles/${profile.id}/runtime-plan`);
      if (!plan.fits) {
        const conflict = plan.alias_conflicts.length
          ? t("Alias incompatibles: {join}", { join: plan.alias_conflicts.join(", ") })
          : plan.port_conflicts.length
            ? t("Puertos incompatibles: {join}", { join: plan.port_conflicts.join(", ") })
            : plan.llm_slots > plan.max_llm_slots
              ? t("Ya hay dos perfiles o modelos Quick cargados")
              : t("Se necesitan {toFixed} GB adicionales y hay {toFixed2} GB libres", { toFixed: (plan.incremental_mb / 1024).toFixed(1), toFixed2: (plan.available_mb / 1024).toFixed(1) });
        notify(t("No se puede arrancar: {conflict}", { conflict: conflict }), true);
        return;
      }
      const result = await api<{ job_id: string }>(`/api/profiles/${profile.id}/start`, {
        method: "POST",
      });
      setRequestedStarts((current) => ({ ...current, [profile.id]: result.job_id }));
      notify(
        missing
          ? t("Preparando {name}: se descargarán {missing} modelo(s) y después arrancará", { name: profile.name, missing: missing })
          : plan.port_assignments.length
            ? t("Preparando {name}: {assignments}", { name: profile.name, assignments: plan.port_assignments.map((item) => `${item.model} :${item.from}→:${item.to}`).join(" · ") })
            : t("Preparando {name}: {shared_models} modelo(s) compartido(s), {toFixed} GB nuevos", { name: profile.name, shared_models: plan.shared_models, toFixed: (plan.incremental_mb / 1024).toFixed(1) }),
      );
      load();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  function profileDownloadTarget(model: ProfileModel) {
    return model.engine === "ollama" ? model.model_ref : model.name;
  }

  async function downloadMissingModel(profile: Profile, model: ProfileModel) {
    const target = profileDownloadTarget(model);
    if (downloads.isDownloading(target)) return;
    downloads.track(target);
    try {
      const result = model.engine === "ollama"
        ? await api<{ job_id: string }>("/api/models/ollama/pull", { method: "POST", body: JSON.stringify({ name: model.model_ref }) })
        : await api<{ job_id: string }>(`/api/profiles/${profile.id}/models/${model.id}/download`, { method: "POST" });
      downloads.track(target, result.job_id);
      notify(t("Descarga de {name} añadida a la cola", { name: model.name }));
      load();
    } catch (error) {
      downloads.untrack(target);
      notify((error as Error).message, true);
    }
  }

  async function remove(profile: Profile) {
    if (!window.confirm(t("¿Eliminar el perfil {name}?", { name: profile.name }))) return;
    try {
      await api(`/api/profiles/${profile.id}?confirm=${encodeURIComponent(profile.name)}`, { method: "DELETE" });
      notify(t("Perfil eliminado"));
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
  const searchedProfiles = (data?.profiles ?? []).filter((profile) => {
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
  const profileCategoriesOf = (profile: Profile) => profileCategories(profile.models);
  const visibleProfiles = searchedProfiles.filter((profile) => profileCategory === "all" || profileCategoriesOf(profile).includes(profileCategory));
  const profileFilterText = [profileSearch, profileCategory === "all" ? "" : profileCategory].join(" ");
  const activeProfiles = visibleProfiles.filter(profileIsRunning).sort(byFavorite);
  const availableProfiles = visibleProfiles.filter((profile) => !profileIsRunning(profile)).sort(byFavorite);

  function renderProfileCard(profile: Profile) {
    if (!data) return null;
    const running = data.runtime.profile_ids?.includes(profile.id)
      || (data.runtime.running && data.runtime.profile_id === profile.id);
    const limitReached = !profile.read_only && data.runtime.llm_slots >= data.runtime.max_llm_slots;
    const runtimePlan = profile.runtime_plan;
    const noFitReason = running
      ? ""
      : limitReached
        ? t("Ya hay dos perfiles o modelos Quick encendidos; detén uno para arrancar este")
        : !profile.memory_plan.fits
          ? t("El conjunto supera la memoria segura del equipo o repite puertos")
          : runtimePlan && !runtimePlan.fits
            ? runtimePlan.alias_conflicts.length
              ? t("Alias en uso por otro perfil encendido: {join}", { join: runtimePlan.alias_conflicts.join(", ") })
              : runtimePlan.port_conflicts.length
                ? t("Puertos en uso por otro perfil encendido: {join}", { join: runtimePlan.port_conflicts.join(", ") })
                : t("Necesita {toFixed} GB más y hay {toFixed2} GB libres", { toFixed: (runtimePlan.incremental_mb / 1024).toFixed(1), toFixed2: (Math.max(0, runtimePlan.available_mb - runtimePlan.reserve_mb) / 1024).toFixed(1) })
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
          <div><ProfileName name={profile.name} /><small title={`${profile.engine} · ${profile.task} · ${profile.model_repo || profile.model_ref}`}>{profile.engine} · {profile.task} · {profile.model_repo || profile.model_ref}</small><CategoryBadges categories={profileCategories(profile.models)} /></div>
          <div className="profile-badges">
            {profile.source.startsWith("ARTIFEX") ? <span className="badge">ARTIFEX</span> : null}
            {profile.read_only ? <span className="badge" title={profile.id === QUICK_PROFILE_ID ? t("Modelos encendidos desde Modelos; no se restaura al reiniciar") : t("Modelos marcados como Default en Modelos; arranca siempre con MyDGX")}>{t("Solo lectura")}</span> : null}
            {profile.recipe_id ? <span className="badge" title={t("Receta de solo lectura; duplícala para editarla")}>{t("Solo lectura")} · v{profile.recipe_version}</span> : null}
            {profile.active ? <span className="badge live">{t("Predeterminado")}</span> : null}
            {running ? <span className="badge running">{t("Cargado")}</span> : null}
          </div>
          <button
            className={`profile-favorite ${profile.favorite ? "selected" : ""}`}
            onClick={() => void toggleFavorite(profile)}
            title={profile.favorite ? t("Quitar de favoritos") : t("Marcar como favorito")}
            aria-label={profile.favorite ? t("Quitar {name} de favoritos", { name: profile.name }) : t("Marcar {name} como favorito", { name: profile.name })}
          >
            <Star size={17} fill={profile.favorite ? "currentColor" : "none"} />
          </button>
        </div>
        <div className="profile-specs">
          <span><small>{t("Modelos")}</small><strong>{profile.models.length}</strong></span>
          <span><small>{t("Puertos")}</small><strong>{profile.models.map((item) => item.port).join(", ")}</strong></span>
          <span><small>{t("Memoria estimada")}</small><strong>{(profile.memory_plan.required_mb / 1024).toFixed(1)} GB</strong></span>
          <span><small>{t("Capacidad segura")}</small><strong>{(profile.memory_plan.capacity_mb / 1024).toFixed(1)} GB</strong></span>
        </div>
        <div className={`profile-capacity ${profile.memory_plan.fits ? "fits" : "over"}`}>
          <span style={{ width: `${Math.min(100, profile.memory_plan.required_mb / Math.max(1, profile.memory_plan.capacity_mb) * 100)}%` }} />
          <small>{profile.memory_plan.fits ? t("El conjunto cabe en la memoria segura") : t("El conjunto supera la memoria segura o repite puertos")}</small>
        </div>
        <div className="profile-model-roster">
          {profile.models.map((model) => {
            const runtimeModel = data.runtime.models?.find((item) => (
              item.model_id === model.id
              && (item.profile_id === profile.id || (!item.profile_id && data.runtime.profile_id === profile.id))
            ));
            const modelRunning = Boolean(runtimeModel?.running);
            const effectiveContext = runtimeModel?.effective_context || model.context_size;
            const identity = profileModelIdentity(model);
            const aliases = [
              model.name !== profile.name && model.name !== identity.name ? model.name : "",
              model.model_alias && model.model_alias !== model.name ? t("alias {alias}", { alias: model.model_alias }) : "",
            ].filter(Boolean);
            const kvCache = model.cache_type_k && model.cache_type_k === model.cache_type_v ? model.cache_type_k : [model.cache_type_k, model.cache_type_v].filter(Boolean).join("/");
            const details = [
              identity.quant,
              model.estimated_memory_mb > 0 ? `≈${(model.estimated_memory_mb / 1024).toFixed(1)} GB` : "",
              ["chat", "vision", "embeddings"].includes(model.task) ? `${(effectiveContext / 1024).toLocaleString(locale)}K ctx${effectiveContext !== model.context_size ? ` ${t("(ajustado)")}` : ""}` : "",
              kvCache ? `KV ${kvCache}` : "",
              model.spec_type ? SPEC_LABELS[model.spec_type] ?? model.spec_type : "",
              model.mmproj_filename || model.mmproj_file ? t("visión") : "",
              model.task !== "chat" ? model.task : "",
              `${model.engine} :${model.port}`,
            ].filter(Boolean);
            return <div key={model.id}>
              <span className={`status-dot ${modelRunning ? "ok" : model.downloaded ? "online" : "warn"}`} />
              <span className="profile-model-id">
                <span className="profile-model-name">
                  <strong title={[identity.file || model.model_repo || model.model_ref, model.spec_type ? `${SPEC_LABELS[model.spec_type] ?? model.spec_type}: ${model.draft_filename || t("MTP integrado en el GGUF")}` : ""].filter(Boolean).join("\n")}>{identity.name}</strong>
                  <UncensoredBadge name={`${model.uncensored ?? ""} ${identity.name}`} flagged={Boolean(model.uncensored)} showKind />
                </span>
                {aliases.length > 0 && <small>{aliases.join(" · ")}</small>}
              </span>
              <small className="profile-model-meta">{details.join(" · ")}</small>
              {!model.downloaded && ((model.engine === "llama.cpp" && model.model_repo) || model.engine === "ollama" || (model.engine === "comfyui" && model.comfyui?.files.length)) && <button className="profile-model-download" disabled={downloads.isDownloading(profileDownloadTarget(model))} onClick={() => void downloadMissingModel(profile, model)}>{downloads.isDownloading(profileDownloadTarget(model)) ? <><RefreshCw className="spin" size={13} />{" "}{t("Descargando…")}</> : <><Download size={13} />{" "}{t("Descargar modelo")}</>}</button>}
            </div>;
          })}
          {profile.app ? (() => {
            const appState = data.apps.states[profile.app];
            const available = data.apps.available.includes(profile.app);
            const dot = !available || appState?.state === "error" ? "warn" : appState?.state === "running" ? "ok" : "online";
            const label = !available
              ? t("No encontrada en {root}", { root: data.apps.root })
              : appState ? profileAppStateLabels[appState.state] : t("Se arranca al cargar el perfil");
            return <div className="profile-app-row">
              <span className={`status-dot ${dot}`} />
              <strong><Rocket size={13} /> {data.apps.web?.[profile.app]?.alias ?? profile.app}</strong>
              <small title={appState?.message}>{t("App")}{data.apps.web?.[profile.app] ? ` ${t("web")} :${data.apps.web[profile.app].port}` : ""} · {label}{appState?.message ? ` · ${appState.message}` : ""}</small>
              {available && <span className="profile-app-actions">
                {appState?.state === "running" && data.apps.web?.[profile.app] && <a className="profile-app-open" href={`http://${window.location.hostname || "127.0.0.1"}:${data.apps.web[profile.app].port}/`} target="_blank" rel="noreferrer"><ExternalLink size={13} />{" "}{t("Abrir")}</a>}
                <button onClick={() => void appAction(profile.app, "status")}><Activity size={13} />{" "}{t("Estado")}</button>
                {running && <button onClick={() => void appAction(profile.app, "restart")}><RefreshCw size={13} />{" "}{t("Reiniciar")}</button>}
              </span>}
            </div>;
          })() : null}
        </div>
        <div className="profile-actions">
          {!profile.active && !profile.read_only && <button title={t("Seleccionarlo sin arrancarlo")} onClick={() => action(`/api/profiles/${profile.id}/activate`, t("{name} será el perfil predeterminado al arrancar", { name: profile.name }))}><ShieldCheck size={14} />{" "}{t("Solo predeterminado")}</button>}
          <button
            className={noFitReason && !preparing ? "no-fit" : undefined}
            title={preparing ? undefined : noFitReason || undefined}
            disabled={preparing || (!running && (anyPreparing || Boolean(noFitReason)))}
            onClick={() => {
              if (!running) {
                void selectAndStart(profile);
              } else if (window.confirm(t("¿Detener {name}? Sus modelos dejarán de responder en el chat y el gateway.", { name: profile.name }))) {
                void action(`/api/profiles/${profile.id}/stop`, t("Perfil detenido"));
              }
            }}
          >
            {running ? <Square size={13} /> : <Play size={14} />}
            {running
              ? t("Detener")
              : preparing
                ? t("Preparando {round}%", { round: Math.round(startJob?.progress ?? 0) })
                : anyPreparing
                  ? t("Otro perfil en preparación")
                : noFitReason
                  ? t("No cabe ahora")
                : missingModels
                  ? t("Descargar {missingModels} y arrancar", { missingModels: missingModels })
                  : profile.read_only ? t("Arrancar") : t("Seleccionar y arrancar")}
          </button>
          {startJob && ["queued", "running"].includes(startJob.status) && <button
            className="danger"
            onClick={() => {
              if (window.confirm(t("¿Cancelar la preparación de {name}? Lo ya descargado se queda en la caché.", { name: profile.name }))) {
                void action(`/api/jobs/${startJob.id}/cancel`, t("Cancelación solicitada"));
              }
            }}
          ><X size={14} />{" "}{t("Cancelar")}</button>}
          <button title={t("Crear un perfil editable con la misma configuración y otro nombre")} onClick={() => void duplicate(profile)}><Copy size={14} />{" "}{t("Duplicar")}</button>
          {profile.recipe_update ? <button
            className="primary"
            disabled={running}
            title={running ? t("Detén el perfil antes de actualizar la receta") : undefined}
            onClick={() => void action(`/api/profiles/recipes/${encodeURIComponent(profile.recipe_id || "")}/update`, t("{name} actualizada a v{version}", { name: profile.name.replace(RECIPE_PREFIX, ""), version: profile.recipe_update }))}
          ><RefreshCw size={14} />{" "}{t("Actualizar a v{version}", { version: profile.recipe_update })}</button> : null}
          {profile.read_only
            ? <small className="profile-readonly-hint">{t("Se gestiona desde Modelos")}</small>
            : <>
              {profile.recipe_id
                ? <small className="profile-readonly-hint">{t("Receta: duplícala para editarla")}</small>
                : <button onClick={() => editProfile(profile)}><Pencil size={14} />{" "}{t("Editar")}</button>}
              <button className="danger" onClick={() => remove(profile)}><Trash2 size={14} /></button>
            </>}
        </div>
      </Card>
    );
  }

  return (
    <div className="view-stack">
      <SectionHeading
        eyebrow={t("CONFIGURACIONES DE INFERENCIA")}
        title={t("Perfiles")}
        action={<div className="dialog-heading-actions">
          <button className="button secondary" onClick={() => setRecipesOpen(true)}><Search size={15} />{" "}{t("Buscar recetas")}</button>
          <button className="button primary" onClick={newProfile}><Rocket size={15} />{" "}{t("Nuevo perfil")}</button>
        </div>}
      />
      {recipesOpen && <RecipesDialog notify={notify} onClose={() => setRecipesOpen(false)} onInstalled={() => load()} />}
      <div className="profile-summary">
        <Card><small>{t("Perfil predeterminado")}</small><strong>{data?.profiles.find((profile) => profile.active)?.name ?? t("Sin seleccionar")}</strong></Card>
        <Card><small>{t("Runtime")}</small><strong>{data?.runtime.running ? t("{loaded}/{max} perfiles o modelos Quick{extra} · {runningModels} modelo(s)", { loaded: data.runtime.llm_slots, max: data.runtime.max_llm_slots, extra: (data.runtime.profile_ids ?? []).includes("mydgx-default") ? " + Default" : "", runningModels: data.runtime.running_models }) : t("Detenido")}</strong></Card>
        <Card><small>llama.cpp</small><strong>{data?.llama_cpp_available ? t("Detectado") : t("No detectado")}</strong></Card>
      </div>
      {data?.runtime.boot_restore?.state === "restoring" && <div className="profile-warning"><RefreshCw className="spin" size={14} />{t("Restaurando los perfiles del último arranque")}{data.runtime.boot_restore.pending.length ? `: ${data.runtime.boot_restore.pending.join(", ")}` : ""}…</div>}
      {data?.runtime.boot_restore?.state === "done" && data.runtime.boot_restore.errors.length > 0 && <div className="profile-warning"><TriangleAlert size={14} />{t("No se pudieron restaurar tras el arranque:")}{" "}{data.runtime.boot_restore.errors.join(" · ")}</div>}
      <div className="profile-filter-bar">
      <div className={`profile-search${searchStateClass(profileFilterText, data ? visibleProfiles.length : null)}`} data-count={searchCountLabel(profileFilterText, data ? visibleProfiles.length : null)}>
        <Search size={14} />
        <input
          type="search"
          value={profileSearch}
          onChange={(event) => setProfileSearch(event.target.value)}
          placeholder={t("Buscar perfiles, modelos, tareas…")}
          aria-label={t("Buscar perfiles")}
        />
        {profileSearch && <button onClick={() => setProfileSearch("")} title={t("Limpiar búsqueda")} aria-label={t("Limpiar búsqueda")}><X size={13} /></button>}
      </div>
      {data && data.profiles.length > 0 && <CategoryFilters
        className="compact"
        value={profileCategory}
        onChange={setProfileCategory}
        counts={categoryCounts(searchedProfiles, profileCategoriesOf)}
        total={searchedProfiles.length}
      />}
      </div>

      {showForm && (
        <div ref={editorRef} className="profile-editor-anchor">
        <Card className="profile-editor">
          <SectionHeading eyebrow={editing ? t("EDITANDO") : t("NUEVO")} title={editing ? form.name : t("Crear perfil")} action={<button className="icon-button" onClick={() => setShowForm(false)}><X size={16} /></button>} />
          <form onSubmit={save}>
            <label>{t("Nombre")}<input value={form.name} onChange={(event) => setField("name", event.target.value)} required /></label>
            <label>{t("Motor")}<select value={form.engine} onChange={(event) => setPrimaryEngine(event.target.value as Profile["engine"])}>{engineOptions.map((engine) => <option value={engine} key={engine}>{engine}</option>)}</select></label>
            <label>{t("Tarea")}<select value={form.task} onChange={(event) => setPrimaryTask(event.target.value as ModelTask)}>{taskOptions.map((task) => <option value={task.id} key={task.id}>{task.label}</option>)}</select></label>
            <label>{t("Runtime")}<select value={form.runtime_backend} onChange={(event) => setField("runtime_backend", event.target.value as Profile["runtime_backend"])}><option value="native">{t("Nativo")}</option><option value="external">{t("Endpoint externo local")}</option><option value="compose" disabled>{t("Compose (próxima fase)")}</option></select></label>
            <label className="wide">{form.engine === "llama.cpp" ? t("Identificador del modelo / API") : t("Modelo Ollama")}<input value={form.model_ref} onChange={(event) => setField("model_ref", event.target.value)} {...(form.engine === "ollama" ? modelFieldEvents(null) : {})} placeholder={form.engine === "llama.cpp" ? t("Se completa con el repositorio") : "qwen3:8b"} required /></label>
            {form.engine === "ollama" && <div className="wide recommendation-action">{defaultsButton(null, "primary")}</div>}
            {!["llama.cpp", "ollama"].includes(form.engine) && <>
              <label className="wide">{t("Endpoint local")}<input type="url" value={form.endpoint_url} onChange={(event) => setField("endpoint_url", event.target.value)} placeholder={form.api_protocol === "tts-lab" ? "http://127.0.0.1:8010/api/projects/mi-voz" : "http://127.0.0.1:8000"} required /></label>
              <label>{t("Protocolo")}<select value={form.api_protocol} onChange={(event) => setField("api_protocol", event.target.value as Profile["api_protocol"])}><option value="openai">{t("OpenAI compatible")}</option><option value="tts-lab">{t("TTS Lab")}</option><option value="voice-agent">{t("Voice Agent (API privada)")}</option><option value="ragkit">RAGKit</option><option value="security-app">{t("Aplicación de seguridad")}</option><option value="comfyui">{t("ComfyUI (adaptador requerido)")}</option></select></label>
              <label>{t("Timeout (s)")}<input type="number" min={10} max={86400} value={form.timeout_seconds} onChange={(event) => setField("timeout_seconds", Number(event.target.value))} /></label>
            </>}
            {form.engine === "llama.cpp" && (
              <>
                <label className="wide">{t("Repositorio Hugging Face")}<input value={form.model_repo} onChange={(event) => setField("model_repo", event.target.value)} {...modelFieldEvents(null)} placeholder={t("organización/modelo-GGUF")} /></label>
                <label>{t("Alias OpenAI servido")}<input value={form.model_alias} onChange={(event) => setField("model_alias", event.target.value)} placeholder={form.model_ref || "mi-modelo"} /></label>
                <label>{t("Archivo GGUF remoto")}<input value={form.model_filename} onChange={(event) => setField("model_filename", event.target.value)} placeholder="modelo.Q4_K_M.gguf" /></label>
                <label className="wide">{t("Archivo GGUF local")}<input value={form.model_file} onChange={(event) => setField("model_file", event.target.value)} placeholder={t("Se completa al descargar, o indica una ruta absoluta")} /></label>
                <label className="wide">{t("Shards GGUF remotos")}{" "}<small>{t("(uno por línea)")}</small><textarea value={form.model_files.join("\n")} onChange={(event) => setField("model_files", event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))} placeholder={"UD-IQ4_XS/model-00001-of-00003.gguf\nUD-IQ4_XS/model-00002-of-00003.gguf"} /></label>
                {form.task === "vision" && <>
                  <label>{t("Repositorio mmproj")}<input value={form.mmproj_repo} onChange={(event) => setField("mmproj_repo", event.target.value)} placeholder={form.model_repo || t("organización/modelo-GGUF")} /></label>
                  <label>{t("Archivo mmproj remoto")}<input value={form.mmproj_filename} onChange={(event) => setField("mmproj_filename", event.target.value)} placeholder="mmproj-model-f16.gguf" /></label>
                  <label className="wide">{t("Archivo mmproj local")}<input value={form.mmproj_file} onChange={(event) => setField("mmproj_file", event.target.value)} /></label>
                </>}
                <div className="wide recommendation-action">
                  {defaultsButton(null, "primary")}
                  <button type="button" className="button secondary" onClick={recommend} disabled={analyzing}><Sparkles size={15} /> {analyzing ? t("Analizando ficha…") : t("Recomendar desde Hugging Face")}</button>
                  {recommendation && <small>{t("Contexto obtenido de")}{" "}{recommendation.context_source}. {t("GGUF sugerido:")} {recommendation.recommended_file ?? t("no indicado")}.</small>}
                </div>
              </>
            )}
            <PortField auto={isAutoPort(form)} port={form.port} onAuto={(auto) => setField("port_auto", auto)} onPort={(port) => setField("port", port)} />
            <label>{t("Contexto")}<input type="number" value={form.context_size} min={512} onChange={(event) => setField("context_size", Number(event.target.value))} /></label>
            <label>{t("Capas GPU")}<input type="number" value={form.gpu_layers} min={-1} onChange={(event) => setField("gpu_layers", Number(event.target.value))} /></label>
            <label>{t("Hilos CPU")}<input type="number" value={form.threads} min={1} onChange={(event) => setField("threads", Number(event.target.value))} /></label>
            <label>{t("Límite de entrada (MiB)")}<input type="number" min={1} max={1024} value={form.max_input_mb} onChange={(event) => setField("max_input_mb", Number(event.target.value))} /></label>
            <label>{t("Modalidades")}<input value={`${form.input_modalities.join(" + ")} → ${form.output_modalities.join(" + ")}`} readOnly /></label>
            {form.engine === "llama.cpp" && <details className="wide profile-advanced">
              <summary>{t("Parámetros avanzados de llama.cpp")}</summary>
              <div className="advanced-grid">
                <label>{t("Slots paralelos")}<input type="number" value={form.parallel} min={1} max={32} onChange={(event) => setField("parallel", Number(event.target.value))} /></label>
                <label>{t("Batch")}<input type="number" value={form.batch_size} min={1} onChange={(event) => setField("batch_size", Number(event.target.value))} /></label>
                <label>Micro-batch<input type="number" value={form.ubatch_size} min={1} onChange={(event) => setField("ubatch_size", Number(event.target.value))} /></label>
                <label>{t("Temperatura")}<input type="number" step="0.05" value={form.temperature} min={0} max={2} onChange={(event) => setField("temperature", Number(event.target.value))} /></label>
                <label>{t("Top P")}<input type="number" step="0.01" value={form.top_p} min={0.01} max={1} onChange={(event) => setField("top_p", Number(event.target.value))} /></label>
                <label>{t("Top K")}<input type="number" value={form.top_k} min={0} onChange={(event) => setField("top_k", Number(event.target.value))} /></label>
                <label>{t("Min P")}<input type="number" step="0.01" value={form.min_p} min={0} max={1} onChange={(event) => setField("min_p", Number(event.target.value))} /></label>
                <label>{t("Repeat penalty")}<input type="number" step="0.05" value={form.repeat_penalty} min={0} max={2} onChange={(event) => setField("repeat_penalty", Number(event.target.value))} /></label>
                <label>{t("Presence penalty")}<input type="number" step="0.1" value={form.presence_penalty} min={0} max={2} onChange={(event) => setField("presence_penalty", Number(event.target.value))} /></label>
                <label>{t("KV cache K")}<select value={form.cache_type_k} onChange={(event) => setField("cache_type_k", event.target.value as Profile["cache_type_k"])}><option value="">{t("Predeterminado (F16)")}</option><option value="f16">F16</option><option value="q8_0">Q8_0</option><option value="q4_0">Q4_0</option></select></label>
                <label>{t("KV cache V")}<select value={form.cache_type_v} onChange={(event) => setField("cache_type_v", event.target.value as Profile["cache_type_v"])}><option value="">{t("Predeterminado (F16)")}</option><option value="f16">F16</option><option value="q8_0">Q8_0</option><option value="q4_0">Q4_0</option></select></label>
                <label>{t("Memoria libre mínima (MiB)")}<input type="number" value={form.min_free_memory_mb} min={0} onChange={(event) => setField("min_free_memory_mb", Number(event.target.value))} /></label>
                <label>{t("Reasoning effort")}<select value={form.reasoning_effort} onChange={(event) => setField("reasoning_effort", event.target.value as Profile["reasoning_effort"])}><option value="">{t("Sin especificar")}</option><option value="low">{t("Low")}</option><option value="medium">{t("Medium")}</option><option value="high">{t("High")}</option></select></label>
                <label>{t("Runtime requerido")}<input value={form.runtime_requirement} onChange={(event) => setField("runtime_requirement", event.target.value)} placeholder={t("llama.cpp v1.0.0 · CUDA 13 · sm_121")} /></label>
                <div className="advanced-checks">
                  <label className="checkbox"><input type="checkbox" checked={Boolean(form.flash_attention)} onChange={(event) => setField("flash_attention", Number(event.target.checked))} /><span>{t("Flash Attention")}</span></label>
                  <label className="checkbox"><input type="checkbox" checked={Boolean(form.jinja)} onChange={(event) => setField("jinja", Number(event.target.checked))} /><span>{t("Plantillas Jinja")}</span></label>
                  <label className="checkbox"><input type="checkbox" checked={Boolean(form.reasoning_off)} onChange={(event) => setField("reasoning_off", Number(event.target.checked))} /><span>{t("Reasoning desactivado")}</span></label>
                  <label className="checkbox"><input type="checkbox" checked={Boolean(form.kv_unified_per_slot)} onChange={(event) => setField("kv_unified_per_slot", Number(event.target.checked))} /><span>{t("KV unificado por slot")}</span></label>
                </div>
              </div>
            </details>}
            <div className="wide capacity-editor">
              <div>
                <strong>{t("Seguridad de memoria del perfil")}</strong>
                <small>{t("MyDGX suma modelos y contextos antes de detener el perfil actual.")}</small>
              </div>
              <label>{t("Reserva del sistema (MiB)")}<input type="number" min={1024} value={form.memory_reserve_mb} onChange={(event) => setField("memory_reserve_mb", Number(event.target.value))} /></label>
              <label>{t("Contexto mínimo de recuperación")}<input type="number" min={512} value={form.minimum_context_size} onChange={(event) => setField("minimum_context_size", Number(event.target.value))} /></label>
              <label className="checkbox"><input type="checkbox" checked={Boolean(form.auto_fit_context)} onChange={(event) => setField("auto_fit_context", Number(event.target.checked))} /><span>{t("Reducir contexto automáticamente tras OOM")}</span></label>
            </div>
            <div className="wide capacity-editor">
              <div>
                <strong>{t("App del perfil")}</strong>
                <small>{t("Se arranca con su")}{" "}<code>start.sh start</code>{" "}{t("cuando la inferencia está lista y se detiene con")}{" "}<code>start.sh stop</code>{" "}{t("al parar el perfil. Apps disponibles en")}{" "}{data?.apps.root ?? t("el home")}.</small>
              </div>
              <label>{t("App al cargar el perfil")}
                <select value={form.app ?? ""} onChange={(event) => setField("app", event.target.value)}>
                  <option value="">{t("Ninguna")}</option>
                  {data?.apps.available.map((name) => <option value={name} key={name}>{name}</option>)}
                  {form.app && !data?.apps.available.includes(form.app) ? <option value={form.app}>{form.app}{" "}{t("(no encontrada)")}</option> : null}
                </select>
              </label>
              {form.app ? <>
                <label>{t("Alias de la app web")}
                  <input maxLength={40} value={appWeb.alias} placeholder={form.app} onChange={(event) => setAppWebField("alias", event.target.value)} />
                </label>
                <label>{t("Puerto web en 127.0.0.1")}
                  <input type="number" min={1024} max={65535} value={appWeb.port} placeholder={t("Sin acceso web")} onChange={(event) => setAppWebField("port", event.target.value)} />
                </label>
                <small className="wide">{t("Con puerto,")}{" "}<code>start.sh</code> {t("recibe")} <code>MYDGX_APP_PORT</code>, <code>MYDGX_APP_HOST=127.0.0.1</code> y <code>MYDGX_APP_URL</code>{t(", y la app aparece en Resumen y en la barra de menús mientras está en marcha. El alias y el puerto son de la app y se comparten entre los perfiles que la usan.")}</small>
              </> : null}
            </div>
            <div className="wide additional-models-editor">
              <div className="additional-models-heading">
                <div><strong>{t("Modelos del perfil")}</strong><small>{t("El modelo principal y")}{" "}{form.additional_models.length}{" "}{t("modelo(s) adicional(es) arrancarán en orden.")}</small></div>
                <button type="button" className="button secondary" onClick={addModel}><Boxes size={15} />{" "}{t("Añadir modelo")}</button>
              </div>
              {form.additional_models.map((model, index) => (
                <div className="additional-model-editor" key={model.id}>
                  <div className="additional-model-title">
                    <strong>{model.name || t("Modelo {value}", { value: index + 2 })}</strong>
                    <label className="checkbox"><input type="checkbox" checked={model.enabled} onChange={(event) => setAdditionalField(index, "enabled", event.target.checked)} /><span>{t("Habilitado")}</span></label>
                    <button type="button" className="icon-button danger" onClick={() => removeAdditional(index)}><Trash2 size={14} /></button>
                  </div>
                  <div className="additional-model-grid">
                    <label>{t("Nombre")}<input value={model.name} onChange={(event) => setAdditionalField(index, "name", event.target.value)} required /></label>
                    <label>{t("Motor")}<select value={model.engine} onChange={(event) => setAdditionalEngine(index, event.target.value as ProfileModel["engine"])}>{engineOptions.map((engine) => <option value={engine} key={engine}>{engine}</option>)}</select></label>
                    <label>{t("Tarea")}<select value={model.task} onChange={(event) => setAdditionalTask(index, event.target.value as ModelTask)}>{taskOptions.map((task) => <option value={task.id} key={task.id}>{task.label}</option>)}</select></label>
                    <label>{t("Identificador / modelo")}<input value={model.model_ref} onChange={(event) => setAdditionalField(index, "model_ref", event.target.value)} {...(model.engine === "ollama" ? modelFieldEvents(index) : {})} placeholder={model.engine === "llama.cpp" ? t("Se completa con el repositorio") : undefined} required /></label>
                    <PortField auto={isAutoPort(model)} port={model.port} onAuto={(auto) => setAdditionalField(index, "port_auto", auto)} onPort={(port) => setAdditionalField(index, "port", port)} />
                    {!["llama.cpp", "ollama"].includes(model.engine) && <>
                      <label className="span-two">{t("Endpoint local")}<input type="url" value={model.endpoint_url} onChange={(event) => setAdditionalField(index, "endpoint_url", event.target.value)} placeholder={model.api_protocol === "tts-lab" ? "http://127.0.0.1:8010/api/projects/mi-voz" : "http://127.0.0.1:8000"} required /></label>
                      <label>{t("Protocolo")}<select value={model.api_protocol} onChange={(event) => setAdditionalField(index, "api_protocol", event.target.value as ModelConfig["api_protocol"])}><option value="openai">{t("OpenAI compatible")}</option><option value="tts-lab">{t("TTS Lab")}</option><option value="voice-agent">{t("Voice Agent (API privada)")}</option><option value="ragkit">RAGKit</option><option value="security-app">{t("Aplicación de seguridad")}</option><option value="comfyui">ComfyUI</option></select></label>
                    </>}
                    {model.engine === "llama.cpp" && <>
                      <label className="span-two">{t("Repositorio Hugging Face")}<input value={model.model_repo} onChange={(event) => setAdditionalField(index, "model_repo", event.target.value)} {...modelFieldEvents(index)} placeholder={t("organización/modelo-GGUF")} /></label>
                      <label>{t("Archivo GGUF remoto")}<input value={model.model_filename} onChange={(event) => setAdditionalField(index, "model_filename", event.target.value)} /></label>
                      <label>{t("Archivo GGUF local")}<input value={model.model_file} onChange={(event) => setAdditionalField(index, "model_file", event.target.value)} /></label>
                      {model.task === "vision" && <>
                        <label>{t("Archivo mmproj remoto")}<input value={model.mmproj_filename} onChange={(event) => setAdditionalField(index, "mmproj_filename", event.target.value)} /></label>
                        <label>{t("Archivo mmproj local")}<input value={model.mmproj_file} onChange={(event) => setAdditionalField(index, "mmproj_file", event.target.value)} /></label>
                      </>}
                    </>}
                    <label>{t("Contexto")}<input type="number" min={512} value={model.context_size} onChange={(event) => setAdditionalField(index, "context_size", Number(event.target.value))} /></label>
                    <label>{t("Batch / uBatch")}<div className="paired-inputs"><input type="number" min={1} value={model.batch_size} onChange={(event) => setAdditionalField(index, "batch_size", Number(event.target.value))} /><input type="number" min={1} value={model.ubatch_size} onChange={(event) => setAdditionalField(index, "ubatch_size", Number(event.target.value))} /></div></label>
                    <label>{t("Memoria estimada (MiB)")}<input type="number" min={0} value={model.estimated_memory_mb} onChange={(event) => setAdditionalField(index, "estimated_memory_mb", Number(event.target.value))} placeholder={t("0 = automática")} /></label>
                    <label>{t("Alias OpenAI servido")}<input value={model.model_alias} onChange={(event) => setAdditionalField(index, "model_alias", event.target.value)} /></label>
                    {["llama.cpp", "ollama"].includes(model.engine) && <div className="span-two recommendation-action">{defaultsButton(index, model.id)}</div>}
                  </div>
                </div>
              ))}
            </div>
            {duplicateAliases.length > 0 && <div className="profile-warning wide"><ShieldCheck size={16} />{t("Cada modelo habilitado necesita un alias OpenAI único. Duplicados:")}{" "}{duplicateAliases.join(", ")}.</div>}
            {recommendation?.warning && <div className="profile-warning wide"><ShieldCheck size={16} />{recommendation.warning}</div>}
            <div className="profile-form-actions wide"><button type="button" className="button secondary" onClick={() => setShowForm(false)}>{t("Cancelar")}</button><button className="button primary" type="submit" disabled={duplicateAliases.length > 0}>{t("Guardar perfil")}</button></div>
          </form>
        </Card>
        </div>
      )}

      {(activeProfiles.length > 0 || availableProfiles.length > 0) && <div className="profile-groups">
        {activeProfiles.length > 0 && <section className="profile-group split-section is-active">
          <div className="split-section-title"><strong>{t("Activos")}</strong><span>{activeProfiles.length}</span></div>
          <div className="profiles-list">{activeProfiles.map(renderProfileCard)}</div>
        </section>}
        {availableProfiles.length > 0 && <section className="profile-group split-section">
          <div className="split-section-title"><strong>{t("Disponibles")}</strong><span>{availableProfiles.length}</span></div>
          <div className="profiles-list">{availableProfiles.map(renderProfileCard)}</div>
        </section>}
      </div>}
      {data && !visibleProfiles.length && (
        <Empty
          icon={<SlidersHorizontal />}
          title={profileFilterText.trim() ? t("No hay coincidencias") : t("No hay perfiles")}
          text={profileFilterText.trim() ? t("Prueba con otro nombre, modelo, motor o tarea.") : t("Crea una configuración para llama.cpp u Ollama y actívala como predeterminada.")}
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
      ...(stopProfiles ? profiles.map((profile) => t("perfil {name}", { name: profile.name })) : []),
      ...active.filter((service) => chosen.has(service.id)).map((service) => service.name),
    ];
    if (!window.confirm(t("Se detendrán: {value} y se descargarán los modelos de Ollama. Podrás devolverlo todo con «Restaurar». ¿Continuar?", { value: names.join(", ") || t("ningún servicio") }))) return;
    void run("release", "/api/memory-mode/release", {
      services: [...chosen].filter((id) => active.some((service) => service.id === id)),
      release_ollama: true,
      stop_profiles: stopProfiles && profiles.length > 0,
      confirm: "liberar memoria",
    },
      (result) => t("Memoria liberada · {value} libres", { value: bytes(result.memory.free ?? 0) }));
  }
  function toggleService(service: OptionalService) {
    const action = service.active ? "stop" : "start";
    if (action === "stop" && !window.confirm(t("¿Detener {name}? {impact}", { name: service.name, impact: service.impact }))) return;
    void run(service.id, `/api/memory-mode/services/${encodeURIComponent(service.id)}`, { action, confirm: `${action} ${service.id}` },
      () => (action === "stop" ? t("{name} detenido", { name: service.name }) : t("{name} arrancado", { name: service.name })));
  }
  if (!status) return null;
  const stoppedNames = [
    ...status.stopped_profiles.map((profile) => t("perfil {name}", { name: profile.name })),
    ...status.services.filter((service) => service.stopped_by_memory_mode).map((service) => service.name),
  ];
  return <Card className="memory-mode-card">
    <div className="memory-mode-head">
      <div className="model-icon"><Zap /></div>
      <span>
        <strong>{t("Memoria máxima para operaciones intensivas")}</strong>
        <small>{t("Detén lo opcional para cargar un modelo grande (≈100 GB). La memoria libre real ahora:")}{" "}<b>{bytes(status.memory.free ?? 0)}</b> {t("de")} {bytes(status.memory.total ?? 0)}.</small>
      </span>
      {stoppedNames.length > 0 && <span className="badge running">{t("Modo memoria activo")}</span>}
    </div>
    <div className="memory-mode-list">
      <div className={`memory-mode-row ${profiles.length ? "" : "is-stopped"}`}>
        <label>
          <input type="checkbox" disabled={!profiles.length || busy !== null} checked={profiles.length > 0 && stopProfiles} onChange={() => setStopProfiles((value) => !value)} />
          <span>
            <strong>{t("Perfiles llama.cpp")}</strong>
            <small>{profiles.length
              ? `${profiles.map((profile) => `${profile.name} (${profile.models.join(", ")})`).join(" · ")}. ${t("Incluye el modelo del chat del dashboard si usa un perfil. «Restaurar» los vuelve a levantar.")}`
              : status.stopped_profiles.length ? t("Detenidos por modo memoria: {join}.", { join: status.stopped_profiles.map((profile) => profile.name).join(", ") }) : t("Ningún perfil cargado.")}</small>
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
        <span className="memory-mode-bytes">{service.active ? (service.bytes ? bytes(service.bytes) : "—") : service.stopped_by_memory_mode ? t("Detenido por modo memoria") : t("Detenido")}</span>
        <button className={service.active ? "danger" : "primary-action"} disabled={busy !== null} onClick={() => toggleService(service)}>
          {service.active ? <Square size={13} /> : <Play size={14} />}{busy === service.id ? t("Procesando…") : service.active ? t("Detener") : t("Arrancar")}
        </button>
      </div>)}
      <div className="memory-mode-row">
        <label><input type="checkbox" checked disabled /><span><strong>{t("Modelos en Ollama")}</strong><small>{status.ollama_models.length ? t("Modelo del chat del dashboard y otros: {join}. Se recargan solos al volver a usarlos.", { join: status.ollama_models.join(", ") }) : t("Ninguno cargado.")}</small></span></label>
        <span className="memory-mode-bytes">{status.ollama_bytes ? bytes(status.ollama_bytes) : "—"}</span>
        <span />
      </div>
    </div>
    <small className="memory-mode-note"><Info size={12} />{" "}{t("Después levanta el modelo grande desde Perfiles: si no cabe en la memoria libre, MyDGX vacía la caché de disco antes de cargarlo. Para restaurar los perfiles anteriores, detén antes el modelo grande.")}</small>
    <div className="memory-mode-actions">
      <button className="danger" disabled={busy !== null} onClick={releaseAll}><Zap size={14} />{busy === "release" ? t("Liberando…") : t("Liberar seleccionados (~{chosenBytes} + caché)", { chosenBytes: bytes(chosenBytes) })}</button>
      {stoppedNames.length > 0 && <button className="primary-action" disabled={busy !== null} onClick={() => {
        if (window.confirm(t("¿Volver a arrancar {join}?", { join: stoppedNames.join(", ") }))) void run("restore", "/api/memory-mode/restore", { confirm: "restaurar servicios" }, () => t("Servicios restaurados"));
      }}><RefreshCw size={14} />{busy === "restore" ? t("Restaurando…") : t("Restaurar ({join})", { join: stoppedNames.join(", ") })}</button>}
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
    if (operation === "stop" && !window.confirm(t("¿Detener {name}? Los modelos que dependen de este motor dejarán de estar disponibles.", { name: engine.name }))) return;
    setBusy(engine.id);
    try {
      await api(`/api/engines/${encodeURIComponent(engine.id)}/action`, {
        method: "POST",
        body: JSON.stringify({ action: operation, confirm: `${operation} ${engine.id}` }),
      });
      notify(operation === "start" ? t("{name} arrancado", { name: engine.name }) : t("{name} detenido", { name: engine.name }));
      await load();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(null);
    }
  }
  return <div className="view-stack">
    <SectionHeading eyebrow={t("RUNTIMES DE INFERENCIA")} title={t("Motores")} action={<button className="icon-button" onClick={load}><RefreshCw className={loading ? "spin" : ""} size={16} /></button>} />
    <MemoryModePanel notify={notify} onChange={() => void load()} />
    <div className="engine-grid">
      {engines.map((engine) => <Card className="engine-card" key={engine.id}>
        <div className="engine-head"><div className="model-icon"><Cpu /></div><span><strong>{engine.name}</strong><small>{engine.version || t("Versión no detectada")}</small></span><span className={`badge ${engine.reachable ? "live" : engine.installed ? "running" : ""}`}>{engine.reachable ? t("Disponible") : engine.installed ? t("Instalado") : t("No instalado")}</span></div>
        <div className="engine-capabilities">{engine.capabilities.map((capability) => <span className="badge" key={capability}>{capability}</span>)}</div>
        <small>{engine.endpoint || engine.binary || t("Sin endpoint configurado")} · {engine.managed ? t("Gestionado por MyDGX") : t("Solo descubrimiento")}</small>
        {engine.essential && <small className="engine-protection"><ShieldCheck size={12} />{" "}{t("Protegido: necesario para MyDGX, el gateway, perfiles o chatbot.")}</small>}
        {engine.controllable && <div className="engine-actions">
          <small>{engine.running
            ? t("Opcional · al detenerlo queda desactivado también tras reiniciar el DGX, hasta que lo vuelvas a arrancar aquí.")
            : t("Desactivado · «Arrancar motor» lo levanta y lo vuelve a activar en el arranque del DGX.")}</small>
          <button
            className={engine.running ? "danger" : "primary-action"}
            disabled={busy === engine.id || (!engine.running && !engine.installed)}
            onClick={() => void action(engine, engine.running ? "stop" : "start")}
          >
            {engine.running ? <Square size={13} /> : <Play size={14} />}
            {busy === engine.id ? t("Procesando…") : engine.running ? t("Detener motor") : t("Arrancar motor")}
          </button>
        </div>}
        {engine.models.length > 0 && <div className="engine-models">{engine.models.slice(0, 8).map((model) => <span key={model}>{model}</span>)}</div>}
      </Card>)}
    </div>
    <ProfileAppsPanel notify={notify} />
  </div>;
}

type ProfileAppsOverview = {
  root: string;
  available: string[];
  states: Record<string, ProfileAppState>;
  web: Record<string, { alias: string; port: number; url: string }>;
};

function ProfileAppsPanel({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const [apps, setApps] = useState<ProfileAppsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setApps(await api<ProfileAppsOverview>("/api/profile-apps"));
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
  async function action(name: string, operation: "start" | "stop" | "restart") {
    if (operation === "stop" && !window.confirm(t("¿Detener {name}? Se ejecutará su start.sh stop y dejará de estar disponible hasta que lo arranques.", { name }))) return;
    setBusy(name);
    try {
      const result = await api<ProfileAppState & { exit_code: number }>(`/api/profile-apps/${encodeURIComponent(name)}/${operation}`, { method: "POST" });
      notify(`${name}: ${profileAppStateLabels[result.state]}`, result.state === "error");
      await load();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(null);
    }
  }
  return <>
    <SectionHeading eyebrow={t("APLICACIONES CON START.SH")} title={t("Apps de perfil")} action={<button className="icon-button" onClick={load} title={t("Comprobar estado")}><RefreshCw className={loading ? "spin" : ""} size={16} /></button>} />
    {apps && apps.available.length === 0 && <Card className="engine-card"><small>{t("No hay apps en {root}: cada app es una carpeta con un start.sh que acepte start, stop, restart y status.", { root: apps.root })}</small></Card>}
    <div className="engine-grid">
      {(apps?.available ?? []).map((name) => {
        const state = apps?.states[name];
        const web = apps?.web[name];
        const running = state?.state === "running";
        const stopped = state?.state === "stopped";
        const pending = busy === name || state?.state === "starting" || state?.state === "stopping";
        return <Card className="engine-card" key={name}>
          <div className="engine-head">
            <div className="model-icon"><Boxes /></div>
            <span><strong>{web?.alias || name}</strong><small>{apps?.root}/{name}/start.sh</small></span>
            <span className={`badge ${running ? "live" : state?.state === "error" ? "warning" : ""}`}>{state ? profileAppStateLabels[state.state] : t("Sin comprobar")}</span>
          </div>
          {state?.message && <small>{state.message}</small>}
          {(state?.profiles.length ?? 0) > 0 && <small>{t("Usada por el perfil: {value}", { value: state?.profiles.join(", ") })}</small>}
          {web && <small>{running ? <a href={web.url} target="_blank" rel="noreferrer">{web.url} <ExternalLink size={11} /></a> : web.url}</small>}
          <div className="engine-actions app-actions">
            <button className="primary-action" disabled={pending || running} onClick={() => void action(name, "start")}><Play size={14} />{" "}{t("Arrancar")}</button>
            <button className="secondary" disabled={pending || stopped} onClick={() => void action(name, "restart")}><RotateCw size={13} />{" "}{t("Reiniciar")}</button>
            <button className="danger" disabled={pending || stopped} onClick={() => void action(name, "stop")}><Square size={13} />{" "}{busy === name ? t("Procesando…") : t("Detener")}</button>
          </div>
        </Card>;
      })}
    </div>
  </>;
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
    reader.onerror = () => reject(new Error(t("No se pudo leer el archivo")));
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
      notify(t("Selecciona un archivo compatible"), true);
      return;
    }
    if (file && file.size > selected.max_input_mb * 1024 * 1024) {
      notify(t("El archivo supera {max_input_mb} MiB", { max_input_mb: selected.max_input_mb }), true);
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
        notify(t("Generación de vídeo enviada a trabajos"));
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
        notify(t("El trabajo ya no aparece en la actividad reciente"), true);
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
    ? JSON.stringify(result.result, (key, value) => key === "b64_json" ? t("[contenido base64 omitido]") : value, 2)
    : "";

  return <div className="view-stack">
    <SectionHeading eyebrow={t("IMAGEN · AUDIO · VÍDEO · EMBEDDINGS")} title={t("Laboratorio multimodal")} action={<button className="icon-button" onClick={load}><RefreshCw size={16} /></button>} />
    <Card className="multimodal-intro">
      <Sparkles />
      <div><strong>{t("Prueba el perfil activo y los motores administrados")}</strong><small>{t("ComfyUI genera imagen y vídeo localmente; las entradas no se guardan en SQLite.")}</small></div>
    </Card>
    {!models.length ? <Empty icon={<Boxes />} title={t("Sin modelos multimodales")} text={t("Activa un perfil que declare una tarea y arranca sus endpoints.")} /> :
      <div className="multimodal-layout">
        <Card className="multimodal-form-card">
          <form onSubmit={run}>
            <label>{t("Servicio")}<select value={modelAlias} onChange={(event) => { setModelAlias(event.target.value); setFile(null); setResult(null); }}>{models.map((model) => <option value={model.alias} key={model.alias}>{model.name} · {model.task} · {model.engine}</option>)}</select></label>
            <div className="multimodal-capabilities">
              <span className="badge">{selected?.task}</span>
              <small>{selected?.input_modalities.join(" + ")} → {selected?.output_modalities.join(" + ")}</small>
              <small>{selected?.endpoint}</small>
            </div>
            {selected?.task !== "asr" && <label>{t("Instrucción")}<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={selected?.task === "image-generation" ? t("Describe la imagen que quieres generar") : selected?.task === "tts" ? t("Texto que se convertirá en voz") : t("Introduce la petición")} required={selected?.task !== "reranking"} /></label>}
            {selected?.task === "reranking" && <label>{t("Documentos")}{" "}<small>{t("(uno por línea)")}</small><textarea value={documents} onChange={(event) => setDocuments(event.target.value)} placeholder={t("Primer documento\nSegundo documento")} required /></label>}
            {needsFile && <label className="multimodal-upload">{t("Archivo")}<input type="file" accept={accept} onChange={(event) => setFile(event.target.files?.[0] || null)} required /><span>{file ? `${file.name} · ${bytes(file.size)}` : t("Máximo {max_input_mb} MiB", { max_input_mb: selected.max_input_mb })}</span></label>}
            <button className="button primary" type="submit" disabled={busy}>{busy ? t("Procesando…") : selected?.task === "video-generation" ? t("Crear trabajo") : t("Ejecutar")}</button>
          </form>
        </Card>
        <Card className="multimodal-result">
          <SectionHeading eyebrow={t("RESULTADO LOCAL")} title={selected?.name || t("Salida")} />
          {!result && <Empty icon={<Sparkles />} title={t("Esperando una ejecución")} text={t("El resultado aparecerá aquí sin registrar el contenido de tu petición.")} />}
          {result?.job_id && <div className="multimodal-job"><strong>{t("Trabajo creado")}</strong><code>{result.job_id}</code><small>{t("El vídeo se procesa de forma asíncrona.")}</small><button className="button secondary" onClick={() => void checkVideoJob(result.job_id!)}>{t("Consultar resultado")}</button></div>}
          {imageBase64 && <img src={`data:image/png;base64,${imageBase64}`} alt={t("Resultado generado")} />}
          {imageUrl && <a className="button secondary" href={imageUrl} target="_blank" rel="noreferrer">{t("Abrir")}{" "}{selected?.task === "video-generation" ? t("vídeo") : t("imagen")}{" "}{t("generada")} <ExternalLink size={14} /></a>}
          {binaryUrl && result?.content_type.startsWith("audio/") && <audio src={binaryUrl} controls />}
          {binaryUrl && result?.content_type.startsWith("image/") && <img src={binaryUrl} alt={t("Resultado generado")} />}
          {artifactObjectUrl && result?.content_type.startsWith("video/") && <video src={artifactObjectUrl} controls />}
          {compactResult && <pre>{compactResult}</pre>}
        </Card>
      </div>}
  </div>;
}

function ChatView({ models, config, notify, onClose }: { models: Models | null; config: Config | null; notify: (message: string, error?: boolean) => void; onClose?: () => void }) {
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
    truncated?: boolean;
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
      label: t("Asistente MyDGX · {value}", { value: config.assistant_model || t("automático") }),
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
          if (!copied) throw new Error(t("Portapapeles no disponible"));
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
        if (!copied) throw new Error(t("Portapapeles no disponible"));
      }
      notify(t("Mensaje copiado"));
    } catch {
      notify(t("No se pudo copiar el mensaje"), true);
    }
  }

  function clearChat() {
    if (!window.confirm(t("¿Borrar todo el historial de este chat en este navegador?"))) return;
    setMessages([]);
    try {
      localStorage.removeItem(historyStorageKey);
    } catch {
      // El estado en memoria ya se ha eliminado.
    }
    notify(t("Historial del chat eliminado"));
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
        truncated?: boolean;
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
        content: response.message.content || t("Sin respuesta"),
        model: response.model,
        tools: response.tools_used,
        actions: response.pending_actions,
        truncated: response.truncated,
      }]);
    } catch (error) {
      const detail = (error as Error).message;
      setMessages((items) => [...items, {
        role: "assistant",
        content: t("No pude completar la consulta. {detail}", { detail: detail }),
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
      notify(confirm ? t("Acción del asistente ejecutada") : t("Acción rechazada"));
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
        <div><span className="eyebrow">{t("ASISTENTE LOCAL")}</span><h2>{t("MyDGX Copilot")}</h2></div>
        <div className="chat-header-actions">
          {messages.length > 0 && <button className="chat-clear" type="button" onClick={clearChat} aria-label={t("Borrar chat completo")} title={t("Borrar chat completo")}><Trash2 size={15} /></button>}
          <select value={activeModel} onChange={(event) => setModel(event.target.value)}>
            {available.length ? available.map((item) => <option key={item.value} value={item.value}>{item.label}</option>) : <option value="">{t("Sin modelos")}</option>}
          </select>
          {onClose && <button className="chat-close" type="button" onClick={onClose} aria-label={t("Cerrar asistente")} title={t("Cerrar asistente")}><X size={16} /></button>}
        </div>
      </div>
      <div className="messages">
        {messages.length === 0 && (
          <div className="chat-welcome"><Sparkles /><h3>{t("Pregunta o administra tu MyDGX")}</h3><p>{t("Puede consultar telemetría, sistema, modelos, perfiles y documentación. Las acciones siempre requieren confirmación.")}</p>
            {assistantUnavailable && <div className="assistant-unavailable"><TriangleAlert size={14} /><span>{assistantStatus?.remediation || t("No hay un modelo local disponible")}</span></div>}
            {assistantStatus?.ready && <small>{assistantStatus.documentation_chunks}{" "}{t("fragmentos ·")}{" "}{assistantStatus.read_tools?.length ?? 0}{" "}{t("consultas ·")}{" "}{assistantStatus.action_tools?.length ?? 0}{" "}{t("acciones confirmadas")}</small>}
            {!assistantUnavailable && <div className="assistant-suggestions">
              {[
                t("Recomiéndame tres modelos de código que quepan en este equipo"),
                t("Resume el estado del sistema y sus avisos"),
                t("¿Qué perfiles y modelos tengo cargados ahora?"),
                t("Busca en la documentación cómo funciona el gateway"),
              ].map((suggestion) => <button type="button" key={suggestion} onClick={() => setMessage(suggestion)}>{suggestion}</button>)}
            </div>}
          </div>
        )}
        {messages.map((item, index) => (
          <div className={`message ${item.role}`} key={`${item.role}-${index}`}>
            <span>{item.role === "user" ? t("Tú") : item.model || "MyDGX Copilot"}</span>
            {item.role === "assistant"
              ? <MarkdownMessage content={item.content} />
              : <p>{item.content}</p>}
            <div className="message-controls">
              <button className="message-copy" type="button" onClick={() => void copyMessage(item.content)} aria-label={t("Copiar mensaje")} title={t("Copiar mensaje")}><Copy size={13} /></button>
            </div>
            {item.truncated && <div className="assistant-truncated"><TriangleAlert size={13} />{t("Respuesta cortada al llegar al límite de longitud. El modelo puede haber entrado en bucle; prueba con otro modelo o reformula la pregunta.")}</div>}
            {item.tools && item.tools.length > 0 && <div className="assistant-tools">
              {item.tools.map((tool, toolIndex) => <small key={`${tool.name}-${toolIndex}`} className={tool.status}>{tool.name}</small>)}
            </div>}
            {item.actions?.map((action) => <div className={`assistant-action ${action.status || "pending"}`} key={action.id}>
              <div><ShieldCheck size={15} /><span><strong>{t("Confirmación requerida")}</strong><small>{action.label}</small></span></div>
              {!action.status && <div>
                <button className="button secondary" type="button" onClick={() => resolveAction(action.id, false)}><X size={14} />{" "}{t("Rechazar")}</button>
                <button className="button primary" type="button" onClick={() => resolveAction(action.id, true)}><CheckCircle2 size={14} />{" "}{t("Confirmar")}</button>
              </div>}
              {action.status && <em>{action.status === "running" ? t("Ejecutando…") : action.status === "confirmed" ? t("Ejecutada") : action.status === "rejected" ? t("Rechazada") : t("No se pudo ejecutar")}</em>}
            </div>)}
          </div>
        ))}
        {sending && <div className="message assistant"><span>{activeLabel}</span><p className="typing">{t("Pensando")}<span>.</span><span>.</span><span>.</span></p></div>}
      </div>
      <form className="composer" onSubmit={send}>
        <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={assistantUnavailable ? t("Instala o carga un modelo para activar el asistente") : activeModel ? t("Pregunta a {activeLabel}", { activeLabel: activeLabel }) : t("Descarga un modelo para comenzar")} disabled={!activeModel || assistantUnavailable} />
        <button className="button primary" type="submit" disabled={!activeModel || assistantUnavailable || sending}>{t("Enviar")}{" "}<ChevronRight size={16} /></button>
      </form>
      <a className="openwebui-link" href={config?.openwebui_url} target="_blank" rel="noreferrer">{t("Abrir experiencia avanzada en Open WebUI")}{" "}<ExternalLink size={14} /></a>
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
    disk_total: number;
    disk_free: number;
    model_storage: Array<Record<string, unknown>>;
    home_directories: Array<{ name: string; path: string; size: number }>;
    nvme_devices: NvmeDevice[];
    usage_pending: boolean;
    usage_updated_at: string | null;
  } | null>(null);
  const load = useCallback((refresh = false) => {
    api<NonNullable<typeof storage>>(`/api/storage${refresh ? "?refresh=true" : ""}`)
      .then(setStorage)
      .catch((error: Error) => notify(error.message, true));
  }, [notify]);
  useEffect(() => { load(); }, [load]);
  const pending = storage?.usage_pending ?? false;
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => load(), 2000);
    return () => window.clearTimeout(timer);
  }, [pending, storage, load]);
  if (!storage) return <Loading label={t("Leyendo discos")} />;
  const hasUsage = storage.usage_categories.length > 0;
  return (
    <div className="view-stack">
      <SectionHeading eyebrow="NVME" title={t("Unidades y salud SMART")} />
      <div className="storage-grid nvme-grid">
        {storage.nvme_devices.map((device) => {
          const smart = device.smart;
          const healthy = smart.available && (smart.critical_warning ?? 0) === 0;
          const busyTime = smart.controller_busy_time == null
            ? "—"
            : t("{hours} h {minutes} min", { hours: Math.floor(smart.controller_busy_time / 60), minutes: smart.controller_busy_time % 60 });
          return (
            <Card className="storage-card nvme-card" key={device.name}>
              <div className="card-kicker">
                <HardDrive size={16} />
                {device.model || device.name}
                <StatusDot online={device.state === "live"} />
              </div>
              <strong>{bytes(device.capacity)} <small>{device.name}{" "}{t("· FW")}{" "}{device.firmware || "—"}</small></strong>
              <div className="nvme-summary">
                <span><Thermometer size={14} /><strong>{device.temperature == null ? "—" : `${device.temperature} °C`}</strong><small>{t("Temperatura")}</small></span>
                <span><Activity size={14} /><strong>{smart.percentage_used == null ? "—" : `${smart.percentage_used}%`}</strong><small>{t("Vida utilizada")}</small></span>
                <span><ShieldCheck size={14} /><strong>{smart.available ? (healthy ? t("Correcto") : t("Atención")) : t("Sin acceso")}</strong><small>{smart.source ?? "SMART"}</small></span>
              </div>
              {smart.available ? (
                <div className="nvme-details">
                  <span>{t("Reserva")}{" "}<strong>{smart.available_spare == null ? "—" : `${smart.available_spare}%`}</strong></span>
                  <span>{t("Horas encendido")}{" "}<strong>{smart.power_on_hours == null ? "—" : `${smart.power_on_hours.toLocaleString(locale)} h`}</strong></span>
                  <span>{t("Uso activo")}{" "}<strong>{busyTime}</strong></span>
                  <span>{t("Ciclos encendido")}{" "}<strong>{smart.power_cycles?.toLocaleString(locale) ?? "—"}</strong></span>
                  <span>{t("Errores de medio")}{" "}<strong>{smart.media_errors ?? "—"}</strong></span>
                  <span>{t("Entradas de error")}{" "}<strong>{smart.num_err_log_entries?.toLocaleString(locale) ?? "—"}</strong></span>
                  <span>{t("Apagados inseguros")}{" "}<strong>{smart.unsafe_shutdowns ?? "—"}</strong></span>
                  <span>{t("Leído")}{" "}<strong>{smart.data_units_read == null ? "—" : bytes(smart.data_units_read * 512000)}</strong></span>
                  <span>{t("Escrito")}{" "}<strong>{smart.data_units_written == null ? "—" : bytes(smart.data_units_written * 512000)}</strong></span>
                </div>
              ) : (
                <small className="nvme-note">{t("La unidad se detecta por sysfs; SMART requiere acceso al dispositivo NVMe.")}</small>
              )}
            </Card>
          );
        })}
        {storage.nvme_devices.length === 0 && <Card className="empty-state"><HardDrive /><strong>{t("No se detectaron controladores NVMe")}</strong></Card>}
      </div>
      <StorageMap storage={storage} onRefresh={() => load(true)} />
      <SectionHeading eyebrow={t("USO REAL")} title={t("Distribución del almacenamiento")} />
      <Card className="storage-breakdown">
        <div className="storage-breakdown-total">
          <span><Database size={17} /><strong>{t("Espacio ocupado clasificado")}</strong></span>
          <strong>{hasUsage ? bytes(storage.categorized_total) : "—"}</strong>
        </div>
        {!hasUsage && <small className="storage-pending"><RefreshCw className="spin" size={13} />{" "}{t("Midiendo carpetas; puede tardar si el disco no se ha leído hace poco.")}</small>}
        {storage.usage_categories.map((category) => {
          const percent = storage.categorized_total > 0
            ? Math.min(100, category.size / storage.categorized_total * 100)
            : 0;
          return <div className="storage-breakdown-row" data-category={category.id} key={category.id}>
            <div><span><strong>{category.label}</strong><small>{category.description}</small></span><strong>{bytes(category.size)}</strong></div>
            <div className="storage-category-bar"><span style={{ width: `${percent}%` }} /></div>
            <small>{percent.toFixed(1)}{t("% del espacio ocupado")}</small>
          </div>;
        })}
      </Card>
      <SectionHeading eyebrow={t("CAPACIDAD")} title={t("Almacenamiento")} />
      <div className="storage-grid">
        {storage.partitions.map((partition) => {
          const percent = Number(partition.percent);
          const kind = String(partition.kind);
          const mountpoint = String(partition.mountpoint);
          return (
            <Card className="storage-card" key={mountpoint}>
              <div className="card-kicker">
                <HardDrive size={16} />
                {mountpoint === "/" ? t("Disco del sistema") : mountpoint}
                <span className={`storage-kind ${kind}`}>{kind === "virtual" ? t("Virtual") : kind === "physical" ? t("Físico") : t("Sistema")}</span>
              </div>
              <strong>{bytes(Number(partition.used))} <small>{t("de")} {bytes(Number(partition.total))}</small></strong>
              <div className="storage-bar"><span style={{ width: `${percent}%` }} /></div>
              <small>{percent}{t("% utilizado ·")}{" "}{String(partition.filesystem)} · {String(partition.device)}</small>
            </Card>
          );
        })}
      </div>
      <SectionHeading eyebrow={t("DISTRIBUCIÓN")} title={t("Datos de modelos")} />
      <Card className="storage-list">
        {storage.model_storage.map((item) => (
          <div key={String(item.path)}><div><Database size={17} /><span><strong>{String(item.name)}</strong><small>{String(item.path)}</small></span></div><strong>{bytes(Number(item.size))}</strong></div>
        ))}
      </Card>
      <SectionHeading eyebrow={t("APPS DE USUARIO")} title={t("Directorios del home")} />
      <Card className="storage-list">
        {!hasUsage && <small className="storage-pending"><RefreshCw className="spin" size={13} />{" "}{t("Midiendo el home.")}</small>}
        {(storage.home_directories ?? []).map((item) => (
          <div key={item.path}><div><Folder size={17} /><span><strong>{item.name}</strong><small>{item.path}</small></span></div><strong>{bytes(item.size)}</strong></div>
        ))}
        {hasUsage && (storage.home_directories ?? []).length > 0 && (
          <small className="storage-home-note">{t("Cada directorio excluye lo que ya cuentan Modelos, Apps y MyDGX; juntos suman «Usuario y otros».")}</small>
        )}
      </Card>
    </div>
  );
}

const STORAGE_SEGMENT_STYLE: Record<string, { kind: string; colorIndex?: number }> = {
  system: { kind: "system" },
  models: { kind: "model", colorIndex: 0 },
  apps: { kind: "model", colorIndex: 1 },
  mydgx: { kind: "model", colorIndex: 2 },
  home: { kind: "model", colorIndex: 4 },
};

function StorageMap({ storage, onRefresh }: {
  storage: {
    usage_categories: Array<{ id: string; label: string; size: number; description: string }>;
    categorized_total: number;
    disk_total: number;
    disk_free: number;
    usage_pending: boolean;
    usage_updated_at: string | null;
  };
  onRefresh: () => void;
}) {
  const total = storage.disk_total;
  const grouped = storage.usage_categories.reduce((sum, category) => sum + category.size, 0);
  const reserved = Math.max(0, total - grouped - storage.disk_free);
  const segments: MapSegment[] = [
    ...storage.usage_categories
      .filter((category) => category.size > 0)
      .map((category) => ({
        name: category.label,
        bytes: category.size,
        description: category.description,
        ...(STORAGE_SEGMENT_STYLE[category.id] ?? { kind: "system" }),
      })),
    ...(reserved > 0 ? [{ name: t("Reservado"), bytes: reserved, kind: "cache", description: t("Bloques que ext4 reserva para root; no están ocupados pero tampoco disponibles para el usuario.") }] : []),
    { name: t("Libre"), bytes: storage.disk_free, kind: "available", description: t("Espacio libre en el disco del sistema.") },
  ];
  const updated = storage.usage_updated_at
    ? new Date(storage.usage_updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  const badge = (
    <span className="storage-map-status">
      {storage.usage_pending
        ? <><RefreshCw className="spin" size={12} /> {updated ? t("Actualizando") : t("Calculando")}</>
        : updated && <>{t("Medido a las")}{" "}{updated}</>}
      <button className="icon-button" onClick={onRefresh} disabled={storage.usage_pending} title={t("Volver a medir las carpetas")} aria-label={t("Volver a medir el almacenamiento")}>
        <RefreshCw size={13} />
      </button>
    </span>
  );
  if (!storage.usage_categories.length || !total) {
    return (
      <div className="memory-map storage-map">
        <div className="memory-map-heading">
          <div><strong>{t("Mapa de almacenamiento")}</strong>{badge}</div>
          <small>{t("Midiendo sistema, modelos, apps y MyDGX…")}</small>
        </div>
        <div className="memory-map-bar storage-map-placeholder" aria-busy="true" />
      </div>
    );
  }
  return (
    <SegmentedMap
      className="storage-map"
      title={t("Mapa de almacenamiento")}
      badge={badge}
      summary={t("{used} usados · {free} libres · {total} total", { used: bytes(storage.categorized_total), free: bytes(storage.disk_free), total: bytes(total) })}
      ariaLabel={t("Disco del sistema: {categorized_total} usados y {disk_free} libres", { categorized_total: bytes(storage.categorized_total), disk_free: bytes(storage.disk_free) })}
      total={total}
      segments={segments}
    />
  );
}

type BenchmarkCategoryId = "all" | "text" | "voice" | "image" | "vision" | "retrieval";

const BENCHMARK_CATEGORIES: Array<{ id: BenchmarkCategoryId; label: string; icon: typeof Gauge; color: string; modalities: string[] }> = [
  { id: "all", label: t("Todos"), icon: Gauge, color: "var(--accent)", modalities: [] },
  { id: "text", label: t("Texto"), icon: MessageSquare, color: "#68b929", modalities: ["text-generation"] },
  { id: "voice", label: t("Voz"), icon: Mic, color: "#3e8fdc", modalities: ["automatic-speech-recognition", "text-to-speech"] },
  { id: "image", label: t("Imagen y vídeo"), icon: ImageIcon, color: "#c05bd6", modalities: ["image-generation", "video-generation"] },
  { id: "vision", label: t("Visión"), icon: Eye, color: "#e09a2b", modalities: ["vision"] },
  { id: "retrieval", label: t("Embeddings y rerank"), icon: Layers, color: "#2fb3a3", modalities: ["embeddings", "reranking"] },
];

const MODALITY_LABELS: Record<string, string> = {
  "text-generation": t("Generación de texto"),
  "automatic-speech-recognition": t("Reconocimiento de voz"),
  "text-to-speech": t("Síntesis de voz"),
  "image-generation": t("Generación de imagen"),
  "video-generation": t("Generación de vídeo"),
  vision: t("Visión"),
  embeddings: t("Embeddings"),
  reranking: t("Reranking"),
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
    { key: "tps", label: t("Salida"), hint: t("Tokens generados por segundo · media"), better: "higher", value: (s) => finite(s.output_tokens_per_second?.mean), format: (v) => `${v.toFixed(1)} tok/s` },
    { key: "ttft", label: t("Primer token"), hint: t("TTFT p50 · menor es mejor"), better: "lower", value: (s) => finite(s.ttft_ms?.p50), format: fmtMs },
    { key: "stability", label: t("Estabilidad"), hint: t("Variación entre repeticiones"), better: "higher", value: (s) => finite(s.score_dimensions?.stability), format: (v) => `${v.toFixed(0)}/100` },
    { key: "memory", label: t("Memoria pico"), hint: t("Memoria unificada máxima durante el run"), better: "lower", value: (s) => finite(s.resources?.max_memory_bytes), format: (v) => bytes(v) },
  ],
  "automatic-speech-recognition": [
    { key: "rtf", label: t("Tiempo real"), hint: t("RTF: proceso / duración del audio · menor es mejor"), better: "lower", value: (s) => finite(s.real_time_factor?.mean), format: (v) => `${v.toFixed(3)} RTF` },
    { key: "wer", label: t("Error palabras"), hint: t("WER frente al fixture · menor es mejor"), better: "lower", value: (s) => pct(s.word_error_rate, 100), format: fmtPct },
    { key: "cer", label: t("Error caracteres"), hint: t("CER · menor es mejor"), better: "lower", value: (s) => pct(s.character_error_rate, 100), format: fmtPct },
    { key: "latency", label: t("Latencia p50"), hint: t("Tiempo total por audio"), better: "lower", value: (s) => finite(s.total_ms?.p50), format: fmtMs },
  ],
  "text-to-speech": [
    { key: "rtf", label: t("Tiempo real"), hint: t("RTF: síntesis / duración del audio · menor es mejor"), better: "lower", value: (s) => finite(s.real_time_factor?.mean), format: (v) => `${v.toFixed(3)} RTF` },
    { key: "intelligibility", label: t("Inteligibilidad"), hint: t("Round-trip con Whisper local"), better: "higher", value: (s) => (s.intelligibility?.available ? pct(1 - Number(s.intelligibility.word_error_rate ?? 1), 100) : null), format: fmtPct },
    { key: "integrity", label: t("Audio íntegro"), hint: t("WAV válido y decodificable"), better: "higher", value: (s) => finite(s.audio_validation?.integrity_percent), format: fmtPct },
    { key: "latency", label: t("Latencia p50"), hint: t("Tiempo total por frase"), better: "lower", value: (s) => finite(s.total_ms?.p50), format: fmtMs },
  ],
  "image-generation": [
    { key: "seconds", label: t("Generación"), hint: t("Tiempo total p50 · menor es mejor"), better: "lower", value: (s) => finite(s.total_ms?.p50 ?? s.total_ms?.mean), format: fmtMs },
    { key: "repro", label: t("Reproducible"), hint: t("Coincidencia de píxeles con semilla fija"), better: "higher", value: (s) => finite(s.image_validation?.pixel_reproducibility_percent), format: fmtPct },
    { key: "png", label: t("PNG íntegro"), hint: t("Imágenes válidas"), better: "higher", value: (s) => finite(s.image_validation?.png_integrity_percent), format: fmtPct },
    { key: "resolution", label: t("Resolución"), hint: t("Resolución esperada"), better: "higher", value: (s) => finite(s.image_validation?.expected_resolution_percent), format: fmtPct },
  ],
  "video-generation": [
    { key: "seconds", label: t("Generación"), hint: t("Tiempo total p50 · menor es mejor"), better: "lower", value: (s) => finite(s.total_ms?.p50 ?? s.total_ms?.mean), format: fmtMs },
    { key: "repro", label: t("Reproducible"), hint: t("Firma perceptual o exacta con semilla fija"), better: "higher", value: (s) => finite(s.video_validation?.perceptual_reproducibility_percent ?? s.video_validation?.exact_reproducibility_percent), format: fmtPct },
    { key: "container", label: t("Contenedor"), hint: t("Vídeo decodificable"), better: "higher", value: (s) => finite(s.video_validation?.container_integrity_percent), format: fmtPct },
    { key: "size", label: t("Tamaño medio"), hint: t("Tamaño del vídeo generado"), better: "lower", value: (s) => finite(s.output_size_bytes?.mean), format: (v) => bytes(v) },
  ],
  vision: [
    { key: "latency", label: t("Latencia p50"), hint: t("Tiempo total · menor es mejor"), better: "lower", value: (s) => finite(s.total_ms?.p50), format: fmtMs },
    { key: "recall", label: t("Conceptos"), hint: t("Recall de conceptos visuales esperados"), better: "higher", value: (s) => pct(s.vision_quality?.normalized_concept_recall, 100), format: fmtPct },
    { key: "reliability", label: t("Fiabilidad"), hint: t("Muestras válidas"), better: "higher", value: (s) => finite(s.reliability_percent), format: fmtPct },
    { key: "tps", label: t("Salida"), hint: t("Tokens por segundo"), better: "higher", value: (s) => finite(s.output_tokens_per_second?.mean), format: (v) => `${v.toFixed(1)} tok/s` },
  ],
  embeddings: [
    { key: "items", label: t("Throughput"), hint: t("Elementos vectorizados por segundo"), better: "higher", value: (s) => finite(s.items_per_second?.mean), format: (v) => `${v.toFixed(1)}/s` },
    { key: "pairs", label: t("Calidad"), hint: t("Pares positivos separados de negativos"), better: "higher", value: (s) => pct(s.semantic_quality?.pair_accuracy, 100), format: fmtPct },
    { key: "margin", label: t("Margen"), hint: t("Margen semántico medio"), better: "higher", value: (s) => finite(s.semantic_quality?.mean_margin), format: (v) => v.toFixed(3) },
    { key: "latency", label: t("Latencia p50"), hint: t("Tiempo total"), better: "lower", value: (s) => finite(s.total_ms?.p50), format: fmtMs },
  ],
  reranking: [
    { key: "ndcg", label: "NDCG", hint: t("Calidad de ordenación"), better: "higher", value: (s) => pct(s.ranking_quality?.ndcg_mean, 100), format: fmtPct },
    { key: "latency", label: t("Latencia p50"), hint: t("Tiempo total · menor es mejor"), better: "lower", value: (s) => finite(s.total_ms?.p50), format: fmtMs },
    { key: "mrr", label: "MRR", hint: t("Primer resultado relevante"), better: "higher", value: (s) => pct(s.ranking_quality?.mrr_mean, 100), format: fmtPct },
    { key: "reliability", label: t("Fiabilidad"), hint: t("Muestras válidas"), better: "higher", value: (s) => finite(s.reliability_percent), format: fmtPct },
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
  let name = (run.model_info?.name || run.source_id.split("/").pop() || run.source_id).replace(/^ARTIFEX · /, "");
  name = name.split("/").pop() || name;
  // Requantizers name repos "<original author>_<model>"; the base_model says who that author is.
  const authors = (run.model_info?.base_model ?? "").split(",").map((item) => item.trim().split("/")[0]).filter(Boolean);
  const author = authors.find((item) => name.toLowerCase().startsWith(`${item.toLowerCase()}_`) || name.toLowerCase().startsWith(`${item.toLowerCase()}.`));
  if (author) name = name.slice(author.length + 1);
  return name.replace(/[-_.]gguf$/i, "") || name;
}

function parameterLabel(info?: BenchmarkModelInfo) {
  if (!info?.parameters_b) return "";
  const total = info.parameters_b >= 1 ? `${info.parameters_b}B` : `${Math.round(info.parameters_b * 1000)}M`;
  return info.active_parameters_b ? t("{total} · {active}B activos", { total, active: info.active_parameters_b }) : total;
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
      </ResponsiveContainer> : <small className="benchmark-chart-empty">{t("Sin datos medidos")}</small>}
    </Card>;
  };
  const scatter = rows.filter((row) => row.primary != null && row.secondary != null);
  const gain = (value: number, better: "higher" | "lower") => (better === "higher" ? value : -value);
  const dominates = (a: typeof rows[number], b: typeof rows[number]) => {
    const aX = gain(Number(a.primary), primary.better);
    const aY = gain(Number(a.secondary), secondary.better);
    const bX = gain(Number(b.primary), primary.better);
    const bY = gain(Number(b.secondary), secondary.better);
    return aX >= bX && aY >= bY && (aX > bX || aY > bY);
  };
  const frontier = scatter
    .filter((row) => !scatter.some((other) => other !== row && dominates(other, row)))
    .sort((a, b) => gain(Number(b.primary), primary.better) - gain(Number(a.primary), primary.better))
    .slice(0, 8);
  const others = scatter.filter((row) => !frontier.includes(row));
  const logAxis = (key: "primary" | "secondary") => {
    const values = scatter.map((row) => Number(row[key])).filter((value) => value > 0);
    return values.length === scatter.length && Math.max(...values) / Math.min(...values) >= 8;
  };
  const logX = logAxis("primary");
  const logY = logAxis("secondary");
  return <section className="benchmark-modality">
    <header>
      <span className="benchmark-modality-icon" style={{ "--category": color } as CSSProperties}><ModalityIcon modality={modality} size={17} /></span>
      <strong>{MODALITY_LABELS[modality] ?? modality}</strong>
      <small>{runs.length}{" "}{runs.length === 1 ? t("modelo") : t("modelos")}{" "}{t("· último resultado válido por artefacto")}</small>
    </header>
    <div className="benchmark-chart-grid three">
      {bar("score", t("Ranking"), t("Score MyDGX /100 · mayor es mejor"), "higher", (value) => `${value.toFixed(0)}`, color)}
      {bar("primary", primary.label, primary.hint, primary.better, primary.format, color)}
      {bar("secondary", secondary.label, secondary.hint, secondary.better, secondary.format, "var(--blue)")}
    </div>
    {scatter.length >= 2 && <Card className="benchmark-chart">
      <div><strong>{primary.label}{" "}{t("frente a")}{" "}{secondary.label.toLowerCase()}</strong><small>{t("Cada burbuja es un modelo; su tamaño es el peso en disco. Mejor:")}{" "}{primary.better === "higher" ? t("derecha") : t("izquierda")}{" "}{t("y")}{" "}{secondary.better === "higher" ? t("arriba") : t("abajo")}.{" "}{t("Solo se rotulan los modelos de la frontera óptima; pasa el ratón por el resto.")}{logX || logY ? ` ${t("Escala logarítmica.")}` : ""}</small></div>
      <ResponsiveContainer width="100%" height={340}>
        <ScatterChart margin={{ top: 22, right: 32, left: 4, bottom: 12 }}>
          <CartesianGrid stroke="var(--border)" strokeOpacity={0.6} />
          <XAxis type="number" dataKey="primary" name={primary.label} scale={logX ? "log" : "auto"} domain={logX ? ["auto", "auto"] : [0, "auto"]} allowDataOverflow={false} tickFormatter={(value) => primary.format(Number(value))} tick={{ fontSize: 11 }} />
          <YAxis type="number" dataKey="secondary" name={secondary.label} scale={logY ? "log" : "auto"} domain={logY ? ["auto", "auto"] : [0, "auto"]} tickFormatter={(value) => secondary.format(Number(value))} width={70} tick={{ fontSize: 11 }} />
          <ZAxis type="number" dataKey="size" range={[40, 420]} name="GB" />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
            const row = payload?.[0]?.payload as typeof rows[number] | undefined;
            return row ? <div className="benchmark-tooltip"><strong>{row.name}</strong><span>{primary.label}: {primary.format(Number(row.primary))}</span><span>{secondary.label}: {secondary.format(Number(row.secondary))}</span><span>{t("Disco:")}{" "}{row.size.toFixed(1)}{" "}{t("GB · score")}{" "}{row.score}</span></div> : null;
          }} />
          <Scatter data={others} fill={color} fillOpacity={0.28} stroke={color} strokeOpacity={0.5} isAnimationActive={false} />
          <Scatter data={frontier} fill={color} fillOpacity={0.85} stroke="var(--surface)" isAnimationActive={false}>
            <LabelList dataKey="name" position="top" offset={8} style={{ fontSize: 11, fontWeight: 650, fill: "var(--text)" }} />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </Card>}
    {modality === "text-generation" && <BenchmarkEfficiencyCharts runs={runs} />}
  </section>;
}

function BenchmarkEfficiencyCharts({ runs }: { runs: BenchmarkRun[] }) {
  const rows = runs.flatMap((run) => {
    const info = run.model_info;
    const tps = finite(run.summary.output_tokens_per_second?.mean);
    const total = finite(info?.parameters_b);
    const active = finite(info?.active_parameters_b) ?? total;
    if (!tps || !total || !active) return [];
    const weightGbPerToken = (Number(run.artifact_size || 0) / 1e9) * (active / total);
    const bandwidth = info?.memory_bandwidth_gbps || 273;
    return [{
      name: shortModelName(run).slice(0, 28),
      tps, total, active,
      moe: active < total,
      estimated: Boolean(info?.parameters_estimated),
      quantization: run.quantization,
      perParameter: tps * active,
      bandwidthUse: weightGbPerToken ? Math.min(100, (tps * weightGbPerToken / bandwidth) * 100) : null,
      bandwidth,
    }];
  });
  if (rows.length < 2) return null;
  const sorted = [...rows.map((row) => row.perParameter)].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const actives = rows.map((row) => row.active);
  const [minActive, maxActive] = [Math.min(...actives) * 0.8, Math.max(...actives) * 1.25];
  const curve = Array.from({ length: 24 }, (_, index) => {
    const active = minActive * (maxActive / minActive) ** (index / 23);
    return { active, tps: median / active };
  });
  const params = (row: typeof rows[number]) => `${row.estimated ? "≈" : ""}${row.total}B${row.moe ? t(" · {active}B activos (MoE)", { active: row.active }) : ""}`;
  const tooltip = ({ payload }: { payload?: ReadonlyArray<{ payload?: unknown }> }) => {
    const row = payload?.[0]?.payload as typeof rows[number] | undefined;
    return row && "perParameter" in row ? <div className="benchmark-tooltip">
      <strong>{row.name}</strong>
      <span>{params(row)} · {row.quantization}</span>
      <span>{row.tps.toFixed(1)}{" "}{t("tok/s ·")}{" "}{row.perParameter.toFixed(0)}{" "}{t("B·tok/s")}</span>
      {row.bandwidthUse != null && <span>{row.bandwidthUse.toFixed(0)}{" "}{t("% de")}{" "}{row.bandwidth}{" "}{t("GB/s")}</span>}
    </div> : null;
  };
  const ranking = (key: "perParameter" | "bandwidthUse", title: string, hint: string, format: (value: number) => string) => {
    const data = rows.filter((row) => row[key] != null).sort((a, b) => Number(b[key]) - Number(a[key]));
    return <Card className="benchmark-chart">
      <div><strong>{title}</strong><small>{hint}</small></div>
      <ResponsiveContainer width="100%" height={Math.max(140, 34 * data.length + 40)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 70, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="var(--border)" horizontal={false} />
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12, fill: "var(--text-secondary)" }} />
          <Tooltip content={tooltip} cursor={{ fill: "var(--surface-soft)" }} />
          <Bar dataKey={key} radius={[0, 6, 6, 0]} barSize={18} isAnimationActive={false}>
            {data.map((row, index) => <Cell key={row.name} fill={row.moe ? "var(--blue)" : "var(--accent)"} fillOpacity={index === 0 ? 1 : 0.6} />)}
            <LabelList dataKey={key} position="right" formatter={(value: unknown) => format(Number(value))} style={{ fontSize: 12, fill: "var(--text-secondary)" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>;
  };
  return <>
    <div className="benchmark-chart-grid">
      {ranking("perParameter", t("Eficiencia por parámetro"), t("tok/s × miles de millones de parámetros activos: cuánto modelo mueve por segundo. Quita la ventaja de ser pequeño · mayor es mejor"), (value) => `${value.toFixed(0)} B·tok/s`)}
      {ranking("bandwidthUse", t("Aprovechamiento de la memoria"), t("tok/s × GB de pesos leídos por token ÷ ancho de banda del GB10. Descuenta también la cuantización; 100 % es el límite físico"), (value) => `${value.toFixed(0)} %`)}
    </div>
    <Card className="benchmark-chart">
      <div><strong>{t("Velocidad frente a parámetros activos")}</strong><small>{t("Escalas logarítmicas. La línea discontinua es la eficiencia mediana (")}{median.toFixed(0)}{" "}{t("B·tok/s): por encima, más rápido de lo que le tocaría por su tamaño. Azul: MoE · verde: denso.")}</small></div>
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 16, right: 24, left: 4, bottom: 12 }}>
          <CartesianGrid stroke="var(--border)" />
          <XAxis type="number" dataKey="active" name={t("Parámetros activos")} scale="log" domain={[minActive, maxActive]} allowDataOverflow tickFormatter={(value) => `${Number(value) >= 10 ? Number(value).toFixed(0) : Number(value).toFixed(1)}B`} tick={{ fontSize: 11 }} />
          <YAxis type="number" dataKey="tps" name="tok/s" scale="log" domain={["auto", "auto"]} tickFormatter={(value) => `${Number(value).toFixed(0)}`} width={48} tick={{ fontSize: 11 }} />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} content={tooltip} />
          <Scatter data={curve} line={{ stroke: "var(--text-muted)", strokeDasharray: "5 4" }} shape={() => <g />} isAnimationActive={false} legendType="none" />
          <Scatter data={rows} isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.name} fill={row.moe ? "var(--blue)" : "var(--accent)"} fillOpacity={0.8} />)}
            <LabelList dataKey="name" position="top" style={{ fontSize: 11, fill: "var(--text-secondary)" }} />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </Card>
  </>;
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
    .map((item) => ({ date: new Date(item.created_at).toLocaleDateString(locale), score: Math.round(Number(item.score)) }));
  const facts = [
    { label: t("Tamaño"), value: bytes(run.artifact_size) },
    { label: t("Parámetros"), value: parameterLabel(info) },
    { label: t("Cuantización"), value: run.quantization },
    { label: t("Arquitectura"), value: run.architecture },
    { label: t("Memoria estimada"), value: info?.estimated_memory_mb ? bytes(info.estimated_memory_mb * 1024 * 1024) : "" },
    { label: t("Licencia"), value: info?.license },
    { label: t("Idiomas"), value: info?.languages.slice(0, 4).join(", ") },
    { label: t("Modelo base"), value: info?.base_model },
  ].filter((fact) => fact.value);
  return <Card className={`benchmark-model-card-v2 ${run.valid ? "" : "invalid"}`} >
    <div className="bmc-hero" style={{ "--category": category.color } as CSSProperties}>
      <span className="bmc-icon"><ModalityIcon modality={modality} size={22} /></span>
      <div className="bmc-title">
        <span className="bmc-kicker">{MODALITY_LABELS[modality] ?? modality}{info?.author ? ` · ${info.author}` : ""}</span>
        <strong title={run.source_id}>{shortModelName(run)}</strong>
        <div className="bmc-badges">
          <span className={`badge ${run.valid ? "live" : ""}`}>{run.valid ? t("Válido") : run.status}</span>
          {run.summary.score_provisional ? <span className="badge" title={t("Con una sola repetición no se puede medir la estabilidad")}>{t("Provisional")}</span> : null}
          {parameterLabel(info) && <span className="badge">{parameterLabel(info)}</span>}
          {run.quantization && <span className="badge">{run.quantization}</span>}
          {run.imported ? <span className="badge">{t("Importado")}</span> : null}
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
          <em>{relative == null ? t("sin comparación") : relative >= 0.999 ? t("mejor de su categoría") : t("{round}% del mejor", { round: Math.round(relative * 100) })}</em>
        </div>;
      })}
    </div>
    <div className="bmc-body">
      <dl className="bmc-facts">
        {facts.map((fact) => <span key={fact.label}><dt>{fact.label}</dt><dd title={String(fact.value)}>{fact.value}</dd></span>)}
      </dl>
      {trend.length > 1 && <div className="bmc-trend">
        <small>{t("Evolución del score")}</small>
        <ResponsiveContainer width="100%" height={56}>
          <AreaChart data={trend} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
            <Tooltip formatter={(value) => [`${value}/100`, t("Score")]} labelFormatter={(label) => String(label)} />
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
    {!run.valid && <em className="bmc-invalid">{run.invalid_reason || t("Resultado excluido de comparativas")}</em>}
    <div className="bmc-footer">
      <small>{run.protocol_name} · {new Date(run.created_at).toLocaleString(locale)} · {run.artifact_hash.slice(0, 10)}…</small>
      <div className="benchmark-run-actions">
        <button className="icon-button" disabled={active || rerunning} title={t("Ejecutar de nuevo y conservar el histórico")} aria-label={t("Volver a ejecutar benchmark de {source_id}", { source_id: run.source_id })} onClick={onRerun}><RefreshCw className={rerunning ? "spin" : ""} size={15} /></button>
        <button className="button secondary" disabled={detailLoading} onClick={onOpen}><Info size={14} />{" "}{t("Ficha completa")}</button>
        <button className="icon-button" aria-label={t("Exportar benchmark")} onClick={onExport}><Download size={15} /></button>
      </div>
    </div>
    {history.length > 0 && <details className="benchmark-history">
      <summary>{t("Histórico del artefacto (")}{history.length})</summary>
      {history.map((item) => <button key={item.id} type="button" onClick={() => onOpenRun(item.id)}>
        <span>{new Date(item.created_at).toLocaleString(locale)}</span>
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
      t("Se volverá a ejecutar el benchmark de {source_id}. El resultado anterior se conservará ", { source_id: run.source_id })
      + t("en el histórico y la inferencia quedará pausada durante la medición. ¿Continuar?"),
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
      notify(t("Nuevo benchmark encolado: {source_id}", { source_id: run.source_id }));
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
      t("La suite medirá {length} modelo(s) ({totalSize} en disco). ", { length: selectedCandidates.length, totalSize: bytes(totalSize) })
      + t("Puede tardar muchas horas. Durante todo el proceso el chat, el gateway y los perfiles ")
      + t("no estarán disponibles. MyDGX descargará todos los modelos de memoria, medirá uno por ")
      + t("uno y restaurará el estado actual al terminar o al detener la suite. ¿Continuar?"),
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
      notify(t("Suite de benchmarks iniciada"));
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
      t("Se detendrá la muestra actual y MyDGX restaurará los perfiles y modelos que estaban ")
      + t("cargados antes de empezar. La restauración puede tardar unos minutos. ¿Detener la suite?"),
    )) return;
    setSuiteAction("stopping");
    try {
      await api(`/api/benchmarks/suite/${data.suite.id}/stop`, { method: "POST" });
      notify(t("Detención solicitada; restaurando el estado anterior"));
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
      notify(t("Benchmark automático descartado"));
      await load();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function cancelRun(jobId: string) {
    try {
      await api(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      notify(t("Cancelación solicitada"));
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
      notify(t("Benchmark exportado"));
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function importRun(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error(t("El bundle supera 10 MiB"));
      const bundle = JSON.parse(await file.text()) as Record<string, unknown>;
      const result = await api<{ imported: boolean; duplicate: boolean }>("/api/benchmarks/import", {
        method: "POST",
        body: JSON.stringify({ bundle }),
      });
      notify(result.duplicate ? t("El benchmark ya existía") : t("Benchmark importado"));
      await load();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  if (loading && !data) return <Loading label={t("Cargando benchmarks")} />;
  if (!data) return <Empty icon={<Gauge />} title={t("Benchmarks no disponibles")} text={t("No se pudo consultar la base de benchmarks.")} />;

  const modalityOf = (run: BenchmarkRun) => data.protocols.find((protocol) => protocol.id === run.protocol_id)?.modality ?? "text-generation";
  const validRuns = data.runs.filter((run) => run.status === "completed" && run.valid);
  // Charts compare one device across software updates (e.g. a new llama.cpp) by default;
  // the selector narrows them to a single exact environment.
  const deviceOf = (run: BenchmarkRun) => String(run.hardware.device_model || run.hardware.product_name || t("Equipo"));
  const comparisonGroups = Array.from(validRuns.reduce((groups, run) => {
    const device = deviceOf(run);
    for (const [key, label] of [
      [`device|${device}`, t("{device} · todas las versiones", { device: device })],
      [`env|${run.environment_hash}`, t("{device} · entorno {hash}", { device, hash: run.environment_hash.slice(0, 8) })],
    ]) {
      const current = groups.get(key);
      if (current) {
        current.count += 1;
        current.environments.add(run.environment_hash);
        if (run.created_at < current.since) current.since = run.created_at;
      } else {
        groups.set(key, { key, label, count: 1, since: run.created_at, environments: new Set([run.environment_hash]) });
      }
    }
    return groups;
  }, new Map<string, { key: string; label: string; count: number; since: string; environments: Set<string> }>()).values())
    .filter((group, _, all) => group.key.startsWith("device|") || all.filter((item) => item.key.startsWith("env|")).length > 1);
  const selectedComparison = comparisonGroups.some((group) => group.key === comparisonKey)
    ? comparisonKey
    : (validRuns[0] ? `device|${deviceOf(validRuns[0])}` : "");
  const selectedGroup = comparisonGroups.find((group) => group.key === selectedComparison);
  const inComparison = (run: BenchmarkRun) => (selectedComparison.startsWith("env|")
    ? `env|${run.environment_hash}` === selectedComparison
    : `device|${deviceOf(run)}` === selectedComparison);
  const comparableByModality = new Map<string, BenchmarkRun[]>();
  for (const run of validRuns.filter(inComparison)) {
    const modality = modalityOf(run);
    const items = comparableByModality.get(modality) ?? [];
    const reference = items[0] ?? run;
    if (
      run.protocol_id === reference.protocol_id
      && run.score_algorithm === reference.score_algorithm
      && !items.some((item) => item.artifact_hash === run.artifact_hash)
    ) items.push(run);
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
        eyebrow={t("MEDICIÓN REPRODUCIBLE")}
        title={t("Benchmarks")}
        action={<button className="icon-button" onClick={() => void load()} aria-label={t("Actualizar benchmarks")}><RefreshCw size={16} /></button>}
      />

      <Card className="benchmark-explainer">
        <div className="bx-hero">
          <div className="bx-hero-icon"><Gauge size={26} /></div>
          <div>
            <span className="card-kicker">{t("QUÉ HACE ESTE MENÚ")}</span>
            <h3>{t("Mide cada modelo del DGX con el mismo protocolo y te dice cuál rinde mejor en esta máquina")}</h3>
            <p>
              {t("No son cifras de catálogo: cada número sale de ejecutar el modelo aquí, aislado, con pruebas versionadas por tipo de tarea. Los resultados se guardan para siempre y solo se comparan entre sí cuando el hardware, el protocolo y el algoritmo de score coinciden.")}
            </p>
          </div>
          <div className="bx-status">
            <span className={data.active ? "running" : "idle"}><Activity size={13} /> {data.active ? t("Benchmark en curso") : t("Runner disponible")}</span>
            <span><Zap size={13} /> {data.auto_new_models ? t("Auto con modelos nuevos · calma {quiet_seconds}s", { quiet_seconds: data.quiet_seconds }) : t("Automático desactivado")}</span>
            <span><ShieldCheck size={13} />{" "}{t("Protocolo v")}{data.protocols.find((protocol) => protocol.active)?.version ?? "—"}</span>
          </div>
        </div>

        <ol className="bx-steps">
          {[
            { icon: Boxes, title: t("Elige"), text: t("Selecciona en la suite los modelos pendientes o vuelve a medir uno desde su ficha.") },
            { icon: Cpu, title: t("Aísla"), text: t("Libera la memoria, carga solo ese modelo y hace un calentamiento que no cuenta.") },
            { icon: Activity, title: t("Mide"), text: t("Repite las pruebas sin tráfico concurrente y registra velocidad, calidad, memoria y potencia.") },
            { icon: Trophy, title: t("Compara"), text: t("Calcula un score sobre 100, lo ordena por categoría y conserva todo el histórico.") },
          ].map((step, index) => <li key={step.title}>
            <span className="bx-step-num">{index + 1}</span>
            <span className="bx-step-icon"><step.icon size={18} /></span>
            <strong>{step.title}</strong>
            <small>{step.text}</small>
          </li>)}
        </ol>

        <div className="bx-modalities">
          {[
            { category: "text", title: t("Texto"), metrics: t("tok/s · primer token · estabilidad") },
            { category: "voice", title: t("Voz"), metrics: t("tiempo real (RTF) · error de palabras · inteligibilidad") },
            { category: "image", title: t("Imagen y vídeo"), metrics: t("tiempo de generación · integridad · reproducibilidad") },
            { category: "vision", title: t("Visión"), metrics: t("latencia · conceptos reconocidos") },
            { category: "retrieval", title: t("Embeddings y rerank"), metrics: t("elementos/s · calidad semántica · NDCG") },
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
          <span><ShieldCheck size={13} />{" "}{t("Una petición a la vez")}</span>
          <span><Database size={13} />{" "}{t("Histórico append-only, nada se sobrescribe")}</span>
          <span><RefreshCw size={13} />{" "}{t("Restaura perfiles y modelos al terminar o cancelar")}</span>
          <span><Download size={13} />{" "}{t("Exporta e importa resultados en JSON")}</span>
        </div>
      </Card>

      <Card className={`benchmark-pipeline ${activeSuite ? "is-running" : ""}`}>
        <div className="benchmark-pipeline-hero">
          <div className="benchmark-pipeline-icon"><Boxes size={25} /></div>
          <div>
            <span className="card-kicker">{t("SUITE MULTIMODAL SECUENCIAL · LARGA DURACIÓN")}</span>
            <h3>{t("Completar benchmarks pendientes")}</h3>
            <p>
              {t("Descarga todos los modelos de memoria y mide cada artefacto local con su protocolo: texto, reconocimiento de voz o generación de imagen. Entre modelos libera la RAM.")}
            </p>
          </div>
          <div className="benchmark-pipeline-stat">
            <strong>{activeSuite ? `${activeSuite.completed_models}/${activeSuite.total_models}` : selectedSuiteCandidates.length}</strong>
            <small>{activeSuite ? t("modelos procesados") : t("seleccionados · {count} pendientes", { count: pendingSuiteCount })}</small>
            <span>{suiteHasEstimatedSize ? "≈ " : ""}{bytes(suiteTotalSize)}{suiteHasEstimatedSize ? t(" (incluye estimaciones)") : t(" en disco")}</span>
          </div>
        </div>

        <div className="benchmark-pipeline-warning">
          <TriangleAlert size={19} />
          <div>
            <strong>{t("Puede tardar muchas horas y deja temporalmente el sistema sin inferencia")}</strong>
            <span>
              {t("Chat, asistente, perfiles, OpenAI Gateway y Open WebUI no podrán usar modelos durante la suite. Puedes detenerla en cualquier momento: MyDGX cancela la muestra actual y restaura automáticamente los perfiles y modelos residentes anteriores.")}
            </span>
          </div>
        </div>

        {activeSuite && <div className="benchmark-pipeline-progress">
          <div>
            <span>
              <RefreshCw size={15} className={activeSuite.status !== "restoring" ? "spin" : ""} />
              <strong>
                {activeSuite.status === "restoring"
                  ? t("Restaurando el estado anterior")
                  : currentSuiteItem
                    ? t("Midiendo {model_name}", { model_name: currentSuiteItem.model_name })
                    : t("Preparando la suite")}
              </strong>
            </span>
            <b>{Math.round(suiteProgress)}%</b>
          </div>
          <div className="benchmark-pipeline-track">
            <span style={{ width: `${Math.max(1, suiteProgress)}%` }} />
          </div>
          <small>{suiteJob?.message || t("Liberando memoria y preparando el siguiente modelo")}</small>
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
                ? t("Ocultar modelos")
                : t("Mostrar {length} modelos", { length: suiteInventory.length })}
            </span>
            <small>{t("{selected} de {total}", { selected: activeSuite ? suiteInventory.length : selectedSuiteCandidates.length, total: suiteInventory.length })} · {suiteHasEstimatedSize ? "≈ " : ""}{bytes(suiteTotalSize)}</small>
          </summary>
          <div>
            {!activeSuite && suiteInventory.length > 0 && <div className="benchmark-pipeline-selection">
              <span>
                {selectedSuiteCandidates.length}{" "}{t("seleccionados ·")}{" "}{t("{count} pendientes", { count: pendingSuiteCount })}
                {blockedSuiteCount ? t(" · {blockedSuiteCount} sin runtime activo", { blockedSuiteCount: blockedSuiteCount }) : ""}
              </span>
              <div>
                <button type="button" onClick={() => {
                  selectionTouched.current = true;
                  setSelectedCandidateKeys(new Set(
                    selectableCandidates.filter((item) => !item.suite_completed).map((item) => item.candidate_key),
                  ));
                }}>{t("Pendientes")}</button>
                <button type="button" onClick={() => {
                  selectionTouched.current = true;
                  setSelectedCandidateKeys(new Set(selectableCandidates.map((item) => item.candidate_key)));
                }}>{t("Seleccionar todo")}</button>
                <button type="button" onClick={() => {
                  selectionTouched.current = true;
                  setSelectedCandidateKeys(new Set());
                }}>{t("Ninguno")}</button>
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
                      title={blocked ? item.blocked_reason : t("Incluir {name}", { name: item.name })}
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
                        aria-label={t("Incluir {name} en la suite", { name: item.name })}
                      />
                    </label>}
                <span>
                  <strong>
                    {"model_name" in item ? item.model_name : item.name}
                    {"variant" in item && item.variant ? <i> · {item.variant}</i> : null}
                  </strong>
                  <small>
                    {item.engine} · {item.modality} · {item.artifact_hash.slice(0, 10)}…
                    {"measured" in item && item.measured ? t(" · benchmark individual existente") : ""}
                  </small>
                  {blocked && <small className="benchmark-pipeline-model-blocked">
                    <TriangleAlert size={11} /> {item.blocked_reason}
                  </small>}
                </span>
                <b title={"artifact_size_estimated" in item && item.artifact_size_estimated
                  ? t("Estimación de memoria del perfil; el archivo de pesos no está declarado")
                  : t("Tamaño exacto de los artefactos locales")}>
                  {"artifact_size_estimated" in item && item.artifact_size_estimated ? "≈ " : ""}
                  {bytes(item.artifact_size)}
                </b>
                <em>
                  {status === "completed" ? t("Completado")
                    : status === "running" ? t("Midiendo")
                      : status === "loading" ? t("Cargando")
                        : status === "failed" ? t("Falló")
                          : status === "cancelled" ? t("Cancelado")
                            : status === "skipped" ? t("Omitido")
                              : blocked ? t("No disponible")
                                : completedBefore ? t("Ya medido")
                                  : t("Pendiente")}
                </em>
              </div>;
            }) : <div className="benchmark-pipeline-empty"><CheckCircle2 size={18} />{" "}{t("Todos los modelos locales elegibles ya completaron la suite.")}</div>}
          </div>
        </details>

        {latestSuite && <details className="benchmark-pipeline-result">
          <summary>
            <span>
              {latestSuiteFailed.length || latestSuiteCancelled.length
                ? <TriangleAlert size={16} />
                : <CheckCircle2 size={16} />}
              <strong>{t("Última ejecución")}</strong>
            </span>
            <small>
              {latestSuiteCompleted.length}{" "}{t("correctos ·")}{" "}{latestSuiteFailed.length}{" "}{t("fallidos")}
              {latestSuiteSkipped.length ? t(" · {count} omitidos", { count: latestSuiteSkipped.length }) : ""}
              {latestSuiteCancelled.length ? t(" · {count} cancelados", { count: latestSuiteCancelled.length }) : ""}
            </small>
          </summary>
          <div>
            {latestSuite.items.map((item) => <div className={`benchmark-pipeline-result-row status-${item.status}`} key={item.candidate_key}>
              <span>
                <strong>{item.model_name}</strong>
                <small>{item.engine} · {item.modality}{item.error ? ` · ${item.error}` : ""}</small>
              </span>
              <em>
                {item.status === "completed" ? t("Correcto")
                  : item.status === "failed" ? t("Falló")
                    : item.status === "skipped" ? t("Omitido")
                      : item.status === "cancelled" ? t("Cancelado")
                        : t("Pendiente")}
              </em>
            </div>)}
            {latestSuiteFailed.length + latestSuiteSkipped.length > 0 && <p className="benchmark-pipeline-result-hint">
              {t("Los modelos fallidos u omitidos siguen en la lista superior y puedes volver a seleccionarlos.")}
            </p>}
            {latestSuite.error && <p>{latestSuite.error}</p>}
          </div>
        </details>}

        <div className="benchmark-pipeline-actions">
          <span>
            <ShieldCheck size={14} />
            {t("El estado actual se captura antes de empezar y se restaura al finalizar.")}
          </span>
          {!activeSuite && <div className="benchmark-pipeline-options">
            <label title={t("Repeticiones medidas por caso; con 2 o más se calcula la estabilidad")}>{t("Repeticiones")}
              <input type="number" min={1} max={10} value={repetitions} onChange={(event) => setRepetitions(Math.max(1, Math.min(10, Number(event.target.value))))} />
            </label>
            <label className="checkbox" title={t("Detiene el tráfico del resto de servicios durante cada medición")}><input type="checkbox" checked={strictIsolation} onChange={(event) => setStrictIsolation(event.target.checked)} /><span>{t("Aislamiento estricto")}</span></label>
          </div>}
          {activeSuite
            ? <button
                className="button danger"
                disabled={activeSuite.status === "restoring" || suiteAction === "stopping"}
                onClick={() => void stopSuite()}
              ><Square size={14} /> {suiteAction === "stopping" ? t("Deteniendo…") : activeSuite.status === "restoring" ? t("Restaurando…") : t("Detener y restaurar")}</button>
            : <button
                className="button primary"
                disabled={!data.enabled || !selectedSuiteCandidates.length || data.active || suiteAction === "starting"}
                onClick={() => void startSuite()}
              ><Play size={15} /> {suiteAction === "starting" ? t("Iniciando…") : t("Ejecutar suite de benchmarks")}</button>}
        </div>
      </Card>

      {activeJob && <Card className="benchmark-active">
        <div><RefreshCw className="spin" size={18} /><span><strong>{activeJob.message}</strong><small>{activeJob.target}</small></span><b>{Math.round(activeJob.progress)}%</b></div>
        <div className="storage-bar"><span style={{ width: `${activeJob.progress}%` }} /></div>
        <button className="button secondary" onClick={() => void cancelRun(activeJob.id)}>{t("Cancelar")}</button>
      </Card>}

      {pendingQueue.length > 0 && <Card className="benchmark-queue">
        <div><strong>{t("Cola automática")}</strong><small>{t("Se ejecuta cuando no hay trabajos, ni inferencia activa, ni uso interactivo reciente")}</small></div>
        {pendingQueue.map((entry) => <div className="benchmark-queue-row" key={entry.id}>
          <span><strong>{entry.target.replace(/^ollama:/, "").replace(/^profile:/, `${t("perfil")} `)}</strong><small>{entry.status === "running" ? t("Ejecutando") : entry.last_reason || t("Esperando ventana libre")}{" "}{t("· intento")}{" "}{entry.attempts}</small></span>
          {entry.status === "pending" && <button className="button secondary" onClick={() => void skipQueueEntry(entry.id)}>{t("Descartar")}</button>}
        </div>)}
      </Card>}

      <div className="benchmark-summary-grid">
        <Card><small>{t("Runs históricos")}</small><strong>{data.runs.length}</strong><span>{t("Locales e importados")}</span></Card>
        <Card><small>{t("Runs válidos")}</small><strong>{validRuns.length}</strong><span>{t("Incluidos en comparativas")}</span></Card>
        <Card><small>{t("Artefactos medidos")}</small><strong>{new Set(data.runs.map((run) => run.artifact_hash)).size}</strong><span>{t("Digest exacto")}</span></Card>
        <Card><small>{t("Protocolo activo")}</small><strong>v{data.protocols.find((protocol) => protocol.active)?.version ?? "—"}</strong><span>{data.score_algorithm}</span></Card>
      </div>

      <div className="benchmark-category-tabs" role="tablist" aria-label={t("Categorías de benchmark")}>
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
          eyebrow={t("COMPARACIÓN")}
          title={activeCategory.id === "all" ? t("Rendimiento por categoría") : t("Rendimiento · {label}", { label: activeCategory.label })}
          action={comparisonGroups.length > 1 ? <select className="benchmark-comparison-select" value={selectedComparison} onChange={(event) => setComparisonKey(event.target.value)} aria-label={t("Entorno de comparación")}>
            {comparisonGroups.map((group) => <option key={group.key} value={group.key}>{group.label}{group.key.startsWith("env|") ? t(" · desde {date}", { date: new Date(group.since).toLocaleDateString(locale) }) : ""} ({group.count})</option>)}
          </select> : undefined}
        />
        {selectedGroup && selectedGroup.environments.size > 1 && <small className="benchmark-comparison-note">
          {t("Combina")}{" "}{selectedGroup.environments.size}{" "}{t("entornos de software (por ejemplo, versiones de llama.cpp o del driver). Cada modelo muestra su último resultado; elige un entorno concreto para comparar en igualdad estricta.")}
        </small>}
        {chartModalities.map((modality) => <BenchmarkModalityCharts key={modality} modality={modality} runs={comparableByModality.get(modality) ?? []} />)}
      </>}

      <SectionHeading
        eyebrow={t("FICHAS")}
        title={t("Resultados por modelo")}
        action={<div className="benchmark-list-actions">
          <label className={`benchmark-search${searchStateClass(benchSearch, visibleGroups.length)}`} data-count={searchCountLabel(benchSearch, visibleGroups.length)}>
            <Search size={14} />
            <input
              type="search"
              value={benchSearch}
              onChange={(event) => setBenchSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") setBenchSearch(""); }}
              placeholder={t("Buscar modelo, autor, tag…")}
              aria-label={t("Buscar en resultados por modelo")}
            />
            {benchSearch && <button type="button" onClick={() => setBenchSearch("")} aria-label={t("Limpiar búsqueda")}><X size={13} /></button>}
          </label>
          <select className="benchmark-comparison-select" value={benchSort} onChange={(event) => setBenchSort(event.target.value as typeof benchSort)} aria-label={t("Ordenar fichas")}>
            <option value="score">{t("Por categoría y score")}</option>
            <option value="recent">{t("Más recientes")}</option>
            <option value="name">{t("Por nombre")}</option>
          </select>
          <label className="button secondary benchmark-import"><Download size={14} />{" "}{t("Importar JSON")}<input type="file" accept="application/json,.json" onChange={(event) => { void importRun(event.target.files?.[0]); event.target.value = ""; }} /></label>
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
      </div> : <Empty icon={<Gauge />} title={!artifactGroups.length ? t("Todavía no hay benchmarks") : searchTerms.length ? t("Nada coincide con «{trim}»", { trim: benchSearch.trim() }) : t("Sin modelos en esta categoría")} text={searchTerms.length ? t("Prueba con otro término o cambia de categoría.") : t("Selecciona un modelo y ejecuta la suite reproducible.")} />}

      {detail && <div className="benchmark-detail-overlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setDetail(null); }}>
        <Card className="benchmark-detail" >
          <div className="benchmark-detail-head">
            <div><span className="eyebrow">{t("FICHA COMPLETA")}</span><h2>{detail.source_id}</h2><small>{detail.artifact_hash.slice(0, 16)}… · {detail.quantization || detail.filename || detail.source}</small></div>
            <button className="icon-button" onClick={() => setDetail(null)} aria-label={t("Cerrar ficha")}><X size={17} /></button>
          </div>
          <div className="benchmark-detail-body">
            {(() => {
              const info = detail.model_info;
              const category = benchmarkCategory(detailModality);
              const radar = Object.entries(detail.summary.score_dimensions ?? {})
                .filter(([, value]) => value != null)
                .map(([key, value]) => ({ dimension: key.replace(/_/g, " "), value: Number(value) }));
              const runEstimate = Number(detail.runtime?.estimated_memory_mb || 0) || info?.estimated_memory_mb || 0;
              const peakMemory = detail.summary.resources?.max_memory_bytes;
              const drafter = detail.runtime?.speculative as { spec_type?: string; draft_filename?: string } | undefined;
              const acceptance = detail.summary.speculative;
              const facts = [
                [t("Tarea"), MODALITY_LABELS[detailModality] ?? detailModality],
                [t("Autor"), info?.author],
                [t("Parámetros"), parameterLabel(info)],
                [t("Tamaño en disco"), bytes(detail.artifact_size)],
                [t("Cuantización"), detail.quantization],
                [t("Arquitectura"), detail.architecture],
                [t("Memoria estimada"), runEstimate ? bytes(runEstimate * 1024 * 1024) : ""],
                [t("Pico real vs estimada"), peakMemory && runEstimate
                  ? t("{peakMemory} del sistema · {value} de la estimación", { peakMemory: bytes(peakMemory), value: peakMemory > runEstimate * 1024 * 1024 ? t("por encima") : t("dentro") })
                  : ""],
                [t("Especulativa"), drafter?.spec_type
                  ? `${SPEC_LABELS[drafter.spec_type] ?? drafter.spec_type}${drafter.draft_filename ? ` · ${drafter.draft_filename}` : ` · ${t("integrado")}`}${acceptance ? t(" · aceptación {round}%", { round: Math.round(acceptance.acceptance_rate * 100) }) : t(" · sin datos de aceptación")}`
                  : ""],
                [t("Entrada → salida"), info?.input_modalities.length ? `${info.input_modalities.join(", ")} → ${info.output_modalities.join(", ") || "—"}` : ""],
                [t("Licencia"), info?.license],
                [t("Modelo base"), info?.base_model],
                [t("Librería"), info?.library],
                [t("Idiomas"), info?.languages.slice(0, 8).join(", ")],
                [t("Popularidad"), info?.downloads || info?.likes ? t("{downloads} descargas · {likes} likes", { downloads: compactCount(info?.downloads) || "0", likes: compactCount(info?.likes) || "0" }) : ""],
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
                  </ResponsiveContainer> : <small className="benchmark-chart-empty">{t("Dimensiones insuficientes para el radar")}</small>}
                </div>
              </div>;
            })()}
            <div className="benchmark-summary-grid">
              <Card><small>{t("Score medido")}</small><strong>{detail.summary.score ?? "—"}</strong><span>{detail.score_algorithm}</span></Card>
              {detailModality === "automatic-speech-recognition" ? <>
                <Card><small>{t("RTF / WER")}</small><strong>{detail.summary.real_time_factor?.mean == null ? "—" : `${Number(detail.summary.real_time_factor.mean).toFixed(3)} / ${((detail.summary.word_error_rate ?? 0) * 100).toFixed(1)}%`}</strong><span>{t("Velocidad / error de palabras")}</span></Card>
                <Card><small>CER</small><strong>{detail.summary.character_error_rate == null ? "—" : `${(Number(detail.summary.character_error_rate) * 100).toFixed(1)}%`}</strong><span>{t("Fixture de audio versionado")}</span></Card>
              </> : detailModality === "vision" ? <>
                <Card><small>{t("Latencia p50")}</small><strong>{detail.summary.total_ms?.p50 == null ? "—" : `${Number(detail.summary.total_ms.p50).toFixed(0)} ms`}</strong><span>{t("Inferencia con imagen local")}</span></Card>
                <Card><small>{t("Recall de conceptos")}</small><strong>{detail.summary.vision_quality?.normalized_concept_recall == null ? "—" : `${(Number(detail.summary.vision_quality.normalized_concept_recall) * 100).toFixed(1)}%`}</strong><span>{detail.summary.vision_quality?.method || t("Fixture visual versionado")}</span></Card>
              </> : detailModality === "text-to-speech" ? <>
                <Card><small>{t("RTF medio")}</small><strong>{detail.summary.real_time_factor?.mean == null ? "—" : Number(detail.summary.real_time_factor.mean).toFixed(3)}</strong><span>{t("Síntesis / duración")}</span></Card>
                <Card><small>{t("Inteligibilidad")}</small><strong>{!detail.summary.intelligibility?.available ? t("No medida") : `${((1 - Number(detail.summary.intelligibility.word_error_rate ?? 1)) * 100).toFixed(1)}%`}</strong><span>{detail.summary.intelligibility?.quality_claim || t("Sin afirmación de inteligibilidad")}</span></Card>
              </> : detailModality === "image-generation" ? <>
                <Card><small>{t("Generación p50")}</small><strong>{detail.summary.total_ms?.p50 == null ? "—" : `${(Number(detail.summary.total_ms.p50) / 1000).toFixed(1)} s`}</strong><span>{t("Workflow y semilla fijos")}</span></Card>
                <Card><small>{t("Reproducibilidad")}</small><strong>{detail.summary.image_validation?.pixel_reproducibility_percent == null ? "—" : `${Number(detail.summary.image_validation.pixel_reproducibility_percent).toFixed(0)}%`}</strong><span>{t("Validación de píxeles")}</span></Card>
              </> : detailModality === "video-generation" ? <>
                <Card><small>{t("Generación p50")}</small><strong>{detail.summary.total_ms?.p50 == null ? "—" : `${(Number(detail.summary.total_ms.p50) / 1000).toFixed(1)} s`}</strong><span>{t("Workflow Wan reproducible")}</span></Card>
                <Card><small>{t("Reproducibilidad")}</small><strong>{detail.summary.video_validation?.perceptual_reproducibility_percent == null && detail.summary.video_validation?.exact_reproducibility_percent == null ? "—" : `${Number(detail.summary.video_validation.perceptual_reproducibility_percent ?? detail.summary.video_validation.exact_reproducibility_percent).toFixed(0)}%`}</strong><span>{detail.summary.video_validation?.quality_claim || t("Validación objetiva del contenedor")}</span></Card>
              </> : detailModality === "embeddings" ? <>
                <Card><small>{t("Elementos/s")}</small><strong>{detail.summary.items_per_second?.mean == null ? "—" : Number(detail.summary.items_per_second.mean).toFixed(1)}</strong><span>{t("Throughput vectorial")}</span></Card>
                <Card><small>{t("Calidad semántica")}</small><strong>{detail.summary.semantic_quality?.pair_accuracy == null ? "—" : `${(Number(detail.summary.semantic_quality.pair_accuracy) * 100).toFixed(1)}%`}</strong><span>{t("Margen")}{" "}{detail.summary.semantic_quality?.mean_margin?.toFixed(3) ?? "—"}</span></Card>
              </> : detailModality === "reranking" ? <>
                <Card><small>NDCG</small><strong>{detail.summary.ranking_quality?.ndcg_mean == null ? "—" : `${(Number(detail.summary.ranking_quality.ndcg_mean) * 100).toFixed(1)}%`}</strong><span>{t("Ordenación esperada")}</span></Card>
                <Card><small>MRR</small><strong>{detail.summary.ranking_quality?.mrr_mean == null ? "—" : `${(Number(detail.summary.ranking_quality.mrr_mean) * 100).toFixed(1)}%`}</strong><span>{t("Primer resultado relevante")}</span></Card>
              </> : <>
                <Card><small>{t("TTFT p50 / p95")}</small><strong>{detail.summary.ttft_ms?.p50 == null ? "—" : `${Number(detail.summary.ttft_ms.p50).toFixed(0)} / ${Number(detail.summary.ttft_ms.p95 ?? 0).toFixed(0)} ms`}</strong><span>{t("Primer token")}</span></Card>
                <Card><small>{t("Throughput")}</small><strong>{detail.summary.output_tokens_per_second?.mean == null ? "—" : `${Number(detail.summary.output_tokens_per_second.mean).toFixed(1)} tok/s`}</strong><span>{detail.summary.characters_per_second?.mean == null ? t("Sin normalizar") : `${Number(detail.summary.characters_per_second.mean).toFixed(0)} chars/s`}</span></Card>
              </>}
              <Card><small>{t("Fiabilidad")}</small><strong>{detail.summary.reliability_percent ?? 0}%</strong><span>{t("{valid}/{total} muestras", { valid: detail.summary.valid_sample_count ?? 0, total: detail.summary.sample_count ?? 0 })}</span></Card>
            </div>
            {detail.telemetry.length > 1 && <Card className="benchmark-chart">
              <div><strong>{t("Telemetría durante el run")}</strong><small>{t("Utilización GPU y potencia observadas")}</small></div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={detail.telemetry.map((point) => ({ time: new Date(point.created_at).toLocaleTimeString(locale), gpu: point.gpu_utilization, power: point.gpu_power_watts }))}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="time" />
                  <YAxis width={42} />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="gpu" name="GPU %" stroke="var(--accent)" fill="var(--accent-soft)" />
                  <Area type="monotone" dataKey="power" name={t("Potencia W")} stroke="var(--blue)" fill="transparent" />
                </AreaChart>
              </ResponsiveContainer>
            </Card>}
            <div className="benchmark-detail-grid">
              <div><strong>{t("Artefacto")}</strong><dl><dt>{t("Fuente")}</dt><dd>{detail.source}</dd><dt>{t("Revisión")}</dt><dd>{detail.revision || "—"}</dd><dt>{t("Archivo")}</dt><dd>{detail.filename || "—"}</dd><dt>{t("Tamaño")}</dt><dd>{bytes(detail.artifact_size)}</dd><dt>{t("Hash")}</dt><dd><code>{detail.artifact_hash}</code></dd></dl></div>
              <div><strong>{t("Entorno")}</strong><dl>{Object.entries(detail.hardware).slice(0, 10).map(([key, value]) => <span key={key}><dt>{key}</dt><dd>{String(value ?? "—")}</dd></span>)}</dl></div>
              <div><strong>{t("Runtime efectivo")}</strong><pre>{JSON.stringify(detail.runtime, null, 2)}</pre></div>
              <div><strong>{t("Score dimensional")}{detail.summary.score_provisional ? t(" · provisional") : ""}</strong><dl>{Object.entries(detail.summary.score_dimensions ?? {}).map(([key, value]) => <span key={key}><dt>{key}</dt><dd>{value == null ? t("— (requiere ≥2 repeticiones)") : `${Number(value).toFixed(1)}/100`}</dd></span>)}</dl></div>
            </div>
            {detail.summary.cases && <div className="benchmark-samples benchmark-cases">
              <strong>{t("Resultado por caso")}</strong>
              <div className="benchmark-sample-head"><span>{t("Caso")}</span><span>{t("Válidas")}</span><span>{t("TTFT p50")}</span><span>{t("tok/s")}</span><span>CV</span><span>{t("Fin temprano")}</span></div>
              {Object.entries(detail.summary.cases).map(([caseId, item]) => <div key={caseId}><span>{caseId}</span><span>{item.valid_samples}/{item.samples}</span><span>{item.ttft_ms_p50 == null ? "—" : `${item.ttft_ms_p50.toFixed(0)} ms`}</span><span>{item.output_tokens_per_second_mean == null ? "—" : item.output_tokens_per_second_mean.toFixed(1)}</span><span>{item.coefficient_of_variation == null ? "—" : `${(item.coefficient_of_variation * 100).toFixed(1)}%`}</span><span>{item.early_stops}</span></div>)}
            </div>}
            <div className="benchmark-samples">
              <strong>{t("Muestras")}</strong>
              <div className="benchmark-sample-head"><span>{t("Caso")}</span><span>{t("Fase")}</span><span>TTFT</span><span>{t("tok/s")}</span><span>{t("Tokens")}</span><span>{t("Estado")}</span></div>
              {detail.samples.map((sample) => <div key={sample.id}><span>{sample.case_id}</span><span>{sample.phase} {sample.repetition || ""}</span><span>{sample.ttft_ms == null ? "—" : `${sample.ttft_ms.toFixed(0)} ms`}</span><span>{sample.output_tps == null ? "—" : sample.output_tps.toFixed(1)}</span><span>{sample.output_tokens ?? "—"}</span><span className={sample.valid ? "ok" : "error"}>{sample.valid ? t("Válida") : sample.error || t("Fallida")}</span></div>)}
            </div>
            {detail.card_text && <details className="benchmark-model-card"><summary>{t("Descripción / model card de Hugging Face")}</summary><MarkdownMessage content={detail.card_text.slice(0, 12_000)} /></details>}
            <details className="benchmark-raw"><summary>{t("Metadatos completos")}</summary><pre>{JSON.stringify(detail.metadata, null, 2)}</pre></details>
          </div>
        </Card>
      </div>}
    </div>
  );
}

function healthCheckStatusLabel(status: HealthCheckStatus) {
  return status === "ok" ? t("Correcto")
    : status === "warning" ? t("Advertencia")
      : status === "critical" ? t("Crítico")
        : status === "unknown" ? t("Sin datos")
          : t("No aplica");
}

function worstHealthStatus(statuses: HealthCheckStatus[]): HealthCheckStatus {
  return (["critical", "warning", "unknown", "ok"] as const).find((status) => statuses.includes(status)) ?? "not_applicable";
}

function HealthFindingCard({ finding }: { finding: HealthFinding }) {
  const state = finding.active ? finding.severity : "resolved";
  return <Card className={`health-finding ${state}`}>
    <div className="health-finding-icon">
      {!finding.active ? <CheckCircle2 /> : finding.severity === "critical" ? <TriangleAlert /> : finding.severity === "warning" ? <Info /> : <Activity />}
    </div>
    <div className="health-finding-copy">
      <div className="health-finding-title">
        <strong>{finding.title}</strong>
        <span className="health-finding-badges">
          <span className={`badge ${state}`}>{!finding.active ? t("Resuelto") : finding.severity === "critical" ? t("Crítico") : finding.severity === "warning" ? t("Advertencia") : t("Información")}</span>
          <span className="badge">{finding.category}</span>
          <span className={`badge confidence-${finding.confidence}`}>{t("Confianza {value}", { value: finding.confidence === "high" ? t("alta") : finding.confidence === "medium" ? t("media") : t("baja") })}</span>
        </span>
      </div>
      <p>{finding.detail}</p>
      <div className="health-finding-facts">
        {finding.evidence && <div className="health-evidence"><Eye size={14} /><span><small>{t("Evidencia")}</small><code>{finding.evidence}</code></span></div>}
        {finding.active && finding.remediation && <div className="health-remediation"><ShieldCheck size={14} /><span><small>{t("Acción recomendada")}</small><em>{finding.remediation}</em></span></div>}
      </div>
      <small className="health-meta">
        {finding.active
          ? t("Detectado {first} · visto por última vez {last}", { first: new Date(finding.first_seen).toLocaleString(locale), last: new Date(finding.last_seen).toLocaleString(locale) })
          : t("Resuelto {time}", { time: new Date(finding.resolved_at || finding.last_seen).toLocaleString(locale) })}
        {finding.occurrences > 1 && <> · {t("{count} apariciones", { count: finding.occurrences })}</>}
        {finding.source_note && <><br />{t("Fuente")}: {finding.source_note}</>}
      </small>
    </div>
  </Card>;
}

function HealthCenterPanel({ health, loading, onRefresh, notify }: {
  health: HealthCenter | null;
  loading: boolean;
  onRefresh: () => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [filter, setFilter] = useState<"active" | "critical" | "warning" | "resolved">("active");
  if (!health) {
    return <Card className="health-loading"><RefreshCw className="spin" /><span>{t("Evaluando la salud del sistema…")}</span></Card>;
  }
  const active = health.findings.filter((finding) => finding.active);
  const visible = filter === "resolved"
    ? health.findings.filter((finding) => !finding.active)
    : filter === "active" ? active : active.filter((finding) => finding.severity === filter);
  const checks = health.checks ?? [];
  const measured = checks.filter((check) => check.status !== "not_applicable");
  const passing = measured.filter((check) => check.status === "ok").length;
  const unknown = measured.filter((check) => check.status === "unknown").length;
  const collectors = health.diagnosis.collectors;
  const working = collectors.filter((collector) => collector.status !== "error").length;
  const groups: Array<{ kind: HealthCheck["kind"]; label: string; icon: ReactNode }> = [
    { kind: "gpu", label: "GPU", icon: <Cpu size={15} /> },
    { kind: "memory", label: t("Memoria unificada"), icon: <MemoryStick size={15} /> },
    { kind: "storage", label: t("Almacenamiento"), icon: <HardDrive size={15} /> },
    { kind: "kernel", label: t("Kernel · arranque actual"), icon: <Terminal size={15} /> },
    { kind: "runtime", label: t("Runtimes"), icon: <Boxes size={15} /> },
    { kind: "services", label: t("Servicios"), icon: <Server size={15} /> },
    { kind: "inference", label: t("Inferencia"), icon: <Gauge size={15} /> },
  ];
  const collectorLabels: Record<string, string> = {
    metrics: t("Métricas del host"),
    gpu: t("Telemetría GPU"),
    kernel: t("Journal del kernel"),
    services: "systemd",
    runtime: "Python / PyTorch",
  };
  const statusTitle = health.status === "healthy"
    ? t("Sistema saludable")
    : health.status === "critical"
      ? t("Hay problemas críticos")
      : t("El sistema requiere atención");
  async function downloadReport() {
    try {
      const report = await api<Record<string, unknown>>("/api/system/health-center/report");
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `mydgx-health-report-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      notify(t("Informe de salud descargado"));
    } catch (error) {
      notify((error as Error).message, true);
    }
  }
  const toggle = (value: typeof filter) => setFilter(filter === value ? "active" : value);
  return <div className="health-center">
    <Card className={`health-hero ${health.status}`}>
      <div className="health-hero-status">
        {health.status === "healthy" ? <CheckCircle2 /> : <TriangleAlert />}
        <span>
          <small>{t("HEALTH CENTER")}</small>
          <strong>{statusTitle}</strong>
          <em>
            {measured.length > 0 && <>{t("{passing}/{total} comprobaciones correctas", { passing, total: measured.length })} · </>}
            {health.diagnosis.complete ? t("Diagnóstico completo") : t("Diagnóstico parcial")}
            {" · "}{t("Evaluado {time}", { time: new Date(health.evaluated_at).toLocaleTimeString(locale) })}
          </em>
        </span>
      </div>
      <div className="health-summary">
        <button className={`critical${filter === "critical" ? " selected" : ""}`} aria-pressed={filter === "critical"} onClick={() => toggle("critical")}>
          <strong>{health.summary.critical}</strong><small>{t("Críticos")}</small>
        </button>
        <button className={`warning${filter === "warning" ? " selected" : ""}`} aria-pressed={filter === "warning"} onClick={() => toggle("warning")}>
          <strong>{health.summary.warning}</strong><small>{t("Advertencias")}</small>
        </button>
        <button className={`resolved${filter === "resolved" ? " selected" : ""}`} aria-pressed={filter === "resolved"} onClick={() => toggle("resolved")}>
          <strong>{health.summary.resolved}</strong><small>{t("Resueltos · 7 días")}</small>
        </button>
      </div>
      <div className="health-hero-actions">
        <button className="button secondary" onClick={() => void downloadReport()} title={t("JSON sin hostname, IP ni logs completos")}><Download size={15} />{" "}{t("Informe redactado")}</button>
        <button className="button secondary" disabled={loading} onClick={onRefresh}><RefreshCw className={loading ? "spin" : ""} size={15} />{" "}{t("Volver a evaluar")}</button>
      </div>
    </Card>

    {filter === "active" && !active.length
      ? <div className="health-clear">
        <CheckCircle2 size={16} />
        <span>
          <strong>{t("No hay hallazgos activos.")}</strong>{" "}
          {unknown
            ? t("Las comprobaciones medidas están dentro de sus umbrales; {count} no tienen datos en este equipo.", { count: unknown })
            : t("Todas las comprobaciones medidas están dentro de sus umbrales.")}
        </span>
        {health.summary.resolved > 0 && <button className="button secondary compact" onClick={() => setFilter("resolved")}>{t("Ver resueltos")}</button>}
      </div>
      : <section className="health-section">
        <div className="health-section-heading">
          <h3>{filter === "resolved" ? t("Hallazgos resueltos · 7 días") : filter === "critical" ? t("Hallazgos críticos") : filter === "warning" ? t("Advertencias activas") : t("Hallazgos activos")}</h3>
          {filter !== "active" && <button className="button secondary compact" onClick={() => setFilter("active")}>{t("Ver todos los activos")}</button>}
        </div>
        {visible.length
          ? <div className="health-findings">{visible.map((finding) => <HealthFindingCard finding={finding} key={finding.id} />)}</div>
          : <p className="health-section-empty">{filter === "resolved" ? t("No se resolvió ninguna incidencia en los últimos siete días.") : t("No hay hallazgos con esta gravedad.")}</p>}
      </section>}

    {checks.length > 0 && <section className="health-section">
      <div className="health-section-heading">
        <h3>{t("Comprobaciones")}</h3>
        <p>{t("Valores observados en esta evaluación frente a sus umbrales.")}</p>
      </div>
      <div className="health-check-grid">
        {groups.map((group) => {
          const items = checks.filter((check) => check.kind === group.kind);
          if (!items.length) return null;
          const groupStatus = worstHealthStatus(items.map((item) => item.status));
          return <Card className={`health-check-group ${groupStatus}`} key={group.kind}>
            <div className="health-check-group-title">
              {group.icon}<strong>{group.label}</strong>
              <span className={`health-pill ${groupStatus}`}>{healthCheckStatusLabel(groupStatus)}</span>
            </div>
            {items.map((check) => <div className={`health-check ${check.status}`} key={check.id} title={healthCheckStatusLabel(check.status)}>
              <i aria-hidden="true" />
              <span><strong>{check.label}</strong>{check.threshold && <small>{check.threshold}</small>}</span>
              <code>{check.value}</code>
            </div>)}
          </Card>;
        })}
      </div>
    </section>}

    <div className="health-coverage">
      <span className="health-coverage-title"><Activity size={14} />{t("Cobertura {working}/{total}", { working, total: collectors.length })}</span>
      {collectors.map((collector) => <span className={`health-chip ${collector.status}`} key={collector.id} title={collector.detail}>
        {collector.status === "ok" ? <CheckCircle2 size={13} /> : collector.status === "error" ? <TriangleAlert size={13} /> : <CircleHelp size={13} />}
        {collectorLabels[collector.id] ?? collector.id}
        {collector.status !== "ok" && <small>{collector.detail}</small>}
      </span>)}
    </div>
  </div>;
}

function SystemView({ config, jobs, overview, notify, onOpenLab, initialTab = "overview" }: { config: Config | null; jobs: Job[]; overview: Overview | null; notify: (message: string, error?: boolean) => void; onOpenLab: () => void; initialTab?: "overview" | "health" }) {
  const [systemTab, setSystemTab] = useState<"overview" | "health">(initialTab);
  const [healthCenter, setHealthCenter] = useState<HealthCenter | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [services, setServices] = useState<Array<Record<string, unknown>>>([]);
  const [updates, setUpdates] = useState<SystemUpdates | null>(null);
  const [versions, setVersions] = useState<{ components: Array<{ name: string; version?: string; available: boolean; detail: string; category?: string }>; packages: Array<{ name: string; version: string }> } | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [integrity, setIntegrity] = useState<SystemIntegrity | null>(null);
  const [firmware, setFirmware] = useState<FirmwareStatus | null>(null);
  const [firmwareChecking, setFirmwareChecking] = useState(false);
  const loadFirmware = useCallback((refresh = false) => {
    setFirmwareChecking(true);
    api<FirmwareStatus>(`/api/updates/firmware${refresh ? "?refresh=true" : ""}`)
      .then(setFirmware)
      .catch((error) => notify(error.message, true))
      .finally(() => setFirmwareChecking(false));
  }, [notify]);
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
    loadFirmware();
  }, [notify, loadFirmware]);
  const fetchHealth = useCallback((refresh: boolean, silent: boolean) => (
    api<HealthCenter>(`/api/system/health-center${refresh ? "?refresh=true" : ""}`)
      .then(setHealthCenter)
      .catch((error) => { if (!silent) notify(error.message, true); })
      .finally(() => setHealthLoading(false))
  ), [notify]);
  const loadHealth = useCallback(() => {
    setHealthLoading(true);
    void fetchHealth(true, false);
  }, [fetchHealth]);
  useEffect(load, [load]);
  useEffect(() => { void fetchHealth(false, true); }, [fetchHealth]);
  useEffect(() => {
    if (systemTab !== "health") return;
    const timer = window.setInterval(() => { void fetchHealth(false, true); }, 60_000);
    return () => window.clearInterval(timer);
  }, [systemTab, fetchHealth]);
  const maintenanceStatus = jobs
    .filter((job) => ["system.update", "system.repair", "system.firmware"].includes(job.kind))
    .map((job) => `${job.id}:${job.status}`)
    .join("|");
  useEffect(() => {
    if (maintenanceStatus.includes(":completed") || maintenanceStatus.includes(":failed")) load();
  }, [load, maintenanceStatus]);

  async function applyFirmware() {
    const reboot = firmware?.updates.some((item) => item.needs_reboot);
    const message = [
      t("Se instalará el firmware pendiente con fwupd. No apagues ni desconectes el equipo durante la instalación."),
      reboot ? t("Hará falta reiniciar el DGX para aplicarlo; MyDGX no reiniciará por su cuenta.") : "",
    ].filter(Boolean).join("\n\n");
    if (!window.confirm(message)) return;
    try {
      await api("/api/updates/firmware/apply", { method: "POST", body: JSON.stringify({ confirm: "ACTUALIZAR FIRMWARE" }) });
      notify(t("Instalación de firmware iniciada"));
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function applyUpdates() {
    if (!window.confirm(t("Se actualizarán los paquetes del sistema. Guarda todo tu trabajo antes de continuar."))) return;
    try {
      await api("/api/updates/apply", { method: "POST", body: JSON.stringify({ confirm: "ACTUALIZAR MYDGX" }) });
      notify(t("Actualización iniciada; al terminar se verificarán kernel, driver, CUDA, DKMS y llama.cpp"));
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function repairSystem() {
    if (!window.confirm(t("Se comprobarán paquetes, DKMS, driver NVIDIA, CUDA y llama.cpp. La reparación puede tardar varios minutos."))) return;
    try {
      await api("/api/system/repair", { method: "POST", body: JSON.stringify({ confirm: "REPARAR MYDGX" }) });
      notify(t("Comprobación y reparación iniciada"));
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  async function control(name: string, action: "start" | "stop" | "restart") {
    if (!window.confirm(t("¿{action} el servicio {name}?", { action: action === "start" ? t("Iniciar") : action === "stop" ? t("Detener") : t("Reiniciar"), name: name }))) return;
    try {
      await api("/api/services/action", { method: "POST", body: JSON.stringify({ name, action, confirm: `${action} ${name}` }) });
      notify(t("Servicio {name}: {action}", { name: name, action: action === "start" ? t("Iniciar") : action === "stop" ? t("Detener") : t("Reiniciar") }));
      load();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  const maintenanceActive = jobs.some((job) =>
    ["system.update", "system.repair", "system.firmware"].includes(job.kind) &&
    ["queued", "running"].includes(job.status)
  );
  const systemBranding = overview ? deviceBranding(overview.host) : null;
  const updateCategoryLabels: Record<SystemUpdatePackage["category"], string> = {
    kernel: t("Kernel"),
    nvidia: "NVIDIA / CUDA",
    containers: t("Contenedores"),
    runtime: t("Runtime"),
    system: t("Sistema"),
  };

  return (
    <div className="view-stack">
      <SectionHeading
        eyebrow={overview?.host.is_dgx_spark ? t("PLATAFORMA NVIDIA GB10") : (overview?.host.os_family ? overview.host.os_family.toUpperCase() : t("SISTEMA"))}
        title={t("Sistema y servicios")}
        action={<div className="system-heading-actions">
          <button className="button secondary" onClick={onOpenLab} title={t("Imagen, audio, vídeo y embeddings")}><Sparkles size={15} />{" "}{t("Laboratorio IA")}</button>
          <button className="icon-button" onClick={systemTab === "health" ? loadHealth : load}><RefreshCw className={systemTab === "health" && healthLoading ? "spin" : ""} size={17} /></button>
        </div>}
      />
      <div className="tabs system-tabs">
        <button className={systemTab === "overview" ? "active" : ""} onClick={() => setSystemTab("overview")}><Server size={14} />{" "}{t("Plataforma")}</button>
        <button className={systemTab === "health" ? "active" : ""} onClick={() => setSystemTab("health")}>
          <Activity size={14} />{" "}{t("Health Center")}
          {healthCenter && (healthCenter.summary.critical + healthCenter.summary.warning) > 0 && <b className={`tab-count ${healthCenter.summary.critical ? "critical" : "warning"}`}>{healthCenter.summary.critical + healthCenter.summary.warning}</b>}
        </button>
      </div>
      {systemTab === "health"
        ? <HealthCenterPanel health={healthCenter} loading={healthLoading} onRefresh={loadHealth} notify={notify} />
        : <>
      {overview && systemBranding && (
        <Card className={`system-device-banner device-${overview.host.device_variant}`}>
          <div className="system-device-copy">
            <div className="system-device-brand">
              {systemBranding.logo && <img src={systemBranding.logo} alt={overview.host.device_vendor} />}
              <span>{systemBranding.subtitle}</span>
            </div>
            <strong>{systemBranding.label}</strong>
            <small><StatusDot online /> {overview.host.is_dgx_spark ? t("NVIDIA GB10 detectado") : t("Equipo detectado")} · {overview.host.hostname}</small>
            <div className="system-device-chips">
              <span>{overview.host.gpu_name || t("GPU no detectada")}</span>
              <span>{overview.host.architecture}</span>
              <span>{overview.host.is_dgx_os ? "DGX OS" : overview.host.os_family}</span>
            </div>
          </div>
          <div className="system-device-photo">
            {systemBranding.product
              ? <img src={systemBranding.product} alt={systemBranding.label} />
              : <Cpu aria-label={t("Equipo sin fotografía disponible")} />}
          </div>
        </Card>
      )}
      {readiness && (
        <>
          <Card className={`readiness-summary ${readiness.ready ? "ready" : "attention"}`}>
            <div className="readiness-title">
              {readiness.ready ? <CheckCircle2 /> : <TriangleAlert />}
              <span>
                <strong>{readiness.ready ? t("Sistema listo") : t("El sistema requiere atención")}</strong>
                <small>{readiness.ready ? t("Todos los requisitos obligatorios están disponibles.") : t("Revisa los avisos antes de activar perfiles o descargar modelos.")}</small>
              </span>
            </div>
            <div className="readiness-counts">
              <span className="ok"><CheckCircle2 size={16} /><strong>{readiness.summary.ok}</strong><small>{t("Correctos")}</small></span>
              <span className="warning"><TriangleAlert size={16} /><strong>{readiness.summary.warnings}</strong><small>{t("Avisos")}</small></span>
              <span className="info"><Info size={16} /><strong>{readiness.summary.optional}</strong><small>{t("Opcionales")}</small></span>
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
          <div className="card-kicker"><Cpu size={16} />{" "}{t("Plataforma y sistema operativo")}</div>
          <div className="system-facts">
            <div><span>{t("Plataforma")}</span><strong>{overview ? (overview.host.is_dgx_spark ? overview.host.device_model : t("Equipo no DGX Spark")) : t("Detectando")}</strong></div>
            <div><span>{t("Familia del SO")}</span><strong>{overview ? (overview.host.is_dgx_os ? "NVIDIA DGX OS" : overview.host.os_family) : t("Detectando")}</strong></div>
            <div><span>{t("Distribución")}</span><strong>{overview?.host.os_name ?? t("Detectando")}</strong></div>
            <div><span>{t("Kernel")}</span><strong>{overview?.host.kernel ?? "—"}</strong></div>
            <div><span>{t("Arquitectura")}</span><strong>{overview?.host.architecture ?? "—"}</strong></div>
            <div><span>CPU</span><strong>{overview?.host.cpu_count ?? "—"}{" "}{t("núcleos")}</strong></div>
          </div>
        </Card>
        <Card>
          <div className="card-kicker"><Server size={16} />{" "}{t("Servicios administrados")}</div>
          <div className="service-list">
            {services.map((service) => {
              const active = ["active", "running"].includes(String(service.status));
              return (
                <div className="service-control" key={`${service.type}-${service.name}`}>
                  <StatusDot online={active} />
                  <div><strong>{String(service.name)}</strong><small>{String(service.type)} · {String(service.status)}</small></div>
                  {service.type === "systemd" && <div><button onClick={() => control(String(service.name), "restart")}>{t("Reiniciar")}</button><button onClick={() => control(String(service.name), active ? "stop" : "start")}>{active ? t("Detener") : t("Iniciar")}</button></div>}
                </div>
              );
            })}
            {!services.length && <p className="muted">{t("No se detectaron servicios administrados.")}</p>}
          </div>
        </Card>
        <Card className="integrity-card">
          <div className="card-kicker">
            {integrity?.healthy ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
            {t("Integridad después de actualizar")}
          </div>
          {integrity && (
            <>
              <div className={`integrity-state ${integrity.healthy ? "ok" : "warning"}`}>
                <strong>{integrity.healthy ? t("Sistema coherente") : integrity.reboot_required ? t("Reinicio requerido") : t("Reparación recomendada")}</strong>
                <small>{t("Kernel activo")}{" "}{integrity.current_kernel}{integrity.latest_kernel !== integrity.current_kernel ? t(" · disponible {kernel}", { kernel: integrity.latest_kernel }) : ""}</small>
              </div>
              <div className="integrity-checks">
                {[
                  ["APT", integrity.apt_ok],
                  ["dpkg", integrity.dpkg_ok],
                  ["DKMS", integrity.dkms_ok],
                  ["NVIDIA Container", integrity.container_runtime_ok],
                  [t("Driver NVIDIA"), integrity.nvidia_ok],
                  ["llama.cpp", integrity.llama_ok],
                  [t("Servicio al arrancar"), integrity.service_enabled],
                ].map(([label, value]) => (
                  <span key={String(label)} className={value === false ? "warning" : value === true ? "ok" : "info"}>
                    {value === false ? <TriangleAlert /> : value === true ? <CheckCircle2 /> : <Info />}
                    <small>{String(label)}</small>
                  </span>
                ))}
              </div>
              <div className="integrity-actions">
                <small>{integrity.last_repair ? t("Última comprobación {date}", { date: new Date(integrity.last_repair).toLocaleString(locale) }) : t("Sin reparación registrada")}</small>
                <button className="button secondary" disabled={!config?.system_updates_enabled || !integrity.repair_available || maintenanceActive} onClick={repairSystem}>{t("Comprobar y reparar")}</button>
              </div>
            </>
          )}
        </Card>
        <Card className="updates-card">
          <div className="card-kicker"><PackageCheck size={16} />{" "}{t("Actualizaciones")}</div>
          <div className="updates-overview">
            <div className="update-total">
              <strong>{updates?.supported ? updates.packages.length : "—"}</strong>
              <span>{updates?.supported ? t("paquetes disponibles") : t("APT no disponible")}</span>
            </div>
            <div className="update-stats">
              <span className={(updates?.summary.security ?? 0) > 0 ? "warning" : ""}><strong>{updates?.summary.security ?? 0}</strong><small>{t("Seguridad")}</small></span>
              <span><strong>{updates?.summary.kernel ?? 0}</strong><small>{t("Kernel")}</small></span>
              <span><strong>{updates?.summary.nvidia ?? 0}</strong><small>{t("NVIDIA/CUDA")}</small></span>
              <span><strong>{updates?.summary.containers ?? 0}</strong><small>{t("Contenedores")}</small></span>
            </div>
            <div className="update-actions">
              {updates?.reboot_required && <span className="update-reboot"><TriangleAlert size={15} />{" "}{t("Hay un reinicio pendiente")}</span>}
              <small>{updates?.checked_at ? t("Comprobado {date}", { date: new Date(updates.checked_at).toLocaleString(locale) }) : t("Comprobando APT…")}</small>
              <button className="button primary" disabled={!config?.system_updates_enabled || !updates?.packages.length || maintenanceActive} onClick={applyUpdates}>{maintenanceActive ? t("Mantenimiento en curso") : t("Actualizar sistema")}</button>
              {!config?.system_updates_enabled && <small>{t("Actívalo en Configuración → Mantenimiento del sistema")}</small>}
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
                  {item.security && <span className="badge warning">{t("Seguridad")}</span>}
                  <code>{item.current_version || "—"} <span>→</span> {item.candidate_version}</code>
                </div>
              ))}
            </div>
          ) : updates?.supported ? <p className="updates-empty"><CheckCircle2 size={17} />{" "}{t("El sistema está actualizado.")}</p> : null}
        </Card>
        <Card className="updates-card">
          <div className="card-kicker"><Cpu size={16} />{" "}{t("Firmware")}</div>
          <div className="updates-overview">
            <div className="update-total">
              <strong>{firmware?.supported ? firmware.updates.length : "—"}</strong>
              <span>{firmware?.supported ? t("actualizaciones de firmware") : t("fwupd no disponible")}</span>
            </div>
            <div className="update-actions">
              {firmware?.reboot_pending && <span className="update-reboot"><TriangleAlert size={15} />{" "}{t("Firmware preparado; reinicia para aplicarlo")}</span>}
              <small>{firmwareChecking ? t("Comprobando firmware…") : firmware?.checked_at ? t("Comprobado {date}", { date: new Date(firmware.checked_at).toLocaleString(locale) }) : ""}</small>
              <button className="button secondary" disabled={firmwareChecking} onClick={() => loadFirmware(true)}>{t("Buscar firmware")}</button>
              <button className="button primary" disabled={!config?.firmware_updates_enabled || !firmware?.updates.length || maintenanceActive} onClick={applyFirmware}>{maintenanceActive ? t("Mantenimiento en curso") : t("Instalar firmware")}</button>
              {!config?.firmware_updates_enabled && <small>{t("Actívalo en Configuración → Mantenimiento del sistema")}</small>}
            </div>
          </div>
          {firmware?.message && <div className="update-message">{firmware.message}</div>}
          <div className="update-packages">
            {firmware?.updates.map((item) => (
              <div className="update-package" key={item.device_id}>
                <span>
                  <strong>{item.name}</strong>
                  <small>{[item.vendor, item.summary].filter(Boolean).join(" · ")}</small>
                  {item.description && <small className="firmware-notes">{item.description}</small>}
                </span>
                {item.needs_reboot && <span className="badge warning">{t("Requiere reinicio")}</span>}
                <code>{item.current_version || "—"} <span>→</span> {item.new_version}</code>
              </div>
            ))}
            {firmware?.connectx && (
              <div className="update-package">
                <span>
                  <strong>{firmware.connectx.name}</strong>
                  <small>{
                    firmware.connectx.state === "cable_required" ? t("Sin cable QSFP conectado: NVIDIA la actualiza al arrancar cuando detecta el cable") :
                    firmware.connectx.state === "pending" ? t("Se actualizará en el próximo arranque con el cable QSFP conectado") :
                    firmware.connectx.state === "current" ? t("Firmware al día") : t("Versión en uso no detectada")
                  }</small>
                </span>
                {firmware.connectx.state === "pending" && <span className="badge warning">{t("Pendiente")}</span>}
                <code>{firmware.connectx.running_version || "—"} <span>→</span> {firmware.connectx.package_version}</code>
              </div>
            )}
          </div>
          {firmware?.supported && !firmware.updates.length && <p className="updates-empty"><CheckCircle2 size={17} />{" "}{t("No hay firmware pendiente en fwupd.")}</p>}
        </Card>
      </div>
      <SectionHeading eyebrow={t("SOFTWARE")} title={t("Versiones instaladas")} />
      <Card className="version-list">
        {versions?.components.map((component) => (
          <div key={component.name}>
            <StatusDot online={component.available} />
            <span><strong>{component.name}</strong><small>{component.category ? `${component.category} · ` : ""}{component.detail}</small></span>
            <code>{component.version ?? t("No detectado")}</code>
          </div>
        ))}
        {versions?.packages.map((item) => (
          <div key={item.name}><StatusDot online /><span><strong>{item.name}</strong><small>{t("Paquete DGX OS")}</small></span><code>{item.version}</code></div>
        ))}
      </Card>
      {jobs.some((job) => ["system.update", "system.repair", "system.firmware"].includes(job.kind)) && <Card className="notice"><Terminal /><span>{t("La tarea de mantenimiento se puede seguir en Modelos → Actividad reciente.")}</span></Card>}
      </>}
    </div>
  );
}

type AppNotification = {
  id: number;
  created_at: string;
  level: "info" | "warning" | "error";
  kind: string;
  target: string;
  title: string;
  message: string;
  log: string;
  read_at: string | null;
};
type NotificationsResponse = { unread: number; items: AppNotification[] };

function NotificationBell({ unread, popup, onOpen }: { unread: number; popup: AppNotification | null; onOpen: () => void }) {
  return <div className="notification-bell-wrap">
    <button className={`header-icon-button notification-bell ${unread ? "has-unread" : ""}`} onClick={onOpen} title={t("Notificaciones")} aria-label={unread ? t("{count} notificación(es) sin leer", { count: unread }) : t("Notificaciones")}>
      <Bell size={16} />
      {unread > 0 && <span className="notification-count">{unread > 99 ? "99+" : unread}</span>}
    </button>
    {popup && <button className={`notification-popup ${popup.level}`} onClick={onOpen} role="status">
      <TriangleAlert size={15} />
      <span><strong>{popup.title}</strong><small>{popup.message}</small></span>
    </button>}
  </div>;
}

function NotificationsPanel({ data, onRead, notify, onOpenHealth }: { data: NotificationsResponse | null; onRead: (ids: number[] | "all") => void; notify: (message: string, error?: boolean) => void; onOpenHealth: () => void }) {
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const unreadIds = useMemo(() => (data?.items ?? []).filter((item) => !item.read_at).map((item) => item.id), [data]);
  useEffect(() => {
    if (!unreadIds.length) return;
    setFresh((current) => new Set([...current, ...unreadIds]));
    const timer = window.setTimeout(() => onRead(unreadIds), 800);
    return () => window.clearTimeout(timer);
  }, [onRead, unreadIds]);
  const items = data?.items ?? [];
  return <Card className="notifications-panel">
    <div className="notifications-head">
      <div><Bell size={16} /><span><strong>{t("Notificaciones")}</strong><small>{items.length ? t("{count} aviso(s) recientes · se marcan como leídos al verlos", { count: items.length }) : t("Sin avisos")}</small></span></div>
      {data && data.unread > 0 && <button className="button secondary compact" onClick={() => onRead("all")}>{t("Marcar todas como leídas")}</button>}
    </div>
    {items.length ? <ol className="notifications-list">
      {items.map((item) => <li key={item.id} className={`${item.level} ${fresh.has(item.id) ? "fresh" : ""}`}>
        <TriangleAlert size={15} />
        <div>
          <div className="notification-line"><strong>{item.title}</strong><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString(locale)}</time></div>
          <p>{item.message}</p>
          {item.kind === "memory.pressure" && <div className="notification-actions"><StopAllModelsButton notify={notify} onDone={() => undefined} /></div>}
          {item.kind === "health.alert" && <div className="notification-actions"><button className="button secondary compact" onClick={onOpenHealth}><Activity size={14} />{" "}{t("Abrir Health Center")}</button></div>}
          {item.log && <details><summary>{t("Log")}</summary><pre>{item.log}</pre></details>}
        </div>
      </li>)}
    </ol> : <p className="notifications-empty">{t("Aquí aparecerán las descargas fallidas, los errores al cargar modelos o al ejecutar benchmarks y los modelos defectuosos.")}</p>}
  </Card>;
}

function LogsView({ notify, notifications, onReadNotifications, onOpenHealth }: { notify: (message: string, error?: boolean) => void; notifications: NotificationsResponse | null; onReadNotifications: (ids: number[] | "all") => void; onOpenHealth: () => void }) {
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
        eyebrow={t("DIAGNÓSTICO PERSISTENTE")}
        title={t("Logs")}
        action={<div className="logs-heading-actions">
          <button className={`button ${live ? "primary" : "secondary"}`} onClick={() => setLive((current) => !current)}>
            {live ? <Activity size={14} /> : <Square size={13} />} {live ? t("En directo") : t("Pausado")}
          </button>
          <button className="icon-button" onClick={() => void load()} aria-label={t("Actualizar logs")}><RefreshCw size={16} /></button>
        </div>}
      />
      <NotificationsPanel data={notifications} onRead={onReadNotifications} notify={notify} onOpenHealth={onOpenHealth} />
      <div className="logs-summary">
        <Card><small>{t("Últimas 24 h")}</small><strong>{Object.values(counts).reduce((total, count) => total + (count ?? 0), 0)}</strong></Card>
        <Card className="warning"><small>{t("Warnings")}</small><strong>{counts.warning ?? 0}</strong></Card>
        <Card className="error"><small>{t("Errores")}</small><strong>{(counts.error ?? 0) + (counts.critical ?? 0)}</strong></Card>
        <Card><small>{t("Retención")}</small><strong>{data?.retention_days ?? 30}{" "}{t("días")}</strong></Card>
      </div>
      <Card className="logs-panel">
        <form className="logs-filters" onSubmit={search}>
          <label>{t("Nivel")}
            <select value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="">{t("Todos")}</option>
              <option value="debug">{t("Debug")}</option>
              <option value="info">{t("Info")}</option>
              <option value="warning">{t("Warning")}</option>
              <option value="error">{t("Error")}</option>
              <option value="critical">{t("Critical")}</option>
            </select>
          </label>
          <label>{t("Categoría")}
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">{t("Todas")}</option>
              {(data?.categories ?? []).map((item) => <option value={item} key={item}>{item}</option>)}
            </select>
          </label>
          <label className={`logs-search${searchStateClass(query, data && appliedQuery === query.trim() ? data.entries.length : null)}`} data-count={searchCountLabel(query, data && appliedQuery === query.trim() ? data.entries.length : null)}>{t("Buscar")}
            <span><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("acción, entidad o mensaje")} /><button type="submit">{t("Filtrar")}</button></span>
          </label>
        </form>
        <div className="logs-table-head"><span>{t("Fecha")}</span><span>{t("Nivel")}</span><span>{t("Evento")}</span><span>{t("Categoría")}</span></div>
        <div className="logs-list">
          {(data?.entries ?? []).map((entry) => (
            <button
              className={`log-entry level-${entry.level} ${selected === entry.id ? "selected" : ""}`}
              key={entry.id}
              onClick={() => setSelected((current) => current === entry.id ? null : entry.id)}
            >
              <time>{new Date(entry.created_at).toLocaleString(locale)}</time>
              <span className={`log-level ${entry.level}`}>{entry.level}</span>
              <span className="log-message">
                <strong>{entry.message}</strong>
                <small>{entry.action}{entry.entity_id ? ` · ${entry.entity_id}` : ""}</small>
                {selected === entry.id && <code>{JSON.stringify(entry.detail, null, 2)}</code>}
              </span>
              <span className="log-category">{entry.category}</span>
            </button>
          ))}
          {data && data.entries.length === 0 && <Empty icon={<Terminal />} title={t("Sin resultados")} text={t("No hay logs que coincidan con estos filtros.")} />}
        </div>
        {data?.has_more && <small className="logs-limit-note">{t("Se muestran los 200 eventos más recientes. Acota los filtros para investigar un caso concreto.")}</small>}
      </Card>
    </div>
  );
}

type EnvSetting = { key: string; type: "bool" | "int" | "str"; value: boolean | number | string; default: boolean | number | string | null; min: number | null; max: number | null; restart: boolean; confirm?: string | null };
type EnvSettings = { env_file: boolean; hf_token_configured: boolean; settings: EnvSetting[] };
type EnvSettingsUpdate = EnvSettings & { updated: string[]; restart_required: string[]; hf_user?: string };

function envSettingGroups(): Array<{ title: string; items: Record<string, { label: string; hint: string }> }> {
  return [
    { title: t("Mantenimiento del sistema"), items: {
      ENABLE_SYSTEM_UPDATES: { label: t("Actualizar el sistema"), hint: t("Permite instalar paquetes APT y reparar kernel, driver y runtimes desde Sistema. Pide confirmación para activarlo") },
      ENABLE_FIRMWARE_UPDATES: { label: t("Actualizar firmware"), hint: t("Permite instalar firmware con fwupd desde Sistema → Actualizaciones. Pide confirmación para activarlo") },
      ENABLE_SERVICE_CONTROL: { label: t("Controlar servicios"), hint: t("Permite iniciar, detener y reiniciar los servicios de la lista permitida desde Sistema y Motores. Pide confirmación para activarlo") },
    } },
    { title: t("Descargas"), items: {
      HF_DOWNLOAD_WORKERS: { label: t("Descargas en paralelo"), hint: t("Archivos o shards simultáneos al bajar de Hugging Face") },
      MODEL_IMPORT_MAX_GB: { label: t("ZIP de importación máximo (GB)"), hint: t("Tamaño máximo de un modelo importado desde un ZIP") },
    } },
    { title: t("Benchmarks"), items: {
      BENCHMARK_ENABLED: { label: t("Benchmarks"), hint: t("Permite medir modelos desde MyDGX") },
      BENCHMARK_AUTO_NEW_MODELS: { label: t("Comprobar modelos nuevos"), hint: t("Pasa un benchmark a cada GGUF descargado y marca los defectuosos o incompletos") },
      BENCHMARK_REPETITIONS: { label: t("Repeticiones por caso"), hint: t("Más repeticiones dan medidas más estables, pero tardan más") },
      BENCHMARK_QUIET_SECONDS: { label: t("Espera sin actividad (s)"), hint: t("Tiempo sin uso antes de lanzar benchmarks automáticos") },
    } },
    { title: t("Chatbot y perfiles"), items: {
      ASSISTANT_ENABLED: { label: t("Chatbot de MyDGX"), hint: t("Asistente operativo del panel") },
      ASSISTANT_MODEL: { label: t("Modelo del chatbot"), hint: t("Nombre exacto en Ollama, por ejemplo llama3.2:3b") },
      ENABLE_PROFILE_AUTOSTART: { label: t("Restaurar perfiles al arrancar"), hint: t("Vuelve a encender los perfiles activos tras reiniciar MyDGX") },
      DEFAULT_PROFILE_ID: { label: t("Perfil predeterminado"), hint: t("ID del perfil que se activa al arrancar; vacío para ninguno") },
      PROFILE_START_TIMEOUT_SECONDS: { label: t("Tiempo máximo de arranque (s)"), hint: t("Espera máxima a que un modelo responda al encenderlo") },
    } },
    { title: t("Sesión y retención"), items: {
      MYDGX_SESSION_TTL_MINUTES: { label: t("Cierre por inactividad (min)"), hint: t("La sesión se renueva mientras usas el dashboard; se cierra tras este tiempo sin actividad") },
      MYDGX_SESSION_MAX_HOURS: { label: t("Duración máxima de la sesión (h)"), hint: t("Tras este tiempo desde que entras hay que volver a escribir la contraseña, aunque sigas trabajando") },
      METRICS_RETENTION_HOURS: { label: t("Retención de métricas (h)"), hint: t("Telemetría que se conserva en la base de datos") },
      LOG_RETENTION_DAYS: { label: t("Retención de logs (días)"), hint: t("Eventos y auditoría que se conservan") },
    } },
  ];
}

function ServerSettingsCard({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const [env, setEnv] = useState<EnvSettings | null>(null);
  const [draft, setDraft] = useState<Record<string, boolean | number | string>>({});
  const [token, setToken] = useState("");
  const [tokenStatus, setTokenStatus] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "token" | "verify" | "clear">("");
  const [typedConfirmations, setTypedConfirmations] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const result = await api<EnvSettings>("/api/settings/env");
      setEnv(result);
      setDraft(Object.fromEntries(result.settings.map((item) => [item.key, item.value])));
      setTypedConfirmations({});
    } catch (error) {
      notify((error as Error).message, true);
    }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const changed = env ? env.settings.filter((item) => draft[item.key] !== item.value) : [];
  const needsConfirmation = (item: EnvSettings["settings"][number]) => Boolean(item.confirm) && draft[item.key] === true && item.value !== true;

  async function submit(body: Record<string, unknown>, mode: typeof busy) {
    setBusy(mode);
    try {
      const result = await api<EnvSettingsUpdate>("/api/settings/env", { method: "PUT", body: JSON.stringify(body) });
      setEnv(result);
      setDraft(Object.fromEntries(result.settings.map((item) => [item.key, item.value])));
      setTypedConfirmations({});
      return result;
    } catch (error) {
      notify((error as Error).message, true);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function saveValues(event: FormEvent) {
    event.preventDefault();
    if (!changed.length) return;
    const confirmations: Record<string, string> = {};
    for (const item of changed) {
      if (!item.confirm || !needsConfirmation(item)) continue;
      if ((typedConfirmations[item.key] ?? "").trim() !== item.confirm) {
        notify(t("Para activar {key} escribe {phrase} en el campo de confirmación", { key: item.key, phrase: item.confirm }), true);
        return;
      }
      confirmations[item.key] = item.confirm;
    }
    const result = await submit({ values: Object.fromEntries(changed.map((item) => [item.key, draft[item.key]])), confirmations }, "save");
    if (!result) return;
    notify(result.restart_required.length
      ? t("Guardado en .env. {keys} se aplicará al reiniciar MyDGX", { keys: result.restart_required.join(", ") })
      : t("Guardado en .env y aplicado"));
  }

  async function saveToken(event: FormEvent) {
    event.preventDefault();
    if (!token.trim()) return;
    const result = await submit({ hf_token: token.trim() }, "token");
    if (!result) return;
    setToken("");
    setTokenStatus(result.hf_user ? t("Válido · cuenta {user}", { user: result.hf_user }) : t("Válido"));
    notify(t("Token de Hugging Face guardado"));
  }

  async function clearToken() {
    if (!window.confirm(t("¿Quitar el token de Hugging Face? Los repositorios restringidos dejarán de poder descargarse."))) return;
    const result = await submit({ clear_hf_token: true }, "clear");
    if (!result) return;
    setTokenStatus("");
    notify(t("Token de Hugging Face eliminado; solo se podrán descargar modelos públicos"));
  }

  async function verifyToken() {
    setBusy("verify");
    try {
      const result = await api<{ configured: boolean; valid: boolean; user: string }>("/api/settings/hf-token/verify", { method: "POST" });
      setTokenStatus(!result.configured ? t("Sin token") : result.user ? t("Válido · cuenta {user}", { user: result.user }) : t("Válido"));
    } catch (error) {
      setTokenStatus((error as Error).message);
    } finally {
      setBusy("");
    }
  }

  const byKey = new Map((env?.settings ?? []).map((item) => [item.key, item]));
  return <Card className="server-settings">
    <div className="card-kicker"><SlidersHorizontal size={16} />{" "}{t("Servidor · .env")}</div>
    <p className="server-settings-intro">{t("Se guardan en el .env del equipo. La autenticación y la exposición en red solo se cambian a mano en ese archivo; activar una operación privilegiada pide escribir una confirmación y queda auditado.")}</p>
    <form className="server-settings-token" onSubmit={saveToken}>
      <div><KeyRound size={16} /><span><strong>{t("Token de Hugging Face")}</strong><small>{env?.hf_token_configured ? t("Configurado · no se muestra nunca") : t("Sin token · solo modelos públicos")}{tokenStatus ? ` · ${tokenStatus}` : ""}</small></span></div>
      <div className="inline-form">
        <input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={env?.hf_token_configured ? t("Nuevo token hf_…") : "hf_…"} autoComplete="off" spellCheck={false} aria-label={t("Token de Hugging Face")} />
        <button className="button primary" type="submit" disabled={!token.trim() || Boolean(busy)}>{busy === "token" ? t("Comprobando…") : t("Guardar token")}</button>
        <button className="button secondary" type="button" disabled={!env?.hf_token_configured || Boolean(busy)} onClick={() => void verifyToken()}>{busy === "verify" ? t("Comprobando…") : t("Comprobar")}</button>
        <button className="button danger" type="button" disabled={!env?.hf_token_configured || Boolean(busy)} onClick={() => void clearToken()}>{t("Quitar")}</button>
      </div>
    </form>
    {env && <form className="server-settings-form" onSubmit={saveValues}>
      {envSettingGroups().map((group) => <fieldset key={group.title}>
        <legend>{group.title}</legend>
        {Object.entries(group.items).map(([key, meta]) => {
          const item = byKey.get(key);
          if (!item) return null;
          const value = draft[key];
          const confirmPending = needsConfirmation(item);
          const confirmMatches = (typedConfirmations[key] ?? "").trim() === item.confirm;
          return <div key={key} className="server-setting-wrap">
            <label className={`server-setting ${item.type === "bool" ? "is-toggle" : ""}`}>
              <span><strong>{meta.label}{item.restart && <em>{t("requiere reinicio")}</em>}</strong><small>{meta.hint}</small></span>
              {item.type === "bool"
                ? <input type="checkbox" checked={Boolean(value)} onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })} />
                : item.type === "int"
                  ? <input type="number" min={item.min ?? undefined} max={item.max ?? undefined} value={Number(value)} onChange={(event) => setDraft({ ...draft, [key]: Math.trunc(Number(event.target.value)) })} />
                  : <input type="text" value={String(value ?? "")} spellCheck={false} onChange={(event) => setDraft({ ...draft, [key]: event.target.value.trim() })} />}
            </label>
            {confirmPending && <div className={`server-setting-confirm ${confirmMatches ? "ok" : ""}`}>
              <TriangleAlert size={14} />
              <span>{t("Se ejecuta como root. Escribe {phrase} para confirmarlo:", { phrase: item.confirm })}</span>
              <input
                type="text"
                value={typedConfirmations[key] ?? ""}
                onChange={(event) => setTypedConfirmations({ ...typedConfirmations, [key]: event.target.value })}
                placeholder={item.confirm ?? ""}
                autoComplete="off"
                spellCheck={false}
                aria-label={t("Confirmación para activar {key}", { key })}
              />
            </div>}
          </div>;
        })}
      </fieldset>)}
      <div className="gateway-actions">
        <small>{changed.length ? t("{count} cambio(s) sin guardar", { count: changed.length }) : t("Sin cambios")}</small>
        <button className="button secondary" type="button" disabled={!changed.length || Boolean(busy)} onClick={() => env && setDraft(Object.fromEntries(env.settings.map((item) => [item.key, item.value])))}>{t("Descartar")}</button>
        <button className="button primary" type="submit" disabled={!changed.length || Boolean(busy)}>{busy === "save" ? t("Guardando…") : t("Guardar en .env")}</button>
      </div>
    </form>}
  </Card>;
}

function SettingsView({ config, themePreference, setThemePreference, notify }: { config: Config | null; themePreference: ThemePreference; setThemePreference: (preference: ThemePreference) => void; notify: (message: string, error?: boolean) => void }) {
  const [languagePreference, setLanguageChoice] = useState<LanguagePreference>(storedLanguagePreference);
  const chooseLanguage = (preference: LanguagePreference) => {
    setLanguageChoice(preference);
    setLanguagePreference(preference);
  };
  const [key, setKey] = useState(getApiKey());
  const [gateway, setGateway] = useState<GatewayConfig | null>(null);
  useEffect(() => {
    api<GatewayConfig>("/api/gateway/config").then(setGateway).catch((error) => notify(error.message, true));
  }, [notify]);

  function saveKey() {
    if (key) sessionStorage.setItem("mydgx-api-key", key);
    else sessionStorage.removeItem("mydgx-api-key");
    notify(t("Clave guardada solo durante esta sesión"));
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
          web_search: gateway.web_search !== false,
        }),
      });
      notify(t("Gateway actualizado. La búsqueda web se aplica al momento y OpenCode la toma al volver a abrirse. Host, puerto o activación requieren ./start.sh restart."));
      setGateway(await api<GatewayConfig>("/api/gateway/config"));
    } catch (error) {
      notify((error as Error).message, true);
    }
  }

  return (
    <div className="view-stack settings-view">
      <SectionHeading eyebrow={t("PREFERENCIAS")} title={t("Configuración")} />
      <Card>
        <div className="settings-row"><div><Sun /><span><strong>{t("Apariencia")}</strong><small>{t("Sigue el modo del sistema o fija día o noche")}</small></span></div><div className="segmented theme-preference"><button className={themePreference === "system" ? "active" : ""} onClick={() => setThemePreference("system")}>{t("Automático")}</button><button className={themePreference === "light" ? "active" : ""} onClick={() => setThemePreference("light")}>{t("Día")}</button><button className={themePreference === "dark" ? "active" : ""} onClick={() => setThemePreference("dark")}>{t("Noche")}</button></div></div>
        <div className="settings-row"><div><Languages /><span><strong>{t("Idioma")}</strong><small>{languagePreference === "system" ? t("Según el navegador: {language}", { language: language === "es" ? "Español" : "English" }) : t("Idioma fijo para este navegador")}</small></span></div><div className="segmented theme-preference"><button className={languagePreference === "system" ? "active" : ""} onClick={() => chooseLanguage("system")}>{t("Automático")}</button><button className={languagePreference === "es" ? "active" : ""} onClick={() => chooseLanguage("es")}>{t("Español")}</button><button className={languagePreference === "en" ? "active" : ""} onClick={() => chooseLanguage("en")}>{t("English")}</button></div></div>
        <div className="settings-row"><div><ShieldCheck /><span><strong>{t("Clave de acceso MyDGX")}</strong><small>{t("Se guarda únicamente en sessionStorage")}</small></span></div><div className="inline-form"><input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={config?.api_key_required ? t("Clave requerida") : t("No configurada")} autoComplete="off" /><button className="button secondary" onClick={saveKey}>{t("Guardar")}</button></div></div>
      </Card>
      <Card>
        <div className="card-kicker"><Activity size={16} />{" "}{t("Integraciones")}</div>
        <div className="integration-list">
          <div><span><strong>{t("Actualizaciones")}</strong><small>{t("Operación privilegiada controlada")}</small></span><span className={`badge ${config?.system_updates_enabled ? "live" : ""}`}>{config?.system_updates_enabled ? t("Activadas") : t("Bloqueadas")}</span></div>
          <div><span><strong>{t("Firmware")}</strong><small>{t("fwupd con orden permitida")}</small></span><span className={`badge ${config?.firmware_updates_enabled ? "live" : ""}`}>{config?.firmware_updates_enabled ? t("Activado") : t("Bloqueado")}</span></div>
          <div><span><strong>{t("Servicios")}</strong><small>{t("systemd con lista permitida")}</small></span><span className={`badge ${config?.service_control_enabled ? "live" : ""}`}>{config?.service_control_enabled ? t("Activado") : t("Solo lectura")}</span></div>
        </div>
      </Card>
      <ServerSettingsCard notify={notify} />
      <Card className="gateway-settings">
        <div className="gateway-settings-head">
          <div><Bot size={17} /><span><strong>{t("Gateway OpenAI del perfil activo")}</strong><small>{gateway?.endpoint ?? config?.gateway_url ?? t("Cargando…")}</small></span></div>
          <span className={`badge ${gateway?.running ? "live" : ""}`}>{gateway?.running ? t("En línea") : gateway?.enabled ? t("Reinicio pendiente") : t("Desactivado")}</span>
        </div>
        {gateway && <form onSubmit={saveGateway}>
          <label className="checkbox"><input type="checkbox" checked={gateway.enabled} onChange={(event) => setGateway({ ...gateway, enabled: event.target.checked })} /><span>{t("Activar gateway al arrancar MyDGX")}</span></label>
          <label className="checkbox"><input type="checkbox" checked={gateway.web_search !== false} onChange={(event) => setGateway({ ...gateway, web_search: event.target.checked })} /><span>{t("Búsqueda web para OpenCode, con SearXNG local. Activada por defecto; no requiere reiniciar.")}</span></label>
          <label>{t("Escucha")}<select value={gateway.host} onChange={(event) => setGateway({ ...gateway, host: event.target.value as GatewayConfig["host"] })}><option value="127.0.0.1">{t("Solo localhost (recomendado)")}</option><option value="::1">{t("Solo localhost IPv6")}</option><option value="0.0.0.0">{t("Toda la red IPv4")}</option><option value="::">{t("Toda la red IPv6")}</option></select></label>
          <label>{t("Puerto")}<input type="number" min={1024} max={65535} value={gateway.port} onChange={(event) => setGateway({ ...gateway, port: Number(event.target.value) })} /></label>
          <label>{t("Timeout de inferencia (s)")}<input type="number" min={10} max={7200} value={gateway.request_timeout_seconds} onChange={(event) => setGateway({ ...gateway, request_timeout_seconds: Number(event.target.value) })} /></label>
          <label>{t("Petición máxima (MiB)")}<input type="number" min={1} max={256} value={gateway.max_request_mb} onChange={(event) => setGateway({ ...gateway, max_request_mb: Number(event.target.value) })} /></label>
          <div className="gateway-profile-summary">
            <span><small>{t("Perfil proxy")}</small><strong>{gateway.active_profile ?? t("Ningún perfil activo")}</strong></span>
            <span><small>{t("Autenticación")}</small><strong>{gateway.api_key_configured ? t("Bearer configurado en .env") : t("Sin clave · solo localhost")}</strong></span>
            <span><small>{t("Adaptador de protocolos")}</small><strong>{gateway.protocol_adapter ? `LiteLLM ${gateway.protocol_adapter}` : t("No disponible")}</strong></span>
            <span><small>{t("Búsqueda web")}</small><strong>{gateway.web_search !== false ? t("Activada · SearXNG") : t("Desactivada")}</strong></span>
            <span className="gateway-aliases"><small>{t("Modelos publicados · nombre completo y alias para el campo model")}</small><GatewayModelList gateway={gateway} empty={t("Ninguno configurado")} /></span>
          </div>
          <div className="gateway-actions"><small>{t("OpenAI:")}{" "}{gateway.endpoint}{" "}{t("· Anthropic:")}{" "}{gateway.anthropic_endpoint}</small></div>
          <div className="gateway-actions"><small>{t("Los cambios de host, puerto o activación requieren reiniciar MyDGX.")}</small><button className="button primary" type="submit">{t("Guardar gateway")}</button></div>
        </form>}
      </Card>
      <div className="security-note"><ShieldCheck /><div><strong>{t("Diseñado para mantener los secretos en el servidor")}</strong><p>{t("Las claves de Hugging Face y servicios nunca se devuelven al navegador, a los logs ni a SQLite.")}</p></div></div>
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
    <div className="font-scale" role="group" aria-label={t("Tamaño de letra")}>
      <button type="button" aria-label={t("Reducir tamaño de letra")} onPointerDown={(event) => startHolding(-1, event)} onPointerUp={stop} onPointerCancel={stop}>−</button>
      <span className="font-scale-mark" aria-hidden="true"><span>A</span><span>A</span></span>
      <button type="button" aria-label={t("Aumentar tamaño de letra")} onPointerDown={(event) => startHolding(1, event)} onPointerUp={stop} onPointerCancel={stop}>+</button>
    </div>
  );
}

export default function App({ onLogout }: { onLogout?: () => void }) {
  const [themePreference, setThemePreference] = useState<ThemePreference>(storedThemePreference);
  const [systemTheme, setSystemTheme] = useState<Theme>(readSystemTheme);
  const theme = useMemo(() => resolveTheme(themePreference, systemTheme), [themePreference, systemTheme]);
  const [fontScale, setFontScale] = useState(() => {
    const scale = storedFontScale();
    applyFontScale(scale);
    return scale;
  });
  const [view, setView] = useState<View>(() => {
    const stored = localStorage.getItem("mydgx-view");
    return navItems.some((item) => item.id === stored) || stored === "multimodal" ? stored as View : "dashboard";
  });
  const [chatOpen, setChatOpen] = useState(() => localStorage.getItem("mydgx-chat-open") === "1");
  const [chatMounted, setChatMounted] = useState(chatOpen);
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

  const [notifications, setNotifications] = useState<NotificationsResponse | null>(null);
  const [notificationPopup, setNotificationPopup] = useState<AppNotification | null>(null);
  const [systemTabRequest, setSystemTabRequest] = useState<"overview" | "health">("overview");
  const openHealthCenter = useCallback(() => {
    setSystemTabRequest("health");
    setView("system");
    window.scrollTo({ top: 0 });
  }, []);
  const lastNotificationId = useRef<number | null>(null);
  const popupTimer = useRef<number | undefined>(undefined);
  const refreshNotifications = useCallback(async () => {
    try {
      const result = await api<NotificationsResponse>("/api/notifications?limit=100");
      setNotifications(result);
      const newest = result.items[0]?.id ?? 0;
      if (lastNotificationId.current !== null) {
        const arrived = result.items.find((item) => item.id > (lastNotificationId.current ?? 0) && !item.read_at);
        if (arrived) {
          setNotificationPopup(arrived);
          window.clearTimeout(popupTimer.current);
          popupTimer.current = window.setTimeout(() => setNotificationPopup(null), 4000);
        }
      }
      lastNotificationId.current = Math.max(lastNotificationId.current ?? 0, newest);
    } catch {
      // The header bell is secondary; the main views already report connection errors.
    }
  }, []);
  const readNotifications = useCallback(async (ids: number[] | "all") => {
    try {
      const result = await api<{ unread: number }>("/api/notifications/read", {
        method: "POST",
        body: JSON.stringify(ids === "all" ? { all: true } : { ids }),
      });
      const readAt = new Date().toISOString();
      setNotifications((current) => current && {
        unread: result.unread,
        items: current.items.map((item) => (ids === "all" || ids.includes(item.id)) && !item.read_at ? { ...item, read_at: readAt } : item),
      });
    } catch (requestError) {
      notify((requestError as Error).message, true);
    }
  }, [notify]);
  useEffect(() => {
    const initial = window.setTimeout(() => void refreshNotifications(), 0);
    const timer = window.setInterval(refreshNotifications, 5000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.clearTimeout(popupTimer.current);
    };
  }, [refreshNotifications]);

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
    const media = matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => setSystemTheme(media.matches ? "dark" : "light");
    syncSystemTheme();
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("mydgx-theme-preference", themePreference);
    localStorage.removeItem("mydgx-theme");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0b0d0c" : "#f4f6f3");
  }, [theme, themePreference]);

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

  const [pendingBenchmarks, setPendingBenchmarks] = useState(0);
  const benchmarkInventorySignature = jobs
    .filter((job) => (job.kind.startsWith("benchmark.") || downloadJobKinds.has(job.kind) || job.kind.startsWith("models.")) && !activeJobStatuses.has(job.status))
    .map((job) => job.id)
    .join("|");
  useEffect(() => {
    const load = () => {
      api<{ pending: number }>("/api/benchmarks/pending").then((data) => setPendingBenchmarks(data.pending)).catch(() => undefined);
    };
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [benchmarkInventorySignature]);

  useEffect(() => {
    localStorage.setItem("mydgx-view", view);
  }, [view]);
  useEffect(() => {
    localStorage.setItem("mydgx-chat-open", chatOpen ? "1" : "0");
    if (!chatOpen) return;
    setChatMounted(true);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setChatOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [chatOpen]);
  useEffect(() => {
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
    profiles: { value: runningProfileTotal, title: t(runningProfileTotal === 1 ? "{count} perfil levantado" : "{count} perfiles levantados", { count: runningProfileTotal }) },
    models: { value: loadedModelTotal, title: t(loadedModelTotal === 1 ? "{count} modelo cargado" : "{count} modelos cargados", { count: loadedModelTotal }) },
    benchmarks: { value: pendingBenchmarks, title: t(pendingBenchmarks === 1 ? "{count} benchmark pendiente" : "{count} benchmarks pendientes", { count: pendingBenchmarks }) },
  };
  const currentLabel = useMemo(() => view === "multimodal" ? t("Laboratorio IA") : navItems.find((item) => item.id === view)?.label ?? "MyDGX", [view]);
  const benchmarkSuiteJob = jobs.find(
    (job) => job.kind === "benchmark.suite" && activeJobStatuses.has(job.status),
  );
  function toggleTheme() {
    setThemePreference(theme === "dark" ? "light" : "dark");
  }

  let content: ReactNode;
  if (view === "dashboard") content = <Dashboard overview={overview} models={models} modelMetrics={modelMetrics} config={config} jobs={jobs} />;
  else if (view === "models") content = <ModelsView models={models} overview={overview} modelMetrics={modelMetrics} jobs={jobs} refresh={refreshModels} notify={notify} />;
  else if (view === "benchmarks") content = <BenchmarksView jobs={jobs} notify={notify} />;
  else if (view === "profiles") content = <ProfilesView jobs={jobs} notify={notify} />;
  else if (view === "engines") content = <EnginesView notify={notify} />;
  else if (view === "multimodal") content = <MultimodalLabView notify={notify} />;
  else if (view === "storage") content = <StorageView notify={notify} />;
  else if (view === "system") content = <SystemView key={systemTabRequest} config={config} jobs={jobs} overview={overview} notify={notify} initialTab={systemTabRequest} onOpenLab={() => { setView("multimodal"); window.scrollTo({ top: 0 }); }} />;
  else if (view === "logs") content = <LogsView notify={notify} notifications={notifications} onReadNotifications={readNotifications} onOpenHealth={openHealthCenter} />;
  else content = <SettingsView config={config} themePreference={themePreference} setThemePreference={setThemePreference} notify={notify} />;

  return (
    <div className="app-shell">
      <aside className={menuOpen ? "open" : ""}>
        <div className="brand"><Logo /><div><strong>MyDGX</strong><span>{t("SPARK CONTROL")}</span></div><button className="mobile-close" onClick={() => setMenuOpen(false)}><X /></button></div>
        <nav>
          <span className="nav-label">{t("MENÚ PRINCIPAL")}</span>
          {navItems.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => { setView(item.id); setSystemTabRequest("overview"); setMenuOpen(false); }}><Icon size={18} /><span>{item.label}</span>{navCounts[item.id]?.value ? <b className="nav-count" title={navCounts[item.id]?.title} aria-label={navCounts[item.id]?.title}>{navCounts[item.id]?.value}</b> : null}{item.id === "benchmarks" && benchmarkSuiteJob ? <b className="nav-running-dot" title={t("Suite {progress}%", { progress: Math.round(benchmarkSuiteJob.progress) })} /> : null}{view === item.id && <ChevronRight size={14} />}</button>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="device-mini">
            <div className="device-image"><Cpu /></div>
            <div><strong>{overview ? (overview.host.is_dgx_spark ? overview.host.device_model : overview.host.hostname) : t("Detectando equipo")}</strong><span><StatusDot online={Boolean(overview)} /> {overview ? `${overview.host.is_dgx_spark ? "DGX Spark / GB10" : t("No DGX Spark")} · ${overview.host.is_dgx_os ? "DGX OS" : overview.host.os_family}` : t("Conectando")}</span></div>
            {overview?.running_profiles?.length ? (
              <button className="device-profiles" onClick={() => { setView("profiles"); setMenuOpen(false); }} title={t("Ver perfiles")}>
                <small>{overview.running_profiles.length === 1 ? t("Perfil activo") : t("Perfiles activos")}</small>
                {overview.running_profiles.map((profile) => (
                  <div key={profile.id}>
                    <span>
                      <SlidersHorizontal size={11} />
                      <ProfileName name={profile.name} as="b" />
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
      {menuOpen && <button className="backdrop" onClick={() => setMenuOpen(false)} aria-label={t("Cerrar menú")} />}
      <main>
        <header>
          <button className="menu-button" onClick={() => setMenuOpen(true)}><Menu /></button>
          <span>{currentLabel}</span>
          <div className="appearance-row">
            {hasActiveModels && <StopAllModelsButton notify={notify} onDone={() => { void refreshOverview(); void refreshModels(); }} />}
            <div className="header-prefs" role="group" aria-label={t("Apariencia")}>
              <button className="header-pref theme-toggle" onClick={toggleTheme} title={`${theme === "dark" ? t("Modo día") : t("Modo noche")} · ${themePreference === "system" ? t("Tema automático según el sistema") : t("Tema fijo")}`} aria-label={theme === "dark" ? t("Modo día") : t("Modo noche")}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</button>
              <FontSizeControl onChange={setFontScale} />
              <button className="header-pref language-toggle" onClick={() => setLanguagePreference(language === "es" ? "en" : "es")} title={language === "es" ? t("Switch to English") : t("Cambiar a español")} aria-label={language === "es" ? t("Switch to English") : t("Cambiar a español")}><Languages size={15} /><span>{language.toUpperCase()}</span></button>
            </div>
            <button
              className={`header-icon-button chat-toggle ${chatOpen ? "active" : ""}`}
              onClick={() => setChatOpen((open) => !open)}
              title={chatOpen ? t("Cerrar asistente") : t("Abrir asistente")}
              aria-label={chatOpen ? t("Cerrar asistente") : t("Abrir asistente")}
              aria-expanded={chatOpen}
              aria-controls="chat-dock"
            ><Bot size={17} /></button>
            <NotificationBell
              unread={notifications?.unread ?? 0}
              popup={notificationPopup}
              onOpen={() => {
                const popupKind = notificationPopup?.kind;
                setNotificationPopup(null);
                setMenuOpen(false);
                if (popupKind === "health.alert") openHealthCenter();
                else setView("logs");
                window.scrollTo({ top: 0 });
              }}
            />
            {onLogout && <button className="header-icon-button session-logout" onClick={onLogout} title={t("Cerrar sesión")} aria-label={t("Cerrar sesión")}><LogOut size={16} /></button>}
          </div>
        </header>
        {error && <div className="error-banner"><ShieldCheck size={18} /><span>{error}</span><button onClick={() => { void refreshOverview(); void refreshCore(); void refreshModels(); }}>{t("Reintentar")}</button></div>}
        <div className="content">{content}</div>
      </main>
      {chatMounted && <div id="chat-dock" className="chat-dock" role="dialog" aria-label={t("MyDGX Copilot")} hidden={!chatOpen}>
        <ChatView models={models} config={config} notify={notify} onClose={() => setChatOpen(false)} />
      </div>}
      {toast && <div className={`toast ${toast.error ? "error" : ""}`}>{toast.error ? <ShieldCheck /> : <Sparkles />}<span>{toast.message}</span></div>}
    </div>
  );
}
