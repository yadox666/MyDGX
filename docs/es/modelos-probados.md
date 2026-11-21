# Modelos soportados y probados

<p align="center">
  <strong>Qué modelos funcionan de verdad en un DGX Spark y cuál elegir para cada tarea.</strong><br>
  <sub>Resultados medidos con los Benchmarks de MyDGX en un NVIDIA DGX Spark (GB10, 128 GB de memoria unificada) · 19 de noviembre de 2026</sub>
</p>

<p align="center">
  <strong>32 modelos medidos</strong> ·
  <strong>23 de texto</strong> ·
  <strong>5 de voz sintética</strong> ·
  <strong>2 de transcripción</strong> ·
  <strong>1 de imagen</strong> ·
  <strong>1 de visión</strong>
</p>

Todas las cifras de esta página salen de ejecutar cada modelo en el propio Spark,
de uno en uno y con las mismas pruebas. No son datos de catálogo ni estimaciones.

- [¿Cuál elijo?](#cuál-elijo)
- [Cómo leer las tablas](#cómo-leer-las-tablas)
- [Ranking de modelos de texto](#ranking-de-modelos-de-texto)
- [Voz, imagen y visión](#voz-imagen-y-visión)
- [Glosario rápido](#glosario-rápido)
- [Cómo se ha medido](#cómo-se-ha-medido)

## ¿Cuál elijo?

| Si quieres… | Prueba | Por qué |
|---|---|---|
| ⚡ **Respuestas al instante** | [llama3.2:3b](https://ollama.com/library/llama3.2) | 98 tokens por segundo y ocupa solo 2 GB. Ideal para dudas rápidas. |
| 🧠 **Un buen asistente para todo** | [Kimi-Linear-48B-A3B-Instruct](https://huggingface.co/bartowski/moonshotai_Kimi-Linear-48B-A3B-Instruct-GGUF) | El mejor equilibrio entre inteligencia y velocidad: 47 tok/s con un modelo de 48B. |
| 💻 **Programar** | [Cyber-Tiel-Coder-35B-A3B](https://huggingface.co/peculiar-ragdoll/Cyber-Tiel-Coder-35B-A3B-GGUF) | Pensado para código; rápido (45 tok/s) y cabe sobrado (32 GB). |
| 🛡️ **Ciberseguridad** | [BaronLLM (Llama 3.1 8B)](https://huggingface.co/AlicanKiraz0/Cybersecurity-BaronLLM_Offensive_Security_LLM_Q6_K_GGUF) | Especializado en seguridad ofensiva, ligero (6,6 GB) y fluido. |
| 🏋️ **El modelo más potente que cabe** | [gpt-oss-120b-Derestricted](https://huggingface.co/gghfez/gpt-oss-120b-Derestricted.MXFP4_MOE-gguf) | 117B de parámetros y aun así 41 tok/s gracias a su arquitectura MoE. |
| 🎙️ **Transcribir audio** | [whisper-large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo) | Transcribe 12 s de audio en 0,16 s. |
| 🗣️ **Convertir texto en voz** | [OmniVoice](https://huggingface.co/k2-fsa/OmniVoice) | Voz perfectamente inteligible y la más rápida de las probadas. |
| 🎨 **Generar imágenes** | [FLUX.1 Schnell FP8](https://huggingface.co/Comfy-Org/flux1-schnell) | Una imagen en 1 segundo, siempre igual con la misma semilla. |

> [!TIP]
> Si no sabes por dónde empezar, enciende **Kimi-Linear-48B-A3B-Instruct** desde
> *Modelos* y pruébalo en *Chat*. Si va justo de memoria porque tienes otros
> modelos cargados, usa **llama3.2:3b**.

## Cómo leer las tablas

| Columna | Qué significa | ¿Qué es bueno? |
|---|---|---|
| **Score** | Nota MyDGX de 0 a 100 que combina velocidad, rapidez de la primera respuesta, estabilidad y fiabilidad. | Cuanto más alto, mejor. |
| **Velocidad** | Tokens por segundo (tok/s). Un token es, más o menos, media palabra. | 🟢 40 o más: instantáneo · 🟡 15–40: fluido · 🟠 6–15: se lee cómodo · 🔴 menos de 6: lento |
| **Primera respuesta** | Cuánto tarda en empezar a escribir después de enviar la pregunta. | Menos de 0,5 s se nota inmediato. |
| **Tamaño** | Lo que ocupa el modelo en disco. Necesita más o menos lo mismo en memoria, más un poco para el contexto. | El Spark tiene 128 GB; deja margen para el sistema. |
| **Parámetros** | El "tamaño del cerebro" del modelo. En los MoE solo trabaja una parte (los *activos*) en cada palabra. | Más parámetros suele dar más calidad; pocos activos dan más velocidad. |
| **Cuantización** | Cuánto se ha comprimido el modelo para que quepa. | `Q8_0` casi no pierde calidad; `Q4` y `IQ3` comprimen más. |

## Ranking de modelos de texto

Modelos de chat, programación y razonamiento ordenados por score MyDGX.

| # | Modelo | Score | Velocidad (tok/s) | Primera respuesta | Tamaño | Parámetros | Cuantización | Origen |
|:-:|---|:-:|---|:-:|:-:|---|:-:|:-:|
| 🥇 | **[llama3.2:3b](https://ollama.com/library/llama3.2)**<br><sub>Asistente rápido para tareas sencillas (es el modelo del asistente MyDGX)</sub> | **99** | 🟢 98,0<br><sub>▰▰▰▰▰▰▰▰▰▰</sub> | 0,04 s | 2,0 GB | 3B | `Q4_K_M` | Ollama |
| 🥈 | **[deepseek-coder:6.7b](https://ollama.com/library/deepseek-coder)**<br><sub>Programación ligera y autocompletado</sub> | **95** | 🟢 58,6<br><sub>▰▰▰▰▰▰▱▱▱▱</sub> | 0,04 s | 3,8 GB | 6,7B | `Q4_0` | Ollama |
| 🥉 | **[Kimi-Linear-48B-A3B-Instruct](https://huggingface.co/bartowski/moonshotai_Kimi-Linear-48B-A3B-Instruct-GGUF)**<br><sub>Asistente general con contexto muy largo</sub> | **93** | 🟢 47,5<br><sub>▰▰▰▰▰▱▱▱▱▱</sub> | 0,07 s | 40,6 GB | 48B · 3B activos | `Q6_K_L` | Hugging Face |
| 4 | **[Cyber-Tiel-Coder-35B-A3B](https://huggingface.co/peculiar-ragdoll/Cyber-Tiel-Coder-35B-A3B-GGUF)**<br><sub>Programación y ciberseguridad, sin censura</sub> | **93** | 🟢 44,8<br><sub>▰▰▰▰▱▱▱▱▱▱</sub> | 0,07 s | 31,8 GB | 35B · 3B activos | `UD-Q6_K_XL` | Hugging Face |
| 5 | **[gpt-oss-120b-Derestricted](https://huggingface.co/gghfez/gpt-oss-120b-Derestricted.MXFP4_MOE-gguf)**<br><sub>Generalista grande de OpenAI, sin restricciones</sub> | **90** | 🟢 41,0<br><sub>▰▰▰▰▱▱▱▱▱▱</sub> | 0,18 s | 63,4 GB | 116,8B · 5,1B activos | `MXFP4` | Hugging Face |
| 6 | **[BaronLLM (Llama 3.1 8B)](https://huggingface.co/AlicanKiraz0/Cybersecurity-BaronLLM_Offensive_Security_LLM_Q6_K_GGUF)**<br><sub>Ciberseguridad ofensiva</sub> | **88** | 🟡 25,3<br><sub>▰▰▰▱▱▱▱▱▱▱</sub> | 0,08 s | 6,6 GB | 8B | `Q6_K` | Hugging Face |
| 7 | **[Qwen3.8-Flash-Next abliterated](https://huggingface.co/SC117/Qwen3.8-Flash-Next-GSQ-RCO-abliterated-GGUF)**<br><sub>Generalista grande, sin censura</sub> | **88** | 🟡 25,5<br><sub>▰▰▰▱▱▱▱▱▱▱</sub> | 0,11 s | 76,1 GB | MoE · n/d | `IQ3_XXS` | Hugging Face |
| 8 | **[Bimo-7B-CyberAgent](https://huggingface.co/mradermacher/Bimo-7B-CyberAgent-GGUF)**<br><sub>Agente de ciberseguridad ligero</sub> | **87** | 🟡 21,0<br><sub>▰▰▱▱▱▱▱▱▱▱</sub> | 0,07 s | 8,1 GB | 7B | `Q8_0` | Hugging Face |
| 9 | **[Qwen3.8-Flash-Next](https://huggingface.co/unsloth/Qwen3.8-Flash-Next-GGUF)**<br><sub>Generalista grande</sub> | **87** | 🟡 25,5<br><sub>▰▰▰▱▱▱▱▱▱▱</sub> | 0,19 s | 83,6 GB | MoE · n/d | `UD-IQ3_XXS` | Hugging Face |
| 10 | **[Qwen3-14B-BaronLLM-v2](https://huggingface.co/AlicanKiraz0/Qwen3-14B-BaronLLM-v2-Q4_0-GGUF)**<br><sub>Ciberseguridad ofensiva</sub> | **86** | 🟡 19,2<br><sub>▰▰▱▱▱▱▱▱▱▱</sub> | 0,07 s | 8,5 GB | 14B | `Q4_0` | Hugging Face |
| 11 | **[DeepSeek-V4-Pro-Qwen3.5-9B heretic](https://huggingface.co/mradermacher/DeepSeek-V4-Pro-Qwen3.5-9B-UNCENSORED-heretic-GGUF)**<br><sub>Razonamiento compacto, sin censura</sub> | **86** | 🟡 18,1<br><sub>▰▰▱▱▱▱▱▱▱▱</sub> | 0,10 s | 9,8 GB | 9B | `Q8_0` | Hugging Face |
| 12 | **[GLM-5.3-Flash](https://huggingface.co/unsloth/GLM-5.3-Flash-GGUF)**<br><sub>Generalista muy grande</sub> | **83** | 🟡 16,1<br><sub>▰▰▱▱▱▱▱▱▱▱</sub> | 0,20 s | 101,8 GB | MoE · n/d | `UD-IQ2_XXS` | Hugging Face |
| 13 | **[GLM-5.3-Flash Uncensored](https://huggingface.co/BoldingBuilds/orcarouter_GLM-5.3-Flash-Uncensored-GGUF)**<br><sub>Generalista muy grande, sin censura</sub> | **82** | 🟠 12,7<br><sub>▰▱▱▱▱▱▱▱▱▱</sub> | 0,19 s | 97,1 GB | MoE · n/d | `IQ2_XXS` | Hugging Face |
| 14 | **[Gemma-4-12B heretic](https://huggingface.co/igorls/gemma-4-12B-it-heretic-GGUF)**<br><sub>Conversación general, sin censura</sub> | **78** | 🟠 12,4<br><sub>▰▱▱▱▱▱▱▱▱▱</sub> | 0,43 s | 12,7 GB | 12B | `Q8_0` | Hugging Face |
| 15 | **[Qwen3.8-27B abliterated](https://huggingface.co/Blackfrost-AI/Qwen3.8-27B-ABLITERATED-GGUF)**<br><sub>Generalista mediano, sin censura</sub> | **78** | 🟠 7,4<br><sub>▰▱▱▱▱▱▱▱▱▱</sub> | 0,21 s | 22,4 GB | 27B | `Q6_K` | Hugging Face |
| 16 | **[Dolphin-Mistral-24B Venice](https://huggingface.co/bartowski/cognitivecomputations_Dolphin-Mistral-24B-Venice-Edition-GGUF)**<br><sub>Conversación abierta, sin censura</sub> | **78** | 🟠 6,6<br><sub>▰▱▱▱▱▱▱▱▱▱</sub> | 0,18 s | 25,1 GB | 24B | `Q8_0` | Hugging Face |
| 17 | **[Qwen3.8-27B Uncensored Cyber](https://huggingface.co/philbert440/Qwen3.8-27B-Uncensored-Cyber-GGUF)**<br><sub>Ciberseguridad, sin censura</sub> | **77** | 🟠 6,9<br><sub>▰▱▱▱▱▱▱▱▱▱</sub> | 0,21 s | 23,7 GB | 27B | `Q6_K` | Hugging Face |
| 18 | **[Qwen3.8-27B](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF)**<br><sub>Generalista mediano</sub> | **77** | 🟠 7,3<br><sub>▰▱▱▱▱▱▱▱▱▱</sub> | 0,22 s | 22,0 GB | 27B | `UD-Q6_K` | Hugging Face |
| 19 | **[Assistant Pepe 70B](https://huggingface.co/bartowski/SicariusSicariiStuff_Assistant_Pepe_70B-GGUF)**<br><sub>Conversación y rol</sub> | **72** | 🔴 3,7<br><sub>▰▱▱▱▱▱▱▱▱▱</sub> | 0,31 s | 44,0 GB | 70B | `Q4_K_M` | Hugging Face |
| 20 | **[Qwen3.8-40B Ultimate Heretic](https://huggingface.co/DavidAU/Qwen3.8-40B-Ultimate-Heretic-Uncensored-Turbo-Brilliance-50x-AGI-NEO-GGUF)**<br><sub>Razonamiento creativo, sin censura</sub> | **71** | 🔴 3,9<br><sub>▰▱▱▱▱▱▱▱▱▱</sub> | 0,39 s | 42,0 GB | 40B | `Q8_0` | Hugging Face |
| 21 | **[Assistant Pepe 70B](https://huggingface.co/bartowski/SicariusSicariiStuff_Assistant_Pepe_70B-GGUF)**<br><sub>Conversación y rol, versión menos comprimida</sub> | **69** | 🔴 2,7<br><sub>▰▱▱▱▱▱▱▱▱▱</sub> | 0,41 s | 60,6 GB | 70B | `Q6_K` | Hugging Face |
| 22 | **[Gemma-4-31B heretic](https://huggingface.co/llmfan46/gemma-4-31B-it-uncensored-heretic-GGUF)**<br><sub>Conversación general, sin censura</sub> | **69** | 🟠 6,3<br><sub>▰▱▱▱▱▱▱▱▱▱</sub> | 0,85 s | 25,2 GB | 31B | `Q6_K` | Hugging Face |
| 23 | **[Kimi-Dev-72B](https://huggingface.co/unsloth/Kimi-Dev-72B-GGUF)**<br><sub>Programación (resolución de issues)</sub> | **68** | 🔴 2,5<br><sub>▰▱▱▱▱▱▱▱▱▱</sub> | 0,42 s | 64,3 GB | 72B | `Q6_K` | Hugging Face |

<sub>La barra de velocidad va de 0 a 100 tok/s. "MoE · n/d": modelo de expertos cuyo
número de parámetros no figura en sus metadatos.</sub>

### Velocidad de los 10 más rápidos

```mermaid
xychart-beta
    title "Tokens por segundo (más es mejor)"
    x-axis ["llama3.2 3B", "deepseek-coder 6.7B", "Kimi-Linear 48B", "Cyber-Tiel 35B", "gpt-oss 120B", "Qwen3.8-Flash abl.", "Qwen3.8-Flash", "BaronLLM 8B", "Bimo 7B", "BaronLLM-v2 14B"]
    y-axis "tok/s" 0 --> 100
    bar [98.0, 58.6, 47.5, 44.8, 41.0, 25.5, 25.5, 25.3, 21.0, 19.2]
```

> [!NOTE]
> **¿Por qué un modelo de 120B va más rápido que uno de 27B?** Los modelos
> **MoE** (como gpt-oss-120b, Kimi-Linear o Cyber-Tiel) solo activan una pequeña
> parte de sus parámetros en cada palabra, así que leen mucha menos memoria. En
> el Spark eso pesa más que el tamaño total: un MoE de 117B con 5B activos va
> más de cinco veces más rápido que un modelo denso de 27B.

## Voz, imagen y visión

### 🎙️ Transcripción de voz (audio a texto)

| # | Modelo | Score | Error de palabras | Tiempo para 12 s de audio | Tamaño |
|:-:|---|:-:|:-:|:-:|:-:|
| 🥇 | **[whisper-large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo)** | **92** | 11 % | 0,16 s (73× más rápido que el audio) | 1,6 GB |
| 🥈 | **[faster-whisper-large-v3-turbo](https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo)** | **92** | 11 % | 0,28 s (42× más rápido que el audio) | 1,6 GB |

### 🗣️ Síntesis de voz (texto a voz)

La inteligibilidad se comprueba transcribiendo la voz generada con Whisper: 100 %
significa que se entendieron todas las palabras.

| # | Modelo | Score | Inteligibilidad | Velocidad | Tamaño |
|:-:|---|:-:|:-:|:-:|:-:|
| 🥇 | **[OmniVoice](https://huggingface.co/k2-fsa/OmniVoice)** | **100** | 100 % | 4× tiempo real | 3,3 GB |
| 🥈 | **[F5-TTS](https://huggingface.co/SWivid/F5-TTS)** | **100** | 100 % | 3,3× tiempo real | 6,7 GB |
| 🥉 | **[Qwen3-TTS-12Hz-1.7B-Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base)** | **100** | 100 % | 1,5× tiempo real | 4,5 GB |
| 4 | **[Chatterbox](https://huggingface.co/ResembleAI/chatterbox)** | **81** | 62 % | 1,7× tiempo real | 13,9 GB |

<sub>"4× tiempo real" quiere decir que genera 4 segundos de voz en 1 segundo.</sub>

### 🎨 Generación de imagen

| Modelo | Score | Tiempo por imagen | Reproducible | Tamaño |
|---|:-:|:-:|:-:|:-:|
| **[FLUX.1 Schnell FP8](https://huggingface.co/Comfy-Org/flux1-schnell)** | **100** | 1,0 s | ✅ misma semilla, misma imagen | 17,2 GB |

### 👁️ Visión (describir imágenes)

| Modelo | Score | Conceptos reconocidos | Tiempo por imagen | Tamaño |
|---|:-:|:-:|:-:|:-:|
| **[OrcaCyber-Nano-1.0](https://huggingface.co/orcarouter/OrcaCyber-Nano-1.0)** | **50** | 50 % | 7,0 s | 15,7 GB |

<sub>OrcaCyber-Nano-1.0 es un repositorio con acceso restringido (*gated*): hay que
aceptar sus condiciones en Hugging Face y guardar un token en *Configuración*
antes de descargarlo.</sub>

## Glosario rápido

| Término | En pocas palabras |
|---|---|
| **Token** | Un trozo de texto, más o menos media palabra. Leemos a unos 5–8 tokens por segundo. |
| **Parámetros (B)** | Miles de millones de "conexiones" del modelo. 3B es pequeño; 70B o más, grande. |
| **MoE** | *Mixture of Experts*: el modelo tiene muchos "expertos" y en cada palabra solo usa unos pocos. Rápido aunque sea enorme. |
| **Decodificación especulativa** | Un modelo pequeño (*drafter*) propone varios tokens y el grande los comprueba de una vez. Si acierta, la respuesta sale más rápido sin cambiar su calidad. |
| **Drafter** | El modelo pequeño que propone los tokens. Debe compartir vocabulario con el principal (Qwen3-Coder-Next, por ejemplo, no tiene ninguno compatible instalado) y los MTP solo sirven para el modelo con el que se entrenaron. En llama.cpp no se combina con visión (`mmproj`), así que MyDGX elige el drafter salvo que pidas visión. |
| **MTP** | *Multi-Token Prediction*: un drafter que viene dentro del GGUF o en un archivo aparte (`mtp-*.gguf`). En el Spark, BugHunter v7 pasa de 13 a 31 tok/s con el suyo y Cyber-Tiel Q5 de 64 a 90 tok/s. MyDGX lo activa solo si encuentra el drafter. |
| **Cuantización** | Compresión del modelo. `Q8_0` ≈ original; `Q6_K` muy bueno; `Q4` buen equilibrio; `IQ2`/`IQ3` mucha compresión para que quepan modelos gigantes. |
| **GGUF** | Formato de archivo que usa llama.cpp. Es el que mejor funciona en el Spark. |
| **Ollama / Hugging Face** | Dos sitios de donde descargar modelos. MyDGX gestiona los dos desde *Modelos*. |
| **Abliterated / Heretic / Uncensored** | Variantes a las que se les han quitado los filtros de rechazo. Úsalas con responsabilidad. |
| **Gated** | Repositorio que pide aceptar condiciones y un token de Hugging Face para descargar. |

## Cómo se ha medido

- **Equipo:** NVIDIA DGX Spark con GB10 y 128 GB de memoria unificada (273 GB/s).
- **Motores:** llama.cpp compilado para GB10 (sm_121) para los GGUF, Ollama para
  sus modelos, ComfyUI para imagen y los servicios locales de voz de MyDGX.
- **Aislamiento:** antes de cada medida MyDGX libera la memoria, carga solo ese
  modelo y lo calienta, para que nada interfiera.
- **Pruebas:** protocolos versionados por tipo de tarea, varias repeticiones y
  solo resultados válidos (todas las muestras correctas). En texto se mide la
  velocidad de salida, el tiempo hasta el primer token y la estabilidad entre
  repeticiones.
- **Qué no mide el score:** la calidad de las respuestas en tu caso concreto. Un
  modelo grande y lento puede razonar mejor que uno pequeño y rápido; usa el
  ranking para saber qué es cómodo de usar y prueba la calidad en *Chat*.

Los resultados cambian con la versión de llama.cpp, el contexto y la
cuantización. Para ver los tuyos, abre **Benchmarks** en MyDGX: cada modelo que
descargas se mide automáticamente. Detalle del método en
[Benchmarks reproducibles](benchmarks.md).
